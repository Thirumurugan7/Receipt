# Receipt protocol

Version 1. Two documents and one rule about hashing them.

This describes the wire format and the adjudication semantics precisely enough
to write a second implementation. `packages/core` is the reference one, and
`pnpm verify` is a client that trusts nothing in this repository except these
rules.

---

## 1. Canonicalisation

Every hash in this protocol is taken over **JCS** (RFC 8785) output, never over
`JSON.stringify`.

```
hash(doc) = keccak256( utf8Bytes( jcs(doc) ) )
```

This is load-bearing. Two implementations that serialise the same document with
different key order or number formatting would produce different hashes, and
the whole verification story rests on independent parties agreeing byte for
byte. JCS fixes key order, number formatting and string escaping.

Implementations MUST reject a document that is not JCS-serialisable (`undefined`
values, non-finite numbers, cycles) rather than coercing it.

---

## 2. Terms

Authored and signed by the buyer. Transported base64url-encoded in the
`X-Receipt-Terms` request header.

```jsonc
{
  "v": 1,
  "nonce": "0x…",                  // 32 bytes
  "payer": "0x…",                  // 20 bytes
  "payee": "0x…",                  // 20 bytes
  "token": "0.0.0",                // settlement asset; "0.0.0" is native HBAR
  "amount": "50000000",            // smallest unit, as a STRING
  "resource": "https://…",
  "deadlineMs": 1789200000000,     // absolute unix milliseconds
  "checks": { … }                  // see §4
}
```

`amount` is a string because a JSON number cannot carry a uint256 without loss.

`termsHash = hash(terms)`.

### 2.1 Signature

The buyer signs an EIP-712 payload that commits to `termsHash` **and repeats
the economically meaningful fields**, so a facilitator cannot alter them
between signing and escrow:

```
domain: { name: "Receipt", version: "1", chainId, verifyingContract }
Terms(bytes32 termsHash, address payer, address payee,
      uint256 amount, uint64 deadline, bytes32 nonce)
```

`deadline` is `floor(deadlineMs / 1000)`. Implementations MUST reject a
`deadlineMs` that is not a whole number of milliseconds, or that is small
enough to look like unix seconds — a silent 1000× error there makes every deal
expire on open.

---

## 3. Observation

What the facilitator measured. Published verbatim so a verifier can replay it.

```jsonc
{
  "status": 200,
  "headers": { "content-type": "application/json" },  // lowercased keys
  "body": "<raw bytes>",
  "requestTimeMs": 1789200000000,
  "observedLatencyMs": 412
}
```

The adjudicator reads nothing else. It has no network, no filesystem, no clock
and no randomness: `requestTimeMs` and `observedLatencyMs` are inputs, not
things it measures.

---

## 4. Checks

All checks run, in this fixed order, even after the first failure — so the
verdict is complete rather than short-circuited. A check whose key is absent
from `checks` is recorded as `{ pass: true, skipped: true }`.

| # | Check | Passes when |
|---|---|---|
| 1 | `status` | the code is in the `in` array |
| 2 | `contentType` | `content-type`, lowercased with parameters stripped, equals the declared value |
| 3 | `minBytes` | raw body byte length ≥ the value |
| 4 | `requiredPaths` | every JSONPath resolves to a defined, non-null value |
| 5 | `jsonSchema` | body parses as JSON and validates (Ajv, `strict: false`, `allErrors: true`) |
| 6 | `freshness` | `$.timestamp` — unix seconds or ISO-8601 — is within N seconds of `requestTimeMs` |
| 7 | `expectedHash` | `keccak256(body)` equals the declared hash; skipped when `null` |

`maxLatencyMs` is **not** in this list. See §5.

`firstFailure` is the first `false` in the order above, not the order failures
were discovered. Two implementations must agree on which check is to blame.

---

## 5. Verdict

```jsonc
{
  "v": 1,
  "adjudicator": "receipt-adjudicator@0.1.0",
  "termsHash": "0x…",
  "responseHash": "0x…",           // keccak256 of the raw body
  "observedStatus": 200,
  "observedBytes": 1349,
  "reproducible": [ … ],           // §4, decides settlement
  "attested":     [ … ],           // measured by the facilitator, decides nothing
  "pass": false,
  "firstFailure": "freshness"
}
```

`verdictHash = hash(verdict)`.

### 5.1 `detail` strings are part of the hash

A failing check carries a `detail` string, and because `detail` sits inside the
hashed document, **two conforming implementations that phrase it differently
produce different verdict hashes for an identical decision**.

