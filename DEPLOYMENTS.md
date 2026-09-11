# Deployments

All public identifiers. No secrets here; keys live in `.env`, which is gitignored.

## Hedera testnet (chain id 296)

### ReceiptEscrow

| | |
|---|---|
| EVM address | `0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071` |
| Hedera contract ID | `0.0.10485798` |

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
| Topic ID | _created in phase 3_ |
