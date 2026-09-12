# Receipt

**Receipt is a drop-in x402 facilitator that adds conditional settlement: the buyer attaches machine-checkable acceptance terms to a paid API call, the money waits in escrow, and it moves to the seller only if the response actually satisfies those terms.**

Live on Hedera testnet. Settlement runs through the Blocky402 x402 facilitator, every verdict is published to a public Hedera Consensus Service topic, and anyone can re-run the adjudicator offline and check the result against the hash recorded on chain.

---

## The problem

When an AI agent pays for an API call over x402, the money moves the moment the payment is verified. If the API returns garbage, the agent has paid for garbage.

- **x402 has no refund primitive.** There is no dispute step anywhere in the stack. The only native attempt, x402r, has roughly one GitHub star per repo and self-describes its Solana contracts as unaudited pilot code.
- **The median x402 ticket is around $0.46.** Kleros and UMA both work, and both need bonds, liveness windows and gas measured in dollars and days. They are economically impossible at this size.
- **Stripe's agentic commerce docs** route refunds and disputes back through the existing card flow, which covers nothing machine to machine.
- **Google AP2 and ERC-8004 stop at evidence.** AP2 produces a signed audit trail and hands the remedy to whatever rail you are on. ERC-8004's spec says outright that payments are orthogonal and out of scope.

The obvious fix is an evaluator: a human or an LLM judges whether the delivery was good. **That design already shipped.** Virtuals Protocol's Agent Commerce Protocol has Client, Provider and Evaluator roles with escrow, went live on Base, and accumulated over 12 million cumulative commerce memos. As of 11 September 2026 an independent tracker shows it running at **five unique senders per day**. The evaluator is what broke it: nobody could answer who judges, who pays the judge, and why the verdict should be trusted.

**Receipt has no judge.** Every check is a pure function of (terms, response). Both parties can compute it. So can you.

---

## Architecture

```
                    ┌──────────────────────────────┐
                    │  BUYER AGENT                 │
                    │  signs Terms (EIP-712)       │
                    │  calls seller via Receipt    │
                    └───────────┬──────────────────┘
                                │ HTTP + X-Receipt-Terms header
                                ▼
   ┌────────────────────────────────────────────────────────┐
   │  RECEIPT FACILITATOR                                    │
   │                                                         │
   │  1. parse + verify Terms signature                      │
   │  2. verify x402 payment payload                         │
   │  3. settle via Blocky402  ────────────────┐             │
   │  4. open() escrow on-chain                │             │
   │  5. forward request to seller, time it    │             │
   │  6. hash response                         │             │
   │  7. run ADJUDICATOR (pure, deterministic) │             │
   │  8. release() / refund() on-chain  ───────┤             │
   │  9. publish terms+response+verdict to HCS │             │
   └───────────────────────────────────────────┼─────────────┘
                     │                         │
                     ▼                         ▼
         ┌────────────────────┐    ┌───────────────────────────┐
         │  SELLER            │    │  ReceiptEscrow.sol        │
         │  x402-gated API    │    │  Hedera testnet EVM (296) │
         │  stock @x402/hono  │    │  holds funds until verdict│
         └────────────────────┘    └───────────────────────────┘
                                                │
                                                ▼
                                   ┌───────────────────────────┐
                                   │  Hedera HCS topic         │
                                   │  ordered public audit log │
                                   │  terms / response / verdict│
                                   └───────────────────────────┘
```

**The seller changes two lines of config: its facilitator URL and its `payTo`. The buyer changes one URL and adds one header.**

---

## Why you do not have to trust our adjudicator

This is the part that matters, so here is the precise claim.

The adjudicator is software on our server. You should not take its word for anything. You do not have to:

1. The **terms** are signed by the buyer with EIP-712 and hashed with JCS (RFC 8785), so key order and number formatting cannot change the hash. `termsHash` goes on chain in `open()`.
2. The **full raw response** — status, content-type and body — is published to the HCS topic. Not a digest. A digest would make verification circular: you cannot re-run a JSON-schema check against a hash.
3. The **verdict document** is published to HCS and its hash goes on chain in `release()` / `refund()`.
4. The adjudicator is a **pure function**: no network, no filesystem, no clock, no randomness. Asserted mechanically in `packages/core/test/purity.test.ts`, not left to code review.

