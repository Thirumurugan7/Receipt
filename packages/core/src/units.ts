/**
 * HBAR unit conversion.
 *
 * Hedera's native ledger counts HBAR in TINYBARS (1 HBAR = 1e8 tinybars).
 * Hedera's EVM counts the same HBAR in WEIBARS (1 HBAR = 1e18 weibars), because
 * `msg.value` has to look like wei to Solidity. The factor between the two is
 * 1e10 and nothing warns you when you get it wrong: x402 `amount` is tinybars,
 * `open()` receives weibars. Every crossing goes through these two functions.
 */
export const TINYBARS_PER_HBAR = 100_000_000n
export const WEIBARS_PER_TINYBAR = 10_000_000_000n

/** Smallest plausible unix-millisecond timestamp (2001-09-09). Anything below
 *  this is almost certainly a unix-seconds value that lost its 1000x. */
const MIN_PLAUSIBLE_MS = 1_000_000_000_000

export function tinybarsToWeibars(tinybars: bigint): bigint {
  if (tinybars < 0n) throw new Error(`tinybars must be non-negative, got ${tinybars}`)
  return tinybars * WEIBARS_PER_TINYBAR
}

export function weibarsToTinybars(weibars: bigint): bigint {
  if (weibars < 0n) throw new Error(`weibars must be non-negative, got ${weibars}`)
  if (weibars % WEIBARS_PER_TINYBAR !== 0n) {
    throw new Error(
      `${weibars} weibars is not a whole number of tinybars (factor ${WEIBARS_PER_TINYBAR})`,
    )
  }
  return weibars / WEIBARS_PER_TINYBAR
}

/**
 * Terms carry `deadlineMs` in unix milliseconds; the escrow stores a uint64 of
 * unix seconds. Floor, and fail loudly on anything that smells like a units
 * error, because the quiet version of this bug makes every deal expire on open.
 */
export function floorDeadlineToSeconds(deadlineMs: number): bigint {
  if (!Number.isInteger(deadlineMs)) {
    throw new Error(`deadlineMs must be a whole number of milliseconds, got ${deadlineMs}`)
  }
  if (deadlineMs <= 0) throw new Error(`deadlineMs must be positive, got ${deadlineMs}`)
  if (deadlineMs < MIN_PLAUSIBLE_MS) {
    throw new Error(
      `deadlineMs=${deadlineMs} is too small to be unix milliseconds; it looks like unix seconds`,
    )
  }
  return BigInt(Math.floor(deadlineMs / 1000))
}
