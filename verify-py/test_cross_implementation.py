#!/usr/bin/env python3
"""
Cross-implementation conformance.

Runs this Python adjudicator against the fixture the TypeScript reference
implementation generated, and asserts they agree on every check outcome, on
firstFailure, on responseHash, and on the canonical bytes of reproducible[].

This is the test that gives SPEC.md teeth: a specification nobody has
implemented twice is a document, not a specification.

    python3 test_cross_implementation.py
"""
import base64
import json
import pathlib
import sys

from adjudicator import adjudicate, jcs, hash_jcs

FIXTURE = pathlib.Path(__file__).parent.parent / "packages/core/test/fixtures/adjudication.json"


def main() -> int:
    data = json.loads(FIXTURE.read_text())
    terms = data["terms"]
    failures = 0

    print(f"cross-implementation conformance — {len(data['cases'])} cases\n")
    for case in data["cases"]:
        name = case["name"]
        obs = case["observation"]
        expected = case["expected"]

        mine = adjudicate(terms, {
            "status": obs["status"],
            "headers": obs["headers"],
            "body": base64.b64decode(obs["bodyBase64"]),
            "requestTimeMs": obs["requestTimeMs"],
        })

        problems = []
        if mine["pass"] != expected["pass"]:
            problems.append(f"pass {mine['pass']} != {expected['pass']}")
        if mine["firstFailure"] != expected["firstFailure"]:
            problems.append(f"firstFailure {mine['firstFailure']} != {expected['firstFailure']}")
        if mine["responseHash"].lower() != expected["responseHash"].lower():
            problems.append("responseHash differs")

        # the strongest assertion: identical canonical bytes for the array
        # that decides settlement
        ours = jcs(mine["reproducible"])
        if ours != expected["reproducibleJcs"]:
            problems.append("reproducible[] canonical bytes differ")

        # and the full verdict document must hash identically
        rebuilt = dict(case["verdict"])
        rebuilt["reproducible"] = mine["reproducible"]
        if hash_jcs(rebuilt).lower() != expected["verdictHash"].lower():
            problems.append("verdictHash differs")

        if problems:
            failures += 1
            print(f"  FAIL  {name}")
            for p in problems:
                print(f"        {p}")
            print(f"        ours     {ours}")
            print(f"        theirs   {expected['reproducibleJcs']}")
        else:
            print(f"  ok    {name:<20} pass={str(expected['pass']):<5} first={expected['firstFailure'] or '-'}")

    print()
    if failures:
        print(f"{failures} case(s) diverged — the two implementations do not agree")
        return 1
    print("all cases agree: two independent implementations, identical verdicts and hashes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
