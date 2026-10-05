import { describe, expect, it } from 'vitest'
import { pointAtProgress, routeProgress, type Route } from '@zotstop/transit-engine'

const route: Route = {
  id: 'test', name: 'Test', letter: 'T', color: '#000', stops: [],
  shape: [[-117.84, 33.645556], [-117.839, 33.645556], [-117.839, 33.646], [-117.84, 33.645556]],
}

describe('rider route matching', () => {
  it('uses local earth scale and rejects distant reports', () => {
    const onRoute = routeProgress(route, { lon: -117.8395, lat: 33.645556 })
    const away = routeProgress(route, { lon: -117.8395, lat: 33.647 })
    expect(onRoute?.distance).toBeLessThan(1)
    expect(away?.distance).toBeGreaterThan(40)
    expect(onRoute?.loop).toBe(true)
  })

  it('returns a valid coarse point along the route', () => {
    const matched = routeProgress(route, { lon: -117.8395, lat: 33.645556 })!
    const point = pointAtProgress(route, Math.round(matched.progress / 200) * 200)
    expect(routeProgress(route, point)?.distance).toBeLessThan(1)
  })
})
