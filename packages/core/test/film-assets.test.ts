import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * The evidence scene plays back a recorded session frame by frame, and the
 * film holds the frame count as a constant. If a re-capture produces a
 * different number, the film either stops early on a frozen image or asks for
 * files that are not there and shows gaps. Neither fails loudly on its own,
 * so it fails here instead.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url))
const film = readFileSync(`${root}demo/film.html`, 'utf8')
const runDir = `${root}demo/shots/run`

describe('the recorded session the film plays back', () => {
  test('the frame count comes from the capture, not a second copy in the film', () => {
    // Two numbers that must agree eventually will not. The film reads the
    // count from run-frames.js, which interact.mjs writes; the only thing to
    // check is that the written number matches what is on disk.
    const declared = Number(/window\.RUN_FRAMES = (\d+)/
      .exec(readFileSync(`${root}demo/run-frames.js`, 'utf8'))?.[1])
    const onDisk = readdirSync(runDir).filter((f) => /^f\d+\.jpg$/.test(f)).length
    expect(declared, 'run: node demo/interact.mjs').toBe(onDisk)
    expect(film, 'the film should not hold its own copy of the count')
      .not.toMatch(/const RUN_FRAMES = \d+/)
  })

  test('the frames are numbered from zero with no gaps', () => {
    const names = readdirSync(runDir).filter((f) => /^f\d+\.jpg$/.test(f)).sort()
    names.forEach((name, i) => {
      expect(name).toBe(`f${String(i).padStart(3, '0')}.jpg`)
    })
  })

  test('every still the film references is present', () => {
    for (const m of film.matchAll(/src="(shots\/[^"]+)"/g)) {
      if (m[1]!.includes('${')) continue           // the generated run frames
      expect(existsSync(`${root}demo/${m[1]}`), m[1]).toBe(true)
    }
  })
})
