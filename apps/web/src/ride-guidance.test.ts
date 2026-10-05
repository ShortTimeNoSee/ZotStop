import { describe, expect, it } from 'vitest'
import { fuseRideGuidance, reportedBusesNear, rideGuidance, type RidePoint, type Route } from '@zotstop/transit-engine'

const line: Route = {
  id: 'r', letter: 'T', name: 'Test', color: '#000',
  shape: [[-117.84, 33.64], [-117.83, 33.64]],
  stops: [
    { id: 'a', code: '1', name: 'Start', lon: -117.84, lat: 33.64 },
    { id: 'b', code: '2', name: 'Middle', lon: -117.835, lat: 33.64 },
    { id: 'c', code: '3', name: 'End', lon: -117.83, lat: 33.64 },
  ],
}

const loop: Route = {
  ...line,
  letter: 'L',
  shape: [[-117.84, 33.64], [-117.83, 33.64], [-117.83, 33.65], [-117.84, 33.65], [-117.84, 33.64]],
  stops: [
    { id: 'a', code: '1', name: 'Gate', lon: -117.84, lat: 33.64 },
    { id: 'b', code: '2', name: 'Far corner', lon: -117.83, lat: 33.65 },
  ],
}

function guide(route: Route, stopId: string, lon: number, lat: number, history: RidePoint[] = [], previous: Parameters<typeof rideGuidance>[4] = null, accuracy = 8, at = 10_000) {
  return rideGuidance(route, stopId, { lon, lat, accuracy, at }, history, previous, false)
}

