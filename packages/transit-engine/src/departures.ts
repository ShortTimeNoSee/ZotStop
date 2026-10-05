import { distanceMeters, fleetNumber, formatArrival, type Route, type Snapshot, type Stop } from './index'
import { campusCenter, nearbyWalkMeters } from './limits'

export type Departure = { route: Route; label: string; fleetNumber: string | null }
export type DepartureGroup = { stop: Stop; distance: number; departures: Departure[] }

export function departureBoard(
  routes: Route[],
  snapshot: Snapshot | null,
  origin: { lat: number; lon: number } | null,
  now: number,
): { nearYou: boolean; stops: DepartureGroup[] } {
  const center = origin ?? campusCenter
  const groups = new Map<string, DepartureGroup>()
  for (const route of routes) {
    for (const stop of route.stops) {
      const distance = distanceMeters(center, stop)
      if (distance > nearbyWalkMeters) continue
      let group = groups.get(stop.id)
      if (!group) {
        group = { stop, distance, departures: [] }
        groups.set(stop.id, group)
      }
      const arrival = snapshot?.arrivals
        .filter(item => item.routeId === route.id && item.stopId === stop.id)
        .sort((a, b) => a.estimatedAt - b.estimatedAt)[0]
      const vehicle = arrival
        ? snapshot?.vehicles.find(item => item.id === arrival.vehicleId && item.routeId === route.id)
        : undefined
      group.departures.push({
        route,
        label: arrival && vehicle
          ? formatArrival(arrival.estimatedAt, vehicle.updatedAt, now, vehicle.paceRatio)
          : 'Time unavailable',
        fleetNumber: vehicle ? fleetNumber(vehicle) : null,
      })
    }
  }
  return {
    nearYou: origin !== null,
    stops: [...groups.values()].sort((a, b) => a.distance - b.distance || a.stop.name.localeCompare(b.stop.name)),
  }
}
