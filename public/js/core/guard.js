import { auth } from '../config/firebase-config.js';
import { resolveSession, signOutUser } from './auth.js';

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;

let lastActivity = Date.now();
let intervalId = null;

function bump() {
  lastActivity = Date.now();
}

function startInactivityTracking() {
  if (intervalId) {
    clearInterval(intervalId);
  }
  window.addEventListener('mousedown', bump, { passive: true });
  window.addEventListener('keydown', bump, { passive: true });
  window.addEventListener('touchstart', bump, { passive: true });
  window.addEventListener('scroll', bump, { passive: true });
  window.addEventListener('mousemove', bump, { passive: true });
  intervalId = setInterval(() => {
    if (Date.now() - lastActivity > INACTIVITY_LIMIT_MS) {
      logout('timeout');
    }
  }, 30000);
}

export async function requireSession() {
  await auth.authStateReady();
  if (!auth.currentUser) {
    location.replace('/pages/login.html');
    return new Promise(() => {});
  }
  const result = await resolveSession(auth.currentUser);
  if (!result.ok) {
    await signOutUser();
    location.replace('/pages/login.html?reason=' + result.reason);
    return new Promise(() => {});
  }
  if (window.APP_CACHE) {
    window.APP_CACHE.currentUser = result.profile;
  }
  startInactivityTracking();
  return result.profile;
}

export async function logout(reason) {
  await signOutUser();
  if (window.APP_CACHE) {
    window.APP_CACHE.currentUser = null;
    window.APP_CACHE.branches = [];
    window.APP_CACHE.courses = [];
    window.APP_CACHE.levels = [];
  }
  location.replace('/pages/login.html' + (reason ? '?reason=' + reason : ''));
}
