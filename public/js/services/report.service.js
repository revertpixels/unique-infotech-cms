// report.service.js — Shared data loading, caching, ledger normalization, and export
// helpers for Pending & Overdue and Payment History (Youth Centre & Unique Kids).
// All fee/fine/balance maths delegate to payment.service.js, session-rules.js,
// and school-billing.js (single source of truth).

import { db } from '../config/firebase-config.js';
import {
  collection,
  collectionGroup,
  count,
  doc,
  getAggregateFromServer,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  Timestamp,
  where
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  evaluateYouthStudentDues,
  normalizeYouthPaymentsLedger,
  fetchStudentPayments,
  calculateStudentFinancials,
  isStudentEligibleForDues
} from './payment.service.js?v=1.8.196';
import {
  evaluateKidsPendingBills,
  buildKidsPaymentLedger,
  syncOpenKidsBills
} from '../utils/school-billing.js?v=1.8.196';
import { getStudentPhotoSrc } from '../utils/student-media.js?v=1.8.196';
import {
  todayISO,
  fmtDate,
  getOrgTimezone
} from '../utils/session-rules.js?v=1.8.196';
import { formatINR } from '../utils/formatter.js?v=1.8.196';
import { formatPersonName } from '../utils/formatter.js?v=1.8.196';
import { resolveUserDisplay, loadUsersDirectory, getRoleTitle } from './user-directory.service.js?v=1.8.196';
import { loadPdfMake, urlToDataUrl } from '../utils/admission-receipt-pdf.js?v=1.8.196';
import { loadAllSessions, getAllCachedSessions, hasFreshSessionsCache } from '../core/sessions.js?v=1.8.196';

const CACHE_KEY = 'financialReports';
export const CACHE_STALE_MS = 30000;
const YOUTH_STUDENTS_FIRST_PAGE_SIZE = 250;
const YOUTH_STUDENTS_NEXT_PAGE_SIZE = 500;
const UNLIMITED_STUDENTS_KEY = 'ALL';

const inflightMeta = new Map();
const inflightStudents = new Map();
const inflightSessionDatasets = new Map();
const inflightPending = new Map();
const inflightHistory = new Map();
let inflightKidsDataset = null;
let inflightKidsDelta = null;

let serverAggregationDisabledForSession = false;
let serverAggregationWarnedForSession = false;

function isFailedPreconditionError(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  if (code === 'failed-precondition' || code.endsWith('/failed-precondition')) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('failed-precondition') || msg.includes('requires an index');
}

function disableServerAggregationForSession(err) {
  serverAggregationDisabledForSession = true;
  if (!serverAggregationWarnedForSession) {
    serverAggregationWarnedForSession = true;
    const reason = err?.message || err?.code || 'missing composite index';
    console.warn(
      `[Dashboard] Server aggregation unavailable (${reason}); using local session dataset for this session.`
    );
  }
}

function ensureCacheRoot() {
  if (typeof window === 'undefined') {
    if (!globalThis.__UIC_APP_CACHE__) globalThis.__UIC_APP_CACHE__ = {};
    if (!globalThis.__UIC_APP_CACHE__[CACHE_KEY]) {
      globalThis.__UIC_APP_CACHE__[CACHE_KEY] = {
        meta: null,
        studentsById: new Map(),
        studentsLists: new Map(),
        youthSessionDatasets: new Map(),
        kidsDataset: null,
        kidsAdmissionReceipts: new Map(),
        photos: new Map(),
        youthPending: new Map(),
        kidsPending: null,
        youthHistory: new Map(),
        kidsHistory: null,
        billsById: new Map(),
        allYouthSessions: null
      };
    }
    return globalThis.__UIC_APP_CACHE__[CACHE_KEY];
  }
  window.APP_CACHE = window.APP_CACHE || {};
  if (!window.APP_CACHE[CACHE_KEY]) {
    window.APP_CACHE[CACHE_KEY] = {
      meta: null,
      studentsById: new Map(),
      studentsLists: new Map(),
      youthSessionDatasets: new Map(),
      kidsDataset: null,
      kidsAdmissionReceipts: new Map(),
      photos: new Map(),
      youthPending: new Map(),
      kidsPending: null,
      youthHistory: new Map(),
      kidsHistory: null,
      billsById: new Map(),
      allYouthSessions: null
    };
  }
  const root = window.APP_CACHE[CACHE_KEY];
  if (!root.studentsLists) root.studentsLists = new Map();
  if (!root.youthSessionDatasets) root.youthSessionDatasets = new Map();
  if (!root.kidsAdmissionReceipts) root.kidsAdmissionReceipts = new Map();
  return root;
}

export function isCacheStale(entry, maxAgeMs = CACHE_STALE_MS) {
  if (!entry || !entry.fetchedAt) return true;
  return (Date.now() - Number(entry.fetchedAt)) >= maxAgeMs;
}

/**
 * Delays showing a skeleton loader until delayMs passes without data settling,
 * preventing flicker when cached or fast queries complete under 250ms.
 */
export function scheduleDelayedSkeleton(showFn, delayMs = 250) {
  let active = true;
  const timer = setTimeout(() => {
    if (active && typeof showFn === 'function') showFn();
  }, delayMs);
  return {
    cancel() {
      active = false;
      clearTimeout(timer);
    }
  };
}

export function invalidateFinancialCache({ clearMeta = false } = {}) {
  const root = ensureCacheRoot();
  if (clearMeta) {
    root.meta = null;
    root.allYouthSessions = null;
  }
  root.studentsLists.clear();
  root.youthSessionDatasets.clear();
  root.kidsDataset = null;
  root.kidsAdmissionReceipts.clear();
  root.youthPending.clear();
  root.kidsPending = null;
  root.youthHistory.clear();
  root.kidsHistory = null;
  root.billsById.clear();
}

export function clearAllReportCaches() {
  invalidateFinancialCache({ clearMeta: true });
  const root = ensureCacheRoot();
  root.studentsById.clear();
  root.photos.clear();
  inflightMeta.clear();
  inflightStudents.clear();
  inflightSessionDatasets.clear();
  inflightPending.clear();
  inflightHistory.clear();
  inflightKidsDataset = null;
  inflightKidsDelta = null;
  serverAggregationDisabledForSession = false;
  serverAggregationWarnedForSession = false;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !window.__uicReportListenersBound) {
  window.__uicReportListenersBound = true;
  window.addEventListener('uic:data-mutated', () => {
    invalidateFinancialCache({ clearMeta: false });
    ensureCacheRoot().studentsById.clear();
  });
  window.addEventListener('uic:meta-mutated', () => {
    invalidateFinancialCache({ clearMeta: true });
  });
  window.addEventListener('uic:sessions-changed', () => {
    ensureCacheRoot().allYouthSessions = null;
  });
}

export async function getCachedBillForEntry(billId) {
  if (!billId) return null;
  const root = ensureCacheRoot();
  if (root.kidsPending?.items?.length) {
    const found = root.kidsPending.items.find((it) => it.billId === billId && it.bill);
    if (found?.bill) {
      root.billsById.set(billId, found.bill);
      return found.bill;
    }
  }
  if (root.billsById.has(billId)) return root.billsById.get(billId);
  try {
    const snap = await getDoc(doc(db, 'bills', billId));
    const bill = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    root.billsById.set(billId, bill);
    return bill;
  } catch (_) {
    root.billsById.set(billId, null);
    return null;
  }
}

export function clearPhotoCache() {
  ensureCacheRoot().photos.clear();
}

async function runInChunks(items, chunkSize, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    const settled = await Promise.all(slice.map(worker));
    results.push(...settled);
  }
  return results;
}

export function getCachedReferenceData(profile = null) {
  const root = ensureCacheRoot();
  const roleKey = `${profile?.role || 'anon'}::${profile?.branchId || ''}`;
  return (root.meta && root.meta._roleKey === roleKey) ? root.meta : null;
}

/**
 * Loads session-cached reference metadata (branches, courses, batches, and user display names).
 * Avoids repeated Firestore reads when switching filters or navigating between financial pages.
 */
export async function ensureReferenceData({ forceRefresh = false, profile = null } = {}) {
  const root = ensureCacheRoot();
  const roleKey = `${profile?.role || 'anon'}::${profile?.branchId || ''}`;
  if (root.meta && root.meta._roleKey === roleKey && !forceRefresh) {
    return { ...root.meta, readCount: 0, fromCache: true };
  }
  if (!forceRefresh && inflightMeta.has(roleKey)) {
    return inflightMeta.get(roleKey);
  }

  const task = (async () => {
    let readCount = 0;
    const isBranchHead = profile?.role === 'branch_head';
    const isSchoolHead = profile?.role === 'school_head';
    const isSuper = !isBranchHead && !isSchoolHead;

    const branchPromise = isBranchHead
      ? (profile?.branchId ? getDoc(doc(db, 'branches', profile.branchId)) : Promise.resolve(null))
      : (isSuper ? getDocs(collection(db, 'branches')) : Promise.resolve(null));

    const courseQuery = isBranchHead
      ? query(collection(db, 'courses'), where('ctx', '==', 'youth'))
      : (isSchoolHead ? query(collection(db, 'courses'), where('ctx', '==', 'school')) : collection(db, 'courses'));

    const batchQuery = isBranchHead
      ? query(collection(db, 'batches'), where('ctx', '==', 'youth'))
      : (isSchoolHead ? query(collection(db, 'batches'), where('ctx', '==', 'school')) : collection(db, 'batches'));

    const usersPromise = getDocs(collection(db, 'users')).catch(() => null);

    const [brRes, crRes, btRes, usrRes] = await Promise.allSettled([
      branchPromise,
      getDocs(courseQuery),
      getDocs(batchQuery),
      usersPromise
    ]);

    const toMapAndList = (settled) => {
      if (settled.status !== 'fulfilled' || !settled.value) return { list: [], byId: {} };
      const val = settled.value;
      if (typeof val.exists === 'function') {
        if (!val.exists()) return { list: [], byId: {} };
        readCount += 1;
        const item = { id: val.id, ...val.data() };
        return { list: [item], byId: { [item.id]: item } };
      }
      readCount += val.size;
      const list = val.docs.map((d) => ({ id: d.id, ...d.data() }));
      const byId = {};
      list.forEach((item) => { byId[item.id] = item; });
      return { list, byId };
    };

    const branches = toMapAndList(brRes);
    const courses = toMapAndList(crRes);
    const batches = toMapAndList(btRes);

    const usersByEmail = {};
    if (usrRes.status === 'fulfilled' && usrRes.value) {
      readCount += usrRes.value.size;
      usrRes.value.docs.forEach((d) => {
        const data = d.data() || {};
        const key = String(data.email || d.id || '').trim().toLowerCase();
        if (key) {
          usersByEmail[key] = {
            email: key,
            name: data.name || key,
            designation: data.designation || '',
            role: data.role || ''
          };
        }
      });
    }
    const dirUsers = (typeof window !== 'undefined' && window.APP_CACHE && window.APP_CACHE.usersByEmail) ? window.APP_CACHE.usersByEmail : {};
    Object.keys(dirUsers).forEach((k) => {
      if (dirUsers[k]) usersByEmail[k] = { ...usersByEmail[k], ...dirUsers[k] };
    });
    if (profile?.email) {
      const key = String(profile.email).trim().toLowerCase();
      usersByEmail[key] = {
        email: key,
        name: profile.name || usersByEmail[key]?.name || key,
        designation: profile.designation || usersByEmail[key]?.designation || '',
        role: profile.role || usersByEmail[key]?.role || ''
      };
    }

    const meta = {
      _roleKey: roleKey,
      fetchedAt: Date.now(),
      branchesList: branches.list,
      branchesById: branches.byId,
      coursesList: courses.list,
      coursesById: courses.byId,
      batchesList: batches.list,
      batchesById: batches.byId,
      usersByEmail
    };
    root.meta = meta;
    return { ...meta, readCount, fromCache: false };
  })().finally(() => {
    inflightMeta.delete(roleKey);
  });

  inflightMeta.set(roleKey, task);
  return task;
}

function getYouthStudentsCacheKey({ profile = null, sessionId = '', includeAllSessions = false } = {}) {
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const branchScope = isBranchHead ? profile.branchId : 'ALL';
  const sid = String(sessionId || '').trim();
  const scope = sid ? `S:${sid}` : (includeAllSessions ? 'ALL_SESSIONS' : 'UNSCOPED');
  return `${scope}::${branchScope}::${UNLIMITED_STUDENTS_KEY}`;
}

export function getCachedYouthStudents({ profile = null, sessionId = '', includeAllSessions = false } = {}) {
  const root = ensureCacheRoot();
  const key = getYouthStudentsCacheKey({ profile, sessionId, includeAllSessions });
  if (root.studentsLists.has(key)) {
    const entry = root.studentsLists.get(key);
    if (entry && entry.isComplete !== false) return entry;
  }
  const sid = String(sessionId || '').trim();
  if (sid) {
    const allKey = getYouthStudentsCacheKey({ profile, sessionId: '', includeAllSessions: true });
    const allEntry = root.studentsLists.get(allKey);
    if (allEntry && allEntry.isComplete !== false && !isCacheStale(allEntry)) {
      const list = allEntry.list.filter((s) => s.sessionId === sid);
      const byId = {};
      list.forEach((s) => { byId[s.id] = s; });
      return {
        list,
        byId,
        totalCount: list.length,
        loadedCount: list.length,
        isComplete: true,
        fetchedAt: allEntry.fetchedAt,
        syncedAtMs: allEntry.syncedAtMs || allEntry.fetchedAt,
        readCount: 0,
        fromCache: true
      };
    }
  }
  return null;
}

/**
 * Loads Youth Centre student list once per login/session using cursor pagination (startAfter)
 * so ALL students load without truncation. Optionally returns immediately after page 1 while
 * continuing remaining pages silently in the background.
 */
export async function ensureYouthStudents({
  profile = null,
  sessionId = '',
  includeAllSessions = false,
  forceRefresh = false,
  maxLimit = null,
  pageSize = YOUTH_STUDENTS_FIRST_PAGE_SIZE,
  nextPageSize = YOUTH_STUDENTS_NEXT_PAGE_SIZE,
  returnOnFirstPage = false,
  onFirstPage = null,
  onProgress = null
} = {}) {
  const root = ensureCacheRoot();
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const sid = String(sessionId || '').trim();
  const key = getYouthStudentsCacheKey({ profile, sessionId: sid, includeAllSessions });
  const numericCap = (Number.isFinite(Number(maxLimit)) && Number(maxLimit) > 0) ? Number(maxLimit) : Infinity;

  if (!forceRefresh) {
    const hit = getCachedYouthStudents({ profile, sessionId: sid, includeAllSessions });
    if (hit && hit.isComplete !== false && !isCacheStale(hit)) {
      if (!root.studentsLists.has(key)) root.studentsLists.set(key, hit);
      return { ...hit, readCount: 0, fromCache: true };
    }
    const existing = inflightStudents.get(key);
    if (existing) {
      if (onProgress && typeof existing.subscribe === 'function') existing.subscribe(onProgress);
      return returnOnFirstPage && existing.firstPagePromise
        ? existing.firstPagePromise
        : existing.fullPromise;
    }
  }

  const baseConstraints = [where('ctx', '==', 'youth')];
  if (sid) baseConstraints.push(where('sessionId', '==', sid));
  if (isBranchHead) baseConstraints.push(where('branchId', '==', profile.branchId));
  const baseQuery = query(collection(db, 'students'), ...baseConstraints);

  const progressListeners = new Set();
  if (typeof onProgress === 'function') progressListeners.add(onProgress);

  let resolveFirstPage;
  let rejectFirstPage;
  const firstPagePromise = new Promise((resolve, reject) => {
    resolveFirstPage = resolve;
    rejectFirstPage = reject;
  });
  // Prevent unhandled rejection when caller awaits fullPromise instead of firstPagePromise.
  firstPagePromise.catch(() => {});

  const fullPromise = (async () => {
    const firstLimit = Math.min(numericCap, Math.max(1, Number(pageSize) || YOUTH_STUDENTS_FIRST_PAGE_SIZE));
    const batchNextLimit = Math.max(1, Number(nextPageSize) || YOUTH_STUDENTS_NEXT_PAGE_SIZE);
    const syncStartedAtMs = Date.now() - 2000;

    const countPromise = getCountFromServer(baseQuery).catch(() => null);
    const snap1 = await getDocs(query(collection(db, 'students'), ...baseConstraints, limit(firstLimit)));
    const countSnap = await countPromise;

    const list = [];
    const byId = {};
    const seen = new Set();
    let readCount = snap1.size + (countSnap ? 1 : 0);

    snap1.docs.forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      const s = { id: d.id, ...d.data() };
      list.push(s);
      byId[s.id] = s;
      root.studentsById.set(s.id, s);
    });

    const serverTotal = countSnap && typeof countSnap.data === 'function' ? Number(countSnap.data().count || 0) : 0;
    const hitCapImmediately = Number.isFinite(numericCap) && list.length >= numericCap;
    const singlePageComplete = snap1.docs.length < firstLimit || hitCapImmediately;
    let totalCount = singlePageComplete ? list.length : Math.max(list.length, serverTotal || list.length);

    const makePayload = (isComplete) => ({
      list: list.slice(),
      byId: { ...byId },
      totalCount: isComplete ? list.length : totalCount,
      loadedCount: list.length,
      isComplete,
      fetchedAt: Date.now(),
      syncedAtMs: syncStartedAtMs,
      readCount,
      fromCache: false,
      done: fullPromise
    });

    const firstPayload = makePayload(singlePageComplete);
    if (singlePageComplete) {
      root.studentsLists.set(key, firstPayload);
    }
    if (typeof onFirstPage === 'function') {
      try { onFirstPage(firstPayload); } catch (_) {}
    }
    resolveFirstPage(firstPayload);

    let lastDoc = snap1.docs.length ? snap1.docs[snap1.docs.length - 1] : null;
    let hasMore = !singlePageComplete && !!lastDoc;
    let pages = 1;

    while (hasMore && list.length < numericCap && pages < 200) {
      const remaining = Number.isFinite(numericCap) ? Math.max(1, numericCap - list.length) : batchNextLimit;
      const take = Math.min(batchNextLimit, remaining);
      const snap = await getDocs(
        query(collection(db, 'students'), ...baseConstraints, startAfter(lastDoc), limit(take))
      );
      readCount += snap.size;
      pages += 1;

      let added = 0;
      snap.docs.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const s = { id: d.id, ...d.data() };
        list.push(s);
        byId[s.id] = s;
        root.studentsById.set(s.id, s);
        added += 1;
      });

      totalCount = Math.max(totalCount, list.length);
      lastDoc = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      hasMore = snap.docs.length === take && added > 0 && list.length < numericCap && !!lastDoc;

      const stepPayload = makePayload(!hasMore);
      if (!hasMore) {
        root.studentsLists.set(key, stepPayload);
      } else {
        progressListeners.forEach((cb) => {
          try { cb(stepPayload); } catch (_) {}
        });
      }
    }

    const entry = {
      list,
      byId,
      totalCount: list.length,
      loadedCount: list.length,
      isComplete: true,
      fetchedAt: Date.now(),
      syncedAtMs: syncStartedAtMs,
      readCount,
      fromCache: false,
      done: fullPromise
    };
    root.studentsLists.set(key, entry);
    progressListeners.forEach((cb) => {
      try { cb(entry); } catch (_) {}
    });
    return entry;
  })().catch((err) => {
    rejectFirstPage(err);
    throw err;
  }).finally(() => {
    inflightStudents.delete(key);
  });

  inflightStudents.set(key, {
    fullPromise,
    firstPagePromise,
    subscribe(cb) {
      if (typeof cb === 'function') progressListeners.add(cb);
    }
  });
  return returnOnFirstPage ? firstPagePromise : fullPromise;
}

/**
 * Incrementally checks for Youth students created/updated since the last full load
 * (using `updatedAt > syncedAtMs` + `getCountFromServer`) so second opens cost 1-20 reads.
 */
export async function syncYouthStudentsDelta({
  profile = null,
  sessionId = '',
  includeAllSessions = false
} = {}) {
  const root = ensureCacheRoot();
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const sid = String(sessionId || '').trim();
  const key = getYouthStudentsCacheKey({ profile, sessionId: sid, includeAllSessions });
  const existing = root.studentsLists.get(key) || getCachedYouthStudents({ profile, sessionId: sid, includeAllSessions });
  if (!existing || existing.isComplete === false || !existing.syncedAtMs) {
    const full = await ensureYouthStudents({ profile, sessionId: sid, includeAllSessions, forceRefresh: true });
    return { ...full, changedIds: (full.list || []).map((s) => s.id), deltaUsed: false };
  }

  const missingUpdatedIds = existing.list
    .filter((s) => s && s.status !== 'deleted' && !s.updatedAt)
    .map((s) => s.id);

  const baseConstraints = [where('ctx', '==', 'youth')];
  if (sid) baseConstraints.push(where('sessionId', '==', sid));
  if (isBranchHead) baseConstraints.push(where('branchId', '==', profile.branchId));

  // Safety net prior to backfill: if many cached records lack updatedAt, force a clean full reload
  // so legacy edits invisible to `updatedAt > sinceTs` are never skipped.
  if (missingUpdatedIds.length > 25) {
    const full = await ensureYouthStudents({ profile, sessionId: sid, includeAllSessions, forceRefresh: true });
    return {
      ...full,
      changedIds: Array.from(new Set([...(full.list || []).map((s) => s.id), ...missingUpdatedIds])),
      deltaUsed: false
    };
  }

  const nextSyncAtMs = Date.now() - 2000;
  const sinceTs = typeof Timestamp?.fromMillis === 'function'
    ? Timestamp.fromMillis(existing.syncedAtMs)
    : new Date(existing.syncedAtMs);

  const [countSnap, deltaSnap] = await Promise.all([
    getCountFromServer(query(collection(db, 'students'), ...baseConstraints)),
    getDocs(query(collection(db, 'students'), ...baseConstraints, where('updatedAt', '>', sinceTs)))
  ]);

  const serverTotal = Number(countSnap?.data?.()?.count ?? existing.list.length);
  if (serverTotal < existing.list.length) {
    // A document was permanently removed; re-fetch full list to avoid stale deleted entries.
    const full = await ensureYouthStudents({ profile, sessionId: sid, includeAllSessions, forceRefresh: true });
    return { ...full, changedIds: [], deltaUsed: false, readCount: (full.readCount || 0) + 1 + deltaSnap.size };
  }

  if (serverTotal > existing.list.length && typeof Timestamp?.fromMillis === 'function') {
    const tsCountSnap = await getCountFromServer(
      query(collection(db, 'students'), ...baseConstraints, where('updatedAt', '>', Timestamp.fromMillis(0)))
    ).catch(() => null);
    const tsCount = tsCountSnap && typeof tsCountSnap.data === 'function' ? Number(tsCountSnap.data().count ?? serverTotal) : serverTotal;
    if (tsCount < serverTotal) {
      const full = await ensureYouthStudents({ profile, sessionId: sid, includeAllSessions, forceRefresh: true });
      return { ...full, changedIds: (full.list || []).map((s) => s.id), deltaUsed: false, readCount: (full.readCount || 0) + 2 + deltaSnap.size };
    }
  }

  let readCount = 1 + deltaSnap.size;
  const changedSet = new Set();
  let nextList = existing.list;
  let nextById = existing.byId;

  const deltaIds = new Set(deltaSnap.docs.map((d) => d.id));
  const fetchMissingIds = missingUpdatedIds.filter((id) => !deltaIds.has(id));
  const extraSnaps = fetchMissingIds.length
    ? await Promise.all(fetchMissingIds.map((id) => getDoc(doc(db, 'students', id)).catch(() => null)))
    : [];
  readCount += fetchMissingIds.length;

  if (deltaSnap.size > 0 || extraSnaps.length > 0) {
    nextList = existing.list.slice();
    nextById = { ...existing.byId };
    const idxById = new Map();
    nextList.forEach((s, idx) => { if (s?.id) idxById.set(s.id, idx); });

    const mergeDoc = (d) => {
      if (!d || (typeof d.exists === 'function' && !d.exists())) return;
      const st = { id: d.id, ...d.data() };
      changedSet.add(st.id);
      nextById[st.id] = st;
      root.studentsById.set(st.id, st);
      if (idxById.has(st.id)) nextList[idxById.get(st.id)] = st;
      else {
        idxById.set(st.id, nextList.length);
        nextList.push(st);
      }
    };
    deltaSnap.docs.forEach(mergeDoc);
    extraSnaps.forEach(mergeDoc);
  }
  missingUpdatedIds.forEach((id) => changedSet.add(id));
  const changedIds = Array.from(changedSet);

  const updated = {
    ...existing,
    list: nextList,
    byId: nextById,
    totalCount: nextList.length,
    loadedCount: nextList.length,
    isComplete: true,
    fetchedAt: Date.now(),
    syncedAtMs: nextSyncAtMs,
    readCount,
    fromCache: false,
    changedIds,
    deltaUsed: true
  };
  root.studentsLists.set(key, updated);
  return updated;
}

