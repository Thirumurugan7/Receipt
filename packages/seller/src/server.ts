/**
 * Demo x402-gated API.
 *
 * The only Receipt-specific configuration here is two lines: the facilitator
 * URL points at Receipt instead of Blocky402, and payTo names Receipt's
 * settlement account. Everything else is stock @x402/hono. That is the
 * "the seller changes nothing" claim, in the form a judge can diff.
 *
 * Phase 3 ships honest mode only; the garbage and dead modes belong to phase 4.
 */
import '@receipt/core/loadenv'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { paymentMiddlewareFromConfig } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { balances, GraphError, poolsFor, toQuote } from './graph.js'
import { readiness } from './readiness.js'
import { adjudicate, decodeTermsHeader } from '@receipt/core'
import type { Observation } from '@receipt/core'

const need = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const PORT = Number(process.env.SELLER_PORT ?? 8787)
const NETWORK = need('BLOCKY402_NETWORK') as `${string}:${string}`
const ASSET = need('SETTLEMENT_ASSET')
const PRICE_TINYBARS = process.env.SELLER_PRICE_TINYBARS ?? '50000000' // 0.5 ℏ
const MIRROR = need('HEDERA_MIRROR_URL')
/** The address whose token holdings this seller quotes. A large exchange hot
 *  wallet: holdings are recognisable rather than airdrop spam, and nobody has
 *  to trust a wallet we control. */
const QUOTE_ADDRESS = process.env.GRAPH_QUOTE_ADDRESS ?? '0x28C6c06298d514Db089934071355E5743bf21d60'
const QUOTE_NETWORK = process.env.GRAPH_QUOTE_NETWORK ?? 'mainnet'
/** How far back `subtle` mode rewinds the snapshot. Must exceed the buyer's
 *  freshnessSeconds (3600) for the check to bite. */
const STALE_BY_SECONDS = Number(process.env.SELLER_STALE_BY_SECONDS ?? 7200)

/** Receipt, not Blocky402. This single line is the integration. */
const RECEIPT = process.env.RECEIPT_FACILITATOR_URL ?? 'http://localhost:8080'

const app = new Hono()

app.use('*', async (c, next) => {
  const paid = c.req.header('x-payment') ?? c.req.header('payment-signature')
  await next()
  console.log(
    `${c.req.method} ${c.req.path} -> ${c.res.status}` +
      ` [payment header: ${paid ? `${paid.length} chars` : 'ABSENT'}]`,
  )
})

/**
 * Health means "can this seller take a payment", not "is this process alive".
 * The difference is not academic: the x402 resource server loads supported
 * payment kinds from the facilitator once at startup, and if the facilitator
 * was not up yet it keeps listening and answers every paid request with 500.
 * Reporting ok in that state is how a restart produced a refunded honest deal.
 */
app.get('/health', async (c) => {
  const dep = await readiness(RECEIPT)
  return c.json(
    {
      status: dep.ready ? 'ok' : 'degraded',
      detail: dep.detail,
      facilitator: RECEIPT,
      price: PRICE_TINYBARS,
      sells: 'the-graph-token-api',
      graphKeyConfigured: Boolean(process.env.GRAPH_TOKEN_API_KEY),
    },
    dep.ready ? 200 : 503,
  )
})

app.use(
  paymentMiddlewareFromConfig(
    {
      'GET /api/quote': {
        accepts: {
          scheme: 'exact',
          network: NETWORK,
          // Receipt's settlement account, because the money is going into
          // escrow rather than straight to this seller.
          payTo: need('FACILITATOR_HEDERA_ACCOUNT_ID'),
          price: { asset: ASSET, amount: PRICE_TINYBARS },
          maxTimeoutSeconds: 300,
        },
        description: 'Live Hedera network data, priced per request',
        mimeType: 'application/json',
      },
    },
    new HTTPFacilitatorClient({ url: RECEIPT }),
    [{ network: NETWORK, server: new ExactHederaScheme() }],
    // Leave syncFacilitatorOnStart at its default: the resource server has to
    // fetch supported kinds from Receipt's /supported before it can quote a
    // price. Start the facilitator first.
  ),
)

/**
 * Three modes, switchable live so the demo can change the seller's behaviour
 * between scenes without restarting anything.
 *
 *   honest  — real data, passes every check
 *   garbage — HTTP 200 with a useless body. A naive payment rail sees
 *             "200 OK" and releases the money.
 *   subtle  — real Graph data, correct shape, every field valid — but the
 *             snapshot is hours old. This is the failure a human reviewer
 *             waves through: nothing looks wrong. Only `freshness` catches it.
 *   dead    — never responds at all.
 */
