/**
 * Captures the explorer pages the film shows.
 *
 *   node demo/shot.mjs
 *
 * The film claims these transactions exist. Showing the explorer is how that
 * claim is made checkable on screen rather than asserted, so these are real
 * captures of real pages, taken fresh, not mock-ups.
 *
 * HashScan asks about cookies on first load. This declines them, which is the
 * privacy-preserving answer and also the one that does not leave a banner
 * across the middle of the shot.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, sleep } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'shots')
const WIDTH = 1500
const HEIGHT = 1000

const FACILITATOR = process.env.RECEIPT_FACILITATOR_URL ?? 'http://localhost:8080'

/** Click a button by its visible text, if it is there. */
const CLICK_BY_TEXT = (texts) => `(() => {
  const wanted = ${JSON.stringify(texts)}.map((t) => t.toLowerCase());
  const nodes = [...document.querySelectorAll('button, a, [role=button]')];
  const hit = nodes.find((n) => wanted.includes((n.textContent || '').trim().toLowerCase()));
  if (hit) { hit.click(); return true; }
  return false;
})()`

async function main() {
  mkdirSync(OUT, { recursive: true })

  const deals = await fetch(`${FACILITATOR}/deals`).then((r) => r.json()).catch(() => [])
  const released = deals.find((d) => d.phase === 'released')
  const topic = await fetch(`${FACILITATOR}/health`).then((r) => r.json()).then((h) => h.topic)
    .catch(() => null)

  if (!released?.resolveTxHash || !topic) {
    console.error('need a released deal and a topic from the facilitator; is it running?')
    process.exit(1)
  }

  const shots = [
    {
      name: 'tx-release',
      url: `https://hashscan.io/testnet/transaction/${released.resolveTxHash}`,
      note: `release() for deal ${released.dealId.slice(0, 12)}…`,
    },
    {
      name: 'topic-messages',
      url: `https://hashscan.io/testnet/topic/${topic}/messages`,
      note: 'the audit log',
    },
    {
      name: 'ledger',
      url: FACILITATOR,
      note: 'the live ledger',
    },
  ]

  const browser = await launch({ width: WIDTH, height: HEIGHT, profileDir: join(OUT, '.profile') })
  try {
    for (const s of shots) {
      await browser.goto(s.url)
      // Decline non-essential cookies rather than accept them, then give the
      // app a moment to paint the data it fetched.
      await sleep(2500)
      await browser.evaluate(CLICK_BY_TEXT(['reject', 'decline', 'reject all']))
      await sleep(4500)
      const png = await browser.screenshot('png')
      writeFileSync(join(OUT, `${s.name}.png`), png)
      console.log(`${s.name}.png  ${s.note}`)
    }
  } finally {
    browser.kill()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
