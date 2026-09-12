/**
 * The nine-step flow from BUILD.md §3, as amended by DECISIONS-01.
 *
 * The ordering matters and is not arbitrary: settlement happens before escrow
 * (the facilitator cannot fund open() with money it does not yet hold), and
 * escrow happens before the seller is called (so a seller that hangs cannot
 * cost the buyer anything that claimExpired cannot recover).
 */
import { adjudicate, hashTerms, hashVerdict, dealId as computeDealId } from '@receipt/core'
import type { Hex, Observation, Terms, Verdict } from '@receipt/core'
import { MAX_BODY_BYTES, submit } from '@receipt/core/hcs'
import { encodeTermsHeader, recoverTermsSigner } from '@receipt/core'
import { config } from './env.js'
import { blocky, requirementsFor, type PaymentPayload } from './blocky.js'
import * as escrow from './escrow.js'
import { advance, get as getDeal, upsert } from './store.js'
import { record as recordSettlement } from './payments.js'

/** Must stay below the terms deadline, or a hung seller would outlive it. */
export const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS ?? 45_000)

const domain = {
  name: 'Receipt',
  version: '1',
  chainId: config.chainId,
  verifyingContract: config.escrow,
} as const

const hcs = { operatorId: config.operatorId, operatorKey: config.operatorKey, network: 'testnet' as const }

export class FlowError extends Error {
  constructor(message: string, readonly status = 400) { super(message) }
}

/**
 * The seller never answered.
 *
 * This deliberately does NOT refund. The adjudicator's whole claim is that a
 * verdict is a pure function of (terms, response) that anyone can recompute —
 * and there is no response here to publish, so any verdict would be one nobody
 * could reproduce. Rather than invent one, the facilitator declines to resolve
 * and leaves the deal open.
 *
 * The buyer is not stuck: past the deadline `claimExpired` returns the money
 * and needs no permission from anyone, including us. That is the point of the
 * deadline, and it holds even if this facilitator disappears entirely.
 */
export class SellerUnreachableError extends FlowError {
  constructor(readonly dealId: Hex, readonly deadlineMs: number, readonly waitedMs: number) {
    super(
      `seller did not respond within ${waitedMs}ms; deal left open, ` +
        `claimExpired is callable by anyone after ${new Date(deadlineMs).toISOString()}`,
      504,
    )
  }
}

/** Step 1: the terms must be signed by the payer they name. */
export async function assertTermsSigned(terms: Terms, signature: Hex): Promise<void> {
  const recovered = await recoverTermsSigner(terms, domain, signature)
  if (recovered.toLowerCase() !== terms.payer.toLowerCase()) {
    throw new FlowError(`terms signature recovers to ${recovered}, not payer ${terms.payer}`, 401)
  }
}

export interface FlowResult {
  dealId: Hex
  verdict: Verdict
  body: Uint8Array
  status: number
  contentType: string
  settlementTxId: string
  openTxHash: Hex
  resolveTxHash: Hex
}

