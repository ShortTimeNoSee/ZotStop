import { normalizeSnapshot } from '../../../packages/transit-engine/src/normalize'
import routes from '../../../packages/transit-engine/assets/routes.min.json'
import { pointAtProgress, routeProgress } from '../../../packages/transit-engine/src/rider-signal'
export { RiderSignals } from './rider-signals'
export { UsageRetention } from './usage-retention'

const UPSTREAM = 'https://ucirvine.transloc.com/Services/JSONPRelay.svc/'
const ROUTES = routes.routes
  .map((route) => route.id.replace(/^TL-/, ''))
  .join(',')

type Env = { ASSETS: Fetcher; UX_DB?: D1Database; RIDER_SIGNALS: DurableObjectNamespace; USAGE_RETENTION: DurableObjectNamespace; RIDER_RATE: RateLimit }

async function initializeRetention(env: Env) {
  const retention = env.USAGE_RETENTION.get(env.USAGE_RETENTION.idFromName('usage-counts'))
  const response = await retention.fetch('https://usage-retention.internal')
  if (!response.ok) throw new Error('Usage retention unavailable')
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error('large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder().decode(bytes))
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    if (url.pathname === '/api/v1/ux' && request.method === 'GET') {
      await initializeRetention(env)
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    }
    if (url.pathname === '/api/v1/rider-signals') {
      const route = routes.routes.find(item => item.id === url.searchParams.get('route'))
      if (!route) return new Response('Unknown route', { status: 404 })
      const object = env.RIDER_SIGNALS.get(env.RIDER_SIGNALS.idFromName(route.id))
      if (request.method === 'GET') {
        const shape = routeProgress(route, { lon: route.shape[0][0], lat: route.shape[0][1] })
        const result = await object.fetch('https://rider-signals.internal', { method: 'POST', body: JSON.stringify({ action: 'read', length: shape?.length, loop: shape?.loop }) })
        const data = await result.json() as { corroborated: { progress: number; riders: number; updatedAt: number }[] }
        return Response.json({ signals: data.corroborated.map(item => ({ ...pointAtProgress(route, item.progress), riders: item.riders, updatedAt: item.updatedAt })) }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (request.method !== 'POST' && request.method !== 'DELETE') return new Response('Method not allowed', { status: 405 })
      let body: Record<string, unknown>
      try { body = await readJson(request, 1024) as Record<string, unknown> } catch (error) { return new Response('Invalid data', { status: error instanceof Error && error.message === 'large' ? 413 : 400 }) }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return new Response('Invalid data', { status: 400 })
      if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) return new Response('Invalid data', { status: 400 })
      if (request.method === 'DELETE') return object.fetch('https://rider-signals.internal', { method: 'POST', body: JSON.stringify({ action: 'end', id: body.id }) })
      const ip = request.headers.get('CF-Connecting-IP')
      if (ip && !(await env.RIDER_RATE.limit({ key: ip })).success) return new Response(null, { status: 204 })
      if (typeof body.lat !== 'number' || typeof body.lon !== 'number' || typeof body.accuracy !== 'number' || Math.abs(body.lat) > 90 || Math.abs(body.lon) > 180 || body.accuracy < 0 || body.accuracy > 40) return new Response(null, { status: 204 })
      const matched = routeProgress(route, { lat: body.lat, lon: body.lon })
      if (!matched || matched.distance > 40) return new Response(null, { status: 204 })
      return object.fetch('https://rider-signals.internal', { method: 'POST', body: JSON.stringify({ action: 'report', id: body.id, progress: matched.progress, length: matched.length, loop: matched.loop }) })
    }
    if (url.pathname === '/api/v1/ux' && request.method === 'POST') {
      if (!env.UX_DB) return new Response('Unavailable', { status: 503 })
      let events: unknown
      try {
        events = await readJson(request, 4096)
      } catch (error) {
        return new Response('Invalid data', { status: error instanceof Error && error.message === 'large' ? 413 : 400 })
      }
      const valid =
        Array.isArray(events) &&
        events.length > 0 &&
        events.length <= 20 &&
        events.every(
          (event) =>
            event &&
            typeof event === 'object' &&
            [
              'route_found_quickly',
              'stop_found_quickly',
              'map_zoom_used',
            ].includes(event.metric) &&
            (event.value === 0 || event.value === 1) &&
            Object.keys(event).length === 2,
        )
      if (!valid) return new Response('Invalid data', { status: 400 })
      const day = new Date().toISOString().slice(0, 10)
      const grouped = new Map<string, number>()
      for (const event of events as { metric: string; value: number }[]) {
        const key = `${event.metric}:${event.value}`
        grouped.set(key, (grouped.get(key) || 0) + 1)
      }
      await env.UX_DB.batch(
        [...grouped].map(([key, count]) => {
          const [metric, value] = key.split(':')
          return env
            .UX_DB!.prepare(
              'INSERT INTO ux_aggregate (day, metric, value, count) VALUES (?, ?, ?, ?) ON CONFLICT(day, metric, value) DO UPDATE SET count = count + excluded.count',
            )
            .bind(day, metric, Number(value), count)
        }),
      )
      await initializeRetention(env)
      return new Response(null, {
        status: 204,
        headers: { 'Cache-Control': 'no-store' },
      })
    }

    if (request.method !== 'GET' || url.pathname !== '/api/v1/snapshot')
      return new Response('Not found', { status: 404 })
    const cache = caches.default
    const key = new Request(`${url.origin}/api/v1/snapshot`)
    const lastGoodKey = new Request(`${url.origin}/api/v1/last-good-snapshot`)
    const cached = await cache.match(key)
    if (cached) return cached
    try {
      const [vehiclesResponse, arrivalsResponse] = await Promise.all([
        fetch(`${UPSTREAM}GetMapVehiclePoints`, {
          headers: { Accept: 'application/json' },
        }),
        fetch(`${UPSTREAM}GetStopArrivalTimes?routeIds=${ROUTES}&version=2`, {
          headers: { Accept: 'application/json' },
        }),
      ])
      if (!vehiclesResponse.ok || !arrivalsResponse.ok)
        throw new Error('Transit source unavailable')
      const rawVehicles = await vehiclesResponse.json()
      const rawArrivals = await arrivalsResponse.json()
      const snapshot = normalizeSnapshot(rawVehicles, rawArrivals)
      if (
        (rawVehicles.length > 0 && snapshot.vehicles.length === 0) ||
        (rawArrivals.length > 0 && snapshot.arrivals.length === 0)
      ) throw new Error('Transit data could not be validated')
      const response = new Response(JSON.stringify(snapshot), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=4, s-maxage=4',
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        },
      })
      context.waitUntil(
        Promise.all([
          cache.put(key, response.clone()),
          cache.put(
            lastGoodKey,
            new Response(JSON.stringify(snapshot), {
              headers: { 'Cache-Control': 'public, max-age=86400' },
            }),
          ),
        ]),
      )
      return response
    } catch {
      const lastGood = await cache.match(lastGoodKey)
      if (lastGood)
        return new Response(lastGood.body, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Transit-Fallback': 'last-good',
          },
        })
      return Response.json(
        { error: 'Live transit is unavailable' },
        {
          status: 502,
          headers: {
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          },
        },
      )
    }
  },
}
