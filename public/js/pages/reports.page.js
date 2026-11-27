// reports.page.js — Read-only Youth Centre Reports page (#/reports) using calm flat ref-cards design.
// Accessible to Super Admin (all branches + Section 5 Comparison) and Branch Head (own branch locked, Sections 1-4).

import { createSelect } from '../components/ui-select.js?v=1.8.179';
import { createBranchBatchFilter, clearPersistedBranchBatchFilters } from '../components/branch-batch-filter.js?v=1.8.179';
import {
  CHART_PALETTE,
  renderDonutChart,
  renderBarChart,
  renderStackedBarChart,
  renderLineChart,
  renderThinBarList,
  renderSegmentedBar
} from '../components/charts.js?v=1.8.179';
import { showToast } from '../components/toast.js?v=1.8.179';
import { renderEmptyTableState } from '../components/list-page.js?v=1.8.179';
import {
  getCachedSessions,
  loadSessions,
  getSelectedSession
} from '../core/sessions.js?v=1.8.179';
import {
  ensureReferenceData,
  scopeReferenceDataByCtx,
  invalidateFinancialCache,
  getReportDatePresetOptions,
  getDatePresetRange,
  loadYouthPaymentHistory,
  loadYouthPendingReport,
  loadAllYouthSessionsForCompare,
  buildYouthReportsData,
  downloadCsv,
  openPrintSheet,
  toTitleCaseIfCaps,
  formatINR,
  fmtDate,
  todayISO
} from '../services/report.service.js?v=1.8.179';
import { resolveUserDisplay, getRoleTitle } from '../services/user-directory.service.js?v=1.8.179';

const FILTER_STORAGE_PREFIX = 'uicms.rep.v1.';
const CALM_SEG_COLORS = ['#323A85', '#6366F1', '#64748B', '#94A3B8', '#CBD5E1'];

let state = null;
let sessionsLoadedListener = null;
let sessionsChangedListener = null;
let usersUpdatedListener = null;

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

function storageKey(profile) {
  return FILTER_STORAGE_PREFIX + String(profile?.email || profile?.role || 'anon').toLowerCase();
}

function readSavedFilters(profile) {
  try {
    const raw = sessionStorage.getItem(storageKey(profile));
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveFilters() {
  if (!state) return;
  try {
    const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: state.filters.branchId || 'all', batchId: state.filters.batchId || 'all' };
    sessionStorage.setItem(storageKey(state.profile), JSON.stringify({
      branchId: state.isBranchHead ? state.profile.branchId : bb.branchId,
      batchId: bb.batchId,
      courseId: state.filters.courseId,
      datePreset: state.filters.datePreset,
      dateFrom: state.filters.dateFrom,
      dateTo: state.filters.dateTo,
      duesGroupBy: state.duesGroupBy,
      stuGroupBy: state.stuGroupBy,
      trendKind: state.trendKind
    }));
  } catch (_) {}
}

function clearSavedFilters(profile) {
  try {
    sessionStorage.removeItem(storageKey(profile));
  } catch (_) {}
}

function resolveActiveSession() {
  if (!state) return null;
  const cached = getCachedSessions('youth');
  if (cached.length) state.sessions = cached;
  return getSelectedSession('youth') || state.sessions[0] || null;
}

function resolvePreviousSession(allYouthSessions = [], activeSession = null) {
  if (!activeSession || !Array.isArray(allYouthSessions) || !allYouthSessions.length) return null;
  const sorted = allYouthSessions.slice().sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  const idx = sorted.findIndex((s) => s.id === activeSession.id);
  if (idx >= 0 && sorted[idx + 1]) return sorted[idx + 1];
  const curStart = activeSession.startDate || '';
  return sorted.find((s) => s.id !== activeSession.id && s.startDate && s.startDate < curStart) || null;
}

function toggleNoSessionState(show) {
  $('rep-no-session').hidden = !show;
  $('rep-toolbar').hidden = show;
  $('rep-sec-kpis').hidden = show;
  $('rep-sec-money').hidden = show;
  $('rep-sec-dues').hidden = show;
  $('rep-sec-students').hidden = show;
  $('rep-sec-comparison').hidden = show || !state?.isSuper;
  if (show) paint();
}

function showSkeletons() {
  const kpis = $('rep-kpis');
  if (kpis) {
    kpis.classList.add('is-loading');
    kpis.querySelectorAll('.rc-stat-val').forEach((el) => {
      el.textContent = '';
      el.classList.add('skel');
    });
  }
  ['rep-chart-trend', 'rep-chart-modes', 'rep-chart-fee-types', 'rep-chart-dues-group', 'rep-chart-ageing', 'rep-chart-admissions', 'rep-chart-stu-course'].forEach((id) => {
    const el = $(id);
    if (el) {
      el.innerHTML = '<div class="rep-chart-skel skel"></div>';
    }
  });
}

function hideSkeletons() {
  const kpis = $('rep-kpis');
  if (!kpis) return;
  kpis.classList.remove('is-loading');
  kpis.querySelectorAll('.rc-stat-val').forEach((el) => el.classList.remove('skel'));
}

export async function mount({ profile, ctx }) {
  const isSuper = profile?.role === 'superadmin';
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;

  if ((!isSuper && !isBranchHead) || (ctx && ctx !== 'youth')) {
    $('rep-access-denied').hidden = false;
    $('rep-main').hidden = true;
    $('rep-denied-desc').textContent = !isSuper && !isBranchHead
      ? `Reports in Youth Centre are available to ${getRoleTitle('superadmin')} and ${getRoleTitle('branch_head')}.`
      : 'Reports are currently available for Youth Centre only.';
    paint();
    return;
  }

  $('rep-access-denied').hidden = true;
  $('rep-main').hidden = false;

  const saved = readSavedFilters(profile);
  const today = todayISO();

  state = {
    profile,
    isSuper,
    isBranchHead,
    meta: null,
    sessions: getCachedSessions('youth'),
    allSessions: [],
    activeSession: null,
    prevSession: null,
    duesGroupBy: saved?.duesGroupBy || (isBranchHead ? 'batch' : 'branch'),
    stuGroupBy: saved?.stuGroupBy || 'course',
    trendKind: saved?.trendKind || 'line',
    filters: {
      branchId: isBranchHead ? profile.branchId : (saved?.branchId || 'all'),
      batchId: saved?.batchId || 'all',
      courseId: saved?.courseId || 'all',
      datePreset: saved?.datePreset || 'session',
      dateFrom: saved?.dateFrom || today,
      dateTo: saved?.dateTo || today
    },
    bbFilter: null,
    selects: {},
    historyResult: null,
    pendingResult: null,
    prevPendingResult: null,
    analytics: null,
    totalReads: 0,
    destroyed: false
  };

  if (isBranchHead) {
    if (state.duesGroupBy === 'branch') state.duesGroupBy = 'batch';
    state.stuGroupBy = 'course';
  }

  $('rep-sec-comparison').hidden = !isSuper;
  $('rep-dues-grp-branch').hidden = isBranchHead;
  $('rep-stu-group-tabs').hidden = !isSuper;

  updateHeaderUi();
  initControls();
  bindEvents();
  showSkeletons();
  await bootstrapData({ forceRefresh: false });
}

function updateHeaderUi() {
  if (!state) return;
  const sessName = state.activeSession?.name || '';
  $('rep-subtitle').textContent = sessName
    ? `Read-only analytics for ${sessName} across collections, dues, and students.`
    : 'Read-only analytics across collections, dues, students, and performance.';
}

function initControls() {
  state.bbFilter = createBranchBatchFilter($('rep-bb-host'), {
    persistKey: 'reports.youth',
    profile: state.profile,
    ctx: 'youth',
    sessionId: '',
    branches: [],
    batches: [],
    courses: [],
    onChange: (next) => {
      if (state) {
        state.filters.branchId = state.isBranchHead ? state.profile.branchId : (next?.branchId || 'all');
        state.filters.batchId = next?.batchId || 'all';
        saveFilters();
        computeAndRenderAnalytics();
      }
    }
  });

  state.selects.course = createSelect($('rep-course-host'), {
    options: [{ value: 'all', label: 'All courses', icon: 'book-open' }],
    value: state.filters.courseId,
    ariaLabel: 'Course',
    onChange: (val) => {
      state.filters.courseId = val || 'all';
      saveFilters();
      computeAndRenderAnalytics();
    }
  });

  state.selects.datePreset = createSelect($('rep-date-host'), {
    options: getReportDatePresetOptions(),
    value: state.filters.datePreset,
    ariaLabel: 'Date range',
    onChange: (val) => {
      state.filters.datePreset = val || 'session';
      updateCustomDateVisibility();
      saveFilters();
      computeAndRenderAnalytics();
    }
  });

  updateCustomDateVisibility();
  syncSegmentButtons();
}

function updateCustomDateVisibility() {
  const isCustom = state?.filters?.datePreset === 'custom';
  $('rep-date-custom').hidden = !isCustom;
  if (isCustom) {
    if (!$('rep-date-from').value) $('rep-date-from').value = state.filters.dateFrom || todayISO();
    if (!$('rep-date-to').value) $('rep-date-to').value = state.filters.dateTo || todayISO();
  }
}

function syncSegmentButtons() {
  document.querySelectorAll('#rep-trend-mode-bar .rc-seg-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.kind === state?.trendKind);
  });
  document.querySelectorAll('#rep-dues-group-tabs .rc-seg-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.group === state?.duesGroupBy);
  });
  document.querySelectorAll('#rep-stu-group-tabs .rc-seg-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.sgroup === state?.stuGroupBy);
  });
}

