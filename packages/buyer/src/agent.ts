/**
 * The buying agent, as a CLI.
 *
 * Presentation only — the actual purchase lives in buy.ts, shared with the MCP
 * server so the two cannot drift. Compared with a plain x402 client the only
 * differences are the two headers it attaches and the URL it points at: it
 * states, in machine terms, what it is willing to pay for, and signs that
 * statement.
 */
import '@receipt/core/loadenv'
import { buy, buildTerms } from './buy.js'

const need = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const MIRROR = need('HEDERA_MIRROR_URL')
const SELLER = process.env.SELLER_URL ?? 'http://localhost:8787'
const BUYER_ID = need('BUYER_HEDERA_ACCOUNT_ID')

const hbar = (tb: bigint) => `${(Number(tb) / 1e8).toFixed(8)} ℏ`

async function balance(id: string): Promise<bigint> {
  const r = await fetch(`${MIRROR}/api/v1/accounts/${id}`)
  const j = (await r.json()) as { balance?: { balance?: number } }
  return BigInt(j.balance?.balance ?? 0)
}

export async function run(mode = 'honest') {
  // `<mode>-selfcheck` asks the seller to grade its own response against the
  // buyer's terms before returning it, and decline rather than fail.
  const selfCheck = mode.endsWith('-selfcheck')
  const base = selfCheck ? mode.slice(0, -'-selfcheck'.length) : mode
  const resource = `${SELLER}/api/quote?mode=${base}${selfCheck ? '&selfcheck=1' : ''}`
  const { terms, minIndexedBlock, head } = await buildTerms({ resource })

  console.log('terms')
  console.log(`  resource   ${resource}`)
  console.log(`  amount     ${terms.amount} tinybars (${hbar(BigInt(terms.amount))})`)
  console.log(`  checks     ${Object.keys(terms.checks).join(', ')}`)
  console.log(`  products   the-graph token-api + subgraph (both asserted)`)
  if (selfCheck) console.log(`  selfcheck  seller will grade its own response before answering`)
  console.log(
    minIndexedBlock === null
      ? `  provenance NOT ASSERTED — no eth head available, so no block floor was signed`
      : `  provenance indexedBlock >= ${minIndexedBlock}  (eth head ${head}, tolerance ${head - minIndexedBlock} blocks)`,
  )

  const before = await balance(BUYER_ID)
  console.log(`\nbuyer balance before  ${hbar(before)}`)

  // the very terms printed above, not a freshly built lookalike
  const r = await buy({ resource }, terms)
  console.log(`\n402 payment required -> payTo ${need('FACILITATOR_HEDERA_ACCOUNT_ID')} (the facilitator, not the seller)`)

  if (r.outcome === 'unreachable') {
    const after = await balance(BUYER_ID)
    console.log(`\nHTTP 504 — seller did not respond`)
    console.log(`  dealId          ${r.dealId}`)
    console.log(`  escrow          still Open; no verdict was published`)
    console.log(`\nbuyer balance now     ${hbar(after)}`)
    console.log(`buyer delta           ${hbar(after - before)}  (still escrowed)`)
    console.log(`\nrecover it with:  pnpm claim --deal ${r.dealId}`)
    return r
  }

  const after = await balance(BUYER_ID)

  console.log(`\nseller responded HTTP ${r.sellerStatus}`)
  if (r.declined) {
    let reason = '(unknown)'
    try { reason = (JSON.parse(r.body) as { reason?: string }).reason ?? reason } catch { /* keep default */ }
    console.log(`  the seller DECLINED the sale`)
    console.log(`  it ran the buyer's own checks, saw it would fail on: ${reason}`)
    console.log(`  and refused rather than take a payment it could not keep`)
  }
  console.log(`  verdict        ${r.settled ? 'pass' : 'fail'}`)
  console.log(`  firstFailure   ${r.firstFailure ?? '(none)'}`)
  console.log(`  dealId         ${r.dealId}`)
  console.log(`  settlement tx  ${r.settlementTxId}`)
  console.log(`  open tx        ${r.openTxHash}`)
  console.log(`  resolve tx     ${r.resolveTxHash}`)
  console.log(`\nbody: ${r.body.slice(0, 300)}`)
  console.log(`\nbuyer balance after   ${hbar(after)}`)
  console.log(`buyer delta           ${hbar(after - before)}`)
  console.log(
    r.settled
      ? '\nchecks passed -> funds released to the seller'
      : '\nchecks failed -> funds refunded to the buyer',
  )
  return r
}

await run(process.argv[2] ?? 'honest')
