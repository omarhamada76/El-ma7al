/**
 * Scan feedback: short beep via Web Audio API + mobile vibration.
 * No external audio files needed.
 */

let audioCtx: AudioContext | null = null

/** Play a short beep and vibrate on success. Quieter double-buzz on error. */
export function playScanFeedback(success: boolean = true) {
  try {
    // Vibrate on mobile (ignored on desktop)
    if (navigator.vibrate) {
      navigator.vibrate(success ? 80 : [40, 25, 40])
    }

    // Short sine-wave beep via Web Audio API
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    }
    const ctx = audioCtx
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.type = 'sine'
    osc.frequency.value = success ? 1200 : 400 // high ping for success, low buzz for error
    gain.gain.value = 0.12

    const now = ctx.currentTime
    osc.start(now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + (success ? 0.12 : 0.2))
    osc.stop(now + (success ? 0.12 : 0.2))
  } catch {
    // Silently ignore — audio is optional
  }
}
