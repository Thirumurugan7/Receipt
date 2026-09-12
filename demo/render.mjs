/**
 * Renders film.html to a video without screen-recording anything.
 *
 *   node demo/render.mjs
 *
 * The film is a pure function of time: `seek(ms)` computes every pixel of
 * state from the clock, so a frame at t is the same frame no matter when, or
 * on whose machine, it is rendered. That is the same property the project
 * claims for its verdicts, and it is what makes this renderer possible --
 * there is no wall-clock animation to race, so frames can be captured as fast
 * or as slowly as Chrome manages.
 *
 * `seek` also returns a signature of the state it just painted. Frames whose
 * signature is unchanged are not re-captured; they become a longer `duration`
 * in the ffmpeg concat list instead. A four-minute film holding on a static
 * slide costs one screenshot, not nine hundred.
 *
 * Dependencies: none. Chrome is driven over the DevTools Protocol using the
 * WebSocket client built into Node, and the page is served by node:http.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FPS = 30
const WIDTH = 1920
const HEIGHT = 1080
const OUT = join(HERE, 'receipt-demo.mp4')
const FRAMES = process.env.FRAME_DIR ?? join(HERE, '.frames')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

// ── a static server for the film, so the page can fetch its own data ───────
function serve() {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0])
    const safe = rel.replace(/\.\./g, '').replace(/^\/+/, '') || 'film.html'
    try {
      const body = readFileSync(join(HERE, safe))
      res.writeHead(200, { 'content-type': TYPES[extname(safe)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function main() {
  const { server, port } = await serve()
  const url = `http://127.0.0.1:${port}/film.html#render`

  rmSync(FRAMES, { recursive: true, force: true })
  mkdirSync(FRAMES, { recursive: true })

  const browser = await launch({
    width: WIDTH, height: HEIGHT, profileDir: join(FRAMES, 'profile'),
  })
  const call = browser.call

  await browser.goto(url)

  // The film is typeset in one family. Rendering a frame in the fallback font
  // because the webfont had not arrived yet would be a silent defect in the
  // finished video, so wait for it and refuse to render without it.
  await call('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
  // Check the faces the film actually sets text in. Checking a weight the
  // film no longer uses fails for the wrong reason and blocks the render.
  const FACES = ['700 80px "IBM Plex Mono"', '500 26px "IBM Plex Mono"',
                 '400 17px "IBM Plex Sans"', '700 46px "IBM Plex Sans"']
  // Ask for them first. A face is only fetched when something visible uses it,
  // and every scene but the first is display:none at t=0, so checking without
  // loading reports faces missing that simply had not been needed yet.
  const missing = (await call('Runtime.evaluate', {
    expression: `Promise.all(${JSON.stringify(FACES)}.map((f) => document.fonts.load(f)))
      .then(() => JSON.stringify(${JSON.stringify(FACES)}.filter((f) => !document.fonts.check(f))))`,
    awaitPromise: true,
    returnByValue: true,
  })).result.value
  if (JSON.parse(missing).length) {
    throw new Error(`webfonts did not load, refusing to render: ${missing}`)
  }

  // The evidence scene plays back dozens of captured frames. Screenshotting
  // one before it has decoded would put a blank rectangle in the finished
  // film, so wait for every image the page holds.
  await call('Runtime.evaluate', {
    expression: `Promise.all([...document.images].map((i) => i.complete ? null : i.decode().catch(() => null)))`,
    awaitPromise: true,
  })

  const total = (await call('Runtime.evaluate', {
    expression: 'window.TOTAL_MS', returnByValue: true,
  })).result.value
  if (!total) throw new Error('film.html did not expose TOTAL_MS')

  // Publish the running order so DEMO.md's timecodes can be checked against
  // the film rather than maintained by hand and silently drifting.
  const schedule = (await call('Runtime.evaluate', {
    expression: 'JSON.stringify(window.SCHEDULE)', returnByValue: true,
  })).result.value
  writeFileSync(join(HERE, 'schedule.json'),
    JSON.stringify({ totalMs: total, scenes: JSON.parse(schedule) }, null, 2) + '\n')

  // --at 0,12500,48000 renders just those moments, for checking the layout
  // without paying for a full render.
  const atArg = process.argv.indexOf('--at')
  if (atArg !== -1) {
    for (const ms of process.argv[atArg + 1].split(',').map(Number)) {
      await call('Runtime.evaluate', { expression: `window.seek(${ms})`, returnByValue: true })
      const { data } = await call('Page.captureScreenshot', { format: 'png', fromSurface: true })
      const file = join(FRAMES, `at-${ms}.png`)
      writeFileSync(file, Buffer.from(data, 'base64'))
      console.log(file)
    }
    browser.kill()
    server.close()
    return
  }

  const frameCount = Math.round((total / 1000) * FPS)
  console.log(`film is ${(total / 1000).toFixed(1)}s — ${frameCount} frames at ${FPS}fps`)

  const shots = []           // { file, frames }
  let lastSig = null
  let captured = 0

  for (let f = 0; f < frameCount; f++) {
    const t = Math.round((f / FPS) * 1000)
    const sig = (await call('Runtime.evaluate', {
      expression: `window.seek(${t})`, returnByValue: true,
    })).result.value

    if (sig === lastSig) {
      shots[shots.length - 1].frames++
      continue
    }
    lastSig = sig

    const { data } = await call('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true,
    })
    const file = join(FRAMES, `f${String(captured).padStart(5, '0')}.png`)
    writeFileSync(file, Buffer.from(data, 'base64'))
    shots.push({ file, frames: 1 })
    captured++

    if (captured % 50 === 0) {
      const pct = ((f / frameCount) * 100).toFixed(0)
      process.stdout.write(`\r  ${pct}% — ${captured} distinct frames captured`)
    }
  }
  process.stdout.write(`\r  100% — ${captured} distinct frames for ${frameCount} frame slots\n`)

  browser.kill()
  server.close()

  // ffmpeg's concat demuxer wants the final entry repeated for its duration to
  // be honoured, and durations in seconds.
  const lines = []
  for (const s of shots) {
    lines.push(`file '${s.file}'`, `duration ${(s.frames / FPS).toFixed(6)}`)
  }
  lines.push(`file '${shots[shots.length - 1].file}'`)
  const listFile = join(FRAMES, 'concat.txt')
  writeFileSync(listFile, lines.join('\n') + '\n')

  const seconds = (total / 1000).toFixed(3)
  const args = [
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-t', seconds,
    '-vf', `fps=${FPS},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-movflags', '+faststart', OUT,
  ]
  console.log(`encoding ${OUT}`)
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] })
  const code = await new Promise((r) => ff.on('exit', r))
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`)

  console.log(`done — ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
