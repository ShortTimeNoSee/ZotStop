import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  campusCenter,
  clockOffsetMs,
  clockSkewMessage,
  departureBoard,
  formatArrival,
  nearbyWalkMeters,
  routeBadgeInk,
  stopServiceNote,
  themes,
  upcomingStops,
  type Route,
  type Snapshot,
  type Stop,
} from '@zotstop/transit-engine'
import { navigationFromSearch, navigationHref } from './hooks/useNavigation'
import { nosePlacement, recordTrail, sheetClearance } from './map-motion'
import { readRecentStops, rememberStop, searchTransit } from './search'
import routes from '../../../packages/transit-engine/assets/routes.min.json'

const now = Date.parse('2026-09-22T17:00:00Z')

function stop(id: string, name: string, lat: number, lon: number, timepoint?: boolean): Stop {
  return { id, code: id, name, lat, lon, ...(timepoint === undefined ? {} : { timepoint }) }
}

function line(id: string, letter: string, stops: Stop[]): Route {
  return {
    id,
    name: `${letter} Line`,
    letter,
    color: '#FBF140',
    shape: stops.map(item => [item.lon, item.lat]),
    stops,
  }
}

describe('departure board', () => {
  const near = stop('near', 'Near', campusCenter.lat + 0.001, campusCenter.lon)
  const far = stop('far', 'Far', campusCenter.lat + 0.002, campusCenter.lon)
  const beyond = stop('beyond', 'Beyond', campusCenter.lat + 0.02, campusCenter.lon)
  const route = line('TL-7', 'A', [far, near, beyond])
  const snapshot: Snapshot = {
    fetchedAt: now,
    vehicles: [{ id: '12', name: 'AE-09', routeId: 'TL-7', lat: near.lat, lon: near.lon, heading: 0, speedKph: 10, updatedAt: now - 4000 }],
    arrivals: [
      { routeId: 'TL-7', stopId: 'near', vehicleId: '12', estimatedAt: now + 5 * 60000 },
      { routeId: 'TL-7', stopId: 'far', vehicleId: '12', estimatedAt: now + 8 * 60000 },
    ],
  }

  it('orders walking-distance stops from the fix, and uses campus center without one', () => {
    expect(nearbyWalkMeters).toBeGreaterThan(500)
    const withFix = departureBoard([route], snapshot, { lat: far.lat, lon: far.lon }, now)
    expect(withFix.nearYou).toBe(true)
    expect(withFix.stops.map(item => item.stop.id)).toEqual(['far', 'near'])
    expect(withFix.stops[1].departures[0]).toMatchObject({ label: '5 min', fleetNumber: '09' })
    const campus = departureBoard([route], snapshot, null, now)
    expect(campus.nearYou).toBe(false)
    expect(campus.stops.map(item => item.stop.id)).toEqual(['near', 'far'])
    expect(campus.stops.some(item => item.stop.id === 'beyond')).toBe(false)
  })

  it('keeps a missing or stale estimate as time unavailable', () => {
    const stale = departureBoard([route], {
      ...snapshot,
      vehicles: [{ ...snapshot.vehicles[0], updatedAt: now - 120_000 }],
    }, null, now)
    expect(stale.stops[0].departures[0].label).toBe('Time unavailable')
    expect(stale.stops[0].departures[0].fleetNumber).toBe('09')
  })
})

describe('search, recents, and links', () => {
  const loaded = routes.routes as Route[]

  it('matches a landmark the line list does not name', () => {
    const found = searchTransit(loaded, 'Anteater Recreation')
    expect(found.stops.map(item => item.stop.id)).toContain('TL-21')
    expect(searchTransit(loaded, '110').stops.some(item => item.stop.name.includes('CDS'))).toBe(true)
    expect(searchTransit(loaded, 'A Line').routes.map(item => item.letter)).toContain('A')
  })

  it('keeps the last eight opened stop ids and nothing else', () => {
    const storage = new Map<string, string>()
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
    }
    for (let index = 0; index < 10; index++) rememberStop(`TL-${index}`, store)
    expect(readRecentStops(store)).toEqual(['TL-9', 'TL-8', 'TL-7', 'TL-6', 'TL-5', 'TL-4', 'TL-3', 'TL-2'])
    rememberStop('TL-4', store)
    expect(readRecentStops(store)[0]).toBe('TL-4')
    expect(readRecentStops(store)).toHaveLength(8)
    expect([...storage.values()].join('')).not.toMatch(/lat|lon/)
  })

  it('reopens a stop from the query string and leaves location out of the link', () => {
    expect(navigationFromSearch('?stop=TL-2&route=TL-7')).toMatchObject({
      screen: 'nearby',
      routeId: 'TL-7',
      selectedStopId: 'TL-2',
    })
    expect(navigationFromSearch('?screen=routes')).toMatchObject({ screen: 'routes', selectedStopId: null })
    expect(navigationFromSearch('?stop=TL-2&lat=33.6&lon=-117.8')?.selectedStopId).toBe('TL-2')
    const href = navigationHref({ screen: 'nearby', routeId: 'TL-7', selectedStopId: 'TL-2' }, '/')
    expect(href).toBe('/?route=TL-7&stop=TL-2')
    expect(href).not.toMatch(/lat|lon|accuracy/)
  })
})

