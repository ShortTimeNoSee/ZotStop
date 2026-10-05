import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { fleetName, fuseRideGuidance, reportedBusesNear, rideGuidance, rideLimits, type RideGuidance, type RidePoint, type RideStage, type Route, type Vehicle } from '@zotstop/transit-engine'
import { rideAlertFeedback } from '../nativeFeedback'
import { liveSnapshotIntervalMs, snapshotUrl } from './useLiveTransit'
import { nativeRideRunning, requestRideNotification, showRideNotification, startNativeRide, stopNativeRide, syncNativeRide } from '../nativeRide'
import type { useLocation } from './useLocation'

const rideKey = 'zotstop-active-ride'
const soundKey = 'zotstop-ride-sound'

export type RideChoice = {
  routeId: string
  stopId: string
  mode: 'phone' | 'bus'
  vehicleId: string | null
  fleetName: string | null
}

function storedRide(): RideChoice | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(rideKey) || 'null')
    if (!value || typeof value !== 'object') return null
    const row = value as Partial<RideChoice>
    if (typeof row.routeId !== 'string' || typeof row.stopId !== 'string') return null
    const mode = row.mode === 'bus' ? 'bus' : 'phone'
    const vehicleId = typeof row.vehicleId === 'string' ? row.vehicleId : null
    if (mode === 'bus' && !vehicleId) return null
    return { routeId: row.routeId, stopId: row.stopId, mode, vehicleId, fleetName: typeof row.fleetName === 'string' ? row.fleetName : null }
  } catch {
    return null
  }
}

function audioContext() {
  const Context = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return Context ? new Context() : null
}

