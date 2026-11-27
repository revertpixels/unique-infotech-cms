// reports.page.js — Unified Financial Reports page (Youth Centre & Unique Kids)
// Accessible exclusively to Super Admin role (resolved dynamically via getRoleTitle).

import { createSelect } from '../components/ui-select.js?v=1.8.176';
import { createBranchBatchFilter, clearPersistedBranchBatchFilters } from '../components/branch-batch-filter.js?v=1.8.176';
import { openPopup } from '../components/modal.js?v=1.8.176';
import { showToast } from '../components/toast.js?v=1.8.176';
import { renderPager, renderEmptyTableState, PAGE_SIZE } from '../components/list-page.js?v=1.8.176';
import {
  getCachedSessions,
  loadSessions,
  getSelectedSession
} from '../core/sessions.js?v=1.8.176';
import {
  ensureReferenceData,
  scopeReferenceDataByCtx,
  getPaymentDatePresetOptions,
  getPaymentTypeFilterOptions,
  getPaymentModeFilterOptions,
  getPaymentChipOrder,
  loadYouthPaymentHistory,
  loadKidsPaymentHistory,
  loadYouthPendingReport,
  loadKidsPendingReport,
  loadStudentPhotos,
  getCachedStudentPhoto,
  getCachedBillForEntry,
  getDatePresetRange,
  formatCourseBranchDisplay,
  formatCollectorName,
  formatCollectorWithDesignation,
  formatShortReceipt,
  modeDisplayMeta,
  buildPaymentDetailsModel,
  buildFinancialReportAggregates,
  exportFinancialReportPdf,
  downloadCsv,
  openPrintSheet,
  toTitleCaseIfCaps,
  formatINR,
  fmtDate,
  todayISO
} from '../services/report.service.js?v=1.8.176';
import { formatPersonName, initials } from '../utils/formatter.js?v=1.8.176';
import { resolveUserDisplay, getRoleTitle } from '../services/user-directory.service.js?v=1.8.176';

let state = null;
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
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function ic(name) {
  const i = document.createElement('i');
  i.setAttribute('data-lucide', name);
  return i;
}

