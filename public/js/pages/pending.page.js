// pending.page.js — Shared Overdue Payments view for Youth Centre (#/pending) & Unique Kids (#/school-pending).
// Matches payments.page.js layout (no inner scroll, shared 10-row pager, short codes, icon actions, details popup).

import { createSelect } from '../components/ui-select.js?v=1.8.200';
import { createBranchBatchFilter, clearPersistedBranchBatchFilters } from '../components/branch-batch-filter.js?v=1.8.200';
import { openPopup } from '../components/modal.js?v=1.8.200';
import { showToast } from '../components/toast.js?v=1.8.200';
import { renderPager, renderEmptyTableState, PAGE_SIZE } from '../components/list-page.js?v=1.8.200';
import { openPaymentPopup } from '../components/payment-popup.js?v=1.8.200';
import {
  getCachedSessions,
  loadSessions,
  getSelectedSession,
  hasFreshSessionsCache
} from '../core/sessions.js?v=1.8.200';
import {
  ensureReferenceData,
  getCachedReferenceData,
  scopeReferenceDataByCtx,
  filterOverdueItems,
  getDaysLateFilterOptions,
  matchesDaysLateFilter,
  buildOverdueDetailsModel,
  loadYouthPendingReport,
  getCachedYouthPending,
  loadKidsPendingReport,
  getCachedKidsPending,
  refreshSingleYouthPendingStudent,
  loadStudentPhotos,
  getCachedStudentPhoto,
  summarizePendingItems,
  isCacheStale,
  scheduleDelayedSkeleton,
  formatCourseBranchDisplay,
  formatCourseAndBranch,
  toTitleCaseIfCaps,
  downloadCsv,
  openPrintSheet,
  formatINR,
  fmtDate,
  todayISO
} from '../services/report.service.js?v=1.8.200';
import { initials } from '../utils/formatter.js?v=1.8.200';

let state = null;
let sessionListener = null;
let sessionsLoadedListener = null;
let sessionsChangedListener = null;
let lastMountedCtx = null;

function $(id) {
  return document.getElementById(id);
}

