import { app } from '../config/firebase-config.js';

export const APP_VERSION = '1.2.0';

export const APP_CACHE = {
  currentUser: null,
  branches: [],
  courses: [],
  levels: []
};

window.APP_CACHE = APP_CACHE;

export function clearAppCache() {
  APP_CACHE.currentUser = null;
  APP_CACHE.branches = [];
  APP_CACHE.courses = [];
  APP_CACHE.levels = [];
}

export function setContext(ctx) {
  if (ctx !== 'youth' && ctx !== 'school') {
    return;
  }
  document.body.dataset.ctx = ctx;
  try {
    sessionStorage.setItem('uic_ctx', ctx);
  } catch (e) {
    // silent
  }
}

export function getContext() {
  return document.body.dataset.ctx || 'youth';
}

export function loadSavedContext() {
  try {
    const v = sessionStorage.getItem('uic_ctx');
    if (v === 'youth' || v === 'school') {
      return v;
    }
  } catch (e) {
    // silent
  }
  return null;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.dataset.ctx) {
    document.body.dataset.ctx = 'youth';
  }
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  console.info(`Unique Infotech CMS v${APP_VERSION} - Firebase initialized`);
});
