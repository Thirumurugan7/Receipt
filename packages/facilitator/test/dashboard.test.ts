import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * The dashboard is a prop, but it is a prop that appears on camera and is
 * served from the facilitator. These guard the things that would break it
 * silently: a renamed endpoint, or a stray external dependency that fails to
 * load on a conference network.
 */
const html = readFileSync(new URL('../../dashboard/public/index.html', import.meta.url), 'utf8')

describe('dashboard', () => {
  test('subscribes to the facilitator SSE stream', () => {
    expect(html).toMatch(/new EventSource\('\/stream'\)/)
  })

  test('reads deployment identifiers from /health rather than hardcoding them', () => {
    expect(html).toMatch(/fetch\('\/health'\)/)
    // a redeploy must not require editing this file
    expect(html).not.toMatch(/0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071/i)
  })

  test('renders a state for every phase the flow can reach', () => {
    for (const phase of ['released', 'refunded', 'expired', 'awaiting-expiry', 'failed']) {
      expect(html).toContain(`'${phase}'`)
    }
  })

  test('distinguishes attested checks from reproducible ones on screen', () => {
    expect(html).toMatch(/attested/)
  })

  test('escapes interpolated values, since deal data reaches the DOM as HTML', () => {
    // an escaper exists...
    expect(html).toMatch(/const esc = \(s\)/)
    expect(html).toMatch(/&amp;/)
    expect(html).toMatch(/&lt;/)
    // ...and the seller-controlled fields actually go through it
    expect(html).toMatch(/esc\(d\.terms\?\.resource/)
    expect(html).toMatch(/esc\(c\.detail\)/)
  })

  test('loads no script from a third party', () => {
    const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]!)
    expect(scriptSrcs).toHaveLength(0)
  })

  /**
   * Hedera prints a transaction id as 0.0.7162784@1789235851.125983072 and
   * HashScan routes on 0.0.7162784-1789235851-125983072. Passing the printed
   * form straight through renders a link to a page that does not exist, on
   * the one page whose whole argument is "do not believe me, go and look".
   */
  test('converts a printed Hedera transaction id into the form HashScan routes on', () => {
    expect(html).toMatch(/\(\\d\+\\\.\\d\+\\\.\\d\+\)@/)
    expect(html).toMatch(/\$\{m\[1\]\}-\$\{m\[2\]\}-\$\{m\[3\]\}/)
  })

  test('cites each audit message on the mirror node, not just the topic', () => {
    expect(html).toMatch(/mirrornode\.hedera\.com/)
    expect(html).toMatch(/topics\/\$\{t\}\/messages\/\$\{seq\}/)
  })

  test('the run button posts a mode the server re-checks, and streams the result', () => {
    expect(html).toMatch(/fetch\('\/demo\/run'/)
    expect(html).toMatch(/EventSource\('\/stream'\)/)
  })

  test('respects reduced motion', () => {
    expect(html).toMatch(/prefers-reduced-motion/)
  })

  test('links out to HashScan for contract, topic and transactions', () => {
    // The network comes from /health like every other identifier, so the URL
    // is built rather than spelled out.
    expect(html).toMatch(/hashscan\.io\/\$\{net\}/)
    expect(html).toMatch(/\/contract\//)
    expect(html).toMatch(/\/topic\//)
    expect(html).toMatch(/\/transaction\//)
  })
})
