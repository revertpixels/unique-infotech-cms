import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

// Shared session state lives on window so every module copy sees the same data.
function cache() {
  window.APP_CACHE = window.APP_CACHE || {};
  window.APP_CACHE.sessions = window.APP_CACHE.sessions || {};
  return window.APP_CACHE;
}
function centreOf(ctx) { return ctx === 'school' ? 'school' : 'youth'; }
function toDate(s) {
  if (!s) return null;
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

// Loads non-archived sessions for a centre, newest first.
export async function loadSessions(ctx) {
  const centre = centreOf(ctx);
  let list = [];
  try {
    const snap = await getDocs(query(collection(db, 'sessions'), where('ctx', '==', centre)));
    list = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
      .filter((s) => s.status !== 'archived')
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  } catch (e) {
    console.warn('[sessions] load failed', e && e.code ? e.code : e);
  }
  cache().sessions[centre] = list;
  return list;
}

export function getCachedSessions(ctx) { return cache().sessions[centreOf(ctx)] || []; }
export function getRunningSession(ctx) { return getCachedSessions(ctx).find((s) => s.status === 'running') || null; }

export function getSelectedSessionId(ctx) {
  try { return localStorage.getItem('uicms.session.' + centreOf(ctx)); } catch (e) { return null; }
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
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
  window.dispatchEvent(new Event('uic:sessions-changed'));
}
