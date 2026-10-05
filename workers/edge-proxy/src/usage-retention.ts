import { DurableObject } from 'cloudflare:workers'
import { purgeUsageCounts } from './retention'

export class UsageRetention extends DurableObject<{ UX_DB: D1Database }> {
  async fetch() {
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 1000)
    return new Response(null, { status: 204 })
  }

  async alarm() {
    try {
      await purgeUsageCounts(this.env.UX_DB, Date.now())
    } finally {
      const now = new Date()
      const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6)
      await this.ctx.storage.setAlarm(next > now.getTime() ? next : next + 86400000)
    }
  }
}
