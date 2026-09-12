/**
 * Links to the public record.
 *
 * Every claim this project makes is meant to be followed up by someone who
 * does not trust it, which only works if the links land. These are the URL
 * shapes verified against the live explorer and mirror node, in one place, so
 * a dead link is a failing test rather than a judge's dead end.
 */

export type Network = 'testnet' | 'mainnet' | 'previewnet'

const HASHSCAN = 'https://hashscan.io'
const mirrorBase = (net: Network) => `https://${net}.mirrornode.hedera.com/api/v1`

/** 0x-prefixed 32-byte EVM transaction hash. */
const EVM_TX = /^0x[0-9a-fA-F]{64}$/
/** How Hedera prints a transaction id: 0.0.7162784@1789235851.125983072 */
const HEDERA_TX_PRINTED = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/
/** How HashScan routes one: 0.0.7162784-1789235851-125983072 */
const HEDERA_TX_ROUTED = /^\d+\.\d+\.\d+-\d+-\d+$/

/**
 * A transaction on HashScan, from either form this project holds.
 *
 * The escrow calls are EVM transactions and carry a 0x hash; the x402
 * settlement and every HCS publish are native Hedera transactions and carry a
 * printed id, which HashScan does not route on. Returns null rather than a
 * guess, so a caller renders a dash instead of a link that goes nowhere.
 */
export function hashscanTx(id: string | undefined | null, net: Network): string | null {
  if (!id) return null
  const v = id.trim()
  if (EVM_TX.test(v) || HEDERA_TX_ROUTED.test(v)) return `${HASHSCAN}/${net}/transaction/${v}`
  const m = HEDERA_TX_PRINTED.exec(v)
  if (m) return `${HASHSCAN}/${net}/transaction/${m[1]}-${m[2]}-${m[3]}`
  return null
}

export const hashscanContract = (address: string, net: Network) =>
  `${HASHSCAN}/${net}/contract/${address}`

export const hashscanTopic = (topicId: string, net: Network) =>
  `${HASHSCAN}/${net}/topic/${topicId}`

/** The audit log itself: every terms, observation and verdict, in order. */
export const hashscanTopicMessages = (topicId: string, net: Network) =>
  `${HASHSCAN}/${net}/topic/${topicId}/messages`

/**
 * One message, as raw JSON from the mirror node. This is the better citation
 * for "here is the input the verdict was computed over" — it is the bytes,
 * not an explorer's rendering of them.
 */
export const mirrorTopicMessage = (topicId: string, sequenceNumber: number, net: Network) =>
  `${mirrorBase(net)}/topics/${topicId}/messages/${sequenceNumber}`

export const mirrorContract = (address: string, net: Network) =>
  `${mirrorBase(net)}/contracts/${address}`

/**
 * `hedera:testnet` is how x402 names the chain; the explorer wants `testnet`.
 */
export function networkFromCaip(caip: string): Network {
  const tail = caip.includes(':') ? caip.slice(caip.indexOf(':') + 1) : caip
  return tail === 'mainnet' || tail === 'previewnet' ? tail : 'testnet'
}