function paint() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function yesterdayISO() {
  const today = todayISO();
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function resolveActiveYouthSession() {
  if (!state) return null;
  const cached = getCachedSessions('youth');
  if (cached.length) state.sessions = cached;
  return getSelectedSession('youth') || state.sessions[0] || null;
}

function toggleNoSessionState(show) {
  $('rep-no-session').hidden = !show;
  $('rep-stats').hidden = show;
  $('rep-toolbar').hidden = show;
  $('rep-tabs').hidden = show;
  $('rep-panel-collection').hidden = show || state?.activeTab !== 'collection';
  $('rep-panel-settlement').hidden = show || state?.ctx === 'school' || state?.activeTab !== 'settlement';
  $('rep-panel-waivers').hidden = show || state?.activeTab !== 'waivers';
  $('rep-panel-overview').hidden = show || state?.activeTab !== 'overview';
  if (show) {
    $('rep-breakdown-strip').hidden = true;
    $('rep-partial-banner').hidden = true;
    paint();
  }
}

function showSkeleton() {
  $('rep-breakdown-strip').hidden = true;
  $('rep-col-footer-summaries').hidden = true;
  const stats = $('rep-stats');
  if (stats) {
    stats.classList.add('is-loading');
    stats.querySelectorAll('.lp-stat-value').forEach((el) => {
      el.textContent = '';
      el.classList.add('skel');
    });
  }
  const tbody = $('rep-col-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const widths = ['w-date', 'w-long', 'w-med', 'w-short', 'w-short', 'w-short', 'w-short', 'w-act'];
  for (let i = 0; i < 6; i++) {
    const tr = mk('tr', 'adm-sk-row');
    widths.forEach((w) => {
      const td = mk('td');
      td.appendChild(mk('div', 'adm-sk-cell skel ' + w));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
}

function hideSkeleton() {
  const stats = $('rep-stats');
  if (!stats) return;
  stats.classList.remove('is-loading');
  stats.querySelectorAll('.lp-stat-value').forEach((el) => el.classList.remove('skel'));
}

export async function mount({ profile, ctx }) {
  const isSuper = profile?.role === 'superadmin';
  const activeCtx = ctx === 'school' ? 'school' : 'youth';

  if (!isSuper) {
    $('rep-access-denied').hidden = false;
    $('rep-main').hidden = true;
    const superLabel = getRoleTitle('superadmin');
    $('rep-denied-desc').textContent = `Financial reports can only be accessed by ${superLabel}.`;
    paint();
    return;
  }

  $('rep-access-denied').hidden = true;
  $('rep-main').hidden = false;

  if (lastMountedCtx && lastMountedCtx !== activeCtx) {
    clearPersistedBranchBatchFilters('reports.');
  }
  lastMountedCtx = activeCtx;

  const today = todayISO();
  state = {
    profile,
    ctx: activeCtx,
    meta: null,
    sessions: getCachedSessions('youth'),
    activeSession: null,
    activeTab: 'collection',
    sortBy: 'date',
    sortDir: 'desc',
    filters: {
      datePreset: 'all',
      singleDate: today,
      dateFrom: today,
      dateTo: today,
      collectedAt: 'all',
      collector: 'all',
      courseId: 'all',
      type: 'all',
      mode: 'all',
      search: ''
    },
    bbFilter: null,
    selects: {},
    youthResult: null,
    kidsResult: null,
    pendingResult: null,
    mergedEntries: [],
    filteredEntries: [],
    aggs: null,
    page: 1,
    totalReadCount: 0,
    destroyed: false
  };

  updateHeaderText();
  initControls();
  bindEvents();
  switchTab('collection');
  showSkeleton();
  await bootstrapData({ forceRefresh: false });
}

function updateHeaderText() {
  if (!state) return;
  const isSchool = state.ctx === 'school';
  const label = isSchool ? 'Unique Kids' : 'Youth Centre';
  const sessName = !isSchool && state.activeSession?.name ? ` · ${state.activeSession.name}` : '';
  const superLabel = getRoleTitle('superadmin');

  $('rep-crumb-ctx').textContent = label;
  $('rep-title').textContent = `${label} — Financial Reports`;
  $('rep-subtitle').textContent = isSchool
    ? 'Collections, collector accountability, fine waivers, and overdue dues across Unique Kids.'
    : `Collections, collector accountability, branch cash settlement, and fine waivers${sessName}.`;

  const badge = $('rep-scope-badge');
  if (badge) {
    badge.hidden = false;
    badge.textContent = `${superLabel} · ${isSchool ? 'Unique Kids' : 'All Branches'}`;
  }

  $('rep-course-label').textContent = isSchool ? 'Level' : 'Course';
  $('rep-col-th-cb').textContent = isSchool ? 'Level, Branch & Batch' : 'Course, Branch & Batch';
  $('rep-courses-th-name').textContent = isSchool ? 'Level' : 'Course';

  const settleHoTh = $('rep-settle-th-ho');
  if (settleHoTh) settleHoTh.textContent = `HO / ${superLabel}`;

  const settleTab = $('rep-tab-settlement');
  if (settleTab) settleTab.hidden = isSchool;
  if (isSchool && state.activeTab === 'settlement') {
    state.activeTab = 'collection';
  }
}

function switchTab(tabKey) {
  if (!state) return;
  const target = (state.ctx === 'school' && tabKey === 'settlement') ? 'collection' : tabKey;
  state.activeTab = target;

  document.querySelectorAll('#rep-tabs .org-tab').forEach((btn) => {
    const active = btn.dataset.tab === target;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  ['collection', 'settlement', 'waivers', 'overview'].forEach((k) => {
    const panel = $(`rep-panel-${k}`);
    if (!panel) return;
    panel.hidden = k !== target || (k === 'settlement' && state.ctx === 'school');
  });
}

function computeActiveDateRange() {
  if (!state) return { from: '', to: '' };
  const f = state.filters;
  if (f.datePreset === 'single') {
    const d = f.singleDate || todayISO();
    return { from: d, to: d };
  }
  if (f.datePreset === 'custom') {
    return { from: f.dateFrom || '', to: f.dateTo || '' };
  }
  if (f.datePreset === 'all') {
    return { from: '', to: '' };
  }
  return getDatePresetRange(f.datePreset, todayISO(), state.activeSession);
}

function updateDateSubbarVisibility() {
  if (!state) return;
  const preset = state.filters.datePreset;
  const sub = $('rep-date-subbar');
  const singleWrap = $('rep-single-date-wrap');
  const customWrap = $('rep-custom-range-wrap');

  const isSingle = preset === 'single';
  const isCustom = preset === 'custom';
  sub.hidden = !(isSingle || isCustom);
  singleWrap.hidden = !isSingle;
  customWrap.hidden = !isCustom;

  if (isSingle && !$('rep-single-date').value) {
    $('rep-single-date').value = state.filters.singleDate || todayISO();
  }
  if (isCustom) {
    if (!$('rep-date-from').value) $('rep-date-from').value = state.filters.dateFrom || todayISO();
    if (!$('rep-date-to').value) $('rep-date-to').value = state.filters.dateTo || todayISO();
  }
}

function initControls() {
  const isSchool = state.ctx === 'school';

  state.bbFilter = createBranchBatchFilter($('rep-bb-host'), {
    persistKey: 'reports.' + state.ctx,
    profile: state.profile,
    ctx: state.ctx,
    sessionId: '',
    branches: [],
    batches: [],
    courses: [],
    onChange: () => {
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.datePreset = createSelect($('rep-date-host'), {
    options: getPaymentDatePresetOptions(state.ctx, { includeSingle: true }),
    value: state.filters.datePreset,
    ariaLabel: 'Date range',
    onChange: async (val) => {
      state.filters.datePreset = val || 'all';
      updateDateSubbarVisibility();
      state.page = 1;
      await loadReportData({ forceRefresh: false });
    }
  });

  state.selects.collectedAt = createSelect($('rep-loc-host'), {
    options: [{ value: 'all', label: 'All locations', icon: 'map-pin' }],
    value: 'all',
    ariaLabel: 'Collected at location',
    onChange: (val) => {
      state.filters.collectedAt = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.collector = createSelect($('rep-collector-host'), {
    options: [{ value: 'all', label: 'All collectors', icon: 'users' }],
    value: 'all',
    ariaLabel: 'Collected by',
    onChange: (val) => {
      state.filters.collector = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.course = createSelect($('rep-course-host'), {
    options: [{ value: 'all', label: isSchool ? 'All levels' : 'All courses', icon: 'book-open' }],
    value: 'all',
    ariaLabel: isSchool ? 'Level' : 'Course',
    onChange: (val) => {
      state.filters.courseId = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.type = createSelect($('rep-type-host'), {
    options: getPaymentTypeFilterOptions(state.ctx),
    value: 'all',
    ariaLabel: 'Payment type',
    onChange: (val) => {
      state.filters.type = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });

  state.selects.mode = createSelect($('rep-mode-host'), {
    options: getPaymentModeFilterOptions(state.ctx),
    value: 'all',
    ariaLabel: 'Payment mode',
    onChange: (val) => {
      state.filters.mode = val || 'all';
      state.page = 1;
      applyFiltersAndRender();
    }
  });
}

function bindEvents() {
  document.querySelectorAll('#rep-tabs .org-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab || 'collection');
    });
  });

  const searchInp = $('rep-search');
  if (searchInp) {
    searchInp.addEventListener('input', () => {
      state.filters.search = (searchInp.value || '').trim().toLowerCase();
      state.page = 1;
      applyFiltersAndRender();
    });
  }

  $('rep-mobile-filters-btn')?.addEventListener('click', () => {
    const tb = $('rep-toolbar');
    const btn = $('rep-mobile-filters-btn');
    const open = tb.classList.toggle('is-filters-open');
    btn?.setAttribute('aria-expanded', String(open));
    if (!open) {
      $('rep-extra-filters').hidden = true;
      $('rep-more-btn')?.setAttribute('aria-expanded', 'false');
    }
  });

  $('rep-more-btn')?.addEventListener('click', () => {
    const extra = $('rep-extra-filters');
    const btn = $('rep-more-btn');
    if (!extra || !btn) return;
    extra.hidden = !extra.hidden;
    btn.setAttribute('aria-expanded', String(!extra.hidden));
  });

  $('rep-single-date')?.addEventListener('change', async () => {
    if (!state || state.filters.datePreset !== 'single') return;
    state.filters.singleDate = $('rep-single-date').value || todayISO();
    state.page = 1;
    await loadReportData({ forceRefresh: false });
  });

  $('rep-single-today')?.addEventListener('click', async () => {
    if (!state) return;
    const t = todayISO();
    state.filters.singleDate = t;
    $('rep-single-date').value = t;
    state.page = 1;
    await loadReportData({ forceRefresh: false });
  });

  $('rep-single-yesterday')?.addEventListener('click', async () => {
    if (!state) return;
    const y = yesterdayISO();
    state.filters.singleDate = y;
    $('rep-single-date').value = y;
    state.page = 1;
    await loadReportData({ forceRefresh: false });
  });

  const onRangeChange = async () => {
    if (!state || state.filters.datePreset !== 'custom') return;
    state.filters.dateFrom = $('rep-date-from').value || '';
    state.filters.dateTo = $('rep-date-to').value || '';
    state.page = 1;
    await loadReportData({ forceRefresh: false });
  };
  $('rep-date-from')?.addEventListener('change', onRangeChange);
  $('rep-date-to')?.addEventListener('change', onRangeChange);

  $('rep-clear-filters')?.addEventListener('click', () => resetAllFilters());

  $('rep-refresh')?.addEventListener('click', async () => {
    await loadReportData({ forceRefresh: true });
    showToast({ type: 'success', message: 'Financial reports refreshed.' });
  });
  $('rep-retry')?.addEventListener('click', () => loadReportData({ forceRefresh: true }));
  $('rep-banner-loadmore')?.addEventListener('click', () => loadMoreYouth({ loadAll: false }));
  $('rep-banner-loadall')?.addEventListener('click', () => loadMoreYouth({ loadAll: true }));

  $('rep-sort-date')?.addEventListener('click', () => toggleSort('date'));
  $('rep-sort-amount')?.addEventListener('click', () => toggleSort('amount'));

  $('rep-export-csv')?.addEventListener('click', handleExportCsv);
  $('rep-export-pdf')?.addEventListener('click', handleExportPdf);
  $('rep-print')?.addEventListener('click', handlePrintReport);

  const onSessionsSync = async () => {
    if (!state || state.destroyed || state.ctx !== 'youth') return;
    state.activeSession = resolveActiveYouthSession();
    updateHeaderText();
    if (!state.activeSession) {
      toggleNoSessionState(true);
      return;
    }
    toggleNoSessionState(false);
    syncBranchBatchContext();
    await loadReportData({ forceRefresh: false });
  };

  sessionsLoadedListener = () => onSessionsSync();
  sessionsChangedListener = async () => {
    if (!state || state.destroyed || state.ctx !== 'youth') return;
    state.sessions = await loadSessions('youth');
    onSessionsSync();
  };
  usersUpdatedListener = () => {
    if (!state || state.destroyed) return;
    populateDynamicFilterOptions();
    applyFiltersAndRender();
  };

  window.addEventListener('uic:sessions-loaded', sessionsLoadedListener);
  window.addEventListener('uic:sessions-changed', sessionsChangedListener);
  window.addEventListener('uic:users-updated', usersUpdatedListener);
}

function toggleSort(field) {
  if (!state) return;
  if (state.sortBy === field) {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    state.sortBy = field;
    state.sortDir = 'desc';
  }
  $('rep-sort-date')?.classList.toggle('is-active', state.sortBy === 'date');
  $('rep-sort-amount')?.classList.toggle('is-active', state.sortBy === 'amount');
  state.page = 1;
  applyFiltersAndRender();
}

async function resetAllFilters() {
  if (!state) return;
  state.filters.search = '';
  $('rep-search').value = '';
  clearPersistedBranchBatchFilters('reports.');
  state.bbFilter?.reset();

  state.filters.collectedAt = 'all';
  state.selects.collectedAt.setValue('all');
  state.filters.collector = 'all';
  state.selects.collector.setValue('all');
  state.filters.courseId = 'all';
  state.selects.course.setValue('all');
  state.filters.type = 'all';
  state.selects.type.setValue('all');
  state.filters.mode = 'all';
  state.selects.mode.setValue('all');

  const needReload = state.filters.datePreset !== 'all';
  state.filters.datePreset = 'all';
  state.selects.datePreset.setValue('all');
  updateDateSubbarVisibility();
  state.page = 1;

  if (needReload) await loadReportData({ forceRefresh: false });
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
    await loadReportData({ forceRefresh });
  } catch (err) {
    if (!state || state.destroyed) return;
    console.error('[reports] bootstrap failed', err);
    showLoadError(err);
  }
}

function populateCourseOptions() {
  const isSchool = state.ctx === 'school';
  const { coursesList } = scopeReferenceDataByCtx(state.meta || {}, state.ctx);
  const opts = [{ value: 'all', label: isSchool ? 'All levels' : 'All courses', icon: 'book-open' }]
    .concat(
      coursesList
        .slice()
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((c) => ({
          value: c.id,
          label: [c.courseCode || c.code, c.name || c.id].filter(Boolean).join(' - '),
          icon: 'book-open'
        }))
    );
  state.selects.course.setOptions(opts);
  if (state.filters.courseId !== 'all' && !opts.some((o) => o.value === state.filters.courseId)) {
    state.filters.courseId = 'all';
  }
  state.selects.course.setValue(state.filters.courseId);
}

async function loadReportData({ forceRefresh = false } = {}) {
  if (!state || state.destroyed) return;
  $('rep-error').hidden = true;
  showSkeleton();

  const { from, to } = computeActiveDateRange();
  try {
    if (state.ctx === 'youth') {
      const [histRes, pendRes] = await Promise.all([
        loadYouthPaymentHistory({
          profile: state.profile,
          dateFrom: from,
          dateTo: to,
          loadAll: true,
          forceRefresh
        }),
        loadYouthPendingReport({
          profile: state.profile,
          session: state.activeSession,
          forceRefresh
        })
      ]);
      if (!state || state.destroyed) return;
      state.youthResult = histRes;
      state.kidsResult = null;
      state.pendingResult = pendRes;
      state.totalReadCount = (histRes.readCount || 0) + (pendRes?.readCount || 0);
      state.mergedEntries = histRes.entries || [];
    } else {
      const [histRes, pendRes] = await Promise.all([
        loadKidsPaymentHistory({
          profile: state.profile,
          dateFrom: from,
          dateTo: to,
          forceRefresh
        }),
        loadKidsPendingReport({
          profile: state.profile,
          forceRefresh
        })
      ]);
      if (!state || state.destroyed) return;
      state.kidsResult = histRes;
      state.youthResult = null;
      state.pendingResult = pendRes;
      state.totalReadCount = (histRes.readCount || 0) + (pendRes?.readCount || 0);
      state.mergedEntries = histRes.entries || [];
    }

    populateDynamicFilterOptions();
    updateLoadMoreUi();
    applyFiltersAndRender();

    const uniqueIds = Array.from(new Set(state.mergedEntries.map((e) => e.studentDocId).filter(Boolean))).slice(0, 60);
    if (uniqueIds.length) {
      loadStudentPhotos(uniqueIds).then((map) => {
        if (!state || state.destroyed || !map || !map.size) return;
        renderCollectionTable();
        paint();
      }).catch(() => {});
    }
  } catch (err) {
    if (!state || state.destroyed) return;
    console.error('[reports] load failed', err);
    showLoadError(err);
  }
}

async function loadMoreYouth({ loadAll = false } = {}) {
  if (!state || state.ctx !== 'youth' || !state.youthResult?.hasMore) return;
  const { from, to } = computeActiveDateRange();
  const btn = loadAll ? $('rep-banner-loadall') : $('rep-banner-loadmore');
  if (btn) btn.disabled = true;
  try {
    const res = await loadYouthPaymentHistory({
      profile: state.profile,
      dateFrom: from,
      dateTo: to,
      cursor: state.youthResult.lastCursor,
      loadAll,
      maxBatches: loadAll ? 50 : 3,
      existingState: state.youthResult
    });
    if (!state || state.destroyed) return;
    state.youthResult = res;
    state.mergedEntries = res.entries || [];
    populateDynamicFilterOptions();
    updateLoadMoreUi();
    applyFiltersAndRender();
  } catch (err) {
    showToast({ type: 'error', message: err?.message || 'Failed to load older receipts.' });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function populateDynamicFilterOptions() {
  if (!state) return;
  const scoped = scopeReferenceDataByCtx(state.meta || {}, state.ctx);
  const activeSessId = state.activeSession?.id || '';

  // Collected At locations
  const locMap = new Map();
  if (state.ctx === 'school') {
    locMap.set('HO', 'Head Office (HO)');
  } else {
    locMap.set('HO', 'Head Office (HO)');
    scoped.branchesList.forEach((b) => {
      const lbl = [b.code || b.branchCode, toTitleCaseIfCaps(b.name || b.id)].filter(Boolean).join(' - ');
      locMap.set(b.id, lbl || b.id);
    });
  }

  const collectors = new Map();
  state.mergedEntries.forEach((e) => {
    if (state.ctx === 'youth' && activeSessId && e.sessionId && e.sessionId !== activeSessId) return;
    if (e.collectedAtKey && e.collectedAtLabel && !locMap.has(e.collectedAtKey)) {
      locMap.set(e.collectedAtKey, e.collectedAtLabel);
    }
    const email = String(e.recordedBy || '').toLowerCase().trim();
    if (email) {
      const disp = resolveUserDisplay(email, e.recordedByName, e.recordedByDesignation);
      const name = disp.name && disp.name !== '-' ? disp.name : (formatCollectorName(e.recordedByName, email, e.recordedByDesignation) || email);
      const desig = disp.designation || (e.collectedByRole ? getRoleTitle(e.collectedByRole) : '');
      collectors.set(email, desig ? `${name} (${desig})` : name);
    }
  });

  const locOpts = [{ value: 'all', label: 'All locations', icon: 'map-pin' }].concat(
    Array.from(locMap.entries()).map(([value, label]) => ({
      value,
      label,
      icon: value === 'HO' ? 'building-2' : 'git-branch'
    }))
  );
  state.selects.collectedAt.setOptions(locOpts);
  if (state.filters.collectedAt !== 'all' && !locMap.has(state.filters.collectedAt)) {
    state.filters.collectedAt = 'all';
  }
  state.selects.collectedAt.setValue(state.filters.collectedAt);

  const colOpts = [{ value: 'all', label: 'All collectors', icon: 'users' }].concat(
    Array.from(collectors.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label, icon: 'user' }))
  );
  state.selects.collector.setOptions(colOpts);
  if (state.filters.collector !== 'all' && !collectors.has(state.filters.collector)) {
    state.filters.collector = 'all';
  }
  state.selects.collector.setValue(state.filters.collector);
}

function updateLoadMoreUi() {
  const hasMore = Boolean(state.ctx === 'youth' && state.youthResult?.hasMore);
  const loadedCount = state.mergedEntries.length;
  $('rep-partial-banner').hidden = !hasMore;
  if (hasMore) {
    $('rep-partial-text').textContent = `Showing ${loadedCount} recent Youth receipts. Load older or Load All to include every receipt.`;
  }
}

function showLoadError(err) {
  hideSkeleton();
  $('rep-breakdown-strip').hidden = true;
  $('rep-col-footer-summaries').hidden = true;
  $('rep-error-msg').textContent = err?.message || 'Permission or network failure while loading financial reports.';
  $('rep-error').hidden = false;
  paint();
}

function updateFilterIndicators() {
  const f = state.filters;
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };

  let secondaryCount = 0;
  if (f.courseId !== 'all') secondaryCount++;
  if (f.type !== 'all') secondaryCount++;
  if (f.mode !== 'all') secondaryCount++;

  const mobileCount = secondaryCount +
    (state.ctx !== 'school' && bb.branchId !== 'all' ? 1 : 0) +
    (bb.batchId !== 'all' ? 1 : 0) +
    (f.datePreset !== 'all' ? 1 : 0) +
    (f.collectedAt !== 'all' ? 1 : 0) +
    (f.collector !== 'all' ? 1 : 0);

  const mobileBadge = $('rep-mobile-filters-count');
  if (mobileBadge) {
    mobileBadge.textContent = String(mobileCount);
    mobileBadge.hidden = mobileCount === 0;
  }

  const moreBtn = $('rep-more-btn');
  if (moreBtn) {
    moreBtn.classList.toggle('has-active', secondaryCount > 0);
    const sp = moreBtn.querySelector('span');
    if (sp) sp.textContent = secondaryCount > 0 ? `More (${secondaryCount})` : 'More';
  }

  const resetBtn = $('rep-clear-filters');
  if (resetBtn) resetBtn.hidden = !(f.search || mobileCount > 0);
}

function entryMatchesFilters(e, { applyLocationAndCollector = true } = {}) {
  const f = state.filters;
  const isSchool = state.ctx === 'school';
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };
  const activeSessId = state.activeSession?.id || '';

  if (e.ctx && e.ctx !== state.ctx) return false;
  if (!isSchool && activeSessId && e.sessionId && e.sessionId !== activeSessId) return false;
  if (!isSchool && bb.branchId !== 'all' && e.branchId !== bb.branchId) return false;
  if (bb.batchId !== 'all' && e.batchId !== bb.batchId) return false;

  if (f.courseId !== 'all' && e.courseId !== f.courseId) return false;
  if (f.type !== 'all') {
    if (f.type === 'WA') {
      if (!e.isPureWaiver && e.type !== 'WA' && !(Number(e.lateFeeWaived || 0) > 0)) return false;
    } else if (e.isAdmissionGroup && Array.isArray(e.breakdown)) {
      if (!e.breakdown.some((b) => String(b.type || '').toUpperCase() === f.type)) return false;
    } else if (String(e.type || '').toUpperCase() !== f.type) {
      return false;
    }
  }
  if (f.mode !== 'all') {
    if (e.isPureWaiver) return false;
    const m = String(e.mode || '').toLowerCase();
    const norm = (m === 'bank_transfer' || m === 'bank') ? 'bank' : m;
    if (norm !== f.mode) return false;
  }

  if (applyLocationAndCollector) {
    if (f.collectedAt !== 'all' && e.collectedAtKey !== f.collectedAt) return false;
    if (f.collector !== 'all' && String(e.recordedBy || '').toLowerCase() !== f.collector) return false;
  }

  if (f.search && !String(e.searchBlob || '').includes(f.search)) return false;
  return true;
}

function applyFiltersAndRender() {
  if (!state) return;

  const list = state.mergedEntries.filter((e) => entryMatchesFilters(e, { applyLocationAndCollector: true }));
  list.sort((a, b) => {
    if (state.sortBy === 'amount') {
      const av = a.isPureWaiver ? 0 : Number(a.totalReceived || 0);
      const bv = b.isPureWaiver ? 0 : Number(b.totalReceived || 0);
      const cmp = av - bv;
      if (cmp !== 0) return state.sortDir === 'asc' ? cmp : -cmp;
    }
    const dc = (a.date || '').localeCompare(b.date || '');
    if (dc !== 0) return state.sortBy === 'date' && state.sortDir === 'asc' ? dc : -dc;
    return (b.createdAtSec || 0) - (a.createdAtSec || 0);
  });

  state.filteredEntries = list;

  // Scope overdue pending items for Branch Settlement & Course tie-in using active Branch/Batch/Course
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };
  const scopedPending = (state.pendingResult?.items || []).filter((p) => {
    if (state.ctx === 'youth' && bb.branchId !== 'all' && p.branchId !== bb.branchId) return false;
    if (bb.batchId !== 'all' && p.batchId !== bb.batchId) return false;
    if (state.filters.courseId !== 'all' && p.courseId !== state.filters.courseId) return false;
    return true;
  });

  const scoped = scopeReferenceDataByCtx(state.meta || {}, state.ctx);
  state.aggs = buildFinancialReportAggregates(list, {
    branchesList: bb.branchId !== 'all' ? scoped.branchesList.filter((b) => b.id === bb.branchId) : scoped.branchesList,
    coursesList: state.filters.courseId !== 'all' ? scoped.coursesList.filter((c) => c.id === state.filters.courseId) : scoped.coursesList,
    pendingItems: scopedPending,
    usersByEmail: window.APP_CACHE?.usersByEmail || {},
    ctx: state.ctx
  });

  hideSkeleton();
  updateFilterIndicators();
  renderStatsAndChips();
  renderCollectionTable();
  renderCollectionFooterSummaries();
  renderSettlementTab();
  renderWaiversTab();
  renderOverviewTab();
  paint();
}

function renderStatsAndChips() {
  const s = state.aggs?.summary || {};
  $('rep-stat-total').textContent = formatINR(s.totalCollected || 0);
  $('rep-stat-total-sub').textContent = `${s.moneyReceipts || 0} receipt${s.moneyReceipts === 1 ? '' : 's'} · ${s.uniqueStudents || 0} student${s.uniqueStudents === 1 ? '' : 's'}`;

  $('rep-stat-cash').textContent = formatINR(s.cashTotal || 0);
  $('rep-stat-cash-sub').textContent = `${s.cashCount || 0} cash receipt${s.cashCount === 1 ? '' : 's'}`;

  $('rep-stat-digital').textContent = formatINR((s.upiTotal || 0) + (s.bankTotal || 0));
  $('rep-stat-digital-sub').textContent = `${(s.upiCount || 0) + (s.bankCount || 0)} digital receipt${((s.upiCount || 0) + (s.bankCount || 0)) === 1 ? '' : 's'}`;

  $('rep-stat-fines').textContent = formatINR(s.lateFeesCollected || 0);
  $('rep-stat-fines-sub').textContent = `${s.fineReceiptCount || 0} receipt${s.fineReceiptCount === 1 ? '' : 's'} with fine`;

  $('rep-stat-waived').textContent = formatINR(s.lateFeesWaived || 0);
  $('rep-stat-waived-sub').textContent = `${s.waiverCount || 0} waiver${s.waiverCount === 1 ? '' : 's'}`;

  const chipsWrap = $('rep-chips');
  chipsWrap.innerHTML = '';
  const keys = getPaymentChipOrder(state.ctx);
  let shownChips = 0;
  keys.forEach((k) => {
    const row = s.byType?.[k];
    if (!row || (!row.count && !row.amount)) return;
    shownChips++;
    const chip = mk('span', 'fr-chip');
    chip.append(`${row.label}: `, mk('strong', '', formatINR(row.amount)), ` (${row.count})`);
    chipsWrap.appendChild(chip);
  });

  $('rep-breakdown-strip').hidden = shownChips === 0 && !state.filteredEntries.length;
  const { from, to } = computeActiveDateRange();
  const rangeTxt = from || to
    ? (from === to ? `Date: ${fmtDate(from)}` : `Range: ${from ? fmtDate(from) : 'Start'} – ${to ? fmtDate(to) : 'Today'}`)
    : 'All dates in loaded scope';
  $('rep-meta-note').textContent = `${rangeTxt} · ${state.totalReadCount} reads`;
}

function makeAvatarCell(entry) {
  const wrap = mk('div', 'fr-student-cell');
  const photo = getCachedStudentPhoto(entry.studentDocId);
  if (photo) {
    const img = document.createElement('img');
    img.className = 'fr-avatar';
    img.src = photo;
    img.alt = entry.studentName || 'Student';
    wrap.appendChild(img);
  } else {
    wrap.appendChild(mk('div', 'fr-avatar-fallback', initials(entry.studentName || 'ST')));
  }
  const meta = mk('div', 'fr-student-meta');
  const link = mk('a', 'fr-student-link', formatPersonName(entry.studentName || 'Student'));
  link.href = `#/students/${encodeURIComponent(entry.studentDocId)}`;
  meta.appendChild(link);
  const sub = [entry.studentId, entry.phone].filter(Boolean).join(' · ');
  if (sub) meta.appendChild(mk('span', 'fr-sub-ellipsis', sub));
  wrap.appendChild(meta);
  return wrap;
}

function renderCollectionTable() {
  const tbody = $('rep-col-tbody');
  const pager = $('rep-col-pager');
  const list = state.filteredEntries || [];

  $('rep-col-count').textContent = `${list.length} record${list.length === 1 ? '' : 's'}`;

  if (!list.length) {
    renderEmptyTableState(tbody, {
      colSpan: 8,
      title: 'No matching transactions',
      desc: 'Try expanding the date window or clearing filters.',
      onClear: () => resetAllFilters()
    });
    pager.hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = list.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = '';
  pageItems.forEach((e) => {
    const tr = mk('tr');

    // 1. Date
    const tdDate = mk('td', 'fr-col-date');
    tdDate.dataset.label = 'Date';
    tdDate.appendChild(mk('span', 'fr-date-main', e.date ? fmtDate(e.date) : '-'));
    tr.appendChild(tdDate);

    // 2. Student
    const tdSt = mk('td', 'lp-td-primary fr-col-student');
    tdSt.appendChild(makeAvatarCell(e));
    tr.appendChild(tdSt);

    // 3. Course, Branch & Batch
    const tdCb = mk('td', 'fr-col-cb');
    tdCb.dataset.label = state.ctx === 'school' ? 'Level & Batch' : 'Course, Branch & Batch';
    const cbStack = mk('div', 'rep-cell-stack');
    const cbMeta = formatCourseBranchDisplay(e);
    const cbLine = mk('div', 'fr-cb-inline');
    if (cbMeta.courseLabel) cbLine.appendChild(mk('span', 'fr-cb-course', cbMeta.courseLabel));
    if (cbMeta.branchLabel) {
      if (cbLine.childNodes.length) cbLine.appendChild(mk('span', 'fr-cb-sep', '·'));
      cbLine.appendChild(mk('span', 'pill indigo fr-cb-branch', cbMeta.branchLabel));
    }
    cbStack.appendChild(cbLine);
    const typeAndBatch = [e.typeLabel || e.type, cbMeta.batchName].filter(Boolean).join(' · ');
    if (typeAndBatch) cbStack.appendChild(mk('span', 'fr-sub-ellipsis', typeAndBatch));
    tdCb.appendChild(cbStack);
    tr.appendChild(tdCb);

    // 4. Mode
    const tdMode = mk('td', 'fr-col-mode');
    tdMode.dataset.label = 'Mode';
    const modeStack = mk('div', 'rep-cell-stack');
    const mMeta = modeDisplayMeta(e);
    const badge = mk('span', `la-mode ${mMeta.cls} fr-mode-badge`);
    badge.append(ic(mMeta.icon), mk('span', '', mMeta.label));
    modeStack.appendChild(badge);
    if (e.txnId) modeStack.appendChild(mk('span', 'fr-mode-ref fr-mono', e.txnId));
    tdMode.appendChild(modeStack);
    tr.appendChild(tdMode);

    // 5. Collected By
    const tdBy = mk('td', 'rep-col-by');
    tdBy.dataset.label = 'Collected By';
    const byStack = mk('div', 'rep-cell-stack');
    const collectorTxt = formatCollectorWithDesignation(e)
      || formatCollectorName(e.recordedByName, e.recordedBy, e.recordedByDesignation)
      || 'Authorised Staff';
    byStack.appendChild(mk('span', 'rep-by-main', collectorTxt));
    if (e.collectedByRole) {
      byStack.appendChild(mk('span', 'fr-sub-ellipsis', getRoleTitle(e.collectedByRole)));
    }
    tdBy.appendChild(byStack);
    tr.appendChild(tdBy);

    // 6. Collected At
    const tdLoc = mk('td');
    tdLoc.dataset.label = 'Collected At';
    const locStack = mk('div', 'rep-cell-stack');
    const locPill = mk('span', `pill ${e.collectedAtType === 'head_office' ? 'sky' : 'indigo'}`, e.collectedAtShort || e.collectedAtLabel || 'HO');
    locStack.appendChild(locPill);
    if (e.isCrossBranch) {
      const cTag = mk('div', 'rep-cross-tag');
      cTag.append(ic('arrow-left-right'), mk('span', '', `Home: ${e.homeBranchCode || e.branchCode || e.homeBranchId}`));
      locStack.appendChild(cTag);
    }
    tdLoc.appendChild(locStack);
    tr.appendChild(tdLoc);

    // 7. Received
    const tdAmt = mk('td', 'num fr-col-received');
    tdAmt.dataset.label = 'Received';
    const amtStack = mk('div', 'rep-cell-stack is-right');
    const isWaiverOnly = Boolean(e.isPureWaiver);
    const amtEl = mk('span', `fr-money ${isWaiverOnly ? 'muted' : 'success'}`, isWaiverOnly ? '₹0 (Waived)' : formatINR(e.totalReceived || 0));
    amtStack.appendChild(amtEl);
    const subParts = [];
    if (Number(e.lateFeePaid || 0) > 0) subParts.push(`Incl. fine ${formatINR(e.lateFeePaid)}`);
    if (Number(e.lateFeeWaived || 0) > 0) subParts.push(`Waived ${formatINR(e.lateFeeWaived)}`);
    if (subParts.length) amtStack.appendChild(mk('span', 'fr-sub-ellipsis', subParts.join(' · ')));
    tdAmt.appendChild(amtStack);
    tr.appendChild(tdAmt);

    // 8. Receipt / Info
    const tdRcpt = mk('td', 'act fr-rcpt-td');
    tdRcpt.dataset.label = 'Receipt';
    const rcptBtn = mk('button', 'fr-rcpt-link');
    rcptBtn.type = 'button';
    rcptBtn.title = e.receiptNo && e.receiptNo !== '—' ? `Open details (${e.receiptNo})` : 'View payment details';
    rcptBtn.append(ic('file-text'), mk('span', '', formatShortReceipt(e.receiptNo) || 'Details'));
    rcptBtn.addEventListener('click', () => openEntryDetailsPopup(e));
    tdRcpt.appendChild(rcptBtn);
    tr.appendChild(tdRcpt);

    tbody.appendChild(tr);
  });

  renderPager(pager, {
    page: state.page,
    pageSize: PAGE_SIZE,
    totalItems: list.length,
    showWhenSingle: true,
    onPageChange: (p) => {
      state.page = p;
      renderCollectionTable();
      paint();
    }
  });
}

function renderCollectionFooterSummaries() {
  const wrap = $('rep-col-footer-summaries');
  const aggs = state.aggs;
  if (!wrap || !aggs || !state.filteredEntries.length) {
    if (wrap) wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  const s = aggs.summary;
  $('rep-footer-counts').textContent =
    `${s.moneyReceipts} receipt${s.moneyReceipts === 1 ? '' : 's'} · ` +
    `${s.fineReceiptCount} fine payment${s.fineReceiptCount === 1 ? '' : 's'} · ` +
    `${s.waiverCount} waiver${s.waiverCount === 1 ? '' : 's'}`;

  // By Collected At
  const locTbody = $('rep-loc-summary-tbody');
  locTbody.innerHTML = '';
  (aggs.byCollectedAt || []).forEach((r) => {
    const tr = mk('tr');
    tr.appendChild(mk('td', '', r.label));
    tr.appendChild(mk('td', 'num', r.receipts));
    tr.appendChild(mk('td', 'num', formatINR(r.cashAmount)));
    tr.appendChild(mk('td', 'num', formatINR(r.digitalAmount)));
    tr.appendChild(mk('td', 'num', `${formatINR(r.lateFees)} / ${r.waiverCount}`));
    tr.appendChild(mk('td', 'num fr-money success', formatINR(r.totalCollected)));
    locTbody.appendChild(tr);
  });

  // By Collected By
  const colTbody = $('rep-collector-summary-tbody');
  colTbody.innerHTML = '';
  (aggs.byCollectedBy || []).forEach((r) => {
    const tr = mk('tr');
    const tdName = mk('td');
    tdName.appendChild(mk('div', '', r.label));
    tdName.appendChild(mk('span', 'fr-sub-ellipsis', r.roleLabel));
    tr.appendChild(tdName);
    tr.appendChild(mk('td', 'num', r.receipts));
    tr.appendChild(mk('td', 'num', formatINR(r.cashAmount)));
    tr.appendChild(mk('td', 'num', formatINR(r.digitalAmount)));
    tr.appendChild(mk('td', 'num fr-money success', formatINR(r.totalCollected)));
    colTbody.appendChild(tr);
  });

  // By Mode
  const modeTbody = $('rep-mode-summary-tbody');
  modeTbody.innerHTML = '';
  (aggs.byMode || []).forEach((m) => {
    const tr = mk('tr');
    const tdM = mk('td');
    const b = mk('span', `la-mode ${m.cls} fr-mode-badge`);
    b.append(ic(m.icon), mk('span', '', m.label));
    tdM.appendChild(b);
    tr.appendChild(tdM);
    tr.appendChild(mk('td', 'num', m.receipts));
    tr.appendChild(mk('td', 'num fr-money success', formatINR(m.amount)));
    tr.appendChild(mk('td', 'num', `${m.sharePct}%`));
    modeTbody.appendChild(tr);
  });
}

function renderSettlementTab() {
  if (!state || state.ctx !== 'youth') return;
  const rows = state.aggs?.byBranchSettlement || [];
  const superLabel = getRoleTitle('superadmin');
  const branchHeadLabel = getRoleTitle('branch_head');

  let totBhCash = 0;
  let totBhDigital = 0;
  let totSuper = 0;
  let totHandover = 0;
  rows.forEach((r) => {
    totBhCash += r.bhCash || 0;
    totBhDigital += r.bhDigital || 0;
    totSuper += r.superAdminTotal || 0;
    totHandover += r.cashHandoverDue || 0;
  });

  const callout = $('rep-settle-callout');
  callout.innerHTML = '';
  const cards = [
    { label: 'Physical Cash at Branches', val: formatINR(totHandover), sub: `Held by ${branchHeadLabel} for handover`, hi: true },
    { label: 'Branch Cash (Own Students)', val: formatINR(totBhCash), sub: 'Collected at branch counter', hi: false },
    { label: 'Branch UPI / Bank', val: formatINR(totBhDigital), sub: 'Settled digitally', hi: false },
    { label: `HO / ${superLabel} Collected`, val: formatINR(totSuper), sub: 'Bypassing branch cashbox', hi: false }
  ];
  cards.forEach((c) => {
    const card = mk('div', 'rep-callout-card' + (c.hi ? ' is-highlight' : ''));
    card.append(
      mk('span', 'rep-callout-label', c.label),
      mk('span', 'rep-callout-val', c.val),
      mk('span', 'rep-callout-sub', c.sub)
    );
    callout.appendChild(card);
  });

  const tbody = $('rep-settle-tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    renderEmptyTableState(tbody, {
      colSpan: 8,
      title: 'No branch settlement rows',
      desc: 'No active branches match the current filter.'
    });
  } else {
    rows.forEach((r) => {
      const tr = mk('tr');

      const tdBr = mk('td', 'lp-td-primary');
      const brStack = mk('div', 'rep-cell-stack');
      brStack.appendChild(mk('strong', '', r.branchCode ? `${r.branchCode} — ${r.branchName}` : r.branchName));
      if (r.crossBranchHereCount > 0) {
        brStack.appendChild(mk('span', 'fr-sub-ellipsis', `+${r.crossBranchHereCount} cross-branch here (${formatINR(r.crossBranchCashHere)} cash)`));
      }
      tdBr.appendChild(brStack);
      tr.appendChild(tdBr);

      const tdBhCash = mk('td', 'num');
      tdBhCash.dataset.label = 'Branch Cash Held';
      const bhCashStack = mk('div', 'rep-cell-stack is-right');
      bhCashStack.append(mk('span', '', formatINR(r.bhCash)), mk('span', 'fr-sub-ellipsis', `${r.bhCashCount} receipt${r.bhCashCount === 1 ? '' : 's'}`));
      tdBhCash.appendChild(bhCashStack);
      tr.appendChild(tdBhCash);

      const tdBhDig = mk('td', 'num');
      tdBhDig.dataset.label = 'Branch UPI / Bank';
      const bhDigStack = mk('div', 'rep-cell-stack is-right');
      bhDigStack.append(mk('span', '', formatINR(r.bhDigital)), mk('span', 'fr-sub-ellipsis', `${r.bhDigitalCount} receipt${r.bhDigitalCount === 1 ? '' : 's'}`));
      tdBhDig.appendChild(bhDigStack);
      tr.appendChild(tdBhDig);

      const tdHo = mk('td', 'num');
      tdHo.dataset.label = `HO / ${superLabel}`;
      const hoStack = mk('div', 'rep-cell-stack is-right');
      hoStack.append(mk('span', '', formatINR(r.superAdminTotal)), mk('span', 'fr-sub-ellipsis', `${r.superAdminCount} receipt${r.superAdminCount === 1 ? '' : 's'}`));
      tdHo.appendChild(hoStack);
      tr.appendChild(tdHo);

      const tdTot = mk('td', 'num');
      tdTot.dataset.label = 'Branch Total';
      const totStack = mk('div', 'rep-cell-stack is-right');
      totStack.append(mk('span', 'fr-money success', formatINR(r.homeCollected)), mk('span', 'fr-sub-ellipsis', `${r.homeReceipts} receipt${r.homeReceipts === 1 ? '' : 's'}`));
      tdTot.appendChild(totStack);
      tr.appendChild(tdTot);

      const tdDue = mk('td', 'num');
      tdDue.dataset.label = 'Cash Handover Due';
      if (r.cashHandoverDue > 0) {
        const pill = mk('span', 'rep-handover-pill', formatINR(r.cashHandoverDue));
        tdDue.appendChild(pill);
      } else {
        tdDue.appendChild(mk('span', 'rep-handover-zero', '₹0'));
      }
      tr.appendChild(tdDue);

      const tdPend = mk('td', 'num');
      tdPend.dataset.label = 'Overdue Pending';
      const pendStack = mk('div', 'rep-cell-stack is-right');
      pendStack.append(mk('span', `fr-money ${r.overdueTotal > 0 ? 'danger' : 'muted'}`, formatINR(r.overdueTotal)), mk('span', 'fr-sub-ellipsis', `${r.pendingStudentCount} student${r.pendingStudentCount === 1 ? '' : 's'}`));
      tdPend.appendChild(pendStack);
      tr.appendChild(tdPend);

      const tdAct = mk('td', 'act fr-action-td');
      tdAct.dataset.label = 'Breakdown';
      const btn = mk('button', 'ui-btn ghost sm fr-act-btn');
      btn.type = 'button';
      btn.append(ic('list-filter'), mk('span', '', `Receipts (${r.entries.length})`));
      btn.disabled = !r.entries.length;
      btn.addEventListener('click', () => openBranchSettlementPopup(r));
      tdAct.appendChild(btn);
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
  }

  $('rep-settle-formula-note').textContent =
    `Cash Handover Due = physical Cash collected by ${branchHeadLabel} at that branch (plus any cross-branch cash taken at its counter). ` +
    `Digital (UPI/Bank) and ${superLabel} / Head Office receipts do not require cash handover.`;
}

function renderWaiversTab() {
  const waivers = state.aggs?.waivers || [];
  const sum = state.aggs?.summary || {};
  $('rep-waivers-badge').textContent = `${waivers.length} waiver${waivers.length === 1 ? '' : 's'} · ${formatINR(sum.lateFeesWaived || 0)}`;

  const tbody = $('rep-waivers-tbody');
  tbody.innerHTML = '';
  if (!waivers.length) {
    renderEmptyTableState(tbody, {
      colSpan: 8,
      title: 'No fine or fee waivers in this scope',
      desc: 'Waivers granted during fee collection or direct waiver logs appear here.'
    });
    return;
  }

  waivers.forEach((w) => {
    const tr = mk('tr');

    const tdD = mk('td', 'fr-col-date');
    tdD.dataset.label = 'Date';
    tdD.textContent = w.date ? fmtDate(w.date) : '-';
    tr.appendChild(tdD);

    const tdS = mk('td', 'lp-td-primary');
    if (w.studentDocId) {
      const link = mk('a', 'fr-student-link', w.studentName);
      link.href = `#/students/${encodeURIComponent(w.studentDocId)}`;
      tdS.appendChild(link);
    } else {
      tdS.appendChild(mk('strong', '', w.studentName));
    }
    if (w.studentId) tdS.appendChild(mk('span', 'fr-sub-ellipsis', w.studentId));
    tr.appendChild(tdS);

    const tdBc = mk('td');
    tdBc.dataset.label = 'Branch & Course';
    tdBc.appendChild(mk('div', '', w.courseLabel));
    tdBc.appendChild(mk('span', 'fr-sub-ellipsis', w.branchLabel));
    tr.appendChild(tdBc);

    const tdFee = mk('td');
    tdFee.dataset.label = 'Fee Item';
    tdFee.textContent = w.feeLabel;
    tr.appendChild(tdFee);

    const tdAmt = mk('td', 'num');
    tdAmt.dataset.label = 'Waived Amount';
    tdAmt.appendChild(mk('span', 'fr-money danger', formatINR(w.waivedAmount || 0)));
    tr.appendChild(tdAmt);

    const tdBy = mk('td');
    tdBy.dataset.label = 'Waived By';
    tdBy.textContent = w.waivedByLabel;
    tr.appendChild(tdBy);

    const tdReason = mk('td', 'rep-reason-cell');
    tdReason.dataset.label = 'Reason';
    tdReason.textContent = w.reason || 'Waiver granted';
    tr.appendChild(tdReason);

    const tdAct = mk('td', 'act fr-action-td');
    tdAct.dataset.label = 'Details';
    const btn = mk('button', 'ui-btn ghost sm fr-act-btn');
    btn.type = 'button';
    btn.append(ic('eye'), mk('span', '', w.receiptNo && w.receiptNo !== '-' ? formatShortReceipt(w.receiptNo) : 'View'));
    btn.addEventListener('click', () => openEntryDetailsPopup(w.entry));
    tdAct.appendChild(btn);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  });
}

function renderOverviewTab() {
  const aggs = state.aggs;
  if (!aggs) return;

  // Mode bars
  const modeWrap = $('rep-mode-bars');
  modeWrap.innerHTML = '';
  const modes = aggs.byMode || [];
  if (!modes.length) {
    modeWrap.appendChild(mk('span', 'fr-sub-ellipsis', 'No receipts in the active filter scope.'));
  } else {
    modes.forEach((m) => {
      const row = mk('div', 'rep-bar-row');
      const top = mk('div', 'rep-bar-top');
      top.appendChild(mk('span', 'rep-bar-label', `${m.label} (${m.receipts})`));
      const val = mk('span', 'rep-bar-val', formatINR(m.amount));
      val.appendChild(mk('span', 'rep-bar-sub', `${m.sharePct}%`));
      top.appendChild(val);

      const track = mk('div', 'rep-bar-track');
      const fill = mk('div', `rep-bar-fill ${m.cls || 'cash'}`);
      fill.style.width = `${Math.max(2, Math.min(100, m.sharePct || 0))}%`;
      track.appendChild(fill);
      row.append(top, track);
      modeWrap.appendChild(row);
    });
  }

  // Daily series bars (latest 14 days shown cleanly)
  const dailyWrap = $('rep-daily-bars');
  dailyWrap.innerHTML = '';
  const series = (aggs.dailySeries || []).slice(-14).reverse();
  $('rep-daily-caption').textContent = `${aggs.dailySeries?.length || 0} day${aggs.dailySeries?.length === 1 ? '' : 's'}`;
  if (!series.length) {
    dailyWrap.appendChild(mk('span', 'fr-sub-ellipsis', 'No daily collections in this scope.'));
  } else {
    const maxAmt = Math.max(1, ...series.map((d) => d.amount || 0));
    series.forEach((d) => {
      const row = mk('div', 'rep-bar-row');
      const top = mk('div', 'rep-bar-top');
      top.appendChild(mk('span', 'rep-bar-label', d.label));
      const val = mk('span', 'rep-bar-val', formatINR(d.amount));
      val.appendChild(mk('span', 'rep-bar-sub', `${d.receipts} rcpt`));
      top.appendChild(val);

      const track = mk('div', 'rep-bar-track');
      const fill = mk('div', 'rep-bar-fill');
      fill.style.width = `${Math.round(((d.amount || 0) / maxAmt) * 100)}%`;
      track.appendChild(fill);
      row.append(top, track);
      dailyWrap.appendChild(row);
    });
  }

  // Course / Level table + Overdue tie-in
  const overdueItems = state.pendingResult?.items || [];
  let totalOverdue = 0;
  overdueItems.forEach((p) => {
    totalOverdue += Number(p.totalPayable != null ? p.totalPayable : (Number(p.amount || 0) + Number(p.lateFee || 0)));
  });
  $('rep-overdue-tiein-note').textContent = `Total current overdue: ${formatINR(totalOverdue)}`;

  const tbody = $('rep-courses-tbody');
  tbody.innerHTML = '';
  const courses = aggs.byCourse || [];
  if (!courses.length) {
    renderEmptyTableState(tbody, {
      colSpan: 8,
      title: 'No course activity in scope',
      desc: 'Adjust date or branch filters to see course breakdowns.'
    });
    return;
  }

  courses.forEach((c) => {
    const tr = mk('tr');

    const tdName = mk('td', 'lp-td-primary');
    tdName.appendChild(mk('strong', '', [c.courseCode, c.courseName].filter(Boolean).join(' - ')));
    tr.appendChild(tdName);

    const tdPayers = mk('td', 'num', c.studentsCount);
    tdPayers.dataset.label = 'Payers';
    tr.appendChild(tdPayers);

    const tdRcpt = mk('td', 'num', c.receipts);
    tdRcpt.dataset.label = 'Receipts';
    tr.appendChild(tdRcpt);

    const tdBase = mk('td', 'num', formatINR(c.baseCollected));
    tdBase.dataset.label = 'Fees Collected';
    tr.appendChild(tdBase);

    const tdFine = mk('td', 'num', formatINR(c.lateCollected));
    tdFine.dataset.label = 'Late Fees';
    tr.appendChild(tdFine);

    const tdW = mk('td', 'num', formatINR(c.waivedAmount));
    tdW.dataset.label = 'Waived';
    tr.appendChild(tdW);

    const tdTot = mk('td', 'num');
    tdTot.dataset.label = 'Total Collected';
    tdTot.appendChild(mk('span', 'fr-money success', formatINR(c.totalCollected)));
    tr.appendChild(tdTot);

    const tdOv = mk('td', 'num');
    tdOv.dataset.label = 'Overdue Pending';
    tdOv.appendChild(mk('div', `fr-money ${c.overdueDue > 0 ? 'danger' : 'muted'}`, formatINR(c.overdueDue)));
    tdOv.appendChild(mk('span', 'fr-sub-ellipsis', `${c.overdueStudentCount} student${c.overdueStudentCount === 1 ? '' : 's'}`));
    tr.appendChild(tdOv);

    tbody.appendChild(tr);
  });
}

function buildSectionCard(title, fields) {
  const card = mk('div', 'adm-view-sec');
  card.appendChild(mk('h4', '', title));
  fields.forEach((f) => {
    const row = mk('div', 'adm-view-row');
    row.appendChild(mk('span', 'adm-view-k', f.label));
    const v = mk('span', 'adm-view-v' + (f.mono ? ' fr-mono' : '') + (f.highlight ? ' fr-val-strong' : ''), f.value);
    row.appendChild(v);
    card.appendChild(row);
  });
  return card;
}

async function openEntryDetailsPopup(entry) {
  if (!entry) return;
  const sessionsById = {};
  (state?.sessions || []).forEach((s) => { if (s?.id) sessionsById[s.id] = s; });
  const bill = entry.billId ? await getCachedBillForEntry(entry.billId).catch(() => null) : null;
  const model = buildPaymentDetailsModel(entry, { sessionsById, bill });

  const popup = openPopup({
    title: model.receiptId || 'Payment Details',
    subtitle: `${formatPersonName(entry.studentName || '')} (${entry.studentId || '-'})`,
    icon: entry.isPureWaiver ? 'shield-off' : 'receipt',
    tone: entry.isPureWaiver ? 'amber' : 'default',
    wide: true
  });

  const headRow = mk('div', 'fr-det-head-row');
  headRow.appendChild(mk('span', `pill ${model.status.cls === 'waived' ? 'amber' : 'green'}`, model.status.label));
  headRow.appendChild(mk('span', 'pill indigo', entry.collectedAtLabel || 'Head Office (HO)'));

  const stack = mk('div', 'fr-det-stack');
  const grid = mk('div', 'fr-det-grid');
  grid.append(
    buildSectionCard('Student', model.studentFields),
    buildSectionCard('Payment Summary', model.paymentFields),
    buildSectionCard('Transaction & Collector', model.transactionFields)
  );
  const remCard = mk('div', 'adm-view-sec fr-det-card-full');
  remCard.append(mk('h4', '', 'Remarks'), mk('div', `fr-det-remarks${model.remarksText === 'No remarks' ? ' is-empty' : ''}`, model.remarksText));

  const actions = mk('div', 'adm-view-actions');
  const copyBtn = mk('button', 'ui-btn ghost sm');
  copyBtn.type = 'button';
  copyBtn.append(ic('copy'), mk('span', '', 'Copy Summary'));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(model.copyText);
      showToast({ type: 'success', message: 'Payment summary copied.' });
    } catch (_) {
      showToast({ type: 'error', message: 'Could not access clipboard.' });
    }
  });
  actions.appendChild(copyBtn);

  if (entry.receiptRoute) {
    const linkBtn = mk('button', 'ui-btn primary sm');
    linkBtn.type = 'button';
    linkBtn.append(ic('external-link'), mk('span', '', entry.ctx === 'school' ? 'Open Student Payments' : 'Open Official Receipt'));
    linkBtn.addEventListener('click', () => {
      popup.close();
      location.hash = entry.receiptRoute;
    });
    actions.appendChild(linkBtn);
  }

  stack.append(headRow, grid, remCard, actions);
  popup.container.appendChild(stack);
  paint();
}

function openBranchSettlementPopup(branchRow) {
  const popup = openPopup({
    title: `${branchRow.branchCode ? branchRow.branchCode + ' — ' : ''}${branchRow.branchName}`,
    subtitle: `Cash Handover Due: ${formatINR(branchRow.cashHandoverDue)} · Total Receipts: ${branchRow.entries.length}`,
    icon: 'landmark',
    tone: branchRow.cashHandoverDue > 0 ? 'amber' : 'default',
    wide: true
  });

  const wrap = mk('div', 'fr-det-inst-wrap');
  const tbl = mk('table', 'fr-det-inst-table');
  const thead = document.createElement('thead');
  const hTr = document.createElement('tr');
  ['Date', 'Student', 'Mode', 'Collected By', 'Collected At', 'Received', 'Receipt'].forEach((lbl, idx) => {
    const th = mk('th', idx === 5 ? 'num' : '', lbl);
    hTr.appendChild(th);
  });
  thead.appendChild(hTr);

  const tbody = document.createElement('tbody');
  branchRow.entries.forEach((e) => {
    const tr = mk('tr');
    tr.appendChild(mk('td', '', e.date ? fmtDate(e.date) : '-'));
    tr.appendChild(mk('td', '', `${formatPersonName(e.studentName || '')} (${e.studentId || '-'})`));
    tr.appendChild(mk('td', '', modeDisplayMeta(e).label));
    tr.appendChild(mk('td', '', formatCollectorWithDesignation(e) || formatCollectorName(e.recordedByName, e.recordedBy) || '-'));
    tr.appendChild(mk('td', '', e.collectedAtShort || e.collectedAtLabel || '-'));
    tr.appendChild(mk('td', 'num', formatINR(e.totalReceived || 0)));
    tr.appendChild(mk('td', 'fr-mono', formatShortReceipt(e.receiptNo) || '-'));
    tbody.appendChild(tr);
  });

  tbl.append(thead, tbody);
  wrap.appendChild(tbl);
  popup.container.appendChild(wrap);
  paint();
}

function getExportSubtitle() {
  const isSchool = state.ctx === 'school';
  const { from, to } = computeActiveDateRange();
  const scopePart = isSchool ? 'Unique Kids' : `Youth Centre (${state.activeSession?.name || 'All Sessions'})`;
  const datePart = from || to ? (from === to ? fmtDate(from) : `${from ? fmtDate(from) : 'Start'} to ${to ? fmtDate(to) : 'Today'}`) : 'All Loaded Dates';
  return `${scopePart} · ${datePart}`;
}

function handleExportCsv() {
  if (!state) return;
  const tab = state.activeTab;
  const stamp = todayISO();
  const prefix = state.ctx === 'school' ? 'kids' : 'youth';

  if (tab === 'settlement' && state.ctx === 'youth') {
    const rows = (state.aggs?.byBranchSettlement || []).map((b) => [
      b.branchCode || b.branchId,
      b.branchName,
      b.bhCash,
      b.bhDigital,
      b.superAdminTotal,
      b.homeCollected,
      b.crossBranchCashHere,
      b.cashHandoverDue,
      b.overdueTotal
    ]);
    downloadCsv(
      `branch-settlement-${stamp}.csv`,
      ['Branch Code', 'Branch Name', 'Branch Cash Held', 'Branch UPI/Bank', 'HO / Top Admin', 'Branch Total', 'Cross-Branch Cash Here', 'Cash Handover Due', 'Overdue Pending'],
      rows
    );
    showToast({ type: 'success', message: 'Branch settlement CSV downloaded.' });
    return;
  }

  if (tab === 'waivers') {
    const rows = (state.aggs?.waivers || []).map((w) => [
      w.date,
      w.receiptNo,
      w.studentId,
      w.studentName,
      w.branchLabel,
      w.courseLabel,
      w.feeLabel,
      w.waivedAmount,
      w.waivedByLabel,
      w.reason
    ]);
    downloadCsv(
      `${prefix}-fine-waivers-${stamp}.csv`,
      ['Date', 'Receipt No', 'Student ID', 'Student Name', 'Branch', 'Course / Level', 'Fee Item', 'Amount Waived', 'Waived By', 'Reason'],
      rows
    );
    showToast({ type: 'success', message: 'Fine waivers CSV downloaded.' });
    return;
  }

  if (tab === 'overview') {
    const rows = (state.aggs?.byCourse || []).map((c) => [
      c.courseCode,
      c.courseName,
      c.studentsCount,
      c.receipts,
      c.baseCollected,
      c.lateCollected,
      c.waivedAmount,
      c.totalCollected,
      c.overdueStudentCount,
      c.overdueDue
    ]);
    downloadCsv(
      `${prefix}-course-summary-${stamp}.csv`,
      ['Code', state.ctx === 'school' ? 'Level' : 'Course', 'Payers', 'Receipts', 'Fees Collected', 'Late Fees', 'Waived', 'Total Collected', 'Overdue Students', 'Overdue Amount'],
      rows
    );
    showToast({ type: 'success', message: 'Course summary CSV downloaded.' });
    return;
  }

  const rows = (state.filteredEntries || []).map((e) => [
    e.date,
    e.receiptNo,
    e.studentId,
    formatPersonName(e.studentName || ''),
    e.branchCode || e.branchName,
    [e.courseCode, e.courseName].filter(Boolean).join(' - '),
    e.typeLabel || e.type,
    modeDisplayMeta(e).label,
    e.txnId || '',
    formatCollectorWithDesignation(e) || formatCollectorName(e.recordedByName, e.recordedBy, e.recordedByDesignation),
    e.collectedByRole ? getRoleTitle(e.collectedByRole) : '',
    e.collectedAtLabel || '',
    e.amount,
    e.lateFeePaid,
    e.lateFeeWaived,
    e.isPureWaiver ? 0 : e.totalReceived,
    e.waiverReason || ''
  ]);
  downloadCsv(
    `${prefix}-collection-report-${stamp}.csv`,
    ['Date', 'Receipt No', 'Student ID', 'Student Name', 'Branch', 'Course/Level', 'Payment For', 'Mode', 'Txn ID', 'Collected By', 'Role', 'Collected At', 'Base Fee', 'Late Fee Paid', 'Waived', 'Net Received', 'Waiver Reason'],
    rows
  );
  showToast({ type: 'success', message: 'Collection report CSV downloaded.' });
}

async function handleExportPdf() {
  if (!state) return;
  const btn = $('rep-export-pdf');
  if (btn) btn.disabled = true;
  try {
    const stamp = todayISO();
    const isSchool = state.ctx === 'school';
    await exportFinancialReportPdf({
      title: `${isSchool ? 'Unique Kids' : 'Youth Centre'} Financial Report`,
      subtitle: getExportSubtitle(),
      filename: `${isSchool ? 'kids' : 'youth'}-financial-report-${stamp}.pdf`,
      org: window.APP_CACHE?.org || null,
      summary: state.aggs?.summary || {},
      aggs: state.aggs || {},
      entries: state.filteredEntries || [],
      ctx: state.ctx,
      printedBy: state.profile?.name || state.profile?.email || getRoleTitle('superadmin')
    });
    showToast({ type: 'success', message: 'PDF report downloaded.' });
  } catch (err) {
    console.error('[reports] PDF export failed', err);
    showToast({ type: 'error', message: err?.message || 'Failed to generate PDF report.' });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function handlePrintReport() {
  if (!state) return;
  const s = state.aggs?.summary || {};
  const isSchool = state.ctx === 'school';
  const subtitle = getExportSubtitle();
  const summaryPairs = [
    { label: 'Total Collected', value: formatINR(s.totalCollected || 0) },
    { label: 'Cash', value: formatINR(s.cashTotal || 0) },
    { label: 'UPI / Bank', value: formatINR((s.upiTotal || 0) + (s.bankTotal || 0)) },
    { label: 'Late Fees Paid', value: formatINR(s.lateFeesCollected || 0) },
    { label: 'Fees Waived', value: formatINR(s.lateFeesWaived || 0) },
    { label: 'Receipts / Waivers', value: `${s.moneyReceipts || 0} / ${s.waiverCount || 0}` }
  ];

  const tab = state.activeTab;
  let title = `${isSchool ? 'Unique Kids' : 'Youth Centre'} — Collection Report`;
  let columns = [
    { label: 'Date' },
    { label: 'Student' },
    { label: 'Payment For' },
    { label: 'Mode' },
    { label: 'Collected By' },
    { label: 'Collected At' },
    { label: 'Received', num: true },
    { label: 'Receipt' }
  ];
  let rows = (state.filteredEntries || []).map((e) => [
    e.date ? fmtDate(e.date) : '-',
    `${formatPersonName(e.studentName || '')} (${e.studentId || '-'})`,
    e.typeLabel || e.type || '-',
    modeDisplayMeta(e).label,
    formatCollectorWithDesignation(e) || formatCollectorName(e.recordedByName, e.recordedBy) || '-',
    e.collectedAtLabel || '-',
    e.isPureWaiver ? '₹0 (Waived)' : formatINR(e.totalReceived || 0),
    e.receiptNo || '-'
  ]);

  if (tab === 'settlement' && !isSchool) {
    title = 'Youth Centre — Branch Settlement Report';
    columns = [
      { label: 'Branch' },
      { label: 'Branch Cash Held', num: true },
      { label: 'Branch UPI / Bank', num: true },
      { label: `HO / ${getRoleTitle('superadmin')}`, num: true },
      { label: 'Branch Total', num: true },
      { label: 'Cash Handover Due', num: true }
    ];
    rows = (state.aggs?.byBranchSettlement || []).map((b) => [
      b.branchCode ? `${b.branchCode} - ${b.branchName}` : b.branchName,
      formatINR(b.bhCash),
      formatINR(b.bhDigital),
      formatINR(b.superAdminTotal),
      formatINR(b.homeCollected),
      formatINR(b.cashHandoverDue)
    ]);
  } else if (tab === 'waivers') {
    title = `${isSchool ? 'Unique Kids' : 'Youth Centre'} — Fine Waivers Audit`;
    columns = [
      { label: 'Date' },
      { label: 'Student' },
      { label: 'Fee Item' },
      { label: 'Waived', num: true },
      { label: 'Waived By' },
      { label: 'Reason' }
    ];
    rows = (state.aggs?.waivers || []).map((w) => [
      w.date ? fmtDate(w.date) : '-',
      `${w.studentName} (${w.studentId || '-'})`,
      w.feeLabel,
      formatINR(w.waivedAmount),
      w.waivedByLabel,
      w.reason
    ]);
  }

  const ok = openPrintSheet({
    title,
    subtitle,
    summaryPairs,
    columns,
    rows,
    footerNote: `Prepared for ${(window.APP_CACHE?.org && window.APP_CACHE.org.orgName) || 'Unique Infotech'} · ${state.aggs?.byCollectedAt?.length || 0} location(s) · ${state.aggs?.byCollectedBy?.length || 0} collector(s)`
  });
  if (!ok) {
    showToast({ type: 'error', message: 'Popup blocked. Allow popups to print reports.' });
  }
}

export function unmount() {
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
  if (state) {
    state.destroyed = true;
    state = null;
  }
}
