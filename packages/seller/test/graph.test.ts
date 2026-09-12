import { describe, expect, test } from 'vitest'
import { toQuote, type TokenBalance } from '../src/graph.js'

/**
 * toQuote shapes The Graph's response into the payload the buyer's acceptance
 * terms are written against. If this drifts, the terms stop matching and the
 * seller stops getting paid for good data — so the shape is pinned here.
 */
const balance = (over: Partial<TokenBalance> = {}): TokenBalance => ({
  last_update: '2026-09-12 10:00:00',
  last_update_block_num: 21_000_000,
  last_update_timestamp: 1_789_200_000,
  address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
  contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  amount: '1250000000',
  decimals: 6,
  symbol: 'USDC',
  network: 'mainnet',
  value: 1250.0,
  ...over,
})

describe('toQuote', () => {
  test('produces the fields the buyer-signed schema requires', () => {
    const q = toQuote({ data: [balance()] }, '0xabc', 'mainnet')
    expect(q).toHaveProperty('data')
    expect(q).toHaveProperty('timestamp')
    expect(Array.isArray(q.data)).toBe(true)
    expect(q.data[0]).toMatchObject({ symbol: 'USDC', amount: '1250000000', decimals: 6 })
  })

  test('names The Graph as the source, so the receipt records what was bought', () => {
    expect(toQuote({ data: [balance()] }, '0xabc', 'mainnet').source).toBe('the-graph-token-api')
  })

  test('lifts the newest block timestamp so the freshness check is meaningful', () => {
    const q = toQuote(
      { data: [balance({ last_update_timestamp: 1_789_200_000 }), balance({ last_update_timestamp: 1_789_209_999 })] },
      '0xabc',
      'mainnet',
    )
    expect(q.timestamp).toBe(1_789_209_999)
  })

  test('a stale upstream response yields a stale timestamp rather than a fresh lie', () => {
    const old = 1_700_000_000
    expect(toQuote({ data: [balance({ last_update_timestamp: old })] }, '0xabc', 'mainnet').timestamp).toBe(old)
  })

  test('an empty result stays empty, so minItems fails instead of being padded', () => {
    const q = toQuote({ data: [] }, '0xabc', 'mainnet')
    expect(q.data).toHaveLength(0)
  })

  test('missing optional fields become null, not undefined, which JCS cannot hash', () => {
    const q = toQuote(
      { data: [balance({ symbol: undefined, decimals: undefined, value: undefined })] },
      '0xabc',
      'mainnet',
    )
    expect(q.data[0]!.symbol).toBeNull()
    expect(q.data[0]!.decimals).toBeNull()
    expect(JSON.stringify(q.data[0])).toContain('"symbol":null')
  })

  test('the payload round-trips through JSON unchanged, since it gets hashed', () => {
    const q = toQuote({ data: [balance()] }, '0xabc', 'mainnet')
    expect(JSON.parse(JSON.stringify(q))).toEqual(q)
  })
})

describe('the seller refuses to fabricate', () => {
  test('no fallback payload is exported for use when the API key is absent', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/graph.ts', import.meta.url), 'utf8'),
    )
    // Check the CODE, not the prose — the comments discuss mocking precisely
    // because there is none.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    // no canned token data anywhere in the module
    expect(code).not.toMatch(/symbol:\s*['"]/)
    expect(code).not.toMatch(/\bFALLBACK\b|\bSAMPLE\b|fakeBalances/i)
    // and a missing key is a thrown error, not a silent substitution
    expect(code).toMatch(/throw new GraphError\(/)
    expect(src).toMatch(/GRAPH_TOKEN_API_KEY is not set/)
  })
})
