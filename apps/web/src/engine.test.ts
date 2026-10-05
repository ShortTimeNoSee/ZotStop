import { describe, expect, it } from 'vitest'
import { ageSeconds, fleetNumber, formatArrival, freshness, routeBadgeInk, serviceState } from '@zotstop/transit-engine'
import { normalizeSnapshot } from '../../../packages/transit-engine/src/normalize'
import routes from '../../../packages/transit-engine/assets/routes.min.json'

describe('transit trust rules', () => {
  const now = Date.parse('2026-09-22T17:00:00Z')

  it('withholds a countdown when a vehicle has not reported recently', () => {
    expect(freshness(now - 19_000, now)).toBe('fresh')
    expect(freshness(now - 21_000, now)).toBe('aging')
    expect(freshness(now - 91_000, now)).toBe('stale')
    expect(formatArrival(now + 5 * 60000, now - 91_000, now)).toBe('Time unavailable')
    expect(ageSeconds(now - 19_000, now)).toBe(19)
  })

  it('widens fresh downstream estimates only when measured travel is slowing', () => {
    expect(formatArrival(now + 5 * 60000, now - 4_000, now, 1.3)).toBe('4\u20137 min')
    expect(formatArrival(now + 5 * 60000, now - 4_000, now, 1.1)).toBe('5 min')
    expect(formatArrival(now + 5 * 60000, now - 30_000, now, 1.3)).toBe('About 5 min')
  })

  it('filters old upstream estimates while retaining current buses', () => {
    const output = normalizeSnapshot([{ VehicleID: 12, RouteID: 7, Latitude: 33.646, Longitude: -117.824, Heading: 90, GroundSpeed: 36, TimeStamp: `/Date(${now - 4000})/` }], [{ RouteId: 7, StopId: 2, Times: [{ VehicleId: 12, EstimateTime: `/Date(${now - 6 * 3600000})/` }] }], now)
    expect(output.vehicles).toHaveLength(1)
    expect(output.vehicles[0].speedKph).toBe(36)
    expect(output.vehicles[0].name).toBeUndefined()
    expect(output.arrivals).toHaveLength(0)
  })

  it('keeps the printed fleet name, which is not the route or the operator id', () => {
    const output = normalizeSnapshot(
      [
        { VehicleID: 12, Name: ' AE-09 ', RouteID: 7, Latitude: 33.646, Longitude: -117.824, Heading: 90, GroundSpeed: 10, TimeStamp: `/Date(${now - 4000})/`, IsDelayed: true, IsOnRoute: false },
        { VehicleID: 14, Name: 'AE-14', RouteID: 5, Latitude: 33.649, Longitude: -117.838, Heading: 180, GroundSpeed: 12, TimeStamp: `/Date(${now + 6 * 3600000 - 2000}-0600)/` },
      ],
      [],
      now,
    )
    expect(output.vehicles.map(vehicle => [vehicle.id, vehicle.name, vehicle.routeId])).toEqual([
      ['12', 'AE-09', 'TL-7'],
      ['14', 'AE-14', 'TL-5'],
    ])
    expect(output.vehicles[0].delayed).toBe(true)
    expect(output.vehicles[0].onRoute).toBe(false)
    expect(output.vehicles[1].updatedAt).toBe(now - 2000)
    expect(output.vehicles.map(fleetNumber)).toEqual(['09', '14'])
    expect(fleetNumber({ name: '12' })).toBe('12')
    expect(fleetNumber({})).toBeNull()
  })

  it('corrects the upstream vehicle clock without changing UTC arrival estimates', () => {
    const output = normalizeSnapshot(
      [{ VehicleID: 12, RouteID: 7, Latitude: 33.646, Longitude: -117.824, TimeStamp: `/Date(${now + 6 * 3600000 - 4000}-0600)/` }],
      [{ RouteId: 7, StopId: 2, Times: [{ VehicleId: 12, EstimateTime: `/Date(${now + 5 * 60000})/` }] }],
      now,
    )
    expect(output.vehicles[0].updatedAt).toBe(now - 4000)
    expect(output.arrivals[0].estimatedAt).toBe(now + 5 * 60000)
    expect(freshness(now + 6 * 3600000, now)).toBe('stale')
  })

  it('switches to evening routes at the published hour', () => {
    expect(serviceState(new Date('2026-09-22T18:00:00Z')).active).toEqual(['A', 'E', 'M', 'N'])
    expect(serviceState(new Date('2026-09-23T02:00:00Z')).active).toEqual(['H', 'M'])
    expect(serviceState(new Date('2026-09-26T18:00:00Z')).active).toEqual([])
    expect(serviceState(new Date('2026-11-11T18:00:00Z')).message).toBe('No service today')
  })

  it('keeps every operator route badge at AAA large-text contrast', () => {
    const luminance = (color: string) => {
      const channels = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    for (const route of routes.routes) {
      const light = luminance(route.color)
      const ink = luminance(routeBadgeInk(route.color))
      expect((Math.max(light, ink) + 0.05) / (Math.min(light, ink) + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
