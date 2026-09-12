/**
 * The Graph — Token API client (Pinax).
 *
 * This is what the seller actually sells. It is load-bearing rather than
 * decorative in a specific sense: the buyer's acceptance terms are written
 * against the SHAPE of this response, the adjudicator decides whether the
 * seller gets paid by validating it, and the raw response is published to HCS
 * so anyone can re-check that decision offline.
 *
 * In other words the project produces a verifiable receipt for a Graph query.
 * Remove The Graph and there is nothing being bought.
 *
 * Base URL and auth shape confirmed against app.pinax.network/docs/api.
 */
const BASE = process.env.GRAPH_API_BASE ?? 'https://api.pinax.network/v1'

/**
 * One row as the Token API actually returns it.
 *
 * The published docs sample shows `timestamp` / `block_num`; the live EVM
 * balances endpoint returns `last_update_timestamp` / `last_update_block_num`.
 * These names are taken from a real response, not the sample.
 */
export interface TokenBalance {
  last_update: string
  last_update_block_num: number
  last_update_timestamp: number
  address: string
  contract: string
  amount: string
  value?: number
  name?: string
  symbol?: string
  decimals?: number
  network: string
}

export class GraphError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

function apiKey(): string {
  const k = process.env.GRAPH_TOKEN_API_KEY
  if (!k) {
    // No mock fallback by design: a demo that invents token data when the
    // integration is missing is worse than one that refuses to start.
    throw new GraphError(
      'GRAPH_TOKEN_API_KEY is not set. Get one at https://thegraph.market — ' +
        'the seller has nothing real to sell without it.',
    )
  }
  return k
}

async function get<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GraphError(`Token API ${res.status} for ${path}: ${body.slice(0, 160)}`, res.status)
  }
  return (await res.json()) as T
}

/** ERC-20 balances for one address, newest first. */
export async function balances(
  address: string,
  network = 'mainnet',
  limit = 5,
): Promise<{ data: TokenBalance[] }> {
  return get('/evm/balances', { network, address, limit, page: 1 })
}

/** Networks The Graph serves. Unauthenticated, used for the health probe. */
export async function networks(): Promise<{ networks: { id: string; fullName: string }[] }> {
  const res = await fetch(`${BASE}/networks`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new GraphError(`networks ${res.status}`, res.status)
  return (await res.json()) as { networks: { id: string; fullName: string }[] }
}

/**
 * The sellable payload, composed from BOTH Graph products.
 *
 * `timestamp` is lifted to the top level on purpose — the buyer's terms use
 * `freshnessSeconds` against `$.timestamp`, so stale Graph data fails the
 * checks and the seller does not get paid for it. `indexedBlock` does the same
 * job in blocks rather than seconds, which is the unit the data is actually
 * produced in.
 */
export function toQuote(
  raw: { data: TokenBalance[] },
  address: string,
  network: string,
  pools?: { pools: Pool[]; _meta: { block: { number: number; timestamp: number } } },
) {
  const data = (raw.data ?? []).map((b) => ({
    contract: b.contract,
    symbol: b.symbol ?? null,
    name: b.name ?? null,
    amount: b.amount,
    decimals: b.decimals ?? null,
    value: b.value ?? null,
    blockNum: b.last_update_block_num,
    lastUpdate: b.last_update,
    network: b.network ?? network,
  }))
  const newest = (raw.data ?? []).reduce((m, b) => Math.max(m, b.last_update_timestamp ?? 0), 0)

  const markets = (pools?.pools ?? []).map((p) => ({
    pool: p.id,
    feeTier: p.feeTier,
    liquidity: p.liquidity,
    tvlUsd: p.totalValueLockedUSD,
    pair: `${p.token0.symbol}/${p.token1.symbol}`,
  }))

  return {
    // Two Graph products, named so the buyer can assert on both.
    source: 'the-graph',
    sources: {
      balances: 'token-api',
      markets: 'subgraph',
    },
    address,
    network,
    data,
    markets,
    /** The subgraph's indexed head. Provenance in blocks, not wall clock. */
    indexedBlock: pools?._meta.block.number ?? 0,
    // seconds, matching what the freshness check parses
    timestamp: newest || Math.floor(Date.now() / 1000),
  }
}

// ─── Second Graph product: the Subgraph Gateway ──────────────────────────────
//
// The quote composes TWO of The Graph's products. Token API supplies what the
// address holds; a subgraph supplies where that asset actually trades. Neither
// answers the question alone, which is what makes this composition rather than
// two endpoints stapled together.
//
// It also gives the buyer something stronger than wall-clock freshness to
// assert on: `_meta.block.number` is the indexed head, so the terms can demand
// the data be recent in BLOCKS, not just in seconds.

const GATEWAY = process.env.GRAPH_GATEWAY_BASE ?? 'https://gateway.thegraph.com/api'

export interface Pool {
  id: string
  feeTier: string
  liquidity: string
  totalValueLockedUSD: string
  token0: { symbol: string; id: string }
  token1: { symbol: string; id: string }
}

function subgraphKey(): string {
  const k = process.env.GRAPH_SUBGRAPH_KEY
  if (!k) {
    throw new GraphError(
      'GRAPH_SUBGRAPH_KEY is not set. Get one at https://thegraph.com/studio — ' +
        'the quote composes the Token API with a subgraph and will not fake either half.',
    )
  }
  return k
}

export async function subgraphQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const id = process.env.GRAPH_SUBGRAPH_ID
  if (!id) throw new GraphError('GRAPH_SUBGRAPH_ID is not set')

  const res = await fetch(`${GATEWAY}/${subgraphKey()}/subgraphs/id/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new GraphError(`subgraph gateway ${res.status}`, res.status)

  const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) throw new GraphError(`subgraph: ${body.errors[0]!.message}`)
  if (!body.data) throw new GraphError('subgraph returned no data')
  return body.data
}

/** Deepest pools for a token, plus the subgraph's indexed head block. */
export async function poolsFor(tokenAddress: string, first = 3) {
  return subgraphQuery<{ pools: Pool[]; _meta: { block: { number: number; timestamp: number } } }>(
    `query Pools($token: String!, $first: Int!) {
       pools(first: $first, orderBy: totalValueLockedUSD, orderDirection: desc,
             where: { token0: $token }) {
         id feeTier liquidity totalValueLockedUSD
         token0 { symbol id }
         token1 { symbol id }
       }
       _meta { block { number timestamp } }
     }`,
    { token: tokenAddress.toLowerCase(), first },
  )
}
