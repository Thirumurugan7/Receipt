/**
 * Publishing to the Hedera Consensus Service.
 *
 * The read half lives in hcs-read.ts and is re-exported here, so existing
 * callers see one module while the browser can import only what it needs
 * without pulling in the Hedera SDK.
 */
import {
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
} from '@hiero-ledger/sdk'
import type { HcsConfig, HcsMessage } from './hcs-read.js'

export * from './hcs-read.js'

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
/**
 * Where one published message landed on the public log.
 *
 * Both halves are citations a third party can follow without asking us
 * anything: the transaction is the write itself on the explorer, and the
 * sequence number addresses the message on the mirror node, which serves the
 * raw bytes the verdict was computed over.
 */
export interface Published {
  transactionId: string
  /** Null only if the receipt omitted it, which would be a Hedera change. */
  sequenceNumber: number | null
}

export async function submit(
  cfg: HcsConfig,
  topicId: string,
  message: HcsMessage,
): Promise<Published> {
  const client = clientFor(cfg)
  try {
    const body = JSON.stringify(message)
    const response = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(body)
      .execute(client)
    const receipt = await response.getReceipt(client)
    return {
      transactionId: response.transactionId.toString(),
      sequenceNumber: receipt.topicSequenceNumber ? receipt.topicSequenceNumber.toNumber() : null,
    }
  } finally {
    client.close()
  }
}

/** One message row as the Mirror Node returns it. */