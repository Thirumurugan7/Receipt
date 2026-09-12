/**
 * Receipt as an MCP server.
 *
 * Exposes the whole loop as three tools an agent can call directly:
 *
 *   buy_verified_data — state acceptance terms, pay, and get back the data
 *                       together with the reason it was accepted or refused
 *   verify_deal       — re-run the adjudicator against the public log
 *   get_deal          — the verdict and on-chain state for one deal
 *
 * The point of the MCP surface is that an agent never has to understand x402,
 * escrow, or Hedera. It states what it is willing to pay for, and either gets
 * usable data or keeps its money — and the tool result carries the command a
 * third party can run to check that decision independently.
 */
import '@receipt/core/loadenv'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readTopic } from '@receipt/core/hcs'
import { adjudicate, hashVerdict, jcs } from '@receipt/core'
import type { Observation, Terms, Verdict } from '@receipt/core'
import { buy } from '@receipt/buyer/buy'

const FACILITATOR = process.env.RECEIPT_FACILITATOR_URL ?? 'http://localhost:8080'
const TOPIC = process.env.HCS_TOPIC_ID ?? ''
const MIRROR = process.env.HEDERA_MIRROR_URL ?? 'https://testnet.mirrornode.hedera.com'

const server = new McpServer({ name: 'receipt', version: '0.1.0' })

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })

server.registerTool(
  'buy_verified_data',
  {
    title: 'Buy data under acceptance terms',
    description:
      'Buy a priced API response, paying only if it satisfies machine-checkable acceptance ' +
      'terms. Payment is escrowed and released to the seller only when every check passes; ' +
      'otherwise it is refunded automatically, with no dispute process and no human. Returns ' +
      'the data when it passed, the reason it did not when it failed, and a deal id anyone ' +
      'can use to re-verify the decision.',
    inputSchema: {
      resource: z.string().describe('URL of the priced resource to buy'),
      required_paths: z.array(z.string()).optional()
        .describe('JSONPath expressions that must resolve to a non-null value, e.g. $.data'),
      freshness_seconds: z.number().int().positive().optional()
        .describe('Reject data whose $.timestamp is older than this'),
      max_price_tinybars: z.string().optional()
        .describe('Most you will pay, in tinybars (1 HBAR = 100000000)'),
    },
  },
  async ({ resource, required_paths, freshness_seconds, max_price_tinybars }) => {
    try {
      const r = await buy({
        resource,
        requiredPaths: required_paths,
        freshnessSeconds: freshness_seconds,
        maxPriceTinybars: max_price_tinybars,
      })
      return text(JSON.stringify({
        settled: r.settled,
        outcome: r.outcome,
        first_failure: r.firstFailure,
        // null when the checks failed: data that did not pass is never handed
        // back as though it had
        data: r.data,
        deal_id: r.dealId,
        terms_hash: r.termsHash,
        settlement_tx: r.settlementTxId,
        open_tx: r.openTxHash,
        resolve_tx: r.resolveTxHash,
        audit: { topic: r.topic, verify_command: r.verifyCommand },
        note: r.outcome === 'released'
          ? 'every acceptance check passed, so the seller was paid'
          : r.outcome === 'refunded'
            ? `rejected on ${r.firstFailure}; the payment was returned automatically`
            : 'the seller never responded; no verdict was published and the funds are recoverable after the deadline',
      }, null, 2))
    } catch (e) {
      return text(`purchase failed: ${(e as Error).message}`)
    }
  },
)

server.registerTool(
  'verify_deal',
  {
    title: 'Re-run the adjudicator on a past deal',
    description:
      'Independently re-runs the verdict for a deal from the public Hedera Consensus Service ' +
      'topic. Reads the signed terms and the raw response, recomputes every reproducible ' +
      'check, and reports whether the recomputed verdict hash matches the published one. ' +
      'Needs no credentials and no cooperation from the facilitator.',
    inputSchema: {
      deal_id: z.string().describe('0x-prefixed 32-byte deal id'),
      topic_id: z.string().optional().describe('HCS topic; defaults to the configured one'),
    },
  },
  async ({ deal_id, topic_id }) => {
    const topic = topic_id ?? TOPIC
    if (!topic) return text('no HCS topic configured; pass topic_id')

    const messages = await readTopic(MIRROR, topic)
    const forDeal = messages.filter((m) => (m.message as { dealId?: string }).dealId === deal_id)
    const termsMsg = forDeal.find((m) => m.message.kind === 'terms')
    const obsMsg = forDeal.find((m) => m.message.kind === 'observation')
    const verdictMsg = forDeal.find((m) => m.message.kind === 'verdict')

    if (!termsMsg) return text(`no terms published for ${deal_id}`)
    if (!verdictMsg) {
      return text(`no verdict published for ${deal_id} — the seller never responded, so ` +
        `nothing was published to judge. claimExpired returns the funds after the deadline.`)
    }
    if (!obsMsg) return text('the response body was withheld (bodyTooLarge): not reproducible by design')

    const terms = (termsMsg.message as { terms: Terms }).terms
    const published = verdictMsg.message as { verdict: Verdict; verdictHash: string }
    const o = obsMsg.message as Extract<typeof obsMsg.message, { kind: 'observation' }>
    const latency = published.verdict.attested.find((a) => a.check === 'maxLatencyMs')?.observed ?? 0

    const observation: Observation = {
      status: o.status,
      headers: o.headers,
      body: new Uint8Array(Buffer.from(o.bodyBase64, 'base64')),
      requestTimeMs: o.requestTimeMs,
      observedLatencyMs: latency,
    }

    const recomputed = adjudicate(terms, observation)
    const identical = jcs(recomputed.reproducible) === jcs(published.verdict.reproducible)
    const rebuilt: Verdict = { ...published.verdict, reproducible: recomputed.reproducible }
    const recomputedHash = hashVerdict(rebuilt)
    const match = recomputedHash.toLowerCase() === published.verdictHash.toLowerCase()

    return text(JSON.stringify({
      deal_id,
      reproducible_checks_identical: identical,
      recomputed_verdict_hash: recomputedHash,
      published_verdict_hash: published.verdictHash,
      match,
      pass: recomputed.pass,
      first_failure: recomputed.firstFailure,
      checks: recomputed.reproducible,
      note: match
        ? 'the published verdict follows from the published terms and response'
        : 'the published verdict does NOT follow from its inputs',
    }, null, 2))
  },
)

server.registerTool(
  'get_deal',
  {
    title: 'Deal state',
    description: 'The verdict, phase and on-chain settlement state for one deal.',
    inputSchema: { deal_id: z.string().describe('0x-prefixed 32-byte deal id') },
  },
  async ({ deal_id }) => {
    const res = await fetch(`${FACILITATOR}/deals/${deal_id}`)
    return text(await res.text())
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`receipt mcp server ready — facilitator ${FACILITATOR}, topic ${TOPIC || '(unset)'}`)
