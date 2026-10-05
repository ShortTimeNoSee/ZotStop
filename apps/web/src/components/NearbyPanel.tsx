import { useState } from 'react'
import { ArrowRight, BusFront, RefreshCw } from 'lucide-react'
import {
  distanceMeters,
  boardingGuide,
  departureBoard,
  formatArrival,
  officialUpdatesUrl,
  routeDescription,
  routeBadgeInk,
  serviceState,
  shownLocationMeters,
  type Route,
  type Stop,
  type Vehicle,
} from '@zotstop/transit-engine'
import type { useLiveTransit } from '../hooks/useLiveTransit'
import type { useLocation } from '../hooks/useLocation'
import type { useRiderSignals } from '../hooks/useRiderSignals'
import { TransitSearch } from './TransitSearch'

type Props = {
  service: ReturnType<typeof serviceState>
  feedError: boolean
  routesAgeDays: number | null
  clock: Date
  locationControl: ReturnType<typeof useLocation>
  locate: () => void
  recommended: Route[]
  routes: Route[]
  visibleRoutes: Route[]
  watchedStopIds: string[]
  route: Route | undefined
  stops: Stop[]
  selectedStopId: string | null
  routeVehicles: Vehicle[]
  routeFreshness: string
  liveAgeSeconds: number | null
  live: ReturnType<typeof useLiveTransit>
  location: { lat: number; lon: number; accuracy?: number } | null
  recentStopIds: string[]
  onAllRoutes: () => void
  selectRoute: (route: Route) => void
  selectStop: (stop: Stop) => void
  riderSignals: ReturnType<typeof useRiderSignals>
}

