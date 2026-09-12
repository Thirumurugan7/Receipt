import '@receipt/core/loadenv'
import { createTopic } from '@receipt/core/hcs'

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v }

if (process.env.HCS_TOPIC_ID) {
  console.log(`HCS_TOPIC_ID already set: ${process.env.HCS_TOPIC_ID} — refusing to create another`)
  process.exit(0)
}
const topicId = await createTopic(
  { operatorId: env('HEDERA_OPERATOR_ID'), operatorKey: env('HEDERA_OPERATOR_KEY'), network: 'testnet' },
  'Receipt — conditional settlement audit log (terms / observation / verdict)',
)
console.log(`HCS_TOPIC_ID=${topicId}`)
