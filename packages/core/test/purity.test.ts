import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * BUILD.md Phase 1 checkpoint: the adjudicator has zero network, filesystem or
 * clock imports. This is the property the whole trust argument rests on, so it
 * is asserted mechanically rather than by review.
 */
const SOURCE = readFileSync(new URL('../src/adjudicator.ts', import.meta.url), 'utf8')

describe('adjudicator purity', () => {
  test.each([
    ['node:fs', /node:fs|from ['"]fs['"]/],
    ['node:http', /node:http|from ['"]https?['"]/],
    ['fetch', /\bfetch\s*\(/],
    ['Date.now', /Date\.now|new Date\(\)/],
    ['Math.random', /Math\.random/],
    ['process.env', /process\.env/],
  ])('does not reference %s', (_label, pattern) => {
    expect(SOURCE).not.toMatch(pattern)
  })

  test('imports only from the local module graph and pure libraries', () => {
    const imports = [...SOURCE.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)
    const allowed = /^(\.\/|ajv|ajv-formats|jsonpath-plus|viem)/
    for (const i of imports) expect(i).toMatch(allowed)
  })
})
