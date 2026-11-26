// school-fees.page.js � Unique Kids monthly fee collection (school context, Super Admin).
// Lists monthly bills with status (unpaid/paid/partial), late fees, and allows recording
// payments. Kids billing is session-independent: monthly bills open on the 1st, due by the
// 10th, late fine Rs 1/day from the 11th.
import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc, updateDoc, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.171';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.171';
import { PAGE_SIZE, buildStats, buildToolbar, renderPager } from '../components/list-page.js?v=1.8.171';
import { createSelect } from '../components/ui-select.js?v=1.8.171';
import { openMenu } from '../components/ui-menu.js?v=1.8.171';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.171';
import { formatINR, formatDateIN, formatPersonName } from '../utils/formatter.js?v=1.8.171';
import { resolveUserDisplay, getRoleTitle } from '../services/user-directory.service.js?v=1.8.171';
import { isCourseActive } from '../utils/session-rules.js?v=1.8.171';
import { localToday, monthSeq, nextMonth } from '../utils/school-lifecycle.js?v=1.8.171';
import { playPaymentSuccessSound } from '../utils/sound.js?v=1.8.171';
import { daysLate, computeLateFee } from '../utils/school-billing.js?v=1.8.171';

const COL = 'students';
const BILLS_COL = 'bills';
const PAYMENTS_COL = 'payments';

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
        { value: 'overdue', label: 'Overdue' }
      ]
    },
    { id: 'month', label: 'Month', options: [{ value: 'all', label: 'All months', icon: 'calendar' }] },
    { id: 'level', label: 'Level', options: [{ value: 'all', label: 'All levels', icon: 'book-open' }] }
  ];
  const tb = buildToolbar({
    placeholder: 'Search student name, Student ID or phone',
    filters: tbFilters,
    onChange: () => { page = 1; render(); },
    onRefresh: () => load()
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

  // ---------- load ----------
  async function load() {
    setLoading(true);
    loadError = null;
    try {
      const [bSnap, sSnap, cSnap, brSnap] = await Promise.all([
        getDocs(query(collection(db, BILLS_COL), where('ctx', '==', 'school'))),
        getDocs(query(collection(db, COL), where('ctx', '==', 'school'))),
        getDocs(query(collection(db, 'courses'), where('ctx', '==', 'school'))),
        getDocs(query(collection(db, 'batches'), where('ctx', '==', 'school')))
      ]);
      bills = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      students = sSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      levels = cSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(c => (c.status || 'active') === 'active');
      coursesById = {}; levels.forEach(c => { coursesById[c.id] = c; });
      batches = brSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(b => (b.status || 'active') === 'active');
      const months = Array.from(new Set(bills.map(b => b.month).filter(Boolean))).sort().reverse();
      tb.setFilterOptions('month', [{ value: 'all', label: 'All months', icon: 'calendar' }].concat(
        months.map(m => ({ value: m, label: m, icon: 'calendar' }))
      ));
      tb.setFilterOptions('level', [{ value: 'all', label: 'All levels', icon: 'book-open' }].concat(
        levels.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
          .map(c => ({ value: c.id, label: c.name || c.id, icon: 'book-open' }))
      ));
      render();
    } catch (e) {
      console.error('[school-fees] load failed', e);
      setError('Could not load fees (' + (e.code || 'error') + ').');
    }
  }

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
      if (f.status && f.status !== 'all') {
        if (f.status === 'overdue') {
          if (b.status === 'paid' || daysLate(b.month) <= 0) return false;
        } else if (b.status !== f.status) return false;
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
      stats.update(3, bills.filter(b => b.status !== 'paid' && daysLate(b.month) > 0).length);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const pageList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    pageList.forEach(b => {
      const s = students.find(x => x.id === b.studentId) || {};
      const c = coursesById[b.courseId] || {};
      const late = computeLateFee(b);
      const tr = document.createElement('tr');
      const paidPct = b.monthlyFee > 0 ? Math.round((Number(b.paidAmount || 0) / Number(b.monthlyFee)) * 100) : 0;
      tr.innerHTML =
        '<td class="sf-id">' + (s.studentId || '-') + '</td>' +
        '<td>' + (formatPersonName(s.name || '') || '-') + '</td>' +
        '<td class="hide-sm">' + (s.phone || '-') + '</td>' +
        '<td>' + (c.name || '-') + '</td>' +
        '<td>' + (b.month || '-') + '</td>' +
        '<td>' + formatINR(b.monthlyFee) + '</td>' +
        '<td>' + (b.status === 'paid' ? 'Paid' : b.status === 'partial' ? 'Partial (' + Math.round((Number(b.paidAmount || 0) / Number(b.monthlyFee || 1)) * 100) + '%)' : 'Unpaid') + '</td>' +
        '<td>' + (late > 0 ? formatINR(late) : '-') + '</td>' +
        '<td class="sk-actions">' +
        '<button type="button" class="sk-act pay" data-id="' + b.id + '" title="Record payment"><i data-lucide="credit-card"></i></button>' +
        '</td>';
      rowsHost.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const unpaidN = bills.filter(b => b.status === 'unpaid' || b.status === 'partial').length;
    const paidN = bills.filter(b => b.status === 'paid').length;
    const overdueN = bills.filter(b => b.status !== 'paid' && daysLate(b.month) > 0).length;
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

    // row actions: payment
    rowsHost.querySelectorAll('.pay').forEach(b => {
      b.addEventListener('click', () => { location.hash = '#/school-fees/pay/' + b.dataset.id; });
    });
  }

  // ---------- payment recording ----------
  async function recordPaymentForBill(billId, amount, receivedDate, receivedBy) {
    const bill = bills.find(b => b.id === billId);
    if (!bill) { showToast({ type: 'error', message: 'Bill not found.' }); return; }
    const paid = rupees(amount);
    if (!Number.isFinite(paid) || paid <= 0) { showToast({ type: 'error', message: 'Enter a valid amount.' }); return; }
    if (!receivedDate) { showToast({ type: 'error', message: 'Enter the received date.' }); return; }
    try {
      const who = (profile && profile.email) || '';
      const recDisp = resolveUserDisplay(who, profile?.name, profile?.designation);
      // Read unpaid bills outside the transaction; only writes run inside it.
      const unpaidSnap = await getDocs(query(collection(db, BILLS_COL),
        where('studentId', '==', bill.studentId), where('status', 'in', ['unpaid', 'partial'])));
      const targets = unpaidSnap.docs.map(d => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => monthSeq(a.month) - monthSeq(b.month));
      await runTransaction(db, async (tx) => {
        let remaining = paid;
        for (const b of targets) {
          if (remaining <= 0) break;
          const billLate = computeLateFee(b);
          const billDue = rupees(b.monthlyFee || 0) + billLate;
          const billRemaining = billDue - rupees(b.paidAmount || 0);
          if (billRemaining <= 0) continue;
          const payThis = Math.min(remaining, billRemaining);
          const allocRef = doc(collection(db, PAYMENTS_COL));
          tx.set(allocRef, {
            id: allocRef.id, studentId: b.studentId, billId: b.id, month: b.month,
            amount: rupees(payThis), lateFeeCovered: 0, feeCovered: rupees(payThis),
            receivedDate, receivedBy: who,
            ...(recDisp.name ? { receivedByName: recDisp.name } : {}),
            ...(recDisp.designation ? { recordedByDesignation: recDisp.designation } : {}),
            createdAt: serverTimestamp()
          });
          const newPaid = rupees(b.paidAmount || 0) + payThis;
          tx.update(doc(db, BILLS_COL, b.id), {
            paidAmount: rupees(newPaid), status: newPaid >= billDue ? 'paid' : 'partial', updatedAt: serverTimestamp()
          });
          remaining = rupees(remaining - payThis);
        }
        const payRef = doc(collection(db, PAYMENTS_COL));
        tx.set(payRef, {
          id: payRef.id, studentId: bill.studentId, totalAmount: paid, receivedDate, receivedBy: who,
          ...(recDisp.name ? { receivedByName: recDisp.name } : {}),
          ...(recDisp.designation ? { recordedByDesignation: recDisp.designation } : {}),
          allocations: [], createdAt: serverTimestamp()
        });
      });
      await load();
      playPaymentSuccessSound();
      showToast({ type: 'success', message: 'Payment of ' + formatINR(paid) + ' recorded.' });
    } catch (e) {
      console.error('[school-fees] payment failed', e);
      showToast({ type: 'error', message: 'Payment failed (' + (e.code || 'error') + ').' });
    }
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

