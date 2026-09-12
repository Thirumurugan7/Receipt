/**
 * The buying routine, shared by the CLI agent and the MCP server.
 *
 * Deliberately lives on the buyer side: the facilitator never holds the
 * buyer's key, and never authors the terms it is later judged against. An
 * agent that wants conditional settlement signs its own criteria or the
 * guarantee is worth nothing.
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

export interface BuyOptions {
  /** URL of the priced resource. */
  resource: string
  requiredPaths?: string[]
  freshnessSeconds?: number
  maxPriceTinybars?: string
  /** Extra JSON Schema to demand of the body, merged over the default. */
  jsonSchema?: Record<string, unknown>
}

export interface BuyResult {
  outcome: 'released' | 'refunded' | 'unreachable'
  settled: boolean
  dealId: string | null
  firstFailure: string | null
  status: number
  body: string
  data: unknown
  settlementTxId: string | null
  openTxHash: string | null
  resolveTxHash: string | null
  verifyCommand: string | null
  topic: string | null
}

/** The head of a public chain, used to demand provenance in blocks not seconds. */
export async function ethHeadBlock(): Promise<number> {
  const rpcs = process.env.ETH_RPC_URL
    ? [process.env.ETH_RPC_URL]
    : ['https://ethereum-rpc.publicnode.com', 'https://eth.drpc.org']
  for (const rpc of rpcs) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        signal: AbortSignal.timeout(8000),
      })
      const j = (await res.json()) as { result?: string }
      if (j.result) return parseInt(j.result, 16)
    } catch { /* try the next */ }
  }
  return 0
}

export async function buildTerms(opts: BuyOptions): Promise<{ terms: Terms; minIndexedBlock: number | null; head: number }> {
  const buyer = privateKeyToAccount(need('BUYER_PRIVATE_KEY') as `0x${string}`)
  const head = await ethHeadBlock()
  const maxBehind = Number(process.env.MAX_BLOCKS_BEHIND ?? 200)
  // A floor of 1 would pass for every input — a clause in name only. Absent is
  // honest; vacuous is a lie told to whoever reads the terms.
  const minIndexedBlock = head > 0 ? head - maxBehind : null

  const terms: Terms = {
    v: 1,
    nonce: toHex(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)), { size: 32 }),
    payer: buyer.address,
    payee: need('SELLER_EVM_ADDRESS') as `0x${string}`,
    token: need('SETTLEMENT_ASSET'),
    amount: opts.maxPriceTinybars ?? process.env.SELLER_PRICE_TINYBARS ?? '50000000',
    resource: opts.resource,
    deadlineMs: Date.now() + 60_000,
    checks: {
      status: { in: [200] },
      contentType: { equals: 'application/json' },
      minBytes: 32,
      maxLatencyMs: 8000,
      requiredPaths: opts.requiredPaths ?? [
        '$.data', '$.markets', '$.sources.balances', '$.sources.markets', '$.indexedBlock', '$.timestamp',
      ],
      jsonSchema: opts.jsonSchema ?? {
        type: 'object',
        required: ['data', 'markets', 'sources', 'indexedBlock', 'source', 'timestamp'],
        properties: {
          source: { type: 'string', const: 'the-graph' },
          timestamp: { type: 'integer', minimum: 1 },
          sources: {
            type: 'object',
            required: ['balances', 'markets'],
            properties: {
              balances: { type: 'string', const: 'token-api' },
              markets: { type: 'string', const: 'subgraph' },
            },
          },
          indexedBlock: minIndexedBlock === null
            ? { type: 'integer' }
            : { type: 'integer', minimum: minIndexedBlock },
          data: {
            type: 'array', minItems: 1,
            items: {
              type: 'object', required: ['contract', 'amount'],
              properties: {
                contract: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
                amount: { type: 'string', pattern: '^[0-9]+$' },
              },
            },
          },
          markets: {
            type: 'array', minItems: 1,
            items: {
              type: 'object', required: ['pool', 'pair'],
              properties: { pool: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' } },
            },
          },
        },
      },
      freshnessSeconds: opts.freshnessSeconds ?? 3600,
    },
  }
  return { terms, minIndexedBlock, head }
}

