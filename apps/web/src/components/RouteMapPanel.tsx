import type { useLocation } from '../hooks/useLocation'
import { useState, lazy, Suspense, type PointerEvent } from 'react'
import { ArrowLeft, Clock3, ExternalLink, Heart, MapPin, X } from 'lucide-react'
import { ageSeconds, boardingGuide, clockSkewMessage, fleetName, formatArrival, freshness, officialRouteUrl, routeBadgeInk, serviceState, stopServiceNote, upcomingStops, type Route, type Snapshot, type Stop, type Vehicle } from '@zotstop/transit-engine'
import type { RideChoice } from '../hooks/useActiveRide'
import { ErrorBoundary } from './ErrorBoundary'
import type { useRiderSignals } from '../hooks/useRiderSignals'

const TransitMap = lazy(() => import('./CanvasTransitMap'))

type Props = {
  expanded: boolean
  onToggleExpanded: () => void
  onCollapseHandle: (event: PointerEvent<HTMLButtonElement>) => void
  onBack: () => void
  routes: Route[]
  allRoutes: Route[]
  focusedRoute: Route | undefined
  vehicles: Vehicle[]
  onToggleRoute: (id: string) => void
  onSetRoutes: (ids: string[]) => void
  onSaveView: (name: string) => void
  watchedStopIds: string[]
  onToggleWatched: (stop: Stop) => void
  location: { lat: number; lon: number; accuracy?: number } | null
  trackingLocation: boolean
  selectedStopId: string | null
  selectedStop: Stop | null
  stopRoutes: Route[]
  snapshot: Snapshot | null
  liveError: boolean
  service: ReturnType<typeof serviceState>
  clock: Date
  clockSkewed?: boolean
  onStop: (stop: Stop) => void
  onLocate: ReturnType<typeof useLocation>['locate']
  onZoom: () => void
  feedError: boolean
  locationError: string
  dismissLocationError: () => void
  saved: string[]
  onToggleSaved: (stop: Stop) => void
  onClose: () => void
  riderSignals: ReturnType<typeof useRiderSignals>
  activeRide: RideChoice | null
  onStartRide: (choice: RideChoice) => void
}

