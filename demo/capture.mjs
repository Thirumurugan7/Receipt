/**
 * Captures the transcripts the film shows, from a real run.
 *
 *   node demo/capture.mjs                 # run everything (needs both servers)
 *   node demo/capture.mjs --scenes f.txt  # reuse an already-captured scene run
 *
 * Writes demo/demo-data.js. Nothing in the film is typed by hand: if a number
 * appears on screen it came through here from a live run against Hedera
 * testnet, which is the only way a demo of this project could be honest.
 *
 * The per-check results behind the animated checklist are read back from the
 * facilitator's own deal record rather than assumed from the summary line, so
 * the ticks and crosses on screen are the ones the adjudicator actually
 * produced -- including the checks that failed *after* the first failure.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const FACILITATOR = process.env.RECEIPT_FACILITATOR_URL ?? 'http://localhost:8080'
const TOPIC = process.env.RECEIPT_HCS_TOPIC ?? '0.0.10495465'
const ESCROW = process.env.RECEIPT_ESCROW_ADDRESS ?? ''

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1]
}

const run = (cmd, args, cwd = ROOT) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd, env: process.env, maxBuffer: 64 * 1024 * 1024 })
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
}

/** pnpm prints its own banner before every script; it is not part of the demo. */
const strip = (text) =>
  text
    .split('\n')
    .filter((l) => !/^\s*>\s/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** scenes.ts separates each scene with a box rule and a title line. */
function sections(transcript) {
  const out = {}
  const parts = transcript.split(/\n─{50,}\n/)
  for (let i = 1; i < parts.length; i += 2) {
    const title = parts[i].trim()
    const body = parts[i + 1] ?? ''
    out[title] = strip(body)
  }
  return out
}

const find = (secs, needle) => {
  const key = Object.keys(secs).find((k) => k.includes(needle))
  return key ? secs[key] : ''
}

/** Keep the tail of a long transcript: the summary is the part worth showing. */
const tail = (text, lines) => {
  const l = strip(text).split('\n')
  return l.length <= lines ? l.join('\n') : l.slice(l.length - lines).join('\n')
}

const dealsIn = (text) => [...text.matchAll(/dealId\s+(0x[0-9a-f]{64})/gi)].map((m) => m[1])

async function verdictFor(dealId) {
  try {
    const r = await fetch(`${FACILITATOR}/deals/${dealId}`, { signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const d = await r.json()
    if (!d.verdict) return null
    return {
      dealId,
      reproducible: d.verdict.reproducible,
      attested: d.verdict.attested,
      pass: d.verdict.pass,
      firstFailure: d.verdict.firstFailure,
      observedBytes: d.verdict.observedBytes,
      observedStatus: d.verdict.observedStatus,
      latencyMs: d.verdict.attested?.[0]?.observed ?? null,
    }
  } catch {
    return null
  }
}

// ── gather ────────────────────────────────────────────────────────────────
const scenesFile = arg('--scenes')
const transcript = scenesFile
  ? readFileSync(scenesFile, 'utf8')
  : run('pnpm', ['scenes'])

const secs = sections(transcript)
const honest = find(secs, 'SCENE 2')
const garbage = find(secs, 'SCENE 3 ')
const subtle = find(secs, 'SCENE 3b')
const selfcheck = find(secs, 'SCENE 3c')
const dead = find(secs, 'SCENE 4')

// The reproducibility scene runs three verifications; the released one is the
// one the film shows in full.
const verifySection = find(secs, 'SCENE 5')
const verifyOne = strip(
  verifySection.split(/── verifying the/)[1]?.replace(/^[^\n]*\n/, '') ?? '',
).split(/\n(?=── |Receipt — independent)/)[0]

const honestDeal = dealsIn(honest)[0]
const garbageDeal = dealsIn(garbage)[0]
const subtleDeal = dealsIn(subtle)[0]

const verifyAll = arg('--verify-all')
  ? readFileSync(arg('--verify-all'), 'utf8')
  : run('pnpm', ['verify:all'])

const python = arg('--python')
  ? readFileSync(arg('--python'), 'utf8')
  : run('python3', ['verify.py', '--deal', honestDeal, '--topic', TOPIC,
      ...(ESCROW ? ['--escrow', ESCROW] : [])], join(ROOT, 'verify-py'))

const conformance = arg('--conformance')
  ? readFileSync(arg('--conformance'), 'utf8')
  : run('pnpm', ['conformance'])

const data = {
  honest,
  garbage,
  subtle,
  selfcheck,
  dead,
  verifyOne: strip(verifyOne),
  verifyAll: tail(verifyAll, 30),
  python: strip(python),
  conformance: strip(conformance).replace(/^\s*ok\s+keccak256[^\n]*\n?/gm, ''),
  verdicts: {
    honest: await verdictFor(honestDeal),
    garbage: await verdictFor(garbageDeal),
    subtle: await verdictFor(subtleDeal),
  },
  capturedAt: new Date().toISOString(),
}

for (const [k, v] of Object.entries(data)) {
  if (typeof v === 'string' && v.trim() === '') {
    console.error(`capture is empty: ${k} — the film would show a blank slide`)
    process.exit(1)
  }
}

writeFileSync(
  join(HERE, 'demo-data.js'),
  `// Captured from a live run against Hedera testnet by demo/capture.mjs.\n` +
  `// Do not edit by hand: every number here is meant to be one that happened.\n` +
  `window.DEMO_DATA = ${JSON.stringify(data, null, 2)};\n`,
)

const lines = Object.entries(data)
  .filter(([, v]) => typeof v === 'string')
  .map(([k, v]) => `  ${k.padEnd(12)} ${v.split('\n').length} lines`)
console.log(`wrote demo/demo-data.js\n${lines.join('\n')}`)
