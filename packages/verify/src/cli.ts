/**
 * Independent verification of a Receipt verdict.
 *
 *   pnpm verify --topic <hcs-topic-id> --deal <dealId>
 *
 * This is the answer to "why should I trust your adjudicator". It does not
 * trust it. It pulls the terms and the raw response from the public HCS topic,
 * re-runs the SAME pure adjudicator offline, and checks the result against
 * both the published verdict and the hash recorded on-chain.
 *
 * It needs no credentials, no API key and no cooperation from the facilitator:
 * the Mirror Node and the JSON-RPC relay are public. If the facilitator had
 * lied about a verdict, the recomputed hash would differ from the one the
 * escrow recorded, and that discrepancy is what moved the money.
 *
 * What it proves and what it does not:
 *   - reproducible checks: recomputed here from published inputs. Proven.
 *   - attested checks (latency): the facilitator's own stopwatch. Nobody can
 *     recompute it, which is exactly why it gates nothing. Reported, not proven.
 */
import '@receipt/core/loadenv'
import { adjudicate, attestedLatencyOf, hashVerdict, jcs, rebuildForHashing } from '@receipt/core'
import type { Terms, Verdict } from '@receipt/core'
import { observationFromMessage, readTopic } from '@receipt/core/hcs'
import { keccak256, toBytes } from 'viem'

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const topicId = arg('topic') ?? process.env.HCS_TOPIC_ID
const dealId = arg('deal')
const mirror = arg('mirror') ?? process.env.HEDERA_MIRROR_URL ?? 'https://testnet.mirrornode.hedera.com'
const escrow = (arg('escrow') ?? process.env.ESCROW_ADDRESS ?? '').toLowerCase()

const all = process.argv.includes('--all')

if (!topicId || (!dealId && !all)) {
  console.error('usage: pnpm verify --topic <hcs-topic-id> (--deal <dealId> | --all) [--mirror <url>] [--escrow <address>]')
  process.exit(2)
}

const DEAL_RELEASED = keccak256(toBytes('DealReleased(bytes32,bytes32)'))
const DEAL_REFUNDED = keccak256(toBytes('DealRefunded(bytes32,bytes32,string)'))
const DEAL_EXPIRED = keccak256(toBytes('DealExpired(bytes32)'))

const pad = (s: string) => (s.startsWith('0x') ? s.toLowerCase() : `0x${s.toLowerCase()}`)

/**
 * Collects every escrow event for this deal from the public log.
 *
 * claimExpired emits BOTH DealExpired and DealRefunded (with a zero
 * verdictHash, since no verdict exists). Taking only the first match in
 * descending order picks up DealRefunded and hides the expiry, so all events
 * are gathered and the caller decides.
 *
 * The Mirror Node's `topic1=` filter silently returns an empty set here, so
 * the deal is matched client-side on topics[1] instead. Trusting that empty
 * result would report "not found" for a deal that is plainly on chain — a
 * false negative on the check that matters most.
 */
async function onChainEvents(): Promise<{ events: string[]; verdictHash: string | null }> {
  const out = { events: [] as string[], verdictHash: null as string | null }
  if (!escrow) return out
  const wanted = pad(dealId!)
  let next: string | null = `/api/v1/contracts/${escrow}/results/logs?limit=100&order=desc`

  for (let page = 0; next && page < 5; page++) {
    const res = await fetch(`${mirror}${next}`)
    if (!res.ok) return out
    const body = (await res.json()) as {
      logs?: { topics: string[]; data: string }[]
      links?: { next?: string | null }
    }
    for (const log of body.logs ?? []) {
      const t0 = pad(log.topics?.[0] ?? '')
      if (pad(log.topics?.[1] ?? '') !== wanted) continue

      const name =
        t0 === DEAL_RELEASED ? 'DealReleased'
        : t0 === DEAL_REFUNDED ? 'DealRefunded'
        : t0 === DEAL_EXPIRED ? 'DealExpired'
        : null
      if (!name) continue
      if (!out.events.includes(name)) out.events.push(name)

      if (name !== 'DealExpired' && out.verdictHash === null) {
        // verdictHash is the first non-indexed word of the data payload
        const data = log.data.startsWith('0x') ? log.data.slice(2) : log.data
        const h = pad(data.slice(0, 64))
        // claimExpired writes a zero hash; that is an absence, not a verdict
        if (!/^0x0{64}$/.test(h)) out.verdictHash = h
      }
    }
    next = body.links?.next ?? null
  }
  return out
}

