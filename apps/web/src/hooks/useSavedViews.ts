import { useState } from 'react'

export type SavedView = { id: string; name: string; routeIds: string[]; stopIds: string[] }
const storageKey = 'zotstop-saved-views-v1'

function load(): SavedView[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(value) ? value.filter((item): item is SavedView =>
      item && typeof item.id === 'string' && typeof item.name === 'string' &&
      Array.isArray(item.routeIds) && item.routeIds.every((id: unknown) => typeof id === 'string') &&
      Array.isArray(item.stopIds) && item.stopIds.every((id: unknown) => typeof id === 'string')) : []
  } catch {
    return []
  }
}

export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>(load)
  const update = (next: SavedView[]) => {
    setViews(next)
    localStorage.setItem(storageKey, JSON.stringify(next))
  }
  const add = (name: string, routeIds: string[], stopIds: string[]) => {
    const clean = name.trim().slice(0, 40)
    if (!clean || !routeIds.length) return
    update([...views, { id: crypto.randomUUID(), name: clean, routeIds: [...new Set(routeIds)], stopIds: [...new Set(stopIds)] }])
  }
  const rename = (id: string, name: string) => {
    const clean = name.trim().slice(0, 40)
    if (clean) update(views.map(view => view.id === id ? { ...view, name: clean } : view))
  }
  const remove = (id: string) => update(views.filter(view => view.id !== id))
  return { views, add, rename, remove }
}
