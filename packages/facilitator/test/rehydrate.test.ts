import { describe, expect, test } from 'vitest'
import { recordsFromLog } from '../src/rehydrate.js'

/**
 * The deal log is in memory, so a restart used to leave a judge looking at an
 * empty page until they pressed a button. It does not have to: everything the
 * ledger shows was published to the audit topic, so the facilitator can
 * rebuild its own view from the same public record a stranger would use.
 *
 * That is worth more than the convenience. If the page can be reconstructed
 * from the log, the log demonstrably contains what the page claims.
 */
const TERMS = {
  resource: 'http://seller/api/quote?mode=honest',
  amount: '50000000',
  checks: { status: { in: [200] } },
} as never

const termsMsg = (dealId: string, seq: number) => ({
  consensusTimestamp: `${seq}.0`,
  sequenceNumber: seq,
  message: { kind: 'terms', dealId, termsHash: '0xaa', terms: TERMS },
}) as never

const verdictMsg = (dealId: string, seq: number, pass: boolean) => ({
  consensusTimestamp: `${seq}.0`,
  sequenceNumber: seq,
  message: {
    kind: 'verdict',
    dealId,
    termsHash: '0xaa',
    verdictHash: '0xbb',
    verdict: {
      reproducible: [{ check: 'status', pass }],
      attested: [{ check: 'maxLatencyMs', pass: true, observed: 12 }],
      pass,
      firstFailure: pass ? null : 'status',
    },
    settlementTxId: '0.0.7162784@1789235851.125983072',
    openTxHash: '0xopen',
    resolveTxHash: '0xresolve',
  },
}) as never

describe('recordsFromLog', () => {
  test('a deal with a passing verdict comes back as released', () => {
    const out = recordsFromLog([termsMsg('0xd1', 1), verdictMsg('0xd1', 3, true)])
    expect(out).toHaveLength(1)
    expect(out[0]!.phase).toBe('released')
    expect(out[0]!.verdict?.pass).toBe(true)
  })

  test('a failing verdict comes back as refunded', () => {
    const out = recordsFromLog([termsMsg('0xd2', 1), verdictMsg('0xd2', 3, false)])
    expect(out[0]!.phase).toBe('refunded')
    expect(out[0]!.verdict?.firstFailure).toBe('status')
  })

  test('carries the transaction ids so the ledger can still cite the record', () => {
    const out = recordsFromLog([termsMsg('0xd3', 1), verdictMsg('0xd3', 3, true)])
    expect(out[0]!.settlementTxId).toBe('0.0.7162784@1789235851.125983072')
    expect(out[0]!.openTxHash).toBe('0xopen')
    expect(out[0]!.resolveTxHash).toBe('0xresolve')
  })

  test('carries the sequence numbers, which are the citations themselves', () => {
    const out = recordsFromLog([termsMsg('0xd4', 7), verdictMsg('0xd4', 9, true)])
    expect(out[0]!.audit?.terms?.sequenceNumber).toBe(7)
    expect(out[0]!.audit?.verdict?.sequenceNumber).toBe(9)
  })

  /**
   * A deal whose seller never answered publishes terms and nothing else. That
   * is the correct outcome for the dead-seller case, so it must survive the
   * rebuild rather than being dropped as malformed.
   */
  test('terms with no verdict is a real state, not a broken record', () => {
    const out = recordsFromLog([termsMsg('0xd5', 1)])
    expect(out).toHaveLength(1)
    expect(out[0]!.phase).toBe('awaiting-expiry')
    expect(out[0]!.verdict).toBeUndefined()
  })

  test('ignores foreign messages on a shared topic rather than throwing', () => {
    const junk = { consensusTimestamp: '1.0', sequenceNumber: 1, message: { hello: 'world' } } as never
    expect(() => recordsFromLog([junk, termsMsg('0xd6', 2)])).not.toThrow()
    expect(recordsFromLog([junk, termsMsg('0xd6', 2)])).toHaveLength(1)
  })

  test('newest first, so the ledger opens on what just happened', () => {
    const out = recordsFromLog([
      termsMsg('0xold', 1), verdictMsg('0xold', 2, true),
      termsMsg('0xnew', 8), verdictMsg('0xnew', 9, true),
    ])
    expect(out.map((r) => r.dealId)).toEqual(['0xnew', '0xold'])
  })
})
