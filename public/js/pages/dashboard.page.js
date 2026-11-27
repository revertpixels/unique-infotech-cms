// dashboard.page.js — Read-only Youth Centre Dashboard (#/dashboard) + preserved Unique Kids placeholder.

import { ROUTES } from '../core/router.js?v=1.8.184';
import { createSelect } from '../components/ui-select.js?v=1.8.184';
import {
  renderDonutChart,
  renderBarChart,
  renderStackedBarChart,
  renderLineChart
} from '../components/charts.js?v=1.8.184';
import { openPaymentDetailsModal } from '../components/payment-details-modal.js?v=1.8.184';
import { loadDashboardArchiveReminder } from '../services/archive.service.js?v=1.8.184';
import { resolveUserDisplay, getRoleTitle } from '../services/user-directory.service.js?v=1.8.184';
import { getCachedSessions, loadSessions, getSelectedSession } from '../core/sessions.js?v=1.8.184';
import { getOrgTimezone } from '../utils/session-rules.js?v=1.8.184';
import { formatPersonName, initials } from '../utils/formatter.js?v=1.8.184';
import { buildYouthDashboardData } from '../services/dashboard.service.js?v=1.8.184';
import {
  ensureReferenceData,
  scopeReferenceDataByCtx,
  loadYouthPaymentHistory,
  loadYouthPendingReport,
  loadStudentPhotos,
  getCachedStudentPhoto,
  formatShortReceipt,
  modeDisplayMeta,
  formatINR,
  fmtDate
} from '../services/report.service.js?v=1.8.184';

