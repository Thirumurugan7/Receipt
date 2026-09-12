/**
 * Records the ledger page actually being used.
 *
 *   node demo/interact.mjs
 *
 * A still of the page proves the page exists. This presses the button, lets a
 * real deal run, and captures the screen while the transcript streams and each
 * transaction link lands -- then follows one of those links to HashScan. The
 * film plays the frames back, so what a viewer sees is a real session rather
 * than a mock-up of one.
 *
 * Frames are JPEG and modest in size on purpose: they are committed so the
 * film can be rebuilt without a live facilitator, and a repo should not carry
 * a hundred full-size PNGs to do it.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch, sleep } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'shots', 'run')
/** Captured full size here first; ffmpeg cannot safely rewrite in place. */
const RAW = join(OUT, 'raw')
const WIDTH = 1400
const HEIGHT = 900
const EVERY_MS = 380              // ~2.6 frames a second of real time
const MAX_FRAMES = 90
const SHRINK_TO = 1120          // committed, so keep them light
const FACILITATOR = process.env.RECEIPT_FACILITATOR_URL ?? 'http://localhost:8080'

/** Click the run button for a given mode. */
const CLICK_RUN = (mode) =>
  `(() => { const b = document.querySelector('[data-mode="${mode}"]'); if (!b) return false; b.click(); return true; })()`

/** True once the run has finished and its links are on screen. */
const IS_DONE = `(() => document.getElementById('term')?.textContent.includes('done —') ?? false)()`

const RESOLVE_TX = `(() => {
  const chips = [...document.querySelectorAll('.chip')];
  const hit = chips.find((c) => (c.textContent || '').toLowerCase().includes('release'));
  const a = hit && hit.querySelector('a');
  return a ? a.href : null;
})()`

async function main() {
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(RAW, { recursive: true })

  const browser = await launch({
    width: WIDTH, height: HEIGHT, profileDir: join(HERE, 'shots', '.profile'),
  })

  let n = 0
  const shoot = async () => {
    const jpg = await browser.screenshot('jpeg')
    writeFileSync(join(RAW, `f${String(n).padStart(3, '0')}.jpg`), jpg)
    n++
  }

  try {
    await browser.goto(FACILITATOR)
    await sleep(3500)                       // let the ledger stream in
    // Put the run panel in view and keep it there; the interesting things all
    // happen inside it.
    await browser.evaluate(
      `document.getElementById('runbar').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); true`,
    )
    await sleep(600)

    await shoot()                            // the page, before anything happens
    await shoot()

    const clicked = await browser.evaluate(CLICK_RUN('honest'))
    if (!clicked) throw new Error('no run button on the page')

    let done = false
    while (n < MAX_FRAMES && !done) {
      await sleep(EVERY_MS)
      await shoot()
      done = await browser.evaluate(IS_DONE)
    }

    // hold on the finished state, with every transaction link on screen
    for (let i = 0; i < 6 && n < MAX_FRAMES; i++) {
      await sleep(EVERY_MS)
      await shoot()
    }

    // follow the release link to the explorer, which is where the money moved
    const txUrl = await browser.evaluate(RESOLVE_TX)
    if (txUrl) {
      await browser.goto(txUrl)
      await sleep(2500)
      await browser.evaluate(
        `(() => { const b = [...document.querySelectorAll('button')]
            .find((x) => (x.textContent || '').trim().toLowerCase() === 'reject');
          if (b) b.click(); return true; })()`,
      )
      await sleep(4500)
      for (let i = 0; i < 8; i++) { await shoot(); await sleep(250) }
    } else {
      console.error('no release link appeared; the explorer tail was skipped')
    }

    // Shrink into the directory the film reads. Never in place: ffmpeg's
    // image sequences start numbering at 1, so rewriting the same pattern
    // silently shifts every frame by one and leaves the first unconverted.
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-start_number', '0', '-i', join(RAW, 'f%03d.jpg'),
      '-vf', `scale=${SHRINK_TO}:-2`, '-q:v', '6',
      '-start_number', '0', join(OUT, 'f%03d.jpg'),
    ])
    rmSync(RAW, { recursive: true, force: true })

    writeFileSync(join(OUT, 'frames.json'), JSON.stringify({ frames: n, everyMs: EVERY_MS }, null, 2) + '\n')
    console.log(`captured ${n} frames -> demo/shots/run/`)
    if (txUrl) console.log(`followed ${txUrl}`)
  } finally {
    browser.kill()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
