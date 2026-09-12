import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

/**
 * The narration script is read aloud over the film, so a timecode that drifts
 * is a presenter reading the wrong line over the wrong slide. The renderer
 * writes demo/schedule.json from the film itself; this checks DEMO.md against
 * it rather than trusting that both were remembered at the same time.
 *
 * This repo has shipped stale demo docs before. That is what this is for.
 */
const root = new URL('../../../', import.meta.url)
const schedulePath = new URL('demo/schedule.json', root)
const demo = readFileSync(new URL('DEMO.md', root), 'utf8')
const readme = readFileSync(new URL('README.md', root), 'utf8')

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Rows look like: | 1:04 | verdict | Seven checks decide … | */
const rows = [...demo.matchAll(/^\|\s*(\d+:\d{2})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)]
  .map((m) => ({ at: m[1] ?? '', scene: m[2] ?? '', line: m[3] ?? '' }))

describe('the narration script matches the film', () => {
  test('demo/schedule.json exists — the film has been rendered', () => {
    expect(existsSync(schedulePath), 'run: node demo/render.mjs').toBe(true)
  })

  const schedule = existsSync(schedulePath)
    ? JSON.parse(readFileSync(schedulePath, 'utf8'))
    : { totalMs: 0, scenes: [] }

  test('every scene in the film has a line to say over it', () => {
    expect(rows.map((r) => r.scene)).toEqual(schedule.scenes.map((s: { n: string }) => s.n))
  })

  test('every timecode is the moment that scene actually starts', () => {
    for (const [i, s] of schedule.scenes.entries()) {
      expect(rows[i]?.at, `scene ${s.n}`).toBe(mmss(s.start))
    }
  })

  test('the runtime DEMO.md states is the runtime the film has', () => {
    // Match the runtime near the filename, not a particular punctuation mark.
    const stated = demo.match(/receipt-demo\.mp4[^\n]{0,40}?(\d+:\d{2})/)?.[1]
    expect(stated, 'DEMO.md should state the runtime').toBeDefined()
    expect(stated).toBe(mmss(schedule.totalMs))
  })

  test('the README points at the film that exists, with its real runtime', () => {
    expect(readme).toContain('demo/receipt-demo.mp4')
    const stated = readme.match(/receipt-demo\.mp4\)[^\n]{0,40}?(\d+:\d{2})/)?.[1]
    expect(stated, 'README should state the runtime').toBeDefined()
    expect(stated).toBe(mmss(schedule.totalMs))
  })

  test('the film is under four minutes, which is the submission limit', () => {
    expect(schedule.totalMs).toBeGreaterThan(0)
    expect(schedule.totalMs).toBeLessThanOrEqual(240_000)
  })

  test('each line is short enough to read aloud in its scene', () => {
    // ~2.5 words a second at a calm pace; over 3.2 means the presenter is
    // still talking when the slide changes.
    for (const [i, s] of schedule.scenes.entries()) {
      const words = (rows[i]?.line ?? '').split(/\s+/).filter(Boolean).length
      const rate = words / (s.dur / 1000)
      expect(rate, `${s.n}: ${words} words in ${s.dur / 1000}s`).toBeLessThan(3.2)
    }
  })
})
