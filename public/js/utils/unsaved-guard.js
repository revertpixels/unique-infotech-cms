// unsaved-guard.js — Rule 3 (v1.8.5): one shared "unsaved changes" guard for every form page.
// State lives on window so every import URL (with or without ?v=) shares the same registry.
import { confirmDialog } from '../components/ui-confirm.js';

const S = window.__uicUnsavedGuard || (window.__uicUnsavedGuard = { checks: new Set(), open: false, bound: false });

// Register a function that returns true while the page has unsaved changes.
// Returns an unregister function.
export function registerDirty(fn) {
  if (typeof fn !== 'function') return () => {};
  S.checks.add(fn);
  return () => S.checks.delete(fn);
}

export function isAnyDirty() {
  for (const fn of S.checks) {
    try { if (fn()) return true; } catch (e) { /* ignore broken check */ }
  }
  return false;
}

// Remove every registration (router calls this when a new page is rendered).
export function clearDirty() { S.checks.clear(); }

// Ask before leaving. Resolves true = allowed to leave, false = stay.
// opts.clear (default true): after "Leave", drop all registrations so the next guard check passes.
// Use { clear: false } for a form's own Cancel button (page stays, guard must keep working).
export async function confirmLeave(opts) {
  const clear = !opts || opts.clear !== false;
  if (!isAnyDirty()) return true;
  if (S.open) return false;
  S.open = true;
  let ok = false;
  try {
    ok = await confirmDialog({
      title: 'Unsaved changes',
      message: 'You have unsaved changes. If you leave now, your changes will be lost.',
      confirmText: 'Leave without saving',
      cancelText: 'Stay on page',
      danger: true,
      icon: 'alert-triangle'
    });
  } finally {
    S.open = false;
  }
  if (ok && clear) clearDirty();
  return !!ok;
}

// Browser back-out / refresh / tab close.
if (!S.bound) {
  S.bound = true;
  window.addEventListener('beforeunload', (ev) => {
    if (!isAnyDirty()) return;
    ev.preventDefault();
    ev.returnValue = '';
    return '';
  });
}
