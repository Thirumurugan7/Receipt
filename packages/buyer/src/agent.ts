/**
 * The buying agent.
 *
 * Compared with a plain x402 client, the only differences are the two headers
 * it attaches and the URL it points at. It states, up front and in machine
 * terms, what it is willing to pay for — and signs that statement.
 */
import '@receipt/core/loadenv'
import { PrivateKey } from '@hiero-ledger/sdk'
import { createClientHederaSigner } from '@x402/hedera'
import { privateKeyToAccount } from 'viem/accounts'
import { toHex } from 'viem'
import { encodeTermsHeader, hashTerms, signTerms } from '@receipt/core'
import type { Terms } from '@receipt/core'

const need = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const RECEIPT = process.env.RECEIPT_FACILITATOR_URL ?? 'http://localhost:8080'
const SELLER = process.env.SELLER_URL ?? 'http://localhost:8787'
const MIRROR = need('HEDERA_MIRROR_URL')
const NETWORK = need('BLOCKY402_NETWORK')
const AMOUNT_TINYBARS = process.env.SELLER_PRICE_TINYBARS ?? '50000000'

const buyer = privateKeyToAccount(need('BUYER_PRIVATE_KEY') as `0x${string}`)
const BUYER_ID = need('BUYER_HEDERA_ACCOUNT_ID')

const hbar = (tb: bigint) => `${(Number(tb) / 1e8).toFixed(8)} ℏ`

async function balance(id: string): Promise<bigint> {
  const r = await fetch(`${MIRROR}/api/v1/accounts/${id}`)
  const j = (await r.json()) as { balance?: { balance?: number } }
  return BigInt(j.balance?.balance ?? 0)
}

function parseHederaKey(raw: string): PrivateKey {
  return PrivateKey.fromStringECDSA(raw.startsWith('0x') ? raw.slice(2) : raw)
}

export async function buy(mode = 'honest') {
  const resource = `${SELLER}/api/quote?mode=${mode}`

  /**
   * The acceptance criteria. Every one of these is a pure function of the
   * response, which is the entire reason there is no judge in this protocol.
   */
  const terms: Terms = {
    v: 1,
    nonce: toHex(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)), { size: 32 }),
    payer: buyer.address,
    payee: need('SELLER_EVM_ADDRESS') as `0x${string}`,
    token: need('SETTLEMENT_ASSET'),
    amount: AMOUNT_TINYBARS,
    resource,
    deadlineMs: Date.now() + 60_000, // DECISIONS-01 Q6: watchable on video
    checks: {
      status: { in: [200] },
      contentType: { equals: 'application/json' },
      minBytes: 32,
      maxLatencyMs: 5000,
      requiredPaths: ['$.data', '$.timestamp'],
      jsonSchema: {
        type: 'object',
        required: ['data'],
        properties: { data: { type: 'array', minItems: 1 } },
      },
      freshnessSeconds: 120,
    },
  }

  const domain = {
    name: 'Receipt',
    version: '1',
    chainId: Number(need('HEDERA_CHAIN_ID')),
    verifyingContract: need('ESCROW_ADDRESS') as `0x${string}`,
  }
  const signature = await signTerms(terms, domain, buyer)

  console.log('terms')
  console.log(`  resource   ${terms.resource}`)
  console.log(`  amount     ${AMOUNT_TINYBARS} tinybars (${hbar(BigInt(AMOUNT_TINYBARS))})`)
  console.log(`  checks     ${Object.keys(terms.checks).join(', ')}`)
  console.log(`  termsHash  ${hashTerms(terms)}`)

  const before = await balance(BUYER_ID)
  console.log(`\nbuyer balance before  ${hbar(before)}`)

  const headers: Record<string, string> = {
    'X-Receipt-Terms': encodeTermsHeader(terms),
    'X-Receipt-Signature': signature,
  }

  // 1. ask, unpaid — standard x402
  const quote = await fetch(`${RECEIPT}/proxy`, { method: 'POST', headers })
  if (quote.status !== 402) {
    throw new Error(`expected 402 from facilitator, got ${quote.status}: ${await quote.text()}`)
  }
  const required = (await quote.json()) as { accepts: Record<string, unknown>[] }
  const requirements = required.accepts[0]!
  console.log(`\n402 payment required -> payTo ${requirements.payTo} (the facilitator, not the seller)`)

  // 2. build the partially-signed transfer. The fee-payer signature is NOT ours.
  const signer = createClientHederaSigner(BUYER_ID, parseHederaKey(need('BUYER_PRIVATE_KEY')), {
    network: NETWORK,
  })
  const transaction = await signer.createPartiallySignedTransferTransaction(requirements as never)
  const paymentPayload = {
    x402Version: 2,
    scheme: 'exact',
    network: NETWORK,
    accepted: requirements,
    payload: { transaction },
  }

  // 3. pay
  const res = await fetch(`${RECEIPT}/proxy`, {
    method: 'POST',
    headers: {
      ...headers,
      'X-PAYMENT': Buffer.from(JSON.stringify(paymentPayload), 'utf8').toString('base64'),
    },
  })

  const body = await res.text()
  const verdict = res.headers.get('X-Receipt-Verdict')
  const after = await balance(BUYER_ID)

  console.log(`\nHTTP ${res.status}`)
  console.log(`  verdict        ${verdict}`)
  console.log(`  firstFailure   ${res.headers.get('X-Receipt-First-Failure') || '(none)'}`)
  console.log(`  dealId         ${res.headers.get('X-Receipt-Deal-Id')}`)
  console.log(`  settlement tx  ${res.headers.get('X-Receipt-Settlement-Tx')}`)
  console.log(`  open tx        ${res.headers.get('X-Receipt-Open-Tx')}`)
  console.log(`  resolve tx     ${res.headers.get('X-Receipt-Resolve-Tx')}`)
  console.log(`\nbody: ${body.slice(0, 300)}`)
  console.log(`\nbuyer balance after   ${hbar(after)}`)
  console.log(`buyer delta           ${hbar(after - before)}`)
  console.log(
    verdict === 'pass'
      ? '\nchecks passed -> funds released to the seller'
      : '\nchecks failed -> funds refunded to the buyer',
  )
  return { verdict, dealId: res.headers.get('X-Receipt-Deal-Id'), delta: after - before }
}

const mode = process.argv[2] ?? 'honest'
await buy(mode)
