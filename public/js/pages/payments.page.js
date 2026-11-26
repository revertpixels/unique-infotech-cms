// payments.page.js — Payment History page for Youth Centre (#/payments) & Unique Kids (#/school-payments).
// Follows Rule 1 (global toolbar session only, plain-text subtitle) & Rule 2 (shared [ Branch -> Batch ] box).

import { createSelect } from '../components/ui-select.js?v=1.8.168';
import { createBranchBatchFilter, clearPersistedBranchBatchFilters } from '../components/branch-batch-filter.js?v=1.8.168';
import { openPopup } from '../components/modal.js?v=1.8.168';
import { showToast } from '../components/toast.js?v=1.8.168';
import { renderPager, renderEmptyTableState, PAGE_SIZE } from '../components/list-page.js?v=1.8.168';
import {
  getCachedSessions,
  loadSessions,
  getSelectedSession
} from '../core/sessions.js?v=1.8.168';
import {
  ensureReferenceData,
  scopeReferenceDataByCtx,
  getPaymentDatePresetOptions,
  getPaymentTypeFilterOptions,
  getPaymentModeFilterOptions,
  getPaymentChipOrder,
  loadYouthPaymentHistory,
  loadKidsPaymentHistory,
  loadStudentPhotos,
  getCachedStudentPhoto,
  getCachedBillForEntry,
  getDatePresetRange,
  formatCourseBranchDisplay,
  formatCourseAndBranch,
  formatCollectorName,
  formatCollectorWithDesignation,
  formatShortReceipt,
  modeDisplayMeta,
  buildPaymentDetailsModel,
  summarizePaymentLedger,
  downloadCsv,
  openPrintSheet,
  formatINR,
  fmtDate,
  todayISO
} from '../services/report.service.js?v=1.8.168';
import { formatPersonName, initials } from '../utils/formatter.js?v=1.8.168';
import { resolveUserDisplay } from '../services/user-directory.service.js?v=1.8.168';

