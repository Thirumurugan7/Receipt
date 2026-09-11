import { describe, expect, test } from 'vitest'
import {
  WEIBARS_PER_TINYBAR,
  floorDeadlineToSeconds,
  tinybarsToWeibars,
  weibarsToTinybars,
} from '../src/units.js'

describe('tinybar <-> weibar', () => {
  test('the factor is 1e10', () => {
    expect(WEIBARS_PER_TINYBAR).toBe(10_000_000_000n)
  })

  test('one HBAR in tinybars becomes one HBAR in weibars', () => {
    expect(tinybarsToWeibars(100_000_000n)).toBe(1_000_000_000_000_000_000n)
  })

  test('round-trips exactly', () => {
    expect(weibarsToTinybars(tinybarsToWeibars(12_345n))).toBe(12_345n)
  })

  test('rejects weibars that are not a whole number of tinybars', () => {
    expect(() => weibarsToTinybars(1n)).toThrow(/tinybar/i)
  })

  test('rejects negative amounts', () => {
    expect(() => tinybarsToWeibars(-1n)).toThrow()
  })
})

describe('floorDeadlineToSeconds', () => {
  test('floors milliseconds to whole seconds', () => {
    expect(floorDeadlineToSeconds(1_757_779_200_999)).toBe(1_757_779_200n)
  })

  test('rejects a zero deadline loudly rather than expiring every deal', () => {
    expect(() => floorDeadlineToSeconds(0)).toThrow()
  })

  test('rejects a deadline that is not a whole number of milliseconds', () => {
    expect(() => floorDeadlineToSeconds(1.5)).toThrow()
  })

  test('rejects a seconds value passed where milliseconds were expected', () => {
    // 1.75e9 ms is 1975; a bare unix-seconds value here means a 1000x units bug.
    expect(() => floorDeadlineToSeconds(1_757_779_200)).toThrow(/millisecond/i)
  })
})
