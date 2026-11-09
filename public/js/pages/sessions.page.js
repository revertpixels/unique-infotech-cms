import { db } from '../config/firebase-config.js';
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createSelect } from '../components/ui-select.js';
import { openMenu } from '../components/ui-menu.js';
import { confirmDialog } from '../components/ui-confirm.js';
import { showToast } from '../components/toast.js';
import { registerDirty, confirmLeave } from '../utils/unsaved-guard.js?v=1.8.9';
import { buildStats, buildToolbar } from '../components/list-page.js';
import { notifySessionsChanged, todayISO, expectedStatus, statusMismatch, daysLeft } from '../core/sessions.js?v=1.8.9';

const TEXT_KEYS = ['name', 'start', 'end'];
const KEYS = ['name', 'start', 'end', 'status'];
const BLANK = { name: '', start: '', end: '', status: 'upcoming' };
const STATUS_OPTIONS = [
  { value: 'upcoming', label: 'Upcoming', icon: 'clock' },
  { value: 'running', label: 'Running', icon: 'play-circle' },
  { value: 'closed', label: 'Closed', icon: 'check-circle' },
  { value: 'archived', label: 'Archived', icon: 'archive' }
];
const PILL = { upcoming: 'up', running: 'on', closed: 'off', archived: 'arch' };
const LABEL = { upcoming: 'Upcoming', running: 'Running', closed: 'Closed', archived: 'Archived' };