function bindEvents() {
  const onCustomDateInput = () => {
    if (!state || state.filters.datePreset !== 'custom') return;
    state.filters.dateFrom = $('rep-date-from').value || '';
    state.filters.dateTo = $('rep-date-to').value || '';
    saveFilters();
    computeAndRenderAnalytics();
  };
  $('rep-date-from')?.addEventListener('change', onCustomDateInput);
  $('rep-date-to')?.addEventListener('change', onCustomDateInput);

  $('rep-reset-filters')?.addEventListener('click', () => resetFilters());
  $('rep-retry')?.addEventListener('click', () => bootstrapData({ forceRefresh: true }));
  $('rep-refresh')?.addEventListener('click', async () => {
    invalidateFinancialCache({ clearMeta: false });
    await loadAllReportSources({ forceRefresh: true });
    showToast({ type: 'success', message: 'Reports refreshed with latest data.' });
  });

  document.querySelectorAll('#rep-trend-mode-bar .rc-seg-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state) return;
      state.trendKind = btn.dataset.kind || 'line';
      saveFilters();
      syncSegmentButtons();
      renderMoneySection();
      paint();
    });
  });

  document.querySelectorAll('#rep-dues-group-tabs .rc-seg-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state) return;
      state.duesGroupBy = btn.dataset.group || 'batch';
      saveFilters();
      syncSegmentButtons();
      renderDuesSection();
      paint();
    });
  });

  document.querySelectorAll('#rep-stu-group-tabs .rc-seg-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state) return;
      state.stuGroupBy = btn.dataset.sgroup || 'course';
      saveFilters();
      syncSegmentButtons();
      renderStudentsSection();
      paint();
    });
  });

  $('rep-csv-staff')?.addEventListener('click', () => exportTableCsv('staff'));
  $('rep-csv-dues-group')?.addEventListener('click', () => exportTableCsv('duesGroup'));
  $('rep-csv-batches')?.addEventListener('click', () => exportTableCsv('batches'));
  $('rep-csv-branch-comp')?.addEventListener('click', () => exportTableCsv('branchComp'));
  $('rep-csv-session-comp')?.addEventListener('click', () => exportTableCsv('sessionComp'));

  $('rep-print')?.addEventListener('click', handlePrintWholePage);

  const onSessionEvent = async (forceSessReload = false) => {
    if (!state || state.destroyed) return;
    if (forceSessReload) {
      state.sessions = await loadSessions('youth');
    }
    state.activeSession = resolveActiveSession();
    state.prevSession = resolvePreviousSession(state.allSessions, state.activeSession);
    updateHeaderUi();
    syncBranchBatchFilter();
    if (!state.activeSession) {
      toggleNoSessionState(true);
      return;
    }
    toggleNoSessionState(false);
    await loadAllReportSources({ forceRefresh: false });
  };

  sessionsLoadedListener = () => onSessionEvent(false);
  sessionsChangedListener = () => onSessionEvent(true);
  usersUpdatedListener = () => {
    if (!state || state.destroyed || !state.historyResult) return;
    computeAndRenderAnalytics();
  };

  window.addEventListener('uic:sessions-loaded', sessionsLoadedListener);
  window.addEventListener('uic:sessions-changed', sessionsChangedListener);
  window.addEventListener('uic:users-updated', usersUpdatedListener);
}

