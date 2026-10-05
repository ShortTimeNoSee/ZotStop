import { describe, expect, it } from 'vitest'
import { ArrivalPaceTracker, VehicleTracker } from '@zotstop/transit-engine'
import type { Route, Vehicle } from '@zotstop/transit-engine'

const route: Route = {
  id: 'r',
  letter: 'R',
  name: 'Route',
  color: '#000',
  shape: [[-117.84, 33.64], [-117.83, 33.64]],
  stops: [
    { id: 'a', code: '1', name: 'Terminal', lon: -117.84, lat: 33.64 },
    { id: 'b', code: '2', name: 'Timing point', lon: -117.838, lat: 33.64 },
    { id: 'c', code: '3', name: 'Next timing point', lon: -117.836, lat: 33.64 },
  ],
  timingSegments: [{ fromStopId: 'b', toStopId: 'c', scheduledSeconds: 90 }],
}
const vehicle: Vehicle = { id: '1', routeId: 'r', lat: 33.6401, lon: -117.838, heading: 90, speedKph: 16, updatedAt: 100000 }

describe('vehicle tracking', () => {
  it('snaps nearby noise and rejects distant observations', () => {
    const tracker = new VehicleTracker()
    expect(tracker.update(vehicle, route).lat).toBeCloseTo(33.64, 5)
    expect(tracker.update({ ...vehicle, lat: 33.65, updatedAt: 108000 }, route).snapped).toBeUndefined()
  })
  it('keeps a coherent state across observations', () => {
    const tracker = new VehicleTracker()
    tracker.update(vehicle, route)
    const next = tracker.update({ ...vehicle, lon: -117.8376, updatedAt: 108000 }, route)
    expect(next.snapped).toBe(true)
    expect(next.lon).toBeGreaterThan(vehicle.lon)
    expect(next.uncertaintyMeters).toBeGreaterThan(0)
  })

  it('returns uncertainty to the baseline while parked at a terminal', () => {
    const tracker = new VehicleTracker()
    tracker.update(vehicle, route)
    const moving = tracker.update({ ...vehicle, lon: -117.837, updatedAt: 170000 }, route)
    expect(moving.uncertaintyMeters).toBeGreaterThan(15)
    const parked = tracker.update({ ...vehicle, lon: -117.83999, speedKph: 0.3, updatedAt: 240000 }, route)
    expect(parked.uncertaintyMeters).toBe(15)
    expect(parked.lon).toBeCloseTo(-117.83999, 4)
    const stillParked = tracker.update({ ...vehicle, lon: -117.83998, speedKph: 0, updatedAt: 310000 }, route)
    expect(stillParked.uncertaintyMeters).toBe(15)
  })

  it('removes vehicles that have not reported for 20 minutes', () => {
    const tracker = new VehicleTracker()
    tracker.update(vehicle, route)
    tracker.update({ ...vehicle, id: '2' }, route)
    expect(tracker.prune(vehicle.updatedAt + 20 * 60_000)).toBe(0)
    expect(tracker.prune(vehicle.updatedAt + 20 * 60_000 + 1)).toBe(2)
  })

  it('uses heading to disambiguate nearby opposing route segments while moving', () => {
    const opposingRoute: Route = {
      ...route,
      shape: [
        [-117.84, 33.64],
        [-117.83, 33.64],
        [-117.83, 33.6401],
        [-117.84, 33.6401],
        [-117.84, 33.641],
      ],
    }
    const observation = {
      ...vehicle,
      lon: -117.835,
      lat: 33.64004,
      heading: 270,
    }
    expect(new VehicleTracker().update(observation, opposingRoute).lat).toBeCloseTo(33.6401, 5)
    expect(new VehicleTracker().update({ ...observation, speedKph: 0 }, opposingRoute).lat).toBeCloseTo(33.64, 5)
  })

  it('rejects route progress outside the physically reachable window', () => {
    const tracker = new VehicleTracker()
    tracker.update({ ...vehicle, lon: -117.839 }, route)
    const impossible = tracker.update(
      { ...vehicle, lon: -117.833, updatedAt: vehicle.updatedAt + 15_000 },
      route,
    )
    expect(impossible.snapped).toBeUndefined()
    expect(impossible.lon).toBe(-117.833)
    expect(
      tracker.update(
        { ...vehicle, lon: -117.838, updatedAt: vehicle.updatedAt + 30_000 },
        route,
      ).snapped,
    ).toBe(true)
  })
})

describe('arrival pace tracking', () => {
  it('detects sustained segment slowdown from stop crossings', () => {
    const tracker = new ArrivalPaceTracker()
    const update = (lon: number, updatedAt: number) => tracker.update({ ...vehicle, lon, updatedAt }, route)
    expect(update(-117.839, 100000)).toBeUndefined()
    expect(update(-117.8379, 130000)).toBeUndefined()
    expect(update(-117.837, 180000)).toBeUndefined()
    expect(update(-117.8359, 250000)).toBeGreaterThan(1.15)
  })

  it('drops incomplete evidence after a telemetry gap', () => {
    const tracker = new ArrivalPaceTracker()
    tracker.update({ ...vehicle, lon: -117.839, updatedAt: 100000 }, route)
    tracker.update({ ...vehicle, lon: -117.8379, updatedAt: 130000 }, route)
    expect(tracker.update({ ...vehicle, lon: -117.8359, updatedAt: 240001 }, route)).toBeUndefined()
  })

  it('removes stale segment histories', () => {
    const tracker = new ArrivalPaceTracker()
    tracker.update(vehicle, route)
    tracker.update({ ...vehicle, id: '2' }, route)
    expect(tracker.prune(vehicle.updatedAt + 20 * 60_000 + 1)).toBe(2)
    expect(tracker.prune(vehicle.updatedAt + 40 * 60_000)).toBe(0)
  })
})
