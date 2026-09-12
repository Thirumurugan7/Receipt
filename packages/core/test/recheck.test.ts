import { describe, expect, test } from 'vitest'
import { attestedLatencyOf, rebuildForHashing } from '../src/verdict.js'
import type { Verdict } from '../src/types.js'

/**
 * Re-checking a published verdict is not the same as producing a fresh one.
 *
 * `attested[]` holds the facilitator's own stopwatch, which nobody else can
 * measure after the fact, so a verifier carries it over from the published
 * document rather than inventing a value. Only `reproducible[]` — the part
 * that is a pure function of published inputs — is substituted. Getting this
 * wrong produces a hash mismatch on a verdict that is perfectly honest, which
 * is the worst possible false alarm for this project.
 */
const published: Verdict = {
  v: 1,
  adjudicator: 'receipt-adjudicator@0.1.0',
  termsHash: '0xaa',
  responseHash: '0xbb',
  observedStatus: 200,
  observedBytes: 1897,
  reproducible: [{ check: 'status', pass: true }],
  attested: [{ check: 'maxLatencyMs', pass: true, observed: 3859 }],
  pass: true,
  firstFailure: null,
} as unknown as Verdict

describe('attestedLatencyOf', () => {
  test('reads the latency the facilitator published', () => {
    expect(attestedLatencyOf(published)).toBe(3859)
  })

  test('falls back to zero when the check was not required', () => {
    const none = { ...published, attested: [] } as unknown as Verdict
    expect(attestedLatencyOf(none)).toBe(0)
  })
})

describe('rebuildForHashing', () => {
  test('keeps every published field except the recomputed checks', () => {
    const recomputed = [{ check: 'status', pass: true }]
    const rebuilt = rebuildForHashing(published, recomputed)
    expect(rebuilt.attested).toEqual(published.attested)
    expect(rebuilt.observedBytes).toBe(published.observedBytes)
    expect(rebuilt.reproducible).toBe(recomputed)
  })

  test('a changed check result changes the document, which is the whole point', () => {
    const honest = rebuildForHashing(published, [{ check: 'status', pass: true }])
    const tampered = rebuildForHashing(published, [{ check: 'status', pass: false }])
    expect(JSON.stringify(honest)).not.toBe(JSON.stringify(tampered))
  })

  test('does not mutate the published verdict it was handed', () => {
    const before = JSON.stringify(published)
    rebuildForHashing(published, [{ check: 'status', pass: false }])
    expect(JSON.stringify(published)).toBe(before)
  })
})
