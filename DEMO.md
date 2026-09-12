# DEMO.md — the film, and what to say over it

`demo/receipt-demo.mp4` — 3:54, 1920×1080, no audio.

Every figure in it came off a live run against Hedera testnet: real settlement
through Blocky402, real escrow, real release and refund, real data bought from
The Graph. Nothing is mocked, which is why nothing needed to be faked.

The film carries the argument on its own if it is watched in silence. The
narration below is for when you are presenting it — read it over the top, or
record it as a voice track. Timecodes are taken from `demo/schedule.json`,
which the renderer writes from the film itself, so this script cannot quietly
drift out of sync with what is on screen.

---

## Narration

| at | scene | what to say |
|---|---|---|
| 0:00 | title | Receipt is a drop-in x402 facilitator that adds one thing: the money moves only if the response passes checks the buyer wrote. |
| 0:09 | problem | An agent pays first and looks second. If the API returns two hundred and garbage, the money is gone — x402 has no refund primitive. Arbitration cannot help at forty-six cents a ticket. The shipped alternative appoints an evaluator, and does five senders a day. |
| 0:24 | architecture | Here is the whole thing. The buyer signs terms up front. Receipt is a drop-in facilitator the seller points at instead. Blocky402 still performs the payment, and the escrow holds it and checks the buyer's signature on chain. The seller sells Graph data, and grades itself before answering. The adjudicator is a pure function, and everything lands on a public log anyone can replay. |
| 0:46 | honest | Here is a real purchase. The buyer signs terms saying what shape of token data it will pay for — real contract addresses, integer amounts, a snapshot indexed past a stated block. The payment escrows on Hedera instead of going to the seller. The seller answers, the adjudicator runs, and the funds release. |
| 1:07 | verdict | Seven checks decide where the money goes, and every one is recomputable. Latency is the eighth: measured, published, and gating nothing — we cannot prove our own stopwatch. |
| 1:17 | garbage | Same buyer, same terms. This time the seller returns HTTP two hundred with a useless body. |
| 1:30 | refund | Nothing at the HTTP layer was wrong — status passed. The schema caught it, and the money came back in seconds. No human, no evaluator, no dispute. |
| 1:41 | stale | Harder case. The data is well-formed and correct — it is just an hour old. Every check passes except freshness, and freshness is the one that matters. |
| 1:53 | declined | And because the check is a pure function, the seller can run it too, before answering. Here it grades its own response, sees it would fail, and declines the sale rather than take a payment it could not keep. |
| 2:06 | expired | If the seller simply never answers, no verdict is invented. The escrow expires, and an unrelated wallet — not the buyer — calls claimExpired. The funds can only go back to the payer, so anyone is safe to call it. |
| 2:19 | replay | Now do not trust any of it. This replays every verdict the facilitator ever published, from the public log, with no cooperation from it. Twenty-eight reproduce. Zero mismatch. |
| 2:34 | second impl | And here it is again in a second implementation — Python, no dependencies, its own keccak, written from the spec rather than from our TypeScript. Same verdict, same hash, and it is the hash the escrow recorded on chain. |
| 2:48 | evidence | None of this has to be taken on trust. Here is that release on HashScan — half an HBAR leaving the escrow for the seller. Here is the audit log, in the open. And here is a real session on the live page: one press, a real deal, and every link is a transaction that just happened. |
| 3:12 | conform | Twelve cases, both implementations, identical every time. If the spec were ambiguous, these would disagree. |
| 3:21 | sponsors | And the evidence for each. The Graph is what is being bought. Hedera holds the money and carries the log. Blocky402 performs every payment. Bazantic prices a swap only against holdings that passed. |
| 3:34 | limits | What we cannot prove, we say. Latency is attested and gates nothing. Publishing the raw response is what makes verification real, and it is wrong for a business selling data. |
| 3:45 | close | x402 has no refund primitive. The shipped alternative appoints an evaluator. Receipt has no evaluator, because the verdict is a pure function anyone can recompute. |

Pace is about 2.5 words a second. If you run long, the scenes that tolerate
cutting are **stale** and **conform**; do not cut **replay** or **second
impl**, which are the two that make the claim checkable.

---

## Questions judges ask, and the honest answer

**"Who decides what counts as a good response?"** The buyer, before paying,
in signed terms. Nobody decides afterwards.

**"What if the facilitator lies about the verdict?"** It publishes the terms,
the raw response and the verdict to a public HCS topic, and the escrow records
the verdict hash on chain. `pnpm verify --all` recomputes all of it from the
log. A lie would have to produce a verdict that follows from inputs it also
published, which is the same as not lying.

**"It still custodies the money for a hop."** Yes. Both legs are on the public
log, and `open()` verifies the buyer's EIP-712 signature on chain, so the
facilitator cannot alter the deal it was handed. Removing the hop entirely
needs a scheme change in x402, not a change here.

**"Why not just use an LLM judge?"** Because then you need an evaluator, and
somebody has to pay it and trust it. That design is shipped, and it runs at
five unique senders a day.

---

## Rebuilding the film

Both steps are reproducible and neither records a screen.

```bash
# 1. capture real transcripts (needs the facilitator and seller running)
pnpm facilitator            # :8080
pnpm seller                 # :8787
node demo/capture.mjs       # runs every scene for real, writes demo/demo-data.js

# 2. render
node demo/render.mjs        # writes demo/receipt-demo.mp4 and demo/schedule.json
```

`demo/render.mjs --at 0,62000,163000` renders single moments instead of the
whole film, which is how to check a layout change without paying for a full
render. See `demo/README.md` for how it works.

---

## If you want to run it live instead

The film is the safer artifact — a live run needs testnet liquidity, a
responsive mirror node, and about four minutes of patience for the expiry
scene. If you do run it live:

```bash
pnpm facilitator            # :8080
pnpm seller                 # :8787
pnpm buy honest             # releases
pnpm buy garbage            # refunds
pnpm buy subtle             # refunds on freshness alone
pnpm verify --all           # replays every verdict from the public log
cd verify-py && python3 verify.py --deal <dealId> --topic 0.0.10495465
```

Do one throwaway `pnpm buy honest` before recording so the first-run compile is
not on camera, and have these open:

- escrow — `https://hashscan.io/testnet/contract/0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071`
- audit topic — `https://hashscan.io/testnet/topic/0.0.10495465`
