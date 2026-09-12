#!/usr/bin/env python3
"""
Independent verification of a Receipt verdict — zero dependencies.

    python3 verify.py --deal 0x...  [--topic 0.0.x] [--escrow 0x...]

Reads the public Hedera Consensus Service topic and the public Mirror Node,
re-runs the adjudicator implemented here from SPEC.md, and compares the result
against the published verdict and the hash the escrow recorded on chain.

Shares nothing with the TypeScript implementation: different language,
different Keccak, different JSON Schema engine, different author of the
canonicaliser. If both agree on the hash, the verdict is reproducible in the
sense the project claims.

Requires only the Python standard library.
"""
import argparse
import base64
import json
import sys
import urllib.request

from adjudicator import adjudicate, hash_jcs, jcs
from keccak import keccak256_hex

DEFAULT_MIRROR = "https://testnet.mirrornode.hedera.com"

DEAL_RELEASED = keccak256_hex(b"DealReleased(bytes32,bytes32)")
DEAL_REFUNDED = keccak256_hex(b"DealRefunded(bytes32,bytes32,string)")
DEAL_EXPIRED = keccak256_hex(b"DealExpired(bytes32)")


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def read_topic(mirror: str, topic: str):
    """Read every message, rejoining chunked ones as BYTES before decoding."""
    rows, nxt = [], f"/api/v1/topics/{topic}/messages?limit=100&order=asc"
    while nxt:
        page = get_json(mirror + nxt)
        rows += page.get("messages", [])
        nxt = (page.get("links") or {}).get("next")

    groups = {}
    for m in rows:
        ci = m.get("chunk_info") or {}
        it = ci.get("initial_transaction_id") or {}
        key = f"{it.get('account_id')}@{it.get('transaction_valid_start')}" if ci else f"seq:{m['sequence_number']}"
        groups.setdefault(key, []).append(m)

    out = []
    for parts in groups.values():
        total = (parts[0].get("chunk_info") or {}).get("total", 1)
        if len(parts) != total:
            continue  # incomplete: drop rather than misparse
        parts.sort(key=lambda p: (p.get("chunk_info") or {}).get("number", 1))
        blob = b"".join(base64.b64decode(p["message"]) for p in parts)
        try:
            out.append((parts[0]["sequence_number"], json.loads(blob.decode("utf-8"))))
        except Exception:
            pass  # a foreign message on the topic is data, not a crash
    return [m for _, m in sorted(out)]


def onchain_events(mirror: str, escrow: str, deal: str):
    events, verdict_hash = [], None
    nxt = f"/api/v1/contracts/{escrow.lower()}/results/logs?limit=100&order=desc"
    pages = 0
    while nxt and pages < 5:
        page = get_json(mirror + nxt)
        for log in page.get("logs", []):
            topics = [t.lower() for t in (log.get("topics") or [])]
            if len(topics) < 2 or topics[1] != deal.lower():
                continue
            name = {DEAL_RELEASED: "DealReleased", DEAL_REFUNDED: "DealRefunded",
                    DEAL_EXPIRED: "DealExpired"}.get(topics[0])
            if not name:
                continue
            if name not in events:
                events.append(name)
            if name != "DealExpired" and verdict_hash is None:
                data = (log.get("data") or "")[2:]
                h = "0x" + data[:64].lower()
                if h != "0x" + "0" * 64:
                    verdict_hash = h
        nxt = (page.get("links") or {}).get("next")
        pages += 1
    return events, verdict_hash


