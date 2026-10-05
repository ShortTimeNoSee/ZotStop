import { describe, expect, it } from 'vitest'
import type { Route } from '@zotstop/transit-engine'
import { closestOnLane, laneSpread, parallelRoutes, type Point } from './parallelRoutes'

const route = (id: string, shape: Point[]): Route => ({ id, name: id, letter: id, color: '#000000', shape, stops: [] })
const samePoint = (point: Point) => point

describe('parallel route display', () => {
  it('gives nearby shared roads distinct lanes without moving their source coordinates', () => {
    const routes = [
      route('A', [[0, 0], [90, 0]]),
      route('H', [[0, 2], [90, 2]]),
      route('N', [[0, -2], [90, -2]]),
    ]
    const lanes = parallelRoutes(routes, samePoint)
    expect(lanes.map(lane => lane.points[1].offset)).toEqual([-7, 0, 7])
    expect(lanes.map(lane => lane.points[1].point)).toEqual([[30, 0], [30, 2], [30, -2]])
  })

  it('keeps separate roads centered on their actual geometry', () => {
    const lanes = parallelRoutes([
      route('A', [[0, 0], [90, 0]]),
      route('H', [[0, 50], [90, 50]]),
    ], samePoint)
    expect(lanes.every(lane => lane.points.every(point => point.offset === 0))).toBe(true)
  })

  it('places a nearby report on the drawn line and leaves a distant report alone', () => {
    const [lane] = parallelRoutes([route('M', [[0, 0], [90, 0]])], samePoint)
    const onLine = closestOnLane(lane, [40, 12], 35)
    expect(onLine?.point[0]).toBeCloseTo(40)
    expect(onLine?.point[1]).toBeCloseTo(0)
    expect(onLine?.offset).toBe(0)
    expect(closestOnLane(lane, [40, 90], 35)).toBeNull()
    expect(laneSpread(0.4)).toBe(1)
    expect(laneSpread(1.2)).toBe(0)
    expect(laneSpread(0.85)).toBeGreaterThan(0)
    expect(laneSpread(0.85)).toBeLessThan(1)
  })

  it('recognizes opposing traffic on a shared road', () => {
    const lanes = parallelRoutes([
      route('A', [[0, 0], [90, 0]]),
      route('H', [[90, 2], [0, 2]]),
    ], samePoint)
    expect(lanes[0].points[1].offset).toBe(-3.5)
    expect(lanes[1].points[1].offset).toBe(3.5)
  })
})