const line = (k: string, v: unknown) => console.log(`  ${k.padEnd(26)}${v}`)

console.log('\nReceipt — independent verdict verification')
line('topic', topicId)
line('deal', dealId)
line('mirror node', mirror)
line('escrow', escrow || '(not checked: pass --escrow)')

const messages = await readTopic(mirror, topicId)

/**
 * Sweep every deal on the topic.
 *
 * One MATCH proves a deal. This proves a facilitator: if any verdict it ever
 * published fails to follow from its own published inputs, it shows up here.
 */
if (all) {
  const byDeal = new Map<string, typeof messages>()
  for (const m of messages) {
    const id = (m.message as { dealId?: string }).dealId
    if (!id) continue
    byDeal.set(id, [...(byDeal.get(id) ?? []), m])
  }

  let match = 0, mismatch = 0, expired = 0, withheld = 0, incomplete = 0
  const failures: string[] = []

  console.log(`\nsweeping topic ${topicId} — ${byDeal.size} deals\n`)
  for (const [id, msgs] of byDeal) {
    const t = msgs.find((m) => m.message.kind === 'terms')
    const o = msgs.find((m) => m.message.kind === 'observation')
    const v = msgs.find((m) => m.message.kind === 'verdict')
    const short = `${id.slice(0, 10)}…`

    if (!t) { incomplete++; console.log(`  ${short}  no terms`); continue }
    if (!v) { expired++; console.log(`  ${short}  no verdict — seller never answered (by design)`); continue }
    if (!o) { withheld++; console.log(`  ${short}  body withheld (bodyTooLarge) — not reproducible by design`); continue }

    const terms = (t.message as { terms: Terms }).terms
    const pub = v.message as { verdict: Verdict; verdictHash: string }
    const om = o.message as Extract<typeof o.message, { kind: 'observation' }>
    const latency = attestedLatencyOf(pub.verdict)
    const recomputed = adjudicate(terms, observationFromMessage(om, latency))
    const rebuilt: Verdict = rebuildForHashing(pub.verdict, recomputed.reproducible)
    const ok = hashVerdict(rebuilt).toLowerCase() === pub.verdictHash.toLowerCase()
      && jcs(recomputed.reproducible) === jcs(pub.verdict.reproducible)

    if (ok) { match++; console.log(`  ${short}  MATCH   ${pub.verdict.pass ? 'released' : `refunded (${pub.verdict.firstFailure})`}`) }
    else { mismatch++; failures.push(id); console.log(`  ${short}  MISMATCH`) }
  }

  console.log(`\n  reproduce        ${match}`)
  console.log(`  mismatch         ${mismatch}`)
  console.log(`  no verdict       ${expired}   (seller never answered — correct behaviour)`)
  if (withheld) console.log(`  body withheld    ${withheld}`)
  if (incomplete) console.log(`  incomplete       ${incomplete}`)

  console.log('')
  if (mismatch === 0 && match > 0) {
    console.log(`ALL ${match} VERDICTS REPRODUCE`)
    console.log('  every verdict this facilitator published follows from its own published')
    console.log('  inputs. Recomputed independently, with no cooperation from it.')
    process.exit(0)
  }
  console.log(`${mismatch} VERDICT(S) DO NOT REPRODUCE`)
  for (const f of failures) console.log(`  ${f}`)
  process.exit(1)
}

const forDeal = messages.filter((m) => (m.message as { dealId?: string }).dealId === dealId)

if (forDeal.length === 0) {
  console.error(`\nno messages on topic ${topicId} for deal ${dealId}`)
  process.exit(1)
}

const termsMsg = forDeal.find((m) => m.message.kind === 'terms')
const obsMsg = forDeal.find((m) => m.message.kind === 'observation')
const verdictMsg = forDeal.find((m) => m.message.kind === 'verdict')

console.log('\npublic log')
line('messages for this deal', forDeal.length)
if (termsMsg) line('terms', `seq #${termsMsg.sequenceNumber}`)
if (obsMsg) {
  const o = obsMsg.message as Extract<typeof obsMsg.message, { kind: 'observation' }>
  line('observation', `seq #${obsMsg.sequenceNumber}  status ${o.status}  ${Buffer.from(o.bodyBase64, 'base64').length} bytes`)
}
if (verdictMsg) line('verdict', `seq #${verdictMsg.sequenceNumber}`)

if (!termsMsg) {
  console.error('\nMISMATCH — no terms were published for this deal')
  process.exit(1)
}

