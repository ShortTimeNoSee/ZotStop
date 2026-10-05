import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { ArrivalPaceTracker, VehicleTracker, clockOffsetMs, type Route, type Snapshot } from '@zotstop/transit-engine'

const CACHE_KEY = 'zotstop-last-snapshot-v1'
export const liveSnapshotIntervalMs = 8000
const nativeApiBase = import.meta.env.VITE_TRANSIT_API_URL || 'https://zotstop-edge-proxy.theedenwatcher.workers.dev'

export function snapshotUrl() {
  const base = Capacitor.isNativePlatform() ? nativeApiBase : (import.meta.env.VITE_TRANSIT_API_URL || '')
  return `${base}/api/v1/snapshot`
}

function cachedSnapshot(): Snapshot | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(CACHE_KEY) || 'null',
    ) as Snapshot | null
    return value &&
      typeof value.fetchedAt === 'number' &&
      Array.isArray(value.vehicles) &&
      Array.isArray(value.arrivals)
      ? value
      : null
  } catch {
    return null
  }
}

async function fetchSnapshot(): Promise<Snapshot> {
  let value: Snapshot
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url: snapshotUrl(), connectTimeout: 6000, readTimeout: 7000 })
    if (response.status !== 200) throw new Error('Live service unavailable')
    value =
      typeof response.data === 'string'
        ? JSON.parse(response.data)
        : response.data
  } else {
    const response = await fetch(
      snapshotUrl(),
      { cache: 'no-store', signal: AbortSignal.timeout(7000) },
    )
    if (!response.ok) throw new Error('Live service unavailable')
    value = (await response.json()) as Snapshot
  }
  if (
    !Number.isFinite(value.fetchedAt) ||
    !Array.isArray(value.vehicles) ||
    !Array.isArray(value.arrivals)
  )
    throw new Error('Invalid response')
  return value
}

export function useLiveTransit(routeIds: string, routes: Route[]) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(cachedSnapshot)
  const [clockOffset, setClockOffset] = useState(0)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const inFlight = useRef(false)
  const alive = useRef(true)
  const vehicleTracker = useRef(new VehicleTracker())
  const paceTracker = useRef(new ArrivalPaceTracker())
  const routesById = useMemo(() => new Map(routes.map(route => [route.id, route])), [routes])
  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    try {
      const value = await fetchSnapshot()
      if (!alive.current) return
      vehicleTracker.current.prune(value.fetchedAt)
      paceTracker.current.prune(value.fetchedAt)
      const tracked = {
        ...value,
        vehicles: value.vehicles.map(vehicle => {
          const route = routesById.get(vehicle.routeId)
          if (!route) return vehicle
          const paceRatio = paceTracker.current.update(vehicle, route)
          return { ...vehicleTracker.current.update(vehicle, route), paceRatio }
        }),
      }
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(tracked)) } catch {}
      setClockOffset(clockOffsetMs(Date.now(), value.fetchedAt))
      setSnapshot(tracked)
      setError(false)
    } catch {
      if (alive.current) setError(true)
    } finally {
      inFlight.current = false
      if (alive.current) setRefreshing(false)
    }
  }, [routesById])
  useEffect(() => {
    alive.current = true
    if (!routeIds) return
    void refresh()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, liveSnapshotIntervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, routeIds])
  return { snapshot, error, refreshing, refresh, clockOffset }
}
