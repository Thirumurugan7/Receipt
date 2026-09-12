import { hashJcs } from './terms.js'
import type { Hex, Verdict } from './types.js'

export function hashVerdict(verdict: Verdict): Hex {
  return hashJcs(verdict)
}

/**
 * The facilitator's own stopwatch, as published.
 *
 * Latency is attested, not reproducible: nobody can measure after the fact how
 * long the seller took. A verifier therefore carries the published value over
 * instead of inventing one, which is also why it gates nothing.
 */
export function attestedLatencyOf(published: Verdict): number {
  return published.attested.find((a) => a.check === 'maxLatencyMs')?.observed ?? 0
}

/**
 * The published verdict document with our own recomputed checks substituted,
 * ready to hash.
 *
 * Hashing a freshly built verdict instead would compare the attested latency
 * too and report a mismatch on an honest verdict. Substituting only
 * `reproducible[]` isolates exactly the part that is a pure function of the
 * published inputs: if the facilitator altered a single check result, the hash
 * moves and no longer matches what the escrow recorded.
 */
export function rebuildForHashing(
  published: Verdict,
  recomputed: Verdict['reproducible'],
): Verdict {
  return { ...published, reproducible: recomputed }
}
