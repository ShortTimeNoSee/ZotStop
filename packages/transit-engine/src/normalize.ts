import { routeIdFromNumber, stopIdFromNumber, type Snapshot, type Vehicle, type Arrival } from './index'
import feed from '../assets/routes.min.json'

const points = feed.routes.flatMap(route => route.shape)
const bounds = { south: Math.min(...points.map(point => point[1])) - 0.05, north: Math.max(...points.map(point => point[1])) + 0.05, west: Math.min(...points.map(point => point[0])) - 0.05, east: Math.max(...points.map(point => point[0])) + 0.05 }

const timestamp = (value: unknown, reference: number, maxFuture: number): number | null => {
  if (typeof value !== 'string') return null
  const match = /\/Date\((\d+)([+-])(\d{2})(\d{2})\)/.exec(value)
  const plain = /\/Date\((\d+)\)/.exec(value)
  if (!match && !plain) return null
  const time = Number((match || plain)![1])
  if (match && time > reference + maxFuture) {
    const offset = (Number(match[3]) * 60 + Number(match[4])) * 60_000
    const corrected = time + (match[2] === '-' ? -offset : offset)
    if (corrected >= reference - 15 * 60_000 && corrected <= reference + maxFuture) return corrected
  }
  return time
}

export function normalizeSnapshot(rawVehicles: unknown, rawArrivals: unknown, fetchedAt = Date.now()): Snapshot {
  if (!Array.isArray(rawVehicles) || !Array.isArray(rawArrivals)) throw new Error('Unexpected transit response')
  const vehicles: Vehicle[] = rawVehicles.flatMap((item): Vehicle[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const updatedAt = timestamp(row.TimeStamp, fetchedAt, 30_000)
    const lat = Number(row.Latitude)
    const lon = Number(row.Longitude)
    const routeId = Number(row.RouteID)
    const id = Number(row.VehicleID)
    const name = typeof row.Name === 'string' ? row.Name.trim() : ''
    if (!updatedAt || !Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(routeId) || !Number.isFinite(id)) return []
    if (lat < bounds.south || lat > bounds.north || lon < bounds.west || lon > bounds.east || updatedAt > fetchedAt + 30_000 || fetchedAt - updatedAt > 15 * 60 * 1000) return []
    return [{
      id: String(id),
      ...(name ? { name } : {}),
      ...(row.IsDelayed === true ? { delayed: true } : {}),
      ...(typeof row.IsOnRoute === 'boolean' ? { onRoute: row.IsOnRoute } : {}),
      routeId: routeIdFromNumber(routeId),
      lat,
      lon,
      heading: Number(row.Heading) || 0,
      speedKph: Number(row.GroundSpeed) || 0,
      updatedAt,
    }]
  })
  const arrivals: Arrival[] = rawArrivals.flatMap((item): Arrival[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const route = Number(row.RouteId)
    const stop = Number(row.StopId)
    if (!Number.isFinite(route) || !Number.isFinite(stop) || !Array.isArray(row.Times)) return []
    return row.Times.flatMap((entry): Arrival[] => {
      if (!entry || typeof entry !== 'object') return []
      const time = entry as Record<string, unknown>
      const estimatedAt = timestamp(time.EstimateTime, fetchedAt, 90 * 60_000)
      const vehicleId = Number(time.VehicleId)
      if (!estimatedAt || !Number.isFinite(vehicleId) || estimatedAt < fetchedAt - 60_000 || estimatedAt > fetchedAt + 90 * 60_000) return []
      return [{ routeId: routeIdFromNumber(route), stopId: stopIdFromNumber(stop), vehicleId: String(vehicleId), estimatedAt }]
    })
  })
  return { fetchedAt, vehicles, arrivals }
}
