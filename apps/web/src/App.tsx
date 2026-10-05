import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'
import { Capacitor, CapacitorHttp } from '@capacitor/core'
import {
  ageSeconds,
  clockSkewMessage,
  distanceMeters,
  serviceState,
  suggestedRoutes,
  type Route,
  type Stop,
} from '@zotstop/transit-engine'
import { readRecentStops, rememberStop } from './search'
import { useTransitFeed } from './hooks/useTransitFeed'
import { useLiveTransit } from './hooks/useLiveTransit'
import { useLocation } from './hooks/useLocation'
import { useRiderSignals } from './hooks/useRiderSignals'
import { useActiveRide } from './hooks/useActiveRide'
import { useVisibleRoutes } from './hooks/useVisibleRoutes'
import { useSavedViews } from './hooks/useSavedViews'
import { QuantUx } from '@zotstop/telemetry-client'
import { useNavigation } from './hooks/useNavigation'
import { useSwipeTabs } from './hooks/useSwipeTabs'
import { useMapStretch } from './hooks/useMapStretch'
import { NearbyPanel } from './components/NearbyPanel'
import { InfoPanel } from './components/InfoPanel'
import { RoutesPanel } from './components/RoutesPanel'
import { SavedPanel } from './components/SavedPanel'
import { RouteMapPanel } from './components/RouteMapPanel'
import { NavigationTabs } from './components/NavigationTabs'
import { ActiveRideBar } from './components/ActiveRideBar'
import { touchFeedback } from './nativeFeedback'

