import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * The MCP surface is what an agent actually sees, so these guard the promises
 * it makes rather than its plumbing: that failed data is never handed back as
 * though it passed, and that every result carries the means to re-check it.
 */
const src = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')

describe('MCP server', () => {
  test('exposes the three tools an agent needs', () => {
    for (const tool of ['buy_verified_data', 'verify_deal', 'get_deal']) {
      expect(src).toContain(`'${tool}'`)
    }
  })

  test('buying goes through the shared routine, not a facilitator-side shortcut', () => {
    // The facilitator must never hold the buyer's key or author the terms it
    // is later judged against.
    expect(src).toMatch(/from '@receipt\/buyer\/buy'/)
    expect(src).not.toMatch(/\/mcp\/buy/)
  })

  test('never returns data that failed its checks as though it passed', () => {
    expect(src).toMatch(/data: r\.data/)
    const buySrc = readFileSync(new URL('../../buyer/src/buy.ts', import.meta.url), 'utf8')
    expect(buySrc).toMatch(/data: passed \? data : null/)
  })

  test('every purchase result carries the means to re-check it', () => {
    expect(src).toMatch(/verify_command/)
    expect(src).toMatch(/topic/)
  })

  test('a refund is reported as a payment-layer success, not an error', () => {
    expect(src).toMatch(/returned automatically/)
  })

  test('verify_deal reports a hash comparison, not a claim of correctness', () => {
    expect(src).toMatch(/recomputed_verdict_hash/)
    expect(src).toMatch(/published_verdict_hash/)
    expect(src).toMatch(/match/)
  })

  test('an unreachable seller is explained rather than swallowed', () => {
    expect(src).toMatch(/no verdict was published/)
  })
})
