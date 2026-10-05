import { expect, it, vi } from 'vitest'
import { purgeUsageCounts } from '../../../workers/edge-proxy/src/retention'

it.each([
  ['2026-09-26T00:00:00Z', '2026-08-28'],
  ['2026-09-26T23:59:59Z', '2026-08-28'],
  ['2024-03-01T06:00:00Z', '2024-02-01'],
])('keeps the latest 30 UTC days at %s', async (now, cutoff) => {
  const run = vi.fn().mockResolvedValue(undefined)
  const bind = vi.fn().mockReturnValue({ run })
  const prepare = vi.fn().mockReturnValue({ bind })
  await purgeUsageCounts({ prepare }, Date.parse(now))
  expect(prepare).toHaveBeenCalledWith('DELETE FROM ux_aggregate WHERE day < ?')
  expect(bind).toHaveBeenCalledWith(cutoff)
  expect(run).toHaveBeenCalledOnce()
})

it('propagates a cleanup failure to the scheduler', async () => {
  const database = { prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error('Database unavailable')) }) }) }
  await expect(purgeUsageCounts(database, Date.now())).rejects.toThrow('Database unavailable')
})
