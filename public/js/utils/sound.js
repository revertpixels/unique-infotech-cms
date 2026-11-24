// sound.js — Audio cue utilities for user interactions
let cachedAudio = null;

/**
 * Plays the payment confirmation audio cue.
 * Non-blocking and catches all browser autoplay or path errors silently.
 */
export function playPaymentSuccessSound() {
  try {
    if (!cachedAudio) {
      cachedAudio = new Audio('assets/sounds/payment_confirmation.mp3');
      cachedAudio.volume = 0.9;
    }
    cachedAudio.currentTime = 0;
    const p = cachedAudio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        try {
          const alt = new Audio('/assets/sounds/payment_confirmation.mp3');
          alt.volume = 0.9;
          alt.play().catch(() => {});
        } catch (_) {}
      });
    }
  } catch (_) {
    // Non-blocking: audio playback must never disrupt payment logic
  }
}
