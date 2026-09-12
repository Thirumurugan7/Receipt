/**
 * Hedera Consensus Service: the public, ordered audit log.
 *
 * Per DECISIONS-01 Q2 the topic carries the FULL raw response body, not just
 * its hash. Publishing only a hash would make `pnpm verify` circular — you
 * cannot re-run `requiredPaths` or `jsonSchema` against a digest, so the CLI
 * could do nothing but re-hash its own output.
 *
 * It also carries the status line and content-type, because `status` and
 * `contentType` are checks over the response HEAD, not its body. Without them
 * a verifier could not recompute the full `reproducible` array either.
 *
 * Together those three messages are exactly the `Observation` the adjudicator
 * consumed, so anyone can replay it offline and get byte-identical bytes back.
 */
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk'
import type { Hex, Observation, Terms, Verdict } from './types.js'

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

function clientFor(cfg: HcsConfig): Client {
  const key = cfg.operatorKey.startsWith('0x') ? cfg.operatorKey.slice(2) : cfg.operatorKey
  const client = cfg.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet()
  client.setOperator(cfg.operatorId, PrivateKey.fromStringECDSA(key))
  return client
}

export async function createTopic(cfg: HcsConfig, memo: string): Promise<string> {
  const client = clientFor(cfg)
  try {
    const receipt = await (
      await new TopicCreateTransaction().setTopicMemo(memo).execute(client)
    ).getReceipt(client)
    const id = receipt.topicId
    if (!id) throw new Error('topic creation returned no topicId')
    return id.toString()
  } finally {
    client.close()
  }
}

/** Submits one message. The SDK chunks at 1KB; 20 chunks is the default cap. */
export async function submit(
  cfg: HcsConfig,
  topicId: string,
  message: HcsMessage,
): Promise<string> {
  const client = clientFor(cfg)
  try {
    const body = JSON.stringify(message)
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(body)
      .execute(client)
    await response.getReceipt(client)
    return response.transactionId.toString()
  } finally {
    client.close()
  }
}

/** One message row as the Mirror Node returns it. */
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
    const bytes = Buffer.concat(ordered.map((p) => Buffer.from(p.message, 'base64')))
    try {
      out.push({
        consensusTimestamp: ordered[0]!.consensus_timestamp,
        sequenceNumber: ordered[0]!.sequence_number,
        json: JSON.parse(bytes.toString('utf8')),
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
    body: new Uint8Array(Buffer.from(m.bodyBase64, 'base64')),
    requestTimeMs: m.requestTimeMs,
    observedLatencyMs,
  }
}