function App() {
  const { feed, error: feedError } = useTransitFeed()
  const routes = useMemo(() => feed?.routes ?? [], [feed])
  const routeIds = routes.map((item) => item.id.replace(/^TL-/, '')).join(',')
  const live = useLiveTransit(routeIds, routes)
  const [clock, setClock] = useState(new Date())
  const [recentStopIds, setRecentStopIds] = useState(readRecentStops)
  const clockOffsetRef = useRef(live.clockOffset)
  clockOffsetRef.current = live.clockOffset
  const { navigation, navigate, back } = useNavigation()
  const { screen, routeId, selectedStopId, mapExpanded } = navigation
  const [infoOpen, setInfoOpen] = useState(false)
  const ux = useRef(new QuantUx(async (events) => {
      if (Capacitor.isNativePlatform()) {
        await CapacitorHttp.post({
          url: `${import.meta.env.VITE_TRANSIT_API_URL || 'https://zotstop-edge-proxy.theedenwatcher.workers.dev'}/api/v1/ux`,
          headers: { 'Content-Type': 'application/json' },
          data: events,
        })
      } else {
        await fetch('/api/v1/ux', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(events),
        })
      }
    }))
  const [uxEnabled, setUxEnabled] = useState(false)
  useEffect(() => { setUxEnabled(ux.current.enabled()) }, [])
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [screen])
  const swipeTabs = useSwipeTabs(screen, (next) => {
    touchFeedback()
    navigate({ screen: next, selectedStopId: null })
  })
  const launchedAt = useRef(performance.now())
  const firstRouteRecorded = useRef(false)
  const firstStopRecorded = useRef(false)
  const zoomRecorded = useRef(false)
  const [saved, setSaved] = useState<string[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('zotstop-saved-stops') || '[]')
      return Array.isArray(stored) ? [...new Set(stored.filter((value): value is string => typeof value === 'string').map(value => value.split(':').at(-1)!))] : []
    } catch { return [] }
  })
  const [watched, setWatched] = useState<string[]>(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem('zotstop-watched-stops-v1') || '[]')
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    } catch { return [] }
  })
  const savedViews = useSavedViews()
  const locationControl = useLocation()
  const location = locationControl.position
  const locationError = locationControl.error
  const setLocationError = locationControl.setError
  useEffect(() => {
    let interval: number | undefined
    const update = () => setClock(new Date(Date.now() - clockOffsetRef.current))
    const resume = () => {
      window.clearInterval(interval)
      interval = undefined
      if (document.visibilityState !== 'visible') return
      update()
      interval = window.setInterval(update, 15000)
    }
    resume()
    document.addEventListener('visibilitychange', resume)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', resume) }
  }, [])
  useEffect(() => {
    setClock(new Date(Date.now() - live.clockOffset))
  }, [live.clockOffset])
  useEffect(() => {
    if (!infoOpen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setInfoOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [infoOpen])
  useEffect(() => {
    if (!mapExpanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !infoOpen) back() }
    window.addEventListener('keydown', onKeyDown)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKeyDown) }
  }, [mapExpanded, back, infoOpen])
  const recommended = useMemo(() => suggestedRoutes(routes, clock), [routes, clock])
  const visibleRoutes = useVisibleRoutes(routes, recommended[0] ?? routes[0])
  useEffect(() => {
    if (!routes.length) return
    const missing: string[] = []
    if (routeId && routes.some(item => item.id === routeId) && !visibleRoutes.ids.includes(routeId)) missing.push(routeId)
    if (selectedStopId) {
      const serving = routes.filter(item => item.stops.some(stop => stop.id === selectedStopId))
      const covered = serving.some(item => visibleRoutes.ids.includes(item.id) || missing.includes(item.id))
      if (!covered && serving[0]) missing.push(serving[0].id)
    }
    if (missing.length) visibleRoutes.set([...visibleRoutes.ids, ...missing])
  }, [selectedStopId, routeId, routes, visibleRoutes])
  const route = visibleRoutes.visible.find(item => item.id === routeId) ?? visibleRoutes.visible[0]
  const riderSignals = useRiderSignals(route, locationControl, visibleRoutes.visible)
  const activeRide = useActiveRide(routes, locationControl, live.snapshot?.vehicles ?? [])
  const stopRoutes = selectedStopId ? visibleRoutes.visible.filter(item => item.stops.some(stop => stop.id === selectedStopId)) : []
  const selectedStop = stopRoutes.flatMap(item => item.stops).find(stop => stop.id === selectedStopId) ?? null
  const service = serviceState(clock)
  const routeVehicles = live.snapshot?.vehicles.filter((vehicle) => vehicle.routeId === route?.id) ?? []
  const mapVehicles = live.snapshot?.vehicles.filter(vehicle => visibleRoutes.ids.includes(vehicle.routeId)) ?? []
  const oldestAge = routeVehicles.length
    ? Math.max(...routeVehicles.map((vehicle) => ageSeconds(vehicle.updatedAt, clock.getTime())))
    : null
  const routeFreshness = oldestAge === null ? 'none'
    : oldestAge <= 20 ? 'fresh'
    : oldestAge <= 90 ? 'aging'
    : 'stale'
  const routesAgeDays = feed ? Math.floor((clock.getTime() - Date.parse(feed.generatedAt)) / 86400000) : null
  const liveAgeSeconds = live.snapshot ? ageSeconds(live.snapshot.fetchedAt, clock.getTime()) : null
  const stops = useMemo(() => {
    if (!route) return []
    if (!location || (location.accuracy ?? 0) > 200) return route.stops
    return [...route.stops].sort((a, b) => distanceMeters(location, a) - distanceMeters(location, b))
  }, [route, location])
  const toggleSaved = (stop: Stop) => {
    touchFeedback()
    const next = saved.includes(stop.id) ? saved.filter(item => item !== stop.id) : [...saved, stop.id]
    setSaved(next)
    localStorage.setItem('zotstop-saved-stops', JSON.stringify(next))
  }
  const toggleWatched = (stop: Stop) => {
    touchFeedback()
    const next = watched.includes(stop.id) ? watched.filter(id => id !== stop.id) : [...watched, stop.id]
    setWatched(next)
    localStorage.setItem('zotstop-watched-stops-v1', JSON.stringify(next))
  }
  const locate = () => locationControl.locate()
  const selectRoute = (next: Route) => {
    touchFeedback()
    if (!firstRouteRecorded.current) {
      firstRouteRecorded.current = true
      ux.current.record('route_found_quickly', performance.now() - launchedAt.current <= 1800)
    }
    visibleRoutes.include(next.id)
    navigate({ routeId: next.id, selectedStopId: null, screen: 'nearby' })
  }
  const toggleVisibleRoute = (id: string) => {
    touchFeedback()
    if (visibleRoutes.ids.length === 1 && visibleRoutes.ids.includes(id)) return
    visibleRoutes.toggle(id)
    if (route?.id === id && visibleRoutes.ids.includes(id)) {
      navigate({ routeId: visibleRoutes.ids.find(value => value !== id) ?? null, selectedStopId: null }, true)
    }
  }
  const selectStop = (stop: Stop) => {
    touchFeedback()
    setRecentStopIds(rememberStop(stop.id))
    if (!firstStopRecorded.current) {
      firstStopRecorded.current = true
      ux.current.record('stop_found_quickly', performance.now() - launchedAt.current <= 10000)
    }
    const servingAll = routes.filter(item => item.stops.some(candidate => candidate.id === stop.id))
    const serving = servingAll.find(item => visibleRoutes.ids.includes(item.id)) ?? servingAll[0]
    const phone = window.matchMedia('(max-width: 850px)').matches
    navigate({ routeId: serving?.id ?? route?.id ?? null, selectedStopId: stop.id, mapExpanded: mapExpanded || phone }, mapExpanded)
  }
  const panelContent = screen === 'nearby' ? (
    <NearbyPanel
      service={service}
      feedError={feedError}
      routesAgeDays={routesAgeDays}
      clock={clock}
      locationControl={locationControl}
      locate={locate}
      recommended={recommended}
      routes={routes}
      visibleRoutes={visibleRoutes.visible}
      watchedStopIds={watched}
      route={route}
      stops={stops}
      selectedStopId={selectedStopId}
      routeVehicles={routeVehicles}
      routeFreshness={routeFreshness}
      liveAgeSeconds={liveAgeSeconds}
      live={live}
      location={location}
      onAllRoutes={() => navigate({ screen: 'routes', selectedStopId: null })}
      selectRoute={selectRoute}
      selectStop={selectStop}
      riderSignals={riderSignals}
      recentStopIds={recentStopIds}
    />
  ) : screen === 'routes' ? (
    <RoutesPanel
      routes={routes}
      visibleIds={visibleRoutes.ids}
      recentStopIds={recentStopIds}
      selectStop={selectStop}
      onToggleVisible={toggleVisibleRoute}
      back={back}
      selectRoute={selectRoute}
    />
  ) : screen === 'saved' ? (
    <SavedPanel
      saved={saved}
      routes={routes}
      views={savedViews.views}
      onRenameView={savedViews.rename}
      onRemoveView={savedViews.remove}
      onOpenView={(view) => {
        visibleRoutes.set(view.routeIds)
        setWatched(view.stopIds)
        localStorage.setItem('zotstop-watched-stops-v1', JSON.stringify(view.stopIds))
        navigate({ routeId: view.routeIds[0] ?? null, selectedStopId: null, screen: 'nearby' })
      }}
      onSelect={(nextStopId) => {
        setRecentStopIds(rememberStop(nextStopId))
        const serving = routes.filter(item => item.stops.some(stop => stop.id === nextStopId))
        visibleRoutes.set(serving.map(item => item.id))
        navigate({ routeId: serving[0]?.id ?? null, selectedStopId: nextStopId, mapExpanded: window.matchMedia('(max-width: 850px)').matches })
      }}
      onBrowse={() => navigate({ screen: 'routes', selectedStopId: null })}
    />
  ) : null

  const isMapFullscreen = mapExpanded
  const mapStretch = useMapStretch(
    isMapFullscreen,
    () => { if (!mapExpanded) navigate({ mapExpanded: true }) },
    () => { if (mapExpanded) back() },
  )

  return (
    <div ref={mapStretch.shellRef} className={`app-shell screen-${screen} ${isMapFullscreen ? 'map-fullscreen' : ''}`}>
      <a className="skip-link" href="#transit-information">Skip to transit information</a>
      <header className="topbar">
        <div className="brand">ZotStop</div>
        <button className="info-trigger" type="button" onClick={() => setInfoOpen(true)} aria-label="About and settings">
          <Info size={18} />
        </button>
      </header>
      {infoOpen && (
        <div className="info-overlay" role="dialog" aria-modal="true" aria-label="About ZotStop">
          <div className="info-sheet">
            <div className="info-sheet-head">
              <strong>About</strong>
              <button onClick={() => setInfoOpen(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <InfoPanel
              uxEnabled={uxEnabled}
              onToggle={(enabled) => { ux.current.setEnabled(enabled); setUxEnabled(enabled) }}
            />
          </div>
        </div>
      )}
      {!isMapFullscreen && (
        <NavigationTabs screen={screen} variant="external" onSelect={(next) => navigate({ screen: next, selectedStopId: null })} />
      )}
      {activeRide.guidance && activeRide.route && (
        <ActiveRideBar
          letter={activeRide.route.letter}
          guidance={activeRide.guidance}
          note={activeRide.note}
          sound={activeRide.sound}
          onToggleSound={activeRide.toggleSound}
          onEnd={activeRide.end}
        />
      )}
      {live.clockOffset !== 0 && <p className="clock-notice" role="status">{clockSkewMessage}</p>}
      <main className="main-grid">
        <section
            id="transit-information"
            className="content-pane"
            aria-label="Transit information"
            onTouchStart={swipeTabs.onTouchStart}
            onTouchMove={swipeTabs.onTouchMove}
            onTouchEnd={swipeTabs.onTouchEnd}
            onTouchCancel={swipeTabs.onTouchCancel}
          >
            <div className="panel-pages" ref={swipeTabs.content}>
              {panelContent}
            </div>
            <NavigationTabs screen={screen} variant="inline" onSelect={(next) => navigate({ screen: next, selectedStopId: null })} />
          </section>
        <RouteMapPanel
          expanded={isMapFullscreen}
          onToggleExpanded={() => isMapFullscreen ? back() : navigate({ mapExpanded: true })}
          onCollapseHandle={mapStretch.onHandlePointerDown}
          routes={visibleRoutes.visible}
          allRoutes={routes}
          focusedRoute={route}
          vehicles={mapVehicles}
          onToggleRoute={toggleVisibleRoute}
          onSetRoutes={visibleRoutes.set}
          onSaveView={(name) => savedViews.add(name, visibleRoutes.ids, watched.filter(id => visibleRoutes.visible.some(item => item.stops.some(stop => stop.id === id))))}
          watchedStopIds={watched}
          onToggleWatched={toggleWatched}
          location={location}
          trackingLocation={locationControl.mode === 'tracking'}
          selectedStopId={selectedStopId}
          selectedStop={selectedStop}
          stopRoutes={stopRoutes}
          snapshot={live.snapshot}
          liveError={live.error}
          service={service}
          clock={clock}
          clockSkewed={live.clockOffset !== 0}
          onStop={selectStop}
          onLocate={locate}
          onZoom={() => { if (!zoomRecorded.current) { zoomRecorded.current = true; ux.current.record('map_zoom_used', true) } }}
          feedError={feedError}
          locationError={locationError}
          dismissLocationError={() => setLocationError('')}
          saved={saved}
          onToggleSaved={toggleSaved}
          onClose={() => navigate({ selectedStopId: null }, true)}
          riderSignals={riderSignals}
          activeRide={activeRide.target}
          onStartRide={activeRide.start}
          onBack={() => navigate({ screen: 'nearby', mapExpanded: false }, true)}
        />
      </main>
    </div>
  )
}

export default App
