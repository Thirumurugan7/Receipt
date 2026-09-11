import { hashJcs } from './terms.js'
import type { Hex, Verdict } from './types.js'

export function hashVerdict(verdict: Verdict): Hex {
  return hashJcs(verdict)
}
