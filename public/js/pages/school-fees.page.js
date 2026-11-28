// school-fees.page.js � Unique Kids monthly fee collection (school context, Super Admin).
// Lists monthly bills with status (unpaid/paid/partial), late fees, and allows recording
// payments. Kids billing is session-independent: monthly bills open on the 1st, due by the
// 10th, late fine Rs 1/day from the 11th.
import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.197';
import { PAGE_SIZE, buildStats, buildToolbar, renderPager } from '../components/list-page.js?v=1.8.197';
import { createSelect } from '../components/ui-select.js?v=1.8.197';
import { openMenu } from '../components/ui-menu.js?v=1.8.197';
import { formatINR, formatDateIN, formatPersonName } from '../utils/formatter.js?v=1.8.197';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.197';
import { isCourseActive } from '../utils/session-rules.js?v=1.8.197';
import { localToday, monthSeq, nextMonth } from '../utils/school-lifecycle.js?v=1.8.197';
import { openPaymentPopup } from '../components/payment-popup.js?v=1.8.197';
import { daysLate, computeLateFee, syncOpenKidsBills } from '../utils/school-billing.js?v=1.8.197';
import {
  ensureReferenceData,
  getCachedReferenceData,
  scopeReferenceDataByCtx,
  ensureKidsDataset,
  getCachedKidsDataset,
  syncKidsDatasetDelta,
  isCacheStale,
  scheduleDelayedSkeleton
} from '../services/report.service.js?v=1.8.197';

const COL = 'students';
const BILLS_COL = 'bills';
const PAYMENTS_COL = 'payments';
let cleanupPage = null;
export function unmount() { if (cleanupPage) cleanupPage(); cleanupPage = null; }

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-fees] missing #' + id); return el; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

