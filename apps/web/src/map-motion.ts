import { freshness, preciseFixMeters, shownLocationMeters, type Vehicle } from '@zotstop/transit-engine'

export type TrailPoint = { lat: number; lon: number; at: number }
const trailLimit = 6
const trailMinMeters = 12

export function noseLength(scale: number) {
  const far = 28
  const close = 14
  const span = Math.min(1, Math.max(0, (scale - 0.25) / (2.5 - 0.25)))
  return Math.round(far - (far - close) * span)
}

export function nosePlacement(scale: number) {
  const height = noseLength(scale)
  const top = 2 - height
  const originY = 12 + height
  return { height, top, originY, center: top + originY }
}

export function recordTrail(trails: Map<string, TrailPoint[]>, vehicles: Vehicle[], now: number) {
  const next = new Map<string, TrailPoint[]>()
  for (const vehicle of vehicles) {
    if (freshness(vehicle.updatedAt, now) === 'stale') continue
    const prior = trails.get(vehicle.id) ?? []
    const last = prior.at(-1)
    const moved = !last || metersBetween(last, vehicle) >= trailMinMeters
    const points = moved ? [...prior, { lat: vehicle.lat, lon: vehicle.lon, at: vehicle.updatedAt }] : prior
    next.set(vehicle.id, points.slice(-trailLimit))
  }
  return next
}

function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const east = (b.lon - a.lon) * 111320 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  const north = (b.lat - a.lat) * 111320
  return Math.hypot(east, north)
}

export function showAccuracyRing(accuracy?: number) {
  return accuracy != null && Number.isFinite(accuracy) && accuracy > preciseFixMeters && accuracy <= shownLocationMeters
}

export function sheetClearance(
  point: { x: number; y: number },
  sheet: { left: number; top: number; right: number; bottom: number },
  map: { width: number; height: number },
  pad = 28,
) {
  const covered = point.x > sheet.left && point.x < sheet.right && point.y > sheet.top && point.y < sheet.bottom
  if (!covered) return null
  const options = [
    { x: 0, y: sheet.top - pad - point.y },
    { x: 0, y: sheet.bottom + pad - point.y },
    { x: sheet.left - pad - point.x, y: 0 },
    { x: sheet.right + pad - point.x, y: 0 },
  ]
  const fits = options.filter(move => {
    const x = point.x + move.x
    const y = point.y + move.y
    return x >= pad && y >= pad && x <= map.width - pad && y <= map.height - pad
  })
  return (fits.length ? fits : options).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0] ?? null
}
