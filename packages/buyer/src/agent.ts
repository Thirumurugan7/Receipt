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

/**
 * The current Ethereum head, from a public RPC the buyer picks itself.
 *
 * This is what lets the terms demand provenance in BLOCKS rather than seconds:
 * the buyer decides how far behind the chain it will tolerate, and the seller
 * cannot argue with a number the buyer sourced independently. Falls back to 0,
 * which disables the floor rather than inventing one.
 */
async function ethHeadBlock(): Promise<number> {
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
    } catch {
      // try the next one
    }
  }
  return 0
}

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
    /**
     * Acceptance terms written against The Graph's Token API payload.
     *
     * This is the point of the project in one object: the agent says what
     * shape of token data it is willing to pay for, and the escrow enforces
     * it. A response that is merely well-formed JSON does not qualify — the
     * schema demands a non-empty holdings array where every entry carries a
     * contract address and an integer-string amount, and freshness rejects a
     * stale snapshot even when it is otherwise perfect.
     */
    checks: {
      status: { in: [200] },
      contentType: { equals: 'application/json' },
      minBytes: 32,
      maxLatencyMs: 8000,
      requiredPaths: ['$.data', '$.timestamp', '$.source'],
      jsonSchema: {
        type: 'object',
        required: ['data', 'source', 'timestamp'],
        properties: {
          source: { type: 'string', const: 'the-graph-token-api' },
          timestamp: { type: 'integer', minimum: 1 },
          data: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              required: ['contract', 'amount'],
              properties: {
                contract: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
                amount: { type: 'string', pattern: '^[0-9]+$' },
              },
            },
          },
        },
      },
      freshnessSeconds: 3600,
    },
  }

  const head = await ethHeadBlock()
  /** How far behind the chain the buyer will accept. */
  const MAX_BLOCKS_BEHIND = Number(process.env.MAX_BLOCKS_BEHIND ?? 200)
  /**
   * If no head is available the buyer does NOT assert on block height at all.
   * The tempting fallback — a floor of 1 — passes for every possible input,
   * which is a check in name only. An absent clause is honest; a vacuous one
   * is a lie told to the person reading the terms.
   */
  const minIndexedBlock = head > 0 ? head - MAX_BLOCKS_BEHIND : null

  terms.checks.requiredPaths = [
    '$.data', '$.markets', '$.sources.balances', '$.sources.markets',
    '$.indexedBlock', '$.timestamp',
  ]
  terms.checks.jsonSchema = {
    type: 'object',
    required: ['data', 'markets', 'sources', 'indexedBlock', 'source', 'timestamp'],
    properties: {
      source: { type: 'string', const: 'the-graph' },
      timestamp: { type: 'integer', minimum: 1 },
      // both products must be named, so a quote cannot quietly drop one half
      sources: {
        type: 'object',
        required: ['balances', 'markets'],
        properties: {
          balances: { type: 'string', const: 'token-api' },
          markets: { type: 'string', const: 'subgraph' },
        },
      },
      // provenance in blocks: the subgraph must be near the chain head
      indexedBlock:
        minIndexedBlock === null
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
  console.log(`  products   the-graph token-api + subgraph (both asserted)`)
  console.log(
    minIndexedBlock === null
      ? `  provenance NOT ASSERTED — no eth head available, so no block floor was signed`
      : `  provenance indexedBlock >= ${minIndexedBlock}  (eth head ${head}, tolerance ${MAX_BLOCKS_BEHIND} blocks)`,
  )
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

  // The seller never answered. The facilitator declined to invent a verdict it
  // could not publish, so the deal is still open and the deadline is the
  // remedy — claimable by anyone, including people with no stake in it.
  if (res.status === 504) {
    const info = JSON.parse(body) as { dealId: string; claimableAfter: string; error: string }
    console.log(`\nHTTP 504 — seller did not respond`)
    console.log(`  dealId          ${info.dealId}`)
    console.log(`  claimable after ${info.claimableAfter}`)
    console.log(`  escrow          still Open; no verdict was published`)
    console.log(`\nbuyer balance now     ${hbar(after)}`)
    console.log(`buyer delta           ${hbar(after - before)}  (still escrowed)`)
    console.log(`\nrecover it with:  pnpm claim --deal ${info.dealId}`)
    return { verdict: 'unreachable' as const, dealId: info.dealId, delta: after - before }
  }

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
