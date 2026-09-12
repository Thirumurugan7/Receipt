# Deployments

All public identifiers. No secrets here; keys live in `.env`, which is gitignored.

## Hedera testnet (chain id 296)

### ReceiptEscrow

| | |
|---|---|
| EVM address | `0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071` |
| Hedera contract ID | `0.0.10485798` |

| Deploy | `forge script script/Deploy.s.sol:Deploy --rpc-url $HEDERA_RPC_URL --broadcast --legacy` |
| HashScan | https://hashscan.io/testnet/contract/0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071 |
| Source verification | Sourcify **exact match**, mirrored by HashScan as "Full Match" |
| Sourcify record | https://sourcify.dev/server/v2/contract/296/0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071 |

Constructor arguments:

| Argument | Value | Meaning |
|---|---|---|
| `adjudicator_` | `0x66347975c63d6d7d6992740c6adf30858101d4fd` | may call `release` / `refund` |
| `valueScale_` | `1` | `msg.value` units per signed `amount` unit — both tinybars on Hedera |

Read back from the live contract after deploy:

```
adjudicator()    0x66347975C63D6d7d6992740C6aDF30858101D4Fd
owner()          0x66347975C63D6d7d6992740C6aDF30858101D4Fd
valueScale()     1
termsTypeHash()  0x7a5dc37a55680f9e99995f59e0e8ead6cc3307365c89723399d709af91478bff
```

### Measured: `msg.value` on Hedera is in tinybars

DECISIONS-01 Q1.1 assumed Hedera's EVM reports `msg.value` in weibars (1e18/HBAR)
and therefore set `valueScale` to 1e10. That is wrong, and the first live `open()`
reverted with `ValueMismatch(expected 500000000000000000, received 50000000)`.

The JSON-RPC relay accepts a transaction `value` in **weibars** for tooling
compatibility and divides by 1e10 at the boundary, so Solidity sees `msg.value`
in **tinybars**. x402 `amount` is also tinybars, so the two already agree and the
correct `valueScale` is **1**.

Callers still send weibars on the wire — `tinybarsToWeibars` in
`packages/core/src/units.ts` converts for the RPC field, not for the comparison.

This is exactly the silent 1e10 error DECISIONS-01 predicted; it surfaced loudly
only because `open()` compares `msg.value` against the buyer-signed amount.

That last value matches `packages/contracts/test/fixtures/eip712.json` exactly, so the
EIP-712 payload the TypeScript buyer signs is the one the deployed bytecode recovers
against — confirmed against the chain, not only in tests.

## Accounts (Hedera testnet, all ECDSA with EVM aliases)

Roles are kept separate so the demo shows real balance movement between distinct parties.

| Role | Account ID | EVM address |
|---|---|---|
| Facilitator / adjudicator / deployer / HCS operator | `0.0.2672117` | `0x66347975c63d6d7d6992740c6adf30858101d4fd` |
| Buyer agent | `0.0.10484281` | `0xe748c0793ee92098dcbf37c6557ff17836d40cc1` |
| Seller / payee | `0.0.10484410` | `0xf603bec282b1f50e851c6470828b1b12a851bd50` |
| Stranger (calls `claimExpired` in demo scene 4) | `0.0.10484261` | `0x13dd3c134de76eb85dab76bf3d3d4e435dbe5770` |

## x402 settlement

Settlement goes through the Blocky402 facilitator. Values confirmed live from
`GET https://api.testnet.blocky402.com/supported`:

| | |
|---|---|
| Facilitator | `https://api.testnet.blocky402.com` |
| Network | `hedera:testnet` |
| x402 version | 2 |
| Fee payer | `0.0.7162784` |
| Settlement asset | `0.0.0` (native HBAR) |

## HCS

| | |
|---|---|
| Topic ID | `0.0.10495465` |
| HashScan | https://hashscan.io/testnet/topic/0.0.10495465 |
| Mirror Node | https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10495465/messages |

Three messages per deal: `terms`, `observation` (status + headers + the full raw
response body), and `verdict`. The observation is what makes `pnpm verify` real —
see DECISIONS-01 Q2.

Messages above 1024 bytes are split by the SDK and arrive as several Mirror Node
rows sharing one `initial_transaction_id`. `reassembleChunks` in
`packages/core/src/hcs.ts` rejoins them as bytes before decoding; per-row decoding
yields truncated JSON, which would look exactly like a verdict that fails to
reproduce when it is in fact correct.

## First end-to-end paid request

