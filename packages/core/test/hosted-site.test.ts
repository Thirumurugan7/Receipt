import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The hosted ledger is a static page with no server behind it, which is the
 * whole point of it: it rebuilds every deal in the browser from Hedera's
 * mirror node. That makes two things drift-prone, and both have bitten this
 * repo already in other forms.
 *
 * The deployment identifiers are baked into the page because there is no
 * /health to ask, so they can fall out of step with the ones we actually
 * deployed. And site/verify.js is a copy of the built bundle, so it can be a
 * version behind the adjudicator it claims to run.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))
const site = readFileSync(`${root}site/index.html`, 'utf8')
const deployment = readFileSync(`${root}site/deployment.js`, 'utf8')
const deployments = readFileSync(`${root}DEPLOYMENTS.md`, 'utf8')

const field = (name: string) =>
  new RegExp(`${name}:\\s*'([^']+)'`).exec(deployment)?.[1]

describe('the hosted ledger', () => {
  test('its baked-in identifiers are the ones DEPLOYMENTS records', () => {
    for (const name of ['escrow', 'adjudicator', 'topic'] as const) {
      const value = field(name)
      expect(value, `${name} missing from deployment.js`).toBeTruthy()
      expect(deployments, `${name} ${value} is not in DEPLOYMENTS.md`).toContain(value!)
    }
  })

  test('the verifier it serves is the current build', () => {
    expect(readFileSync(`${root}site/verify.js`, 'utf8'), 'run: pnpm build:site')
      .toBe(readFileSync(`${root}packages/dashboard/public/verify.js`, 'utf8'))
  })

  /**
   * If the page could call a server of ours, "rebuilt in your browser" would
   * be a claim rather than a fact. It must reach only Hedera.
   */
  test('it asks no server of ours for anything', () => {
    expect(site).not.toMatch(/fetch\('\/health'\)/)
    expect(site).not.toMatch(/\/demo\/run/)
    expect(site).not.toMatch(/EventSource/)
    expect(site).toMatch(/loadLedger/)
  })
})
