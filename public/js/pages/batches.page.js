import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.5';
import { registerDirty } from '../utils/unsaved-guard.js?v=1.8.5';
import { buildStats, buildToolbar } from '../components/list-page.js?v=1.8.5';
import { loadSessions } from '../core/sessions.js?v=1.8.5';
// Part 2: form + registerDirty

function $(id) { return document.getElementById(id); }

export async function mount({ profile, ctx }) {
  const youth = ctx === 'youth';
  const sub = $('bt-sub');
  if (sub) sub.textContent = youth ? 'Teaching groups per course, session and branch.' : 'Unique Kids teaching groups (Head Office).';

  const branchCol = $('bt-col-branch');
  if (!youth && branchCol) branchCol.style.display = 'none';

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

  let batches = [], sessions = [], branches = [], courses = [];

  async function load() {
    try {
      const bSnap = await getDocs(query(collection(db, 'batches'), where('ctx', '==', ctx)));
      batches = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      sessions = await loadSessions(ctx);
      console.log('[batches] loaded', { ctx, sessions: sessions.length, branches: branches.length, batches: batches.length });
      if (youth) {
        const brSnap = await getDocs(collection(db, 'branches'));
        branches = brSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(b => (b.status || 'active') === 'active');
      }
      const cSnap = await getDocs(query(collection(db, 'courses'), where('ctx', '==', ctx)));
      courses = cSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    } catch (e) {
      console.error('[batches] load failed', e);
      showToast('Could not load batches (' + (e.code || 'error') + ').', 'error');
      batches = []; sessions = []; branches = []; courses = [];
    }
    tb.setFilterOptions('session', [{ value: 'all', label: 'All sessions' }].concat(sessions.map(s => ({ value: s.id, label: s.name || s.id }))));
    if (youth) tb.setFilterOptions('branch', [{ value: 'all', label: 'All branches' }].concat(branches.map(b => ({ value: b.id, label: b.name || b.id }))));
    render();
  }

  function courseOf(b) { return courses.find(c => c.id === b.courseId) || {}; }
  function sessionName(b) { const s = sessions.find(x => x.id === b.sessionId); return s ? (s.name || s.id) : (b.sessionName || ''); }
  function branchName(b) { const br = branches.find(x => x.id === b.branchId); return br ? (br.name || br.id) : (b.branchName || ''); }

  const rowsHost = $('bt-rows');
  const empty = $('bt-empty');
  const countEl = $('bt-count');

  function render() {
    if (!rowsHost) return;
    rowsHost.innerHTML = '';
    const f = tb.state || {};
    const q = (f.q || '').toLowerCase();
    const list = batches.filter(b => {
      if (f.status && f.status !== 'all' && (b.status || 'upcoming') !== f.status) return false;
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
    const running = batches.filter(x => x.status === 'running').length;
    const upcoming = batches.filter(x => x.status === 'upcoming').length;
    const students = batches.reduce((a, b) => a + (b.studentCount || 0), 0);
    stats.update(0, total, 'This centre');
    stats.update(1, running, 'Classes in progress');
    stats.update(2, upcoming, 'Not started yet');
    stats.update(3, students, 'Across all batches');

    if (countEl) countEl.textContent = batches.length + ' batches';
    if (empty) empty.hidden = batches.length > 0;

    if (batches.length && !list.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'lp-empty';
      td.colSpan = 8;
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
        sub2.textContent = 'Exam fee locked: Rs ' + b.lockedExamFee;
        tdCourse.appendChild(document.createElement('br'));
        tdCourse.appendChild(sub2);
      }
      tr.appendChild(tdCourse);

      const tdPre = document.createElement('td');
      tdPre.className = 'hide-md';
      tdPre.textContent = b.prerequisiteCourseCode || '\u2014';
      tr.appendChild(tdPre);

      const tdSess = document.createElement('td');
      tdSess.textContent = sessionName(b) || '\u2014';
      tr.appendChild(tdSess);

      if (youth) {
        const tdBr = document.createElement('td');
        tdBr.className = 'hide-sm';
        tdBr.textContent = branchName(b) || '\u2014';
        tr.appendChild(tdBr);
      }

      const tdStu = document.createElement('td');
      tdStu.textContent = (b.studentCount || 0) + (b.capacity ? '/' + b.capacity : '');
      tr.appendChild(tdStu);

      const tdStatus = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = 'bt-pill ' + (b.status || 'upcoming');
      pill.textContent = b.status || 'upcoming';
      tdStatus.appendChild(pill);
      tr.appendChild(tdStatus);

      const tdAct = document.createElement('td');
      tdAct.className = 'bt-actions';
      const btn = document.createElement('button');
      btn.className = 'ui-btn ghost';
      btn.textContent = 'Edit (Part 2)';
      btn.addEventListener('click', () => showToast('Coming in Part 2', 'info'));
      tdAct.appendChild(btn);
      tr.appendChild(tdAct);

      rowsHost.appendChild(tr);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  await load();
}
