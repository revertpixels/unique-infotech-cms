import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc, serverTimestamp, runTransaction } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.66';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.66';
import { buildStats, buildToolbar } from '../components/list-page.js?v=1.8.66';
import { createSelect } from '../components/ui-select.js?v=1.8.66';
import { openMenu } from '../components/ui-menu.js?v=1.8.66';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.66';
import { getSelectedSessionId, getCachedSessions, loadSessions, todayISO } from '../core/sessions.js?v=1.8.66';
import { firstInstallmentOf, admissionState, sessionLabel, installmentSchedule, batchAllowsCourse, batchCourseLabel, isCourseActive } from '../utils/session-rules.js?v=1.8.66';
import { formatINR, formatDateIN, initials } from '../utils/formatter.js?v=1.8.66';
import { validatePhone, validateEmail, validateDOB, validateName, validateRequired } from '../utils/validator.js?v=1.8.66';
import { listStudentsRaw, checkDuplicatePhone, readStudentId, readReceiptNo, writeCounter, createStudentWithDocs, updateStudentWithDocs, updateStudent, deleteStudent } from '../services/admission.service.js?v=1.8.66';
import { feeTotal } from '../utils/fees.js?v=1.8.66';
import { compressTo100KB, readAsDataURL, blobToDataURL, isImageFile, formatBytes } from '../utils/image-compress.js?v=1.8.66';

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
  { value: 'dropped', label: 'Dropped', cls: 'dropped' },
  { value: 'completed', label: 'Completed', cls: 'completed' }
];
const PAGE_SIZE = 25;

const DOC_KEYS = ['photo', 'signature', 'dobProof', 'marksheet'];
const DOC_LABELS = {
  photo: 'Photo',
  signature: 'Signature',
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

  if (isSuper) {
    branchSel = createSelect($('adm-branch-host'), {
      options: [{ value: '', label: 'Select a branch', icon: 'git-branch' }],
      value: '', ariaLabel: 'Branch',
      onChange: () => { onBranchChange(); touched = true; refreshForm(); }
    });
  } else {
    $('adm-branch-host').hidden = true;
  }

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
    placeholder: 'Search name, admission no, phone or guardian',
    filters: tbFilters,
    onChange: () => render(),
    onRefresh: () => load()
  });
  const tbHost = $('adm-toolbar');
  if (tbHost) {
    tbHost.innerHTML = '';
    tb.el.classList.add('adm-toolbar-row');
    tbHost.appendChild(tb.el);
  }

  // ---------- stats ----------
  const stats = buildStats([
    { label: 'Total admissions', value: 0, sub: 'This session', icon: 'user-plus', tone: 'indigo' },
    { label: 'This month', value: 0, sub: 'Admitted this month', icon: 'calendar', tone: 'green' },
    { label: 'Today', value: 0, sub: 'Admitted today', icon: 'clock', tone: 'amber' },
    { label: 'Active students', value: 0, sub: 'Currently enrolled', icon: 'check-circle', tone: 'violet' }
  ]);
  const statsHost = $('adm-stats');
  if (statsHost) statsHost.appendChild(stats.el);

  function showRealStats() {
    statsHost.innerHTML = '';
    statsHost.appendChild(stats.el);
  }

  // ---------- state ----------
  let students = [], courses = [], batches = [], branches = [], sessions = [];
  let editId = null, editRow = null, saved = {}, touched = false, saving = false, loading = false;
  let page = 1, filteredList = [];
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
      { label: 'Total admissions', value: '', sub: 'This session', icon: 'user-plus', tone: 'indigo' },
      { label: 'This month', value: '', sub: 'Admitted this month', icon: 'calendar', tone: 'green' },
      { label: 'Today', value: '', sub: 'Admitted today', icon: 'clock', tone: 'amber' },
      { label: 'Active students', value: '', sub: 'Currently enrolled', icon: 'check-circle', tone: 'violet' }
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
  function branchNameOf(id) { const b = branchOf(id); return b.name || b.id || ''; }
