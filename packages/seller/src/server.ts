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

app.get('/health', (c) => c.json({ status: 'ok', facilitator: RECEIPT, price: PRICE_TINYBARS }))

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
 *   garbage — HTTP 200 with a useless body. The important one: a naive payment
 *             rail sees "200 OK" and releases the money.
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

  const res = await fetch(`${MIRROR}/api/v1/network/supply`)
  const supply = (await res.json()) as { released_supply?: string; total_supply?: string }

  return c.json({
    data: [
      {
        symbol: 'HBAR',
        network: 'hedera-testnet',
        releasedSupply: supply.released_supply ?? null,
        totalSupply: supply.total_supply ?? null,
        source: 'hedera mirror node /api/v1/network/supply',
      },
    ],
    timestamp: Math.floor(Date.now() / 1000),
  })
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`seller on :${info.port}`)
  console.log(`  facilitator ${RECEIPT}`)
  console.log(`  price       ${PRICE_TINYBARS} tinybars of ${ASSET} on ${NETWORK}`)
})
