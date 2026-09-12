/**
 * Is everything a judge might open actually up?
 *
 *   pnpm health
 *
 * Written because a hand-rolled shell loop reported the local services down
 * twice when they were fine, and a false alarm before a demo is as costly as
 * a real outage. This checks each thing the same way a visitor would, prints
 * what it found, and exits non-zero only if something a judge would actually
 * reach is broken.
 */
const TUNNEL = process.env.RECEIPT_TUNNEL_URL ??
  'https://0700-2406-7400-c4-858a-d876-37d7-a720-7be3.ngrok-free.app'

const CHECKS = [
  {
    name: 'hosted ledger',
    critical: true,
    url: 'https://receipt-ledger-zeta.vercel.app',
    note: 'static, no backend, survives this laptop being off',
  },
  {
    name: 'audit topic',
    critical: true,
    url: 'https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10495465/messages?limit=1',
    note: 'the public record everything is checked against',
  },
  {
    name: 'bazantic gateway',
    critical: true,
    url: 'https://2g6od7kdczdp7p5wr3ywz2vhlu.bazgateway.com/health',
    note: 'proxies to the facilitator, so it needs the tunnel up',
  },
  {
    name: 'facilitator (local)',
    critical: false,
    url: 'http://127.0.0.1:8080/health',
    note: 'needed to run NEW deals',
  },
  {
    name: 'seller (local)',
    critical: false,
    url: 'http://127.0.0.1:8787/health',
    note: 'needed to run NEW deals',
  },
  {
    name: 'tunnel',
    critical: false,
    url: `${TUNNEL}/health`,
    headers: { 'ngrok-skip-browser-warning': '1' },
    note: 'the public face of the local stack',
  },
]

const pad = (s, n) => String(s).padEnd(n)

async function probe(c) {
  const started = Date.now()
  try {
    const res = await fetch(c.url, {
      headers: c.headers ?? {},
      signal: AbortSignal.timeout(15_000),
    })
    // A service that is listening but cannot do its job says so in the body.
    // Printing that beats printing 503 and leaving the reader to guess.
    let detail = null
    if (!res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      detail = await res.json().then((b) => b?.detail ?? null).catch(() => null)
    }
    return { ok: res.ok, code: res.status, ms: Date.now() - started, detail }
  } catch (e) {
    return { ok: false, code: e.name === 'TimeoutError' ? 'timeout' : 'unreachable', ms: Date.now() - started }
  }
}

const results = await Promise.all(CHECKS.map(probe))

console.log()
let brokenCritical = 0
let brokenOptional = 0
for (const [i, c] of CHECKS.entries()) {
  const r = results[i]
  if (!r.ok) c.critical ? brokenCritical++ : brokenOptional++
  console.log(`  ${r.ok ? 'up  ' : 'DOWN'}  ${pad(c.name, 20)} ${pad(r.code, 12)} ${pad(r.ms + 'ms', 8)} ${r.detail ?? c.note}`)
}
console.log()

if (brokenCritical) {
  console.log(`  ${brokenCritical} thing(s) a judge would reach are down.`)
} else if (brokenOptional) {
  console.log('  Everything a judge reaches is up. The local stack is off, so the')
  console.log('  "run a deal" buttons will not work: start it with  pnpm serve')
} else {
  console.log('  Everything is up, including running new deals.')
}
console.log()
process.exit(brokenCritical ? 1 : 0)
