# RECEIPT — Build Specification

> Drop this file at the repo root as `BUILD.md`, then paste the kickoff prompt at the bottom into your coding agent.
> Everything the building agent needs is in this file. It has none of the conversation that produced it.

> **AMENDED BY `DECISIONS-01.md`.** Where that file disagrees with this one, that file wins.
> Known amendments: escrow holds HBAR not ERC-20 (§5.1), verdict is split reproducible/attested (§4.2),
> HCS carries the full response body (§5.7), x402 packages are the scoped v2 line (§6), demo scene 6 (§12).

---

## 0. HARD RULES FOR THE BUILDING AGENT

Read these first. They override convenience at every step.

1. **Never invent an API, a package name, a contract address, or a token address.** If you need one, fetch the documentation URL listed in section 11 and read it. If you still cannot find it, stop and ask. A hallucinated USDC address costs more time than asking.
2. **Verify every npm package exists and check its current version before adding it.** Run `npm view <pkg> version` first. The x402 package ecosystem moved fast and names have changed.
3. **Build in the order given in section 9.** Each phase has a checkpoint that must pass before moving on. Do not scaffold everything and debug at the end.
4. **Commit after every passing checkpoint**, with a real message. Judges check git history and single-commit submissions get discounted.
5. **No mock integrations.** If something cannot be made real, say so and leave it out rather than faking it. A working three-piece demo beats a fake five-piece one.
6. **The deadline is hard.** Sunday 13 September 2026, 12:00 EDT. Phase 4 is the last phase that must ship. Phases 5 and 6 are optional.
7. When you finish a phase, print a one-line status and what you are doing next. Do not narrate inside a phase.

---

## 1. WHAT WE ARE BUILDING

**Receipt is a drop-in x402 facilitator that adds conditional settlement.**

Today, when an AI agent pays for an API call over x402, the money moves the instant the request is verified. If the API returns garbage, the agent has paid for garbage. There is no refund primitive in x402 and no dispute process anywhere in the stack.

Receipt sits in the facilitator slot. The buyer attaches machine-checkable acceptance terms to the request. The payment goes into an escrow contract instead of to the seller. The seller responds. A deterministic adjudicator checks the response against the terms. Pass releases the funds. Fail refunds them. Every step is written to a public log so anyone can re-run the check and confirm the verdict.

**The seller changes nothing. The buyer changes one URL and adds one header.**

### Why this specific design

The obvious way to build agent escrow is with an evaluator: a human or an LLM judges whether the delivery was good. That design already shipped. Virtuals Protocol's Agent Commerce Protocol has a Client, Provider and Evaluator role with escrow, it went live on Base, it accumulated over 12 million cumulative commerce memos, and as of 11 September 2026 an independent tracker shows it running at **five unique senders per day**. The evaluator is what broke it: nobody could answer who judges, who pays the judge, and why the verdict should be trusted.

Receipt has **no judge**. Every check is a pure function of (terms, response). Both parties can compute it. The adjudicator that runs it on the hot path cannot lie without being caught, because the terms, the response hash and the verdict are all published, and anyone can re-run the adjudicator offline and compare hashes. That reproducibility is the core intellectual claim of this project and the demo must prove it explicitly.

### What else exists, and why this is still open

- **x402 core has no refund primitive.** The only native attempt is x402r (github.com/BackTrackCo), whose repos have roughly one GitHub star each and whose Solana contracts are self-described as unaudited pilot code.
- **Kleros and UMA work but are economically impossible here.** Both need bonds, liveness windows and gas, against a median x402 ticket of roughly $0.46.
- **Stripe's agentic commerce docs** state that refunds and disputes for agentic checkouts are just the existing card flow, which covers nothing machine to machine.
- **Google AP2 and ERC-8004 both stop at evidence.** AP2 produces a signed audit trail and hands the remedy to whatever rail you are on. ERC-8004's spec says outright that payments are orthogonal and not covered.

Receipt is the remedy layer that all of them punt on, built cheap enough to work at sub-cent ticket sizes.

