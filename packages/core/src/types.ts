/** Protocol types for Receipt. See BUILD.md §4, amended by DECISIONS-01.md. */

export type Hex = `0x${string}`

export interface Checks {
  status?: { in: number[] }
  contentType?: { equals: string }
  minBytes?: number
  /** Attested, not reproducible: gates nothing. DECISIONS-01 Q3. */
  maxLatencyMs?: number
  requiredPaths?: string[]
  jsonSchema?: Record<string, unknown>
  freshnessSeconds?: number
  expectedHash?: Hex | null
}

export interface Terms {
  v: 1
  nonce: Hex
  payer: Hex
  payee: Hex
  /** Blocky402 `asset`. "0.0.0" is native HBAR. DECISIONS-01 Q1. */
  token: string
  /** Smallest unit as a string. For HBAR that is tinybars (1e8). */
  amount: string
  resource: string
  deadlineMs: number
  checks: Checks
}

/**
 * Everything the adjudicator is allowed to look at. The facilitator measures
 * this and publishes it to HCS verbatim, so a verifier can recompute the
 * reproducible checks from the public log. `observedLatencyMs` is the one
 * field nobody else can recompute — it gates nothing.
 */
export interface Observation {
  status: number
  /** Header names MUST be lowercased by the caller. */
  headers: Record<string, string>
  body: Uint8Array
  requestTimeMs: number
  observedLatencyMs: number
}

export interface CheckResult {
  check: string
  pass: boolean
  detail?: string
  skipped?: true
}

export interface AttestedResult extends CheckResult {
  observed: number
}

export interface Verdict {
  v: 1
  adjudicator: string
  termsHash: Hex
  responseHash: Hex
  observedStatus: number
  observedBytes: number
  /** Recomputable by anyone from (terms, observation). Gates settlement. */
  reproducible: CheckResult[]
  /** The facilitator's own measurements. Recorded, displayed, gates nothing. */
  attested: AttestedResult[]
  pass: boolean
  firstFailure: string | null
}
