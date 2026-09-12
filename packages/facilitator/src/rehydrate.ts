/**
 * Rebuilding the ledger from the public log.
 *
 * The deal log is in memory, so a restart would otherwise leave a visitor
 * looking at an empty page. It does not have to: everything the ledger shows
 * was published to the audit topic, so the facilitator can reconstruct its own
 * view from the same public record a stranger would use.
 *
 * The convenience is the smaller half of the point. If this page can be
 * rebuilt from the log, then the log demonstrably contains what the page
 * claims — which is the project's whole argument, run against itself.
 */
import type { Terms, Verdict } from '@receipt/core'
import type { HcsMessage } from '@receipt/core/hcs-read'
import { readTopic } from '@receipt/core/hcs-read'
import type { DealRecord } from './store.js'
import { upsert } from './store.js'

type Row = { consensusTimestamp: string; sequenceNumber: number; message: HcsMessage }

/** Consensus timestamps are `seconds.nanos`; only the ordering matters here. */
const toMillis = (ts: string): number => {
  const [secs, nanos] = ts.split('.')
  return Number(secs ?? 0) * 1000 + Math.floor(Number(nanos ?? 0) / 1e6)
}

export function recordsFromLog(rows: Row[]): DealRecord[] {
  const byDeal = new Map<string, Row[]>()

  for (const r of rows) {
    const m = r.message as { kind?: string; dealId?: string }
    // A shared topic can carry anything. Anything without our shape is data,
    // not a crash.
    if (!m || typeof m.dealId !== 'string' || typeof m.kind !== 'string') continue
    const list = byDeal.get(m.dealId) ?? []
    list.push(r)
    byDeal.set(m.dealId, list)
  }

  const out: DealRecord[] = []

  for (const [dealId, list] of byDeal) {
    const find = (kind: string) => list.find((r) => (r.message as { kind: string }).kind === kind)
    const termsRow = find('terms')
    const obsRow = find('observation')
    const verdictRow = find('verdict')
    if (!termsRow) continue

    const termsMsg = termsRow.message as Extract<HcsMessage, { kind: 'terms' }>
    const v = verdictRow?.message as Extract<HcsMessage, { kind: 'verdict' }> | undefined
    const verdict = v?.verdict as Verdict | undefined

    const cite = (row: Row | undefined) =>
      row ? { transactionId: '', sequenceNumber: row.sequenceNumber } : undefined

    out.push({
      dealId,
      termsHash: termsMsg.termsHash,
      terms: termsMsg.terms as Terms,
      // No verdict means the seller never answered, which is a real state and
      // the one `claimExpired` exists for — not a broken record to discard.
      phase: verdict ? (verdict.pass ? 'released' : 'refunded') : 'awaiting-expiry',
      createdAt: toMillis(termsRow.consensusTimestamp),
      settlementTxId: v?.settlementTxId ?? undefined,
      openTxHash: v?.openTxHash ?? undefined,
      resolveTxHash: v?.resolveTxHash ?? undefined,
      verdict,
      audit: {
        terms: cite(termsRow),
        observation: cite(obsRow),
        verdict: cite(verdictRow),
      },
    })
  }

  return out.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Best effort: a mirror node that is slow or down must not stop the
 * facilitator from starting, it just means the page opens empty until the
 * next deal.
 */
export async function rehydrate(mirrorUrl: string, topicId: string): Promise<number> {
  const rows = (await readTopic(mirrorUrl, topicId)) as Row[]
  const records = recordsFromLog(rows)
  for (const r of records) upsert(r)
  return records.length
}
