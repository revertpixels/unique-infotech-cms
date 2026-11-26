// report.service.js — Shared data loading, caching, ledger normalization, and export
// helpers for Pending & Overdue and Payment History (Youth Centre & Unique Kids).
// All fee/fine/balance maths delegate to payment.service.js, session-rules.js,
// and school-billing.js (single source of truth).

import { db } from '../config/firebase-config.js';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  evaluateYouthStudentDues,
  normalizeYouthPaymentsLedger,
  fetchStudentPayments
} from './payment.service.js?v=1.8.174';
import {
  evaluateKidsPendingBills,
  buildKidsPaymentLedger
} from '../utils/school-billing.js?v=1.8.174';
import { getStudentPhotoSrc } from '../utils/student-media.js?v=1.8.174';
import {
  todayISO,
  fmtDate,
  getOrgTimezone
} from '../utils/session-rules.js?v=1.8.174';
import { formatINR } from '../utils/formatter.js?v=1.8.174';
import { formatPersonName } from '../utils/formatter.js?v=1.8.174';
import { resolveUserDisplay, loadUsersDirectory } from './user-directory.service.js?v=1.8.174';

const CACHE_KEY = 'financialReports';

function ensureCacheRoot() {
  window.APP_CACHE = window.APP_CACHE || {};
  if (!window.APP_CACHE[CACHE_KEY]) {
    window.APP_CACHE[CACHE_KEY] = {
      meta: null,
      studentsById: new Map(),
      photos: new Map(),
      youthPending: new Map(),
      kidsPending: null,
      youthHistory: new Map(),
      kidsHistory: null,
      billsById: new Map()
    };
  }
  return window.APP_CACHE[CACHE_KEY];
}

