# DEMO.md — the recording script

Under 5 minutes. Judges are watching a recording, not standing at your table.
**Show, do not explain.** Every number on screen is real and comes from Hedera
testnet; nothing here is mocked, so nothing needs to be faked.

Record at 1080p minimum. Terminal font large enough to read on a laptop. No
background music.

---

## Before you hit record

```bash
# 1. services, in this order — the seller syncs supported kinds from Receipt
pnpm facilitator      # :8080
pnpm seller           # :8787

# 2. confirm the buyer has enough testnet HBAR for four scenes (~2 ℏ)
curl -s https://testnet.mirrornode.hedera.com/api/v1/accounts/$BUYER_HEDERA_ACCOUNT_ID \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['balance']['balance']/1e8, 'HBAR')"

# 3. do one throwaway `pnpm buy honest` so the first-run compile is not on camera
```

Have these tabs open and already loaded:

- HashScan contract: `https://hashscan.io/testnet/contract/0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071`
- HashScan HCS topic: `https://hashscan.io/testnet/topic/0.0.10495465`

Terminal layout: one wide terminal is enough. Resist a four-pane grid; it reads
as clutter at 1080p.

---

## Scene 1 — the problem (25s)

**Show:** the seller in garbage mode, called directly, with no Receipt.

```bash
curl -s "http://localhost:8787/api/quote?mode=garbage" -H "PAYMENT-SIGNATURE: $PAID"
```

```json
{"error":"upstream rate limited"}
```

**Say, once:** "HTTP 200. The payment already settled. The agent paid for
this, and there is no refund primitive in x402 — no dispute step anywhere in
the stack."

**Do not** linger. This scene exists to make scene 3 land.

---

## Scene 2 — the honest path (45s)

```bash
pnpm buy honest
```

**Point at, in this order:**

1. The **terms** block at the top — `checks: status, contentType, minBytes, maxLatencyMs, requiredPaths, jsonSchema, freshnessSeconds`.
   Say: "The buyer states, up front and in machine terms, what it is paying for. Then signs it."
2. `402 payment required -> payTo 0.0.2672117 (the facilitator, not the seller)`.
   Say: "That one field is the whole product. The money goes to escrow, not the seller."
3. `verdict pass`, then the three transaction ids: settlement, `open()`, `release()`.
4. `buyer delta -0.50000000 ℏ`.

Cut to the HashScan tab and show the contract's recent transactions.

---

## Scene 3 — garbage: the money shot (50s)

This is the scene that wins or loses the submission. Give it room.

```bash
pnpm buy garbage
```

**Point at, in this order:**

1. The body: `{"error":"upstream rate limited"}`
2. **`firstFailure requiredPaths`** — and say the important sentence:
   **"Status two hundred. The status check passed. Nothing at the HTTP layer is
   wrong. The schema check is what caught it."**
3. `buyer delta 0.00000000 ℏ`

**Say:** "The money came back in seconds. No human touched it, no evaluator was
asked, nobody filed a dispute."

**Then the line that separates this from metered refunds:** "The call completed.
Status two hundred. A meter would bill this as consumed and it would be right —
the bytes arrived. Metering refunds what you didn't use. This refunds what you
did use and couldn't."

Let the `0.00000000` sit on screen for a beat before cutting.

---

## Scene 3b — subtle: the one a reviewer would approve (25s)

```bash
pnpm buy subtle
```

Real holdings from The Graph. Correct shape. Every field valid. The snapshot is
two hours old.

**Point at the check list:** `status`, `contentType`, `minBytes`,
`requiredPaths`, `jsonSchema` — **all pass**. Then `freshness` alone fails.

**Say:** "Nothing here looks wrong. A human reviewing this response would
approve it, and a meter has no opinion about it at all — the bytes arrived. The
only thing that catches it is the buyer having said, up front, how fresh the
data had to be."

This is the strongest scene in the demo. Do not rush it.

---

## Scene 4 — dead seller (30s)

```bash
pnpm buy dead          # ~45s; cut the wait in the edit
```

Show `HTTP 504 — seller did not respond`, `escrow still Open; no verdict was published`.

**Say:** "The seller never answered. A verdict is a pure function of terms and
response — with no response, there is nothing to judge, so we publish nothing
rather than invent a verdict nobody could reproduce."

Then, and this is the point:

```bash
pnpm claim --deal 0x…
```

**Point at `caller (stranger) 0x13DD3C13…`** and say: "That wallet is not the
buyer, not the seller, not the facilitator. `claimExpired` is permissionless
and can only pay the payer. If we disappeared, the money still comes back."

Show `payer delta 0.50000000 ℏ`.

---

## Scene 5 — reproducibility (40s)

**The most important twenty seconds in the video.**

```bash
pnpm verify --deal 0x…       # use the garbage deal: a refund is the harder case
```

Point at the three hashes lining up:

```
recomputed verdictHash    0x055b2c13…
published  verdictHash    0x055b2c13…
on-chain   verdictHash    0x055b2c13…   (DealRefunded)

MATCH
```

**Say the line:** "Do not trust my adjudicator. This just pulled the terms and
the raw response off a public Hedera topic, re-ran the same pure function
offline, and got the same hash the escrow recorded. No API key. No cooperation
from me. If I had lied, this number would differ — and that number is what
moved the money."

Then be honest, briefly: "One field we cannot prove is latency — it is our own
stopwatch. So it gates nothing. It is recorded and it decides nothing."

That sentence buys more credibility than it costs.

---

## Scene 6 — the zero-fee detail (20s)

Show the buyer's balance line from any scene:

```
buyer delta  -0.50000000 ℏ
```

**Say:** "Exactly the transfer amount. The agent never submitted a transaction
and never paid a network fee — it signs a partial transfer and Blocky402 adds
the fee-payer signature and submits. An agent holding no HBAR for gas can still
transact."

Optionally show the fee payer `0.0.7162784` on HashScan.

---

## Closing (20s)

One slide, three lines:

> **x402 has no refund primitive.**
>
> **The only shipped alternative uses an evaluator, and runs at five unique senders a day.**
>
> **Receipt has no evaluator, because the verdict is a pure function anyone can recompute.**

Then the repo URL. Stop.

---

## Things to avoid

- Do not read the architecture diagram aloud. Judges can read.
- Do not explain JCS, EIP-712 or weibars. They are in the README.
- Do not apologise for testnet.
- Do not show a wall of passing tests; one `MATCH` is worth more.
- Do not exceed 5 minutes. A 4:10 video that lands beats a 5:30 that gets cut off.

## If something breaks on camera

Re-record. Do not narrate over a failure hoping it passes — a judge who sees a
retry loses the thread. `pnpm scenes` runs everything unattended if you would
rather capture one clean pass and cut it into scenes afterwards.
