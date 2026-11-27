import { auth, db } from '../config/firebase-config.js';
import { terminate, clearIndexedDbPersistence } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { clearAppCache } from './app.js?v=1.8.190';
import { clearRouterCache } from './router.js?v=1.8.190';
import { resolveSession, signOutUser } from './auth.js';
import { playLogoutSound } from '../utils/sound.js?v=1.8.190';
import { clearAllReportCaches } from '../services/report.service.js?v=1.8.190';
import { invalidateArchiveReminderCache } from '../services/archive.service.js?v=1.8.190';
import { clearUsersDirectoryCache } from '../services/user-directory.service.js?v=1.8.190';
import { clearPersistedBranchBatchFilters } from '../components/branch-batch-filter.js?v=1.8.190';

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

    // Stop active page listeners/routes BEFORE terminating Firestore or wiping IndexedDB.
    try { clearRouterCache(); } catch (_) {}
    try { await terminate(db); } catch (_) {}
    try { await clearIndexedDbPersistence(db); } catch (_) {}

    try { clearAllReportCaches(); } catch (_) {}
    try { invalidateArchiveReminderCache(); } catch (_) {}
    try { clearUsersDirectoryCache(); } catch (_) {}
    try { clearPersistedBranchBatchFilters(); } catch (_) {}
    clearAppCache();

    if (typeof sessionStorage !== 'undefined') {
      try { sessionStorage.clear(); } catch (_) {}
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i += 1) keys.push(localStorage.key(i));
        keys.forEach((k) => {
          if (k && /^(uicms\.|uic_|pending_verification|email_verification)/i.test(k)) {
            localStorage.removeItem(k);
          }
        });
      } catch (_) {}
    }

    const cleanReason = reason ? '?reason=' + encodeURIComponent(reason) : '';
    const canReloadPage = typeof window !== 'undefined' && typeof location !== 'undefined' && typeof location.replace === 'function';
    if (canReloadPage) {
      location.replace('/index.html' + cleanReason);
    } else if (typeof unauthHandler === 'function') {
      await unauthHandler(reason || 'signedout');
    }
  } finally {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-logging-out');
    }
    loggingOut = false;
  }
}
