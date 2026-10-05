import { useCallback, useMemo, useState } from 'react'
import type { Route } from '@zotstop/transit-engine'

const storageKey = 'zotstop-visible-routes-v1'

function storedRoutes(): string[] | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || 'null')
    return Array.isArray(value) && value.length && value.every(id => typeof id === 'string') ? value : null
  } catch {
    return null
  }
}

export function useVisibleRoutes(routes: Route[], fallback: Route | undefined) {
  const [selection, setSelection] = useState<string[] | null>(storedRoutes)
  const validIds = useMemo(() => new Set(routes.map(route => route.id)), [routes])
  const ids = useMemo(() => {
    const savedIds = selection?.filter(id => validIds.has(id)) ?? []
    return savedIds.length ? savedIds : fallback ? [fallback.id] : []
  }, [selection, validIds, fallback])
  const visible = useMemo(() => routes.filter(route => ids.includes(route.id)), [routes, ids])

  const set = useCallback((next: string[]) => {
    const distinct = [...new Set(next.filter(id => validIds.has(id)))]
    if (!distinct.length) return
    setSelection(distinct)
    localStorage.setItem(storageKey, JSON.stringify(distinct))
  }, [validIds])
  const toggle = useCallback((id: string) => {
    if (!validIds.has(id)) return
    set(ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id])
  }, [validIds, ids, set])
  const include = useCallback((id: string) => {
    if (!ids.includes(id)) set([...ids, id])
  }, [ids, set])

  return { ids, visible, set, toggle, include }
}
