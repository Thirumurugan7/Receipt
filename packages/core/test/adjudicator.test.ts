import { describe, expect, test } from 'vitest'
import { adjudicate, ADJUDICATOR_VERSION, REPRODUCIBLE_ORDER } from '../src/adjudicator.js'
import { jcs } from '../src/terms.js'
import {
  GARBAGE_BODY,
  HONEST_BODY,
  REQUEST_TIME_MS,
  bytes,
  hashBody,
  makeObs,
  makeTerms,
  reproduced,
} from './helpers.js'

describe('status', () => {
  test('passes when the code is in the allowed set', () => {
    const v = adjudicate(makeTerms({ status: { in: [200] } }), makeObs())
    expect(reproduced(v, 'status')?.pass).toBe(true)
    expect(v.pass).toBe(true)
  })

  test('fails when the code is outside the allowed set', () => {
    const v = adjudicate(makeTerms({ status: { in: [200] } }), makeObs({ status: 503 }))
    expect(reproduced(v, 'status')?.pass).toBe(false)
    expect(v.pass).toBe(false)
    expect(v.firstFailure).toBe('status')
  })
})

describe('contentType', () => {
  test('passes with parameters stripped and case normalised', () => {
    const obs = makeObs({ headers: { 'content-type': 'Application/JSON; charset=utf-8' } })
    const v = adjudicate(makeTerms({ contentType: { equals: 'application/json' } }), obs)
    expect(reproduced(v, 'contentType')?.pass).toBe(true)
  })

  test('fails on a different media type', () => {
    const obs = makeObs({ headers: { 'content-type': 'text/html' } })
    const v = adjudicate(makeTerms({ contentType: { equals: 'application/json' } }), obs)
    expect(reproduced(v, 'contentType')?.pass).toBe(false)
  })
})

describe('minBytes', () => {
  test('passes when the body meets the floor', () => {
    const v = adjudicate(makeTerms({ minBytes: 32 }), makeObs())
    expect(reproduced(v, 'minBytes')?.pass).toBe(true)
  })

  test('fails when the body is under the floor', () => {
    const v = adjudicate(makeTerms({ minBytes: 32 }), makeObs({ body: bytes('{}') }))
    expect(reproduced(v, 'minBytes')?.pass).toBe(false)
  })
})

describe('requiredPaths', () => {
  test('passes when every path resolves', () => {
    const v = adjudicate(makeTerms({ requiredPaths: ['$.data', '$.timestamp'] }), makeObs())
    expect(reproduced(v, 'requiredPaths')?.pass).toBe(true)
  })

  test('fails and names the missing path', () => {
    const obs = makeObs({ body: bytes(GARBAGE_BODY) })
    const v = adjudicate(makeTerms({ requiredPaths: ['$.data'] }), obs)
    const r = reproduced(v, 'requiredPaths')
    expect(r?.pass).toBe(false)
    expect(r?.detail).toContain('$.data')
  })

  test('treats an explicit null as missing', () => {
    const obs = makeObs({ body: bytes(JSON.stringify({ data: null })) })
    const v = adjudicate(makeTerms({ requiredPaths: ['$.data'] }), obs)
    expect(reproduced(v, 'requiredPaths')?.pass).toBe(false)
  })
})

describe('jsonSchema', () => {
  const schema = {
    type: 'object',
    required: ['data'],
    properties: { data: { type: 'array', minItems: 1 } },
  }

  test('passes on a conforming body', () => {
    const v = adjudicate(makeTerms({ jsonSchema: schema }), makeObs())
    expect(reproduced(v, 'jsonSchema')?.pass).toBe(true)
  })

  test('fails on a non-conforming body and explains why', () => {
    const obs = makeObs({ body: bytes(GARBAGE_BODY) })
    const v = adjudicate(makeTerms({ jsonSchema: schema }), obs)
    const r = reproduced(v, 'jsonSchema')
    expect(r?.pass).toBe(false)
    expect(r?.detail).toBeTruthy()
  })

  test('fails when the body is not JSON at all', () => {
    const obs = makeObs({ body: bytes('<html>502 Bad Gateway</html>') })
    const v = adjudicate(makeTerms({ jsonSchema: schema }), obs)
    expect(reproduced(v, 'jsonSchema')?.pass).toBe(false)
    expect(reproduced(v, 'jsonSchema')?.detail).toMatch(/json/i)
  })
})

describe('freshness', () => {
  test('passes when $.timestamp is inside the window', () => {
    const v = adjudicate(makeTerms({ freshnessSeconds: 120 }), makeObs())
    expect(reproduced(v, 'freshness')?.pass).toBe(true)
  })

  test('fails when $.timestamp is stale', () => {
    const stale = JSON.stringify({ data: [1], timestamp: 1_757_779_200 - 600 })
    const v = adjudicate(makeTerms({ freshnessSeconds: 120 }), makeObs({ body: bytes(stale) }))
    expect(reproduced(v, 'freshness')?.pass).toBe(false)
  })

  test('accepts an ISO-8601 timestamp', () => {
    const iso = JSON.stringify({ data: [1], timestamp: '2025-09-13T16:00:00.000Z' })
    const v = adjudicate(makeTerms({ freshnessSeconds: 120 }), makeObs({ body: bytes(iso) }))
    expect(reproduced(v, 'freshness')?.pass).toBe(true)
  })
})

