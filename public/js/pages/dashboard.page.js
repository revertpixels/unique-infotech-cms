// dashboard.page.js — Read-only Youth Centre Dashboard (#/dashboard) + preserved Unique Kids placeholder.

import { ROUTES } from '../core/router.js?v=1.8.197';
import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createSelect } from '../components/ui-select.js?v=1.8.197';
import {
  renderDonutChart,
  renderBarChart,
  renderStackedBarChart,
  renderLineChart
} from '../components/charts.js?v=1.8.197';
import { openPaymentDetailsModal } from '../components/payment-details-modal.js?v=1.8.197';
import { loadDashboardArchiveReminder, getCachedDashboardArchiveReminder } from '../services/archive.service.js?v=1.8.197';
import { resolveUserDisplay, getRoleTitle } from '../services/user-directory.service.js?v=1.8.197';
import { getCachedSessions, loadSessions, getSelectedSession, getSelectedSessionId, hasFreshSessionsCache } from '../core/sessions.js?v=1.8.197';
import { getOrgTimezone } from '../utils/session-rules.js?v=1.8.197';
import { formatPersonName, initials, formatDateIN } from '../utils/formatter.js?v=1.8.197';
import { buildYouthDashboardData } from '../services/dashboard.service.js?v=1.8.197';
import { localToday } from '../utils/school-lifecycle.js?v=1.8.197';
import {
  isBreakOverdueReturn,
  formatBreakPeriod,
  formatShortMonthYear,
  evaluateKidsPendingBills,
  syncOpenKidsBills
} from '../utils/school-billing.js?v=1.8.197';
import { openKidsResumeBreakModal } from '../utils/school-break-modals.js?v=1.8.197';
import {
  ensureReferenceData,
  getCachedReferenceData,
  scopeReferenceDataByCtx,
  ensureYouthStudents,
  loadYouthDashboardServerAggregates,
  loadYouthPaymentHistory,
  getCachedYouthHistory,
  loadYouthPendingReport,
  getCachedYouthPending,
  loadKidsPaymentHistory,
  getCachedKidsHistory,
  ensureKidsDataset,
  syncKidsDatasetDelta,
  getCachedKidsDataset,
  loadKidsDashboardServerAggregates,
  loadStudentPhotos,
  getCachedStudentPhoto,
  isCacheStale,
  scheduleDelayedSkeleton,
  formatShortReceipt,
  modeDisplayMeta,
  formatINR,
  fmtDate
} from '../services/report.service.js?v=1.8.197';

let state = null;
let profileListener = null;
let usersListener = null;
let sessionSelListener = null;
let sessionsLoadedListener = null;
let sessionsChangedListener = null;
let kidsDataMutatedListener = null;
let kidsDashDestroyed = false;

function $(id) {
  return document.getElementById(id);
}

function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function paint() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function getGreetingPrefix() {
  try {
    const tz = getOrgTimezone() || 'Asia/Kolkata';
    const hrStr = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false
    }).format(new Date());
    const hr = Number(hrStr);
    if (Number.isFinite(hr)) {
      if (hr < 12) return 'Good morning';
      if (hr < 17) return 'Good afternoon';
      return 'Good evening';
    }
  } catch (_) {
    /* fallback */
  }
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function resolveGreetingText(profile) {
  const disp = resolveUserDisplay(profile?.email, profile?.name, profile?.designation);
  const rawName = (disp.name && disp.name !== '-') ? disp.name : (profile?.name || profile?.email?.split('@')[0] || 'there');
  const cleanName = formatPersonName(rawName) || rawName;
  return `${getGreetingPrefix()}, ${cleanName}`;
}

function formatPaymentTimeIST(sec) {
  const n = Number(sec || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: getOrgTimezone() || 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(n * 1000)).toLowerCase();
  } catch (_) {
    return '';
  }
}

function rcptWord(n) {
  return Number(n) === 1 ? 'receipt' : 'receipts';
}

function stuWord(n) {
  return Number(n) === 1 ? 'student' : 'students';
}

function modeChipClass(entry) {
  const raw = String(entry?.mode || '').toLowerCase();
  const lbl = String(modeDisplayMeta(entry).label || '').toLowerCase();
  if (raw === 'cash' || lbl.includes('cash')) return 'is-cash';
  if (raw === 'upi' || lbl.includes('upi')) return 'is-upi';
  if (raw === 'bank' || raw === 'neft' || raw === 'imps' || raw === 'rtgs' || lbl.includes('bank')) return 'is-bank';
  return 'is-other';
}

function showYouthSkeletons() {
  if (!state || state.destroyed) return;
  const kpiIds = [
    'dash-kpi-active',
    'dash-kpi-admissions',
    'dash-kpi-collected',
    'dash-kpi-overdue',
    'dash-kpi-today',
    'dash-kpi-month',
    'dash-kpi-outstanding',
    'dash-kpi-rate'
  ];
  kpiIds.forEach((id) => {
    const el = $(id);
    if (el) el.innerHTML = '<span class="skel dash-kpi-skel"></span>';
  });
  const subIds = [
    'dash-kpi-active-sub',
    'dash-kpi-admissions-sub',
    'dash-kpi-collected-sub',
    'dash-kpi-overdue-sub',
    'dash-kpi-today-sub',
    'dash-kpi-month-sub',
    'dash-kpi-outstanding-sub',
    'dash-kpi-rate-sub'
  ];
  subIds.forEach((id) => {
    const el = $(id);
    if (el) el.textContent = 'Loading...';
  });

  ['dash-chart-feehead', 'dash-chart-trend'].forEach((id) => {
    const el = $(id);
    if (el) el.innerHTML = '<div class="skel dash-chart-skel"></div>';
  });
  const brHost = $('dash-branch-list');
  if (brHost) brHost.innerHTML = '<div class="skel dash-branch-skel"></div>';

  ['dash-chart-modes', 'dash-chart-ageing', 'dash-chart-stu-course'].forEach((id) => {
    const el = $(id);
    if (el) {
      el.innerHTML = '<div class="dash-donut-skel"><div class="skel dash-donut-ring-skel"></div><div class="dash-donut-lines-skel"><div class="skel dash-donut-line-skel"></div><div class="skel dash-donut-line-skel"></div><div class="skel dash-donut-line-skel"></div></div></div>';
    }
  });

  const recentHost = $('dash-recent-list');
  if (recentHost) {
    recentHost.innerHTML = '<div class="dash-recent-skel-wrap"><div class="skel dash-recent-skel-row"></div><div class="skel dash-recent-skel-row"></div><div class="skel dash-recent-skel-row"></div><div class="skel dash-recent-skel-row"></div><div class="skel dash-recent-skel-row"></div></div>';
  }
}

function toggleNoSessionState(isNoSession) {
  const notice = $('dash-no-session');
  const main = $('dash-main');
  if (notice) notice.hidden = !isNoSession;
  if (main) main.hidden = isNoSession;
  paint();
}