export function getCachedYouthSessionDataset({ profile = null, session = null, sessionId = '' } = {}) {
  const sid = String(sessionId || session?.id || '').trim();
  if (!sid) return null;
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const key = `${sid}::${isBranchHead ? profile.branchId : 'ALL'}`;
  return ensureCacheRoot().youthSessionDatasets.get(key) || null;
}

/**
 * Shared single-session Youth dataset loader (students + payment subcollections).
 * Deduplicates concurrent callers (Dashboard, Pending, Payments, Reports) so each session
 * reads students and their payment subcollections at most once.
 */
export async function ensureYouthSessionDataset({
  profile = null,
  session = null,
  sessionId = '',
  forceRefresh = false
} = {}) {
  const sid = String(sessionId || session?.id || '').trim();
  if (!sid) {
    return {
      sessionId: '',
      studentsList: [],
      studentsById: {},
      paymentsByStudentId: {},
      rawPayments: [],
      fetchedAt: Date.now(),
      readCount: 0,
      fromCache: false
    };
  }

  const root = ensureCacheRoot();
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const branchScope = isBranchHead ? profile.branchId : 'ALL';
  const key = `${sid}::${branchScope}`;

  if (!forceRefresh && root.youthSessionDatasets.has(key)) {
    return { ...root.youthSessionDatasets.get(key), readCount: 0, fromCache: true };
  }
  if (!forceRefresh && inflightSessionDatasets.has(key)) {
    return inflightSessionDatasets.get(key);
  }

  const task = (async () => {
    const sessObj = session || (getAllCachedSessions('youth') || []).find((s) => s.id === sid) || null;
    const lookbackStart = sessObj?.startDate ? addDaysISO(sessObj.startDate, -120) : '';
    const canUseCollectionGroup = !isBranchHead && Boolean(lookbackStart);
    let earlyCgPromise = null;
    const fetchCgPayments = async () => {
      const groupedByStudent = new Map();
      const seenPayKeys = new Set();
      let cur = null;
      let cgHasMore = true;
      let cgPages = 0;
      const cgPageSize = 1000;
      let cgReads = 0;

      while (cgHasMore && cgPages < 40) {
        const cgConstraints = [where('date', '>=', lookbackStart), orderBy('date', 'desc')];
        if (cur) cgConstraints.push(startAfter(cur));
        cgConstraints.push(limit(cgPageSize));

        const cgSnap = await getDocs(query(collectionGroup(db, 'payment'), ...cgConstraints));
        cgReads += cgSnap.size;
        cgPages += 1;

        cgSnap.docs.forEach((d) => {
          const parentId = d.ref?.parent?.parent?.id || '';
          const data = d.data() || {};
          const studentDocId = data.studentDocId || parentId;
          if (!studentDocId) return;
          const uniqueKey = `${studentDocId}/${d.id}`;
          if (seenPayKeys.has(uniqueKey)) return;
          seenPayKeys.add(uniqueKey);
          const item = { id: d.id, studentDocId, ...data };
          if (!groupedByStudent.has(studentDocId)) groupedByStudent.set(studentDocId, []);
          groupedByStudent.get(studentDocId).push(item);
        });

        cur = cgSnap.docs.length ? cgSnap.docs[cgSnap.docs.length - 1] : null;
        cgHasMore = cgSnap.docs.length === cgPageSize && !!cur;
      }
      return { groupedByStudent, cgReads };
    };

    const [metaRes, stRes] = await Promise.all([
      ensureReferenceData({ forceRefresh, profile }),
      ensureYouthStudents({
        profile,
        sessionId: sid,
        forceRefresh,
        onFirstPage: (firstSnap) => {
          if (canUseCollectionGroup && !earlyCgPromise && Number(firstSnap?.totalCount || 0) > 40) {
            earlyCgPromise = fetchCgPayments();
          }
        }
      })
    ]);
    let readCount = (stRes.fromCache ? 0 : (stRes.readCount || 0));
    const studentsList = stRes.list || [];
    const studentsById = stRes.byId || {};
    const paymentsByStudentId = {};
    const rawPayments = [];

    const activeTargets = studentsList.filter((s) => s && s.status !== 'deleted');
    const useCgForSession = canUseCollectionGroup && (activeTargets.length > 40 || Boolean(earlyCgPromise));

    const sortStudentPaymentsDesc = (arr) => {
      arr.sort((a, b) => {
        const da = a.paidOn || a.date || (a.createdAt && a.createdAt.seconds ? new Date(a.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
        const dbDate = b.paidOn || b.date || (b.createdAt && b.createdAt.seconds ? new Date(b.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
        if (da !== dbDate) return dbDate.localeCompare(da);
        const ca = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
        const cb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
        return cb - ca;
      });
      return arr;
    };

    if (useCgForSession) {
      const { groupedByStudent, cgReads } = await (earlyCgPromise || fetchCgPayments());
      readCount += cgReads;

      const fallbackTargets = [];
      activeTargets.forEach((s) => {
        const found = groupedByStudent.get(s.id) || [];
        const admittedBeforeLookback = Boolean(s.admissionDate && s.admissionDate < lookbackStart);
        const foundCoursePaid = Number(calculateStudentFinancials(s, found).paid || 0);
        const foundMoneySum = found.reduce((acc, p) => {
          const t = String(p?.type || '').toUpperCase().trim();
          if (t === 'WA' || t === 'WAIVER') return acc;
          if (p.total != null) return acc + Number(p.total || 0);
          const lf = (p.waived || p.lateFeeWaived) ? 0 : Number(p.lateFee ?? p.lateFeeAmount ?? 0);
          return acc + Number(p.amount || 0) + lf;
        }, 0);
        const expectedCoursePaid = Number(s.paidAmount ?? s.totalPaid ?? 0);
        const paidSumMismatch = foundCoursePaid !== expectedCoursePaid;
        const moneySumMismatch = s.moneyCollected != null && foundMoneySum !== Number(s.moneyCollected);
        const missingExpectedPayments = expectedCoursePaid > 0 && found.length === 0;
        if (admittedBeforeLookback || paidSumMismatch || moneySumMismatch || missingExpectedPayments) {
          fallbackTargets.push(s);
        } else {
          const sorted = sortStudentPaymentsDesc(found.slice());
          paymentsByStudentId[s.id] = sorted;
          sorted.forEach((p) => rawPayments.push(p));
        }
      });

      if (fallbackTargets.length) {
        await runInChunks(fallbackTargets, 25, async (s) => {
          const payments = await fetchStudentPayments(s.id);
          readCount += Math.max(1, payments.length);
          paymentsByStudentId[s.id] = payments;
          payments.forEach((p) => {
            rawPayments.push({
              ...p,
              studentDocId: p.studentDocId || s.id
            });
          });
        });
      }
    } else {
      await runInChunks(activeTargets, 25, async (s) => {
        const payments = await fetchStudentPayments(s.id);
        readCount += Math.max(1, payments.length);
        paymentsByStudentId[s.id] = payments;
        payments.forEach((p) => {
          rawPayments.push({
            ...p,
            studentDocId: p.studentDocId || s.id
          });
        });
      });
    }

    const entry = {
      sessionId: sid,
      branchScope,
      meta: metaRes,
      studentsList,
      studentsById,
      paymentsByStudentId,
      rawPayments,
      fetchedAt: Date.now(),
      syncedAtMs: stRes.syncedAtMs || (Date.now() - 2000),
      readCount,
      fromCache: false
    };
    root.youthSessionDatasets.set(key, entry);
    return entry;
  })().finally(() => {
    inflightSessionDatasets.delete(key);
  });

  inflightSessionDatasets.set(key, task);
  return task;
}

/**
 * Incrementally syncs an already-cached single-session dataset using student `updatedAt` delta
 * and re-fetches payment subcollections ONLY for changed students.
 */
export async function syncYouthSessionDatasetDelta({
  profile = null,
  session = null,
  sessionId = ''
} = {}) {
  const sid = String(sessionId || session?.id || '').trim();
  if (!sid) return ensureYouthSessionDataset({ profile, session, sessionId: sid });

  const root = ensureCacheRoot();
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const branchScope = isBranchHead ? profile.branchId : 'ALL';
  const key = `${sid}::${branchScope}`;
  const existing = root.youthSessionDatasets.get(key);
  if (!existing) {
    const full = await ensureYouthSessionDataset({ profile, session, sessionId: sid, forceRefresh: false });
    return { ...full, changedCount: full.studentsList?.length || 0, deltaUsed: false };
  }

  const stDelta = await syncYouthStudentsDelta({ profile, sessionId: sid });
  if (stDelta.deltaUsed === false) {
    // A deletion forced full student refresh; rebuild full dataset.
    const full = await ensureYouthSessionDataset({ profile, session, sessionId: sid, forceRefresh: true });
    return { ...full, changedCount: full.studentsList?.length || 0, deltaUsed: false, readCount: (full.readCount || 0) + (stDelta.readCount || 0) };
  }

  const changedIds = (stDelta.changedIds || []).filter((id) => stDelta.byId?.[id]?.status !== 'deleted');
  let readCount = stDelta.readCount || 0;

  if (changedIds.length === 0) {
    const refreshed = {
      ...existing,
      studentsList: stDelta.list,
      studentsById: stDelta.byId,
      fetchedAt: Date.now(),
      syncedAtMs: stDelta.syncedAtMs || existing.syncedAtMs,
      readCount,
      fromCache: false,
      changedCount: 0,
      deltaUsed: true
    };
    root.youthSessionDatasets.set(key, refreshed);
    return refreshed;
  }

  const nextPaymentsByStu = { ...(existing.paymentsByStudentId || {}) };
  await runInChunks(changedIds, 15, async (id) => {
    const payments = await fetchStudentPayments(id);
    readCount += Math.max(1, payments.length);
    nextPaymentsByStu[id] = payments.map((p) => ({ ...p, studentDocId: p.studentDocId || id }));
  });

  const nextRawPayments = [];
  Object.entries(nextPaymentsByStu).forEach(([sId, arr]) => {
    if (!stDelta.byId?.[sId] || stDelta.byId[sId].status === 'deleted') return;
    (arr || []).forEach((p) => nextRawPayments.push({ ...p, studentDocId: p.studentDocId || sId }));
  });

  const updated = {
    ...existing,
    studentsList: stDelta.list,
    studentsById: stDelta.byId,
    paymentsByStudentId: nextPaymentsByStu,
    rawPayments: nextRawPayments,
    fetchedAt: Date.now(),
    syncedAtMs: stDelta.syncedAtMs || Date.now() - 2000,
    readCount,
    fromCache: false,
    changedCount: changedIds.length,
    deltaUsed: true
  };
  root.youthSessionDatasets.set(key, updated);

  // Invalidate derived pending/history caches ONLY for the session that changed.
  for (const k of Array.from(root.youthPending.keys())) {
    if (k.startsWith(`${sid}::`)) root.youthPending.delete(k);
  }
  for (const k of Array.from(root.youthHistory.keys())) {
    if (k.includes(`S:${sid}`)) root.youthHistory.delete(k);
  }
  return updated;
}

/**
 * Lazily fetches student avatar photos ONLY for visible student IDs on the active page.
 */
export async function loadStudentPhotos(studentDocIds = [], studentsById = null) {
  const root = ensureCacheRoot();
  const missing = [];
  const seen = new Set();
  const lookupStudent = (sid) => {
    if (!studentsById) return null;
    if (studentsById instanceof Map) return studentsById.get(sid) || null;
    return studentsById[sid] || null;
  };
  for (const id of studentDocIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const cached = root.photos.get(id);
    if (cached) continue;
    const directSrc = getStudentPhotoSrc(lookupStudent(id), null);
    if (directSrc) {
      root.photos.set(id, directSrc);
      continue;
    }
    if (!root.photos.has(id)) missing.push(id);
  }
  if (!missing.length) return root.photos;

  await runInChunks(missing, 6, async (sid) => {
    const stObj = lookupStudent(sid);
    try {
      const snap = await getDoc(doc(db, 'students', sid, 'docs', 'photo'));
      if (snap.exists()) {
        const docsMap = { photo: { id: snap.id, ...snap.data() } };
        const src = getStudentPhotoSrc(stObj, docsMap);
        if (src) {
          root.photos.set(sid, src);
          return;
        }
      }
      // Fallback: inspect docs subcollection in case photo was saved under an alternate ID/key
      const colSnap = await getDocs(collection(db, 'students', sid, 'docs'));
      const docsMap = {};
      colSnap.docs.forEach((d) => { docsMap[d.id] = { id: d.id, ...d.data() }; });
      root.photos.set(sid, getStudentPhotoSrc(stObj, docsMap));
    } catch (_) {
      root.photos.set(sid, getStudentPhotoSrc(stObj, null));
    }
  });
  return root.photos;
}

export function getCachedStudentPhoto(studentDocId) {
  return ensureCacheRoot().photos.get(studentDocId) || '';
}

export function getNextMonthPrefix(asOfIso = todayISO()) {
  const m = /^(\d{4})-(\d{2})/.exec(String(asOfIso || ''));
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]) + 1;
  if (mo > 12) { mo = 1; y += 1; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

export function getDatePresetRange(preset, asOfIso = todayISO(), session = null) {
  const today = String(asOfIso || todayISO());
  if (!preset || preset === 'all') return { dateFrom: '', dateTo: '' };
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === 'week') {
    const parts = today.split('-').map(Number);
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    const dow = dt.getUTCDay() || 7; // Mon=1 .. Sun=7
    const mon = new Date(dt.getTime() - (dow - 1) * 86400000);
    return {
      dateFrom: mon.toISOString().slice(0, 10),
      dateTo: today
    };
  }
  if (preset === 'month') {
    const ym = today.slice(0, 7);
    return { dateFrom: `${ym}-01`, dateTo: `${ym}-31` };
  }
  if (preset === 'last_month') {
    const parts = today.split('-').map(Number);
    const firstCur = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, 1));
    const lastPrev = new Date(firstCur.getTime() - 86400000);
    const y = lastPrev.getUTCFullYear();
    const m = String(lastPrev.getUTCMonth() + 1).padStart(2, '0');
    const d = String(lastPrev.getUTCDate()).padStart(2, '0');
    return { dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${d}` };
  }
  if (preset === 'session' && session) {
    return {
      dateFrom: String(session.startDate || ''),
      dateTo: String(session.endDate || '')
    };
  }
  return { dateFrom: '', dateTo: '' };
}

export function summarizePendingItems(items = [], asOfDate = todayISO()) {
  const nextMonthPrefix = getNextMonthPrefix(asOfDate);
  const overdueStudents = new Set();
  const dueStudents = new Set();
  const upcomingNextStudents = new Set();

  let overdueAmount = 0;
  let lateFeesTotal = 0;
  let dueThisMonthAmount = 0;
  let upcomingNextAmount = 0;
  let totalUpcomingAmount = 0;
  let maxDaysLate = 0;
  let oldestStudentName = '';
  let oldestItemLabel = '';

  for (const item of items) {
    const st = String(item.status || '').toLowerCase();
    const amt = Number(item.amount || 0);
    const lf = Number(item.lateFee || 0);
    const days = Number(item.daysLate || 0);

    if (st === 'overdue') {
      overdueAmount += amt;
      lateFeesTotal += lf;
      if (item.studentDocId) overdueStudents.add(item.studentDocId);
      if (days > maxDaysLate) {
        maxDaysLate = days;
        oldestStudentName = toTitleCaseIfCaps(item.studentName || '') || '';
        oldestItemLabel = item.kind === 'IN' && item.installmentNo
          ? `Inst ${item.installmentNo}`
          : (item.monthLabel ? `${item.monthLabel} bill` : (item.whatIsDue || ''));
      }
    } else if (st === 'due') {
      dueThisMonthAmount += amt;
      if (item.studentDocId) dueStudents.add(item.studentDocId);
    } else if (st === 'upcoming') {
      totalUpcomingAmount += amt;
      const monthKey = item.month || String(item.dueDate || '').slice(0, 7);
      if (!nextMonthPrefix || monthKey === nextMonthPrefix) {
        upcomingNextAmount += amt;
        if (item.studentDocId) upcomingNextStudents.add(item.studentDocId);
      }
    }
  }

  return {
    overdueAmount,
    lateFeesTotal,
    overdueWithLate: overdueAmount + lateFeesTotal,
    overdueStudentCount: overdueStudents.size,
    dueThisMonthAmount,
    dueStudentCount: dueStudents.size,
    upcomingNextAmount,
    upcomingNextStudentCount: upcomingNextStudents.size,
    totalUpcomingAmount,
    maxDaysLate,
    oldestStudentName,
    oldestItemLabel,
    totalRows: items.length
  };
}

export function getDaysLateFilterOptions() {
  return [
    { value: 'all', label: 'All days late', icon: 'clock' },
    { value: '1-7', label: '1-7 days', icon: 'clock' },
    { value: '8-30', label: '8-30 days', icon: 'clock' },
    { value: '31-60', label: '31-60 days', icon: 'alert-triangle' },
    { value: '60+', label: '60+ days', icon: 'flame' }
  ];
}

export function matchesDaysLateFilter(daysLate, rangeKey = 'all') {
  if (!rangeKey || rangeKey === 'all') return true;
  const d = Number(daysLate || 0);
  if (rangeKey === '1-7') return d >= 1 && d <= 7;
  if (rangeKey === '8-30') return d >= 8 && d <= 30;
  if (rangeKey === '31-60') return d >= 31 && d <= 60;
  if (rangeKey === '60+') return d > 60;
  return true;
}

export function isItemStrictlyOverdue(item, asOfDate = todayISO()) {
  if (!item) return false;
  const due = String(item.dueDate || '').slice(0, 10);
  if (!due || due >= asOfDate) return false; // Due today is not overdue
  if (Number(item.amount || 0) <= 0) return false;
  return String(item.status || '').toLowerCase() === 'overdue';
}

export function filterOverdueItems(items = [], asOfDate = todayISO()) {
  return (items || []).filter((it) => isItemStrictlyOverdue(it, asOfDate));
}

/**
 * Enforces sequential installment collection on Youth rows matching Pay Fees rules.
 */
function markYouthSequentialEligibility(studentItems) {
  let minUnpaidInst = Infinity;
  for (const it of studentItems) {
    if (it.kind === 'IN' && Number(it.installmentNo) > 0) {
      minUnpaidInst = Math.min(minUnpaidInst, Number(it.installmentNo));
    }
  }
  return studentItems.map((it) => {
    if (it.kind === 'IN') {
      const canCollect = Number(it.installmentNo) === minUnpaidInst;
      return {
        ...it,
        canCollect,
        sequentialBlockedBy: canCollect ? null : minUnpaidInst,
        collectHint: canCollect ? '' : `Pay Installment ${minUnpaidInst} first`
      };
    }
    return { ...it, canCollect: true, sequentialBlockedBy: null, collectHint: '' };
  });
}

function buildYouthPendingItemsFromDataset(dataset, session, meta, asOfDate) {
  const activeStudents = (dataset.studentsList || []).filter((s) => s && s.status === 'active');
  const paymentsByStudentId = dataset.paymentsByStudentId || {};
  const allItems = [];

  activeStudents.forEach((s) => {
    const payments = paymentsByStudentId[s.id] || [];
    const evaluated = evaluateYouthStudentDues(s, payments, session, {
      asOfDate,
      coursesById: meta.coursesById,
      branchesById: meta.branchesById,
      batchesById: meta.batchesById
    });
    if (!evaluated.eligible || !evaluated.items.length) return;

    const marked = filterOverdueItems(markYouthSequentialEligibility(evaluated.items), asOfDate);
    marked.forEach((item) => {
      const br = meta.branchesById[item.branchId || s.branchId] || {};
      const cr = meta.coursesById[item.courseId || s.courseId] || {};
      const courseCode = String(cr.courseCode || cr.code || item.courseCode || s.courseCode || '').trim();
      const courseName = item.courseName || s.courseName || cr.name || '';
      const branchCode = String(br.code || br.branchCode || br.shortCode || item.branchCode || s.branchCode || '').trim();
      const branchName = item.branchName || s.branchName || br.name || '';
      allItems.push({
        ...item,
        courseCode,
        courseName,
        branchCode,
        branchName,
        org: 'youth',
        orgLabel: 'Youth Centre',
        sessionName: session.name || '',
        searchBlob: [
          item.studentName,
          item.studentId,
          item.phone,
          courseCode,
          courseName,
          item.batchName,
          branchCode,
          branchName,
          item.whatIsDue
        ].filter(Boolean).join(' ').toLowerCase()
      });
    });
  });

  return {
    studentsById: dataset.studentsById || {},
    paymentsByStudentId,
    allItems
  };
}

export async function loadYouthDashboardServerAggregates({
  profile = null,
  session = null,
  branchFilter = 'all'
} = {}) {
  if (!session?.id) return null;
  if (serverAggregationDisabledForSession) return null;
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const effBranch = isBranchHead ? profile.branchId : (branchFilter && branchFilter !== 'all' ? branchFilter : 'all');
  const constraints = [where('ctx', '==', 'youth')];
  if (effBranch !== 'all') constraints.push(where('branchId', '==', effBranch));
  constraints.push(where('sessionId', '==', session.id));
  const baseQ = query(collection(db, 'students'), ...constraints);
  const activeQ = query(collection(db, 'students'), ...constraints, where('status', '==', 'active'));
  const moneyCountQ = query(collection(db, 'students'), ...constraints, where('moneyCollected', '>=', 0));

  try {
    // Separate count() and moneyCollected from course sum() queries: Firestore multi-field aggregation
    // excludes docs lacking ANY requested sum field, which would undercount totalCount/feeSum/paidSum pre-backfill.
    const [totalCountSnap, courseAggSnap, activeAggSnap, moneyAggSnap, moneyCountSnap] = await Promise.all([
      getCountFromServer(baseQ),
      getAggregateFromServer(baseQ, {
        feeSum: sum('feeTotal'),
        paidSum: sum('paidAmount')
      }),
      getAggregateFromServer(activeQ, {
        activeCount: count(),
        balanceSum: sum('balanceDue')
      }),
      getAggregateFromServer(baseQ, {
        moneySum: sum('moneyCollected')
      }),
      getCountFromServer(moneyCountQ).catch((err) => {
        if (isFailedPreconditionError(err)) throw err;
        return null;
      })
    ]);

    const totalAll = Number(totalCountSnap?.data?.()?.count || 0);
    const courseData = typeof courseAggSnap?.data === 'function' ? courseAggSnap.data() : {};
    const actData = typeof activeAggSnap?.data === 'function' ? activeAggSnap.data() : {};
    const moneyData = typeof moneyAggSnap?.data === 'function' ? moneyAggSnap.data() : {};
    const activeCount = Number(actData.activeCount || 0);
    const moneyDocsCount = (moneyCountSnap && typeof moneyCountSnap.data === 'function')
      ? Number(moneyCountSnap.data().count ?? -1)
      : -1;
    let readCount = 4 + (moneyCountSnap ? 1 : 0);

    let dropCount = 0;
    let dropFee = 0;
    let dropPaid = 0;
    if (totalAll > activeCount) {
      const dropQ = query(
        collection(db, 'students'),
        ...constraints,
        where('status', 'in', ['dropped', 'left', 'inactive', 'deleted'])
      );
      const dropSnap = await getAggregateFromServer(dropQ, {
        dropCount: count(),
        dropFee: sum('feeTotal'),
        dropPaid: sum('paidAmount')
      }).catch((err) => {
        if (isFailedPreconditionError(err)) throw err;
        return null;
      });
      if (dropSnap && typeof dropSnap.data === 'function') {
        const dd = dropSnap.data();
        dropCount = Number(dd.dropCount || 0);
        dropFee = Number(dd.dropFee || 0);
        dropPaid = Number(dd.dropPaid || 0);
        readCount += 1;
      }
    }

    const totalCount = Math.max(0, totalAll);
    // Safety net prior to backfill: if ANY student lacks moneyCollected (or coverage query unavailable),
    // fall back cleanly to full ledger calculation for monetary KPIs instead of painting partial sums.
    const missingMoneyCollected = totalCount > 0 && moneyDocsCount !== totalCount;
    const feeSum = Math.max(0, Number(courseData.feeSum || 0) - dropFee);
    const paidSum = Math.max(0, Number(courseData.paidSum || 0) - dropPaid);
    // Fee Collection includes payments collected from all students in the session (including later-dropped students),
    // matching Payment History & Reports ledger totals.
    const moneySum = missingMoneyCollected ? null : Math.max(0, Number(moneyData.moneySum || 0));
    const balanceSum = Math.max(0, Number(actData.balanceSum || 0));

    return {
      sessionId: session.id,
      branchFilter: effBranch,
      totalCount,
      activeCount,
      droppedExcludedCount: dropCount,
      feeSum,
      paidSum,
      moneySum,
      balanceSum,
      missingMoneyCollected,
      hasCurrencySums: !missingMoneyCollected && (feeSum > 0 || paidSum > 0 || balanceSum > 0 || totalCount === 0),
      hasMoneySum: !missingMoneyCollected && (moneySum > 0 || totalCount === 0),
      readCount
    };
  } catch (err) {
    if (isFailedPreconditionError(err)) {
      disableServerAggregationForSession(err);
      return null;
    }
    try {
      const cntSnap = await getCountFromServer(baseQ);
      const totalCount = Number(cntSnap?.data?.()?.count || 0);
      return {
        sessionId: session.id,
        branchFilter: effBranch,
        totalCount,
        activeCount: null,
        feeSum: 0,
        paidSum: 0,
        moneySum: 0,
        balanceSum: 0,
        hasCurrencySums: totalCount === 0,
        hasMoneySum: totalCount === 0,
        readCount: 1
      };
    } catch (countErr) {
      if (isFailedPreconditionError(countErr)) {
        disableServerAggregationForSession(countErr);
      }
      return null;
    }
  }
}

export function getCachedYouthPending({
  profile = null,
  session = null,
  asOfDate = todayISO()
} = {}) {
  if (!session || !session.id) return null;
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const cacheKey = `${session.id}::${isBranchHead ? profile.branchId : 'ALL'}::${asOfDate}`;
  return ensureCacheRoot().youthPending.get(cacheKey) || null;
}

/**
 * Loads Pending & Overdue dues for Youth Centre (session + role branch scoped).
 * Reuses the shared single-session dataset so Dashboard, Pending, Payments, and Reports
 * never duplicate student or payment subcollection reads.
 */
export async function loadYouthPendingReport({
  profile,
  session,
  forceRefresh = false,
  deltaRefresh = false,
  asOfDate = todayISO()
} = {}) {
  if (!session || !session.id) {
    const meta = await ensureReferenceData({ forceRefresh, profile });
    return {
      ctx: 'youth',
      items: [],
      studentsById: {},
      paymentsByStudentId: {},
      summary: summarizePendingItems([], asOfDate),
      readCount: meta.fromCache ? 0 : (meta.readCount || 0),
      asOfDate,
      fetchedAt: Date.now(),
      fromCache: false
    };
  }

  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const cacheKey = `${session.id}::${isBranchHead ? profile.branchId : 'ALL'}::${asOfDate}`;
  const root = ensureCacheRoot();
  if (!forceRefresh && !deltaRefresh && root.youthPending.has(cacheKey)) {
    const cached = root.youthPending.get(cacheKey);
    return { ...cached, readCount: 0, fromCache: true };
  }
  if (!forceRefresh && !deltaRefresh && inflightPending.has(cacheKey)) {
    return inflightPending.get(cacheKey);
  }

  const task = (async () => {
    const existingCached = !forceRefresh ? root.youthPending.get(cacheKey) : null;
    const [meta, dataset] = await Promise.all([
      ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile }),
      (!forceRefresh && deltaRefresh)
        ? syncYouthSessionDatasetDelta({ profile, session })
        : ensureYouthSessionDataset({ profile, session, forceRefresh })
    ]);
    const readCount = (meta.fromCache ? 0 : (meta.readCount || 0))
      + (dataset.fromCache ? 0 : (dataset.readCount || 0));

    if (!forceRefresh && deltaRefresh && dataset.deltaUsed && dataset.changedCount === 0 && existingCached) {
      const untouched = { ...existingCached, fetchedAt: Date.now(), readCount, fromCache: false };
      root.youthPending.set(cacheKey, untouched);
      return untouched;
    }

    const { studentsById, paymentsByStudentId, allItems } = buildYouthPendingItemsFromDataset(
      dataset,
      session,
      meta,
      asOfDate
    );

    const payload = {
      ctx: 'youth',
      items: allItems,
      studentsById,
      paymentsByStudentId,
      summary: summarizePendingItems(allItems, asOfDate),
      readCount,
      asOfDate,
      fetchedAt: dataset.fetchedAt || Date.now(),
      fromCache: false
    };
    root.youthPending.set(cacheKey, payload);
    return payload;
  })().finally(() => {
    inflightPending.delete(cacheKey);
  });

  inflightPending.set(cacheKey, task);
  return task;
}

/**
 * Updates one student inside cached Youth Pending reports right after payment collection
 * (only 2 reads: student + subcollection) so cards & rows update immediately.
 */
export async function refreshSingleYouthPendingStudent({
  studentDocId,
  session,
  profile,
  asOfDate = todayISO()
} = {}) {
  if (!studentDocId || !session?.id) return null;
  const root = ensureCacheRoot();
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const cacheKey = `${session.id}::${isBranchHead ? profile.branchId : 'ALL'}::${asOfDate}`;
  const existing = root.youthPending.get(cacheKey);
  if (!existing) return null;

  const meta = await ensureReferenceData({ profile });
  const [stSnap, payments] = await Promise.all([
    getDoc(doc(db, 'students', studentDocId)),
    fetchStudentPayments(studentDocId)
  ]);

  const student = stSnap.exists() ? { id: stSnap.id, ...stSnap.data() } : existing.studentsById[studentDocId];
  if (student) {
    root.studentsById.set(student.id, student);
    existing.studentsById[student.id] = student;
  }
  existing.paymentsByStudentId[studentDocId] = payments;

  const filteredOut = existing.items.filter((it) => it.studentDocId !== studentDocId);
  if (student && student.status === 'active') {
    const evaluated = evaluateYouthStudentDues(student, payments, session, {
      asOfDate,
      coursesById: meta.coursesById,
      branchesById: meta.branchesById,
      batchesById: meta.batchesById
    });
    if (evaluated.eligible && evaluated.items.length) {
      const marked = filterOverdueItems(markYouthSequentialEligibility(evaluated.items), asOfDate);
      marked.forEach((item) => {
        const br = meta.branchesById[item.branchId || student.branchId] || {};
        const cr = meta.coursesById[item.courseId || student.courseId] || {};
        const courseCode = String(cr.courseCode || cr.code || item.courseCode || student.courseCode || '').trim();
        const courseName = item.courseName || student.courseName || cr.name || '';
        const branchCode = String(br.code || br.branchCode || br.shortCode || item.branchCode || student.branchCode || '').trim();
        const branchName = item.branchName || student.branchName || br.name || '';
        filteredOut.push({
          ...item,
          courseCode,
          courseName,
          branchCode,
          branchName,
          org: 'youth',
          orgLabel: 'Youth Centre',
          sessionName: session.name || '',
          searchBlob: [
            item.studentName,
            item.studentId,
            item.phone,
            courseCode,
            courseName,
            item.batchName,
            branchCode,
            branchName,
            item.whatIsDue
          ].filter(Boolean).join(' ').toLowerCase()
        });
      });
    }
  }

  existing.items = filteredOut;
  existing.summary = summarizePendingItems(filteredOut, asOfDate);
  existing.fetchedAt = Date.now();
  if (existing.paymentsByStudentId) {
    existing.paymentsByStudentId[studentDocId] = payments;
  }
  const dsKey = `${session.id}::${isBranchHead ? profile.branchId : 'ALL'}`;
  const cachedDs = root.youthSessionDatasets.get(dsKey);
  if (cachedDs) {
    if (student) cachedDs.studentsById[student.id] = student;
    cachedDs.paymentsByStudentId[studentDocId] = payments;
    cachedDs.rawPayments = [
      ...(cachedDs.rawPayments || []).filter((p) => p.studentDocId !== studentDocId),
      ...payments.map((p) => ({ ...p, studentDocId }))
    ];
    cachedDs.fetchedAt = Date.now();
  }
  // Also invalidate Youth Payment History & unscoped student lists so switching tabs shows the newly recorded receipt.
  root.youthHistory.clear();
  root.studentsLists.clear();
  return existing;
}

function decorateKidsStudentsWithActiveBreaks(students = [], breaks = []) {
  const activeBreakBySid = new Map();
  (breaks || []).forEach((b) => {
    const st = String(b?.status || '').toLowerCase();
    if ((st === 'active' || st === 'approved') && !b.actualReturnDate && !b.actualReturnMonth) {
      if (b.studentId) activeBreakBySid.set(b.studentId, b);
      if (b.studentCode) activeBreakBySid.set(b.studentCode, b);
    }
  });
  return (students || []).map((orig) => {
    const s = { ...orig };
    const ab = activeBreakBySid.get(s.id) || (s.studentId ? activeBreakBySid.get(s.studentId) : null);
    if (ab && !s.breakFrom) s.breakFrom = ab.startMonth || '';
    if (ab && !s.breakTo) s.breakTo = ab.plannedEndMonth || ab.endMonth || '';
    if (ab && !s.breakReason) s.breakReason = ab.reason || '';
    return s;
  });
}

export function getCachedKidsDataset() {
  return ensureCacheRoot().kidsDataset || null;
}

/**
 * Loads and caches the shared Unique Kids dataset (`students` where ctx=='school',
 * `bills`, and `breaks`) so Dashboard, Students, Break Management, Collect Fees,
 * Pending & Overdue, Payment History, and Profiles share zero-duplicate reads.
 */
export async function ensureKidsDataset({
  profile = null,
  forceRefresh = false,
  syncOpenBills = false
} = {}) {
  const root = ensureCacheRoot();
  const isSuper = profile?.role === 'superadmin';
  const today = todayISO();

  if (!forceRefresh && root.kidsDataset) {
    if (syncOpenBills && isSuper && root.kidsDataset.billsSyncedAsOf !== today) {
      const createdBills = await syncOpenKidsBills(db, {
        students: root.kidsDataset.studentsList,
        bills: root.kidsDataset.bills,
        breaks: root.kidsDataset.breaks,
        asOfDate: today
      }).catch(() => []);
      if (createdBills && createdBills.length > 0) {
        const nextBills = root.kidsDataset.bills.concat(createdBills);
        createdBills.forEach((b) => { if (b?.id) root.billsById.set(b.id, b); });
        root.kidsDataset = {
          ...root.kidsDataset,
          bills: nextBills,
          billsSyncedAsOf: today,
          fetchedAt: Date.now(),
          syncedAtMs: Date.now() - 2000
        };
      } else {
        root.kidsDataset = { ...root.kidsDataset, billsSyncedAsOf: today };
      }
    }
    return { ...root.kidsDataset, readCount: 0, fromCache: true };
  }

  if (!forceRefresh && inflightKidsDataset) {
    return inflightKidsDataset;
  }

  const task = (async () => {
    const nextSyncAtMs = Date.now() - 2000;
    const [stSnap, billsSnap, brkSnap] = await Promise.all([
      getDocs(query(collection(db, 'students'), where('ctx', '==', 'school'))),
      getDocs(collection(db, 'bills')),
      getDocs(collection(db, 'breaks')).catch(() => null)
    ]);

    const readCount = stSnap.size + billsSnap.size + (brkSnap ? brkSnap.size : 0);
    const rawStudents = stSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    let bills = billsSnap.docs.map((d) => {
      const b = { id: d.id, ...d.data() };
      root.billsById.set(b.id, b);
      return b;
    });
    const breaks = brkSnap
      ? brkSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => !b.ctx || b.ctx === 'school')
      : [];

    const studentsList = decorateKidsStudentsWithActiveBreaks(rawStudents, breaks);
    const studentsById = {};
    studentsList.forEach((s) => {
      studentsById[s.id] = s;
      root.studentsById.set(s.id, s);
    });

    if (syncOpenBills && isSuper) {
      const createdBills = await syncOpenKidsBills(db, {
        students: studentsList,
        bills,
        breaks,
        asOfDate: today
      }).catch(() => []);
      if (createdBills && createdBills.length > 0) {
        bills = bills.concat(createdBills);
        createdBills.forEach((b) => { if (b?.id) root.billsById.set(b.id, b); });
      }
    }

    const entry = {
      ctx: 'school',
      studentsList,
      studentsById,
      bills,
      breaks,
      billsSyncedAsOf: (syncOpenBills && isSuper) ? today : '',
      fetchedAt: Date.now(),
      syncedAtMs: nextSyncAtMs,
      readCount,
      fromCache: false
    };
    root.kidsDataset = entry;
    return entry;
  })().finally(() => {
    inflightKidsDataset = null;
  });

  inflightKidsDataset = task;
  return task;
}

/**
 * Incrementally checks for Unique Kids changes since the last full load
 * (`updatedAt > syncedAtMs` + `getCountFromServer`), avoiding full collection scans.
 */
export async function syncKidsDatasetDelta({
  profile = null,
  syncOpenBills = false
} = {}) {
  const root = ensureCacheRoot();
  const existing = root.kidsDataset;
  if (!existing || !existing.syncedAtMs) {
    const full = await ensureKidsDataset({ profile, forceRefresh: true, syncOpenBills });
    return { ...full, changedCount: full.studentsList?.length || 0, deltaUsed: false };
  }
  if (inflightKidsDelta) return inflightKidsDelta;

  const task = (async () => {
    const missingUpdatedIds = existing.studentsList
      .filter((s) => s && s.status !== 'deleted' && !s.updatedAt)
      .map((s) => s.id);
    if (missingUpdatedIds.length > 25) {
      const full = await ensureKidsDataset({ profile, forceRefresh: true, syncOpenBills });
      return { ...full, changedCount: full.studentsList?.length || 0, deltaUsed: false };
    }

    const nextSyncAtMs = Date.now() - 2000;
    const sinceTs = typeof Timestamp?.fromMillis === 'function'
      ? Timestamp.fromMillis(existing.syncedAtMs)
      : new Date(existing.syncedAtMs);

    const [stCountSnap, stDeltaSnap, billsCountSnap, billsDeltaSnap, brkCountSnap, brkDeltaSnap] = await Promise.all([
      getCountFromServer(query(collection(db, 'students'), where('ctx', '==', 'school'))),
      getDocs(query(collection(db, 'students'), where('ctx', '==', 'school'), where('updatedAt', '>', sinceTs))),
      getCountFromServer(collection(db, 'bills')).catch(() => null),
      getDocs(query(collection(db, 'bills'), where('updatedAt', '>', sinceTs))).catch(() => null),
      getCountFromServer(collection(db, 'breaks')).catch(() => null),
      getDocs(query(collection(db, 'breaks'), where('updatedAt', '>', sinceTs))).catch(() => null)
    ]);

    const stServerTotal = Number(stCountSnap?.data?.()?.count ?? existing.studentsList.length);
    const billsServerTotal = billsCountSnap && typeof billsCountSnap.data === 'function'
      ? Number(billsCountSnap.data().count ?? existing.bills.length)
      : existing.bills.length;
    const brkServerTotal = brkCountSnap && typeof brkCountSnap.data === 'function'
      ? Number(brkCountSnap.data().count ?? existing.breaks.length)
      : existing.breaks.length;

    const readCount = 1 + stDeltaSnap.size
      + (billsCountSnap ? 1 : 0) + (billsDeltaSnap ? billsDeltaSnap.size : 0)
      + (brkCountSnap ? 1 : 0) + (brkDeltaSnap ? brkDeltaSnap.size : 0);

    if (stServerTotal < existing.studentsList.length || billsServerTotal < existing.bills.length) {
      const full = await ensureKidsDataset({ profile, forceRefresh: true, syncOpenBills });
      return { ...full, changedCount: full.studentsList?.length || 0, deltaUsed: false, readCount: (full.readCount || 0) + readCount };
    }

    let extraReads = 0;
    const deltaIds = new Set(stDeltaSnap.docs.map((d) => d.id));
    const fetchMissingIds = missingUpdatedIds.filter((id) => !deltaIds.has(id));
    const extraStSnaps = fetchMissingIds.length
      ? await Promise.all(fetchMissingIds.map((id) => getDoc(doc(db, 'students', id)).catch(() => null)))
      : [];
    extraReads += fetchMissingIds.length;

    let changedCount = stDeltaSnap.size + (billsDeltaSnap ? billsDeltaSnap.size : 0) + (brkDeltaSnap ? brkDeltaSnap.size : 0);
    const needFullBillsBecauseMissingTs = billsServerTotal > existing.bills.length && (!billsDeltaSnap || billsDeltaSnap.size === 0);
    const needFullBrkBecauseMissingTs = brkServerTotal > existing.breaks.length && (!brkDeltaSnap || brkDeltaSnap.size === 0);
    const needFullStBecauseMissingTs = stServerTotal > existing.studentsList.length && stDeltaSnap.size === 0;
    if (needFullBillsBecauseMissingTs || needFullBrkBecauseMissingTs || needFullStBecauseMissingTs) {
      const full = await ensureKidsDataset({ profile, forceRefresh: true, syncOpenBills });
      return { ...full, changedCount: full.studentsList?.length || 0, deltaUsed: false, readCount: (full.readCount || 0) + readCount + extraReads };
    }

    let nextRawStudents = existing.studentsList.slice();
    if (stDeltaSnap.size > 0 || extraStSnaps.length > 0) {
      const stIdx = new Map();
      nextRawStudents.forEach((s, i) => { if (s?.id) stIdx.set(s.id, i); });
      const mergeSt = (d) => {
        if (!d || (typeof d.exists === 'function' && !d.exists())) return;
        const st = { id: d.id, ...d.data() };
        changedCount += 1;
        if (stIdx.has(st.id)) nextRawStudents[stIdx.get(st.id)] = st;
        else {
          stIdx.set(st.id, nextRawStudents.length);
          nextRawStudents.push(st);
        }
      };
      stDeltaSnap.docs.forEach(mergeSt);
      extraStSnaps.forEach(mergeSt);
    }

    let nextBills = existing.bills.slice();
    if (billsDeltaSnap && billsDeltaSnap.size > 0) {
      const bIdx = new Map();
      nextBills.forEach((b, i) => { if (b?.id) bIdx.set(b.id, i); });
      billsDeltaSnap.docs.forEach((d) => {
        const b = { id: d.id, ...d.data() };
        root.billsById.set(b.id, b);
        if (bIdx.has(b.id)) nextBills[bIdx.get(b.id)] = b;
        else {
          bIdx.set(b.id, nextBills.length);
          nextBills.push(b);
        }
      });
    }

    let nextBreaks = existing.breaks.slice();
    if (brkDeltaSnap && brkDeltaSnap.size > 0) {
      const brIdx = new Map();
      nextBreaks.forEach((b, i) => { if (b?.id) brIdx.set(b.id, i); });
      brkDeltaSnap.docs.forEach((d) => {
        const b = { id: d.id, ...d.data() };
        if (b.ctx && b.ctx !== 'school') return;
        if (brIdx.has(b.id)) nextBreaks[brIdx.get(b.id)] = b;
        else {
          brIdx.set(b.id, nextBreaks.length);
          nextBreaks.push(b);
        }
      });
    }

    const today = todayISO();
    const isSuper = profile?.role === 'superadmin';
    let billsSyncedAsOf = existing.billsSyncedAsOf || '';
    const nextStudentsList = decorateKidsStudentsWithActiveBreaks(nextRawStudents, nextBreaks);
    const nextStudentsById = {};
    nextStudentsList.forEach((s) => {
      nextStudentsById[s.id] = s;
      root.studentsById.set(s.id, s);
    });

    if (syncOpenBills && isSuper && billsSyncedAsOf !== today) {
      const createdBills = await syncOpenKidsBills(db, {
        students: nextStudentsList,
        bills: nextBills,
        breaks: nextBreaks,
        asOfDate: today
      }).catch(() => []);
      if (createdBills && createdBills.length > 0) {
        nextBills = nextBills.concat(createdBills);
        createdBills.forEach((b) => { if (b?.id) root.billsById.set(b.id, b); });
        changedCount += createdBills.length;
      }
      billsSyncedAsOf = today;
    }

    const updated = {
      ...existing,
      studentsList: nextStudentsList,
      studentsById: nextStudentsById,
      bills: nextBills,
      breaks: nextBreaks,
      billsSyncedAsOf,
      fetchedAt: Date.now(),
      syncedAtMs: nextSyncAtMs,
      readCount: readCount + extraReads,
      fromCache: false,
      changedCount,
      deltaUsed: true
    };
    root.kidsDataset = updated;
    if (changedCount > 0) {
      root.kidsPending = null;
      root.kidsHistory = null;
    }
    return updated;
  })().finally(() => {
    inflightKidsDelta = null;
  });

  inflightKidsDelta = task;
  return task;
}

/**
 * Lightweight server-side count/sum aggregates for the Unique Kids Dashboard
 * with silent one-time console.warn fallback if a composite index is missing.
 */
export async function loadKidsDashboardServerAggregates({ profile = null } = {}) {
  if (serverAggregationDisabledForSession) return null;
  const studentsCol = collection(db, 'students');
  const totalQ = query(studentsCol, where('ctx', '==', 'school'));
  const activeQ = query(studentsCol, where('ctx', '==', 'school'), where('status', '==', 'active'));
  const breakQ = query(studentsCol, where('ctx', '==', 'school'), where('status', '==', 'break'));
  try {
    const [totalSnap, activeSnap, breakSnap] = await Promise.all([
      getCountFromServer(totalQ),
      getCountFromServer(activeQ),
      getCountFromServer(breakQ)
    ]);
    return {
      totalCount: Number(totalSnap?.data?.()?.count || 0),
      activeCount: Number(activeSnap?.data?.()?.count || 0),
      onBreakCount: Number(breakSnap?.data?.()?.count || 0),
      readCount: 3,
      profileRole: profile?.role || ''
    };
  } catch (err) {
    if (isFailedPreconditionError(err)) {
      disableServerAggregationForSession(err);
    }
    return null;
  }
}

export function getCachedKidsPending({ asOfDate = todayISO() } = {}) {
  const entry = ensureCacheRoot().kidsPending;
  if (!entry || entry.asOfDate !== asOfDate) return null;
  return entry;
}

/**
 * Loads Pending & Overdue dues for Unique Kids (active students + unpaid/partial bills + approved breaks),
 * reusing `ensureKidsDataset` / `syncKidsDatasetDelta` to eliminate duplicate collection reads.
 */
export async function loadKidsPendingReport({
  profile = null,
  forceRefresh = false,
  deltaRefresh = false,
  asOfDate = todayISO()
} = {}) {
  const root = ensureCacheRoot();
  if (!forceRefresh && !deltaRefresh && root.kidsPending && root.kidsPending.asOfDate === asOfDate) {
    return { ...root.kidsPending, readCount: 0, fromCache: true };
  }

  const existingCached = !forceRefresh ? root.kidsPending : null;
  const [meta, dataset] = await Promise.all([
    ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile }),
    (!forceRefresh && deltaRefresh)
      ? syncKidsDatasetDelta({ profile, syncOpenBills: true })
      : ensureKidsDataset({ profile, forceRefresh, syncOpenBills: true })
  ]);
  const readCount = (meta.fromCache ? 0 : (meta.readCount || 0))
    + (dataset.fromCache ? 0 : (dataset.readCount || 0));

  if (!forceRefresh && deltaRefresh && dataset.deltaUsed && dataset.changedCount === 0 && existingCached && existingCached.asOfDate === asOfDate) {
    const untouched = { ...existingCached, fetchedAt: Date.now(), readCount, fromCache: false };
    root.kidsPending = untouched;
    return untouched;
  }

  const students = dataset.studentsList || [];
  const studentsById = dataset.studentsById || {};
  const bills = dataset.bills || [];
  const breaks = dataset.breaks || [];

  const rawItems = filterOverdueItems(
    evaluateKidsPendingBills({ students, bills, breaks, asOfDate }),
    asOfDate
  );
  const items = rawItems.map((it) => {
    const st = studentsById[it.studentDocId] || {};
    const br = meta.branchesById[it.branchId || st.branchId] || {};
    const cr = meta.coursesById[it.courseId || st.courseId]
      || findCourseByName(meta.coursesById, it.courseName || st.courseName || it.level, 'school')
      || {};
    const bt = meta.batchesById[it.batchId || st.batchId] || {};
    const branchCode = String(br.code || br.branchCode || it.branchCode || st.branchCode || 'HO').trim();
    const branchName = st.branchName || br.name || 'Head Office';
    const courseCode = String(cr.courseCode || cr.code || it.courseCode || st.courseCode || '').trim();
    const courseName = st.courseName || cr.name || it.courseName || it.level || '';
    const batchName = st.batchName || bt.name || '';
    const mParts = /^(\d{4})-(\d{2})$/.exec(String(it.month || ''));
    const monthLabel = mParts
      ? new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(
        new Date(Date.UTC(Number(mParts[1]), Number(mParts[2]) - 1, 1))
      )
      : '';
    return {
      ...it,
      org: 'school',
      orgLabel: 'Unique Kids',
      branchId: it.branchId || st.branchId || 'HO',
      branchCode,
      branchName,
      courseId: it.courseId || st.courseId || '',
      courseCode,
      courseName,
      batchId: it.batchId || st.batchId || '',
      batchName,
      monthLabel,
      sessionId: '',
      sessionName: monthLabel || it.month || '',
      canCollect: true,
      searchBlob: [
        it.studentName,
        it.studentId,
        it.phone,
        courseCode,
        courseName,
        batchName,
        branchCode,
        branchName,
        monthLabel,
        it.whatIsDue
      ].filter(Boolean).join(' ').toLowerCase()
    };
  });

  const payload = {
    ctx: 'school',
    items,
    studentsById,
    paymentsByStudentId: {},
    summary: summarizePendingItems(items, asOfDate),
    readCount,
    asOfDate,
    fetchedAt: dataset.fetchedAt || Date.now(),
    fromCache: false
  };
  root.kidsPending = payload;
  return payload;
}

/**
 * Loads Youth Payment History using:
 * - Super Admin: paginated collectionGroup('payment') ordered by date desc + admission sibling safeguard
 * - Branch Head: branch-scoped students + subcollections (avoids Firestore collectionGroup get() limitation)
 */
function filterRawPaymentByDate(p, dateFrom = '', dateTo = '') {
  if (!p) return false;
  if (!dateFrom && !dateTo) return true;
  const dStr = String(p.date || p.paidOn || '').slice(0, 10);
  if (dateFrom && dStr < dateFrom) return false;
  if (dateTo && dStr > dateTo) return false;
  return true;
}

function getYouthHistoryCacheKey({
  profile = null,
  session = null,
  sessionId = '',
  extraSession = null,
  extraSessionId = '',
  dateFrom = '',
  dateTo = ''
} = {}) {
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const branchScope = isBranchHead ? profile.branchId : 'SUPER';
  const sid = String(sessionId || session?.id || '').trim();
  const esid = String(extraSessionId || extraSession?.id || '').trim();
  return `${branchScope}::S:${sid || 'ALL'}::E:${esid || ''}::${dateFrom || ''}::${dateTo || ''}`;
}

export function getCachedYouthHistory(opts = {}) {
  const key = getYouthHistoryCacheKey(opts);
  return ensureCacheRoot().youthHistory.get(key) || null;
}

function normalizeYouthHistoryResult({
  rawList,
  studentsById,
  meta,
  readCount = 0,
  rawByPath = {},
  lastCursor = null,
  hasMore = false
}) {
  const entries = normalizeYouthPaymentsLedger(rawList, studentsById, {
    branchesById: meta.branchesById,
    coursesById: meta.coursesById,
    requireParentStudent: true
  }).map((entry) => enrichLedgerEntry(entry, meta, studentsById[entry.studentDocId]));

  return {
    org: 'youth',
    entries,
    rawByPath,
    lastCursor,
    hasMore,
    readCount,
    fetchedAt: Date.now(),
    fromCache: false
  };
}

/**
 * Loads Youth Payment History entries scoped by active session (preferred) or paginated fallback:
 * - When `session` / `sessionId` is supplied, reuses `ensureYouthSessionDataset` (0 duplicate reads across
 *   Dashboard, Pending, Payments, and Reports; optional `extraSession` / `extraSessionId` runs in parallel).
 * - Otherwise Super Admin uses paginated `collectionGroup('payment')` (`loadAll = false` default, batch size 60)
 *   and Branch Head uses branch-scoped bounded `ensureYouthStudents`.
 */
export async function loadYouthPaymentHistory({
  profile,
  session = null,
  sessionId = '',
  extraSession = null,
  extraSessionId = '',
  dateFrom = '',
  dateTo = '',
  cursor = null,
  pageSize = 60,
  loadAll = false,
  maxBatches = 50,
  forceRefresh = false,
  deltaRefresh = false,
  existingState = null
} = {}) {
  const root = ensureCacheRoot();
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const sid = String(sessionId || session?.id || '').trim();
  const esid = String(extraSessionId || extraSession?.id || '').trim();
  const cacheKey = getYouthHistoryCacheKey({ profile, sessionId: sid, extraSessionId: esid, dateFrom, dateTo });

  if (!cursor && !forceRefresh && !deltaRefresh && root.youthHistory.has(cacheKey)) {
    const cached = root.youthHistory.get(cacheKey);
    return { ...cached, readCount: 0, fromCache: true };
  }
  if (!cursor && !forceRefresh && !deltaRefresh && inflightHistory.has(cacheKey)) {
    return inflightHistory.get(cacheKey);
  }

  const runTask = async () => {
    // Fast bounded session-dataset path (reuses students & payments with Dashboard/Pending/Reports)
    if (sid && !cursor) {
      const targetSessions = [sid];
      if (esid && esid !== sid) targetSessions.push(esid);
      const existingCached = !forceRefresh ? root.youthHistory.get(cacheKey) : null;

      const [meta, ...datasets] = await Promise.all([
        ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile }),
        ...targetSessions.map((id) => (
          (!forceRefresh && deltaRefresh)
            ? syncYouthSessionDatasetDelta({ profile, sessionId: id })
            : ensureYouthSessionDataset({ profile, sessionId: id, forceRefresh })
        ))
      ]);

      let readCount = meta.fromCache ? 0 : (meta.readCount || 0);
      datasets.forEach((ds) => {
        if (ds && !ds.fromCache) readCount += (ds.readCount || 0);
      });

      const allUnchanged = !forceRefresh && deltaRefresh && existingCached
        && datasets.every((ds) => ds && ds.deltaUsed && ds.changedCount === 0);
      if (allUnchanged) {
        const untouched = { ...existingCached, fetchedAt: Date.now(), readCount, fromCache: false };
        root.youthHistory.set(cacheKey, untouched);
        return untouched;
      }

      const studentsById = {};
      const rawList = [];
      datasets.forEach((ds) => {
        if (!ds) return;
        Object.assign(studentsById, ds.studentsById || {});
        (ds.rawPayments || []).forEach((p) => {
          if (filterRawPaymentByDate(p, dateFrom, dateTo)) rawList.push(p);
        });
      });

      const payload = normalizeYouthHistoryResult({
        rawList,
        studentsById,
        meta,
        readCount,
        rawByPath: {},
        lastCursor: null,
        hasMore: false
      });
      root.youthHistory.set(cacheKey, payload);
      return payload;
    }

    const meta = await ensureReferenceData({ forceRefresh, profile });
    let readCount = meta.fromCache ? 0 : (meta.readCount || 0);

    // Branch Head fallback when loading across all sessions (cannot run collectionGroup query)
    if (isBranchHead) {
      const stRes = await ensureYouthStudents({
        profile,
        includeAllSessions: true,
        forceRefresh
      });
      if (!stRes.fromCache) readCount += (stRes.readCount || 0);
      const studentsById = stRes.byId || {};
      const studentsList = (stRes.list || []).filter((s) => s && s.status !== 'deleted');

      const rawPayments = [];
      await runInChunks(studentsList, 15, async (s) => {
        const pSnap = await getDocs(collection(db, 'students', s.id, 'payment'));
        readCount += Math.max(1, pSnap.size);
        pSnap.docs.forEach((pd) => {
          const data = pd.data() || {};
          const item = { id: pd.id, studentDocId: s.id, ...data };
          if (filterRawPaymentByDate(item, dateFrom, dateTo)) rawPayments.push(item);
        });
      });

      const payload = normalizeYouthHistoryResult({
        rawList: rawPayments,
        studentsById,
        meta,
        readCount,
        rawByPath: {},
        lastCursor: null,
        hasMore: false
      });
      root.youthHistory.set(cacheKey, payload);
      return payload;
    }

    // Super Admin paginated collectionGroup('payment') ordered by date desc in bounded pages.
    const rawByPath = existingState?.rawByPath ? { ...existingState.rawByPath } : {};
    const touchedStudentIds = new Set(Object.values(rawByPath).map((p) => p.studentDocId).filter(Boolean));
    const fetchedBoundaryStudents = new Set();

    let cur = cursor;
    let hasMore = false;
    let batches = 0;

    do {
      const batchConstraints = [];
      if (dateFrom) batchConstraints.push(where('date', '>=', dateFrom));
      if (dateTo) batchConstraints.push(where('date', '<=', dateTo));
      batchConstraints.push(orderBy('date', 'desc'));
      if (cur) batchConstraints.push(startAfter(cur));
      batchConstraints.push(limit(pageSize));

      const cgSnap = await getDocs(query(collectionGroup(db, 'payment'), ...batchConstraints));
      readCount += cgSnap.size;
      batches += 1;

      cgSnap.docs.forEach((d) => {
        const parentStudentId = d.ref.parent?.parent?.id || '';
        const data = d.data() || {};
        rawByPath[`${parentStudentId}/${d.id}`] = {
          id: d.id,
          studentDocId: data.studentDocId || parentStudentId,
          ...data
        };
        if (parentStudentId) touchedStudentIds.add(parentStudentId);
      });

      hasMore = cgSnap.docs.length === pageSize;
      if (cgSnap.docs.length) cur = cgSnap.docs[cgSnap.docs.length - 1];

      // Safeguard: if pagination ends mid-group on AD/FULL/MAT, fetch that student's sibling payments.
      if (hasMore && (!loadAll || batches >= maxBatches)) {
        const tailDoc = cgSnap.docs[cgSnap.docs.length - 1];
        const tailType = String(tailDoc.data()?.type || '').toUpperCase();
        const tailSid = tailDoc.ref.parent?.parent?.id || '';
        if (tailSid && (tailType === 'AD' || tailType === 'FULL' || tailType === 'MAT') && !fetchedBoundaryStudents.has(tailSid)) {
          fetchedBoundaryStudents.add(tailSid);
          const sibSnap = await getDocs(collection(db, 'students', tailSid, 'payment'));
          readCount += Math.max(1, sibSnap.size);
          sibSnap.docs.forEach((pd) => {
            const item = { id: pd.id, studentDocId: tailSid, ...pd.data() };
            if (filterRawPaymentByDate(item, dateFrom, dateTo)) {
              rawByPath[`${tailSid}/${pd.id}`] = item;
            }
          });
        }
      }
    } while (loadAll && hasMore && batches < maxBatches);

    // Fetch any missing parent students (and cache them for subsequent views).
    const missingStudentIds = Array.from(touchedStudentIds).filter((id) => !root.studentsById.has(id));
    if (missingStudentIds.length) {
      await runInChunks(missingStudentIds, 15, async (id) => {
        try {
          const snap = await getDoc(doc(db, 'students', id));
          readCount += 1;
          root.studentsById.set(id, snap.exists() ? { id: snap.id, ...snap.data() } : null);
        } catch (_) {
          root.studentsById.set(id, null);
        }
      });
    }

    const studentsById = {};
    Object.values(rawByPath).forEach((p) => {
      const st = root.studentsById.get(p.studentDocId);
      if (st && st.ctx === 'youth') studentsById[p.studentDocId] = st;
    });

    const validRawList = Object.values(rawByPath).filter((p) => Boolean(studentsById[p.studentDocId]));
    const payload = normalizeYouthHistoryResult({
      rawList: validRawList,
      studentsById,
      meta,
      readCount,
      rawByPath,
      lastCursor: cur,
      hasMore
    });
    if (!cursor) {
      root.youthHistory.set(cacheKey, payload);
    }
    return payload;
  };

  if (cursor) {
    return runTask();
  }
  const task = runTask().finally(() => {
    inflightHistory.delete(cacheKey);
  });
  inflightHistory.set(cacheKey, task);
  return task;
}

/**
 * Loads Unique Kids Payment History (admission receipts + monthly payments + waivers).
 */
export function getCachedKidsHistory({ dateFrom = '', dateTo = '' } = {}) {
  const entry = ensureCacheRoot().kidsHistory;
  if (!entry) return null;
  return {
    ...entry,
    entries: filterEntriesByDate(entry.entries, dateFrom, dateTo),
    allEntriesCount: entry.entries.length
  };
}

/**
 * Loads Unique Kids Payment History reusing the shared `kidsDataset` and reading
 * admission payments directly from student docs (only querying `payment/payment`
 * subcollection for rare legacy docs missing inline fee fields).
 */
export async function loadKidsPaymentHistory({
  profile = null,
  dateFrom = '',
  dateTo = '',
  forceRefresh = false,
  deltaRefresh = false
} = {}) {
  const root = ensureCacheRoot();

  if (!forceRefresh && !deltaRefresh && root.kidsHistory) {
    const filtered = filterEntriesByDate(root.kidsHistory.entries, dateFrom, dateTo);
    return {
      ...root.kidsHistory,
      entries: filtered,
      allEntriesCount: root.kidsHistory.entries.length,
      readCount: 0,
      fromCache: true
    };
  }

  const existingHistory = !forceRefresh ? root.kidsHistory : null;
  const [meta, dataset] = await Promise.all([
    ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile }),
    (!forceRefresh && deltaRefresh)
      ? syncKidsDatasetDelta({ profile })
      : ensureKidsDataset({ profile, forceRefresh })
  ]);
  let readCount = (meta.fromCache ? 0 : (meta.readCount || 0))
    + (dataset.fromCache ? 0 : (dataset.readCount || 0));

  if (!forceRefresh && deltaRefresh && existingHistory && dataset.deltaUsed) {
    const [payCountSnap, wavCountSnap] = await Promise.all([
      getCountFromServer(collection(db, 'payments')).catch(() => null),
      getCountFromServer(collection(db, 'waivers')).catch(() => null)
    ]);
    const payTotal = payCountSnap && typeof payCountSnap.data === 'function' ? Number(payCountSnap.data().count ?? -1) : -1;
    const wavTotal = wavCountSnap && typeof wavCountSnap.data === 'function' ? Number(wavCountSnap.data().count ?? -1) : -1;
    readCount += (payCountSnap ? 1 : 0) + (wavCountSnap ? 1 : 0);
    if (dataset.changedCount === 0 && payTotal === existingHistory.rawPaymentsCount && wavTotal === existingHistory.rawWaiversCount) {
      const untouched = { ...existingHistory, fetchedAt: Date.now() };
      root.kidsHistory = untouched;
      return {
        ...untouched,
        entries: filterEntriesByDate(untouched.entries, dateFrom, dateTo),
        allEntriesCount: untouched.entries.length,
        readCount,
        fromCache: false
      };
    }
  }

  const [paySnap, wavSnap] = await Promise.all([
    getDocs(collection(db, 'payments')),
    getDocs(collection(db, 'waivers'))
  ]);
  readCount += paySnap.size + wavSnap.size;

  const students = dataset.studentsList || [];
  const studentsById = dataset.studentsById || {};

  const paymentsDocs = paySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const waiversDocs = wavSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Build admission payment records from inline student doc fields to eliminate N+1 subcollection reads;
  // fall back to `students/{id}/payment/payment` only for legacy docs missing fee/receipt fields.
  const admissionPayments = [];
  const legacyFallbackStudents = [];
  students.forEach((s) => {
    const hasInlineFee = s.actualAmountReceived != null || s.admissionFee != null;
    if (hasInlineFee) {
      const amt = Number(s.actualAmountReceived ?? s.receivedTotal ?? s.admissionFee ?? 0);
      if (amt <= 0) return;
      if (s.receiptNo || s.paymentMode) {
        admissionPayments.push({
          id: 'payment',
          studentDocId: s.id,
          studentId: s.studentId || s.id,
          receiptNo: s.receiptNo || '',
          admissionFee: Number(s.admissionFee ?? amt),
          configuredAdmissionFee: Number(s.configuredAdmissionFee ?? s.admissionFee ?? amt),
          actualAmountReceived: amt,
          paymentMode: s.paymentMode || 'full',
          txnId: s.txnId || '',
          admissionDate: s.admissionDate || '',
          createdBy: s.createdBy || '',
          recordedByRole: s.recordedByRole || '',
          receivedByName: s.receivedByName || s.recordedByName || '',
          recordedByDesignation: s.recordedByDesignation || '',
          createdAt: s.createdAt || null
        });
        return;
      }
    }
    if (root.kidsAdmissionReceipts.has(s.id)) {
      const cachedAp = root.kidsAdmissionReceipts.get(s.id);
      if (cachedAp) admissionPayments.push(cachedAp);
      return;
    }
    legacyFallbackStudents.push(s);
  });

  if (legacyFallbackStudents.length > 0) {
    await runInChunks(legacyFallbackStudents, 10, async (s) => {
      try {
        const snap = await getDoc(doc(db, 'students', s.id, 'payment', 'payment'));
        readCount += 1;
        if (snap.exists()) {
          const ap = { id: snap.id, studentDocId: s.id, ...snap.data() };
          root.kidsAdmissionReceipts.set(s.id, ap);
          admissionPayments.push(ap);
        } else {
          root.kidsAdmissionReceipts.set(s.id, null);
        }
      } catch (_) {
        // Ignore missing permission/doc
      }
    });
  }

  const rawEntries = buildKidsPaymentLedger({
    students,
    admissionPayments,
    paymentsDocs,
    waiversDocs
  });

  const entries = rawEntries.map((entry) => {
    const st = studentsById[entry.studentDocId] || {};
    const enriched = enrichLedgerEntry(entry, meta, st);
    return {
      ...enriched,
      org: 'school',
      orgLabel: 'Unique Kids'
    };
  });

  const cached = {
    org: 'school',
    entries,
    rawPaymentsCount: paymentsDocs.length,
    rawWaiversCount: waiversDocs.length,
    hasMore: false,
    lastCursor: null,
    readCount,
    fetchedAt: Date.now(),
    fromCache: false
  };
  root.kidsHistory = cached;

  return {
    ...cached,
    entries: filterEntriesByDate(entries, dateFrom, dateTo),
    allEntriesCount: entries.length
  };
}

function filterEntriesByDate(entries = [], dateFrom = '', dateTo = '') {
  if (!dateFrom && !dateTo) return entries;
  return entries.filter((e) => {
    const d = String(e.date || '').slice(0, 10);
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
}

function findCourseByName(coursesById = {}, courseName = '', ctx = '') {
  const target = String(courseName || '').trim().toLowerCase();
  if (!target) return null;
  const list = Object.values(coursesById);
  return list.find((c) => c && String(c.name || '').trim().toLowerCase() === target && (!ctx || !c.ctx || c.ctx === ctx))
    || list.find((c) => c && String(c.name || '').trim().toLowerCase() === target)
    || null;
}

const MODE_META = {
  cash: { label: 'Cash', cls: 'cash', icon: 'banknote' },
  upi: { label: 'UPI', cls: 'upi', icon: 'smartphone' },
  card: { label: 'Card', cls: 'card', icon: 'credit-card' },
  bank: { label: 'Bank', cls: 'bank', icon: 'landmark' },
  bank_transfer: { label: 'Bank', cls: 'bank', icon: 'landmark' },
  neft: { label: 'Bank', cls: 'bank', icon: 'landmark' },
  online: { label: 'Online', cls: 'upi', icon: 'smartphone' },
  cheque: { label: 'Cheque', cls: 'cheque', icon: 'file-text' },
  waiver: { label: 'Waiver', cls: 'waiver', icon: 'shield-off' }
};

export function toTitleCaseIfCaps(text) {
  return formatPersonName(text);
}

export function formatCollectorName(name, email = '', designation = '') {
  if (email) {
    const disp = resolveUserDisplay(email, name, designation);
    if (disp.name && disp.name !== '-') return disp.name;
  }
  const raw = String(name || '').trim();
  if (!raw || raw === '-') return '';
  return formatPersonName(raw);
}

export function formatCollectorWithDesignation(entry = {}) {
  const disp = resolveUserDisplay(entry.recordedBy, entry.recordedByName, entry.recordedByDesignation);
  const name = disp.name && disp.name !== '-' ? disp.name : '';
  if (!name) return '';
  return disp.designation ? `${name} (${disp.designation})` : name;
}

export function formatShortReceipt(receiptNo) {
  const raw = String(receiptNo || '').trim();
  if (!raw || raw === '-' || raw === '—' || raw === 'WAIVER') return '';
  const parts = raw.split('-').filter(Boolean);
  const tail = (parts.length ? parts[parts.length - 1] : raw).replace(/^#/, '');
  return tail ? `#${tail}` : '';
}

export function modeDisplayMeta(entry = {}) {
  const raw = String(entry.mode || 'cash').toLowerCase().trim();
  if (entry.isPureWaiver || raw === 'waiver' || raw === 'waived') return MODE_META.waiver;
  return MODE_META[raw] || { label: toTitleCaseIfCaps(raw) || 'Cash', cls: 'cash', icon: 'banknote' };
}

function formatTimePartsIST(sec) {
  if (!sec || !Number.isFinite(Number(sec)) || Number(sec) <= 0) return null;
  const d = new Date(Number(sec) * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const tz = getOrgTimezone();
  const isoParts = {};
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d)
      .forEach((p) => { isoParts[p.type] = p.value; });
  } catch (_) { }
  const isoDate = isoParts.year && isoParts.month && isoParts.day
    ? `${isoParts.year}-${isoParts.month}-${isoParts.day}`
    : '';
  const timeStr = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(d).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  const dateStr = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(d);
  return { isoDate, dateTime: `${dateStr}, ${timeStr} IST` };
}

function fmtPlainRs(val) {
  return `Rs ${Number(val || 0).toLocaleString('en-IN')}`;
}

/**
 * Pure view-model + plain-text clipboard formatter for Payment Details popup.
 * Omits empty fields so UI and copied text stay clean for Cash, UPI, Waived, Youth, and Kids.
 */
export function buildPaymentDetailsModel(entry = {}, { sessionsById = {}, bill = null } = {}) {
  const mMeta = modeDisplayMeta(entry);
  const collector = formatCollectorWithDesignation(entry) || formatCollectorName(entry.recordedByName, entry.recordedBy, entry.recordedByDesignation);
  const courseCode = String(entry.courseCode || '').trim();
  const courseFullName = String(entry.courseName || '').trim();
  const courseDisplay = [courseCode, courseFullName].filter(Boolean).join(' - ');
  const branchCode = String(entry.branchCode || '').trim();
  const branchFullName = toTitleCaseIfCaps(entry.branchName || '');
  const branchDisplay = [branchCode, branchFullName].filter(Boolean).join(' - ');
  const sessionName = String(entry.sessionName || (entry.sessionId && sessionsById[entry.sessionId]?.name) || '').trim();

  const totalRecv = Number(entry.totalReceived || 0);
  const feeAmt = Number(entry.amount || 0);
  const latePaid = Number(entry.lateFeePaid || 0);
  const lateWaived = Number(entry.lateFeeWaived || 0);
  const isWaivedStatus = Boolean(entry.isPureWaiver || (totalRecv === 0 && lateWaived > 0));
  const isPartial = Boolean(!isWaivedStatus && (entry.isPartial || bill?.status === 'partial'));
  const status = isWaivedStatus
    ? { label: 'Waived', cls: 'waived' }
    : (isPartial ? { label: 'Partial', cls: 'partial' } : { label: 'Paid', cls: 'paid' });

  const tsInfo = formatTimePartsIST(entry.createdAtSec);
  const rawDate = String(entry.date || '').slice(0, 10);
  const dateDisplay = rawDate ? fmtDate(rawDate) : '-';
  let paymentDateTime = dateDisplay;
  let recordedAt = '';
  if (tsInfo) {
    if (!rawDate || !tsInfo.isoDate || tsInfo.isoDate === rawDate) {
      paymentDateTime = tsInfo.dateTime;
    } else {
      paymentDateTime = dateDisplay;
      recordedAt = tsInfo.dateTime;
    }
  }

  const basePaymentFor = entry.typeLabel || entry.type || '-';
  const hasMultiBreakdown = Array.isArray(entry.breakdown) && entry.breakdown.length > 1;
  const breakdownItems = hasMultiBreakdown
    ? entry.breakdown.map((b) => ({
      label: b.label || b.type || 'Item',
      value: formatINR(b.amount || 0),
      plainValue: fmtPlainRs(b.amount || 0)
    }))
    : [];

  const dueDateDisplay = entry.dueDate ? fmtDate(entry.dueDate) : '';
  const billPeriodDisplay = String(entry.billPeriod || entry.month || '').trim();
  const waivedReason = String(entry.waiverReason || '').trim();
  const waivedDisplay = lateWaived > 0
    ? `${formatINR(lateWaived)}${waivedReason ? ' — ' + waivedReason : ''}`
    : (entry.isPureWaiver && waivedReason ? waivedReason : '');

  const studentDisplayName = formatPersonName(entry.studentName || '') || entry.studentName || '';
  const studentFields = [
    { label: 'Name', value: studentDisplayName },
    { label: 'Student ID', value: entry.studentId || '' },
    { label: 'Phone', value: entry.phone || '' },
    { label: entry.ctx === 'school' ? 'Level / Course' : 'Course', value: courseDisplay },
    { label: 'Branch', value: branchDisplay },
    { label: 'Batch', value: entry.batchName || '' },
    { label: 'Session', value: sessionName }
  ].filter((f) => Boolean(f.value));

  const paymentFields = [
    { label: 'Payment for', value: basePaymentFor },
    breakdownItems.length
      ? {
        label: 'Breakdown',
        value: breakdownItems.map((b) => `${b.label}: ${b.value}`).join(' + '),
        items: breakdownItems
      }
      : null,
    { label: 'Bill period', value: entry.ctx === 'school' ? billPeriodDisplay : '' },
    { label: 'Installment due date', value: dueDateDisplay },
    { label: 'Fee amount', value: (!entry.isPureWaiver || feeAmt > 0) ? formatINR(feeAmt) : '' },
    { label: 'Late fee', value: latePaid > 0 ? formatINR(latePaid) : '' },
    { label: 'Waived amount', value: waivedDisplay },
    { label: 'Amount received', value: formatINR(totalRecv), highlight: true }
  ].filter((f) => f && Boolean(f.value));

  const txnRef = String(entry.txnId || '').trim();
  const transactionFields = [
    { label: 'Mode', value: mMeta.label },
    { label: 'Transaction ID', value: txnRef, mono: true },
    { label: 'Payment date', value: paymentDateTime },
    { label: 'Collected by', value: collector },
    { label: 'Recorded at', value: recordedAt }
  ].filter((f) => Boolean(f.value));

  const remarksText = String(entry.remarks || '').trim() || 'No remarks';
  const fullReceipt = String(entry.receiptNo || '').trim();

  const copyLines = [];
  if (fullReceipt) copyLines.push(`Receipt: ${fullReceipt}`);
  copyLines.push(`Status: ${status.label}`);
  if (studentDisplayName) {
    copyLines.push(`Student: ${studentDisplayName}${entry.studentId ? ' (' + entry.studentId + ')' : ''}`);
  }
  if (entry.phone) copyLines.push(`Phone: ${entry.phone}`);
  if (courseDisplay) copyLines.push(`Course: ${courseDisplay}`);
  if (branchDisplay) copyLines.push(`Branch: ${branchDisplay}`);
  if (entry.batchName) copyLines.push(`Batch: ${entry.batchName}`);
  if (sessionName) copyLines.push(`Session: ${sessionName}`);
  copyLines.push(`Payment for: ${basePaymentFor}`);
  if (breakdownItems.length) {
    copyLines.push(`Breakdown: ${breakdownItems.map((b) => `${b.label} (${b.plainValue})`).join(' + ')}`);
  }
  if (entry.ctx === 'school' && billPeriodDisplay) copyLines.push(`Bill period: ${billPeriodDisplay}`);
  if (dueDateDisplay) copyLines.push(`Due date: ${dueDateDisplay}`);

  const feeSummaryParts = [
    `Fee: ${fmtPlainRs(feeAmt)}`,
    `Late fee: ${fmtPlainRs(latePaid)}`
  ];
  if (lateWaived > 0) feeSummaryParts.push(`Waived: ${fmtPlainRs(lateWaived)}`);
  feeSummaryParts.push(`Received: ${fmtPlainRs(totalRecv)}`);
  copyLines.push(feeSummaryParts.join(' | '));
  if (waivedReason && lateWaived > 0) copyLines.push(`Waiver reason: ${waivedReason}`);

  const modeCopy = txnRef ? `Mode: ${mMeta.label} | Txn ID: ${txnRef}` : `Mode: ${mMeta.label}`;
  copyLines.push(modeCopy);
  copyLines.push(`Date: ${paymentDateTime}`);
  if (recordedAt) copyLines.push(`Recorded at: ${recordedAt}`);
  if (collector) copyLines.push(`Collected by: ${collector}`);
  copyLines.push(`Remarks: ${remarksText}`);

  return {
    receiptId: fullReceipt || 'Waiver',
    status,
    studentFields,
    paymentFields,
    transactionFields,
    remarksText,
    copyText: copyLines.join('\n')
  };
}

/**
 * Pure view-model + plain-text clipboard formatter for the Pending & Overdue "View details" modal.
 * Includes full student info, summary totals, and every overdue installment/bill for that student.
 */
export function buildOverdueDetailsModel(item = {}, studentItems = [], { sessionsById = {} } = {}) {
  const isSchool = item.ctx === 'school' || item.org === 'school';
  const studentDisplay = toTitleCaseIfCaps(item.studentName || '-') || '-';
  const courseCode = String(item.courseCode || '').trim();
  const courseFullName = String(item.courseName || '').trim();
  const courseDisplay = [courseCode, courseFullName].filter(Boolean).join(' - ');
  const branchCode = String(item.branchCode || '').trim();
  const branchFullName = toTitleCaseIfCaps(item.branchName || '');
  const branchDisplay = [branchCode, branchFullName].filter(Boolean).join(' - ');
  const sessionName = isSchool
    ? ''
    : String(item.sessionName || (item.sessionId && sessionsById[item.sessionId]?.name) || '').trim();

  const sourceList = (Array.isArray(studentItems) && studentItems.length ? studentItems : [item])
    .filter((it) => it && Number(it.amount || 0) > 0)
    .slice()
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || Number(a.installmentNo || 0) - Number(b.installmentNo || 0));

  let sumFee = 0;
  let sumLate = 0;
  let sumTotal = 0;
  let maxDays = 0;

  const installments = sourceList.map((row) => {
    const fee = Number(row.amount || 0);
    const late = Number(row.lateFee || 0);
    const total = Number(row.totalPayable != null ? row.totalPayable : (fee + late));
    const days = Number(row.daysLate || 0);
    sumFee += fee;
    sumLate += late;
    sumTotal += total;
    if (days > maxDays) maxDays = days;

    const label = row.kind === 'IN' && row.installmentNo
      ? `Installment ${row.installmentNo}`
      : (row.kind === 'EX'
        ? 'Examination Fee'
        : (row.monthLabel ? `${row.monthLabel} bill` : (row.whatIsDue || 'Monthly bill')));
    const dueDateFormatted = row.dueDate ? fmtDate(row.dueDate) : '-';
    const daysLateText = `${days} ${days === 1 ? 'day' : 'days'} late`;
    const isSelected = Boolean(
      row.kind === item.kind &&
      row.dueDate === item.dueDate &&
      Number(row.installmentNo || 0) === Number(item.installmentNo || 0) &&
      (row.billId || '') === (item.billId || '')
    );

    return {
      label,
      dueDateFormatted,
      days,
      daysLateText,
      fee,
      lateFee: late,
      total,
      feeText: formatINR(fee),
      lateFeeText: late > 0 ? formatINR(late) : '—',
      totalText: formatINR(total),
      feePlain: fmtPlainRs(fee),
      lateFeePlain: fmtPlainRs(late),
      totalPlain: fmtPlainRs(total),
      isSelected
    };
  });

  const primaryPhone = String(item.phone || item.student?.phone || '').trim();
  const altPhone = String(item.altPhone || item.student?.altPhone || '').trim();
  const phonesDisplay = [primaryPhone, altPhone && altPhone !== primaryPhone ? altPhone : '']
    .filter(Boolean)
    .join(', ');

  const studentFields = [
    { label: 'Name', value: studentDisplay },
    { label: 'Student ID', value: item.studentId || '' },
    { label: 'Phone', value: phonesDisplay },
    { label: isSchool ? 'Level' : 'Course', value: courseDisplay },
    { label: 'Branch', value: branchDisplay },
    { label: 'Batch', value: item.batchName || '' },
    { label: 'Session', value: sessionName }
  ].filter((f) => Boolean(f.value));

  const earliestDue = sourceList[0]?.dueDate ? fmtDate(sourceList[0].dueDate) : '';
  const summaryFields = [
    { label: isSchool ? 'Overdue bills' : 'Overdue installments', value: String(installments.length) },
    { label: 'Fee due', value: formatINR(sumFee) },
    { label: 'Late fees', value: sumLate > 0 ? formatINR(sumLate) : formatINR(0) },
    { label: 'Total overdue due', value: formatINR(sumTotal), highlight: true, danger: true },
    { label: 'Earliest due date', value: earliestDue ? `${earliestDue} (${maxDays} ${maxDays === 1 ? 'day' : 'days'} late)` : '' }
  ].filter((f) => Boolean(f.value));

  const copyLines = [];
  copyLines.push(`Student: ${studentDisplay}${item.studentId ? ' (' + item.studentId + ')' : ''}`);
  if (phonesDisplay) copyLines.push(`Phone: ${phonesDisplay}`);
  if (courseDisplay) copyLines.push(`${isSchool ? 'Level' : 'Course'}: ${courseDisplay}`);
  if (branchDisplay) copyLines.push(`Branch: ${branchDisplay}`);
  if (item.batchName) copyLines.push(`Batch: ${item.batchName}`);
  if (sessionName) copyLines.push(`Session: ${sessionName}`);
  copyLines.push('');
  copyLines.push(`${isSchool ? 'Overdue Bills' : 'Overdue Installments'} (${installments.length}):`);
  installments.forEach((inst) => {
    copyLines.push(
      `- ${inst.label} | Due: ${inst.dueDateFormatted} | ${inst.daysLateText} | Fee: ${inst.feePlain} | Late fee: ${inst.lateFeePlain} | Total: ${inst.totalPlain}`
    );
  });
  copyLines.push(`Total Fee: ${fmtPlainRs(sumFee)} | Total Late Fee: ${fmtPlainRs(sumLate)} | Total Due: ${fmtPlainRs(sumTotal)}`);

  return {
    title: 'Overdue Details',
    subtitle: `${studentDisplay}${item.studentId ? ' · ' + item.studentId : ''}`,
    status: { label: 'Overdue', cls: 'overdue' },
    studentFields,
    summaryFields,
    installments,
    grandTotal: {
      feeText: formatINR(sumFee),
      lateFeeText: sumLate > 0 ? formatINR(sumLate) : '—',
      totalText: formatINR(sumTotal)
    },
    isSchool,
    copyText: copyLines.join('\n')
  };
}

/**
 * Display format for Payment History screen & mobile card view:
 * - Course code (or full course name if course has no code)
 * - Branch code from branch record (or readable branch name if branch has no code)
 * - Tooltip: 2 lines containing full Course Name and Title Case Branch Name
 */
export function formatCourseBranchDisplay(item = {}) {
  const courseCode = String(item.courseCode || '').trim();
  const courseFull = String(item.courseName || courseCode || '').trim();
  const branchCode = String(item.branchCode || '').trim();
  const branchFull = toTitleCaseIfCaps(item.branchName || branchCode || '');

  const courseLabel = courseCode || courseFull;
  const branchLabel = branchCode || branchFull;
  const hasBranchCode = Boolean(branchCode);
  const text = [courseLabel, branchLabel].filter(Boolean).join(' - ') || '-';
  const tooltip = [courseFull, branchFull].filter(Boolean).join('\n') || '-';
  return { courseLabel, branchLabel, hasBranchCode, text, tooltip };
}

/**
 * Full human-readable format for CSV & Print exports (readable without hover).
 */
export function formatCourseAndBranch(item = {}) {
  const courseFull = String(item.courseName || item.courseCode || '').trim();
  const branchFull = toTitleCaseIfCaps(item.branchName || item.branchCode || '');
  return [courseFull, branchFull].filter(Boolean).join(' - ') || '-';
}

function enrichLedgerEntry(entry, meta, student = {}) {
  const email = String(entry.recordedBy || entry.collectedBy || '').trim().toLowerCase();
  const usr = email ? meta.usersByEmail[email] : null;
  const br = meta.branchesById[entry.branchId || student?.branchId] || {};
  const ctxVal = entry.ctx === 'school' ? 'school' : 'youth';
  const cr = meta.coursesById[entry.courseId || student?.courseId]
    || findCourseByName(meta.coursesById, entry.courseName || student?.courseName, ctxVal)
    || {};
  const bt = meta.batchesById[student?.batchId] || {};
  const orgLabel = ctxVal === 'school' ? 'Unique Kids' : 'Youth Centre';
  const disp = resolveUserDisplay(email, entry.recordedByName || (usr && usr.name), entry.recordedByDesignation || (usr && usr.designation));
  const collectorName = disp.name && disp.name !== '-' ? disp.name : ((usr && usr.name) || entry.recordedByName || entry.recordedBy || '-');
  const collectorDesig = disp.designation || (usr && usr.designation) || entry.recordedByDesignation || '';
  const rowKey = entry.rowKey || `${ctxVal}:${entry.id || entry.receiptNo || '-'}:${entry.studentDocId || ''}`;
  const courseCode = String(cr.courseCode || cr.code || entry.courseCode || student?.courseCode || '').trim();
  const courseName = entry.courseName || student?.courseName || cr.name || '';
  const branchCode = String(br.code || br.branchCode || br.shortCode || entry.branchCode || student?.branchCode || (ctxVal === 'school' ? 'HO' : '')).trim();
  const branchName = entry.branchName || student?.branchName || br.name || (ctxVal === 'school' ? 'Head Office' : '');

  const collectedByRole = String(entry.collectedByRole || entry.recordedByRole || (usr && usr.role) || '').toLowerCase().trim();
  const homeBr = meta.branchesById[entry.homeBranchId || student?.branchId] || br;
  const homeBranchId = entry.homeBranchId || student?.branchId || (ctxVal === 'school' ? 'HO' : '');
  const homeBranchCode = String(entry.homeBranchCode || homeBr.code || homeBr.branchCode || student?.branchCode || (ctxVal === 'school' ? 'HO' : '')).trim();
  const homeBranchName = toTitleCaseIfCaps(entry.homeBranchName || student?.branchName || homeBr.name || (ctxVal === 'school' ? 'Head Office' : '')) || '';

  const isHoCollection = ctxVal === 'school'
    || entry.collectedAtType === 'head_office'
    || String(entry.collectedAtBranchId || '').toUpperCase() === 'HO'
    || (!entry.collectedAtType && !entry.recordedAtBranchId && !entry.paidAt && collectedByRole === 'superadmin');
  const collectedAtType = isHoCollection ? 'head_office' : 'branch';
  const collectedAtBranchId = isHoCollection ? 'HO' : (entry.collectedAtBranchId || entry.branchId || student?.branchId || '');
  const colBr = isHoCollection ? {} : (meta.branchesById[collectedAtBranchId] || br);
  const collectedAtBranchCode = isHoCollection
    ? 'HO'
    : String(entry.collectedAtBranchCode || colBr.code || colBr.branchCode || branchCode || '').trim();
  const collectedAtBranchName = isHoCollection
    ? 'Head Office'
    : (toTitleCaseIfCaps(entry.collectedAtBranchName || colBr.name || branchName || '') || collectedAtBranchId || 'Branch');
  const collectedAtKey = isHoCollection ? 'HO' : (collectedAtBranchId || 'UNKNOWN');
  const collectedAtShort = isHoCollection ? 'HO' : (collectedAtBranchCode || collectedAtBranchName);
  const collectedAtLabel = isHoCollection
    ? 'Head Office (HO)'
    : [collectedAtBranchCode, collectedAtBranchName].filter(Boolean).join(' - ');
  const isCrossBranch = Boolean(homeBranchId && collectedAtBranchId && !isHoCollection && homeBranchId !== collectedAtBranchId);

  return {
    ...entry,
    rowKey,
    ctx: ctxVal,
    org: ctxVal,
    orgLabel,
    sessionId: entry.sessionId || student?.sessionId || '',
    branchId: entry.branchId || student?.branchId || '',
    branchCode,
    branchName,
    homeBranchId,
    homeBranchCode,
    homeBranchName,
    collectedByRole,
    collectedAtType,
    collectedAtBranchId,
    collectedAtBranchCode,
    collectedAtBranchName,
    collectedAtKey,
    collectedAtShort,
    collectedAtLabel,
    isCrossBranch,
    courseId: entry.courseId || student?.courseId || '',
    courseCode,
    courseName,
    batchId: student?.batchId || '',
    batchName: student?.batchName || bt.name || '',
    phone: entry.phone || student?.phone || '',
    recordedBy: email,
    recordedByName: collectorName,
    recordedByDesignation: collectorDesig,
    collectedByName: collectorName,
    searchBlob: [
      entry.receiptNo,
      entry.studentName,
      entry.studentId,
      entry.phone,
      entry.txnId,
      entry.typeLabel,
      entry.remarks,
      entry.waiverReason,
      email,
      collectorName,
      collectedAtLabel,
      collectedAtBranchCode,
      courseCode,
      courseName,
      branchCode,
      branchName,
      student?.batchName,
      bt?.name
    ].filter(Boolean).join(' ').toLowerCase()
  };
}

export function summarizePaymentLedger(entries = []) {
  let totalCollected = 0;
  let cashTotal = 0;
  let cashCount = 0;
  let upiTotal = 0;
  let upiCount = 0;
  let bankTotal = 0;
  let bankCount = 0;
  let lateFeesCollected = 0;
  let lateFeesWaived = 0;
  let moneyReceipts = 0;
  let waiverCount = 0;

  const byType = {
    ADMISSION: { label: 'Admission', count: 0, amount: 0 },
    FULL: { label: 'Full Course', count: 0, amount: 0 },
    MAT: { label: 'Material', count: 0, amount: 0 },
    IN: { label: 'Installments', count: 0, amount: 0 },
    EX: { label: 'Exam Fee', count: 0, amount: 0 },
    KIDS_MONTHLY: { label: 'Kids Monthly', count: 0, amount: 0 }
  };

  for (const e of entries) {
    lateFeesWaived += Number(e.lateFeeWaived || 0);
    if (e.isPureWaiver || e.type === 'WA') {
      waiverCount += 1;
      continue;
    }
    const amt = Number(e.totalReceived || 0);
    const lfPaid = Number(e.lateFeePaid || 0);
    totalCollected += amt;
    lateFeesCollected += lfPaid;
    moneyReceipts += 1;

    const mode = String(e.mode || '').toLowerCase();
    if (mode === 'upi') {
      upiTotal += amt;
      upiCount += 1;
    } else if (mode === 'bank' || mode === 'bank_transfer') {
      bankTotal += amt;
      bankCount += 1;
    } else {
      cashTotal += amt;
      cashCount += 1;
    }

    if (e.isAdmissionGroup && Array.isArray(e.breakdown) && e.breakdown.length) {
      let hasFull = false;
      let hasAd = false;
      for (const b of e.breakdown) {
        const bCode = String(b.type || '').toUpperCase();
        const bAmt = Number(b.amount || 0);
        if (bCode === 'FULL') {
          hasFull = true;
          byType.FULL.amount += bAmt;
        } else if (bCode === 'MAT') {
          byType.MAT.amount += bAmt;
          byType.MAT.count += 1;
        } else {
          hasAd = true;
          byType.ADMISSION.amount += bAmt;
        }
      }
      if (hasFull) byType.FULL.count += 1;
      else if (hasAd) byType.ADMISSION.count += 1;
    } else {
      const code = String(e.type || '').toUpperCase();
      const mappedKey = code === 'AD' ? 'ADMISSION' : (byType[code] ? code : 'IN');
      byType[mappedKey].count += 1;
      byType[mappedKey].amount += amt;
    }
  }

  return {
    totalCollected,
    cashTotal,
    cashCount,
    upiTotal,
    upiCount,
    bankTotal,
    bankCount,
    lateFeesCollected,
    lateFeesWaived,
    moneyReceipts,
    waiverCount,
    byType
  };
}

function escapeCsvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function downloadCsv(filename, headers = [], rows = []) {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(','));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function escHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Opens a clean print-formatted window for Overdue Report, Daily Cash Report,
 * or full multi-section Reports (with Org header, filters, generatedBy, and inline SVG charts).
 */
export function openPrintSheet({
  title = 'Report',
  subtitle = '',
  org = null,
  filtersText = '',
  generatedBy = '',
  summaryPairs = [],
  columns = [],
  rows = [],
  sections = null,
  footerNote = ''
} = {}) {
  const win = window.open('', '_blank', 'width=1120,height=780');
  if (!win) return false;

  const tz = getOrgTimezone();
  const generatedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date());

  const brandName = (org && org.orgName) || title;
  const brandTagline = (org && org.tagline) || '';
  const contactBits = [];
  if (org && Array.isArray(org.phones) && org.phones.length) contactBits.push(org.phones.join(' / '));
  if (org && org.email) contactBits.push(org.email);
  if (org && org.address) contactBits.push(org.address);

  const summaryHtml = summaryPairs.length
    ? `<div class="pr-summary">${summaryPairs.map((p) => (
      `<div class="pr-box"><div class="pr-k">${escHtml(p.label)}</div><div class="pr-v">${escHtml(p.value)}</div>${p.sub ? `<div class="pr-s">${escHtml(p.sub)}</div>` : ''}</div>`
    )).join('')}</div>`
    : '';

  const renderTblHtml = (cols = [], rws = []) => {
    const thHtml = cols.map((c) => `<th class="${c.num ? 'num' : ''}">${escHtml(c.label)}</th>`).join('');
    const bodyHtml = rws.map((r) => (
      `<tr>${r.map((cell, idx) => `<td class="${cols[idx]?.num ? 'num' : ''}">${escHtml(cell)}</td>`).join('')}</tr>`
    )).join('');
    return `<table><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml || `<tr><td colspan="${Math.max(1, cols.length)}" style="text-align:center;padding:14px;color:#64748B;">No records</td></tr>`}</tbody></table>`;
  };

  let contentHtml = '';
  if (Array.isArray(sections) && sections.length) {
    contentHtml = sections.map((sec) => {
      const charts = Array.isArray(sec.chartsHtml) && sec.chartsHtml.length
        ? `<div class="pr-charts-grid">${sec.chartsHtml.map((ch) => `<div class="pr-chart-box">${ch}</div>`).join('')}</div>`
        : '';
      const tbl = sec.columns && sec.columns.length ? renderTblHtml(sec.columns, sec.rows || []) : '';
      const subTables = Array.isArray(sec.tables)
        ? sec.tables.map((t) => `<h4 class="pr-sub-h">${escHtml(t.title || '')}</h4>${renderTblHtml(t.columns || [], t.rows || [])}`).join('')
        : '';
      return `<section class="pr-sec"><h3 class="pr-sec-title">${escHtml(sec.title || '')}</h3>${sec.note ? `<div class="pr-sec-note">${escHtml(sec.note)}</div>` : ''}${charts}${tbl}${subTables}</section>`;
    }).join('');
  } else {
    contentHtml = renderTblHtml(columns, rows);
  }

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; }
  body { margin: 22px; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #171717; background: #FFFFFF; font-size: 11.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .pr-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #323A85; padding-bottom: 12px; margin-bottom: 12px; gap: 16px; }
  .pr-brand { font-size: 18px; font-weight: 800; color: #323A85; letter-spacing: -0.01em; }
  .pr-title { font-size: 13.5px; font-weight: 700; color: #171717; margin-top: 2px; }
  .pr-sub { font-size: 11.5px; color: #525252; margin-top: 2px; }
  .pr-contact { font-size: 10.5px; color: #6B6B6B; margin-top: 4px; }
  .pr-meta { text-align: right; font-size: 10.5px; color: #525252; line-height: 1.55; flex-shrink: 0; }
  .pr-filters { background: #EEF0FA; border: 1px solid #D8DDF2; border-radius: 6px; padding: 7px 11px; margin-bottom: 14px; font-size: 11px; color: #262E70; font-weight: 600; }
  .pr-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 9px; margin-bottom: 16px; }
  .pr-box { border: 1px solid #EAEAEA; border-radius: 8px; padding: 9px 11px; background: #F6F6F8; break-inside: avoid; }
  .pr-k { font-size: 9.5px; font-weight: 800; text-transform: uppercase; color: #6B6B6B; letter-spacing: .05em; }
  .pr-v { font-size: 14.5px; font-weight: 800; color: #171717; margin-top: 3px; font-variant-numeric: tabular-nums; }
  .pr-s { font-size: 10px; color: #525252; margin-top: 2px; }
  .pr-sec { margin-top: 16px; break-inside: avoid; page-break-inside: avoid; }
  .pr-sec-title { margin: 0 0 6px; font-size: 13px; font-weight: 800; color: #323A85; border-bottom: 1px solid #EAEAEA; padding-bottom: 4px; }
  .pr-sec-note { font-size: 11px; color: #525252; margin-bottom: 8px; }
  .pr-sub-h { margin: 10px 0 4px; font-size: 11.5px; font-weight: 700; color: #171717; }
  .pr-charts-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 8px 0 10px; }
  .pr-chart-box { border: 1px solid #EAEAEA; border-radius: 8px; padding: 10px; background: #FFFFFF; break-inside: avoid; page-break-inside: avoid; }
  .pr-chart-title { font-size: 11px; font-weight: 700; color: #374151; margin-bottom: 6px; }
  .uich-wrap { position: relative; }
  .uich-donut-wrap { display: flex; align-items: center; gap: 14px; flex-wrap: nowrap; }
  .uich-donut-svg { width: 150px; height: 150px; flex-shrink: 0; }
  .uich-svg { max-width: 100%; max-height: 220px; height: auto; display: block; }
  .uich-legend { list-style: none; margin: 0; padding: 0; flex: 1; font-size: 10.5px; }
  .uich-legend-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 6px; }
  .uich-leg-item { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .uich-leg-dot { width: 9px; height: 9px; border-radius: 0; flex-shrink: 0; display: inline-block; }
  .uich-leg-label { color: #374151; font-weight: 600; flex: 1; }
  .uich-leg-val { color: #171717; font-weight: 700; font-variant-numeric: tabular-nums; margin-left: 6px; }
  .uich-tooltip { display: none !important; }
  .uich-empty { padding: 10px 14px; display: flex; align-items: center; justify-content: center; gap: 6px; color: #6B7280; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #EAEAEA; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #EEF0FA; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #323A85; }
  tbody tr:nth-child(even) td { background: #FAFAFC; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pr-foot { margin-top: 16px; padding-top: 10px; border-top: 1px solid #EAEAEA; font-size: 10.5px; color: #6B6B6B; display: flex; justify-content: space-between; }
  @media print {
    body { margin: 10px; }
    .no-print { display: none; }
    svg { break-inside: avoid; page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="pr-head">
    <div>
      <div class="pr-brand">${escHtml(brandName)}</div>
      ${org ? `<div class="pr-title">${escHtml(title)}</div>` : ''}
      ${brandTagline ? `<div class="pr-sub">${escHtml(brandTagline)}</div>` : ''}
      ${subtitle ? `<div class="pr-sub">${escHtml(subtitle)}</div>` : ''}
      ${contactBits.length ? `<div class="pr-contact">${escHtml(contactBits.join(' · '))}</div>` : ''}
    </div>
    <div class="pr-meta">
      <div><strong>Generated:</strong> ${escHtml(generatedAt)} (${escHtml(tz)})</div>
      ${generatedBy ? `<div><strong>Generated by:</strong> ${escHtml(generatedBy)}</div>` : `<div>Report date: ${escHtml(fmtDate(todayISO()))}</div>`}
    </div>
  </div>
  ${filtersText ? `<div class="pr-filters">Filters: ${escHtml(filtersText)}</div>` : ''}
  ${summaryHtml}
  ${contentHtml}
  <div class="pr-foot">
    <span>${escHtml(footerNote || brandName || 'Unique Infotech CMS')}</span>
    <span>${Array.isArray(sections) ? `${sections.length} sections` : `Rows: ${rows.length}`}</span>
  </div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 260));</script>
</body>
</html>`);
  win.document.close();
  return true;
}

/**
 * Filters reference metadata strictly to the active programme ('youth' or 'school')
 * so dropdowns never mix Youth branches/courses/batches with Unique Kids levels/batches.
 */
export function scopeReferenceDataByCtx(meta = {}, ctx = 'youth') {
  const isSchool = ctx === 'school';
  const branchesList = isSchool
    ? []
    : (meta.branchesList || []).filter((b) => !b.ctx || b.ctx === 'youth');
  const coursesList = (meta.coursesList || []).filter((c) => (
    isSchool ? c.ctx === 'school' : (c.ctx || 'youth') === 'youth'
  ));
  const batchesList = (meta.batchesList || []).filter((b) => (
    isSchool ? b.ctx === 'school' : (b.ctx || 'youth') === 'youth'
  ));
  const toMap = (arr) => {
    const out = {};
    arr.forEach((item) => { if (item?.id) out[item.id] = item; });
    return out;
  };
  return {
    branchesList,
    branchesById: toMap(branchesList),
    coursesList,
    coursesById: toMap(coursesList),
    batchesList,
    batchesById: toMap(batchesList)
  };
}

export function getPaymentDatePresetOptions(ctx = 'youth', { includeSingle = false } = {}) {
  const isSchool = ctx === 'school';
  const opts = [
    { value: 'all', label: 'All dates (recent)', icon: 'calendar' },
    { value: 'today', label: 'Today', icon: 'calendar-check' },
    { value: 'week', label: 'This week', icon: 'calendar-days' },
    { value: 'month', label: 'This month', icon: 'calendar-range' }
  ];
  if (includeSingle) {
    opts.push({ value: 'single', label: 'Single date', icon: 'calendar-search' });
  }
  if (!isSchool) {
    opts.push({ value: 'session', label: 'Active session window', icon: 'calendar-clock' });
  }
  opts.push({ value: 'custom', label: 'Custom range', icon: 'sliders-horizontal' });
  return opts;
}

export function getPaymentTypeFilterOptions(ctx = 'youth') {
  if (ctx === 'school') {
    return [
      { value: 'all', label: 'All types', icon: 'list-filter' },
      { value: 'ADMISSION', label: 'Admission fee', icon: 'user-check' },
      { value: 'KIDS_MONTHLY', label: 'Monthly fee', icon: 'calendar-check' },
      { value: 'WA', label: 'Waivers only', icon: 'shield-off' }
    ];
  }
  return [
    { value: 'all', label: 'All types', icon: 'list-filter' },
    { value: 'ADMISSION', label: 'Admission / Full', icon: 'user-check' },
    { value: 'IN', label: 'Installments', icon: 'wallet' },
    { value: 'EX', label: 'Exam fee', icon: 'file-text' }
  ];
}

export function getPaymentModeFilterOptions(ctx = 'youth') {
  if (ctx === 'school') {
    return [
      { value: 'all', label: 'All modes', icon: 'credit-card' },
      { value: 'cash', label: 'Cash', icon: 'banknote' },
      { value: 'upi', label: 'UPI', icon: 'smartphone' },
      { value: 'bank', label: 'Bank transfer', icon: 'landmark' },
      { value: 'waiver', label: 'Waiver only', icon: 'shield-off' }
    ];
  }
  return [
    { value: 'all', label: 'All modes', icon: 'credit-card' },
    { value: 'cash', label: 'Cash', icon: 'banknote' },
    { value: 'upi', label: 'UPI', icon: 'smartphone' },
    { value: 'card', label: 'Card', icon: 'credit-card' },
    { value: 'bank', label: 'Bank transfer', icon: 'landmark' },
    { value: 'cheque', label: 'Cheque', icon: 'file-text' }
  ];
}

export function getPaymentChipOrder(ctx = 'youth') {
  return ctx === 'school'
    ? ['ADMISSION', 'KIDS_MONTHLY']
    : ['ADMISSION', 'FULL', 'MAT', 'IN', 'EX'];
}

/**
 * Computes grouped financial report aggregates (Collected At, Collected By, Payment Mode,
 * Branch Settlement separating physical branch-head cash from Super Admin/HO collections,
 * Course/Level totals + overdue, Fine Waivers audit, and Daily Collection trend).
 */
export function buildFinancialReportAggregates(
  entries = [],
  { branchesList = [], coursesList = [], pendingItems = [], usersByEmail = {}, ctx = 'youth' } = {}
) {
  const summary = summarizePaymentLedger(entries);
  let fineReceiptCount = 0;
  let totalFeesBase = 0;

  const uniquePayers = new Set();
  const locMap = new Map();
  const collectorMap = new Map();
  const modeMap = new Map();
  const courseMap = new Map();
  const dailyMap = new Map();
  const settlementMap = new Map();
  const waivers = [];

  const ensureSettlementRow = (bId, code = '', name = '') => {
    const key = bId || 'UNKNOWN';
    if (!settlementMap.has(key)) {
      settlementMap.set(key, {
        branchId: key,
        branchCode: code,
        branchName: toTitleCaseIfCaps(name || code || key),
        homeReceipts: 0,
        homeCollected: 0,
        bhCash: 0,
        bhCashCount: 0,
        bhDigital: 0,
        bhDigitalCount: 0,
        bhTotal: 0,
        bhCount: 0,
        superAdminCash: 0,
        superAdminDigital: 0,
        superAdminTotal: 0,
        superAdminCount: 0,
        crossBranchCashHere: 0,
        crossBranchHereCount: 0,
        cashHandoverDue: 0,
        pendingStudents: new Set(),
        pendingAmount: 0,
        pendingLateFee: 0,
        entries: []
      });
    }
    return settlementMap.get(key);
  };

  for (const br of (branchesList || [])) {
    if (!br || !br.id || (ctx === 'youth' && br.ctx && br.ctx !== 'youth')) continue;
    ensureSettlementRow(br.id, br.code || br.branchCode || '', br.name || br.id);
  }

  for (const cs of (coursesList || [])) {
    if (!cs || !cs.id) continue;
    courseMap.set(cs.id, {
      courseId: cs.id,
      courseCode: String(cs.courseCode || cs.code || '').trim(),
      courseName: cs.name || cs.id,
      payers: new Set(),
      receipts: 0,
      baseCollected: 0,
      lateCollected: 0,
      waivedAmount: 0,
      totalCollected: 0,
      overdueStudents: new Set(),
      overdueDue: 0
    });
  }

  for (const e of (entries || [])) {
    if (!e) continue;
    const isWaiverOnly = Boolean(e.isPureWaiver || e.type === 'WA');
    const amt = isWaiverOnly ? 0 : Number(e.totalReceived || 0);
    const lfPaid = isWaiverOnly ? 0 : Number(e.lateFeePaid || 0);
    const lfWaived = Number(e.lateFeeWaived || 0);
    const baseAmt = isWaiverOnly ? 0 : Math.max(0, amt - lfPaid);
    const mMeta = modeDisplayMeta(e);
    const modeLower = String(e.mode || 'cash').toLowerCase().trim();
    const isCash = !isWaiverOnly && (modeLower === 'cash' || !modeLower);

    if (!isWaiverOnly) {
      totalFeesBase += baseAmt;
      if (lfPaid > 0) fineReceiptCount += 1;
      if (e.studentDocId) uniquePayers.add(e.studentDocId);
    }

    // 1. Waivers Audit log (every pure waiver OR fine waiver on a receipt)
    if (isWaiverOnly || lfWaived > 0) {
      const wBy = formatCollectorWithDesignation(e)
        || formatCollectorName(e.recordedByName, e.recordedBy, e.recordedByDesignation)
        || 'Authorised Staff';
      waivers.push({
        date: e.date || '',
        receiptNo: e.receiptNo || (isWaiverOnly ? 'Waiver Log' : '-'),
        studentDocId: e.studentDocId || '',
        studentId: e.studentId || '',
        studentName: formatPersonName(e.studentName || '') || e.studentName || '-',
        branchLabel: [e.homeBranchCode || e.branchCode, toTitleCaseIfCaps(e.homeBranchName || e.branchName)].filter(Boolean).join(' - ') || '-',
        courseLabel: [e.courseCode, e.courseName].filter(Boolean).join(' - ') || '-',
        feeLabel: e.typeLabel || e.type || 'Fee waiver',
        waivedAmount: lfWaived,
        reason: String(e.waiverReason || e.remarks || 'Waiver granted').trim(),
        waivedByLabel: wBy,
        entry: e
      });
    }

    // 2. Group by Collected At
    const locKey = e.collectedAtKey || (e.collectedAtType === 'head_office' ? 'HO' : (e.collectedAtBranchId || e.branchId || 'UNKNOWN'));
    const locLabel = e.collectedAtLabel
      || (locKey === 'HO'
        ? 'Head Office (HO)'
        : ([e.collectedAtBranchCode || e.branchCode, toTitleCaseIfCaps(e.collectedAtBranchName || e.branchName || '')].filter(Boolean).join(' - ') || locKey));
    if (!locMap.has(locKey)) {
      locMap.set(locKey, {
        key: locKey,
        type: e.collectedAtType || (locKey === 'HO' ? 'head_office' : 'branch'),
        label: locLabel,
        receipts: 0,
        fineReceipts: 0,
        cashAmount: 0,
        digitalAmount: 0,
        lateFees: 0,
        waiverCount: 0,
        waivedAmount: 0,
        totalCollected: 0
      });
    }
    const locBucket = locMap.get(locKey);
    if (lfWaived > 0 || isWaiverOnly) {
      locBucket.waiverCount += 1;
      locBucket.waivedAmount += lfWaived;
    }
    if (!isWaiverOnly) {
      locBucket.receipts += 1;
      if (lfPaid > 0) locBucket.fineReceipts += 1;
      if (isCash) locBucket.cashAmount += amt;
      else locBucket.digitalAmount += amt;
      locBucket.lateFees += lfPaid;
      locBucket.totalCollected += amt;
    }

    // 3. Group by Collected By
    const colEmail = String(e.recordedBy || '').trim().toLowerCase();
    const usr = colEmail ? usersByEmail[colEmail] : null;
    const roleKey = String(e.collectedByRole || e.recordedByRole || usr?.role || '').toLowerCase().trim();
    const dispLabel = formatCollectorWithDesignation(e)
      || formatCollectorName(e.recordedByName, colEmail, e.recordedByDesignation)
      || 'Authorised Staff';
    const colKey = colEmail || `name:${dispLabel.toLowerCase()}`;
    const roleLabel = roleKey ? getRoleTitle(roleKey) : 'Staff';
    if (!collectorMap.has(colKey)) {
      collectorMap.set(colKey, {
        key: colKey,
        email: colEmail,
        label: dispLabel,
        role: roleKey,
        roleLabel,
        receipts: 0,
        fineReceipts: 0,
        cashAmount: 0,
        digitalAmount: 0,
        lateFees: 0,
        waiverCount: 0,
        waivedAmount: 0,
        totalCollected: 0
      });
    }
    const colBucket = collectorMap.get(colKey);
    if (lfWaived > 0 || isWaiverOnly) {
      colBucket.waiverCount += 1;
      colBucket.waivedAmount += lfWaived;
    }
    if (!isWaiverOnly) {
      colBucket.receipts += 1;
      if (lfPaid > 0) colBucket.fineReceipts += 1;
      if (isCash) colBucket.cashAmount += amt;
      else colBucket.digitalAmount += amt;
      colBucket.lateFees += lfPaid;
      colBucket.totalCollected += amt;
    }

    // 4. Group by Payment Mode (money receipts)
    if (!isWaiverOnly) {
      const mKey = mMeta.cls || 'cash';
      if (!modeMap.has(mKey)) {
        modeMap.set(mKey, {
          key: mKey,
          label: mMeta.label,
          cls: mMeta.cls,
          icon: mMeta.icon,
          receipts: 0,
          amount: 0,
          sharePct: 0
        });
      }
      const mB = modeMap.get(mKey);
      mB.receipts += 1;
      mB.amount += amt;

      // 5. Daily Trend
      const dIso = String(e.date || '').slice(0, 10);
      if (dIso) {
        if (!dailyMap.has(dIso)) {
          dailyMap.set(dIso, { date: dIso, label: fmtDate(dIso), receipts: 0, amount: 0 });
        }
        const dB = dailyMap.get(dIso);
        dB.receipts += 1;
        dB.amount += amt;
      }
    }

    // 6. Course / Level aggregation
    const cId = e.courseId || e.courseCode || e.courseName || 'OTHER';
    if (!courseMap.has(cId)) {
      courseMap.set(cId, {
        courseId: cId,
        courseCode: e.courseCode || '',
        courseName: e.courseName || cId,
        payers: new Set(),
        receipts: 0,
        baseCollected: 0,
        lateCollected: 0,
        waivedAmount: 0,
        totalCollected: 0,
        overdueStudents: new Set(),
        overdueDue: 0
      });
    }
    const cBucket = courseMap.get(cId);
    if (lfWaived > 0 || isWaiverOnly) cBucket.waivedAmount += lfWaived;
    if (!isWaiverOnly) {
      cBucket.receipts += 1;
      if (e.studentDocId) cBucket.payers.add(e.studentDocId);
      cBucket.baseCollected += baseAmt;
      cBucket.lateCollected += lfPaid;
      cBucket.totalCollected += amt;
    }

    // 7. Youth Branch Settlement
    if (ctx === 'youth' && !isWaiverOnly) {
      const homeId = e.homeBranchId || e.branchId || '';
      const colAtId = e.collectedAtBranchId || '';
      const colAtType = e.collectedAtType || 'branch';
      const isCollectedBySuperOrHO = roleKey === 'superadmin'
        || colAtType === 'head_office'
        || (homeId && colAtId && colAtId !== homeId);

      if (homeId) {
        const sRow = ensureSettlementRow(homeId, e.homeBranchCode || e.branchCode || '', e.homeBranchName || e.branchName || '');
        sRow.homeReceipts += 1;
        sRow.homeCollected += amt;
        sRow.entries.push(e);

        if (isCollectedBySuperOrHO) {
          sRow.superAdminCount += 1;
          sRow.superAdminTotal += amt;
          if (isCash) sRow.superAdminCash += amt;
          else sRow.superAdminDigital += amt;
        } else {
          sRow.bhCount += 1;
          sRow.bhTotal += amt;
          if (isCash) {
            sRow.bhCash += amt;
            sRow.bhCashCount += 1;
          } else {
            sRow.bhDigital += amt;
            sRow.bhDigitalCount += 1;
          }
        }
      }

      // Track cash physically taken at a branch on behalf of ANOTHER branch's student
      if (colAtType === 'branch' && colAtId && homeId && colAtId !== homeId && roleKey !== 'superadmin') {
        const colRow = ensureSettlementRow(colAtId, e.collectedAtBranchCode || '', e.collectedAtBranchName || '');
        colRow.crossBranchHereCount += 1;
        if (isCash) colRow.crossBranchCashHere += amt;
        if (!colRow.entries.includes(e)) colRow.entries.push(e);
      }
    }
  }

  // Fold overdue items into Settlement & Course tables
  for (const p of (pendingItems || [])) {
    if (!p) continue;
    const dueTot = Number(p.totalPayable != null ? p.totalPayable : (Number(p.amount || 0) + Number(p.lateFee || 0)));
    const pCId = p.courseId || p.courseCode || p.courseName || 'OTHER';
    if (courseMap.has(pCId)) {
      const cb = courseMap.get(pCId);
      if (p.studentDocId) cb.overdueStudents.add(p.studentDocId);
      cb.overdueDue += dueTot;
    }
    if (ctx === 'youth' && p.branchId && settlementMap.has(p.branchId)) {
      const sb = settlementMap.get(p.branchId);
      if (p.studentDocId) sb.pendingStudents.add(p.studentDocId);
      sb.pendingAmount += Number(p.amount || 0);
      sb.pendingLateFee += Number(p.lateFee || 0);
    }
  }

  const byCollectedAt = Array.from(locMap.values()).sort((a, b) => b.totalCollected - a.totalCollected || b.waiverCount - a.waiverCount);
  const byCollectedBy = Array.from(collectorMap.values()).sort((a, b) => b.totalCollected - a.totalCollected || b.waiverCount - a.waiverCount);
  const byMode = Array.from(modeMap.values())
    .map((m) => ({
      ...m,
      sharePct: summary.totalCollected > 0 ? Math.round((m.amount / summary.totalCollected) * 100) : 0
    }))
    .sort((a, b) => b.amount - a.amount);

  const byBranchSettlement = Array.from(settlementMap.values())
    .map((row) => ({
      ...row,
      cashHandoverDue: row.bhCash + row.crossBranchCashHere,
      pendingStudentCount: row.pendingStudents.size,
      overdueTotal: row.pendingAmount + row.pendingLateFee
    }))
    .filter((r) => r.homeReceipts > 0 || r.crossBranchHereCount > 0 || r.overdueTotal > 0 || (branchesList || []).some((b) => b.id === r.branchId))
    .sort((a, b) => b.homeCollected - a.homeCollected || (a.branchName || '').localeCompare(b.branchName || ''));

  const byCourse = Array.from(courseMap.values())
    .map((c) => ({
      ...c,
      studentsCount: c.payers.size,
      overdueStudentCount: c.overdueStudents.size
    }))
    .filter((c) => c.receipts > 0 || c.overdueDue > 0)
    .sort((a, b) => b.totalCollected - a.totalCollected || (a.courseName || '').localeCompare(b.courseName || ''));

  const dailySeries = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  waivers.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return {
    summary: {
      ...summary,
      fineReceiptCount,
      baseCollected: totalFeesBase,
      uniqueStudents: uniquePayers.size,
      waiverCount: waivers.length
    },
    byCollectedAt,
    byCollectedBy,
    byMode,
    byBranchSettlement,
    byCourse,
    waivers,
    dailySeries
  };
}

/**
 * Generates and downloads a structured multi-section vector PDF Financial Report using vendored pdfMake.
 */
export async function exportFinancialReportPdf({
  title = 'Financial Report',
  subtitle = '',
  filename = 'financial-report.pdf',
  org = null,
  summary = {},
  aggs = {},
  entries = [],
  ctx = 'youth',
  printedBy = ''
} = {}) {
  const pdfMake = await loadPdfMake();
  const logoData = await urlToDataUrl('/assets/images/logo-512.jpg').catch(() => null);
  const accent = ctx === 'school' ? '#0F766E' : '#323A85';
  const softFill = ctx === 'school' ? '#E6F6F4' : '#EEF0FA';
  const fmtPlain = (n) => 'Rs ' + Math.round(Number(n || 0)).toLocaleString('en-IN');

  const tz = getOrgTimezone();
  const genTime = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date());

  const makeTableSection = (heading, headers, rows, widths = null) => {
    const body = [
      headers.map((h) => ({
        text: h.text || h,
        bold: true,
        fontSize: 8.5,
        color: accent,
        fillColor: softFill,
        alignment: h.num ? 'right' : 'left'
      })),
      ...(rows.length
        ? rows.map((r) => r.map((cell, idx) => ({
          text: String(cell ?? '-'),
          fontSize: 8.2,
          alignment: headers[idx]?.num ? 'right' : 'left'
        })))
        : [[{ text: 'No records in this view', colSpan: headers.length, alignment: 'center', color: '#6B6B6B', fontSize: 8.5 }, ...Array(Math.max(0, headers.length - 1)).fill({})]])
    ];
    return [
      { text: heading, bold: true, fontSize: 10.5, color: accent, margin: [0, 10, 0, 4] },
      {
        table: {
          headerRows: 1,
          ...(widths ? { widths } : { widths: Array(headers.length).fill('*') }),
          body
        },
        layout: {
          hLineColor: () => '#E2E4EA',
          vLineColor: () => '#E2E4EA',
          paddingTop: () => 4,
          paddingBottom: () => 4,
          paddingLeft: () => 5,
          paddingRight: () => 5
        }
      }
    ];
  };

  const content = [];
  content.push({
    columns: [
      ...(logoData ? [{ image: logoData, width: 38, margin: [0, 0, 10, 0] }] : []),
      {
        width: '*',
        stack: [
          { text: (org && org.orgName) || 'Unique Infotech', bold: true, fontSize: 14, color: accent },
          { text: title, bold: true, fontSize: 11, color: '#171717', margin: [0, 1, 0, 0] },
          { text: subtitle || '', fontSize: 8.5, color: '#525252', margin: [0, 2, 0, 0] }
        ]
      },
      {
        width: 170,
        alignment: 'right',
        stack: [
          { text: `Generated: ${genTime}`, fontSize: 8, color: '#525252' },
          ...(printedBy ? [{ text: `Prepared by: ${printedBy}`, fontSize: 8, color: '#525252', margin: [0, 2, 0, 0] }] : [])
        ]
      }
    ],
    margin: [0, 0, 0, 8]
  });

  content.push({
    table: {
      widths: ['*', '*', '*', '*', '*'],
      body: [[
        { stack: [{ text: 'TOTAL COLLECTED', fontSize: 7.5, color: '#6B6B6B', bold: true }, { text: fmtPlain(summary.totalCollected), fontSize: 11, bold: true, color: '#16A34A' }, { text: `${summary.moneyReceipts || 0} receipts`, fontSize: 7.5, color: '#525252' }], fillColor: '#F6F6F8' },
        { stack: [{ text: 'CASH COLLECTED', fontSize: 7.5, color: '#6B6B6B', bold: true }, { text: fmtPlain(summary.cashTotal), fontSize: 11, bold: true }, { text: `${summary.cashCount || 0} receipts`, fontSize: 7.5, color: '#525252' }], fillColor: '#F6F6F8' },
        { stack: [{ text: 'UPI / BANK', fontSize: 7.5, color: '#6B6B6B', bold: true }, { text: fmtPlain((summary.upiTotal || 0) + (summary.bankTotal || 0)), fontSize: 11, bold: true }, { text: `${(summary.upiCount || 0) + (summary.bankCount || 0)} digital`, fontSize: 7.5, color: '#525252' }], fillColor: '#F6F6F8' },
        { stack: [{ text: 'LATE FEES PAID', fontSize: 7.5, color: '#6B6B6B', bold: true }, { text: fmtPlain(summary.lateFeesCollected), fontSize: 11, bold: true }, { text: `${summary.fineReceiptCount || 0} receipts`, fontSize: 7.5, color: '#525252' }], fillColor: '#F6F6F8' },
        { stack: [{ text: 'WAIVED FEES', fontSize: 7.5, color: '#6B6B6B', bold: true }, { text: fmtPlain(summary.lateFeesWaived), fontSize: 11, bold: true }, { text: `${summary.waiverCount || 0} waivers`, fontSize: 7.5, color: '#525252' }], fillColor: '#F6F6F8' }
      ]]
    },
    layout: { hLineColor: () => '#EAEAEA', vLineColor: () => '#EAEAEA', paddingTop: () => 5, paddingBottom: () => 5 }
  });

  // Transactions table (cap at 500 rows for instant vector PDF assembly)
  const limitedRows = (entries || []).slice(0, 500);
  content.push(...makeTableSection(
    `Receipt & Collection Details (${entries.length}${entries.length > 500 ? ', showing latest 500' : ''})`,
    [
      { text: 'Date' },
      { text: 'Student' },
      { text: 'Payment For' },
      { text: 'Mode' },
      { text: 'Collected By' },
      { text: 'Collected At' },
      { text: 'Received', num: true },
      { text: 'Receipt' }
    ],
    limitedRows.map((e) => [
      e.date ? fmtDate(e.date) : '-',
      `${formatPersonName(e.studentName || '')} (${e.studentId || '-'})`,
      e.typeLabel || e.type || '-',
      modeDisplayMeta(e).label,
      formatCollectorWithDesignation(e) || formatCollectorName(e.recordedByName, e.recordedBy, e.recordedByDesignation) || '-',
      e.collectedAtLabel || '-',
      e.isPureWaiver ? 'Rs 0 (Waiver)' : fmtPlain(e.totalReceived),
      e.receiptNo || (e.isPureWaiver ? 'Waiver Log' : '-')
    ]),
    ['auto', '*', 'auto', 'auto', '*', 'auto', 'auto', 'auto']
  ));

  // Report Footer Groupings: Collected At + Collected By + Mode
  content.push(...makeTableSection(
    'Summary Grouped by Collected At',
    [
      { text: 'Collected At' },
      { text: 'Receipts', num: true },
      { text: 'Cash', num: true },
      { text: 'UPI / Bank', num: true },
      { text: 'Fines', num: true },
      { text: 'Waivers', num: true },
      { text: 'Total Collected', num: true }
    ],
    (aggs.byCollectedAt || []).map((r) => [
      r.label,
      r.receipts,
      fmtPlain(r.cashAmount),
      fmtPlain(r.digitalAmount),
      fmtPlain(r.lateFees),
      r.waiverCount ? `${r.waiverCount} (${fmtPlain(r.waivedAmount)})` : '0',
      fmtPlain(r.totalCollected)
    ])
  ));

  content.push(...makeTableSection(
    'Summary Grouped by Collected By',
    [
      { text: 'Collected By' },
      { text: 'Role' },
      { text: 'Receipts', num: true },
      { text: 'Cash', num: true },
      { text: 'UPI / Bank', num: true },
      { text: 'Waivers', num: true },
      { text: 'Total Collected', num: true }
    ],
    (aggs.byCollectedBy || []).map((r) => [
      r.label,
      r.roleLabel || '-',
      r.receipts,
      fmtPlain(r.cashAmount),
      fmtPlain(r.digitalAmount),
      r.waiverCount ? `${r.waiverCount} (${fmtPlain(r.waivedAmount)})` : '0',
      fmtPlain(r.totalCollected)
    ])
  ));

  content.push(...makeTableSection(
    'Summary Grouped by Payment Mode',
    [
      { text: 'Mode' },
      { text: 'Receipts', num: true },
      { text: 'Amount', num: true },
      { text: 'Share', num: true }
    ],
    (aggs.byMode || []).map((m) => [m.label, m.receipts, fmtPlain(m.amount), `${m.sharePct}%`])
  ));

  if (ctx === 'youth' && (aggs.byBranchSettlement || []).length) {
    content.push(...makeTableSection(
      'Branch Settlement Reconciliation',
      [
        { text: 'Branch' },
        { text: 'Branch Cash Held', num: true },
        { text: 'Branch UPI/Bank', num: true },
        { text: 'Top Admin / HO', num: true },
        { text: 'Branch Students Total', num: true },
        { text: 'Cash Handover Due', num: true }
      ],
      aggs.byBranchSettlement.map((b) => [
        b.branchCode ? `${b.branchCode} - ${b.branchName}` : b.branchName,
        fmtPlain(b.bhCash),
        fmtPlain(b.bhDigital),
        fmtPlain(b.superAdminTotal),
        fmtPlain(b.homeCollected),
        fmtPlain(b.cashHandoverDue)
      ])
    ));
  }

  if ((aggs.waivers || []).length) {
    content.push(...makeTableSection(
      `Fine & Fee Waivers Audit (${aggs.waivers.length})`,
      [
        { text: 'Date' },
        { text: 'Student' },
        { text: 'Fee Item' },
        { text: 'Waived', num: true },
        { text: 'Reason' },
        { text: 'Waived By' }
      ],
      aggs.waivers.map((w) => [
        w.date ? fmtDate(w.date) : '-',
        `${w.studentName} (${w.studentId || '-'})`,
        w.feeLabel,
        fmtPlain(w.waivedAmount),
        w.reason,
        w.waivedByLabel
      ])
    ));
  }

  const docDef = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [24, 24, 24, 28],
    footer: (cur, count) => ({
      columns: [
        { text: `${(org && org.orgName) || 'Unique Infotech'} · ${title}`, fontSize: 7.5, color: '#6B6B6B', margin: [24, 0, 0, 0] },
        { text: `Page ${cur} of ${count}`, fontSize: 7.5, color: '#6B6B6B', alignment: 'right', margin: [0, 0, 24, 0] }
      ]
    }),
    content
  };

  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(docDef).getBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        resolve(true);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function getReportDatePresetOptions() {
  return [
    { value: 'session', label: 'Whole session', icon: 'calendar-clock' },
    { value: 'today', label: 'Today', icon: 'calendar-check' },
    { value: 'week', label: 'This week', icon: 'calendar-days' },
    { value: 'month', label: 'This month', icon: 'calendar-range' },
    { value: 'last_month', label: 'Last month', icon: 'calendar' },
    { value: 'custom', label: 'Custom', icon: 'sliders-horizontal' }
  ];
}

function addDaysISO(iso, deltaDays) {
  const [y, m, d] = String(iso || todayISO()).split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function diffDaysISO(fromIso, toIso) {
  if (!fromIso || !toIso) return 0;
  const a = new Date(fromIso + 'T00:00:00Z');
  const b = new Date(toIso + 'T00:00:00Z');
  return Math.max(0, Math.round((b - a) / 86400000));
}

function fmtShortDay(iso) {
  if (!iso || iso.length < 10) return iso || '-';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(dt);
}

function fmtMonthShort(ym) {
  if (!ym || ym.length < 7) return ym || '-';
  const [y, m] = ym.slice(0, 7).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: '2-digit' }).format(dt);
}

function safeTimestampISO(ts) {
  if (!ts) return '';
  if (typeof ts === 'string') return ts.slice(0, 10);
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000).toISOString().slice(0, 10);
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString().slice(0, 10);
  return '';
}

function sanitizeStaffName(email, recordedByName, recordedByDesignation) {
  const disp = resolveUserDisplay(email, recordedByName, recordedByDesignation);
  let name = String(disp.name || recordedByName || '').trim();
  const desig = String(disp.designation || recordedByDesignation || '').trim();
  if (!name || name === '-' || name.includes('@')) {
    name = 'Authorised Staff';
  } else {
    name = formatPersonName(name) || name;
  }
  const fullLabel = desig ? `${name} (${desig})` : name;
  return { name, desig, fullLabel };
}

export async function loadAllYouthSessionsForCompare({ forceRefresh = false } = {}) {
  const root = ensureCacheRoot();
  if (!forceRefresh && Array.isArray(root.allYouthSessions) && hasFreshSessionsCache('youth', CACHE_STALE_MS)) {
    return { sessions: root.allYouthSessions, readCount: 0, fromCache: true };
  }
  const hadFreshSessions = !forceRefresh && hasFreshSessionsCache('youth', CACHE_STALE_MS);
  const allList = hadFreshSessions
    ? getAllCachedSessions('youth')
    : await loadAllSessions('youth', { forceRefresh });
  const list = (allList || [])
    .filter((s) => s.status !== 'deleted')
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  root.allYouthSessions = list;
  return {
    sessions: list,
    readCount: hadFreshSessions ? 0 : list.length,
    fromCache: hadFreshSessions
  };
}

export function computePreviousPeriodRange(preset, dateFrom, dateTo, asOfIso = todayISO()) {
  if (!preset || preset === 'session') {
    return { type: 'session', from: '', to: '', label: 'prev session' };
  }
  if (preset === 'today') {
    const yday = addDaysISO(dateFrom || asOfIso, -1);
    return { type: 'dates', from: yday, to: yday, label: 'yesterday' };
  }
  if (preset === 'week') {
    const span = diffDaysISO(dateFrom, dateTo);
    const prevFrom = addDaysISO(dateFrom, -7);
    return { type: 'dates', from: prevFrom, to: addDaysISO(prevFrom, span), label: 'last week' };
  }
  if (preset === 'month') {
    const parts = String(dateFrom || asOfIso).split('-').map(Number);
    const prevEndDt = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, 1));
    prevEndDt.setUTCDate(0);
    const y = prevEndDt.getUTCFullYear();
    const m = String(prevEndDt.getUTCMonth() + 1).padStart(2, '0');
    const lastDay = String(prevEndDt.getUTCDate()).padStart(2, '0');
    return { type: 'dates', from: `${y}-${m}-01`, to: `${y}-${m}-${lastDay}`, label: 'last month' };
  }
  if (preset === 'last_month') {
    const parts = String(dateFrom || asOfIso).split('-').map(Number);
    const prevEndDt = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1, 1));
    prevEndDt.setUTCDate(0);
    const y = prevEndDt.getUTCFullYear();
    const m = String(prevEndDt.getUTCMonth() + 1).padStart(2, '0');
    const lastDay = String(prevEndDt.getUTCDate()).padStart(2, '0');
    return { type: 'dates', from: `${y}-${m}-01`, to: `${y}-${m}-${lastDay}`, label: 'prior month' };
  }
  if (dateFrom && dateTo) {
    const span = diffDaysISO(dateFrom, dateTo) + 1;
    const prevTo = addDaysISO(dateFrom, -1);
    const prevFrom = addDaysISO(prevTo, -(span - 1));
    return { type: 'dates', from: prevFrom, to: prevTo, label: 'prev period' };
  }
  return { type: 'none', from: '', to: '', label: 'prev period' };
}

function makeDelta(curr, prev, { label = 'prev period', inverseBad = false } = {}) {
  const c = Number(curr || 0);
  if (prev === null || prev === undefined) {
    return { pct: null, dir: 'flat', tone: 'neutral', text: `— vs ${label}` };
  }
  const p = Number(prev || 0);
  if (p === 0 && c === 0) {
    return { pct: 0, dir: 'flat', tone: 'neutral', text: `0% vs ${label}` };
  }
  if (p === 0) {
    return {
      pct: null,
      dir: 'up',
      tone: inverseBad ? 'bad' : 'good',
      text: `New vs 0 (${label})`
    };
  }
  const rawPct = ((c - p) / Math.abs(p)) * 100;
  const rounded = Math.round(rawPct * 10) / 10;
  const dir = rounded > 0 ? 'up' : (rounded < 0 ? 'down' : 'flat');
  const sign = rounded > 0 ? '+' : '';
  let tone = 'neutral';
  if (dir === 'up') tone = inverseBad ? 'bad' : 'good';
  else if (dir === 'down') tone = inverseBad ? 'good' : 'bad';
  return { pct: rounded, dir, tone, text: `${sign}${rounded}% vs ${label}` };
}

function normalizeStudentStatus(raw) {
  const st = String(raw || 'active').toLowerCase().trim();
  if (st === 'active') return 'Active';
  if (st === 'completed' || st === 'ended') return 'Completed';
  if (st === 'transferred') return 'Transferred';
  if (st === 'dropped' || st === 'left' || st === 'inactive' || st === 'deleted') return 'Dropped';
  return toTitleCaseIfCaps(st) || 'Active';
}

function normalizeGenderLabel(raw) {
  const g = String(raw || '').toLowerCase().trim();
  if (g === 'm' || g === 'male') return 'Male';
  if (g === 'f' || g === 'female') return 'Female';
  if (!g) return 'Unspecified';
  return 'Other';
}

/**
 * Pure analytics builder for Youth Centre Reports (#/reports).
 * Matches Payment History (summarizePaymentLedger) and Pending & Overdue (summarizePendingItems)
 * totals exactly for identical Session / Branch / Batch / Course / Date filters.
 */
export function buildYouthReportsData({
  entries = [],
  pendingReport = null,
  activeSession = null,
  prevPendingReport = null,
  prevSession = null,
  branchesList = [],
  coursesList = [],
  batchesList = [],
  branchesById = {},
  coursesById = {},
  batchesById = {},
  profile = null,
  filters = {},
  asOfDate = todayISO()
} = {}) {
  const isSuper = profile?.role === 'superadmin';
  const effectiveBranchId = (!isSuper && profile?.role === 'branch_head' && profile?.branchId)
    ? profile.branchId
    : (filters.branchId || 'all');
  const batchFilter = filters.batchId || 'all';
  const courseFilter = filters.courseId || 'all';
  const datePreset = filters.datePreset || 'session';
  const isWholeSession = datePreset === 'session';
  // "Whole session" filters payments strictly by sessionId (never by startDate..endDate),
  // because advance admissions/fees for upcoming sessions may be paid before session startDate.
  const effFrom = isWholeSession ? '' : (filters.dateFrom || '');
  const effTo = isWholeSession ? '' : (filters.dateTo || '');
  const sessId = activeSession?.id || '';

  const matchesStructEntry = (e, ignoreBranch = false) => {
    if (!e || (e.ctx && e.ctx !== 'youth')) return false;
    if (sessId && e.sessionId && e.sessionId !== sessId) return false;
    if (!ignoreBranch && effectiveBranchId !== 'all' && e.branchId !== effectiveBranchId) return false;
    if (batchFilter !== 'all' && e.batchId !== batchFilter) return false;
    if (courseFilter !== 'all' && e.courseId !== courseFilter) return false;
    return true;
  };

  const matchesStructStudent = (s, ignoreBranch = false) => {
    if (!s || (s.ctx && s.ctx !== 'youth')) return false;
    if (sessId && s.sessionId && s.sessionId !== sessId) return false;
    if (!ignoreBranch && effectiveBranchId !== 'all' && s.branchId !== effectiveBranchId) return false;
    if (batchFilter !== 'all' && s.batchId !== batchFilter) return false;
    if (courseFilter !== 'all' && s.courseId !== courseFilter) return false;
    return true;
  };

  const isNonDroppedStu = (s) => !['dropped', 'left', 'inactive', 'deleted'].includes(String(s?.status || 'active').toLowerCase().trim());

  const inDateRange = (iso, from, to) => {
    if (!iso) return !from && !to;
    if (from && iso < from) return false;
    if (to && iso > to) return false;
    return true;
  };

  // 1. Entries (Payment History exact parity)
  const structEntries = (entries || []).filter((e) => matchesStructEntry(e, false));
  const entriesCurrent = structEntries.filter((e) => inDateRange(e.date, effFrom, effTo));
  const paySummary = summarizePaymentLedger(entriesCurrent);

  // 2. Pending / Overdue & Student Financials (Pending & Overdue + calculateStudentFinancials parity)
  const rawOverdueItems = filterOverdueItems(pendingReport?.items || [], asOfDate);
  const filteredOverdueItems = rawOverdueItems.filter((it) => {
    if (effectiveBranchId !== 'all' && it.branchId !== effectiveBranchId) return false;
    if (batchFilter !== 'all' && it.batchId !== batchFilter) return false;
    if (courseFilter !== 'all' && it.courseId !== courseFilter) return false;
    return true;
  });
  const pendingSummary = summarizePendingItems(filteredOverdueItems, asOfDate);

  const allSessionStudents = Object.values(pendingReport?.studentsById || {}).filter(Boolean);
  const scopedStudents = allSessionStudents.filter((s) => matchesStructStudent(s, false));
  const activeStudents = scopedStudents.filter((s) => isStudentEligibleForDues(s));
  const scopedCourseStudents = scopedStudents.filter(isNonDroppedStu);
  const paymentsByStudentId = pendingReport?.paymentsByStudentId || {};

  let totalOutstanding = 0;
  let studentsWithBalanceCount = 0;

  // Student-level overdue lookup from exact overdue items
  const overdueByStu = new Map();
  filteredOverdueItems.forEach((it) => {
    if (!it.studentDocId) return;
    if (!overdueByStu.has(it.studentDocId)) {
      overdueByStu.set(it.studentDocId, { principal: 0, lateFee: 0, count: 0 });
    }
    const b = overdueByStu.get(it.studentDocId);
    b.principal += Number(it.amount || 0);
    b.lateFee += Number(it.lateFee || 0);
    b.count += 1;
  });

  // Groupings for Section 3a
  const duesByBranch = new Map();
  const duesByBatch = new Map();
  const duesByCourse = new Map();

  const bumpDuesBucket = (map, key, label, shortLabel, outAmt, ovAmt) => {
    const k = key || 'OTHER';
    if (!map.has(k)) {
      map.set(k, { key: k, label: label || k, shortLabel: shortLabel || label || k, students: 0, outstanding: 0, overdue: 0 });
    }
    const b = map.get(k);
    b.students += 1;
    b.outstanding += outAmt;
    b.overdue += ovAmt;
  };

  for (const s of activeStudents) {
    const fin = calculateStudentFinancials(s, paymentsByStudentId[s.id] || []);
    const outAmt = Number(fin.outstanding || 0);
    totalOutstanding += outAmt;

    const br = branchesById[s.branchId] || {};
    const cr = coursesById[s.courseId] || {};
    const bt = batchesById[s.batchId] || {};
    const brCode = String(br.code || br.branchCode || s.branchCode || '').trim();
    const brName = toTitleCaseIfCaps(br.name || s.branchName || '') || s.branchId || 'Branch';
    const crCode = String(cr.courseCode || cr.code || s.courseCode || '').trim();
    const crName = cr.name || s.courseName || 'Course';
    const btName = bt.name || s.batchName || 'Batch';

    const stuOv = overdueByStu.get(s.id) || { principal: 0, lateFee: 0, count: 0 };
    if (outAmt > 0 || stuOv.principal > 0) studentsWithBalanceCount += 1;

    bumpDuesBucket(duesByBranch, s.branchId, brCode ? `${brCode} - ${brName}` : brName, brCode || brName, outAmt, stuOv.principal);
    bumpDuesBucket(duesByBatch, s.batchId || 'UNASSIGNED', `${btName}${brCode ? ' (' + brCode + ')' : ''}`, btName, outAmt, stuOv.principal);
    bumpDuesBucket(duesByCourse, s.courseId, crCode ? `${crCode} - ${crName}` : crName, crCode || crName, outAmt, stuOv.principal);
  }

  // Total course fee across non-dropped filtered students for Collection Rate
  const totalCourseFee = scopedCourseStudents.reduce((sum, s) => sum + Number(calculateStudentFinancials(s, []).total || 0), 0);
  const collectionRatePct = totalCourseFee > 0 ? Math.round((paySummary.totalCollected / totalCourseFee) * 1000) / 10 : 0;

  // Overdue ageing buckets
  const ageingBuckets = {
    '1-15': { label: '1-15 days', value: 0, count: 0, color: '#D97706' },
    '16-30': { label: '16-30 days', value: 0, count: 0, color: '#EA580C' },
    '31-60': { label: '31-60 days', value: 0, count: 0, color: '#DC2626' },
    '60+': { label: '60+ days', value: 0, count: 0, color: '#7F1D1D' }
  };
  filteredOverdueItems.forEach((it) => {
    const d = Number(it.daysLate || 0);
    const amt = Number(it.amount || 0);
    const k = d <= 15 ? '1-15' : (d <= 30 ? '16-30' : (d <= 60 ? '31-60' : '60+'));
    ageingBuckets[k].value += amt;
    ageingBuckets[k].count += 1;
  });

  // New admissions count in date range
  const getAdmIso = (s) => String(s.admissionDate || safeTimestampISO(s.createdAt) || '').slice(0, 10);
  const newAdmissions = isWholeSession
    ? scopedStudents.length
    : scopedStudents.filter((s) => inDateRange(getAdmIso(s), effFrom, effTo)).length;

  // Previous Period Delta computations for all 8 KPI cards
  const prevRange = computePreviousPeriodRange(datePreset, effFrom, effTo, asOfDate);
  let prevVals = { collected: null, outstanding: null, overdue: null, lateCollected: null, lateWaived: null, admissions: null, activeStudents: null, collectionRate: null };

  if (prevRange.type === 'dates' && prevRange.from && prevRange.to) {
    const prevEntries = structEntries.filter((e) => inDateRange(e.date, prevRange.from, prevRange.to));
    const prevPay = summarizePaymentLedger(prevEntries);
    prevVals.collected = prevPay.totalCollected;
    prevVals.lateCollected = prevPay.lateFeesCollected;
    prevVals.lateWaived = prevPay.lateFeesWaived;
    prevVals.admissions = scopedStudents.filter((s) => inDateRange(getAdmIso(s), prevRange.from, prevRange.to)).length;
    const prevCourseTotal = scopedCourseStudents.reduce((sum, s) => {
      const admIso = getAdmIso(s);
      if (admIso && admIso > prevRange.to) return sum;
      return sum + Number(calculateStudentFinancials(s, []).total || 0);
    }, 0);
    prevVals.collectionRate = prevCourseTotal > 0 ? Math.round((prevPay.totalCollected / prevCourseTotal) * 1000) / 10 : null;

    // Historical as-of snapshot at prevRange.to using only payments <= prevRange.to
    let prevOut = 0;
    let prevOv = 0;
    let prevAct = 0;
    for (const s of activeStudents) {
      const admIso = getAdmIso(s);
      if (admIso && admIso > prevRange.to) continue;
      prevAct += 1;
      const priorPays = (paymentsByStudentId[s.id] || []).filter((p) => {
        const pd = String(p.paidOn || p.date || safeTimestampISO(p.createdAt) || '').slice(0, 10);
        return !pd || pd <= prevRange.to;
      });
      const evPrev = evaluateYouthStudentDues(s, priorPays, activeSession, {
        asOfDate: prevRange.to,
        coursesById,
        branchesById,
        batchesById
      });
      prevOut += Number(evPrev.financials?.outstanding || 0);
      evPrev.items.forEach((it) => {
        if (it.status === 'overdue') prevOv += Number(it.amount || 0);
      });
    }
    prevVals.outstanding = prevOut;
    prevVals.overdue = prevOv;
    prevVals.activeStudents = prevAct;
  } else if (prevRange.type === 'session' && prevSession) {
    const prevSessEntries = (entries || []).filter((e) => {
      if (e.ctx && e.ctx !== 'youth') return false;
      if (e.sessionId !== prevSession.id) return false;
      if (effectiveBranchId !== 'all' && e.branchId !== effectiveBranchId) return false;
      if (courseFilter !== 'all' && e.courseId !== courseFilter) return false;
      return true;
    });
    const prevPay = summarizePaymentLedger(prevSessEntries);
    prevVals.collected = prevPay.totalCollected;
    prevVals.lateCollected = prevPay.lateFeesCollected;
    prevVals.lateWaived = prevPay.lateFeesWaived;

    const prevStudents = Object.values(prevPendingReport?.studentsById || {}).filter((s) => (
      s && (!s.ctx || s.ctx === 'youth')
      && (effectiveBranchId === 'all' || s.branchId === effectiveBranchId)
      && (courseFilter === 'all' || s.courseId === courseFilter)
    ));
    const prevActList = prevStudents.filter(isStudentEligibleForDues);
    const prevCourseTotal = prevStudents.filter(isNonDroppedStu).reduce((sum, s) => sum + Number(calculateStudentFinancials(s, []).total || 0), 0);
    prevVals.collectionRate = prevCourseTotal > 0 ? Math.round((prevPay.totalCollected / prevCourseTotal) * 1000) / 10 : null;
    prevVals.admissions = prevStudents.length;
    prevVals.activeStudents = prevActList.length;

    let prevOut = 0;
    const prevPayByStu = prevPendingReport?.paymentsByStudentId || {};
    for (const ps of prevActList) {
      prevOut += Number(calculateStudentFinancials(ps, prevPayByStu[ps.id] || []).outstanding || 0);
    }
    prevVals.outstanding = prevOut;
    const prevOvItems = filterOverdueItems(prevPendingReport?.items || [], prevSession.endDate || asOfDate).filter((it) => (
      (effectiveBranchId === 'all' || it.branchId === effectiveBranchId)
      && (courseFilter === 'all' || it.courseId === courseFilter)
    ));
    prevVals.overdue = summarizePendingItems(prevOvItems, prevSession.endDate || asOfDate).overdueAmount;
  }

  const rateDelta = (() => {
    if (prevVals.collectionRate === null || prevVals.collectionRate === undefined) {
      return { pct: null, dir: 'flat', tone: 'neutral', text: `— vs ${prevRange.label}` };
    }
    const diff = Math.round((collectionRatePct - prevVals.collectionRate) * 10) / 10;
    const dir = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');
    const sign = diff > 0 ? '+' : '';
    const tone = dir === 'up' ? 'good' : (dir === 'down' ? 'bad' : 'neutral');
    return { pct: diff, dir, tone, text: `${sign}${diff}% vs ${prevRange.label}` };
  })();

  const kpis = {
    totalCollected: {
      value: paySummary.totalCollected,
      sub: `${paySummary.moneyReceipts} receipt${paySummary.moneyReceipts === 1 ? '' : 's'}`,
      delta: makeDelta(paySummary.totalCollected, prevVals.collected, { label: prevRange.label })
    },
    outstandingDues: {
      value: totalOutstanding,
      sub: `${studentsWithBalanceCount} student${studentsWithBalanceCount === 1 ? '' : 's'} with balance`,
      delta: makeDelta(totalOutstanding, prevVals.outstanding, { label: prevRange.label, inverseBad: true })
    },
    overdueAmount: {
      value: pendingSummary.overdueAmount,
      sub: `Late ${formatINR(pendingSummary.lateFeesTotal)} · Total ${formatINR(pendingSummary.overdueWithLate)}`,
      delta: makeDelta(pendingSummary.overdueAmount, prevVals.overdue, { label: prevRange.label, inverseBad: true })
    },
    lateFeesCollected: {
      value: paySummary.lateFeesCollected,
      sub: `Across collected receipts`,
      delta: makeDelta(paySummary.lateFeesCollected, prevVals.lateCollected, { label: prevRange.label })
    },
    lateFeesWaived: {
      value: paySummary.lateFeesWaived,
      sub: (() => {
        const wCnt = entriesCurrent.filter((e) => e.isPureWaiver || e.type === 'WA' || Number(e.lateFeeWaived || 0) > 0).length;
        return `${wCnt} waiver${wCnt === 1 ? '' : 's'}`;
      })(),
      delta: makeDelta(paySummary.lateFeesWaived, prevVals.lateWaived, { label: prevRange.label, inverseBad: true })
    },
    newAdmissions: {
      value: newAdmissions,
      sub: isWholeSession ? 'In active session' : 'Admitted in period',
      delta: makeDelta(newAdmissions, prevVals.admissions, { label: prevRange.label })
    },
    activeStudents: {
      value: activeStudents.length,
      sub: `${scopedStudents.length} total in scope`,
      delta: makeDelta(activeStudents.length, prevVals.activeStudents, { label: prevRange.label })
    },
    collectionRate: {
      value: collectionRatePct,
      barPct: Math.min(100, Math.max(0, Math.round(collectionRatePct))),
      totalCourseFee,
      sub: totalCourseFee > 0 ? `${formatINR(paySummary.totalCollected)} of ${formatINR(totalCourseFee)}` : 'No course fee in scope',
      delta: rateDelta
    }
  };

  // Section 2: Money
  const spanDays = (!isWholeSession && effFrom && effTo) ? diffDaysISO(effFrom, effTo) + 1 : 999;
  const useDailyTrend = datePreset === 'today' || datePreset === 'week' || datePreset === 'month' || datePreset === 'last_month' || (!isWholeSession && spanDays <= 45);
  const trendMap = new Map();
  if (useDailyTrend && effFrom && effTo && spanDays <= 35) {
    let curD = effFrom;
    let guard = 0;
    while (curD <= effTo && guard < 40) {
      trendMap.set(curD, { key: curD, label: fmtDate(curD), shortLabel: fmtShortDay(curD), value: 0, receipts: 0 });
      curD = addDaysISO(curD, 1);
      guard += 1;
    }
  }
  entriesCurrent.forEach((e) => {
    if (e.isPureWaiver || e.type === 'WA') return;
    const amt = Number(e.totalReceived || 0);
    const key = useDailyTrend ? String(e.date || '').slice(0, 10) : String(e.date || '').slice(0, 7);
    if (!key) return;
    if (!trendMap.has(key)) {
      trendMap.set(key, {
        key,
        label: useDailyTrend ? fmtDate(key) : fmtMonthShort(key),
        shortLabel: useDailyTrend ? fmtShortDay(key) : fmtMonthShort(key),
        value: 0,
        receipts: 0
      });
    }
    const b = trendMap.get(key);
    b.value += amt;
    b.receipts += 1;
  });
  const trendPoints = Array.from(trendMap.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((t) => ({ ...t, sub: `${t.receipts} rcpt${t.receipts === 1 ? '' : 's'}` }));

  // 2b Payment mode donut
  const modeBuckets = new Map();
  entriesCurrent.forEach((e) => {
    const amt = Number(e.totalReceived || 0);
    const rawM = String(e.mode || 'cash').toLowerCase().trim();
    if (e.isPureWaiver || e.type === 'WA' || amt <= 0 || rawM === 'waiver' || rawM === 'waived') return;
    const meta = modeDisplayMeta(e);
    const key = `${meta.cls || 'cash'}:${meta.label || 'Cash'}`;
    if (!modeBuckets.has(key)) modeBuckets.set(key, { key: meta.cls || 'cash', label: meta.label, value: 0, count: 0 });
    const b = modeBuckets.get(key);
    b.value += amt;
    b.count += 1;
  });
  const modeColors = { cash: '#323A85', upi: '#0F766E', bank: '#0284C7', card: '#7C3AED', cheque: '#D97706' };
  const modeSlices = Array.from(modeBuckets.values())
    .sort((a, b) => b.value - a.value)
    .map((m) => ({ label: m.label, value: m.value, color: modeColors[m.key] || '#0F766E', sub: `${m.count} rcpt` }));

  // 2c Fee type donut (Admission, Installment, Material, Exam, Late fee)
  const feeBuckets = {
    ADMISSION: { label: 'Admission', value: 0, color: '#323A85' },
    IN: { label: 'Installment', value: 0, color: '#0F766E' },
    MAT: { label: 'Material', value: 0, color: '#0284C7' },
    EX: { label: 'Exam', value: 0, color: '#7C3AED' },
    LF: { label: 'Late fee', value: 0, color: '#D97706' }
  };
  entriesCurrent.forEach((e) => {
    if (e.isPureWaiver || e.type === 'WA') return;
    const lf = Number(e.lateFeePaid || 0);
    feeBuckets.LF.value += lf;
    if (e.isAdmissionGroup && Array.isArray(e.breakdown) && e.breakdown.length) {
      e.breakdown.forEach((b) => {
        const bt = String(b.type || '').toUpperCase();
        const bAmt = Number(b.amount || 0);
        if (bt === 'MAT') feeBuckets.MAT.value += bAmt;
        else feeBuckets.ADMISSION.value += bAmt;
      });
    } else {
      const base = Math.max(0, Number(e.totalReceived || 0) - lf);
      const t = String(e.type || '').toUpperCase();
      if (t === 'MAT') feeBuckets.MAT.value += base;
      else if (t === 'EX') feeBuckets.EX.value += base;
      else if (t === 'AD' || t === 'ADMISSION' || t === 'FULL') feeBuckets.ADMISSION.value += base;
      else feeBuckets.IN.value += base;
    }
  });
  const feeTypeSlices = Object.values(feeBuckets).filter((s) => s.value > 0);

  // 2d Staff-wise collection table (never show raw emails)
  const staffMap = new Map();
  entriesCurrent.forEach((e) => {
    const amt = Number(e.totalReceived || 0);
    if (e.isPureWaiver || e.type === 'WA' || amt <= 0) return;
    const email = String(e.recordedBy || '').toLowerCase().trim();
    const { name, desig, fullLabel } = sanitizeStaffName(email, e.recordedByName, e.recordedByDesignation);
    const key = email || `name:${fullLabel.toLowerCase()}`;
    if (!staffMap.has(key)) {
      staffMap.set(key, {
        label: fullLabel,
        name,
        designation: desig,
        receipts: 0,
        amount: 0,
        cashAmount: 0,
        onlineAmount: 0
      });
    }
    const row = staffMap.get(key);
    const m = String(e.mode || 'cash').toLowerCase();
    row.receipts += 1;
    row.amount += amt;
    if (m === 'cash' || !m) row.cashAmount += amt;
    else row.onlineAmount += amt;
  });
  const staffRows = Array.from(staffMap.values()).sort((a, b) => b.amount - a.amount || b.receipts - a.receipts);

  // Section 4: Students
  const admMonthMap = new Map();
  const courseStuMap = new Map();
  const statusStuMap = new Map();
  const genderStuMap = new Map();
  const batchEnrolledMap = new Map();

  scopedStudents.forEach((s) => {
    const admIso = getAdmIso(s);
    const ym = admIso ? admIso.slice(0, 7) : '';
    if (ym) {
      if (!admMonthMap.has(ym)) {
        admMonthMap.set(ym, { key: ym, label: fmtMonthShort(ym), shortLabel: fmtMonthShort(ym), value: 0 });
      }
      admMonthMap.get(ym).value += 1;
    }

    const cr = coursesById[s.courseId] || {};
    const crLabel = [cr.courseCode || cr.code || s.courseCode, cr.name || s.courseName].filter(Boolean).join(' - ') || 'Other';
    const cKey = s.courseId || crLabel;
    if (!courseStuMap.has(cKey)) courseStuMap.set(cKey, { label: crLabel, value: 0 });
    courseStuMap.get(cKey).value += 1;

    const stLabel = normalizeStudentStatus(s.status);
    if (!statusStuMap.has(stLabel)) statusStuMap.set(stLabel, { label: stLabel, value: 0 });
    statusStuMap.get(stLabel).value += 1;

    const gLabel = normalizeGenderLabel(s.gender);
    if (!genderStuMap.has(gLabel)) genderStuMap.set(gLabel, { label: gLabel, value: 0 });
    genderStuMap.get(gLabel).value += 1;

    if (isStudentEligibleForDues(s) && s.batchId) {
      batchEnrolledMap.set(s.batchId, (batchEnrolledMap.get(s.batchId) || 0) + 1);
    }
  });

  const admissionsByMonth = Array.from(admMonthMap.values()).sort((a, b) => a.key.localeCompare(b.key));
  const studentsByCourse = Array.from(courseStuMap.values()).sort((a, b) => b.value - a.value);
  const statusColors = { Active: '#16A34A', Completed: '#323A85', Dropped: '#DC2626', Transferred: '#D97706' };
  const studentsByStatus = Array.from(statusStuMap.values())
    .sort((a, b) => b.value - a.value)
    .map((it) => ({ ...it, color: statusColors[it.label] || '#64748B' }));
  const genderColors = { Male: '#323A85', Female: '#0F766E', Other: '#7C3AED', Unspecified: '#94A3B8' };
  const genderSplit = Array.from(genderStuMap.values())
    .sort((a, b) => b.value - a.value)
    .map((it) => ({ ...it, color: genderColors[it.label] || '#64748B' }));

  const batchFilling = (batchesList || [])
    .filter((b) => {
      if (!b || (b.ctx && b.ctx !== 'youth')) return false;
      if (sessId && b.sessionId && b.sessionId !== sessId) return false;
      if (effectiveBranchId !== 'all' && b.branchId !== effectiveBranchId) return false;
      if (batchFilter !== 'all' && b.id !== batchFilter) return false;
      if (courseFilter !== 'all') {
        const cIds = Array.isArray(b.courseIds) ? b.courseIds : (b.courseId ? [b.courseId] : []);
        if (cIds.length && !cIds.includes(courseFilter)) return false;
      }
      return true;
    })
    .map((b) => {
      const enrolled = batchEnrolledMap.get(b.id) || 0;
      const cap = b.capacity !== null && b.capacity !== undefined && b.capacity !== '' ? Number(b.capacity) : 0;
      const br = branchesById[b.branchId] || {};
      const brCode = String(br.code || br.branchCode || '').trim();
      const pct = cap > 0 ? Math.min(100, Math.round((enrolled / cap) * 100)) : 0;
      return {
        batchId: b.id,
        name: b.name || b.id,
        branchShort: brCode || br.name || '',
        enrolled,
        capacity: cap,
        hasCapacity: cap > 0,
        pct,
        isFull: cap > 0 && enrolled >= cap
      };
    })
    .sort((a, b) => (b.isFull ? 1 : 0) - (a.isFull ? 1 : 0) || b.pct - a.pct || b.enrolled - a.enrolled);

  // Section 5: Super Admin Comparison
  let branchComparison = [];
  let sessionComparison = null;
  if (isSuper) {
    const branchStatsMap = new Map();
    (branchesList || []).forEach((b) => {
      if (!b || !b.id || (b.ctx && b.ctx !== 'youth')) return;
      const code = String(b.code || b.branchCode || '').trim();
      const name = toTitleCaseIfCaps(b.name || b.id) || b.id;
      branchStatsMap.set(b.id, {
        branchId: b.id,
        branchCode: code,
        branchName: name,
        label: code ? `${code} - ${name}` : name,
        shortLabel: code || name,
        students: 0,
        collected: 0,
        courseTotal: 0,
        coursePaid: 0,
        outstanding: 0,
        overdue: 0,
        collectionPct: 0
      });
    });

    const brStudentsAll = allSessionStudents.filter((s) => matchesStructStudent(s, true));
    brStudentsAll.forEach((s) => {
      const bId = s.branchId || 'OTHER';
      if (!branchStatsMap.has(bId)) {
        const bCode = s.branchCode || '';
        const bName = toTitleCaseIfCaps(s.branchName || bId);
        branchStatsMap.set(bId, {
          branchId: bId, branchCode: bCode, branchName: bName, label: bCode ? `${bCode} - ${bName}` : bName,
          shortLabel: bCode || bName, students: 0, collected: 0, courseTotal: 0, outstanding: 0, overdue: 0, collectionPct: 0
        });
      }
      const row = branchStatsMap.get(bId);
      row.students += 1;
      if (isNonDroppedStu(s)) {
        row.courseTotal += Number(calculateStudentFinancials(s, []).total || 0);
      }
      if (isStudentEligibleForDues(s)) {
        const fin = calculateStudentFinancials(s, paymentsByStudentId[s.id] || []);
        row.outstanding += Number(fin.outstanding || 0);
      }
    });

    (entries || []).forEach((e) => {
      if (!matchesStructEntry(e, true) || !inDateRange(e.date, effFrom, effTo)) return;
      if (e.isPureWaiver || e.type === 'WA') return;
      const bId = e.branchId || 'OTHER';
      if (!branchStatsMap.has(bId)) return;
      branchStatsMap.get(bId).collected += Number(e.totalReceived || 0);
    });

    rawOverdueItems.forEach((it) => {
      if (batchFilter !== 'all' && it.batchId !== batchFilter) return;
      if (courseFilter !== 'all' && it.courseId !== courseFilter) return;
      const bId = it.branchId || 'OTHER';
      if (!branchStatsMap.has(bId)) return;
      branchStatsMap.get(bId).overdue += Number(it.amount || 0);
    });

    branchComparison = Array.from(branchStatsMap.values())
      .map((r) => ({
        ...r,
        collectionPct: r.courseTotal > 0 ? Math.min(100, Math.round((r.collected / r.courseTotal) * 1000) / 10) : (r.collected > 0 ? 100 : 0)
      }))
      .sort((a, b) => b.collected - a.collected || b.students - a.students);

    // Session comparison uses the exact same filtered dataset for Current Session so KPI and Session Comparison match identically.
    const curSessRow = {
      sessionId: activeSession?.id || 'curr',
      label: activeSession?.name || 'Current Session',
      tag: 'Current',
      students: scopedStudents.length,
      collected: paySummary.totalCollected,
      dues: totalOutstanding,
      overdue: pendingSummary.overdueAmount
    };
    let prevSessRow = null;
    if (prevSession) {
      const pEntries = (entries || []).filter((e) => (
        (!e.ctx || e.ctx === 'youth')
        && e.sessionId === prevSession.id
        && (effectiveBranchId === 'all' || e.branchId === effectiveBranchId)
        && (courseFilter === 'all' || e.courseId === courseFilter)
      ));
      const pPay = summarizePaymentLedger(pEntries);
      const pStus = Object.values(prevPendingReport?.studentsById || {}).filter((s) => (
        s && (!s.ctx || s.ctx === 'youth')
        && (effectiveBranchId === 'all' || s.branchId === effectiveBranchId)
        && (courseFilter === 'all' || s.courseId === courseFilter)
      ));
      const pPayMap = prevPendingReport?.paymentsByStudentId || {};
      let pOut = 0;
      pStus.filter(isStudentEligibleForDues).forEach((ps) => {
        pOut += Number(calculateStudentFinancials(ps, pPayMap[ps.id] || []).outstanding || 0);
      });
      const pOv = summarizePendingItems(
        filterOverdueItems(prevPendingReport?.items || [], prevSession.endDate || asOfDate).filter((it) => (
          (effectiveBranchId === 'all' || it.branchId === effectiveBranchId)
          && (courseFilter === 'all' || it.courseId === courseFilter)
        )),
        prevSession.endDate || asOfDate
      );
      prevSessRow = {
        sessionId: prevSession.id,
        label: prevSession.name || 'Previous Session',
        tag: 'Previous',
        students: pStus.length,
        collected: pPay.totalCollected,
        dues: pOut,
        overdue: pOv.overdueAmount
      };
    }
    sessionComparison = { current: curSessRow, previous: prevSessRow };
  }

  return {
    kpis,
    money: {
      useDailyTrend,
      trendPoints,
      modeSlices,
      feeTypeSlices,
      totalCollected: paySummary.totalCollected,
      staffRows
    },
    dues: {
      byBranch: Array.from(duesByBranch.values()).sort((a, b) => b.outstanding - a.outstanding),
      byBatch: Array.from(duesByBatch.values()).sort((a, b) => b.outstanding - a.outstanding),
      byCourse: Array.from(duesByCourse.values()).sort((a, b) => b.outstanding - a.outstanding),
      ageingSlices: Object.values(ageingBuckets).filter((b) => b.value > 0).map((b) => ({
        label: b.label, value: b.value, color: b.color, sub: `${b.count} item${b.count === 1 ? '' : 's'}`
      })),
      overdueTotal: pendingSummary.overdueAmount,
      studentsWithBalanceCount
    },
    students: {
      totalCount: scopedStudents.length,
      activeCount: activeStudents.length,
      admissionsByMonth,
      byCourse: studentsByCourse,
      byStatus: studentsByStatus,
      batchFilling,
      genderSplit
    },
    comparison: {
      branchComparison,
      sessionComparison
    }
  };
}

export { formatINR, fmtDate, todayISO };
