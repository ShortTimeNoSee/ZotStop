import { Capacitor, registerPlugin } from '@capacitor/core'

const NativeFeedback = registerPlugin<{ feedback: (options?: { intensity?: number; pulses?: number }) => Promise<void> }>('ZotStopNative')

export function touchFeedback() {
  if (Capacitor.getPlatform() === 'ios') void NativeFeedback.feedback().catch(() => {})
}

export function rideAlertFeedback(urgent: boolean) {
  if (Capacitor.getPlatform() === 'ios') {
    void NativeFeedback.feedback(urgent ? { intensity: 0.9, pulses: 3 } : { intensity: 0.55, pulses: 1 }).catch(() => {})
    return
  }
  if (typeof navigator.vibrate === 'function') navigator.vibrate(urgent ? [70, 40, 70, 40, 140] : [35])
}
