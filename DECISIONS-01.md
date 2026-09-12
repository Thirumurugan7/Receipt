# DECISIONS 01 — answers to the Phase 0 questions

Amends BUILD.md. Where this file disagrees with BUILD.md, this file wins.

---

## Q1. Escrow funding path → **Option 1, facilitator relays.** Harden it as below.

You are right that native Hedera transfers and the EVM escrow are two address spaces and
do not compose. Option 2 fails for a reason worth recording: HBAR sent natively to a
contract ID credits the balance but does **not** invoke `receive()`, so the contract
cannot know which deal the money belongs to. You would be reduced to balance polling,
which races. Option 3 costs a wait we do not have.

So: x402 settles natively to the **facilitator's Hedera account**, and the facilitator
immediately funds `open()` on the EVM escrow in the same request handler.

Three changes that make this defensible rather than a hole:

1. **The escrow holds HBAR, not an ERC-20.** Make `open()` payable. Delete `SafeERC20`
   and the `token` parameter's ERC-20 handling. Keep `token` in Terms as the literal
   string `"0.0.0"` to match Blocky402's `asset` field, for forward compatibility when
   HTS tokens appear.

   **Unit gotcha, flag it in a code comment.** Native HBAR is tinybars, 10^8. Hedera's
   EVM `msg.value` is weibars, 10^18. The conversion factor is 10^10. Write one helper
   with tests and use it everywhere. A silent 10^10 error here will cost hours.

2. **Verify the buyer's EIP-712 signature inside `open()`.** Yes, spend the Phase 2 time.
   This is what closes the custody objection: the facilitator holds funds for one hop,
   but it cannot open a deal the buyer did not sign, cannot change the amount, and cannot
   change the terms. Recover the signer from the signature over `termsHash` and require
   it equals `payer`.

3. **Log both legs to HCS**: the Hedera settlement transaction ID and the EVM `open()`
   transaction hash. The custody window becomes publicly measurable.

**Say the limitation out loud.** README section 8 and one line in the video: the
facilitator custodies for one hop between settlement and escrow, that hop is on the
public record, and everything after escrow is trustless. A judge who finds an
undisclosed trust assumption discounts the whole project. A judge who is told about
one before they find it does the opposite.

---

## Q2. Does HCS carry the full response body? → **Yes. This is not optional.**

You are right that the CLI is circular as specified and that this threatens the entire
claim. Publish the raw response body to HCS, not just its hash.

- Chunk deliberately. Cap the demo seller's response at **4KB** so it fits well inside
  the 20-chunk default.
- The facilitator **rejects** any response over the cap with a recorded verdict of
  `bodyTooLarge`, rather than silently truncating. A truncated body would produce a
  verdict nobody can reproduce, which is worse than a failure.
- README states the production path plainly: bodies above the cap go to a
  content-addressed store with the CID on HCS. Do not build that now.

This also gives Phase 6 a real architectural justification rather than a bolt-on. Publishing
the body makes the purchased data public, which is fine for a demo and wrong for a
business. A Chainlink Confidential Workflow sees the body inside the enclave and publishes
only the verdict. If you get there, that is the framing.

---

## Q3. Latency → **split the verdict into reproducible and attested.**

You are right that `observedLatencyMs` is the facilitator's own measurement and cannot be
independently checked. Do not hide it. Restructure the verdict:

```jsonc
{
  "reproducible": [
    { "check": "status",        "pass": true },
    { "check": "contentType",   "pass": true },
    { "check": "minBytes",      "pass": true },
    { "check": "requiredPaths", "pass": false, "detail": "missing $.data" },
    { "check": "jsonSchema",    "pass": false, "detail": "data: required property missing" },
    { "check": "freshness",     "pass": true },
    { "check": "expectedHash",  "pass": true, "skipped": true }
  ],
  "attested": [
    { "check": "maxLatencyMs",  "pass": true, "observed": 412 }
  ],
  "pass": false,
  "firstFailure": "requiredPaths"
}
```

**Only `reproducible` checks gate settlement in the demo.** `attested` is recorded and
displayed but does not move money. The verify CLI recomputes the `reproducible` array
byte-for-byte and ignores `attested`, so `MATCH` means exactly what we claim it means.

This turns the weakness into the sharpest thing in the README: we can tell you precisely
which parts of our verdict you have to trust us for, and it is one number that does not
touch your funds.

---

## Q4. Package namespace → **use the scoped v2 line. My spec was wrong.**

`@x402/core`, `@x402/hedera`, `@x402/hono`, `@x402/fetch` at 2.25.0. Blocky402 advertises
`x402Version: 2` and the unscoped `x402@1.2.0` packages are a different protocol version.
Ignore the stack table in BUILD.md section 6 for these four names. Everything else in
that table stands.

Spend 20 minutes reading the `@x402/hedera` source before Phase 3 to confirm the partial
signing flow. Do not wait on a human reply from Blocky402.

---

## Q5 to Q7. Your stated defaults are correct, take them.

- **deadline**: floor `deadlineMs` to seconds for the contract. Assert the floored value
  is non-zero and in the future, so a units error fails loudly instead of making every
  deal instantly expired.
- **Demo timing**: `deadlineMs` at 60s, proxy fetch timeout at 45s. Scene 4 has to be
  watchable.
- **cre**: install it if it takes under 10 minutes, request access, then forget it.
  Phase 6 is a bonus and nothing waits on it.

---

## Correction to DEMO.md scene 6

My original scene said "show the agent's HBAR balance is zero." That is now wrong, because
HBAR is the settlement asset and the agent must hold some to pay.

The correct beat: **the agent never submits a transaction and never pays a network fee.**
It signs a partial transfer; Blocky402 adds the fee-payer signature and submits. Show the
agent's account has no fee outflow and the fee was paid by `0.0.7162784`. Same point, and
now it is true.

---

## Time

43 hours accepted. The phase budget is about 21 hours of work, and Q1 and Q2 will eat some
of the slack. Protect it by holding the dashboard to its two-hour cap.

Phase 3's checkpoint, one real paid request settled through Blocky402 and visible on
HashScan, is the entire Hedera bounty. If that is not true by hour 20, stop and switch the
escrow to Base Sepolia per BUILD.md section 6. You lose the Hedera prize, not the project.

Start Phase 1 now. It is unblocked by every question above.


---

## Addenda found while building (recorded here so BUILD.md stays as handed over)

**`@hashgraph/sdk` -> `@hiero-ledger/sdk`.** BUILD.md §6 names `@hashgraph/sdk`.
Both packages self-describe as "Hiero SDK"; `@hashgraph/sdk` is the former name.
`@x402/hedera@2.25.0` depends on `@hiero-ledger/sdk`, so we use that throughout
to avoid two copies of the SDK and `instanceof` mismatches on `Transaction`.

**`msg.value` on Hedera is tinybars, not weibars.** Q1.1 of this document assumed
weibars and set `valueScale` to 1e10. Measured on testnet: the relay accepts a
weibar `value` over JSON-RPC and divides by 1e10, so Solidity sees tinybars.
x402 `amount` is tinybars too, so `valueScale` is 1. See DEPLOYMENTS.md.

**Chainlink CRE access is not self-serve.** BUILD.md Phase 0 says to run
`cre account access`. No such grant exists: `cre account` manages linked wallet
addresses, and Confidential Workflows is a private beta gated behind a Chainlink
account team. Phase 6 is therefore an enrollment conversation, not a command.

**HashScan's verifier moved.** `server-verify.hashscan.io` 308-redirects to
upstream Sourcify and Foundry cannot follow it. Use
`--verifier-url https://sourcify.dev/server`.