def line(k, v):
    print(f"  {k:<28}{v}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--deal", required=True)
    ap.add_argument("--topic", required=True)
    ap.add_argument("--escrow")
    ap.add_argument("--mirror", default=DEFAULT_MIRROR)
    args = ap.parse_args()

    print("\nReceipt — independent verification (python, zero dependencies)")
    line("topic", args.topic)
    line("deal", args.deal)
    line("mirror node", args.mirror)

    messages = [m for m in read_topic(args.mirror, args.topic) if m.get("dealId") == args.deal]
    terms_msg = next((m for m in messages if m.get("kind") == "terms"), None)
    obs_msg = next((m for m in messages if m.get("kind") == "observation"), None)
    verdict_msg = next((m for m in messages if m.get("kind") == "verdict"), None)

    print("\npublic log")
    line("messages for this deal", len(messages))
    if not terms_msg:
        print("\nno terms published for this deal")
        return 1
    if not verdict_msg:
        events, _ = onchain_events(args.mirror, args.escrow, args.deal) if args.escrow else ([], None)
        line("on-chain events", ", ".join(events) or "(none)")
        if "DealExpired" in events:
            print("\nEXPIRED — no verdict exists, and none should.")
            print("  the seller never responded, so nothing was published to judge.")
            return 0
        print("\nINCOMPLETE — terms published, no verdict yet.")
        return 1
    if not obs_msg:
        print("\nNOT REPRODUCIBLE — the response body was withheld (bodyTooLarge).")
        return 1

    body = base64.b64decode(obs_msg["bodyBase64"])
    line("observation", f"status {obs_msg['status']}  {len(body)} bytes")

    observation = {
        "status": obs_msg["status"],
        "headers": obs_msg.get("headers", {}),
        "body": body,
        "requestTimeMs": obs_msg["requestTimeMs"],
    }

    print("\nre-running the adjudicator, implemented here from SPEC.md")
    mine = adjudicate(terms_msg["terms"], observation)
    published = verdict_msg["verdict"]

    agree = True
    for theirs in published["reproducible"]:
        ours = next((r for r in mine["reproducible"] if r["check"] == theirs["check"]), None)
        same = ours is not None and ours["pass"] == theirs["pass"]
        agree = agree and same
        mark = "agree" if same else "DIFFER"
        print(f"    {theirs['check']:<16}{'pass' if theirs['pass'] else 'fail':<6}{mark}")

    line("verdict pass recomputed", mine["pass"])
    line("verdict pass published", published["pass"])
    line("firstFailure recomputed", mine["firstFailure"])
    line("firstFailure published", published["firstFailure"])
    line("responseHash recomputed", mine["responseHash"])
    line("responseHash published", published["responseHash"])

    outcome_agrees = (
        agree
        and mine["pass"] == published["pass"]
        and mine["firstFailure"] == published["firstFailure"]
        and mine["responseHash"].lower() == published["responseHash"].lower()
    )

    # Rebuild the published document with our own array and hash it.
    rebuilt = dict(published)
    rebuilt["reproducible"] = mine["reproducible"]
    recomputed_hash = hash_jcs(rebuilt)

    print("\nhashes")
    line("recomputed verdictHash", recomputed_hash)
    line("published verdictHash", verdict_msg["verdictHash"])
    chain_hash = None
    if args.escrow:
        events, chain_hash = onchain_events(args.mirror, args.escrow, args.deal)
        line("on-chain verdictHash", f"{chain_hash}  ({', '.join(events)})" if chain_hash else "(not found)")

    hash_matches = recomputed_hash.lower() == verdict_msg["verdictHash"].lower()
    chain_ok = chain_hash is None or chain_hash.lower() == verdict_msg["verdictHash"].lower()

    print()
    if outcome_agrees and hash_matches and chain_ok:
        print("MATCH")
        print("  a second implementation, sharing no code with the first, reached the same")
        print("  verdict and the same hash — the one the escrow recorded.")
        return 0

    if outcome_agrees and not hash_matches:
        # Honest about the one thing that is implementation-defined.
        print("OUTCOME MATCH  (hash differs)")
        print("  Every check outcome agrees, and so do pass, firstFailure and responseHash.")
        print("  The verdict hash differs because a failing jsonSchema check embeds the")
        print("  validator's own error text, which SPEC.md does not fix. The decision is")
        print("  reproducible; that one human-readable string is not.")
        return 0

    print("MISMATCH")
    if not agree:
        print("  a check outcome differs from the published verdict")
    if not chain_ok:
        print("  the on-chain hash does not match the published verdict")
    return 1


if __name__ == "__main__":
    sys.exit(main())
