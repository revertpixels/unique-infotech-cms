import { db } from '../config/firebase-config.js';
import { collection, getDocs, doc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createSelect } from '../components/ui-select.js';
import { openMenu } from '../components/ui-menu.js';
import { confirmDialog } from '../components/ui-confirm.js';
import { showToast } from '../components/toast.js';
import { registerDirty, confirmLeave } from '../utils/unsaved-guard.js?v=1.8.9';
import { buildStats, buildToolbar } from '../components/list-page.js';

const TEXT_KEYS = ['name', 'code', 'email', 'address', 'mapUrl'];
const KEYS = ['name', 'code', 'phones', 'email', 'address', 'mapUrl', 'status'];
const BLANK = { name: '', code: '', phones: [], email: '', address: '', mapUrl: '', status: 'active' };
const MAX_PHONES = 5;
const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAP_RE = /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\S*$/i;

// Old docs have a single `phone` string; new docs have `phones` array.
function phonesOf(r) {
  if (r && Array.isArray(r.phones)) return r.phones.filter(Boolean);
  return r && r.phone ? [r.phone] : [];
}
function sameVal(a, b) {
  return Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a || []) === JSON.stringify(b || []) : a === b;
}
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed'; ta.style.top = '-1000px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
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

  const phonesHost = $('br-phones');
  const phoneAddBtn = $('br-phone-add');

  function phoneInputs() { return Array.from(phonesHost.querySelectorAll('input.br-phone-input')); }

  function syncPhoneUi() {
    const items = phonesHost.querySelectorAll('.br-phone-row');
    items.forEach((row, i) => {
      const inp = row.querySelector('input');
      inp.setAttribute('aria-label', 'Phone number ' + (i + 1));
      inp.placeholder = i === 0 ? 'Main number, e.g. 98765 43210' : 'Number ' + (i + 1);
      row.querySelector('.br-phone-del').hidden = items.length === 1;
    });
    phoneAddBtn.disabled = items.length >= MAX_PHONES;
    const c = $('br-phones-count');
    if (c) c.textContent = items.length + '/' + MAX_PHONES;
  }

  function addPhoneRow(val, focus) {
    if (phonesHost.querySelectorAll('.br-phone-row').length >= MAX_PHONES) return;
    const row = mk('div', 'br-phone-row');
    const wrap = mk('div', 'ui-input-wrap');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', 'phone');
    wrap.appendChild(ic);
    const inp = mk('input', 'ui-input br-phone-input');
    inp.type = 'tel'; inp.maxLength = 20; inp.autocomplete = 'off';
    inp.value = val || '';
    wrap.appendChild(inp);
    row.appendChild(wrap);
    const del = mk('button', 'ui-btn ghost br-phone-del');
    del.type = 'button';
    del.setAttribute('aria-label', 'Remove this number');
    const di = document.createElement('i');
    di.setAttribute('data-lucide', 'x');
    del.appendChild(di);
    del.addEventListener('click', () => {
      row.remove();
      if (!phonesHost.children.length) addPhoneRow('', false);
      syncPhoneUi(); touched = true; refresh();
    });
    row.appendChild(del);
    phonesHost.appendChild(row);
    syncPhoneUi();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (focus) inp.focus();
  }

  phoneAddBtn.addEventListener('click', () => { addPhoneRow('', true); refresh(); });

  let rows = [];
  const stats = buildStats([
    { label: 'Total branches', value: 0, sub: 'All branches', icon: 'git-branch', tone: 'indigo' },
    { label: 'Active', value: 0, sub: 'Open for admissions', icon: 'check-circle', tone: 'green' },
    { label: 'Inactive', value: 0, sub: 'Paused or closed', icon: 'pause-circle', tone: 'amber' },
    { label: 'Heads assigned', value: 0, sub: 'Branches with a head', icon: 'user-check', tone: 'violet' }
  ]);
  const statsHost = $('br-stats');
  if (statsHost) statsHost.appendChild(stats.el);
  const tb = buildToolbar({
    placeholder: 'Search name, code, phone, email or address',
    filters: [{ id: 'status', label: 'Status', options: [
      { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }
    ] }],
    onChange: () => render(),
    onRefresh: () => load()
  });
  const tbHost = $('br-toolbar');
  if (tbHost) tbHost.appendChild(tb.el);
  let headsByBranch = {};
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
    TEXT_KEYS.forEach((k) => { const e = $('br-' + k); v[k] = e ? e.value.trim() : ''; });
    v.code = v.code.toUpperCase();
    v.email = v.email.toLowerCase();
    v.phones = phoneInputs().map((e) => e.value.trim()).filter(Boolean);
    v.status = statusSel.value;
    return v;
  }

  function fillForm(v) {
    TEXT_KEYS.forEach((k) => { const e = $('br-' + k); if (e) e.value = v[k] || ''; });
    phonesHost.textContent = '';
    const list = (v.phones && v.phones.length) ? v.phones : [''];
    list.forEach((p) => addPhoneRow(p, false));
    statusSel.value = v.status || 'active';
  }

  function validate(v) {
    const err = {};
    if (!v.name) err.name = 'Branch name is required.';
    else if (v.name.length < 2) err.name = 'Name is too short.';
    if (!v.code) err.code = 'Code is required.';
    else if (!/^[A-Z0-9]{2,10}$/.test(v.code)) err.code = '2–10 letters or digits, no spaces.';
    else if (rows.some((r) => r.id !== editId && (r.code || '').toUpperCase() === v.code)) err.code = 'This code is already used by another branch.';
    const badIdx = [];
    phoneInputs().forEach((e, i) => { const p = e.value.trim(); if (p && !PHONE_RE.test(p)) badIdx.push(i); });
    if (badIdx.length) err.phones = 'Number ' + badIdx.map((i) => i + 1).join(', ') + ': use 7-20 digits, spaces, + or - only.';
    else if (new Set(v.phones.map((p) => p.replace(/\D/g, ''))).size !== v.phones.length) err.phones = 'The same number is entered twice.';
    else if (v.phones.length > MAX_PHONES) err.phones = 'Maximum ' + MAX_PHONES + ' numbers.';
    err._badPhones = badIdx;
    if (v.email && !EMAIL_RE.test(v.email)) err.email = 'Enter a valid email address.';
    if (v.mapUrl && !MAP_RE.test(v.mapUrl)) err.mapUrl = 'Paste a Google Maps link (https://maps.app.goo.gl/... or https://www.google.com/maps/...).';
    return err;
  }

  function showErrors(err) {
    KEYS.forEach((k) => {
      const box = $('br-' + k + '-err');
      if (box) box.textContent = err[k] || '';
      const e = $('br-' + k);
      if (e && e.classList.contains('ui-input') && e.parentElement) e.parentElement.classList.toggle('is-invalid', !!err[k]);
    });
    const bad = err._badPhones || [];
    phoneInputs().forEach((e, i) => e.parentElement.classList.toggle('is-invalid', bad.includes(i)));
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
    const dirty = KEYS.some((k) => !sameVal(v[k], saved[k]));
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
    const f = tb.state;
    const list = rows.filter((r) => (f.status === 'all' || ((r.status || 'active') === 'active') === (f.status === 'active')) && (!f.q || [r.name, r.code, r.address, r.email].concat(phonesOf(r)).some((x) => (x || '').toLowerCase().includes(f.q))));
    const act = rows.filter((r) => (r.status || 'active') === 'active').length;
    const withHead = rows.filter((r) => (headsByBranch[r.id] || []).length > 0).length;
    stats.update(0, rows.length, 'All branches');
    stats.update(1, act, 'Open for admissions');
    stats.update(2, rows.length - act, 'Paused or closed');
    stats.update(3, withHead, rows.length ? (rows.length - withHead) + ' without a head' : 'Branches with a head');
    const cnt = $('br-count');
    if (cnt) cnt.textContent = rows.length + ' branches';
    const foot = $('br-foot');
    if (foot) {
      foot.hidden = rows.length === 0;
      foot.textContent = list.length === rows.length ? 'Showing all ' + rows.length : 'Showing ' + list.length + ' of ' + rows.length;
    }
    if (rows.length && !list.length) {
      const tr = mk('tr');
      const td = mk('td', 'lp-empty', 'No branches match your search or filter.');
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    list.forEach((r) => {
      const tr = mk('tr');
      tr.appendChild(mk('td', 'br-name', r.name || '—'));
      const tdCode = mk('td');
      tdCode.appendChild(mk('span', 'br-code', r.code || '—'));
      tr.appendChild(tdCode);
      tr.appendChild(headCell(r));
      const tdC = mk('td', 'hide-sm br-contact');
      const ph = phonesOf(r);
      tdC.appendChild(mk('b', '', ph[0] || '—'));
      if (ph.length > 1) tdC.appendChild(mk('span', 'br-muted', '+' + (ph.length - 1) + ' more'));
      if (r.email) tdC.appendChild(mk('span', 'br-muted', r.email));
      tr.appendChild(tdC);
      const tdA = mk('td', 'hide-md br-addr');
      tdA.appendChild(mk('span', '', r.address || '—'));
      if (r.mapUrl) {
        const a = mk('a', 'br-map', 'Open map');
        a.href = r.mapUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
        tdA.appendChild(a);
      }
      tr.appendChild(tdA);
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
        { label: 'Edit', icon: 'pencil', onClick: async () => {
          if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
          openForm(r);
        } },
        { label: 'Copy branch details', icon: 'copy', onClick: () => copyBranch(r) },
        'sep',
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => tryDelete(r) }
      ]));
      tdAct.appendChild(k);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function branchText(r) {
    const lines = ['*Unique Infotech - ' + (r.name || 'Branch') + '*'];
    if (r.code) lines.push('Branch Code: ' + r.code);
    const ph = phonesOf(r);
    if (ph.length) lines.push('Call: ' + ph.join(', '));
    if (r.email) lines.push('Email: ' + r.email);
    if (r.address) lines.push('Address: ' + String(r.address).replace(/\s*\n\s*/g, ', '));
    if (r.mapUrl) lines.push('Map: ' + r.mapUrl);
    return lines.join('\n');
  }

  async function copyBranch(r) {
    const ok = await copyText(branchText(r));
    note(ok ? 'Details of "' + r.name + '" copied. Paste them in WhatsApp, SMS or email.' : 'Could not copy. Please try again.', !ok);
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
      name: r.name || '', code: (r.code || '').toUpperCase(), phones: phonesOf(r),
      email: r.email || '', address: r.address || '', mapUrl: r.mapUrl || '', status: r.status || 'active'
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

  addBtn.addEventListener('click', async () => {
    if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
    openForm(null);
  });
  cancelBtn.addEventListener('click', async () => {
    if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
    closeForm();
  });
  registerDirty(() => !form.hidden && !saveBtn.disabled && !saving);
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
      if (firstBad === 'status') statusSel.focus();
      else if (firstBad === 'phones') { const bi = (err._badPhones || [])[0]; (phoneInputs()[bi || 0] || phoneAddBtn).focus(); }
      else $('br-' + firstBad).focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    setState('Saving...', 'dirty');
    const who = (profile && profile.email) ? profile.email : '';
    const data = {
      name: v.name, code: v.code, phones: v.phones, phone: v.phones[0] || '',
      email: v.email, address: v.address, mapUrl: v.mapUrl, status: v.status,
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
