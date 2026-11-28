// school-break.page.js — Unique Kids Break Management (Super Admin: full; School Head: read-only).
// Whole-month planned breaks, unpaid dues warning, rejoin/early-return resume, full history,
// and "Break ended - not rejoined" follow-up list.
import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.196';
import { PAGE_SIZE, buildStats, buildToolbar, renderPager } from '../components/list-page.js?v=1.8.196';
import { openPopup } from '../components/modal.js?v=1.8.196';
import { createSelect } from '../components/ui-select.js?v=1.8.196';
import { formatDateIN, formatPersonName } from '../utils/formatter.js?v=1.8.196';
import { localToday } from '../utils/school-lifecycle.js?v=1.8.196';
import {
  formatBreakPeriod,
  formatShortMonthYear,
  isBreakOverdueReturn
} from '../utils/school-billing.js?v=1.8.196';
import {
  openKidsStartBreakModal,
  openKidsResumeBreakModal
} from '../utils/school-break-modals.js?v=1.8.196';
import { getRoleTitle, resolveUserDisplay } from '../services/user-directory.service.js?v=1.8.196';

const COL = 'students';
const BREAKS_COL = 'breaks';

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-break] missing #' + id); return el; }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

function isOngoingBreak(br) {
  const st = String(br?.status || '').toLowerCase().trim();
  return (st === 'active' || st === 'approved') && !br.actualReturnDate && !br.actualReturnMonth;
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

function formatAuditCell(b) {
  const startWho = b.startedBy || b.requestedBy || b.approvedBy || '';
  const startDisp = startWho ? resolveUserDisplay(startWho, b.startedByName, b.startedByDesignation) : null;
  const startLabel = startDisp && startDisp.name && startDisp.name !== '-' ? startDisp.name : (startWho || '-');
  const startWhen = b.startedAtISO ? formatDateIN(b.startedAtISO.slice(0, 10)) : '';

  const lines = [`<div><span class="skb-audit-lbl">Started:</span> ${esc(startLabel)}${startWhen ? ' (' + esc(startWhen) + ')' : ''}</div>`];
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
  if (!rowsHost || !emptyEl || !loadingEl || !noMatchEl || !loadErrorEl) return;

  if (addBtn) addBtn.hidden = !isSuper;

  const qStr = (location.hash.split('?')[1] || '');
  const hashParams = new URLSearchParams(qStr);
  const initialFilter = ['active', 'overdue', 'completed', 'all'].includes(hashParams.get('filter'))
    ? hashParams.get('filter')
    : 'all';

  // ---------- toolbar ----------
  const tbFilters = [
    {
      id: 'status', label: 'Filter', options: [
        { value: 'all', label: 'All breaks' },
        { value: 'active', label: 'Currently on break' },
        { value: 'overdue', label: 'Break ended - not rejoined' },
        { value: 'completed', label: 'Completed (Rejoined)' }
      ]
    }
  ];
  const tb = buildToolbar({
    placeholder: 'Search student name, ID, phone or reason',
    filters: tbFilters,
    onChange: () => { page = 1; render(); },
    onRefresh: () => load()
  });
  tb.state.status = initialFilter;
  const tbHost = $('skb-toolbar');
  if (tbHost) { tbHost.innerHTML = ''; tb.el.classList.add('skb-toolbar-row'); tbHost.appendChild(tb.el); }

  // ---------- stats ----------
  const stats = buildStats([
    { label: 'On Break', value: 0, sub: 'Currently paused', icon: 'pause-circle', tone: 'amber' },
    { label: 'Break Ended - Not Rejoined', value: 0, sub: 'Needs rejoin follow-up', icon: 'alert-circle', tone: 'red' },
    { label: 'Rejoined', value: 0, sub: 'Completed break history', icon: 'play-circle', tone: 'green' },
    { label: 'Total Records', value: 0, sub: 'All recorded breaks', icon: 'history', tone: 'indigo' }
  ]);
  const statsHost = $('skb-stats');
  if (statsHost) statsHost.appendChild(stats.el);

  // ---------- state ----------
  let breaks = [], students = [];
  let page = 1;
  let loadError = null;
  let loading = true;

  function resolveStudentForBreak(b) {
    return students.find((x) => x.id === b.studentId || (b.studentCode && x.studentId === b.studentCode) || (x.studentId && x.studentId === b.studentId)) || null;
  }

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
        getDocs(collection(db, BREAKS_COL)),
        getDocs(query(collection(db, COL), where('ctx', '==', 'school')))
      ]);
      students = sSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      const rawBreaks = bSnap.docs
        .map((d) => Object.assign({ id: d.id }, d.data()))
        .filter((b) => !b.ctx || b.ctx === 'school');

      // Include any student still marked status='break' who lacks a doc in `breaks` (legacy draft records).
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

    const today = localToday();
    const ongoingList = breaks.filter((b) => isOngoingBreak(b));
    const overdueList = ongoingList.filter((b) => isBreakOverdueReturn(b, today));
    const completedList = breaks.filter((b) => !isOngoingBreak(b) && String(b.status || '').toLowerCase() === 'completed');

    stats.update(0, ongoingList.length);
    stats.update(1, overdueList.length);
    stats.update(2, completedList.length);
    stats.update(3, breaks.length);

    const f = tb.state || {};
    const q = (f.q || '').toLowerCase().trim();
    const list = breaks.filter((b) => {
      if (f.status === 'active' && !isOngoingBreak(b)) return false;
      if (f.status === 'overdue' && !isBreakOverdueReturn(b, today)) return false;
      if (f.status === 'completed' && (isOngoingBreak(b) || String(b.status || '').toLowerCase() !== 'completed')) return false;
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

    if (breaks.length === 0) {
      emptyEl.hidden = false;
      footEl.hidden = true;
      return;
    }

    if (!list.length) {
      noMatchEl.hidden = false;
      footEl.hidden = true;
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
      const period = formatBreakPeriod(b.startMonth, b.plannedEndMonth || b.endMonth);
      const returnText = b.actualReturnDate
        ? `${formatDateIN(b.actualReturnDate)}${b.endedEarly ? ' <span class="skb-early-tag">Early</span>' : ''}`
        : (isBreakOverdueReturn(b, today)
          ? `<span class="text-danger font-semibold">Overdue (ended ${esc(formatShortMonthYear(b.plannedEndMonth || b.endMonth))})</span>`
          : '<span class="text-mute">On break</span>');

      const tr = document.createElement('tr');
      const canResume = isSuper && isOngoingBreak(b) && s;
      tr.innerHTML =
        `<td class="sk-id"><b>${esc(dispId)}</b></td>` +
        `<td><a class="skb-student-link" href="#/students/${encodeURIComponent(docId)}">${esc(dispName)}</a>` +
        (s?.phone ? `<div class="skb-sub">${esc(s.phone)}</div>` : '') +
        `</td>` +
        `<td><strong>${esc(period)}</strong></td>` +
        `<td>${returnText}</td>` +
        `<td>${esc(b.reason || '-')}</td>` +
        `<td>${statusPill(b, today)}</td>` +
        `<td class="skb-audit">${formatAuditCell(b)}</td>` +
        `<td class="skb-actions">` +
        (canResume ? `<button type="button" class="sk-act approve skb-resume" data-id="${esc(b.id)}" title="Resume / Rejoin"><i data-lucide="play-circle"></i><span>Resume</span></button>` : '') +
        (docId ? `<a class="sk-act view" href="#/students/${encodeURIComponent(docId)}" title="View student profile"><i data-lucide="user"></i><span>Profile</span></a>` : '') +
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
  }

  function openPickStudentForBreak() {
    const activeStudents = students
      .filter((s) => (s.status || 'active') === 'active')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (!activeStudents.length) {
      showToast({ type: 'info', message: 'No active Unique Kids students available to put on break.' });
      return;
    }
    const popup = openPopup({
      title: 'Select Student for Break',
      subtitle: 'Only active Unique Kids students can start a new break',
      icon: 'pause-circle',
      tone: 'amber'
    });
    const host = document.createElement('div');
    const wrap = document.createElement('div');
    wrap.className = 'ui-field';
    const lab = document.createElement('label');
    lab.textContent = 'Student';
    wrap.append(lab, host);
    popup.container.appendChild(wrap);

    let chosenId = '';
    createSelect(host, {
      options: [{ value: '', label: 'Select active student...', icon: 'user' }].concat(
        activeStudents.map((s) => ({
          value: s.id,
          label: `${formatPersonName(s.name || '')} (${s.studentId || s.id})${s.courseName ? ' · ' + s.courseName : ''}`,
          icon: 'user'
        }))
      ),
      value: '',
      ariaLabel: 'Select student',
      onChange: (val) => {
        chosenId = val;
        okBtn.disabled = !chosenId;
      }
    });

    const foot = document.createElement('div');
    foot.className = 'adm-view-foot';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ui-btn ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => popup.close();
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'ui-btn primary';
    okBtn.disabled = true;
    okBtn.textContent = 'Continue';
    okBtn.onclick = () => {
      const target = activeStudents.find((s) => s.id === chosenId);
      popup.close();
      if (target) {
        openKidsStartBreakModal({
          student: target,
          profile,
          onSuccess: () => {
            window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'break:start' } }));
            return load();
          }
        });
      }
    };
    foot.append(cancelBtn, okBtn);
    popup.container.appendChild(foot);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  if (addBtn && isSuper) {
    addBtn.addEventListener('click', openPickStudentForBreak);
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