function showYouthError(err) {
  const errBox = $('dash-error');
  const msgEl = $('dash-error-msg');
  if (msgEl) msgEl.textContent = err?.message || 'Permission or network failure while reading Youth overview.';
  if (errBox) errBox.hidden = false;
  paint();
}

function applyArchiveReminderDom(remHost, rem) {
  if (!remHost) return;
  if (!rem || (rem.unarchivedCount === 0 && !rem.staleArchive)) {
    remHost.hidden = true;
    remHost.innerHTML = '';
    return;
  }
  const parts = [];
  if (rem.unarchivedCount > 0) {
    const names = rem.unarchivedNames.slice(0, 2).join(', ');
    const extra = rem.unarchivedNames.length > 2 ? ` +${rem.unarchivedNames.length - 2} more` : '';
    parts.push(`${rem.unarchivedCount} completed session${rem.unarchivedCount === 1 ? '' : 's'} not downloaded yet (${names}${extra}).`);
  }
  if (rem.staleArchive) {
    if (rem.daysSinceLast === null) {
      parts.push('No Youth archive downloaded yet.');
    } else {
      parts.push(`Last archive download was ${rem.daysSinceLast} days ago.`);
    }
  }

  remHost.innerHTML = '';
  const box = mk('div', 'arx-reminder' + (rem.unarchivedCount > 0 ? '' : ' is-info'));
  const main = mk('div', 'arx-reminder-main');
  const icBox = mk('div', 'arx-reminder-ic');
  icBox.innerHTML = `<i data-lucide="${rem.unarchivedCount > 0 ? 'archive' : 'clock'}" aria-hidden="true"></i>`;
  const txt = mk('div', 'arx-reminder-txt');
  const b = mk('strong', '', 'Archive reminder: ');
  txt.append(b, document.createTextNode(parts.join(' ')));
  main.append(icBox, txt);

  const link = mk('a', 'ui-btn ghost sm', 'Open Archives');
  link.href = '#/archives';
  box.append(main, link);
  remHost.appendChild(box);
  remHost.hidden = false;
  paint();
}

async function updateArchiveReminder() {
  if (!state || state.destroyed) return;
  const remHost = $('dash-archive-reminder');
  if (!remHost) return;
  const canSee = state.ctx === 'youth' && (state.isSuper || state.isBranchHead);
  if (!canSee) {
    remHost.hidden = true;
    remHost.innerHTML = '';
    return;
  }
  const cachedRem = getCachedDashboardArchiveReminder(state.profile);
  if (cachedRem && 'data' in cachedRem) {
    applyArchiveReminderDom(remHost, cachedRem.data);
  }
  try {
    const rem = await loadDashboardArchiveReminder({ profile: state.profile });
    if (!state || state.destroyed || !remHost) return;
    applyArchiveReminderDom(remHost, rem);
  } catch (_) {
    /* optional notice */
  }
}

function updateHeaderUi() {
  if (!state || state.destroyed) return;
  const gEl = $('dash-greeting');
  if (gEl) gEl.textContent = resolveGreetingText(state.profile);

  const chip = $('dash-role-chip');
  const roleLabel = getRoleTitle(state.profile?.role);
  if (chip) {
    chip.textContent = roleLabel || '';
    chip.hidden = !roleLabel;
  }

  const subEl = $('dash-subtitle');
  if (subEl) {
    if (!state.activeSession) {
      subEl.textContent = 'Select a Youth Centre session in the top toolbar.';
    } else if (state.analytics) {
      const { runningBatchesCount, activeBranchesCount } = state.analytics.headerMeta;
      const bTxt = `${runningBatchesCount} running batch${runningBatchesCount === 1 ? '' : 'es'}`;
      const brTxt = state.isBranchHead
        ? (state.analytics.studentsByBranch[0]?.label || 'Assigned branch')
        : `${activeBranchesCount} branch${activeBranchesCount === 1 ? '' : 'es'}`;
      subEl.textContent = `${state.activeSession.name || state.activeSession.id} · ${bTxt} across ${brTxt}`;
    } else {
      subEl.textContent = `${state.activeSession.name || state.activeSession.id} · Loading live Youth Centre overview...`;
    }
  }
}

function syncBranchFilterControl() {
  if (!state || state.destroyed) return;
  const wrap = $('dash-branch-filter-wrap');
  const host = $('dash-branch-host');
  const lockedEl = $('dash-branch-locked');
  const lockedNameEl = $('dash-branch-locked-name');
  const sepBranch = $('dash-tb-sep-branch');
  if (!wrap || !host || !lockedEl) return;

  const scoped = scopeReferenceDataByCtx(state.meta || {}, 'youth');
  const branches = scoped.branchesList || [];

  if (state.isBranchHead) {
    wrap.hidden = false;
    if (sepBranch) sepBranch.hidden = false;
    host.hidden = true;
    host.innerHTML = '';
    state.branchSelect = null;
    const br = state.meta?.branchesById?.[state.profile.branchId] || branches.find((b) => b.id === state.profile.branchId) || {};
    const brName = br.name || br.code || state.profile.branchId;
    if (lockedNameEl) lockedNameEl.textContent = brName;
    lockedEl.title = brName;
    lockedEl.hidden = false;
    paint();
    return;
  }

  if (!state.isSuper) {
    wrap.hidden = true;
    if (sepBranch) sepBranch.hidden = true;
    return;
  }

  wrap.hidden = false;
  if (sepBranch) sepBranch.hidden = false;
  lockedEl.hidden = true;
  host.hidden = false;

  const options = [
    {
      value: 'all',
      label: 'All branches',
      shortLabel: 'All branches',
      title: '',
      icon: 'git-branch'
    },
    ...branches.map((b) => {
      const code = String(b.code || '').trim();
      const fullName = String(b.name || '').trim();
      return {
        value: b.id,
        label: code && fullName ? `${code} - ${fullName}` : (fullName || code || b.id),
        shortLabel: code || fullName || b.id,
        title: fullName || code || b.id,
        icon: 'map-pin'
      };
    })
  ];

  if (!state.branchSelect) {
    host.innerHTML = '';
    state.branchSelect = createSelect(host, {
      options,
      value: state.branchFilter,
      ariaLabel: 'Filter by branch',
      searchable: branches.length > 6,
      searchPlaceholder: 'Filter branch...',
      onChange: (val) => {
        if (!state || state.destroyed) return;
        state.branchFilter = val || 'all';
        computeAndRenderDashboard();
      }
    });
  } else {
    state.branchSelect.setOptions(options, state.branchFilter);
  }
  paint();
}

