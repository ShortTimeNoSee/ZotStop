import { ArrowRight, BusFront, Radio, RefreshCw } from 'lucide-react'
import {
  distanceMeters,
  boardingGuide,
  formatArrival,
  routeDescription,
  routeBadgeInk,
  type Route,
  type Stop,
  type Vehicle,
  serviceState,
} from '@zotstop/transit-engine'
import type { useLiveTransit } from '../hooks/useLiveTransit'
import type { useLocation } from '../hooks/useLocation'
import type { useRiderSignals } from '../hooks/useRiderSignals'

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
  onAllRoutes: () => void
  selectRoute: (route: Route) => void
  selectStop: (stop: Stop) => void
  riderSignals: ReturnType<typeof useRiderSignals>
}

export function HomePanel({
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
  onAllRoutes,
  selectRoute,
  selectStop,
  riderSignals,
}: Props) {
  return (
    <>
      <div className="intro">
        <div className="eyebrow eyebrow-blue">
          <span className="tiny-line" /> ANTEATER EXPRESS
        </div>
        <h1>
          Find your bus<span>.</span>
        </h1>
        <p>Routes, stops, and the latest bus locations.</p>
      </div>
      <div className="service-strip">
        <span
          className={`service-pulse ${service.active.length ? '' : 'inactive'}`}
        />
        <span>{service.message}</span>
        {(feedError || (routesAgeDays !== null && routesAgeDays > 7)) && (
          <span
            className="route-age"
            title={feedError ? 'Using saved routes' : 'Routes may have changed'}
          >
            Routes updated{' '}
            {routesAgeDays === null
              ? 'earlier'
              : routesAgeDays === 0
                ? 'today'
                : `${routesAgeDays}d ago`}
          </span>
        )}
        <span className="service-clock">
          {new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'America/Los_Angeles',
          }).format(clock)}
        </span>
      </div>
      {watchedStopIds.length > 0 && <div className="watch-board">
        <div className="section-heading"><div><span className="eyebrow">YOUR VIEW</span><h2>Watching stops</h2></div></div>
        {watchedStopIds.map(id => {
          const serving = visibleRoutes.filter(item => item.stops.some(stop => stop.id === id))
          const stop = serving[0]?.stops.find(item => item.id === id)
          return stop ? <button className="watch-row" key={id} onClick={() => selectStop(stop)}>
            <strong>{stop.name}</strong>
            <span>{serving.map(item => {
              const arrival = live.snapshot?.arrivals.filter(value => value.routeId === item.id && value.stopId === id).sort((a, b) => a.estimatedAt - b.estimatedAt)[0]
              const vehicle = arrival ? live.snapshot?.vehicles.find(value => value.id === arrival.vehicleId && value.routeId === item.id) : null
              const label = arrival && vehicle ? formatArrival(arrival.estimatedAt, vehicle.updatedAt, clock.getTime(), vehicle.paceRatio) : 'No live time'
              return <span className="watch-route" key={item.id}><span className="watch-route-letter" style={{ background: item.color, color: routeBadgeInk(item.color) }}>{item.letter}</span>{label}</span>
            })}</span>
          </button> : null
        })}
      </div>}
      <div className="section-heading">
        <div>
          <span className="eyebrow">TODAY</span>
          <h2>
            {service.active.length ? 'Suggested for now' : 'Explore routes'}
          </h2>
        </div>
        <button className="text-button" onClick={() => onAllRoutes()}>
          All routes <ArrowRight size={16} />
        </button>
      </div>
      <div className="quick-routes">
        {(recommended.length ? recommended : routes.slice(0, 2)).map((item) => (
          <button
            data-testid={`route-card-${item.letter.toLowerCase()}-line`}
            key={item.id}
            className={`quick-card ${route?.id === item.id ? 'active' : ''}`}
            onClick={() => selectRoute(item)}
          >
            <span
              className="route-badge"
              style={{ '--route-color': item.color, '--route-ink': routeBadgeInk(item.color) } as React.CSSProperties}
            >
              {item.letter}
            </span>
            <span className="quick-copy">
              <strong>{item.name}</strong>
              <small>{routeDescription(item)}</small>
            </span>
            <ArrowRight size={18} />
          </button>
        ))}
      </div>
      <div className="location-card">
        <div>
          <strong>Your location</strong>
          <span>
            {locationControl.mode === 'tracking'
              ? 'Following your location until you pause or stop'
              : locationControl.mode === 'paused'
                ? 'Paused at your last location'
                : locationControl.mode === 'finding'
                  ? 'Finding a close location, then stopping'
                  : locationControl.mode === 'once'
                    ? 'Last location shown. Tracking is off'
                    : 'Off. Use it to find nearby stops'}
          </span>
        </div>
        <div className="location-options">
          <button
            onClick={locate}
            disabled={locationControl.mode === 'finding'}
          >
            Find once
          </button>
          {locationControl.mode === 'tracking' ? (
            <button onClick={() => void locationControl.pause()}>Pause</button>
          ) : (
            <button onClick={() => void locationControl.start()}>
              {locationControl.mode === 'paused' ? 'Resume' : 'Follow me'}
            </button>
          )}
          {locationControl.mode !== 'off' && (
            <button onClick={() => void locationControl.stop()}>Stop</button>
          )}
        </div>
      </div>
      {route && (
        <div className="selected-detail">
          <div className="section-heading detail-heading">
            <div>
              <span className="eyebrow">SELECTED ROUTE</span>
              <h2>{route.name}</h2>
            </div>
            <span className="route-mini" style={{ background: route.color }} />
          </div>
          <p className="detail-description">{routeDescription(route)}</p>
          <div className={`live-status ${routeFreshness}`} role="status">
            <Radio size={17} />
            <span>
              {live.error
                ? liveAgeSeconds !== null
                  ? `Live updates unavailable · last received ${liveAgeSeconds < 60 ? `${liveAgeSeconds}s` : `${Math.floor(liveAgeSeconds / 60)}m`} ago`
                  : 'Live updates unavailable'
                : routeFreshness === 'fresh'
                  ? 'Vehicle positions are live'
                  : routeFreshness === 'aging'
                    ? 'Vehicle positions may be delayed'
                    : routeFreshness === 'stale'
                      ? 'Vehicle positions are old'
                      : 'No active vehicles reported'}
            </span>
            <button
              aria-label="Refresh live data"
              title="Refresh live data"
              onClick={() => void live.refresh()}
            >
              <RefreshCw
                size={17}
                className={live.refreshing ? 'spinning' : ''}
              />
            </button>
          </div>
          <div className={`rider-share ${riderSignals.sharing ? 'is-sharing' : ''}`}>
            <BusFront size={22} aria-hidden="true" />
            <div>
              <strong>{riderSignals.sharing ? 'Ride sharing is on' : 'On this bus?'}</strong>
              <span>{riderSignals.sharing ? riderSignals.status : 'Send your precise location while ZotStop is open. It is checked, then discarded.'}</span>
            </div>
            <button onClick={riderSignals.sharing ? riderSignals.stop : riderSignals.start}>{riderSignals.sharing ? 'Stop sharing' : 'Share ride'}</button>
          </div>
          {riderSignals.signals.length > 0 && <div className="rider-note" role="status">{riderSignals.signals.length} rider-reported {riderSignals.signals.length === 1 ? 'area' : 'areas'} on this route. Approximate and unverified.</div>}
          <div className="stop-header">
            <strong>Stops on this route</strong>
            <span>{route.stops.length} stops</span>
          </div>
          <div className="stop-list">
            {stops.map((stop, index) => {
              const arrival = live.snapshot?.arrivals
                .filter(
                  (item) =>
                    item.routeId === route.id && item.stopId === stop.id,
                )
                .sort((a, b) => a.estimatedAt - b.estimatedAt)[0]
              const vehicle = arrival
                ? routeVehicles.find((item) => item.id === arrival.vehicleId)
                : null
              const label =
                arrival && vehicle
                  ? formatArrival(
                      arrival.estimatedAt,
                      vehicle.updatedAt,
                      clock.getTime(),
                      vehicle.paceRatio,
                    )
                  : 'No live time'
              return (
                <button
                  key={`${stop.id}-${index}`}
                  className={`stop-row ${selectedStopId === stop.id ? 'selected' : ''}`}
                  onClick={() => selectStop(stop)}
                >
                  <span className="stop-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="stop-name">
                    <strong>{stop.name}</strong>
                    <small>
                      {stop.code ? `Stop ${stop.code}` : 'Campus stop'}
                      {boardingGuide(stop) ? ` · ${boardingGuide(stop)!.side}` : ''}
                      {location && (location.accuracy ?? 0) <= 200
                        ? ` · ${Math.round(distanceMeters(location, stop))} m away`
                        : ''}
                    </small>
                  </span>
                  <span className="stop-eta">{label}</span>
                  <ArrowRight size={15} />
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
