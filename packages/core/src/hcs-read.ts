/**
 * Reading the public audit log.
 *
 * Deliberately separate from the writing half: publishing needs the Hedera
 * SDK and an operator key, but *checking* a verdict needs neither. Everything
 * here is fetch and pure functions, so the same code that backs `pnpm verify`
 * also runs in a judge's browser against the mirror node directly, with this
 * project's servers entirely out of the loop. That is the whole claim, so it
 * should not require trusting our bundle any more than it requires trusting
 * our facilitator.
 */
import type { Hex, Observation, Terms, Verdict } from './types.js'

/**
 * Base64 to bytes without `Buffer`, so this module runs unchanged in a
 * browser. The point of separating the read half is that a verifier needs no
 * Node, no SDK and no key -- a Buffer call here would quietly undo that.
 */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** DECISIONS-01 Q2: reject rather than truncate above this. */
export const MAX_BODY_BYTES = 4096

export type HcsMessage =
  | { kind: 'terms'; dealId: Hex; termsHash: Hex; terms: Terms }
  | {
      kind: 'observation'
      dealId: Hex
      termsHash: Hex
      status: number
      headers: Record<string, string>
      bodyBase64: string
      requestTimeMs: number
    }
  | {
      kind: 'verdict'
      dealId: Hex
      termsHash: Hex
      verdictHash: Hex
      verdict: Verdict
      /** Both legs of the custody hop, so the window is publicly measurable. */
      settlementTxId: string | null
      openTxHash: string | null
      resolveTxHash: string | null
    }

export interface HcsConfig {
  operatorId: string
  operatorKey: string
  network?: 'testnet' | 'mainnet'
}

export interface MirrorMessage {
  consensus_timestamp: string
  sequence_number: number
  /** base64 of this chunk's bytes, not of the whole message. */
  message: string
  chunk_info?: {
    initial_transaction_id: {
      account_id: string
      nonce: number
      scheduled: boolean
      transaction_valid_start: string
    }
    number: number
    total: number
  } | null
}

export interface ReassembledMessage {
  consensusTimestamp: string
  sequenceNumber: number
  json: unknown
}

/**
 * Rejoins chunked topic messages.
 *
 * HCS caps a message at 1024 bytes and the SDK splits anything larger, so a
 * published response body arrives as several Mirror Node rows sharing one
 * initial_transaction_id. Decoding each row on its own yields truncated JSON —
 * which is exactly how the verify CLI would silently "fail to reproduce" a
 * verdict that is in fact correct.
 *
 * Chunks are concatenated as BYTES before decoding, because a split can land
 * mid UTF-8 sequence and per-chunk toString() would corrupt the character.
 */
export function reassembleChunks(messages: MirrorMessage[]): ReassembledMessage[] {
  const groups = new Map<string, MirrorMessage[]>()

  for (const m of messages) {
    const c = m.chunk_info
    const key = c
      ? `${c.initial_transaction_id.account_id}@${c.initial_transaction_id.transaction_valid_start}`
      : `seq:${m.sequence_number}`
    const list = groups.get(key)
    if (list) list.push(m)
    else groups.set(key, [m])
  }

  const out: ReassembledMessage[] = []
  for (const parts of groups.values()) {
    const total = parts[0]?.chunk_info?.total ?? 1
    if (parts.length !== total) continue // incomplete: drop rather than misparse

    const ordered = [...parts].sort(
      (a, b) => (a.chunk_info?.number ?? 1) - (b.chunk_info?.number ?? 1),
    )
    // Join as BYTES, then decode once. Decoding each chunk separately splits
    // multi-byte characters across the boundary and corrupts them.
    const chunks = ordered.map((p) => base64ToBytes(p.message))
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let offset = 0
    for (const c of chunks) { bytes.set(c, offset); offset += c.length }
    try {
      out.push({
        consensusTimestamp: ordered[0]!.consensus_timestamp,
        sequenceNumber: ordered[0]!.sequence_number,
        json: JSON.parse(new TextDecoder().decode(bytes)),
      })
    } catch {
      // a foreign message on the topic is data, not a crash
    }
  }
  return out.sort((a, b) => a.sequenceNumber - b.sequenceNumber)
}

/**
 * Reads a topic back through the public Mirror Node REST API rather than a
 * subscription, so the verify CLI needs no credentials and no SDK client —
 * anyone can run it against the public log.
 */
export async function readTopic(
  mirrorUrl: string,
  topicId: string,
): Promise<{ consensusTimestamp: string; sequenceNumber: number; message: HcsMessage }[]> {
  const rows: MirrorMessage[] = []
  let next: string | null = `/api/v1/topics/${topicId}/messages?limit=100&order=asc`
  while (next) {
    const res = await fetch(`${mirrorUrl}${next}`)
    if (!res.ok) throw new Error(`mirror node ${res.status} for ${next}`)
    const page = (await res.json()) as { messages: MirrorMessage[]; links?: { next?: string | null } }
    rows.push(...page.messages)
    next = page.links?.next ?? null
  }
  return reassembleChunks(rows).map((r) => ({
    consensusTimestamp: r.consensusTimestamp,
    sequenceNumber: r.sequenceNumber,
    message: r.json as HcsMessage,
  }))
}

/** Rebuilds the exact Observation the adjudicator saw, from the public log. */
export function observationFromMessage(
  m: Extract<HcsMessage, { kind: 'observation' }>,
  observedLatencyMs: number,
): Observation {
  return {
    status: m.status,
    headers: m.headers,
    body: base64ToBytes(m.bodyBase64),
    requestTimeMs: m.requestTimeMs,
    observedLatencyMs,
  }
}