function renderHeaderToolbar(d = null) {
  const host = $('dash-toolbar-actions');
  const sepActions = $('dash-tb-sep-actions');
  if (!host || !state) return;

  const pendingCnt = d ? Number(d.kpis?.overdueFees?.studentCount || 0) : 0;
  const role = state.profile?.role || '';

  if (host.dataset.renderedRole !== role) {
    const definitions = [
      { id: 'dash-tb-admission', key: 'admissions', label: 'New Admission', href: '#/admissions?new=1', icon: 'user-plus' },
      { id: 'dash-tb-collect', key: 'pay-fees', label: 'Collect Fees', href: '#/pay-fees', icon: 'wallet' },
      { id: 'dash-tb-pending', key: 'pending', label: 'Pending & Overdue', href: '#/pending', icon: 'alarm-clock', hasBadge: true },
      { id: 'dash-tb-payments', key: 'payments', label: 'Payment History', href: '#/payments', icon: 'history' },
      { id: 'dash-tb-reports', key: 'reports', label: 'Reports', href: '#/reports', icon: 'bar-chart-3' }
    ];

    const visible = definitions.filter((item) => {
      const r = ROUTES[item.key];
      return r && (!Array.isArray(r.roles) || r.roles.includes(role));
    });

    host.innerHTML = '';
    visible.forEach((item) => {
      const wrap = mk('div', 'dash-tb-item');
      const a = mk('a', 'dash-tb-btn');
      a.id = item.id;
      a.href = item.href;
      a.setAttribute('aria-label', item.label);

      const ic = document.createElement('i');
      ic.setAttribute('data-lucide', item.icon);
      ic.setAttribute('aria-hidden', 'true');
      a.appendChild(ic);

      if (item.hasBadge) {
        const badge = mk('span', 'dash-tb-badge');
        badge.id = 'dash-tb-pending-badge';
        badge.hidden = true;
        badge.setAttribute('aria-hidden', 'true');
        a.appendChild(badge);
      }

      const tip = mk('span', 'dash-tb-tip', item.label);
      tip.setAttribute('role', 'tooltip');
      wrap.append(a, tip);
      host.appendChild(wrap);
    });

    host.dataset.renderedRole = role;
    host.hidden = visible.length === 0;
    if (sepActions) sepActions.hidden = visible.length === 0;
    paint();
  }

  const badgeEl = host.querySelector('.dash-tb-badge');
  if (badgeEl) {
    if (pendingCnt > 0) {
      badgeEl.textContent = String(pendingCnt);
      badgeEl.hidden = false;
    } else {
      badgeEl.textContent = '';
      badgeEl.hidden = true;
    }
  }
}

function resolveSessionFromList(sessionsList = []) {
  const cached = getSelectedSession('youth');
  if (cached && sessionsList.some((s) => s.id === cached.id)) return cached;
  return sessionsList.find((s) => s.isCurrent) || sessionsList.find((s) => s.status === 'running') || sessionsList[0] || null;
}

function resolveActiveSession() {
  return resolveSessionFromList(state?.sessions || []);
}

function dashboardSignature(histRes, pendRes) {
  const hLen = histRes?.entries?.length || 0;
  const pLen = pendRes?.items?.length || 0;
  const latestRec = hLen ? (histRes.entries[0]?.receiptNo || histRes.entries[0]?.id || '') : '';
  const dueSum = pendRes?.summary?.overdueAmount || 0;
  const colSum = (histRes?.entries || []).reduce((acc, e) => acc + Number(e.totalPaid || e.amount || 0), 0);
  return `${hLen}|${pLen}|${latestRec}|${dueSum}|${colSum}`;
}