This was found by writing the second implementation, not by reading the first.
`verify-py` initially rendered a failed `pattern` check as
`"/data/0/amount: must match pattern"` while the reference rendered
`"/data/0/amount: must match pattern \"^[0-9]+$\""`. Same decision, different
hash.

Until v2, `detail` for a `jsonSchema` failure MUST follow Ajv's message
vocabulary, joined with `"; "`, each entry formatted as
`` `${instancePath || '/'}: ${message}` ``:

| condition | message |
|---|---|
| missing property | ``must have required property '<name>'`` |
| wrong type | `must be object` / `must be array` / `must be string` / `must be integer` |
| `const` mismatch | `must be equal to constant` |
| `pattern` mismatch | ``must match pattern "<pattern>"`` — the pattern is included |
| `minItems` | `must NOT have fewer than <n> items` |
| `minimum` | `must be >= <n>` |

**This is a wart.** Binding a consensus hash to a human-readable string is the
wrong design; a v2 should either exclude `detail` from the hashed document or
replace it with a structured error code. It is documented rather than hidden
because an implementer will otherwise discover it as an unexplained mismatch.

### 5.2 Why the verdict is split

`reproducible[]` is a pure function of (terms, observation). Anyone holding
those two documents recomputes it exactly. **`pass` is the AND of
`reproducible[]` only**, and `pass` is what moves money.

`attested[]` holds measurements only the facilitator can make — currently just
`maxLatencyMs`, its own stopwatch. No third party can recompute it, so it
gates nothing. It is recorded and displayed and never decides a payment.

An implementation that lets an attested check influence `pass` is not
implementing this protocol.

---

## 6. Audit log

Three messages per deal, published to an ordered public log (here, a Hedera
Consensus Service topic):

| kind | carries |
|---|---|
| `terms` | the full Terms document |
| `observation` | status, headers, and the **full raw body**, base64 |
| `verdict` | the full Verdict, its hash, and the settlement / open / resolve transaction ids |

Publishing only a hash of the body would make verification circular: you cannot
re-run a JSON Schema check against a digest. Bodies above the implementation's
publish cap MUST be rejected with a recorded `bodyTooLarge` verdict rather than
truncated — a truncated body yields a verdict nobody can reproduce, which is
worse than a refusal.

Messages larger than the log's per-message limit are chunked by the transport
and MUST be rejoined **as bytes** before decoding; a chunk boundary can fall
inside a multi-byte UTF-8 sequence.

---

## 7. Settlement

| Call | Who | Effect |
|---|---|---|
| `open` | anyone holding a buyer signature | escrows funds; verifies the EIP-712 signature on-chain and reverts unless the recovered signer is `payer` |
| `release` | adjudicator | pays `payee`, records `verdictHash` |
| `refund` | adjudicator | pays `payer`, records `verdictHash` |
| `claimExpired` | **anyone** | after `deadline`, returns funds to `payer` |

`claimExpired` is the liveness guarantee: it takes no verdict, needs no
permission, and can only pay the payer. A buyer's funds are recoverable even if
the facilitator disappears entirely.

When the seller never responds there is no observation, so a conforming
facilitator publishes **no verdict** and does not resolve. Inventing one would
mean publishing a verdict nobody can reproduce. The deadline is the remedy.

---

## 8. Verification

Given a public log and a deal id, a verifier:

1. reads `terms` and `observation` from the log;
2. recomputes `reproducible[]` from them;
3. compares it byte for byte against the published array;
4. rebuilds the verdict document with its own array, hashes it, and compares
   against both the published `verdictHash` and the hash recorded on-chain.

Agreement proves the verdict follows from the published inputs and that the
hash which moved the money is the hash of that verdict.

A note on vacuous clauses: a check whose bound can never fail is worse than an
absent one, because a reader of the terms believes something is being enforced.
The reference buyer omits its block-height floor entirely when it cannot source
a chain head, and says so, rather than signing a floor of 1.

It does **not** prove the observation itself is honest. That is the boundary of
the claim, and it is why latency is attested rather than reproducible.

### 8.1 Conformance

`verify-py/` is a second implementation of §1–§5, written from this document in
Python with no dependencies — its own Keccak-256, its own canonicaliser, its own
JSON Schema subset. `verify-py/test_cross_implementation.py` runs it against a
fixture generated by the reference implementation and asserts both agree on
every check outcome, on `firstFailure`, on `responseHash`, and on the canonical
bytes of `reproducible[]`.

Both run in CI. A specification nobody has implemented twice is a document, not
a specification.
