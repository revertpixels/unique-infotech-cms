import { db } from '../config/firebase-config.js';
import {
  collection,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  serverTimestamp,
  runTransaction,
  writeBatch,
  deleteDoc,
  updateDoc,
  arrayUnion,
  addDoc
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.90';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.90';
import { buildStats, buildToolbar, renderPager } from '../components/list-page.js?v=1.8.90';
import { createSelect } from '../components/ui-select.js?v=1.8.90';
import { openMenu } from '../components/ui-menu.js?v=1.8.90';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.90';
import { openPopup } from '../components/modal.js?v=1.8.90';
import { createDatePicker } from '../components/ui-datepicker.js?v=1.8.90';
import { getSelectedSessionId, getCachedSessions, loadSessions, todayISO } from '../core/sessions.js?v=1.8.90';
import { firstInstallmentOf, admissionState, sessionLabel, installmentSchedule, batchAllowsCourse, batchCourseLabel, isCourseActive } from '../utils/session-rules.js?v=1.8.90';
import { formatINR, formatDateIN, initials } from '../utils/formatter.js?v=1.8.90';
import { validatePhone, validateEmail, validateDOB, validateName, validateRequired } from '../utils/validator.js?v=1.8.90';
import { listStudentsRaw, checkDuplicatePhone, readStudentId, readReceiptNo, writeCounter, createStudentWithDocs, updateStudentWithDocs, updateStudent, deleteStudent } from '../services/admission.service.js?v=1.8.90';
import { feeTotal } from '../utils/fees.js?v=1.8.90';
import { compressTo100KB, readAsDataURL, blobToDataURL, isImageFile, formatBytes } from '../utils/image-compress.js?v=1.8.90';

const COL = 'students';

const GENDERS = [
  { value: 'male', label: 'Male', icon: 'user' },
  { value: 'female', label: 'Female', icon: 'user-circle' },
  { value: 'other', label: 'Other', icon: 'user-x' }
];
const QUALIFICATIONS = [
  { value: 'VIII Pass', label: 'VIII Pass', icon: 'award' },
  { value: 'Secondary (X) Pass', label: 'Secondary (X) Pass', icon: 'award' },
  { value: 'Higher Secondary (XII) Pass', label: 'Higher Secondary (XII) Pass', icon: 'award' },
  { value: 'ITI', label: 'ITI', icon: 'award' },
  { value: 'Diploma', label: 'Diploma', icon: 'award' },
  { value: 'Undergraduate (Graduate)', label: 'Undergraduate (Graduate)', icon: 'award' },
  { value: 'Postgraduate', label: 'Postgraduate', icon: 'award' },
  { value: 'Other', label: 'Other', icon: 'award' }
];
const STATUS_PILLS = [
  { value: 'active', label: 'Active', cls: 'active' },
  { value: 'dropped', label: 'Dropped', cls: 'inactive' },
  { value: 'completed', label: 'Completed', cls: 'completed' },
  { value: 'inactive', label: 'Inactive', cls: 'inactive' },
  { value: 'ended', label: 'Ended', cls: 'archived' },
  { value: 'archived', label: 'Archived', cls: 'archived' },
  { value: 'break', label: 'On break', cls: 'break' }
];
const PAGE_SIZE = 10;

const DOC_KEYS = ['photo', 'signature', 'dobProof', 'marksheet'];
const DOC_LABELS = {
  photo: 'Photo',
  signature: "Student's signature",
  dobProof: 'Date of birth proof',
  marksheet: 'Marksheet (highest qualification)'
};
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Completion rule (T3): a student is treated as "completed" a course when an active admission
// has status === 'completed'. The status itself is set by a later feature; this file only reads it.
const COMPLETED_STATUSES = ['completed'];

// Prerequisite check state.
let prereqCheck = null;          // {status:'auto'|'manual', courseId, sourceSessionId, sourceAdmissionId, verifiedBy, verifiedAt}
let prereqKey = null;            // studentKey + '|' + courseId for which prereqCheck was computed
let prereqTimer = null;          // debounce timer for T4

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[admissions] missing #' + id); return el; }
function $t(id, text) { const el = $(id); if (el) el.textContent = text; }
function $v(id, value) { const el = $(id); if (el) el.value = value; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function isDataUrl(v) { return typeof v === 'string' && /^data:image\/[^;]+;base64,/.test(v); }
function num(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function toDate(s) {
  if (!s) return null;
  const p = String(s).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

export async function mount({ container, profile, ctx }) {
  const youth = ctx === 'youth';
  const isSuper = profile && profile.role === 'superadmin';
  const isHead = profile && profile.role === 'branch_head';
  const fixedBranch = isHead ? profile.branchId : null;

  // ---------- list / filter state (declared first, before any use) ----------
  let students = [], courses = [], batches = [], branches = [], sessions = [];
  let page = 1, filteredList = [];
  let admDateFilter = 'all';   // 'all'|'today'|'last7'|'thismonth'|'lastmonth'|'last3months'|'thisyear'|'custom'
  let admDateFrom = '', admDateTo = '';
  let dateErrEl = null;
  let dateSel = null, dateCustomWrap = null, fromInp = null, toInp = null;

  if (!youth) {
    showToast('Admissions is only available in the Youth Centre.', 'error');
    return;
  }

  const form = $('adm-form');
  const addBtn = $('adm-add');
  const saveBtn = $('adm-save');
  const cancelBtn = $('adm-cancel');
  const lookupInp = $('adm-student-id-lookup');
  const findBtn = $('adm-find-student');
  const lookupStatus = $('adm-lookup-status');
  const rowsHost = $('adm-rows');
  const empty = $('adm-empty');
  const emptyAdd = $('adm-empty-add');
  const footEl = $('adm-foot');
  if (!form || !addBtn || !saveBtn || !cancelBtn || !rowsHost || !empty) return;

  let sessionNotice = null;
  const tableEl = rowsHost.closest('table');
  const anchor = tableEl ? tableEl.parentNode : null; // the wrapper around the table
  if (anchor && anchor.parentNode) {
    sessionNotice = mk('div', 'adm-session-notice');
    sessionNotice.hidden = true;
    anchor.parentNode.insertBefore(sessionNotice, anchor);
  }

  // ---------- form selects ----------
  const genderSel = createSelect($('adm-gender-host'), {
    options: [{ value: '', label: 'Select gender', icon: 'user' }].concat(GENDERS.map(g => ({ value: g.value, label: g.label, icon: g.icon }))),
    value: '', ariaLabel: 'Gender'
  });

  const qualificationSel = createSelect($('adm-qualification-host'), {
    options: [{ value: '', label: 'Select qualification', icon: 'award' }].concat(QUALIFICATIONS.map(q => ({ value: q.value, label: q.label, icon: q.icon }))),
    value: '', ariaLabel: 'Highest qualification'
  });

  let branchSel = null;
  let sessionSel = null;

  // ---------- session select (first field in Course & batch) ----------
  sessionSel = createSelect($('adm-session-host'), {
    options: [{ value: '', label: 'Select a session', icon: 'calendar-clock' }],
    value: '', ariaLabel: 'Session',
    onChange: () => { onSessionChange(); touched = true; refreshForm(); }
  });

  branchSel = createSelect($('adm-branch-host'), {
    options: [{ value: '', label: 'Select a branch', icon: 'git-branch' }],
    value: isSuper ? '' : (fixedBranch || ''),
    ariaLabel: 'Branch',
    disabled: !isSuper,
    onChange: () => { onBranchChange(); touched = true; refreshForm(); }
  });

  const courseSel = createSelect($('adm-course-host'), {
    options: [{ value: '', label: 'Select a course', icon: 'book-open' }],
    value: '', ariaLabel: 'Course',
    onChange: () => { onCourseChange(); touched = true; refreshForm(); }
  });
  const batchSel = createSelect($('adm-batch-host'), {
    options: [{ value: '', label: 'Select a batch', icon: 'layers' }],
    value: '', ariaLabel: 'Batch',
    onChange: () => { onBatchChange(); touched = true; refreshForm(); }
  });

  // ---------- toolbar one row ----------
  const tbFilters = [
    { id: 'status', label: 'Status', options: [
      { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' },
      { value: 'dropped', label: 'Dropped' }, { value: 'completed', label: 'Completed' }
    ]},
    { id: 'course', label: 'Course', options: [{ value: 'all', label: 'All courses', icon: 'book-open' }] },
    { id: 'batch', label: 'Batch', options: [{ value: 'all', label: 'All batches', icon: 'layers' }] }
  ];
  if (isSuper) {
    tbFilters.splice(2, 0, { id: 'branch', label: 'Branch', options: [{ value: 'all', label: 'All branches', icon: 'git-branch' }] });
  }
  const tb = buildToolbar({
    placeholder: 'Search name, student ID, phone or guardian',
    filters: tbFilters,
    onChange: () => { page = 1; render(); },
    onRefresh: () => load(),
    rowLayout: true
  });
  const tbHost = $('adm-toolbar');
  if (tbHost) {
    tbHost.innerHTML = '';
    tbHost.appendChild(tb.el);

    // Admission date filter dropdown + custom range row (inside row 3 container).
    const dateWrap = document.createElement('div');
    dateWrap.className = 'lp-filter';
    const dateLabel = document.createElement('span');
    dateLabel.className = 'lp-filter-label';
    dateLabel.textContent = 'Admission date';
    const dateSelHost = document.createElement('div');
    dateSelHost.className = 'lp-filter-select';
    dateWrap.appendChild(dateLabel);
    dateWrap.appendChild(dateSelHost);
    dateSel = createSelect(dateSelHost, {
      options: [
        { value: 'all', label: 'All dates', icon: 'calendar-clock' },
        { value: 'today', label: 'Today', icon: 'calendar' },
        { value: 'last7', label: 'Last 7 days', icon: 'calendar' },
        { value: 'thismonth', label: 'This month', icon: 'calendar' },
        { value: 'lastmonth', label: 'Last month', icon: 'calendar' },
        { value: 'last3months', label: 'Last 3 months', icon: 'calendar' },
        { value: 'thisyear', label: 'This year', icon: 'calendar' },
        { value: 'custom', label: 'Custom range', icon: 'calendar' }
      ],
      value: admDateFilter, ariaLabel: 'Admission date filter',
      onChange: (v) => {
        admDateFilter = v;
        admDateFrom = ''; admDateTo = '';
        dateCustomWrap.hidden = v !== 'custom';
        page = 1; render();
      }
    });
    tb.addFilterEl(dateWrap);

    dateCustomWrap = document.createElement('div');
    dateCustomWrap.className = 'lp-date-custom';
    dateCustomWrap.hidden = admDateFilter !== 'custom';
    fromInp = document.createElement('input');
    fromInp.type = 'date';
    fromInp.className = 'lp-date-input';
    toInp = document.createElement('input');
    toInp.type = 'date';
    toInp.className = 'lp-date-input';
    const fromLbl = document.createElement('span');
    fromLbl.className = 'lp-date-label';
    fromLbl.textContent = 'From';
    const toLbl = document.createElement('span');
    toLbl.className = 'lp-date-label';
    toLbl.textContent = 'To';
    dateErrEl = document.createElement('span');
    dateErrEl.className = 'lp-date-err';
    dateErrEl.hidden = true;
    dateCustomWrap.appendChild(fromLbl);
    dateCustomWrap.appendChild(fromInp);
    dateCustomWrap.appendChild(toLbl);
    dateCustomWrap.appendChild(toInp);
    dateCustomWrap.appendChild(dateErrEl);
    tb.rowCustom.appendChild(dateCustomWrap);

    fromInp.addEventListener('change', () => {
      admDateFrom = fromInp.value; page = 1; render();
    });
    toInp.addEventListener('change', () => {
      admDateTo = toInp.value; page = 1; render();
    });
  }

  // ---------- stats ----------
  const stats = buildStats([
    { label: 'Total students', value: 0, sub: 'All records', icon: 'users', tone: 'indigo' },
    { label: 'Active', value: 0, sub: 'Currently enrolled', icon: 'check-circle', tone: 'green' },
    { label: 'On break', value: 0, sub: 'Currently on break', icon: 'pause-circle', tone: 'amber' },
    { label: 'Admitted this month', value: 0, sub: 'This calendar month', icon: 'calendar', tone: 'blue' }
  ]);
  const statsHost = $('adm-stats');
  if (statsHost) statsHost.appendChild(stats.el);
  // Clicking "Admitted this month" card (index 3) sets the date filter to This month.
  setTimeout(() => {
    const cards = statsHost.querySelectorAll('.lp-stat');
    if (cards[3]) {
      cards[3].style.cursor = 'pointer';
      cards[3].addEventListener('click', () => {
        admDateFilter = 'thismonth';
        admDateFrom = ''; admDateTo = '';
        dateSel.value = 'thismonth';
        dateCustomWrap.hidden = true;
        page = 1; render();
      });
    }
  }, 0);

  function showRealStats() {
    statsHost.innerHTML = '';
    statsHost.appendChild(stats.el);
  }

  // ---------- state ----------
  let editId = null, editRow = null, saved = {}, touched = false, saving = false, loading = false;
  let returnDoc = null;          // { id, sessionId, studentId, sessionName, previousStudentIds } of found returning student
  let keptDocs = {};             // key -> old doc data { data (base64), name, sizeBytes, type, updatedAt }
  let docAction = {};            // key -> 'keep' | 'replace' | 'remove'

  // ---------- document state ----------
  const docFiles = {}; // key -> { file, compressedBlob, dataUrl }
  const docOriginals = {}; // key -> existing doc data (edit mode)

  // ---------- document compression & preview ----------
  async function compressFile(key) {
    const df = docFiles[key];
    if (!df || !df.file) return null;
    try {
      const kind = key === 'photo' ? 'photo' : key === 'signature' ? 'signature' : 'doc';
      const result = await compressTo100KB(df.file, kind);
      df.compressedBlob = result.blob;
      df.dataUrl = await blobToDataURL(result.blob);
      return result.blob;
    } catch (e) {
      const errBox = $('adm-' + key + '-err');
      if (errBox) errBox.textContent = e.message;
      throw e;
    }
  }

  function setDocPreview(key, file) {
    const preview = $('adm-' + key + '-preview');
    const errBox = $('adm-' + key + '-err');
    const sizeEl = $('adm-' + key + '-size');
    const upload = $('adm-' + key + '-upload');
    const emptyEl = upload ? upload.querySelector('.adm-upload-empty') : null;
    if (!preview) return;
    preview.innerHTML = '';
    preview.style.display = 'none';
    if (errBox) errBox.textContent = '';
    if (!file) {
      docFiles[key] = null;
      if (sizeEl) { sizeEl.textContent = ''; sizeEl.className = 'adm-doc-size'; }
      if (emptyEl) emptyEl.style.display = 'flex';
      if (upload) upload.classList.remove('has-preview');
      return;
    }
    const df = docFiles[key];
    if (!df || !df.dataUrl) return;
    if (!isDataUrl(df.dataUrl)) return;
    preview.style.display = 'flex';
    const box = mk('div', 'adm-doc-box');
    box.style.position = 'relative';
    box.style.overflow = 'visible';
    const img = mk('img', 'adm-doc-thumb');
    img.src = df.dataUrl;
    img.style.objectFit = (key === 'photo') ? 'cover' : 'contain';
    if (key === 'signature') img.style.background = '#FFFFFF';
    box.appendChild(img);
    const remove = mk('button', 'adm-doc-remove');
    remove.type = 'button';
    remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.setAttribute('aria-label', 'Remove file');
    remove.addEventListener('click', (ev) => { ev.stopPropagation(); setDocPreview(key, null); });
    box.appendChild(remove);
    preview.appendChild(box);
    if (emptyEl) emptyEl.style.display = 'none';
    if (upload) upload.classList.add('has-preview');
    if (sizeEl && df.compressedBlob) {
      sizeEl.textContent = 'Saved: ' + formatBytes(df.compressedBlob.size);
      sizeEl.className = 'adm-doc-size saved';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ---------- skeleton UI ----------
  function showSkeleton() {
    statsHost.innerHTML = '';
    const skStats = buildStats([
      { label: 'Total students', value: '', sub: 'All records', icon: 'users', tone: 'indigo' },
      { label: 'Active', value: '', sub: 'Currently enrolled', icon: 'check-circle', tone: 'green' },
      { label: 'On break', value: '', sub: 'Currently on break', icon: 'pause-circle', tone: 'amber' },
      { label: 'Admitted this month', value: '', sub: 'This calendar month', icon: 'calendar', tone: 'blue' }
    ]);
    statsHost.appendChild(skStats.el);
    skStats.el.querySelectorAll('.lp-stat-value, .lp-stat-label, .lp-stat-sub').forEach((el) => {
      el.textContent = '';
      el.classList.add('skel');
    });
    skStats.el.querySelector('.lp-stat-ic').classList.add('skel');
    rowsHost.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const tr = mk('tr', 'adm-sk-row');
      ['w-short', 'w-med', 'w-short', 'w-long', 'w-date', 'w-pill', 'w-act'].forEach((cls) => {
        const td = mk('td');
        td.appendChild(mk('div', 'adm-sk-cell skel ' + cls));
        tr.appendChild(td);
      });
      rowsHost.appendChild(tr);
    }
    if (empty) empty.hidden = true;
    if (footEl) footEl.hidden = true;
  }

  function hideSkeleton() { loading = false; }

  function batchOf(id) { return batches.find((b) => b.id === id) || {}; }
  function batchStatusOf(batchId) {
    // same logic as batchStatus() in batches.page.js: status comes from the batch's session
    const b = batchOf(batchId);
    const s = sessions.find((x) => x.id === b.sessionId);
    if (!s) return 'completed';
    if (s.status === 'upcoming') return 'upcoming';
    if (s.status === 'running') return 'running';
    if (s.status === 'closed') return 'completed';
    if (s.status === 'archived') return 'archived';
    return 'completed';
  }
  function courseOf(id) { return courses.find((c) => c.id === id) || {}; }
  function branchOf(id) { return branches.find((b) => b.id === id) || {}; }
  function branchNameOf(id) {
    if (!id) return '';
    const b = branchOf(id);
    if (b && b.name) return b.name;
    console.warn('[admissions] Unknown branch for id:', id);
    return 'Unknown branch';
  }
function dueLabel(dueISO) {
  const d = toDate(dueISO);
  if (!d) return ' - ';
  return d.getDate() + ' ' + d.toLocaleDateString('en-IN', { month: 'short' });
}

  // ---------- data load ----------
  async function load() {
    showSkeleton();
    try {
      const ctxConstraint = where('ctx', '==', 'youth');
      const branchConstraint = isHead ? where('branchId', '==', fixedBranch) : null;
      const q = branchConstraint ? query(collection(db, 'students'), ctxConstraint, branchConstraint) : query(collection(db, 'students'), ctxConstraint);
      const sSnap = await getDocs(q);
      students = sSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

      const cSnap = await getDocs(query(collection(db, 'courses'), where('ctx', '==', 'youth')));
      courses = cSnap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter(c => (c.status || 'active') === 'active');

      const bSnap = await getDocs(collection(db, 'batches'));
      batches = bSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

      if (isSuper) {
        const brSnap = await getDocs(collection(db, 'branches'));
        branches = brSnap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter(b => (b.status || 'active') === 'active');
      } else if (isHead && fixedBranch) {
        try {
          const brSnap = await getDoc(doc(db, 'branches', fixedBranch));
          if (brSnap.exists()) {
            branches = [Object.assign({ id: brSnap.id }, brSnap.data())];
          } else {
            console.warn('[admissions] Branch doc does not exist for fixedBranch:', fixedBranch);
          }
        } catch (err) {
          console.warn('[admissions] Failed to load own branch:', err);
        }
      }

      const sessSnap = await getDocs(collection(db, 'sessions'));
      sessions = sessSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

      tb.setFilterOptions('course', [{ value: 'all', label: 'All courses', icon: 'book-open' }].concat(courses.map(c => ({ value: c.id, label: (c.courseCode || c.code || c.id), icon: 'book-open' }))));
      const batchOpts = [{ value: 'all', label: 'All batches', icon: 'layers' }];
      batches.forEach(b => {
        const st = batchStatusOf(b.id);
        if (st === 'upcoming' || st === 'running') {
          const c = courseOf(b.courseId);
          batchOpts.push({ value: b.id, label: (b.name || b.id) + ' (' + (c.courseCode || c.code || '') + ')', icon: 'layers' });
        }
      });
      tb.setFilterOptions('batch', batchOpts);
      if (isSuper) {
        tb.setFilterOptions('branch', [{ value: 'all', label: 'All branches', icon: 'git-branch' }].concat(branches.map(b => ({ value: b.id, label: b.name || 'Unknown branch', icon: 'git-branch' }))));
      }

      if (branchSel) {
        if (isSuper) {
          branchSel.setOptions([{ value: '', label: 'Select a branch', icon: 'git-branch' }].concat(branches.map(b => ({ value: b.id, label: b.name || 'Unknown branch', icon: 'git-branch' }))));
        } else {
          const myBr = branches.find(b => b.id === fixedBranch);
          const brLabel = (myBr && myBr.name) ? myBr.name : 'Unknown branch';
          if (!myBr || !myBr.name) {
            console.warn('[admissions] Could not resolve branch name for fixedBranch:', fixedBranch);
          }
          branchSel.setOptions([{ value: fixedBranch, label: brLabel, icon: 'git-branch' }]);
          branchSel.value = fixedBranch;
          branchSel.disabled = true;
        }
      }
      updateLookupPlaceholder();

      courseSel.setOptions([{ value: '', label: 'Select a course', icon: 'book-open' }].concat(courses.filter(isCourseActive).map(c => ({ value: c.id, label: (c.courseCode || c.code || c.id) + ' - ' + (c.name || ''), icon: 'book-open' }))));

      // ---------- session options ----------
      const today = todayISO();
      const sessOpts = [];
      // T1: list only sessions that are open for admission (reuse admissionState helper;
      // closed/ended/archived sessions are not listed at all).
      sessions.filter(s => admissionState(s, today).open)
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
        .forEach((s) => {
          const label = sessionLabel(s);
          sessOpts.push({ value: s.id, label: label, icon: 'calendar-clock' });
        });
      sessionSel.setOptions([{ value: '', label: 'Select a session', icon: 'calendar-clock' }].concat(sessOpts));

      // Default: preselect topbar session if it is open for admission.
      const topSelId = getSelectedSessionId();
      if (topSelId) {
        const topS = sessions.find(s => s.id === topSelId);
        const st0 = admissionState(topS, today);
        if (st0.open) {
          sessionSel.value = topSelId;
          onSessionChange();
        }
      }

      hideSkeleton();
      page = 1;
      showRealStats();
      render();
      // Reload batch options whenever data finishes loading to prevent race condition
      if (courseSel && courseSel.value) {
        onCourseChange();
      }
    } catch (e) {
      console.error('[admissions] load failed', e);
      showRealStats();
      stats.update(0, '-', 'All records');
      stats.update(1, '-', 'Currently enrolled');
      stats.update(2, '-', 'Currently on break');
      stats.update(3, '-', 'This calendar month');
      rowsHost.innerHTML = '';
      const tr = mk('tr');
      const td = mk('td', 'adm-empty');
      td.colSpan = 7;
      td.innerHTML = 'Could not load admissions (' + (e.code || 'error') + '). <button type="button" id="adm-retry" class="ui-btn primary" style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;"><i data-lucide="rotate-ccw"></i>Retry</button>';
      tr.appendChild(td);
      rowsHost.appendChild(tr);
      if (footEl) footEl.hidden = true;
      const retryBtn = $('adm-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => load());
      return;
    } finally {
      hideSkeleton();
    }
  }

  // ---------- form chain ----------
  function isBatchSelectable(b) {
    // Batches with status 'upcoming' OR 'active' (or with no status) must be selectable.
    // Only 'closed'/'completed'/'inactive'/'archived' are excluded.
    const rawStatus = (b.status || '').toLowerCase().trim();
    if (['closed', 'completed', 'inactive', 'archived'].includes(rawStatus)) {
      return { ok: false, reason: `status '${rawStatus}' is excluded` };
    }
    const s = sessions.find(x => String(x.id).trim() === String(b.sessionId).trim());
    if (s) {
      const sStatus = (s.status || '').toLowerCase().trim();
      if (['closed', 'archived'].includes(sStatus)) {
        return { ok: false, reason: `session status '${sStatus}' is excluded` };
      }
    }
    return { ok: true, reason: 'upcoming/active/open' };
  }

  function getBatchOptions(branchId, courseId, sessionId) {
    const opts = [];
    let matchCount = 0;
    const bIdStr = String(branchId || '').trim();
    const sIdStr = String(sessionId || '').trim();
    const cIdStr = String(courseId || '').trim();

    batches.forEach(b => {
      const bBranch = String(b.branchId || '').trim();
      const bSession = String(b.sessionId || '').trim();

      // Check ctx
      let rejectReason = null;
      if (b.ctx && b.ctx !== 'youth') {
        rejectReason = `ctx is '${b.ctx}' (expected youth)`;
      } else if (bIdStr && bBranch !== bIdStr) {
        rejectReason = `branchId mismatch (batch='${bBranch}', selected='${bIdStr}')`;
      } else if (sIdStr && bSession !== sIdStr) {
        rejectReason = `sessionId mismatch (batch='${bSession}', selected='${sIdStr}')`;
      } else if (cIdStr && !batchAllowsCourse(b, cIdStr, courses)) {
        rejectReason = `course check failed (allCourses=${b.allCourses}, courseIds=${b.courseIds ? b.courseIds.join(',') : b.courseId}, selectedCourse='${cIdStr}')`;
      } else {
        const stCheck = isBatchSelectable(b);
        if (!stCheck.ok) {
          rejectReason = stCheck.reason;
        }
      }

      console.log(`[admissions] batch "${b.name || b.id}": ${rejectReason ? 'REJECTED (' + rejectReason + ')' : 'ACCEPTED'}`);

      if (rejectReason) return;

      matchCount++;
      const cap = Number(b.capacity || 0);
      const filled = students.filter(s => s.batchId === b.id && s.status === 'active').length;
      const full = cap > 0 && filled >= cap;
      const label = (b.name || b.id) + ' (' + filled + '/' + cap + ' seats)' + (full ? ' (Full)' : '');
      const hint = b.allCourses ? ' (all courses)' : (b.courseIds && b.courseIds.length > 1 ? ' (shared: ' + batchCourseLabel(b, courses) + ')' : '');
      opts.push({ value: b.id, label: label + hint, icon: 'layers', disabled: full });
    });
    return { opts, matchCount };
  }

  function onSessionChange() {
    const sessionId = sessionSel ? sessionSel.value : '';
    const branchId = branchSel ? branchSel.value : (fixedBranch || '');
    const courseId = courseSel ? courseSel.value : '';
    // Clear batch when session changes.
    batchSel.setOptions([{ value: '', label: 'Select a batch', icon: 'layers' }]);
    batchSel.value = '';
    if (courseId) {
      onCourseChange();
    } else {
      updateFees(null, null);
      updateSeats();
      refreshForm();
    }
    // Amber note when no session is open for admission.
    const noteEl = $('adm-session-note');
    const selS = sessions.find(s => s.id === sessionId);
    if (sessionId) {
      if (noteEl) { noteEl.hidden = true; }
    } else {
      const anyOpen = sessions.some(s => admissionState(s, todayISO()).open);
      if (noteEl) {
        noteEl.hidden = anyOpen;
        if (!anyOpen) noteEl.textContent = 'No session is open for admission. Add an upcoming session in Sessions.';
      }
    }
  }

  function onCourseChange() {
    const sessionId = sessionSel ? sessionSel.value : '';
    const branchId = branchSel ? branchSel.value : (fixedBranch || '');
    const courseId = courseSel.value;
    batchSel.setOptions([{ value: '', label: 'Select a batch', icon: 'layers' }]);
    batchSel.value = '';

    const c = courseOf(courseId);
    const s = sessions.find(sx => sx.id === sessionId);

    if (!courseId) {
      // Still list the branch's batches so the user can see them before picking a course.
      const pre = getBatchOptions(branchId, '', sessionId);
      if (pre.matchCount) batchSel.setOptions([{ value: '', label: 'Select a batch', icon: 'layers' }].concat(pre.opts));
      const prereqEl = $('adm-prereq');
      if (prereqEl) prereqEl.hidden = true;
      updateFees(null, null);
      updateSeats();
      refreshForm();
      return;
    }

    const { opts, matchCount } = getBatchOptions(branchId, courseId, sessionId);
    if (matchCount === 0) {
      batchSel.setOptions([{ value: '', label: 'No batch for this course in this branch and session', icon: 'layers', disabled: true }]);
      batchSel.value = '';
    } else {
      batchSel.setOptions([{ value: '', label: 'Select a batch', icon: 'layers' }].concat(opts));
    }
    const prereqEl = $('adm-prereq');
    if (!c) { if (prereqEl) prereqEl.hidden = true; updateFees(null, null); updateSeats(); return; }
    if (prereqEl) {
      const pre = c.prerequisiteCode || c.prerequisite || c.eligibility || '';
      if (pre) { prereqEl.textContent = 'Requires completion of ' + pre; prereqEl.hidden = false; }
      else { prereqEl.hidden = true; }
    }
    updateFees(c, s);
    updateSeats();
    runPrereqCheck();
  }

  function onBranchChange() {
    onCourseChange();
    updateLookupPlaceholder();
  }

  function updateLookupPlaceholder() {
    const year = new Date().getFullYear();
    const branchId = branchSel ? branchSel.value : (fixedBranch || '');
    const br = branches.find((b) => b.id === branchId);
    const code = br ? (br.code || br.id || '') : '';
    if (lookupInp) lookupInp.placeholder = code ? 'e.g. ' + code + '-' + year + '-0001' : 'e.g. YC-' + year + '-0001';
  }

  // ---------- T1: resolve the prerequisite course ----------
  // Match by prereqId (course id) first, else by course code (case-insensitive, trimmed).
  // Admissions may store only courseId or only courseCode, so both are tried.
  function getPrereq(course) {
    if (!course) return null;
    const id = course.prerequisiteId || course.prereqId; // prerequisiteId first; prereqId as legacy fallback
    if (id) {
      const p = courses.find((c) => c.id === id);
      if (p) return { id: p.id, code: p.courseCode || p.code || '', name: p.name || '' };
    }
    const code = String(course.prerequisiteCode || course.prerequisiteCourseCode || course.prerequisite || '').trim();
    if (code) {
      const p = courses.find((c) => String(c.courseCode || c.code || '').trim().toLowerCase() === code.toLowerCase());
      if (p) return { id: p.id, code: p.courseCode || p.code || '', name: p.name || '' };
    }
    return null;
  }

  // ---------- T2: who is the student ----------
  // Returning student loaded via Find -> use its studentId.
  // Else: exact name (trim, case-insensitive) + dob + phone (digits only). All three required.
  function getStudentKey() {
    if (returnDoc && returnDoc.studentId) return returnDoc.studentId;
    const name = (document.getElementById('adm-name') && document.getElementById('adm-name').value || '').trim();
    const dob = (document.getElementById('adm-dob') && document.getElementById('adm-dob').value || '').trim();
    const phone = (document.getElementById('adm-phone') && document.getElementById('adm-phone').value || '').replace(/\D/g, '');
    if (name && dob && phone) return name.toLowerCase() + '|' + dob + '|' + phone;
    return null;
  }

  // ---------- T4: prerequisite check ----------
  function setPrereqNote(html, cls) {
    const el = $('adm-prereq');
    if (!el) return;
    el.textContent = '';
    const tokens = html.split(/(<b>|<\/b>)/);
    let bold = false;
    tokens.forEach((t) => {
      if (t === '<b>') { bold = true; return; }
      if (t === '</b>') { bold = false; return; }
      const node = bold ? document.createElement('b') : document.createTextNode(t);
      if (bold) node.textContent = t;
      el.appendChild(node);
    });
    el.className = cls || '';
    el.hidden = false;
  }
  function hidePrereqNote() {
    const el = $('adm-prereq');
    if (el) el.hidden = true;
  }

  async function runPrereqCheck() {
    if (prereqTimer) { clearTimeout(prereqTimer); prereqTimer = null; }
    const courseId = courseSel ? courseSel.value : '';
    if (!courseId) { prereqCheck = null; prereqKey = null; hidePrereqNote(); return; }
    const c = courseOf(courseId);
    const prereq = getPrereq(c);
    if (!prereq) { prereqCheck = null; prereqKey = null; hidePrereqNote(); return; }

    const studentKey = getStudentKey();
    if (!studentKey) {
      prereqCheck = null; prereqKey = null;
      setPrereqNote('Enter student details or Find a returning student to check the prerequisite.', 'adm-prereq-note pending');
      return;
    }

    const checkKey = studentKey + '|' + prereq.id;
    // Don't re-run / re-open the dialog for the same student + course; just show the existing result.
    if (prereqKey === checkKey && prereqCheck) {
      showPrereqResult(prereq);
      return;
    }
    prereqKey = checkKey;
    prereqCheck = null;
    hidePrereqNote();

    prereqTimer = setTimeout(async () => {
      prereqTimer = null;
      try {
        const q1 = query(collection(db, 'students'), where('courseId', '==', prereq.id));
        const q2 = query(collection(db, 'students'), where('courseCode', '==', prereq.code));
        const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const seen = new Set();
        let found = null;
        const add = (snap) => {
          snap.docs.forEach((d) => {
            const a = Object.assign({ id: d.id }, d.data());
            if (a.status === 'archived' || a.status === 'deleted') return;
            if (editId && a.id === editId) return;
            if (seen.has(a.id)) return;
            seen.add(a.id);
            if (COMPLETED_STATUSES.includes(a.status)) { found = a; return false; }
          });
        };
        add(s1); add(s2);
        if (found) {
          prereqCheck = {
            status: 'auto',
            courseId: prereq.id,
            sourceSessionId: found.sessionId,
            sourceAdmissionId: found.id
          };
          setPrereqNote('Prerequisite <b>' + prereq.code + '</b> completed in <b>' + (found.sessionName || '') + '.</b>', 'adm-prereq-note ok');
          return;
        }
        // Not found: silent amber note + "Verify manually" button (no dialog yet).
        showPrereqNotFound(prereq);
        return;
      } catch (e) {
        console.error('[admissions] prereq check failed', e);
      }
    }, 400);
  }

  function showPrereqNotFound(prereq) {
    const el = $('adm-prereq');
    if (!el) return;
    el.textContent = '';
    const t1 = document.createTextNode('Prerequisite ');
    const b = document.createElement('b');
    b.textContent = prereq.code;
    const t2 = document.createTextNode(' not found in the system. ');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-btn ghost';
    btn.textContent = 'Verify manually';
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); verifyManually(prereq); });
    el.appendChild(t1, b, t2, btn);
    el.className = 'adm-prereq-note pending';
    el.hidden = false;
  }

  async function verifyManually(prereq) {
    const ok = await confirmDialog({
      title: 'Prerequisite not found',
      message: 'This student is not eligible as per the data currently in the system. Older records may be archived. Have you verified that the student completed ' + prereq.code + ' - ' + prereq.name + '?',
      confirmText: 'Yes, verified', cancelText: 'Cancel'
    });
    if (!ok) return; // Cancel -> stay on form, do not clear course
    prereqCheck = {
      status: 'manual',
      courseId: prereq.id,
      verifiedBy: (profile && profile.email) || '',
      verifiedAt: serverTimestamp()
    };
    setPrereqNote('Prerequisite <b>' + prereq.code + '</b> verified manually.', 'adm-prereq-note manual');
  }

  function showPrereqResult(prereq) {
    if (!prereqCheck) { hidePrereqNote(); return; }
    if (prereqCheck.status === 'auto') {
      const s = sessions.find((x) => x.id === prereqCheck.sourceSessionId) || {};
      setPrereqNote('Prerequisite <b>' + prereq.code + '</b> completed in <b>' + (s.name || '') + '.</b>', 'adm-prereq-note ok');
    } else {
      setPrereqNote('Prerequisite <b>' + prereq.code + '</b> verified manually.', 'adm-prereq-note manual');
    }
  }

  function onBatchChange() {
    updateSeats();
    refreshForm();
  }

  let totalRowEl = null;

  function updateFees(c, s) {
    const host = $('adm-fee-grid');
    if (!host) return;
    host.innerHTML = '';
    if (totalRowEl) { totalRowEl.remove(); totalRowEl = null; }

    const items = [
      { label: 'Admission fee', key: 'admission', cls: 'adm-fee-admission' },
      { label: 'Installment x 4', key: 'installment', cls: 'adm-fee-installment' },
      { label: 'Exam fee', key: 'exam', cls: 'adm-fee-exam' },
      { label: 'Study material fee', key: 'material', cls: 'adm-fee-material' }
    ];
    items.forEach((it) => {
      const div = mk('div', 'adm-fee-box ' + it.cls);
      div.appendChild(mk('div', 'adm-fee-label', it.label));
      let val = '—';
      if (c) {
        const f = c.fees || {};
        const amt = f[it.key] || 0;
        if (it.key === 'installment' && amt > 0) {
          val = formatINR(amt) + ' x 4 = ' + formatINR(amt * 4);
        } else {
          val = formatINR(amt);
        }
      }
      div.appendChild(mk('div', 'adm-fee-amt' + (c ? '' : ' muted'), val));
      host.appendChild(div);
      if (editId) {
        const lock = document.createElement('i');
        lock.setAttribute('data-lucide', 'lock');
        lock.className = 'ui-fee-lock';
        div.appendChild(lock);
      }
    });

    const f = c ? c.fees || {} : {};
    const total = feeTotal(f);
    const tr = mk('div', 'adm-fee-total-row');
    const left = mk('div', 'adm-fee-total-left');
    const label = mk('div', 'adm-fee-total-label', 'Total payable');
    let sentence;
    if (c) {
      const payNowTotal = Number(f.admission || 0) + Number(f.material || 0);
      let payNowPart;
      if (f.material && f.material > 0) {
        payNowPart = '<b>Pay ' + formatINR(payNowTotal) + ' now</b> (admission fee ' + formatINR(f.admission || 0) + ' + study material fee ' + formatINR(f.material || 0) + ')';
      } else {
        payNowPart = '<b>Pay ' + formatINR(f.admission || 0) + ' now</b> as admission fee';
      }
      if (s) {
        const sched = installmentSchedule(s);
        const monthNames = sched.map(function (it) {
          const d = toDate(it.due);
          return d ? d.toLocaleDateString('en-IN', { month: 'short' }) : '';
        });
        const dueItems = monthNames.map(function (m) { return '10 ' + m; });
        const dueStr = dueItems.slice(0, 3).join(', ') + ' and ' + dueItems[3];
        sentence = payNowPart + ', then 4 installments of ' + formatINR(f.installment || 0) + ' due on ' + dueStr;
        if (f.exam && f.exam > 0) {
          sentence += ', and ' + formatINR(f.exam || 0) + ' exam fee before the session ends. Late payment: ₹1 per day after the 10th.';
        } else {
          sentence += '. Late payment: ₹1 per day after the 10th.';
        }
      } else {
        sentence = payNowPart + ', then 4 installments of ' + formatINR(f.installment || 0) + ' due on the 10th of months 3-6 of the session';
        if (f.exam && f.exam > 0) {
          sentence += ', and ' + formatINR(f.exam || 0) + ' exam fee before the session ends. Late payment: ₹1 per day after the 10th.';
        } else {
          sentence += '. Late payment: ₹1 per day after the 10th.';
        }
      }
    } else {
      sentence = 'Select a course to see the full fee details.';
    }
    const summary = mk('div', 'adm-fee-total-sentence' + (c ? '' : ' muted'), sentence);
    summary.innerHTML = sentence;
    left.appendChild(label);
    left.appendChild(summary);
    tr.appendChild(left);
    const amtDiv = mk('div', 'adm-fee-total-amount', c ? formatINR(total) : '—');
    if (!c) amtDiv.classList.add('muted');
    tr.appendChild(amtDiv);
    totalRowEl = tr;
    host.parentNode.insertBefore(tr, host.nextSibling);
  }

  function updateSeats() {
    const el = $('adm-seats');
    if (!el) return;
    const b = batchOf(batchSel.value);
    if (!b || !b.capacity) { el.textContent = ''; el.className = 'adm-seats'; return; }
    const cap = Number(b.capacity);
    const filled = students.filter(s => s.batchId === b.id && s.status === 'active').length;
    el.textContent = 'Seats: ' + filled + ' of ' + cap + ' filled';
    el.className = 'adm-seats' + (filled >= cap ? ' full' : ' ok');
    if (filled >= cap) el.textContent += '  -  batch is full';
  }

  // ---------- returning-student lookup (T1) ----------
  async function findStudent() {
    const studentId = (lookupInp.value || '').trim();
    lookupStatus.textContent = '';
    lookupStatus.className = '';
    if (!studentId) { lookupStatus.textContent = 'Enter a student ID.'; lookupStatus.className = 'ui-err'; lookupInp.focus(); return; }
    returnDoc = null; keptDocs = {}; docAction = {}; prereqCheck = null;
    clearReturnUI();
    try {
    const q1 = query(collection(db, 'students'), where('studentId', '==', studentId));
    const q2 = query(collection(db, 'students'), where('previousStudentIds', 'array-contains', studentId));
    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const byId = snap1.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    const byPrev = snap2.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    const seen = new Set();
    let candidates = [];
    [...byId, ...byPrev].forEach((c) => { if (!seen.has(c.id)) { seen.add(c.id); candidates.push(c); } });
      candidates = candidates.filter((s) => s.status !== 'archived' && s.status !== 'deleted');
      if (candidates.length === 0) {
        lookupStatus.textContent = 'No student with this ID found. Older records may be archived.';
        lookupStatus.className = 'ui-err';
        return;
      }
      candidates.sort((a, b) => (b.admissionDate || '').localeCompare(a.admissionDate || ''));
      const src = candidates[0];
      returnDoc = {
        id: src.id,
        sessionId: src.sessionId,
        studentId: src.studentId,
        sessionName: src.sessionName || '',
        previousStudentIds: src.previousStudentIds || []
      };
      populateStudentFields(src);
      try {
        const [docsSnap, aadhaarSnap] = await Promise.all([
          getDocs(query(collection(db, 'students', src.id, 'docs'))),
          getDoc(doc(db, 'students', src.id, 'aadhaar', 'aadhaar'))
        ]);
        docsSnap.docs.forEach((d) => { keptDocs[d.id] = d.data(); });
        if (aadhaarSnap.exists()) {
          const aData = aadhaarSnap.data();
          if (aData.aadhaar) {
            $v('adm-aadhaar', aData.aadhaar);
          }
        }
      } catch (e) { /* non-fatal */ }
      renderReturnDocs();
      lookupStatus.textContent = 'Details loaded from ' + returnDoc.sessionName + '. You can edit anything.';
      lookupStatus.className = 'ui-err found';
      $t('adm-state', 'Returning student loaded. Fill batch & documents, then save.');
    } catch (e) {
      lookupStatus.textContent = 'Lookup failed: ' + (e.message || 'error');
      lookupStatus.className = 'ui-err';
      console.error('[admissions] findStudent failed', e);
    }
  }

  function populateStudentFields(v) {
    $v('adm-name', v.name || '');
    $v('adm-guardianName', v.guardianName || '');
    $v('adm-phone', v.phone || '');
    $v('adm-altPhone', v.altPhone || '');
    $v('adm-email', v.email || '');
    $v('adm-aadhaar', v.aadhaar || '');
    $v('adm-dob', v.dob || '');
    genderSel.value = v.gender || '';
    qualificationSel.value = v.qualification || '';
    $v('adm-address', v.address || '');
    touched = true;
    refreshForm();
  }

  function clearReturnUI() {
    DOC_KEYS.forEach((k) => {
      const el = $('adm-doc-action-' + k);
      if (el) el.hidden = true;
    });
  }

  function clearReturnState() {
    returnDoc = null; keptDocs = {}; docAction = {};
    clearReturnUI();
    lookupInp.value = '';
    lookupStatus.textContent = '';
    lookupStatus.className = '';
    prereqCheck = null;
  }

  function renderReturnDocs() {
    DOC_KEYS.forEach((k) => {
      const old = keptDocs[k];
      if (!old) { docAction[k] = docAction[k] || 'new'; return; }
      if (!docAction[k]) docAction[k] = 'keep';
      let action = $('adm-doc-action-' + k);
      if (!action) {
        action = mk('div', 'adm-doc-action');
        action.id = 'adm-doc-action-' + k;
        const host = $('adm-' + k + '-upload');
        if (host && host.parentNode) host.parentNode.insertBefore(action, host.nextSibling);
      }
      action.hidden = false;
      const thumb = old.data && isDataUrl(old.data) ? old.data : '';
      action.innerHTML =
        '<div class="adm-doc-action-row">' +
        (thumb ? '<img src="' + thumb + '" class="adm-doc-thumb" alt="existing">' : '<div class="adm-doc-thumb empty" style="width:56px;height:56px;border:1px dashed var(--border);border-radius:6px;display:grid;place-items:center;color:var(--text-mute);font-size:10px;">-</div>') +
        '<div class="adm-doc-action-opts">' +
        '<label style="margin-right:10px;"><input type="radio" name="adm-doc-action-' + k + '" value="keep" ' + (docAction[k] === 'keep' ? 'checked' : '') + '> Keep</label>' +
        '<label style="margin-right:10px;"><input type="radio" name="adm-doc-action-' + k + '" value="replace" ' + (docAction[k] === 'replace' ? 'checked' : '') + '> Replace</label>' +
        '<label><input type="radio" name="adm-doc-action-' + k + '" value="remove" ' + (docAction[k] === 'remove' ? 'checked' : '') + '> Remove</label>' +
        '</div>' +
        '</div>';
      action.querySelectorAll('input[type=radio]').forEach((rb) => {
        rb.addEventListener('change', (ev) => { docAction[k] = ev.target.value; touched = true; refreshForm(); });
      });
    });
  }

  // ---------- validation ----------
  function validate(v) {
    const err = {};
    const nErr = validateName(v.name);
    if (nErr) err.name = nErr;
    const gErr = validateRequired(v.guardianName, 'Guardian name');
    if (gErr) err.guardianName = gErr;
    const pErr = validatePhone(v.phone);
    if (pErr) err.phone = pErr;
    if (v.altPhone) { const aErr = validatePhone(v.altPhone); if (aErr) err.altPhone = aErr; }
    if (v.email) { const eErr = validateEmail(v.email); if (eErr) err.email = eErr; }
    const rawAadhaar = (v.aadhaar || '').replace(/\s+/g, '');
    if (!rawAadhaar) {
      err.aadhaar = 'Aadhaar number is required.';
    } else if (!/^\d{12}$/.test(rawAadhaar)) {
      err.aadhaar = 'Aadhaar number must be exactly 12 digits.';
    }
    const dErr = validateDOB(v.dob);
    if (dErr) err.dob = dErr;
    if (!v.admissionDate) err.admissionDate = 'Admission date is required.';
    if (!v.gender) err.gender = 'Select gender.';
    if (!v.qualification) err.qualification = 'Select highest qualification.';
    const aErr = validateRequired(v.address, 'Address');
    if (aErr) err.address = aErr;
    if (!v.branchId) err.branch = 'Select a branch.';
    if (!v.courseId) err.course = 'Select a course.';
    else {
      const c = courses.find((x) => x.id === v.courseId);
      if (c && !isCourseActive(c)) err.course = 'This course is inactive. Choose another course.';
    }
    if (!v.batchId) err.batch = 'Select a batch.';
    if (!v.sessionId) err.session = 'Select a session.';
    DOC_KEYS.forEach((k) => {
      const hasNew = docFiles[k] && docFiles[k].compressedBlob;
      const kept = returnDoc && docAction[k] === 'keep';
      if (!hasNew && !kept) err[k] = 'Upload ' + DOC_LABELS[k] + '.';
    });
    return err;
  }

  function showErrors(err) {
    const fields = ['name', 'guardianName', 'phone', 'altPhone', 'email', 'aadhaar', 'dob', 'admissionDate', 'address'];
    fields.forEach((k) => {
      const box = $('adm-' + k + '-err');
      if (box) box.textContent = err[k] || '';
      const el = $('adm-' + k);
      if (el && el.parentElement) el.parentElement.classList.toggle('is-invalid', !!err[k]);
    });
    const selectMap = { gender: genderSel, qualification: qualificationSel, session: sessionSel, branch: branchSel, course: courseSel, batch: batchSel };
    const selectErrMap = { gender: 'gender', qualification: 'qualification', session: 'session', branch: 'branch', course: 'course', batch: 'batch' };
    Object.keys(selectMap).forEach((k) => {
      const sel = selectMap[k];
      let hostId;
      if (k === 'branch' && !isSuper) hostId = null;
      else hostId = 'adm-' + k + '-host';
      const host = hostId ? $(hostId) : null;
      const isInvalid = !!err[selectErrMap[k]];
      if (host) host.classList.toggle('is-invalid', isInvalid);
      const box = $('adm-' + selectErrMap[k] + '-err');
      if (box) box.textContent = err[selectErrMap[k]] || '';
    });
    DOC_KEYS.forEach((k) => {
      const box = $('adm-' + k + '-err');
      if (box) box.textContent = err[k] || '';
      const host = $('adm-' + k + '-upload');
      if (host) host.classList.toggle('is-invalid', !!err[k]);
    });
  }

  function readForm() {
    const v = {};
    v.name = $('adm-name') ? $('adm-name').value.trim() : '';
    v.guardianName = $('adm-guardianName') ? $('adm-guardianName').value.trim() : '';
    v.phone = $('adm-phone') ? $('adm-phone').value.trim() : '';
    v.altPhone = $('adm-altPhone') ? $('adm-altPhone').value.trim() : '';
    v.email = $('adm-email') ? $('adm-email').value.trim() : '';
    v.aadhaar = $('adm-aadhaar') ? $('adm-aadhaar').value.replace(/\s+/g, '') : '';
    v.dob = $('adm-dob') ? $('adm-dob').value : '';
    v.admissionDate = $('adm-admissionDate') ? $('adm-admissionDate').value : '';
    v.gender = genderSel ? genderSel.value : '';
    v.qualification = qualificationSel ? qualificationSel.value : '';
    v.address = $('adm-address') ? $('adm-address').value.trim() : '';
    v.branchId = branchSel ? branchSel.value : (fixedBranch || '');
    v.courseId = courseSel ? courseSel.value : '';
    v.batchId = batchSel ? batchSel.value : '';
    v.sessionId = sessionSel ? sessionSel.value : '';
    const selS = sessions.find(s => s.id === v.sessionId);
    v.sessionName = selS ? selS.name : '';
    return v;
  }

  function fillForm(v) {
    $v('adm-name', v.name || '');
    $v('adm-guardianName', v.guardianName || '');
    $v('adm-phone', v.phone || '');
    $v('adm-altPhone', v.altPhone || '');
    $v('adm-email', v.email || '');
    $v('adm-aadhaar', v.aadhaar || '');
    $v('adm-dob', v.dob || '');
    $v('adm-admissionDate', v.admissionDate || '');
    genderSel.value = v.gender || '';
    qualificationSel.value = v.qualification || '';
    $v('adm-address', v.address || '');
    if (sessionSel) {
      sessionSel.value = v.sessionId || '';
      sessionSel.disabled = !!editId;
    }
    if (branchSel) {
      branchSel.value = isSuper ? (v.branchId || '') : (fixedBranch || '');
      branchSel.disabled = !isSuper || !!editId;
    }
    courseSel.value = v.courseId || '';
    courseSel.disabled = !!editId;
    batchSel.value = v.batchId || '';
    batchSel.disabled = !!editId;
    const admDateEl = $('adm-admissionDate');
    if (admDateEl) admDateEl.disabled = !!editId;
    if (editId) {
      ['adm-session-host', 'adm-branch-host', 'adm-course-host', 'adm-batch-host'].forEach((hostId) => {
        const host = $(hostId);
        if (!host) return;
        const btn = host.querySelector('.ui-select-btn');
        if (btn) {
          btn.disabled = true;
          const chev = btn.querySelector('.ui-select-chev');
          if (chev && !btn.querySelector('[data-lucide="lock"]')) {
            chev.setAttribute('data-lucide', 'lock');
            chev.className = 'ui-select-chev';
          }
        }
      });
      if (admDateEl) {
        const wrap = admDateEl.closest('.ui-input-wrap');
        if (wrap && !wrap.querySelector('[data-lucide="lock"]')) {
          const lock = document.createElement('i');
          lock.setAttribute('data-lucide', 'lock');
          lock.className = 'ui-input-lock';
          wrap.appendChild(lock);
        }
      }
    }
    if (editId && v.prereqCheck) {
      prereqCheck = Object.assign({}, v.prereqCheck);
      const pc = getPrereq(courseOf(v.courseId));
      prereqKey = (getStudentKey() || '') + '|' + (pc ? pc.id : '');
      showPrereqResult(pc);
    }
    onCourseChange();
    updateSeats();

    DOC_KEYS.forEach((k) => {
      setDocPreview(k, null);
      if (docOriginals[k]) {
        const preview = $('adm-' + k + '-preview');
        const upload = $('adm-' + k + '-upload');
        const emptyEl = upload ? upload.querySelector('.adm-upload-empty') : null;
        if (preview) {
          preview.style.display = 'flex';
          const box = mk('div', 'adm-doc-box');
          box.style.position = 'relative';
          box.style.overflow = 'visible';
          const img = mk('img', 'adm-doc-thumb');
          if (isDataUrl(docOriginals[k].data)) {
            img.src = docOriginals[k].data;
            img.style.objectFit = (k === 'photo') ? 'cover' : 'contain';
            if (k === 'signature') img.style.background = '#FFFFFF';
            box.appendChild(img);
          }
          const remove = mk('button', 'adm-doc-remove');
          remove.type = 'button';
          remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
          remove.setAttribute('aria-label', 'Remove file');
          remove.addEventListener('click', (ev) => { ev.stopPropagation(); docOriginals[k] = null; setDocPreview(k, null); });
          box.appendChild(remove);
          preview.appendChild(box);
          if (emptyEl) emptyEl.style.display = 'none';
          if (upload) upload.classList.add('has-preview');
          const sizeEl = $('adm-' + k + '-size');
          if (sizeEl) {
            sizeEl.textContent = 'Saved: ' + formatBytes(docOriginals[k].sizeBytes || 0);
            sizeEl.className = 'adm-doc-size saved';
          }
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
        docFiles[k] = docOriginals[k];
      }
    });
  }

  function snapshot() {
    return JSON.stringify(readForm()) + JSON.stringify(Object.keys(docFiles).map(k => [k, !!docFiles[k]]));
  }

  function refreshForm() {
    if (form.hidden) return;
    const dirty = snapshot() !== saved;
    const b = batchOf(batchSel.value);
    let capErr = '';
    if (b && b.capacity) {
      const cap = Number(b.capacity);
      const filled = students.filter(s => s.batchId === b.id && s.status === 'active' && s.id !== editId).length;
      if (filled >= cap) capErr = 'This batch is full.';
    }
    $t('adm-batch-err', capErr);
    saveBtn.disabled = saving || !dirty || !!capErr;
    cancelBtn.disabled = saving;
    const stateEl = $('adm-state');
    if (stateEl) {
      stateEl.textContent = dirty ? 'Unsaved changes' : (editId ? 'No changes yet' : 'Fill in the details');
      stateEl.className = 'save-state' + (dirty ? ' dirty' : '');
    }
    // Amber note when no session is open for admission (new admission only).
    const noteEl = $('adm-session-note');
    if (noteEl && sessionSel && !editId) {
      const anyOpen = sessions.some(s => admissionState(s, todayISO()).open);
      noteEl.hidden = anyOpen;
      if (!anyOpen) noteEl.textContent = 'No session is open for admission. Add an upcoming session in Sessions.';
    }
    if (!editId && noteEl && !noteEl.hidden) saveBtn.disabled = true;
  }

  // ---------- render list ----------
  function admDateRange() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (yy, mm, dd) => yy + '-' + pad(mm + 1) + '-' + pad(dd);
    let from = '', to = '', err = '';
    switch (admDateFilter) {
      case 'today': from = iso(y, m, d); to = iso(y, m, d); break;
      case 'last7': { const s = new Date(now); s.setDate(d - 6); from = iso(s.getFullYear(), s.getMonth(), s.getDate()); to = iso(y, m, d); break; }
      case 'thismonth': from = iso(y, m, 1); to = iso(y, m, new Date(y, m + 1, 0).getDate()); break;
      case 'lastmonth': { const pm = m === 0 ? 11 : m - 1; const py = m === 0 ? y - 1 : y; from = iso(py, pm, 1); to = iso(py, pm, new Date(py, pm + 1, 0).getDate()); break; }
      case 'last3months': { const s = new Date(now); s.setMonth(m - 2); s.setDate(1); from = iso(s.getFullYear(), s.getMonth(), 1); to = iso(y, m, new Date(y, m + 1, 0).getDate()); break; }
      case 'thisyear': from = iso(y, 0, 1); to = iso(y, 11, 31); break;
      case 'custom': from = admDateFrom; to = admDateTo; break;
    }
    if (admDateFilter === 'custom' && from && to && to < from) err = 'To date must be on or after From date.';
    return { from, to, err };
  }

  function render() {
    if (!rowsHost) return;
    try {
      rowsHost.innerHTML = '';
    const f = tb.state || {};
    const dr = admDateRange();
    if (dateErrEl) { dateErrEl.textContent = dr.err || ''; dateErrEl.hidden = !dr.err; }
    const q = (f.q || '').toLowerCase();
    const selSession = getSelectedSessionId();

    // Session filter helper: matches selected session, or if student has no session specified
    const inCurrentSession = (s) => !(selSession && s.sessionId && s.sessionId !== selSession);

    // Hidden students count (session filter hides students with different session)
    const hiddenCount = students.filter(s => selSession && s.sessionId && s.sessionId !== selSession).length;
    if (sessionNotice) {
      if (hiddenCount > 0) {
        sessionNotice.textContent = hiddenCount + ' students are in other sessions - switch session to see them.';
        sessionNotice.hidden = false;
      } else {
        sessionNotice.hidden = true;
      }
    }

    let list = students.filter(s => {
      if (selSession && s.sessionId && s.sessionId !== selSession) return false;
      if (f.status && f.status !== 'all' && s.status !== f.status) return false;
      if (f.course && f.course !== 'all' && s.courseId !== f.course) return false;
      if (f.batch && f.batch !== 'all' && s.batchId !== f.batch) return false;
      if (isSuper && f.branch && f.branch !== 'all' && s.branchId !== f.branch) return false;
      const ad = s.admissionDate || '';
      if (dr.from && ad < dr.from) return false;
      if (dr.to && ad > dr.to) return false;
      if (q) {
        const c = courseOf(s.courseId);
        const hay = [s.name, s.studentId, s.phone, s.guardianName, c.courseCode || c.code, c.name, s.batchName || ''].map(x => (x || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => (b.admissionDate || '').localeCompare(a.admissionDate || ''));
    filteredList = list;

    const total = students.filter(s => inCurrentSession(s)).length;
    const thisMonth = students.filter(s => {
      if (!inCurrentSession(s)) return false;
      if (!s.admissionDate) return false;
      const d = new Date(s.admissionDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const active = students.filter(s => inCurrentSession(s) && s.status === 'active').length;
    const onBreak = students.filter(s => inCurrentSession(s) && (s.status === 'inactive' || s.status === 'ended' || s.status === 'break')).length;
    const selSessionId = getSelectedSessionId();
    const selSName = sessions.find(s => s.id === selSessionId)?.name || selSessionId || 'This session';
    stats.update(0, total, selSName);
    stats.update(1, active, 'Currently enrolled');
    stats.update(2, onBreak, 'Currently on break');
    stats.update(3, thisMonth, 'This calendar month');

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * PAGE_SIZE;
    const pageList = list.slice(start, start + PAGE_SIZE);

    const hasFilter = q || f.status !== 'all' || f.course !== 'all' || f.batch !== 'all' || (isSuper && f.branch !== 'all') || admDateFilter !== 'all' || admDateFrom || admDateTo;

    if (!list.length) {
      rowsHost.innerHTML = '';
      if (!hasFilter) {
        empty.hidden = false;
        if (footEl) footEl.hidden = true;
      } else {
        empty.hidden = true;
        const tr = mk('tr');
        const td = mk('td', 'adm-empty');
        td.colSpan = 7;
        td.innerHTML = 'No students match your filters. <a href="#" id="adm-clear-filters" style="color:var(--primary);cursor:pointer;text-decoration:underline">Clear filters</a>';
        const cl = td.querySelector('#adm-clear-filters');
        cl.addEventListener('click', (ev) => { ev.preventDefault(); tb.state.q = ''; tb.state.status = 'all'; tb.state.course = 'all'; tb.state.batch = 'all'; if (isSuper) tb.state.branch = 'all'; admDateFilter = 'all'; admDateFrom = ''; admDateTo = ''; dateSel.value = 'all'; dateCustomWrap.hidden = true; fromInp.value = ''; toInp.value = ''; render(); });
        tr.appendChild(td);
        rowsHost.appendChild(tr);
        if (footEl) footEl.hidden = true;
      }
    } else {
      if (empty) empty.hidden = true;
      pageList.forEach(s => {
        try {
          const tr = mk('tr');
          const c = courseOf(s.courseId);
          const b = batchOf(s.batchId);
          const pill = STATUS_PILLS.find(x => x.value === s.status) || STATUS_PILLS[0];

          tr.appendChild(mk('td', '', s.studentId || ' - '));

          const tdSt = mk('td');
          tdSt.appendChild(mk('b', '', s.name || ' - '));
          tdSt.appendChild(mk('br'));
          tdSt.appendChild(mk('span', 'adm-sub', s.guardianName || '-'));
          tr.appendChild(tdSt);

          tr.appendChild(mk('td', 'hide-sm', s.phone || ' - '));

          const tdCb = mk('td');
          const code = c.courseCode || c.code || '';
          const courseName = c.name || '';
          const line1 = code && courseName ? (code + '  -  ' + courseName) : (code || courseName || '-');
          tdCb.appendChild(mk('span', '', line1));
          tdCb.appendChild(mk('br'));
          tdCb.appendChild(mk('span', 'adm-sub', b.name || '-'));
          tr.appendChild(tdCb);

          tr.appendChild(mk('td', 'hide-sm', formatDateIN(s.admissionDate)));

          const tdSt2 = mk('td', 'hide-md');
          tdSt2.appendChild(mk('span', 'adm-pill ' + pill.cls, pill.label));
          tr.appendChild(tdSt2);

          const tdAct = mk('td', 'adm-actions');
          const kebab = mk('button', 'ui-kebab');
          kebab.type = 'button';
          kebab.setAttribute('aria-label', 'Actions for ' + (s.name || 'student'));
          kebab.setAttribute('aria-haspopup', 'menu');
          kebab.setAttribute('aria-expanded', 'false');
          const ki = document.createElement('i');
          ki.setAttribute('data-lucide', 'more-vertical');
          kebab.appendChild(ki);
          const st = (s.status || 'active');
          const isSuperAdmin = isSuper;

          // Build status-based menu items (Youth only)
          const baseItems = [];

          // SECTION: View
          const viewItems = [
            {
              label: 'View student',
              icon: 'user',
              onClick: () => {
                if (s.studentId) {
                  location.hash = '#/students/' + s.studentId;
                } else {
                  showToast({ type: 'info', message: 'Student profile page is coming next' });
                }
              }
            },
            {
              label: 'View admission receipt',
              icon: 'file-text',
              onClick: () => {
                location.hash = '#/admissions/' + s.id + '/receipt';
              }
            }
          ];
          if (viewItems.length > 0) {
            baseItems.push({ section: 'View' });
            baseItems.push(...viewItems);
          }

          // SECTION: Manage (Super Admin; Branch Head for own branch)
          const canManage = isSuperAdmin || (isHead && s.branchId === profile.branchId);
          const isActiveOrBreak = st === 'active' || st === 'break';
          const manageItems = [];
          if (canManage && isActiveOrBreak) {
            manageItems.push({
              label: 'Change batch',
              icon: 'shuffle',
              onClick: () => changeBatchPopup(s)
            });
          }
          if (manageItems.length > 0) {
            baseItems.push({ section: 'Manage' });
            baseItems.push(...manageItems);
          }

          // SECTION: Danger zone (Super Admin only)
          if (isSuperAdmin) {
            const dangerItems = [];
            if (isActiveOrBreak) {
              dangerItems.push({
                label: 'Drop student',
                icon: 'user-x',
                danger: true,
                onClick: () => removeStudentPopup(s, 'drop')
              });
            }
            dangerItems.push({
              label: 'Delete permanently',
              icon: 'trash-2',
              danger: true,
              onClick: () => removeStudentPopup(s, 'delete')
            });

            if (dangerItems.length > 0) {
              baseItems.push({ section: 'Danger zone' });
              baseItems.push(...dangerItems);
            }
          }

          kebab.addEventListener('click', () => openMenu(kebab, baseItems));
          tdAct.appendChild(kebab);
          tr.appendChild(tdAct);

          rowsHost.appendChild(tr);
        } catch (e) {
          console.warn('[admissions] row failed', s.id, e);
        }
      });

      if (footEl) {
        renderPager(footEl, { page, pageSize: PAGE_SIZE, totalItems: list.length, onPageChange: (p) => { page = p; render(); } });
      }
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error('[admissions] render failed', e);
      const msg = e && e.message ? e.message : String(e);
      rowsHost.innerHTML = '';
      const tr = mk('tr');
      const td = mk('td', 'adm-empty');
      td.colSpan = 7;
      td.innerHTML = 'Could not load students: ' + msg + '. <button type="button" id="adm-retry" class="ui-btn primary" style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;"><i data-lucide="rotate-ccw"></i>Retry</button>';
      tr.appendChild(td);
      rowsHost.appendChild(tr);
      const retryBtn = $('adm-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => { load(); render(); });
    }
  }

  // ---------- form actions ----------
  async function openForm(r) {
    try {
      clearReturnState();
      DOC_KEYS.forEach((k) => { docFiles[k] = null; docOriginals[k] = null; });
    DOC_KEYS.forEach((k) => { const p = $('adm-' + k + '-preview'); if (p) p.innerHTML = ''; });
    DOC_KEYS.forEach((k) => { const s = $('adm-' + k + '-size'); if (s) s.textContent = ''; });

    editId = r ? r.id : null;
    editRow = r || null;
    const v = r ? {
      name: r.name || '', guardianName: r.guardianName || '', phone: r.phone || '',
      altPhone: r.altPhone || '', email: r.email || '', aadhaar: '', dob: r.dob || '',
      admissionDate: r.admissionDate || '', gender: r.gender || '',
      qualification: r.qualification || '', address: r.address || '',
      branchId: isSuper ? (r.branchId || '') : (fixedBranch || ''), courseId: r.courseId || '', batchId: r.batchId || ''
    } : {
      name: '', guardianName: '', phone: '', altPhone: '', email: '', aadhaar: '', dob: '',
      admissionDate: new Date().toISOString().slice(0, 10), gender: '',
      qualification: '', address: '', branchId: fixedBranch || '', courseId: '', batchId: '', sessionId: '', sessionName: ''
    };
    fillForm(v);
    onBranchChange();
    $t('adm-form-title', r ? 'Edit admission' : 'New admission');
    $t('adm-save-label', r ? 'Save changes' : 'Admit student');
    form.hidden = false;
    touched = false;
    showErrors({});
    saved = snapshot();
    refreshForm();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const nameEl = $('adm-name');
    if (nameEl && nameEl.focus) nameEl.focus({ preventScroll: true });

    if (r) {
      try {
        const [docsSnap, aadhaarSnap] = await Promise.all([
          getDocs(query(collection(db, 'students', r.id, 'docs'))),
          getDoc(doc(db, 'students', r.id, 'aadhaar', 'aadhaar'))
        ]);
        docsSnap.docs.forEach((d) => {
          const data = d.data();
          docOriginals[d.id] = data;
        });
        if (aadhaarSnap.exists()) {
          const aData = aadhaarSnap.data();
          v.aadhaar = aData.aadhaar || '';
        }
        fillForm(v);
        saved = snapshot();
      } catch (e) {
        // non-fatal
      }
    }
    } catch (e) {
      console.error('[admissions] openForm failed', e);
      showToast('Could not open the form (' + (e.message || 'error') + ').', 'error');
    }
  }

  function closeForm() {
    form.hidden = true;
    editId = null;
    editRow = null;
    clearReturnState();
    $v('adm-aadhaar', '');
    DOC_KEYS.forEach((k) => { docFiles[k] = null; docOriginals[k] = null; });
    DOC_KEYS.forEach((k) => {
      const preview = $('adm-' + k + '-preview');
      if (preview) preview.innerHTML = '';
      const size = $('adm-' + k + '-size');
      if (size) size.textContent = '';
    });
    showErrors({});
  }

  function focusFirstError(err) {
    const order = ['name', 'guardianName', 'phone', 'email', 'aadhaar', 'dob', 'admissionDate', 'gender', 'qualification', 'address', 'session', 'branch', 'course', 'batch', ...DOC_KEYS];
    const map = {
      name: 'adm-name', guardianName: 'adm-guardianName', phone: 'adm-phone', email: 'adm-email', aadhaar: 'adm-aadhaar',
      dob: 'adm-dob', admissionDate: 'adm-admissionDate', gender: 'adm-gender-host', qualification: 'adm-qualification-host',
      address: 'adm-address', session: 'adm-session-host', branch: 'adm-branch-host', course: 'adm-course-host', batch: 'adm-batch-host'
    };
    DOC_KEYS.forEach((k) => { map[k] = 'adm-' + k + '-upload'; });
    for (const k of order) {
      if (err[k]) { const el = $(map[k]); if (el && el.focus) { el.focus(); return; } }
    }
  }

  async function save() {
    const v = readForm();
    touched = true;
    const err = validate(v);
    showErrors(err);
    const firstBad = Object.keys(err).find(k => err[k]);
    if (firstBad) {
      $t('adm-state', 'Please fix the highlighted fields');
      const stateEl = $('adm-state');
      if (stateEl) stateEl.className = 'save-state error';
      showToast('Please fix the highlighted fields.', 'error');
      focusFirstError(err);
      return;
    }
    // ---------- T2/T5: prerequisite gate on Admit (new admissions only) ----------
    if (!editId) {
      const cForSave = courseOf(v.courseId);
      if (cForSave && getPrereq(cForSave) && !prereqCheck) {
        const p = getPrereq(cForSave);
        const ok = await confirmDialog({
          title: 'Prerequisite not found',
          message: 'This student is not eligible as per the data currently in the system. Older records may be archived. Have you verified that the student completed ' + p.code + ' - ' + p.name + '?',
          confirmText: 'Yes, verify', cancelText: 'Cancel'
        });
        if (!ok) return; // Cancel -> stay on form, do not clear course
        prereqCheck = {
          status: 'manual',
          courseId: p.id,
          verifiedBy: (profile && profile.email) || '',
          verifiedAt: serverTimestamp()
        };
      }
    }
    // ---------- T3: confirm admission before saving (new admissions) ----------
    if (!editId) {
      const cc = courseOf(v.courseId);
      const bb = batchOf(v.batchId);
      const ss = sessions.find(s => s.id === v.sessionId);
      const totalFee = feeTotal(cc.fees || {});
      const ff = cc ? cc.fees || {} : {};
      const dueNow = Number(ff.admission || 0) + Number(ff.material || 0);
      const summary =
        'Student: ' + v.name + '\n' +
        'Course: ' + (cc.courseCode || cc.code || '') + ' - ' + (cc.name || '') + '\n' +
        'Batch: ' + (bb.name || '-') + '\n' +
        'Session: ' + (ss ? ss.name : '-') + '\n' +
        'Total fee: Rs. ' + formatINR(totalFee) + '\n' +
        'Due now: Rs. ' + formatINR(dueNow);
      const ok = await confirmDialog({
        title: 'Confirm admission',
        message: summary,
        confirmText: 'Admit', cancelText: 'Back'
      });
      if (!ok) return; // Back -> stay on form
    }
    const b = batchOf(v.batchId);
    if (b && b.capacity) {
      const cap = Number(b.capacity);
      const filled = students.filter(s => s.batchId === b.id && s.status === 'active' && s.id !== editId).length;
      if (filled >= cap) {
        $t('adm-batch-err', 'This batch is full (0 seats left).');
        batchSel.focus();
        return;
      }
    }
    const selS = sessions.find(s => s.id === v.sessionId);
    if (selS) {
      const st = admissionState(selS, todayISO());
      if (!st.open) {
        $t('adm-session-err', 'Admission closed for ' + selS.name + ': ' + st.reason + '.');
        $('adm-session-host').classList.add('is-invalid');
        showToast('Admission closed for ' + selS.name + ': first installment date has passed. Please choose another session.', 'error');
        sessionSel.focus();
        return;
      }
    }
    if (!editId) {
      const dup = await checkDuplicatePhone({ branchId: v.branchId, courseId: v.courseId, phone: v.phone });
      if (dup) {
        const ok = await confirmDialog({
          title: 'Duplicate phone',
          message: 'A student with this phone is already admitted to this course. Save anyway?',
          confirmText: 'Save anyway', cancelText: 'Cancel'
        });
        if (!ok) return;
      }
    }
    const who = (profile && profile.email) ? profile.email : '';
    const c = courseOf(v.courseId);
    const bObj = batchOf(v.batchId);
    const br = branchOf(v.branchId);
    const sched = selS ? installmentSchedule(selS) : [];
    const f = c ? c.fees || {} : {};
    const today = new Date().toISOString().slice(0, 10);

    const branchCode = br.code || br.id || '';
    const sessionYear = (selS && selS.startDate) ? selS.startDate.slice(0, 4) : today.slice(0, 4);
    const courseLevel = c ? Number(c.level) : null;
    let studentId, receiptNo, previousStudentIds, newStudentRefId;
    const sourceAdmissionRef = returnDoc ? { sessionId: returnDoc.sessionId, admissionId: returnDoc.id } : null;

    // ---------- documents (read/compress OUTSIDE transaction) ----------
    const docs = {};
    try {
      await Promise.all(DOC_KEYS.map(async (k) => {
        const action = docAction[k] || 'new';
        const df = docFiles[k];
        const old = keptDocs[k];
        if (action === 'remove') { docs[k] = false; return; }
        if (action === 'keep' && old) {
          docs[k] = Object.assign({}, old, { updatedAt: serverTimestamp() });
          return;
        }
        if (df && df.compressedBlob) {
          docs[k] = {
            type: 'image/jpeg',
            mime: 'image/jpeg',
            name: df.file.name,
            sizeBytes: df.compressedBlob.size,
            data: await blobToDataURL(df.compressedBlob),
            updatedAt: serverTimestamp()
          };
          return;
        }
        docs[k] = false;
      }));
    } catch (e) {
      throw e;
    }

    try {
      const saveResult = await runTransaction(db, async (tx) => {
        // ALL reads first (counters), then ALL writes below
        if (editId) {
          studentId = (editRow && editRow.studentId ? editRow.studentId : '');
          receiptNo = (editRow && editRow.receiptNo ? editRow.receiptNo : '');
          previousStudentIds = (editRow && editRow.previousStudentIds) || [];
        } else if (returnDoc) {
          const sid = await readStudentId(tx, { org: 'youth', sessionYear, level: courseLevel });
          const rc = await readReceiptNo(tx, { org: 'youth', type: 'AD', branchCode, date: v.admissionDate });
          studentId = sid.studentId;
          receiptNo = rc.receiptNo;
          previousStudentIds = [returnDoc.studentId, ...(returnDoc.previousStudentIds || [])];
          previousStudentIds = [...new Set(previousStudentIds)];
          writeCounter(tx, sid.ref, sid.next, { org: 'youth', sessionYear, level: courseLevel });
          writeCounter(tx, rc.ref, rc.next, { org: 'youth', type: 'AD', branchCode: branchCode, date: v.admissionDate });
        } else {
          const sid = await readStudentId(tx, { org: 'youth', sessionYear, level: courseLevel });
          const rc = await readReceiptNo(tx, { org: 'youth', type: 'AD', branchCode, date: v.admissionDate });
          studentId = sid.studentId;
          receiptNo = rc.receiptNo;
          previousStudentIds = undefined;
          writeCounter(tx, sid.ref, sid.next, { org: 'youth', sessionYear, level: courseLevel });
          writeCounter(tx, rc.ref, rc.next, { org: 'youth', type: 'AD', branchCode: branchCode, date: v.admissionDate });
        }

        const data = {
          studentId: studentId,
          receiptNo: receiptNo,
          name: v.name,
          guardianName: v.guardianName,
          phone: v.phone,
          altPhone: v.altPhone || '',
          email: v.email || '',
          dob: v.dob,
          gender: v.gender,
          qualification: v.qualification,
          address: v.address,
          ctx: 'youth',
          status: 'active',
          docs: {},
          createdAt: editId ? undefined : serverTimestamp(),
          createdBy: editId ? undefined : who,
          updatedAt: serverTimestamp(),
          updatedBy: who,
          branchId: v.branchId,
          branchName: branchNameOf(v.branchId),
          branchCode: branchCode,
          courseId: v.courseId,
          courseCode: c.courseCode || c.code || '',
          courseName: c.name || '',
          batchId: v.batchId,
          batchName: bObj.name || '',
          sessionId: v.sessionId,
          sessionName: selS ? (selS.name || '') : '',
          admissionDate: v.admissionDate || today,
          feeTotal: feeTotal(c ? c.fees || {} : {}),
          feeSnapshot: c ? c.fees || {} : {},
          feeSchedule: sched.map(function (it) { return { no: it.no, month: it.month, opens: it.opens, due: it.due, amount: f.installment || 0 }; }),
          examFee: f.exam || 0,
          dueAtAdmission: { admission: Number(f.admission || 0), material: Number(f.material || 0), total: Number(f.admission || 0) + Number(f.material || 0) },
          prereqCheck: (c && getPrereq(c)) ? prereqCheck : null,
          ...(previousStudentIds !== undefined ? { previousStudentIds: previousStudentIds } : {}),
          ...(sourceAdmissionRef ? { sourceAdmission: sourceAdmissionRef } : {})
        };

        // Remove undefined values (Firestore rejects undefined)
        Object.keys(data).forEach((k) => { if (data[k] === undefined) delete data[k]; });

        DOC_KEYS.forEach((k) => { data.docs[k] = !!docs[k]; });

        const studentRef = editId ? doc(db, COL, editId) : doc(collection(db, COL));
        newStudentRefId = studentRef.id;
        tx.set(studentRef, data, { merge: !!editId });

        Object.entries(docs).forEach(([key, docData]) => {
          if (docData) {
            const docRef = doc(collection(studentRef, 'docs'), key);
            tx.set(docRef, Object.assign({}, docData, { updatedAt: serverTimestamp() }));
          } else {
            const docRef = doc(collection(studentRef, 'docs'), key);
            tx.delete(docRef);
          }
        });

        if (v.aadhaar) {
          const aadhaarRef = doc(db, COL, studentRef.id, 'aadhaar', 'aadhaar');
          tx.set(aadhaarRef, {
            studentId: studentId,
            aadhaar: v.aadhaar,
            updatedAt: serverTimestamp()
          });
        }

        return { studentId: studentId, receiptNo: receiptNo, id: newStudentRefId };
      });
    studentId = saveResult.studentId;
    receiptNo = saveResult.receiptNo;
    const admissionId = saveResult.id;

    saving = false;
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
    const saveIcon = saveBtn.querySelector('i');
    if (saveIcon) saveIcon.setAttribute('data-lucide', 'save');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    $t('adm-state', 'Saved.');
    const stateEl = $('adm-state');
    if (stateEl) stateEl.className = 'save-state saved';

    if (!editId) {
      // T1: navigate to receipt route instead of showing a dialog
      saved = snapshot();
      clearDirty();
      location.hash = '#/admissions/' + admissionId + '/receipt';
    } else {
      saved = snapshot();
      clearDirty();
      closeForm();
      await load();
      showToast('Admission saved - ' + studentId, 'success');
    }
  } catch (e) {
    console.error('[admissions] save failed', e);
    saving = false;
    refreshForm();
    const saveIcon2 = saveBtn.querySelector('i');
    if (saveIcon2) saveIcon2.setAttribute('data-lucide', 'save');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    $t('adm-state', 'Save failed (' + (e.code || 'error') + ')');
    const stateEl2 = $('adm-state');
    if (stateEl2) stateEl2.className = 'save-state error';
    showToast('Save failed (' + (e.code || 'error') + ').', 'error');
  }
}

  async function viewStudent(s) {
    const c = courseOf(s.courseId);
    const b = batchOf(s.batchId);
    const selS = sessions.find(x => x.id === s.sessionId) || {};
    const back = document.createElement('div');
    back.className = 'ui-modal-back';
    const box = document.createElement('div');
    box.className = 'ui-modal view-student-modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    // Header row
    const head = document.createElement('div');
    head.className = 'adm-view-head';
    const photo = document.createElement('div');
    photo.className = 'adm-view-photo';
    photo.textContent = initials(s.name || '');
    head.appendChild(photo);

    // T1: load photo from students/<id>/docs/photo (one getDoc, not whole subcollection)
    try {
      const photoSnap = await getDoc(doc(db, 'students', s.id, 'docs', 'photo'));
      if (photoSnap.exists()) {
        const data = photoSnap.data();
        const photoUrl = data && data.data ? data.data : null;
        if (photoUrl && isDataUrl(photoUrl)) {
          photo.textContent = '';
          const img = document.createElement('img');
          img.src = photoUrl;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = 'cover';
          img.style.display = 'block';
          photo.appendChild(img);
        }
      }
    } catch (e) {
      // non-fatal, keep initials
    }

    const info = document.createElement('div');
    info.className = 'adm-view-info';
    const nameEl = document.createElement('h2');
    nameEl.className = 'adm-view-name';
    nameEl.textContent = s.name || ' - ';
    // T2: status dot next to name
    const stValue = (s.status || 'active');
    const statusLabel = stValue.charAt(0).toUpperCase() + stValue.slice(1);
    const nameDot = document.createElement('span');
    nameDot.className = 'adm-view-status-dot ' + (stValue === 'active' ? 'active' : stValue === 'dropped' ? 'dropped' : 'completed');
    nameDot.title = statusLabel;
    nameDot.setAttribute('aria-label', statusLabel);
    nameEl.appendChild(nameDot);
    const noEl = document.createElement('div');
    noEl.className = 'adm-view-no';
    noEl.textContent = 'Student ID: ' + (s.studentId || ' - ');
    const rcptEl = document.createElement('div');
    rcptEl.className = 'adm-view-no';
    rcptEl.style.fontSize = '12px';
    rcptEl.style.color = 'var(--text-mute)';
    rcptEl.textContent = 'Receipt: ' + (s.receiptNo || ' - ');
    info.appendChild(nameEl);
    info.appendChild(noEl);
    info.appendChild(rcptEl);
    head.appendChild(info);

    // T3: header buttons in ONE flex container, equal gaps, no button margins
    const btns = document.createElement('div');
    btns.className = 'adm-view-actions';
    const viewRcpt = document.createElement('button');
    viewRcpt.type = 'button';
    viewRcpt.className = 'ui-btn ghost';
    viewRcpt.textContent = 'View receipt';
    viewRcpt.addEventListener('click', (ev) => { ev.stopPropagation(); back.remove(); location.hash = '#/admissions/' + s.id + '/receipt'; });
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ui-btn primary';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', (ev) => { ev.stopPropagation(); back.remove(); openForm(s); });
    const xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.className = 'ui-btn ghost adm-view-close';
    xBtn.setAttribute('aria-label', 'Close');
    xBtn.innerHTML = '<i data-lucide="x" width="18" height="18" stroke-width="2"></i>';
    xBtn.addEventListener('click', (ev) => { ev.stopPropagation(); back.remove(); });
    btns.appendChild(viewRcpt);
    btns.appendChild(editBtn);
    btns.appendChild(xBtn);
    head.appendChild(btns);
    box.appendChild(head);

    // Card grid sections
    const body = document.createElement('div');
    body.className = 'adm-view-body';
    const grid = document.createElement('div');
    grid.className = 'adm-view-grid';

    const pc = s.prereqCheck || null;
    let prereqText = 'Not required';
    if (pc && pc.status === 'auto') prereqText = 'Verified automatically';
    else if (pc && pc.status === 'manual') prereqText = 'Verified manually';

    const feeTotal = Number(s.feeTotal || 0);
    const paid = Number((s.dueAtAdmission && s.dueAtAdmission.total) || 0);
    const balance = feeTotal - paid;
    const nextDue = (s.feeSchedule && Array.isArray(s.feeSchedule) && s.feeSchedule.length > 0) ? formatDateIN(s.feeSchedule[0].due) || '-' : '-';

    const sections = [
      { id: 'personal', icon: 'user', title: 'Personal', rows: [
        ['Guardian', s.guardianName || '-'],
        ['DOB', formatDateIN(s.dob)],
        ['Gender', s.gender ? (s.gender.charAt(0).toUpperCase() + s.gender.slice(1)) : '-'],
        ['Highest qualification', s.qualification || '-']
      ]},
      { id: 'contact', icon: 'phone', title: 'Contact', rows: [
        ['Phone', s.phone || '-'],
        ['Alt phone', s.altPhone || '-'],
        ['Email', s.email || '-'],
        ['Address', s.address || '-']
      ]},
      { id: 'course', icon: 'book-open', title: 'Course & batch', rows: [
        ['Session', selS.name || '-'],
        ['Branch', (s.branchName && s.branchName !== s.branchId) ? s.branchName : (branchNameOf(s.branchId) || 'Unknown branch')],
        ['Course', ((c.courseCode || c.code || '') + '  -  ' + (c.name || '')) || '-'],
        ['Batch', b.name || '-'],
        ['Admission date', formatDateIN(s.admissionDate)],
        ['Prerequisite status', prereqText]
      ]},
      { id: 'fees', icon: 'wallet', title: 'Fees', rows: [
        ['Total course fee', formatINR(feeTotal)],
        ['Paid at admission', formatINR(paid)],
        ['Balance', formatINR(balance)],
        ['Next due instalment', nextDue]
      ]}
    ];

    sections.forEach(sec => {
      const card = document.createElement('div');
      card.className = 'adm-view-card';
      const ch = document.createElement('div');
      ch.className = 'adm-view-card-head';
      const ico = document.createElement('i');
      ico.setAttribute('data-lucide', sec.icon);
      const title = document.createElement('span');
      title.className = 'adm-view-card-title';
      title.textContent = sec.title;
      ch.appendChild(ico);
      ch.appendChild(title);
      card.appendChild(ch);

      const body = document.createElement('div');
      body.className = 'adm-view-card-body';

      const tbl = document.createElement('table');
      tbl.className = 'adm-view-table';
        sec.rows.forEach(([label, value]) => {
          const tr = document.createElement('tr');
          const tdL = document.createElement('td');
          tdL.className = 'adm-view-label';
          tdL.textContent = label;
          const tdV = document.createElement('td');
          tdV.className = 'adm-view-value';
          tdV.textContent = value;
          tr.appendChild(tdL);
          tr.appendChild(tdV);
          tbl.appendChild(tr);
        });
        body.appendChild(tbl);
      card.appendChild(body);
      grid.appendChild(card);
    });
    body.appendChild(grid);
    box.appendChild(body);

    back.appendChild(box);
    document.body.appendChild(back);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    back.addEventListener('click', (ev) => { if (ev.target === back) back.remove(); });
  }

  async function changeStatus(s) {
    const next = s.status === 'active' ? 'dropped' : (s.status === 'dropped' ? 'active' : s.status);
    const ok = await confirmDialog({
      title: 'Change status',
      message: 'Set "' + (s.name || 'this student') + '" to ' + next + '?',
      confirmText: next.charAt(0).toUpperCase() + next.slice(1), cancelText: 'Cancel'
    });
    if (!ok) return;
    try {
      await updateStudent(s.id, { status: next });
      await load();
      showToast('Status changed to ' + next + '.', 'success');
    } catch (e) {
      showToast('Status change failed (' + (e.code || 'error') + ').', 'error');
    }
  }

  async function tryDelete(s) {
    if (isHead) return;
    if (!form.hidden && !saveBtn.disabled && editId !== s.id && !(await confirmLeave({ clear: false }))) return;
    const ok = await confirmDialog({
      title: 'Delete admission?',
      message: 'Delete "' + (s.name || 'this student') + '" (' + (s.studentId || '') + ')? This cannot be undone. Type DELETE to confirm.',
      confirmText: 'Delete', danger: true, requireText: 'DELETE'
    });
    if (!ok) return;
    try {
      await deleteStudent(s.id);
      if (editId === s.id) closeForm();
      await load();
      showToast('Admission deleted.', 'success');
    } catch (e) {
      showToast('Delete failed (' + (e.code || 'error') + ').', 'error');
    }
  }

  // ---------- status history helper ----------
  async function appendStatusHistory(studentId, action, fromStatus, toStatus, details) {
    try {
      const snap = await getDoc(doc(db, COL, studentId));
      if (!snap.exists()) return;
      const data = snap.data();
      const hist = Array.isArray(data.statusHistory) ? data.statusHistory.slice() : [];
      hist.push({
        action: action,
        fromStatus: fromStatus,
        toStatus: toStatus,
        changedBy: (profile && profile.email) || '',
        changedAt: serverTimestamp(),
        details: details || ''
      });
      await updateDoc(doc(db, COL, studentId), { statusHistory: hist, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error('[statusHistory] failed', e);
    }
  }

  // ---------- Popup Helpers ----------
  function courseNameOf(s) {
    const c = (courses && courses.find ? courses.find(x => x.id === s.courseId) : null) || {};
    return c.name || s.courseName || c.courseCode || c.code || s.courseCode || s.courseId || '-';
  }

  function studentSub(s) {
    return `${s.name || 'Student'} - ${s.studentId || '-'} - ${courseNameOf(s)} / ${s.batchName || 'Batch'} / ${s.sessionName || 'Session'}`;
  }

  function formatTiming(b) {
    if (!b) return '';
    return b.timing || b.time || b.slot || b.schedule || '';
  }

  function pField(label, el, { half = false, required = false } = {}) {
    const w = mk('div', 'pk-field' + (half ? ' half' : ''));
    const lr = mk('div', 'pk-label-row');
    const lab = mk('label', null, label);
    if (required) {
      const em = mk('span', 'pk-req', '*');
      em.style.color = 'var(--danger)';
      em.style.marginLeft = '4px';
      lab.appendChild(em);
    }
    lr.appendChild(lab);
    w.appendChild(lr);
    w.appendChild(el);
    return w;
  }

  function pFieldRow(f1, f2) {
    const row = mk('div', 'pk-field-row-2');
    row.appendChild(f1);
    row.appendChild(f2);
    return row;
  }

  function pTextarea(placeholder = '') {
    const wrap = mk('div', 'ui-input-wrap top');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', 'file-text');
    wrap.appendChild(ic);
    const ta = document.createElement('textarea');
    ta.className = 'ui-input';
    ta.rows = 2;
    if (placeholder) ta.placeholder = placeholder;
    wrap.appendChild(ta);
    return { wrap, textarea: ta };
  }

  function pTypeConfirm(targetId) {
    const wrap = mk('div', 'ui-input-wrap');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', 'key-round');
    wrap.appendChild(ic);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'ui-input pk-confirm-id';
    inp.placeholder = targetId || '';
    inp.autocomplete = 'off';
    inp.addEventListener('input', () => {
      if (inp.value.trim() === String(targetId || '')) {
        inp.classList.add('matched');
      } else {
        inp.classList.remove('matched');
      }
    });
    wrap.appendChild(inp);
    return { wrap, input: inp };
  }

  function pInfoGrid3(rows) {
    const g = mk('div', 'pk-info-grid pk-info-grid-3');
    rows.forEach(([label, value]) => {
      const cell = mk('div', 'pk-info-cell');
      cell.appendChild(mk('div', 'pk-info-label', label));
      cell.appendChild(mk('div', 'pk-info-value', String(value ?? '-')));
      g.appendChild(cell);
    });
    return g;
  }

  function pWarn(text) {
    const w = mk('div', 'pk-warn');
    w.innerHTML = `<i data-lucide="alert-triangle"></i><span>${text}</span>`;
    return w;
  }

  function pNote(text) {
    const n = mk('div', 'pk-note');
    n.innerHTML = `<i data-lucide="info"></i><span>${text}</span>`;
    return n;
  }

  function pButtons(popup, label, { icon = '', tone = 'default' } = {}) {
    const foot = mk('div', 'adm-view-foot');
    const c = mk('button', 'ui-btn ghost', 'Cancel');
    c.type = 'button';
    c.addEventListener('click', () => popup.close());
    const ok = mk('button', 'ui-btn ' + (tone === 'danger' ? 'danger' : (tone === 'success' ? 'success' : 'primary')));
    ok.type = 'button';
    ok.disabled = true;
    let originalHtml = '';
    if (icon) {
      originalHtml = `<i data-lucide="${icon}"></i><span>${label}</span>`;
    } else {
      originalHtml = `<span>${label}</span>`;
    }
    ok.innerHTML = originalHtml;
    foot.appendChild(c);
    foot.appendChild(ok);
    popup.container.appendChild(foot);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    function setSaving(isSaving) {
      if (isSaving) {
        ok.disabled = true;
        c.disabled = true;
        ok.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>Saving...</span>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      } else {
        ok.innerHTML = originalHtml;
        c.disabled = false;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }

    return { cancelBtn: c, okBtn: ok, setSaving };
  }

  // ---------- popup: change batch ----------
  async function changeBatchPopup(s) {
    // Eligible batches list:
    // b.ctx === 'youth'
    // b.branchId === s.branchId
    // b.sessionId === s.sessionId
    // b.status === 'active'
    // batchAllowsCourse(b, s.courseId, courses)
    // Exclude current batch (b.id !== s.batchId)
    const eligibleBatches = batches.filter((b) => {
      const isYouth = (b.ctx || 'youth') === 'youth';
      const sameBranch = b.branchId === s.branchId;
      const sameSession = b.sessionId === s.sessionId;
      const isActive = (b.status || 'active') === 'active';
      const allowsCourse = batchAllowsCourse(b, s.courseId, courses);
      const notCurrent = b.id !== s.batchId;
      return isYouth && sameBranch && sameSession && isActive && allowsCourse && notCurrent;
    });

    if (eligibleBatches.length === 0) {
      showToast({ type: 'warning', message: 'No other open batch for this course in this branch and session' });
      return;
    }

    let saving = false;
    const popup = openPopup({
      title: 'Change batch',
      subtitle: studentSub(s),
      icon: 'shuffle',
      tone: 'default',
      saving: () => saving
    });
    const c = popup.container;

    // Target batch dropdown using createSelect
    const batchSelectHost = document.createElement('div');
    const batchOpts = [{ value: '', label: 'Select destination batch' }].concat(
      eligibleBatches.map((b) => {
        const timing = formatTiming(b);
        const name = b.name || b.id;
        return {
          value: b.id,
          label: timing ? `${name} (${timing})` : name,
          icon: 'layers'
        };
      })
    );

    let selectedBatchId = '';
    const capInfo = mk('div', 'pk-cap-info');
    capInfo.style.fontSize = '12px';
    capInfo.style.marginTop = '6px';
    capInfo.style.color = 'var(--text-mute)';

    const capWarn = pWarn('');
    capWarn.hidden = true;

    const bSelect = createSelect(batchSelectHost, {
      options: batchOpts,
      value: '',
      ariaLabel: 'New batch',
      onChange: (v) => {
        selectedBatchId = v;
        updateCapacityDisplay();
        check();
      }
    });

    function updateCapacityDisplay() {
      if (!selectedBatchId) {
        capInfo.textContent = '';
        capWarn.hidden = true;
        return;
      }
      const targetB = eligibleBatches.find(b => b.id === selectedBatchId);
      if (!targetB) return;

      const activeCount = students.filter(
        st => (st.ctx || 'youth') === 'youth' &&
              st.batchId === targetB.id &&
              (st.status === 'active' || st.status === 'break')
      ).length;
      const cap = Number(targetB.capacity || targetB.maxStudents || 0);

      if (cap > 0) {
        capInfo.textContent = `Batch capacity: ${activeCount} / ${cap} students`;
        if (activeCount >= cap) {
          capWarn.querySelector('span').textContent = `This batch is at capacity (${activeCount}/${cap}). You can still proceed if needed.`;
          capWarn.hidden = false;
        } else {
          capWarn.hidden = true;
        }
      } else {
        capInfo.textContent = `Current batch strength: ${activeCount} students`;
        capWarn.hidden = true;
      }
    }

    const dateHost = document.createElement('div');
    const dPicker = createDatePicker(dateHost, { value: todayISO(), ariaLabel: 'Effective date', onChange: () => check() });

    const fBatch = pField('New batch', batchSelectHost, { required: true });
    fBatch.appendChild(capInfo);
    const fDate = pField('Effective date', dateHost, { required: true });
    c.appendChild(pFieldRow(fBatch, fDate));
    c.appendChild(capWarn);

    const { wrap: reasonWrap, textarea: reasonTa } = pTextarea('Reason for batch change');
    c.appendChild(pField('Reason', reasonWrap, { required: true }));

    c.appendChild(pNote('Past payments and receipts will remain unchanged. Only the student\'s batch will change.'));

    const { cancelBtn, okBtn, setSaving } = pButtons(popup, 'Change batch', { icon: 'shuffle', tone: 'default' });

    const check = () => {
      okBtn.disabled = saving || !selectedBatchId || !reasonTa.value.trim() || !dPicker.value;
    };
    reasonTa.addEventListener('input', check);
    check();

    okBtn.addEventListener('click', async () => {
      const destBatchId = selectedBatchId;
      const effectiveDate = dPicker.value;
      const reason = reasonTa.value.trim();
      const destBatch = eligibleBatches.find((b) => b.id === destBatchId);
      if (!destBatch) return;

      saving = true;
      setSaving(true);

      try {
        await updateDoc(doc(db, COL, s.id), {
          batchId: destBatch.id,
          batchName: destBatch.name || destBatch.id,
          batchHistory: arrayUnion({
            fromBatchId: s.batchId || '',
            fromBatchName: s.batchName || '',
            toBatchId: destBatch.id,
            toBatchName: destBatch.name || destBatch.id,
            date: effectiveDate,
            reason: reason,
            by: (profile && profile.email) || 'admin',
            at: new Date().toISOString()
          }),
          updatedAt: serverTimestamp()
        });

        showToast({ type: 'success', message: `Batch changed to ${destBatch.name || destBatch.id}` });
        popup.close();
        await load();
        render();
      } catch (err) {
        console.error('[admissions] change batch failed', err);
        showToast({ type: 'error', message: 'Could not change batch: ' + (err.message || 'error') });
        saving = false;
        setSaving(false);
      }
    });
  }

  // ---------- Session-Scoped Youth Drop & Delete ----------
  async function purgeYouthAdmission(s, meta) {
    // 1. Gather all subcollection documents of students/{s.id}: docs, payment, aadhaar
    const subcols = ['docs', 'payment', 'aadhaar'];
    const subRefs = [];
    for (const sc of subcols) {
      try {
        const snap = await getDocs(collection(db, COL, s.id, sc));
        snap.docs.forEach(d => subRefs.push(d.ref));
      } catch (_) { /* non-fatal */ }
    }

    // 2. Gather root collection documents: bills, payments, waivers, breaks, transfers, enrolments
    // Strictly session-scoped: delete only records where studentId == s.id OR (studentId == s.studentId && sessionId == s.sessionId)
    const rootCols = ['bills', 'payments', 'waivers', 'breaks', 'transfers', 'enrolments'];
    const rootRefs = [];
    for (const rc of rootCols) {
      try {
        const snap1 = await getDocs(query(collection(db, rc), where('studentId', '==', s.id)));
        snap1.docs.forEach(d => {
          if (!rootRefs.some(r => r.path === d.ref.path)) rootRefs.push(d.ref);
        });

        if (s.studentId && s.studentId !== s.id && s.sessionId) {
          const snap2 = await getDocs(query(collection(db, rc), where('studentId', '==', s.studentId)));
          snap2.docs.forEach(d => {
            const data = d.data();
            if (data.sessionId === s.sessionId) {
              if (!rootRefs.some(r => r.path === d.ref.path)) rootRefs.push(d.ref);
            }
          });
        }
      } catch (_) { /* non-fatal */ }
    }

    const totalRecords = subRefs.length + rootRefs.length + 1;

    // 3. Log to root collection /deletionLog BEFORE deleting
    try {
      await addDoc(collection(db, 'deletionLog'), {
        ctx: 'youth',
        type: meta.mode,
        studentCode: s.studentId || '',
        name: s.name || '',
        sessionName: s.sessionName || '',
        courseName: courseNameOf(s),
        branchName: s.branchName || '',
        reason: meta.reason || '',
        lastDay: meta.lastDay || '',
        recordsDeleted: totalRecords,
        by: (profile && profile.email) || 'admin',
        at: new Date().toISOString()
      });
    } catch (err) {
      console.warn('[youth] deletion log failed', err);
    }

    // 4. Delete in chunks of max 400
    const allRefs = [...subRefs, ...rootRefs];
    for (let i = 0; i < allRefs.length; i += 400) {
      const wb = writeBatch(db);
      allRefs.slice(i, i + 400).forEach(r => wb.delete(r));
      await wb.commit();
    }

    // 5. Delete the student document itself
    await deleteDoc(doc(db, COL, s.id));

    return totalRecords;
  }

  // ---------- popup: drop / delete ----------
  async function removeStudentPopup(s, mode) {
    const isDrop = mode === 'drop';
    let saving = false;
    const popup = openPopup({
      title: isDrop ? 'Drop student' : 'Delete permanently',
      subtitle: studentSub(s),
      icon: isDrop ? 'user-x' : 'trash-2',
      tone: 'danger',
      wide: true,
      saving: () => saving
    });
    const c = popup.container;

    // 3-column info grid
    const infoRows = [
      ['Student ID', s.studentId || '-'],
      ['Session', s.sessionName || s.sessionId || '-'],
      ['Course', courseNameOf(s)]
    ];
    c.appendChild(pInfoGrid3(infoRows));

    // Warning line explaining session-scoped action
    const warn = pWarn(
      isDrop
        ? `This drops the student from the ${s.sessionName || 'current'} session ONLY. Records from other sessions will not be affected.`
        : `Permanent deletion: this completely removes the admission and all fee records for ${s.sessionName || 'current'} ONLY. Other sessions of this student are kept. This action cannot be undone.`
    );
    c.appendChild(warn);

    let reasonTa = null;
    let lastDayPicker = null;

    if (isDrop) {
      const lastDayHost = document.createElement('div');
      lastDayPicker = createDatePicker(lastDayHost, {
        value: todayISO(),
        max: todayISO(),
        ariaLabel: 'Last day of attendance',
        onChange: () => check()
      });
      c.appendChild(pField('Last day attended', lastDayHost, { half: true, required: true }));

      const { wrap: reasonWrap, textarea } = pTextarea('Reason for dropping');
      reasonTa = textarea;
      c.appendChild(pField('Reason for dropping', reasonWrap, { required: true }));
    }

    // Type student ID to confirm
    const { wrap: confirmWrap, input: confirmInp } = pTypeConfirm(s.studentId);
    c.appendChild(pField(`Type student ID (${s.studentId || ''}) to confirm`, confirmWrap, { required: true }));

    const { cancelBtn, okBtn, setSaving } = pButtons(
      popup,
      isDrop ? 'Drop student' : 'Delete permanently',
      { icon: isDrop ? 'user-x' : 'trash-2', tone: 'danger' }
    );

    const check = () => {
      const idOk = confirmInp.value.trim() === String(s.studentId || '');
      if (isDrop) {
        okBtn.disabled = saving || !idOk || !reasonTa.value.trim() || !lastDayPicker.value;
      } else {
        okBtn.disabled = saving || !idOk;
      }
    };

    confirmInp.addEventListener('input', check);
    if (isDrop && reasonTa) reasonTa.addEventListener('input', check);
    check();

    okBtn.addEventListener('click', async () => {
      saving = true;
      setSaving(true);
      try {
        await purgeYouthAdmission(s, {
          mode,
          reason: isDrop ? reasonTa.value.trim() : 'Permanent deletion via menu',
          lastDay: isDrop ? lastDayPicker.value : ''
        });

        showToast({
          type: 'success',
          message: isDrop ? `Student dropped from ${s.sessionName || 'session'}` : 'Admission deleted permanently'
        });
        popup.close();
        if (editId === s.id) closeForm();
        await load();
        render();
      } catch (err) {
        console.error('[admissions] purgeYouthAdmission failed', err);
        showToast({ type: 'error', message: 'Operation failed: ' + (err.message || 'unknown error') });
        saving = false;
        setSaving(false);
      }
    });
  }

  // ---------- event listeners ----------
  addBtn.addEventListener('click', async () => {
    if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
    openForm(null);
  });
  findBtn.addEventListener('click', () => findStudent());
  lookupInp.addEventListener('input', () => { lookupStatus.textContent = ''; lookupStatus.className = ''; });
  lookupInp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); findStudent(); } });
  cancelBtn.addEventListener('click', async () => {
    if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
    closeForm();
  });
  if (emptyAdd) {
    emptyAdd.addEventListener('click', async () => {
      if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
      openForm(null);
    });
  }
  registerDirty(() => !form.hidden && !saveBtn.disabled && !saving);
  const aadhInp = $('adm-aadhaar');
  if (aadhInp) {
    aadhInp.addEventListener('blur', () => {
      aadhInp.value = aadhInp.value.replace(/\s+/g, '');
    });
  }
  form.addEventListener('input', (ev) => {
    touched = true;
    refreshForm();
    const id = ev.target && ev.target.id;
    if (id === 'adm-name' || id === 'adm-dob' || id === 'adm-phone' || id === 'adm-student-id-lookup') {
      prereqCheck = null;
      runPrereqCheck();
    }
  });
  form.addEventListener('change', () => { touched = true; refreshForm(); });
  form.addEventListener('submit', (ev) => { ev.preventDefault(); save(); });

  // Document upload: click, drag/drop, compress immediately
  DOC_KEYS.forEach((k) => {
    const box = $('adm-' + k + '-upload');
    const input = $('adm-' + k + '-file');
    if (!box || !input) return;

    box.addEventListener('click', (ev) => {
      if (ev.target.tagName === 'BUTTON') return;
      input.click();
    });

    box.addEventListener('dragover', (ev) => { ev.preventDefault(); box.classList.add('dragover'); });
    box.addEventListener('dragleave', () => box.classList.remove('dragover'));
    box.addEventListener('drop', (ev) => {
      ev.preventDefault();
      box.classList.remove('dragover');
      const file = ev.dataTransfer.files[0];
      if (file) handleFileSelect(k, file);
    });

    input.addEventListener('change', (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (file) handleFileSelect(k, file);
    });
  });

  async function handleFileSelect(k, file) {
    if (!isImageFile(file)) {
      const errBox = $('adm-' + k + '-err');
      if (errBox) errBox.textContent = 'Only JPG, PNG or WEBP allowed';
      return;
    }
    if (/^image\/(heic|heif)$/i.test(file.type)) {
      const errBox = $('adm-' + k + '-err');
      if (errBox) errBox.textContent = 'Only JPG, PNG or WEBP allowed';
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      const errBox = $('adm-' + k + '-err');
      if (errBox) errBox.textContent = 'File too large (max 10 MB).';
      showToast('File too large (max 10 MB).', 'error');
      return;
    }
    const upload = $('adm-' + k + '-upload');
    const preview = $('adm-' + k + '-preview');
    const emptyEl = upload ? upload.querySelector('.adm-upload-empty') : null;
    const sizeEl = $('adm-' + k + '-size');
    if (emptyEl) emptyEl.style.display = 'none';
    preview.style.display = 'none';
    preview.innerHTML = '';
    upload.classList.add('compressing');
    const spin = mk('div', 'adm-doc-spinner');
    spin.textContent = 'Compressing...';
    upload.appendChild(spin);
    try {
      docFiles[k] = { file, compressedBlob: null, dataUrl: null };
      const blob = await compressFile(k);
      preview.style.display = 'flex';
      const box = mk('div', 'adm-doc-box');
      box.style.position = 'relative';
      box.style.overflow = 'visible';
      const img = mk('img', 'adm-doc-thumb');
      if (isDataUrl(docFiles[k].dataUrl)) {
        img.src = docFiles[k].dataUrl;
        img.style.objectFit = (k === 'photo') ? 'cover' : 'contain';
        if (k === 'signature') img.style.background = '#FFFFFF';
        box.appendChild(img);
      }
      const remove = mk('button', 'adm-doc-remove');
      remove.type = 'button';
      remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      remove.setAttribute('aria-label', 'Remove file');
      remove.addEventListener('click', (ev) => { ev.stopPropagation(); setDocPreview(k, null); });
      box.appendChild(remove);
      preview.appendChild(box);
      upload.classList.add('has-preview');
      if (sizeEl) {
        sizeEl.textContent = 'Saved: ' + formatBytes(blob.size);
        sizeEl.className = 'adm-doc-size saved';
      }
      touched = true;
      refreshForm();
    } catch (e) {
      // error already shown in compressFile
      if (emptyEl) emptyEl.style.display = 'flex';
      upload.classList.remove('compressing', 'has-preview');
    } finally {
      upload.classList.remove('compressing');
      if (spin && spin.parentNode === upload) upload.removeChild(spin);
    }
  }

  await load();
}

export function unmount() {
  clearDirty();
}

