function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function showSkeleton() {
  const foot = $('pend-foot');
  if (foot) foot.hidden = true;
  const stats = $('pend-stats');
  if (stats) {
    stats.classList.add('is-loading');
    stats.querySelectorAll('.lp-stat-value').forEach((el) => {
      el.textContent = '';
      el.classList.add('skel');
    });
  }
  const tbody = $('pend-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const widths = ['w-long', 'w-med', 'w-med', 'w-date', 'w-short', 'w-short', 'w-short', 'w-act'];
  for (let i = 0; i < 6; i++) {
    const tr = mk('tr', 'adm-sk-row');
    widths.forEach((cls) => {
      const td = mk('td');
      td.appendChild(mk('div', 'adm-sk-cell skel ' + cls));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

function hideSkeleton() {
  const stats = $('pend-stats');
  if (!stats) return;
  stats.classList.remove('is-loading');
  stats.querySelectorAll('.lp-stat-value').forEach((el) => el.classList.remove('skel'));
}

function resolveActiveYouthSession() {
  if (!state) return null;
  const cached = getCachedSessions('youth');
  if (cached.length) state.sessions = cached;
  return getSelectedSession('youth') || state.sessions[0] || null;
}

function updateSubtitle(activeSess) {
  const sub = $('pend-subtitle');
  if (!sub) return;
  if (state.ctx === 'school') {
    sub.textContent = 'Unique Kids — Past-due monthly fees awaiting collection.';
    return;
  }
  if (activeSess) {
    sub.textContent = `Session ${activeSess.name} — Overdue installments and late fees past their due date.`;
  } else {
    sub.textContent = 'Youth Centre — Overdue installments and late fees past their due date.';
  }
}

function toggleNoSessionState(show) {
  $('pend-no-session').hidden = !show;
  $('pend-stats').hidden = show;
  $('pend-toolbar').hidden = show;
  $('pend-table-card').hidden = show;
  if (show && typeof lucide !== 'undefined') lucide.createIcons();
}

export async function mount({ container, profile, ctx }) {
  const role = profile?.role || '';
  if (!['superadmin', 'branch_head', 'school_head'].includes(role)) {
    const stats = $('pend-stats');
    const tb = $('pend-toolbar');
    const scrollWrap = $('pend-scroll-wrap');
    const footBar = $('pend-foot');
    const errBox = $('pend-error');
    const retryBtn = $('pend-retry');
    if (stats) stats.hidden = true;
    if (tb) tb.hidden = true;
    if (scrollWrap) scrollWrap.hidden = true;
    if (footBar) footBar.hidden = true;
    if (retryBtn) retryBtn.hidden = true;
    if (errBox) {
      errBox.hidden = false;
      const h3 = errBox.querySelector('h3');
      if (h3) h3.textContent = 'Access denied';
      const msg = $('pend-error-msg');
      if (msg) msg.textContent = 'Your account does not have permission to view overdue payments.';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  const isBranchHead = role === 'branch_head';
  const isSchoolHead = role === 'school_head';
  let activeCtx = ctx === 'school' ? 'school' : 'youth';
  if (isBranchHead) activeCtx = 'youth';
  if (isSchoolHead) activeCtx = 'school';

  // Clear persisted branch/batch filters when switching Programme (Youth <-> Unique Kids).
  if (lastMountedCtx && lastMountedCtx !== activeCtx) {
    clearPersistedBranchBatchFilters('pending.');
  }
  lastMountedCtx = activeCtx;

  state = {
    profile,
    ctx: activeCtx,
    meta: null,
    sessions: getCachedSessions('youth'),
    activeSession: null,
    filters: {
      search: '',
      daysLate: 'all',
      courseId: 'all',
      sort: 'daysLate_desc'
    },
    bbFilter: null,
    selects: {},
    report: null,
    filteredItems: [],
    page: 1,
    loading: false,
    destroyed: false
  };

  const isSchool = activeCtx === 'school';
  $('pend-crumb-ctx').textContent = isSchool ? 'Unique Kids' : 'Youth Centre';
  $('pend-title').textContent = isSchool
    ? 'Unique Kids — Pending & Overdue'
    : 'Youth Centre — Pending & Overdue';
  $('pend-course-label').textContent = isSchool ? 'Level' : 'Course';
  const searchInp = $('pend-search');
  if (searchInp) {
    searchInp.placeholder = isSchool
      ? 'Search student name, ID, phone or level'
      : 'Search student name, ID, phone or course';
  }
  const cbTh = $('pend-th-cb');
  if (cbTh) cbTh.textContent = isSchool ? 'Level, Branch & Batch' : 'Course, Branch & Batch';
  const itemTh = $('pend-th-item');
  if (itemTh) itemTh.textContent = isSchool ? 'Bill' : 'Installment';
  const moreBtn = $('pend-more-btn');
  if (moreBtn) {
    moreBtn.title = isSchool ? 'Level & Sort filters' : 'Course & Sort filters';
  }

  const brBadge = $('pend-branch-badge');
  if (isBranchHead && brBadge) {
    brBadge.hidden = false;
    brBadge.textContent = `Branch: ${profile.branchName || profile.branchId || '-'}`;
  } else if (isSchoolHead && brBadge) {
    brBadge.hidden = false;
    brBadge.textContent = 'Scope: Unique Kids';
  }

  $('pend-asof-note').textContent = `As of ${fmtDate(todayISO())} (IST)`;

  initControls();
  bindEvents();

  await bootstrapData({ forceRefresh: false });
}

function initControls() {
  const isSchool = state.ctx === 'school';

  state.bbFilter = createBranchBatchFilter($('pend-bb-host'), {
    persistKey: `pending.${state.ctx}`,
    profile: state.profile,
    ctx: state.ctx,
    sessionId: '',
    branches: [],
    batches: [],
    onChange: () => {
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.daysLate = createSelect($('pend-days-host'), {
    options: getDaysLateFilterOptions(),
    value: 'all',
    ariaLabel: 'Days late',
    onChange: (val) => {
      state.filters.daysLate = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.course = createSelect($('pend-course-host'), {
    options: [{ value: 'all', label: isSchool ? 'All levels' : 'All courses', icon: 'book-open' }],
    value: 'all',
    ariaLabel: isSchool ? 'Level' : 'Course',
    onChange: (val) => {
      state.filters.courseId = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.sort = createSelect($('pend-sort-host'), {
    options: [
      { value: 'daysLate_desc', label: 'Days late (high)', icon: 'arrow-down-wide-narrow' },
      { value: 'daysLate_asc', label: 'Days late (low)', icon: 'arrow-up-narrow-wide' },
      { value: 'amount_desc', label: 'Total due (high)', icon: 'indian-rupee' },
      { value: 'amount_asc', label: 'Total due (low)', icon: 'indian-rupee' },
      { value: 'dueDate_asc', label: 'Due date (oldest)', icon: 'calendar' },
      { value: 'name_asc', label: 'Name (A-Z)', icon: 'arrow-up-a-z' }
    ],
    value: 'daysLate_desc',
    ariaLabel: 'Sort order',
    onChange: (val) => {
      state.filters.sort = val || 'daysLate_desc';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  syncSortHeaders();
}

function syncSortHeaders() {
  const sort = state?.filters?.sort || 'daysLate_desc';
  const dueBtn = $('pend-sort-due');
  const totBtn = $('pend-sort-total');

  if (dueBtn) {
    const dueActive = sort === 'daysLate_desc' || sort === 'daysLate_asc';
    dueBtn.classList.toggle('is-active', dueActive);
    dueBtn.title = sort === 'daysLate_desc' ? 'Sorted by most days late (click to reverse)' : 'Sort by days late';
    const ic = dueBtn.querySelector('svg, i');
    if (ic) ic.setAttribute('data-lucide', sort === 'daysLate_asc' ? 'arrow-up' : (sort === 'daysLate_desc' ? 'arrow-down' : 'arrow-up-down'));
  }

  if (totBtn) {
    const totActive = sort === 'amount_desc' || sort === 'amount_asc';
    totBtn.classList.toggle('is-active', totActive);
    totBtn.title = sort === 'amount_desc' ? 'Sorted by highest total due (click to reverse)' : 'Sort by total due';
    const ic = totBtn.querySelector('svg, i');
    if (ic) ic.setAttribute('data-lucide', sort === 'amount_asc' ? 'arrow-up' : (sort === 'amount_desc' ? 'arrow-down' : 'arrow-up-down'));
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function bindEvents() {
  const searchInput = $('pend-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.filters.search = (searchInput.value || '').trim().toLowerCase();
      state.page = 1;
      applyFiltersAndRender();
    });
  }

  $('pend-mobile-filters-btn')?.addEventListener('click', () => {
    const tb = $('pend-toolbar');
    const btn = $('pend-mobile-filters-btn');
    const open = tb.classList.toggle('is-filters-open');
    btn?.setAttribute('aria-expanded', String(open));
    if (!open) {
      const extra = $('pend-extra-filters');
      const moreBtn = $('pend-more-btn');
      if (extra) extra.hidden = true;
      if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
    }
  });

  $('pend-more-btn')?.addEventListener('click', () => {
    const extra = $('pend-extra-filters');
    const btn = $('pend-more-btn');
    if (!extra || !btn) return;
    extra.hidden = !extra.hidden;
    btn.setAttribute('aria-expanded', String(!extra.hidden));
  });

  $('pend-sort-due')?.addEventListener('click', () => {
    if (!state) return;
    const next = state.filters.sort === 'daysLate_desc' ? 'daysLate_asc' : 'daysLate_desc';
    state.filters.sort = next;
    state.selects.sort?.setValue(next);
    state.page = 1;
    applyFiltersAndRender();
  });

  $('pend-sort-total')?.addEventListener('click', () => {
    if (!state) return;
    const next = state.filters.sort === 'amount_desc' ? 'amount_asc' : 'amount_desc';
    state.filters.sort = next;
    state.selects.sort?.setValue(next);
    state.page = 1;
    applyFiltersAndRender();
  });

  $('pend-clear-filters')?.addEventListener('click', () => resetAllFilters());

  $('pend-refresh')?.addEventListener('click', async () => {
    await loadActiveReport({ forceRefresh: true });
    showToast({ type: 'success', message: 'Overdue fees refreshed.' });
  });

  $('pend-retry')?.addEventListener('click', () => loadActiveReport({ forceRefresh: true }));
  $('pend-export-csv')?.addEventListener('click', handleExportCsv);
  $('pend-print')?.addEventListener('click', handlePrint);

  const onSessionSwitch = async (explicit = false) => {
    if (!state || state.destroyed || state.ctx !== 'youth') return;
    const prevSessId = state.activeSession?.id || '';
    state.activeSession = resolveActiveYouthSession();
    updateSubtitle(state.activeSession);
    if (!state.activeSession) {
      toggleNoSessionState(true);
      return;
    }
    toggleNoSessionState(false);

    const changed = explicit || (prevSessId && state.activeSession.id !== prevSessId);
    if (changed) {
      clearPersistedBranchBatchFilters('pending.');
      resetAllFilters({ skipRender: true });
    }
    syncBranchBatchContext();
    state.page = 1;
    await loadActiveReport({ forceRefresh: false });
  };

  sessionListener = () => { onSessionSwitch(true); };
  sessionsLoadedListener = () => { onSessionSwitch(false); };
  sessionsChangedListener = async () => {
    if (!state || state.destroyed || state.ctx !== 'youth') return;
    state.sessions = await loadSessions('youth');
    onSessionSwitch(false);
  };
  window.addEventListener('uic:session-selected', sessionListener);
  window.addEventListener('uic:sessions-loaded', sessionsLoadedListener);
  window.addEventListener('uic:sessions-changed', sessionsChangedListener);
}

function resetAllFilters({ skipRender = false } = {}) {
  if (!state) return;
  const searchInput = $('pend-search');
  state.filters.search = '';
  if (searchInput) searchInput.value = '';
  state.bbFilter?.reset();
  state.filters.daysLate = 'all';
  state.selects.daysLate?.setValue('all');
  state.filters.courseId = 'all';
  state.selects.course?.setValue('all');
  state.filters.sort = 'daysLate_desc';
  state.selects.sort?.setValue('daysLate_desc');
  state.page = 1;
  if (!skipRender) applyFiltersAndRender();
}

function syncBranchBatchContext() {
  if (!state || !state.bbFilter) return;
  const scoped = scopeReferenceDataByCtx(state.meta || {}, state.ctx);
  state.bbFilter.updateData({
    ctx: state.ctx,
    sessionId: state.ctx === 'youth' ? (state.activeSession?.id || '') : '',
    branches: scoped.branchesList,
    batches: scoped.batchesList,
    courses: scoped.coursesList
  });
}

function pendingSignature(rep) {
  return `${rep?.items?.length || 0}|${rep?.summary?.overdueAmount || 0}`;
}

async function bootstrapData({ forceRefresh = false, deltaRefresh = false, background = false } = {}) {
  if (!state || state.destroyed) return;

  if (!forceRefresh && !deltaRefresh && state.ctx === 'school') {
    const cachedMeta = getCachedReferenceData(state.profile);
    const cachedReport = getCachedKidsPending();
    if (cachedMeta && cachedReport) {
      state.meta = cachedMeta;
      state.sessions = [];
      state.activeSession = null;
      updateSubtitle(null);
      populateCourseOptions();
      syncBranchBatchContext();
      state.report = cachedReport;
      hideSkeleton();
      toggleNoSessionState(false);
      applyFiltersAndRender();
      if (!background && (isCacheStale(cachedMeta) || isCacheStale(cachedReport))) {
        bootstrapData({ forceRefresh: false, deltaRefresh: true, background: true }).catch(() => {});
      }
      return;
    }
  }

  if (!forceRefresh && !deltaRefresh && state.ctx === 'youth') {
    const cachedMeta = getCachedReferenceData(state.profile);
    const cachedSessions = getCachedSessions('youth');
    if (cachedMeta && (cachedSessions.length || hasFreshSessionsCache('youth'))) {
      state.meta = cachedMeta;
      state.sessions = cachedSessions;
      state.activeSession = resolveActiveYouthSession();
      updateSubtitle(state.activeSession);
      populateCourseOptions();
      syncBranchBatchContext();

      if (!state.activeSession) {
        hideSkeleton();
        toggleNoSessionState(true);
        if (isCacheStale(cachedMeta) || !hasFreshSessionsCache('youth')) {
          bootstrapData({ forceRefresh: true, background: true }).catch(() => {});
        }
        return;
      }

      const cachedReport = getCachedYouthPending({ profile: state.profile, session: state.activeSession });
      if (cachedReport) {
        state.report = cachedReport;
        hideSkeleton();
        toggleNoSessionState(false);
        applyFiltersAndRender();
        // Always revalidate Pending & Overdue cleanly via updatedAt delta query (1 read if unchanged).
        if (!background) {
          bootstrapData({ forceRefresh: false, deltaRefresh: true, background: true }).catch(() => {});
        }
        return;
      }
    }
  }

  const skelTask = (!state.report && !background)
    ? scheduleDelayedSkeleton(() => {
      if (state && !state.destroyed && !state.report) showSkeleton();
    }, state.ctx === 'school' ? 300 : 250)
    : null;

  try {
    const [meta, sessions] = await Promise.all([
      ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile: state.profile }),
      state.ctx === 'youth'
        ? ((!forceRefresh && hasFreshSessionsCache('youth'))
          ? Promise.resolve(getCachedSessions('youth'))
          : loadSessions('youth', { forceRefresh }))
        : Promise.resolve([])
    ]);
    if (!state || state.destroyed) return;
    state.meta = meta;
    state.sessions = sessions;
    state.activeSession = state.ctx === 'youth' ? resolveActiveYouthSession() : null;

    if (!background) {
      updateSubtitle(state.activeSession);
      populateCourseOptions();
      syncBranchBatchContext();
    }

    if (state.ctx === 'youth' && !state.activeSession) {
      if (skelTask) skelTask.cancel();
      hideSkeleton();
      toggleNoSessionState(true);
      return;
    }
    toggleNoSessionState(false);
    await loadActiveReport({ forceRefresh, deltaRefresh, background, skelTask });
  } catch (err) {
    if (skelTask) skelTask.cancel();
    if (!background) {
      console.error('[pending] bootstrap error', err);
      showLoadError(err);
    }
  }
}

function populateCourseOptions() {
  const scoped = scopeReferenceDataByCtx(state.meta || {}, state.ctx);
  const courseOpts = [{ value: 'all', label: state.ctx === 'school' ? 'All levels' : 'All courses', icon: 'book-open' }]
    .concat(
      scoped.coursesList
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((c) => ({ value: c.id, label: c.name || c.code || c.id, icon: 'book-open' }))
    );
  state.selects.course.setOptions(courseOpts);
}

async function loadActiveReport({ forceRefresh = false, deltaRefresh = false, background = false, skelTask = null } = {}) {
  if (!state || state.destroyed) return;
  if (state.ctx === 'youth' && !state.activeSession) {
    toggleNoSessionState(true);
    return;
  }

  const refreshBtn = $('pend-refresh');
  const errBox = $('pend-error');
  const scrollWrap = $('pend-scroll-wrap');
  const footBar = $('pend-foot');
  if (!background) {
    if (errBox) errBox.hidden = true;
    if (scrollWrap) scrollWrap.hidden = false;
    if (footBar) footBar.hidden = false;
    state.loading = true;
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.classList.add('spin');
    }
  }

  const ownSkel = (!skelTask && !state.report && !background)
    ? scheduleDelayedSkeleton(() => {
      if (state && !state.destroyed && !state.report) showSkeleton();
    }, state.ctx === 'school' ? 300 : 250)
    : null;
  const activeSkel = skelTask || ownSkel;
  const prevSig = pendingSignature(state.report);

  try {
    const nextReport = state.ctx === 'school'
      ? await loadKidsPendingReport({ profile: state.profile, forceRefresh, deltaRefresh })
      : await loadYouthPendingReport({
        profile: state.profile,
        session: state.activeSession,
        forceRefresh,
        deltaRefresh
      });
    if (!state || state.destroyed) return;
    if (activeSkel) activeSkel.cancel();
    const nextSig = pendingSignature(nextReport);
    state.report = nextReport;
    hideSkeleton();
    console.debug('[pending] loaded', {
      ctx: state.ctx,
      reads: state.report.readCount || 0,
      fromCache: Boolean(state.report.fromCache),
      overdueItems: state.report.items?.length || 0
    });
    if (!background || nextSig !== prevSig) {
      updateSubtitle(state.activeSession);
      populateCourseOptions();
      syncBranchBatchContext();
      applyFiltersAndRender();
    }
  } catch (err) {
    if (activeSkel) activeSkel.cancel();
    if (!background) {
      console.error('[pending] load failed', err);
      showLoadError(err);
    }
  } finally {
    if (activeSkel) activeSkel.cancel();
    if (!background) {
      state.loading = false;
      hideSkeleton();
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('spin');
      }
    }
  }
}

function showLoadError(err) {
  hideSkeleton();
  const errBox = $('pend-error');
  const msgEl = $('pend-error-msg');
  const scrollWrap = $('pend-scroll-wrap');
  const footBar = $('pend-foot');
  if (scrollWrap) scrollWrap.hidden = true;
  if (footBar) footBar.hidden = true;
  if (errBox && msgEl) {
    msgEl.textContent = err?.message || 'Permission or network failure while loading overdue fees.';
    errBox.hidden = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

function matchStructuralFilters(item) {
  const f = state.filters;
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };
  if (state.ctx === 'youth' && bb.branchId !== 'all' && item.branchId !== bb.branchId) return false;
  if (bb.batchId !== 'all' && item.batchId !== bb.batchId) return false;
  if (!matchesDaysLateFilter(item.daysLate, f.daysLate)) return false;
  if (f.courseId !== 'all') {
    const selectedCourseName = state.meta?.coursesById?.[f.courseId]?.name;
    const matchesCourse = item.courseId === f.courseId ||
      (state.ctx === 'school' && selectedCourseName && (item.level === selectedCourseName || item.courseName === selectedCourseName));
    if (!matchesCourse) return false;
  }
  if (f.search && !(item.searchBlob || '').includes(f.search)) return false;
  return true;
}

function sortItems(list, sortKey) {
  const arr = list.slice();
  arr.sort((a, b) => {
    if (sortKey === 'daysLate_asc') {
      return (Number(a.daysLate || 0) - Number(b.daysLate || 0)) ||
        (b.dueDate || '0000').localeCompare(a.dueDate || '0000') ||
        (a.studentName || '').localeCompare(b.studentName || '');
    }
    if (sortKey === 'dueDate_asc') {
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
        (a.studentName || '').localeCompare(b.studentName || '');
    }
    if (sortKey === 'amount_desc') {
      return (Number(b.totalPayable || b.amount) - Number(a.totalPayable || a.amount)) ||
        (Number(b.daysLate || 0) - Number(a.daysLate || 0));
    }
    if (sortKey === 'amount_asc') {
      return (Number(a.totalPayable || a.amount) - Number(b.totalPayable || b.amount)) ||
        (Number(a.daysLate || 0) - Number(b.daysLate || 0));
    }
    if (sortKey === 'name_asc') {
      return toTitleCaseIfCaps(a.studentName || '').localeCompare(toTitleCaseIfCaps(b.studentName || '')) ||
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    }
    const lateDiff = Number(b.daysLate || 0) - Number(a.daysLate || 0);
    if (lateDiff !== 0) return lateDiff;
    return (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
      (a.studentName || '').localeCompare(b.studentName || '');
  });
  return arr;
}

function updateFilterIndicators() {
  const f = state.filters;
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };

  let secondaryCount = 0;
  if (f.courseId !== 'all') secondaryCount++;
  if (f.sort && f.sort !== 'daysLate_desc') secondaryCount++;

  let activeCount = secondaryCount;
  if (state.ctx === 'youth' && state.profile?.role !== 'branch_head' && bb.branchId !== 'all') activeCount++;
  if (bb.batchId !== 'all') activeCount++;
  if (f.daysLate !== 'all') activeCount++;

  const mobileBadge = $('pend-mobile-filters-count');
  if (mobileBadge) {
    mobileBadge.textContent = String(activeCount);
    mobileBadge.hidden = activeCount === 0;
  }

  const moreBtn = $('pend-more-btn');
  if (moreBtn) {
    moreBtn.classList.toggle('has-active', secondaryCount > 0);
    const label = moreBtn.querySelector('span');
    if (label) label.textContent = secondaryCount > 0 ? `More (${secondaryCount})` : 'More';
  }

  const hasCustomFilter = Boolean(f.search || activeCount > 0);
  const resetBtn = $('pend-clear-filters');
  if (resetBtn) resetBtn.hidden = !hasCustomFilter;

  syncSortHeaders();
}

function applyFiltersAndRender() {
  if (!state || !state.report) return;
  const asOf = state.report.asOfDate || todayISO();
  const overdueOnly = filterOverdueItems(state.report.items || [], asOf);
  const matching = overdueOnly.filter(matchStructuralFilters);

  const kpi = summarizePendingItems(matching, asOf);
  updateKpiCards(kpi);

  state.filteredItems = sortItems(matching, state.filters.sort);

  updateFilterIndicators();
  renderTablePage();
}

function updateKpiCards(kpi) {
  $('pend-kpi-students').textContent = String(kpi.overdueStudentCount);
  $('pend-kpi-students-sub').textContent = kpi.totalRows === 1
    ? '1 overdue item'
    : `${kpi.totalRows} overdue items`;
  $('pend-kpi-overdue').textContent = formatINR(kpi.overdueAmount);
  $('pend-kpi-late').textContent = formatINR(kpi.lateFeesTotal);
  $('pend-kpi-total-due').textContent = formatINR(kpi.overdueWithLate);
  $('pend-kpi-oldest').textContent = kpi.maxDaysLate > 0
    ? `${kpi.maxDaysLate} ${kpi.maxDaysLate === 1 ? 'day' : 'days'}`
    : '0 days';
  $('pend-kpi-oldest-sub').textContent = kpi.oldestStudentName
    ? toTitleCaseIfCaps(kpi.oldestStudentName)
    : 'No overdue items';
}

function renderTablePage() {
  const tbody = $('pend-tbody');
  const countBadge = $('pend-row-count');
  const footBar = $('pend-foot');
  if (!tbody) return;

  const list = state.filteredItems;
  if (countBadge) countBadge.textContent = list.length === 1 ? '1 item' : `${list.length} items`;

  if (!list.length) {
    const hasFilter = $('pend-clear-filters') && !$('pend-clear-filters').hidden;
    renderEmptyTableState(tbody, {
      colSpan: 8,
      title: hasFilter ? 'No matching overdue payments' : 'No overdue payments - everyone is up to date',
      desc: hasFilter
        ? 'No overdue records match your search or filter criteria.'
        : (state.ctx === 'school'
          ? 'All Unique Kids students are up to date on past-due monthly fees.'
          : 'All active students in this session are up to date on past-due installments.'),
      onClear: hasFilter ? () => resetAllFilters() : undefined
    });
    if (footBar) renderPager(footBar, { page: 1, pageSize: PAGE_SIZE, totalItems: 0, showWhenSingle: false });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = list.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = '';
  for (const item of pageItems) {
    tbody.appendChild(buildPendingRow(item));
  }

  if (footBar) {
    renderPager(footBar, {
      page: state.page,
      pageSize: PAGE_SIZE,
      totalItems: list.length,
      showWhenSingle: true,
      onPageChange: (nextPage) => {
        state.page = nextPage;
        renderTablePage();
      }
    });
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();

  const visibleIds = pageItems.map((it) => it.studentDocId).filter(Boolean);
  loadStudentPhotos(visibleIds).then(() => {
    if (!state || state.destroyed) return;
    pageItems.forEach((it) => {
      const url = getCachedStudentPhoto(it.studentDocId);
      if (!url) return;
      const slot = tbody.querySelector(`.fr-avatar-slot[data-sid="${CSS.escape(it.studentDocId)}"]`);
      if (slot && slot.tagName !== 'IMG') {
        const img = document.createElement('img');
        img.className = 'fr-avatar';
        img.src = url;
        img.alt = it.studentName || '';
        slot.replaceWith(img);
      }
    });
  }).catch(() => {});
}

function formatDueHeading(item) {
  if (item.kind === 'IN' && item.installmentNo) {
    return `Installment ${item.installmentNo}`;
  }
  if (item.kind === 'EX') {
    return 'Examination Fee';
  }
  if (state?.ctx === 'school' || item.org === 'school') {
    return item.monthLabel ? `${item.monthLabel} bill` : 'Monthly bill';
  }
  if (item.monthLabel) {
    return `${item.monthLabel} bill`;
  }
  return item.whatIsDue || 'Monthly bill';
}

function buildPendingRow(item) {
  const tr = document.createElement('tr');
  const displayName = toTitleCaseIfCaps(item.studentName || '-') || '-';
  const isSchool = state.ctx === 'school';
  const canCollectRole = state.profile?.role === 'superadmin' || (!isSchool && state.profile?.role === 'branch_head');

  // 1. Student (Title Case name + ID · Phone on one muted line)
  const tdStudent = mk('td', 'fr-col-student');
  tdStudent.dataset.label = 'Student';
  const cell = mk('div', 'fr-student-cell');
  const cachedPhoto = getCachedStudentPhoto(item.studentDocId);
  if (cachedPhoto) {
    const img = document.createElement('img');
    img.className = 'fr-avatar';
    img.src = cachedPhoto;
    img.alt = displayName;
    cell.appendChild(img);
  } else {
    const av = mk('span', 'fr-avatar-fallback fr-avatar-slot', initials(displayName || 'ST'));
    av.dataset.sid = item.studentDocId || '';
    cell.appendChild(av);
  }
  const meta = mk('div', 'fr-student-meta');
  const nameBtn = mk('button', 'fr-student-link', displayName);
  nameBtn.type = 'button';
  nameBtn.title = displayName;
  nameBtn.addEventListener('click', () => {
    location.hash = `#/students/${encodeURIComponent(item.studentDocId)}?tab=payments`;
  });
  const idPhoneText = `${item.studentId || '-'}${item.phone ? ' · ' + item.phone : ''}`;
  const idLine = mk('span', 'lp-sub fr-id-phone', idPhoneText);
  idLine.title = idPhoneText;
  meta.append(nameBtn, idLine);
  cell.appendChild(meta);
  tdStudent.appendChild(cell);

  // 2. Course, Branch & Batch (Line 1: CODE - [BRANCHCODE] chip; Line 2: full batch name)
  const tdCourse = mk('td', 'fr-col-cb');
  tdCourse.dataset.label = isSchool ? 'Level, Branch & Batch' : 'Course, Branch & Batch';
  const cb = formatCourseBranchDisplay(item);
  tdCourse.title = [cb.tooltip, item.batchName].filter(Boolean).join('\n') || '-';
  const cbWrap = document.createElement('div');
  const line1 = mk('div', 'fr-cb-inline');
  line1.title = cb.tooltip;
  if (cb.courseLabel) line1.appendChild(mk('strong', 'fr-cb-course', cb.courseLabel));
  if (cb.courseLabel && cb.branchLabel) line1.appendChild(mk('span', 'fr-cb-sep', ' - '));
  if (cb.branchLabel) {
    line1.appendChild(mk('span', cb.hasBranchCode ? 'pill neutral fr-cb-branch' : 'fr-cb-course', cb.branchLabel));
  }
  if (line1.childNodes.length) cbWrap.appendChild(line1);
  if (item.batchName) {
    const batchLine = mk('span', 'lp-sub fr-sub-ellipsis', item.batchName);
    batchLine.title = item.batchName;
    cbWrap.appendChild(batchLine);
  }
  if (!cbWrap.childNodes.length) cbWrap.textContent = '-';
  tdCourse.appendChild(cbWrap);

  // 3. Installment / Bill ("Installment 3" + Session underneath, or "Nov 2026 bill" in Kids)
  const tdDueItem = document.createElement('td');
  tdDueItem.dataset.label = isSchool ? 'Bill' : 'Installment';
  const dueWrap = document.createElement('div');
  if (item.month) dueWrap.title = `Billing month: ${item.month}`;
  dueWrap.appendChild(mk('span', 'fr-due-title', formatDueHeading(item)));
  if (item.isPartial || item.bill?.status === 'partial') {
    dueWrap.appendChild(mk('span', 'pill partial', 'Partial Paid'));
  } else if (!isSchool && item.sessionName) {
    const sessEl = mk('span', 'lp-sub fr-sub-ellipsis', item.sessionName);
    sessEl.title = item.sessionName;
    dueWrap.appendChild(sessEl);
  }
  tdDueItem.appendChild(dueWrap);

  // 4. Due Date ("10 Nov 2026" + red "15 days late" underneath; crimson for 30+ days)
  const tdDueDate = mk('td', 'fr-col-date');
  tdDueDate.dataset.label = 'Due Date';
  const dtWrap = document.createElement('div');
  dtWrap.appendChild(mk('span', 'fr-date-main', item.dueDate ? fmtDate(item.dueDate) : '-'));
  const days = Number(item.daysLate || 0);
  if (days > 0) {
    dtWrap.appendChild(mk(
      'span',
      days >= 30 ? 'lp-sub fr-days-late is-severe' : 'lp-sub fr-days-late',
      `${days} ${days === 1 ? 'day' : 'days'} late`
    ));
  }
  tdDueDate.appendChild(dtWrap);

  // 5. Fee (right-aligned)
  const tdFee = mk('td', 'num fr-col-money');
  tdFee.dataset.label = 'Fee';
  tdFee.appendChild(mk('span', 'fr-money', formatINR(item.amount || 0)));

  // 6. Late Fee (right-aligned)
  const tdLate = mk('td', 'num fr-col-money');
  tdLate.dataset.label = 'Late Fee';
  if (Number(item.lateFee || 0) > 0) {
    tdLate.appendChild(mk('span', 'fr-money danger', formatINR(item.lateFee)));
  } else {
    tdLate.appendChild(mk('span', 'fr-money muted', '—'));
  }

  // 7. Total Due (right-aligned bold red)
  const tdTotalDue = mk('td', 'num fr-col-money');
  tdTotalDue.dataset.label = 'Total Due';
  const totalPay = item.totalPayable != null ? Number(item.totalPayable) : (Number(item.amount || 0) + Number(item.lateFee || 0));
  tdTotalDue.appendChild(mk('span', 'fr-money danger', formatINR(totalPay)));

  // 8. Action (Eye "View details" + Wallet "Collect fee" for roles allowed to collect)
  const tdAct = mk('td', 'fr-action-td');
  tdAct.dataset.label = 'Action';
  const actions = mk('div', canCollectRole ? 'fr-actions fr-actions-dual' : 'fr-actions');

  const eyeBtn = mk('button', 'ui-kebab fr-act-btn');
  eyeBtn.type = 'button';
  eyeBtn.title = 'View details';
  eyeBtn.setAttribute('aria-label', `View details for ${displayName}`);
  eyeBtn.innerHTML = '<i data-lucide="eye"></i><span>Details</span>';
  eyeBtn.addEventListener('click', () => openOverdueDetailsPopup(item));
  actions.appendChild(eyeBtn);

  if (canCollectRole) {
    const walletBtn = mk('button', 'ui-kebab fr-act-btn fr-wallet-btn');
    walletBtn.type = 'button';
    walletBtn.innerHTML = '<i data-lucide="wallet"></i><span>Collect</span>';

    if (isSchool) {
      walletBtn.title = 'Collect fee';
      walletBtn.setAttribute('aria-label', `Collect fee for ${displayName}`);
      walletBtn.addEventListener('click', () => handleKidsCollect(item));
      actions.appendChild(walletBtn);
    } else if (item.canCollect) {
      walletBtn.title = 'Collect fee';
      walletBtn.setAttribute('aria-label', `Collect fee for ${displayName}`);
      walletBtn.addEventListener('click', () => handleYouthCollect(item));
      actions.appendChild(walletBtn);
    } else {
      const blockedTip = `Pay Installment ${item.sequentialBlockedBy || 1} first`;
      walletBtn.disabled = true;
      walletBtn.title = blockedTip;
      walletBtn.setAttribute('aria-label', blockedTip);
      const tipWrap = mk('span', 'fr-btn-tip-wrap');
      tipWrap.title = blockedTip;
      tipWrap.appendChild(walletBtn);
      actions.appendChild(tipWrap);
    }
  }

  tdAct.appendChild(actions);
  tr.append(tdStudent, tdCourse, tdDueItem, tdDueDate, tdFee, tdLate, tdTotalDue, tdAct);
  return tr;
}

async function copyTextWithFallback(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) {
    return false;
  }
}

function buildDetailCard(title, iconName, fields) {
  const card = mk('div', 'adm-view-card');
  const head = mk('div', 'adm-view-card-head');
  const ic = document.createElement('i');
  ic.setAttribute('data-lucide', iconName);
  head.append(ic, mk('span', 'adm-view-card-title', title));
  const body = mk('div', 'adm-view-card-body');

  const tbl = mk('table', 'adm-view-table');
  const tbody = document.createElement('tbody');
  fields.forEach((f) => {
    const tr = document.createElement('tr');
    const tdL = mk('td', 'adm-view-label', f.label);
    const valCls = 'adm-view-value'
      + (f.mono ? ' fr-mono' : '')
      + (f.highlight ? ' fr-val-strong' : '')
      + (f.danger ? ' danger' : '');
    const tdV = mk('td', valCls, f.value);
    tr.append(tdL, tdV);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  body.appendChild(tbl);
  card.append(head, body);
  return card;
}

function openOverdueDetailsPopup(item) {
  if (!item) return;
  const sessionsById = {};
  (state?.sessions || []).forEach((s) => { if (s?.id) sessionsById[s.id] = s; });

  const allReportItems = state?.report?.items || [];
  const studentItems = allReportItems.filter((it) => it.studentDocId === item.studentDocId);
  const model = buildOverdueDetailsModel(item, studentItems, { sessionsById });

  let copyTimer = null;
  const popup = openPopup({
    title: model.title,
    subtitle: model.subtitle,
    icon: 'alarm-clock',
    tone: 'danger',
    wide: true,
    onClose: () => {
      if (copyTimer) {
        clearTimeout(copyTimer);
        copyTimer = null;
      }
    }
  });

  // Add Overdue badge beside title (same pattern as Payment Details popup) and show student photo in tile if available
  const popupPhoto = getCachedStudentPhoto(item.studentDocId);
  const headTile = popup.head.querySelector('.adm-view-tile');
  if (headTile && popupPhoto) {
    headTile.style.padding = '0';
    headTile.style.overflow = 'hidden';
    headTile.innerHTML = '';
    const phImg = document.createElement('img');
    phImg.src = popupPhoto;
    phImg.alt = item.studentName || '';
    phImg.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    headTile.appendChild(phImg);
  }
  const titleEl = popup.head.querySelector('.adm-view-title');
  if (titleEl) {
    titleEl.textContent = '';
    const row = mk('span', 'fr-det-head-row');
    row.append(
      mk('span', '', model.title),
      mk('span', `pill ${model.status.cls}`, model.status.label)
    );
    titleEl.appendChild(row);
  }

  // Copy icon button in header right before Close (X): [Copy] [Close X]
  const copyBtn = mk('button', 'ui-btn ghost adm-view-close fr-copy-btn');
  copyBtn.type = 'button';
  copyBtn.title = 'Copy details';
  copyBtn.setAttribute('aria-label', 'Copy details');
  copyBtn.innerHTML = '<i data-lucide="copy" width="18" height="18"></i>';
  copyBtn.addEventListener('click', async () => {
    const ok = await copyTextWithFallback(model.copyText);
    if (!ok) {
      showToast({ type: 'error', message: 'Unable to copy details.' });
      return;
    }
    showToast({ type: 'success', message: 'Details copied' });
    copyBtn.classList.add('is-copied');
    copyBtn.innerHTML = '<i data-lucide="check" width="18" height="18"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyBtn.classList.remove('is-copied');
      copyBtn.innerHTML = '<i data-lucide="copy" width="18" height="18"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      copyTimer = null;
    }, 2000);
  });
  popup.actions.insertBefore(copyBtn, popup.actions.firstChild);

  const stack = mk('div', 'fr-det-stack');
  const grid = mk('div', 'fr-det-grid');
  if (model.studentFields.length) grid.appendChild(buildDetailCard('STUDENT', 'user', model.studentFields));
  if (model.summaryFields.length) grid.appendChild(buildDetailCard('OVERDUE SUMMARY', 'indian-rupee', model.summaryFields));

  const instCard = mk('div', 'adm-view-card fr-det-card-full');
  const instHead = mk('div', 'adm-view-card-head');
  const instIc = document.createElement('i');
  instIc.setAttribute('data-lucide', 'calendar-clock');
  instHead.append(instIc, mk('span', 'adm-view-card-title', model.isSchool ? 'OVERDUE BILLS' : 'OVERDUE INSTALLMENTS'));
  const instBody = mk('div', 'fr-det-inst-wrap');

  const tbl = mk('table', 'fr-det-inst-table');
  const thead = document.createElement('thead');
  const thr = document.createElement('tr');
  [
    { label: model.isSchool ? 'Bill Month' : 'Installment' },
    { label: 'Due Date' },
    { label: 'Days Late' },
    { label: 'Fee', num: true },
    { label: 'Late Fee', num: true },
    { label: 'Total', num: true }
  ].forEach((c) => {
    const th = document.createElement('th');
    if (c.num) th.className = 'num';
    th.textContent = c.label;
    thr.appendChild(th);
  });
  thead.appendChild(thr);

  const tbody = document.createElement('tbody');
  model.installments.forEach((inst) => {
    const tr = document.createElement('tr');
    if (inst.isSelected && model.installments.length > 1) tr.className = 'is-current-row';
    const tdItem = mk('td', '', '');
    tdItem.appendChild(mk('strong', '', inst.label));
    const tdDue = mk('td', '', inst.dueDateFormatted);
    const tdDays = mk('td', '', '');
    tdDays.appendChild(mk(
      'span',
      Number(inst.days || 0) >= 30 ? 'fr-days-late is-severe' : 'fr-days-late',
      inst.daysLateText
    ));
    const tdFee = mk('td', 'num fr-money', inst.feeText);
    const tdLate = mk('td', 'num fr-money danger', inst.lateFeeText);
    const tdTot = mk('td', 'num fr-money danger', inst.totalText);
    tr.append(tdItem, tdDue, tdDays, tdFee, tdLate, tdTot);
    tbody.appendChild(tr);
  });

  const tfoot = document.createElement('tfoot');
  const tfr = document.createElement('tr');
  tfr.append(
    mk('td', '', 'Grand Total'),
    mk('td', '', ''),
    mk('td', '', ''),
    mk('td', 'num', model.grandTotal.feeText),
    mk('td', 'num danger', model.grandTotal.lateFeeText),
    mk('td', 'num danger', model.grandTotal.totalText)
  );
  tfoot.appendChild(tfr);

  tbl.append(thead, tbody, tfoot);
  instBody.appendChild(tbl);
  instCard.append(instHead, instBody);
  grid.appendChild(instCard);

  stack.appendChild(grid);
  popup.container.appendChild(stack);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function handleKidsCollect(item) {
  if (!item) return;
  const student = state.report?.studentsById?.[item.studentDocId] || {
    id: item.studentDocId,
    studentId: item.studentId,
    name: item.studentName,
    courseId: item.courseId || '',
    courseName: item.courseName || '',
    ctx: 'school'
  };
  openPaymentPopup({
    student: { ...student, ctx: 'school' },
    profile: state.profile,
    preselectedBillId: item.billId || '',
    from: 'school-pending',
    onSuccess: async () => {
      await bootstrapData({ forceRefresh: false, deltaRefresh: true });
    }
  });
}

function handleYouthCollect(item) {
  const student = state.report?.studentsById?.[item.studentDocId];
  const session = state.activeSession;
  if (!student || !session) {
    showToast({ type: 'error', message: 'Student or session record missing. Refresh and retry.' });
    return;
  }
  const payments = state.report?.paymentsByStudentId?.[item.studentDocId] || [];
  const preselectedOption = item.preselectedOption || (item.kind === 'EX' ? 'EX' : `IN_${item.installmentNo}`);

  openPaymentPopup({
    student,
    profile: state.profile,
    preselectedOption,
    sessionsCache: state.sessions,
    activeSession: session,
    payments,
    from: 'pending',
    onSuccess: async () => {
      try {
        const updated = await refreshSingleYouthPendingStudent({
          studentDocId: item.studentDocId,
          session,
          profile: state.profile
        });
        if (updated && state && !state.destroyed) {
          state.report = updated;
          applyFiltersAndRender();
        }
      } catch (e) {
        console.warn('[pending] single student refresh failed', e);
      }
    }
  });
}

function formatCodeAndName(code, name) {
  const c = String(code || '').trim();
  const n = String(name || '').trim();
  if (c && n && c.toLowerCase() !== n.toLowerCase()) return `${c} - ${n}`;
  return n || c || '';
}

function handleExportCsv() {
  const list = state?.filteredItems || [];
  if (!list.length) {
    showToast({ type: 'warning', message: 'No overdue rows to export.' });
    return;
  }
  const isSchool = state.ctx === 'school';
  const headers = [
    'Student ID',
    'Student Name',
    'Phone',
    isSchool ? 'Level Code' : 'Course Code',
    isSchool ? 'Level' : 'Course',
    'Branch Code',
    'Branch',
    'Batch',
    isSchool ? 'Bill' : 'Installment',
    'Due Date',
    'Days Late',
    'Fee (INR)',
    'Late Fee (INR)',
    'Total Due (INR)'
  ];
  const rows = list.map((it) => {
    const name = toTitleCaseIfCaps(it.studentName || '') || '';
    const dueLabel = formatDueHeading(it);
    const total = Number(it.totalPayable != null ? it.totalPayable : (Number(it.amount || 0) + Number(it.lateFee || 0)));
    return [
      it.studentId || '',
      name,
      it.phone || '',
      it.courseCode || '',
      it.courseName || it.level || '',
      it.branchCode || '',
      toTitleCaseIfCaps(it.branchName || '') || '',
      it.batchName || '',
      dueLabel,
      it.dueDate ? fmtDate(it.dueDate) : '',
      it.daysLate || 0,
      Number(it.amount || 0),
      Number(it.lateFee || 0),
      total
    ];
  });
  const prefix = isSchool ? 'unique-kids-overdue' : 'youth-overdue';
  downloadCsv(`${prefix}-${todayISO()}.csv`, headers, rows);
}

function handlePrint() {
  const list = state?.filteredItems || [];
  const kpi = summarizePendingItems(list, state?.report?.asOfDate || todayISO());
  const isSchool = state.ctx === 'school';
  const sessionName = !isSchool
    ? (state.activeSession?.name || 'Active Session')
    : 'Unique Kids Monthly Billing';
  const oldestValue = kpi.maxDaysLate > 0
    ? `${kpi.maxDaysLate} ${kpi.maxDaysLate === 1 ? 'day' : 'days'}${kpi.oldestStudentName ? ' (' + toTitleCaseIfCaps(kpi.oldestStudentName) + ')' : ''}`
    : '0 days';
  const ok = openPrintSheet({
    title: `${isSchool ? 'Unique Kids' : 'Youth Centre'} — Overdue Payments Report`,
    subtitle: `Scope: ${sessionName} · Overdue items: ${list.length}`,
    summaryPairs: [
      { label: 'Overdue Students', value: String(kpi.overdueStudentCount) },
      { label: 'Overdue Amount', value: formatINR(kpi.overdueAmount) },
      { label: 'Late Fees', value: formatINR(kpi.lateFeesTotal) },
      { label: 'Total to Collect', value: formatINR(kpi.overdueWithLate) },
      { label: 'Oldest Overdue', value: oldestValue }
    ],
    columns: [
      { label: 'Student' },
      { label: 'Phone' },
      { label: isSchool ? 'Level, Branch & Batch' : 'Course, Branch & Batch' },
      { label: isSchool ? 'Bill' : 'Installment' },
      { label: 'Due Date' },
      { label: 'Days Late', num: true },
      { label: 'Fee', num: true },
      { label: 'Late Fee', num: true },
      { label: 'Total Due', num: true }
    ],
    rows: list.map((it) => {
      const coursePart = formatCodeAndName(it.courseCode, it.courseName || it.level);
      const branchPart = formatCodeAndName(it.branchCode, toTitleCaseIfCaps(it.branchName || ''));
      const cbCombined = [[coursePart, branchPart].filter(Boolean).join(' - '), it.batchName].filter(Boolean).join(' · ');
      return [
        `${toTitleCaseIfCaps(it.studentName || '')} (${it.studentId || '-'})`,
        it.phone || '-',
        cbCombined || formatCourseAndBranch(it) || '-',
        formatDueHeading(it),
        it.dueDate ? fmtDate(it.dueDate) : '-',
        String(it.daysLate || 0),
        formatINR(it.amount || 0),
        formatINR(it.lateFee || 0),
        formatINR(it.totalPayable != null ? it.totalPayable : (Number(it.amount || 0) + Number(it.lateFee || 0)))
      ];
    }),
    footerNote: `Printed by ${state.profile?.name || state.profile?.email || 'User'}`
  });
  if (!ok) {
    showToast({ type: 'warning', message: 'Please allow popups to open the print report.' });
  }
}

export function unmount() {
  if (state) state.destroyed = true;
  if (sessionListener) {
    window.removeEventListener('uic:session-selected', sessionListener);
    sessionListener = null;
  }
  if (sessionsLoadedListener) {
    window.removeEventListener('uic:sessions-loaded', sessionsLoadedListener);
    sessionsLoadedListener = null;
  }
  if (sessionsChangedListener) {
    window.removeEventListener('uic:sessions-changed', sessionsChangedListener);
    sessionsChangedListener = null;
  }
  state = null;
}
