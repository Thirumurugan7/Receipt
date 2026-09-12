/** Generates the cross-implementation fixture from the reference adjudicator. */
import { writeFileSync } from 'node:fs'
import { adjudicate, hashVerdict, jcs } from '../src/index.js'
import type { Observation, Terms } from '../src/types.js'

const NOW = 1_789_200_000_000
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o))

const CHECKS = {
  status: { in: [200] },
  contentType: { equals: 'application/json' },
  minBytes: 32,
  maxLatencyMs: 5000,
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

const terms = (): Terms => ({
  v: 1, nonce: `0x${'11'.repeat(32)}`,
  payer: '0x1111111111111111111111111111111111111111',
  payee: '0x2222222222222222222222222222222222222222',
  token: '0.0.0', amount: '50000000',
  resource: 'https://seller.example/api/quote',
  deadlineMs: NOW + 60_000, checks: CHECKS as never,
})

const GOOD = {
  source: 'the-graph-token-api',
  address: '0x28C6c06298d514Db089934071355E5743bf21d60',
  network: 'mainnet',
  timestamp: Math.floor(NOW / 1000),
  data: [{ contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', name: 'USDC', amount: '51951297920', decimals: 6, value: 51951.29792, blockNum: 25960658, lastUpdate: '2026-09-12 10:00:00', network: 'mainnet' }],
}

const cases: { name: string; body: unknown; status?: number; contentType?: string }[] = [
  { name: 'honest', body: GOOD },
  { name: 'garbage', body: { error: 'upstream rate limited' } },
  { name: 'stale', body: { ...GOOD, timestamp: Math.floor(NOW / 1000) - 7200 } },
  { name: 'empty-holdings', body: { ...GOOD, data: [] } },
  { name: 'forged-source', body: { ...GOOD, source: 'invented' } },
  { name: 'bad-amount', body: { ...GOOD, data: [{ ...GOOD.data[0], amount: 'lots' }] } },
  { name: 'bad-contract', body: { ...GOOD, data: [{ ...GOOD.data[0], contract: 'nope' }] } },
  { name: 'wrong-status', body: GOOD, status: 503 },
  { name: 'wrong-content-type', body: GOOD, contentType: 'text/html' },
]

const out = cases.map((c) => {
  const observation: Observation = {
    status: c.status ?? 200,
    headers: { 'content-type': c.contentType ?? 'application/json; charset=utf-8' },
    body: enc(c.body),
    requestTimeMs: NOW,
    observedLatencyMs: 412,
  }
  const verdict = adjudicate(terms(), observation)
  return {
    name: c.name,
    observation: {
      status: observation.status,
      headers: observation.headers,
      bodyBase64: Buffer.from(observation.body).toString('base64'),
      requestTimeMs: observation.requestTimeMs,
    },
    expected: {
      pass: verdict.pass,
      firstFailure: verdict.firstFailure,
      responseHash: verdict.responseHash,
      reproducibleJcs: jcs(verdict.reproducible),
      verdictHash: hashVerdict(verdict),
    },
    verdict,
  }
})

writeFileSync(
  new URL('fixtures/adjudication.json', import.meta.url),
  JSON.stringify({ terms: terms(), cases: out }, null, 2) + '\n',
)
console.log(`wrote ${out.length} cases`)
for (const c of out) console.log(`  ${c.name.padEnd(20)} pass=${String(c.expected.pass).padEnd(5)} first=${c.expected.firstFailure ?? '-'}`)
