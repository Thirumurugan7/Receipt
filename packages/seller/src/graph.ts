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

export interface TokenBalance {
  block_num: number
  datetime: string
  timestamp: number
  contract: string
  amount: string
  decimals?: number
  symbol?: string
  network: string
  value?: number
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
 * The sellable payload: a token-holdings snapshot an agent can act on.
 *
 * `timestamp` is lifted to the top level on purpose — the buyer's terms use
 * `freshnessSeconds` against `$.timestamp`, so stale Graph data fails the
 * checks and the seller does not get paid for it.
 */
export function toQuote(raw: { data: TokenBalance[] }, address: string, network: string) {
  const data = (raw.data ?? []).map((b) => ({
    contract: b.contract,
    symbol: b.symbol ?? null,
    amount: b.amount,
    decimals: b.decimals ?? null,
    value: b.value ?? null,
    blockNum: b.block_num,
    network: b.network ?? network,
  }))
  const newest = (raw.data ?? []).reduce((m, b) => Math.max(m, b.timestamp ?? 0), 0)
  return {
    source: 'the-graph-token-api',
    address,
    network,
    data,
    // seconds, matching what the freshness check parses
    timestamp: newest || Math.floor(Date.now() / 1000),
  }
}
