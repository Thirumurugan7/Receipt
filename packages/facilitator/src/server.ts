/**
 * The Receipt facilitator.
 *
 * Two faces:
 *   - to the BUYER it is a proxy: POST /proxy runs the nine-step flow.
 *   - to the SELLER it is an x402 facilitator: /verify, /settle, /supported.
 *     The seller points @x402/hono at this URL instead of Blocky402 and
 *     changes nothing else. That is the drop-in claim, made literal.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { decodeTermsHeader, hashVerdict } from '@receipt/core'
import type { Hex } from '@receipt/core'
import { config } from './env.js'
import { blocky, requirementsFor } from './blocky.js'
import { decodePayment, FlowError, runFlow, SellerUnreachableError } from './flow.js'
import { adjudicatorAddress, readDeal } from './escrow.js'
import * as store from './store.js'
import { openapi, publicUrl } from './openapi.js'
import { DEMO_MODES, isDemoMode, RunGate } from './demo.js'
import { lookup, record } from './payments.js'

const app = new Hono()

// Without this, a seller answering 402 to a paid request is invisible.
app.use('*', async (c, next) => {
  const started = Date.now()
  await next()
  console.log(`${c.req.method} ${c.req.path} -> ${c.res.status} (${Date.now() - started}ms)`)
})

/** The dashboard is a single static file; no build step, no bundler. */
const DASHBOARD = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../dashboard/public/index.html',
)

app.get('/', (c) => {
  try {
    return c.html(readFileSync(DASHBOARD, 'utf8'))
  } catch {
    return c.text('dashboard not found', 404)
  }
})

app.get('/openapi.json', (c) => c.json(openapi(publicUrl())))

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    adjudicator: adjudicatorAddress,
    escrow: config.escrow,
    topic: config.topicId,
    network: config.network,
    settlesThrough: config.blockyUrl,
  }),
)

/** x402 facilitator interface, for the seller's middleware. */
app.get('/supported', async (c) => c.json(await blocky.supported()))

/**
 * Receipt has already verified and settled this payment by the time the seller
 * asks — it had to, in order to fund escrow before calling the seller. So this
 * reports the known-good result rather than paying twice.
 */
app.post('/verify', async (c) => {
  const body = await c.req.json()
  const seen = lookup(body?.paymentPayload)
  if (seen) return c.json({ isValid: true, payer: seen.payer })
  return c.json(await blocky.verify(body.paymentPayload, body.paymentRequirements))
})

app.post('/settle', async (c) => {
  const body = await c.req.json()
  const seen = lookup(body?.paymentPayload)
  if (seen) {
    return c.json({
      success: true, transaction: seen.transaction, network: config.network, payer: seen.payer,
    })
  }
  return c.json(await blocky.settle(body.paymentPayload, body.paymentRequirements))
})

/** The buyer's entry point. */
app.post('/proxy', async (c) => {
  const termsHeader = c.req.header('X-Receipt-Terms')
  const signature = c.req.header('X-Receipt-Signature') as Hex | undefined
  const paymentHeader = c.req.header('X-PAYMENT')

  if (!termsHeader || !signature) {
    return c.json({ error: 'X-Receipt-Terms and X-Receipt-Signature are required' }, 400)
  }

  const terms = decodeTermsHeader(termsHeader)

  // Standard x402: no payment yet, so quote one. payTo is the FACILITATOR,
  // which is what routes the money through escrow instead of to the seller.
  if (!paymentHeader) {
    return c.json(
      {
        x402Version: 2,
        error: 'payment required',
        resource: { url: terms.resource },
        accepts: [requirementsFor(terms.amount)],
      },
      402,
    )
  }

  try {
    const payload = decodePayment(paymentHeader)
    const result = await runFlow(terms, signature, payload)

    return new Response(result.body, {
      status: 200,
      headers: {
        'content-type': result.contentType || 'application/octet-stream',
        'X-Receipt-Deal-Id': result.dealId,
        'X-Receipt-Verdict': result.verdict.pass ? 'pass' : 'fail',
        // the seller's own status, so a caller can tell a decline (409) from a
        // bad payload returned with 200
        'X-Receipt-Seller-Status': String(result.status),
        'X-Receipt-Verdict-Hash': hashVerdict(result.verdict),
        'X-Receipt-First-Failure': result.verdict.firstFailure ?? '',
        'X-Receipt-Settlement-Tx': result.settlementTxId,
        'X-Receipt-Open-Tx': result.openTxHash,
        'X-Receipt-Resolve-Tx': result.resolveTxHash,
      },
    })
  } catch (e) {
    if (e instanceof SellerUnreachableError) {
      return c.json(
        {
          error: e.message,
          dealId: e.dealId,
          remedy: 'claimExpired',
          claimableAfter: new Date(e.deadlineMs).toISOString(),
          note: 'the deal is still open on-chain; anyone may call claimExpired after the deadline',
        },
        504,
        { 'X-Receipt-Deal-Id': e.dealId },
      )
    }
    const err = e as FlowError
    return c.json({ error: err.message }, (err.status as 400) ?? 500)
  }
})