export function invalidateFinancialCache({ clearMeta = false } = {}) {
  const root = ensureCacheRoot();
  if (clearMeta) root.meta = null;
  root.youthPending.clear();
  root.kidsPending = null;
  root.youthHistory.clear();
  root.kidsHistory = null;
  root.billsById.clear();
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

/**
 * Loads session-cached reference metadata (branches, courses, batches, and user display names).
 * Avoids repeated Firestore reads when switching filters or navigating between financial pages.
 */
export async function ensureReferenceData({ forceRefresh = false, profile = null } = {}) {
  const root = ensureCacheRoot();
  const roleKey = `${profile?.role || 'anon'}::${profile?.branchId || ''}`;
  if (root.meta && root.meta._roleKey === roleKey && !forceRefresh) {
    return { ...root.meta, readCount: 0 };
  }

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
    branchesList: branches.list,
    branchesById: branches.byId,
    coursesList: courses.list,
    coursesById: courses.byId,
    batchesList: batches.list,
    batchesById: batches.byId,
    usersByEmail
  };
  root.meta = meta;
  return { ...meta, readCount };
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

/**
 * Loads Pending & Overdue dues for Youth Centre (session + role branch scoped).
 */
export async function loadYouthPendingReport({
  profile,
  session,
  forceRefresh = false,
  asOfDate = todayISO()
} = {}) {
  const meta = await ensureReferenceData({ forceRefresh, profile });
  let readCount = meta.readCount || 0;

  if (!session || !session.id) {
    return {
      ctx: 'youth',
      items: [],
      studentsById: {},
      paymentsByStudentId: {},
      summary: summarizePendingItems([], asOfDate),
      readCount,
      asOfDate,
      fromCache: false
    };
  }

  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const cacheKey = `${session.id}::${isBranchHead ? profile.branchId : 'ALL'}::${asOfDate}`;
  const root = ensureCacheRoot();
  if (!forceRefresh && root.youthPending.has(cacheKey)) {
    const cached = root.youthPending.get(cacheKey);
    return { ...cached, readCount, fromCache: true };
  }

  const constraints = [
    where('ctx', '==', 'youth'),
    where('sessionId', '==', session.id)
  ];
  if (isBranchHead) {
    constraints.push(where('branchId', '==', profile.branchId));
  }

  const stSnap = await getDocs(query(collection(db, 'students'), ...constraints));
  readCount += stSnap.size;

  const studentsById = {};
  const activeStudents = [];
  stSnap.docs.forEach((d) => {
    const s = { id: d.id, ...d.data() };
    root.studentsById.set(s.id, s);
    studentsById[s.id] = s;
    if (s.status === 'active') activeStudents.push(s);
  });

  const paymentsByStudentId = {};
  const allItems = [];

  await runInChunks(activeStudents, 10, async (s) => {
    const payments = await fetchStudentPayments(s.id);
    readCount += Math.max(1, payments.length);
    paymentsByStudentId[s.id] = payments;

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

  const payload = {
    ctx: 'youth',
    items: allItems,
    studentsById,
    paymentsByStudentId,
    summary: summarizePendingItems(allItems, asOfDate),
    readCount,
    asOfDate,
    fromCache: false
  };
  root.youthPending.set(cacheKey, payload);
  return payload;
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
  // Also invalidate Youth Payment History cache so switching tabs shows the newly recorded receipt.
  root.youthHistory.clear();
  return existing;
}

/**
 * Loads Pending & Overdue dues for Unique Kids (active students + unpaid/partial bills + approved breaks).
 */
export async function loadKidsPendingReport({
  profile = null,
  forceRefresh = false,
  asOfDate = todayISO()
} = {}) {
  const meta = await ensureReferenceData({ forceRefresh, profile });
  let readCount = meta.readCount || 0;

  const root = ensureCacheRoot();
  if (!forceRefresh && root.kidsPending && root.kidsPending.asOfDate === asOfDate) {
    return { ...root.kidsPending, readCount, fromCache: true };
  }

  const [stSnap, billsSnap, brkSnap] = await Promise.all([
    getDocs(query(collection(db, 'students'), where('ctx', '==', 'school'))),
    getDocs(query(collection(db, 'bills'), where('status', 'in', ['unpaid', 'partial']))),
    getDocs(query(collection(db, 'breaks'), where('status', '==', 'approved')))
  ]);

  readCount += stSnap.size + billsSnap.size + brkSnap.size;

  const students = stSnap.docs.map((d) => {
    const s = { id: d.id, ...d.data() };
    root.studentsById.set(s.id, s);
    return s;
  });
  const studentsById = {};
  students.forEach((s) => { studentsById[s.id] = s; });

  const bills = billsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const breaks = brkSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
export async function loadYouthPaymentHistory({
  profile,
  dateFrom = '',
  dateTo = '',
  cursor = null,
  pageSize = 60,
  loadAll = !cursor,
  maxBatches = 50,
  forceRefresh = false,
  existingState = null
} = {}) {
  const meta = await ensureReferenceData({ forceRefresh, profile });
  let readCount = meta.readCount || 0;
  const root = ensureCacheRoot();
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;
  const cacheKey = `${isBranchHead ? profile.branchId : 'SUPER'}::${dateFrom || ''}::${dateTo || ''}`;

  if (!cursor && !forceRefresh && root.youthHistory.has(cacheKey)) {
    const cached = root.youthHistory.get(cacheKey);
    return { ...cached, readCount, fromCache: true };
  }

  // Branch Head flow (cannot run collectionGroup query due to parent-get security rule)
  if (isBranchHead) {
    const stSnap = await getDocs(query(
      collection(db, 'students'),
      where('ctx', '==', 'youth'),
      where('branchId', '==', profile.branchId)
    ));
    readCount += stSnap.size;
    const studentsById = {};
    const studentsList = stSnap.docs.map((d) => {
      const s = { id: d.id, ...d.data() };
      root.studentsById.set(s.id, s);
      studentsById[s.id] = s;
      return s;
    });

    const rawPayments = [];
    await runInChunks(studentsList, 10, async (s) => {
      const pSnap = await getDocs(collection(db, 'students', s.id, 'payment'));
      readCount += Math.max(1, pSnap.size);
      pSnap.docs.forEach((pd) => {
        const data = pd.data() || {};
        const dStr = String(data.date || data.paidOn || '').slice(0, 10);
        if (dateFrom && dStr < dateFrom) return;
        if (dateTo && dStr > dateTo) return;
        rawPayments.push({
          id: pd.id,
          studentDocId: s.id,
          ...data
        });
      });
    });

    const entries = normalizeYouthPaymentsLedger(rawPayments, studentsById, {
      branchesById: meta.branchesById,
      coursesById: meta.coursesById,
      requireParentStudent: true
    }).map((entry) => enrichLedgerEntry(entry, meta, studentsById[entry.studentDocId]));

    const payload = {
      org: 'youth',
      entries,
      rawByPath: {},
      lastCursor: null,
      hasMore: false,
      readCount,
      fromCache: false
    };
    root.youthHistory.set(cacheKey, payload);
    return payload;
  }

  // Super Admin paginated collectionGroup('payment') ordered by date desc in batches of 60.
  // When loadAll is true (default), fetch all batches of 60 before summarizing & paging so
  // summary cards, older sessions, total counts, and last page numbers are always exact.
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
          const dStr = String(pd.data()?.date || pd.data()?.paidOn || '').slice(0, 10);
          if (dateFrom && dStr < dateFrom) return;
          if (dateTo && dStr > dateTo) return;
          rawByPath[`${tailSid}/${pd.id}`] = {
            id: pd.id,
            studentDocId: tailSid,
            ...pd.data()
          };
        });
      }
    }
  } while (loadAll && hasMore && batches < maxBatches);

  // Fetch any missing parent students (and cache them for subsequent views).
  const missingStudentIds = Array.from(touchedStudentIds).filter((sid) => !root.studentsById.has(sid));
  if (missingStudentIds.length) {
    await runInChunks(missingStudentIds, 10, async (sid) => {
      try {
        const snap = await getDoc(doc(db, 'students', sid));
        readCount += 1;
        root.studentsById.set(sid, snap.exists() ? { id: snap.id, ...snap.data() } : null);
      } catch (_) {
        root.studentsById.set(sid, null);
      }
    });
  }

  const studentsById = {};
  Object.values(rawByPath).forEach((p) => {
    const st = root.studentsById.get(p.studentDocId);
    if (st && st.ctx === 'youth') studentsById[p.studentDocId] = st;
  });

  const validRawList = Object.values(rawByPath).filter((p) => Boolean(studentsById[p.studentDocId]));
  const entries = normalizeYouthPaymentsLedger(validRawList, studentsById, {
    branchesById: meta.branchesById,
    coursesById: meta.coursesById,
    requireParentStudent: true
  }).map((entry) => enrichLedgerEntry(entry, meta, studentsById[entry.studentDocId]));

  const payload = {
    org: 'youth',
    entries,
    rawByPath,
    lastCursor: cur,
    hasMore,
    readCount,
    fromCache: false
  };
  if (!cursor) {
    root.youthHistory.set(cacheKey, payload);
  }
  return payload;
}