---

## 2. TARGET BOUNTIES

Build against these. The requirements below are load-bearing, not decoration.

| Sponsor | Track | Value | What it requires |
|---|---|---|---|
| **Hedera** | AI & Agentic Payments | $2,000, up to 3 teams | Host a live x402-gated service on Hedera testnet or mainnet, **settled through the Blocky402 facilitator**. An agent must complete at least one real paid request end to end. Public GitHub repo, demo video 5 minutes or under. |
| **Bazantic** | Best Recipe using sponsor APIs | $500 / $300 / $200 | An x402/MPP Gateway plus a Recipe that chains multiple APIs into one MCP tool. Screen recording required. Needs a bazantic.com account and your username in the submission. |
| **Chainlink** | Best Chainlink-Powered Upgrade (Continuity) | $500 | Integration must contribute to a state change on a blockchain. Displaying data in a frontend is explicitly not sufficient. Our `resolve()` call qualifies. |
| **Chainlink** | Best Confidential Workflow | $1,000, up to 2 teams | A CRE Workflow using a confidential TEE handler. **Access is gated, see section 10.** Optional. |
| **The Graph** | AI tooling with The Graph | up to $2,500 | The Graph must be load-bearing. Optional, section 5.4. |

Realistic reach if the core ships: **$2,500 to $3,500.** With Chainlink confidential: up to $4,500.

---

## 3. ARCHITECTURE

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
   │  3. open() escrow on-chain  ──────────────┐             │
   │  4. forward request to seller, time it    │             │
   │  5. hash response                         │             │
   │  6. run ADJUDICATOR (pure, deterministic) │             │
   │  7. resolve() on-chain  ──────────────────┤             │
   │  8. publish terms+response+verdict to HCS │             │
   │  9. return response + verdict to buyer    │             │
   └───────────────────────────────────────────┼─────────────┘
                     │                         │
                     ▼                         ▼
         ┌────────────────────┐    ┌───────────────────────────┐
         │  SELLER            │    │  ReceiptEscrow.sol        │
         │  x402-gated API    │    │  Hedera testnet EVM (296) │
         │  unmodified        │    │  holds funds until verdict│
         └────────────────────┘    └───────────────────────────┘
                                                │
                                                ▼
                                   ┌───────────────────────────┐
                                   │  Hedera HCS topic         │
                                   │  ordered public audit log │
                                   │  terms / response / verdict│
                                   └───────────────────────────┘