/**
 * The seller grades its own response against the buyer's terms before
 * returning it.
 *
 * This is only possible because adjudication is a pure function of
 * (terms, response): the seller can run the identical check the escrow will
 * run, reach the identical verdict, and decline rather than ship something it
 * knows will be rejected. An external evaluator — ERC-8183, ACP, a human
 * reviewer — cannot be consulted before the work is delivered, so no such
 * design allows an honest seller to say "I cannot earn this, do not pay me".
 *
 * Off by default, because a seller that does NOT do this is the realistic
 * case and is what the adjudicator exists to catch.
 */
export function selfCheck(termsHeader: string | undefined, body: unknown) {
  if (!termsHeader) return null
  let terms
  try {
    terms = decodeTermsHeader(termsHeader)
  } catch {
    return null // unreadable terms are not the seller's to enforce
  }
  const encoded = new TextEncoder().encode(JSON.stringify(body))
  const observation: Observation = {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: encoded,
    requestTimeMs: Date.now(),
    observedLatencyMs: 0,
  }
  const verdict = adjudicate(terms, observation)
  return verdict.pass ? null : verdict
}

app.get('/api/quote', async (c) => {
  const mode = c.req.query('mode') ?? 'honest'
  const wantsSelfCheck = c.req.query('selfcheck') === '1'

  if (mode === 'garbage') {
    const refused = wantsSelfCheck
      ? selfCheck(c.req.header('X-Receipt-Terms'), { error: 'upstream rate limited' })
      : null
    if (refused) return c.json(declinedBody(refused), 409)
    // Note the status: 200, not 500. Nothing at the HTTP layer is wrong here.
    return c.json({ error: 'upstream rate limited' }, 200)
  }

  if (mode === 'dead') {
    await new Promise(() => {}) // never settles; the caller must time out
  }

  // Honest mode: live token holdings from The Graph's Token API. This is the
  // product. The buyer's terms are written against its shape, the adjudicator
  // decides payment by validating it, and the raw bytes go to HCS so the
  // decision can be re-checked by anyone.
  try {
    // Compose both Graph products: holdings from the Token API, and the
    // markets those holdings trade in from a subgraph. Fetched together so a
    // failure in either half fails the sale rather than half-answering it.
    const raw = await balances(QUOTE_ADDRESS, QUOTE_NETWORK, 5)
    const topHolding = raw.data?.[0]?.contract
    const pools = topHolding ? await poolsFor(topHolding, 3) : undefined
    const quote = toQuote(raw, QUOTE_ADDRESS, QUOTE_NETWORK, pools)

    // `subtle` models a lagging indexer: the holdings are genuinely from The
    // Graph and every field is valid, but the snapshot is stale. A reviewer
    // eyeballing this response would approve it. The signed terms will not.
    const payload = mode === 'subtle'
      ? { ...quote, timestamp: quote.timestamp - STALE_BY_SECONDS }
      : quote

    if (wantsSelfCheck) {
      const refused = selfCheck(c.req.header('X-Receipt-Terms'), payload)
      if (refused) return c.json(declinedBody(refused), 409)
    }
    return c.json(payload)
  } catch (e) {
    if (e instanceof GraphError) {
      // Fail loudly rather than substituting invented data. The checks would
      // catch a fake payload anyway — but a seller that fabricates on error is
      // exactly the behaviour this project exists to make unprofitable.
      return c.json({ error: 'upstream: the graph token api', detail: e.message }, 502)
    }
    throw e
  }
})

/**
 * 409, not 200-with-junk and not 500. The request was well-formed and the
 * seller is working correctly — it simply will not accept payment for a
 * response that does not meet the buyer's stated criteria.
 */
export function declinedBody(verdict: { firstFailure: string | null; reproducible: unknown[] }) {
  return {
    declined: true,
    reason: verdict.firstFailure,
    detail:
      "the seller ran the buyer's own acceptance checks against this response, " +
      'saw that it would be rejected, and declined the sale rather than take a ' +
      'payment it could not keep',
    checks: verdict.reproducible,
  }
}

/**
 * Only listen when this file is the entry point. `selfCheck` and
 * `declinedBody` are pure and imported elsewhere; binding a port as an import
 * side effect makes the test suite fail with EADDRINUSE whenever the demo
 * seller happens to be running.
 */
const isEntryPoint = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntryPoint) {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`seller on :${info.port}`)
    console.log(`  facilitator ${RECEIPT}`)
    console.log(`  price       ${PRICE_TINYBARS} tinybars of ${ASSET} on ${NETWORK}`)
  })
}
