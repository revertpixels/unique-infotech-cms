import { auth } from '../config/firebase-config.js';
import { clearAppCache } from './app.js?v=1.8.186';
import { resolveSession, signOutUser } from './auth.js';
import { playLogoutSound } from '../utils/sound.js?v=1.8.186';

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const LOGOUT_MIN_TRANSITION_MS = 1200;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];

let lastActivity = Date.now();
let intervalId = null;
let trackingBound = false;
let loggingOut = false;
let unauthHandler = null;

function bump() {
  lastActivity = Date.now();
}

export function stopInactivityTracking() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (trackingBound && typeof window !== 'undefined') {
    trackingBound = false;
    ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, bump));
  }
}

export function activateSession(profile) {
  stopInactivityTracking();
  lastActivity = Date.now();
  if (window.APP_CACHE) {
    window.APP_CACHE.currentUser = profile || null;
  }
  if (typeof window !== 'undefined') {
    trackingBound = true;
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
    intervalId = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_LIMIT_MS) {
        logout('timeout');
      }
    }, 30000);
  }
}

export function setUnauthenticatedHandler(fn) {
  unauthHandler = typeof fn === 'function' ? fn : null;
}

export async function tryRestoreSession() {
  await auth.authStateReady();
  if (!auth.currentUser) {
    return { ok: false, reason: '' };
  }
  const result = await resolveSession(auth.currentUser);
  if (!result.ok) {
    await signOutUser().catch(() => {});
    return { ok: false, reason: result.reason };
  }
  activateSession(result.profile);
  return { ok: true, profile: result.profile };
}

export async function requireSession() {
  const res = await tryRestoreSession();
  if (res.ok) return res.profile;
  if (typeof unauthHandler === 'function') {
    await unauthHandler(res.reason || '');
  } else {
    location.replace('/index.html' + (res.reason ? '?reason=' + res.reason : ''));
  }
  return new Promise(() => {});
}

export async function logout(reason, { minDelayMs = reason === 'timeout' ? 0 : LOGOUT_MIN_TRANSITION_MS } = {}) {
  if (loggingOut) return;
  loggingOut = true;
  try {
    playLogoutSound();
    stopInactivityTracking();
    if (typeof document !== 'undefined') {
      document.body.classList.add('is-logging-out');
      const signoutBtn = document.querySelector('#sidebar .sb-identity-btn');
      if (signoutBtn) {
        signoutBtn.disabled = true;
        signoutBtn.setAttribute('aria-busy', 'true');
      }
    }
    const tasks = [signOutUser().catch(() => {})];
    if (minDelayMs > 0) {
      tasks.push(new Promise((resolve) => setTimeout(resolve, minDelayMs)));
    }
    await Promise.all(tasks);
    clearAppCache();
    if (typeof unauthHandler === 'function') {
      await unauthHandler(reason || 'signedout');
    } else {
      location.replace('/index.html' + (reason ? '?reason=' + reason : ''));
    }
  } finally {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-logging-out');
    }
    loggingOut = false;
  }
}