/**
 * No verdict. That is a legitimate outcome, not a discrepancy: when the seller
 * never answers there is no response to judge, so the facilitator publishes
 * nothing rather than inventing a verdict nobody could reproduce. The deadline
 * is the remedy, and claimExpired is permissionless.
 *
 * Reporting this as MISMATCH would be wrong — nothing was misreported.
 */
if (!verdictMsg) {
  const chainEvents = await onChainEvents()
  console.log('\nno verdict was published for this deal')
  line('on-chain events', chainEvents.events.join(', ') || '(none found)')
  if (chainEvents.events.includes('DealExpired')) {
    console.log('\nEXPIRED — no verdict exists, and none should.')
    console.log('  the seller never responded, so the adjudicator produced nothing to publish.')
    console.log('  the deadline passed and claimExpired returned the funds to the payer.')
    console.log('  nobody had to be trusted, and nobody had to be asked.')
    process.exit(0)
  }
  console.log('\nINCOMPLETE — terms were published but no verdict and no expiry event.')
  console.log('  the deal may still be open and awaiting its deadline.')
  process.exit(1)
}

const terms = (termsMsg.message as Extract<typeof termsMsg.message, { kind: 'terms' }>).terms
const published = (verdictMsg.message as Extract<typeof verdictMsg.message, { kind: 'verdict' }>)

if (!obsMsg) {
  console.log('\nno observation was published for this deal.')
  console.log(`published verdict: pass=${published.verdict.pass} firstFailure=${published.verdict.firstFailure}`)
  console.log(
    '\nNOT REPRODUCIBLE — by design, not by accident: the response body exceeded the\n' +
      'publish cap, so the facilitator recorded bodyTooLarge and withheld it rather\n' +
      'than publishing a truncated body nobody could replay.',
  )
  process.exit(1)
}

// Re-run the adjudicator on the published inputs. Latency comes from the
// published verdict because it is attested, not reproducible.
const attestedLatency = attestedLatencyOf(published.verdict)
const observation = observationFromMessage(
  obsMsg.message as Extract<typeof obsMsg.message, { kind: 'observation' }>,
  attestedLatency,
)

console.log('\nre-running the adjudicator offline')
const recomputed: Verdict = adjudicate(terms, observation)

const reproducibleMatches = jcs(recomputed.reproducible) === jcs(published.verdict.reproducible)
line('checks recomputed', recomputed.reproducible.length)
line('reproducible[] identical', reproducibleMatches ? 'YES' : 'NO')
line('pass recomputed', recomputed.pass)
line('pass published', published.verdict.pass)

// Rebuild the exact published document, substituting our own reproducible
// array, then hash it. If the facilitator altered a single check result the
// hash moves and no longer matches what the escrow recorded.
const rebuilt: Verdict = rebuildForHashing(published.verdict, recomputed.reproducible)
const recomputedHash = hashVerdict(rebuilt)

console.log('\nhashes')
line('recomputed verdictHash', recomputedHash)
line('published verdictHash', published.verdictHash)
const chain = await onChainEvents()
line(
  'on-chain verdictHash',
  chain.verdictHash ? `${chain.verdictHash}  (${chain.events.join(', ')})` : '(not found)',
)

const publishedOk = recomputedHash.toLowerCase() === published.verdictHash.toLowerCase()
const chainOk = chain.verdictHash
  ? chain.verdictHash.toLowerCase() === published.verdictHash.toLowerCase()
  : null

console.log('\nsettlement legs recorded on the log')
line('x402 settlement', published.settlementTxId ?? '-')
line('open()', published.openTxHash ?? '-')
line('release()/refund()', published.resolveTxHash ?? '-')

const allOk = reproducibleMatches && publishedOk && chainOk !== false
console.log('')
if (allOk) {
  console.log('MATCH')
  console.log(
    chainOk
      ? '  the verdict follows from the published terms and response, and its hash is the one the escrow recorded.'
      : '  the verdict follows from the published terms and response. (on-chain hash not checked)',
  )
  process.exit(0)
}
console.log('MISMATCH')
if (!reproducibleMatches) {
  console.log('  recomputed checks differ from the published ones:')
  console.log(`    recomputed: ${jcs(recomputed.reproducible)}`)
  console.log(`    published : ${jcs(published.verdict.reproducible)}`)
}
if (!publishedOk) console.log('  the published verdictHash does not match the published document')
if (chainOk === false) console.log('  the on-chain verdictHash does not match the published verdict')
process.exit(1)
