import type { useLocation } from '../hooks/useLocation'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { Crosshair, Layers3, Maximize2, Minimize2, Minus, Move, Plus, RotateCcw, X } from 'lucide-react'
import type { Route, Stop, Vehicle } from '@zotstop/transit-engine'
import { campusCenter, fleetNumber, freshness, routeBadgeInk, routeMatchMeters, shownLocationMeters, themes, type ThemeName } from '@zotstop/transit-engine'
import { nosePlacement, recordTrail, sheetClearance, showAccuracyRing, type TrailPoint } from '../map-motion'
import './map.css'
import type { RiderSignal } from '../hooks/useRiderSignals'
import { closestOnLane, laneSpread, parallelRoutes, type LanePoint } from './parallelRoutes'
import { spatialIndex, type Bounds } from './spatialIndex'

type Props = {
  routes: Route[]
  allRoutes: Route[]
  focusedRouteId: string | null
  vehicles: Vehicle[]
  onToggleRoute: (id: string) => void
  onSetRoutes: (ids: string[]) => void
  onSaveView: (name: string) => void
  watchedStopIds: string[]
  location: { lat: number; lon: number; accuracy?: number } | null
  trackingLocation: boolean
  selectedStopId: string | null
  onStop: (stop: Stop) => void
  onVehicle?: (vehicle: Vehicle) => void
  onLocate: ReturnType<typeof useLocation>['locate']
  onZoom: () => void
  expanded: boolean
  onToggleExpanded: () => void
  riderSignals: RiderSignal[]
  rideControl?: ReactNode
  rideOffer?: ReactNode
  liveStatus?: string
  now?: number
  sheetAnchor?: { key: string; lat: number; lon: number } | null
}
type Point = [number, number]
type Feature = {
  properties: { kind: string; name: string }
  geometry: { type: 'Polygon' | 'LineString' | 'Point'; coordinates: Point | Point[] | Point[][] }
}
type Collection = { features: Feature[] }
type MapData = { areas: Collection; roads: Collection; places: Collection }
type Shape = { kind: string; name: string; paths: Point[][]; bounds: [number, number, number, number] }
type View = { center: Point; scale: number; bearing: number }

const latitude = campusCenter.lat
const longitude = campusCenter.lon
const metersPerLongitude = 111320 * Math.cos(latitude * Math.PI / 180)
const metersPerLatitude = 111320
const minimumScale = 0.02
const toWorld = ([lon, lat]: Point): Point => [
  (lon - longitude) * metersPerLongitude,
  (latitude - lat) * metersPerLatitude,
]

function prepare(collection: Collection): Shape[] {
  return collection.features.map(({ properties, geometry }) => {
    const paths = geometry.type === 'Point'
      ? [[toWorld(geometry.coordinates as Point)]]
      : geometry.type === 'LineString'
        ? [(geometry.coordinates as Point[]).map(toWorld)]
        : (geometry.coordinates as Point[][]).map((ring) => ring.map(toWorld))
    const points = paths.flat()
    return {
      kind: properties.kind,
      name: properties.name,
      paths,
      bounds: [
        Math.min(...points.map((point) => point[0])),
        Math.min(...points.map((point) => point[1])),
        Math.max(...points.map((point) => point[0])),
        Math.max(...points.map((point) => point[1])),
      ],
    }
  })
}

function fit(routes: Route[], width: number, height: number): View {
  const points = routes.flatMap(route => route.stops.length
    ? route.stops.map((stop) => toWorld([stop.lon, stop.lat]))
    : route.shape.map(toWorld))
  if (!points.length) return { center: [0, 0], scale: 0.3, bearing: 0 }
  const west = Math.min(...points.map((point) => point[0]))
  const east = Math.max(...points.map((point) => point[0]))
  const north = Math.min(...points.map((point) => point[1]))
  const south = Math.max(...points.map((point) => point[1]))
  const leftInset = 48
  const rightInset = 96
  const topInset = 28
  const bottomInset = Math.min(132, height * 0.36)
  const scale = Math.min(
    Math.max(1, width - leftInset - rightInset) / Math.max(250, east - west),
    Math.max(1, height - topInset - bottomInset) / Math.max(250, south - north),
  )
  return {
    center: [(west + east) / 2 + (rightInset - leftInset) / 2 / scale, (north + south) / 2],
    scale,
    bearing: 0,
  }
}

const viewKey = 'zotstop-map-view-v1'
function restoredView(routeKey: string): View | null {
  try {
    const value = JSON.parse(localStorage.getItem(viewKey) || 'null') as { routeKey?: string; view?: View } | null
    const view = value?.view
    return value?.routeKey === routeKey && view && Array.isArray(view.center) && view.center.length === 2 &&
      view.center.every(Number.isFinite) && Number.isFinite(view.scale) && view.scale >= minimumScale && view.scale <= 8 && Number.isFinite(view.bearing) ? view : null
  } catch {
    return null
  }
}

function project(point: Point, view: View, width: number, height: number): Point {
  const x = (point[0] - view.center[0]) * view.scale
  const y = (point[1] - view.center[1]) * view.scale
  const cos = Math.cos(view.bearing)
  const sin = Math.sin(view.bearing)
  return [width / 2 + x * cos - y * sin, height / 2 + x * sin + y * cos]
}

function displayedLanePoint(sample: LanePoint, view: View, width: number, height: number): Point {
  const [x, y] = project(sample.point, view, width, height)
  const shift = sample.offset * laneSpread(view.scale)
  const cos = Math.cos(view.bearing)
  const sin = Math.sin(view.bearing)
  return [
    x + (sample.normal[0] * cos - sample.normal[1] * sin) * shift,
    y + (sample.normal[0] * sin + sample.normal[1] * cos) * shift,
  ]
}