So pull the topic, feed (terms, response) into the published adjudicator, and compare. That is one command:

```bash
pnpm verify --deal 0x055b...   # --topic and --escrow default from .env
```

```
re-running the adjudicator offline
  checks recomputed         7
  reproducible[] identical  YES

hashes
  recomputed verdictHash    0x055b2c13de5aaf1af1e22c3bd602d242d82a6769b1baaac4297b8c2839b9ade7
  published verdictHash     0x055b2c13de5aaf1af1e22c3bd602d242d82a6769b1baaac4297b8c2839b9ade7
  on-chain verdictHash      0x055b2c13de5aaf1af1e22c3bd602d242d82a6769b1baaac4297b8c2839b9ade7  (DealRefunded)

MATCH
  the verdict follows from the published terms and response, and its hash is the one the escrow recorded.
```

It needs no credentials, no API key, and no cooperation from us. If we had lied about a verdict, the recomputed hash would differ from the one the escrow recorded — and that hash is what moved the money.

### The part we cannot prove, stated plainly

`observedLatencyMs` is our own stopwatch. No third party can recompute it. So it does not gate settlement: the verdict splits into `reproducible[]`, which decides where the money goes, and `attested[]`, which is recorded and displayed and decides nothing. `pnpm verify` recomputes the first and ignores the second.

We can tell you exactly which part of our verdict you have to take on faith, and it is one number that cannot touch your funds.

---

## Deployed

