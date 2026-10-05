import { expect, test } from 'vitest'
import { estimateRate, randomizedResponse } from '@zotstop/telemetry-client'

test('randomized response and aggregate correction', () => {
  expect(randomizedResponse(true, () => 0)).toBe(1)
  expect(randomizedResponse(false, () => 0)).toBe(0)
  const values = [0.8, 0.2]
  expect(randomizedResponse(false, () => values.shift()!)).toBe(1)
  expect(estimateRate(75, 100)).toBe(1)
  expect(estimateRate(25, 100)).toBe(0)
})
