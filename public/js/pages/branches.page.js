import { db } from '../config/firebase-config.js';
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createSelect } from '../components/ui-select.js';
import { openMenu } from '../components/ui-menu.js';
import { confirmDialog } from '../components/ui-confirm.js';

const TEXT_KEYS = ['name', 'code', 'phone', 'address'];
const KEYS = ['name', 'code', 'phone', 'address', 'status'];
const BLANK = { name: '', code: '', phone: '', address: '', status: 'active' };
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', icon: 'check-circle' },
  { value: 'inactive', label: 'Inactive', icon: 'pause-circle' }
];

function $(id) { return document.getElementById(id); }
function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function initials(s) {
  const parts = String(s || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export async function mount({ profile }) {
  const form = $('br-form');
  const tbody = $('br-rows');
  const empty = $('br-empty');
  const addBtn = $('br-add');
  const saveBtn = $('br-save');
  const cancelBtn = $('br-cancel');
  const statusHost = $('br-status');
  if (!form || !tbody || !addBtn || !saveBtn || !cancelBtn || !statusHost) return;

  const statusSel = createSelect(statusHost, { options: STATUS_OPTIONS, value: 'active', ariaLabel: 'Status' });

  let rows = [];
  let headsByBranch = {};
  let editId = null;
  let saved = Object.assign({}, BLANK);
  let touched = false;
  let saving = false;

  function note(text, isError) {
    const n = $('br-note');
    if (!n) return;
    n.textContent = text || '';
    n.classList.toggle('is-error', !!isError);
  }

  function readForm() {
    const v = {};
    TEXT_KEYS.forEach((k) => { const e = $('br-' + k); v[k] = e ? e.value.trim() : ''; });
    v.code = v.code.toUpperCase();
    v.status = statusSel.value;
    return v;
  }

  function fillForm(v) {
    TEXT_KEYS.forEach((k) => { const e = $('br-' + k); if (e) e.value = v[k] || ''; });
    statusSel.value = v.status || 'active';
  }

  function validate(v) {
    const err = {};
    if (!v.name) err.name = 'Branch name is required.';
    else if (v.name.length < 2) err.name = 'Name is too short.';
    if (!v.code) err.code = 'Code is required.';
    else if (!/^[A-Z0-9]{2,10}$/.test(v.code)) err.code = '2–10 letters or digits, no spaces.';
    else if (rows.some((r) => r.id !== editId && (r.code || '').toUpperCase() === v.code)) err.code = 'This code is already used by another branch.';
    if (v.phone && !/^[0-9+\-\s()]{7,20}$/.test(v.phone)) err.phone = 'Use digits, spaces, + or - only.';
    return err;
  }

  function showErrors(err) {
    KEYS.forEach((k) => {
      const box = $('br-' + k + '-err');
      if (box) box.textContent = err[k] || '';
      const e = $('br-' + k);
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
    const s = $('br-state');
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

  function headCell(r) {
    const td = mk('td', 'hide-sm');
    const list = headsByBranch[r.id] || [];
    if (!list.length) {
      td.appendChild(mk('span', 'br-muted', 'Not assigned'));
      return td;
    }
    const h = list[0];
    const box = mk('div', 'br-head');
    box.appendChild(mk('span', 'br-head-av', initials(h.name || h.email)));
    const txt = mk('div', 'br-head-txt');
    txt.appendChild(mk('b', '', h.name || h.email));
    txt.appendChild(mk('span', '', list.length > 1 ? (h.email + ' +' + (list.length - 1) + ' more') : (h.email || '')));
    box.appendChild(txt);
    td.appendChild(box);
    return td;
  }

  function render() {
    tbody.textContent = '';
    if (empty) empty.hidden = rows.length > 0;
    rows.forEach((r) => {
      const tr = mk('tr');
      tr.appendChild(mk('td', 'br-name', r.name || '—'));
      const tdCode = mk('td');
      tdCode.appendChild(mk('span', 'br-code', r.code || '—'));
      tr.appendChild(tdCode);
      tr.appendChild(headCell(r));
      tr.appendChild(mk('td', 'hide-sm', r.phone || '—'));
      tr.appendChild(mk('td', 'hide-md br-addr', r.address || '—'));
      const tdSt = mk('td');
      const active = (r.status || 'active') === 'active';
      tdSt.appendChild(mk('span', 'br-pill ' + (active ? 'on' : 'off'), active ? 'Active' : 'Inactive'));
      tr.appendChild(tdSt);
      const tdAct = mk('td', 'br-actions');
      const k = mk('button', 'ui-kebab');
      k.type = 'button';
      k.setAttribute('aria-label', 'Actions for ' + (r.name || 'branch'));
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
      const snap = await getDocs(collection(db, 'branches'));
      rows = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (e) {
      console.error('[branches] load failed', e);
      note('Could not load branches (' + (e.code || 'error') + ').', true);
      rows = [];
    }
    headsByBranch = {};
    try {
      const hs = await getDocs(query(collection(db, 'users'), where('role', '==', 'branch_head')));
      hs.docs.forEach((d) => {
        const u = d.data();
        if (!u.branchId) return;
        (headsByBranch[u.branchId] = headsByBranch[u.branchId] || []).push({ name: u.name || '', email: u.email || d.id });
      });
    } catch (e) {
      console.warn('[branches] branch heads load failed', e && e.code ? e.code : e);
    }
    render();
  }

  function openForm(r) {
    editId = r ? r.id : null;
    saved = r ? {
      name: r.name || '', code: (r.code || '').toUpperCase(), phone: r.phone || '',
      address: r.address || '', status: r.status || 'active'
    } : Object.assign({}, BLANK);
    fillForm(saved);
    $('br-form-title').textContent = r ? 'Edit branch' : 'New branch';
    form.hidden = false;
    touched = false;
    showErrors({});
    note('');
    refresh();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('br-name').focus({ preventScroll: true });
  }

  function closeForm() {
    form.hidden = true;
    editId = null;
    showErrors({});
  }

  // Delete rule (see docs/03-DECISIONS.md): never cascade. Block if anything references the branch.
  // TODO: when students, batches, fees or payments collections exist, add their checks here.
  async function tryDelete(r) {
    const heads = headsByBranch[r.id] || [];
    if (heads.length) {
      await confirmDialog({
        title: 'Cannot delete this branch',
        message: '"' + r.name + '" has a branch head assigned (' + heads.map((h) => h.name || h.email).join(', ') + '). Remove or move the branch head first, or set the branch to Inactive to keep its history.',
        confirmText: 'OK', icon: 'shield-alert', infoOnly: true
      });
      return;
    }
    const ok = await confirmDialog({
      title: 'Delete branch?',
      message: 'This permanently deletes "' + r.name + '" (' + r.code + '). This cannot be undone.',
      confirmText: 'Delete branch', danger: true, requireText: r.code || 'DELETE'
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'branches', r.id));
      if (editId === r.id) closeForm();
      await load();
      note('Branch "' + r.name + '" deleted.', false);
    } catch (e) {
      console.error('[branches] delete failed', e);
      note('Delete failed (' + (e.code || 'error') + ').', true);
    }
  }

  addBtn.addEventListener('click', () => openForm(null));
  cancelBtn.addEventListener('click', closeForm);
  form.addEventListener('input', () => { touched = true; refresh(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = readForm();
    touched = true;
    const err = validate(v);
    showErrors(err);
    const firstBad = KEYS.find((k) => err[k]);
    if (firstBad) {
      setState('Please fix the highlighted fields', 'error');
      if (firstBad === 'status') statusSel.focus(); else $('br-' + firstBad).focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    setState('Saving...', 'dirty');
    const who = (profile && profile.email) ? profile.email : '';
    const data = {
      name: v.name, code: v.code, phone: v.phone, address: v.address, status: v.status,
      updatedAt: serverTimestamp(), updatedBy: who
    };
    try {
      const wasEdit = !!editId;
      if (editId) {
        await updateDoc(doc(db, 'branches', editId), data);
      } else {
        data.createdAt = serverTimestamp();
        data.createdBy = who;
        await addDoc(collection(db, 'branches'), data);
      }
      saving = false;
      closeForm();
      await load();
      note(wasEdit ? 'Branch updated.' : 'Branch added.', false);
    } catch (e) {
      console.error('[branches] save failed', e);
      saving = false;
      refresh();
      setState('Save failed (' + (e.code || 'error') + ')', 'error');
    }
  });

  await load();
}
