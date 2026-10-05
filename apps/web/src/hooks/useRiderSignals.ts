import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { routeProgress, type Route } from '@zotstop/transit-engine'
import type { useLocation } from './useLocation'

export type RiderSignal = { routeId: string; lat: number; lon: number; riders: number; updatedAt: number }
type Ride = { id: string; routeId: string; lastSent: number; pending: Promise<unknown> }

const endpoint = (routeId: string) => `${Capacitor.isNativePlatform() ? import.meta.env.VITE_TRANSIT_API_URL || 'https://zotstop-edge-proxy.theedenwatcher.workers.dev' : ''}/api/v1/rider-signals?route=${encodeURIComponent(routeId)}`

async function request(routeId: string, method: 'GET' | 'POST' | 'DELETE', data?: object) {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({ url: endpoint(routeId), method, headers: { 'Content-Type': 'application/json' }, data, connectTimeout: 6000, readTimeout: 6000 })
    if (response.status < 200 || response.status >= 300) throw new Error('Rider sharing is unavailable')
    return method === 'GET' ? (typeof response.data === 'string' ? JSON.parse(response.data) : response.data) : response.status
  }
  const response = await fetch(endpoint(routeId), { method, headers: data ? { 'Content-Type': 'application/json' } : undefined, body: data ? JSON.stringify(data) : undefined, cache: 'no-store', signal: AbortSignal.timeout(6000) })
  if (!response.ok) throw new Error('Rider sharing is unavailable')
  return method === 'GET' ? response.json() : response.status
}

export function useRiderSignals(route: Route | undefined, location: ReturnType<typeof useLocation>, visibleRoutes: Route[]) {
  const ride = useRef<Ride | null>(null)
  const [sharing, setSharing] = useState(false)
  const [status, setStatus] = useState('')
  const [signals, setSignals] = useState<RiderSignal[]>([])
  const stop = useCallback(() => {
    const previous = ride.current
    ride.current = null
    setSharing(false)
    setStatus('')
    if (!previous) return
    void previous.pending.catch(() => {}).then(() => request(previous.routeId, 'DELETE', { id: previous.id })).catch(() => {})
    location.release('share')
  }, [location.release])
  const start = () => {
    if (!route || ride.current) return
    ride.current = { id: crypto.randomUUID(), routeId: route.id, lastSent: 0, pending: Promise.resolve() }
    setSharing(true)
    setStatus('Finding your location')
    location.hold('share')
  }
  useEffect(() => {
    if (ride.current && (ride.current.routeId !== route?.id || location.mode !== 'tracking')) stop()
  }, [route?.id, location.mode, stop])
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') stop() }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [stop])
  useEffect(() => {
    const current = ride.current
    const position = location.position
    if (!current || !route || !position || location.mode !== 'tracking' || document.visibilityState !== 'visible') return
    if (!Number.isFinite(position.accuracy) || position.accuracy! > 40) {
      setStatus('Waiting for a clear location')
      return
    }
    const matched = routeProgress(route, position)
    if (!matched || matched.distance > 40) {
      setStatus('Waiting until you are on the route')
      return
    }
    if (Date.now() - current.lastSent < 30_000) return
    current.lastSent = Date.now()
    current.pending = request(route.id, 'POST', { id: current.id, lat: position.lat, lon: position.lon, accuracy: position.accuracy }).then((result) => {
      if (ride.current === current) setStatus(result === 202 ? 'Sending while the app is open. A map hint needs another rider.' : 'This location could not confirm the route yet.')
    }).catch(() => {
      if (ride.current === current) setStatus('Could not share. Will retry with your next location')
    })
  }, [location.position, location.mode, route])
  const visibleIds = visibleRoutes.map(item => item.id).join(',')
  useEffect(() => {
    const routeIds = visibleIds ? visibleIds.split(',') : []
    if (!routeIds.length) { setSignals([]); return }
    let active = true
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void Promise.allSettled(routeIds.map(async routeId => {
        const value = await request(routeId, 'GET') as { signals?: Omit<RiderSignal, 'routeId'>[] }
        return Array.isArray(value.signals) ? value.signals.map(signal => ({ ...signal, routeId })) : []
      })).then(results => {
        if (active) setSignals(results.flatMap(result => result.status === 'fulfilled' ? result.value : []))
      })
    }
    refresh()
    const timer = window.setInterval(refresh, 30_000)
    return () => { active = false; clearInterval(timer) }
  }, [visibleIds])
  useEffect(() => () => {
    const current = ride.current
    if (!current) return
    void current.pending.catch(() => {}).then(() => request(current.routeId, 'DELETE', { id: current.id })).catch(() => {})
    location.release('share')
  }, [location.release])
  return { sharing, status, signals, start, stop }
}