function $(id) { return document.getElementById(id); }
function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function toDate(s) {
  if (!s) return null;
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function fmt(s) {
  const d = toDate(s);
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
function lengthText(a, b) {
  const s = toDate(a), e = toDate(b);
  if (!s || !e) return '—';
  const days = Math.round((e - s) / 86400000) + 1;
  const months = Math.round(days / 30.44);
  return months >= 1 ? months + (months === 1 ? ' month' : ' months') : days + ' days';
}

export async function mount({ profile, ctx }) {
  const form = $('ss-form');
  const tbody = $('ss-rows');
  const empty = $('ss-empty');
  const addBtn = $('ss-add');
  const saveBtn = $('ss-save');
  const cancelBtn = $('ss-cancel');
  const statusHost = $('ss-status');
  if (!form || !tbody || !addBtn || !saveBtn || !cancelBtn || !statusHost) return;

  const centre = (ctx === 'school') ? 'school' : 'youth';
  const sub = $('ss-sub');
  if (sub) sub.textContent = (centre === 'school' ? 'Unique Kids' : 'Youth Centre') + ' sessions. Only one session can be running at a time.';

  const statusSel = createSelect(statusHost, { options: STATUS_OPTIONS, value: 'upcoming', ariaLabel: 'Status' });

  let rows = [];
  const stats = buildStats([
    { label: 'Total sessions', value: 0, sub: 'All statuses', icon: 'calendar-range', tone: 'indigo' },
    { label: 'Running now', value: '—', sub: 'None running', icon: 'play-circle', tone: 'green' },
    { label: 'Upcoming', value: 0, sub: 'Not started yet', icon: 'clock', tone: 'sky' },
    { label: 'Days left', value: '—', sub: 'In running session', icon: 'hourglass', tone: 'amber' }
  ]);
  const statsHost = $('ss-stats');
  if (statsHost) statsHost.appendChild(stats.el);
  const tb = buildToolbar({
    placeholder: 'Search session name',
    filters: [{ id: 'status', label: 'Status', options: [
      { value: 'all', label: 'All statuses' }, { value: 'running', label: 'Running' },
      { value: 'upcoming', label: 'Upcoming' }, { value: 'closed', label: 'Closed' }, { value: 'archived', label: 'Archived' }
    ] }],
    onChange: () => render(),
    onRefresh: () => load()
  });
  const tbHost = $('ss-toolbar');
  if (tbHost) tbHost.appendChild(tb.el);
  let editId = null;
  let saved = Object.assign({}, BLANK);
  let touched = false;
  let saving = false;

  function note(text, isError) {
    if (!text) return;
    showToast({ type: isError ? 'error' : 'success', message: text });
  }
  function readForm() {
    const v = {};
    TEXT_KEYS.forEach((k) => { const e = $('ss-' + k); v[k] = e ? e.value.trim() : ''; });
    v.status = statusSel.value;
    return v;
  }
  function fillForm(v) {
    TEXT_KEYS.forEach((k) => { const e = $('ss-' + k); if (e) e.value = v[k] || ''; });
    statusSel.value = v.status || 'upcoming';
  }
  function validate(v) {
    const err = {};
    if (!v.name) err.name = 'Session name is required.';
    else if (rows.some((r) => r.id !== editId && (r.name || '').toLowerCase() === v.name.toLowerCase())) err.name = 'A session with this name already exists.';
    if (!v.start) err.start = 'Start date is required.';
    if (!v.end) err.end = 'End date is required.';
    else if (v.start && v.end <= v.start) err.end = 'End date must be after the start date.';
    if (v.start && v.end && v.status !== 'archived') {
      const exp = expectedStatus(v.start, v.end);
      if (v.status !== exp) {
        if (v.status === 'upcoming') err.status = 'Start date has already passed. Choose Running or Closed, or change the dates.';
        else if (v.status === 'running' && exp === 'upcoming') err.status = 'This session starts on ' + fmt(v.start) + '. Choose Upcoming, or change the dates.';
        else if (v.status === 'running' && exp === 'closed') err.status = 'End date ' + fmt(v.end) + ' has passed. Choose Closed, or change the dates.';
        else if (v.status === 'closed') err.status = 'End date has not passed yet. Choose ' + (exp === 'running' ? 'Running' : 'Upcoming') + '.';
      }
    }
    if (v.status === 'running') {
      const other = rows.find((r) => r.id !== editId && r.status === 'running');
      if (other) err.status = '"' + other.name + '" is already running. Set it to Closed first.';
    }
    return err;
  }
  function showErrors(err) {
    KEYS.forEach((k) => {
      const box = $('ss-' + k + '-err');
      if (box) box.textContent = err[k] || '';
      const e = $('ss-' + k);
      if (e && e.classList.contains('ui-input') && e.parentElement) e.parentElement.classList.toggle('is-invalid', !!err[k]);
    });
  }
  function updateCounters() {
    form.querySelectorAll('.ui-count[data-for]').forEach((c) => {
      const e = $(c.dataset.for);
      if (e) c.textContent = e.value.length + '/' + e.maxLength;
    });
  }
  function setState(text, cls) {
    const s = $('ss-state');
    if (!s) return;
    s.textContent = text;
    s.className = 'save-state' + (cls ? ' ' + cls : '');
  }
  function refresh() {
    const v = readForm();
    const dirty = KEYS.some((k) => v[k] !== saved[k]);
    updateCounters();
    if (touched) showErrors(validate(v));
    saveBtn.disabled = saving || !dirty;
    cancelBtn.disabled = saving;
    if (!saving) setState(dirty ? 'Unsaved changes' : (editId ? 'No changes yet' : 'Fill in the details'), dirty ? 'dirty' : '');
  }

  function render() {
    tbody.textContent = '';
    if (empty) empty.hidden = rows.length > 0;
    const f = tb.state;
    const list = rows.filter((r) => (f.status === 'all' || (r.status || 'upcoming') === f.status) && (!f.q || (r.name || '').toLowerCase().includes(f.q)));
    const run = rows.find((r) => r.status === 'running');
    stats.update(0, rows.length, rows.length === 1 ? '1 session' : rows.length + ' sessions');
    stats.update(1, run ? run.name : '—', run ? fmt(run.startDate) + ' – ' + fmt(run.endDate) : 'None running');
    stats.update(2, rows.filter((r) => (r.status || 'upcoming') === 'upcoming').length, 'Not started yet');
    if (run && toDate(run.endDate)) {
      const sd = run.startDate, ed = run.endDate;
      if (toDate(sd) && toDate(sd) > new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) {
        stats.update(3, '—', 'Starts ' + fmt(sd));
      } else {
        const d = daysLeft(ed);
        if (d < 0) { stats.update(3, 'Ended', 'Ended ' + fmt(ed) + ' – close this session'); }
        else if (d === 0) stats.update(3, 0, 'Ends today');
        else stats.update(3, d, 'Ends ' + fmt(ed));
      }
      const sub = stats.el.querySelectorAll('.lp-stat')[3]?.querySelector('.lp-stat-sub');
      if (sub) sub.classList.toggle('ss-overdue', !!(run && daysLeft(run.endDate) < 0));
    } else {
      stats.update(3, '—', 'No running session');
    }
    const cnt = $('ss-count');
    if (cnt) cnt.textContent = rows.length + ' sessions';
    const foot = $('ss-foot');
    if (foot) {
      foot.hidden = rows.length === 0;
      foot.textContent = list.length === rows.length ? 'Showing all ' + rows.length : 'Showing ' + list.length + ' of ' + rows.length;
    }
    if (rows.length && !list.length) {
      const tr = mk('tr');
      const td = mk('td', 'lp-empty', 'No sessions match your search or filter.');
      td.colSpan = 6;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    list.forEach((r) => {
      const tr = mk('tr');
      tr.appendChild(mk('td', 'br-name', r.name || '—'));
      tr.appendChild(mk('td', '', fmt(r.startDate)));
      tr.appendChild(mk('td', '', fmt(r.endDate)));
      tr.appendChild(mk('td', 'hide-sm', lengthText(r.startDate, r.endDate)));
       const tdSt = mk('td');
       const st = r.status || 'upcoming';
       tdSt.appendChild(mk('span', 'br-pill ' + (PILL[st] || 'off'), LABEL[st] || st));
       if (statusMismatch(r)) {
         const exp = expectedStatus(r.startDate, r.endDate);
         let title = '';
         if (r.status === 'running' && exp === 'closed') title = 'Marked Running but ended ' + fmt(r.endDate);
         else if (r.status === 'running' && exp === 'upcoming') title = 'Marked Running but starts ' + fmt(r.startDate);
         else if (r.status === 'upcoming' && exp === 'running') title = 'Marked Upcoming but started ' + fmt(r.startDate);
         else if (r.status === 'upcoming' && exp === 'closed') title = 'Marked Upcoming but ended ' + fmt(r.endDate);
         else if (r.status === 'closed' && exp === 'running') title = 'Marked Closed but not ended yet';
         else if (r.status === 'closed' && exp === 'upcoming') title = 'Marked Closed but not started yet';
         else title = 'Dates don\'t match status';
          const chip = mk('span', 'ss-mismatch', "Dates don't match status");
          chip.title = title;
          tdSt.appendChild(chip);
       }
       tr.appendChild(tdSt);
      const tdAct = mk('td', 'br-actions');
      const k = mk('button', 'ui-kebab');
      k.type = 'button';
      k.setAttribute('aria-label', 'Actions for ' + (r.name || 'session'));
      k.setAttribute('aria-haspopup', 'menu');
      k.setAttribute('aria-expanded', 'false');
      const ki = document.createElement('i');
      ki.setAttribute('data-lucide', 'more-vertical');
      k.appendChild(ki);
      k.addEventListener('click', () => openMenu(k, [
        { label: 'Edit', icon: 'pencil', onClick: () => openForm(r) },
        'sep',
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => tryDelete(r) }
      ]));
      tdAct.appendChild(k);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  async function load() {
    try {
      const snap = await getDocs(query(collection(db, 'sessions'), where('ctx', '==', centre)));
      rows = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      rows.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    } catch (e) {
      console.error('[sessions] load failed', e);
      note('Could not load sessions (' + (e.code || 'error') + ').', true);
      rows = [];
    }
    render();
  }

  function openForm(r) {
    editId = r ? r.id : null;
    saved = r ? { name: r.name || '', start: r.startDate || '', end: r.endDate || '', status: r.status || 'upcoming' } : Object.assign({}, BLANK);
    fillForm(saved);
    $('ss-form-title').textContent = r ? 'Edit session' : 'New session';
    form.hidden = false;
    touched = false;
    showErrors({});
    note('');
    refresh();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('ss-name').focus({ preventScroll: true });
  }
  function closeForm() {
    form.hidden = true;
    editId = null;
    showErrors({});
  }

  // Delete rule: never cascade. TODO: when students/fees/payments exist, block delete if they reference this session.
  async function tryDelete(r) {
    if (r.status === 'running') {
      await confirmDialog({
        title: 'Cannot delete the running session',
        message: '"' + r.name + '" is the running session. Set it to Closed first, then delete it.',
        confirmText: 'OK', icon: 'shield-alert', infoOnly: true
      });
      return;
    }
    const ok = await confirmDialog({
      title: 'Delete session?',
      message: 'This permanently deletes "' + r.name + '". This cannot be undone.',
      confirmText: 'Delete session', danger: true, requireText: 'DELETE'
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'sessions', r.id));
      if (editId === r.id) closeForm();
      await load();
      note('Session "' + r.name + '" deleted.', false);
      notifySessionsChanged();
    } catch (e) {
      console.error('[sessions] delete failed', e);
      note('Delete failed (' + (e.code || 'error') + ').', true);
    }
  }

  addBtn.addEventListener('click', () => openForm(null));
  cancelBtn.addEventListener('click', async () => {
    if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
    closeForm();
  });
  registerDirty(() => !form.hidden && !saveBtn.disabled && !saving);
  form.addEventListener('input', () => { touched = true; refresh(); });
  form.addEventListener('change', () => { touched = true; refresh(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = readForm();
    touched = true;
    const err = validate(v);
    showErrors(err);
    const firstBad = KEYS.find((k) => err[k]);
    if (firstBad) {
      setState('Please fix the highlighted fields', 'error');
      if (firstBad === 'status') statusSel.focus(); else $('ss-' + firstBad).focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    setState('Saving...', 'dirty');
    const who = (profile && profile.email) ? profile.email : '';
    const data = { name: v.name, ctx: centre, startDate: v.start, endDate: v.end, status: v.status, updatedAt: serverTimestamp(), updatedBy: who };
    try {
      const wasEdit = !!editId;
      if (editId) {
        await updateDoc(doc(db, 'sessions', editId), data);
      } else {
        data.createdAt = serverTimestamp();
        data.createdBy = who;
        await addDoc(collection(db, 'sessions'), data);
      }
      saving = false;
      closeForm();
      await load();
      note(wasEdit ? 'Session updated.' : 'Session added.', false);
      notifySessionsChanged();
    } catch (e) {
      console.error('[sessions] save failed', e);
      saving = false;
      refresh();
      setState('Save failed (' + (e.code || 'error') + ')', 'error');
    }
  });

  await load();
}
