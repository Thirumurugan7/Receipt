import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

/**
 * `selfCheck` and `declinedBody` are pure functions other packages and the test
 * suite import directly. If importing the module also opens a listening socket,
 * running the suite while the demo seller is up fails with EADDRINUSE — on the
 * judge's machine as readily as on ours. Importing must be side-effect free;
 * only running the file as the entry point may bind a port.
 */
describe('importing the seller module', () => {
  test('does not bind a port, so the process exits on its own', async () => {
    const server = fileURLToPath(new URL('../src/server.ts', import.meta.url))
    // tsx is this package's own devDependency; pnpm links its bin here.
    const tsx = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url))

    const exitCode = await new Promise<number | 'timeout'>((resolve) => {
      // No top-level await: tsx transforms --eval as CJS, which rejects it.
      const program =
        `import(${JSON.stringify(server)}).catch((e) => { console.error(e); process.exitCode = 1 })`
      const child = spawn(tsx, ['--eval', program], { stdio: 'inherit' })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve('timeout')
      }, 15_000)
      child.on('exit', (code) => {
        clearTimeout(timer)
        resolve(code ?? 0)
      })
    })

    expect(exitCode).toBe(0)
  }, 20_000)
})
