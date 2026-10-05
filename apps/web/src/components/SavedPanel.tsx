import { useState } from 'react'
import { ArrowRight, Bookmark, Pencil, Trash2 } from 'lucide-react'
import { routeBadgeInk, type Route } from '@zotstop/transit-engine'
import type { SavedView } from '../hooks/useSavedViews'

type Props = {
  saved: string[]
  routes: Route[]
  views: SavedView[]
  onOpenView: (view: SavedView) => void
  onRenameView: (id: string, name: string) => void
  onRemoveView: (id: string) => void
  onSelect: (stopId: string) => void
  onBrowse: () => void
}

export function SavedPanel({ saved, routes, views, onOpenView, onRenameView, onRemoveView, onSelect, onBrowse }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')

  if (!saved.length && !views.length) return (
    <div className="empty-state">
      <Bookmark size={28} aria-hidden="true" />
      <h2>Nothing saved yet</h2>
      <p>Save a route view from the map, or open a stop and save it here.</p>
      <button onClick={onBrowse}>Browse routes <ArrowRight size={15} /></button>
    </div>
  )

  return (
    <>
      {views.length > 0 && (
        <div className="saved-views">
          <h2>Route views</h2>
          {views.map(view => (
            <div className="saved-view-row" key={view.id}>
              {editing === view.id
                ? <form onSubmit={event => { event.preventDefault(); onRenameView(view.id, name); setEditing(null) }}>
                    <input value={name} onChange={event => setName(event.target.value)} maxLength={40} aria-label={`Name for ${view.name}`} autoFocus />
                    <button type="submit">Save</button>
                    <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                  </form>
                : <>
                    <button className="saved-view-open" onClick={() => onOpenView(view)}>
                      <div className="saved-view-content">
                        <strong>{view.name}</strong>
                        <small>
                          {view.routeIds.map(id => routes.find(r => r.id === id)?.letter).filter(Boolean).join(' · ')}
                          {view.stopIds.length ? ` · ${view.stopIds.length} stop${view.stopIds.length !== 1 ? 's' : ''} watched` : ''}
                        </small>
                      </div>
                      <span className="saved-route-badges">
                        {view.routeIds.slice(0, 4).map(id => {
                          const r = routes.find(route => route.id === id)
                          return r ? <span key={id} className="route-badge" style={{ '--route-color': r.color, '--route-ink': routeBadgeInk(r.color) } as React.CSSProperties}>{r.letter}</span> : null
                        })}
                      </span>
                    </button>
                    <button className="saved-view-action" onClick={() => { setEditing(view.id); setName(view.name) }} aria-label={`Rename ${view.name}`}><Pencil size={16} /></button>
                    <button className="saved-view-action" onClick={() => onRemoveView(view.id)} aria-label={`Remove ${view.name}`}><Trash2 size={16} /></button>
                  </>}
            </div>
          ))}
        </div>
      )}

      {saved.length > 0 && (
        <div className="saved-stops">
          <h2>Saved stops</h2>
          {saved.map(stopId => {
            const serving = routes.filter(item => item.stops.some(stop => stop.id === stopId))
            const stop = serving[0]?.stops.find(item => item.id === stopId)
            return stop ? (
              <button className="all-route-row" key={stopId} onClick={() => onSelect(stopId)}>
                <span className="saved-route-badges">
                  {serving.map(item => <span key={item.id} className="route-badge" style={{ '--route-color': item.color, '--route-ink': routeBadgeInk(item.color) } as React.CSSProperties}>{item.letter}</span>)}
                </span>
                <span>
                  <strong>{stop.name}</strong>
                  <small>{serving.map(item => item.name).join(' · ')}</small>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : null
          })}
        </div>
      )}
    </>
  )
}
