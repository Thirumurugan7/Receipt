import { keccak256, toBytes } from 'viem'
import type { CheckResult, Checks, Hex, Observation, Terms, Verdict } from '../src/types.js'

export const REQUEST_TIME_MS = 1_757_779_200_000
export const HONEST_BODY = JSON.stringify({
  data: [{ symbol: 'HBAR', price: '0.28' }],
  timestamp: 1_757_779_200,
})
/** HTTP 200 with a useless body. The case naive rails cannot catch. */
export const GARBAGE_BODY = JSON.stringify({ error: 'upstream rate limited' })

export function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

export function hashBody(s: string): Hex {
  return keccak256(toBytes(s))
}

export function makeTerms(checks: Checks = {}): Terms {
  return {
    v: 1,
    nonce: `0x${'11'.repeat(32)}`,
    payer: '0x1111111111111111111111111111111111111111',
    payee: '0x2222222222222222222222222222222222222222',
    token: '0.0.0',
    amount: '10000',
    resource: 'https://seller.example/api/quote',
    deadlineMs: REQUEST_TIME_MS + 60_000,
    checks,
  }
}

export function makeObs(over: Partial<Observation> = {}): Observation {
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: bytes(HONEST_BODY),
    requestTimeMs: REQUEST_TIME_MS,
    observedLatencyMs: 412,
    ...over,
  }
}

export function reproduced(v: Verdict, name: string): CheckResult | undefined {
  return v.reproducible.find((r) => r.check === name)
}