/**
 * Loads Unique Kids Payment History (admission receipts + monthly payments + waivers).
 */
export async function loadKidsPaymentHistory({
  profile = null,
  dateFrom = '',
  dateTo = '',
  forceRefresh = false
} = {}) {
  const meta = await ensureReferenceData({ forceRefresh, profile });
  let readCount = meta.readCount || 0;
  const root = ensureCacheRoot();

  if (!forceRefresh && root.kidsHistory) {
    const filtered = filterEntriesByDate(root.kidsHistory.entries, dateFrom, dateTo);
    return {
      ...root.kidsHistory,
      entries: filtered,
      allEntriesCount: root.kidsHistory.entries.length,
      readCount,
      fromCache: true
    };
  }

  const [stSnap, paySnap, wavSnap] = await Promise.all([
    getDocs(query(collection(db, 'students'), where('ctx', '==', 'school'))),
    getDocs(collection(db, 'payments')),
    getDocs(collection(db, 'waivers'))
  ]);
  readCount += stSnap.size + paySnap.size + wavSnap.size;

  const students = stSnap.docs.map((d) => {
    const s = { id: d.id, ...d.data() };
    root.studentsById.set(s.id, s);
    return s;
  });
  const studentsById = {};
  students.forEach((s) => { studentsById[s.id] = s; });

  const paymentsDocs = paySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const waiversDocs = wavSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Kids admission receipts live at students/{id}/payment/payment (1 doc per admitted student).
  const admissionPayments = [];
  await runInChunks(students, 10, async (s) => {
    try {
      const snap = await getDoc(doc(db, 'students', s.id, 'payment', 'payment'));
      readCount += 1;
      if (snap.exists()) {
        admissionPayments.push({ id: snap.id, studentDocId: s.id, ...snap.data() });
      }
    } catch (_) {
      // Ignore missing permission/doc
    }
  });

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
    hasMore: false,
    lastCursor: null,
    readCount,
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
  if (entry.isPureWaiver || raw === 'waiver') return MODE_META.waiver;
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
      email,
      collectorName,
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

function escHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Opens a clean print-formatted window for Overdue Report or Daily Cash Report.
 */
export function openPrintSheet({
  title = 'Report',
  subtitle = '',
  summaryPairs = [],
  columns = [],
  rows = [],
  footerNote = ''
} = {}) {
  const win = window.open('', '_blank', 'width=1024,height=740');
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

  const summaryHtml = summaryPairs.length
    ? `<div class="pr-summary">${summaryPairs.map((p) => (
      `<div class="pr-box"><div class="pr-k">${escHtml(p.label)}</div><div class="pr-v">${escHtml(p.value)}</div></div>`
    )).join('')}</div>`
    : '';

  const thHtml = columns.map((c) => `<th class="${c.num ? 'num' : ''}">${escHtml(c.label)}</th>`).join('');
  const bodyHtml = rows.map((r) => (
    `<tr>${r.map((cell, idx) => `<td class="${columns[idx]?.num ? 'num' : ''}">${escHtml(cell)}</td>`).join('')}</tr>`
  )).join('');

  win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escHtml(title)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap');
  * { box-sizing: border-box; }
  body { margin: 24px; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #171717; background: #FFFFFF; font-size: 12px; }
  .pr-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #323A85; padding-bottom: 12px; margin-bottom: 16px; }
  .pr-brand { font-size: 18px; font-weight: 800; color: #323A85; letter-spacing: -0.01em; }
  .pr-sub { font-size: 12px; color: #525252; margin-top: 3px; }
  .pr-meta { text-align: right; font-size: 11px; color: #6B6B6B; line-height: 1.5; }
  .pr-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .pr-box { border: 1px solid #EAEAEA; border-radius: 8px; padding: 10px 12px; background: #F6F6F8; }
  .pr-k { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #6B6B6B; letter-spacing: .05em; }
  .pr-v { font-size: 15px; font-weight: 800; color: #171717; margin-top: 3px; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #EAEAEA; padding: 7px 9px; text-align: left; vertical-align: top; }
  th { background: #EEF0FA; font-size: 10.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: #323A85; }
  tbody tr:nth-child(even) td { background: #FAFAFC; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pr-foot { margin-top: 14px; padding-top: 10px; border-top: 1px solid #EAEAEA; font-size: 11px; color: #6B6B6B; display: flex; justify-content: space-between; }
  @media print {
    body { margin: 12px; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="pr-head">
    <div>
      <div class="pr-brand">${escHtml(title)}</div>
      <div class="pr-sub">${escHtml(subtitle)}</div>
    </div>
    <div class="pr-meta">
      <div>Generated: ${escHtml(generatedAt)} (${escHtml(tz)})</div>
      <div>Report date: ${escHtml(fmtDate(todayISO()))}</div>
    </div>
  </div>
  ${summaryHtml}
  <table>
    <thead><tr>${thHtml}</tr></thead>
    <tbody>${bodyHtml || `<tr><td colspan="${columns.length}" style="text-align:center;padding:18px;color:#64748B;">No rows to print</td></tr>`}</tbody>
  </table>
  <div class="pr-foot">
    <span>${escHtml(footerNote || 'Unique Infotech CMS')}</span>
    <span>Rows: ${rows.length}</span>
  </div>
  <script>window.addEventListener('load', () => setTimeout(() => window.print(), 250));</script>
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

export function getPaymentDatePresetOptions(ctx = 'youth') {
  const isSchool = ctx === 'school';
  const opts = [
    { value: 'all', label: 'All dates (recent)', icon: 'calendar' },
    { value: 'today', label: 'Today', icon: 'calendar-check' },
    { value: 'week', label: 'This week', icon: 'calendar-days' },
    { value: 'month', label: 'This month', icon: 'calendar-range' }
  ];
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

export { formatINR, fmtDate, todayISO };
