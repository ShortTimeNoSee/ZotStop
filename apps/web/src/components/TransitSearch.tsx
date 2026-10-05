import { useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { routeBadgeInk, type Route, type Stop } from '@zotstop/transit-engine'
import { searchTransit, stopsForIds } from '../search'

type Props = {
  routes: Route[]
  query: string
  onQuery: (query: string) => void
  recentIds: string[]
  onSelectStop: (stop: Stop) => void
  onSelectRoute: (route: Route) => void
  showRouteResults?: boolean
}

export function TransitSearch({ routes, query, onQuery, recentIds, onSelectStop, onSelectRoute, showRouteResults = true }: Props) {
  const [focused, setFocused] = useState(false)
  const blurTimer = useRef(0)
  const needle = query.trim()
  const results = needle ? searchTransit(routes, needle) : { routes: [], stops: [] }
  const recent = needle ? [] : stopsForIds(routes, recentIds)
  const routeResults = showRouteResults ? results.routes : []
  const open = focused && (recent.length > 0 || results.stops.length > 0 || routeResults.length > 0)

  return (
    <div className="transit-search">
      <div className="search-field">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={event => onQuery(event.target.value)}
          onFocus={() => {
            window.clearTimeout(blurTimer.current)
            setFocused(true)
          }}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setFocused(false), 150)
          }}
          placeholder="Search stops, codes, or lines"
          role="combobox"
          aria-label="Search stops and lines"
          aria-expanded={open}
          aria-controls={open ? 'transit-search-results' : undefined}
          aria-autocomplete="list"
        />
      </div>
      {open && (
        <div id="transit-search-results" className="search-results" role="listbox" aria-label={needle ? 'Matching stops and lines' : 'Recent stops'}>
          {!needle && <div className="section-label">Recent stops</div>}
          {recent.map(stop => (
            <button key={stop.id} type="button" className="search-result" role="option" onMouseDown={event => event.preventDefault()} onClick={() => { onSelectStop(stop); onQuery('') }}>
              <span>{stop.name}</span>
              {stop.code && <small>Stop {stop.code}</small>}
            </button>
          ))}
          {results.stops.map(({ stop, routes: serving }) => (
            <button key={stop.id} type="button" className="search-result" role="option" onMouseDown={event => event.preventDefault()} onClick={() => { onSelectStop(stop); onQuery('') }}>
              <span>{stop.name}</span>
              <small>{[stop.code ? `Stop ${stop.code}` : '', serving.map(route => route.letter).join(' ')].filter(Boolean).join(' · ')}</small>
            </button>
          ))}
          {routeResults.map(route => (
            <button key={route.id} type="button" className="search-result" role="option" onMouseDown={event => event.preventDefault()} onClick={() => { onSelectRoute(route); onQuery('') }}>
              <span className="route-badge" style={{ '--route-color': route.color, '--route-ink': routeBadgeInk(route.color) } as React.CSSProperties}>{route.letter}</span>
              <span>{route.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