```

### The trust argument, stated precisely

The adjudicator is a piece of software running on our server. A judge will immediately ask why they should trust it. The answer:

1. The **terms** are signed by the buyer and hashed. The hash goes on-chain in `open()`.
2. The **response body hash** is published to HCS.
3. The **verdict document** is published to HCS and its hash goes on-chain in `resolve()`.
4. The adjudicator is a **pure function** with no network access, no randomness, no clock beyond the recorded latency measurement, and a pinned version string in the verdict.

Therefore anyone can pull the HCS topic, feed (terms, response) into the published adjudicator, and get a byte-identical verdict document. If the hashes differ, the facilitator cheated and it is provable. **Ship a CLI command that does exactly this and run it in the demo.**

---

## 4. THE PROTOCOL

### 4.1 Terms document

Buyer-authored, signed with EIP-712, sent base64url-encoded in the `X-Receipt-Terms` request header.

```jsonc
{
  "v": 1,
  "nonce": "0x<32 bytes hex>",
  "payer": "0x<address>",
  "payee": "0x<address>",
  "token": "0x<erc20 address>",
  "amount": "10000",              // smallest unit, string to avoid float loss
  "resource": "https://seller.example/api/quote",
  "deadlineMs": 1757779200000,     // absolute unix ms; after this anyone can refund
  "checks": {
    "status":        { "in": [200] },
    "contentType":   { "equals": "application/json" },
    "minBytes":      32,
    "maxLatencyMs":  5000,
    "requiredPaths": ["$.data", "$.timestamp"],
    "jsonSchema":    { "type": "object", "required": ["data"], "properties": { "data": { "type": "array", "minItems": 1 } } },
    "freshnessSeconds": 120,       // optional; checks $.timestamp against request time
    "expectedHash":  null          // optional; seller precommitment
  }
}
```

**Canonicalisation rule, and it matters:** before hashing, serialise with **JCS (RFC 8785)** so that key order and number formatting cannot change the hash. Use the `canonicalize` npm package. Never hash `JSON.stringify` output directly. `termsHash = keccak256(utf8Bytes(jcs(terms)))`.

### 4.2 Verdict document

Adjudicator-authored, published to HCS, hashed on-chain.

```jsonc
{
  "v": 1,
  "adjudicator": "receipt-adjudicator@0.1.0",
  "termsHash": "0x...",
  "responseHash": "0x...",          // keccak256 of the raw response bytes
  "observedStatus": 200,
  "observedLatencyMs": 412,
  "observedBytes": 1841,
  "results": [
    { "check": "status",        "pass": true  },
    { "check": "contentType",   "pass": true  },
    { "check": "minBytes",      "pass": true  },
    { "check": "maxLatencyMs",  "pass": true  },
    { "check": "requiredPaths", "pass": false, "detail": "missing $.data" },
    { "check": "jsonSchema",    "pass": false, "detail": "data: required property missing" }
  ],
  "pass": false,
  "firstFailure": "requiredPaths"
}
```

`verdictHash = keccak256(utf8Bytes(jcs(verdict)))`.

### 4.3 Check semantics — implement exactly

Checks run in this fixed order and **all of them run** even after the first failure, so the verdict is complete. `pass` is the AND of all results. `firstFailure` is the first false in order.

| Check | Passes when |
|---|---|
| `status` | HTTP status code is in the `in` array |
| `contentType` | `Content-Type` header, lowercased with parameters stripped, equals the declared value |
| `minBytes` | raw response body byte length is >= the value |
| `maxLatencyMs` | measured wall time from request send to last byte received is <= the value |
| `requiredPaths` | every JSONPath resolves to a defined, non-null value |
| `jsonSchema` | body parses as JSON and validates against the schema with **Ajv, `strict: false`, `allErrors: true`** |
| `freshnessSeconds` | `$.timestamp` parsed as unix seconds or ISO-8601 is within N seconds of the recorded request time |
| `expectedHash` | keccak256 of raw body equals the declared hash; skipped when null |

Absent keys in `checks` are skipped and recorded as `{ "check": "x", "pass": true, "skipped": true }`. Determinism rules: no network calls, no `Date.now()` inside the adjudicator (the caller passes in `requestTimeMs` and `observedLatencyMs`), no locale-dependent formatting.

---

## 5. COMPONENTS

### 5.1 `packages/contracts` — ReceiptEscrow.sol

Foundry. Solidity ^0.8.24. Deploy to Hedera testnet EVM.

```solidity
enum Status { None, Open, Released, Refunded }

struct Deal {
    address payer;
    address payee;
    address token;
    uint256 amount;
    bytes32 termsHash;
    uint64  openedAt;
    uint64  deadline;     // unix seconds
    Status  status;
}

mapping(bytes32 => Deal) public deals;   // key: dealId = keccak256(abi.encode(payer, payee, nonce))
address public adjudicator;
address public owner;

event DealOpened  (bytes32 indexed dealId, address indexed payer, address indexed payee, address token, uint256 amount, bytes32 termsHash, uint64 deadline);
event DealReleased(bytes32 indexed dealId, bytes32 verdictHash);
event DealRefunded(bytes32 indexed dealId, bytes32 verdictHash, string reason);
event DealExpired (bytes32 indexed dealId);

