import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * public/verify.js is a build artefact that is committed, because the
 * facilitator serves it as a static file with no build step at run time. That
 * makes it possible to edit the TypeScript, forget to rebuild, and ship a page
 * whose "recompute it yourself" button runs last week's adjudicator while
 * claiming to run this one.
 *
 * So: rebuild it here and require the bytes to match.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))
const committed = join(root, 'packages/dashboard/public/verify.js')
const entry = join(root, 'packages/dashboard/src/verify-browser.ts')
const esbuild = join(root, 'node_modules/.bin/esbuild')

describe('the committed browser verifier', () => {
  test('is the current build of its source', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'receipt-verify-')), 'verify.js')
    execFileSync(esbuild, [
      entry, '--bundle', '--format=iife', '--platform=browser',
      '--target=es2022', '--minify', `--outfile=${out}`,
    ], { cwd: root, stdio: 'pipe' })

    expect(readFileSync(committed, 'utf8'), 'run: pnpm build:verifier')
      .toBe(readFileSync(out, 'utf8'))
  }, 60_000)

  test('carries no reference to the facilitator it is meant to check', () => {
    // The whole claim is that this recomputes from the mirror node without
    // asking our server. A fetch back to it would quietly make that false.
    const js = readFileSync(committed, 'utf8')
    expect(js).toMatch(/mirrornode\.hedera\.com/)
    expect(js).not.toMatch(/\/deals\//)
    expect(js).not.toMatch(/localhost:8080/)
  })
})