export function useActiveRide(routes: Route[], location: ReturnType<typeof useLocation>, vehicles: Vehicle[]) {
  const [target, setTarget] = useState(storedRide)
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem(soundKey) === '1' } catch { return false }
  })
  const [guidance, setGuidance] = useState<RideGuidance | null>(null)
  const [note, setNote] = useState('')
  const [backgroundLimited, setBackgroundLimited] = useState(false)
  const history = useRef<RidePoint[]>([])
  const remembered = useRef<RideStage | null>(null)
  const announced = useRef('')
  const riding = useRef(false)
  const audio = useRef<AudioContext | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const vehiclesRef = useRef(vehicles)
  vehiclesRef.current = vehicles

  const primeAudio = () => {
    if (!audio.current) audio.current = audioContext()
    void audio.current?.resume().catch(() => {})
  }
  const claimScreen = () => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
    void navigator.wakeLock.request('screen').then(sentinel => {
      void wakeLock.current?.release().catch(() => {})
      wakeLock.current = sentinel
    }).catch(() => {})
  }

  useEffect(() => {
    if (!target || !routes.length) return
    const route = routes.find(item => item.id === target.routeId)
    if (!route?.stops.some(stop => stop.id === target.stopId)) {
      sessionStorage.removeItem(rideKey)
      setTarget(null)
    }
  }, [routes, target])

  useEffect(() => {
    const phone = target?.mode === 'phone'
    if (phone && !riding.current) {
      riding.current = true
      location.hold('ride')
    } else if (!phone && riding.current) {
      riding.current = false
      location.release('ride')
    }
  }, [target, location.hold, location.release])

  useEffect(() => () => {
    if (riding.current) location.release('ride')
    void wakeLock.current?.release().catch(() => {})
  }, [location.release])

  const route = routes.find(item => item.id === target?.routeId)
  useEffect(() => {
    if (!target || !route) return
    const tick = () => {
      const hidden = document.visibilityState === 'hidden' || (Capacitor.isNativePlatform() && location.mode === 'paused')
      const destination = route.stops.find(stop => stop.id === target.stopId)
      const label = target.fleetName || 'the bus you selected'
      if (target.mode === 'bus') {
        const bus = vehiclesRef.current.find(item => item.id === target.vehicleId && item.routeId === target.routeId)
        setNote(`Following ${label}, not this phone. A late position can make this alert early or late.`)
        if (!bus) {
          const message = `${label} is no longer reporting.`
          setGuidance({ stage: 'waiting', message, destinationName: destination?.name ?? 'your stop', alongMeters: null, stopsAway: null })
          return
        }
        const next = rideGuidance(route, target.stopId, { lat: bus.lat, lon: bus.lon, accuracy: bus.uncertaintyMeters, at: Date.now(), reportedAt: bus.updatedAt }, history.current, remembered.current, hidden, 'bus')
        history.current = next.history
        remembered.current = next.rememberedStage
        setGuidance(next.guidance)
        return
      }
      const phoneFix = location.position && location.mode === 'tracking' && !hidden
        ? { lat: location.position.lat, lon: location.position.lon, accuracy: location.position.accuracy, at: Date.now() }
        : null
      const selected = target.vehicleId
        ? vehiclesRef.current.find(item => item.id === target.vehicleId && item.routeId === target.routeId)
        : null
      const freshSelected = selected && Date.now() - selected.updatedAt <= 90_000 ? selected : null
      const near = phoneFix ? reportedBusesNear(route, phoneFix, vehiclesRef.current, Date.now()) : []
      const matched = target.vehicleId ? freshSelected : near.length === 1 ? near[0] : null
      if (target.vehicleId && !selected) setNote(`${label} is no longer reporting, so only this phone is used.`)
      else if (target.vehicleId && !freshSelected) setNote(`${label} is not reporting a fresh position, so only this phone is used.`)
      else if (target.vehicleId && freshSelected) setNote(fleetName(freshSelected) ? `Using this phone and bus ${fleetName(freshSelected)}.` : 'Using this phone and the bus you selected.')
      else if (near.length > 1) setNote('More than one reported bus is near this phone, so only the phone is used.')
      else if (near.length === 1) setNote(fleetName(near[0]) ? `Using this phone and bus ${fleetName(near[0])}.` : 'Using this phone and one reported bus.')
      else setNote('Using this phone. No single reported bus is close enough to check.')
      const busFix = matched ? { lat: matched.lat, lon: matched.lon, accuracy: matched.uncertaintyMeters, at: Date.now(), reportedAt: matched.updatedAt } : null
      const next = fuseRideGuidance(route, target.stopId, phoneFix, busFix, history.current, remembered.current, hidden && !phoneFix)
      history.current = next.history
      remembered.current = next.rememberedStage
      setGuidance(next.guidance)
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [target, route, location.position, location.mode])

  useEffect(() => {
    if (!guidance || !target) return
    const urgent = guidance.stage === 'now' || guidance.stage === 'passed'
    const cueable = urgent || guidance.stage === 'soon' || (sound && guidance.stage === 'riding')
    const signature = `${guidance.stage}:${guidance.message}:${sound}`
    if (cueable && announced.current !== signature) {
      announced.current = signature
      if (guidance.stage !== 'riding') rideAlertFeedback(urgent)
      if (sound) {
        primeAudio()
        const context = audio.current
        if (context) {
          const beep = (frequency: number, at: number, duration: number) => {
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            oscillator.frequency.value = frequency
            gain.gain.setValueAtTime(0.0001, at)
            gain.gain.exponentialRampToValueAtTime(0.04, at + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
            oscillator.connect(gain)
            gain.connect(context.destination)
            oscillator.start(at)
            oscillator.stop(at + duration)
          }
          beep(urgent ? 740 : 520, context.currentTime, 0.12)
          if (urgent) beep(988, context.currentTime + 0.16, 0.2)
        }
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(guidance.message)
          utterance.lang = document.documentElement.lang || 'en-US'
          window.speechSynthesis.cancel()
          window.speechSynthesis.speak(utterance)
        }
      }
    }
    const title = `${route?.letter ?? ''} Line to ${guidance.destinationName}`.trim()
    if (guidance.stage === 'soon' || guidance.stage === 'now' || guidance.stage === 'passed') showRideNotification(title, guidance.message)
    void syncNativeRide(title, guidance.message, guidance.stage).catch(() => {})
  }, [guidance, sound, target, route?.letter])

  const start = (choice: RideChoice) => {
    if (choice.mode === 'bus' && !choice.vehicleId) return
    if (target?.routeId === choice.routeId && target.stopId === choice.stopId && target.mode === choice.mode && target.vehicleId === choice.vehicleId) return
    const nextRoute = routes.find(item => item.id === choice.routeId)
    const stop = nextRoute?.stops.find(item => item.id === choice.stopId)
    if (!nextRoute || !stop) return
    history.current = []
    remembered.current = null
    announced.current = ''
    sessionStorage.setItem(rideKey, JSON.stringify(choice))
    setTarget(choice)
    setBackgroundLimited(false)
    primeAudio()
    claimScreen()
    void requestRideNotification()
    const limits = rideLimits(nextRoute)
    void startNativeRide({
      mode: choice.mode,
      fleetName: choice.fleetName,
      letter: nextRoute.letter,
      stopName: stop.name,
      vehicleId: choice.vehicleId,
      routeId: choice.routeId,
      apiUrl: snapshotUrl(),
      pollMs: liveSnapshotIntervalMs,
      loop: limits.loop,
      nowMeters: limits.nowMeters,
      soonMeters: limits.soonMeters,
      destination: { lat: stop.lat, lon: stop.lon },
      shape: nextRoute.shape,
    }).then(result => {
      if (choice.mode === 'phone' && result && result.backgroundLocation === false) setBackgroundLimited(true)
    }).catch(() => {})
  }
  const end = () => {
    history.current = []
    remembered.current = null
    announced.current = ''
    sessionStorage.removeItem(rideKey)
    setTarget(null)
    setGuidance(null)
    setNote('')
    setBackgroundLimited(false)
    window.speechSynthesis?.cancel()
    void wakeLock.current?.release().catch(() => {})
    wakeLock.current = null
    void stopNativeRide().catch(() => {})
  }
  useEffect(() => {
    if (!target) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      claimScreen()
      void nativeRideRunning().then(running => { if (!running) end() }).catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [target])

  const toggleSound = () => {
    setSound(current => {
      const next = !current
      try { localStorage.setItem(soundKey, next ? '1' : '0') } catch { /* preference stays in memory */ }
      if (next) primeAudio()
      else window.speechSynthesis?.cancel()
      return next
    })
  }

  const shownNote = backgroundLimited && target?.mode === 'phone'
    ? `${note} Background location is off, so the notification cannot keep updating after you leave.`
    : note

  return { target, route, guidance, note: shownNote, sound, start, end, toggleSound }
}