function open(bytes32 dealId, address payer, address payee, address token, uint256 amount, bytes32 termsHash, uint64 deadline) external;
function release(bytes32 dealId, bytes32 verdictHash) external onlyAdjudicator;
function refund (bytes32 dealId, bytes32 verdictHash, string calldata reason) external onlyAdjudicator;
function claimExpired(bytes32 dealId) external;   // permissionless after deadline, refunds payer
function setAdjudicator(address a) external onlyOwner;
```

Requirements:
- `open` pulls `amount` of `token` from `msg.sender` via `transferFrom`. Reverts if `deals[dealId].status != None`.
- `release` and `refund` revert unless status is `Open`.
- `claimExpired` is callable by **anyone** once `block.timestamp > deadline` and status is `Open`. This is the liveness guarantee and it must be demonstrated in the video. A dead seller cannot trap funds.
- Use OpenZeppelin `SafeERC20` and `ReentrancyGuard`.
- Emit events on every state change. The dashboard reads these.

Tests in `test/ReceiptEscrow.t.sol` must cover: happy release, refund, double-open revert, non-adjudicator revert, expiry before deadline reverts, expiry after deadline succeeds, reentrancy. **Checkpoint: `forge test` all green.**

### 5.2 `packages/core` — shared library

- `terms.ts` — Terms type, JCS canonicalisation, `hashTerms()`, EIP-712 domain and types, `signTerms()`, `verifyTermsSignature()`.
- `adjudicator.ts` — `adjudicate(terms, observation) => Verdict`. **Pure.** Zero imports that touch network, filesystem or clock.
- `verdict.ts` — Verdict type, `hashVerdict()`.
- `hcs.ts` — thin wrapper over `@hashgraph/sdk` for creating a topic and submitting messages.

The adjudicator must be unit tested against a table of fixtures. **Checkpoint: at least 12 adjudicator unit tests green, including one per check, passing and failing.**

### 5.3 `packages/facilitator` — the Receipt facilitator

Hono server. Endpoints:

- `POST /proxy` — the main path. Accepts the buyer's request plus `X-Receipt-Terms`. Runs the nine-step flow in section 3. Returns the seller's response body with `X-Receipt-Verdict` and `X-Receipt-Deal-Id` response headers.
- `GET /deals/:dealId` — current state, terms, verdict.
- `GET /stream` — Server-Sent Events feed of every state transition, for the dashboard.
- `GET /health`.

**Critical: you must settle through Blocky402.** Read https://hedera.com/blog/hedera-and-the-x402-payment-standard/ and the Blocky402 docs at https://blocky402.com before writing this. Hedera's x402 flow is **not** the standard EVM ERC-3009 flow. The client builds and signs a **partially signed transaction**, the facilitator **adds its own signature to pay the gas** and submits it. That property means an agent holding zero HBAR can transact, which is worth calling out in the video. Adapt the integration to what the docs actually say rather than assuming the Base flow.

### 5.4 `packages/seller` — demo x402-gated API

One Hono server, three modes selected by a query param or route so the demo can switch live:

- `/api/quote?mode=honest` — returns valid JSON matching the schema.
- `/api/quote?mode=garbage` — returns **HTTP 200** with `{"error":"upstream rate limited"}`. This is the important one: a 200 with a useless body is exactly what naive payment rails cannot catch.
- `/api/quote?mode=dead` — never responds. Hangs until the deadline.

Gate it with the x402 middleware (`x402-hono`, verify the package name and version on npm first).

**Make the honest payload real, not fake.** Have the seller fetch live token data from The Graph's Token API. That makes the demo credible, and if you have time it opens The Graph's prize. The Graph also supports x402 payments on the Subgraph Gateway, meaning the seller pays for its own data in USDC with no API key, which is a nice detail for the video. Docs: https://thegraph.com/docs/en/

### 5.5 `packages/buyer` — the agent

A small script or an MCP tool that:
1. builds Terms for the call it wants to make,
2. signs them,
3. calls through the Receipt facilitator,
4. prints the verdict and its resulting balance.

Show the agent's wallet balance before and after in every scene.

### 5.6 `packages/dashboard` — live view

Keep it simple. A single page served by the facilitator, subscribing to `/stream`, rendering a row per deal with a state chip that moves Open → Released or Refunded, the check results, the escrow balance, and links to HashScan and the HCS topic. No framework needed beyond plain React via CDN or a tiny Vite app. **Do not spend more than two hours here.** It exists so the video has something to point at.

### 5.7 `packages/verify` — the reproducibility CLI

```
pnpm verify --topic <hcs-topic-id> --deal <dealId>
```

Pulls the HCS messages, re-runs `adjudicate()` offline, recomputes `verdictHash`, and compares against the hash recorded on-chain. Prints `MATCH` or `MISMATCH`.

**This is the most important twenty seconds of the demo.** It is the answer to "why should I trust your adjudicator." Build it properly.

---

## 6. TECH STACK

```
Node            >= 20
Package manager pnpm workspaces
Language        TypeScript, strict
HTTP            hono
Chain client    viem
Contracts       Foundry, solc ^0.8.24, OpenZeppelin
Hedera SDK      @hashgraph/sdk        (HCS topic + messages)
x402            x402, x402-hono, x402-fetch   ← VERIFY NAMES AND VERSIONS ON NPM
JSON Schema     ajv + ajv-formats
JSONPath        jsonpath-plus
Canonical JSON  canonicalize          (RFC 8785)
Hashing         viem keccak256
Tests           vitest (TS), forge (Solidity)
```

Network constants to confirm, **do not assume**:
- Hedera testnet EVM chain ID: **296**
- JSON-RPC relay: **https://testnet.hashio.io/api**
- Explorer: **https://hashscan.io/testnet**
- Faucet / portal: **https://portal.hedera.com**
- The ERC-20 used for settlement: **get the address from the Blocky402 or Hedera docs. Do not guess a USDC address.**

**Portability requirement:** keep all chain-specific values in `.env` and make the escrow contract plain EVM with no Hedera-specific opcodes. If the Blocky402 integration fights you past hour 20, you can point the same contract at Base Sepolia and still have a working demo. Build the escape hatch in from the start; do not retrofit it at 3am.

---

## 7. REPO LAYOUT

```
receipt/
├── BUILD.md                  ← this file
├── README.md                 ← written in phase 6, see section 12
├── DEMO.md                   ← the video script
├── .env.example
├── package.json              ← pnpm workspace root
├── packages/
│   ├── contracts/
│   │   ├── src/ReceiptEscrow.sol
│   │   ├── test/ReceiptEscrow.t.sol
│   │   ├── script/Deploy.s.sol
│   │   └── foundry.toml
│   ├── core/
│   │   └── src/{terms,verdict,adjudicator,hcs,index}.ts
│   ├── facilitator/
│   │   └── src/{server,flow,escrow,blocky,stream}.ts
│   ├── seller/
│   │   └── src/server.ts
│   ├── buyer/
│   │   └── src/agent.ts
│   ├── dashboard/
│   │   └── public/index.html
│   └── verify/
│       └── src/cli.ts
└── recipes/
    └── receipt.bazantic.json
