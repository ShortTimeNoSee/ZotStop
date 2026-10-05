import type { Route } from '@zotstop/transit-engine'

export type Point = [number, number]
export type LanePoint = { point: Point; normal: Point; offset: number }
export type RouteLane = { route: Route; points: LanePoint[] }

export function laneSpread(scale: number) {
  return Math.max(0, Math.min(1, (1.2 - scale) / 0.7))
}

export function closestOnLane(lane: RouteLane, world: Point, maxDistance: number): LanePoint | null {
  const points = lane.points
  if (!points.length) return null
  let best: LanePoint | null = null
  let bestDistance = maxDistance
  const consider = (point: Point, normal: Point, offset: number) => {
    const distance = Math.hypot(world[0] - point[0], world[1] - point[1])
    if (distance > bestDistance) return
    bestDistance = distance
    const length = Math.hypot(normal[0], normal[1]) || 1
    best = { point, normal: [normal[0] / length, normal[1] / length], offset }
  }
  if (points.length === 1) {
    consider(points[0].point, points[0].normal, points[0].offset)
    return best
  }
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    const dx = to.point[0] - from.point[0]
    const dy = to.point[1] - from.point[1]
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared ? Math.max(0, Math.min(1, ((world[0] - from.point[0]) * dx + (world[1] - from.point[1]) * dy) / lengthSquared)) : 0
    consider(
      [from.point[0] + t * dx, from.point[1] + t * dy],
      [from.normal[0] + (to.normal[0] - from.normal[0]) * t, from.normal[1] + (to.normal[1] - from.normal[1]) * t],
      from.offset + (to.offset - from.offset) * t,
    )
  }
  return best
}

type Segment = { from: Point; to: Point; direction: Point }
type WorkingRoute = { route: Route; segments: Segment[]; samples: { point: Point; direction: Point }[] }

function distanceToSegment(point: Point, segment: Segment) {
  const dx = segment.to[0] - segment.from[0]
  const dy = segment.to[1] - segment.from[1]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - segment.from[0]) * dx + (point[1] - segment.from[1]) * dy) / lengthSquared)) : 0
  return Math.hypot(point[0] - segment.from[0] - t * dx, point[1] - segment.from[1] - t * dy)
}

function prepare(route: Route, toWorld: (point: Point) => Point): WorkingRoute {
  const path = route.shape.map(toWorld)
  const segments: Segment[] = []
  const samples: WorkingRoute['samples'] = []
  for (let index = 1; index < path.length; index++) {
    const from = path[index - 1]
    const to = path[index]
    const dx = to[0] - from[0]
    const dy = to[1] - from[1]
    const length = Math.hypot(dx, dy)
    if (length < 0.01) continue
    const direction: Point = [dx / length, dy / length]
    segments.push({ from, to, direction })
    const steps = Math.ceil(length / 30)
    for (let step = 0; step < steps; step++) {
      const t = step / steps
      samples.push({ point: [from[0] + t * dx, from[1] + t * dy], direction })
    }
  }
  if (segments.length) samples.push({ point: segments.at(-1)!.to, direction: segments.at(-1)!.direction })
  return { route, segments, samples }
}

export function parallelRoutes(routes: Route[], toWorld: (point: Point) => Point): RouteLane[] {
  const working = routes.map(route => prepare(route, toWorld))
  return working.map((current, currentIndex) => ({
    route: current.route,
    points: current.samples.map(sample => {
      const group = [currentIndex]
      const directions = new Map<number, Point>([[currentIndex, sample.direction]])
      for (let routeIndex = 0; routeIndex < working.length; routeIndex++) {
        if (routeIndex === currentIndex) continue
        let nearest = 14
        let direction: Point | null = null
        for (const segment of working[routeIndex].segments) {
          if (Math.abs(sample.direction[0] * segment.direction[0] + sample.direction[1] * segment.direction[1]) < 0.82) continue
          const distance = distanceToSegment(sample.point, segment)
          if (distance < nearest) {
            nearest = distance
            direction = segment.direction
          }
        }
        if (direction) {
          group.push(routeIndex)
          directions.set(routeIndex, direction)
        }
      }
      group.sort((a, b) => a - b)
      const anchor = directions.get(group[0])!
      return {
        point: sample.point,
        normal: [-anchor[1], anchor[0]] as Point,
        offset: (group.indexOf(currentIndex) - (group.length - 1) / 2) * 7,
      }
    }),
  }))
}
