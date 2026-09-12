/**
 * Loads the repo-root .env regardless of which package you launched from.
 * Avoids a per-package .env symlink, which is gitignored and so would not
 * survive a clone.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as dotenvConfig } from 'dotenv'

export function loadRootEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  // packages/core/src -> repo root
  dotenvConfig({ path: resolve(here, '../../../.env'), quiet: true })
}

loadRootEnv()
