import '@receipt/core/loadenv'
import { readTopic } from '@receipt/core/hcs'

const topic = process.env.HCS_TOPIC_ID!
const mirror = process.env.HEDERA_MIRROR_URL!
const msgs = await readTopic(mirror, topic)
console.log(`topic ${topic}: ${msgs.length} complete messages\n`)
for (const m of msgs.slice(-6)) {
  const x = m.message as Record<string, any>
  let extra = ''
  if (x.kind === 'observation') {
    const bytes = Buffer.from(x.bodyBase64, 'base64')
    extra = ` status=${x.status} body=${bytes.length}B`
  }
  if (x.kind === 'verdict') extra = ` pass=${x.verdict?.pass} first=${x.verdict?.firstFailure ?? '-'}`
  if (x.kind === 'terms') extra = ` amount=${x.terms?.amount}`
  console.log(`  #${String(m.sequenceNumber).padStart(3)} ${String(x.kind).padEnd(12)}${extra}  deal=${String(x.dealId).slice(0, 12)}…`)
}
