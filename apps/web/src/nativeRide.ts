import { Capacitor, registerPlugin } from '@capacitor/core'

type RidePlan = {
  mode: 'phone' | 'bus'
  fleetName: string | null
  letter: string
  stopName: string
  vehicleId: string | null
  routeId: string
  apiUrl: string
  pollMs: number
  loop: boolean
  nowMeters: number
  soonMeters: number
  destination: { lat: number; lon: number }
  shape: [number, number][]
}

type RidePlugin = {
  start: (options: { plan: string }) => Promise<{ backgroundLocation?: boolean }>
  sync: (options: { title: string; body: string; stage: string }) => Promise<void>
  stop: () => Promise<void>
  status: () => Promise<{ running: boolean }>
}

const IosRide = registerPlugin<RidePlugin>('ZotStopNative')
const AndroidRide = registerPlugin<RidePlugin>('RideAlert')

export async function startNativeRide(plan: RidePlan) {
  if (!Capacitor.isNativePlatform()) return { backgroundLocation: true }
  const payload = { plan: JSON.stringify(plan) }
  if (Capacitor.getPlatform() === 'ios') return IosRide.start(payload)
  return AndroidRide.start(payload)
}

export async function syncNativeRide(title: string, body: string, stage: string) {
  if (!Capacitor.isNativePlatform()) return
  const payload = { title, body, stage }
  if (Capacitor.getPlatform() === 'ios') await IosRide.sync(payload)
  else await AndroidRide.sync(payload)
}

export async function stopNativeRide() {
  if (!Capacitor.isNativePlatform()) return
  if (Capacitor.getPlatform() === 'ios') await IosRide.stop()
  else await AndroidRide.stop()
}

export async function nativeRideRunning() {
  if (!Capacitor.isNativePlatform()) return true
  const status = await (Capacitor.getPlatform() === 'ios' ? IosRide.status() : AndroidRide.status()).catch(() => ({ running: true }))
  return status.running
}

export function showRideNotification(title: string, body: string) {
  if (Capacitor.isNativePlatform() || !('Notification' in window) || Notification.permission !== 'granted') return
  try { new Notification(title, { body, tag: 'zotstop-ride' }) } catch { /* the in-app alert remains */ }
}

export async function requestRideNotification() {
  if (Capacitor.isNativePlatform() || !('Notification' in window) || Notification.permission !== 'default') return
  await Notification.requestPermission().catch(() => {})
}
