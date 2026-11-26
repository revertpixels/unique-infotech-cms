// dataset-session.js — Option A client-side watcher for `_system/client_state`.
// Pins the current dataset generation on page load and listens for live maintenance
// locks or generation changes (from Master Delete / Restore in another tab or session).
import { db } from '../config/firebase-config.js';
import {
  doc,
  getDocFromServer,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const KEY = Symbol.for('uic.dataset-session.v1');
const state = globalThis[KEY] || (globalThis[KEY] = {
  generation: null,
  active: false,
  mode: '',
  stale: false,
  ready: null,
  unsub: null,
  listeners: new Set()
});

function emit() {
  const snapshot = {
    generation: state.generation,
    active: state.active,
    mode: state.mode,
    stale: state.stale
  };
  state.listeners.forEach((fn) => {
    try { fn(snapshot); } catch (_) { /* silent */ }
  });
}

function showSafetyBanner(message, showReload) {
  if (typeof document === 'undefined' || !document.body) return;
  let el = document.getElementById('datasetSafetyNotice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'datasetSafetyNotice';
    el.setAttribute('role', 'alert');
    el.style.cssText = [
      'position:sticky',
      'top:0',
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:12px',
      'flex-wrap:wrap',
      'padding:12px 18px',
      'background:#FEF2F2',
      'color:#7F1D1D',
      'border-bottom:2px solid #DC2626',
      'font-size:13.5px',
      'font-weight:600',
      'box-shadow:0 4px 14px rgba(127,29,29,0.12)'
    ].join(';');
    document.body.prepend(el);
  }
  el.textContent = '';
  const txt = document.createElement('span');
  txt.textContent = message;
  el.appendChild(txt);
  if (showReload) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reload page';
    btn.style.cssText = 'padding:6px 14px;border-radius:8px;border:1px solid #DC2626;background:#DC2626;color:#fff;font-weight:700;font-size:12.5px;cursor:pointer;';
    btn.onclick = () => location.reload();
    el.appendChild(btn);
  }
}

function hideSafetyBanner() {
  if (typeof document === 'undefined') return;
  document.getElementById('datasetSafetyNotice')?.remove();
}

function syncBanner() {
  // Suppress blocking banner while the Manage Data page itself is actively driving an op.
  const onOrgManage = typeof location !== 'undefined'
    && location.hash.startsWith('#/org')
    && document.getElementById('md-workspace')
    && !document.getElementById('md-workspace').hidden;

  if (state.stale) {
    if (!onOrgManage) {
      showSafetyBanner('CMS data was cleared or restored in another session. Reload this page before continuing.', true);
    }
  } else if (state.active && state.mode !== 'backup') {
    if (!onOrgManage) {
      showSafetyBanner('System maintenance is active (' + state.mode + '). Access is temporarily paused until completion.', false);
    }
  } else {
    hideSafetyBanner();
  }
}

export function initDatasetSession() {
  if (state.ready) return state.ready;

  state.ready = (async () => {
    const ref = doc(db, '_system', 'client_state');
    let value = { generation: 'initial', active: false, mode: '' };
    try {
      const snap = await getDocFromServer(ref);
      if (snap.exists()) value = snap.data() || value;
    } catch (err) {
      // Fallback gracefully if offline or before first initialization; rules still enforce locks server-side.
      console.warn('[dataset-session] initial read skipped:', err && err.code ? err.code : err);
    }

    state.generation = value.generation || 'initial';
    state.active = !!value.active;
    state.mode = value.mode || '';
    syncBanner();
    emit();

    if (!state.unsub) {
      state.unsub = onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
        if (snap.metadata && snap.metadata.fromCache) return;
        const next = snap.exists() ? (snap.data() || {}) : { generation: 'initial', active: false, mode: '' };
        const nextGen = next.generation || 'initial';
        state.active = !!next.active;
        state.mode = next.mode || '';
        if (nextGen !== state.generation) {
          state.stale = true;
        }
        syncBanner();
        emit();
      }, (err) => {
        console.warn('[dataset-session] watcher warning:', err && err.code ? err.code : err);
      });
    }

    return state.generation;
  })();

  return state.ready;
}

export function getDatasetGeneration() {
  return state.generation || 'initial';
}

export function isDatasetStale() {
  return !!state.stale;
}

export function isMaintenanceActive() {
  return !!state.active && state.mode !== 'backup';
}

export function stopDatasetSession() {
  if (typeof state.unsub === 'function') {
    try { state.unsub(); } catch (_) {}
  }
  state.unsub = null;
  state.ready = null;
  state.generation = null;
  state.active = false;
  state.mode = '';
  state.stale = false;
  state.listeners.clear();
  hideSafetyBanner();
}

export function onDatasetStateChange(cb) {
  if (typeof cb !== 'function') return () => {};
  state.listeners.add(cb);
  return () => state.listeners.delete(cb);
}
