import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

const commitPx = 120

function restingMapHeight() {
  return Math.min(440, Math.max(340, window.innerHeight * 0.42))
}

export function useMapStretch(expanded: boolean, expand: () => void, collapse: () => void) {
  const shellRef = useRef<HTMLDivElement>(null)
  const resting = useRef(restingMapHeight())
  const frame = useRef(0)
  const expandRef = useRef(expand)
  const collapseRef = useRef(collapse)
  expandRef.current = expand
  collapseRef.current = collapse

  const paint = (px: number | null) => {
    const shell = shellRef.current
    if (!shell) return
    if (px == null) {
      shell.classList.remove('map-stretching')
      shell.style.removeProperty('--map-stretch')
      return
    }
    shell.classList.add('map-stretching')
    shell.style.setProperty('--map-stretch', `${Math.round(px)}px`)
  }

  const animateTo = (to: number, done: () => void) => {
    const shell = shellRef.current
    const from = shell ? parseFloat(shell.style.getPropertyValue('--map-stretch')) : to
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!Number.isFinite(from) || reduce) {
      paint(to)
      done()
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 180)
      const eased = 1 - (1 - t) ** 3
      paint(from + (to - from) * eased)
      if (t < 1) frame.current = requestAnimationFrame(step)
      else done()
    }
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(step)
  }

  const release = (height: number, fromExpanded: boolean) => {
    if (!fromExpanded && height - resting.current >= commitPx) {
      animateTo(window.innerHeight, () => expandRef.current())
      return
    }
    if (fromExpanded && window.innerHeight - height >= commitPx) {
      animateTo(resting.current, () => {
        paint(null)
        collapseRef.current()
      })
      return
    }
    animateTo(fromExpanded ? window.innerHeight : resting.current, () => paint(null))
  }

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  useEffect(() => {
    if (!expanded) return
    const id = requestAnimationFrame(() => paint(null))
    return () => cancelAnimationFrame(id)
  }, [expanded])

  useEffect(() => {
    const pane = shellRef.current?.querySelector('.content-pane')
    if (!(pane instanceof HTMLElement)) return
    let startX = 0
    let startY = 0
    let origin = 0
    let armed = false
    let tracking = false
    const onStart = (event: TouchEvent) => {
      armed = false
      tracking = false
      if (expanded || event.touches.length !== 1) return
      if (!window.matchMedia('(max-width: 850px)').matches) return
      const list = pane.querySelector('.panel-pages')
      if (window.scrollY > 1 || pane.scrollTop > 1 || (list instanceof HTMLElement && list.scrollTop > 1)) return
      const target = event.target
      if (!(target instanceof Element) || target.closest('button, a, input, textarea, select, [role="button"]')) return
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
      origin = shellRef.current?.querySelector('.map-pane')?.getBoundingClientRect().height ?? restingMapHeight()
      resting.current = origin
      armed = true
    }
    const onMove = (event: TouchEvent) => {
      if (!armed || expanded || event.touches.length !== 1) return
      const dy = event.touches[0].clientY - startY
      const dx = event.touches[0].clientX - startX
      if (!tracking) {
        if (dy < 10 || Math.abs(dy) < Math.abs(dx) || window.scrollY > 1) return
        tracking = true
      }
      if (event.cancelable) event.preventDefault()
      paint(Math.min(window.innerHeight, origin + Math.max(0, dy)))
    }
    const onEnd = () => {
      if (!tracking) {
        armed = false
        return
      }
      const shell = shellRef.current
      const height = shell ? parseFloat(shell.style.getPropertyValue('--map-stretch')) : origin
      tracking = false
      armed = false
      release(Number.isFinite(height) ? height : origin, false)
    }
    pane.addEventListener('touchstart', onStart, { passive: true })
    pane.addEventListener('touchmove', onMove, { passive: false })
    pane.addEventListener('touchend', onEnd)
    pane.addEventListener('touchcancel', onEnd)
    return () => {
      pane.removeEventListener('touchstart', onStart)
      pane.removeEventListener('touchmove', onMove)
      pane.removeEventListener('touchend', onEnd)
      pane.removeEventListener('touchcancel', onEnd)
    }
  }, [expanded])

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !expanded) return
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const origin = window.innerHeight
    resting.current = restingMapHeight()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const move = (ev: PointerEvent) => {
      paint(Math.max(resting.current, Math.min(origin, origin + ev.clientY - startY)))
    }
    const finish = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      release(origin + ev.clientY - startY, true)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }

  return { shellRef, onHandlePointerDown }
}