function resetFilters() {
  if (!state) return;
  clearSavedFilters(state.profile);
  clearPersistedBranchBatchFilters('reports.youth');
  state.bbFilter?.reset();

  const today = todayISO();
  state.filters = {
    branchId: state.isBranchHead ? state.profile.branchId : 'all',
    batchId: 'all',
    courseId: 'all',
    datePreset: 'session',
    dateFrom: today,
    dateTo: today
  };
  state.selects.course.setValue('all');
  state.selects.datePreset.setValue('session');
  updateCustomDateVisibility();
  saveFilters();
  computeAndRenderAnalytics();
}

function populateCourseOptions() {
  const { coursesList } = scopeReferenceDataByCtx(state.meta || {}, 'youth');
  const opts = [{ value: 'all', label: 'All courses', icon: 'book-open' }].concat(
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

function syncBranchBatchFilter() {
  if (!state || !state.bbFilter) return;
  const scoped = scopeReferenceDataByCtx(state.meta || {}, 'youth');
  state.bbFilter.updateData({
    ctx: 'youth',
    sessionId: state.activeSession?.id || '',
    branches: scoped.branchesList,
    batches: scoped.batchesList,
    courses: scoped.coursesList
  });
  state.bbFilter.setValue({
    branchId: state.isBranchHead ? state.profile.branchId : (state.filters.branchId || 'all'),
    batchId: state.filters.batchId || 'all'
  });
}

async function bootstrapData({ forceRefresh = false } = {}) {
  $('rep-error').hidden = true;
  showSkeletons();
  try {
    const [meta, activeSessions, compareInfo] = await Promise.all([
      ensureReferenceData({ forceRefresh, profile: state.profile }),
      getCachedSessions('youth').length ? Promise.resolve(getCachedSessions('youth')) : loadSessions('youth'),
      loadAllYouthSessionsForCompare()
    ]);
    if (!state || state.destroyed) return;

    state.meta = meta;
    state.sessions = activeSessions;
    state.allSessions = compareInfo?.sessions?.length ? compareInfo.sessions : activeSessions;
    state.activeSession = resolveActiveSession();
    state.prevSession = resolvePreviousSession(state.allSessions, state.activeSession);
    state.totalReads = (meta.readCount || 0) + (compareInfo?.readCount || 0);

    updateHeaderUi();
    populateCourseOptions();
    syncBranchBatchFilter();

    if (!state.activeSession) {
      hideSkeletons();
      toggleNoSessionState(true);
      return;
    }

    toggleNoSessionState(false);
    await loadAllReportSources({ forceRefresh });
  } catch (err) {
    if (!state || state.destroyed) return;
    console.error('[reports] bootstrap failed', err);
    showError(err);
  }
}

async function loadAllReportSources({ forceRefresh = false } = {}) {
  if (!state || state.destroyed || !state.activeSession) return;
  $('rep-error').hidden = true;
  showSkeletons();
  const refreshBtn = $('rep-refresh');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spin');
  }

  try {
    const tasks = [
      loadYouthPaymentHistory({
        profile: state.profile,
        dateFrom: '',
        dateTo: '',
        loadAll: true,
        forceRefresh
      }),
      loadYouthPendingReport({
        profile: state.profile,
        session: state.activeSession,
        forceRefresh
      }),
      state.prevSession
        ? loadYouthPendingReport({
          profile: state.profile,
          session: state.prevSession,
          forceRefresh
        })
        : Promise.resolve(null)
    ];

    const [histRes, pendRes, prevPendRes] = await Promise.all(tasks);
    if (!state || state.destroyed) return;

    state.historyResult = histRes;
    state.pendingResult = pendRes;
    state.prevPendingResult = prevPendRes;
    state.totalReads += (histRes?.readCount || 0) + (pendRes?.readCount || 0) + (prevPendRes?.readCount || 0);

    computeAndRenderAnalytics();
  } catch (err) {
    if (!state || state.destroyed) return;
    console.error('[reports] load failed', err);
    showError(err);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spin');
    }
  }
}

function showError(err) {
  hideSkeletons();
  $('rep-error-msg').textContent = err?.message || 'Permission or network failure while reading Youth reports.';
  $('rep-error').hidden = false;
  paint();
}

function resolveEffectiveDateWindow() {
  if (!state) return { dateFrom: '', dateTo: '' };
  const p = state.filters.datePreset || 'session';
  if (p === 'session') return { dateFrom: '', dateTo: '' };
  if (p === 'custom') {
    return { dateFrom: state.filters.dateFrom || '', dateTo: state.filters.dateTo || '' };
  }
  return getDatePresetRange(p, todayISO(), state.activeSession);
}

