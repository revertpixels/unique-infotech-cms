// school-break.page.js — Unique Kids Break Management (Super Admin: full; School Head: view-only).
// Whole-month planned breaks, searchable "+ Start break", Extend break (future months only),
// Resume / Rejoin, tabs, month & status filters, Print/CSV export, and shared dataset caching.

import { showToast } from '../components/toast.js?v=1.8.201';
import { PAGE_SIZE, buildStats, buildToolbar, renderPager } from '../components/list-page.js?v=1.8.201';
import { formatDateIN, formatPersonName } from '../utils/formatter.js?v=1.8.201';
import { localToday } from '../utils/school-lifecycle.js?v=1.8.201';
import {
  ymRange,
  formatBreakPeriod,
  formatShortMonthYear,
  isBreakOverdueReturn
} from '../utils/school-billing.js?v=1.8.201';
import {
  openKidsStartBreakModal,
  openKidsResumeBreakModal,
  openKidsExtendBreakModal
} from '../utils/school-break-modals.js?v=1.8.201';
import { getRoleTitle, resolveUserDisplay } from '../services/user-directory.service.js?v=1.8.201';
import {
  ensureReferenceData,
  getCachedReferenceData,
  ensureKidsDataset,
  getCachedKidsDataset,
  syncKidsDatasetDelta,
  isCacheStale,
  scheduleDelayedSkeleton,
  downloadCsv,
  openPrintSheet
} from '../services/report.service.js?v=1.8.201';

let cleanupPage = null;
export function unmount() { if (cleanupPage) cleanupPage(); cleanupPage = null; }

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-break] missing #' + id); return el; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

function isOngoingBreak(br) {
  const st = String(br?.status || '').toLowerCase().trim();
  return (st === 'active' || st === 'approved') && !br.actualReturnDate && !br.actualReturnMonth;
}

function getBreakMonths(br) {
  const from = String(br?.startMonth || '').slice(0, 7);
  const to = String(br?.plannedEndMonth || br?.endMonth || from).slice(0, 7);
  if (!from || !to) return [];
  return ymRange(from, to);
}

function isRejoinedThisMonth(br, curYM) {
  if (isOngoingBreak(br) || String(br?.status || '').toLowerCase() !== 'completed') return false;
  const retM = String(br.actualReturnMonth || '').slice(0, 7);
  const resM = String(br.resumedAtISO || '').slice(0, 7);
  return retM === curYM || resM === curYM;
}

function statusLabelOf(br, asOfDate) {
  if (isOngoingBreak(br)) {
    return isBreakOverdueReturn(br, asOfDate) ? 'Break ended - not rejoined' : 'On break';
  }
  const st = String(br?.status || '').toLowerCase();
  if (st === 'completed') return 'Rejoined';
  if (st === 'rejected') return 'Rejected';
  return st || 'Completed';
}

function statusPill(br, asOfDate) {
  if (isOngoingBreak(br)) {
    if (isBreakOverdueReturn(br, asOfDate)) {
      return '<span class="uk-pill overdue">Ended - not rejoined</span>';
    }
    return '<span class="uk-pill break">On Break</span>';
  }
  const st = String(br?.status || '').toLowerCase();
  if (st === 'completed') return '<span class="uk-pill active">Rejoined</span>';
  if (st === 'rejected') return '<span class="uk-pill inactive">Rejected</span>';
  return '<span class="uk-pill completed">' + esc(st || 'Completed') + '</span>';
}

function formatStartedByLabel(b) {
  const startWho = b.startedBy || b.requestedBy || b.approvedBy || '';
  const startDisp = startWho ? resolveUserDisplay(startWho, b.startedByName, b.startedByDesignation) : null;
  return (startDisp && startDisp.name && startDisp.name !== '-') ? startDisp.name : (startWho || '-');
}