async function loadDashboardSources({ forceRefresh = false, deltaRefresh = false, background = false } = {}) {
  if (!state || state.destroyed) return;
  const errBox = $('dash-error');
  if (errBox && !background) errBox.hidden = true;

  if (!forceRefresh && !deltaRefresh) {
    const cachedMeta = getCachedReferenceData(state.profile);
    const cachedSessions = getCachedSessions('youth');
    const cachedSess = cachedSessions.length ? resolveSessionFromList(cachedSessions) : null;
    if (cachedMeta && cachedSessions.length && !cachedSess) {
      state.meta = cachedMeta;
      state.sessions = cachedSessions;
      state.activeSession = null;
      updateHeaderUi();
      syncBranchFilterControl();
      toggleNoSessionState(true);
      if (isCacheStale(cachedMeta) || !hasFreshSessionsCache('youth')) {
        loadDashboardSources({ forceRefresh: true, background: true }).catch(() => {});
      }
      return;
    }
    if (cachedMeta && cachedSess) {
      const cachedHist = getCachedYouthHistory({ profile: state.profile, session: cachedSess });
      const cachedPend = getCachedYouthPending({ profile: state.profile, session: cachedSess });
      if (cachedHist && cachedPend) {
        state.meta = cachedMeta;
        state.sessions = cachedSessions;
        state.activeSession = cachedSess;
        state.historyResult = cachedHist;
        state.pendingResult = cachedPend;
        updateHeaderUi();
        syncBranchFilterControl();
        toggleNoSessionState(false);
        computeAndRenderDashboard();

        const isStale = isCacheStale(cachedMeta)
          || !hasFreshSessionsCache('youth')
          || isCacheStale(cachedHist)
          || isCacheStale(cachedPend);
        if (isStale && !background) {
          loadDashboardSources({ forceRefresh: false, deltaRefresh: true, background: true }).catch(() => {});
        }
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          window.dispatchEvent(new CustomEvent('uic:initial-data-ready'));
        }
        return;
      }
    }
  }

  const refreshBtn = $('dash-refresh');
  if (refreshBtn && !background) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('is-refreshing');
    const ic = refreshBtn.querySelector('svg, i');
    if (ic) ic.classList.add('spin');
  }

  const prevSig = dashboardSignature(state.historyResult, state.pendingResult);
  const skelTask = (!state.analytics && !background)
    ? scheduleDelayedSkeleton(() => {
      if (state && !state.destroyed && !state.analytics) showYouthSkeletons();
    }, 250)
    : null;

  try {
    const preSessId = getSelectedSessionId('youth');
    const earlyAggPromise = (!background && preSessId)
      ? loadYouthDashboardServerAggregates({
        profile: state.profile,
        session: { id: preSessId },
        branchFilter: state.branchFilter
      }).then((agg) => {
        if (agg) {
          if (state && !state.destroyed) state.lastServerAgg = agg;
          applyEarlyServerAggregates(agg);
        }
        return agg;
      }).catch(() => null)
      : Promise.resolve(null);

    const [meta, sessions] = await Promise.all([
      ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile: state.profile }),
      (!forceRefresh && hasFreshSessionsCache('youth'))
        ? Promise.resolve(getCachedSessions('youth'))
        : loadSessions('youth', { forceRefresh })
    ]);
    if (!state || state.destroyed) return;

    state.meta = meta;
    state.sessions = sessions || [];
    state.activeSession = resolveActiveSession();

    if (!background) {
      updateHeaderUi();
      syncBranchFilterControl();
    }

    if (!state.activeSession) {
      toggleNoSessionState(true);
      return;
    }

    toggleNoSessionState(false);

    // Phase 1: KPI server aggregate (if active session differed from pre-selected ID or wasn't started yet)
    if (!background && state.activeSession.id !== preSessId) {
      loadYouthDashboardServerAggregates({
        profile: state.profile,
        session: state.activeSession,
        branchFilter: state.branchFilter
      }).then((agg) => {
        if (agg) {
          if (state && !state.destroyed) state.lastServerAgg = agg;
          applyEarlyServerAggregates(agg);
        }
      }).catch(() => {});
    } else if (!background) {
      await Promise.race([earlyAggPromise, new Promise((r) => setTimeout(r, 120))]);
    }

    // Phase 2: Stream active-session students early for instant Active/Admissions KPIs while payment dataset completes
    if (!background && !deltaRefresh) {
      ensureYouthStudents({
        profile: state.profile,
        sessionId: state.activeSession.id,
        forceRefresh,
        onFirstPage: (firstSt) => applyEarlyStudentSnapshot(firstSt)
      }).then((fullSt) => applyEarlyStudentSnapshot(fullSt)).catch(() => {});
    }

    // Phase 3: Load active-session pending & payment dataset (shared single-session dataset); paint KPIs first
    const [histRes, pendRes] = await Promise.all([
      loadYouthPaymentHistory({
        profile: state.profile,
        session: state.activeSession,
        dateFrom: '',
        dateTo: '',
        loadAll: false,
        forceRefresh,
        deltaRefresh
      }),
      loadYouthPendingReport({
        profile: state.profile,
        session: state.activeSession,
        forceRefresh,
        deltaRefresh
      })
    ]);
    if (!state || state.destroyed) return;

    const nextSig = dashboardSignature(histRes, pendRes);
    state.historyResult = histRes;
    state.pendingResult = pendRes;

    if (!background || nextSig !== prevSig || !state.analytics) {
      updateHeaderUi();
      syncBranchFilterControl();
      computeAndRenderDashboard();
    }
    if (state.lastServerAgg && state.analytics?.kpis && state.lastServerAgg.sessionId === state.activeSession?.id) {
      const a = state.lastServerAgg;
      const k = state.analytics.kpis;
      const drifts = [];
      if (a.hasMoneySum && Math.abs(a.moneySum - Number(k.feeCollection?.value || 0)) > 1) {
        drifts.push(`collected server=${a.moneySum} vs ledger=${k.feeCollection?.value}`);
      }
      if (a.hasCurrencySums && Math.abs(a.feeSum - Number(k.feeCollection?.totalCourseFee || 0)) > 1) {
        drifts.push(`feeTotal server=${a.feeSum} vs calc=${k.feeCollection?.totalCourseFee}`);
      }
      if (a.hasCurrencySums && Math.abs(a.balanceSum - Number(k.outstandingDues?.value || 0)) > 1) {
        drifts.push(`balanceDue server=${a.balanceSum} vs calc=${k.outstandingDues?.value}`);
      }
      if (Number.isFinite(a.activeCount) && a.activeCount !== Number(k.activeStudents?.value || 0)) {
        drifts.push(`activeCount server=${a.activeCount} vs calc=${k.activeStudents?.value}`);
      }
      if (drifts.length) {
        console.warn('[dashboard] KPI denormalization drift detected (using payment records truth):', drifts.join('; '));
      }
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('uic:initial-data-ready'));
    }
  } catch (err) {
    if (!state || state.destroyed) return;
    if (!background) {
      console.error('[dashboard] load failed', err);
      showYouthError(err);
    }
  } finally {
    if (skelTask) skelTask.cancel();
    if (refreshBtn && !background) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('is-refreshing');
      refreshBtn.querySelectorAll('.spin').forEach((el) => el.classList.remove('spin'));
    }
  }
}

function renderKpis(d) {
  const k = d.kpis;
  $('dash-kpi-active').textContent = String(k.activeStudents.value);
  $('dash-kpi-active-sub').textContent = `Across ${k.activeStudents.activeBatchesCount} ${k.activeStudents.activeBatchesCount === 1 ? 'batch' : 'batches'}`;

  $('dash-kpi-admissions').textContent = String(k.newAdmissions.value);
  $('dash-kpi-admissions-sub').textContent = `${k.newAdmissions.thisMonth} this month`;

  $('dash-kpi-collected').textContent = formatINR(k.feeCollection.value);
  $('dash-kpi-collected-sub').textContent = `${k.feeCollection.collectionRate}% of ${formatINR(k.feeCollection.totalCourseFee)} billed`;

  const ovVal = $('dash-kpi-overdue');
  const ovSub = $('dash-kpi-overdue-sub');
  if (ovVal) {
    ovVal.textContent = formatINR(k.overdueFees.value);
    ovVal.className = `rc-stat-val${k.overdueFees.value > 0 ? ' is-danger' : ''}`;
  }
  if (ovSub) {
    ovSub.textContent = k.overdueFees.studentCount > 0
      ? `${k.overdueFees.studentCount} ${stuWord(k.overdueFees.studentCount)} pending`
      : 'No overdue fees';
    ovSub.className = `rc-chip${k.overdueFees.value > 0 ? ' is-danger' : ''}`;
  }

  $('dash-kpi-today').textContent = formatINR(k.todayCollection.value);
  $('dash-kpi-today-sub').textContent = `${k.todayCollection.receipts} ${rcptWord(k.todayCollection.receipts)} today`;

  $('dash-kpi-month').textContent = formatINR(k.monthCollection.value);
  $('dash-kpi-month-sub').textContent = `${k.monthCollection.receipts} ${rcptWord(k.monthCollection.receipts)} this month`;

  $('dash-kpi-outstanding').textContent = formatINR(k.outstandingDues.value);
  $('dash-kpi-outstanding-sub').textContent = `${k.outstandingDues.studentsWithBalanceCount} ${stuWord(k.outstandingDues.studentsWithBalanceCount)} with balance`;

  $('dash-kpi-rate').textContent = `${k.collectionRate.value}%`;
  const rateBar = $('dash-kpi-rate-bar');
  if (rateBar) {
    const pct = Math.max(0, Math.min(100, Number(k.collectionRate.value || 0)));
    rateBar.style.width = `${pct}%`;
  }
  $('dash-kpi-rate-sub').textContent = `of ${formatINR(k.collectionRate.totalCourseFee)} total billed`;
}