function updateFilterStatusAndResetBtn() {
  if (!state) return;
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };

  let activeCount = 0;
  if (!state.isBranchHead && bb.branchId !== 'all') activeCount++;
  if (bb.batchId !== 'all') activeCount++;
  if (state.filters.courseId !== 'all') activeCount++;
  if (state.filters.datePreset !== 'session') activeCount++;

  const resetBtn = $('rep-reset-filters');
  if (resetBtn) resetBtn.disabled = activeCount === 0;
}

function computeAndRenderAnalytics() {
  if (!state || state.destroyed) return;
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };
  const { dateFrom, dateTo } = resolveEffectiveDateWindow();
  const scoped = scopeReferenceDataByCtx(state.meta || {}, 'youth');

  state.analytics = buildYouthReportsData({
    entries: state.historyResult?.entries || [],
    pendingReport: state.pendingResult,
    activeSession: state.activeSession,
    prevPendingReport: state.prevPendingResult,
    prevSession: state.prevSession,
    branchesList: scoped.branchesList,
    coursesList: scoped.coursesList,
    batchesList: scoped.batchesList,
    branchesById: state.meta?.branchesById || scoped.branchesById,
    coursesById: state.meta?.coursesById || scoped.coursesById,
    batchesById: state.meta?.batchesById || scoped.batchesById,
    profile: state.profile,
    filters: {
      branchId: state.isBranchHead ? state.profile.branchId : bb.branchId,
      batchId: bb.batchId,
      courseId: state.filters.courseId,
      datePreset: state.filters.datePreset,
      dateFrom,
      dateTo
    }
  });

  hideSkeletons();
  updateFilterStatusAndResetBtn();
  renderKpisSection();
  renderMoneySection();
  renderDuesSection();
  renderStudentsSection();
  renderComparisonSection();
  paint();
}

function hasRealComparison(delta) {
  return !!(delta && delta.text && !String(delta.text).trim().startsWith('—'));
}

function paintKpiFooter(subEl, deltaEl, subText, delta, { overdueDanger = false } = {}) {
  const showDelta = hasRealComparison(delta);
  if (showDelta && deltaEl) {
    deltaEl.hidden = false;
    const isUpGood = delta.tone === 'good' && delta.dir === 'up';
    const isOvBad = overdueDanger && delta.dir === 'up';
    deltaEl.className = `rc-chip is-delta${isUpGood ? ' is-up' : (isOvBad ? ' is-danger' : '')}`;
    deltaEl.textContent = '';
    if (delta.dir === 'up') deltaEl.appendChild(ic('arrow-up'));
    else if (delta.dir === 'down') deltaEl.appendChild(ic('arrow-down'));
    const compactText = String(delta.text || '').replace(/\s*\([^)]+\)/g, '').replace(/\s+vs\s+.*/i, '').trim() || delta.text;
    deltaEl.appendChild(mk('span', '', compactText));

    if (subEl) {
      subEl.className = 'rc-meta-note';
      subEl.textContent = subText || '';
    }
    return;
  }

  if (deltaEl) {
    deltaEl.hidden = true;
    deltaEl.textContent = '';
  }
  if (subEl) {
    subEl.className = `rc-chip${overdueDanger ? ' is-danger' : ''}`;
    subEl.textContent = subText || '';
  }
}

function renderKpisSection() {
  const k = state.analytics?.kpis;
  if (!k) return;

  const setCell = (key, valStr, item, opts = {}) => {
    const valEl = $(`rep-kpi-${key}`);
    const subEl = $(`rep-kpi-${key}-sub`);
    const deltaEl = $(`rep-kpi-${key}-delta`);
    if (valEl) valEl.textContent = valStr;
    paintKpiFooter(subEl, deltaEl, opts.subText ?? item.sub, item.delta, opts);
  };

  setCell('collected', formatINR(k.totalCollected.value), k.totalCollected);
  setCell('rate', `${k.collectionRate.value}%`, k.collectionRate, {
    subText: `${k.collectionRate.value}% of ${formatINR(k.collectionRate.totalCourseFee)}`
  });
  setCell('outstanding', formatINR(k.outstandingDues.value), k.outstandingDues);
  const ovHasAmt = Number(k.overdueAmount.value || 0) > 0;
  setCell('overdue', formatINR(k.overdueAmount.value), k.overdueAmount, { overdueDanger: ovHasAmt });

  setCell('late-paid', formatINR(k.lateFeesCollected.value), k.lateFeesCollected);
  setCell('late-waived', formatINR(k.lateFeesWaived.value), k.lateFeesWaived);
  setCell('admissions', String(k.newAdmissions.value), k.newAdmissions);
  setCell('active', String(k.activeStudents.value), k.activeStudents);
}

