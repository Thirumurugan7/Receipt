/**
 * The seller cannot quote a price until it has fetched supported payment kinds
 * from the facilitator. If that fetch fails at boot it does NOT crash: it keeps
 * listening and answers /api/quote with 500. A health check that only asks
 * "are you listening?" calls that healthy, which is how a restart produced a
 * refunded honest deal nobody could explain.
 *
 * So readiness is a question about the dependency, not about the socket.
 */
import { describe, expect, it } from 'vitest'
import { readiness } from '../src/readiness.js'

const respond = (status: number) =>
  async () => new Response('[]', { status })

describe('seller readiness', () => {
  it('is ready when the facilitator answers /supported', async () => {
    const r = await readiness('http://facilitator.test', respond(200))
    expect(r.ready).toBe(true)
  })

  it('asks the facilitator for its supported payment kinds', async () => {
    let asked = ''
    await readiness('http://facilitator.test', async (u) => {
      asked = String(u)
      return new Response('[]', { status: 200 })
    })
    expect(asked).toBe('http://facilitator.test/supported')
  })

  it('is not ready when the facilitator is unreachable', async () => {
    const r = await readiness('http://facilitator.test', async () => {
      throw new TypeError('fetch failed')
    })
    expect(r.ready).toBe(false)
    expect(r.detail).toContain('unreachable')
  })

  it('is not ready when the facilitator answers with an error status', async () => {
    const r = await readiness('http://facilitator.test', respond(503))
    expect(r.ready).toBe(false)
    expect(r.detail).toContain('503')
  })

  it('is not ready when the facilitator takes too long', async () => {
    const r = await readiness(
      'http://facilitator.test',
      async (_u, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })))
        }),
      50,
    )
    expect(r.ready).toBe(false)
    expect(r.detail).toContain('timed out')
  })
})
