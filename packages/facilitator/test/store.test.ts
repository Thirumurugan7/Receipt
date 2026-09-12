import { beforeEach, describe, expect, test, vi } from 'vitest'
import { advance, all, get, subscribe, upsert, type DealRecord } from '../src/store.js'
import type { Terms } from '@receipt/core'

const terms = (amount = '50000000'): Terms => ({
  v: 1,
  nonce: `0x${'11'.repeat(32)}`,
  payer: '0x1111111111111111111111111111111111111111',
  payee: '0x2222222222222222222222222222222222222222',
  token: '0.0.0',
  amount,
  resource: 'http://seller/api/quote',
  deadlineMs: Date.now() + 60_000,
  checks: {},
})

const record = (dealId: string, over: Partial<DealRecord> = {}): DealRecord => ({
  dealId,
  termsHash: `0x${'ab'.repeat(32)}`,
  terms: terms(),
  phase: 'terms-verified',
  createdAt: Date.now(),
  ...over,
})

describe('deal store', () => {
  test('upsert stores a record retrievable by id', () => {
    upsert(record('0xaaa1'))
    expect(get('0xaaa1')?.phase).toBe('terms-verified')
  })

  test('advance patches without losing untouched fields', () => {
    upsert(record('0xaaa2', { settlementTxId: '0.0.1@2' }))
    advance('0xaaa2', { phase: 'escrowed' })
    const d = get('0xaaa2')
    expect(d?.phase).toBe('escrowed')
    expect(d?.settlementTxId).toBe('0.0.1@2')
  })

  test('advance on an unknown deal is a no-op rather than creating a ghost', () => {
    advance('0xdoesnotexist', { phase: 'released' })
    expect(get('0xdoesnotexist')).toBeUndefined()
  })

  test('all() returns newest first, so the dashboard leads with the live deal', () => {
    upsert(record('0xold', { createdAt: 1000 }))
    upsert(record('0xnew', { createdAt: 2000 }))
    const ids = all().map((d) => d.dealId)
    expect(ids.indexOf('0xnew')).toBeLessThan(ids.indexOf('0xold'))
  })
})

describe('SSE fan-out', () => {
  let sent: string[]
  let unsubscribe: () => void

  beforeEach(() => {
    sent = []
    unsubscribe?.()
    unsubscribe = subscribe((e) => sent.push(e))
  })

  test('every upsert emits one well-formed SSE frame', () => {
    upsert(record('0xsse1'))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/^data: /)
    expect(sent[0]).toMatch(/\n\n$/)
  })

  test('the frame carries the record the dashboard renders', () => {
    upsert(record('0xsse2', { phase: 'released' }))
    const payload = JSON.parse(sent[0]!.replace(/^data: /, '').trim())
    expect(payload.dealId).toBe('0xsse2')
    expect(payload.phase).toBe('released')
    expect(payload.terms.amount).toBe('50000000')
  })

  test('advance also notifies, so a state change reaches an open dashboard', () => {
    upsert(record('0xsse3'))
    advance('0xsse3', { phase: 'refunded' })
    expect(sent).toHaveLength(2)
    expect(JSON.parse(sent[1]!.replace(/^data: /, '').trim()).phase).toBe('refunded')
  })

  test('unsubscribing stops delivery', () => {
    unsubscribe()
    upsert(record('0xsse4'))
    expect(sent).toHaveLength(0)
  })

  test('one slow subscriber does not starve another', () => {
    const other: string[] = []
    const stop = subscribe((e) => other.push(e))
    upsert(record('0xsse5'))
    expect(sent).toHaveLength(1)
    expect(other).toHaveLength(1)
    stop()
  })
})