| | |
|---|---|
| Deal | `0x7e39ed323a78c6ae17f418c6e3a633020ef8bc7301ef7515f9dc2f46b94ad9a5` |
| x402 settlement (Blocky402) | `0.0.7162784@1789198380.662216272` |
| `open()` | `0x5b637ebb484cc2af56ed9c98945ac7af034232871927c1cda7d34a9c19fb0b30` |
| `release()` | `0x728a26100789c79db8a5e72986bc7edfe3c57c589428d9dc1a23073df44b0801` |
| Verdict | pass, all seven reproducible checks |
| Buyer delta | -0.5 ℏ, and no network fee — Blocky402's fee payer covered gas |


## All scenes, verified on testnet

`pnpm scenes` runs every path end to end. Nothing is simulated; the dead-seller
scene really waits for a deadline to pass.

| Scene | Seller | Outcome | Buyer delta |
|---|---|---|---|
| 2 | honest | all 7 reproducible checks pass, `release()` pays the seller | −0.5 ℏ |
| 3 | garbage | **HTTP 200** with a useless body; `requiredPaths` fails, `refund()` | 0.0 ℏ |
| 4 | dead | no verdict is invented; a stranger calls `claimExpired` | 0.0 ℏ after claim |
| 5 | — | `pnpm verify` recomputes both verdicts and prints MATCH | — |

Scene 3 is the one naive payment rails cannot catch: the HTTP layer is entirely
healthy, the status check passes, and the body is still worthless.

Scene 4 deliberately does **not** auto-refund. A verdict is a pure function of
(terms, response), and there is no response here — so publishing one would mean
publishing something nobody could reproduce. The facilitator declines, leaves the
deal open, and the deadline does the work. `claimExpired` is callable by anyone
and can only pay the payer, so the money is recoverable even if this facilitator
disappears. Demonstrated from `0x13DD3C134DE76eb85dAb76Bf3d3D4e435Dbe5770`, a
wallet with no relationship to the deal.

### What `pnpm verify` proves, and what it does not

Proven: the `reproducible` checks are recomputed offline from the published
terms and raw response, and the resulting `verdictHash` matches both the
published document and the hash the escrow recorded on chain. Confirmed for a
passing deal (`DealReleased`) and a failing one (`DealRefunded`).

Not proven: `observedLatencyMs`. It is the facilitator's own stopwatch and no
third party can recompute it — which is exactly why it lives in `attested` and
gates nothing. It is reported, never trusted.


## Bazantic — live

| | |
|---|---|
| Gateway | `Receipt` — **LIVE** |
| Slug | `2g6od7kdczdp7p5wr3ywz2vhlu` |
| Payment gateway | https://2g6od7kdczdp7p5wr3ywz2vhlu.bazgateway.com |
| MCP endpoint | https://2g6od7kdczdp7p5wr3ywz2vhlu.bazgateway.com/mcp |
| Tools | `buyWithTerms`, `getDeal`, `health`, `info` |
| Recipe | `buy-data-you-can-refuse-to-pay-for` — **published** |
| Recipe | `price-a-swap-on-data-you-actually-verified` — **published**, two sponsors |
| Model | `openai/gpt-5-nano` |

Pricing: `POST /proxy` $0.01, `GET /deals/{dealId}` free, `GET /health` free.
Auth: none — the x402 payment *is* the authorization.

Verified end to end through the gateway's MCP server:

```
tools/call health ->
  HTTP GET /2g6od7kdczdp7p5wr3ywz2vhlu/health
  Status: 200
  {"status":"ok","adjudicator":"0x66347975…","escrow":"0x3483B376…",
    "topic":"0.0.10495465","network":"hedera:testnet",
    "settlesThrough":"https://api.testnet.blocky402.com"}
```

An MCP client reached the Bazantic gateway, which reached the facilitator, which
answered with the live escrow address and audit topic. The upstream is a tunnel
to a local facilitator, so the gateway is live only while that tunnel is.

### Two-sponsor recipe

`price-a-swap-on-data-you-actually-verified` binds tools from two different
gateways and needs both to produce an answer:

| Gateway | Slug | Tool |
|---|---|---|
| Receipt | `2g6od7kdczdp7p5wr3ywz2vhlu` | `buyWithTerms` |
| 1inch | `gkrbmuh3urcytk6aumsvf2kyxm` | `getClassicSwapRoute` |

Receipt buys a holdings snapshot under acceptance terms and escrows the payment;
1inch prices a Classic Swap route for the largest holding that passed its checks.
If the snapshot fails its terms the payment refunds and the recipe quotes no
route at all — a route built on unverified numbers is worse than no route.

Inputs: `resource` (URI, required), `swap_to` (string, required).
Source of truth for the definition: `recipes/swap-on-verified-data.bazantic.json`.
