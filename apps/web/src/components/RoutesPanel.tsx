import { useState } from 'react'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { routeBadgeInk, routeDescription, type Route, type Stop } from '@zotstop/transit-engine'
import { searchTransit } from '../search'
import { TransitSearch } from './TransitSearch'

type Props = {
  routes: Route[]
  visibleIds: string[]
  recentStopIds: string[]
  onToggleVisible: (id: string) => void
  back: () => void
  selectRoute: (route: Route) => void
  selectStop: (stop: Stop) => void
}

export function RoutesPanel({ routes, visibleIds, recentStopIds, onToggleVisible, back: _back, selectRoute, selectStop }: Props) {
  const [search, setSearch] = useState('')
  const filtered = search.trim() ? searchTransit(routes, search).routes : routes
  return (
    <>
      <div className="page-head">
        <h2>All routes</h2>
        <p>Show routes on the map or open one to see its stops.</p>
      </div>
      <TransitSearch
        routes={routes}
        query={search}
        onQuery={setSearch}
        recentIds={recentStopIds}
        onSelectStop={selectStop}
        onSelectRoute={selectRoute}
        showRouteResults={false}
      />
      {search.trim() && filtered.length === 0 && <p className="departure-empty">No lines match. Matching stops are listed above.</p>}
      <div className="all-routes">
        {filtered.map(item => (
          <div className="route-pick-row" key={item.id}>
            <button
              className="route-visibility"
              onClick={() => onToggleVisible(item.id)}
              aria-label={`${visibleIds.includes(item.id) ? 'Hide' : 'Show'} ${item.name} on map`}
              aria-pressed={visibleIds.includes(item.id)}
              disabled={visibleIds.length === 1 && visibleIds.includes(item.id)}
            >
              {visibleIds.includes(item.id) ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
            <button className="all-route-row" onClick={() => selectRoute(item)}>
              <span className="route-badge" style={{ '--route-color': item.color, '--route-ink': routeBadgeInk(item.color) } as React.CSSProperties}>{item.letter}</span>
              <span>
                <strong>{item.name}</strong>
                <small>{routeDescription(item)}</small>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