function renderMoneySection() {
  const m = state.analytics?.money;
  const k = state.analytics?.kpis;
  if (!m) return;

  $('rep-trend-badge').textContent = m.useDailyTrend ? 'By day' : 'By month';
  const ovAmt = Number(k?.overdueAmount?.value || 0);
  const periodPhrase = state.filters.datePreset === 'session'
    ? (state.activeSession?.name || 'this session')
    : 'selected period';
  $('rep-trend-amt').textContent = formatINR(m.totalCollected);
  $('rep-trend-per').textContent = ovAmt > 0
    ? `collected in ${periodPhrase} · ${formatINR(ovAmt)} overdue`
    : `collected in ${periodPhrase}`;

  const legend = $('rep-trend-legend');
  if (legend) {
    legend.innerHTML = '';
    const spCol = document.createElement('span');
    const dotCol = document.createElement('i');
    dotCol.style.background = '#323A85';
    spCol.append(dotCol, document.createTextNode('Collected'));
    legend.appendChild(spCol);
    if (ovAmt > 0) {
      const spOv = document.createElement('span');
      const dotOv = document.createElement('i');
      dotOv.style.background = '#DC2626';
      spOv.append(dotOv, document.createTextNode(`Overdue (${formatINR(ovAmt)})`));
      legend.appendChild(spOv);
    }
  }

  const trendHost = $('rep-chart-trend');
  if (state.trendKind === 'bar') {
    renderBarChart(trendHost, {
      items: m.trendPoints,
      valueFormatter: formatINR,
      viewWidth: 760,
      height: 205,
      color: '#323A85',
      emptyText: 'No collections in selected period'
    });
  } else {
    renderLineChart(trendHost, {
      points: m.trendPoints,
      valueFormatter: formatINR,
      viewWidth: 760,
      height: 205,
      color: '#323A85',
      emptyText: 'No collections in selected period'
    });
  }

  renderDonutChart($('rep-chart-modes'), {
    slices: (m.modeSlices || []).map((s, idx) => ({ ...s, color: CALM_SEG_COLORS[idx % CALM_SEG_COLORS.length] })),
    centerLabel: 'Collected',
    centerValue: formatINR(m.totalCollected),
    valueFormatter: formatINR,
    size: 150,
    thickness: 22,
    emptyText: 'No payment receipts'
  });

  renderDonutChart($('rep-chart-fee-types'), {
    slices: (m.feeTypeSlices || []).map((s, idx) => ({ ...s, color: CALM_SEG_COLORS[idx % CALM_SEG_COLORS.length] })),
    centerLabel: 'By Fee Type',
    centerValue: formatINR(m.totalCollected),
    valueFormatter: formatINR,
    size: 150,
    thickness: 22,
    emptyText: 'No payment receipts'
  });

  const rows = m.staffRows || [];
  $('rep-staff-count').textContent = `${rows.length} staff`;
  const tbody = $('rep-staff-tbody');
  tbody.innerHTML = '';
  if (!rows.length) {
    renderEmptyTableState(tbody, { colSpan: 5, title: 'No staff collections', desc: 'No receipts recorded in this filter scope.' });
    return;
  }
  rows.forEach((r) => {
    const tr = mk('tr');
    const tdName = mk('td', 'rc-td-strong lp-td-primary', r.label);
    const tdRcpt = mk('td', 'num', r.receipts); tdRcpt.dataset.label = 'Receipts';
    const tdCash = mk('td', 'num', formatINR(r.cashAmount)); tdCash.dataset.label = 'Cash';
    const tdOnl = mk('td', 'num', formatINR(r.onlineAmount)); tdOnl.dataset.label = 'Online (UPI / Bank)';
    const tdTot = mk('td', 'num rc-td-strong', formatINR(r.amount)); tdTot.dataset.label = 'Total Amount';
    tr.append(tdName, tdRcpt, tdCash, tdOnl, tdTot);
    tbody.appendChild(tr);
  });
}

function getSelectedDuesRows() {
  const d = state.analytics?.dues;
  if (!d) return [];
  if (state.duesGroupBy === 'batch') return d.byBatch;
  if (state.duesGroupBy === 'course') return d.byCourse;
  return d.byBranch;
}

function renderDuesSection() {
  const d = state.analytics?.dues;
  if (!d) return;

  const grpLabel = state.duesGroupBy === 'batch' ? 'Batch' : (state.duesGroupBy === 'course' ? 'Course' : 'Branch');
  const grpNoun = state.duesGroupBy === 'batch' ? 'batches' : (state.duesGroupBy === 'course' ? 'courses' : 'branches');
  $('rep-dues-group-th-name').textContent = grpLabel;

  const grpRows = getSelectedDuesRows();
  const totalOutSum = grpRows.reduce((s, r) => s + Number(r.outstanding || 0), 0);

  renderThinBarList($('rep-chart-dues-group'), {
    items: grpRows.map((r) => ({
      label: r.label,
      value: r.outstanding,
      valueText: formatINR(r.outstanding),
      subText: r.overdue > 0 ? `(${formatINR(r.overdue)} overdue)` : `${r.students} stds`,
      subDanger: r.overdue > 0
    })),
    totalLabel: `Total across ${grpRows.length} ${grpRows.length === 1 ? grpLabel.toLowerCase() : grpNoun}`,
    totalText: formatINR(totalOutSum),
    emptyText: 'No outstanding dues'
  });

  const ageingSlices = d.ageingSlices || [];
  renderThinBarList($('rep-chart-ageing'), {
    items: ageingSlices.map((s) => ({
      label: s.label,
      value: s.value,
      valueText: formatINR(s.value),
      subText: s.sub || ''
    })),
    totalLabel: `Total overdue principal`,
    totalText: formatINR(d.overdueTotal || 0),
    danger: true,
    emptyText: 'No overdue installments'
  });

  const grpTbody = $('rep-dues-group-tbody');
  grpTbody.innerHTML = '';
  if (!grpRows.length) {
    renderEmptyTableState(grpTbody, { colSpan: 4, title: 'No outstanding dues', desc: 'All students in scope have zero remaining balance.' });
  } else {
    grpRows.forEach((r) => {
      const tr = mk('tr');
      const tdN = mk('td', 'rc-td-strong lp-td-primary', r.label);
      const tdSt = mk('td', 'num', r.students); tdSt.dataset.label = 'Active Students';
      const tdOut = mk('td', 'num rc-td-strong', formatINR(r.outstanding)); tdOut.dataset.label = 'Outstanding Dues';
      const tdOv = mk('td', `num ${r.overdue > 0 ? 'rc-td-danger' : 'rc-td-mute'}`, formatINR(r.overdue)); tdOv.dataset.label = 'Overdue Principal';
      tr.append(tdN, tdSt, tdOut, tdOv);
      grpTbody.appendChild(tr);
    });
  }
}

