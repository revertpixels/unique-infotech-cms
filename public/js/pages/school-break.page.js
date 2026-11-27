// school-break.page.js � Kids break management (school context, Super Admin).
// Approved break months: no classes, no monthly fee, not overdue months.
// Store reason and approval history. Authorised staff can approve/reject/modify.
import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc, updateDoc, serverTimestamp, runTransaction } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.188';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.188';
import { PAGE_SIZE, buildStats, buildToolbar, renderPager } from '../components/list-page.js?v=1.8.188';
import { createSelect } from '../components/ui-select.js?v=1.8.188';
import { formatDateIN, formatPersonName } from '../utils/formatter.js?v=1.8.188';
import { localToday, monthSeq, nextMonth } from '../utils/school-lifecycle.js?v=1.8.188';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.188';

const COL = 'students';
const BREAKS_COL = 'breaks';
const BILLS_COL = 'bills';

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-break] missing #' + id); return el; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function statusPill(st) {
  const cls = { pending: 'uk-pill inactive', approved: 'uk-pill active', rejected: 'uk-pill completed' }[st] || 'uk-pill inactive';
  return '<span class="' + cls + '">' + (st.charAt(0).toUpperCase() + st.slice(1)) + '</span>';
}

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  if (!school) {
    showToast({ type: 'error', message: 'Break management is only available in Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';
  if (!isSuper) {
    showToast({ type: 'error', message: `Break management is restricted to ${getRoleTitle('superadmin')}.` });
    return;
  }

  const rowsHost = $('skb-rows');
  const emptyEl = $('skb-empty');
  const loadingEl = $('skb-loading');
  const noMatchEl = $('skb-no-match');
  const loadErrorEl = $('skb-load-error');
  const loadErrorMsg = $('skb-load-error-msg');
  const footEl = $('skb-foot');
  if (!rowsHost || !emptyEl || !loadingEl || !noMatchEl || !loadErrorEl) return;

  // ---------- toolbar ----------
  const tbFilters = [
    {
      id: 'status', label: 'Status', options: [
        { value: 'all', label: 'All statuses' }, { value: 'pending', label: 'Pending' },
        { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }
      ]
    }
  ];
  const tb = buildToolbar({
    placeholder: 'Search student name or Student ID',
    filters: tbFilters,
    onChange: () => { page = 1; render(); },
    onRefresh: () => load()
  });
  const tbHost = $('skb-toolbar');
  if (tbHost) { tbHost.innerHTML = ''; tb.el.classList.add('skb-toolbar-row'); tbHost.appendChild(tb.el); }

  // ---------- stats ----------
  const stats = buildStats([
    { label: 'Total breaks', value: 0, sub: 'Break requests', icon: 'pause-circle', tone: 'indigo' },
    { label: 'Pending', value: 0, sub: 'Awaiting approval', icon: 'clock', tone: 'amber' },
    { label: 'Approved', value: 0, sub: 'Approved breaks', icon: 'check-circle', tone: 'green' },
    { label: 'Rejected', value: 0, sub: 'Rejected requests', icon: 'x-circle', tone: 'red' }
  ]);
  const statsHost = $('skb-stats');
  if (statsHost) statsHost.appendChild(stats.el);

  // ---------- state ----------
  let breaks = [], students = [];
  let page = 1;
  let loadError = null;
  let loading = true;

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

  async function load() {
    setLoading(true);
    loadError = null;
    try {
      const [bSnap, sSnap] = await Promise.all([
        getDocs(query(collection(db, BREAKS_COL), where('ctx', '==', 'school'))),
        getDocs(query(collection(db, COL), where('ctx', '==', 'school')))
      ]);
      breaks = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      students = sSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      render();
    } catch (e) {
      console.error('[school-break] load failed', e);
      setError('Could not load breaks (' + (e.code || 'error') + ').');
    }
  }

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
    const list = breaks.filter(b => {
      if (f.status && f.status !== 'all' && b.status !== f.status) return false;
      if (q) {
        const s = students.find(x => x.id === b.studentId) || {};
        const hay = [(s.name || ''), (s.studentId || '')].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (breaks.length === 0) {
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
      stats.update(0, breaks.length);
      stats.update(1, breaks.filter(b => b.status === 'pending').length);
      stats.update(2, breaks.filter(b => b.status === 'approved').length);
      stats.update(3, breaks.filter(b => b.status === 'rejected').length);
      return;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const pageList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    pageList.forEach(b => {
      const s = students.find(x => x.id === b.studentId) || {};
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="skb-id">' + (s.studentId || '-') + '</td>' +
        '<td>' + (formatPersonName(s.name || '') || '-') + '</td>' +
        '<td>' + (b.startMonth || '-') + ' - ' + (b.endMonth || '-') + '</td>' +
        '<td>' + (b.reason || '-') + '</td>' +
        '<td>' + statusPill(b.status || 'pending') + '</td>' +
        '<td>' + (b.requestedBy || '-') + '</td>' +
        '<td class="skb-actions">' +
        (b.status === 'pending' ?
          '<button type="button" class="skb-act approve" data-id="' + b.id + '" title="Approve"><i data-lucide="check"></i></button>' +
          '<button type="button" class="skb-act reject" data-id="' + b.id + '" title="Reject"><i data-lucide="x"></i></button>' :
          '<button type="button" class="skb-act view" data-id="' + b.id + '" title="View details"><i data-lucide="file-text"></i></button>') +
        '</td>';
      rowsHost.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const pendingN = breaks.filter(b => b.status === 'pending').length;
    const approvedN = breaks.filter(b => b.status === 'approved').length;
    const rejectedN = breaks.filter(b => b.status === 'rejected').length;
    stats.update(0, breaks.length);
    stats.update(1, pendingN);
    stats.update(2, approvedN);
    stats.update(3, rejectedN);
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

    // row actions
    rowsHost.querySelectorAll('.approve').forEach(b => {
      b.addEventListener('click', () => { approveBreak(b.dataset.id); });
    });
    rowsHost.querySelectorAll('.reject').forEach(b => {
      b.addEventListener('click', () => { rejectBreak(b.dataset.id); });
    });
  }

  async function approveBreak(id) {
    const br = breaks.find(b => b.id === id);
    if (!br) return;
    if (!await confirmDialog({
      title: 'Approve break?',
      message: 'Approve break for ' + (br.studentId || '') + ' from ' + br.startMonth + ' to ' + br.endMonth + '? This skips monthly fees for approved months.',
      confirmText: 'Approve', icon: 'check'
    })) return;
    try {
      const who = (profile && profile.email) || '';
      // Read candidate bills outside the transaction; only writes run inside it.
      const futureSnap = await getDocs(query(collection(db, BILLS_COL),
        where('studentId', '==', br.studentId),
        where('month', '>=', br.startMonth),
        where('month', '<=', br.endMonth),
        where('status', '==', 'unpaid')));
      const futureIds = futureSnap.docs.map(d => d.id);
      await runTransaction(db, async (tx) => {
        const ref = doc(db, BREAKS_COL, id);
        tx.update(ref, { status: 'approved', approvedBy: who, approvedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        futureIds.forEach(billId => tx.update(doc(db, BILLS_COL, billId), { status: 'break-waived', stoppedAt: serverTimestamp(), stoppedBy: who }));
      });
      showToast({ type: 'success', message: 'Break approved.' });
      await load();
    } catch (e) {
      console.error('[school-break] approve failed', e);
      showToast({ type: 'error', message: e.message || 'Approve failed.' });
    }
  }

  async function rejectBreak(id) {
    const br = breaks.find(b => b.id === id);
    if (!br) return;
    if (!await confirmDialog({
      title: 'Reject break?',
      message: 'Reject break request for ' + (br.studentId || '') + '?',
      confirmText: 'Reject', icon: 'x'
    })) return;
    try {
      const who = (profile && profile.email) || '';
      await updateDoc(doc(db, BREAKS_COL, id), {
        status: 'rejected', rejectedBy: who, rejectedAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      showToast({ type: 'success', message: 'Break rejected.' });
      await load();
    } catch (e) {
      console.error('[school-break] reject failed', e);
      showToast({ type: 'error', message: e.message || 'Reject failed.' });
    }
  }

  $('skb-load-error-retry').addEventListener('click', () => { load(); });
  $('skb-load-error-back').addEventListener('click', () => { location.hash = '#/dashboard'; });
  $('skb-no-match-clear').addEventListener('click', () => {
    tb.state.q = '';
    tb.state.status = 'all';
    render();
  });

  try { await load(); } catch (e) {
    console.error('[school-break] init load', e);
    setError('Could not load breaks.');
  }
}

