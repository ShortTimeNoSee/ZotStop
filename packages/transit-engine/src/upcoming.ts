import type { Route, Stop } from './index'
import { routeMatchMeters } from './limits'
import { routeProgress } from './rider-signal'

export function upcomingStops(route: Route, point: { lat: number; lon: number }, limit = 5): Stop[] | null {
  const here = routeProgress(route, point)
  if (!here || here.distance > routeMatchMeters) return null
  const placed = route.stops.flatMap(stop => {
    const progress = routeProgress(route, stop)
    return progress ? [{ stop, progress: progress.progress }] : []
  })
  const aheadOf = (progress: number) => {
    const delta = progress - here.progress
    if (delta > 0) return delta
    return here.loop ? delta + here.length : delta
  }
  return placed
    .map(item => ({ stop: item.stop, ahead: aheadOf(item.progress) }))
    .filter(item => item.ahead > 20)
    .sort((a, b) => a.ahead - b.ahead)
    .slice(0, limit)
    .map(item => item.stop)
}
