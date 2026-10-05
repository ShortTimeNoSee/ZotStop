import type { Route } from './index'

const earth = 6371000
const radians = Math.PI / 180

export function routeProgress(route: Route, point: { lat: number; lon: number }) {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || route.shape.length < 2) return null
  const east = earth * radians * Math.cos(point.lat * radians)
  const north = earth * radians
  let best = { distance: Infinity, progress: 0 }
  let length = 0
  for (let index = 1; index < route.shape.length; index++) {
    const [ax, ay] = route.shape[index - 1]
    const [bx, by] = route.shape[index]
    const dx = (bx - ax) * east
    const dy = (by - ay) * north
    const segment = Math.hypot(dx, dy)
    if (segment < 0.01) continue
    const t = Math.max(0, Math.min(1, ((point.lon - ax) * east * dx + (point.lat - ay) * north * dy) / (segment * segment)))
    const distance = Math.hypot((point.lon - ax) * east - t * dx, (point.lat - ay) * north - t * dy)
    if (distance < best.distance) best = { distance, progress: length + segment * t }
    length += segment
  }
  const first = route.shape[0]
  const last = route.shape.at(-1)!
  const loop = Math.hypot((first[0] - last[0]) * east, (first[1] - last[1]) * north) < 100
  return Number.isFinite(best.distance) ? { ...best, length, loop } : null
}

export function pointAtProgress(route: Route, progress: number) {
  let distance = 0
  for (let index = 1; index < route.shape.length; index++) {
    const [ax, ay] = route.shape[index - 1]
    const [bx, by] = route.shape[index]
    const segment = Math.hypot((bx - ax) * earth * radians * Math.cos(ay * radians), (by - ay) * earth * radians)
    if (distance + segment >= progress) {
      const t = segment ? Math.max(0, Math.min(1, (progress - distance) / segment)) : 0
      return { lon: ax + (bx - ax) * t, lat: ay + (by - ay) * t }
    }
    distance += segment
  }
  const [lon, lat] = route.shape.at(-1) ?? [0, 0]
  return { lon, lat }
}
