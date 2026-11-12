import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where, doc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.53';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.53';
import { buildStats, buildToolbar } from '../components/list-page.js?v=1.8.53';
import { createSelect } from '../components/ui-select.js?v=1.8.53';
import { openMenu } from '../components/ui-menu.js?v=1.8.53';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.53';
import { getSelectedSessionId, getCachedSessions, loadSessions, todayISO } from '../core/sessions.js?v=1.8.53';
import { firstInstallmentOf, admissionState, sessionLabel, installmentSchedule, batchAllowsCourse, batchCourseLabel, isCourseActive } from '../utils/session-rules.js?v=1.8.53';
import { formatINR, formatDateIN, initials } from '../utils/formatter.js?v=1.8.53';
import { validatePhone, validateEmail, validateDOB, validateName, validateRequired } from '../utils/validator.js?v=1.8.53';
import { listStudentsRaw, checkDuplicatePhone, generateAdmissionNumber, createStudentWithDocs, updateStudentWithDocs, updateStudent, deleteStudent } from '../services/admission.service.js?v=1.8.53';
import { feeTotal } from '../utils/fees.js?v=1.8.53';
import { compressTo100KB, readAsDataURL, blobToDataURL, isImageFile, formatBytes } from '../utils/image-compress.js?v=1.8.53';

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

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[admissions] missing #' + id); return el; }
function $t(id, text) { const el = $(id); if (el) el.textContent = text; }
function $v(id, value) { const el = $(id); if (el) el.value = value; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
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
  let returnDoc = null;          // { id, sessionId, admissionNo, sessionName } of found returning student
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
      sessions.filter(s => (s.status || 'upcoming') === 'upcoming' || (s.status || 'upcoming') === 'running')
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
        .forEach((s) => {
          const st = s.status || 'upcoming';
          let disabled = false;
          let label = sessionLabel(s);
          if (st === 'running') {
            const fi = firstInstallmentOf(s);
            if (fi && today > fi) {
              disabled = true;
              label = s.name + ' · Closed for admission (1st installment ' + formatDateIN(fi) + ' passed)';
            }
          }
          sessOpts.push({ value: s.id, label: label, icon: 'calendar-clock', disabled: disabled });
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
    returnDoc = null; keptDocs = {}; docAction = {};
    clearReturnUI();
    try {
      const q = query(collection(db, 'students'), where('admissionNo', '==', studentId));
      const snap = await getDocs(q);
      let candidates = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
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
        admissionNo: src.admissionNo,
        sessionName: src.sessionName || ''
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
      if (el) el.remove();
    });
  }

  function clearReturnState() {
    returnDoc = null; keptDocs = {}; docAction = {};
    clearReturnUI();
    lookupInp.value = '';
    lookupStatus.textContent = '';
    lookupStatus.className = '';
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
      const thumb = old.data ? ('data:image/jpeg;base64,' + old.data) : '';
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
    if (branchSel) branchSel.value = v.branchId || '';
    courseSel.value = v.courseId || '';
    batchSel.value = v.batchId || '';
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
          img.src = docOriginals[k].data;
          img.style.objectFit = (k === 'photo') ? 'cover' : 'contain';
          if (k === 'signature') img.style.background = '#FFFFFF';
          box.appendChild(img);
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
        const hay = [s.name, s.admissionNo, s.phone, s.guardianName, c.courseCode || c.code, c.name, s.batchName || ''].map(x => (x || '').toLowerCase()).join(' ');
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

        tr.appendChild(mk('td', '', s.admissionNo || ' - '));

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
    $t('adm-save-label', r ? 'Save changes' : 'Add student');
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
    const b = batchOf(v.batchId);
    if (b && b.capacity) {
      const cap = Number(b.capacity);
      const filled = students.filter(s => s.batchId === b.id && s.status === 'active' && s.id !== editId).length;
      if (filled >= cap) {
        $t('adm-batch-err', 'This batch is full.');
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
    const year = today.slice(0, 4);
    let admissionNo;
    const sourceAdmissionRef = returnDoc ? { sessionId: returnDoc.sessionId, admissionId: returnDoc.id } : null;
    if (editId) {
      admissionNo = (editRow && editRow.admissionNo ? editRow.admissionNo : '');
    } else if (returnDoc) {
      admissionNo = returnDoc.admissionNo; // T2: keep the same studentId, do not generate a new one
    } else {
      admissionNo = await generateAdmissionNumber(branchCode, year);
    }

    // ---------- documents (T1/T2/T3) ----------
    const docs = {};
    try {
      await Promise.all(DOC_KEYS.map(async (k) => {
        const action = docAction[k] || 'new';
        const df = docFiles[k];
        const old = keptDocs[k];
        if (action === 'remove') { docs[k] = false; return; }
        if (action === 'keep' && old) {
          // T1: identical copy of the old doc into the new admission's docs subcollection (Firestore base64 only)
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
      // T1: any doc read/copy failure -> save nothing
      throw e;
    }

    const data = {
      admissionNo: admissionNo,
      name: v.name,
      guardianName: v.guardianName,
      phone: v.phone,
      altPhone: v.altPhone || '',
      email: v.email || '',
      dob: v.dob,
      admissionDate: v.admissionDate || today,
      gender: v.gender,
      qualification: v.qualification,
      address: v.address,
      ctx: 'youth',
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
      feeSnapshot: c.fees || {},
      feeTotal: feeTotal(c.fees || {}),
      feeSchedule: sched.map(function (it) { return { no: it.no, month: it.month, opens: it.opens, due: it.due, amount: f.installment || 0 }; }),
      examFee: f.exam || 0,
      dueAtAdmission: { admission: Number(f.admission || 0), material: Number(f.material || 0), total: Number(f.admission || 0) + Number(f.material || 0) },
      status: 'active',
      docs: {},
      createdAt: editId ? undefined : serverTimestamp(),
      createdBy: editId ? undefined : who,
      updatedAt: serverTimestamp(),
      sourceAdmissionRef: sourceAdmissionRef
    };
    DOC_KEYS.forEach((k) => { data.docs[k] = !!docs[k]; });
    if (!editId) {
      data.createdAt = serverTimestamp();
      data.createdBy = who;
    }

    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    const saveIcon = saveBtn.querySelector('i');
    if (saveIcon) saveIcon.setAttribute('data-lucide', 'loader');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    $t('adm-state', 'Saving...');
    const stateEl = $('adm-state');
    if (stateEl) stateEl.className = 'save-state dirty';

    try {
      const wasEdit = !!editId;
      if (wasEdit) {
        await updateStudentWithDocs(editId, data, docs);
      } else {
        await createStudentWithDocs(data, docs);
      }
      saving = false;
      closeForm();
      await load();
      showToast('Admission saved - ' + admissionNo, 'success');
    } catch (e) {
      console.error('[admissions] save failed', e);
      saving = false;
      refreshForm();
      if (saveIcon) saveIcon.setAttribute('data-lucide', 'save');
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
    const msg = [
      'Admission No: ' + (s.admissionNo || ' - '),
      'Student: ' + (s.name || ' - '),
      'Guardian: ' + (s.guardianName || ' - '),
      'Phone: ' + (s.phone || ' - '),
      'Email: ' + (s.email || ' - '),
      'DOB: ' + formatDateIN(s.dob),
      'Admission date: ' + formatDateIN(s.admissionDate),
      'Gender: ' + (s.gender || ' - '),
      'Qualification: ' + (s.qualification || ' - '),
      'Address: ' + (s.address || ' - '),
      'Course: ' + ((c.courseCode || c.code || '') + '  -  ' + (c.name || '')),
      'Batch: ' + (b.name || ' - '),
      'Session: ' + (s.sessionName || ' - '),
      'Status: ' + (s.status || 'active'),
      'Fees: ' + formatINR(s.feeTotal || 0)
    ].join('\n');
    await confirmDialog({
      title: 'Student details',
      message: msg,
      confirmText: 'OK', infoOnly: true, icon: 'user'
    });
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
      message: 'Delete "' + (s.name || 'this student') + '" (' + (s.admissionNo || '') + ')? This cannot be undone. Type DELETE to confirm.',
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
  form.addEventListener('input', () => { touched = true; refreshForm(); });
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
      img.src = docFiles[k].dataUrl;
      img.style.objectFit = (k === 'photo') ? 'cover' : 'contain';
      if (k === 'signature') img.style.background = '#FFFFFF';
      box.appendChild(img);
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















