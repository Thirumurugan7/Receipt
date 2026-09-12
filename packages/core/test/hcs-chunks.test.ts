import { describe, expect, test } from 'vitest'
import { reassembleChunks, type MirrorMessage } from '../src/hcs.js'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

const chunk = (
  seq: number,
  payload: string,
  start: string,
  number = 1,
  total = 1,
): MirrorMessage => ({
  consensus_timestamp: `${1_700_000_000 + seq}.0`,
  sequence_number: seq,
  message: b64(payload),
  chunk_info: {
    initial_transaction_id: { account_id: '0.0.1', nonce: 0, scheduled: false, transaction_valid_start: start },
    number,
    total,
  },
})

describe('HCS chunk reassembly', () => {
  test('a single-chunk message passes through', () => {
    const out = reassembleChunks([chunk(1, '{"kind":"terms"}', 'a')])
    expect(out).toHaveLength(1)
    expect(out[0]!.json).toEqual({ kind: 'terms' })
  })

  test('a two-chunk message is rejoined in order', () => {
    const out = reassembleChunks([
      chunk(1, '{"kind":"ob', 'a', 1, 2),
      chunk(2, 'servation"}', 'a', 2, 2),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.json).toEqual({ kind: 'observation' })
  })

  test('chunks arriving out of order are still rejoined correctly', () => {
    const out = reassembleChunks([
      chunk(2, 'servation"}', 'a', 2, 2),
      chunk(1, '{"kind":"ob', 'a', 1, 2),
    ])
    expect(out[0]!.json).toEqual({ kind: 'observation' })
  })

  test('interleaved messages from different transactions do not mix', () => {
    const out = reassembleChunks([
      chunk(1, '{"kind":"te', 'a', 1, 2),
      chunk(2, '{"kind":"ve', 'b', 1, 2),
      chunk(3, 'rms"}', 'a', 2, 2),
      chunk(4, 'rdict"}', 'b', 2, 2),
    ])
    expect(out).toHaveLength(2)
    expect(out.map((o) => (o.json as { kind: string }).kind).sort()).toEqual(['terms', 'verdict'])
  })

  test('an incomplete message is dropped rather than parsed as garbage', () => {
    const out = reassembleChunks([chunk(1, '{"kind":"ob', 'a', 1, 2)])
    expect(out).toHaveLength(0)
  })

  test('a foreign non-JSON message on the topic is skipped, not thrown', () => {
    const out = reassembleChunks([chunk(1, 'hello world', 'a')])
    expect(out).toHaveLength(0)
  })

  test('binary-safe: a body split mid multi-byte character survives', () => {
    const payload = JSON.stringify({ kind: 'observation', note: 'héllo ✓' })
    const raw = Buffer.from(payload, 'utf8')
    const cut = 12
    const out = reassembleChunks([
      { ...chunk(1, '', 'a', 1, 2), message: raw.subarray(0, cut).toString('base64') },
      { ...chunk(2, '', 'a', 2, 2), message: raw.subarray(cut).toString('base64') },
    ])
    expect(out[0]!.json).toEqual({ kind: 'observation', note: 'héllo ✓' })
  })
})