function renderStudentsSection() {
  const st = state.analytics?.students;
  const brRows = state.analytics?.comparison?.branchComparison || [];
  if (!st) return;

  renderBarChart($('rep-chart-admissions'), {
    items: st.admissionsByMonth,
    viewWidth: 540,
    height: 205,
    color: '#323A85',
    emptyText: 'No admissions recorded'
  });

  const useBranches = state.isSuper && state.stuGroupBy === 'branch';
  if (useBranches) {
    $('rep-stu-list-title').textContent = 'Students by Branch';
    $('rep-stu-list-sub').textContent = 'Enrolled Youth students per centre';
    const bList = brRows.filter((b) => b.students > 0 || state.filters.branchId === 'all');
    const bTotal = bList.reduce((s, b) => s + Number(b.students || 0), 0);
    renderThinBarList($('rep-chart-stu-course'), {
      items: bList.map((b) => ({ label: b.label, value: b.students, valueText: String(b.students) })),
      totalLabel: `Total across ${bList.length} branch${bList.length === 1 ? '' : 'es'}`,
      totalText: `${bTotal} students`,
      emptyText: 'No students in scope'
    });
  } else {
    $('rep-stu-list-title').textContent = 'Students by Course';
    $('rep-stu-list-sub').textContent = 'Enrolled Youth students by course';
    const cList = st.byCourse || [];
    const cTotal = cList.reduce((s, c) => s + Number(c.value || 0), 0);
    renderThinBarList($('rep-chart-stu-course'), {
      items: cList.map((c) => ({ label: c.label, value: c.value, valueText: String(c.value) })),
      totalLabel: `Total across ${cList.length} course${cList.length === 1 ? '' : 's'}`,
      totalText: `${cTotal} students`,
      emptyText: 'No students in scope'
    });
  }

  renderSegmentedBar($('rep-chart-stu-status'), {
    title: 'Student Status',
    segments: (st.byStatus || []).map((it, idx) => ({
      label: it.label,
      value: it.value,
      color: CALM_SEG_COLORS[idx % CALM_SEG_COLORS.length]
    })),
    emptyText: 'No students in scope'
  });

  renderSegmentedBar($('rep-chart-gender'), {
    title: 'Gender Split',
    segments: (st.genderSplit || []).map((it, idx) => ({
      label: it.label,
      value: it.value,
      color: CALM_SEG_COLORS[idx % CALM_SEG_COLORS.length]
    })),
    emptyText: 'No gender data'
  });

  const batches = st.batchFilling || [];
  $('rep-batch-count').textContent = `${batches.length} batch${batches.length === 1 ? '' : 'es'}`;
  const totalEnrolled = batches.reduce((s, b) => s + Number(b.enrolled || 0), 0);
  const totalCap = batches.reduce((s, b) => s + Number(b.capacity || 0), 0);
  renderThinBarList($('rep-batch-fill-list'), {
    items: batches.map((b) => ({
      label: b.branchShort ? `${b.name} (${b.branchShort})` : b.name,
      value: b.hasCapacity ? b.pct : (b.enrolled > 0 ? 45 : 0),
      pct: b.hasCapacity ? b.pct : (b.enrolled > 0 ? 45 : 0),
      valueText: b.hasCapacity ? `${b.enrolled} / ${b.capacity} (${b.pct}%)` : `${b.enrolled} enrolled`,
      subText: b.isFull ? 'Full' : ''
    })),
    totalLabel: `Total across ${batches.length} batch${batches.length === 1 ? '' : 'es'}`,
    totalText: totalCap > 0 ? `${totalEnrolled} / ${totalCap} seats` : `${totalEnrolled} students`,
    emptyText: 'No batches found for active filters.'
  });
}

function renderComparisonSection() {
  if (!state.isSuper) {
    $('rep-sec-comparison').hidden = true;
    return;
  }
  $('rep-sec-comparison').hidden = false;
  const cmp = state.analytics?.comparison;
  if (!cmp) return;

  const brRows = cmp.branchComparison || [];
  renderStackedBarChart($('rep-chart-branch-comp'), {
    grouped: false,
    viewWidth: 540,
    height: 210,
    categories: brRows.map((b) => ({
      label: b.label,
      shortLabel: b.shortLabel,
      values: { collected: b.collected, overdue: b.overdue }
    })),
    series: [
      { key: 'collected', label: 'Collected', color: CHART_PALETTE[0] },
      { key: 'overdue', label: 'Overdue', color: '#DC2626', opacity: '0.9' }
    ],
    valueFormatter: formatINR,
    emptyText: 'No branches to compare'
  });

  const sessCmp = cmp.sessionComparison;
  const sessCats = [];
  if (sessCmp?.previous) {
    sessCats.push({
      label: `${sessCmp.previous.label} (Prev)`,
      shortLabel: sessCmp.previous.label,
      values: { collected: sessCmp.previous.collected, overdue: sessCmp.previous.overdue }
    });
  }
  if (sessCmp?.current) {
    sessCats.push({
      label: `${sessCmp.current.label} (Curr)`,
      shortLabel: sessCmp.current.label,
      values: { collected: sessCmp.current.collected, overdue: sessCmp.current.overdue }
    });
  }
  renderStackedBarChart($('rep-chart-session-comp'), {
    grouped: false,
    viewWidth: 540,
    height: 210,
    categories: sessCats,
    series: [
      { key: 'collected', label: 'Collected', color: CHART_PALETTE[0] },
      { key: 'overdue', label: 'Overdue', color: '#DC2626', opacity: '0.9' }
    ],
    valueFormatter: formatINR,
    emptyText: 'No sessions to compare'
  });

  const brTbody = $('rep-branch-comp-tbody');
  brTbody.innerHTML = '';
  if (!brRows.length) {
    renderEmptyTableState(brTbody, { colSpan: 6, title: 'No branch data', desc: 'No Youth branches in this scope.' });
  } else {
    brRows.forEach((b) => {
      const tr = mk('tr');
      const tdB = mk('td', 'rc-td-strong lp-td-primary', b.label);
      const tdS = mk('td', 'num', b.students); tdS.dataset.label = 'Students';
      const tdC = mk('td', 'num rc-td-strong', formatINR(b.collected)); tdC.dataset.label = 'Collected';
      const tdOut = mk('td', 'num', formatINR(b.outstanding)); tdOut.dataset.label = 'Outstanding';
      const tdOv = mk('td', `num ${b.overdue > 0 ? 'rc-td-danger' : 'rc-td-mute'}`, formatINR(b.overdue)); tdOv.dataset.label = 'Overdue';
      const tdPct = mk('td', 'num'); tdPct.dataset.label = 'Collection %';
      const track = mk('div', 'rc-rate-track');
      const fill = document.createElement('i');
      fill.style.width = `${Math.min(100, Math.round(b.collectionPct || 0))}%`;
      track.appendChild(fill);
      tdPct.append(track, mk('div', 'rc-rate-text', `${b.collectionPct}%`));
      tr.append(tdB, tdS, tdC, tdOut, tdOv, tdPct);
      brTbody.appendChild(tr);
    });
  }

  const scTbody = $('rep-session-comp-tbody');
  scTbody.innerHTML = '';
  const scRows = [sessCmp?.current, sessCmp?.previous].filter(Boolean);
  if (!scRows.length) {
    renderEmptyTableState(scTbody, { colSpan: 5, title: 'No sessions available', desc: 'Load a session to compare.' });
  } else {
    scRows.forEach((r) => {
      const tr = mk('tr');
      const tdLbl = mk('td', 'rc-td-strong lp-td-primary');
      tdLbl.append(mk('span', '', r.label), ' ', mk('span', 'rc-chip', r.tag));
      const tdS = mk('td', 'num', r.students); tdS.dataset.label = 'Students';
      const tdC = mk('td', 'num rc-td-strong', formatINR(r.collected)); tdC.dataset.label = 'Collected';
      const tdD = mk('td', 'num', formatINR(r.dues)); tdD.dataset.label = 'Outstanding Dues';
      const tdO = mk('td', `num ${r.overdue > 0 ? 'rc-td-danger' : 'rc-td-mute'}`, formatINR(r.overdue)); tdO.dataset.label = 'Overdue Amount';
      tr.append(tdLbl, tdS, tdC, tdD, tdO);
      scTbody.appendChild(tr);
    });
  }
}

