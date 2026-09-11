import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { JSONPath } from 'jsonpath-plus'
import { keccak256 } from 'viem'
import { hashTerms } from './terms.js'
import type {
  AttestedResult,
  CheckResult,
  Checks,
  Observation,
  Terms,
  Verdict,
} from './types.js'

export const ADJUDICATOR_VERSION = 'receipt-adjudicator@0.1.0'

/**
 * Fixed evaluation order. `firstFailure` is the first false in THIS order, not
 * the order failures were discovered, so two implementations agree on which
 * check is to blame.
 */
export const REPRODUCIBLE_ORDER = [
  'status',
  'contentType',
  'minBytes',
  'requiredPaths',
  'jsonSchema',
  'freshness',
  'expectedHash',
] as const

// Interop: both packages ship CJS defaults that ESM sees as a namespace.
const AjvCtor = ((Ajv as unknown as { default?: typeof Ajv }).default ?? Ajv) as typeof Ajv
const applyFormats = ((addFormats as unknown as { default?: typeof addFormats }).default ??
  addFormats) as typeof addFormats

const ok = (check: string): CheckResult => ({ check, pass: true })
const no = (check: string, detail: string): CheckResult => ({ check, pass: false, detail })
const skip = (check: string): CheckResult => ({ check, pass: true, skipped: true })

type Parsed = { ok: true; value: unknown } | { ok: false }

function parseBody(body: Uint8Array): Parsed {
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) }
  } catch {
    return { ok: false }
  }
}

/** JSONPath hit that is present and not null. */
function resolves(json: unknown, path: string): boolean {
  const found = JSONPath({ path, json: json as object, wrap: true }) as unknown[]
  return found.length > 0 && found[0] !== null && found[0] !== undefined
}

function firstValue(json: unknown, path: string): unknown {
  const found = JSONPath({ path, json: json as object, wrap: true }) as unknown[]
  return found.length > 0 ? found[0] : undefined
}

/** Unix seconds (number) or ISO-8601 (string) -> unix milliseconds. */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value * 1000
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function checkStatus(c: Checks, obs: Observation): CheckResult {
  if (c.status === undefined) return skip('status')
  return c.status.in.includes(obs.status)
    ? ok('status')
    : no('status', `status ${obs.status} not in [${c.status.in.join(', ')}]`)
}

function checkContentType(c: Checks, obs: Observation): CheckResult {
  if (c.contentType === undefined) return skip('contentType')
  const raw = obs.headers['content-type'] ?? ''
  const seen = (raw.split(';')[0] ?? '').trim().toLowerCase()
  const want = c.contentType.equals.trim().toLowerCase()
  return seen === want
    ? ok('contentType')
    : no('contentType', `content-type ${seen || '(absent)'} != ${want}`)
}

function checkMinBytes(c: Checks, obs: Observation): CheckResult {
  if (c.minBytes === undefined) return skip('minBytes')
  return obs.body.length >= c.minBytes
    ? ok('minBytes')
    : no('minBytes', `${obs.body.length} bytes < ${c.minBytes}`)
}

function checkRequiredPaths(c: Checks, parsed: Parsed): CheckResult {
  if (c.requiredPaths === undefined) return skip('requiredPaths')
  if (!parsed.ok) return no('requiredPaths', 'body is not valid JSON')
  const missing = c.requiredPaths.filter((p) => !resolves(parsed.value, p))
  return missing.length === 0
    ? ok('requiredPaths')
    : no('requiredPaths', `missing ${missing.join(', ')}`)
}

function checkJsonSchema(c: Checks, parsed: Parsed): CheckResult {
  if (c.jsonSchema === undefined) return skip('jsonSchema')
  if (!parsed.ok) return no('jsonSchema', 'body is not valid JSON')
  const ajv = new AjvCtor({ strict: false, allErrors: true })
  applyFormats(ajv)
  const validate = ajv.compile(c.jsonSchema)
  if (validate(parsed.value)) return ok('jsonSchema')
  const detail = (validate.errors ?? [])
    .map((e) => `${e.instancePath || '/'}: ${e.message}`)
    .join('; ')
  return no('jsonSchema', detail || 'schema validation failed')
}

function checkFreshness(c: Checks, parsed: Parsed, obs: Observation): CheckResult {
  if (c.freshnessSeconds === undefined) return skip('freshness')
  if (!parsed.ok) return no('freshness', 'body is not valid JSON')
  const ms = toEpochMs(firstValue(parsed.value, '$.timestamp'))
  if (ms === null) return no('freshness', '$.timestamp missing or unparseable')
  const driftSeconds = Math.abs(ms - obs.requestTimeMs) / 1000
  return driftSeconds <= c.freshnessSeconds
    ? ok('freshness')
    : no('freshness', `timestamp is ${driftSeconds}s from request, limit ${c.freshnessSeconds}s`)
}

function checkExpectedHash(c: Checks, responseHash: string): CheckResult {
  if (c.expectedHash === undefined || c.expectedHash === null) return skip('expectedHash')
  return c.expectedHash.toLowerCase() === responseHash.toLowerCase()
    ? ok('expectedHash')
    : no('expectedHash', `body hash ${responseHash} != ${c.expectedHash}`)
}

/**
 * Pure. No network, no filesystem, no clock, no randomness.
 *
 * Everything it reads is either the signed terms or the observation the
 * facilitator publishes verbatim to HCS, which is what lets a third party
 * recompute `reproducible` byte-for-byte from the public log.
 *
 * `attested` holds the facilitator's own measurement of latency. Nobody can
 * recompute it, so by DECISIONS-01 Q3 it is recorded but gates nothing.
 */
export function adjudicate(terms: Terms, obs: Observation): Verdict {
  const c = terms.checks
  const parsed = parseBody(obs.body)
  const responseHash = keccak256(obs.body)

  const reproducible: CheckResult[] = [
    checkStatus(c, obs),
    checkContentType(c, obs),
    checkMinBytes(c, obs),
    checkRequiredPaths(c, parsed),
    checkJsonSchema(c, parsed),
    checkFreshness(c, parsed, obs),
    checkExpectedHash(c, responseHash),
  ]

  const latency: AttestedResult =
    c.maxLatencyMs === undefined
      ? { check: 'maxLatencyMs', pass: true, skipped: true, observed: obs.observedLatencyMs }
      : {
          check: 'maxLatencyMs',
          pass: obs.observedLatencyMs <= c.maxLatencyMs,
          observed: obs.observedLatencyMs,
        }

  return {
    v: 1,
    adjudicator: ADJUDICATOR_VERSION,
    termsHash: hashTerms(terms),
    responseHash,
    observedStatus: obs.status,
    observedBytes: obs.body.length,
    reproducible,
    attested: [latency],
    pass: reproducible.every((r) => r.pass),
    firstFailure: reproducible.find((r) => !r.pass)?.check ?? null,
  }
}
