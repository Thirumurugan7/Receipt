/**
 * Rebuilding the facilitator's own ledger from the public log on boot, so a
 * restart does not leave a visitor looking at an empty page.
 *
 * The reconstruction itself lives in @receipt/core, because the hosted site
 * does exactly the same thing in a browser with no server behind it.
 */
import { readTopic } from '@receipt/core/hcs-read'
import { recordsFromLog } from '@receipt/core'
import type { LogRow } from '@receipt/core'
import { upsert } from './store.js'

export { recordsFromLog }

/**
 * Best effort: a mirror node that is slow or down must not stop the
 * facilitator from starting, it just means the page opens empty until the
 * next deal.
 */
export async function rehydrate(mirrorUrl: string, topicId: string): Promise<number> {
  const rows = (await readTopic(mirrorUrl, topicId)) as LogRow[]
  const records = recordsFromLog(rows)
  for (const r of records) upsert(r)
  return records.length
}
