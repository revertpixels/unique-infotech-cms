import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, deleteField } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.13';
import { registerDirty, confirmLeave } from '../utils/unsaved-guard.js?v=1.8.13';
import { buildStats, buildToolbar } from '../components/list-page.js?v=1.8.13';
import { createSelect } from '../components/ui-select.js?v=1.8.13';
import { openMenu } from '../components/ui-menu.js?v=1.8.13';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.13';
import { loadSessions } from '../core/sessions.js?v=1.8.13';
// Batches Part 2A/2B: add/edit form, delete, student capacity

const TEXT_KEYS = ['name', 'code', 'capacity'];
const BLANK = { name: '', code: '', courseId: '', sessionId: '', branchId: '', capacity: '' };

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

  // Form selects
  const courseSel = createSelect($('bt-course-host'), { options: [{ value: '', label: 'Select a course', icon: 'book-open' }], value: '', ariaLabel: 'Course', onChange: () => { paintCourseInfo(); touched = true; refresh(); } });
  const sessionSel = createSelect($('bt-session-host'), { options: [{ value: '', label: 'Select a session', icon: 'calendar-range' }], value: '', ariaLabel: 'Session', onChange: () => { paintSessionInfo(); touched = true; refresh(); } });
  let branchSel = null;
  if (youth) {
    branchSel = createSelect($('bt-branch-host'), { options: [{ value: '', label: 'Select a branch', icon: 'git-branch' }], value: '', ariaLabel: 'Branch', onChange: () => { touched = true; refresh(); } });
  } else {
    $('bt-branch-host').hidden = true;
    $('bt-branch-fixed').hidden = false;
  }

  const statsHost = $('bt-stats');
  const stats = buildStats([
    { label: 'Total batches', value: 0, sub: 'This centre', icon: 'users-round', tone: 'indigo' },
    { label: 'Running', value: 0, sub: 'Classes in progress', icon: 'play-circle', tone: 'green' },
    { label: 'Upcoming', value: 0, sub: 'Not started yet', icon: 'calendar-clock', tone: 'amber' },
    { label: 'Students', value: 0, sub: 'Across all batches', icon: 'graduation-cap', tone: 'violet' }
  ]);
  if (statsHost) statsHost.appendChild(stats.el);

  const tbHost = $('bt-toolbar');
  const tb = buildToolbar({
    placeholder: 'Search batch, code or course',
    filters: [
      { id: 'status', label: 'Status', options: [
        { value: 'all', label: 'All statuses' }, { value: 'upcoming', label: 'Upcoming' },
        { value: 'running', label: 'Running' }, { value: 'completed', label: 'Completed' },
        { value: 'archived', label: 'Archived' }
      ]},
      { id: 'session', label: 'Session', options: [{ value: 'all', label: 'All sessions' }] },
      ...(youth ? [{ id: 'branch', label: 'Branch', options: [{ value: 'all', label: 'All branches' }] }] : []),
      { id: 'level', label: 'Level', options: [
        { value: 'all', label: 'All levels' }, { value: '1', label: 'Semester 1 (Base Course)' },
        { value: '2', label: 'Semester 2 (Combo Course)' }, { value: '3', label: 'Semester 3 (Advanced Course)' }
      ]}
    ],
    onChange: () => render(),
    onRefresh: () => load()
  });
  if (tbHost) tbHost.appendChild(tb.el);

  let batches = [], sessions = [], branches = [], courses = [], coursesById = {};
  let editId = null, editRow = null, saved = Object.assign({}, BLANK), touched = false, saving = false;

  function courseOf(b) { return coursesById[b.courseId] || {}; }
  function sessionName(b) { const s = sessions.find(x => x.id === b.sessionId); return s ? (s.name || s.id) : (b.sessionName || ''); }
  function sessionDates(b) { const s = sessions.find(x => x.id === b.sessionId); return s ? { startDate: s.startDate || '', endDate: s.endDate || '' } : null; }
  function isReadOnly(b) { const st = batchStatus(b); return st === 'completed' || st === 'archived'; }
  // T2: batch status is DERIVED from its session (no stored status).
  function batchStatus(b) {
    const s = sessions.find(x => x.id === b.sessionId);
    if (!s) return 'completed';
    if (s.status === 'upcoming') return 'upcoming';
    if (s.status === 'running') return 'running';
    if (s.status === 'closed') return 'completed';
    if (s.status === 'archived') return 'archived';
    return 'completed';
  }

  function branchName(b) { if (!youth) return b.branchName || 'Head Office'; const br = branches.find(x => x.id === b.branchId); return br ? (br.name || br.id) : (b.branchName || ''); }

  function paintCourseInfo() {
    const c = coursesById[courseSel.value];
    const pre = $('bt-prereq');
    const fee = $('bt-examfee');
    const note = $('bt-examfee-note');
    if (!c) { pre.hidden = true; fee.hidden = true; note.hidden = true; return; }
    const p = coursePrereq(c, coursesById);
    pre.textContent = 'Prerequisite: ' + (p || 'None');
    pre.hidden = false;
    const ef = courseExamFee(c);
    fee.textContent = ef != null ? 'Exam fee locked at ₹' + Number(ef).toLocaleString('en-IN') : '';
    fee.hidden = ef == null;
    // Edit: if course changed from original, keep lockedExamFee but show note.
    const changed = !!(editRow && editRow.courseId && editRow.courseId !== c.id);
    note.textContent = changed && editRow.lockedExamFee != null ? 'Exam fee stays locked at ₹' + Number(editRow.lockedExamFee).toLocaleString('en-IN') + ' (set when the batch was created).' : '';
    note.hidden = !changed || editRow.lockedExamFee == null;
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
    v.courseId = courseSel.value || '';
    v.sessionId = sessionSel.value || '';
    v.branchId = youth ? (branchSel ? branchSel.value : '') : 'HO';

    return v;
  }
  function fillForm(v) {
    TEXT_KEYS.forEach((k) => { const e = $('bt-' + k); if (e) e.value = v[k] != null ? v[k] : ''; });
    courseSel.value = v.courseId || '';
    sessionSel.value = v.sessionId || '';
    if (youth && branchSel) branchSel.value = v.branchId || '';
    paintSessionInfo();
    paintCourseInfo();
  }
  function snapshot(v) { return JSON.stringify(v || readForm()); }

  function validate(v) {
    const err = {};
    if (!v.name) err.name = 'Batch name is required.';
    if (!v.courseId) err.course = 'Select a course.';
    if (!v.sessionId) err.session = 'Select a session.';
    if (youth && !v.branchId) err.branch = 'Select a branch.';
    const rawCap = $('bt-capacity').value.trim();
    if (rawCap !== '') {
      const n = Number(rawCap);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) err.capacity = 'Capacity must be a whole number (0 or more).';
    }
    return err;
  }
  function showErrors(err) {
    ['name', 'course', 'session', 'branch', 'capacity'].forEach((k) => {
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
  }

  function rebuildSelectOptions() {
    const activeSessions = sessions.filter(s => s.status === 'upcoming' || s.status === 'running');
    courseSel.setOptions([{ value: '', label: 'Select a course', icon: 'book-open' }].concat(courses.map(c => ({ value: c.id, label: (courseCode(c) ? courseCode(c) + ' — ' : '') + (courseName(c) || c.id), icon: 'book-open' }))));
    sessionSel.setOptions([{ value: '', label: 'Select a session', icon: 'calendar-range' }].concat(activeSessions.map(s => ({ value: s.id, label: s.name || s.id, icon: 'calendar-range' }))));
    if (youth && branchSel) {
      const activeBranches = branches.filter(b => (b.status || 'active') === 'active');
      branchSel.setOptions([{ value: '', label: 'Select a branch', icon: 'git-branch' }].concat(activeBranches.map(b => ({ value: b.id, label: b.name || b.id, icon: 'git-branch' }))));
    }
  }

  async function load() {
    try {
      const bSnap = await getDocs(query(collection(db, 'batches'), where('ctx', '==', ctx)));
      batches = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      // T2: load ALL sessions of this ctx (incl. closed/archived) for batchStatus lookups.
      const sessSnap = await getDocs(query(collection(db, 'sessions'), where('ctx', '==', ctx)));
      sessions = sessSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      if (youth) {
        const brSnap = await getDocs(collection(db, 'branches'));
        branches = brSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(b => (b.status || 'active') === 'active');
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
    tb.setFilterOptions('session', [{ value: 'all', label: 'All sessions', icon: 'calendar-range' }].concat(sessions.map(s => ({ value: s.id, label: s.name || s.id, icon: 'calendar-range' }))));
    if (youth) tb.setFilterOptions('branch', [{ value: 'all', label: 'All branches', icon: 'git-branch' }].concat(branches.map(b => ({ value: b.id, label: b.name || b.id, icon: 'git-branch' }))));
    rebuildSelectOptions();
    render();
  }

  function openForm(r, readOnly) {
    editId = r ? r.id : null;
    editRow = r || null;
    const v = r ? {
      name: r.name || '', code: r.code || '', courseId: r.courseId || '',
      sessionId: r.sessionId || '', branchId: youth ? (r.branchId || '') : 'HO',
      capacity: (r.capacity === 0 || r.capacity) ? String(r.capacity) : ''
    } : Object.assign({}, BLANK, { branchId: youth ? '' : 'HO' });
    fillForm(v);
    $('bt-form-title').textContent = r ? 'Edit batch' : 'New batch';
    $('bt-save-label').textContent = r ? 'Save changes' : 'Add batch';
    form.hidden = false;
    touched = false;
    showErrors({});
    paintCourseInfo();
    paintSessionInfo();
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

  function render() {
    if (!rowsHost) return;
    rowsHost.innerHTML = '';
    const f = tb.state || {};
    const q = (f.q || '').toLowerCase();
    const list = batches.filter(b => {
      if (f.status && f.status !== 'all' && batchStatus(b) !== f.status) return false;
      if (f.session && f.session !== 'all' && b.sessionId !== f.session) return false;
      if (youth && f.branch && f.branch !== 'all' && b.branchId !== f.branch) return false;
      if (f.level && f.level !== 'all' && String(b.courseLevel || '') !== f.level) return false;
      if (q) {
        const c = courseOf(b);
        const hay = [b.name, b.code, c.code, c.name, c.courseCode].map(x => (x || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const total = batches.length;
    const running = batches.filter(x => batchStatus(x) === 'running').length;
    const upcoming = batches.filter(x => batchStatus(x) === 'upcoming').length;
    const students = batches.reduce((a, b) => a + (b.studentCount || 0), 0);
    stats.update(0, total, 'This centre');
    stats.update(1, running, 'Classes in progress');
    stats.update(2, upcoming, 'Not started yet');
    stats.update(3, students, 'Across all batches');

    if (countEl) countEl.textContent = batches.length + ' ' + (batches.length === 1 ? 'batch' : 'batches');
    if (empty) empty.hidden = batches.length > 0;

    if (batches.length && !list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'lp-empty';
      td.colSpan = 7;
      td.textContent = 'No batches match your search or filter.';
      tr.appendChild(td);
      rowsHost.appendChild(tr);
    }

    list.forEach(b => {
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
      tdCourse.textContent = (c.courseCode || c.code || '') + ' ';
      const lvl = document.createElement('span');
      lvl.className = 'bt-level';
      lvl.textContent = 'Sem ' + (b.courseLevel || c.level || '');
      tdCourse.appendChild(lvl);
      if (b.lockedExamFee != null) {
        const sub2 = document.createElement('span');
        sub2.className = 'bt-muted';
        sub2.textContent = 'Exam fee locked: ₹' + b.lockedExamFee;
        tdCourse.appendChild(document.createElement('br'));
        tdCourse.appendChild(sub2);
      }
      tr.appendChild(tdCourse);

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
      kebab.addEventListener('click', () => openMenu(kebab, [
        
        { label: isReadOnly(b) ? 'View' : 'Edit', icon: 'pencil', onClick: async () => {
          if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
          openForm(b, isReadOnly(b));
        } },
        'sep',
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => tryDelete(b) }
      ]));
      tdAct.appendChild(kebab);
      tr.appendChild(tdAct);

      rowsHost.appendChild(tr);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function focusFirstError(err) {
    if (err.name) return $('bt-name').focus();
    if (err.course) return courseSel.focus();
    if (err.session) return sessionSel.focus();
    if (err.branch && youth && branchSel) return branchSel.focus();
    if (err.capacity) return $('bt-capacity').focus();
  }

  async function save() {
    const v = readForm();
    touched = true;
    const err = validate(v);
    showErrors(err);
    const firstBad = ['name', 'course', 'session', 'branch', 'start', 'end', 'capacity'].find(k => err[k]);
    if (firstBad) {
      noteState('Please fix the highlighted fields', 'error');
      focusFirstError(err);
      return;
    }
    const course = coursesById[v.courseId] || {};
    const session = sessions.find(s => s.id === v.sessionId) || {};
    const branch = youth ? (branches.find(b => b.id === v.branchId) || {}) : { id: 'HO', name: 'Head Office' };
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
      sessionId: v.sessionId,
      sessionName: session.name || session.id || v.sessionId,
      branchId: branch.id || v.branchId,
      branchName: branch.name || (youth ? v.branchId : 'Head Office'),
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
      saving = false;
      closeForm();
      await load();
      showToast(wasEdit ? 'Batch updated.' : 'Batch added.', 'success');
    } catch (e) {
      console.error('[batches] save failed', e);
      saving = false;
      refresh();
      noteState('Save failed (' + (e.code || 'error') + ')', 'error');
      showToast('Save failed (' + (e.code || 'error') + ').', 'error');
    }
  }

  async function tryDelete(b) {
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
    if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
    openForm(null);
  });
  cancelBtn.addEventListener('click', async () => {
    if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
    closeForm();
  });
  registerDirty(() => !form.hidden && !saveBtn.disabled && !saving);
  form.addEventListener('input', (ev) => {
    if (ev.target && ev.target.id === 'bt-code') ev.target.value = ev.target.value.toUpperCase();
    touched = true;
    refresh();
  });
  form.addEventListener('change', () => { touched = true; refresh(); });
  formEl.addEventListener('submit', (ev) => { ev.preventDefault(); save(); });

  await load();
}
