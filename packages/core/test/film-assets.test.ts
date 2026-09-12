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
  test('the frame count in the film is the number of frames captured', () => {
    const declared = Number(/const RUN_FRAMES = (\d+)/.exec(film)?.[1])
    const onDisk = readdirSync(runDir).filter((f) => /^f\d+\.jpg$/.test(f)).length
    expect(declared, 'run: node demo/interact.mjs').toBe(onDisk)
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