export function NearbyPanel({
  service,
  feedError,
  routesAgeDays,
  clock,
  locationControl,
  locate,
  recommended,
  routes,
  visibleRoutes,
  watchedStopIds,
  route,
  stops,
  selectedStopId,
  routeVehicles,
  routeFreshness,
  liveAgeSeconds,
  live,
  location,
  recentStopIds,
  onAllRoutes,
  selectRoute,
  selectStop,
  riderSignals,
}: Props) {
  const [query, setQuery] = useState('')
  const nearYou = location != null && (location.accuracy ?? 0) <= shownLocationMeters
  const board = departureBoard(visibleRoutes, live.snapshot, nearYou ? location : null, clock.getTime())
  const open = service.active.length > 0
  const ageLabel = (() => {
    if (feedError) return 'Using saved routes'
    if (routesAgeDays === null || routesAgeDays <= 7) return null
    return `Routes updated ${routesAgeDays === 0 ? 'today' : `${routesAgeDays}d ago`}`
  })()

  return (
    <>
      <div className="status-bar" role="status">
        <span className={`status-dot ${service.active.length ? '' : 'inactive'}`} aria-hidden="true" />
        <span>{service.message}</span>
        {ageLabel && <span className="status-age" title="Route data may be outdated">{ageLabel}</span>}
        <span className="status-time">{new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(clock)}</span>
      </div>

      <TransitSearch
        routes={routes}
        query={query}
        onQuery={setQuery}
        recentIds={recentStopIds}
        onSelectStop={selectStop}
        onSelectRoute={selectRoute}
      />

      {open ? (
        <section className="departure-board" aria-label={board.nearYou ? 'Departures near you' : 'Campus departures'}>
          <div className="section-label">{board.nearYou ? 'Departures near you' : 'Campus departures'}</div>
          {board.stops.length === 0 && <p className="departure-empty">No stops in walking distance.</p>}
          {board.stops.map(group => (
            <button key={group.stop.id} type="button" className="departure-stop" onClick={() => selectStop(group.stop)}>
              <span className="departure-stop-name">{group.stop.name}</span>
              <span className="departure-lines">
                {group.departures.map(item => (
                  <span className="departure-line" key={item.route.id}>
                    <span className="route-badge" style={{ '--route-color': item.route.color, '--route-ink': routeBadgeInk(item.route.color) } as React.CSSProperties}>{item.route.letter}</span>
                    <span>{item.label}</span>
                    {item.fleetNumber && <span className="departure-fleet">{item.fleetNumber}</span>}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </section>
      ) : (
        <div className="service-closed" role="status">
          <p>{service.message}</p>
          <a href={officialUpdatesUrl} target="_blank" rel="noreferrer">Operator updates</a>
        </div>
      )}

      {watchedStopIds.length > 0 && (
        <div className="watch-board">
          <div className="section-label">Watching</div>
          {watchedStopIds.map(id => {
            const serving = visibleRoutes.filter(item => item.stops.some(stop => stop.id === id))
            const stop = serving[0]?.stops.find(item => item.id === id)
            return stop ? (
              <button className="watch-row" key={id} onClick={() => selectStop(stop)}>
                <span className="watch-row-name">{stop.name}</span>
                <span className="watch-row-times">
                  {serving.map(item => {
                    const arrival = live.snapshot?.arrivals.filter(v => v.routeId === item.id && v.stopId === id).sort((a, b) => a.estimatedAt - b.estimatedAt)[0]
                    const vehicle = arrival ? live.snapshot?.vehicles.find(v => v.id === arrival.vehicleId && v.routeId === item.id) : null
                    const label = arrival && vehicle ? formatArrival(arrival.estimatedAt, vehicle.updatedAt, clock.getTime(), vehicle.paceRatio) : 'No time'
                    return <span className="watch-route" key={item.id}><span className="route-badge" style={{ '--route-color': item.color, '--route-ink': routeBadgeInk(item.color) } as React.CSSProperties}>{item.letter}</span>{label}</span>
                  })}
                </span>
              </button>
            ) : null
          })}
        </div>
      )}

      {open && <>
      <div className="section-label">
        Running now
        <button onClick={onAllRoutes}>All routes</button>
      </div>
      <div className="quick-routes">
        {(recommended.length ? recommended : routes.slice(0, 3)).map(item => (
          <button
            data-testid={`route-card-${item.letter.toLowerCase()}-line`}
            key={item.id}
            className={`quick-card ${route?.id === item.id ? 'active' : ''}`}
            onClick={() => selectRoute(item)}
          >
            <span className="route-badge" style={{ '--route-color': item.color, '--route-ink': routeBadgeInk(item.color) } as React.CSSProperties}>{item.letter}</span>
            <span className="quick-copy">
              <strong>{item.name}</strong>
              <small>{routeDescription(item)}</small>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      </>}

      <div className="location-card">
        <div>
          <strong>Location</strong>
          <span>
            {locationControl.held && locationControl.mode === 'tracking' ? 'On for your ride. Location stays on this device.'
              : locationControl.mode === 'tracking' ? 'Following your position'
              : locationControl.mode === 'paused' ? 'Paused at your last position'
              : locationControl.mode === 'finding' ? 'Finding your position'
              : locationControl.mode === 'once' ? 'Tracking off'
              : 'Off'}
          </span>
        </div>
        <div className="location-options">
          <button onClick={locate} disabled={locationControl.mode === 'finding'}>Locate once</button>
          {locationControl.held && locationControl.mode === 'tracking'
            ? null
            : locationControl.mode === 'tracking'
            ? <button onClick={() => void locationControl.pause()}>Pause</button>
            : <button onClick={() => void locationControl.start()}>{locationControl.mode === 'paused' ? 'Resume' : 'Follow me'}</button>}
          {locationControl.mode !== 'off' && !locationControl.held && <button onClick={() => void locationControl.stop()}>Stop</button>}
        </div>
      </div>

      {route && <>
        <div className="route-detail-head">
          <span className="route-badge" style={{ '--route-color': route.color, '--route-ink': routeBadgeInk(route.color) } as React.CSSProperties}>{route.letter}</span>
          <span className="route-detail-name">{route.name}</span>
          <span className={`route-live-status ${routeFreshness}`} role="status">
            {live.error
              ? liveAgeSeconds !== null ? `${liveAgeSeconds < 60 ? `${liveAgeSeconds}s` : `${Math.floor(liveAgeSeconds / 60)}m`} old` : 'Unavailable'
              : routeFreshness === 'fresh' ? 'Live'
              : routeFreshness === 'aging' ? 'Delayed'
              : routeFreshness === 'stale' ? 'Stale'
              : 'No vehicles'}
          </span>
          <button className="live-refresh" aria-label="Refresh" onClick={() => void live.refresh()}>
            <RefreshCw size={15} className={live.refreshing ? 'spinning' : ''} />
          </button>
        </div>

        <div className={`rider-share ${riderSignals.sharing ? 'is-sharing' : ''}`}>
          <BusFront size={20} aria-hidden="true" />
          <div>
            <strong>{riderSignals.sharing ? 'Sharing this ride' : 'On this bus?'}</strong>
            <span>{riderSignals.sharing ? riderSignals.status : 'Your location is checked then discarded. Not stored.'}</span>
          </div>
          <button onClick={riderSignals.sharing ? riderSignals.stop : riderSignals.start}>
            {riderSignals.sharing ? 'Stop' : 'Share ride'}
          </button>
        </div>
        {riderSignals.signals.length > 0 && (
          <div className="rider-note" role="status">
            {riderSignals.signals.length} rider area{riderSignals.signals.length !== 1 ? 's' : ''} on this route. Approximate and unverified.
          </div>
        )}

        <div className="stop-header">
          <strong>Stops</strong>
          <span>{route.stops.length} stops</span>
        </div>
        <div className="stop-list">
          {stops.map((stop, index) => {
            const arrival = live.snapshot?.arrivals
              .filter(item => item.routeId === route.id && item.stopId === stop.id)
              .sort((a, b) => a.estimatedAt - b.estimatedAt)[0]
            const vehicle = arrival ? routeVehicles.find(item => item.id === arrival.vehicleId) : null
            const label = arrival && vehicle
              ? formatArrival(arrival.estimatedAt, vehicle.updatedAt, clock.getTime(), vehicle.paceRatio)
              : null
            const guide = boardingGuide(stop)
            return (
              <button
                key={`${stop.id}-${index}`}
                className={`stop-row ${selectedStopId === stop.id ? 'selected' : ''}`}
                onClick={() => selectStop(stop)}
              >
                <span className="stop-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="stop-name">
                  <strong>{stop.name}</strong>
                  <small>
                    {stop.code ? `Stop ${stop.code}` : 'Campus stop'}
                    {guide ? ` · ${guide.side}` : ''}
                    {nearYou && location ? ` · ${Math.round(distanceMeters(location, stop))} m` : ''}
                  </small>
                </span>
                <span className={`stop-eta ${label ? '' : 'no-data'}`}>{label ?? 'No time'}</span>
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            )
          })}
        </div>
      </>}
    </>
  )
}
