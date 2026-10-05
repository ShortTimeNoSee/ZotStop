import type { Route } from './index'
import { preciseFixMeters } from './limits'
import { routeProgress } from './rider-signal'

export type RideStage = 'off-route' | 'waiting' | 'riding' | 'soon' | 'now' | 'passed'
export type RidePoint = { progress: number; at: number }
export type RideFix = { lat: number; lon: number; accuracy?: number; at: number; reportedAt?: number }
export type RideSource = 'phone' | 'bus'
export type ReportedBus = { id: string; name?: string; routeId: string; lat: number; lon: number; updatedAt: number; uncertaintyMeters?: number }
export type RideGuidance = {
  stage: RideStage
  message: string
  destinationName: string
  alongMeters: number | null
  stopsAway: number | null
}

const assumedAccuracyMeters = preciseFixMeters
const directionWindowMs = 25_000
const minimumForwardMeters = 18
const stopClearanceMeters = 30

function forward(from: number, to: number, length: number, loop: boolean) {
  if (length <= 0) return Infinity
  if (!loop) return to + 0.5 >= from ? to - from : Infinity
  return ((to - from) % length + length) % length
}

function backward(from: number, to: number, length: number, loop: boolean) {
  if (length <= 0) return Infinity
  if (!loop) return from >= to - 0.5 ? from - to : Infinity
  return ((from - to) % length + length) % length
}

function approachMeters(length: number, loop: boolean, progresses: number[], accuracy: number) {
  const ordered = [...progresses].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let index = 1; index < ordered.length; index++) gaps.push(ordered[index] - ordered[index - 1])
  if (loop && ordered.length > 1) gaps.push(length - ordered[ordered.length - 1] + ordered[0])
  const usable = gaps.filter(gap => gap > 20).sort((a, b) => a - b)
  const median = usable.length ? usable[Math.floor((usable.length - 1) / 2)] : 180
  const now = Math.min(220, Math.max(80, median * 0.4))
  const slack = Math.min(40, Math.max(0, accuracy - 12))
  return { now: now + slack, soon: Math.min(median * 0.9, now * 2.4 + slack) }
}

export function rideGuidance(
  route: Route,
  destinationStopId: string,
  fix: RideFix | null,
  history: RidePoint[],
  previousStage: RideStage | null,
  backgrounded: boolean,
  source: RideSource = 'phone',
): { guidance: RideGuidance; history: RidePoint[]; rememberedStage: RideStage | null } {
  const destination = route.stops.find(stop => stop.id === destinationStopId)
  const destinationName = destination?.name ?? 'your stop'
  const idle = (message: string): { guidance: RideGuidance; history: RidePoint[]; rememberedStage: RideStage | null } => ({
    guidance: { stage: 'waiting', message, destinationName, alongMeters: null, stopsAway: null },
    history,
    rememberedStage: previousStage,
  })
  if (!destination) return idle('That stop is not on this route.')
  if (!fix) return idle(backgrounded ? 'The ride alert continues in the notification.' : 'Finding your location.')

  const accuracy = Number.isFinite(fix.accuracy) ? Math.max(0, fix.accuracy!) : assumedAccuracyMeters
  const matched = routeProgress(route, fix)
  const onRouteLimit = Math.min(75, Math.max(40, accuracy + 20))
  if (!matched || matched.distance > onRouteLimit) {
    return {
      guidance: { stage: 'off-route', message: source === 'bus' ? `The bus you selected is not on the ${route.letter} Line shape.` : `You are not on the ${route.letter} Line yet.`, destinationName, alongMeters: null, stopsAway: null },
      history: history.filter(sample => fix.at - sample.at <= directionWindowMs && sample.at <= fix.at),
      rememberedStage: previousStage,
    }
  }

  const placed = route.stops.flatMap(stop => {
    const point = routeProgress(route, stop)
    return point ? [{ stop, progress: point.progress }] : []
  })
  const destinationProgress = placed.find(item => item.stop.id === destination.id)?.progress
  if (destinationProgress === undefined) return idle('That stop is not on this route.')
  const { now, soon } = approachMeters(matched.length, matched.loop, placed.map(item => item.progress), accuracy)
  const ahead = forward(matched.progress, destinationProgress, matched.length, matched.loop)
  const behind = backward(matched.progress, destinationProgress, matched.length, matched.loop)
  const stopsAway = placed.filter(item => {
    const remaining = forward(matched.progress, item.progress, matched.length, matched.loop)
    return remaining > stopClearanceMeters && remaining <= ahead + 1
  }).length
  const prior = history.filter(sample => fix.at - sample.at <= directionWindowMs && sample.at < fix.at)
  const oldest = prior[0]
  let movement = oldest ? matched.progress - oldest.progress : 0
  if (matched.loop && oldest) {
    if (movement < -matched.length / 2) movement += matched.length
    if (movement > matched.length / 2) movement -= matched.length
  }
  const direction = !oldest ? 'unknown' : movement > Math.max(minimumForwardMeters, accuracy * 0.8) ? 'forward' : movement < -Math.max(minimumForwardMeters, accuracy * 0.8) ? 'reverse' : 'unknown'
  const nextHistory = [...prior, { progress: matched.progress, at: fix.at }]

  const previous = prior.at(-1)
  const previousAhead = previous ? forward(previous.progress, destinationProgress, matched.length, matched.loop) : null
  let stage: RideStage = 'riding'
  let message = stopsAway === 1 ? `Next stop is ${destinationName}.` : `${stopsAway} stops to ${destinationName}.`
  if (previousStage === 'passed' && ahead > soon) {
    stage = 'passed'
    message = `You may have passed ${destinationName}.`
  } else if (ahead <= now && accuracy <= 80 && ahead <= behind) {
    stage = 'now'
    message = `Get off at ${destinationName}.`
  } else if (behind <= now && accuracy <= 80) {
    stage = 'passed'
    message = `You may have passed ${destinationName}.`
  } else if (direction === 'reverse') {
    stage = 'waiting'
    message = `The ${route.letter} Line runs the other way.`
  } else if (accuracy > 80 && ahead <= soon) {
    stage = 'soon'
    message = `Near ${destinationName}. Location is too approximate for a get-off alert.`
  } else if ((previousStage === 'now' || previousStage === 'soon') && previousAhead !== null && previousAhead <= now && ahead > previousAhead + 20 && behind < now) {
    stage = 'passed'
    message = `You may have passed ${destinationName}.`
  } else if (ahead <= soon || stopsAway <= 1) {
    stage = 'soon'
    message = stopsAway <= 1 ? `Next stop is ${destinationName}.` : `Your stop is soon. ${destinationName}.`
  } else if (direction !== 'forward' && source !== 'bus') {
    stage = 'waiting'
    message = `Finding your direction on the ${route.letter} Line.`
  }
  const reportAgeMs = fix.reportedAt == null ? 0 : fix.at - fix.reportedAt
  if (source === 'bus' && reportAgeMs > 90_000 && (stage === 'now' || stage === 'passed')) {
    stage = 'soon'
    message = `Reported near ${destinationName}, but this position is too old to trust. Check the bus itself.`
  }

  return {
    guidance: { stage, message, destinationName, alongMeters: Number.isFinite(ahead) ? ahead : null, stopsAway },
    history: nextHistory,
    rememberedStage: stage,
  }
}

