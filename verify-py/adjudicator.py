"""
An independent implementation of the Receipt adjudicator.

Written from SPEC.md, not from the TypeScript source. It shares no code, no
libraries and no JSON Schema engine with the reference implementation — the
Keccak, the canonicaliser, the schema validator and the JSONPath subset here
are all written from scratch against the spec.

That is the point. "The verdict is a pure function anyone can recompute" is an
assertion until a second implementation computes the same thing.
"""
import json
import re
from keccak import keccak256, keccak256_hex

# SPEC.md §4 — fixed order. firstFailure is the first false in THIS order.
REPRODUCIBLE_ORDER = [
    "status", "contentType", "minBytes",
    "requiredPaths", "jsonSchema", "freshness", "expectedHash",
]


def jcs(value) -> str:
    """
    RFC 8785 canonical JSON, for the document shapes this protocol uses.

    Sorted keys, no insignificant whitespace, UTF-8 without \\u escaping of
    non-ASCII. Our documents contain only integers, so ECMAScript number
    formatting reduces to Python's integer repr.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def hash_jcs(value) -> str:
    return keccak256_hex(jcs(value).encode("utf-8"))


def js_number(n) -> str:
    """JavaScript prints an integral float without a decimal point; Python does not."""
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n)


# ── a JSONPath subset: $.a, $.a.b, $.a[0] ────────────────────────────────────
def json_path(doc, path: str):
    if not path.startswith("$"):
        return []
    node = doc
    for token in re.findall(r"\.([A-Za-z_][\w-]*)|\[(\d+)\]", path):
        key, index = token
        if key:
            if not isinstance(node, dict) or key not in node:
                return []
            node = node[key]
        else:
            i = int(index)
            if not isinstance(node, list) or i >= len(node):
                return []
            node = node[i]
    return [node]


def resolves(doc, path: str) -> bool:
    found = json_path(doc, path)
    return len(found) > 0 and found[0] is not None


# ── a JSON Schema subset: the keywords SPEC.md's checks actually use ─────────
def schema_errors(value, schema: dict, where: str = "") -> list:
    errs = []
    t = schema.get("type")
    if t == "object" and not isinstance(value, dict):
        return [f"{where or '/'}: must be object"]
    if t == "array" and not isinstance(value, list):
        return [f"{where or '/'}: must be array"]
    if t == "string" and not isinstance(value, str):
        return [f"{where or '/'}: must be string"]
    if t == "integer" and not (isinstance(value, int) and not isinstance(value, bool)):
        return [f"{where or '/'}: must be integer"]

    if "const" in schema and value != schema["const"]:
        errs.append(f"{where or '/'}: must be equal to constant")
    if "pattern" in schema and isinstance(value, str):
        if not re.search(schema["pattern"], value):
            # The pattern itself is part of the message. SPEC.md §5.2 pins this
            # because `detail` sits inside the hashed document — an
            # implementation that phrases it differently produces a different
            # verdictHash for an identical decision.
            errs.append(f"{where or '/'}: must match pattern \"{schema['pattern']}\"")
    if "minimum" in schema and isinstance(value, (int, float)):
        if value < schema["minimum"]:
            errs.append(f"{where or '/'}: must be >= {schema['minimum']}")

    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                errs.append(f"{where or '/'}: must have required property '{key}'")
        for key, sub in (schema.get("properties") or {}).items():
            if key in value:
                errs += schema_errors(value[key], sub, f"{where}/{key}")

    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errs.append(f"{where or '/'}: must NOT have fewer than {schema['minItems']} items")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(value):
                errs += schema_errors(item, item_schema, f"{where}/{i}")
    return errs


# ── the checks, in spec order ────────────────────────────────────────────────
def _ok(name):
    return {"check": name, "pass": True}


def _no(name, detail):
    return {"check": name, "pass": False, "detail": detail}


def _skip(name):
    return {"check": name, "pass": True, "skipped": True}


def adjudicate(terms: dict, observation: dict) -> dict:
    checks = terms.get("checks", {})
    body: bytes = observation["body"]
    status = observation["status"]
    headers = observation.get("headers", {})
    request_time_ms = observation["requestTimeMs"]

    try:
        parsed, parsed_ok = json.loads(body.decode("utf-8")), True
    except Exception:
        parsed, parsed_ok = None, False

    response_hash = keccak256_hex(body)
    results = []

    # 1 status
    if "status" not in checks:
        results.append(_skip("status"))
    else:
        allowed = checks["status"]["in"]
        results.append(_ok("status") if status in allowed
                       else _no("status", f"status {status} not in [{', '.join(str(s) for s in allowed)}]"))

    # 2 contentType
    if "contentType" not in checks:
        results.append(_skip("contentType"))
    else:
        raw = headers.get("content-type", "")
        seen = raw.split(";")[0].strip().lower()
        want = checks["contentType"]["equals"].strip().lower()
        results.append(_ok("contentType") if seen == want
                       else _no("contentType", f"content-type {seen or '(absent)'} != {want}"))

    # 3 minBytes
    if "minBytes" not in checks:
        results.append(_skip("minBytes"))
    else:
        floor = checks["minBytes"]
        results.append(_ok("minBytes") if len(body) >= floor
                       else _no("minBytes", f"{len(body)} bytes < {floor}"))

    # 4 requiredPaths
    if "requiredPaths" not in checks:
        results.append(_skip("requiredPaths"))
    elif not parsed_ok:
        results.append(_no("requiredPaths", "body is not valid JSON"))
    else:
        missing = [p for p in checks["requiredPaths"] if not resolves(parsed, p)]
        results.append(_ok("requiredPaths") if not missing
                       else _no("requiredPaths", f"missing {', '.join(missing)}"))

    # 5 jsonSchema
    if "jsonSchema" not in checks:
        results.append(_skip("jsonSchema"))
    elif not parsed_ok:
        results.append(_no("jsonSchema", "body is not valid JSON"))
    else:
        errs = schema_errors(parsed, checks["jsonSchema"])
        results.append(_ok("jsonSchema") if not errs
                       else _no("jsonSchema", "; ".join(errs) or "schema validation failed"))

    # 6 freshness
    if "freshnessSeconds" not in checks:
        results.append(_skip("freshness"))
    elif not parsed_ok:
        results.append(_no("freshness", "body is not valid JSON"))
    else:
        found = json_path(parsed, "$.timestamp")
        value = found[0] if found else None
        ms = None
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            ms = value * 1000
        elif isinstance(value, str):
            from datetime import datetime
            try:
                ms = datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000
            except Exception:
                ms = None
        if ms is None:
            results.append(_no("freshness", "$.timestamp missing or unparseable"))
        else:
            drift = abs(ms - request_time_ms) / 1000
            limit = checks["freshnessSeconds"]
            results.append(_ok("freshness") if drift <= limit
                           else _no("freshness", f"timestamp is {js_number(drift)}s from request, limit {limit}s"))

    # 7 expectedHash
    expected = checks.get("expectedHash")
    if expected is None:
        results.append(_skip("expectedHash"))
    else:
        results.append(_ok("expectedHash") if expected.lower() == response_hash.lower()
                       else _no("expectedHash", f"body hash {response_hash} != {expected}"))

    first_failure = next((r["check"] for r in results if not r["pass"]), None)
    return {
        "reproducible": results,
        "pass": all(r["pass"] for r in results),
        "firstFailure": first_failure,
        "responseHash": response_hash,
        "observedBytes": len(body),
        "observedStatus": status,
    }
