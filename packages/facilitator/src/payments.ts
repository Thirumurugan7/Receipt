/**
 * Settled-payment registry.
 *
 * Receipt verifies and settles a payment BEFORE it calls the seller — it has
 * to, because escrow must be funded first. The seller's own x402 middleware
 * then asks its facilitator (which is Receipt) to verify and settle that same
 * payment. Without this registry Receipt would forward the second request to
 * Blocky402 and try to submit an already-consensused transaction, which fails
 * and makes the seller answer 402 to a request that was in fact paid.
 *
 * So settlement is recorded here the moment it succeeds, and the seller's
 * later verify/settle are answered from it. One payment, one on-chain
 * transfer, asked about twice.
 */
export interface SettledPayment {
  transaction: string
  payer: string
  at: number
}

const byTransaction = new Map<string, SettledPayment>()

/** Keyed on the payload's serialized transaction, which is unique per payment. */
export function fingerprint(payload: unknown): string {
  const tx = (payload as { payload?: { transaction?: string } })?.payload?.transaction
  return typeof tx === 'string' ? tx : ''
}

export function record(payload: unknown, settled: SettledPayment): void {
  const key = fingerprint(payload)
  if (key) byTransaction.set(key, settled)
}

export function lookup(payload: unknown): SettledPayment | undefined {
  const key = fingerprint(payload)
  return key ? byTransaction.get(key) : undefined
}
