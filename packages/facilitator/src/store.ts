/** In-memory deal log plus an SSE fan-out for the dashboard. */
import type { Terms, Verdict } from '@receipt/core'

export type Phase =
  | 'terms-verified' | 'payment-verified' | 'settled' | 'escrowed'
  | 'seller-responded' | 'adjudicated' | 'released' | 'refunded'
  | 'awaiting-expiry' | 'expired' | 'failed'

export interface DealRecord {
  dealId: string
  termsHash: string
  terms: Terms
  phase: Phase
  createdAt: number
  settlementTxId?: string
  openTxHash?: string
  resolveTxHash?: string
  verdict?: Verdict
  observedLatencyMs?: number
  /** What the response said it was made of, for the ledger view. */
  bought?: { products: string; indexedBlock?: number }
  /** True when the seller graded its own response and refused the sale. */
  sellerDeclined?: boolean
  error?: string
}

const deals = new Map<string, DealRecord>()
const listeners = new Set<(e: string) => void>()

export function upsert(record: DealRecord): DealRecord {
  deals.set(record.dealId, record)
  const event = `data: ${JSON.stringify(record)}\n\n`
  for (const l of listeners) l(event)
  return record
}

export function advance(dealId: string, patch: Partial<DealRecord>): void {
  const cur = deals.get(dealId)
  if (cur) upsert({ ...cur, ...patch })
}

export const get = (dealId: string) => deals.get(dealId)
export const all = () => [...deals.values()].sort((a, b) => b.createdAt - a.createdAt)

export function subscribe(fn: (e: string) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