| | |
|---|---|
| `ReceiptEscrow` | [`0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071`](https://hashscan.io/testnet/contract/0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071) |
| Hedera contract ID | `0.0.10485798` |
| Source verification | Sourcify **exact match**, HashScan shows "Full Match" |
| HCS audit topic | [`0.0.10495465`](https://hashscan.io/testnet/topic/0.0.10495465) |
| Network | Hedera testnet, EVM chain id `296` |
| x402 facilitator | `https://api.testnet.blocky402.com`, network `hedera:testnet`, x402 v2 |
| Settlement asset | `0.0.0` (native HBAR) |

Full detail, including the four testnet accounts and their roles, is in [DEPLOYMENTS.md](DEPLOYMENTS.md).

---

## What each sponsor technology actually does

Load-bearing, not decorative. Remove any one of these and the project stops working.

**Hedera** is the settlement and audit layer, not a logo.
- `ReceiptEscrow.sol` runs on the Hedera EVM and custodies real HBAR between payment and verdict.
- **HCS is what makes the trust argument possible.** The ordered public topic is where terms, the raw response and the verdict are published; without it, "re-run it yourself" is a slogan rather than a command. HCS is used as an append-only consensus log, which is exactly what an audit trail needs and what a database cannot give a stranger.

**Blocky402** performs every real payment.
- Hedera's x402 flow is not the EVM ERC-3009 flow. The buyer builds a **partially signed** `TransferTransaction`; Blocky402 adds the fee-payer signature and submits it.
- Consequence worth seeing: in every scene the buyer's balance moves by **exactly** the transfer amount and pays no network fee. Gas came from Blocky402's fee payer `0.0.7162784`. An agent with no HBAR for gas can still transact.

**Chainlink** — see "What is not done" below. Not claimed.

**The Graph** — see "What is not done" below. Not claimed.

---

## Run it yourself

Requires Node >= 20, pnpm, and Foundry.

```bash
git clone --recurse-submodules https://github.com/Thirumurugan7/Receipt.git
cd Receipt
pnpm install

cp .env.example .env      # then fill in the Hedera keys; every value is commented
```

You need four Hedera testnet ECDSA accounts (buyer, seller, facilitator, and one
unrelated wallet for the expiry scene) from [portal.hedera.com](https://portal.hedera.com).
ECDSA specifically — only ECDSA accounts get an EVM alias.

Deploy the escrow and create the audit topic:

```bash
cd packages/contracts && forge test && forge script script/Deploy.s.sol:Deploy \
  --rpc-url $HEDERA_RPC_URL --broadcast --legacy
cd ../.. && pnpm --filter @receipt/facilitator create-topic
# put ESCROW_ADDRESS and HCS_TOPIC_ID into .env
```

Then, in three terminals:

```bash
pnpm facilitator     # :8080  — start this first, the seller syncs from it
pnpm seller          # :8787
pnpm scenes          # runs every scene end to end against testnet
```

The live ledger is at **http://localhost:8080** — deals appear as they settle,
each stamped held, paid or returned, with every check result and links to
HashScan.

`pnpm scenes` is the whole demo in one command:

| Scene | Seller mode | Outcome | Buyer delta |
|---|---|---|---|
| 2 | `honest` | all 7 reproducible checks pass, `release()` pays the seller | −0.5 ℏ |
| 3 | `garbage` | **HTTP 200** with a useless body, `requiredPaths` fails, `refund()` | 0.0 ℏ |
| 4 | `dead` | no verdict invented; a stranger calls `claimExpired` | 0.0 ℏ after claim |
| 5 | — | `pnpm verify` recomputes both verdicts and prints MATCH | — |

Individually:

```bash
pnpm buy honest                     # or: garbage, dead
pnpm claim  --deal 0x…              # permissionless expiry, from an unrelated wallet
pnpm verify --deal 0x…              # re-run the adjudicator offline
```

### Tests

```bash
pnpm test                                   # 77 unit tests
pnpm typecheck                              # strict TypeScript, no emit
cd packages/contracts && forge test         # 22 contract tests
```

The contract suite covers release, refund, double-open, non-adjudicator callers,
expiry before and after the deadline, an inflated amount, a redirected payee, and
a reentrant payee that re-enters `claimExpired` during its own payout.

`packages/contracts/test/fixtures/eip712.json` pins the EIP-712 payload across
both languages: the Solidity suite and the TypeScript suite assert the same
committed digest, so a field reordered on either side fails loudly instead of
surfacing as an unexplained `BadSignature` during a live paid request.

---

## What is not done, honestly

**The facilitator custodies for one hop.** x402 on Hedera settles a native transfer to an account; the escrow is an EVM contract. Those are two address spaces and they do not compose, so the payment lands in the facilitator's account and the facilitator funds `open()` in the same request handler. Both legs — the Hedera settlement transaction id and the EVM `open()` hash — are published to HCS, so the window is publicly measurable. The mitigation is that `open()` verifies the buyer's EIP-712 signature on chain: the facilitator cannot open a deal the buyer did not sign, and cannot alter the amount, payee, deadline or terms on the way through. Tests `test_open_revertsWhenFacilitatorInflatesTheAmount` and `..._redirectsThePayee` cover exactly that. Everything after `open()` is trustless.

**Response bodies are public.** The topic carries the raw body, which is what makes verification real and is also wrong for a business selling data. The right answer is to evaluate inside a TEE and publish only the verdict — which is what the Chainlink Confidential Workflows track is for. That is not built.

**Bodies are capped at 4 KB.** Above the cap the facilitator records `bodyTooLarge` and refuses rather than truncating: a truncated body produces a verdict nobody can reproduce, which is worse than a failure. Production would put the body in a content-addressed store and publish the CID.

**A hung seller is not auto-refunded.** With no response there is nothing to judge, so the facilitator publishes no verdict rather than inventing one nobody could reproduce. The deadline is the remedy and `claimExpired` is permissionless. This is a deliberate choice, not an omission — but it does mean the buyer waits for the deadline instead of being refunded immediately.

**No Chainlink integration.** Confidential Workflows is a private beta gated behind a Chainlink account team, not a self-serve grant, so it was never on the critical path.

**No Graph integration.** The seller returns real live data, but from the Hedera Mirror Node rather than The Graph's Token API. It is real data, not a fixture — just not that sponsor's data.

**The dashboard is a prop.** It is a single static file served by the facilitator at `/`, with no build step and no third-party scripts. It reads deployment identifiers from `/health` and deal state from `/stream`, so it needs no configuration — but it is read-only, keeps state in memory, and is not something to point at production.

**Testnet only.** Nothing here has been audited, and `ReceiptEscrow` holds real funds only in the sense that testnet HBAR is real.