function renderFeeHeadsAndBranches(d) {
  $('dash-feehead-note').textContent = state.activeSession?.name || 'Session scope';
  $('dash-feehead-total').textContent = formatINR(d.feeHeadTotals.collected);
  $('dash-feehead-overdue-note').textContent = d.feeHeadTotals.overdue > 0
    ? `· ${formatINR(d.feeHeadTotals.overdue)} overdue pending`
    : '· All fee heads on schedule';

  const hasAny = d.feeHeadTotals.collected > 0 || d.feeHeadTotals.overdue > 0;
  renderStackedBarChart($('dash-chart-feehead'), {
    grouped: false,
    categories: hasAny
      ? d.feeHeadBars.map((b) => ({
        label: b.label,
        shortLabel: b.shortLabel,
        values: { collected: b.collected, overdue: b.overdue }
      }))
      : [],
    series: [
      { key: 'collected', label: 'Collected', color: '#323A85' },
      { key: 'overdue', label: 'Overdue', color: '#DC2626' }
    ],
    valueFormatter: formatINR,
    viewWidth: 640,
    height: 185,
    emptyText: 'No fee receipts or overdue items in this session'
  });

  const brRows = d.studentsByBranch || [];
  $('dash-branch-count-pill').textContent = `${brRows.length} branch${brRows.length === 1 ? '' : 'es'}`;
  const brHost = $('dash-branch-list');
  brHost.innerHTML = '';

  if (!brRows.length) {
    brHost.appendChild(mk('div', 'uich-empty', 'No Youth Centre students in this session'));
  } else {
    brRows.forEach((r) => {
      const row = mk('div', 'rc-hb');
      const top = mk('div', 'rc-hb-top');
      top.append(
        mk('span', 'rc-hb-name', r.label),
        mk('span', 'rc-hb-val', String(r.count))
      );
      const track = mk('div', 'rc-hb-track');
      const fill = document.createElement('i');
      fill.style.width = `${r.pct}%`;
      track.appendChild(fill);
      row.append(top, track);
      brHost.appendChild(row);
    });
    const note = mk('div', 'rc-total-note');
    note.append(
      mk('span', '', `Total across ${brRows.length} branch${brRows.length === 1 ? '' : 'es'}`),
      mk('b', '', `${d.totalBranchStudents} ${stuWord(d.totalBranchStudents)}`)
    );
    brHost.appendChild(note);
  }
}

function renderThreeDonuts(d) {
  $('dash-mode-receipts').textContent = `${d.kpis.feeCollection.receipts} ${rcptWord(d.kpis.feeCollection.receipts)}`;
  renderDonutChart($('dash-chart-modes'), {
    slices: d.modeSlices,
    centerLabel: 'Collected',
    centerValue: formatINR(d.totalCollected),
    valueFormatter: formatINR,
    emptyText: 'No payment receipts'
  });

  renderDonutChart($('dash-chart-ageing'), {
    slices: d.ageingSlices,
    centerLabel: 'Overdue',
    centerValue: formatINR(d.overdueTotal),
    valueFormatter: formatINR,
    emptyText: 'No overdue installments'
  });

  $('dash-course-count-note').textContent = `${d.totalCourseStudents} total`;
  renderDonutChart($('dash-chart-stu-course'), {
    slices: d.studentsByCourse,
    centerLabel: 'Students',
    centerValue: String(d.totalCourseStudents),
    maxLegendItems: 5,
    emptyText: 'No students in scope'
  });
}

function hydrateRecentAvatars() {
  if (!state || state.destroyed) return;
  const host = $('dash-recent-list');
  if (!host) return;
  host.querySelectorAll('.dash-recent-avatar[data-sid]').forEach((slot) => {
    const sid = slot.dataset.sid;
    if (!sid || slot.querySelector('img')) return;
    const src = getCachedStudentPhoto(sid);
    if (!src) return;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    slot.textContent = '';
    slot.appendChild(img);
  });
}

function renderTrend(d) {
  $('dash-trend-badge').textContent = d.useDailyTrend ? 'By day' : 'By month';
  const trendHost = $('dash-chart-trend');
  if (state.trendKind === 'bar') {
    renderBarChart(trendHost, {
      items: d.trendPoints,
      valueFormatter: formatINR,
      viewWidth: 640,
      height: 205,
      color: '#323A85',
      emptyText: 'No collections in selected period'
    });
  } else {
    renderLineChart(trendHost, {
      points: d.trendPoints,
      valueFormatter: formatINR,
      viewWidth: 640,
      height: 205,
      color: '#323A85',
      emptyText: 'No collections in selected period'
    });
  }
}

function renderRecentPayments(d) {
  const host = $('dash-recent-list');
  const recent = (d.recentPayments || []).slice(0, 5);
  host.innerHTML = '';

  if (!recent.length) {
    const pad = mk('div', 'dash-recent-pad');
    pad.appendChild(mk('div', 'uich-empty', 'No payment receipts recorded yet in this session'));
    host.appendChild(pad);
    return;
  }

  const missingPhotoIds = [];
  recent.forEach((entry) => {
    const btn = mk('button', 'dash-recent-row');
    btn.type = 'button';

    const left = mk('div', 'dash-recent-left');
    const avatar = mk('span', 'dash-recent-avatar');
    if (entry.studentDocId) avatar.dataset.sid = entry.studentDocId;

    const stName = formatPersonName(entry.studentName || '') || entry.studentName || 'Student';
    const cachedSrc = entry.studentDocId ? getCachedStudentPhoto(entry.studentDocId) : '';
    if (cachedSrc) {
      const img = document.createElement('img');
      img.src = cachedSrc;
      img.alt = stName;
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials(stName) || 'S';
      if (entry.studentDocId) missingPhotoIds.push(entry.studentDocId);
    }

    const info = mk('div', 'dash-recent-info');
    info.appendChild(mk('span', 'dash-recent-name', stName));

    const sub = mk('div', 'dash-recent-sub');
    const shortRcpt = formatShortReceipt(entry.receiptNo) || 'Receipt';
    sub.appendChild(mk('span', 'dash-recent-rcpt', shortRcpt));
    const dateTxt = entry.date ? fmtDate(entry.date) : '';
    const timeTxt = formatPaymentTimeIST(entry.createdAtSec);
    const dtDisplay = [dateTxt, timeTxt].filter(Boolean).join(' · ');
    if (dtDisplay) sub.appendChild(mk('span', '', dtDisplay));
    info.appendChild(sub);

    left.append(avatar, info);

    const right = mk('div', 'dash-recent-right');
    right.append(
      mk('span', 'dash-recent-amt', formatINR(entry.totalReceived || 0)),
      mk('span', `dash-recent-mode ${modeChipClass(entry)}`, modeDisplayMeta(entry).label)
    );

    btn.append(left, right);
    btn.addEventListener('click', () => {
      openPaymentDetailsModal(entry, { sessions: state?.sessions || [] });
    });
    host.appendChild(btn);
  });

  if (missingPhotoIds.length) {
    loadStudentPhotos(missingPhotoIds, state.pendingResult?.studentsById || null)
      .then(() => hydrateRecentAvatars())
      .catch(() => {});
  }
}

