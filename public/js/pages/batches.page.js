import { db } from '../config/firebase-config.js';
import { collection, getDocs, getDoc, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, deleteField } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.178';
import { registerDirty, confirmLeave } from '../utils/unsaved-guard.js?v=1.8.178';
import { PAGE_SIZE, buildStats, buildToolbar, renderPager, renderEmptyTableState } from '../components/list-page.js?v=1.8.178';
import { createSelect } from '../components/ui-select.js?v=1.8.178';
import { createMultiSelect } from '../components/multi-select.js?v=1.8.178';
import { openMenu } from '../components/ui-menu.js?v=1.8.178';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.178';
import { loadSessions, getSelectedSessionId, getSelectedSession, getCachedSessions } from '../core/sessions.js?v=1.8.178';
import { batchAllowsCourse, batchCourseLabel, batchCourseTooltip, isCourseActive } from '../utils/session-rules.js?v=1.8.178';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.178';
// Batches Part 2A/2B: add/edit form, delete, student capacity

const TEXT_KEYS = ['name', 'code', 'capacity'];
const BLANK = { name: '', code: '', capacity: '', allCourses: false, courseIds: [], sessionId: '', branchId: '' };

function $(id) { return document.getElementById(id); }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function num(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
// T0: course fields follow courses.page.js docs: courseCode/code, name, level, prerequisiteId/prerequisiteCode/eligibility/prerequisite, fees.exam (semester exam fee).
function courseCode(c) { return c && (c.courseCode || c.code || '') || ''; }
function courseName(c) { return c && c.name || ''; }
function courseLevel(c) { const n = Number(c && c.level); return Number.isFinite(n) ? n : ''; }
function courseExamFee(c) { if (!c) return null; const fees = c.fees || {}; if (fees.exam !== undefined && fees.exam !== null && fees.exam !== '') return num(fees.exam); if (c.examFee !== undefined && c.examFee !== null && c.examFee !== '') return num(c.examFee); return null; }
function coursePrereq(c, byId) {
  if (!c) return '';
  if (c.prerequisiteCode) return c.prerequisiteCode;
  if (c.prerequisite) return c.prerequisite;
  if (c.prerequisiteId && byId && byId[c.prerequisiteId]) return courseCode(byId[c.prerequisiteId]) || courseName(byId[c.prerequisiteId]);
  return c.eligibility || '';
}

export async function mount({ profile, ctx }) {
  const isSuper = profile && profile.role === 'superadmin';
  const isBranchHead = profile && profile.role === 'branch_head';
  const myBranchId = isBranchHead ? profile.branchId : null;
  const youth = ctx === 'youth';
  const sub = $('bt-sub');
  if (sub) sub.textContent = youth ? 'Teaching groups per course, session and branch.' : 'Unique Kids teaching groups (Head Office).';

  const branchCol = $('bt-col-branch');
  if (!youth && branchCol) branchCol.style.display = 'none';

  const form = $('bt-form');
  const formEl = form;
  const addBtn = $('bt-add');
  const saveBtn = $('bt-save');
  const cancelBtn = $('bt-cancel');
  if (!form || !addBtn || !saveBtn || !cancelBtn) return;

  let courseSel, sessionSel, branchSel = null;

  const statsHost = $('bt-stats');
  const stats = buildStats([
    { label: 'Total batches', value: 0, sub: 'This centre', icon: 'users-round', tone: 'indigo' },
    ...(youth ? [
      { label: 'Running', value: 0, sub: 'Classes in progress', icon: 'play-circle', tone: 'green' },
      { label: 'Upcoming', value: 0, sub: 'Not started yet', icon: 'calendar-clock', tone: 'amber' }
    ] : [
      { label: 'Active', value: 0, sub: 'Active batches', icon: 'play-circle', tone: 'green' },
      { label: 'Inactive', value: 0, sub: 'Inactive batches', icon: 'calendar-clock', tone: 'amber' }
    ]),
    { label: 'Students', value: 0, sub: 'Across all batches', icon: 'graduation-cap', tone: 'violet' }
  ]);
  if (statsHost) statsHost.appendChild(stats.el);

  try {
  const tbHost = $('bt-toolbar');
  const tb = buildToolbar({
    placeholder: youth ? 'Search batch, code or course' : 'Search batch, code or level',
      filters: [
        { id: 'status', label: 'Status', options: youth
          ? [
              { value: 'all', label: 'All statuses' }, { value: 'upcoming', label: 'Upcoming' },
              { value: 'running', label: 'Running' }, { value: 'completed', label: 'Completed' },
              { value: 'archived', label: 'Archived' }
            ]
          : [
              { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' }
            ]
        },
        ...(youth ? [{ id: 'branch', label: 'Branch', options: [{ value: 'all', label: 'All branches' }] }] : []),
        { id: 'course', label: youth ? 'Course' : 'Level', options: [{ value: 'all', label: youth ? 'All courses' : 'All levels', icon: 'book-open' }] },
        ...(youth ? [{ id: 'level', label: 'Level', options: [
          { value: 'all', label: 'All levels' }, { value: '1', label: 'Semester 1 (Base Course)' },
          { value: '2', label: 'Semester 2 (Combo Course)' }, { value: '3', label: 'Semester 3 (Advanced Course)' }
        ]}] : [])
    ],
    onChange: () => { page = 1; render(); },
    onRefresh: () => load()
  });
  if (tbHost) tbHost.appendChild(tb.el);

  // Form selects (inside try so a broken component doesn't blank the page)
  try {
    courseSel = createMultiSelect($('bt-course-host'), {
      options: [], ariaLabel: 'Courses',
      branchType: youth ? 'youth' : 'unique-kids',
      onChange: () => { touched = true; refresh(); }
    });
    if (youth) {
      sessionSel = createSelect($('bt-session-host'), { options: [{ value: '', label: 'Select a session', icon: 'calendar-range' }], value: '', ariaLabel: 'Session', onChange: () => { paintSessionInfo(); touched = true; refresh(); } });
      branchSel = createSelect($('bt-branch-host'), { options: [{ value: '', label: 'Select a branch', icon: 'git-branch' }], value: isSuper ? '' : (myBranchId || ''), ariaLabel: 'Branch', disabled: !isSuper, onChange: () => { touched = true; refresh(); } });
    } else {
      $('bt-session-field').hidden = true;
      $('bt-branch-field').hidden = true;
    }
  } catch (err) {
    console.error('[batches] form init', err);
    showToast("Batch form failed to load. Refresh the page.", 'error');
  }

  let batches = [], sessions = [], branches = [], courses = [], coursesById = {};
  let editId = null, editRow = null, saved = Object.assign({}, BLANK), touched = false, saving = false;

  function courseOf(b) { return coursesById[b.courseId] || {}; }
  function sessionName(b) { const s = sessions.find(x => x.id === b.sessionId); return s ? (s.name || s.id) : (b.sessionName || ''); }
  function sessionDates(b) { const s = sessions.find(x => x.id === b.sessionId); return s ? { startDate: s.startDate || '', endDate: s.endDate || '' } : null; }
  function isReadOnly(b) { const st = batchStatus(b); return st === 'completed' || st === 'archived'; }
  // T2: batch status for Youth is DERIVED from its session.
  // For Kids (school), batches are session-independent: use stored status, default Active.
  function batchStatus(b) {
    if (!youth) {
      const st = b.status || 'active';
      if (st === 'completed' || st === 'archived') return st;
      if (st === 'inactive') return 'completed';
      return 'active';
    }
    const s = sessions.find(x => x.id === b.sessionId);
    if (!s) return 'completed';
    if (s.status === 'upcoming') return 'upcoming';
    if (s.status === 'running') return 'running';
    if (s.status === 'closed') return 'completed';
    if (s.status === 'archived') return 'archived';
    return 'completed';
  }

  function branchName(b) {
    if (!youth) return b.branchName || 'Head Office';
    const br = branches.find(x => x.id === b.branchId);
    if (br && br.name) return br.name;
    if (b.branchName && b.branchName !== b.branchId) return b.branchName;
    console.warn('[batches] Unknown branch for batch:', b);
    return 'Unknown branch';
  }
  function resolveBatchBranch({ youth, existingBatch, selectedBranchId, branches }) {
    if (!youth) {
      const existingId = typeof existingBatch?.branchId === 'string' ? existingBatch.branchId.trim() : '';
      const existingName = typeof existingBatch?.branchName === 'string' ? existingBatch.branchName.trim() : '';
      return { branchId: existingId || 'HO', branchName: existingName || 'Head Office' };
    }
    const selected = branches.find(branch => branch.id === selectedBranchId);
    if (!selected) {
      if (selectedBranchId) console.warn('[batches] Selected branch not found in loaded branches:', selectedBranchId);
      return { branchId: selectedBranchId || '', branchName: 'Unknown branch' };
    }
    return { branchId: selected.id, branchName: selected.name || 'Unknown branch' };
  }

  function paintCourseInfo() {
    // No blue info boxes under Course per UI rule (docs/03-DECISIONS.md).
    // Prerequisite/exam fee data still computed and saved; only not shown.
  }
  function paintSessionInfo() {
    const info = $('bt-session-info');
    if (!info) return;
    const s = sessionSel.value ? sessions.find(x => x.id === sessionSel.value) : null;
    if (!s) { info.hidden = true; info.textContent = ''; return; }
    const start = s.startDate || '';
    const end = s.endDate || '';
    const st = s.status || '';
    const label = st.charAt(0).toUpperCase() + st.slice(1);
    const fmt = (iso) => { if (!iso) return ''; const p = iso.split('-').map(Number); const dt = new Date(p[0], p[1]-1, p[2]); return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
    info.textContent = 'Runs ' + fmt(start) + ' \u2013 ' + fmt(end) + ' \u00b7 ' + label;
    info.hidden = false;
  }
  function updateCounters() {
    form.querySelectorAll('.ui-count[data-for]').forEach((c) => {
      const e = $(c.dataset.for);
      if (e) c.textContent = e.value.length + '/' + e.maxLength;
    });
  }
  function noteState(text, cls) {
    const s = $('bt-state');
    if (!s) return;
    s.textContent = text;
    s.className = 'save-state' + (cls ? ' ' + cls : '');
  }

  function readForm() {
    const v = {};
    TEXT_KEYS.forEach((k) => { const e = $('bt-' + k); v[k] = e ? e.value.trim() : ''; });
    v.code = v.code.toUpperCase();
    const cs = courseSel.value;
    v.allCourses = !!cs.allCourses;
    v.courseIds = cs.courseIds && cs.courseIds.length ? cs.courseIds.slice() : [];
    v.courseId = v.allCourses ? null : (v.courseIds[0] || '');
    v.sessionId = youth ? (sessionSel.value || '') : '';
    v.branchId = youth ? (isSuper ? (branchSel ? branchSel.value : '') : (myBranchId || '')) : (editRow && editRow.branchId ? editRow.branchId.trim() : 'HO');

    return v;
  }
  function fillForm(v) {
    TEXT_KEYS.forEach((k) => { const e = $('bt-' + k); if (e) e.value = v[k] != null ? v[k] : ''; });
    courseSel.value = { allCourses: !!v.allCourses, courseIds: v.courseIds && v.courseIds.length ? v.courseIds.slice() : (v.courseId ? [v.courseId] : []) };
    if (youth) sessionSel.value = v.sessionId || '';
    if (youth && branchSel) {
      branchSel.value = isSuper ? (v.branchId || '') : (myBranchId || '');
      branchSel.disabled = !isSuper;
    }
    if (youth) paintSessionInfo();
    renderCourseChips();
  }
  function snapshot(v) { return JSON.stringify(v || readForm()); }

  function renderCourseChips() {
    const host = $('bt-course-codes');
    if (!host) return;
    host.innerHTML = '';
    const cs = courseSel.value;
    if (!cs || (!cs.allCourses && (!cs.courseIds || cs.courseIds.length === 0))) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    if (cs.allCourses) {
      const chip = mk('div', 'bt-course-chip');
      chip.textContent = 'All courses';
      const x = mk('span', 'bt-chip-x', '×');
      x.title = 'Clear all';
      x.addEventListener('click', (ev) => { ev.stopPropagation(); courseSel.value = { allCourses: false, courseIds: [] }; refresh(); });
      chip.appendChild(x);
      host.appendChild(chip);
    } else {
      cs.courseIds.forEach((id) => {
        const c = coursesById[id];
        const code = c ? (c.courseCode || c.code || id) : id;
        const inactive = c && !isCourseActive(c);
        const chip = mk('div', 'bt-course-chip' + (inactive ? ' inactive' : ''));
        chip.textContent = code + (inactive ? ' (inactive)' : '');
        const x = mk('span', 'bt-chip-x', '×');
        x.title = 'Remove ' + code;
        x.addEventListener('click', (ev) => { ev.stopPropagation(); courseSel.value = { allCourses: false, courseIds: cs.courseIds.filter((xid) => xid !== id) }; refresh(); });
        chip.appendChild(x);
        host.appendChild(chip);
      });
    }
  }

  function validate(v) {
    const err = {};
    if (!v.name) err.name = 'Batch name is required.';
    if (!v.allCourses && (!v.courseIds || v.courseIds.length === 0)) err.course = 'Select at least one course.';
    if (youth && !v.sessionId) err.session = 'Select a session.';
    if (youth && !v.branchId) err.branch = 'Select a branch.';
    const rawCap = $('bt-capacity').value.trim();
    if (rawCap !== '') {
      const n = Number(rawCap);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) err.capacity = 'Capacity must be a whole number (0 or more).';
    }
    return err;
  }
  function showErrors(err) {
    ['name', 'course', ...(youth ? ['session', 'branch'] : []), 'capacity'].forEach((k) => {
      const box = $('bt-' + k + '-err');
      if (box) box.textContent = err[k] || '';
      const el = $('bt-' + k);
      if (el && el.parentElement) el.parentElement.classList.toggle('is-invalid', !!err[k]);
    });
  }
  function refresh() {
    if (form.hidden) return;
    updateCounters();
    const dirty = snapshot() !== saved;
    if (touched) showErrors(validate(readForm()));
    saveBtn.disabled = saving || !dirty;
    cancelBtn.disabled = saving;
    if (!saving) noteState(dirty ? 'Unsaved changes' : (editId ? 'No changes yet' : 'Fill in the details'), dirty ? 'dirty' : '');
    renderCourseChips();
  }

  function rebuildSelectOptions() {
    const activeSessions = sessions.filter(s => s.status === 'upcoming' || s.status === 'running');
    courseSel.setOptions(courses.filter(isCourseActive).map(c => ({ value: c.id, label: (courseCode(c) ? courseCode(c) + '  -  ' : '') + (c.name || c.id), icon: 'book-open' })));
    if (youth) {
      sessionSel.setOptions([{ value: '', label: 'Select a session', icon: 'calendar-range' }].concat(activeSessions.map(s => ({ value: s.id, label: s.name || s.id, icon: 'calendar-range' }))));
    }
    if (youth && branchSel) {
      if (isSuper) {
        const activeBranches = branches.filter(b => (b.status || 'active') === 'active');
        branchSel.setOptions([{ value: '', label: 'Select a branch', icon: 'git-branch' }].concat(activeBranches.map(b => ({ value: b.id, label: b.name || 'Unknown branch', icon: 'git-branch' }))));
        branchSel.disabled = false;
      } else {
        const myBr = branches.find(b => b.id === myBranchId);
        const brLabel = (myBr && myBr.name) ? myBr.name : 'Unknown branch';
        if (!myBr || !myBr.name) {
          console.warn('[batches] Could not resolve branch name for myBranchId:', myBranchId);
        }
        branchSel.setOptions([{ value: myBranchId, label: brLabel, icon: 'git-branch' }]);
        branchSel.value = myBranchId;
        branchSel.disabled = true;
      }
    }
  }

  async function load() {
    try {
      const bSnap = await getDocs(query(collection(db, 'batches'), where('ctx', '==', ctx)));
      batches = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      if (isBranchHead && myBranchId) {
        batches = batches.filter(b => b.branchId === myBranchId);
      }
      if (youth) {
        // T2: load ALL sessions of this ctx (incl. closed/archived) for batchStatus lookups.
        const sessSnap = await getDocs(query(collection(db, 'sessions'), where('ctx', '==', ctx)));
        sessions = sessSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      }
      if (youth && isSuper) {
        const brSnap = await getDocs(collection(db, 'branches'));
        branches = brSnap.docs.map(d => Object.assign({ id: d.id }, d.data()))
          .filter(b => (!b.ctx || b.ctx === 'youth') && (b.status || 'active') === 'active');
      } else if (youth && isBranchHead && myBranchId) {
        try {
          const brSnap = await getDoc(doc(db, 'branches', myBranchId));
          if (brSnap.exists()) {
            branches = [Object.assign({ id: brSnap.id }, brSnap.data())];
          } else {
            console.warn('[batches] Branch doc does not exist for myBranchId:', myBranchId);
          }
        } catch (err) {
          console.warn('[batches] Failed to load own branch:', err);
        }
      }
      const cSnap = await getDocs(query(collection(db, 'courses'), where('ctx', '==', ctx)));
      courses = cSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      coursesById = {};
      courses.forEach(c => { coursesById[c.id] = c; });
    } catch (e) {
      console.error('[batches] load failed', e);
      showToast('Could not load batches (' + (e.code || 'error') + ').', 'error');
      batches = []; sessions = []; branches = []; courses = []; coursesById = {};
    }
    if (youth) {
      if (isSuper) {
        tb.setFilterOptions('branch', [{ value: 'all', label: 'All branches', icon: 'git-branch' }].concat(branches.map(b => ({ value: b.id, label: b.name || b.id, icon: 'git-branch' }))));
      } else if (myBranchId) {
        const myBr = branches.find(b => b.id === myBranchId);
        tb.setFilterOptions('branch', [{ value: myBranchId, label: (myBr && myBr.name) || myBranchId, icon: 'lock' }]);
        tb.state.branch = myBranchId;
      }
    }
    tb.setFilterOptions('course', [{ value: 'all', label: youth ? 'All courses' : 'All levels', icon: 'book-open' }].concat(courses.map(c => ({ value: c.id, label: (courseCode(c) ? courseCode(c) + '  -  ' : '') + (c.name || c.id), icon: 'book-open' }))));
    rebuildSelectOptions();
    render();
  }

  function openForm(r, readOnly) {
    editId = r ? r.id : null;
    editRow = r || null;
    const selectedBranchId = isSuper ? (r ? r.branchId : '') : (myBranchId || '');
    const branchInfo = resolveBatchBranch({ youth, existingBatch: r, selectedBranchId, branches });
    const v = r ? {
      name: r.name || '', code: r.code || '', courseId: r.courseId || '',
      allCourses: !!r.allCourses, courseIds: r.courseIds && r.courseIds.slice(),
      sessionId: youth ? (r.sessionId || '') : '',
      branchId: branchInfo.branchId,
      capacity: (r.capacity === 0 || r.capacity) ? String(r.capacity) : ''
    } : Object.assign({}, BLANK, { branchId: youth ? (isSuper ? '' : branchInfo.branchId) : branchInfo.branchId });
    // T2: set course options before filling form so selection renders correctly. Only active courses are offered.
    courseSel.setOptions(courses.filter(isCourseActive).map(c => ({ value: c.id, label: (courseCode(c) ? courseCode(c) + '  -  ' : '') + (c.name || c.id), icon: 'book-open' })));
    fillForm(v);
    $('bt-form-title').textContent = r ? 'Edit batch' : 'New batch';
    $('bt-save-label').textContent = r ? 'Save changes' : 'Add batch';
    form.hidden = false;
    touched = false;
    showErrors({});
    if (youth) paintSessionInfo();
    if (readOnly) {
      form.querySelectorAll('input, select, textarea').forEach(el => { el.readOnly = true; el.disabled = true; });
      form.querySelectorAll('.ui-select-btn').forEach(b => { b.disabled = true; });
      saveBtn.hidden = true;
      const note = $('bt-readonly-note');
      if (note) note.hidden = false;
    } else {
      form.querySelectorAll('input, select, textarea').forEach(el => { el.readOnly = false; el.disabled = false; });
      form.querySelectorAll('.ui-select-btn').forEach(b => { b.disabled = false; });
      saveBtn.hidden = false;
      const note = $('bt-readonly-note');
      if (note) note.hidden = true;
    }
    saved = snapshot(readForm());
    noteState(r ? 'No changes yet' : 'Fill in the details', '');
    refresh();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const nameEl = $('bt-name'); if (nameEl) nameEl.focus({ preventScroll: true });
  }
  function closeForm() {
    form.hidden = true;
    editId = null;
    editRow = null;
    showErrors({});
  }

  function setStateForSave(msg) { noteState(msg, 'dirty'); }

  const rowsHost = $('bt-rows');
  const empty = $('bt-empty');
  const countEl = $('bt-count');
  const footEl = $('bt-foot');
  let page = 1;

  function render() {
    if (!rowsHost) return;
    rowsHost.innerHTML = '';

    // T2: align header/body columns for Kids (no Session or Branch columns)
    const sessHeader = document.getElementById('bt-col-session');
    const branchHeader = document.getElementById('bt-col-branch');
    if (sessHeader) sessHeader.hidden = !youth;
    if (branchHeader) branchHeader.hidden = !youth;

    const activeSessObj = youth ? (getSelectedSession('youth') || sessions.find(s => s.id === getSelectedSessionId('youth')) || sessions.find(s => s.status === 'running') || sessions[0] || null) : null;
    const activeSessId = activeSessObj ? activeSessObj.id : '';
    if (sub) {
      sub.textContent = youth
        ? (activeSessObj ? `Session ${activeSessObj.name} — Teaching groups per course and branch.` : 'Teaching groups per course, session and branch.')
        : 'Unique Kids teaching groups (Head Office).';
    }
    const noSessEl = $('bt-no-session');
    if (noSessEl) noSessEl.hidden = !(youth && sessions.length === 0);

    const sessionBatches = youth && activeSessId ? batches.filter(b => b.sessionId === activeSessId) : batches;
    const f = tb.state || {};
    const q = (f.q || '').toLowerCase();
    const list = sessionBatches.filter(b => {
      if (f.status && f.status !== 'all' && batchStatus(b) !== f.status) return false;
      if (youth && f.branch && f.branch !== 'all' && b.branchId !== f.branch) return false;
      if (f.course && f.course !== 'all' && !batchAllowsCourse(b, f.course, courses)) return false;
      if (youth && f.level && f.level !== 'all' && String(b.courseLevel || b.level || '') !== f.level) return false;
      if (q) {
        const c = courseOf(b);
        const hay = [b.name, b.code, c.code, c.name, c.courseCode].map(x => (x || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const total = sessionBatches.length;
    if (youth) {
      const running = sessionBatches.filter(x => batchStatus(x) === 'running').length;
      const upcoming = sessionBatches.filter(x => batchStatus(x) === 'upcoming').length;
      const students = sessionBatches.reduce((a, b) => a + (b.studentCount || 0), 0);
      stats.update(0, total, activeSessObj ? `Session ${activeSessObj.name}` : 'This centre');
      stats.update(1, running, 'Classes in progress');
      stats.update(2, upcoming, 'Not started yet');
      stats.update(3, students, 'Across all batches');
    } else {
      const active = sessionBatches.filter(x => batchStatus(x) === 'active').length;
      const inactive = sessionBatches.filter(x => batchStatus(x) === 'completed' || batchStatus(x) === 'archived' || batchStatus(x) === 'inactive').length;
      const students = sessionBatches.reduce((a, b) => a + (b.studentCount || 0), 0);
      stats.update(0, total, 'This centre');
      stats.update(1, active, 'Active batches');
      stats.update(2, inactive, 'Inactive batches');
      stats.update(3, students, 'Across all batches');
    }

    if (countEl) countEl.textContent = list.length + ' ' + (list.length === 1 ? 'batch' : 'batches');
    if (empty) empty.hidden = sessionBatches.length > 0;
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const pageList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
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

    if (sessionBatches.length && !list.length) {
      renderEmptyTableState(rowsHost, {
        colSpan: youth ? 7 : 5,
        title: 'No matching batches',
        desc: 'No batches match your search or filter criteria.',
        onClear: () => {
          tb.clearSearch();
          if (tb.state.status) tb.setFilterValue('status', 'all');
          if (tb.state.course) tb.setFilterValue('course', 'all');
          if (tb.state.level) tb.setFilterValue('level', 'all');
          if (tb.state.branch && isSuper) tb.setFilterValue('branch', 'all');
          page = 1;
          render();
        }
      });
    }

    pageList.forEach(b => {
      const c = courseOf(b);
      const tr = document.createElement('tr');
      const tdBatch = document.createElement('td');
      tdBatch.className = 'bt-name';
      tdBatch.textContent = b.name || '\u2014';
      if (b.code) {
        const chip = document.createElement('span');
        chip.className = 'bt-code';
        chip.textContent = b.code;
        tdBatch.appendChild(chip);
      }
      tr.appendChild(tdBatch);

      const tdCourse = document.createElement('td');
      tdCourse.className = 'bt-course';
      const label = batchCourseLabel(b, courses);
      const tip = batchCourseTooltip(b, courses);
      tdCourse.textContent = label;
      if (tip) tdCourse.title = tip;
      tr.appendChild(tdCourse);

      if (youth) {
        const tdSess = document.createElement('td');
        const s0 = sessions.find(x => x.id === b.sessionId);
        const sessLine = document.createElement('div');
        sessLine.className = 'bt-name';
        sessLine.textContent = sessionName(b) || '\u2014';
        tdSess.appendChild(sessLine);
        if (s0 && (s0.startDate || s0.endDate)) {
          const dline = document.createElement('div');
          dline.className = 'bt-sess-dates';
          const fmt = (iso) => { if (!iso) return ''; const p2 = iso.split('-').map(Number); const dt = new Date(p2[0], p2[1]-1, p2[2]); return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
          dline.textContent = fmt(s0.startDate) + ' \u2013 ' + fmt(s0.endDate);
          tdSess.appendChild(dline);
        }
        tr.appendChild(tdSess);
      }

      if (youth) {
        const tdBr = document.createElement('td');
        tdBr.className = 'hide-sm';
        tdBr.textContent = branchName(b) || '\u2014';
        tr.appendChild(tdBr);
      }

      const tdStu = document.createElement('td');
      const stu = b.studentCount || 0;
      const capSet = b.capacity !== null && b.capacity !== undefined && b.capacity !== '';
      if (capSet) {
        tdStu.textContent = stu + ' / ' + b.capacity;
        if (stu >= Number(b.capacity)) tdStu.appendChild(mk('span', 'bt-full', 'Full'));
      } else {
        tdStu.textContent = String(stu);
      }
      tr.appendChild(tdStu);

      const tdStatus = document.createElement('td');
      const pill = document.createElement('span');
      const st = batchStatus(b);
      pill.className = 'bt-pill ' + st;
      pill.textContent = st.charAt(0).toUpperCase() + st.slice(1);
      tdStatus.appendChild(pill);
      tr.appendChild(tdStatus);

      const tdAct = document.createElement('td');
      tdAct.className = 'bt-actions';
      const kebab = mk('button', 'ui-kebab');
      kebab.type = 'button';
      kebab.setAttribute('aria-label', 'Actions for ' + (b.name || 'batch'));
      kebab.setAttribute('aria-haspopup', 'menu');
      kebab.setAttribute('aria-expanded', 'false');
      const ki = document.createElement('i');
      ki.setAttribute('data-lucide', 'more-vertical');
      kebab.appendChild(ki);
      const menuItems = [
        { label: isReadOnly(b) ? 'View' : 'Edit', icon: 'pencil', onClick: async () => {
          try {
            if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
            openForm(b, isReadOnly(b));
          } catch (e) {
            console.error('[batches] edit failed', e);
            showToast('Could not open batch: ' + (e.message || 'error'), 'error');
          }
        } }
      ];
      if (isSuper) {
        menuItems.push('sep');
        menuItems.push({ label: 'Delete', icon: 'trash-2', danger: true, onClick: () => tryDelete(b) });
      }
      kebab.addEventListener('click', () => openMenu(kebab, menuItems));
      tdAct.appendChild(kebab);
      tr.appendChild(tdAct);

      rowsHost.appendChild(tr);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function focusFirstError(err) {
    if (err.name) return $('bt-name').focus();
    if (err.course) return courseSel.focus();
    if (youth && err.session) return sessionSel.focus();
    if (youth && err.branch && branchSel) return branchSel.focus();
    if (err.capacity) return $('bt-capacity').focus();
  }

  async function save() {
    if (saving) return;

    const v = readForm();
    touched = true;
    const err = validate(v);
    showErrors(err);
    const checkKeys = youth ? ['name', 'course', 'session', 'branch', 'capacity'] : ['name', 'course', 'capacity'];
    const firstBad = checkKeys.find(k => err[k]);
    if (firstBad) {
      noteState('Please fix the highlighted fields', 'error');
      focusFirstError(err);
      return;
    }
    const course = coursesById[v.courseId] || {};
    const session = youth ? (sessions.find(s => s.id === v.sessionId) || {}) : {};
    const branchInfo = resolveBatchBranch({ youth, existingBatch: editRow, selectedBranchId: v.branchId, branches });
    if (youth && !branchInfo.branchId) {
      showErrors({ branch: 'Select a valid branch.' });
      noteState('Select a valid branch.', 'error');
      showToast('Select a valid branch.', 'error');
      if (branchSel) branchSel.focus();
      return;
    }
    const who = (profile && profile.email) ? profile.email : '';
    const capRaw = $('bt-capacity').value.trim();
    const capacity = capRaw === '' ? null : Number(capRaw);
    const prereq = coursePrereq(course, coursesById);
    const ef = courseExamFee(course);
    const data = {
      name: v.name,
      code: v.code,
      ctx,
      courseId: v.courseId,
      courseName: courseName(course),
      courseCode: courseCode(course),
      level: courseLevel(course),
      prerequisite: prereq || null,
      prerequisiteCourseCode: prereq || null,
      allCourses: !!v.allCourses,
      courseIds: v.courseIds,
      ...(youth ? { sessionId: v.sessionId, sessionName: session.name || session.id || v.sessionId } : {}),
      branchId: branchInfo.branchId,
      branchName: branchInfo.branchName,
      capacity,
      updatedAt: serverTimestamp(),
      updatedBy: who
    };
    if (editId) {
      // Edit: never change studentCount or lockedExamFee. Drop legacy date/status fields.
      data.startDate = deleteField();
      data.endDate = deleteField();
      data.status = deleteField();
    } else {
      data.studentCount = 0;
      data.lockedExamFee = ef != null ? ef : null;
      data.createdAt = serverTimestamp();
      data.createdBy = who;
    }
    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    setStateForSave('Saving...');
    try {
      const wasEdit = !!editId;
      if (editId) await updateDoc(doc(db, 'batches', editId), data);
      else await addDoc(collection(db, 'batches'), data);
      closeForm();
      await load();
      showToast(wasEdit ? 'Batch updated.' : 'Batch added.', 'success');
    } catch (e) {
      console.error('[batches] save failed', e);
      refresh();
      noteState('Save failed (' + (e.code || 'error') + ')', 'error');
      showToast('Save failed (' + (e.code || 'error') + ').', 'error');
    } finally {
      saving = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  }

  async function tryDelete(b) {
    if (!isSuper) {
      showToast(`Only ${getRoleTitle('superadmin')} can delete batches.`, 'error');
      return;
    }
    const n = b.studentCount || 0;
    if (n > 0) {
      await confirmDialog({
        title: 'Cannot delete this batch',
        message: 'This batch has ' + n + ' ' + (n === 1 ? 'student' : 'students') + '. Move or remove them before deleting.',
        confirmText: 'OK', icon: 'shield-alert', infoOnly: true
      });
      return;
    }
    if (!form.hidden && !saveBtn.disabled && editId !== b.id && !(await confirmLeave({ clear: false }))) return;
    const ok = await confirmDialog({
      title: 'Delete batch?',
      message: 'Delete "' + (b.name || 'this batch') + '"? This cannot be undone. Type DELETE to confirm.',
      confirmText: 'Delete batch', danger: true, requireText: 'DELETE'
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'batches', b.id));
      if (editId === b.id) closeForm();
      await load();
      showToast('Batch deleted.', 'success');
    } catch (e) {
      console.error('[batches] delete failed', e);
      showToast('Delete failed (' + (e.code || 'error') + ').', 'error');
    }
  }

  addBtn.addEventListener('click', async () => {
    try {
      if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
      openForm(null);
    } catch (e) {
      console.error('[batches] addBtn failed', e);
      showToast('Could not open batch form: ' + (e.message || 'error'), 'error');
    }
  });
  cancelBtn.addEventListener('click', async () => {
    try {
      if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
      closeForm();
    } catch (e) {
      console.error('[batches] cancelBtn failed', e);
      showToast('Error closing form', 'error');
    }
  });
  registerDirty(() => !form.hidden && !saveBtn.disabled && !saving);
  form.addEventListener('input', (ev) => {
    if (ev.target && ev.target.id === 'bt-code') ev.target.value = ev.target.value.toUpperCase();
    touched = true;
    refresh();
  });
  form.addEventListener('change', () => { touched = true; refresh(); });
  formEl.addEventListener('submit', (ev) => { ev.preventDefault(); save(); });

  const onToolbarSessionChange = () => {
    if (youth) render();
  };
  const onSessionsChanged = async () => {
    await load();
  };
  window.__btSessionCleanup && window.__btSessionCleanup();
  window.addEventListener('uic:session-selected', onToolbarSessionChange);
  window.addEventListener('uic:sessions-loaded', onToolbarSessionChange);
  window.addEventListener('uic:sessions-changed', onSessionsChanged);
  window.__btSessionCleanup = () => {
    window.removeEventListener('uic:session-selected', onToolbarSessionChange);
    window.removeEventListener('uic:sessions-loaded', onToolbarSessionChange);
    window.removeEventListener('uic:sessions-changed', onSessionsChanged);
  };

  await load();
  } catch (err) {
    console.error('[batches]', err);
    showToast("Couldn't load batches. Refresh the page.", 'error');
    const rowsHost = $('bt-rows');
    const empty = $('bt-empty');
    const countEl = $('bt-count');
    if (rowsHost) rowsHost.innerHTML = '';
    if (empty) empty.hidden = false;
    if (countEl) countEl.textContent = '0 batches';
  }
}

export function unmount() {
  if (window.__btSessionCleanup) {
    window.__btSessionCleanup();
    window.__btSessionCleanup = null;
  }
}


