import { describe, expect, test } from 'vitest'
import { adjudicate } from '../src/adjudicator.js'
import type { Observation, Terms } from '../src/types.js'

const GRAPH_CHECKS = {
  status: { in: [200] },
  contentType: { equals: 'application/json' },
  minBytes: 32,
  requiredPaths: ['$.data', '$.timestamp', '$.source'],
  jsonSchema: {
    type: 'object',
    required: ['data', 'source', 'timestamp'],
    properties: {
      source: { type: 'string', const: 'the-graph-token-api' },
      timestamp: { type: 'integer', minimum: 1 },
      data: {
        type: 'array', minItems: 1,
        items: {
          type: 'object', required: ['contract', 'amount'],
          properties: {
            contract: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
            amount: { type: 'string', pattern: '^[0-9]+$' },
          },
        },
      },
    },
  },
  freshnessSeconds: 3600,
}

const NOW = 1_789_200_000_000
const terms = (): Terms => ({
  v: 1, nonce: `0x${'11'.repeat(32)}`,
  payer: '0x1111111111111111111111111111111111111111',
  payee: '0x2222222222222222222222222222222222222222',
  token: '0.0.0', amount: '50000000', resource: 'https://seller/api/quote',
  deadlineMs: NOW + 60_000, checks: GRAPH_CHECKS as never,
})

const obs = (body: unknown): Observation => ({
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: new TextEncoder().encode(JSON.stringify(body)),
  requestTimeMs: NOW, observedLatencyMs: 400,
})

const good = {
  source: 'the-graph-token-api',
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  network: 'mainnet',
  timestamp: Math.floor(NOW / 1000),
  data: [{ contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', amount: '1250000000', decimals: 6, value: 1250, blockNum: 21000000, network: 'mainnet' }],
}

describe('Graph acceptance terms discriminate', () => {
  test('a real Graph payload passes every check', () => {
    const v = adjudicate(terms(), obs(good))
    expect(v.pass).toBe(true)
  })

  test('an empty holdings array fails — paid-for data must contain something', () => {
    const v = adjudicate(terms(), obs({ ...good, data: [] }))
    expect(v.pass).toBe(false)
    expect(v.firstFailure).toBe('jsonSchema')
  })

  test('a payload claiming a different source fails', () => {
    const v = adjudicate(terms(), obs({ ...good, source: 'invented-by-the-seller' }))
    expect(v.pass).toBe(false)
  })

  test('a non-numeric amount fails, so a seller cannot return "lots"', () => {
    const v = adjudicate(terms(), obs({ ...good, data: [{ ...good.data[0], amount: 'lots' }] }))
    expect(v.pass).toBe(false)
  })

  test('a malformed contract address fails', () => {
    const v = adjudicate(terms(), obs({ ...good, data: [{ ...good.data[0], contract: 'not-an-address' }] }))
    expect(v.pass).toBe(false)
  })

  test('a stale snapshot fails even when perfectly formed', () => {
    const v = adjudicate(terms(), obs({ ...good, timestamp: Math.floor(NOW / 1000) - 7200 }))
    expect(v.pass).toBe(false)
    expect(v.firstFailure).toBe('freshness')
  })

  test('the garbage body still fails, as before', () => {
    const v = adjudicate(terms(), obs({ error: 'upstream rate limited' }))
    expect(v.pass).toBe(false)
    expect(v.firstFailure).toBe('requiredPaths')
  })
})

describe('the subtle failure: valid data, stale snapshot', () => {
  /**
   * The failure a human reviewer waves through. Every field is well-formed,
   * the schema passes, the paths resolve, the source is right — and the data
   * is hours old. Only the freshness clause catches it, which is the argument
   * for stating acceptance criteria up front instead of eyeballing responses.
   */
  const stale = { ...good, timestamp: Math.floor(NOW / 1000) - 7200 }

  test('every content check still passes on the stale payload', () => {
    const v = adjudicate(terms(), obs(stale))
    for (const name of ['status', 'contentType', 'minBytes', 'requiredPaths', 'jsonSchema']) {
      expect(v.reproducible.find((c) => c.check === name)?.pass).toBe(true)
    }
  })

  test('freshness alone rejects it, and it is the first failure', () => {
    const v = adjudicate(terms(), obs(stale))
    expect(v.reproducible.find((c) => c.check === 'freshness')?.pass).toBe(false)
    expect(v.firstFailure).toBe('freshness')
    expect(v.pass).toBe(false)
  })

  test('a snapshot just inside the window is accepted', () => {
    const fresh = { ...good, timestamp: Math.floor(NOW / 1000) - 3500 }
    expect(adjudicate(terms(), obs(fresh)).pass).toBe(true)
  })
})
