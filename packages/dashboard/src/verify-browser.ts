/**
 * Verification that runs in the reader's browser.
 *
 * Everything else on the ledger page is this project telling you what
 * happened. This is the part that does not ask to be believed: it fetches the
 * terms, the raw response and the published verdict straight from Hedera's
 * mirror node, re-runs the adjudicator here, and compares its own hash to the
 * one that was published. No request touches the facilitator, so the
 * facilitator cannot influence the answer.
 *
 * It is the same adjudicator the facilitator ran — the point is not that this
 * is independent code, it is that the *inputs* are public and the function is
 * pure, so the same inputs must give the same verdict. `verify-py/` is the
 * genuinely independent implementation, and agrees.
 */
import { adjudicate, attestedLatencyOf, hashVerdict, jcs, rebuildForHashing, recordsFromLog } from '@receipt/core'
import type { LedgerDeal, LogRow, Terms, Verdict } from '@receipt/core'
import { observationFromMessage, readTopic } from '@receipt/core/hcs-read'
import type { HcsMessage } from '@receipt/core/hcs-read'

export interface VerifyResult {
  dealId: string
  /** How many messages on the public log belong to this deal. */
  messages: number
  sequences: { terms?: number; observation?: number; verdict?: number }
  recomputed: Verdict | null
  /** Did every check result come out the same, byte for byte? */
  reproducibleMatches: boolean | null
  publishedPass: boolean | null
  recomputedHash: string | null
  publishedHash: string | null
  /** True only if the recomputed verdict hashes to the published value. */
  match: boolean
  note: string
}

const MIRROR: Record<string, string> = {
  testnet: 'https://testnet.mirrornode.hedera.com',
  mainnet: 'https://mainnet.mirrornode.hedera.com',
}

export async function verifyDeal(opts: {
  topicId: string
  dealId: string
  network?: string
  mirrorUrl?: string
}): Promise<VerifyResult> {
  const net = (opts.network ?? 'testnet').split(':').pop() ?? 'testnet'
  const mirrorUrl = opts.mirrorUrl ?? MIRROR[net] ?? MIRROR.testnet!

  type Row = Awaited<ReturnType<typeof readTopic>>[number]

  const all = await readTopic(mirrorUrl, opts.topicId)
  const mine = all.filter((m: Row) => (m.message as { dealId?: string }).dealId === opts.dealId)

  const pick = (kind: HcsMessage['kind']): Row | undefined =>
    mine.find((m: Row) => m.message.kind === kind)

  const termsMsg = pick('terms')
  const obsMsg = pick('observation')
  const verdictMsg = pick('verdict')

  const sequences = {
    terms: termsMsg?.sequenceNumber,
    observation: obsMsg?.sequenceNumber,
    verdict: verdictMsg?.sequenceNumber,
  }

  const base: VerifyResult = {
    dealId: opts.dealId,
    messages: mine.length,
    sequences,
    recomputed: null,
    reproducibleMatches: null,
    publishedPass: null,
    recomputedHash: null,
    publishedHash: null,
    match: false,
    note: '',
  }

  if (!termsMsg || !obsMsg) {
    return {
      ...base,
      note: verdictMsg
        ? 'the verdict is published but its inputs are not, so it cannot be rechecked'
        : 'no verdict on the log — the seller never answered, which is the correct outcome for that case',
    }
  }

  const terms = (termsMsg.message as Extract<HcsMessage, { kind: 'terms' }>).terms as Terms
  const published = verdictMsg
    ? (verdictMsg.message as Extract<HcsMessage, { kind: 'verdict' }>)
    : null

  // Latency is attested, not reproducible, so it is carried over from the
  // published document rather than invented here. Hashing a freshly built
  // verdict instead would report a mismatch on a perfectly honest verdict.
  const observation = observationFromMessage(
    obsMsg.message as Extract<HcsMessage, { kind: 'observation' }>,
    published ? attestedLatencyOf(published.verdict) : 0,
  )

  const recomputed = adjudicate(terms, observation)
  const recomputedHash = published
    ? hashVerdict(rebuildForHashing(published.verdict, recomputed.reproducible))
    : null

  return {
    ...base,
    recomputed,
    reproducibleMatches: published
      ? jcs(recomputed.reproducible) === jcs(published.verdict.reproducible)
      : null,
    publishedPass: published?.verdict?.pass ?? null,
    recomputedHash,
    publishedHash: published?.verdictHash ?? null,
    match: Boolean(
      published && recomputedHash &&
      published.verdictHash.toLowerCase() === recomputedHash.toLowerCase(),
    ),
    note: published
      ? 'recomputed in your browser from the public log; the facilitator was not asked'
      : 'inputs are published but no verdict is',
  }
}

/**
 * The whole ledger, rebuilt in the browser from the public topic.
 *
 * This is what lets the hosted site have no backend at all: it asks Hedera's
 * mirror node for the audit topic and reconstructs every deal from it, with
 * the same function the facilitator runs on boot. A page that can do this is
 * itself the argument, since it shows the log carries what the ledger claims.
 */
export async function loadLedger(opts: {
  topicId: string
  network?: string
  mirrorUrl?: string
}): Promise<LedgerDeal[]> {
  const net = (opts.network ?? 'testnet').split(':').pop() ?? 'testnet'
  const mirrorUrl = opts.mirrorUrl ?? MIRROR[net] ?? MIRROR.testnet!
  const rows = (await readTopic(mirrorUrl, opts.topicId)) as LogRow[]
  return recordsFromLog(rows)
}

/*
 * Published on the global object rather than `window`, so this file needs no
 * DOM lib: pulling that into the program conflicts with the Node types the
 * rest of the workspace is built against. In a browser globalThis IS window.
 */
;(globalThis as unknown as Record<string, unknown>).ReceiptVerify = { verifyDeal, loadLedger }
