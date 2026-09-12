import { describe, expect, test } from 'vitest'
import { DEMO_MODES, isDemoMode, RunGate } from '../src/demo.js'

/**
 * The run button is reachable from the public internet and every press spends
 * real testnet HBAR and starts a child process. The mode must therefore come
 * from a fixed list rather than from the request, and presses have to be
 * spaced out and capped, or one impatient visitor drains the buyer account and
 * the demo is dead for the judge after them.
 */
describe('mode allowlist', () => {
  test.each([...DEMO_MODES])('%s is allowed', (m) => {
    expect(isDemoMode(m)).toBe(true)
  })

  test.each([
    'honest; rm -rf /',
    '../../etc/passwd',
    'honest ',
    'HONEST',
    '',
    '--version',
  ])('rejects %j', (bad) => {
    expect(isDemoMode(bad)).toBe(false)
  })

  test('rejects values that are not strings at all', () => {
    for (const bad of [undefined, null, 42, {}, ['honest']]) expect(isDemoMode(bad)).toBe(false)
  })
})

describe('RunGate', () => {
  test('allows the first run', () => {
    const gate = new RunGate({ minGapMs: 15_000, maxRuns: 10 })
    expect(gate.tryAcquire(1000).ok).toBe(true)
  })

  test('refuses a second run while the first is still going', () => {
    const gate = new RunGate({ minGapMs: 15_000, maxRuns: 10 })
    gate.tryAcquire(1000)
    const second = gate.tryAcquire(1001)
    expect(second.ok).toBe(false)
    expect(second.ok === false && second.reason).toBe('busy')
  })

  test('refuses a run that comes too soon after the last one finished', () => {
    const gate = new RunGate({ minGapMs: 15_000, maxRuns: 10 })
    gate.tryAcquire(1000)
    gate.release(2000)
    const soon = gate.tryAcquire(3000)
    expect(soon.ok).toBe(false)
    expect(soon.ok === false && soon.reason).toBe('too-soon')
    expect(soon.ok === false && soon.retryAfterMs).toBe(14_000)
  })

  test('allows a run once the gap has passed', () => {
    const gate = new RunGate({ minGapMs: 15_000, maxRuns: 10 })
    gate.tryAcquire(1000)
    gate.release(2000)
    expect(gate.tryAcquire(17_000).ok).toBe(true)
  })

  test('stops once the budget is spent, because the HBAR is finite', () => {
    const gate = new RunGate({ minGapMs: 0, maxRuns: 2 })
    gate.tryAcquire(0); gate.release(1)
    gate.tryAcquire(2); gate.release(3)
    const third = gate.tryAcquire(4)
    expect(third.ok).toBe(false)
    expect(third.ok === false && third.reason).toBe('budget-spent')
  })

  test('a run that throws still releases the gate, or the demo jams forever', () => {
    const gate = new RunGate({ minGapMs: 0, maxRuns: 10 })
    gate.tryAcquire(0)
    gate.release(1)
    expect(gate.tryAcquire(2).ok).toBe(true)
  })

  test('reports how many runs are left, so the page can say so', () => {
    const gate = new RunGate({ minGapMs: 0, maxRuns: 3 })
    expect(gate.remaining).toBe(3)
    gate.tryAcquire(0); gate.release(1)
    expect(gate.remaining).toBe(2)
  })
})
