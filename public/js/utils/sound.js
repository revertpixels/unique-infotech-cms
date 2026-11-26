// sound.js — Non-blocking audio cue utilities running parallel to user actions
const AUDIO_CACHE = new Map();

function getAudioElement(fileName) {
  if (typeof Audio === 'undefined' || !fileName) return null;
  if (AUDIO_CACHE.has(fileName)) return AUDIO_CACHE.get(fileName);
  try {
    const audio = new Audio(`/assets/sounds/${fileName}`);
    audio.preload = 'auto';
    audio.volume = 0.9;
    AUDIO_CACHE.set(fileName, audio);
    return audio;
  } catch (_) {
    return null;
  }
}

function preloadSound(fileName) {
  try {
    const audio = getAudioElement(fileName);
    if (audio && audio.readyState === 0 && typeof audio.load === 'function') {
      audio.load();
    }
  } catch (_) {
    // Non-blocking: preloading errors must never affect app flow
  }
}

function playSoundCue(fileName) {
  try {
    const audio = getAudioElement(fileName);
    if (!audio) return;
    try {
      audio.currentTime = 0;
    } catch (_) {}
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {
    // Non-blocking: audio playback must never disrupt app logic
  }
}

function stopSoundCue(fileName) {
  try {
    const audio = AUDIO_CACHE.get(fileName);
    if (!audio) return;
    if (typeof audio.pause === 'function') audio.pause();
    try {
      audio.currentTime = 0;
    } catch (_) {}
  } catch (_) {
    // Silent cleanup
  }
}

/**
 * Plays the payment confirmation audio cue.
 */
export function playPaymentSuccessSound() {
  playSoundCue('payment_confirmation.mp3');
}

/**
 * Preloads mode switch audio for instant top-bar toggle playback.
 */
export function preloadSwitchSound() {
  preloadSound('switch.mp3');
}

/**
 * Plays the mode switch sound when toggling Youth Centre <-> Unique Kids.
 */
export function playSwitchSound() {
  playSoundCue('switch.mp3');
}

/**
 * Preloads the login tone when login view initializes.
 */
export function preloadLoginSound() {
  preloadSound('login.mp3');
}

/**
 * Plays login.mp3 immediately on sign-in tap in parallel with auth (never blocks redirect).
 */
export function playLoginSound() {
  playSoundCue('login.mp3');
}

/**
 * Stops login.mp3 cleanly if authentication fails or is cancelled.
 */
export function stopLoginSound() {
  stopSoundCue('login.mp3');
}

/**
 * Preloads the logout sound while inside the authenticated workspace.
 */
export function preloadLogoutSound() {
  preloadSound('logout.mp3');
}

/**
 * Plays logout.mp3 immediately on sign-out tap in parallel with Firebase sign-out.
 */
export function playLogoutSound() {
  playSoundCue('logout.mp3');
}
