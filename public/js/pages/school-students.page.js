// school-students.page.js — Unique Kids student list (school context, Super Admin).
// Lists all Kids students with Student ID, name, guardian, phone, level, batch,
// admission date, status, and actions (view receipt, change batch, end course,
// permanent delete). Search by name, Student ID, or parent phone. Siblings may share phone.
import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.69';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.69';
import { buildStats, buildToolbar } from '../components/list-page.js?v=1.8.69';
import { createSelect } from '../components/ui-select.js?v=1.8.69';
import { openMenu } from '../components/ui-menu.js?v=1.8.69';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.69';
import { formatINR, formatDateIN } from '../utils/formatter.js?v=1.8.69';
import { isCourseActive } from '../utils/session-rules.js?v=1.8.69';
import { localToday } from '../utils/school-lifecycle.js?v=1.8.69';

const COL = 'students';
const GENDER_LABELS = { male: 'Male', female: 'Female', other: 'Other' };
const STATUS_LABELS = { active: 'Active', completed: 'Completed', archived: 'Archived', inactive: 'Inactive', ended: 'Ended' };

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-students] missing #' + id); return el; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function statusPill(st) {
  const cls = { active: 'uk-pill active', completed: 'uk-pill completed', archived: 'uk-pill completed', inactive: 'uk-pill inactive', ended: 'uk-pill inactive' }[st] || 'uk-pill active';
  return '<span class="' + cls + '">' + (STATUS_LABELS[st] || st) + '</span>';
}

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  const isSuper = profile && profile.role === 'superadmin';

  const rowsHost = $('sk-rows');
  const emptyEl = $('sk-empty');
  const loadingEl = $('sk-loading');
  const noMatchEl = $('sk-no-match');
  const loadErrorEl = $('sk-load-error');
  const loadErrorMsg = $('sk-load-error-msg');
  const addBtn = $('sk-add');
  const footEl = $('sk-foot');
  if (!rowsHost || !emptyEl || !addBtn || !loadingEl || !noMatchEl || !loadErrorEl) return;

  if (!school) {
    setError('Kids Students is only available in Unique Kids.');
    return;
  }
  if (!isSuper) {
    setError('Kids Students is restricted to Super Admin.');
    return;
  }

  // ---------- toolbar ----------
  const tbFilters = [
    { id: 'status', label: 'Status', options: [
      { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' },
      { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' },
      { value: 'inactive', label: 'Inactive' }, { value: 'ended', label: 'Ended' }
    ]},
    { id: 'level', label: 'Level', options: [{ value: 'all', label: 'All levels', icon: 'book-open' }] }
  ];
  const tb = buildToolbar({
    placeholder: 'Search name, Student ID or parent phone',
    filters: tbFilters,
    onChange: () => render(),
    onRefresh: () => load()
  });
  const tbHost = $('sk-toolbar');
  if (tbHost) { tbHost.innerHTML = ''; tb.el.classList.add('sk-toolbar-row'); tbHost.appendChild(tb.el); }

  // ---------- stats ----------
  const stats = buildStats([
    { label: 'Active', value: 0, sub: 'Active students', icon: 'check-circle', tone: 'green' },
    { label: 'Inactive', value: 0, sub: 'Inactive/ended', icon: 'pause-circle', tone: 'amber' }
  ]);
  const statsHost = $('sk-stats');
  if (statsHost) statsHost.appendChild(stats.el);

  // ---------- state ----------
  let students = [], levels = [], batches = [], coursesById = {};
  let touched = false;
  let loadError = null;
  let loading = true;

  function courseOf(id) { return coursesById[id] || {}; }

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
      const [sSnap, cSnap, bSnap] = await Promise.all([
        getDocs(query(collection(db, COL), where('ctx', '==', 'school'))),
        getDocs(query(collection(db, 'courses'), where('ctx', '==', 'school'))),
        getDocs(query(collection(db, 'batches'), where('ctx', '==', 'school')))
      ]);
      students = sSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      levels = cSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(c => (c.status || 'active') === 'active');
      coursesById = {}; levels.forEach(c => { coursesById[c.id] = c; });
      batches = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(b => (b.status || 'active') === 'active');
      tb.setFilterOptions('level', [{ value: 'all', label: 'All levels' }].concat(levels.map(c => ({ value: c.id, label: c.name || c.id, icon: 'book-open' }))));
      render();
    } catch (e) {
      console.error('[school-students] load failed', e);
      setError('Could not load students (' + (e.code || 'error') + ').');
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
    const list = students.filter(s => {
      if (f.status && f.status !== 'all' && (s.status || 'active') !== f.status) return false;
      if (f.level && f.level !== 'all') {
        if (String(s.courseId || '') !== String(f.level)) return false;
      }
      if (q) {
        const hay = [(s.name || ''), (s.studentId || ''), (s.phone || ''), (s.guardianName || '')].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const activeN = students.filter(s => (s.status || 'active') === 'active').length;
    const inactiveN = students.filter(s => { const st = s.status || 'active'; return st === 'completed' || st === 'archived' || st === 'inactive' || st === 'ended'; }).length;

    if (students.length === 0) {
      emptyEl.hidden = false;
      footEl.hidden = true;
      stats.update(0, 0);
      stats.update(1, 0);
      return;
    }

    if (!list.length) {
      noMatchEl.hidden = false;
      footEl.hidden = true;
      stats.update(0, activeN);
      stats.update(1, inactiveN);
      return;
    }

    list.forEach(s => {
      const c = coursesById[s.courseId] || {};
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="sk-id"><b>' + (s.studentId || '-') + '</b></td>' +
        '<td>' + (s.name || '-') + '</td>' +
        '<td class="hide-sm">' + (s.guardianName || '-') + '</td>' +
        '<td class="hide-sm">' + (s.phone || '-') + '</td>' +
        '<td>' + (c.name || '-') + '</td>' +
        '<td>' + (s.batchName || '-') + '</td>' +
        '<td class="hide-sm">' + formatDateIN(s.admissionDate) + '</td>' +
        '<td class="hide-md">' + statusPill(s.status || 'active') + '</td>' +
        '<td class="sk-actions">' +
        '<button type="button" class="sk-act view" data-id="' + s.id + '" title="View receipt"><i data-lucide="file-text"></i></button>' +
        '<button type="button" class="sk-act transfer" data-id="' + s.id + '" title="Change batch"><i data-lucide="shuffle"></i></button>' +
        '<button type="button" class="sk-act end" data-id="' + s.id + '" title="End course"><i data-lucide="x-circle"></i></button>' +
        '<button type="button" class="sk-act delete" data-id="' + s.id + '" title="Permanent delete student"><i data-lucide="trash-2"></i></button>' +
        '</td>';
      rowsHost.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    stats.update(0, activeN);
    stats.update(1, inactiveN);
    if (footEl) {
      footEl.hidden = students.length === 0;
      footEl.textContent = list.length === students.length ? 'Showing all ' + students.length : 'Showing ' + list.length + ' of ' + students.length;
    }

    // row actions
    rowsHost.querySelectorAll('.view').forEach(b => {
      b.addEventListener('click', () => { location.hash = '#/school-admissions/' + b.dataset.id + '/receipt'; });
    });
    rowsHost.querySelectorAll('.transfer').forEach(b => {
      b.addEventListener('click', () => { location.hash = '#/school-transfer/' + b.dataset.id; });
    });
    rowsHost.querySelectorAll('.end').forEach(b => {
      b.addEventListener('click', () => { location.hash = '#/school-end/' + b.dataset.id; });
    });
    rowsHost.querySelectorAll('.delete').forEach(b => {
      b.addEventListener('click', () => { location.hash = '#/school-delete/' + b.dataset.id; });
    });
  }

  // ---------- actions ----------
  addBtn.addEventListener('click', () => {
    location.hash = '#/school-admissions';
  });

  $('sk-load-error-retry').addEventListener('click', () => { load(); });
  $('sk-load-error-back').addEventListener('click', () => { location.hash = '#/dashboard'; });
  $('sk-no-match-clear').addEventListener('click', () => {
    tb.state.q = '';
    tb.state.status = 'all';
    tb.state.level = 'all';
    render();
  });
  const emptyAdd = $('sk-empty-add');
  if (emptyAdd) emptyAdd.addEventListener('click', () => { location.hash = '#/school-admissions'; });

  try { await load(); } catch (e) {
    console.error('[school-students] init load', e);
    setError('Could not load students.');
  }
}
