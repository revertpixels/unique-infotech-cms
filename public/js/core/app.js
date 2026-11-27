import { app } from '../config/firebase-config.js';

export const APP_VERSION = '1.8.192';

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
  APP_CACHE.org = null;
  APP_CACHE.sessions = {};
  APP_CACHE.allSessions = {};
  APP_CACHE.sessionsFetchedAt = {};
  APP_CACHE.currentSession = null;
  APP_CACHE.usersByEmail = {};
  APP_CACHE.usersList = [];
  APP_CACHE.usersLoaded = false;
  APP_CACHE.branding = { orgName: '', tagline: '', address: '', phone: '', logoUrl: '', logoDarkUrl: '', signatureUrl: '' };
  if (APP_CACHE.dashboardArchiveReminder instanceof Map) {
    APP_CACHE.dashboardArchiveReminder.clear();
  } else {
    APP_CACHE.dashboardArchiveReminder = new Map();
  }
  const fr = APP_CACHE.financialReports;
  if (fr && typeof fr === 'object') {
    if (fr.studentsById instanceof Map) fr.studentsById.clear();
    if (fr.studentsLists instanceof Map) fr.studentsLists.clear();
    if (fr.youthSessionDatasets instanceof Map) fr.youthSessionDatasets.clear();
    if (fr.photos instanceof Map) fr.photos.clear();
    if (fr.youthPending instanceof Map) fr.youthPending.clear();
    if (fr.youthHistory instanceof Map) fr.youthHistory.clear();
    if (fr.billsById instanceof Map) fr.billsById.clear();
    fr.meta = null;
    fr.kidsPending = null;
    fr.kidsHistory = null;
    fr.allYouthSessions = null;
  }
  delete APP_CACHE.financialReports;
  if (typeof globalThis !== 'undefined' && globalThis.__UIC_APP_CACHE__) {
    delete globalThis.__UIC_APP_CACHE__.financialReports;
  }
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
















