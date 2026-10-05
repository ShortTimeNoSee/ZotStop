import { useRef } from 'react'
import type { TouchEvent } from 'react'
import type { Screen } from './useNavigation'

const screens: Screen[] = ['nearby', 'routes', 'saved']

export function useSwipeTabs(screen: Screen, select: (screen: Screen) => void) {
  const start = useRef<{ x: number; y: number; at: number; scrollY: number; vertical: boolean } | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const reset = () => {
    start.current = null
    if (content.current) {
      content.current.style.transition = ''
      content.current.style.transform = ''
      content.current.style.opacity = ''
    }
  }
  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) return
    if ((event.target as Element).closest('button, a, input, textarea, select, [role="button"]')) return
    const touch = event.touches[0]
    const width = window.innerWidth
    if (touch.clientX < 28 || touch.clientX > width - 28) return
    if (content.current) content.current.style.transition = 'none'
    start.current = { x: touch.clientX, y: touch.clientY, at: performance.now(), scrollY: window.scrollY, vertical: false }
  }
  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const origin = start.current
    if (!origin || event.touches.length !== 1) return
    const touch = event.touches[0]
    const dx = touch.clientX - origin.x
    const dy = touch.clientY - origin.y
    if (Math.abs(dy) > 32 || Math.abs(window.scrollY - origin.scrollY) > 4) origin.vertical = true
    if (origin.vertical || Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return
    const index = screens.indexOf(screen)
    if ((dx > 0 && index === 0) || (dx < 0 && index === screens.length - 1)) return
    const shift = Math.sign(dx) * Math.min(58, Math.abs(dx) * 0.25)
    if (content.current) {
      content.current.style.transform = `translate3d(${shift}px, 0, 0)`
      content.current.style.opacity = String(1 - Math.min(0.12, Math.abs(dx) / 1200))
    }
  }
  const onTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const origin = start.current
    const touch = event.changedTouches[0]
    reset()
    if (!origin || !touch || origin.vertical || Math.abs(window.scrollY - origin.scrollY) > 4) return
    const dx = touch.clientX - origin.x
    const dy = touch.clientY - origin.y
    const elapsed = performance.now() - origin.at
    if (Math.abs(dx) < 96 || Math.abs(dy) > 32 || elapsed > 700) return
    const next = screens[screens.indexOf(screen) + (dx < 0 ? 1 : -1)]
    if (next) select(next)
  }
  return { content, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset }
}
