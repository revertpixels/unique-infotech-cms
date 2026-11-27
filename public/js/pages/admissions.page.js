import { db, storage } from '../config/firebase-config.js';
import { ref as storageRef, deleteObject } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
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
import { showToast } from '../components/toast.js?v=1.8.183';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.183';
import { buildStats, buildToolbar, renderPager, renderEmptyTableState, PAGE_SIZE } from '../components/list-page.js?v=1.8.183';
import { createSelect } from '../components/ui-select.js?v=1.8.183';
import { createBranchBatchFilter } from '../components/branch-batch-filter.js?v=1.8.183';
import { openMenu } from '../components/ui-menu.js?v=1.8.183';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.183';
import { openPopup } from '../components/modal.js?v=1.8.183';
import { createDatePicker } from '../components/ui-datepicker.js?v=1.8.183';
import { getSelectedSessionId, getSelectedSession, getCachedSessions, loadSessions, todayISO } from '../core/sessions.js?v=1.8.183';
import { firstInstallmentOf, admissionState, sessionLabel, installmentSchedule, batchAllowsCourse, batchCourseLabel, isCourseActive } from '../utils/session-rules.js?v=1.8.183';
import { formatINR, formatDateIN, formatPersonName, formatGenderDisplay, initials } from '../utils/formatter.js?v=1.8.183';
import { validatePhone, validateEmail, validateDOB, validateName, validateRequired } from '../utils/validator.js?v=1.8.183';
import { listStudentsRaw, checkDuplicatePhone, readStudentId, readReceiptNo, writeCounter, createStudentWithDocs, updateStudentWithDocs, updateStudent, deleteStudent } from '../services/admission.service.js?v=1.8.183';
import { feeTotal, courseFeeOf, discountOf } from '../utils/fees.js?v=1.8.183';
import { compressTo100KB, readAsDataURL, blobToDataURL, isImageFile, formatBytes } from '../utils/image-compress.js?v=1.8.183';
import { fetchStudentPayments, calculateStudentFinancials, buildReceiptMenuItems } from '../services/payment.service.js?v=1.8.183';
import { loadStudentPhotos, getCachedStudentPhoto } from '../services/report.service.js?v=1.8.183';
import { getStudentPhotoSrc, getStudentDocSrc, getStudentDocMime } from '../utils/student-media.js?v=1.8.183';
import { playPaymentSuccessSound } from '../utils/sound.js?v=1.8.183';
import { openPaymentPopup } from '../components/payment-popup.js?v=1.8.183';
import { APP_CACHE } from '../core/app.js?v=1.8.183';

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
    {
      id: 'status', label: 'Status', options: [
        { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' },
        { value: 'dropped', label: 'Dropped' }, { value: 'completed', label: 'Completed' }
      ]
    },
    { id: 'course', label: 'Course', options: [{ value: 'all', label: 'All courses', icon: 'book-open' }] }
  ];
  const tb = buildToolbar({
    placeholder: 'Search name, student ID, phone or guardian',
    filters: tbFilters,
    onChange: () => { page = 1; render(); },
    onRefresh: () => load(),
    rowLayout: true
  });
  let bbFilter = null;
  const tbHost = $('adm-toolbar');
  if (tbHost) {
    tbHost.innerHTML = '';
    tbHost.appendChild(tb.el);

    const bbHost = document.createElement('div');
    bbHost.className = 'lp-bb-host';
    bbFilter = createBranchBatchFilter(bbHost, {
      persistKey: 'admissions.youth',
      profile,
      ctx: 'youth',
      sessionId: getSelectedSessionId('youth') || '',
      branches: [],
      batches: [],
      onChange: () => { page = 1; render(); }
    });
    tb.addFilterEl(bbHost);

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

      const bSnap = await getDocs(query(collection(db, 'batches'), where('ctx', '==', 'youth')));
      batches = bSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

      if (isSuper) {
        const brSnap = await getDocs(collection(db, 'branches'));
        branches = brSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
          .filter(b => (!b.ctx || b.ctx === 'youth') && (b.status || 'active') === 'active');
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

      const sessSnap = await getDocs(query(collection(db, 'sessions'), where('ctx', '==', 'youth')));
      sessions = sessSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

      tb.setFilterOptions('course', [{ value: 'all', label: 'All courses', icon: 'book-open' }].concat(courses.map(c => ({ value: c.id, label: (c.courseCode || c.code || c.id), icon: 'book-open' }))));
      const activeSess = getSelectedSession('youth') || sessions.find(s => s.id === getSelectedSessionId('youth')) || sessions.find(s => s.status === 'running') || sessions[0] || null;
      if (bbFilter) {
        bbFilter.updateData({
          ctx: 'youth',
          sessionId: activeSess ? activeSess.id : '',
          branches,
          batches,
          courses
        });
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
    selectedPaymentPlan = null;
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
    refreshForm();
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
  let selectedPaymentPlan = null;

  function updateFees(c, s) {
    const host = $('adm-fee-grid');
    if (!host) return;
    host.innerHTML = '';
    if (totalRowEl) { totalRowEl.remove(); totalRowEl = null; }
    if (host.parentNode) {
      host.parentNode.querySelectorAll('.adm-fee-total-row').forEach(el => el.remove());
    }

    const f = c ? (c.fees || {}) : {};
    const hasFullOffer = !editId && f.fullPaymentAmount && Number(f.fullPaymentAmount) > 0;
    if (!hasFullOffer) {
      selectedPaymentPlan = 'installments';
    }

    const fullAmt = Number(f.fullPaymentAmount || 0);
    const materialFee = Number(f.material || 0);
    const courseFee = courseFeeOf(f);
    const disc = discountOf(f);

    const planCard = $('adm-plan-card');
    const planOptions = $('adm-plan-options');
    const planErrBox = $('adm-plan-err');

    if (hasFullOffer && planCard && planOptions) {
      planCard.hidden = false;
      planCard.style.borderColor = 'var(--border, #EAEAEA)';
      planOptions.innerHTML = '';
      if (planErrBox) {
        planErrBox.textContent = '';
        planErrBox.style.display = 'none';
      }

      const lblInst = document.createElement('label');
      lblInst.style.display = 'flex';
      lblInst.style.alignItems = 'center';
      lblInst.style.gap = '6px';
      lblInst.style.cursor = 'pointer';
      lblInst.style.fontSize = '13px';
      lblInst.style.fontWeight = selectedPaymentPlan === 'installments' ? '600' : 'normal';

      const rInst = document.createElement('input');
      rInst.type = 'radio';
      rInst.name = 'adm_payment_plan';
      rInst.value = 'installments';
      rInst.checked = selectedPaymentPlan === 'installments';
      rInst.onchange = () => {
        selectedPaymentPlan = 'installments';
        updateFees(c, s);
        refreshForm();
      };
      lblInst.append(rInst, document.createTextNode('Pay in installments'));

      const lblFull = document.createElement('label');
      lblFull.style.display = 'flex';
      lblFull.style.alignItems = 'center';
      lblFull.style.gap = '6px';
      lblFull.style.cursor = 'pointer';
      lblFull.style.fontSize = '13px';
      lblFull.style.fontWeight = selectedPaymentPlan === 'full' ? '600' : 'normal';

      const rFull = document.createElement('input');
      rFull.type = 'radio';
      rFull.name = 'adm_payment_plan';
      rFull.value = 'full';
      rFull.checked = selectedPaymentPlan === 'full';
      rFull.onchange = () => {
        selectedPaymentPlan = 'full';
        updateFees(c, s);
        refreshForm();
      };
      lblFull.append(rFull, document.createTextNode('Pay in full (Rs ' + formatINR(fullAmt) + ')'));
      if (disc.rs > 0) {
        const badge = mk('span', 'pill up font-semibold', disc.pct + '% discount (saves ' + formatINR(disc.rs) + ')');
        badge.style.fontSize = '11px';
        badge.style.marginLeft = '4px';
        badge.style.padding = '1px 6px';
        lblFull.appendChild(badge);
      }

      planOptions.append(lblInst, lblFull);
    } else if (planCard) {
      planCard.hidden = true;
      if (planOptions) planOptions.innerHTML = '';
      if (planErrBox) {
        planErrBox.textContent = '';
        planErrBox.style.display = 'none';
      }
    }

    let sentence = '';
    let totalAmt = null;
    let isMuted = false;

    if (!c) {
      // 1. Before a course is chosen: show empty slots and prompt
      const items = [
        { label: 'Admission fee', cls: 'adm-fee-admission' },
        { label: 'Study material fee', cls: 'adm-fee-material' },
        { label: 'Installment x 4', cls: 'adm-fee-installment' },
        { label: 'Course total', cls: 'adm-fee-exam' }
      ];
      items.forEach((it) => {
        const div = mk('div', 'adm-fee-box ' + it.cls);
        div.appendChild(mk('div', 'adm-fee-label', it.label));
        div.appendChild(mk('div', 'adm-fee-amt muted', '—'));
        host.appendChild(div);
      });

      const noteBox = mk('div', 'adm-fee-box adm-fee-exam');
      noteBox.style.gridColumn = '1 / -1';
      noteBox.appendChild(mk('div', 'adm-fee-label', 'Note'));
      noteBox.appendChild(mk('div', 'adm-fee-note-text', 'Examination fee is charged separately later. Late payment: ₹1 per day after the 10th.'));
      host.appendChild(noteBox);

      sentence = 'Select a course to see the full fee details.';
      totalAmt = null;
      isMuted = true;
    } else if (hasFullOffer && !selectedPaymentPlan) {
      // 2. Course chosen with full offer, but user hasn't selected a plan yet
      const promptDiv = mk('div', 'adm-plan-prompt', 'Please select a payment plan above to view the fee breakdown.');
      promptDiv.style.gridColumn = '1 / -1';
      promptDiv.style.padding = '16px';
      promptDiv.style.textAlign = 'center';
      promptDiv.style.color = 'var(--text-mute, #6B6B6B)';
      promptDiv.style.fontSize = '13px';
      promptDiv.style.background = 'var(--bg, #F6F6F8)';
      promptDiv.style.borderRadius = 'var(--r, 6px)';
      promptDiv.style.border = '1px dashed var(--border-strong, #D4D4D4)';
      host.appendChild(promptDiv);

      sentence = 'Choose "Pay in installments" or "Pay in full" to view the fee breakdown.';
      totalAmt = null;
      isMuted = true;
    } else if (selectedPaymentPlan === 'full' && hasFullOffer) {
      // 3. Full payment plan chosen
      const totalPayableNow = fullAmt + materialFee;
      const fullItems = [
        { label: 'Course fee', val: formatINR(courseFee), cls: 'adm-fee-admission' },
        { label: 'Full-payment discount', val: '- ' + formatINR(disc.rs) + ' (' + disc.pct + '%)', cls: 'adm-fee-material' },
        { label: 'Full course fee', val: formatINR(fullAmt), cls: 'adm-fee-installment font-semibold' },
        { label: 'Study material fee', val: formatINR(materialFee), cls: 'adm-fee-exam' }
      ];
      fullItems.forEach((it) => {
        const div = mk('div', 'adm-fee-box ' + it.cls);
        div.appendChild(mk('div', 'adm-fee-label', it.label));
        div.appendChild(mk('div', 'adm-fee-amt', it.val));
        host.appendChild(div);
      });

      const noteBox = mk('div', 'adm-fee-box adm-fee-exam');
      noteBox.style.gridColumn = '1 / -1';
      noteBox.appendChild(mk('div', 'adm-fee-label', 'Note'));
      noteBox.appendChild(mk('div', 'adm-fee-note-text', 'Examination fee is charged separately later.'));
      host.appendChild(noteBox);

      sentence = '<b>Pay ' + formatINR(totalPayableNow) + ' now</b> (full course package fee ' + formatINR(fullAmt) + (materialFee > 0 ? ' + study material fee ' + formatINR(materialFee) : '') + '). No installment schedule is created. Examination fee is charged separately later.';
      totalAmt = totalPayableNow;
      isMuted = false;
    } else {
      // 4. Installments plan chosen (or course without full offer)
      const items = [
        { label: 'Admission fee', val: formatINR(f.admission || 0), cls: 'adm-fee-admission' },
        { label: 'Study material fee', val: formatINR(materialFee), cls: 'adm-fee-material' },
        {
          label: 'Installment x 4',
          val: (f.installment && f.installment > 0) ? (formatINR(f.installment) + ' x 4 = ' + formatINR(f.installment * 4)) : 'Rs 0',
          cls: 'adm-fee-installment'
        },
        { label: 'Course total', val: formatINR(courseFee), cls: 'adm-fee-exam' }
      ];
      items.forEach((it) => {
        const div = mk('div', 'adm-fee-box ' + it.cls);
        div.appendChild(mk('div', 'adm-fee-label', it.label));
        div.appendChild(mk('div', 'adm-fee-amt', it.val));
        host.appendChild(div);
      });

      const noteBox = mk('div', 'adm-fee-box adm-fee-exam');
      noteBox.style.gridColumn = '1 / -1';
      noteBox.appendChild(mk('div', 'adm-fee-label', 'Note'));
      noteBox.appendChild(mk('div', 'adm-fee-note-text', 'Examination fee is charged separately later. Late payment: ₹1 per day after the 10th.'));
      host.appendChild(noteBox);

      const payNowTotal = Number(f.admission || 0) + materialFee;
      let payNowPart;
      if (materialFee > 0) {
        payNowPart = '<b>Pay ' + formatINR(payNowTotal) + ' now</b> (admission fee ' + formatINR(f.admission || 0) + ' + study material fee ' + formatINR(materialFee) + ')';
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
        sentence = payNowPart + ', then 4 installments of ' + formatINR(f.installment || 0) + ' due on ' + dueStr + '. Examination fee is charged separately later.';
      } else {
        sentence = payNowPart + ', then 4 installments of ' + formatINR(f.installment || 0) + ' due on the 10th of months 3-6 of the session. Examination fee is charged separately later.';
      }

      // Total payable equals Course total (admission + 4 installments) + study material — NO exam fee!
      totalAmt = courseFee + materialFee;
      isMuted = false;
    }

    // Only ONE Total payable box
    const tr = mk('div', 'adm-fee-total-row');
    const left = mk('div', 'adm-fee-total-left');
    const label = mk('div', 'adm-fee-total-label', (selectedPaymentPlan === 'full' && hasFullOffer) ? 'Total payable now' : 'Total payable');
    const summary = mk('div', 'adm-fee-total-sentence' + (isMuted ? ' muted' : ''), sentence);
    summary.innerHTML = sentence;
    left.append(label, summary);
    const amtDiv = mk('div', 'adm-fee-total-amount' + (isMuted ? ' muted' : ''), totalAmt !== null ? formatINR(totalAmt) : '—');
    tr.append(left, amtDiv);
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
    if (!editId && v.courseId) {
      const c = courses.find((x) => x.id === v.courseId);
      const f = c ? (c.fees || {}) : {};
      const hasFullOffer = f.fullPaymentAmount && Number(f.fullPaymentAmount) > 0;
      if (hasFullOffer && !selectedPaymentPlan) {
        err.paymentPlan = 'Please select a payment plan.';
      }
    }
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
    const planCard = $('adm-plan-card');
    const planErr = $('adm-plan-err');
    if (planCard) {
      planCard.style.borderColor = err.paymentPlan ? 'var(--danger, #DC2626)' : 'var(--border, #EAEAEA)';
    }
    if (planErr) {
      planErr.textContent = err.paymentPlan || '';
      planErr.style.display = err.paymentPlan ? 'block' : 'none';
    }
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
        const origSrc = getStudentDocSrc(docOriginals[k], getStudentDocMime(docOriginals[k]));
        if (docOriginals[k] && origSrc) {
          const preview = $('adm-' + k + '-preview');
          const upload = $('adm-' + k + '-upload');
          const emptyEl = upload ? upload.querySelector('.adm-upload-empty') : null;
          if (preview) {
            preview.style.display = 'flex';
            const box = mk('div', 'adm-doc-box');
            box.style.position = 'relative';
            box.style.overflow = 'visible';
            const mime = getStudentDocMime(docOriginals[k]);
            if (mime.includes('pdf') || /^data:application\/pdf/i.test(origSrc)) {
              const tag = mk('div', 'adm-doc-thumb', 'PDF');
              tag.style.cssText = 'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;background:#EEF2FF;color:#333B84;';
              box.appendChild(tag);
            } else {
              const img = mk('img', 'adm-doc-thumb');
              img.src = origSrc;
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
      const selSession = getSelectedSessionId('youth');
      const activeSessObj = getSelectedSession('youth') || sessions.find(s => s.id === selSession) || sessions.find(s => s.status === 'running') || sessions[0] || null;
      const subEl = $('adm-sub');
      if (subEl) {
        subEl.textContent = activeSessObj
          ? `Session ${activeSessObj.name} — Admit new students to courses and batches. Student IDs are generated per session year and course level.`
          : 'Admit new students to courses and batches. Student IDs are generated per session year and course level.';
      }
      const noSessEl = $('adm-no-session');
      if (noSessEl) noSessEl.hidden = sessions.length > 0;
      const bbVal = bbFilter ? bbFilter.getValue() : { branchId: 'all', batchId: 'all' };

      // Session filter helper: matches selected session, or if student has no session specified
      const inCurrentSession = (s) => !(selSession && s.sessionId && s.sessionId !== selSession);

      // Hidden students count (session filter hides students with different session)
      const hiddenCount = students.filter(s => selSession && s.sessionId && s.sessionId !== selSession).length;
      if (sessionNotice) {
        if (hiddenCount > 0) {
          sessionNotice.textContent = hiddenCount + ' students are in other sessions - switch session in the toolbar to see them.';
          sessionNotice.hidden = false;
        } else {
          sessionNotice.hidden = true;
        }
      }

      let list = students.filter(s => {
        if (selSession && s.sessionId && s.sessionId !== selSession) return false;
        if (f.status && f.status !== 'all' && s.status !== f.status) return false;
        if (f.course && f.course !== 'all' && s.courseId !== f.course) return false;
        if (bbVal.batchId && bbVal.batchId !== 'all' && s.batchId !== bbVal.batchId) return false;
        if (isSuper && bbVal.branchId && bbVal.branchId !== 'all' && s.branchId !== bbVal.branchId) return false;
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

      const countEl = $('adm-count');
      if (countEl) {
        countEl.textContent = total === 1 ? '1 student' : total + ' students';
      }

      const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      if (page > totalPages) page = totalPages;
      const start = (page - 1) * PAGE_SIZE;
      const pageList = list.slice(start, start + PAGE_SIZE);

      const N = list.length;
      const T = total;

      if (!list.length) {
        rowsHost.innerHTML = '';
        if (T === 0) {
          empty.hidden = false;
          if (footEl) footEl.hidden = true;
        } else {
          empty.hidden = true;
          renderEmptyTableState(rowsHost, {
            colSpan: 7,
            title: 'No matching students',
            desc: 'No students match your current search or filter criteria.',
            onClear: () => {
              tb.state.q = '';
              tb.state.status = 'all';
              tb.state.course = 'all';
              if (bbFilter) bbFilter.reset();
              admDateFilter = 'all';
              admDateFrom = '';
              admDateTo = '';
              if (dateSel) dateSel.value = 'all';
              if (dateCustomWrap) dateCustomWrap.hidden = true;
              if (fromInp) fromInp.value = '';
              if (toInp) toInp.value = '';
              render();
            }
          });
          if (footEl) {
            footEl.hidden = false;
            footEl.innerHTML = '';
            footEl.appendChild(mk('span', null, 'Showing 0 of ' + T));
          }
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
            const stNameDisp = formatPersonName(s.name || '') || ' - ';
            const guardDisp = formatPersonName(s.guardianName || '') || '-';
            const stCell = mk('div', 'fr-student-cell');
            const cachedPh = getCachedStudentPhoto(s.id) || getStudentPhotoSrc(s, null);
            if (cachedPh) {
              const avImg = document.createElement('img');
              avImg.className = 'fr-avatar';
              avImg.src = cachedPh;
              avImg.alt = stNameDisp;
              stCell.appendChild(avImg);
            } else {
              const avFb = mk('span', 'fr-avatar-fallback fr-avatar-slot', initials(stNameDisp || 'ST'));
              avFb.dataset.sid = s.id || '';
              stCell.appendChild(avFb);
            }
            const stMeta = mk('div', 'fr-student-meta');
            const nameBtn = mk('button', 'fr-student-link', stNameDisp);
            nameBtn.type = 'button';
            nameBtn.title = stNameDisp;
            nameBtn.addEventListener('click', () => {
              if (s.studentId) location.hash = '#/students/' + s.studentId;
              else if (s.id) location.hash = '#/students/' + s.id;
            });
            stMeta.append(nameBtn, mk('span', 'adm-sub', guardDisp));
            stCell.appendChild(stMeta);
            tdSt.appendChild(stCell);
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
                label: 'Receipts',
                icon: 'receipt',
                onClick: async () => {
                  const payments = await fetchStudentPayments(s.id).catch(() => []);
                  const receiptItems = buildReceiptMenuItems(s, payments);
                  setTimeout(() => openMenu(kebab, receiptItems), 10);
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
          if (T === 0) {
            footEl.hidden = true;
          } else {
            const a = (page - 1) * PAGE_SIZE + 1;
            const b = Math.min(page * PAGE_SIZE, N);
            const range = a + '–' + b;
            let summary;
            if (N === T) {
              summary = totalPages <= 1 ? ('Showing all ' + N) : ('Showing ' + range + ' of ' + N);
            } else {
              summary = totalPages <= 1 ? ('Showing ' + N + ' of ' + T) : ('Showing ' + range + ' of ' + N + ' (filtered from ' + T + ')');
            }
            renderPager(footEl, { page, pageSize: PAGE_SIZE, totalItems: N, summary, showWhenSingle: true, onPageChange: (p) => { page = p; render(); } });
          }
        }
      }

      if (typeof lucide !== 'undefined') lucide.createIcons();

      const pageStudentsMap = {};
      pageList.forEach((stItem) => { if (stItem && stItem.id) pageStudentsMap[stItem.id] = stItem; });
      const visibleIds = Object.keys(pageStudentsMap);
      if (visibleIds.length) {
        loadStudentPhotos(visibleIds, pageStudentsMap).then(() => {
          visibleIds.forEach((sid) => {
            const url = getCachedStudentPhoto(sid);
            if (!url) return;
            const slot = rowsHost.querySelector(`.fr-avatar-slot[data-sid="${CSS.escape(sid)}"]`);
            if (slot && slot.tagName !== 'IMG') {
              const avImg = document.createElement('img');
              avImg.className = 'fr-avatar';
              avImg.src = url;
              avImg.alt = formatPersonName(pageStudentsMap[sid]?.name || '') || '';
              slot.replaceWith(avImg);
            }
          });
        }).catch(() => {});
      }
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
      selectedPaymentPlan = r ? (r.paymentPlan || 'installments') : null;
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
      $t('adm-save-label', r ? 'Save changes' : 'Verify');
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
    const host = $('adm-fee-grid');
    if (host) {
      host.innerHTML = '';
      if (host.parentNode) {
        host.parentNode.querySelectorAll('.adm-fee-total-row').forEach(el => el.remove());
      }
    }
    totalRowEl = null;
    showErrors({});
  }

  function focusFirstError(err) {
    if (err.paymentPlan) {
      const planCard = $('adm-plan-card');
      if (planCard && planCard.scrollIntoView) {
        planCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }
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
      const ff = cc ? cc.fees || {} : {};
      const hasFullOffer = ff.fullPaymentAmount && Number(ff.fullPaymentAmount) > 0;
      const isFull = (selectedPaymentPlan === 'full') && hasFullOffer;

      const courseFee = courseFeeOf(ff);
      const fullAmt = Number(ff.fullPaymentAmount || 0);
      const matFee = Number(ff.material || 0);
      const disc = discountOf(ff);
      const admDue = Number(ff.admission || 0) + matFee;

      const totalFee = isFull ? fullAmt : courseFee;
      const dueNow = isFull ? (fullAmt + matFee) : admDue;

      let summary =
        'Student: ' + v.name + '\n' +
        'Course: ' + (cc.courseCode || cc.code || '') + ' - ' + (cc.name || '') + '\n' +
        'Batch: ' + (bb.name || '-') + '\n' +
        'Session: ' + (ss ? ss.name : '-') + '\n\n';

      if (isFull) {
        summary +=
          'Selected Plan: Pay in full (Discounted)\n' +
          '• Standard course fee: Rs. ' + formatINR(courseFee) + '\n' +
          '• Full-payment discount: - Rs. ' + formatINR(disc.rs) + ' (' + disc.pct + '%)\n' +
          '• Full course fee: Rs. ' + formatINR(fullAmt) + '\n' +
          '• Study material fee: Rs. ' + formatINR(matFee) + '\n' +
          '• Total payable now: Rs. ' + formatINR(dueNow) + '\n' +
          '• Note: Examination fee is charged separately later.\n';
      } else {
        const instDue = Number(ff.installment || 0) * 4;
        summary +=
          'Selected Plan: Pay in installments\n' +
          '• Course total: Rs. ' + formatINR(courseFee) + '\n' +
          '• Admission fee: Rs. ' + formatINR(ff.admission || 0) + '\n' +
          '• Study material fee: Rs. ' + formatINR(matFee) + '\n' +
          '• Due now: Rs. ' + formatINR(dueNow) + '\n' +
          '• Remaining: 4 installments of Rs. ' + formatINR(ff.installment || 0) + ' (Total: Rs. ' + formatINR(instDue) + ')\n' +
          '• Note: Examination fee is charged separately later.\n';
      }

      const ok = await confirmDialog({
        title: 'Verify admission details',
        message: summary,
        confirmText: 'Admit & Proceed to Payment',
        cancelText: 'Cancel'
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
        // Preserve untouched pre-existing docs (loaded into docOriginals -> docFiles on Edit)
        if (df && getStudentDocSrc(df, getStudentDocMime(df))) {
          docs[k] = Object.assign({}, df, { updatedAt: serverTimestamp() });
          return;
        }
        docs[k] = false;
      }));
    } catch (e) {
      throw e;
    }

    if (!editId) {
      // NEW ADMISSION: Do NOT save to Firestore yet.
      // Open the shared payment popup. Save student + payment ONLY inside atomic recordAdmissionWithPayment!
      const hasFullOffer = f.fullPaymentAmount && Number(f.fullPaymentAmount) > 0;
      const isFull = (selectedPaymentPlan === 'full') && hasFullOffer;
      const fullAmt = Number(f.fullPaymentAmount || 0);
      const courseFee = courseFeeOf(f);
      const matFee = Number(f.material || 0);
      const disc = discountOf(f);
      const dueNow = isFull ? (fullAmt + matFee) : (Number(f.admission || 0) + matFee);

      const previewStudent = {
        name: v.name,
        guardianName: v.guardianName,
        phone: v.phone,
        email: v.email,
        dob: v.dob,
        admissionDate: v.admissionDate || today,
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
        paymentPlan: isFull ? 'full' : 'installments',
        fullPaymentAmount: isFull ? fullAmt : null,
        fullPaymentDiscountRs: isFull ? disc.rs : null,
        fullPaymentDiscountPct: isFull ? disc.pct : null,
        fullPaymentDiscount: isFull ? disc.rs : null,
        feeTotal: isFull ? fullAmt : courseFee,
        feeSnapshot: f,
        admissionFee: Number(f.admission || 0),
        materialFee: matFee,
        examFee: Number(f.exam || 0),
        dueAtAdmission: isFull
          ? { full: fullAmt, material: matFee, total: dueNow }
          : { admission: Number(f.admission || 0), material: matFee, total: dueNow }
      };

      const pendingAdmission = {
        studentData: {
          name: v.name,
          guardianName: v.guardianName,
          phone: v.phone,
          altPhone: v.altPhone || '',
          email: v.email || '',
          dob: v.dob,
          gender: v.gender,
          qualification: v.qualification,
          address: v.address,
          courseCode: c.courseCode || c.code || '',
          courseName: c.name || '',
          batchName: bObj.name || '',
          sessionName: selS ? (selS.name || '') : '',
          admissionDate: v.admissionDate || today
        },
        docs: docs,
        aadhaar: v.aadhaar,
        returnDoc: returnDoc,
        org: 'youth',
        sessionYear: sessionYear,
        courseLevel: courseLevel,
        branchCode: branchCode,
        branchId: v.branchId,
        branchName: branchNameOf(v.branchId),
        courseId: v.courseId,
        sessionId: v.sessionId,
        isFull: isFull,
        fullAmt: fullAmt,
        fullDiscRs: disc.rs,
        fullDiscPct: disc.pct,
        fullDisc: disc.rs,
        courseFee: courseFee,
        admFee: Number(f.admission || 0),
        matFee: matFee,
        instFee: Number(f.installment || 0),
        examFee: Number(f.exam || 0),
        feeSnapshot: f,
        sched: sched,
        prereqCheck: (c && getPrereq(c)) ? prereqCheck : null,
        sourceAdmission: sourceAdmissionRef,
        userEmail: who,
        userName: profile?.name || '',
        userRole: profile?.role || ''
      };

      openPaymentPopup({
        student: previewStudent,
        pendingAdmission: pendingAdmission,
        isAdmission: true,
        profile: APP_CACHE.currentUser || profile,
        preselectedOption: isFull ? 'FULL' : 'AD',
        from: 'admissions',
        onSuccess: async (payRes) => {
          saved = snapshot();
          clearDirty();
          closeForm();
          await load();
          showToast('Admission & payment recorded - ' + payRes.studentId, 'success');
          location.hash = '#/admissions/' + payRes.studentDocId + '/receipt';
        }
      });
      return;
    }

    try {
      const saveResult = await runTransaction(db, async (tx) => {
        studentId = (editRow && editRow.studentId ? editRow.studentId : '');
        receiptNo = (editRow && editRow.receiptNo ? editRow.receiptNo : '');
        previousStudentIds = (editRow && editRow.previousStudentIds) || [];

        const data = {
          name: v.name,
          guardianName: v.guardianName,
          phone: v.phone,
          altPhone: v.altPhone || '',
          email: v.email || '',
          dob: v.dob,
          gender: v.gender,
          qualification: v.qualification,
          address: v.address,
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
          docs: {}
        };

        Object.keys(data).forEach((k) => { if (data[k] === undefined) delete data[k]; });
        DOC_KEYS.forEach((k) => { data.docs[k] = !!docs[k]; });

        const studentRef = doc(db, COL, editId);
        newStudentRefId = studentRef.id;
        tx.set(studentRef, data, { merge: true });

        Object.entries(docs).forEach(([key, docData]) => {
          const docRef = doc(collection(studentRef, 'docs'), key);
          if (docData) {
            tx.set(docRef, Object.assign({}, docData, { updatedAt: serverTimestamp() }));
          } else {
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

        return { studentId: studentId, receiptNo: receiptNo, id: newStudentRefId, data: data };
      });

      studentId = saveResult.studentId;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      $t('adm-state', 'Saved.');
      const stateEl = $('adm-state');
      if (stateEl) stateEl.className = 'save-state saved';

      saved = snapshot();
      clearDirty();
      closeForm();
      await load();
      showToast('Admission updated - ' + studentId, 'success');
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

    // Load photo using shared helper (checking docs/photo, docs subcollection, and student fields)
    try {
      let docsMap = {};
      const photoSnap = await getDoc(doc(db, 'students', s.id, 'docs', 'photo'));
      if (photoSnap.exists()) {
        docsMap.photo = { id: photoSnap.id, ...photoSnap.data() };
      }
      let photoUrl = getStudentPhotoSrc(s, docsMap);
      if (!photoUrl) {
        const docsSnap = await getDocs(collection(db, 'students', s.id, 'docs'));
        docsMap = {};
        docsSnap.docs.forEach((d) => { docsMap[d.id] = { id: d.id, ...d.data() }; });
        photoUrl = getStudentPhotoSrc(s, docsMap);
      }
      if (photoUrl) {
        photo.textContent = '';
        const img = document.createElement('img');
        img.src = photoUrl;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        img.onerror = () => {
          img.remove();
          photo.textContent = initials(s.name || '');
        };
        photo.appendChild(img);
      }
    } catch (e) {
      // non-fatal, keep initials
    }

    const info = document.createElement('div');
    info.className = 'adm-view-info';
    const nameEl = document.createElement('h2');
    nameEl.className = 'adm-view-name';
    nameEl.textContent = formatPersonName(s.name || '') || ' - ';
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
    viewRcpt.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const payments = await fetchStudentPayments(s.id).catch(() => []);
      if (!payments || payments.length === 0) {
        back.remove();
        location.hash = '#/admissions/' + s.id + '/receipt';
        return;
      }
      const receiptItems = [
        {
          label: 'Admission receipt',
          icon: 'file-text',
          onClick: () => { back.remove(); location.hash = '#/admissions/' + s.id + '/receipt'; }
        }
      ];
      payments.forEach(p => {
        const type = String(p.type || '').toUpperCase();
        let label = '';
        if (type === 'EX') {
          label = `Exam fee - ${p.receiptNo || 'Receipt'}`;
        } else {
          const no = p.installmentNo || 1;
          const mo = p.month ? ` - ${p.month}` : '';
          label = `Installment ${no}${mo} - ${p.receiptNo || 'Receipt'}`;
        }
        receiptItems.push({
          label,
          icon: 'receipt',
          onClick: () => {
            back.remove();
            location.hash = `#/payments/${s.id}/${p.id}/receipt?from=profile`;
          }
        });
      });
      openMenu(viewRcpt, receiptItems);
    });
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

    const payments = await fetchStudentPayments(s.id).catch(() => []);
    const { total: feeTotal, paid, outstanding: balance } = calculateStudentFinancials(s, payments);
    const nextDue = (s.feeSchedule && Array.isArray(s.feeSchedule) && s.feeSchedule.length > 0) ? formatDateIN(s.feeSchedule[0].due) || '-' : '-';

    const sections = [
      {
        id: 'personal', icon: 'user', title: 'Personal', rows: [
          ['Guardian', formatPersonName(s.guardianName || '') || '-'],
          ['DOB', formatDateIN(s.dob)],
          ['Gender', formatGenderDisplay(s.gender, '-')],
          ['Highest qualification', s.qualification || '-']
        ]
      },
      {
        id: 'contact', icon: 'phone', title: 'Contact', rows: [
          ['Phone', s.phone || '-'],
          ['Alt phone', s.altPhone || '-'],
          ['Email', s.email || '-'],
          ['Address', s.address || '-']
        ]
      },
      {
        id: 'course', icon: 'book-open', title: 'Course & batch', rows: [
          ['Session', selS.name || '-'],
          ['Branch', formatPersonName((s.branchName && s.branchName !== s.branchId) ? s.branchName : (branchNameOf(s.branchId) || 'Unknown branch')) || '-'],
          ['Course', ((c.courseCode || c.code || '') + '  -  ' + (c.name || '')) || '-'],
          ['Batch', b.name || '-'],
          ['Admission date', formatDateIN(s.admissionDate)],
          ['Prerequisite status', prereqText]
        ]
      },
      {
        id: 'fees', icon: 'wallet', title: 'Fees', rows: [
          ['Total course fee', formatINR(feeTotal)],
          ['Paid at admission', formatINR(paid)],
          ['Balance', formatINR(balance)],
          ['Next due instalment', nextDue]
        ]
      }
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

    const curBatch = batches.find((b) => b.id === s.batchId) || {};
    const curTiming = formatTiming(curBatch);

    let saving = false;
    const popup = openPopup({
      title: 'Change Batch',
      subtitle: studentSub(s),
      icon: 'shuffle',
      tone: 'default',
      saving: () => saving
    });
    const c = popup.container;

    // Subtle current batch indicator
    const curRow = mk('div', 'pk-badge-row');
    const curBadge = mk('div', 'pk-current-badge');
    curBadge.innerHTML = `Current Batch: <strong>${curBatch.name || s.batchName || 'None'}</strong>${curTiming ? ' (' + curTiming + ')' : ''}`;
    curRow.appendChild(curBadge);
    c.appendChild(curRow);

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
    createSelect(batchSelectHost, {
      options: batchOpts,
      value: '',
      ariaLabel: 'New batch',
      onChange: (v) => {
        selectedBatchId = v;
        const targetB = eligibleBatches.find(b => b.id === v);
        if (targetB) {
          const activeCount = students.filter(
            st => (st.ctx || 'youth') === 'youth' &&
              st.batchId === targetB.id &&
              (st.status === 'active' || st.status === 'break')
          ).length;
          const cap = Number(targetB.capacity || targetB.maxStudents || 0);
          if (cap > 0) {
            capInfo.textContent = `Batch capacity: ${activeCount} / ${cap} seats filled`;
          } else {
            capInfo.textContent = `Active students: ${activeCount}`;
          }
        } else {
          capInfo.textContent = '';
        }
        check();
      }
    });

    const dateHost = document.createElement('div');
    const dPicker = createDatePicker(dateHost, { value: todayISO(), ariaLabel: 'Effective date', onChange: () => check() });

    const fBatch = pField('New destination batch', batchSelectHost, { required: true });
    fBatch.appendChild(capInfo);
    const fDate = pField('Effective transfer date', dateHost, { required: true });
    c.appendChild(pFieldRow(fBatch, fDate));

    // Reason
    const { wrap: reasonWrap, textarea: reasonTa } = pTextarea('Enter reason for batch change...');
    const fReason = pField('Reason for batch change', reasonWrap, { required: true });
    c.appendChild(fReason);

    // Reassurance note
    c.appendChild(pNote('Past payments and receipts remain intact. Only the batch assignment and class schedule will change.'));

    // Footer buttons
    const { cancelBtn, okBtn, setSaving } = pButtons(popup, 'Change Batch', { icon: 'shuffle', tone: 'default' });

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
          batchChangedAt: serverTimestamp(),
          batchHistory: arrayUnion({
            fromBatchId: s.batchId || null,
            fromBatchName: curBatch.name || s.batchName || null,
            toBatchId: destBatch.id,
            toBatchName: destBatch.name || destBatch.id,
            effectiveDate,
            reason,
            by: (profile && profile.email) || 'admin',
            at: new Date().toISOString()
          }),
          updatedAt: serverTimestamp()
        });

        showToast({ type: 'success', message: `Batch changed to ${destBatch.name || destBatch.id}` });
        saving = false;
        setSaving(false);
        popup.close(true);
        await load();
        render();
      } catch (err) {
        console.error('[admissions] change batch failed', err);
        showToast({ type: 'error', message: 'Could not change batch: ' + (err.message || 'error') });
      } finally {
        saving = false;
        setSaving(false);
        check();
      }
    });
  }

  // Storage cleanup helper: deletes student photos/docs if in Storage, ignores object-not-found, never blocks
  async function deleteStudentStorage(s) {
    if (!storage) return;
    const paths = [
      `students/${s.id}/photo`,
      `students/${s.id}/signature`,
      `students/${s.id}/dobProof`,
      `students/${s.id}/marksheet`,
      `students/${s.id}/docs/photo`,
      `students/${s.id}/docs/signature`,
      `students/${s.id}/docs/dobProof`,
      `students/${s.id}/docs/marksheet`
    ];
    if (s.studentId && s.studentId !== s.id) {
      paths.push(`students/${s.studentId}/photo`);
      paths.push(`students/${s.studentId}/signature`);
    }
    const deletes = paths.map(async (p) => {
      try {
        const fileRef = storageRef(storage, p);
        await deleteObject(fileRef);
      } catch (err) {
        if (err && (err.code === 'storage/object-not-found' || (err.message && err.message.includes('object-not-found')))) {
          return;
        }
      }
    });
    // Never block popup on Storage: Promise.allSettled with timeout
    await Promise.race([
      Promise.allSettled(deletes),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);
  }

  // ---------- Session-Scoped Youth Drop & Delete ----------
  async function purgeYouthAdmission(s, meta) {
    const subcols = ['docs', 'payment', 'aadhaar', 'activity'];
    const subRefs = [];
    for (const sc of subcols) {
      try {
        const snap = await getDocs(collection(db, COL, s.id, sc));
        snap.docs.forEach(d => subRefs.push(d.ref));
      } catch (_) { /* non-fatal */ }
    }

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

    // Storage cleanup: photos/documents, ignore "object-not-found", never block popup
    try {
      await deleteStudentStorage(s);
    } catch (err) {
      console.warn('[youth] storage cleanup failed (non-blocking)', err);
    }

    const allRefs = [...subRefs, ...rootRefs];
    for (let i = 0; i < allRefs.length; i += 400) {
      try {
        const wb = writeBatch(db);
        allRefs.slice(i, i + 400).forEach(r => wb.delete(r));
        await wb.commit();
      } catch (batchErr) {
        console.warn('[youth] batch delete failed, retrying individually with allSettled', batchErr);
        await Promise.allSettled(allRefs.slice(i, i + 400).map(r => deleteDoc(r)));
      }
    }

    await deleteDoc(doc(db, COL, s.id));

    return totalRecords;
  }

  // ---------- popup: drop / delete ----------
  async function removeStudentPopup(s, mode) {
    const isDrop = mode === 'drop';
    let saving = false;
    const popup = openPopup({
      title: isDrop ? 'Drop Student' : 'Delete Permanently',
      subtitle: studentSub(s),
      icon: isDrop ? 'user-x' : 'trash-2',
      tone: 'danger',
      saving: () => saving
    });
    const c = popup.container;

    // Single-sentence alert notice
    if (isDrop) {
      const alert = mk('div', 'pk-alert warning');
      alert.innerHTML = `<i data-lucide="alert-triangle"></i><span>Dropping marks student as Dropped for <strong>${s.sessionName || 'current'}</strong> session only. Future billing stops; historical payments remain preserved.</span>`;
      c.appendChild(alert);
    } else {
      const alert = mk('div', 'pk-alert danger');
      alert.innerHTML = `<i data-lucide="alert-octagon"></i><span>Permanent deletion completely removes this admission and all fee records for <strong>${s.sessionName || 'current'}</strong> session only. This action cannot be undone.</span>`;
      c.appendChild(alert);
    }

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
      const fLast = pField('Last day attended', lastDayHost, { required: true });

      const { wrap: reasonWrap, textarea } = pTextarea('Explain reason for dropping student...');
      reasonTa = textarea;
      const fReason = pField('Reason for dropping', reasonWrap, { required: true });

      c.appendChild(pFieldRow(fLast, fReason));
      reasonTa.addEventListener('input', check);
    }

    // Type student ID to confirm
    const { wrap: confirmWrap, input: confirmInp } = pTypeConfirm(s.studentId);
    const fConfirm = pField(`Type student ID (${s.studentId || ''}) to confirm`, confirmWrap, { required: true });
    c.appendChild(fConfirm);

    const { cancelBtn, okBtn, setSaving } = pButtons(
      popup,
      isDrop ? 'Drop Student' : 'Delete Permanently',
      { icon: isDrop ? 'user-x' : 'trash-2', tone: 'danger' }
    );

    const check = () => {
      const idOk = confirmInp.value.trim() === String(s.studentId || '');
      if (isDrop) {
        const reasonOk = !!(reasonTa && reasonTa.value.trim());
        const dateOk = !!(lastDayPicker && lastDayPicker.value);
        okBtn.disabled = saving || !idOk || !reasonOk || !dateOk;
      } else {
        okBtn.disabled = saving || !idOk;
      }
    };
    confirmInp.addEventListener('input', check);
    check();

    okBtn.addEventListener('click', async () => {
      saving = true;
      setSaving(true);

      try {
        if (isDrop) {
          const lastDay = lastDayPicker ? lastDayPicker.value : todayISO();
          const reason = reasonTa ? reasonTa.value.trim() : '';
          await updateDoc(doc(db, COL, s.id), {
            status: 'dropped',
            droppedAt: serverTimestamp(),
            dropReason: reason,
            dropLastDay: lastDay,
            updatedAt: serverTimestamp()
          });

          try {
            await addDoc(collection(db, 'deletionLog'), {
              ctx: 'youth',
              type: 'drop',
              studentCode: s.studentId || '',
              name: s.name || '',
              sessionName: s.sessionName || '',
              courseName: courseNameOf(s),
              branchName: s.branchName || '',
              reason,
              lastDay,
              recordsDeleted: 0,
              by: (profile && profile.email) || 'admin',
              at: new Date().toISOString()
            });
          } catch (_) {}

          showToast({ type: 'success', message: `Student marked as dropped from ${s.sessionName || 'session'}` });
        } else {
          await purgeYouthAdmission(s, { mode: 'delete' });
          showToast({ type: 'success', message: 'Admission deleted permanently' });
        }

        // Close popup as soon as Firestore delete/drop succeeds
        saving = false;
        setSaving(false);
        popup.close(true);
        if (editId === s.id) closeForm();
        await load();
        render();
      } catch (err) {
        console.error('[admissions] student action failed', err);
        showToast({ type: 'error', message: 'Operation failed: ' + (err.message || 'unknown error') });
      } finally {
        saving = false;
        setSaving(false);
        check();
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

  const onToolbarSessionChange = () => {
    const newSessId = getSelectedSessionId('youth') || '';
    if (bbFilter) {
      bbFilter.updateData({ ctx: 'youth', sessionId: newSessId, branches, batches, courses });
    }
    if (form.hidden && sessionSel && newSessId) {
      const topS = sessions.find(s => s.id === newSessId);
      if (topS && admissionState(topS, todayISO()).open) {
        sessionSel.value = newSessId;
        onSessionChange();
      }
    }
    page = 1;
    render();
  };
  const onSessionsChanged = async () => {
    await load();
  };
  window.__admSessionCleanup && window.__admSessionCleanup();
  window.addEventListener('uic:session-selected', onToolbarSessionChange);
  window.addEventListener('uic:sessions-loaded', onToolbarSessionChange);
  window.addEventListener('uic:sessions-changed', onSessionsChanged);
  window.__admSessionCleanup = () => {
    window.removeEventListener('uic:session-selected', onToolbarSessionChange);
    window.removeEventListener('uic:sessions-loaded', onToolbarSessionChange);
    window.removeEventListener('uic:sessions-changed', onSessionsChanged);
  };

  await load();

  const rawHash = location.hash || '';
  const qIdx = rawHash.indexOf('?');
  if (qIdx !== -1 && new URLSearchParams(rawHash.slice(qIdx)).get('new') === '1') {
    try {
      history.replaceState(null, '', '#/students');
      window.dispatchEvent(new CustomEvent('uic:route-url-replaced'));
    } catch (_) {}
    await openForm(null);
    requestAnimationFrame(() => {
      const nameEl = $('adm-name');
      if (nameEl && nameEl.focus) nameEl.focus({ preventScroll: true });
    });
  }
}

export function unmount() {
  clearDirty();
  if (window.__admSessionCleanup) {
    window.__admSessionCleanup();
    window.__admSessionCleanup = null;
  }
  const host = $('adm-fee-grid');
  if (host && host.parentNode) {
    host.parentNode.querySelectorAll('.adm-fee-total-row').forEach(el => el.remove());
  }
}

