function dueLabel(dueISO) {
  const d = toDate(dueISO);
  if (!d) return ' - ';
  return d.getDate() + ' ' + d.toLocaleDateString('en-IN', { month: 'short' });
}

  // ---------- data load ----------
  async function load() {
    showSkeleton();
    try {
      const branchConstraint = isHead ? where('branchId', '==', fixedBranch) : null;
      const q = branchConstraint ? query(collection(db, 'students'), branchConstraint) : collection(db, 'students');
      const sSnap = await getDocs(q);
      students = sSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

      const cSnap = await getDocs(query(collection(db, 'courses'), where('ctx', '==', 'youth')));
      courses = cSnap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter(c => (c.status || 'active') === 'active');

      const bSnap = await getDocs(collection(db, 'batches'));
      batches = bSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));

      if (isSuper) {
        const brSnap = await getDocs(collection(db, 'branches'));
        branches = brSnap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter(b => (b.status || 'active') === 'active');
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
        tb.setFilterOptions('branch', [{ value: 'all', label: 'All branches', icon: 'git-branch' }].concat(branches.map(b => ({ value: b.id, label: b.name || b.id, icon: 'git-branch' }))));
      }

      if (branchSel) {
        branchSel.setOptions([{ value: '', label: 'Select a branch', icon: 'git-branch' }].concat(branches.map(b => ({ value: b.id, label: b.name || b.id, icon: 'git-branch' }))));
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
    } catch (e) {
      console.error('[admissions] load failed', e);
      showRealStats();
      stats.update(0, '-', 'This session');
      stats.update(1, '-', 'Admitted this month');
      stats.update(2, '-', 'Admitted today');
      stats.update(3, '-', 'Currently enrolled');
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
  function getBatchOptions(branchId, courseId, sessionId) {
    const opts = [];
    let matchCount = 0;
    batches.forEach(b => {
      if (b.branchId !== branchId) return;
      if (!batchAllowsCourse(b, courseId)) return;
      if (sessionId && b.sessionId !== sessionId) return;
      const st = batchStatusOf(b.id);
      if (st !== 'upcoming' && st !== 'running') return;
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
    if (sessionId && branchId && courseId) {
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
      const prereqEl = $('adm-prereq');
      if (prereqEl) prereqEl.hidden = true;
      updateFees(null, null);
      updateSeats();
      refreshForm();
      return;
    }

    const { opts, matchCount } = getBatchOptions(branchId, courseId, sessionId);
    if (matchCount === 0) {
      batchSel.setOptions([{ value: '', label: 'No open batch for this course in this branch', icon: 'layers', disabled: true }]);
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
        const docsSnap = await getDocs(query(collection(db, 'students', src.id, 'docs')));
        docsSnap.docs.forEach((d) => { keptDocs[d.id] = d.data(); });
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
    const fields = ['name', 'guardianName', 'phone', 'altPhone', 'email', 'dob', 'admissionDate', 'address'];
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
      branchSel.value = v.branchId || '';
      branchSel.disabled = !!editId;
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
  function render() {
    rowsHost.innerHTML = '';
    const f = tb.state || {};
    const q = (f.q || '').toLowerCase();
    const selSession = getSelectedSessionId();
    let list = students.filter(s => {
      if (selSession && s.sessionId !== selSession) return false;
      if (f.status && f.status !== 'all' && s.status !== f.status) return false;
      if (f.course && f.course !== 'all' && s.courseId !== f.course) return false;
      if (f.batch && f.batch !== 'all' && s.batchId !== f.batch) return false;
      if (isSuper && f.branch && f.branch !== 'all' && s.branchId !== f.branch) return false;
      if (q) {
        const c = courseOf(s.courseId);
        const hay = [s.name, s.studentId, s.phone, s.guardianName, c.courseCode || c.code, c.name, s.batchName || ''].map(x => (x || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => (b.admissionDate || '').localeCompare(a.admissionDate || ''));
    filteredList = list;

    const total = students.filter(s => !selSession || s.sessionId === selSession).length;
    const thisMonth = students.filter(s => {
      if (!selSession || s.sessionId !== selSession) return false;
      if (!s.admissionDate) return false;
      const d = new Date(s.admissionDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    const today = students.filter(s => {
      if (!selSession || s.sessionId !== selSession) return false;
      return s.admissionDate === new Date().toISOString().slice(0, 10);
    }).length;
    const active = students.filter(s => (!selSession || s.sessionId === selSession) && s.status === 'active').length;
    const selSessionId = getSelectedSessionId();
    const selSName = sessions.find(s => s.id === selSessionId)?.name || selSessionId || 'This session';
    stats.update(0, total, selSName);
    stats.update(1, thisMonth, 'Admitted this month');
    stats.update(2, today, 'Admitted today');
    stats.update(3, active, 'Currently enrolled');

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * PAGE_SIZE;
    const pageList = list.slice(start, start + PAGE_SIZE);

    const hasFilter = q || f.status !== 'all' || f.course !== 'all' || f.batch !== 'all' || (isSuper && f.branch !== 'all');

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
        cl.addEventListener('click', (ev) => { ev.preventDefault(); tb.state.q = ''; tb.state.status = 'all'; tb.state.course = 'all'; tb.state.batch = 'all'; if (isSuper) tb.state.branch = 'all'; render(); });
        tr.appendChild(td);
        rowsHost.appendChild(tr);
        if (footEl) footEl.hidden = true;
      }
    } else {
      if (empty) empty.hidden = true;
      pageList.forEach(s => {
        const tr = mk('tr');
        const c = courseOf(s.courseId);
        const b = batchOf(s.batchId);
        const st = STATUS_PILLS.find(x => x.value === s.status) || STATUS_PILLS[0];

        tr.appendChild(mk('td', '', s.studentId || ' - '));

        const tdSt = mk('td');
        tdSt.appendChild(mk('b', '', s.name || ' - '));
        tdSt.appendChild(mk('br'));
        tdSt.appendChild(mk('span', '', (s.guardianName || '') + (s.guardianName ? '  ·  ' : '') + (c.courseCode || c.code || '')));
        tr.appendChild(tdSt);

        tr.appendChild(mk('td', 'hide-sm', s.phone || ' - '));

        const tdCb = mk('td');
        tdCb.appendChild(mk('b', '', (c.courseCode || c.code || '') + '  -  ' + (c.name || '')));
        tdCb.appendChild(mk('br'));
        tdCb.appendChild(mk('span', '', b.name || ' - '));
        tr.appendChild(tdCb);

        tr.appendChild(mk('td', 'hide-sm', formatDateIN(s.admissionDate)));

        const tdSt2 = mk('td', 'hide-md');
        tdSt2.appendChild(mk('span', 'adm-pill ' + st.cls, st.label));
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
        const items = [
          { label: 'View', icon: 'eye', onClick: () => viewStudent(s) },
          { label: 'View student', icon: 'user', onClick: () => { location.hash = '#/students/' + s.studentId; } },
          { label: 'View admission receipt', icon: 'file-text', onClick: () => { location.hash = '#/admissions/' + s.id + '/receipt'; } },
          { label: 'Edit', icon: 'pencil', onClick: async () => {
            if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
            openForm(s);
          } }
        ];
        if (!isHead) {
          items.push('sep', { label: 'Change status', icon: 'edit-3', onClick: () => changeStatus(s) }, 'sep', { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => tryDelete(s) });
        }
        kebab.addEventListener('click', () => openMenu(kebab, items));
        tdAct.appendChild(kebab);
        tr.appendChild(tdAct);

        rowsHost.appendChild(tr);
      });

      if (footEl) {
        if (totalPages <= 1) {
          footEl.hidden = true;
        } else {
          footEl.hidden = false;
          const showingFrom = start + 1;
          const showingTo = Math.min(start + pageList.length, list.length);
          footEl.textContent = 'Showing ' + showingFrom + '-' + showingTo + ' of ' + list.length;
          footEl.innerHTML += ' <div style="display:inline-flex;gap:6px;align-items:center;margin-left:16px;">' +
            '<button type="button" id="adm-prev" class="ui-btn ghost' + (page <= 1 ? ' disabled' : '') + '">Prev</button>' +
            '<button type="button" id="adm-next" class="ui-btn ghost' + (page >= totalPages ? ' disabled' : '') + '">Next</button>' +
            '</div>';
        }
      }
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
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
      altPhone: r.altPhone || '', email: r.email || '', dob: r.dob || '',
      admissionDate: r.admissionDate || '', gender: r.gender || '',
      qualification: r.qualification || '', address: r.address || '',
      branchId: r.branchId || '', courseId: r.courseId || '', batchId: r.batchId || ''
    } : {
      name: '', guardianName: '', phone: '', altPhone: '', email: '', dob: '',
      admissionDate: new Date().toISOString().slice(0, 10), gender: '',
      qualification: '', address: '', branchId: fixedBranch || '', courseId: '', batchId: '', sessionId: '', sessionName: ''
    };
    fillForm(v);
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
        const docsSnap = await getDocs(query(collection(db, 'students', r.id, 'docs')));
        docsSnap.docs.forEach((d) => {
          const data = d.data();
          docOriginals[d.id] = data;
        });
        fillForm(v);
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
    const order = ['name', 'guardianName', 'phone', 'email', 'dob', 'admissionDate', 'gender', 'qualification', 'address', 'session', 'branch', 'course', 'batch', ...DOC_KEYS];
    const map = {
      name: 'adm-name', guardianName: 'adm-guardianName', phone: 'adm-phone', email: 'adm-email',
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
      location.hash = '#/admissions/' + admissionId + '/receipt';
    } else {
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
        ['Branch', s.branchName || '-'],
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

  if (footEl) {
    footEl.addEventListener('click', (ev) => {
      if (ev.target.id === 'adm-prev' && page > 1) { page--; render(); }
      if (ev.target.id === 'adm-next') { const tp = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE)); if (page < tp) { page++; render(); } }
    });
  }

  await load();
}

export function unmount() {
  clearDirty();
}