let state = null;
let profileListener = null;
let usersListener = null;
let sessionSelListener = null;
let sessionsLoadedListener = null;
let sessionsChangedListener = null;

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
  try {
    const rem = await loadDashboardArchiveReminder({ profile: state.profile });
    if (!state || state.destroyed || !remHost) return;
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
  if (!wrap || !host || !lockedEl) return;

  const scoped = scopeReferenceDataByCtx(state.meta || {}, 'youth');
  const branches = scoped.branchesList || [];

  if (state.isBranchHead) {
    wrap.hidden = false;
    host.hidden = true;
    host.innerHTML = '';
    state.branchSelect = null;
    const br = state.meta?.branchesById?.[state.profile.branchId] || branches.find((b) => b.id === state.profile.branchId) || {};
    if (lockedNameEl) lockedNameEl.textContent = br.name || br.code || state.profile.branchId;
    lockedEl.hidden = false;
    paint();
    return;
  }

  if (!state.isSuper) {
    wrap.hidden = true;
    return;
  }

  wrap.hidden = false;
  lockedEl.hidden = true;
  host.hidden = false;

  const options = [
    { value: 'all', label: 'All branches', icon: 'git-branch' },
    ...branches.map((b) => ({
      value: b.id,
      label: b.code ? `${b.code} - ${b.name || b.id}` : (b.name || b.id),
      icon: 'map-pin'
    }))
  ];

  if (!state.branchSelect) {
    host.innerHTML = '';
    state.branchSelect = createSelect(host, {
      options,
      value: state.branchFilter,
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

function renderQuickActions(d = null) {
  const host = $('dash-quick-links');
  const sec = $('dash-quick-sec');
  if (!host || !sec || !state) return;

  const pendingCnt = d ? Number(d.kpis?.overdueFees?.studentCount || 0) : null;

  const definitions = [
    { key: 'students', label: 'Admissions', href: '#/students', tone: 'is-purple', icon: 'user-plus' },
    { key: 'pay-fees', label: 'Pay Fees', href: '#/pay-fees', tone: 'is-green', icon: 'wallet' },
    {
      key: 'pending',
      label: 'Pending & Overdue',
      href: '#/pending',
      tone: 'is-red',
      icon: 'alarm-clock',
      badge: pendingCnt && pendingCnt > 0 ? String(pendingCnt) : ''
    },
    { key: 'payments', label: 'Payment History', href: '#/payments', tone: 'is-blue', icon: 'history' },
    { key: 'reports', label: 'Reports', href: '#/reports', tone: 'is-teal', icon: 'bar-chart-3' },
    { key: 'archives', label: 'Archives', href: '#/archives', tone: 'is-amber', icon: 'archive' }
  ];

  const role = state.profile?.role || '';
  const visible = definitions.filter((item) => {
    const r = ROUTES[item.key];
    return r && (!Array.isArray(r.roles) || r.roles.includes(role));
  });

  if (!visible.length) {
    sec.hidden = true;
    host.innerHTML = '';
    return;
  }

  sec.hidden = false;
  host.innerHTML = '';
  visible.forEach((item) => {
    const r = ROUTES[item.key];
    const a = mk('a', `dash-qbtn ${item.tone}`);
    a.href = item.href;

    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', item.icon || r?.icon || 'arrow-right');
    ic.setAttribute('aria-hidden', 'true');
    a.append(ic, mk('span', 'dash-qbtn-lbl', item.label));

    if (item.badge) {
      a.appendChild(mk('span', 'dash-qbtn-badge', item.badge));
    }
    host.appendChild(a);
  });
}

function resolveActiveSession() {
  const cached = getSelectedSession('youth');
  if (cached && state.sessions.some((s) => s.id === cached.id)) return cached;
  return state.sessions.find((s) => s.isCurrent) || state.sessions[0] || null;
}

async function loadDashboardSources({ forceRefresh = false } = {}) {
  if (!state || state.destroyed) return;
  const errBox = $('dash-error');
  if (errBox) errBox.hidden = true;

  const refreshBtn = $('dash-refresh');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spin');
  }

  const cacheRoot = window.APP_CACHE?.financialReports;
  const hasWarmCache = !forceRefresh && Boolean(cacheRoot?.meta && cacheRoot?.youthHistory?.size && cacheRoot?.youthPending?.size);
  if (!hasWarmCache) showYouthSkeletons();

  try {
    const [meta, sessions] = await Promise.all([
      ensureReferenceData({ forceRefresh, profile: state.profile }),
      (!forceRefresh && getCachedSessions('youth').length)
        ? Promise.resolve(getCachedSessions('youth'))
        : loadSessions('youth')
    ]);
    if (!state || state.destroyed) return;

    state.meta = meta;
    state.sessions = sessions || [];
    state.activeSession = resolveActiveSession();

    updateHeaderUi();
    syncBranchFilterControl();

    if (!state.activeSession) {
      toggleNoSessionState(true);
      return;
    }

    toggleNoSessionState(false);

    const [histRes, pendRes] = await Promise.all([
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
      })
    ]);
    if (!state || state.destroyed) return;

    state.historyResult = histRes;
    state.pendingResult = pendRes;

    computeAndRenderDashboard();
  } catch (err) {
    if (!state || state.destroyed) return;
    console.error('[dashboard] load failed', err);
    showYouthError(err);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spin');
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
  renderQuickActions(state.analytics);
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

export function mount({ profile, ctx } = {}) {
  unmount();
  const activeCtx = ctx || 'youth';

  const youthShell = $('dash-youth-shell');
  const kidsShell = $('dash-kids-shell');

  if (activeCtx === 'school') {
    if (youthShell) youthShell.hidden = true;
    if (kidsShell) kidsShell.hidden = false;

    const kidsEl = $('dash-kids-greeting');
    const updateKidsGreeting = () => {
      if (kidsEl) kidsEl.textContent = resolveGreetingText(profile);
    };
    updateKidsGreeting();
    profileListener = updateKidsGreeting;
    usersListener = updateKidsGreeting;
    window.addEventListener('uic:profile-updated', profileListener);
    window.addEventListener('uic:users-updated', usersListener);
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

  renderQuickActions(null);
  updateHeaderUi();
  bindEvents();
  updateArchiveReminder();
  loadDashboardSources({ forceRefresh: false });

  profileListener = () => updateHeaderUi();
  usersListener = () => {
    updateHeaderUi();
    if (state?.analytics) computeAndRenderDashboard();
  };
  sessionSelListener = (ev) => {
    if (!state || state.destroyed) return;
    if (ev?.detail?.ctx && ev.detail.ctx !== 'youth') return;
    loadDashboardSources({ forceRefresh: false });
  };
  sessionsLoadedListener = (ev) => {
    if (!state || state.destroyed) return;
    if (ev?.detail?.ctx && ev.detail.ctx !== 'youth') return;
    loadDashboardSources({ forceRefresh: false });
  };
  sessionsChangedListener = () => {
    if (!state || state.destroyed) return;
    loadDashboardSources({ forceRefresh: false });
  };

  window.addEventListener('uic:profile-updated', profileListener);
  window.addEventListener('uic:users-updated', usersListener);
  window.addEventListener('uic:session-selected', sessionSelListener);
  window.addEventListener('uic:sessions-loaded', sessionsLoadedListener);
  window.addEventListener('uic:sessions-changed', sessionsChangedListener);
}

export function unmount() {
  if (state) state.destroyed = true;
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