function computeAndRenderDashboard() {
  if (!state || state.destroyed) return;
  const scoped = scopeReferenceDataByCtx(state.meta || {}, 'youth');

  state.analytics = buildYouthDashboardData({
    entries: state.historyResult?.entries || [],
    pendingReport: state.pendingResult,
    activeSession: state.activeSession,
    branchesList: scoped.branchesList,
    coursesList: scoped.coursesList,
    batchesList: scoped.batchesList,
    branchesById: state.meta?.branchesById || scoped.branchesById,
    coursesById: state.meta?.coursesById || scoped.coursesById,
    batchesById: state.meta?.batchesById || scoped.batchesById,
    profile: state.profile,
    branchFilter: state.isBranchHead ? state.profile.branchId : state.branchFilter
  });

  updateHeaderUi();
  renderHeaderToolbar(state.analytics);
  renderKpis(state.analytics);
  renderFeeHeadsAndBranches(state.analytics);
  renderThreeDonuts(state.analytics);
  renderTrend(state.analytics);
  renderRecentPayments(state.analytics);
  paint();
}

function bindEvents() {
  const refreshBtn = $('dash-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      loadDashboardSources({ forceRefresh: true });
      updateArchiveReminder();
    });
  }

  const retryBtn = $('dash-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      loadDashboardSources({ forceRefresh: true });
    });
  }

  const lineBtn = $('dash-trend-btn-line');
  const barBtn = $('dash-trend-btn-bar');
  const setTrendKind = (kind) => {
    if (!state || state.trendKind === kind) return;
    state.trendKind = kind;
    lineBtn?.classList.toggle('is-active', kind === 'line');
    barBtn?.classList.toggle('is-active', kind === 'bar');
    if (state.analytics) {
      renderTrend(state.analytics);
      paint();
    }
  };
  if (lineBtn) lineBtn.addEventListener('click', () => setTrendKind('line'));
  if (barBtn) barBtn.addEventListener('click', () => setTrendKind('bar'));
}

function applyEarlyServerAggregates(agg) {
  if (!state || state.destroyed || state.analytics || !agg) return;
  state.earlyKpisPainted = true;
  const setKpi = (valId, subId, valText, subText, cls) => {
    const vEl = $(valId);
    const sEl = $(subId);
    if (vEl && valText != null) vEl.textContent = valText;
    if (sEl && subText != null) {
      sEl.textContent = subText;
      if (cls !== undefined) sEl.className = cls;
    }
  };
  if (Number.isFinite(agg.totalCount)) {
    setKpi('dash-kpi-admissions', 'dash-kpi-admissions-sub', agg.totalCount.toLocaleString('en-IN'), 'Session total · syncing...');
    if (Number.isFinite(agg.activeCount)) {
      setKpi('dash-kpi-active', 'dash-kpi-active-sub', agg.activeCount.toLocaleString('en-IN'), agg.activeCount === 0 ? 'No enrolled students' : 'Active in session');
    } else if (agg.totalCount === 0) {
      setKpi('dash-kpi-active', 'dash-kpi-active-sub', '0', 'No enrolled students');
    }
  }
  if (agg.hasCurrencySums) {
    setKpi('dash-kpi-outstanding', 'dash-kpi-outstanding-sub', formatINR(agg.balanceSum), 'Total balance across active');
    if (agg.hasMoneySum && !agg.missingMoneyCollected && !state.missingMoneyCollected) {
      const rate = agg.feeSum > 0 ? Math.min(100, Math.round((agg.moneySum / agg.feeSum) * 100)) : 0;
      setKpi('dash-kpi-collected', 'dash-kpi-collected-sub', formatINR(agg.moneySum), `${rate}% of ${formatINR(agg.feeSum)} billed`);
      setKpi('dash-kpi-rate', 'dash-kpi-rate-sub', `${rate}%`, `of ${formatINR(agg.feeSum)} total billed`);
      const bar = $('dash-kpi-rate-bar');
      if (bar) bar.style.width = `${rate}%`;
    } else {
      // Safety net prior to backfill: fall back to full ledger computation when any student lacks moneyCollected.
      setKpi('dash-kpi-collected', 'dash-kpi-collected-sub', '—', 'Syncing payment ledger...');
      setKpi('dash-kpi-rate', 'dash-kpi-rate-sub', '—', 'Syncing payment ledger...');
    }
  }
}

function applyEarlyStudentSnapshot(stRes) {
  if (!state || state.destroyed || state.analytics || !stRes?.list) return;
  const scoped = scopeReferenceDataByCtx(state.meta || {}, 'youth');
  const effBranch = state.isBranchHead ? state.profile.branchId : (state.branchFilter || 'all');
  const students = (stRes.list || []).filter((s) => (
    s && s.status !== 'deleted' && (effBranch === 'all' || s.branchId === effBranch)
  ));
  if (students.some((s) => s.moneyCollected == null)) {
    state.missingMoneyCollected = true;
    const colEl = $('dash-kpi-collected');
    const colSubEl = $('dash-kpi-collected-sub');
    const rateEl = $('dash-kpi-rate');
    const rateSubEl = $('dash-kpi-rate-sub');
    const rateBar = $('dash-kpi-rate-bar');
    if (colEl) colEl.textContent = '—';
    if (colSubEl) colSubEl.textContent = 'Syncing payment ledger...';
    if (rateEl) rateEl.textContent = '—';
    if (rateSubEl) rateSubEl.textContent = 'Syncing payment ledger...';
    if (rateBar) rateBar.style.width = '0%';
  }
  const nonDropped = students.filter((s) => s.status !== 'dropped' && s.status !== 'cancelled');
  const active = nonDropped.filter((s) => s.status === 'active');
  const sid = state.activeSession?.id || '';
  const batches = (scoped.batchesList || []).filter((b) => (
    b.sessionId === sid && (b.status || 'active') === 'active' && (effBranch === 'all' || b.branchId === effBranch)
  ));
  const nowYm = new Date().toISOString().slice(0, 7);
  const thisMonth = nonDropped.filter((s) => String(s.admissionDate || '').startsWith(nowYm)).length;

  state.earlyKpisPainted = true;
  const setKpi = (valId, subId, valText, subText) => {
    const vEl = $(valId);
    const sEl = $(subId);
    if (vEl && valText != null) vEl.textContent = valText;
    if (sEl && subText != null) sEl.textContent = subText;
  };
  setKpi('dash-kpi-active', 'dash-kpi-active-sub', String(active.length), `Across ${batches.length} ${batches.length === 1 ? 'batch' : 'batches'}`);
  setKpi('dash-kpi-admissions', 'dash-kpi-admissions-sub', String(nonDropped.length), `${thisMonth} this month`);
}

