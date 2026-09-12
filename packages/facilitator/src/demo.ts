/**
 * The "run one yourself" button.
 *
 * A judge should not have to clone the repo and fund an account to see that
 * this works, so the ledger page can start a real purchase. That means a
 * publicly reachable endpoint that spends testnet HBAR and starts a child
 * process, which is worth being careful about:
 *
 *   - the mode is looked up in a fixed list, never taken from the request, so
 *     nothing a caller sends reaches the command line;
 *   - one run at a time, spaced out, and capped in total, so one visitor
 *     cannot drain the buyer account and leave the next judge a dead demo.
 *
 * What the button runs is the command the README documents. It is the same
 * code path as `pnpm buy honest`, not a special demo path that could pass
 * while the real one is broken.
 */

/** Seller modes the button may ask for, and what each one demonstrates. */
export const DEMO_MODES = ['honest', 'garbage', 'subtle', 'subtle-selfcheck'] as const
export type DemoMode = (typeof DEMO_MODES)[number]

export function isDemoMode(v: unknown): v is DemoMode {
  return typeof v === 'string' && (DEMO_MODES as readonly string[]).includes(v)
}

export type Refusal =
  | { ok: false; reason: 'busy'; retryAfterMs: number }
  | { ok: false; reason: 'too-soon'; retryAfterMs: number }
  | { ok: false; reason: 'budget-spent'; retryAfterMs: number }

export class RunGate {
  private running = false
  private lastFinishedAt = Number.NEGATIVE_INFINITY
  private used = 0

  constructor(private readonly opts: { minGapMs: number; maxRuns: number }) {}

  get remaining(): number {
    return Math.max(0, this.opts.maxRuns - this.used)
  }

  get busy(): boolean {
    return this.running
  }

  tryAcquire(now: number): { ok: true } | Refusal {
    if (this.running) return { ok: false, reason: 'busy', retryAfterMs: 5_000 }
    if (this.used >= this.opts.maxRuns) {
      return { ok: false, reason: 'budget-spent', retryAfterMs: 0 }
    }
    const waited = now - this.lastFinishedAt
    if (waited < this.opts.minGapMs) {
      return { ok: false, reason: 'too-soon', retryAfterMs: this.opts.minGapMs - waited }
    }
    this.running = true
    this.used += 1
    return { ok: true }
  }

  /** Must be called on every exit path, including failures, or the gate jams. */
  release(now: number): void {
    this.running = false
    this.lastFinishedAt = now
  }
}