function exportTableCsv(kind) {
  if (!state?.analytics) return;
  const a = state.analytics;
  const stamp = todayISO();

  if (kind === 'staff') {
    downloadCsv(`youth-staff-collections-${stamp}.csv`,
      ['Staff (Designation)', 'Receipts', 'Cash', 'Online', 'Total Amount'],
      (a.money.staffRows || []).map((r) => [r.label, r.receipts, r.cashAmount, r.onlineAmount, r.amount])
    );
  } else if (kind === 'duesGroup') {
    const lbl = state.duesGroupBy === 'batch' ? 'Batch' : (state.duesGroupBy === 'course' ? 'Course' : 'Branch');
    downloadCsv(`youth-outstanding-by-${state.duesGroupBy}-${stamp}.csv`,
      [lbl, 'Active Students', 'Outstanding Dues', 'Overdue Principal'],
      getSelectedDuesRows().map((r) => [r.label, r.students, r.outstanding, r.overdue])
    );
  } else if (kind === 'batches') {
    downloadCsv(`youth-batch-filling-${stamp}.csv`,
      ['Batch', 'Branch', 'Enrolled Active', 'Capacity', 'Fill %', 'Full'],
      (a.students.batchFilling || []).map((b) => [b.name, b.branchShort, b.enrolled, b.hasCapacity ? b.capacity : 'Unlimited', b.hasCapacity ? `${b.pct}%` : '-', b.isFull ? 'Yes' : 'No'])
    );
  } else if (kind === 'branchComp' && state.isSuper) {
    downloadCsv(`youth-branch-comparison-${stamp}.csv`,
      ['Branch', 'Students', 'Collected', 'Outstanding', 'Overdue', 'Collection %'],
      (a.comparison.branchComparison || []).map((b) => [b.label, b.students, b.collected, b.outstanding, b.overdue, `${b.collectionPct}%`])
    );
  } else if (kind === 'sessionComp' && state.isSuper) {
    const sc = [a.comparison.sessionComparison?.current, a.comparison.sessionComparison?.previous].filter(Boolean);
    downloadCsv(`youth-session-comparison-${stamp}.csv`,
      ['Session', 'Scope', 'Students', 'Collected', 'Outstanding Dues', 'Overdue'],
      sc.map((s) => [s.label, s.tag, s.students, s.collected, s.dues, s.overdue])
    );
  }
  showToast({ type: 'success', message: 'CSV downloaded.' });
}

function chartHtmlWithTitle(title, hostId) {
  const el = $(hostId);
  if (!el) return '';
  return `<div class="pr-chart-title">${title}</div>${el.innerHTML}`;
}

function activeFiltersText() {
  const bb = state.bbFilter ? state.bbFilter.getValue() : { branchId: 'all', batchId: 'all' };
  const scoped = scopeReferenceDataByCtx(state.meta || {}, 'youth');
  const { dateFrom, dateTo } = resolveEffectiveDateWindow();

  const brName = state.isBranchHead
    ? (toTitleCaseIfCaps(scoped.branchesById[state.profile.branchId]?.name) || state.profile.branchId)
    : (bb.branchId === 'all' ? 'All Branches' : (toTitleCaseIfCaps(scoped.branchesById[bb.branchId]?.name) || bb.branchId));
  const btName = bb.batchId === 'all' ? 'All Batches' : (scoped.batchesById[bb.batchId]?.name || bb.batchId);
  const crName = state.filters.courseId === 'all' ? 'All Courses' : (scoped.coursesById[state.filters.courseId]?.name || state.filters.courseId);
  const dtStr = dateFrom || dateTo ? `${dateFrom || 'Start'} to ${dateTo || 'Today'}` : 'Whole session';

  return `Session: ${state.activeSession?.name || '-'} | Branch: ${brName} | Batch: ${btName} | Course: ${crName} | Period: ${dtStr}`;
}

