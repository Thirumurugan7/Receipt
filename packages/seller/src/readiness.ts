/**
 * Can this seller actually sell right now?
 *
 * The x402 resource server fetches supported payment kinds from the
 * facilitator once, at startup. If the facilitator is not listening yet, that
 * fetch fails, the seller keeps its port open, and every paid request answers
 * 500 until it is restarted. Nothing crashes, so a liveness check sees a
 * healthy process and a buyer sees a refund they cannot explain.
 *
 * Readiness therefore asks about the dependency, not about the socket.
 */
export type Readiness = { ready: boolean; detail: string }

type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>

export async function readiness(
  facilitatorUrl: string,
  fetchImpl: Fetcher = fetch as unknown as Fetcher,
  timeoutMs = 4000,
): Promise<Readiness> {
  const url = `${facilitatorUrl.replace(/\/+$/, '')}/supported`
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return { ready: false, detail: `facilitator answered ${res.status} at ${url}` }
    return { ready: true, detail: `facilitator reachable at ${url}` }
  } catch (e) {
    const name = (e as Error)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ready: false, detail: `facilitator timed out after ${timeoutMs}ms at ${url}` }
    }
    return { ready: false, detail: `facilitator unreachable at ${url}` }
  }
}
