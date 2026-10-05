import { useEffect, useSyncExternalStore } from 'react'
import { App as NativeApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

export type Screen = 'nearby' | 'routes' | 'saved'
type Navigation = {
  screen: Screen
  routeId: string | null
  selectedStopId: string | null
  mapExpanded: boolean
  depth: number
}

const fallback: Navigation = {
  screen: 'nearby', routeId: null, selectedStopId: null, mapExpanded: false, depth: 0,
}
const eventName = 'zotstop-navigation'
const screens: Screen[] = ['nearby', 'routes', 'saved']

export function navigationFromSearch(search: string): Navigation | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  params.delete('lat')
  params.delete('lon')
  params.delete('accuracy')
  const screen = params.get('screen')
  const routeId = params.get('route')
  const stop = params.get('stop')
  if (!screen && !routeId && !stop) return null
  return {
    screen: screens.includes(screen as Screen) ? screen as Screen : 'nearby',
    routeId: routeId || null,
    selectedStopId: stop || null,
    mapExpanded: false,
    depth: 0,
  }
}

export function navigationHref(nav: Pick<Navigation, 'screen' | 'routeId' | 'selectedStopId'>, pathname: string) {
  const params = new URLSearchParams()
  if (nav.screen !== 'nearby') params.set('screen', nav.screen)
  if (nav.routeId) params.set('route', nav.routeId)
  if (nav.selectedStopId) params.set('stop', nav.selectedStopId)
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ''}`
}

let querySnapshot: Navigation | null = null
let queryKey = ''

function readStored(): Navigation | null {
  const value = window.history.state?.zotstop
  if (!value || typeof value !== 'object') return null
  const screen = value.screen === 'map' ? 'nearby' : value.screen
  if (
    !screens.includes(screen) ||
    !Number.isInteger(value.depth) || value.depth < 0 ||
    typeof value.mapExpanded !== 'boolean' ||
    (value.routeId !== null && typeof value.routeId !== 'string') ||
    (value.selectedStopId !== null && typeof value.selectedStopId !== 'string')
  ) return null
  if (value.screen === 'map') return { ...value, screen: 'nearby', mapExpanded: true }
  return value as Navigation
}

function current(): Navigation {
  const stored = readStored()
  if (stored) return stored
  const key = window.location.search
  if (querySnapshot && queryKey === key) return querySnapshot
  queryKey = key
  querySnapshot = navigationFromSearch(key) ?? fallback
  return querySnapshot
}

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback)
  window.addEventListener(eventName, callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener(eventName, callback)
  }
}

function navigate(changes: Partial<Omit<Navigation, 'depth'>>, replace = false) {
  const before = current()
  const next = { ...before, ...changes }
  if (next.screen === before.screen && next.routeId === before.routeId && next.selectedStopId === before.selectedStopId && next.mapExpanded === before.mapExpanded) return
  next.depth = replace ? before.depth : before.depth + 1
  const href = navigationHref(next, window.location.pathname)
  window.history[replace ? 'replaceState' : 'pushState']({ zotstop: next }, '', href)
  window.dispatchEvent(new Event(eventName))
}

function back() {
  if (current().depth > 0) window.history.back()
  else navigate({ screen: 'nearby', selectedStopId: null, mapExpanded: false }, true)
}

export function useNavigation() {
  const navigation = useSyncExternalStore(subscribe, current, () => fallback)
  useEffect(() => {
    if (window.history.state?.zotstop !== navigation)
      window.history.replaceState({ zotstop: navigation }, '', navigationHref(navigation, window.location.pathname))
  }, [navigation])
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    const listener = NativeApp.addListener('backButton', () => {
      if (current().depth > 0) window.history.back()
      else void NativeApp.minimizeApp()
    })
    return () => {
      cancelled = true
      void listener.then(handle => { if (cancelled) void handle.remove() })
    }
  }, [])
  return { navigation, navigate, back }
}
