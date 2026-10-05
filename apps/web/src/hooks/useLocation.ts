import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'

type Location = { lat: number; lon: number; accuracy?: number }
type LocationEvent = Location | { error: string }
type Mode = 'off' | 'finding' | 'once' | 'tracking' | 'paused'
type State = { position: Location | null; mode: Mode; error: string }
type Action =
  | { type: 'mode'; mode: Mode }
  | { type: 'position'; position: Location }
  | { type: 'error'; message: string }
  | { type: 'stop' }

const AospLocation = registerPlugin<{
  locate: () => Promise<Location>
  startTracking: () => Promise<void>
  stopTracking: () => Promise<void>
  addListener: (event: 'location', callback: (position: LocationEvent) => void) => Promise<PluginListenerHandle>
}>('AospLocation')
const IosLocation = registerPlugin<{
  locate: () => Promise<Location>
  startTracking: () => Promise<void>
  stopTracking: () => Promise<void>
  addListener: (event: 'location', callback: (position: LocationEvent) => void) => Promise<PluginListenerHandle>
}>('ZotStopNative')

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'mode': return { ...state, mode: action.mode, error: '' }
    case 'position': return {
      ...state,
      position: action.position,
      error: action.position.accuracy && action.position.accuracy > 200
        ? 'Your location is approximate. Precise location will show closer stops.'
        : '',
    }
    case 'error': return { ...state, error: action.message }
    case 'stop': return { position: null, mode: 'off', error: '' }
  }
}

const nativeLocation = () => Capacitor.getPlatform() === 'android'
  ? AospLocation
  : Capacitor.getPlatform() === 'ios'
    ? IosLocation
    : null

export function useLocation() {
  const [state, dispatch] = useReducer(reducer, { position: null, mode: 'off', error: '' })
  const [held, setHeld] = useState(false)
  const [following, setFollowing] = useState(false)
  const generation = useRef(0)
  const cleanupQueue = useRef(Promise.resolve())
  const watch = useRef<number | null>(null)
  const listener = useRef<PluginListenerHandle | null>(null)
  const holds = useRef(new Set<string>())
  const follow = useRef(false)
  const starting = useRef(false)
  const modeRef = useRef(state.mode)
  modeRef.current = state.mode

  const clearWatch = () => {
    cleanupQueue.current = cleanupQueue.current.catch(() => {}).then(async () => {
      if (watch.current !== null) navigator.geolocation.clearWatch(watch.current)
      watch.current = null
      const oldListener = listener.current
      listener.current = null
      await nativeLocation()?.stopTracking().catch(() => {})
      await oldListener?.remove().catch(() => {})
    })
    return cleanupQueue.current
  }
  useEffect(() => () => {
    generation.current += 1
    void clearWatch()
  }, [])

  const receive = (value: Location, token: number) => {
    if (generation.current === token) dispatch({ type: 'position', position: value })
  }
  const locate = async () => {
    if (follow.current || holds.current.size > 0 || modeRef.current === 'tracking') return state.position ?? undefined
    const token = ++generation.current
    dispatch({ type: 'mode', mode: 'finding' })
    await clearWatch()
    if (generation.current !== token) return
    let position: Location | undefined
    try {
      const native = nativeLocation()
      if (native) { position = await native.locate(); receive(position, token) }
      else {
        if (!navigator.geolocation) throw new Error('Location is unavailable on this device')
        const value = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, timeout: 12000, maximumAge: 0,
          }),
        )
        position = { lat: value.coords.latitude, lon: value.coords.longitude, accuracy: value.coords.accuracy }
        receive(position, token)
      }
      if (generation.current === token) {
        dispatch({ type: 'mode', mode: 'once' })
        return position
      }
    } catch (cause) {
      if (generation.current !== token) return
      dispatch({ type: 'mode', mode: 'off' })
      dispatch({ type: 'error', message: cause instanceof Error ? cause.message : 'Location could not be found' })
    }
  }
  const begin = async () => {
    if (starting.current) return
    if (modeRef.current === 'tracking' && (watch.current !== null || listener.current)) return
    starting.current = true
    try {
    const token = ++generation.current
    dispatch({ type: 'mode', mode: 'tracking' })
    await clearWatch()
    if (generation.current !== token) return
    try {
      const native = nativeLocation()
      if (native) {
        const handle = await native.addListener('location', value => {
          if (generation.current !== token) return
          if ('error' in value) {
            generation.current += 1
            dispatch({ type: 'mode', mode: 'paused' })
            dispatch({ type: 'error', message: value.error })
            void clearWatch()
          } else receive(value, token)
        })
        if (generation.current !== token) { await handle.remove(); return }
        listener.current = handle
        await native.startTracking()
      } else {
        if (!navigator.geolocation) throw new Error('Location is unavailable on this device')
        watch.current = navigator.geolocation.watchPosition(
          value => receive({ lat: value.coords.latitude, lon: value.coords.longitude, accuracy: value.coords.accuracy }, token),
          cause => { if (generation.current === token) dispatch({ type: 'error', message: cause.message }) },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
        )
      }
    } catch (cause) {
      if (generation.current !== token) return
      generation.current += 1
      await clearWatch()
      dispatch({ type: 'mode', mode: 'off' })
      dispatch({ type: 'error', message: cause instanceof Error ? cause.message : 'Tracking could not start' })
    } finally {
      starting.current = false
    }
    } finally {
      starting.current = false
    }
  }
  const actions = useRef({ begin, clear: clearWatch })
  actions.current = { begin, clear: clearWatch }
  const suspend = useCallback(async () => {
    if (modeRef.current !== 'tracking') return
    generation.current += 1
    dispatch({ type: 'mode', mode: 'paused' })
    await actions.current.clear()
  }, [])
  const clearTracking = useCallback(async () => {
    follow.current = false
    setFollowing(false)
    generation.current += 1
    dispatch({ type: 'stop' })
    await actions.current.clear()
  }, [])
  const start = useCallback(async () => {
    follow.current = true
    setFollowing(true)
    await actions.current.begin()
  }, [])
  const pause = useCallback(async () => {
    follow.current = false
    setFollowing(false)
    if (holds.current.size > 0) return
    await suspend()
  }, [suspend])
  const stop = useCallback(async () => {
    follow.current = false
    setFollowing(false)
    if (holds.current.size > 0) return
    await clearTracking()
  }, [clearTracking])
  const hold = useCallback((id: string) => {
    holds.current.add(id)
    setHeld(true)
    void actions.current.begin()
  }, [])
  const release = useCallback((id: string) => {
    holds.current.delete(id)
    const remaining = holds.current.size > 0
    setHeld(remaining)
    if (!remaining && !follow.current) void clearTracking()
  }, [clearTracking])
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (Capacitor.isNativePlatform() || !holds.current.has('ride')) void suspend()
      } else if (holds.current.size > 0 || follow.current) void actions.current.begin()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const nativeListener = Capacitor.isNativePlatform()
      ? NativeApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) void suspend()
        else if (holds.current.size > 0 || follow.current) void actions.current.begin()
      })
      : null
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void nativeListener?.then(handle => handle.remove())
    }
  }, [suspend])
  return {
    ...state,
    held,
    following,
    setError: (message: string) => dispatch({ type: 'error', message }),
    locate, start, pause, stop, hold, release,
  }
}