describe('expectedHash', () => {
  test('passes when the body hash matches the precommitment', () => {
    const terms = makeTerms({ expectedHash: hashBody(HONEST_BODY) })
    expect(reproduced(adjudicate(terms, makeObs()), 'expectedHash')?.pass).toBe(true)
  })

  test('fails when the body hash differs', () => {
    const terms = makeTerms({ expectedHash: hashBody('something else') })
    expect(reproduced(adjudicate(terms, makeObs()), 'expectedHash')?.pass).toBe(false)
  })

  test('is skipped when null', () => {
    const r = reproduced(adjudicate(makeTerms({ expectedHash: null }), makeObs()), 'expectedHash')
    expect(r?.skipped).toBe(true)
    expect(r?.pass).toBe(true)
  })
})

describe('skipping', () => {
  test('absent checks are recorded as skipped and passing', () => {
    const v = adjudicate(makeTerms({}), makeObs())
    for (const name of REPRODUCIBLE_ORDER) {
      expect(reproduced(v, name)).toMatchObject({ pass: true, skipped: true })
    }
    expect(v.pass).toBe(true)
  })
})

describe('attested vs reproducible', () => {
  test('maxLatencyMs is attested, never reproducible', () => {
    const v = adjudicate(makeTerms({ maxLatencyMs: 5000 }), makeObs())
    expect(reproduced(v, 'maxLatencyMs')).toBeUndefined()
    expect(v.attested[0]).toMatchObject({ check: 'maxLatencyMs', pass: true, observed: 412 })
  })

  test('a blown latency budget does NOT move money', () => {
    const v = adjudicate(makeTerms({ maxLatencyMs: 100 }), makeObs({ observedLatencyMs: 9000 }))
    expect(v.attested[0]).toMatchObject({ check: 'maxLatencyMs', pass: false, observed: 9000 })
    expect(v.pass).toBe(true)
    expect(v.firstFailure).toBeNull()
  })
})

describe('verdict assembly', () => {
  test('every check runs even after the first failure', () => {
    const terms = makeTerms({
      status: { in: [200] },
      minBytes: 10_000,
      requiredPaths: ['$.data'],
      jsonSchema: { type: 'object', required: ['data'] },
    })
    const v = adjudicate(terms, makeObs({ status: 503 }))
    expect(v.reproducible).toHaveLength(REPRODUCIBLE_ORDER.length)
    expect(reproduced(v, 'minBytes')?.pass).toBe(false)
    expect(reproduced(v, 'requiredPaths')?.pass).toBe(true)
  })

  test('firstFailure follows the fixed order, not discovery order', () => {
    const terms = makeTerms({ status: { in: [200] }, minBytes: 10_000 })
    const v = adjudicate(terms, makeObs({ status: 503 }))
    expect(v.firstFailure).toBe('status')
  })

  test('firstFailure skips checks that passed', () => {
    const terms = makeTerms({ status: { in: [200] }, minBytes: 10_000 })
    const v = adjudicate(terms, makeObs())
    expect(v.firstFailure).toBe('minBytes')
  })

  test('records the response hash, status and byte length', () => {
    const v = adjudicate(makeTerms({}), makeObs())
    expect(v.responseHash).toBe(hashBody(HONEST_BODY))
    expect(v.observedStatus).toBe(200)
    expect(v.observedBytes).toBe(bytes(HONEST_BODY).length)
    expect(v.adjudicator).toBe(ADJUDICATOR_VERSION)
    expect(v.v).toBe(1)
  })

  test('the garbage path: HTTP 200 with a useless body refunds', () => {
    const terms = makeTerms({
      status: { in: [200] },
      contentType: { equals: 'application/json' },
      jsonSchema: { type: 'object', required: ['data'], properties: { data: { type: 'array', minItems: 1 } } },
    })
    const v = adjudicate(terms, makeObs({ body: bytes(GARBAGE_BODY) }))
    expect(reproduced(v, 'status')?.pass).toBe(true)
    expect(v.pass).toBe(false)
    expect(v.firstFailure).toBe('jsonSchema')
  })
})

describe('determinism', () => {
  test('identical inputs canonicalise to identical bytes', () => {
    const terms = makeTerms({ status: { in: [200] }, minBytes: 32, freshnessSeconds: 120 })
    const a = adjudicate(terms, makeObs())
    const b = adjudicate(terms, makeObs())
    expect(jcs(a)).toBe(jcs(b))
  })

  test('the verdict does not depend on the wall clock', () => {
    const terms = makeTerms({ freshnessSeconds: 120 })
    const a = adjudicate(terms, makeObs())
    const b = adjudicate(terms, makeObs({ observedLatencyMs: 999 }))
    expect(jcs(a.reproducible)).toBe(jcs(b.reproducible))
  })
})
