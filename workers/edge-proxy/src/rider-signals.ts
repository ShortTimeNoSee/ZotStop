import { DurableObject } from 'cloudflare:workers'

type Signal = { id: string; progress: number; at: number; stationarySince: number; samples: number; moved: boolean }
type Message = { action: 'report' | 'end' | 'read'; id?: string; progress?: number; length?: number; loop?: boolean }
const retentionMs = 20 * 60_000

export class RiderSignals extends DurableObject {
  private async activeSignals(now: number): Promise<Signal[]> {
    const entries = await this.ctx.storage.list<Signal>({ prefix: 'ride:' })
    const active: Signal[] = []
    for (const [key, value] of entries) {
      if (now - value.at >= retentionMs) await this.ctx.storage.delete(key)
      else active.push(value)
    }
    if (!active.length && entries.size) await this.ctx.storage.deleteAll()
    return active
  }

  async alarm(): Promise<void> {
    const active = await this.activeSignals(Date.now())
    if (active.length) await this.ctx.storage.setAlarm(Math.min(...active.map(signal => signal.at + retentionMs)))
  }

  async fetch(request: Request): Promise<Response> {
    const message = await request.json() as Message
    const now = Date.now()
    const active = await this.activeSignals(now)
    if (active.length && await this.ctx.storage.getAlarm() === null) {
      await this.ctx.storage.setAlarm(Math.min(...active.map(signal => signal.at + retentionMs)))
    }
    if (message.action === 'end' && message.id) {
      await this.ctx.storage.delete(`ride:${message.id}`)
      return new Response(null, { status: 204 })
    }
    if (message.action === 'report' && message.id && Number.isFinite(message.progress) && Number.isFinite(message.length)) {
      const progress = Math.round(message.progress! / 25) * 25
      const length = message.length!
      if (progress < 0 || progress > length || length < 100) return new Response(null, { status: 204 })
      const prior = active.find(signal => signal.id === message.id)
      if (prior) {
        const elapsed = (now - prior.at) / 1000
        if (elapsed < 20) return new Response(null, { status: 204 })
        const advance = Math.abs(progress - prior.progress)
        const loopAdvance = message.loop ? Math.min(advance, Math.abs(length - advance)) : advance
        if (loopAdvance / elapsed > 35.7) {
          await this.ctx.storage.delete(`ride:${message.id}`)
          return new Response(null, { status: 204 })
        }
        const stationarySince = loopAdvance < 15 ? prior.stationarySince : now
        if (now - stationarySince > 15 * 60_000) {
          await this.ctx.storage.delete(`ride:${message.id}`)
          return new Response(null, { status: 204 })
        }
        await this.ctx.storage.put(`ride:${message.id}`, { id: message.id, progress, at: now, stationarySince, samples: Math.min(3, prior.samples + 1), moved: prior.moved || loopAdvance >= 35 } satisfies Signal)
      } else {
        if (active.length >= 64) return new Response(null, { status: 204 })
        await this.ctx.storage.put(`ride:${message.id}`, { id: message.id, progress, at: now, stationarySince: now, samples: 1, moved: false } satisfies Signal)
      }
      if (!active.length) await this.ctx.storage.setAlarm(now + retentionMs)
      return new Response(null, { status: 202 })
    }
    const recent = active.filter(signal => now - signal.at <= 100_000 && signal.samples >= 2 && signal.moved)
    const unused = [...recent].sort((a, b) => a.progress - b.progress)
    const corroborated: { progress: number; riders: number; updatedAt: number }[] = []
    while (unused.length) {
      const anchor = unused.shift()!
      const group = [anchor]
      for (let index = unused.length - 1; index >= 0; index--) {
        const distance = Math.abs(unused[index].progress - anchor.progress)
        if (Math.min(distance, message.loop && message.length ? Math.abs(message.length - distance) : distance) <= 200) group.push(unused.splice(index, 1)[0])
      }
      if (group.length >= 2) corroborated.push({
        progress: Math.round(anchor.progress / 200) * 200,
        riders: group.length,
        updatedAt: Math.min(...group.map(signal => signal.at)),
      })
    }
    return Response.json({ corroborated }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