function unproject(point: Point, view: View, width: number, height: number): Point {
  const x = (point[0] - width / 2) / view.scale
  const y = (point[1] - height / 2) / view.scale
  const cos = Math.cos(view.bearing)
  const sin = Math.sin(view.bearing)
  return [
    view.center[0] + x * cos + y * sin,
    view.center[1] - x * sin + y * cos,
  ]
}

function pan(view: View, x: number, y: number): View {
  const cos = Math.cos(view.bearing)
  const sin = Math.sin(view.bearing)
  return {
    ...view,
    center: [
      view.center[0] - (x * cos + y * sin) / view.scale,
      view.center[1] - (-x * sin + y * cos) / view.scale,
    ],
  }
}

function compass(heading: number) {
  const labels = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']
  const turn = ((heading % 360) + 360) % 360
  return labels[Math.round(turn / 45) % 8]
}

function VehicleMarker({ vehicle, route, x, y, bearing, scale, now, viewChanged, onVehicle, dragged }: { vehicle: Vehicle; route: Route; x: number; y: number; bearing: number; scale: number; now: number; viewChanged: boolean; onVehicle?: (vehicle: Vehicle) => void; dragged: MutableRefObject<boolean> }) {
  const previous = useRef<{ lat: number; lon: number; updatedAt: number } | null>(null)
  const last = previous.current
  const traveled = last ? Math.hypot((vehicle.lon - last.lon) * metersPerLongitude, (vehicle.lat - last.lat) * metersPerLatitude) : Infinity
  const animate = !viewChanged && last && vehicle.updatedAt > last.updatedAt && traveled <= 60 && freshness(vehicle.updatedAt, now) === 'fresh'
  const nose = nosePlacement(scale)
  useEffect(() => { previous.current = { lat: vehicle.lat, lon: vehicle.lon, updatedAt: vehicle.updatedAt } }, [vehicle.lat, vehicle.lon, vehicle.updatedAt])
  const name = vehicle.name?.trim()
  const number = fleetNumber(vehicle)
  return <button
    type="button"
    className={`transit-vehicle-marker canvas-map-marker ${freshness(vehicle.updatedAt, now) === 'aging' ? 'aging' : ''}`}
    data-route-id={route.id}
    data-vehicle-key={`${vehicle.routeId}:${vehicle.id}`}
    style={{ left: x, top: y, '--heading': `${vehicle.heading + bearing * 180 / Math.PI}deg`, '--vehicle-color': route.color, '--vehicle-ink': routeBadgeInk(route.color), '--nose-height': `${nose.height}px`, '--nose-top': `${nose.top}px`, '--nose-origin': `4.5px ${nose.originY}px`, transition: animate ? undefined : 'none' } as React.CSSProperties}
    onClick={() => {
      const moved = dragged.current
      dragged.current = false
      if (!moved) onVehicle?.(vehicle)
    }}
    aria-label={name ? `${name} on the ${route.name}, heading ${compass(vehicle.heading)}. Show this bus` : `${route.name} bus with no fleet name in the report, heading ${compass(vehicle.heading)}. Show this bus`}
  >
    <span className="vehicle-badge">
      <span className="vehicle-heading" aria-hidden="true" />
      <span className="vehicle-letter">{route.letter}</span>
    </span>
    {number && <span className="vehicle-number">{number}</span>}
  </button>
}

function LocationMarker({ location, x, y, viewChanged }: { location: { lat: number; lon: number }; x: number; y: number; viewChanged: boolean }) {
  const previous = useRef<Point | null>(null)
  const last = previous.current
  const traveled = last ? Math.hypot((location.lon - last[0]) * metersPerLongitude, (location.lat - last[1]) * metersPerLatitude) : Infinity
  useEffect(() => { previous.current = [location.lon, location.lat] }, [location.lon, location.lat])
  return <div className="transit-location-marker canvas-map-marker" style={{ left: x, top: y, transition: !viewChanged && traveled <= 60 ? undefined : 'none' } as React.CSSProperties} role="img" aria-label="Your last location" />
}