function rupees(n) { return Math.round(Number(n || 0) * 100) / 100; }

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  if (!school) {
    showToast({ type: 'error', message: 'Kids Fees is only available in Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';
  if (!isSuper) {
    showToast({ type: 'error', message: `Kids Fees is restricted to ${getRoleTitle('superadmin')}.` });
    return;
  }

  const rowsHost = $('sf-rows');
  const emptyEl = $('sf-empty');
  const loadingEl = $('sf-loading');
  const noMatchEl = $('sf-no-match');
  const loadErrorEl = $('sf-load-error');
  const loadErrorMsg = $('sf-load-error-msg');
  const footEl = $('sf-foot');
  if (!rowsHost || !emptyEl || !loadingEl || !noMatchEl || !loadErrorEl) return;

  // ---------- toolbar ----------
  const tbFilters = [
    {
      id: 'status', label: 'Status', options: [
        { value: 'all', label: 'All statuses' }, { value: 'unpaid', label: 'Unpaid' },
        { value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' },
        { value: 'overdue', label: 'Overdue' }, { value: 'break-waived', label: 'Break (No fee)' }
      ]
    },
    { id: 'month', label: 'Month', options: [{ value: 'all', label: 'All months', icon: 'calendar' }] },
    { id: 'level', label: 'Level', options: [{ value: 'all', label: 'All levels', icon: 'book-open' }] }
  ];
  const tb = buildToolbar({
    placeholder: 'Search student name, Student ID or phone',
    filters: tbFilters,
    onChange: () => { page = 1; render(); },
    onRefresh: () => load({ forceRefresh: true })
  });
  const tbHost = $('sk-toolbar');
  if (tbHost) { tbHost.innerHTML = ''; tb.el.classList.add('sf-toolbar-row'); tbHost.appendChild(tb.el); }

  // ---------- stats ----------
  const stats = buildStats([
    { label: 'Total bills', value: 0, sub: 'This centre', icon: 'file-text', tone: 'indigo' },
    { label: 'Unpaid', value: 0, sub: 'Outstanding bills', icon: 'alert-circle', tone: 'amber' },
    { label: 'Paid', value: 0, sub: 'Fully paid', icon: 'check-circle', tone: 'green' },
    { label: 'Overdue', value: 0, sub: 'Late fines due', icon: 'alert-triangle', tone: 'red' }
  ]);
  const statsHost = $('sk-stats');
  if (statsHost) statsHost.appendChild(stats.el);

  // ---------- state ----------
  let bills = [], students = [], levels = [], batches = [], coursesById = {};
  let page = 1;
  let loadError = null;
  let loading = true;

  function studentName(id) { const s = students.find(s => s.id === id); return s ? (s.name || '-') : '-'; }
  function studentPhone(id) { const s = students.find(s => s.id === id); return s ? (s.phone || '-') : '-'; }
  function studentId_(id) { const s = students.find(s => s.id === id); return s ? (s.studentId || '-') : '-'; }
  function courseName(id) { const c = coursesById[id]; return c ? (c.name || c.id) : '-'; }

  // ---------- state rendering ----------
  function setLoading(isLoading) {
    loading = isLoading;
    loadingEl.hidden = !isLoading;
    rowsHost.hidden = isLoading;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;
    footEl.hidden = true;
  }

  function setError(msg) {
    loadError = msg;
    loadingEl.hidden = true;
    rowsHost.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = false;
    if (loadErrorMsg) loadErrorMsg.textContent = msg;
    footEl.hidden = true;
  }

  let alive = true;

  function applyLoadedData(meta, dataset) {
    const scoped = scopeReferenceDataByCtx(meta || {}, 'school');
    students = (dataset?.studentsList || []).slice();
    const studentKeys = new Set();
    students.forEach((s) => { if (s.id) studentKeys.add(s.id); if (s.studentId) studentKeys.add(String(s.studentId)); });
    bills = (dataset?.bills || [])
      .filter((b) => studentKeys.has(b.studentId))
      .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')));
    levels = (scoped.coursesList || []).filter((c) => (c.status || 'active') === 'active');
    coursesById = {};
    levels.forEach((c) => { coursesById[c.id] = c; });
    batches = (scoped.batchesList || []).filter((b) => (b.status || 'active') === 'active');
    const months = Array.from(new Set(bills.map((b) => b.month).filter(Boolean))).sort().reverse();
    tb.setFilterOptions('month', [{ value: 'all', label: 'All months', icon: 'calendar' }].concat(
      months.map((m) => ({ value: m, label: m, icon: 'calendar' }))
    ));
    tb.setFilterOptions('level', [{ value: 'all', label: 'All levels', icon: 'book-open' }].concat(
      levels.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((c) => ({ value: c.id, label: c.name || c.id, icon: 'book-open' }))
    ));
    render();
  }

  // ---------- load ----------
  async function load({ forceRefresh = false, deltaRefresh = false, background = false } = {}) {
    loadError = null;
    const today = localToday();
    if (!forceRefresh && !deltaRefresh) {
      const cachedMeta = getCachedReferenceData(profile);
      const cachedDs = getCachedKidsDataset();
      if (cachedMeta && cachedDs) {
        applyLoadedData(cachedMeta, cachedDs);
        if (!background && (isCacheStale(cachedMeta) || isCacheStale(cachedDs) || cachedDs.billsSyncedAsOf !== today)) {
          load({ deltaRefresh: true, background: true }).catch(() => {});
        }
        return;
      }
    }

    const skelTask = (!background && !bills.length)
      ? scheduleDelayedSkeleton(() => {
        if (alive && !bills.length) setLoading(true);
      }, 300)
      : null;

    try {
      const [meta, dataset] = await Promise.all([
        ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile }),
        deltaRefresh
          ? syncKidsDatasetDelta({ profile, syncOpenBills: true })
          : ensureKidsDataset({ profile, forceRefresh, syncOpenBills: true })
      ]);
      if (skelTask) skelTask.cancel();
      if (!alive) return;
      if (!background || !deltaRefresh || !dataset.deltaUsed || dataset.changedCount !== 0 || meta?.fromCache === false) {
        applyLoadedData(meta, dataset);
      }
    } catch (e) {
      if (skelTask) skelTask.cancel();
      if (!background && alive) {
        console.error('[school-fees] load failed', e);
        setError('Could not load fees (' + (e.code || 'error') + ').');
      }
    }
  }

  const onMutated = () => { if (alive) load({ forceRefresh: false }); };
  window.addEventListener('uic:data-mutated', onMutated);
  window.addEventListener('uic:meta-mutated', onMutated);
  cleanupPage = () => {
    alive = false;
    window.removeEventListener('uic:data-mutated', onMutated);
    window.removeEventListener('uic:meta-mutated', onMutated);
  };

  // ---------- render ----------
  function render() {
    if (!rowsHost) return;
    loading = false;
    rowsHost.hidden = false;
    rowsHost.innerHTML = '';
    loadingEl.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;

    const f = tb.state || {};
    const q = (f.q || '').toLowerCase();
    const today = localToday();

    const list = bills.filter(b => {
      const st = String(b.status || 'unpaid').toLowerCase();
      if (f.status && f.status !== 'all') {
        if (f.status === 'overdue') {
          if ((st !== 'unpaid' && st !== 'partial') || daysLate(b.month) <= 0) return false;
        } else if (st !== f.status) return false;
      }
      if (f.month && f.month !== 'all' && b.month !== f.month) return false;
      if (f.level && f.level !== 'all') {
        if (String(b.courseId || '') !== String(f.level)) return false;
      }
      if (q) {
        const hay = [studentName(b.studentId), studentId_(b.studentId), studentPhone(b.studentId)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (bills.length === 0) {
      emptyEl.hidden = false;
      footEl.hidden = true;
      stats.update(0, 0);
      stats.update(1, 0);
      stats.update(2, 0);
      stats.update(3, 0);
      return;
    }

    if (!list.length) {
      noMatchEl.hidden = false;
      footEl.hidden = true;
      stats.update(0, bills.length);
      stats.update(1, bills.filter(b => b.status === 'unpaid' || b.status === 'partial').length);
      stats.update(2, bills.filter(b => b.status === 'paid').length);
      stats.update(3, bills.filter(b => (b.status === 'unpaid' || b.status === 'partial') && daysLate(b.month) > 0).length);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const pageList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    pageList.forEach(b => {
      const s = students.find(x => x.id === b.studentId || (b.studentCode && x.studentId === b.studentCode) || x.studentId === b.studentId) || {};
      const c = coursesById[b.courseId] || {};
      const late = computeLateFee(b);
      const st = String(b.status || 'unpaid').toLowerCase();
      const canPay = st === 'unpaid' || st === 'partial';
      const stText = st === 'paid'
        ? 'Paid'
        : (st === 'partial'
          ? 'Partial (' + Math.round((Number(b.paidAmount || 0) / Number(b.monthlyFee || 1)) * 100) + '%)'
          : (st === 'break-waived'
            ? 'Break (No fee)'
            : (st === 'stopped' || st === 'cancelled' ? 'Stopped' : 'Unpaid')));
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="sf-id">' + (s.studentId || '-') + '</td>' +
        '<td>' + (formatPersonName(s.name || '') || '-') + '</td>' +
        '<td class="hide-sm">' + (s.phone || '-') + '</td>' +
        '<td>' + (c.name || b.courseName || '-') + '</td>' +
        '<td>' + (b.month || '-') + '</td>' +
        '<td>' + (st === 'break-waived' ? '₹0' : formatINR(b.monthlyFee)) + '</td>' +
        '<td>' + stText + '</td>' +
        '<td>' + (late > 0 ? formatINR(late) : '-') + '</td>' +
        '<td class="sk-actions">' +
        (canPay ? '<button type="button" class="sk-act pay" data-id="' + b.id + '" title="Record payment"><i data-lucide="credit-card"></i></button>' : '<span class="text-mute">—</span>') +
        '</td>';
      rowsHost.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const unpaidN = bills.filter(b => b.status === 'unpaid' || b.status === 'partial').length;
    const paidN = bills.filter(b => b.status === 'paid').length;
    const overdueN = bills.filter(b => (b.status === 'unpaid' || b.status === 'partial') && daysLate(b.month) > 0).length;
    stats.update(0, bills.length);
    stats.update(1, unpaidN);
    stats.update(2, paidN);
    stats.update(3, overdueN);
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

    // row actions: open shared payment popup
    rowsHost.querySelectorAll('.pay').forEach(b => {
      b.addEventListener('click', () => {
        const bill = bills.find(x => x.id === b.dataset.id);
        if (!bill) return;
        const matchedStu = students.find(x => x.id === bill.studentId || (bill.studentCode && x.studentId === bill.studentCode) || x.studentId === bill.studentId);
        const stuObj = matchedStu
          ? { ...matchedStu, ctx: 'school' }
          : { id: bill.studentId, studentId: bill.studentCode || bill.studentId, name: bill.studentName || 'Student', ctx: 'school', courseId: bill.courseId || '', courseName: bill.courseName || '' };
        const stuBills = bills.filter(x => x.studentId === bill.studentId || (stuObj.studentId && x.studentId === stuObj.studentId));
        openPaymentPopup({
          student: stuObj,
          profile,
          preselectedBillId: bill.id,
          bills: stuBills,
          from: 'school-fees',
          onSuccess: () => load({ forceRefresh: false })
        });
      });
    });
  }

  $('sf-load-error-retry').addEventListener('click', () => { load(); });
  $('sf-load-error-back').addEventListener('click', () => { location.hash = '#/dashboard'; });
  $('sf-no-match-clear').addEventListener('click', () => {
    tb.state.q = '';
    tb.state.status = 'all';
    tb.state.month = 'all';
    tb.state.level = 'all';
    render();
  });

  try { await load(); } catch (e) {
    console.error('[school-fees] init load', e);
    setError('Could not load fees.');
  }
}