export function mount({ profile, ctx } = {}) {
  unmount();
  const activeCtx = ctx || 'youth';

  const youthShell = $('dash-youth-shell');
  const kidsShell = $('dash-kids-shell');

  if (activeCtx === 'school') {
    if (youthShell) youthShell.hidden = true;
    if (kidsShell) kidsShell.hidden = false;
    kidsDashDestroyed = false;

    const kidsEl = $('dash-kids-greeting');
    const updateKidsGreeting = () => {
      if (kidsEl) kidsEl.textContent = resolveGreetingText(profile);
    };
    updateKidsGreeting();
    profileListener = updateKidsGreeting;
    usersListener = updateKidsGreeting;
    window.addEventListener('uic:profile-updated', profileListener);
    window.addEventListener('uic:users-updated', usersListener);

    const breakCard = $('dash-kids-break-card');
    if (breakCard) breakCard.onclick = () => { location.hash = '#/school-break?filter=active'; };
    const overdueCard = $('dash-kids-break-overdue-card');
    if (overdueCard) overdueCard.onclick = () => { location.hash = '#/school-break?filter=overdue'; };

    const isSuper = profile?.role === 'superadmin';
    const setTxtEl = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };

    function paintKidsAggregates(agg) {
      if (!agg || kidsDashDestroyed) return;
      setTxtEl('dash-kids-students', String(agg.activeCount));
      setTxtEl('dash-kids-students-sub', `${agg.totalCount} total records`);
      setTxtEl('dash-kids-break', String(agg.onBreakCount));
      setTxtEl('dash-kids-break-sub', agg.onBreakCount ? `${agg.onBreakCount} paused (₹0 bills)` : 'None on break');
    }

    function paintKidsDashboardView({ dataset, histRes, today }) {
      if (kidsDashDestroyed || !dataset) return;
      const students = dataset.studentsList || [];
      const bills = dataset.bills || [];
      const breaks = dataset.breaks || [];

      // Exclude on-break, completed, ended, dropped from Active count (Rule 6)
      const activeKids = students.filter((s) => (s.status || 'active') === 'active');
      const onBreakKids = students.filter((s) => (s.status || 'active') === 'break');
      const ongoingBreakBySid = new Map();
      breaks.forEach((b) => {
        const st = String(b.status || '').toLowerCase();
        if ((st === 'active' || st === 'approved') && !b.actualReturnDate && !b.actualReturnMonth) {
          if (b.studentId) ongoingBreakBySid.set(b.studentId, b);
          if (b.studentCode) ongoingBreakBySid.set(b.studentCode, b);
        }
      });

      const breakRows = onBreakKids.map((s) => {
        const ab = ongoingBreakBySid.get(s.id) || (s.studentId ? ongoingBreakBySid.get(s.studentId) : null) || null;
        const startMonth = ab?.startMonth || s.breakFrom || '';
        const plannedEnd = ab?.plannedEndMonth || ab?.endMonth || s.breakTo || '';
        const overdue = isBreakOverdueReturn(ab || s, today);
        return { student: s, breakDoc: ab, startMonth, plannedEnd, reason: ab?.reason || s.breakReason || '-', overdue };
      }).sort((a, b) => (a.overdue === b.overdue ? String(a.plannedEnd).localeCompare(String(b.plannedEnd)) : (a.overdue ? -1 : 1)));

      const overdueCount = breakRows.filter((r) => r.overdue).length;
      const collectedTotal = (histRes?.entries || []).reduce((a, e) => a + Number(e.totalReceived || 0), 0);
      const pendingItems = evaluateKidsPendingBills({ students, bills, breaks, asOfDate: today })
        .filter((it) => it.status === 'due' || it.status === 'overdue');
      const pendingTotal = pendingItems.reduce((a, it) => a + Number(it.totalPayable || 0), 0);
      const overdueTotal = pendingItems.filter((it) => it.status === 'overdue').reduce((a, it) => a + Number(it.totalPayable || 0), 0);

      setTxtEl('dash-kids-students', String(activeKids.length));
      setTxtEl('dash-kids-students-sub', `${students.length} total records`);
      setTxtEl('dash-kids-break', String(onBreakKids.length));
      setTxtEl('dash-kids-break-sub', onBreakKids.length ? `${onBreakKids.length} paused (₹0 bills)` : 'None on break');
      setTxtEl('dash-kids-break-overdue', String(overdueCount));
      if (histRes) setTxtEl('dash-kids-collected', formatINR(collectedTotal));
      setTxtEl('dash-kids-dues', formatINR(pendingTotal));
      setTxtEl('dash-kids-overdue', formatINR(overdueTotal));

      const bodyEl = $('dash-kids-breaks-body');
      if (bodyEl) {
        if (!breakRows.length) {
          bodyEl.innerHTML = '<div class="empty-state"><i data-lucide="check-circle"></i><h3>No students currently on break</h3><p>All active Unique Kids students are following normal monthly billing.</p></div>';
        } else {
          const escK = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
          let html = '<div class="lp-scroll"><table class="lp-table"><thead><tr><th>Student ID</th><th>Student</th><th>Break Period</th><th>Status</th><th>Reason</th><th class="act">Action</th></tr></thead><tbody>';
          breakRows.forEach((r) => {
            const s = r.student;
            const period = formatBreakPeriod(r.startMonth, r.plannedEnd);
            const badge = r.overdue
              ? `<span class="adm-pill break-overdue">Ended - not rejoined (${escK(formatShortMonthYear(r.plannedEnd))})</span>`
              : `<span class="adm-pill break">On Break</span>`;
            html += `<tr><td><b>${escK(s.studentId || '-')}</b></td><td><a href="#/students/${encodeURIComponent(s.id)}">${escK(formatPersonName(s.name || '') || '-')}</a></td><td><strong>${escK(period)}</strong></td><td>${badge}</td><td>${escK(r.reason)}</td><td class="act">${isSuper ? `<button type="button" class="ui-btn ghost sm dk-resume-btn" data-sid="${escK(s.id)}"><i data-lucide="play-circle"></i><span>Resume</span></button>` : `<a class="ui-btn ghost sm" href="#/students/${encodeURIComponent(s.id)}">Profile</a>`}</td></tr>`;
          });
          html += '</tbody></table></div>';
          bodyEl.innerHTML = html;
          if (isSuper) {
            bodyEl.querySelectorAll('.dk-resume-btn').forEach((btn) => {
              btn.addEventListener('click', () => {
                const row = breakRows.find((x) => x.student.id === btn.dataset.sid);
                if (!row) return;
                openKidsResumeBreakModal({
                  student: row.student,
                  breakDoc: row.breakDoc,
                  profile,
                  onSuccess: () => {
                    window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'break:resume' } }));
                    return loadKidsDashboard({ forceRefresh: false });
                  }
                });
              });
            });
          }
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }

    let kidsFullPainted = false;
    async function loadKidsDashboard({ forceRefresh = false, deltaRefresh = false, background = false } = {}) {
      if (kidsDashDestroyed) return;
      const today = localToday();
      const bodyEl = $('dash-kids-breaks-body');

      if (!forceRefresh && !deltaRefresh && !background) {
        const cachedDs = getCachedKidsDataset();
        const cachedHist = getCachedKidsHistory();
        if (cachedDs && cachedHist) {
          kidsFullPainted = true;
          paintKidsDashboardView({ dataset: cachedDs, histRes: cachedHist, today });
          if (isCacheStale(cachedDs) || isCacheStale(cachedHist) || cachedDs.billsSyncedAsOf !== today) {
            loadKidsDashboard({ deltaRefresh: true, background: true }).catch(() => {});
          }
          return;
        }
        if (cachedDs) {
          paintKidsDashboardView({ dataset: cachedDs, histRes: null, today });
        } else if (bodyEl) {
          bodyEl.innerHTML = '';
        }
      }

      let skelTask = null;
      if (!background && !kidsFullPainted && !getCachedKidsDataset()) {
        skelTask = scheduleDelayedSkeleton(() => {
          if (!kidsDashDestroyed && !kidsFullPainted && bodyEl) {
            bodyEl.innerHTML = '<div class="empty-state"><i data-lucide="loader"></i><h3>Loading Unique Kids overview...</h3></div>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
          }
        }, 300);
      }

      try {
        if (!background && !kidsFullPainted && !getCachedKidsDataset()) {
          loadKidsDashboardServerAggregates({ profile }).then((agg) => {
            if (!kidsDashDestroyed && agg && !kidsFullPainted) paintKidsAggregates(agg);
          }).catch(() => {});
        }

        const [dataset, histRes] = await Promise.all([
          deltaRefresh
            ? syncKidsDatasetDelta({ profile, syncOpenBills: true })
            : ensureKidsDataset({ profile, forceRefresh, syncOpenBills: true }),
          loadKidsPaymentHistory({ profile, forceRefresh, deltaRefresh }).catch(() => null)
        ]);
        if (skelTask) skelTask.cancel();
        if (kidsDashDestroyed) return;

        kidsFullPainted = true;
        paintKidsDashboardView({ dataset, histRes, today });
      } catch (err) {
        if (skelTask) skelTask.cancel();
        if (!background) console.warn('[dashboard-kids] load failed:', err);
      }
    }

    kidsDataMutatedListener = () => {
      if (!kidsDashDestroyed) loadKidsDashboard({ forceRefresh: false });
    };
    window.addEventListener('uic:data-mutated', kidsDataMutatedListener);
    loadKidsDashboard();
    paint();
    return;
  }

  if (kidsShell) kidsShell.hidden = true;
  if (youthShell) youthShell.hidden = false;

  const isSuper = profile?.role === 'superadmin';
  const isBranchHead = profile?.role === 'branch_head' && !!profile?.branchId;

  if (!isSuper && !isBranchHead) {
    const denied = $('dash-access-denied');
    const content = $('dash-youth-content');
    if (denied) denied.hidden = false;
    if (content) content.hidden = true;
    paint();
    return;
  }

  state = {
    ctx: 'youth',
    profile,
    isSuper,
    isBranchHead,
    branchFilter: isBranchHead ? profile.branchId : 'all',
    branchSelect: null,
    trendKind: 'line',
    meta: null,
    sessions: [],
    activeSession: null,
    historyResult: null,
    pendingResult: null,
    analytics: null,
    destroyed: false
  };

  syncBranchFilterControl();
  renderHeaderToolbar(null);
  updateHeaderUi();
  bindEvents();
  updateArchiveReminder();
  if (!state.analytics) {
    const preSessId = getSelectedSessionId('youth');
    if (preSessId) {
      loadYouthDashboardServerAggregates({
        profile,
        session: { id: preSessId },
        branchFilter: state.branchFilter
      }).then((agg) => applyEarlyServerAggregates(agg)).catch(() => {});
    }
  }
  loadDashboardSources({ forceRefresh: false });

  profileListener = () => updateHeaderUi();
  usersListener = () => {
    updateHeaderUi();
    if (state?.analytics) computeAndRenderDashboard();
  };
  sessionSelListener = (ev) => {
    if (!state || state.destroyed) return;
    if (ev?.detail?.ctx && ev.detail.ctx !== 'youth') return;
    if (!state.analytics) {
    const preSessId = getSelectedSessionId('youth');
    if (preSessId) {
      loadYouthDashboardServerAggregates({
        profile,
        session: { id: preSessId },
        branchFilter: state.branchFilter
      }).then((agg) => applyEarlyServerAggregates(agg)).catch(() => {});
    }
  }
  loadDashboardSources({ forceRefresh: false });
  };
  sessionsLoadedListener = (ev) => {
    if (!state || state.destroyed) return;
    if (ev?.detail?.ctx && ev.detail.ctx !== 'youth') return;
    if (!state.analytics) {
    const preSessId = getSelectedSessionId('youth');
    if (preSessId) {
      loadYouthDashboardServerAggregates({
        profile,
        session: { id: preSessId },
        branchFilter: state.branchFilter
      }).then((agg) => applyEarlyServerAggregates(agg)).catch(() => {});
    }
  }
  loadDashboardSources({ forceRefresh: false });
  };
  sessionsChangedListener = () => {
    if (!state || state.destroyed) return;
    if (!state.analytics) {
    const preSessId = getSelectedSessionId('youth');
    if (preSessId) {
      loadYouthDashboardServerAggregates({
        profile,
        session: { id: preSessId },
        branchFilter: state.branchFilter
      }).then((agg) => applyEarlyServerAggregates(agg)).catch(() => {});
    }
  }
  loadDashboardSources({ forceRefresh: false });
  };

  window.addEventListener('uic:profile-updated', profileListener);
  window.addEventListener('uic:users-updated', usersListener);
  window.addEventListener('uic:session-selected', sessionSelListener);
  window.addEventListener('uic:sessions-loaded', sessionsLoadedListener);
  window.addEventListener('uic:sessions-changed', sessionsChangedListener);
}

export function unmount() {
  kidsDashDestroyed = true;
  if (state) state.destroyed = true;
  if (kidsDataMutatedListener) {
    window.removeEventListener('uic:data-mutated', kidsDataMutatedListener);
    kidsDataMutatedListener = null;
  }
  if (profileListener) {
    window.removeEventListener('uic:profile-updated', profileListener);
    profileListener = null;
  }
  if (usersListener) {
    window.removeEventListener('uic:users-updated', usersListener);
    usersListener = null;
  }
  if (sessionSelListener) {
    window.removeEventListener('uic:session-selected', sessionSelListener);
    sessionSelListener = null;
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
