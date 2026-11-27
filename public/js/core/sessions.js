import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { todayISO as istTodayISO } from '../utils/session-rules.js?v=1.8.194';

// Shared session state lives on window so every module copy sees the same data.
const SESSION_STALE_MS = 30000;
const inflightSessions = new Map();

function cache() {
  window.APP_CACHE = window.APP_CACHE || {};
  window.APP_CACHE.sessions = window.APP_CACHE.sessions || {};
  window.APP_CACHE.allSessions = window.APP_CACHE.allSessions || {};
  window.APP_CACHE.sessionsFetchedAt = window.APP_CACHE.sessionsFetchedAt || {};
  return window.APP_CACHE;
}

function clearSessionsFreshness() {
  if (typeof window === 'undefined' || !window.APP_CACHE) return;
  window.APP_CACHE.sessionsFetchedAt = {};
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !window.__uicSessionsListenersBound) {
  window.__uicSessionsListenersBound = true;
  window.addEventListener('uic:sessions-changed', clearSessionsFreshness);
  window.addEventListener('uic:meta-mutated', clearSessionsFreshness);
}

function centreOf(ctx) { return ctx === 'school' ? 'school' : 'youth'; }
function toDate(s) {
  if (!s) return null;
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

export function hasFreshSessionsCache(ctx, maxAgeMs = SESSION_STALE_MS) {
  const centre = centreOf(ctx);
  const c = cache();
  const list = c.sessions[centre];
  const at = Number(c.sessionsFetchedAt[centre] || 0);
  return Array.isArray(list) && at > 0 && (Date.now() - at) < maxAgeMs;
}

async function fetchCentreSessions(centre, { forceRefresh = false } = {}) {
  if (!forceRefresh && hasFreshSessionsCache(centre)) {
    return {
      active: cache().sessions[centre] || [],
      all: cache().allSessions[centre] || [],
      fromCache: true
    };
  }
  if (!forceRefresh && inflightSessions.has(centre)) {
    return inflightSessions.get(centre);
  }
  const task = (async () => {
    let allList = cache().allSessions[centre] || [];
    let activeList = cache().sessions[centre] || [];
    let ok = false;
    try {
      const snap = await getDocs(query(collection(db, 'sessions'), where('ctx', '==', centre)));
      const raw = snap.docs
        .map((d) => Object.assign({ id: d.id }, d.data()))
        .filter((s) => s.status !== 'deleted')
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
      allList = raw;
      activeList = raw.filter((s) => s.status !== 'archived');
      ok = true;
    } catch (e) {
      console.warn('[sessions] load failed', e && e.code ? e.code : e);
    }
    cache().allSessions[centre] = allList;
    cache().sessions[centre] = activeList;
    if (ok) cache().sessionsFetchedAt[centre] = Date.now();
    return { active: activeList, all: allList, fromCache: false };
  })().finally(() => {
    inflightSessions.delete(centre);
  });
  inflightSessions.set(centre, task);
  return task;
}

// Loads non-archived sessions for a centre, newest first.
export async function loadSessions(ctx, { forceRefresh = false } = {}) {
  const res = await fetchCentreSessions(centreOf(ctx), { forceRefresh });
  return res.active;
}

export async function loadAllSessions(ctx, { forceRefresh = false } = {}) {
  const res = await fetchCentreSessions(centreOf(ctx), { forceRefresh });
  return res.all;
}

export function getAllCachedSessions(ctx) { return cache().allSessions[centreOf(ctx)] || []; }
export function getCachedSessions(ctx) { return cache().sessions[centreOf(ctx)] || []; }
export function getRunningSession(ctx) { return getCachedSessions(ctx).find((s) => s.status === 'running') || null; }

export function getSelectedSessionId(ctx) {
  try { return localStorage.getItem('uicms.session.' + centreOf(ctx)); } catch (e) { return null; }
}

export function getSelectedSession(ctx = 'youth') {
  const list = getCachedSessions(ctx);
  if (!list.length) return null;
  const id = getSelectedSessionId(ctx);
  return list.find((s) => s.id === id) || list.find((s) => s.status === 'running') || list[0];
}

export function setSelectedSession(ctx, s) {
  try {
    if (s) localStorage.setItem('uicms.session.' + centreOf(ctx), s.id);
    else localStorage.removeItem('uicms.session.' + centreOf(ctx));
  } catch (e) {}
  cache().currentSession = s || null;
  window.dispatchEvent(new CustomEvent('uic:session-selected', { detail: { ctx: centreOf(ctx), session: s || null } }));
}

// Shape used by the sidebar session card.
export function toPeriod(s) {
  const start = toDate(s.startDate);
  const end = toDate(s.endDate);
  const today = toDate(todayISO());
  const DAY = 86400000;
  const total = Math.max(1, Math.round((end - start) / DAY) + 1);
  const done = Math.min(total, Math.max(0, Math.round((today - start) / DAY) + 1));
  return {
    kindLabel: 'Running session',
    name: s.name,
    percent: Math.round((done / total) * 100),
    start,
    end,
    daysLeft: Math.max(0, Math.round((end - today) / DAY))
  };
}

export function notifySessionsChanged() {
  clearSessionsFreshness();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event('uic:sessions-changed'));
    window.dispatchEvent(new CustomEvent('uic:meta-mutated', { detail: { reason: 'sessions:changed' } }));
  }
}
export function todayISO() {
  return istTodayISO();
}
export function expectedStatus(start, end, today = todayISO()) {
  if (start && start > today) return 'upcoming';
  if (end && end < today) return 'closed';
  return 'running';
}
export function statusMismatch(s, today = todayISO()) {
  if (!s) return false;
  if (s.status === 'archived') return false;
  return s.status !== expectedStatus(s.startDate, s.endDate, today);
}
export function daysLeft(end, today = todayISO()) {
  if (!end) return 0;
  const a = new Date(today + 'T00:00:00');
  const b = new Date(end + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