function formatAuditCell(b) {
  const startLabel = formatStartedByLabel(b);
  const startWhen = b.startedAtISO ? formatDateIN(b.startedAtISO.slice(0, 10)) : '';

  const lines = [`<div><span class="skb-audit-lbl">Started:</span> ${esc(startLabel)}${startWhen ? ' (' + esc(startWhen) + ')' : ''}</div>`];
  if (b.extendedBy && b.extendedAtISO) {
    const extDisp = resolveUserDisplay(b.extendedBy, b.extendedByName, b.extendedByDesignation);
    const extLbl = extDisp?.name && extDisp.name !== '-' ? extDisp.name : b.extendedBy;
    lines.push(`<div><span class="skb-audit-lbl">Extended:</span> ${esc(extLbl)} (${esc(formatDateIN(b.extendedAtISO.slice(0, 10)))})</div>`);
  }
  if (b.resumedBy || b.actualReturnDate) {
    const resWho = b.resumedBy || '';
    const resDisp = resWho ? resolveUserDisplay(resWho, b.resumedByName, b.resumedByDesignation) : null;
    const resLabel = resDisp && resDisp.name && resDisp.name !== '-' ? resDisp.name : (resWho || '-');
    const resWhen = b.resumedAtISO ? formatDateIN(b.resumedAtISO.slice(0, 10)) : '';
    lines.push(`<div><span class="skb-audit-lbl">Resumed:</span> ${esc(resLabel)}${resWhen ? ' (' + esc(resWhen) + ')' : ''}</div>`);
  }
  return lines.join('');
}

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  if (!school) {
    showToast({ type: 'error', message: 'Break management is only available in Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';
  const isHead = profile && profile.role === 'school_head';
  if (!isSuper && !isHead) {
    showToast({ type: 'error', message: `Break management is restricted to ${getRoleTitle('superadmin')} and ${getRoleTitle('school_head')}.` });
    return;
  }

  const rowsHost = $('skb-rows');
  const emptyEl = $('skb-empty');
  const loadingEl = $('skb-loading');
  const noMatchEl = $('skb-no-match');
  const loadErrorEl = $('skb-load-error');
  const loadErrorMsg = $('skb-load-error-msg');
  const footEl = $('skb-foot');
  const addBtn = $('skb-add');
  const exportCsvBtn = $('skb-export-csv');
  const printBtn = $('skb-print');
  if (!rowsHost || !emptyEl || !loadingEl || !noMatchEl || !loadErrorEl) return;

  if (addBtn) addBtn.hidden = !isSuper;

  const qStr = (location.hash.split('?')[1] || '');
  const hashParams = new URLSearchParams(qStr);
  const initialFilter = ['active', 'overdue', 'completed', 'all'].includes(hashParams.get('filter'))
    ? hashParams.get('filter')
    : 'all';

  // ---------- tabs & status sync ----------
  let activeTab = initialFilter;
  const tabButtons = {
    active: $('skb-tab-active'),
    overdue: $('skb-tab-overdue'),
    completed: $('skb-tab-completed'),
    all: $('skb-tab-all')
  };

  function syncTabButtons(val) {
    Object.entries(tabButtons).forEach(([key, btn]) => {
      if (!btn) return;
      const isAct = key === val;
      btn.classList.toggle('is-active', isAct);
      btn.setAttribute('aria-selected', String(isAct));
    });
  }

  // ---------- toolbar ----------
  const tbFilters = [
    {
      id: 'month', label: 'Month', options: [
        { value: 'all', label: 'All months', icon: 'calendar' }
      ]
    },
    {
      id: 'status', label: 'Status', options: [
        { value: 'all', label: 'All breaks' },
        { value: 'active', label: 'On break' },
        { value: 'overdue', label: 'Break ended - not rejoined' },
        { value: 'completed', label: 'Rejoined (history)' }
      ]
    }
  ];
  const tb = buildToolbar({
    placeholder: 'Search student name, ID, phone or reason',
    filters: tbFilters,
    onChange: (state) => {
      const nextSt = state?.status || 'all';
      if (nextSt !== activeTab) {
        activeTab = nextSt;
        syncTabButtons(activeTab);
      }
      page = 1;
      render();
    },
    onRefresh: () => load({ forceRefresh: true })
  });
  tb.setFilterValue('status', initialFilter);
  syncTabButtons(activeTab);
  const tbHost = $('skb-toolbar');
  if (tbHost) { tbHost.innerHTML = ''; tb.el.classList.add('skb-toolbar-row'); tbHost.appendChild(tb.el); }

  Object.entries(tabButtons).forEach(([key, btn]) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      activeTab = key;
      syncTabButtons(key);
      tb.setFilterValue('status', key);
      page = 1;
      render();
    });
  });

  // ---------- stats (On break, Not rejoined, Rejoined this month, Total records) ----------
  const stats = buildStats([
    { label: 'On break', value: 0, sub: 'Currently paused', icon: 'pause-circle', tone: 'amber' },
    { label: 'Not rejoined', value: 0, sub: 'Break ended - follow up', icon: 'alert-circle', tone: 'red' },
    { label: 'Rejoined this month', value: 0, sub: 'Total history: 0', icon: 'play-circle', tone: 'green' },
    { label: 'Total records', value: 0, sub: 'All recorded breaks', icon: 'history', tone: 'indigo' }
  ]);
  const statsHost = $('skb-stats');
  if (statsHost) {
    statsHost.appendChild(stats.el);
    const statCards = stats.el.querySelectorAll('.lp-stat');
    const cardTabMap = ['active', 'overdue', 'completed', 'all'];
    statCards.forEach((card, idx) => {
      card.classList.add('clickable');
      card.addEventListener('click', () => {
        const t = cardTabMap[idx] || 'all';
        activeTab = t;
        syncTabButtons(t);
        tb.setFilterValue('status', t);
        page = 1;
        render();
      });
    });
  }

  // ---------- state ----------
  let breaks = [];
  let students = [];
  let cachedMeta = null;
  let lastFilteredList = [];
  let page = 1;
  let alive = true;

  function resolveStudentForBreak(b) {
    return students.find((x) => x.id === b.studentId || (b.studentCode && x.studentId === b.studentCode) || (x.studentId && x.studentId === b.studentId)) || null;
  }

  function setLoading(isLoading) {
    loadingEl.hidden = !isLoading;
    rowsHost.hidden = isLoading;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;
    footEl.hidden = true;
  }

  function setError(msg) {
    loadingEl.hidden = true;
    rowsHost.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = false;
    if (loadErrorMsg) loadErrorMsg.textContent = msg;
    footEl.hidden = true;
  }

  function applyDataset(dataset, meta = null) {
    if (meta) cachedMeta = meta;
    students = (dataset?.studentsList || []).filter((s) => s.status !== 'deleted');
    const rawBreaks = (dataset?.breaks || []).map((b) => ({ ...b }));

    // Include any student marked status='break' without a break doc (legacy fallback)
    const hasActiveBreakDoc = new Set();
    rawBreaks.forEach((b) => {
      if (isOngoingBreak(b)) {
        if (b.studentId) hasActiveBreakDoc.add(b.studentId);
        if (b.studentCode) hasActiveBreakDoc.add(b.studentCode);
      }
    });
    students.forEach((s) => {
      if ((s.status || '').toLowerCase() === 'break' && !hasActiveBreakDoc.has(s.id) && !hasActiveBreakDoc.has(s.studentId)) {
        rawBreaks.push({
          id: 'legacy-' + s.id,
          ctx: 'school',
          studentId: s.id,
          studentCode: s.studentId || '',
          studentName: s.name || '',
          startMonth: s.breakFrom || '',
          endMonth: s.breakTo || '',
          plannedEndMonth: s.breakTo || '',
          reason: s.breakReason || 'Student break',
          status: 'active',
          startedBy: s.breakStartedBy || '',
          _synthetic: true
        });
      }
    });

    rawBreaks.sort((a, b) => {
      const ao = isOngoingBreak(a) ? 0 : 1;
      const bo = isOngoingBreak(b) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return String(b.startMonth || '').localeCompare(String(a.startMonth || ''));
    });
    breaks = rawBreaks;

    // Populate Month filter with every covered break month
    const monthSet = new Set();
    breaks.forEach((br) => {
      getBreakMonths(br).forEach((m) => monthSet.add(m));
    });
    const months = Array.from(monthSet).sort().reverse();
    tb.setFilterOptions('month', [{ value: 'all', label: 'All months', icon: 'calendar' }].concat(
      months.map((m) => ({ value: m, label: formatShortMonthYear(m) || m, icon: 'calendar' }))
    ));

    render();
  }

  async function load({ forceRefresh = false, deltaRefresh = false, background = false } = {}) {
    if (!forceRefresh && !deltaRefresh) {
      const refMeta = getCachedReferenceData(profile);
      const cachedDs = getCachedKidsDataset();
      if (cachedDs) {
        applyDataset(cachedDs, refMeta);
        if (!background && (isCacheStale(cachedDs) || !refMeta)) {
          load({ deltaRefresh: true, background: true }).catch(() => {});
        }
        return;
      }
    }

    const skelTask = (!background && !breaks.length)
      ? scheduleDelayedSkeleton(() => {
        if (alive && !breaks.length) setLoading(true);
      }, 300)
      : null;

    try {
      const [meta, dataset] = await Promise.all([
        ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile }).catch(() => cachedMeta),
        deltaRefresh
          ? syncKidsDatasetDelta({ profile })
          : ensureKidsDataset({ profile, forceRefresh })
      ]);
      if (skelTask) skelTask.cancel();
      if (!alive) return;
      if (!background || !deltaRefresh || !dataset.deltaUsed || dataset.changedCount !== 0) {
        applyDataset(dataset, meta);
      }
    } catch (e) {
      if (skelTask) skelTask.cancel();
      if (!background && alive) {
        console.error('[school-break] load failed', e);
        setError('Could not load breaks (' + (e.code || 'error') + ').');
      }
    }
  }

  const onMutated = () => { if (alive) load({ forceRefresh: false }); };
  window.addEventListener('uic:data-mutated', onMutated);
  cleanupPage = () => {
    alive = false;
    window.removeEventListener('uic:data-mutated', onMutated);
  };

  function getFilteredList(today) {
    const f = tb.state || {};
    const statusFilter = f.status || activeTab || 'all';
    const monthFilter = f.month || 'all';
    const q = (f.q || '').toLowerCase().trim();

    return breaks.filter((b) => {
      if (statusFilter === 'active' && !isOngoingBreak(b)) return false;
      if (statusFilter === 'overdue' && !isBreakOverdueReturn(b, today)) return false;
      if (statusFilter === 'completed' && (isOngoingBreak(b) || String(b.status || '').toLowerCase() !== 'completed')) return false;
      if (monthFilter && monthFilter !== 'all') {
        const covered = getBreakMonths(b);
        if (!covered.includes(monthFilter) && b.startMonth !== monthFilter && (b.plannedEndMonth || b.endMonth) !== monthFilter) {
          return false;
        }
      }
      if (q) {
        const s = resolveStudentForBreak(b) || {};
        const hay = [
          s.name || b.studentName || '',
          s.studentId || b.studentCode || b.studentId || '',
          s.phone || '',
          b.reason || ''
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function render() {
    if (!rowsHost) return;
    rowsHost.hidden = false;
    rowsHost.innerHTML = '';
    loadingEl.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;

    const today = localToday();
    const curYM = today.slice(0, 7);
    const ongoingList = breaks.filter((b) => isOngoingBreak(b));
    const overdueList = ongoingList.filter((b) => isBreakOverdueReturn(b, today));
    const completedList = breaks.filter((b) => !isOngoingBreak(b) && String(b.status || '').toLowerCase() === 'completed');
    const rejoinedThisMonthList = breaks.filter((b) => isRejoinedThisMonth(b, curYM));

    stats.update(0, ongoingList.length, overdueList.length ? `${overdueList.length} ended - not rejoined` : 'Currently paused');
    stats.update(1, overdueList.length);
    stats.update(2, rejoinedThisMonthList.length, `Total history: ${completedList.length}`);
    stats.update(3, breaks.length);

    const setTabCount = (id, n) => { const el = $(id); if (el) el.textContent = String(n); };
    setTabCount('skb-tab-cnt-active', ongoingList.length);
    setTabCount('skb-tab-cnt-overdue', overdueList.length);
    setTabCount('skb-tab-cnt-completed', completedList.length);
    setTabCount('skb-tab-cnt-all', breaks.length);

    const list = getFilteredList(today);
    lastFilteredList = list;

    if (breaks.length === 0) {
      emptyEl.hidden = false;
      footEl.hidden = true;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    if (!list.length) {
      noMatchEl.hidden = false;
      footEl.hidden = true;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const pageList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    pageList.forEach((b) => {
      const s = resolveStudentForBreak(b);
      const docId = s?.id || b.studentId || '';
      const dispName = formatPersonName(s?.name || b.studentName || '') || '-';
      const dispId = s?.studentId || b.studentCode || '-';
      const endYM = b.plannedEndMonth || b.endMonth || b.startMonth;
      const period = formatBreakPeriod(b.startMonth, endYM);
      const monthsCount = getBreakMonths(b).length || 1;
      const returnSub = b.actualReturnDate
        ? `Returned: ${formatDateIN(b.actualReturnDate)}${b.endedEarly ? ' (Early)' : ''}`
        : (isBreakOverdueReturn(b, today)
          ? `<span class="text-danger font-semibold">Ended ${esc(formatShortMonthYear(endYM))} — awaiting rejoin</span>`
          : '');

      const tr = document.createElement('tr');
      const canManage = isSuper && isOngoingBreak(b) && s;
      tr.innerHTML =
        `<td class="sk-id"><b>${esc(dispId)}</b></td>` +
        `<td><a class="skb-student-link" href="#/students/${encodeURIComponent(docId)}">${esc(dispName)}</a>` +
        (s?.phone ? `<div class="skb-sub">${esc(s.phone)}</div>` : '') +
        `</td>` +
        `<td><strong>${esc(period)}</strong>` +
        (returnSub ? `<div class="skb-sub">${returnSub}</div>` : '') +
        `</td>` +
        `<td><span class="skb-months-badge">${monthsCount} mo</span></td>` +
        `<td>${esc(b.reason || '-')}</td>` +
        `<td>${statusPill(b, today)}</td>` +
        `<td class="skb-audit">${formatAuditCell(b)}</td>` +
        `<td class="skb-actions">` +
        (canManage ? `<button type="button" class="sk-act approve skb-resume" data-id="${esc(b.id)}" title="Resume / Rejoin"><i data-lucide="play-circle"></i><span>Resume</span></button>` : '') +
        (canManage ? `<button type="button" class="sk-act extend skb-extend" data-id="${esc(b.id)}" title="Extend break"><i data-lucide="calendar-plus"></i><span>Extend</span></button>` : '') +
        (docId ? `<a class="sk-act view" href="#/students/${encodeURIComponent(docId)}" title="View profile"><i data-lucide="user"></i><span>Profile</span></a>` : '') +
        `</td>`;
      rowsHost.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (footEl) {
      footEl.hidden = list.length === 0;
      renderPager(footEl, {
        page,
        pageSize: PAGE_SIZE,
        totalItems: list.length,
        showWhenSingle: true,
        onPageChange: (next) => { page = next; render(); }
      });
    }

    rowsHost.querySelectorAll('.skb-resume').forEach((btn) => {
      btn.addEventListener('click', () => {
        const br = breaks.find((x) => x.id === btn.dataset.id);
        const st = br ? resolveStudentForBreak(br) : null;
        if (!br || !st) return;
        openKidsResumeBreakModal({
          student: st,
          breakDoc: br._synthetic ? null : br,
          profile,
          onSuccess: () => {
            window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'break:resume' } }));
            return load();
          }
        });
      });
    });

    rowsHost.querySelectorAll('.skb-extend').forEach((btn) => {
      btn.addEventListener('click', () => {
        const br = breaks.find((x) => x.id === btn.dataset.id);
        const st = br ? resolveStudentForBreak(br) : null;
        if (!br || !st) return;
        openKidsExtendBreakModal({
          student: st,
          breakDoc: br._synthetic ? null : br,
          profile,
          onSuccess: () => {
            window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'break:extend' } }));
            return load();
          }
        });
      });
    });
  }

  // ---------- Print & CSV Export ----------
  function handleExportCsv() {
    const today = localToday();
    const list = lastFilteredList.length || breaks.length ? lastFilteredList : [];
    const headers = ['Student ID', 'Student Name', 'Phone', 'Level', 'Period', 'Months Count', 'Actual Return Date', 'Reason', 'Status', 'Started By'];
    const rows = list.map((b) => {
      const s = resolveStudentForBreak(b);
      const endYM = b.plannedEndMonth || b.endMonth || b.startMonth;
      return [
        s?.studentId || b.studentCode || '-',
        formatPersonName(s?.name || b.studentName || '') || '-',
        s?.phone || '',
        s?.courseLevelName || s?.courseName || '',
        formatBreakPeriod(b.startMonth, endYM),
        String(getBreakMonths(b).length || 1),
        b.actualReturnDate ? formatDateIN(b.actualReturnDate) : '',
        b.reason || '-',
        statusLabelOf(b, today),
        formatStartedByLabel(b)
      ];
    });
    downloadCsv(`unique-kids-breaks-${today}.csv`, headers, rows);
    showToast({ type: 'success', message: `Exported ${rows.length} break record${rows.length === 1 ? '' : 's'} to CSV.` });
  }

  function handlePrint() {
    const today = localToday();
    const curYM = today.slice(0, 7);
    const list = lastFilteredList;
    const f = tb.state || {};
    const filterBits = [];
    if (f.status && f.status !== 'all') filterBits.push(`View: ${f.status}`);
    if (f.month && f.month !== 'all') filterBits.push(`Month: ${formatShortMonthYear(f.month) || f.month}`);
    if (f.q) filterBits.push(`Search: "${f.q}"`);

    const ongoingCnt = breaks.filter((b) => isOngoingBreak(b)).length;
    const overdueCnt = breaks.filter((b) => isBreakOverdueReturn(b, today)).length;
    const rejoinedMonthCnt = breaks.filter((b) => isRejoinedThisMonth(b, curYM)).length;

    const ok = openPrintSheet({
      title: 'Unique Kids — Break Management Report',
      subtitle: 'Whole-month planned breaks & rejoin tracking',
      org: cachedMeta?.org || (window.APP_CACHE && window.APP_CACHE.org) || null,
      filtersText: filterBits.join(' | ') || 'All breaks',
      generatedBy: profile?.name || profile?.email || 'User',
      summaryPairs: [
        { label: 'On Break', value: String(ongoingCnt) },
        { label: 'Not Rejoined', value: String(overdueCnt) },
        { label: 'Rejoined This Month', value: String(rejoinedMonthCnt) },
        { label: 'Shown Rows', value: String(list.length) }
      ],
      columns: [
        { label: 'Student ID' },
        { label: 'Student' },
        { label: 'Period' },
        { label: 'Months', num: true },
        { label: 'Reason' },
        { label: 'Status' },
        { label: 'Started By' }
      ],
      rows: list.map((b) => {
        const s = resolveStudentForBreak(b);
        const endYM = b.plannedEndMonth || b.endMonth || b.startMonth;
        return [
          s?.studentId || b.studentCode || '-',
          formatPersonName(s?.name || b.studentName || '') || '-',
          formatBreakPeriod(b.startMonth, endYM),
          String(getBreakMonths(b).length || 1),
          b.reason || '-',
          statusLabelOf(b, today),
          formatStartedByLabel(b)
        ];
      }),
      footerNote: `Printed by ${profile?.name || profile?.email || 'User'}`
    });
    if (!ok) {
      showToast({ type: 'warning', message: 'Please allow popups to open the print report.' });
    }
  }

  if (exportCsvBtn) exportCsvBtn.addEventListener('click', handleExportCsv);
  if (printBtn) printBtn.addEventListener('click', handlePrint);

  if (addBtn && isSuper) {
    addBtn.addEventListener('click', () => {
      openKidsStartBreakModal({
        student: null,
        students,
        profile,
        onSuccess: () => load()
      });
    });
  }

  $('skb-load-error-retry').addEventListener('click', () => { load({ forceRefresh: true }); });
  $('skb-load-error-back').addEventListener('click', () => { location.hash = '#/dashboard'; });
  $('skb-no-match-clear').addEventListener('click', () => {
    tb.state.q = '';
    tb.setFilterValue('month', 'all');
    tb.setFilterValue('status', 'all');
    activeTab = 'all';
    syncTabButtons('all');
    page = 1;
    render();
  });

  try { await load(); } catch (e) {
    console.error('[school-break] init load', e);
    setError('Could not load breaks.');
  }
}