function handlePrintWholePage() {
  if (!state?.analytics) return;
  const a = state.analytics;
  const k = a.kpis;
  const org = window.APP_CACHE?.org || null;

  const disp = resolveUserDisplay(state.profile?.email, state.profile?.name, state.profile?.designation);
  const genName = (!disp.name || disp.name === '-' || disp.name.includes('@')) ? (state.profile?.name || getRoleTitle(state.profile?.role)) : disp.name;
  const genDesig = disp.designation || getRoleTitle(state.profile?.role);
  const generatedBy = genDesig ? `${genName} (${genDesig})` : genName;

  const deltaOrSub = (item) => (hasRealComparison(item.delta) ? item.delta.text : item.sub);

  const summaryPairs = [
    { label: 'Total collected', value: formatINR(k.totalCollected.value), sub: deltaOrSub(k.totalCollected) },
    { label: 'Collection rate', value: `${k.collectionRate.value}%`, sub: k.collectionRate.sub },
    { label: 'Outstanding dues', value: formatINR(k.outstandingDues.value), sub: deltaOrSub(k.outstandingDues) },
    { label: 'Overdue amount', value: formatINR(k.overdueAmount.value), sub: deltaOrSub(k.overdueAmount) },
    { label: 'Late fees collected', value: formatINR(k.lateFeesCollected.value), sub: deltaOrSub(k.lateFeesCollected) },
    { label: 'Late fees waived', value: formatINR(k.lateFeesWaived.value), sub: deltaOrSub(k.lateFeesWaived) },
    { label: 'New admissions', value: String(k.newAdmissions.value), sub: deltaOrSub(k.newAdmissions) },
    { label: 'Active students', value: String(k.activeStudents.value), sub: deltaOrSub(k.activeStudents) }
  ];

  const grpRows = getSelectedDuesRows();
  const grpColLabel = state.duesGroupBy === 'batch' ? 'Batch' : (state.duesGroupBy === 'course' ? 'Course' : 'Branch');

  const sections = [
    {
      title: 'Money & Collections',
      chartsHtml: [
        chartHtmlWithTitle('Collection Trend', 'rep-chart-trend'),
        chartHtmlWithTitle('Collection by Payment Mode', 'rep-chart-modes'),
        chartHtmlWithTitle('Collection by Fee Type', 'rep-chart-fee-types')
      ],
      columns: [
        { label: 'Staff (Designation)' },
        { label: 'Receipts', num: true },
        { label: 'Cash', num: true },
        { label: 'Online', num: true },
        { label: 'Total Amount', num: true }
      ],
      rows: (a.money.staffRows || []).map((r) => [r.label, r.receipts, formatINR(r.cashAmount), formatINR(r.onlineAmount), formatINR(r.amount)])
    },
    {
      title: 'Dues & Ageing',
      chartsHtml: [
        chartHtmlWithTitle(`Outstanding Dues by ${toTitleCaseIfCaps(state.duesGroupBy)}`, 'rep-chart-dues-group'),
        chartHtmlWithTitle('Overdue Ageing', 'rep-chart-ageing')
      ],
      columns: [
        { label: grpColLabel },
        { label: 'Active Students', num: true },
        { label: 'Outstanding Dues', num: true },
        { label: 'Overdue Principal', num: true }
      ],
      rows: grpRows.map((r) => [r.label, r.students, formatINR(r.outstanding), formatINR(r.overdue)])
    },
    {
      title: 'Students & Batch Capacity',
      chartsHtml: [
        chartHtmlWithTitle('Admissions Per Month', 'rep-chart-admissions'),
        chartHtmlWithTitle('Students by Course', 'rep-chart-stu-course'),
        chartHtmlWithTitle('Student Status', 'rep-chart-stu-status'),
        chartHtmlWithTitle('Gender Split', 'rep-chart-gender')
      ],
      columns: [{ label: 'Batch' }, { label: 'Branch' }, { label: 'Enrolled', num: true }, { label: 'Capacity', num: true }, { label: 'Status' }],
      rows: (a.students.batchFilling || []).map((b) => [b.name, b.branchShort, b.enrolled, b.hasCapacity ? b.capacity : 'No cap', b.isFull ? 'FULL' : (b.hasCapacity ? `${b.pct}%` : 'Open')])
    }
  ];

  if (state.isSuper) {
    sections.push({
      title: 'Branch & Session Comparison',
      chartsHtml: [
        chartHtmlWithTitle('Branch Financials Comparison', 'rep-chart-branch-comp'),
        chartHtmlWithTitle('Current vs Previous Session', 'rep-chart-session-comp')
      ],
      tables: [
        {
          title: 'Branch Comparison',
          columns: [{ label: 'Branch' }, { label: 'Students', num: true }, { label: 'Collected', num: true }, { label: 'Outstanding', num: true }, { label: 'Overdue', num: true }, { label: 'Collection %', num: true }],
          rows: (a.comparison.branchComparison || []).map((b) => [b.label, b.students, formatINR(b.collected), formatINR(b.outstanding), formatINR(b.overdue), `${b.collectionPct}%`])
        },
        {
          title: 'Session Comparison',
          columns: [{ label: 'Session' }, { label: 'Students', num: true }, { label: 'Collected', num: true }, { label: 'Outstanding Dues', num: true }, { label: 'Overdue', num: true }],
          rows: [a.comparison.sessionComparison?.current, a.comparison.sessionComparison?.previous].filter(Boolean).map((s) => [`${s.label} (${s.tag})`, s.students, formatINR(s.collected), formatINR(s.dues), formatINR(s.overdue)])
        }
      ]
    });
  }

  const ok = openPrintSheet({
    title: 'Youth Centre — Financial & Student Reports',
    subtitle: `Session: ${state.activeSession?.name || '-'}`,
    org,
    filtersText: activeFiltersText(),
    generatedBy,
    summaryPairs,
    sections,
    footerNote: `${org?.orgName || 'Unique Infotech'} · Generated by ${generatedBy}`
  });
  if (!ok) {
    showToast({ type: 'error', message: 'Popup blocked. Allow popups to Print / Save as PDF.' });
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
