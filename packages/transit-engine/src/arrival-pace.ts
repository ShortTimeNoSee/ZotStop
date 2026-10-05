import type { Route, TimingSegment, Vehicle } from './index'
import { routeProgress } from './rider-signal'

type Passage = { stopId: string; at: number }
type PaceState = {
  at: number
  progress: number
  passage?: Passage
  ratios: number[]
  ratioAt?: number
}

const maximumGapMs = 90_000
const maximumRouteDistanceMeters = 50
const maximumPaceAgeMs = 15 * 60_000
const terminalRadiusMeters = 35
const stateRetentionMs = 20 * 60_000

function weightedPace(state: PaceState, now: number) {
  if (!state.ratioAt || now - state.ratioAt > maximumPaceAgeMs) return undefined
  const weighted = state.ratios.reduce((sum, ratio, index) => sum + ratio * (index + 1), 0)
  const weights = state.ratios.reduce((sum, _, index) => sum + index + 1, 0)
  return weights ? weighted / weights : undefined
}

function segmentFor(segments: TimingSegment[], fromStopId: string, toStopId: string) {
  return segments.find(segment => segment.fromStopId === fromStopId && segment.toStopId === toStopId)
}

function parkedAtTerminal(vehicle: Vehicle, route: Route, loop: boolean) {
  if (vehicle.speedKph >= 1.6 || !route.stops.length) return false
  const terminals = loop ? [route.stops[0]] : [route.stops[0], route.stops.at(-1)!]
  return terminals.some(stop => {
    const north = Math.abs(vehicle.lat - stop.lat) * 111_320
    const east = Math.abs(vehicle.lon - stop.lon) * 111_320 * Math.cos(stop.lat * Math.PI / 180)
    return Math.hypot(east, north) <= terminalRadiusMeters
  })
}

export class ArrivalPaceTracker {
  private states = new Map<string, PaceState>()

  prune(now: number) {
    let removed = 0
    for (const [key, state] of this.states) {
      if (now - state.at <= stateRetentionMs) continue
      this.states.delete(key)
      removed++
    }
    return removed
  }

  update(vehicle: Vehicle, route: Route): number | undefined {
    const segments = route.timingSegments ?? []
    if (!segments.length) return undefined
    const position = routeProgress(route, vehicle)
    if (!position || position.distance > maximumRouteDistanceMeters) return undefined
    const key = `${vehicle.routeId}:${vehicle.id}`
    if (parkedAtTerminal(vehicle, route, position.loop)) {
      this.states.set(key, { at: vehicle.updatedAt, progress: position.progress, ratios: [] })
      return undefined
    }
    const previous = this.states.get(key)
    if (!previous || vehicle.updatedAt <= previous.at || vehicle.updatedAt - previous.at > maximumGapMs) {
      this.states.set(key, { at: vehicle.updatedAt, progress: position.progress, ratios: [] })
      return undefined
    }

    let progress = position.progress
    if (position.loop && progress + position.length / 2 < previous.progress) progress += position.length
    const movement = progress - previous.progress
    const elapsed = vehicle.updatedAt - previous.at
    const state = { ...previous, at: vehicle.updatedAt, progress }
    if (movement <= 0 || movement > Math.max(2000, elapsed * 0.03)) {
      this.states.set(key, state)
      return weightedPace(state, vehicle.updatedAt)
    }

    const stopIds = new Set(segments.flatMap(segment => [segment.fromStopId, segment.toStopId]))
    const crossings: { stopId: string; progress: number }[] = []
    for (const stop of route.stops) {
      if (!stopIds.has(stop.id)) continue
      const stopPosition = routeProgress(route, stop)
      if (!stopPosition) continue
      const cycle = position.loop ? Math.floor(previous.progress / position.length) : 0
      for (const candidate of position.loop
        ? [stopPosition.progress + cycle * position.length, stopPosition.progress + (cycle + 1) * position.length]
        : [stopPosition.progress]) {
        if (candidate > previous.progress && candidate <= progress) crossings.push({ stopId: stop.id, progress: candidate })
      }
    }
    crossings.sort((left, right) => left.progress - right.progress)

    for (const crossing of crossings) {
      const at = previous.at + elapsed * ((crossing.progress - previous.progress) / movement)
      if (state.passage) {
        const segment = segmentFor(segments, state.passage.stopId, crossing.stopId)
        const actualSeconds = (at - state.passage.at) / 1000
        if (segment && actualSeconds >= segment.scheduledSeconds * 0.5 && actualSeconds <= segment.scheduledSeconds * 2.5) {
          state.ratios = [...state.ratios, Math.max(0.7, Math.min(1.75, actualSeconds / segment.scheduledSeconds))].slice(-3)
          state.ratioAt = at
        }
      }
      state.passage = { stopId: crossing.stopId, at }
    }
    this.states.set(key, state)
    return weightedPace(state, vehicle.updatedAt)
  }
}