```

---

## 8. ENVIRONMENT

`.env.example` must list every variable with a comment. No secrets committed, ever.

```
HEDERA_RPC_URL=https://testnet.hashio.io/api
HEDERA_CHAIN_ID=296
HEDERA_OPERATOR_ID=
HEDERA_OPERATOR_KEY=
HCS_TOPIC_ID=

ESCROW_ADDRESS=
SETTLEMENT_TOKEN=            # get from Blocky402 / Hedera docs, do not guess
ADJUDICATOR_PRIVATE_KEY=
DEPLOYER_PRIVATE_KEY=

BLOCKY402_FACILITATOR_URL=   # from blocky402.com
SELLER_URL=http://localhost:8787
FACILITATOR_PORT=8080
SELLER_PORT=8787

BUYER_PRIVATE_KEY=
GRAPH_TOKEN_API_KEY=         # optional, from thegraph.market
```

---

## 9. BUILD ORDER

Do not reorder. Each checkpoint must pass before the next phase starts.

### Phase 0 — hour 0, do this first and in parallel with everything else
- Run `cre account access` to request Chainlink Confidential Workflows access. It is gated and there is a wait. Requesting it now costs two minutes and keeps phase 6 possible. If it is not granted by hour 30, drop phase 6 without regret.
- Create a Hedera testnet account at portal.hedera.com and fund it.
- Create a bazantic.com account.
- `git init`, first commit with this file.

### Phase 1 — core, no network (target: 4 hours)
Terms + Verdict types, JCS canonicalisation, hashing, EIP-712 signing, and the adjudicator with full unit tests.
**Checkpoint:** `pnpm test` green with 12+ adjudicator tests. Adjudicator has zero network, filesystem or clock imports. Commit.

### Phase 2 — contract (target: 3 hours)
ReceiptEscrow.sol, tests, deploy script. Deploy to Hedera testnet.
**Checkpoint:** `forge test` all green. Contract verified on HashScan. Address in `.env`. Commit.

### Phase 3 — the loop, one honest path (target: 6 hours)
Seller in honest mode. Facilitator wired to Blocky402 for payment, to the escrow for open/release, to HCS for logging. Buyer agent makes one real paid call that succeeds and releases funds.
**Checkpoint:** one real end-to-end paid request on Hedera testnet, visible on HashScan, funds released to the seller. **This single checkpoint satisfies the Hedera prize requirement. Do not proceed until it is true.** Commit.

### Phase 4 — the failure paths (target: 4 hours)
Garbage mode and dead mode. Refund path. `claimExpired`. The verify CLI.
**Checkpoint:** all three scenes run from a single command. `pnpm verify` prints MATCH. Commit. **This is the last mandatory phase.**

### Phase 5 — surface (target: 4 hours)
Dashboard with SSE. Bazantic Gateway and Recipe. README and DEMO.md. Record the video.
**Checkpoint:** video recorded, under 5 minutes, repo public. Submit. Commit.

### Phase 6 — optional stretch, only if phases 1 to 5 are done and access came through
Move the check evaluation into a Chainlink CRE Confidential Workflow so the buyer's acceptance criteria stay secret from the seller. This is a genuinely better product because a seller who can read the schema can satisfy it minimally. Register a TEE handler with `cre.HandlerInTee`, evaluate inside the enclave, cross back to the DON for consensus, then call `resolve()`. Language is Go per the current docs.

**If you are at hour 36 and phase 5 is not done, stop building and record the video.** An unrecorded project scores zero.

---

## 10. RISK REGISTER

| Risk | Mitigation |
|---|---|
| Blocky402 integration differs from expectation | Read the docs before writing code. Budget 3 extra hours. Escape hatch: plain EVM escrow works on Base Sepolia. |
| Chainlink CRE access not granted in time | Requested at hour 0. Drop phase 6 silently if not granted. Never on the critical path. |
| Hedera testnet instability | Deploy early in phase 2, not late. Keep the Base Sepolia fallback config ready. |
| Settlement token address wrong | Get it from official docs. Verify a transfer works before building on it. |
| Scope creep into the dashboard | Two hour hard cap. It is a prop. |
| Running out of time | Phases 1 to 4 are the project. 5 is the submission. 6 is a bonus. |

---

## 11. REFERENCES — fetch these, do not work from memory

**x402 and payments**
- x402 docs: https://docs.x402.org/
- x402 repo and schemes: https://github.com/coinbase/x402 and `/specs/schemes/exact`
- Hedera x402 explainer, **read this before phase 3**: https://hedera.com/blog/hedera-and-the-x402-payment-standard/
- Blocky402 facilitator: https://blocky402.com

**Hedera**
- Docs: https://docs.hedera.com
- HCS: https://hedera.com/service/consensus-service/
- Agent Kit: https://github.com/hashgraph/hedera-agent-kit-js
- Portal and faucet: https://portal.hedera.com
- Explorer: https://hashscan.io/testnet

**Bazantic**
- Site and docs: https://bazantic.com and https://bazantic.com/docs
- Provider onboarding: https://bazantic.com/become-a-provider

**Chainlink (phase 6 only)**
- CRE: https://docs.chain.link/cre
- Key terms, has the TEE handler names: https://docs.chain.link/cre/key-terms
- Confidential workflows: https://docs.chain.link/cre/guides/workflow/using-confidential-workflows/making-workflow-confidential

**The Graph (optional seller data)**
- Docs: https://thegraph.com/docs/en/
- API keys: https://thegraph.market

**Standards**
- RFC 8785 JSON Canonicalization Scheme: https://www.rfc-editor.org/rfc/rfc8785
- EIP-712: https://eips.ethereum.org/EIPS/eip-712
- EIP-3009: https://eips.ethereum.org/EIPS/eip-3009

**Prior art worth reading so the README positions correctly**
- x402r, the only other refund attempt: https://github.com/BackTrackCo
- ERC-8004, note it says payments are out of scope: https://eips.ethereum.org/EIPS/eip-8004
- Google AP2, evidence without remedy: https://ap2-protocol.org/

---

## 12. THE DEMO — write `DEMO.md` and follow it

Under 5 minutes. Judges are watching a recording, not standing at your table. Show, do not explain.

**Scene 1 — the problem (25s).** Terminal. An agent pays an API over plain x402. The API returns HTTP 200 with `{"error":"upstream rate limited"}`. Show the agent's balance drop. One line of narration: it paid for nothing and there is no way to get it back.

**Scene 2 — honest path (45s).** Same agent, now routed through Receipt. Show the Terms it signed. Payment goes into escrow, seller returns good data, all checks pass, funds release. Dashboard shows the row turning green. HashScan tab open.

**Scene 3 — garbage path, the money shot (50s).** Switch the seller to garbage mode. Same 200 status. Schema check fails. **Funds return to the buyer automatically in seconds.** Show the balance restored. No human touched it.

**Scene 4 — dead seller (30s).** Seller hangs. Deadline passes. Call `claimExpired` **from a different wallet** to prove it is permissionless. Refund lands.

**Scene 5 — reproducibility (40s).** Run `pnpm verify --topic ... --deal ...`. It pulls the public HCS log, re-runs the adjudicator offline, prints MATCH. Say the line: do not trust my adjudicator, run it yourself.

**Scene 6 — the zero-balance detail (20s).** Show the agent's HBAR balance is zero. It has been paying all along, because Blocky402 signs for gas and submits.

**Closing (20s).** One slide: x402 has no refund primitive. The only shipped alternative uses an evaluator and is running at five senders a day. Receipt has no evaluator, because the verdict is a pure function anyone can recompute.

Record at 1080p minimum. Terminal font large enough to read on a laptop. No background music.

---

## 13. README REQUIREMENTS

The README is judged. It must contain, in this order:

1. One sentence on what Receipt is.
2. The problem, with the specific numbers: x402 has no refund primitive; median ticket around $0.46; Kleros and UMA cost dollars and days per dispute; Virtuals ACP shipped the evaluator design and is at five unique senders a day.
3. Architecture diagram (reuse the ASCII one in section 3).
4. **How the adjudicator is trustless**, with the verify command spelled out. This is the section that wins the prize.
5. Deployed addresses, HCS topic ID, HashScan links.
6. Which sponsor technology does what, and why it is load-bearing rather than decorative.
7. Run it yourself: clone, install, env, three commands for the three scenes.
8. What is not done, honestly stated. Judges trust a stated limitation more than a silent one.

---

## KICKOFF PROMPT

```
Read BUILD.md at the repo root in full before writing any code. It is the complete
specification for a project called Receipt, due Sunday 13 September 2026 at 12:00 EDT.

Follow the hard rules in section 0. In particular: never invent a package name,
contract address or API shape. Fetch the documentation URLs in section 11 and read
them when you need a detail. Ask me rather than guessing.

Start with Phase 0 in section 9, then Phase 1. Stop at each checkpoint, tell me it
passed, and commit before continuing. Do not scaffold later phases early.

Before you begin, tell me: your read of the riskiest part of this build, and any
place where the spec is underspecified enough that you would otherwise guess.
```
