import { describe, expect, test } from 'vitest'
import { encodeTermsHeader } from '@receipt/core'
import type { Terms } from '@receipt/core'
import { declinedBody, selfCheck } from '../src/server.js'

/**
 * The seller grading its own work is only possible because adjudication is a
 * pure function of (terms, response). An external evaluator cannot be
 * consulted before delivery, so no design with one allows a seller to say
 * "I cannot earn this — do not pay me."
 */
const NOW = Math.floor(Date.now() / 1000)

const terms = (): Terms => ({
  v: 1,
  nonce: `0x${'11'.repeat(32)}`,
  payer: '0x1111111111111111111111111111111111111111',
  payee: '0x2222222222222222222222222222222222222222',
  token: '0.0.0',
  amount: '50000000',
  resource: 'https://seller/api/quote',
  deadlineMs: Date.now() + 60_000,
  checks: {
    status: { in: [200] },
    contentType: { equals: 'application/json' },
    requiredPaths: ['$.data', '$.timestamp'],
    jsonSchema: {
      type: 'object',
      required: ['data'],
      properties: { data: { type: 'array', minItems: 1 } },
    },
    freshnessSeconds: 3600,
  } as never,
})

const good = { data: [{ contract: '0xabc', amount: '1' }], timestamp: NOW }

describe('seller self-check', () => {
  test('a response that would pass is not refused', () => {
    expect(selfCheck(encodeTermsHeader(terms()), good)).toBeNull()
  })

  test('a response that would fail is caught by the seller itself', () => {
    const verdict = selfCheck(encodeTermsHeader(terms()), { error: 'rate limited' })
    expect(verdict).not.toBeNull()
    expect(verdict!.pass).toBe(false)
  })

  test('stale data is caught before it is ever returned', () => {
    const stale = { ...good, timestamp: NOW - 7200 }
    const verdict = selfCheck(encodeTermsHeader(terms()), stale)
    expect(verdict?.firstFailure).toBe('freshness')
  })

  test('without terms the seller has nothing to check against and does not guess', () => {
    expect(selfCheck(undefined, { error: 'anything' })).toBeNull()
  })

  test('unreadable terms are not the seller\'s to enforce', () => {
    expect(selfCheck('not-base64url-json', { error: 'anything' })).toBeNull()
  })

  test('the seller reaches the SAME verdict the escrow would', () => {
    // The whole point: one function, two parties, one answer.
    const stale = { ...good, timestamp: NOW - 7200 }
    const sellerSide = selfCheck(encodeTermsHeader(terms()), stale)
    expect(sellerSide?.firstFailure).toBe('freshness')
    expect(sellerSide?.reproducible.find((c) => c.check === 'jsonSchema')?.pass).toBe(true)
  })
})

describe('decline payload', () => {
  test('names the check it would have failed, so the buyer learns why', () => {
    const verdict = selfCheck(encodeTermsHeader(terms()), { error: 'rate limited' })!
    const body = declinedBody(verdict)
    expect(body.declined).toBe(true)
    expect(body.reason).toBe(verdict.firstFailure)
    expect(body.checks.length).toBeGreaterThan(0)
  })

  test('explains the refusal in the seller\'s own voice, not as an error', () => {
    const body = declinedBody(selfCheck(encodeTermsHeader(terms()), { error: 'x' })!)
    expect(body.detail).toMatch(/declined the sale rather than take a payment/)
  })
})
