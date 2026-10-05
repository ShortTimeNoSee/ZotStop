import { useEffect, useState } from 'react'
import type { Feed } from '@zotstop/transit-engine'

const CACHE_KEY = 'zotstop-route-feed-v1'

function validFeed(value: unknown): value is Feed {
  if (!value || typeof value !== 'object') return false
  const feed = value as Feed
  return (
    typeof feed.generatedAt === 'string' &&
    Array.isArray(feed.routes) &&
    feed.routes.length > 0 &&
    feed.routes.every(
      (route) =>
        typeof route.id === 'string' &&
        Array.isArray(route.shape) &&
        route.shape.length > 1 &&
        Array.isArray(route.stops),
    )
  )
}

function cachedFeed(): Feed | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(CACHE_KEY) || 'null',
    ) as unknown
    return validFeed(value) ? value : null
  } catch {
    return null
  }
}

export function useTransitFeed() {
  const [feed, setFeed] = useState<Feed | null>(cachedFeed)
  const [error, setError] = useState(false)
  useEffect(() => {
    fetch('/data/routes.min.json', { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Route data unavailable')
        const value = (await response.json()) as unknown
        if (!validFeed(value)) throw new Error('Invalid route data')
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)) } catch {}
        setFeed(value)
        setError(false)
      })
      .catch(() => setError(true))
  }, [])
  return { feed, error }
}