function CanvasTransitMap({ routes, allRoutes, focusedRouteId, vehicles, onToggleRoute, onSetRoutes, onSaveView, watchedStopIds, location, trackingLocation, selectedStopId, onStop, onVehicle, onLocate, onZoom, expanded, onToggleExpanded, riderSignals, rideControl, rideOffer, liveStatus, now = Date.now(), sheetAnchor = null }: Props) {
  const routeKey = routes.map(route => route.id).join(',')
  const routeSummary = useRef<HTMLButtonElement>(null)
  const movementToggle = useRef<HTMLButtonElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const shell = useRef<HTMLDivElement>(null)
  const trails = useRef(new Map<string, TrailPoint[]>())
  const viewRef = useRef<View>({ center: [0, 0], scale: 1, bearing: 0 })
  const [colorScheme, setColorScheme] = useState<ThemeName>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const locateRequest = useRef(0)
  const trackedLocateRequest = useRef<number | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const pointerStarts = useRef(new Map<number, Point>())
  const draggedStop = useRef(false)
  const touchActivatedTarget = useRef<Element | null>(null)
  const [size, setSize] = useState<Point>([0, 0])
  const [view, setView] = useState<View>(() => restoredView(routeKey) ?? fit(routes, 400, 650))
  const [panControls, setPanControls] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const [stopChoices, setStopChoices] = useState<Stop[] | null>(null)
  const previousLayout = useRef<{ routeKey: string; size: Point } | null>(null)
  const previousView = useRef(view)
  const viewChanged = previousView.current !== view
  previousView.current = view
  viewRef.current = view
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setColorScheme(media.matches ? 'dark' : 'light')
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  const sheetKey = sheetAnchor?.key ?? ''
  const sizeKey = `${Math.round(size[0] / 40)}x${Math.round(size[1] / 40)}`
  useLayoutEffect(() => {
    const anchor = sheetAnchor
    const shellNode = shell.current
    if (!anchor || !shellNode || !size[0] || !size[1]) return
    const popover = shellNode.parentElement?.querySelector('.stop-popover')
    if (!(popover instanceof HTMLElement)) return
    const shellBox = shellNode.getBoundingClientRect()
    const box = popover.getBoundingClientRect()
    let current = viewRef.current
    const width = shellNode.clientWidth
    const height = shellNode.clientHeight
    const world = toWorld([anchor.lon, anchor.lat])
    const placed = project(world, current, width, height)
    if (placed[0] < 60 || placed[0] > width - 60 || placed[1] < 90 || placed[1] > height - 160)
      current = { ...current, center: world, scale: Math.max(current.scale, 0.7) }
    const [px, py] = project(world, current, width, height)
    const move = sheetClearance(
      { x: px, y: py },
      { left: box.left - shellBox.left, top: box.top - shellBox.top, right: box.right - shellBox.left, bottom: box.bottom - shellBox.top },
      { width, height },
    )
    const from = current
    const target = move ? pan(from, move.x, move.y) : from
    if (!move && from === viewRef.current) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setView(target)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (time: number) => {
      const t = Math.min(1, (time - start) / 180)
      const eased = 1 - (1 - t) ** 3
      setView({
        ...target,
        center: [
          from.center[0] + (target.center[0] - from.center[0]) * eased,
          from.center[1] + (target.center[1] - from.center[1]) * eased,
        ],
      })
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [sheetKey, sizeKey])
  const [locationNotice, setLocationNotice] = useState('')
  const [navigationHeight, setNavigationHeight] = useState(48)
  const [navigationBottom, setNavigationBottom] = useState(12)
  const [overlayBounds, setOverlayBounds] = useState<Bounds[]>([])
  const [mapDataFailed, setMapDataFailed] = useState(false)
  const [mapDataAttempt, setMapDataAttempt] = useState(0)
  const [data, setData] = useState<MapData | null>(null)
  const lanes = useMemo(() => parallelRoutes(routes, toWorld), [routes])
  const prepared = useMemo(() => data && {
    areas: spatialIndex(prepare(data.areas)),
    roads: spatialIndex(prepare(data.roads)),
    places: spatialIndex(prepare(data.places)),
  }, [data])

  const uniqueStops = useMemo(() => {
    const stops = new Map<string, { stop: Stop; routes: Route[] }>()
    for (const route of routes) for (const stop of route.stops) {
      const existing = stops.get(stop.id)
      if (existing) existing.routes.push(route)
      else stops.set(stop.id, { stop, routes: [route] })
    }
    return stops
  }, [routes])
  useEffect(() => {
    const element = shell.current
    if (!element) return
    const overlays = [...element.querySelectorAll('.map-route-label, .map-navigation')]
    const measure = () => {
      const origin = element.getBoundingClientRect()
      const navigation = element.querySelector('.map-navigation')?.getBoundingClientRect()
      if (navigation) {
        const bottom = Math.max(0, Math.round(origin.bottom - navigation.bottom))
        setNavigationBottom(previous => previous === bottom ? previous : bottom)
        setNavigationHeight(previous => previous === navigation.height ? previous : navigation.height)
      }
      const bounds: Bounds[] = [...element.querySelectorAll('.map-route-label, .map-control-stack, .map-pan-pad, .map-ride-control')].map(overlay => {
        const box = overlay.getBoundingClientRect()
        return [box.left - origin.left, box.top - origin.top, box.right - origin.left, box.bottom - origin.top]
      })
      setOverlayBounds(previous => previous.flat().join(',') === bounds.flat().join(',') ? previous : bounds)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    overlays.forEach(overlay => observer.observe(overlay))
    measure()
    return () => observer.disconnect()
  }, [size[0], size[1]])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (!pickerOpen && !panControls && !stopChoices)) return
      event.preventDefault()
      event.stopPropagation()
      if (pickerOpen) { setPickerOpen(false); routeSummary.current?.focus({ preventScroll: true }) }
      else if (panControls) { setPanControls(false); movementToggle.current?.focus({ preventScroll: true }) }
      else setStopChoices(null)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [pickerOpen, panControls, stopChoices])

  useEffect(() => {
    const controller = new AbortController()
    setMapDataFailed(false)
    Promise.all(['areas', 'roads', 'places'].map(async (name) => {
      const response = await fetch(`/data/${name}.geojson`, { signal: controller.signal })
      if (!response.ok) throw new Error('Map data unavailable')
      return response.json() as Promise<Collection>
    })).then(([areas, roads, places]) => setData({ areas, roads, places })).catch(() => {
      if (!controller.signal.aborted) setMapDataFailed(true)
    })
    return () => controller.abort()
  }, [mapDataAttempt])

  useEffect(() => {
    if (!shell.current) return
    const observer = new ResizeObserver(([entry]) => {
      setSize([entry.contentRect.width, entry.contentRect.height])
    })
    observer.observe(shell.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!size[0] || !size[1]) return
    const previous = previousLayout.current
    previousLayout.current = { routeKey, size }
    if (!previous) setView(restoredView(routeKey) ?? fit(routes, size[0], size[1]))
    else if (previous.routeKey !== routeKey) setView(fit(routes, size[0], size[1]))
    else if (previous.size[0] !== size[0] || previous.size[1] !== size[1]) {
      const ratio = fit(routes, size[0], size[1]).scale / fit(routes, previous.size[0], previous.size[1]).scale
      setView((current) => ({ ...current, scale: Math.max(minimumScale, Math.min(8, current.scale * ratio)) }))
    }
  }, [routeKey, size[0], size[1]])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(viewKey, JSON.stringify({ routeKey, view })) } catch {}
    }, 400)
    return () => window.clearTimeout(timer)
  }, [routeKey, view])

  useEffect(() => {
    if (!selectedStopId || !size[0] || !size[1]) return
    setPanControls(false)
    setPickerOpen(false)
    if (sheetAnchor) return
    const stop = routes.flatMap(route => route.stops).find(item => item.id === selectedStopId)
    if (!stop) return
    const point = toWorld([stop.lon, stop.lat])
    const position = project(point, view, size[0], size[1])
    if (position[0] < 60 || position[0] > size[0] - 60 || position[1] < 90 || position[1] > size[1] - 160) {
      setView(current => ({ ...current, center: point, scale: Math.max(current.scale, 0.7) }))
    }
  }, [selectedStopId])

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d', { alpha: false })
    if (!element || !context || !size[0] || !size[1]) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.round(size[0] * dpr)
    const height = Math.round(size[1] * dpr)
    if (element.width !== width) element.width = width
    if (element.height !== height) element.height = height
    const palette = themes[colorScheme]
    const dark = colorScheme === 'dark'
    trails.current = recordTrail(trails.current, vehicles, now)
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.fillStyle = palette.street
    context.fillRect(0, 0, size[0], size[1])
    const cos = Math.cos(view.bearing)
    const sin = Math.sin(view.bearing)
    const scale = view.scale
    context.setTransform(
      dpr * scale * cos, dpr * scale * sin,
      -dpr * scale * sin, dpr * scale * cos,
      dpr * (size[0] / 2 - scale * (cos * view.center[0] - sin * view.center[1])),
      dpr * (size[1] / 2 - scale * (sin * view.center[0] + cos * view.center[1])),
    )
    const halfWidth = (Math.abs(cos) * size[0] + Math.abs(sin) * size[1]) / (2 * scale) + 12 / scale
    const halfHeight = (Math.abs(sin) * size[0] + Math.abs(cos) * size[1]) / (2 * scale) + 12 / scale
    const bounds: Bounds = [view.center[0] - halfWidth, view.center[1] - halfHeight, view.center[0] + halfWidth, view.center[1] + halfHeight]
    const areas = prepared?.areas(bounds) ?? []
    const roads = prepared?.roads(bounds) ?? []
    const places = prepared?.places(bounds) ?? []
    const roadsByKind = new Map<string, Shape[]>()
    for (const road of roads) {
      const group = roadsByKind.get(road.kind)
      if (group) group.push(road)
      else roadsByKind.set(road.kind, [road])
    }
    const trace = (paths: Point[][], close: boolean) => {
      context.beginPath()
      paths.forEach((points) => {
        points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
        if (close) context.closePath()
      })
    }
    if (prepared) {
      for (const shape of areas) {
        const color = ['park', 'wood', 'forest'].includes(shape.kind)
          ? (dark ? '#1e3a2c' : '#CBE7D4')
          : ['grass', 'meadow', 'garden'].includes(shape.kind)
            ? (scale >= 0.6 ? (dark ? '#24382c' : '#D8EBDD') : null)
          : ['water', 'reservoir', 'basin'].includes(shape.kind)
            ? (dark ? '#1a3340' : '#BBDCE8')
          : shape.kind === 'wetland'
            ? (dark ? '#1c3330' : '#CCE4DB')
          : ['university', 'college', 'school'].includes(shape.kind)
            ? (dark ? '#242a30' : '#E6E9E5')
            : shape.kind === 'building' && scale >= 0.85 ? (dark ? '#2a3138' : '#D8DEDA') : null
        if (!color) continue
        trace(shape.paths, true)
        context.fillStyle = color
        context.fill('evenodd')
      }
      for (const shape of roads) {
        if (!shape.kind.startsWith('waterway:')) continue
        trace(shape.paths, false)
        context.strokeStyle = dark ? '#1a3340' : '#BBDCE8'
        context.lineWidth = (shape.kind === 'waterway:river' ? 8 : 4) / scale
        context.lineCap = 'round'
        context.lineJoin = 'round'
        context.stroke()
      }
      const roadStyles = ([
        { kinds: ['footway', 'path', 'pedestrian', 'cycleway'], minScale: 0.9, casing: '#D5DCD8', fill: '#FAFBF9', outerWidth: 2.5, innerWidth: 1.5 },
        { kinds: ['service', 'living_street', 'unclassified'], minScale: 0.65, casing: '#D7DDDA', fill: '#FFFFFF', outerWidth: 4, innerWidth: 3 },
        { kinds: ['residential'], minScale: 0.35, casing: '#D1D8D5', fill: '#FFFFFF', outerWidth: 5, innerWidth: 3.5 },
        { kinds: ['tertiary'], minScale: 0, casing: '#C4CFCA', fill: '#FFFFFF', outerWidth: 7, innerWidth: 5 },
        { kinds: ['secondary'], minScale: 0, casing: '#AEBDB9', fill: '#FFFFFF', outerWidth: 9, innerWidth: 6.5 },
        { kinds: ['primary'], minScale: 0, casing: '#9DACAA', fill: '#FFFFFF', outerWidth: 11, innerWidth: 8 },
      ] as const).map(style => dark ? { ...style, casing: '#1e2630', fill: palette.road } : style)
      for (const style of roadStyles) {
        if (scale < style.minScale) continue
        for (const shape of style.kinds.flatMap(kind => roadsByKind.get(kind) ?? [])) {
          trace(shape.paths, false)
          context.lineCap = 'round'
          context.lineJoin = 'round'
          context.strokeStyle = style.casing
          context.lineWidth = style.outerWidth / scale
          context.stroke()
          context.strokeStyle = style.fill
          context.lineWidth = style.innerWidth / scale
          context.stroke()
        }
      }
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    const displayed = lanes.map(lane => ({
      route: lane.route,
      points: lane.points.map(sample => displayedLanePoint(sample, view, size[0], size[1])),
    }))
    for (const lane of displayed) {
      context.beginPath()
      lane.points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y))
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.strokeStyle = dark ? '#d7e4df' : '#1b3a32'
      context.lineWidth = lane.route.id === focusedRouteId ? 9 : 8
      context.stroke()
      context.strokeStyle = lane.route.color
      context.lineWidth = lane.route.id === focusedRouteId ? 5.5 : 4.5
      context.stroke()
    }
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const [vehicleId, points] of trails.current) {
      const vehicle = vehicles.find(item => item.id === vehicleId)
      const route = routes.find(item => item.id === vehicle?.routeId)
      const lane = lanes.find(item => item.route.id === vehicle?.routeId)
      if (!vehicle || !route || points.length < 2) continue
      context.beginPath()
      let drawn = 0
      for (const point of points) {
        const world = toWorld([point.lon, point.lat])
        const onLine = lane ? closestOnLane(lane, world, routeMatchMeters) : null
        const [x, y] = onLine ? displayedLanePoint(onLine, view, size[0], size[1]) : project(world, view, size[0], size[1])
        if (drawn) context.lineTo(x, y)
        else context.moveTo(x, y)
        drawn += 1
      }
      context.strokeStyle = route.color
      context.globalAlpha = 0.55
      context.lineWidth = 3
      context.stroke()
      context.globalAlpha = 1
    }
    if (location && showAccuracyRing(location.accuracy)) {
      const [x, y] = project(toWorld([location.lon, location.lat]), view, size[0], size[1])
      context.beginPath()
      context.arc(x, y, location.accuracy! * view.scale, 0, Math.PI * 2)
      context.fillStyle = dark ? '#93c5fd33' : '#1d4ed822'
      context.fill()
      context.strokeStyle = dark ? '#93c5fd' : '#1d4ed8'
      context.lineWidth = 1.5
      context.stroke()
    }
    for (const lane of displayed) {
      let distanceToArrow = 150
      let arrows = 0
      for (let index = 1; index < lane.points.length && arrows < 7; index++) {
        const [x1, y1] = lane.points[index - 1]
        const [x2, y2] = lane.points[index]
        const length = Math.hypot(x2 - x1, y2 - y1)
        if (length < 1) continue
        while (distanceToArrow <= length && arrows < 7) {
          const fraction = distanceToArrow / length
          const x = x1 + (x2 - x1) * fraction
          const y = y1 + (y2 - y1) * fraction
          if (x > 20 && x < size[0] - 20 && y > 75 && y < size[1] - 35) {
            context.save()
            context.translate(x, y)
            context.rotate(Math.atan2(y2 - y1, x2 - x1))
            context.beginPath()
            context.moveTo(5, 0)
            context.lineTo(-4, -4)
            context.lineTo(-2, 0)
            context.lineTo(-4, 4)
            context.closePath()
            context.strokeStyle = '#183d38'
            context.lineWidth = 1.5
            context.stroke()
            context.fillStyle = '#fff'
            context.fill()
            context.globalAlpha = 0.36
            context.fillStyle = lane.route.color
            context.fill()
            context.restore()
            arrows++
          }
          distanceToArrow += 240
        }
        distanceToArrow -= length
      }
    }
    if (prepared) {
      const occupied: Bounds[] = [...overlayBounds]
      for (const { stop } of uniqueStops.values()) {
        const [x, y] = project(toWorld([stop.lon, stop.lat]), view, size[0], size[1])
        if (x >= -20 && x <= size[0] + 20 && y >= -20 && y <= size[1] + 20) occupied.push([x - 22, y - 22, x + 22, y + 22])
      }
      context.font = '600 11px system-ui, sans-serif'
      context.textAlign = 'center'
      context.lineJoin = 'round'
      let labelCount = 0
      const label = (name: string, point: Point, fill: string, halo: string) => {
        const width = context.measureText(name).width + 12
        const box: Bounds = [point[0] - width / 2, point[1] - 12, point[0] + width / 2, point[1] + 6]
        if (box[0] < 12 || box[2] > size[0] - 12 || box[1] < 16 || box[3] > size[1] - 32) return false
        if (occupied.some(other => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1])) return false
        occupied.push(box)
        context.strokeStyle = halo
        context.lineWidth = 4
        context.strokeText(name, point[0], point[1])
        context.fillStyle = fill
        context.fillText(name, point[0], point[1])
        labelCount++
        return true
      }
      const namedRoads = roads
        .filter(shape => shape.name && (['primary', 'secondary', 'tertiary'].includes(shape.kind) || (scale >= 0.75 && shape.kind === 'residential')))
        .sort((a, b) => {
          const rank = (kind: string) => ({ primary: 0, secondary: 1, tertiary: 2, residential: 3 })[kind as 'primary' | 'secondary' | 'tertiary' | 'residential'] ?? 4
          return rank(a.kind) - rank(b.kind) ||
            (b.bounds[2] - b.bounds[0] + b.bounds[3] - b.bounds[1]) - (a.bounds[2] - a.bounds[0] + a.bounds[3] - a.bounds[1])
        })
      const labeledRoads = new Set<string>()
      for (const shape of namedRoads) {
        if (labeledRoads.has(shape.name)) continue
        const points = shape.paths[0]
        const point = project(points[Math.floor(points.length / 2)], view, size[0], size[1])
        if (label(shape.name, point, palette.label, palette.labelHalo)) labeledRoads.add(shape.name)
        if (labelCount >= 16) break
      }
      for (const shape of places) {
        if (!['park', 'university', 'school', 'garden', 'research_institute'].includes(shape.kind)) continue
        label(shape.name, project(shape.paths[0][0], view, size[0], size[1]), palette.label, palette.labelHalo)
        if (labelCount >= 24) break
      }
    }
  }, [prepared, lanes, focusedRouteId, size, view, overlayBounds, uniqueStops, colorScheme, vehicles, location, now, routes])

  const changeZoom = (factor: number, anchor?: Point) => {
    locateRequest.current++
    onZoom()
    setView((current) => {
      const scale = Math.max(minimumScale, Math.min(8, current.scale * factor))
      if (!anchor) return { ...current, scale }
      const world = unproject(anchor, current, size[0], size[1])
      const relative = unproject(anchor, { ...current, center: [0, 0], scale }, size[0], size[1])
      return { ...current, scale, center: [world[0] - relative[0], world[1] - relative[1]] }
    })
  }
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    touchActivatedTarget.current = null
    if (pointers.current.size === 0) draggedStop.current = false
    if (event.target instanceof Element && event.target.closest('.map-attribution, .map-route-picker, .map-stop-choice')) return
    const target = event.target instanceof Element ? event.target.closest('button') : null
    const captureTarget = target ?? event.currentTarget
    captureTarget.setPointerCapture(event.pointerId)
    if (pointers.current.size > 0) draggedStop.current = true
    pointers.current.set(event.pointerId, [event.clientX, event.clientY])
    pointerStarts.current.set(event.pointerId, [event.clientX, event.clientY])
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const tap = event.pointerType === 'touch' && pointers.current.has(event.pointerId) && pointers.current.size === 1 && !draggedStop.current
    pointers.current.delete(event.pointerId)
    pointerStarts.current.delete(event.pointerId)
    const button = event.target instanceof Element ? event.target.closest('button') : null
    if (tap && button) {
      // Touch taps bypass browser click suppression after a pinch.
      touchActivatedTarget.current = button
      button.focus({ preventScroll: true })
      button.click()
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(event.pointerId)
    if (!before) return
    const origin = pointerStarts.current.get(event.pointerId)
    const wasDragged = draggedStop.current
    if (origin && Math.hypot(event.clientX - origin[0], event.clientY - origin[1]) > 8) draggedStop.current = true
    if (draggedStop.current) locateRequest.current++
    const old = [...pointers.current.values()]
    pointers.current.set(event.pointerId, [event.clientX, event.clientY])
    const next = [...pointers.current.values()]
    if (old.length === 1) {
      if (!draggedStop.current) return
      const start = wasDragged ? before : origin ?? before
      setView((current) => pan(current, event.clientX - start[0], event.clientY - start[1]))
    } else if (old.length === 2) {
      onZoom()
      const oldDistance = Math.hypot(old[1][0] - old[0][0], old[1][1] - old[0][1])
      const newDistance = Math.hypot(next[1][0] - next[0][0], next[1][1] - next[0][1])
      const oldAngle = Math.atan2(old[1][1] - old[0][1], old[1][0] - old[0][0])
      const newAngle = Math.atan2(next[1][1] - next[0][1], next[1][0] - next[0][0])
      const rect = shell.current?.getBoundingClientRect()
      if (!rect) return
      const oldMid: Point = [(old[0][0] + old[1][0]) / 2 - rect.left, (old[0][1] + old[1][1]) / 2 - rect.top]
      const nextMid: Point = [(next[0][0] + next[1][0]) / 2 - rect.left, (next[0][1] + next[1][1]) / 2 - rect.top]
      setView((current) => {
        const world = unproject(oldMid, current, size[0], size[1])
        const scale = Math.max(minimumScale, Math.min(8, current.scale * newDistance / Math.max(1, oldDistance)))
        const bearing = current.bearing + newAngle - oldAngle
        const relative = unproject(nextMid, { center: [0, 0], scale, bearing }, size[0], size[1])
        return { center: [world[0] - relative[0], world[1] - relative[1]], scale, bearing }
      })
    }
  }
  const moveMap = (x: number, y: number) => {
    locateRequest.current++
    setView(current => pan(current, x, y))
  }
  const resetMap = () => {
    locateRequest.current++
    setView(fit(routes, size[0], size[1]))
  }
  const centerLocation = (fix: NonNullable<Props['location']>, request: number) => {
    if (request !== locateRequest.current) { setLocationNotice('Location found. Map position kept.'); return }
    if ((fix.accuracy ?? Infinity) > 200) { setLocationNotice('Location is approximate.'); return }
    setLocationNotice('Location found. Map centered.')
    setView(current => ({ ...current, center: toWorld([fix.lon, fix.lat]), scale: Math.max(current.scale, 0.7) }))
  }
  useEffect(() => {
    const request = trackedLocateRequest.current
    if (!trackingLocation) { trackedLocateRequest.current = null; return }
    if (request !== null && location && (location.accuracy ?? Infinity) <= 200) {
      trackedLocateRequest.current = null
      centerLocation(location, request)
    }
  }, [trackingLocation, location])
  const findLocation = async () => {
    const request = ++locateRequest.current
    setLocationNotice('Finding your location')
    if (trackingLocation) {
      if (location && (location.accuracy ?? Infinity) <= 200) centerLocation(location, request)
      else trackedLocateRequest.current = request
      return
    }
    const fix = await onLocate()
    if (fix) centerLocation(fix, request)
    else setLocationNotice('')
  }
  const markerPosition = (point: Point) => project(toWorld(point), view, size[0], size[1])
  const shownVehicles = vehicles.filter(vehicle => freshness(vehicle.updatedAt, now) !== 'stale')
  const stopGroups: { stops: { stop: Stop; routes: Route[]; x: number; y: number }[]; x: number; y: number }[] = []
  for (const item of uniqueStops.values()) {
    const [x, y] = markerPosition([item.stop.lon, item.stop.lat])
    const stopReach = 16
    if (x < stopReach || x > size[0] - stopReach || y < 75 || y > size[1] - stopReach) continue
    if (overlayBounds.some(box => x > box[0] - stopReach && x < box[2] + stopReach && y > box[1] - stopReach && y < box[3] + stopReach)) continue
    const group = stopGroups.find(item => item.stops.every(existing => Math.hypot(existing.x - x, existing.y - y) < 32))
    if (group) {
      group.x = (group.x * group.stops.length + x) / (group.stops.length + 1)
      group.y = (group.y * group.stops.length + y) / (group.stops.length + 1)
      group.stops.push({ ...item, x, y })
    } else stopGroups.push({ stops: [{ ...item, x, y }], x, y })
  }
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < stopGroups.length && !merged; i++) {
      for (let j = i + 1; j < stopGroups.length; j++) {
        const left = stopGroups[i]
        const right = stopGroups[j]
        if (Math.hypot(left.x - right.x, left.y - right.y) >= 36) continue
        const count = left.stops.length + right.stops.length
        left.x = (left.x * left.stops.length + right.x * right.stops.length) / count
        left.y = (left.y * left.stops.length + right.y * right.stops.length) / count
        left.stops.push(...right.stops)
        stopGroups.splice(j, 1)
        merged = true
        break
      }
    }
  }
  return (
    <div
      ref={shell}
      className="transit-map-shell canvas-map-shell"
      data-map-scale={view.scale}
      data-map-center={view.center.join(',')}
      style={{ '--map-navigation-height': `${navigationHeight}px`, '--map-navigation-bottom': `${navigationBottom}px` } as React.CSSProperties}
      aria-label={`Map showing ${routes.map(route => route.name).join(', ')}`}
      onClickCapture={(event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null
        if (event.detail !== 0 && (draggedStop.current || button === touchActivatedTarget.current && button !== null)) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onLostPointerCapture={(event) => { pointers.current.delete(event.pointerId); pointerStarts.current.delete(event.pointerId) }}
      onPointerUp={onPointerUp}
      onPointerCancel={(event) => { pointers.current.delete(event.pointerId); pointerStarts.current.delete(event.pointerId); draggedStop.current = true }}
    >
      <span className="map-location-notice" role="status">{locationNotice}</span>
      <canvas
        ref={canvas}
        className="transit-map-canvas"
        onWheel={(event) => {
          event.preventDefault()
          const rect = shell.current?.getBoundingClientRect()
          changeZoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, rect ? [event.clientX - rect.left, event.clientY - rect.top] : undefined)
        }}
        aria-hidden="true"
      />
      {stopGroups.map((group) => {
        const stop = group.stops[0].stop
        const clustered = group.stops.length > 1
        const serving = [...new Set(group.stops.flatMap(item => item.routes.map(route => route.letter)))]
        const colors = [...new Set(group.stops.flatMap(item => item.routes.map(route => route.color)))]
        const background = colors.length === 1 ? colors[0] : `conic-gradient(${colors.map((color, index) => `${color} ${index * 100 / colors.length}% ${(index + 1) * 100 / colors.length}%`).join(', ')})`
        return <button
          key={stop.id}
          className={`transit-stop-marker canvas-map-marker ${clustered ? 'cluster' : ''} ${group.stops.some(item => item.stop.id === selectedStopId) ? 'selected' : ''} ${group.stops.some(item => watchedStopIds.includes(item.stop.id)) ? 'watched' : ''}`}
          style={{ left: group.x, top: group.y, '--stop-color': background, '--stop-ink': colors.length === 1 ? routeBadgeInk(colors[0]) : '#fff' } as React.CSSProperties}
          onClick={() => {
            if (!draggedStop.current) {
              if (clustered) {
                if (!expanded && window.matchMedia('(max-width: 850px)').matches) onToggleExpanded()
                setPanControls(false)
                setPickerOpen(false)
                setStopChoices(group.stops.map(item => item.stop))
              }
              else onStop(stop)
            }
            draggedStop.current = false
          }}
          aria-label={clustered ? `${group.stops.length} stops near this point. Choose a stop` : `${stop.name}, ${serving.join(', ')} ${serving.length === 1 ? 'Line' : 'Lines'}. Show arrivals`}
          title={clustered ? `${group.stops.length} nearby stops` : `${stop.name} · ${serving.join(', ')}`}
        ><span className="stop-marker-dot">{clustered ? group.stops.length : null}</span></button>
      })}
      {stopChoices && <div className="map-stop-choice" role="group" aria-label="Choose a stop">
        <div><strong>Stops nearby</strong><button onClick={() => setStopChoices(null)} aria-label="Close stop choices"><X size={17} /></button></div>
        {stopChoices.map(stop => <button key={stop.id} onClick={() => { setStopChoices(null); onStop(stop) }}><span>{stop.name}</span><small>{routes.filter(route => route.stops.some(item => item.id === stop.id)).map(route => route.letter).join(' · ')}</small></button>)}
      </div>}
      {shownVehicles.map((vehicle) => {
        const route = routes.find(item => item.id === vehicle.routeId)
        if (!route) return null
        const lane = lanes.find(item => item.route.id === vehicle.routeId)
        const reported = toWorld([vehicle.lon, vehicle.lat])
        const onLine = lane ? closestOnLane(lane, reported, routeMatchMeters) : null
        const [x, y] = onLine ? displayedLanePoint(onLine, view, size[0], size[1]) : markerPosition([vehicle.lon, vehicle.lat])
        return <VehicleMarker key={`${vehicle.routeId}:${vehicle.id}`} vehicle={vehicle} route={route} x={x} y={y} bearing={view.bearing} scale={view.scale} now={now} viewChanged={viewChanged} onVehicle={onVehicle} dragged={draggedStop} />
      })}
      {riderSignals.map((signal, index) => {
        const [x, y] = markerPosition([signal.lon, signal.lat])
        const route = routes.find(item => item.id === signal.routeId)
        return <div key={`${signal.routeId}:${index}:${signal.updatedAt}`} className="rider-map-marker canvas-map-marker" style={{ left: x, top: y }} role="img" aria-label={`Approximate ${route?.name ?? 'route'} rider-reported bus area, ${signal.riders} reports. Unverified`} title={`Approximate ${route?.name ?? 'route'} rider reports, unverified`} />
      })}
      {location && (location.accuracy ?? 0) <= shownLocationMeters && (() => {
        const [x, y] = markerPosition([location.lon, location.lat])
        return <LocationMarker location={location} x={x} y={y} viewChanged={viewChanged} />
      })()}
      <div className="map-route-label">
        <button ref={routeSummary} className="map-route-summary" onClick={() => { if (!pickerOpen && !expanded && window.matchMedia('(max-width: 850px)').matches) onToggleExpanded(); setPickerOpen(value => !value); setPanControls(false); setStopChoices(null) }} aria-expanded={pickerOpen} aria-controls="map-route-picker" aria-describedby="map-live-status" aria-label={`Routes on map: ${routes.map(route => route.name).join(', ')}. Change routes`}>
          <Layers3 size={18} aria-hidden="true" />
          <span><strong>{routes.length === 1 ? routes[0].name : `${routes.length} routes on map`}</strong><small id="map-live-status" role="status" title={liveStatus}>{routes.map(route => route.letter).join(' · ')} · {liveStatus || `${shownVehicles.length} ${shownVehicles.length === 1 ? 'bus' : 'buses'} reported`}</small>{mapDataFailed && <small className="map-detail-warning">Street details unavailable</small>}</span>
        </button>
      </div>
      {pickerOpen && <div className="map-route-picker" id="map-route-picker">
        <div className="map-picker-heading"><strong>Routes on map</strong><button onClick={() => { setPickerOpen(false); routeSummary.current?.focus({ preventScroll: true }) }} aria-label="Close route choices"><X size={18} /></button></div>
        <p>Select the routes you want to compare.</p>
        <div className="map-route-options">{allRoutes.map(route => {
          const shown = routes.some(item => item.id === route.id)
          return <button key={route.id} onClick={() => onToggleRoute(route.id)} aria-pressed={shown} disabled={shown && routes.length === 1} aria-label={`${shown ? 'Hide' : 'Show'} ${route.name} on map`}>
            <span className="route-badge" style={{ '--route-color': route.color, '--route-ink': routeBadgeInk(route.color) } as React.CSSProperties}>{route.letter}</span>
            <span>{route.name}</span>
          </button>
        })}</div>
        <div className="map-picker-actions"><button onClick={() => onSetRoutes(allRoutes.map(route => route.id))}>Show all</button><button onClick={() => focusedRouteId && onSetRoutes([focusedRouteId])}>Only focused route</button></div>
        {savingView ? <form className="map-save-view" onSubmit={event => { event.preventDefault(); if (viewName.trim()) { onSaveView(viewName); setSaveNotice(`${viewName.trim()} saved`); setViewName(''); setSavingView(false) } }}>
          <input value={viewName} onChange={event => setViewName(event.target.value)} maxLength={40} placeholder="Name this view" aria-label="View name" autoFocus />
          <button type="submit" disabled={!viewName.trim()}>Save</button>
          <button type="button" onClick={() => setSavingView(false)}>Cancel</button>
        </form> : <button className="map-save-open" onClick={() => { setSavingView(true); setSaveNotice('') }}>Save this view</button>}
        {saveNotice && <span className="map-save-notice" role="status">{saveNotice}. Find it in Saved.</span>}
        <small className="map-offset-note">Shared route lines are spaced for clarity. Numbered markers group nearby stops.</small>
        {mapDataFailed && <button className="map-save-open" onClick={() => setMapDataAttempt(value => value + 1)}>Retry street map</button>}
        {rideOffer}
      </div>}
      <div className="map-navigation" aria-label="Map navigation">
        {panControls && <div className="map-pan-pad" id="map-movement-controls" aria-label="Move map">
          <button className="pan-up" onClick={() => moveMap(0, 120)} aria-label="Move map up">↑</button>
          <button className="pan-left" onClick={() => moveMap(120, 0)} aria-label="Move map left">←</button>
          <button className="pan-reset" onClick={resetMap} aria-label="Reset map view and north" title="Fit routes and face north"><RotateCcw size={18} /></button>
          <button className="pan-right" onClick={() => moveMap(-120, 0)} aria-label="Move map right">→</button>
          <button className="pan-down" onClick={() => moveMap(0, -120)} aria-label="Move map down">↓</button>
        </div>}
        {rideControl}
        <div className="map-control-stack" aria-label="Map controls">
          <button onClick={findLocation} aria-label="Find my location" title="Find my location"><Crosshair size={19} /></button>
          <button ref={movementToggle} onClick={() => {
            if (!panControls && !expanded && window.matchMedia('(max-width: 850px)').matches) onToggleExpanded()
            setPanControls(value => !value)
            setPickerOpen(false)
            setStopChoices(null)
          }} aria-label={panControls ? 'Hide map movement controls' : 'Show map movement controls'} aria-expanded={panControls} aria-controls="map-movement-controls" title="Move map"><Move size={18} /></button>
        <button onClick={() => changeZoom(1.25)} aria-label="Zoom in" title="Zoom in"><Plus size={19} /></button>
        <button onClick={() => changeZoom(0.8)} aria-label="Zoom out" title="Zoom out"><Minus size={19} /></button>
        <button className="map-expand" onClick={onToggleExpanded} aria-label={expanded ? 'Close full screen map' : 'Expand map'} title={expanded ? 'Close full screen map' : 'Expand map'}>
          {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          <span>{expanded ? 'Done' : 'Full map'}</span>
        </button>
      </div>
      </div>
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" aria-hidden="true" tabIndex={-1}>© OpenStreetMap contributors</a>
    </div>
  )
}

export default CanvasTransitMap