let state = null;
let sessionListener = null;
let sessionsLoadedListener = null;
let sessionsChangedListener = null;
let usersUpdatedListener = null;
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
  const strip = $('payh-breakdown-strip');
  if (strip) strip.hidden = true;
  const foot = $('payh-foot');
  if (foot) foot.hidden = true;

  const stats = $('payh-stats');
  if (stats) {
    stats.classList.add('is-loading');
    stats.querySelectorAll('.lp-stat-value').forEach((el) => {
      el.textContent = '';
      el.classList.add('skel');
    });
  }
  const tbody = $('payh-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const widths = ['w-date', 'w-long', 'w-med', 'w-med', 'w-short', 'w-short', 'w-short', 'w-short', 'w-act'];
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
  const stats = $('payh-stats');
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

function toggleNoSessionState(show) {
  $('payh-no-session').hidden = !show;
  $('payh-stats').hidden = show;
  $('payh-toolbar').hidden = show;
  $('payh-table-card').hidden = show;
  if (show) {
    $('payh-breakdown-strip').hidden = true;
    $('payh-partial-banner').hidden = true;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

export async function mount({ container, profile, ctx }) {
  const isSuper = profile?.role === 'superadmin';
  const isBranchHead = profile?.role === 'branch_head';
  const isSchoolHead = profile?.role === 'school_head';

  let activeCtx = ctx === 'school' ? 'school' : 'youth';
  if (isBranchHead) activeCtx = 'youth';
  if (isSchoolHead) activeCtx = 'school';

  if (lastMountedCtx && lastMountedCtx !== activeCtx) {
    clearPersistedBranchBatchFilters('payments.');
  }
  lastMountedCtx = activeCtx;

  state = {
    profile,
    ctx: activeCtx,
    isSuper,
    isBranchHead,
    isSchoolHead,
    meta: null,
    sessions: getCachedSessions('youth'),
    activeSession: null,
    filters: {
      datePreset: 'all',
      dateFrom: '',
      dateTo: '',
      courseId: 'all',
      type: 'all',
      mode: 'all',
      collector: 'all',
      search: ''
    },
    bbFilter: null,
    selects: {},
    youthResult: null,
    kidsResult: null,
    mergedEntries: [],
    filteredEntries: [],
    page: 1,
    totalReadCount: 0,
    destroyed: false
  };

  const scopeBadge = $('payh-scope-badge');
  if (scopeBadge) {
    if (isBranchHead) {
      scopeBadge.hidden = false;
      scopeBadge.textContent = `Branch: ${profile.branchName || profile.branchId || '-'}`;
    } else if (isSchoolHead) {
      scopeBadge.hidden = false;
      scopeBadge.textContent = 'Scope: Unique Kids';
    }
  }

  updateHeaderText();
  initControls();
  bindEvents();

  showSkeleton();
  await bootstrapData({ forceRefresh: false });
}

function updateHeaderText() {
  if (!state) return;
  const isSchool = state.ctx === 'school';
  const label = isSchool ? 'Unique Kids' : 'Youth Centre';
  $('payh-crumb-ctx').textContent = label;
  $('payh-title').textContent = `${label} — Payment History`;

  const courseLbl = $('payh-course-label');
  if (courseLbl) courseLbl.textContent = isSchool ? 'Level' : 'Course';
  const cbTh = $('payh-th-cb');
  if (cbTh) cbTh.textContent = isSchool ? 'Level, Branch & Batch' : 'Course, Branch & Batch';
  const moreBtn = $('payh-more-btn');
  if (moreBtn) {
    moreBtn.title = isSchool
      ? 'Type, Mode, Level & Collector filters'
      : 'Type, Mode, Course & Collector filters';
  }

  const sub = $('payh-subtitle');
  if (!sub) return;
  if (isSchool) {
    sub.textContent = 'Unique Kids — Admission fees, monthly bills, and waiver records.';
  } else if (state.activeSession) {
    sub.textContent = `Session ${state.activeSession.name} — Verified receipt ledger for admissions, installments, and exam fees.`;
  } else {
    sub.textContent = 'Youth Centre — Verified receipt ledger for admissions, installments, and exam fees.';
  }
}

function initControls() {
  const isSchool = state.ctx === 'school';

  state.bbFilter = createBranchBatchFilter($('payh-bb-host'), {
    persistKey: `payments.${state.ctx}`,
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

  state.selects.datePreset = createSelect($('payh-date-preset-host'), {
    options: getPaymentDatePresetOptions(state.ctx),
    value: 'all',
    ariaLabel: 'Date range',
    onChange: async (val) => {
      state.filters.datePreset = val || 'all';
      $('payh-custom-dates').hidden = val !== 'custom';
      if (val !== 'custom') {
        const range = getDatePresetRange(val, todayISO(), state.ctx === 'youth' ? state.activeSession : null);
        state.filters.dateFrom = range.dateFrom;
        state.filters.dateTo = range.dateTo;
        state.page = 1;
        await loadHistory({ forceRefresh: false });
      } else {
        state.filters.dateFrom = $('payh-date-from')?.value || '';
        state.filters.dateTo = $('payh-date-to')?.value || '';
        state.page = 1;
        if (state.filters.dateFrom || state.filters.dateTo) {
          await loadHistory({ forceRefresh: false });
        }
      }
    }
  });

  state.selects.course = createSelect($('payh-course-host'), {
    options: [{ value: 'all', label: isSchool ? 'All levels' : 'All courses', icon: 'book-open' }],
    value: 'all',
    ariaLabel: isSchool ? 'Level' : 'Course',
    onChange: (val) => {
      state.filters.courseId = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.type = createSelect($('payh-type-host'), {
    options: getPaymentTypeFilterOptions(state.ctx),
    value: 'all',
    ariaLabel: 'Payment type',
    onChange: (val) => {
      state.filters.type = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.mode = createSelect($('payh-mode-host'), {
    options: getPaymentModeFilterOptions(state.ctx),
    value: 'all',
    ariaLabel: 'Payment mode',
    onChange: (val) => {
      state.filters.mode = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.collector = createSelect($('payh-collector-host'), {
    options: [{ value: 'all', label: 'All collectors', icon: 'users' }],
    value: 'all',
    ariaLabel: 'Collected by',
    onChange: (val) => {
      state.filters.collector = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });
}

function bindEvents() {
  const searchInput = $('payh-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.filters.search = (searchInput.value || '').trim().toLowerCase();
      state.page = 1;
      applyFiltersAndRender();
    });
  }

  $('payh-mobile-filters-btn')?.addEventListener('click', () => {
    const tb = $('payh-toolbar');
    const btn = $('payh-mobile-filters-btn');
    const open = tb.classList.toggle('is-filters-open');
    btn?.setAttribute('aria-expanded', String(open));
    if (!open) {
      const extra = $('payh-extra-filters');
      const moreBtn = $('payh-more-btn');
      if (extra) extra.hidden = true;
      if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
    }
  });

  $('payh-more-btn')?.addEventListener('click', () => {
    const extra = $('payh-extra-filters');
    const btn = $('payh-more-btn');
    if (!extra || !btn) return;
    extra.hidden = !extra.hidden;
    btn.setAttribute('aria-expanded', String(!extra.hidden));
  });

  const onCustomDateChange = async () => {
    if (!state || state.filters.datePreset !== 'custom') return;
    state.filters.dateFrom = $('payh-date-from')?.value || '';
    state.filters.dateTo = $('payh-date-to')?.value || '';
    state.page = 1;
    await loadHistory({ forceRefresh: false });
  };
  $('payh-date-from')?.addEventListener('change', onCustomDateChange);
  $('payh-date-to')?.addEventListener('change', onCustomDateChange);

  $('payh-clear-filters')?.addEventListener('click', () => resetAllFilters());

  $('payh-refresh')?.addEventListener('click', async () => {
    await loadHistory({ forceRefresh: true });
    showToast({ type: 'success', message: 'Payment history refreshed.' });
  });
  $('payh-retry')?.addEventListener('click', () => loadHistory({ forceRefresh: true }));
  $('payh-banner-loadmore')?.addEventListener('click', () => loadMoreYouth({ loadAll: false }));
  $('payh-banner-loadall')?.addEventListener('click', () => loadMoreYouth({ loadAll: true }));

  $('payh-export-csv')?.addEventListener('click', handleExportCsv);
  $('payh-print')?.addEventListener('click', handlePrintCashReport);

  const onSessionSwitch = async (explicit = false) => {
    if (!state || state.destroyed || state.ctx !== 'youth') return;
    const prevSessId = state.activeSession?.id || '';
    state.activeSession = resolveActiveYouthSession();
    const changed = explicit || (prevSessId && state.activeSession?.id !== prevSessId);
    updateHeaderText();

    if (!state.activeSession) {
      toggleNoSessionState(true);
      return;
    }
    toggleNoSessionState(false);

    if (changed) {
      clearPersistedBranchBatchFilters('payments.');
      syncBranchBatchContext();
      await resetAllFilters({ reloadAlways: state.filters.datePreset !== 'all' });
      return;
    }

    syncBranchBatchContext();
    state.page = 1;
    applyFiltersAndRender();
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
  usersUpdatedListener = () => {
    if (!state || state.destroyed) return;
    rebuildMergedAndCollectorOptions();
    applyFiltersAndRender();
  };
  window.addEventListener('uic:users-updated', usersUpdatedListener);
}

async function resetAllFilters({ reloadAlways = false } = {}) {
  if (!state) return;
  const searchInput = $('payh-search');
  state.filters.search = '';
  if (searchInput) searchInput.value = '';
  clearPersistedBranchBatchFilters('payments.');
  state.bbFilter?.reset();
  state.filters.courseId = 'all';
  state.selects.course.setValue('all');
  state.filters.type = 'all';
  state.selects.type.setValue('all');
  state.filters.mode = 'all';
  state.selects.mode.setValue('all');
  state.filters.collector = 'all';
  state.selects.collector.setValue('all');

  const needDateReload = reloadAlways || state.filters.datePreset !== 'all';
  state.filters.datePreset = 'all';
  state.filters.dateFrom = '';
  state.filters.dateTo = '';
  state.selects.datePreset.setValue('all');
  $('payh-custom-dates').hidden = true;
  state.page = 1;
  if (needDateReload) await loadHistory({ forceRefresh: false });
  else applyFiltersAndRender();
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

async function bootstrapData({ forceRefresh = false } = {}) {
  try {
    const [meta, sessions] = await Promise.all([
      ensureReferenceData({ forceRefresh, profile: state.profile }),
      state.ctx === 'youth'
        ? (getCachedSessions('youth').length ? Promise.resolve(getCachedSessions('youth')) : loadSessions('youth'))
        : Promise.resolve([])
    ]);
    if (!state || state.destroyed) return;

    state.meta = meta;
    state.sessions = sessions;
    state.activeSession = state.ctx === 'youth' ? resolveActiveYouthSession() : null;

    updateHeaderText();
    populateCourseOptions();
    syncBranchBatchContext();

    if (state.ctx === 'youth' && !state.activeSession) {
      hideSkeleton();
      toggleNoSessionState(true);
      return;
    }
    toggleNoSessionState(false);
    await loadHistory({ forceRefresh });
  } catch (err) {
    console.error('[payments] bootstrap failed', err);
    showLoadError(err);
  }
}

function populateCourseOptions() {
  const isSchool = state.ctx === 'school';
  const scoped = scopeReferenceDataByCtx(state.meta || {}, state.ctx);
  const opts = [{ value: 'all', label: isSchool ? 'All levels' : 'All courses', icon: 'book-open' }]
    .concat(
      scoped.coursesList
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((c) => ({ value: c.id, label: c.name || c.code || c.id, icon: 'book-open' }))
    );
  state.selects.course.setOptions(opts);
}

async function loadHistory({ forceRefresh = false } = {}) {
  if (!state || state.destroyed) return;
  const refreshBtn = $('payh-refresh');
  const errBox = $('payh-error');
  const scrollWrap = $('payh-scroll-wrap');
  const footBar = $('payh-foot');
  if (errBox) errBox.hidden = true;
  if (scrollWrap) scrollWrap.hidden = false;
  if (footBar) footBar.hidden = false;

  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spin');
  }
  showSkeleton();

  try {
    let totalReads = 0;
    const { dateFrom, dateTo } = state.filters;

    if (state.ctx === 'youth') {
      state.youthResult = await loadYouthPaymentHistory({
        profile: state.profile,
        dateFrom,
        dateTo,
        loadAll: true,
        forceRefresh
      });
      state.kidsResult = null;
      totalReads += state.youthResult.readCount || 0;
    } else {
      state.kidsResult = await loadKidsPaymentHistory({
        profile: state.profile,
        dateFrom,
        dateTo,
        forceRefresh
      });
      state.youthResult = null;
      totalReads += state.kidsResult.readCount || 0;
    }

    if (!state || state.destroyed) return;
    hideSkeleton();
    state.totalReadCount = totalReads;
    rebuildMergedAndCollectorOptions();
    updateLoadMoreUi();
    applyFiltersAndRender();
  } catch (err) {
    console.error('[payments] loadHistory failed', err);
    showLoadError(err);
  } finally {
    hideSkeleton();
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spin');
    }
  }
}

async function loadMoreYouth({ loadAll = false } = {}) {
  if (!state || state.ctx !== 'youth' || !state.youthResult?.hasMore) return;
  const btnBanMore = $('payh-banner-loadmore');
  const btnBanAll = $('payh-banner-loadall');
  [btnBanMore, btnBanAll].forEach((b) => { if (b) b.disabled = true; });

  try {
    let loops = 0;
    do {
      const next = await loadYouthPaymentHistory({
        profile: state.profile,
        dateFrom: state.filters.dateFrom,
        dateTo: state.filters.dateTo,
        cursor: state.youthResult.lastCursor,
        existingState: state.youthResult
      });
      state.youthResult = next;
      state.totalReadCount += next.readCount || 0;
      loops += 1;
    } while (loadAll && state.youthResult.hasMore && loops < 15);

    if (!state || state.destroyed) return;
    rebuildMergedAndCollectorOptions();
    updateLoadMoreUi();
    applyFiltersAndRender();
  } catch (err) {
    console.error('[payments] loadMoreYouth failed', err);
    showToast({ type: 'error', message: 'Failed to load older receipts: ' + (err.message || err) });
  } finally {
    [btnBanMore, btnBanAll].forEach((b) => { if (b) b.disabled = false; });
  }
}

function rebuildMergedAndCollectorOptions() {
  const list = state.ctx === 'school'
    ? (state.kidsResult?.entries || [])
    : (state.youthResult?.entries || []);

  state.mergedEntries = list.slice().sort((a, b) => (
    (b.date || '').localeCompare(a.date || '') ||
    Number(b.createdAtSec || 0) - Number(a.createdAtSec || 0) ||
    (b.receiptNo || '').localeCompare(a.receiptNo || '')
  ));

  const collectors = new Map();
  state.mergedEntries.forEach((e) => {
    const email = String(e.recordedBy || '').trim().toLowerCase();
    if (email) {
      const disp = resolveUserDisplay(email, e.recordedByName, e.recordedByDesignation);
      const label = disp.name && disp.name !== '-' ? disp.name : (formatCollectorName(e.recordedByName, email, e.recordedByDesignation) || email);
      collectors.set(email, disp.designation ? `${label} (${disp.designation})` : label);
    }
  });
  const colOpts = [{ value: 'all', label: 'All collectors', icon: 'users' }]
    .concat(
      Array.from(collectors.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([email, name]) => ({ value: email, label: name, icon: 'user' }))
    );
  state.selects.collector.setOptions(colOpts);
  if (state.filters.collector !== 'all' && !collectors.has(state.filters.collector)) {
    state.filters.collector = 'all';
  }
  state.selects.collector.setValue(state.filters.collector);
}

function updateLoadMoreUi() {
  const hasMore = Boolean(state.ctx === 'youth' && state.youthResult?.hasMore);
  const loadedCount = state.ctx === 'youth'
    ? (state.youthResult?.entries?.length || 0)
    : (state.kidsResult?.entries?.length || 0);
  $('payh-partial-banner').hidden = !hasMore;
  if (hasMore) {
    $('payh-partial-text').textContent =
      `Showing ${loadedCount} recent Youth receipts. Load more or Load All to include older receipts in totals.`;
  }
  console.debug('[payments] loaded', {
    ctx: state.ctx,
    reads: state.totalReadCount,
    entries: loadedCount,
    hasMore
  });
}

function showLoadError(err) {
  hideSkeleton();
  $('payh-breakdown-strip').hidden = true;
  const errBox = $('payh-error');
  const msgEl = $('payh-error-msg');
  const scrollWrap = $('payh-scroll-wrap');
  const footBar = $('payh-foot');
  if (scrollWrap) scrollWrap.hidden = true;
  if (footBar) footBar.hidden = true;
  if (errBox && msgEl) {
    msgEl.textContent = err?.message || 'Permission or network failure while loading payment history.';
    errBox.hidden = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

function updateFilterIndicators() {
  const f = state.filters;
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };

  let secondaryCount = 0;
  if (f.type !== 'all') secondaryCount++;
  if (f.mode !== 'all') secondaryCount++;
  if (f.courseId !== 'all') secondaryCount++;
  if (f.collector !== 'all') secondaryCount++;

  const mobileCount = secondaryCount +
    (state.ctx !== 'school' && state.profile?.role !== 'branch_head' && bb.branchId !== 'all' ? 1 : 0) +
    (bb.batchId !== 'all' ? 1 : 0) +
    (f.datePreset !== 'all' ? 1 : 0);

  const mobileBadge = $('payh-mobile-filters-count');
  if (mobileBadge) {
    mobileBadge.textContent = String(mobileCount);
    mobileBadge.hidden = mobileCount === 0;
  }

  const moreBtn = $('payh-more-btn');
  if (moreBtn) {
    moreBtn.classList.toggle('has-active', secondaryCount > 0);
    const label = moreBtn.querySelector('span');
    if (label) label.textContent = secondaryCount > 0 ? `More (${secondaryCount})` : 'More';
  }

  const hasCustomFilter = Boolean(f.search || mobileCount > 0);
  const resetBtn = $('payh-clear-filters');
  if (resetBtn) resetBtn.hidden = !hasCustomFilter;
}

function applyFiltersAndRender() {
  if (!state) return;
  const f = state.filters;
  const isSchool = state.ctx === 'school';
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };
  const activeSessId = state.activeSession?.id || '';

  state.filteredEntries = state.mergedEntries.filter((e) => {
    if (e.ctx && e.ctx !== state.ctx) return false;
    // Scope Youth entries strictly to active toolbar session
    if (!isSchool && activeSessId && e.sessionId && e.sessionId !== activeSessId) return false;
    if (!isSchool && bb.branchId !== 'all' && e.branchId !== bb.branchId) return false;
    if (bb.batchId !== 'all' && e.batchId !== bb.batchId) return false;
    if (f.courseId !== 'all') {
      const matchCr = e.courseId === f.courseId ||
        (isSchool && e.courseName && state.meta?.coursesById?.[f.courseId]?.name === e.courseName);
      if (!matchCr) return false;
    }
    if (f.type !== 'all') {
      if (f.type === 'ADMISSION') {
        const isAdm = e.isAdmissionGroup || e.type === 'AD' || e.type === 'FULL' || e.type === 'MAT';
        if (!isAdm) return false;
      } else if (e.type !== f.type) {
        return false;
      }
    }
    if (f.mode !== 'all') {
      const m = String(e.mode || '').toLowerCase();
      if (f.mode === 'bank') {
        if (m !== 'bank' && m !== 'bank_transfer') return false;
      } else if (m !== f.mode) {
        return false;
      }
    }
    if (f.collector !== 'all' && String(e.recordedBy || '').trim().toLowerCase() !== f.collector) return false;
    if (f.search && !(e.searchBlob || '').includes(f.search)) return false;
    return true;
  });

  updateFilterIndicators();
  const summary = summarizePaymentLedger(state.filteredEntries);
  updateSummaryUi(summary);
  renderTablePage();
}

function updateSummaryUi(summary) {
  const rcptWord = (n) => (n === 1 ? 'receipt' : 'receipts');
  const waiverWord = (n) => (n === 1 ? 'waiver log' : 'waiver logs');

  $('payh-kpi-total').textContent = formatINR(summary.totalCollected);
  const totalSub = $('payh-kpi-total-sub');
  totalSub.textContent = `${summary.moneyReceipts} ${rcptWord(summary.moneyReceipts)}`;
  totalSub.title = `${summary.moneyReceipts} ${rcptWord(summary.moneyReceipts)} (waivers excluded)`;
  $('payh-kpi-cash').textContent = formatINR(summary.cashTotal);
  $('payh-kpi-cash-sub').textContent = `${summary.cashCount} ${rcptWord(summary.cashCount)}`;
  $('payh-kpi-upi').textContent = formatINR(summary.upiTotal + summary.bankTotal);
  $('payh-kpi-upi-sub').textContent = summary.bankTotal > 0
    ? `UPI ${formatINR(summary.upiTotal)} · Bank ${formatINR(summary.bankTotal)}`
    : `${summary.upiCount} UPI ${rcptWord(summary.upiCount)}`;
  $('payh-kpi-late-paid').textContent = formatINR(summary.lateFeesCollected);
  $('payh-kpi-late-waived').textContent = formatINR(summary.lateFeesWaived);
  $('payh-kpi-waiver-sub').textContent = `${summary.waiverCount} ${waiverWord(summary.waiverCount)}`;

  const strip = $('payh-breakdown-strip');
  const chipsWrap = $('payh-type-chips');
  if (chipsWrap && strip) {
    chipsWrap.innerHTML = '';
    const order = getPaymentChipOrder(state.ctx);
    let shown = 0;
    for (const key of order) {
      const bucket = summary.byType[key];
      if (!bucket || (bucket.count === 0 && bucket.amount === 0)) continue;
      shown += 1;
      const chip = mk('span', 'fr-chip');
      chip.appendChild(mk('span', '', `${bucket.label} (${bucket.count}):`));
      chip.appendChild(mk('strong', '', formatINR(bucket.amount)));
      chipsWrap.appendChild(chip);
    }
    // Hide the strip entirely if zero categories exist so no empty white box renders
    strip.hidden = shown === 0;
  }
}

function renderTablePage() {
  const tbody = $('payh-tbody');
  const countBadge = $('payh-row-count');
  const footBar = $('payh-foot');
  if (!tbody) return;

  const list = state.filteredEntries;
  if (countBadge) countBadge.textContent = list.length === 1 ? '1 receipt' : `${list.length} receipts`;

  if (!list.length) {
    const hasFilter = $('payh-clear-filters') && !$('payh-clear-filters').hidden;
    renderEmptyTableState(tbody, {
      colSpan: 9,
      title: hasFilter ? 'No matching receipts' : 'No payment receipts yet',
      desc: hasFilter
        ? 'No receipts match your search or filter criteria.'
        : (state.ctx === 'school'
          ? 'Collected admission fees, monthly bills, and waivers will appear here.'
          : 'Collected admissions, installments, and exam fees will appear here.'),
      onClear: hasFilter ? () => resetAllFilters() : undefined
    });
    if (footBar) renderPager(footBar, { page: 1, pageSize: PAGE_SIZE, totalItems: 0, showWhenSingle: false });
    return;
  }

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageRows = list.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = '';
  for (const entry of pageRows) {
    tbody.appendChild(buildPaymentRow(entry));
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

  const visibleIds = pageRows.map((e) => e.studentDocId).filter(Boolean);
  loadStudentPhotos(visibleIds).then(() => {
    if (!state || state.destroyed) return;
    pageRows.forEach((e) => {
      const url = getCachedStudentPhoto(e.studentDocId);
      if (!url) return;
      const slot = tbody.querySelector(`.fr-avatar-slot[data-sid="${CSS.escape(e.studentDocId)}"]`);
      if (slot && slot.tagName !== 'IMG') {
        const img = document.createElement('img');
        img.className = 'fr-avatar';
        img.src = url;
        img.alt = e.studentName || '';
        slot.replaceWith(img);
      }
    });
  }).catch(() => {});
}

function navigateToReceipt(entry) {
  if (!entry.receiptRoute) {
    if (entry.studentDocId) {
      location.hash = `#/students/${encodeURIComponent(entry.studentDocId)}?tab=payments`;
    }
    return;
  }
  const route = entry.receiptRoute;
  const [baseRoute] = route.split('?');
  if (baseRoute.startsWith('#/payments/') && baseRoute.endsWith('/receipt')) {
    const fromSlug = state.ctx === 'school' ? 'school-payments' : 'payments';
    location.hash = `${baseRoute}?from=${fromSlug}`;
    return;
  }
  location.hash = route;
}

function typePillClass(typeCode, isAdmGroup) {
  if (typeCode === 'WA') return 'waived';
  if (typeCode === 'EX') return 'purple';
  if (typeCode === 'KIDS_MONTHLY') return 'paid';
  if (isAdmGroup || typeCode === 'AD' || typeCode === 'FULL' || typeCode === 'MAT') return 'neutral';
  return 'sky';
}

function buildPaymentRow(entry) {
  const tr = document.createElement('tr');

  const tdDate = mk('td', 'fr-col-date');
  tdDate.dataset.label = 'Date';
  const dtWrap = document.createElement('div');
  dtWrap.appendChild(mk('span', 'fr-date-main', entry.date ? fmtDate(entry.date) : '-'));
  const colDisp = resolveUserDisplay(entry.recordedBy, entry.recordedByName, entry.recordedByDesignation);
  const collectorDisplay = (colDisp.name && colDisp.name !== '-' ? colDisp.name : formatCollectorName(entry.recordedByName, entry.recordedBy, entry.recordedByDesignation));
  if (collectorDisplay) {
    const byLine = mk('span', 'lp-sub fr-col-by', `by ${collectorDisplay}`);
    byLine.title = colDisp.designation ? `${collectorDisplay} · ${colDisp.designation}` : collectorDisplay;
    dtWrap.appendChild(byLine);
  }
  tdDate.appendChild(dtWrap);

  const tdStudent = mk('td', 'fr-col-student');
  tdStudent.dataset.label = 'Student';
  const cell = mk('div', 'fr-student-cell');
  const stDisplayName = formatPersonName(entry.studentName || '') || entry.studentName || '-';
  const cachedPhoto = getCachedStudentPhoto(entry.studentDocId);
  if (cachedPhoto) {
    const img = document.createElement('img');
    img.className = 'fr-avatar';
    img.src = cachedPhoto;
    img.alt = stDisplayName;
    cell.appendChild(img);
  } else {
    const av = mk('span', 'fr-avatar-fallback fr-avatar-slot', initials(stDisplayName || 'ST'));
    av.dataset.sid = entry.studentDocId || '';
    cell.appendChild(av);
  }
  const meta = mk('div', 'fr-student-meta');
  const nameBtn = mk('button', 'fr-student-link', stDisplayName);
  nameBtn.type = 'button';
  nameBtn.title = stDisplayName;
  nameBtn.addEventListener('click', () => {
    if (entry.studentDocId) location.hash = `#/students/${encodeURIComponent(entry.studentDocId)}?tab=payments`;
  });
  meta.append(nameBtn, mk('span', 'lp-sub', entry.studentId || '-'));
  cell.appendChild(meta);
  tdStudent.appendChild(cell);

  const tdCourse = mk('td', 'fr-col-cb');
  tdCourse.dataset.label = state.ctx === 'school' ? 'Level, Branch & Batch' : 'Course, Branch & Batch';
  const cb = formatCourseBranchDisplay(entry);
  tdCourse.title = [cb.tooltip, entry.batchName].filter(Boolean).join('\n') || '-';
  const cbWrap = document.createElement('div');
  const cbLine1 = mk('div', 'fr-cb-inline');
  cbLine1.title = cb.tooltip;
  if (cb.courseLabel) cbLine1.appendChild(mk('strong', 'fr-cb-course', cb.courseLabel));
  if (cb.courseLabel && cb.branchLabel) cbLine1.appendChild(mk('span', 'fr-cb-sep', ' - '));
  if (cb.branchLabel) {
    cbLine1.appendChild(mk('span', cb.hasBranchCode ? 'pill neutral fr-cb-branch' : 'fr-cb-course', cb.branchLabel));
  }
  if (cbLine1.childNodes.length) cbWrap.appendChild(cbLine1);
  if (entry.batchName) {
    const batchLine = mk('span', 'lp-sub fr-sub-ellipsis', entry.batchName);
    batchLine.title = entry.batchName;
    cbWrap.appendChild(batchLine);
  }
  if (!cbWrap.childNodes.length) cbWrap.textContent = '-';
  tdCourse.appendChild(cbWrap);

  const tdFor = document.createElement('td');
  tdFor.dataset.label = 'Payment For';
  const forWrap = document.createElement('div');
  const forPill = mk('span', `pill ${typePillClass(entry.type, entry.isAdmissionGroup)}`, entry.typeLabel || entry.type || '-');
  if (Array.isArray(entry.breakdown) && entry.breakdown.length > 1) {
    forPill.title = entry.breakdown.map((b) => `${b.label || b.type || 'Item'}: ${formatINR(b.amount || 0)}`).join(' + ');
  }
  forWrap.appendChild(forPill);
  if (entry.remarks && entry.remarks !== entry.typeLabel) {
    const remEl = mk('span', 'lp-sub fr-sub-ellipsis', entry.remarks);
    remEl.title = entry.remarks;
    forWrap.appendChild(remEl);
  }
  tdFor.appendChild(forWrap);

  const tdMode = mk('td', 'fr-col-mode');
  tdMode.dataset.label = 'Mode';
  const mMeta = modeDisplayMeta(entry);
  const modeRaw = String(entry.mode || 'cash').toLowerCase().trim();
  const isCashOrWaiver = modeRaw === 'cash' || entry.isPureWaiver || modeRaw === 'waiver';
  const modeBadge = mk('span', `la-mode fr-mode-badge ${mMeta.cls || 'cash'}`);
  const mIcon = document.createElement('i');
  mIcon.setAttribute('data-lucide', mMeta.icon);
  modeBadge.append(mIcon, mk('span', '', mMeta.label));
  tdMode.appendChild(modeBadge);

  const txnRef = String(entry.txnId || '').trim();
  // Mobile-only card row: Transaction ID as separate field with full ID
  const tdTxn = mk('td', isCashOrWaiver ? 'fr-mobile-only-td fr-is-empty' : 'fr-mobile-only-td');
  tdTxn.dataset.label = 'Transaction ID';
  if (!isCashOrWaiver) {
    if (txnRef) {
      tdTxn.appendChild(mk('span', 'fr-mode-ref', txnRef));
    } else {
      tdTxn.appendChild(mk('span', 'fr-mode-missing', 'Not recorded'));
    }
  }

  const tdFee = mk('td', 'num');
  tdFee.dataset.label = 'Fee / Late';
  const feeWrap = document.createElement('div');
  feeWrap.appendChild(mk('span', 'fr-money', formatINR(entry.amount || 0)));
  if (Number(entry.lateFeePaid || 0) > 0) {
    feeWrap.appendChild(mk('span', 'lp-sub', `+ ${formatINR(entry.lateFeePaid)} late`));
  } else if (Number(entry.lateFeeWaived || 0) > 0) {
    feeWrap.appendChild(mk('span', 'lp-sub', `Waived ${formatINR(entry.lateFeeWaived)}`));
  }
  tdFee.appendChild(feeWrap);

  const tdTotal = mk('td', 'num fr-col-received');
  tdTotal.dataset.label = 'Received';
  if (entry.isPureWaiver) {
    tdTotal.appendChild(mk('span', 'pill waived', `${formatINR(0)} (Waived)`));
  } else {
    tdTotal.appendChild(mk('span', 'fr-money success', formatINR(entry.totalReceived || 0)));
  }

  const tdAct = mk('td', 'fr-rcpt-td');
  tdAct.dataset.label = 'Receipt';
  if (entry.isPureWaiver) {
    tdAct.appendChild(mk('span', 'pill waived', 'Waiver Log'));
  } else {
    const fullReceipt = String(entry.receiptNo || '').trim();
    const shortLabel = formatShortReceipt(fullReceipt) || 'Open';
    const rcBtn = mk('button', 'fr-rcpt-link');
    rcBtn.type = 'button';
    rcBtn.title = fullReceipt && fullReceipt !== '-' ? `${fullReceipt} - Open receipt` : 'Open receipt';
    const rIcon = document.createElement('i');
    rIcon.setAttribute('data-lucide', 'receipt');
    rcBtn.append(rIcon, mk('span', '', shortLabel));
    rcBtn.addEventListener('click', () => navigateToReceipt(entry));
    tdAct.appendChild(rcBtn);
  }

  const tdDetails = mk('td', 'fr-action-td');
  tdDetails.dataset.label = 'Action';
  const detBtn = mk('button', 'ui-kebab fr-act-btn');
  detBtn.type = 'button';
  detBtn.title = 'View payment details';
  detBtn.setAttribute('aria-label', `View payment details for ${entry.studentName || 'payment'}`);
  detBtn.innerHTML = '<i data-lucide="eye"></i><span>Details</span>';
  detBtn.addEventListener('click', () => openPaymentDetailsPopup(entry));
  tdDetails.appendChild(detBtn);

  tr.append(tdDate, tdStudent, tdCourse, tdFor, tdMode, tdTxn, tdFee, tdTotal, tdAct, tdDetails);
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
    const valCls = 'adm-view-value' + (f.mono ? ' fr-mono' : '') + (f.highlight ? ' fr-val-strong' : '');
    const tdV = mk('td', valCls);
    if (Array.isArray(f.items) && f.items.length) {
      const list = mk('div', 'fr-det-breakdown');
      f.items.forEach((item) => {
        const itemRow = mk('div', 'fr-det-breakdown-item');
        itemRow.append(
          mk('span', 'fr-det-breakdown-name', item.label),
          mk('span', 'fr-det-breakdown-amt', item.value)
        );
        list.appendChild(itemRow);
      });
      tdV.appendChild(list);
    } else {
      tdV.textContent = f.value;
    }
    tr.append(tdL, tdV);
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  body.appendChild(tbl);
  card.append(head, body);
  return card;
}

async function openPaymentDetailsPopup(entry) {
  if (!entry) return;
  const sessionsById = {};
  (state?.sessions || []).forEach((s) => { if (s?.id) sessionsById[s.id] = s; });

  const bill = (entry.ctx === 'school' && entry.billId)
    ? await getCachedBillForEntry(entry.billId)
    : null;
  if (!state || state.destroyed) return;

  const model = buildPaymentDetailsModel(entry, { sessionsById, bill });
  const tone = model.status.cls === 'paid' ? 'success' : 'amber';
  let copyTimer = null;

  const popup = openPopup({
    title: 'Payment Details',
    subtitle: model.receiptId,
    icon: 'receipt',
    tone,
    wide: true,
    onClose: () => {
      if (copyTimer) {
        clearTimeout(copyTimer);
        copyTimer = null;
      }
    }
  });

  // Add status badge right beside "Payment Details" title
  const titleEl = popup.head.querySelector('.adm-view-title');
  if (titleEl) {
    titleEl.textContent = '';
    const row = mk('span', 'fr-det-head-row');
    row.append(
      mk('span', '', 'Payment Details'),
      mk('span', `pill ${model.status.cls}`, model.status.label)
    );
    titleEl.appendChild(row);
  }

  // Receipt & Copy icon buttons in header right before Close (X): [Receipt] [Copy] [X]
  const receiptBtn = mk('button', 'ui-btn ghost adm-view-close');
  receiptBtn.type = 'button';
  receiptBtn.title = 'Open receipt';
  receiptBtn.setAttribute('aria-label', 'Open receipt');
  receiptBtn.innerHTML = '<i data-lucide="receipt" width="18" height="18"></i>';
  receiptBtn.addEventListener('click', () => {
    popup.close();
    navigateToReceipt(entry);
  });

  const copyBtn = mk('button', 'ui-btn ghost adm-view-close fr-copy-btn');
  copyBtn.type = 'button';
  copyBtn.title = 'Copy payment details';
  copyBtn.setAttribute('aria-label', 'Copy payment details');
  copyBtn.innerHTML = '<i data-lucide="copy" width="18" height="18"></i>';
  copyBtn.addEventListener('click', async () => {
    const ok = await copyTextWithFallback(model.copyText);
    if (!ok) {
      showToast({ type: 'error', message: 'Unable to copy payment details.' });
      return;
    }
    showToast({ type: 'success', message: 'Payment details copied' });
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

  const closeIconBtn = popup.actions.firstChild;
  popup.actions.insertBefore(receiptBtn, closeIconBtn);
  popup.actions.insertBefore(copyBtn, closeIconBtn);

  const stack = mk('div', 'fr-det-stack');
  const grid = mk('div', 'fr-det-grid');
  if (model.studentFields.length) grid.appendChild(buildDetailCard('STUDENT', 'user', model.studentFields));
  const combinedPaymentFields = [...model.paymentFields, ...model.transactionFields];
  if (combinedPaymentFields.length) grid.appendChild(buildDetailCard('PAYMENT', 'indian-rupee', combinedPaymentFields));

  const remarksCard = mk('div', 'adm-view-card fr-det-card-full');
  const remHead = mk('div', 'adm-view-card-head');
  const remIc = document.createElement('i');
  remIc.setAttribute('data-lucide', 'message-square');
  remHead.append(remIc, mk('span', 'adm-view-card-title', 'REMARKS'));
  const remBody = mk('div', 'adm-view-card-body');
  const remP = mk('p', 'fr-det-remarks' + (model.remarksText === 'No remarks' ? ' is-empty' : ''), model.remarksText);
  remBody.appendChild(remP);
  remarksCard.append(remHead, remBody);
  grid.appendChild(remarksCard);

  stack.appendChild(grid);
  popup.container.appendChild(stack);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function handleExportCsv() {
  const list = state?.filteredEntries || [];
  if (!list.length) {
    showToast({ type: 'warning', message: 'No receipts to export.' });
    return;
  }
  const isSchool = state.ctx === 'school';
  const headers = [
    'Date',
    'Student ID',
    'Student Name',
    'Phone',
    isSchool ? 'Level, Branch & Batch' : 'Course, Branch & Batch',
    'Type',
    'Payment For',
    'Base Fee (INR)',
    'Late Fee Paid (INR)',
    isSchool ? 'Waived (INR)' : 'Late Fee Waived (INR)',
    'Total Received (INR)',
    'Mode',
    'Transaction ID',
    'Collected By',
    'Receipt'
  ];
  const rows = list.map((e) => [
    e.date ? fmtDate(e.date) : '',
    e.studentId || '',
    e.studentName || '',
    e.phone || '',
    [formatCourseAndBranch(e), e.batchName].filter(Boolean).join(' · '),
    e.type || '',
    (e.typeLabel || '') + (e.remarks ? ` (${e.remarks})` : ''),
    Number(e.amount || 0),
    Number(e.lateFeePaid || 0),
    Number(e.lateFeeWaived || 0),
    Number(e.totalReceived || 0),
    String(modeDisplayMeta(e).label || e.mode || ''),
    e.txnId || '',
    formatCollectorWithDesignation(e) || formatCollectorName(e.recordedByName, e.recordedBy, e.recordedByDesignation) || '',
    e.receiptNo || (e.isPureWaiver ? 'Waiver Log' : '')
  ]);
  const slug = isSchool ? 'kids' : 'youth';
  downloadCsv(`payment-history-${slug}-${todayISO()}.csv`, headers, rows);
}

function handlePrintCashReport() {
  const list = state?.filteredEntries || [];
  const summary = summarizePaymentLedger(list);
  const rangeLabel = state.filters.dateFrom || state.filters.dateTo
    ? `${state.filters.dateFrom ? fmtDate(state.filters.dateFrom) : 'Start'} to ${state.filters.dateTo ? fmtDate(state.filters.dateTo) : 'Today'}`
    : 'All Dates';
  const isSchool = state.ctx === 'school';
  const orgTitle = isSchool ? 'Unique Kids' : 'Youth Centre';

  const ok = openPrintSheet({
    title: `${orgTitle} — Daily Cash & Collection Report`,
    subtitle: `Date Scope: ${rangeLabel} · Mode: ${state.filters.mode} · Receipts: ${summary.moneyReceipts}`,
    summaryPairs: [
      { label: 'Total Collected', value: formatINR(summary.totalCollected) },
      { label: 'Cash', value: `${formatINR(summary.cashTotal)} (${summary.cashCount})` },
      { label: 'UPI / Bank', value: `${formatINR(summary.upiTotal + summary.bankTotal)} (${summary.upiCount + summary.bankCount})` },
      { label: 'Late Fees Collected', value: formatINR(summary.lateFeesCollected) },
      { label: 'Late Fees Waived', value: formatINR(summary.lateFeesWaived) }
    ],
    columns: [
      { label: 'Date' },
      { label: 'Student' },
      { label: isSchool ? 'Level, Branch & Batch' : 'Course, Branch & Batch' },
      { label: 'Payment For' },
      { label: 'Mode' },
      { label: 'Transaction ID' },
      { label: 'Collected By' },
      { label: 'Late Paid', num: true },
      { label: 'Waived', num: true },
      { label: 'Received', num: true },
      { label: 'Receipt' }
    ],
    rows: list.map((e) => [
      e.date ? fmtDate(e.date) : '-',
      `${e.studentName} (${e.studentId || '-'})`,
      [formatCourseAndBranch(e), e.batchName].filter(Boolean).join(' · ') || '-',
      e.typeLabel || e.type || '-',
      modeDisplayMeta(e).label,
      e.txnId || '-',
      formatCollectorWithDesignation(e) || formatCollectorName(e.recordedByName, e.recordedBy, e.recordedByDesignation) || '-',
      formatINR(e.lateFeePaid || 0),
      formatINR(e.lateFeeWaived || 0),
      e.isPureWaiver ? `${formatINR(0)} (Waiver)` : formatINR(e.totalReceived || 0),
      e.receiptNo || (e.isPureWaiver ? 'Waiver Log' : '-')
    ]),
    footerNote: (() => {
      const pDisp = resolveUserDisplay(state.profile?.email, state.profile?.name, state.profile?.designation);
      const who = pDisp.name && pDisp.name !== '-' ? pDisp.name : (formatPersonName(state.profile?.name || state.profile?.email) || 'User');
      return `Printed by ${who}${pDisp.designation ? ' (' + pDisp.designation + ')' : ''}`;
    })()
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
  if (usersUpdatedListener) {
    window.removeEventListener('uic:users-updated', usersUpdatedListener);
    usersUpdatedListener = null;
  }
  state = null;
}
