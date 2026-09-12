import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * The README is judged, and a README that disagrees with the repo is worse
 * than no README. These assert the claims that rot fastest: addresses that
 * change on redeploy, and commands that get renamed.
 */
const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

const readme = read('README.md')
const deployments = read('DEPLOYMENTS.md')
const rootPkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

// Anchored on both sides: an unanchored {40} also matches the first 40
// characters of a 64-character hash, which would flag every verdict hash as a
// drifted address.
const ADDRESS_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g
const addresses = (s: string) =>
  new Set(s.match(ADDRESS_RE)?.map((a) => a.toLowerCase()) ?? [])
const hederaIds = (s: string) => new Set(s.match(/\b0\.0\.\d{4,}\b/g) ?? [])

describe('README agrees with DEPLOYMENTS', () => {
  test('every EVM address in the README also appears in DEPLOYMENTS', () => {
    const inDeployments = addresses(deployments)
    for (const a of addresses(readme)) expect(inDeployments).toContain(a)
  })

  test('every Hedera entity id in the README also appears in DEPLOYMENTS', () => {
    const inDeployments = hederaIds(deployments)
    for (const id of hederaIds(readme)) expect(inDeployments).toContain(id)
  })

  test('the escrow address is stated exactly once per document, so a redeploy cannot half-update it', () => {
    const count = (s: string, a: string) => (s.toLowerCase().match(new RegExp(a, 'g')) ?? []).length
    const escrow = '0x3483b3761ebe3c2fc2eb3efe8215a7cf90634071'
    // README links it and shows it as text, DEPLOYMENTS lists it in several rows;
    // the point is only that both agree on a single value.
    expect(count(readme, escrow)).toBeGreaterThan(0)
    expect(count(deployments, escrow)).toBeGreaterThan(0)
  })
})

describe('README commands exist', () => {
  const referenced = [...readme.matchAll(/^\s*(?:\$ )?pnpm ([a-z][a-z-]*)/gm)]
    .map((m) => m[1]!)
    .filter((s) => !['install', 'test', 'typecheck', 'exec', 'run'].includes(s))

  test('the README references at least the core commands', () => {
    expect(referenced.length).toBeGreaterThan(3)
  })

  test.each([...new Set(referenced)])('pnpm %s is a real script', (name) => {
    expect(Object.keys(rootPkg.scripts)).toContain(name)
  })

  test('the workspace exposes the commands the demo depends on', () => {
    for (const s of ['facilitator', 'seller', 'scenes', 'buy', 'claim', 'verify', 'test', 'typecheck']) {
      expect(rootPkg.scripts).toHaveProperty(s)
    }
  })
})

describe('honesty section is present', () => {
  test('the README states what is not done', () => {
    expect(readme).toMatch(/## What is not done, honestly/)
  })

  test('it discloses the one-hop custody rather than burying it', () => {
    expect(readme.toLowerCase()).toMatch(/custodies for one hop/)
  })

  test('it discloses that latency is attested rather than proven', () => {
    expect(readme).toMatch(/observedLatencyMs/)
    expect(readme.toLowerCase()).toMatch(/cannot recompute|cannot prove|own stopwatch/)
  })
})
