export type Metric =
  | 'route_found_quickly'
  | 'stop_found_quickly'
  | 'map_zoom_used'
export type PrivateMetric = { metric: Metric; value: 0 | 1 }

export function randomizedResponse(
  truth: boolean,
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
): 0 | 1 {
  if (random() < 0.5) return truth ? 1 : 0
  return random() < 0.5 ? 1 : 0
}

export class QuantUx {
  constructor(
    private send: (events: PrivateMetric[]) => Promise<void> = async (
      events,
    ) => {
      await fetch('/api/v1/ux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
        keepalive: false,
      })
    },
  ) {}

  private consent = localStorage.getItem('zotstop-ux-consent') === 'yes'
  private pending: PrivateMetric[] = []
  private timer: number | null = null

  enabled() {
    return this.consent
  }
  setEnabled(enabled: boolean) {
    this.consent = enabled
    localStorage.setItem('zotstop-ux-consent', enabled ? 'yes' : 'no')
    if (!enabled) {
      this.pending = []
      if (this.timer !== null) window.clearTimeout(this.timer)
      this.timer = null
    }
  }
  record(metric: Metric, truth: boolean) {
    if (!this.consent) return
    this.pending.push({ metric, value: randomizedResponse(truth) })
    if (this.timer === null)
      this.timer = window.setTimeout(
        () => void this.flush(),
        10_000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 50_000),
      )
  }
  private async flush() {
    this.timer = null
    const events = this.pending.splice(0, 20)
    if (!events.length || !this.consent) return
    try {
      await this.send(events)
    } catch {}
    if (this.pending.length && this.consent)
      this.timer = window.setTimeout(() => void this.flush(), 30_000)
  }
}

export function estimateRate(positive: number, total: number) {
  if (
    !Number.isInteger(positive) ||
    !Number.isInteger(total) ||
    total <= 0 ||
    positive < 0 ||
    positive > total
  )
    throw new RangeError('Invalid aggregate')
  return Math.max(0, Math.min(1, 2 * (positive / total - 0.25)))
}
