import { clockSkewToleranceMs } from './limits'

export const clockSkewMessage = "This phone's clock looks wrong. Times follow the operator report."

export function clockOffsetMs(clientNow: number, fetchedAt: number) {
  if (!Number.isFinite(clientNow) || !Number.isFinite(fetchedAt)) return 0
  const offset = clientNow - fetchedAt
  return Math.abs(offset) > clockSkewToleranceMs ? offset : 0
}