describe('timed stops and the bus on its line', () => {
  it('tells a timepoint to wait and every other stop the pass rule', () => {
    expect(stopServiceNote({ id: 'a', code: '1', name: 'Hold', lat: 0, lon: 0, timepoint: true })).toMatch(/waits for the published time/)
    expect(stopServiceNote({ id: 'b', code: '2', name: 'Pass', lat: 0, lon: 0 })).toMatch(/may not stop/)
    expect(stopServiceNote({ id: 'b', code: '2', name: 'Pass', lat: 0, lon: 0 })).toMatch(/nobody is waiting at the sign/)
  })

  const shape: [number, number][] = [[-117.84, 33.64], [-117.84, 33.65], [-117.83, 33.65], [-117.83, 33.64], [-117.84, 33.64]]
  const route: Route = {
    id: 'TL-1',
    name: 'A Line',
    letter: 'A',
    color: '#FBF140',
    shape,
    stops: [
      stop('one', 'One', 33.645, -117.84),
      stop('two', 'Two', 33.65, -117.84),
      stop('three', 'Three', 33.65, -117.83),
    ],
  }

  it('lists upcoming stops in shape order and drops a bus that is off the line', () => {
    expect(upcomingStops(route, { lat: 33.641, lon: -117.84 })?.map(item => item.name)).toEqual(['One', 'Two', 'Three'])
    expect(upcomingStops(route, { lat: 33.649, lon: -117.84 })?.map(item => item.id)).toEqual(['two', 'three', 'one'])
    expect(upcomingStops(route, { lat: 33.7, lon: -117.84 })).toBeNull()
  })

  it('keeps the nose centered on the badge and shortens it as the map zooms in', () => {
    const far = nosePlacement(0.3)
    const close = nosePlacement(3)
    expect(far.height).toBeGreaterThan(close.height)
    expect(close.height).toBeGreaterThan(9 * 1.4)
    expect(far.center).toBe(14)
    expect(close.center).toBe(14)
  })

  it('drops a trail after the report goes stale', () => {
    const vehicle = { id: '12', routeId: 'TL-7', lat: 33.64, lon: -117.84, heading: 0, speedKph: 10, updatedAt: now - 4000 }
    const first = recordTrail(new Map(), [vehicle], now)
    const moved = recordTrail(first, [{ ...vehicle, lat: 33.641, updatedAt: now }], now)
    expect(moved.get('12')).toHaveLength(2)
    expect(recordTrail(moved, [{ ...vehicle, updatedAt: now - 120_000 }], now).has('12')).toBe(false)
  })

  it('pans the point out of a sheet and leaves a clear point alone', () => {
    const move = sheetClearance({ x: 40, y: 200 }, { left: 0, top: 120, right: 180, bottom: 400 }, { width: 400, height: 500 })
    expect(move).not.toBeNull()
    expect(40 + move!.x > 180 || 200 + move!.y < 120 || 200 + move!.y > 400).toBe(true)
    expect(sheetClearance({ x: 300, y: 40 }, { left: 0, top: 120, right: 180, bottom: 400 }, { width: 400, height: 500 })).toBeNull()
  })
})

describe('night surfaces and the snapshot clock', () => {
  it('keeps route ink readable on every operator color and dark page text readable', () => {
    const css = readFileSync(new URL('./styles/app.css', import.meta.url), 'utf8')
    const dark = css.slice(css.indexOf('prefers-color-scheme: dark'))
    expect(dark).toContain(`--page: ${themes.dark.page}`)
    expect(dark).toContain(`--text: ${themes.dark.text}`)
    expect(dark).toContain(`--street: ${themes.dark.street}`)
    const luminance = (color: string) => {
      const channels = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const ratio = (a: string, b: string) => {
      const [left, right] = [luminance(a), luminance(b)]
      return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
    }
    for (const theme of [themes.light, themes.dark]) expect(ratio(theme.text, theme.page)).toBeGreaterThanOrEqual(4.5)
    for (const route of routes.routes) {
      expect(ratio(routeBadgeInk(route.color), route.color)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(route.color, themes.dark.street)).toBeGreaterThanOrEqual(3)
    }
  })

  it('uses the snapshot clock for arrivals when the phone clock is off', () => {
    const fetchedAt = now - 120_000
    const offset = clockOffsetMs(now, fetchedAt)
    expect(offset).toBe(120_000)
    expect(clockOffsetMs(now, now - 5000)).toBe(0)
    const trusted = now - offset
    expect(formatArrival(fetchedAt + 5 * 60000, fetchedAt - 4000, trusted)).toBe('5 min')
    expect(formatArrival(fetchedAt + 5 * 60000, fetchedAt - 4000, now)).toBe('Time unavailable')
    expect(clockSkewMessage).toMatch(/clock looks wrong/)
  })
})