const nearStage = (stage: RideStage) => stage === 'soon' || stage === 'now' || stage === 'passed'
const urgentStage = (stage: RideStage) => stage === 'now' || stage === 'passed'
const stageRank: Record<RideStage, number> = { waiting: 0, 'off-route': 0, riding: 1, soon: 2, now: 3, passed: 3 }

export function rideLimits(route: Route) {
  const origin = route.stops[0] ?? (route.shape[0] ? { lon: route.shape[0][0], lat: route.shape[0][1] } : null)
  const point = origin ? routeProgress(route, origin) : null
  if (!point) return { nowMeters: 80, soonMeters: 192, loop: false }
  const placed = route.stops.flatMap(stop => {
    const progress = routeProgress(route, stop)
    return progress ? [progress.progress] : []
  })
  const limits = approachMeters(point.length, point.loop, placed, 12)
  return { nowMeters: limits.now, soonMeters: limits.soon, loop: point.loop }
}

export function reportedBusesNear(route: Route, phone: { lat: number; lon: number; accuracy?: number }, buses: ReportedBus[], now = Date.now()) {
  const matched = routeProgress(route, phone)
  const accuracy = Number.isFinite(phone.accuracy) ? Math.max(0, phone.accuracy!) : assumedAccuracyMeters
  const onRouteLimit = Math.min(75, Math.max(40, accuracy + 20))
  if (!matched || matched.distance > onRouteLimit) return []
  const placed = route.stops.flatMap(stop => {
    const point = routeProgress(route, stop)
    return point ? [point.progress] : []
  })
  const limit = approachMeters(matched.length, matched.loop, placed, accuracy).now
  return buses.filter(bus => {
    if (bus.routeId !== route.id || now - bus.updatedAt > 90_000) return false
    const busMatch = routeProgress(route, bus)
    if (!busMatch || busMatch.distance > onRouteLimit) return false
    const separation = Math.min(
      forward(matched.progress, busMatch.progress, matched.length, matched.loop),
      backward(matched.progress, busMatch.progress, matched.length, matched.loop),
    )
    return separation <= limit
  })
}

export function fuseRideGuidance(
  route: Route,
  destinationStopId: string,
  phone: RideFix | null,
  bus: RideFix | null,
  history: RidePoint[],
  previousStage: RideStage | null,
  backgrounded: boolean,
) {
  const phoneResult = phone ? rideGuidance(route, destinationStopId, phone, history, previousStage, backgrounded, 'phone') : null
  const busResult = bus ? rideGuidance(route, destinationStopId, bus, [], null, false, 'bus') : null
  if (!phoneResult) {
    return busResult ? { ...busResult, used: 'bus' as const } : {
      guidance: { stage: 'waiting' as const, message: backgrounded ? 'The ride alert continues in the notification.' : 'Finding your location.', destinationName: route.stops.find(stop => stop.id === destinationStopId)?.name ?? 'your stop', alongMeters: null, stopsAway: null },
      history,
      rememberedStage: previousStage,
      used: 'phone' as const,
    }
  }
  if (!busResult) return { ...phoneResult, used: 'phone' as const }
  const phoneStage = phoneResult.guidance.stage
  const busStage = busResult.guidance.stage
  if ((urgentStage(phoneStage) && !nearStage(busStage)) || (urgentStage(busStage) && !nearStage(phoneStage))) {
    const destinationName = phoneResult.guidance.destinationName
    return {
      guidance: { ...phoneResult.guidance, stage: 'soon' as const, message: `Your phone and the reported bus do not agree. Check ${destinationName} before you get off.` },
      history: phoneResult.history,
      rememberedStage: 'soon' as const,
      used: 'both' as const,
    }
  }
  const chosen = stageRank[busStage] > stageRank[phoneStage] ? busResult.guidance : phoneResult.guidance
  return {
    guidance: chosen,
    history: phoneResult.history,
    rememberedStage: chosen.stage,
    used: 'both' as const,
  }
}
