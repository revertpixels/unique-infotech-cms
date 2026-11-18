import { db } from '../config/firebase-config.js';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createSelect } from '../components/ui-select.js?v=1.8.71';
import { openMenu } from '../components/ui-menu.js?v=1.8.71';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.71';
import { showToast } from '../components/toast.js?v=1.8.71';
import { registerDirty, confirmLeave } from '../utils/unsaved-guard.js?v=1.8.71';
import { buildStats, buildToolbar } from '../components/list-page.js?v=1.8.71';

const TEXT_KEYS = ['name', 'email', 'phone'];
const KEYS = ['name', 'email', 'phone', 'branchId', 'status'];
const BLANK = { name: '', email: '', phone: '', branchId: '', status: 'active' };
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', icon: 'check-circle' },
  { value: 'inactive', label: 'Inactive', icon: 'pause-circle' }
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_DIGITS = 10;

function $(id) { return document.getElementById(id); }
function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export async function mount({ profile }) {
  const form = $('bh-form');
  const tbody = $('bh-rows');
  const empty = $('bh-empty');
  const addBtn = $('bh-add');
  const saveBtn = $('bh-save');
  const cancelBtn = $('bh-cancel');
  const branchHost = $('bh-branch-host');
  const statusHost = $('bh-status');
  if (!form || !tbody || !addBtn || !saveBtn || !cancelBtn || !branchHost || !statusHost) return;

  const branchSel = createSelect(branchHost, { options: [], value: '', ariaLabel: 'Branch' });
  const statusSel = createSelect(statusHost, { options: STATUS_OPTIONS, value: 'active', ariaLabel: 'Status' });

  let rows = [];
  let branches = [];
  const stats = buildStats([
    { label: 'Total heads', value: 0, sub: 'All branch heads', icon: 'user-cog', tone: 'indigo' },
    { label: 'Active', value: 0, sub: 'Can sign in', icon: 'check-circle', tone: 'green' },
    { label: 'Inactive', value: 0, sub: 'Signed out', icon: 'pause-circle', tone: 'amber' },
    { label: 'Branches without a head', value: 0, sub: 'Active branches with no active head', icon: 'git-branch', tone: 'violet' }
  ]);
  const statsHost = $('bh-stats');
  if (statsHost) statsHost.appendChild(stats.el);
  const tb = buildToolbar({
    placeholder: 'Search name, email or phone',
    filters: [
      { id: 'status', label: 'Status', options: [
        { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }
      ] },
      { id: 'branch', label: 'Branch', options: [{ value: 'all', label: 'All branches', icon: 'git-branch' }] }
    ],
    onChange: () => render(),
    onRefresh: () => load()
  });
  const tbHost = $('bh-toolbar');
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
    v.name = $('bh-name') ? $('bh-name').value.trim() : '';
    v.email = $('bh-email') ? $('bh-email').value.trim().toLowerCase() : '';
    v.phone = $('bh-phone') ? $('bh-phone').value.trim() : '';
    v.branchId = branchSel.value;
    v.status = statusSel.value;
    return v;
  }

  function fillForm(v) {
    $('bh-name').value = v.name || '';
    $('bh-email').value = v.email || '';
    $('bh-phone').value = v.phone || '';
    statusSel.value = v.status || 'active';
  }

  function validate(v) {
    const err = {};
    if (!v.name) err.name = 'Full name is required.';
    else if (v.name.length > 60) err.name = 'Name is too long (max 60 characters).';
    if (!v.email) err.email = 'Google email is required.';
    else if (!EMAIL_RE.test(v.email)) err.email = 'Enter a valid email address.';
    const digits = (v.phone || '').replace(/\D/g, '');
    if (v.phone && digits.length !== PHONE_DIGITS) err.phone = 'Phone must be 10 digits.';
    if (!v.branchId) err.branch = 'Branch is required.';
    if (v.branchId) {
      const other = rows.find((r) => r.id !== editId && r.branchId === v.branchId);
      if (other) err.branch = '"' + (other.name || other.email) + '" is already the head of this branch. Delete them first to assign a new head.';
    }
    return err;
  }

  function showErrors(err) {
    ['name', 'email', 'phone', 'branch', 'status'].forEach((k) => {
      const box = $('bh-' + k + '-err');
      if (box) box.textContent = err[k] || '';
    });
    $('bh-name') && $('bh-name').parentElement.classList.toggle('is-invalid', !!err.name);
    $('bh-email') && $('bh-email').parentElement.classList.toggle('is-invalid', !!err.email);
    $('bh-phone') && $('bh-phone').parentElement.classList.toggle('is-invalid', !!err.phone);
    const branchHost = $('bh-branch-host');
    if (branchHost) branchHost.classList.toggle('is-invalid', !!err.branch);
    const statusHost = $('bh-status');
    if (statusHost) statusHost.classList.toggle('is-invalid', !!err.status);
  }

  function updateCounters() {
    form.querySelectorAll('.ui-count[data-for]').forEach((c) => {
      const e = $(c.dataset.for);
      if (e) c.textContent = e.value.length + '/' + e.maxLength;
    });
  }

  function setState(text, cls) {
    const s = $('bh-state');
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

  function branchOptions() {
    const cur = editId ? rows.find((r) => r.id === editId) : null;
    const opts = [];
    let freeCount = 0;
    branches.filter((b) => (b.status || 'active') === 'active').forEach((b) => {
      const hasHead = rows.some((r) => r.branchId === b.id);
      const isEditingOwn = cur && cur.branchId === b.id;
      if (!hasHead || isEditingOwn) {
        opts.push({ value: b.id, label: b.name, icon: 'git-branch' });
        freeCount++;
      }
    });
    if (editId && cur && cur.branchId && !branches.some((b) => b.id === cur.branchId && (b.status || 'active') === 'active')) {
      const b = branches.find((x) => x.id === cur.branchId);
      if (b) { opts.push({ value: b.id, label: b.name + ' (inactive)', icon: 'git-branch' }); freeCount++; }
    }
    if (freeCount === 0) {
      opts.push({ value: '', label: 'All branches have a head', icon: 'git-branch' });
    } else {
      opts.unshift({ value: '', label: 'Select a branch', icon: 'git-branch' });
    }
    return opts;
  }

  function render() {
    tbody.textContent = '';
    if (empty) empty.hidden = rows.length > 0;
    const f = tb.state;
    const list = rows.filter((r) => {
      if (f.status === 'active') return (r.status || 'active') === 'active';
      if (f.status === 'inactive') return (r.status || 'active') === 'inactive';
      return true;
    }).filter((r) => {
      if (f.branch && f.branch !== 'all') return r.branchId === f.branch;
      return true;
    }).filter((r) => {
      if (!f.q) return true;
      const q = f.q;
      return (r.name || '').toLowerCase().includes(q) || (r.email || '').toLowerCase().includes(q) || (r.phone || '').toLowerCase().includes(q);
    });
    const active = rows.filter((r) => (r.status || 'active') === 'active').length;
    const headsByBranch = {};
    rows.filter((r) => (r.status || 'active') === 'active').forEach((r) => { if (r.branchId) headsByBranch[r.branchId] = true; });
    const withoutHead = branches.filter((b) => (b.status || 'active') === 'active' && !headsByBranch[b.id]).length;
    stats.update(0, rows.length, rows.length === 1 ? '1 head' : rows.length + ' heads');
    stats.update(1, active, 'Can sign in');
    stats.update(2, rows.length - active, 'Signed out');
    stats.update(3, withoutHead, withoutHead === 0 ? 'All active branches covered' : withoutHead + ' without a head');
    const cnt = $('bh-count');
    if (cnt) cnt.textContent = rows.length + ' heads';
    const foot = $('bh-foot');
    if (foot) {
      foot.hidden = rows.length === 0;
      foot.textContent = list.length === rows.length ? 'Showing all ' + rows.length : 'Showing ' + list.length + ' of ' + rows.length;
    }
    if (rows.length && !list.length) {
      const tr = mk('tr');
      const td = mk('td', 'lp-empty', 'No branch heads match your search or filter.');
      td.colSpan = 5;
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    list.forEach((r) => {
      const tr = mk('tr');
      const nameTd = mk('td', 'bh-name');
      nameTd.appendChild(mk('b', '', r.name || ' - '));
      nameTd.appendChild(mk('br'));
      nameTd.appendChild(mk('span', 'bh-email', r.email || ''));
      tr.appendChild(nameTd);
      tr.appendChild(mk('td', '', r.phone || ' - '));
      const branchTd = mk('td');
      const b = branches.find((x) => x.id === r.branchId);
      if (b) branchTd.appendChild(mk('span', '', b.name || ' - '));
      else branchTd.appendChild(mk('span', 'bh-branch-missing', 'Branch missing'));
      tr.appendChild(branchTd);
      const st = (r.status || 'active') === 'active';
      const tdSt = mk('td', 'hide-md');
      tdSt.appendChild(mk('span', 'bh-pill ' + (st ? 'on' : 'off'), st ? 'Active' : 'Inactive'));
      tr.appendChild(tdSt);
      const tdAct = mk('td', 'bh-actions');
      const k = mk('button', 'ui-kebab');
      k.type = 'button';
      k.setAttribute('aria-label', 'Actions for ' + (r.name || 'branch head'));
      k.setAttribute('aria-haspopup', 'menu');
      k.setAttribute('aria-expanded', 'false');
      const ki = document.createElement('i');
      ki.setAttribute('data-lucide', 'more-vertical');
      k.appendChild(ki);
      const toggleLabel = st ? 'Make inactive' : 'Make active';
      const toggleIcon = st ? 'pause-circle' : 'play-circle';
      const menuItems = [
        { label: 'Edit', icon: 'pencil', onClick: async () => {
          if (r.role && r.role !== 'branch_head') return;
          if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
          openForm(r);
        } },
        { label: toggleLabel, icon: toggleIcon, onClick: () => toggleActive(r) },
        { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => tryDeleteHead(r) }
      ];
      k.addEventListener('click', () => openMenu(k, menuItems));
      tdAct.appendChild(k);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  async function load() {
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'branch_head')));
      rows = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      rows.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (e) {
      console.error('[branch-heads] load heads failed', e);
      note('Could not load branch heads (' + (e.code || 'error') + ').', true);
      rows = [];
    }
    try {
      const bSnap = await getDocs(collection(db, 'branches'));
      branches = bSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      branches.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } catch (e) {
      console.error('[branch-heads] load branches failed', e);
      branches = [];
    }
    tb.setFilterOptions('branch', [{ value: 'all', label: 'All branches', icon: 'git-branch' }].concat(branches.map((b) => ({ value: b.id, label: b.name, icon: 'git-branch' }))));
    tb.state.branch = 'all';
    render();
  }

  async function toggleActive(r) {
    const wantActive = (r.status || 'active') !== 'active';
    const ok = await confirmDialog({
      title: wantActive ? 'Make active?' : 'Make inactive?',
      message: 'Set "' + (r.name || r.email) + '" to ' + (wantActive ? 'Active' : 'Inactive') + '?',
      confirmText: wantActive ? 'Make active' : 'Make inactive', cancelText: 'Cancel'
    });
    if (!ok) return;
    try {
      await updateDoc(doc(db, 'users', r.id), { status: wantActive ? 'active' : 'inactive', updatedAt: serverTimestamp() });
      if (editId === r.id) closeForm();
      await load();
      note((r.name || r.email) + ' ' + (wantActive ? 'activated.' : 'deactivated.'), false);
    } catch (e) {
      console.error('[branch-heads] toggle failed', e);
      note('Change failed (' + (e.code || 'error') + ').', true);
    }
  }

  async function tryDeleteHead(r) {
    if (r.role && r.role !== 'branch_head') return;
    const ok = await confirmDialog({
      title: 'Delete branch head?',
      message: 'Delete "' + (r.name || r.email) + '" (' + r.email + ')? They will no longer be able to sign in. Type DELETE to confirm.',
      confirmText: 'Delete', danger: true, requireText: 'DELETE'
    });
    if (!ok) return;
    if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
    try {
      await deleteDoc(doc(db, 'users', r.id));
      if (editId === r.id) closeForm();
      await load();
      showToast('Branch head deleted.', 'success');
    } catch (e) {
      console.error('[branch-heads] delete failed', e);
      showToast('Delete failed (' + (e.code || e.message || 'error') + ').', 'error');
    }
  }

  function openForm(r) {
    editId = r ? r.id : null;
    saved = r ? {
      name: r.name || '', email: r.email || '', phone: r.phone || '', branchId: r.branchId || '', status: r.status || 'active'
    } : Object.assign({}, BLANK);
    branchSel.setOptions(branchOptions());
    branchSel.value = saved.branchId || '';
    fillForm(saved);
    $('bh-form-title').textContent = r ? 'Edit branch head' : 'New branch head';
    const emailInput = $('bh-email');
    const emailHelp = $('bh-email-help');
    if (r) {
      emailInput.readOnly = true;
      emailHelp.textContent = 'Email cannot be changed. To change it, delete this head and add again.';
    } else {
      emailInput.readOnly = false;
      emailHelp.textContent = 'Must be the Google account they will sign in with.';
    }
    form.hidden = false;
    touched = false;
    showErrors({});
    note('');
    refresh();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('bh-name').focus({ preventScroll: true });
  }

  function closeForm() {
    form.hidden = true;
    editId = null;
    showErrors({});
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
  form.addEventListener('change', () => { touched = true; refresh(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = readForm();
    touched = true;
    const err = validate(v);
    showErrors(err);
    const firstBad = ['name', 'email', 'phone', 'branch'].find((k) => err[k]);
    if (firstBad) {
      setState('Please fix the highlighted fields', 'error');
      if (firstBad === 'branch') branchSel.focus();
      else if (firstBad === 'status') statusSel.focus();
      else $('bh-' + firstBad).focus();
      return;
    }
    if (!editId) {
      try {
        const snap = await getDoc(doc(db, 'users', v.email));
        if (snap.exists()) {
          err.email = 'This email is already registered.';
          showErrors(err);
          $('bh-email').focus();
          return;
        }
      } catch (e) {
        console.error('[branch-heads] email check failed', e);
        note('Could not verify email (' + (e.code || 'error') + ').', true);
        return;
      }
    }
    saving = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    setState('Saving...', 'dirty');
    const who = (profile && profile.email) ? profile.email : '';
    try {
      if (editId) {
        await updateDoc(doc(db, 'users', editId), {
          name: v.name,
          phone: v.phone || '',
          branchId: v.branchId,
          status: v.status,
          updatedAt: serverTimestamp()
        });
      } else {
        const data = {
          email: v.email,
          name: v.name,
          role: 'branch_head',
          branchId: v.branchId,
          status: v.status,
          createdAt: serverTimestamp(),
          createdBy: who,
          updatedAt: serverTimestamp()
        };
        if (v.phone) data.phone = v.phone;
        await setDoc(doc(db, 'users', v.email), data);
      }
      saving = false;
      closeForm();
      await load();
      note(editId ? 'Branch head updated.' : 'Branch head added.', false);
    } catch (e) {
      console.error('[branch-heads] save failed', e);
      saving = false;
      refresh();
      setState('Save failed (' + (e.code || 'error') + ')', 'error');
      showToast({ type: 'error', message: 'Save failed (' + (e.code || 'error') + ')' });
    }
  });

  await load();
}
