export function RouteMapPanel({
  expanded, onToggleExpanded, onCollapseHandle, onBack,
  routes, allRoutes, focusedRoute, vehicles,
  onToggleRoute, onSetRoutes, onSaveView, watchedStopIds, onToggleWatched,
  location, trackingLocation, selectedStopId, selectedStop, stopRoutes,
  snapshot, liveError, service, clock, clockSkewed,
  onStop, onLocate, onZoom, feedError, locationError, dismissLocationError,
  saved, onToggleSaved, onClose, riderSignals, activeRide, onStartRide,
}: Props) {
  const liveStatus = liveError ? 'Live updates unavailable'
    : !snapshot ? 'Loading live updates'
    : clock.getTime() - snapshot.fetchedAt > 45_000 ? 'Live updates delayed'
    : !vehicles.length && !service.active.length ? service.message
    : undefined
  const guide = selectedStop ? boardingGuide(selectedStop) : null
  const [selectedBusKey, setSelectedBusKey] = useState<string | null>(null)
  const [busFollow, setBusFollow] = useState<'bus' | 'phone' | null>(null)
  const selectedBus = vehicles.find(vehicle => `${vehicle.routeId}:${vehicle.id}` === selectedBusKey) ?? null
  const selectedBusRoute = routes.find(route => route.id === selectedBus?.routeId)
  const nextStops = selectedBus && selectedBusRoute ? upcomingStops(selectedBusRoute, selectedBus) : null
  const sheetAnchor = selectedStop
    ? { key: `stop:${selectedStop.id}`, lat: selectedStop.lat, lon: selectedStop.lon }
    : selectedBus
      ? { key: `bus:${selectedBus.routeId}:${selectedBus.id}`, lat: selectedBus.lat, lon: selectedBus.lon }
      : null

  return (
    <section className={`map-pane ${expanded ? 'map-expanded' : ''}`} aria-label="Route map">
      {expanded && clockSkewed && <p className="clock-notice map-clock-notice" role="status">{clockSkewMessage}</p>}
      {routes.length ? (
        <ErrorBoundary fallback={() => (
          <div className="map-unavailable" role="status">
            <span>Map unavailable. Use the stop list.</span>
            {expanded && <button onClick={onToggleExpanded}>Show stops</button>}
            <button onClick={() => window.location.reload()}>Reload map</button>
          </div>
        )}>
          <Suspense fallback={<div className="map-loading">Loading map</div>}>
            <TransitMap
              routes={routes}
              allRoutes={allRoutes}
              focusedRouteId={focusedRoute?.id ?? null}
              vehicles={vehicles}
              onToggleRoute={onToggleRoute}
              onSetRoutes={onSetRoutes}
              onSaveView={onSaveView}
              watchedStopIds={watchedStopIds}
              location={location}
              trackingLocation={trackingLocation}
              selectedStopId={selectedStopId}
              onStop={(stop) => { setSelectedBusKey(null); onStop(stop) }}
              onVehicle={(vehicle) => { setBusFollow(null); setSelectedBusKey(`${vehicle.routeId}:${vehicle.id}`); onClose() }}
              onLocate={onLocate}
              onZoom={onZoom}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              riderSignals={riderSignals.signals}
              liveStatus={liveStatus}
              now={clock.getTime()}
              sheetAnchor={sheetAnchor}
              rideOffer={!riderSignals.sharing && focusedRoute ? (
                <div className="popover-share">
                  <span>On the {focusedRoute.letter} Line? Share your precise location only while the app is open.</span>
                  <button onClick={riderSignals.start}>Share ride</button>
                </div>
              ) : undefined}
              rideControl={expanded && !selectedStop && riderSignals.sharing ? (
                <div className="map-ride-control is-sharing">
                  <div><strong>Sharing this ride</strong><span role="status" title={riderSignals.status}>{riderSignals.status}</span></div>
                  <button onClick={riderSignals.stop}>Stop sharing</button>
                </div>
              ) : undefined}
            />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <div className="map-loading">{feedError ? 'Route data could not be loaded' : 'Loading campus routes'}</div>
      )}

      {expanded && (
        <button className="map-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={16} /> Back
        </button>
      )}
      {expanded && !selectedStop && !selectedBus && (
        <button type="button" className="map-collapse-handle" aria-label="Drag up to leave the full screen map" onPointerDown={onCollapseHandle} />
      )}

      {locationError && (
        <div className="location-error" role="status">
          {locationError}
          <button onClick={dismissLocationError} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      {selectedStop && (
        <div className="stop-popover">
          <div className="stop-popover-head">
            <h2>{selectedStop.name}</h2>
            <span className="stop-code">{selectedStop.code ? `Stop ${selectedStop.code}` : 'Campus stop'}</span>
            <button className="popover-close" onClick={onClose} aria-label="Close stop details"><X size={16} /></button>
          </div>

          {guide && (
            <div className="boarding-guide">
              <MapPin size={15} aria-hidden="true" />
              <span><strong>Board {guide.side}.</strong> {guide.landmark}.</span>
            </div>
          )}
          <p className="boarding-check">Check the route letter and destination on the bus before boarding.</p>

          <div className="stop-route-arrivals" aria-label="Routes at this stop">
            {stopRoutes.map(route => {
              const arrival = snapshot?.arrivals.filter(item => item.routeId === route.id && item.stopId === selectedStop.id).sort((a, b) => a.estimatedAt - b.estimatedAt)[0]
              const vehicle = arrival ? snapshot?.vehicles.find(item => item.id === arrival.vehicleId && item.routeId === route.id) : null
              const label = arrival && vehicle ? formatArrival(arrival.estimatedAt, vehicle.updatedAt, clock.getTime(), vehicle.paceRatio) : 'Time unavailable'
              const index = route.stops.findIndex(stop => stop.id === selectedStopId)
              const next = index >= 0 ? route.stops[(index + 1) % route.stops.length] : null
              return (
                <div className="stop-route-arrival" key={route.id}>
                  <span className="route-badge" style={{ '--route-color': route.color, '--route-ink': routeBadgeInk(route.color) } as React.CSSProperties}>{route.letter}</span>
                  <div className="stop-route-copy">
                    <strong>{route.name}</strong>
                    {next && <small>Next: {next.name}</small>}
                    <span className="stop-route-time">
                      <Clock3 size={14} aria-hidden="true" />
                      <strong>{label}</strong>
                    </span>
                  </div>
                  <a href={officialRouteUrl(route)} target="_blank" rel="noopener noreferrer" aria-label={`Official ${route.name} route and schedule`}>
                    <ExternalLink size={15} />
                  </a>
                </div>
              )
            })}
          </div>

          <p className="arrival-explainer">{stopServiceNote(selectedStop)}</p>

          <div className="ride-choices">
            <p>Get off at this stop. Follow this phone, or select the bus you are on.</p>
            {stopRoutes.map(route => {
              const buses = vehicles.filter(vehicle => vehicle.routeId === route.id && fleetName(vehicle) && freshness(vehicle.updatedAt, clock.getTime()) !== 'stale')
              const unnamed = vehicles.filter(vehicle => vehicle.routeId === route.id && !fleetName(vehicle) && freshness(vehicle.updatedAt, clock.getTime()) !== 'stale').length
              const phoneOn = activeRide?.mode === 'phone' && !activeRide.vehicleId && activeRide.routeId === route.id && activeRide.stopId === selectedStop.id
              return (
                <div className="ride-choice-route" key={route.id}>
                  <button type="button" aria-pressed={phoneOn} onClick={() => onStartRide({ routeId: route.id, stopId: selectedStop.id, mode: 'phone', vehicleId: null, fleetName: null })}>
                    {stopRoutes.length > 1 ? `Follow the ${route.letter} Line with this phone` : 'Follow with this phone'}
                  </button>
                  {buses.map(vehicle => {
                    const name = fleetName(vehicle)!
                    const riding = activeRide?.mode === 'bus' && activeRide.vehicleId === vehicle.id && activeRide.stopId === selectedStop.id
                    return <button type="button" key={vehicle.id} aria-pressed={riding} onClick={() => onStartRide({ routeId: route.id, stopId: selectedStop.id, mode: 'bus', vehicleId: vehicle.id, fleetName: name })}>
                      Follow {name}{stopRoutes.length > 1 ? ` on the ${route.letter} Line` : ''}. Reported {ageSeconds(vehicle.updatedAt, clock.getTime())}s ago
                    </button>
                  })}
                  {unnamed > 0 && <p>{unnamed === 1 ? 'One report has' : `${unnamed} reports have`} no fleet name printed on the bus, so {unnamed === 1 ? 'it is' : 'they are'} not listed.</p>}
                  {!buses.length && <p>No bus on the {route.letter} Line is reporting a fleet name right now.</p>}
                </div>
              )
            })}
            <p>A late bus report can make a get-off alert early or late. This phone also checks a reported bus only when exactly one is close.</p>
          </div>
          <div className="stop-actions">
            <button className={`save-stop ${saved.includes(selectedStop.id) ? 'is-saved' : ''}`} onClick={() => onToggleSaved(selectedStop)}>
              <Heart size={15} fill={saved.includes(selectedStop.id) ? 'currentColor' : 'none'} />
              {saved.includes(selectedStop.id) ? 'Saved' : 'Save stop'}
            </button>
            <button className={`watch-stop ${watchedStopIds.includes(selectedStop.id) ? 'is-watched' : ''}`} onClick={() => onToggleWatched(selectedStop)}>
              {watchedStopIds.includes(selectedStop.id) ? 'Watching' : 'Watch stop'}
            </button>
          </div>

          {(riderSignals.sharing || (focusedRoute && stopRoutes.some(r => r.id === focusedRoute.id))) && (
            <div className="popover-share">
              <span>{riderSignals.sharing ? riderSignals.status : `On the ${focusedRoute?.letter} Line? Share your precise location only while the app is open.`}</span>
              <button onClick={riderSignals.sharing ? riderSignals.stop : riderSignals.start}>
                {riderSignals.sharing ? 'Stop sharing' : 'Share ride'}
              </button>
            </div>
          )}
        </div>
      )}
      {selectedBusKey && !selectedStop && (
        <div className="stop-popover" role="dialog" aria-label={fleetName(selectedBus ?? { name: '' }) ? `Bus ${fleetName(selectedBus!)}` : 'Reported bus'}>
          <div className="stop-popover-head">
            <h2>{fleetName(selectedBus ?? {}) ?? 'No fleet name in this report'}</h2>
            <span className="stop-code">{selectedBusRoute ? `${selectedBusRoute.letter} Line` : 'Reported bus'}</span>
            <button className="popover-close" onClick={() => setSelectedBusKey(null)} aria-label="Close bus details"><X size={16} /></button>
          </div>
          {!selectedBus && <p className="arrival-explainer">This bus is no longer reporting.</p>}
          {selectedBus && <>
            <p className="arrival-explainer">Reported {ageSeconds(selectedBus.updatedAt, clock.getTime())} seconds ago. This is the name printed on the bus.</p>
            {nextStops && nextStops.length > 0 && (
              <div className="upcoming-stops">
                <div className="section-label">Upcoming stops</div>
                <ol>
                  {nextStops.map(stop => <li key={stop.id}>{stop.name}</li>)}
                </ol>
              </div>
            )}
            {selectedBus.delayed && <p className="arrival-explainer">The operator marked this bus delayed. A late position can make a get-off alert early or late.</p>}
            {selectedBus.onRoute === false && <p className="arrival-explainer">The operator marked this bus off its route.</p>}
            {fleetName(selectedBus) && selectedBusRoute && (
              <div className="ride-choices">
                <p>Choose how to follow {fleetName(selectedBus)}, then the stop where you get off.</p>
                <button type="button" className="secondary" aria-pressed={busFollow === 'bus'} onClick={() => setBusFollow('bus')}>This bus only</button>
                <button type="button" className="secondary" aria-pressed={busFollow === 'phone'} onClick={() => setBusFollow('phone')}>This phone and this bus</button>
                {busFollow && selectedBusRoute.stops.map(stop => (
                  <button type="button" key={stop.id} onClick={() => onStartRide({
                    routeId: selectedBusRoute.id,
                    stopId: stop.id,
                    mode: busFollow === 'phone' ? 'phone' : 'bus',
                    vehicleId: selectedBus.id,
                    fleetName: fleetName(selectedBus),
                  })}>Get off at {stop.name}</button>
                ))}
              </div>
            )}
            {selectedBus && !fleetName(selectedBus) && <p className="arrival-explainer">This report has no fleet name, so it cannot be selected.</p>}
          </>}
        </div>
      )}
    </section>
  )
}
