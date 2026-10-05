import { boardingGuide, routeDescription, type Route, type Stop } from '@zotstop/transit-engine'

const recentKey = 'zotstop-recent-stops'
export const recentStopLimit = 8

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function searchTransit(routes: Route[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return { routes: [] as Route[], stops: [] as { stop: Stop; routes: Route[] }[] }
  const routeHits = routes.filter(route =>
    `${route.name} ${route.letter} ${routeDescription(route)}`.toLowerCase().includes(needle),
  )
  const stops = new Map<string, { stop: Stop; routes: Route[] }>()
  for (const route of routes) {
    for (const stop of route.stops) {
      const guide = boardingGuide(stop)
      const haystack = `${stop.name} ${stop.code} ${guide?.side ?? ''} ${guide?.landmark ?? ''}`.toLowerCase()
      if (!haystack.includes(needle)) continue
      const existing = stops.get(stop.id)
      if (existing) existing.routes.push(route)
      else stops.set(stop.id, { stop, routes: [route] })
    }
  }
  return { routes: routeHits, stops: [...stops.values()] }
}

export function readRecentStops(storage: Store = localStorage) {
  try {
    const value: unknown = JSON.parse(storage.getItem(recentKey) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((id): id is string => typeof id === 'string').slice(0, recentStopLimit)
  } catch {
    return []
  }
}

export function rememberStop(id: string, storage: Store = localStorage) {
  const next = [id, ...readRecentStops(storage).filter(item => item !== id)].slice(0, recentStopLimit)
  storage.setItem(recentKey, JSON.stringify(next))
  return next
}

export function stopsForIds(routes: Route[], ids: string[]) {
  const found: Stop[] = []
  for (const id of ids) {
    for (const route of routes) {
      const stop = route.stops.find(item => item.id === id)
      if (stop) {
        found.push(stop)
        break
      }
    }
  }
  return found
}
