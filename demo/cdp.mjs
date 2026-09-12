/**
 * The smallest Chrome DevTools Protocol client that does what this repo needs.
 *
 * No dependencies: the WebSocket client is the one built into Node. Shared by
 * render.mjs, which paints the film frame by frame, and shot.mjs, which
 * captures the explorer pages the film shows.
 */
import { spawn } from 'node:child_process'

export const CHROME = process.env.CHROME ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Connection {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.listeners = []
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error
          ? reject(new Error(`${msg.error.message} ${JSON.stringify(msg.error.data ?? '')}`))
          : resolve(msg.result)
      } else {
        for (const fn of this.listeners) fn(msg)
      }
    })
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }

  once(method) {
    return new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.method === method) {
          this.listeners = this.listeners.filter((l) => l !== fn)
          resolve(msg.params)
        }
      }
      this.listeners.push(fn)
    })
  }
}

async function endpoint(port, chrome) {
  for (let i = 0; i < 120; i++) {
    if (chrome.exitCode !== null) throw new Error(`Chrome exited with code ${chrome.exitCode}`)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (r.ok) return (await r.json()).webSocketDebuggerUrl
    } catch { /* not listening yet */ }
    await sleep(200)
  }
  throw new Error('Chrome did not open a debugging port')
}

/**
 * Launches headless Chrome at a fixed viewport and attaches to one tab.
 * Returns `call` for raw CDP, plus the helpers both callers need.
 */
export async function launch({ width, height, profileDir }) {
  const port = 9000 + Math.floor(Math.random() * 900)
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    '--disable-lcd-text',
    '--force-device-scale-factor=1',
    '--font-render-hinting=none',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    'about:blank',
  ], { stdio: 'ignore' })

  const conn = new Connection(await (async () => {
    const url = await endpoint(port, chrome)
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${url}`)), { once: true })
    })
    return ws
  })())

  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => conn.send(method, params, sessionId)

  await call('Page.enable')
  await call('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  })

  return {
    call,
    conn,
    async goto(url) {
      const loaded = conn.once('Page.loadEventFired')
      await call('Page.navigate', { url })
      await loaded
    },
    async evaluate(expression, awaitPromise = false) {
      const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
      return r.result.value
    },
    async screenshot(format = 'png') {
      const { data } = await call('Page.captureScreenshot', { format, fromSurface: true })
      return Buffer.from(data, 'base64')
    },
    kill() {
      chrome.kill()
    },
  }
}

export { sleep }