describe('active ride guidance', () => {
  it('waits for a direction before counting stops', () => {
    const first = guide(line, 'c', -117.8397, 33.64)
    expect(first.guidance.stage).toBe('waiting')
    expect(first.guidance.message).toBe('Finding your direction on the T Line.')
    const moving = guide(line, 'c', -117.838, 33.64, first.history, first.rememberedStage, 8, 14_000)
    expect(moving.guidance.stage).toBe('riding')
    expect(moving.guidance.message).toBe('2 stops to End.')
    expect(moving.guidance.stopsAway).toBe(2)
  })

  it('says get off when the destination is within the approach window', () => {
    const moving = guide(line, 'c', -117.838, 33.64, [{ progress: 20, at: 10_000 }], 'riding', 8, 14_000)
    const arrived = guide(line, 'c', -117.8302, 33.64, moving.history, moving.rememberedStage, 8, 20_000)
    expect(arrived.guidance.stage).toBe('now')
    expect(arrived.guidance.message).toBe('Get off at End.')
  })

  it('refuses a get-off alert when the fix is too coarse', () => {
    const arrived = guide(line, 'c', -117.8302, 33.64, [{ progress: 20, at: 10_000 }], 'riding', 120, 14_000)
    expect(arrived.guidance.stage).not.toBe('now')
    expect(arrived.guidance.message).toMatch(/too approximate/)
  })

  it('stays off the route until the fix is near the line', () => {
    const away = guide(line, 'c', -117.835, 33.65)
    expect(away.guidance.stage).toBe('off-route')
    expect(away.guidance.message).toBe('You are not on the T Line yet.')
  })

  it('marks the stop as passed after the rider moves beyond it', () => {
    const approaching = guide(line, 'b', -117.8354, 33.64, [{ progress: 200, at: 10_000 }], 'soon', 8, 14_000)
    expect(approaching.guidance.stage).toBe('now')
    const passed = guide(line, 'b', -117.833, 33.64, approaching.history, approaching.rememberedStage, 8, 18_000)
    expect(passed.guidance.stage).toBe('passed')
    expect(passed.guidance.message).toBe('You may have passed Middle.')
    const stillPast = guide(line, 'b', -117.832, 33.64, passed.history, passed.rememberedStage, 8, 22_000)
    expect(stillPast.guidance.stage).toBe('passed')
  })

  it('counts around a loop to a stop behind the current progress', () => {
    const earlier = guide(loop, 'a', -117.84, 33.643, [], null, 8, 10_000)
    const nearGate = guide(loop, 'a', -117.84, 33.641, earlier.history, earlier.rememberedStage, 8, 16_000)
    expect(nearGate.guidance.stage).toBe('now')
    expect(nearGate.guidance.message).toBe('Get off at Gate.')
  })

  it('does not treat backward motion as progress toward the stop', () => {
    const forward = guide(line, 'c', -117.837, 33.64, [{ progress: 40, at: 10_000 }], 'riding', 8, 14_000)
    const backward = guide(line, 'c', -117.8395, 33.64, forward.history.slice(-1), forward.rememberedStage, 8, 18_000)
    expect(backward.guidance.stage).toBe('waiting')
    expect(backward.guidance.message).toBe('The T Line runs the other way.')
  })

  it('keeps the last stage while the alert continues in the notification', () => {
    const paused = rideGuidance(line, 'c', null, [{ progress: 40, at: 10_000 }], 'now', true)
    expect(paused.guidance.message).toBe('The ride alert continues in the notification.')
    expect(paused.rememberedStage).toBe('now')
  })

  it('counts stops from the selected bus without waiting for a phone direction', () => {
    const result = rideGuidance(line, 'c', { lon: -117.8397, lat: 33.64, at: 10_000, reportedAt: 9_000 }, [], null, false, 'bus')
    expect(result.guidance.stage).toBe('riding')
    expect(result.guidance.message).toBe('2 stops to End.')
  })

  it('does not give a get-off from a bus report that is too old', () => {
    const result = rideGuidance(line, 'c', { lon: -117.8302, lat: 33.64, at: 200_000, reportedAt: 10_000 }, [], null, false, 'bus')
    expect(result.guidance.stage).toBe('soon')
    expect(result.guidance.message).toContain('too old')
  })

  it('returns every fresh bus near the phone and leaves the choice to the caller', () => {
    const phone = { lon: -117.835, lat: 33.64, accuracy: 8 }
    const buses = [
      { id: '1', name: 'AE-09', routeId: 'r', lon: -117.8352, lat: 33.64, updatedAt: 10_000 },
      { id: '2', name: 'AE-14', routeId: 'r', lon: -117.8348, lat: 33.64, updatedAt: 10_000 },
      { id: '3', name: 'AE-20', routeId: 'r', lon: -117.84, lat: 33.64, updatedAt: 10_000 },
      { id: '4', name: 'AE-01', routeId: 'r', lon: -117.835, lat: 33.64, updatedAt: 10_000 - 120_000 },
    ]
    expect(reportedBusesNear(line, phone, buses, 10_000).map(bus => bus.name)).toEqual(['AE-09', 'AE-14'])
  })

  it('uses the more urgent stage when the phone and the bus agree they are close', () => {
    const fused = fuseRideGuidance(
      line,
      'c',
      { lon: -117.831, lat: 33.64, accuracy: 8, at: 20_000 },
      { lon: -117.8302, lat: 33.64, accuracy: 8, at: 20_000, reportedAt: 19_000 },
      [{ progress: 400, at: 10_000 }],
      'riding',
      false,
    )
    expect(fused.used).toBe('both')
    expect(fused.guidance.stage).toBe('now')
    expect(fused.guidance.message).toBe('Get off at End.')
  })

  it('treats a bus just past the stop on a loop as passed, not a full lap away', () => {
    const result = rideGuidance(loop, 'a', { lon: -117.8398, lat: 33.64, at: 20_000, reportedAt: 19_000 }, [], null, false, 'bus')
    expect(result.guidance.stage).toBe('passed')
  })

  it('does not say get off when the phone and the bus disagree', () => {
    const fused = fuseRideGuidance(
      line,
      'c',
      { lon: -117.8302, lat: 33.64, accuracy: 8, at: 20_000 },
      { lon: -117.839, lat: 33.64, accuracy: 8, at: 20_000, reportedAt: 19_000 },
      [{ progress: 700, at: 10_000 }],
      'riding',
      false,
    )
    expect(fused.guidance.stage).toBe('soon')
    expect(fused.guidance.message).toBe('Your phone and the reported bus do not agree. Check End before you get off.')
  })
})
