import { db } from '../config/firebase-config.js';
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createSelect } from '../components/ui-select.js';
import { openMenu } from '../components/ui-menu.js';
import { confirmDialog } from '../components/ui-confirm.js';

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
  let editId = null;
  let saved = Object.assign({}, BLANK);
  let touched = false;
  let saving = false;

  function note(text, isError) {
    const n = $('ss-note');
    if (!n) return;
    n.textContent = text || '';
    n.classList.toggle('is-error', !!isError);
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
    rows.forEach((r) => {
      const tr = mk('tr');
      tr.appendChild(mk('td', 'br-name', r.name || '—'));
      tr.appendChild(mk('td', '', fmt(r.startDate)));
      tr.appendChild(mk('td', '', fmt(r.endDate)));
      tr.appendChild(mk('td', 'hide-sm', lengthText(r.startDate, r.endDate)));
      const tdSt = mk('td');
      const st = r.status || 'upcoming';
      tdSt.appendChild(mk('span', 'br-pill ' + (PILL[st] || 'off'), LABEL[st] || st));
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
    } catch (e) {
      console.error('[sessions] delete failed', e);
      note('Delete failed (' + (e.code || 'error') + ').', true);
    }
  }

  addBtn.addEventListener('click', () => openForm(null));
  cancelBtn.addEventListener('click', closeForm);
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
    } catch (e) {
      console.error('[sessions] save failed', e);
      saving = false;
      refresh();
      setState('Save failed (' + (e.code || 'error') + ')', 'error');
    }
  });

  await load();
}