/**
 * Let a visitor run a real deal.
 *
 * This spends testnet HBAR and starts a child process on every press, so the
 * mode is looked up in a fixed list and the gate caps how often and how many
 * times. What it runs is the documented command, so what a judge sees here is
 * the same code path they would get by cloning the repo.
 */
const gate = new RunGate({
  minGapMs: Number(process.env.RECEIPT_DEMO_MIN_GAP_MS ?? 15_000),
  maxRuns: Number(process.env.RECEIPT_DEMO_MAX_RUNS ?? 200),
})

app.get('/demo/status', (c) =>
  c.json({ modes: DEMO_MODES, remaining: gate.remaining, busy: gate.busy }),
)

app.post('/demo/run', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { mode?: unknown }
  if (!isDemoMode(body.mode)) {
    return c.json({ error: 'unknown mode', allowed: DEMO_MODES }, 400)
  }
  const mode = body.mode

  const slot = gate.tryAcquire(Date.now())
  if (!slot.ok) {
    return c.json(
      { error: slot.reason, retryAfterMs: slot.retryAfterMs, remaining: gate.remaining },
      429,
    )
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const enc = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch { /* client gone */ }
      }

      send('start', { mode, command: `pnpm buy ${mode}` })

      // The mode is one of four constants; nothing from the request reaches
      // the argument list, and there is no shell.
      const child = spawn('pnpm', ['--filter', '@receipt/buyer', 'start', mode], {
        cwd: repoRoot,
        env: process.env,
      })

      let buffered = ''
      const pump = (chunk: Buffer) => {
        buffered += chunk.toString('utf8')
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          if (/^\s*>\s/.test(line)) continue   // pnpm's own banner
          send('line', { line })
        }
      }
      child.stdout.on('data', pump)
      child.stderr.on('data', pump)

      const finish = (info: Record<string, unknown>) => {
        if (buffered.trim()) send('line', { line: buffered })
        gate.release(Date.now())
        send('done', { ...info, remaining: gate.remaining })
        try { controller.close() } catch { /* already closed */ }
      }

      child.on('error', (err) => finish({ ok: false, error: String(err) }))
      child.on('close', (code) => finish({ ok: code === 0, exitCode: code }))
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
})

app.get('/deals', (c) => c.json(store.all()))

app.get('/deals/:dealId', async (c) => {
  const dealId = c.req.param('dealId') as Hex
  const record = store.get(dealId)
  const onchain = await readDeal(dealId).catch(() => null)
  if (!record && !onchain) return c.json({ error: 'unknown deal' }, 404)
  return c.json({
    ...record,
    onchain: onchain
      ? { ...onchain, amount: onchain.amount.toString(), openedAt: Number(onchain.openedAt), deadline: Number(onchain.deadline) }
      : null,
  })
})

app.get('/stream', (c) => {
  let unsubscribe = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      controller.enqueue(enc.encode(': connected\n\n'))
      for (const d of store.all()) controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\n\n`))
      unsubscribe = store.subscribe((e) => {
        try { controller.enqueue(enc.encode(e)) } catch { /* client gone */ }
      })
    },
    cancel() { unsubscribe() },
  })
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  })
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Receipt facilitator on :${info.port}`)
  console.log(`  escrow      ${config.escrow}`)
  console.log(`  adjudicator ${adjudicatorAddress}`)
  console.log(`  HCS topic   ${config.topicId}`)
  console.log(`  settles via ${config.blockyUrl} (${config.network})`)
})

export { app }