function parseHederaKey(raw: string): PrivateKey {
  return PrivateKey.fromStringECDSA(raw.startsWith('0x') ? raw.slice(2) : raw)
}

/**
 * @param prebuilt Terms already produced by `buildTerms`. Pass them when the
 *   caller displayed the terms first: building twice would sign a different
 *   nonce from the one it showed, which is a lie in a demo about verifiable
 *   acceptance criteria.
 */
export async function buy(
  opts: BuyOptions,
  prebuilt?: Terms,
): Promise<BuyResult & { terms: Terms; termsHash: string }> {
  const facilitator = process.env.RECEIPT_FACILITATOR_URL ?? 'http://localhost:8080'
  const network = need('BLOCKY402_NETWORK')
  const buyer = privateKeyToAccount(need('BUYER_PRIVATE_KEY') as `0x${string}`)

  const terms = prebuilt ?? (await buildTerms(opts)).terms
  const domain = {
    name: 'Receipt',
    version: '1',
    chainId: Number(need('HEDERA_CHAIN_ID')),
    verifyingContract: need('ESCROW_ADDRESS') as `0x${string}`,
  }
  const signature = await signTerms(terms, domain, buyer)
  const headers: Record<string, string> = {
    'X-Receipt-Terms': encodeTermsHeader(terms),
    'X-Receipt-Signature': signature,
  }

  // 1. ask unpaid — standard x402
  const quote = await fetch(`${facilitator}/proxy`, { method: 'POST', headers })
  if (quote.status !== 402) {
    throw new Error(`expected 402 from the facilitator, got ${quote.status}: ${(await quote.text()).slice(0, 200)}`)
  }
  const required = (await quote.json()) as { accepts: Record<string, unknown>[] }
  const requirements = required.accepts[0]!

  // 2. partially sign the transfer; the fee-payer signature is not ours
  const signer = createClientHederaSigner(
    need('BUYER_HEDERA_ACCOUNT_ID'),
    parseHederaKey(need('BUYER_PRIVATE_KEY')),
    { network },
  )
  const transaction = await signer.createPartiallySignedTransferTransaction(requirements as never)
  const paymentPayload = {
    x402Version: 2, scheme: 'exact', network,
    accepted: requirements, payload: { transaction },
  }

  // 3. pay
  const res = await fetch(`${facilitator}/proxy`, {
    method: 'POST',
    headers: { ...headers, 'X-PAYMENT': Buffer.from(JSON.stringify(paymentPayload), 'utf8').toString('base64') },
  })
  const body = await res.text()
  const dealId = res.headers.get('X-Receipt-Deal-Id')
  const topic = process.env.HCS_TOPIC_ID ?? null

  if (res.status === 504) {
    const info = JSON.parse(body) as { dealId: string }
    return {
      outcome: 'unreachable', settled: false, dealId: info.dealId, firstFailure: null,
      status: 504, body, data: null, settlementTxId: null, openTxHash: null,
      resolveTxHash: null, verifyCommand: null, topic, terms, termsHash: hashTerms(terms),
    }
  }

  const verdict = res.headers.get('X-Receipt-Verdict')
  const passed = verdict === 'pass'
  let data: unknown = null
  try { data = JSON.parse(body) } catch { /* non-JSON body stays null */ }

  return {
    outcome: passed ? 'released' : 'refunded',
    settled: passed,
    dealId,
    firstFailure: res.headers.get('X-Receipt-First-Failure') || null,
    status: res.status,
    body,
    // Data that failed its checks is never returned as if it passed.
    data: passed ? data : null,
    settlementTxId: res.headers.get('X-Receipt-Settlement-Tx'),
    openTxHash: res.headers.get('X-Receipt-Open-Tx'),
    resolveTxHash: res.headers.get('X-Receipt-Resolve-Tx'),
    verifyCommand: dealId ? `pnpm verify --deal ${dealId}` : null,
    topic,
    terms,
    termsHash: hashTerms(terms),
  }
}
