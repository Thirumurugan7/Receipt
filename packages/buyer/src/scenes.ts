/**
 * Runs every scene end to end against Hedera testnet, in order.
 *
 *   pnpm scenes
 *
 * Each scene is a real paid request: real settlement through Blocky402, real
 * escrow, real release or refund. Nothing here is simulated, which is why it
 * takes a couple of minutes — the dead-seller scene has to actually wait for a
 * deadline to pass.
 */
import '@receipt/core/loadenv'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Workspace scripts live at the repo root; this file runs from packages/buyer. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const FACILITATOR = process.env.RECEIPT_FACILITATOR_URL ?? 'http://localhost:8080'
const SELLER = process.env.SELLER_URL ?? 'http://localhost:8787'

const rule = (t: string) => console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`)

async function healthy(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) })
    return r.ok
  } catch {
    return false
  }
}

for (const [name, url] of [['facilitator', FACILITATOR], ['seller', SELLER]] as const) {
  if (!(await healthy(url))) {
    console.error(`${name} is not responding at ${url}`)
    console.error('start them first:  pnpm facilitator   (then)   pnpm seller')
    process.exit(1)
  }
}
console.log(`facilitator ${FACILITATOR}  seller ${SELLER}  — both healthy`)

const run = (args: string[]) =>
  spawnSync('pnpm', args, { stdio: 'inherit', cwd: ROOT, env: process.env })

const capture = (args: string[]) =>
  spawnSync('pnpm', args, { encoding: 'utf8', cwd: ROOT, env: process.env })

const dealFrom = (output: string): string | null =>
  output.match(/0x[0-9a-f]{64}/i)?.[0] ?? null

// ── Scene 2 ───────────────────────────────────────────────────────────────
rule('SCENE 2 — honest seller: checks pass, funds release to the seller')
const honest = capture(['--filter', '@receipt/buyer', 'start', 'honest'])
process.stdout.write(honest.stdout ?? '')
const honestDeal = (honest.stdout ?? '').match(/dealId\s+(0x[0-9a-f]{64})/i)?.[1] ?? null

// ── Scene 3 ───────────────────────────────────────────────────────────────
rule('SCENE 3 — garbage: HTTP 200 with a useless body. Funds return automatically.')
const garbage = capture(['--filter', '@receipt/buyer', 'start', 'garbage'])
process.stdout.write(garbage.stdout ?? '')
const garbageDeal = (garbage.stdout ?? '').match(/dealId\s+(0x[0-9a-f]{64})/i)?.[1] ?? null

// ── Scene 4 ───────────────────────────────────────────────────────────────
rule('SCENE 4 — dead seller: no verdict is invented; a stranger recovers the funds')
const dead = capture(['--filter', '@receipt/buyer', 'start', 'dead'])
process.stdout.write(dead.stdout ?? '')
const deadDeal = (dead.stdout ?? '').match(/dealId\s+(0x[0-9a-f]{64})/i)?.[1] ?? dealFrom(dead.stdout ?? '')
if (deadDeal) {
  run(['--filter', '@receipt/buyer', 'claim', '--deal', deadDeal])
} else {
  console.error('could not determine the dead-seller dealId; skipping claimExpired')
}

// ── Scene 5 ───────────────────────────────────────────────────────────────
rule('SCENE 5 — reproducibility: do not trust the adjudicator, re-run it yourself')
console.log('\nwaiting a few seconds for the mirror node to index the last messages…')
await new Promise((r) => setTimeout(r, 8000))

let failures = 0
for (const [label, deal] of [['released (pass)', honestDeal], ['refunded (fail)', garbageDeal]] as const) {
  if (!deal) continue
  console.log(`\n── verifying the ${label} deal ──`)
  const res = run(['verify', '--deal', deal])
  if (res.status !== 0) failures++
}

rule(failures === 0 ? 'ALL SCENES PASSED' : `FINISHED WITH ${failures} VERIFICATION FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
