/**
 * The ledger, rebuilt from the public log.
 *
 * Everything the ledger shows was published to the audit topic, so the view
 * can be reconstructed from the same public record a stranger would use. The
 * facilitator does this on boot so a restart does not leave an empty page, and
 * the hosted site does it in the browser so it needs no server at all.
 *
 * That second use is the point. If a static page with no backend can rebuild
 * the whole ledger from the log, then the log demonstrably contains what the
 * ledger claims, which is this project's argument run against itself.
 */
import type { Terms, Verdict } from './types.js'
import type { HcsMessage } from './hcs-read.js'

export type Phase =
  | 'terms-verified' | 'payment-verified' | 'settled' | 'escrowed'
  | 'seller-responded' | 'adjudicated' | 'released' | 'refunded'
  | 'awaiting-expiry' | 'expired' | 'failed'

/** Where one audit message landed, as a citation anyone can follow. */
export interface Cite { transactionId: string; sequenceNumber: number | null }

export interface LedgerDeal {
  dealId: string
  termsHash: string
  terms: Terms
  phase: Phase
  createdAt: number
  settlementTxId?: string
  openTxHash?: string
  resolveTxHash?: string
  verdict?: Verdict
  audit?: { terms?: Cite; observation?: Cite; verdict?: Cite }
}

export type LogRow = { consensusTimestamp: string; sequenceNumber: number; message: HcsMessage }

/** Consensus timestamps are `seconds.nanos`; only the ordering matters here. */
const toMillis = (ts: string): number => {
  const [secs, nanos] = ts.split('.')
  return Number(secs ?? 0) * 1000 + Math.floor(Number(nanos ?? 0) / 1e6)
}

export function recordsFromLog(rows: LogRow[]): LedgerDeal[] {
  const byDeal = new Map<string, LogRow[]>()

  for (const r of rows) {
    const m = r.message as { kind?: string; dealId?: string }
    // A shared topic can carry anything. Anything without our shape is data,
    // not a crash.
    if (!m || typeof m.dealId !== 'string' || typeof m.kind !== 'string') continue
    const list = byDeal.get(m.dealId) ?? []
    list.push(r)
    byDeal.set(m.dealId, list)
  }

  const out: LedgerDeal[] = []

  for (const [dealId, list] of byDeal) {
    const find = (kind: string) => list.find((r) => (r.message as { kind: string }).kind === kind)
    const termsRow = find('terms')
    const obsRow = find('observation')
    const verdictRow = find('verdict')
    if (!termsRow) continue

    const termsMsg = termsRow.message as Extract<HcsMessage, { kind: 'terms' }>
    const v = verdictRow?.message as Extract<HcsMessage, { kind: 'verdict' }> | undefined
    const verdict = v?.verdict as Verdict | undefined

    const cite = (row: LogRow | undefined) =>
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