export async function runFlow(
  terms: Terms,
  signature: Hex,
  paymentPayload: PaymentPayload,
): Promise<FlowResult> {
  const dealId = computeDealId(terms)
  const termsHash = hashTerms(terms)

  upsert({
    dealId, termsHash, terms, phase: 'terms-verified', createdAt: Date.now(),
  })

  // 1. terms signature
  await assertTermsSigned(terms, signature)

  // 2. x402 payment verification, delegated to Blocky402
  const requirements = requirementsFor(terms.amount)
  const verified = await blocky.verify(paymentPayload, requirements)
  if (!verified.isValid) {
    advance(dealId, { phase: 'failed', error: `payment invalid: ${verified.invalidReason ?? '?'}` })
    throw new FlowError(`payment verification failed: ${verified.invalidReason ?? 'unknown'}`, 402)
  }
  advance(dealId, { phase: 'payment-verified' })

  // 3. settle — Blocky402 adds the fee-payer signature and submits
  const settled = await blocky.settle(paymentPayload, requirements)
  if (!settled.success || !settled.transaction) {
    advance(dealId, { phase: 'failed', error: `settle failed: ${settled.errorReason ?? '?'}` })
    throw new FlowError(`settlement failed: ${settled.errorReason ?? 'unknown'}`, 402)
  }
  const settlementTxId = settled.transaction
  // Register BEFORE the seller is called: its middleware will ask Receipt to
  // verify and settle this very payment, and must be answered from here
  // rather than by re-submitting a transaction that already reached consensus.
  recordSettlement(paymentPayload, {
    transaction: settlementTxId,
    payer: settled.payer ?? terms.payer,
    at: Date.now(),
  })
  advance(dealId, { phase: 'settled', settlementTxId })

  // 4. escrow. The custody hop closes here.
  const opened = await escrow.open(terms, signature)
  advance(dealId, { phase: 'escrowed', openTxHash: opened.hash })

  // 5. call the seller, timed
  const termsMsg = await submit(hcs, config.topicId, { kind: 'terms', dealId, termsHash, terms })
  advance(dealId, { audit: { terms: termsMsg } })

  const requestTimeMs = Date.now()
  const started = performance.now()
  let status = 0
  let headers: Record<string, string> = {}
  let body = new Uint8Array()
  let reachedSeller = false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS) // DECISIONS-01 Q6
  try {
    const res = await fetch(terms.resource, {
      // x402 v2 carries the payment in PAYMENT-SIGNATURE. The resource
      // server's extractPayment() reads ONLY that header — `x-payment` is
      // v1 and is used solely to decide whether a route needs payment, so
      // sending it alone yields a 402 on a request that was in fact paid.
      headers: {
        'PAYMENT-SIGNATURE': encodePayment(paymentPayload),
        'X-PAYMENT': encodePayment(paymentPayload),
        // The seller gets the buyer's signed terms too. Because the checks are
        // a pure function, a seller holding them can grade its own response
        // before returning it — and decline a sale it knows it cannot earn.
        // No design with an external evaluator permits that.
        'X-Receipt-Terms': encodeTermsHeader(terms),
      },
      signal: controller.signal,
    })
    status = res.status
    headers = Object.fromEntries([...res.headers].map(([k, v]) => [k.toLowerCase(), v]))
    body = new Uint8Array(await res.arrayBuffer())
    reachedSeller = true
  } catch {
    reachedSeller = false
  } finally {
    clearTimeout(timeout)
  }
  const observedLatencyMs = Math.round(performance.now() - started)

  // Read provenance out of the body for the ledger view. Purely cosmetic —
  // nothing here influences the verdict.
  let bought: { products: string; indexedBlock?: number } | undefined
  let sellerDeclined = false
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as {
      sources?: Record<string, string>
      indexedBlock?: number
      declined?: boolean
    }
    sellerDeclined = parsed?.declined === true
    if (parsed?.sources) {
      bought = {
        products: Object.values(parsed.sources).join(' + '),
        indexedBlock: parsed.indexedBlock,
      }
    }
  } catch { /* a non-JSON body simply has no provenance to show */ }

  if (!reachedSeller) {
    advance(dealId, { phase: 'awaiting-expiry', observedLatencyMs })
    throw new SellerUnreachableError(dealId, terms.deadlineMs, observedLatencyMs)
  }

  advance(dealId, { phase: 'seller-responded', observedLatencyMs, bought, sellerDeclined })

  const observation: Observation = { status, headers, body, requestTimeMs, observedLatencyMs }

  // 6. adjudicate — pure
  let verdict: Verdict = adjudicate(terms, observation)

  // DECISIONS-01 Q2: refuse rather than truncate. A body we cannot publish is
  // a verdict nobody can reproduce, which is worse than a failure.
  const bodyTooLarge = body.length > MAX_BODY_BYTES
  if (bodyTooLarge) {
    verdict = {
      ...verdict,
      reproducible: [{
        check: 'bodyTooLarge',
        pass: false,
        detail: `${body.length} bytes exceeds the ${MAX_BODY_BYTES} byte publish cap`,
      }],
      pass: false,
      firstFailure: 'bodyTooLarge',
    }
  } else {
    const obsMsg = await submit(hcs, config.topicId, {
      kind: 'observation', dealId, termsHash, status, headers,
      bodyBase64: Buffer.from(body).toString('base64'), requestTimeMs,
    })
    advance(dealId, { audit: { ...getDeal(dealId)?.audit, observation: obsMsg } })
  }
  const verdictHash = hashVerdict(verdict)
  advance(dealId, { phase: 'adjudicated', verdict })

  // 7. resolve on-chain
  const resolveTxHash = verdict.pass
    ? await escrow.release(dealId, verdictHash)
    : await escrow.refund(dealId, verdictHash, verdict.firstFailure ?? 'failed')
  advance(dealId, { phase: verdict.pass ? 'released' : 'refunded', resolveTxHash })

  // 8. publish the verdict, with BOTH legs of the custody hop recorded
  const verdictMsg = await submit(hcs, config.topicId, {
    kind: 'verdict', dealId, termsHash, verdictHash, verdict,
    settlementTxId, openTxHash: opened.hash, resolveTxHash,
  })
  advance(dealId, { audit: { ...getDeal(dealId)?.audit, verdict: verdictMsg } })

  return {
    dealId, verdict, body, status,
    contentType: headers['content-type'] ?? '',
    settlementTxId, openTxHash: opened.hash, resolveTxHash,
  }
}

export function encodePayment(p: PaymentPayload): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64')
}

export function decodePayment(header: string): PaymentPayload {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as PaymentPayload
}
