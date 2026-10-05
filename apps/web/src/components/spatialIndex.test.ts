import { describe, expect, it } from 'vitest'
import { spatialIndex, type Bounds } from './spatialIndex'

describe('map spatial index', () => {
  it('matches exhaustive culling and preserves drawing order across viewport sizes', () => {
    const shapes = Array.from({ length: 200 }, (_, id) => ({ id, bounds: [id * 7 % 113 - 50, id * 13 % 127 - 60, id * 7 % 113 - 35, id * 13 % 127 - 40] as Bounds }))
    shapes.push({ id: 200, bounds: [-1000, -1000, 1000, 1000] })
    const query = spatialIndex(shapes)
    for (let x = -150; x < 150; x += 17) for (const width of [0, 10, 50, 400]) {
      const bounds: Bounds = [x, -30, x + width, 40]
      const expected = shapes.filter(({ bounds: b }) => b[0] <= bounds[2] && b[2] >= bounds[0] && b[1] <= bounds[3] && b[3] >= bounds[1])
      expect(query(bounds)).toEqual(expected)
    }
    expect(shapes.map(shape => shape.id)).toEqual(Array.from({ length: 201 }, (_, id) => id))
  })
  it('handles empty data and boundary intersections', () => {
    expect(spatialIndex([])([0, 0, 1, 1])).toEqual([])
    const shape = { bounds: [1, 1, 2, 2] as Bounds }
    expect(spatialIndex([shape])([0, 0, 1, 1])).toEqual([shape])
    expect(spatialIndex([shape])([3, 3, 4, 4])).toEqual([])
  })
})
