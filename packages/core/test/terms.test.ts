import { describe, expect, test } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverTypedDataAddress } from 'viem'
import {
  decodeTermsHeader,
  dealId,
  encodeTermsHeader,
  hashJcs,
  hashTerms,
  jcs,
  termsTypedData,
} from '../src/terms.js'
import { hashVerdict } from '../src/verdict.js'
import { adjudicate } from '../src/adjudicator.js'
import { makeObs, makeTerms } from './helpers.js'

const ACCOUNT = privateKeyToAccount(`0x${'42'.repeat(32)}`)
const DOMAIN = {
  name: 'Receipt',
  version: '1',
  chainId: 296,
  verifyingContract: '0x3333333333333333333333333333333333333333',
} as const

describe('JCS canonicalisation', () => {
  test('key order does not change the output', () => {
    expect(jcs({ b: 1, a: 2 })).toBe(jcs({ a: 2, b: 1 }))
  })

  test('number formatting is normalised', () => {
    expect(jcs({ n: 1.0 })).toBe('{"n":1}')
  })

  test('key order does not change the hash', () => {
    expect(hashJcs({ b: 1, a: 2 })).toBe(hashJcs({ a: 2, b: 1 }))
  })

  test('a different value does change the hash', () => {
    expect(hashJcs({ a: 1 })).not.toBe(hashJcs({ a: 2 }))
  })
})

describe('hashTerms', () => {
  test('is stable across key reordering of the checks object', () => {
    const a = makeTerms({ minBytes: 32, status: { in: [200] } })
    const b = makeTerms({ status: { in: [200] }, minBytes: 32 })
    expect(hashTerms(a)).toBe(hashTerms(b))
  })

  test('changing the amount changes the hash', () => {
    const a = makeTerms({ minBytes: 32 })
    const b = { ...makeTerms({ minBytes: 32 }), amount: '99999' }
    expect(hashTerms(a)).not.toBe(hashTerms(b))
  })

  test('returns a 32-byte hex string', () => {
    expect(hashTerms(makeTerms({}))).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

describe('EIP-712 signing', () => {
  test('the buyer signature recovers to the payer', async () => {
    const terms = { ...makeTerms({ minBytes: 32 }), payer: ACCOUNT.address }
    const typed = termsTypedData(terms, DOMAIN)
    const signature = await ACCOUNT.signTypedData(typed)
    const recovered = await recoverTypedDataAddress({ ...typed, signature })
    expect(recovered.toLowerCase()).toBe(terms.payer.toLowerCase())
  })

  test('the signed payload commits to the terms hash', () => {
    const terms = { ...makeTerms({ minBytes: 32 }), payer: ACCOUNT.address }
    const typed = termsTypedData(terms, DOMAIN) as { message: { termsHash: string } }
    expect(typed.message.termsHash).toBe(hashTerms(terms))
  })

  test('tampering with the amount breaks the recovery', async () => {
    const terms = { ...makeTerms({ minBytes: 32 }), payer: ACCOUNT.address }
    const signature = await ACCOUNT.signTypedData(termsTypedData(terms, DOMAIN))
    const tampered = { ...terms, amount: '99999999' }
    const recovered = await recoverTypedDataAddress({
      ...(termsTypedData(tampered, DOMAIN) as any),
      signature,
    })
    expect(recovered.toLowerCase()).not.toBe(terms.payer.toLowerCase())
  })
})

describe('dealId', () => {
  test('is deterministic for the same payer, payee and nonce', () => {
    expect(dealId(makeTerms({}))).toBe(dealId(makeTerms({ minBytes: 1 })))
  })

  test('changes with the nonce', () => {
    const other = { ...makeTerms({}), nonce: `0x${'22'.repeat(32)}` as const }
    expect(dealId(makeTerms({}))).not.toBe(dealId(other))
  })
})

describe('X-Receipt-Terms header codec', () => {
  test('round-trips through base64url', () => {
    const terms = makeTerms({ status: { in: [200] }, minBytes: 32 })
    expect(decodeTermsHeader(encodeTermsHeader(terms))).toEqual(terms)
  })

  test('produces a header safe to put in HTTP (no +, / or =)', () => {
    expect(encodeTermsHeader(makeTerms({ status: { in: [200] } }))).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('survives the round trip with the hash intact', () => {
    const terms = makeTerms({ jsonSchema: { type: 'object' }, freshnessSeconds: 120 })
    expect(hashTerms(decodeTermsHeader(encodeTermsHeader(terms)))).toBe(hashTerms(terms))
  })
})

describe('hashVerdict', () => {
  test('returns a 32-byte hex string', () => {
    const v = adjudicate(makeTerms({ minBytes: 32 }), makeObs())
    expect(hashVerdict(v)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  test('two runs of the same adjudication hash identically', () => {
    const terms = makeTerms({ minBytes: 32, status: { in: [200] } })
    expect(hashVerdict(adjudicate(terms, makeObs()))).toBe(
      hashVerdict(adjudicate(terms, makeObs())),
    )
  })

  test('the attested latency still changes the verdict hash', () => {
    // It gates nothing, but it is part of the published document.
    const terms = makeTerms({ maxLatencyMs: 5000 })
    const a = hashVerdict(adjudicate(terms, makeObs({ observedLatencyMs: 10 })))
    const b = hashVerdict(adjudicate(terms, makeObs({ observedLatencyMs: 20 })))
    expect(a).not.toBe(b)
  })
})
