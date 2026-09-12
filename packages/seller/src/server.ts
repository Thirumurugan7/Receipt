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
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { paymentMiddlewareFromConfig } from '@x402/hono'
import { HTTPFacilitatorClient } from '@x402/core/server'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { balances, GraphError, poolsFor, toQuote } from './graph.js'

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

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    facilitator: RECEIPT,
    price: PRICE_TINYBARS,
    sells: 'the-graph-token-api',
    graphKeyConfigured: Boolean(process.env.GRAPH_TOKEN_API_KEY),
  }),
)

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
app.get('/api/quote', async (c) => {
  const mode = c.req.query('mode') ?? 'honest'

  if (mode === 'garbage') {
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
    if (mode === 'subtle') {
      return c.json({ ...quote, timestamp: quote.timestamp - STALE_BY_SECONDS })
    }
    return c.json(quote)
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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`seller on :${info.port}`)
  console.log(`  facilitator ${RECEIPT}`)
  console.log(`  price       ${PRICE_TINYBARS} tinybars of ${ASSET} on ${NETWORK}`)
})
