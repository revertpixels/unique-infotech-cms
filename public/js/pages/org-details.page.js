import { db } from '../config/firebase-config.js';
import { registerDirty, confirmLeave } from '../utils/unsaved-guard.js?v=1.8.184';
import { showToast } from '../components/toast.js?v=1.8.184';
import { createManageDataController } from '../core/data-transfer.js?v=1.8.184';
import { mount as mountBranchHeads } from './branch-heads.page.js?v=1.8.184';
import { mountAuthorisedUsers } from './authorised-users.js?v=1.8.184';
import { syncPublicBranding } from '../services/user-directory.service.js?v=1.8.184';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const KEYS = ['name', 'tagline', 'phones', 'receiptCode', 'email', 'website', 'address'];
const DB_FIELD = { name: 'orgName', tagline: 'tagline', phones: 'phones', receiptCode: 'receiptCode', email: 'email', website: 'website', address: 'address' };
const MAX_PHONES = 3;
const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;
const RECEIPT_CODE_RE = /^[A-Z0-9]{2,12}$/;

let manageDataCtrl = null;
let unregisterOrgDirty = null;
let unmountUsersTab = null;
let unmountAuthorisedTab = null;
let removeHashListener = null;

function $(id) { return document.getElementById(id); }
function input(k) { return $('org-' + k); }
function phonesHost() { return $('org-phones'); }
function phoneAddBtn() { return $('org-phone-add'); }
function phoneInputs() { return Array.from(phonesHost().querySelectorAll('input.org-phone-input')); }

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function readForm() {
  const v = {};
  KEYS.forEach((k) => {
    if (k === 'phones') {
      v.phones = phoneInputs().map((e) => e.value.trim()).filter(Boolean);
    } else if (k === 'receiptCode') {
      const el = input(k);
      v[k] = el ? el.value.trim().toUpperCase() : '';
    } else {
      const el = input(k);
      v[k] = el ? el.value.trim() : '';
    }
  });
  return v;
}

function validate(v) {
  const err = {};
  if (!v.name) err.name = 'Institute name is required.';
  else if (v.name.length < 2) err.name = 'Name is too short.';
  const badIdx = [];
  phoneInputs().forEach((e, i) => { const p = e.value.trim(); if (p && !PHONE_RE.test(p)) badIdx.push(i); });
  if (badIdx.length) err.phones = 'Number ' + badIdx.map((i) => i + 1).join(', ') + ': use 7-20 digits, spaces, + or - only.';
  else if (new Set(v.phones.map((p) => p.replace(/\D/g, ''))).size !== v.phones.length) err.phones = 'The same number is entered twice.';
  else if (v.phones.length > MAX_PHONES) err.phones = 'Maximum ' + MAX_PHONES + ' numbers.';
  err._badPhones = badIdx;
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) err.email = 'Enter a valid email address.';
  if (v.website && !/^(https?:\/\/)?[^\s.]+(\.[^\s.]+)+$/i.test(v.website)) err.website = 'Enter a valid website, e.g. www.example.com';
  if (!RECEIPT_CODE_RE.test(v.receiptCode || '')) err.receiptCode = 'Receipt code is required (2-12 uppercase letters or digits).';
  return err;
}

function showErrors(err) {
  KEYS.forEach((k) => {
    if (k === 'phones') return;
    const box = $('org-' + k + '-err');
    const el = input(k);
    if (box) box.textContent = err[k] || '';
    if (el && el.parentElement) el.parentElement.classList.toggle('is-invalid', !!err[k]);
  });
  const bad = err._badPhones || [];
  phoneInputs().forEach((e, i) => e.parentElement.classList.toggle('is-invalid', bad.includes(i)));
  const box = $('org-phones-err');
  if (box) box.textContent = err.phones || '';
}

function updateCounters() {
  document.querySelectorAll('.ui-count[data-for]').forEach((c) => {
    const el = $(c.dataset.for);
    if (el) c.textContent = el.value.length + '/' + el.maxLength;
  });
}

function updatePreview(v) {
  const n = $('pv-name');
  const t = $('pv-tagline');
  if (n) n.textContent = v.name || 'Institute name';
  if (t) t.textContent = v.tagline || '';
}

function setState(text, cls) {
  const s = $('org-state');
  if (!s) return;
  s.textContent = text;
  s.className = 'save-state' + (cls ? ' ' + cls : '');
}

function updateSidebarBrand(orgName, tagline) {
  const box = document.querySelector('.sb-brand .brand-txt');
  if (!box) return;
  const h3 = box.querySelector('h3');
  if (h3) h3.textContent = orgName;
  let p = box.querySelector('p');
  if (tagline) {
    if (!p) { p = document.createElement('p'); box.appendChild(p); }
    p.textContent = tagline;
  } else if (p) {
    p.remove();
  }
}

function getTabFromHash() {
  const q = (location.hash || '').split('?')[1] || '';
  const tab = new URLSearchParams(q).get('tab') || 'details';
  if (tab === 'users' || tab === 'authorised' || tab === 'manage') return tab;
  return 'details';
}

export async function mount({ profile }) {
  unmount();

  const isSuper = !!(profile && profile.role === 'superadmin');
  const tabDetails = $('org-tab-details');
  const tabUsers = $('org-tab-users');
  const tabAuthorised = $('org-tab-authorised');
  const tabManage = $('org-tab-manage');
  const panelDetails = $('org-panel-details');
  const panelUsers = $('org-panel-users');
  const panelAuthorised = $('org-panel-authorised');
  const panelManage = $('org-panel-manage');
  const usersHost = $('org-users-host');
  const authorisedHost = $('org-authorised-host');

  let usersMounted = false;
  let usersLoading = false;
  let authorisedMounted = false;
  let currentTab = 'details';

  if (!isSuper) {
    tabUsers?.remove();
    tabAuthorised?.remove();
    tabManage?.remove();
    panelUsers?.remove();
    panelAuthorised?.remove();
    panelManage?.remove();
  } else {
    if (tabUsers) tabUsers.hidden = false;
    if (tabAuthorised) tabAuthorised.hidden = false;
    if (tabManage) tabManage.hidden = false;
  }

  async function ensureUsersMounted() {
    if (!isSuper || usersMounted || usersLoading || !usersHost) return;
    usersLoading = true;
    try {
      const res = await fetch('pages/branch-heads.html?v=1.8.184');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      usersHost.innerHTML = await res.text();
      const ctrl = await mountBranchHeads({ profile });
      if (typeof ctrl === 'function') unmountUsersTab = ctrl;
      usersMounted = true;
    } catch (err) {
      console.error('[org] users tab mount failed', err);
      usersHost.textContent = 'Could not load Users section. Please refresh and try again.';
    } finally {
      usersLoading = false;
    }
  }

  async function ensureAuthorisedMounted() {
    if (!isSuper || authorisedMounted || !authorisedHost) return;
    authorisedMounted = true;
    const ctrl = await mountAuthorisedUsers({
      container: authorisedHost,
      profile,
      onSwitchToUsers: () => switchTab('users')
    });
    if (typeof ctrl === 'function') unmountAuthorisedTab = ctrl;
  }

  async function switchTab(target, { updateHash = true } = {}) {
    let next = isSuper ? target : 'details';
    if (!['details', 'users', 'authorised', 'manage'].includes(next)) next = 'details';
    if (next === currentTab && updateHash === false) return;
    if (next !== currentTab && !(await confirmLeave())) return;

    currentTab = next;
    const tabMap = [
      ['details', tabDetails, panelDetails],
      ['users', tabUsers, panelUsers],
      ['authorised', tabAuthorised, panelAuthorised],
      ['manage', tabManage, panelManage]
    ];
    tabMap.forEach(([key, btn, panel]) => {
      const active = key === next;
      if (btn) {
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      if (panel) panel.hidden = !active;
    });

    if (next !== 'manage' && manageDataCtrl && manageDataCtrl.isUnlocked()) {
      manageDataCtrl.lock();
    }
    if (updateHash) {
      const wanted = next === 'details' ? '#/org' : `#/org?tab=${next}`;
      if (location.hash !== wanted) {
        try {
          history.replaceState(null, '', wanted);
        } catch (_) { /* silent */ }
      }
    }

    if (next === 'users') await ensureUsersMounted();
    if (next === 'authorised') await ensureAuthorisedMounted();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  tabDetails?.addEventListener('click', () => switchTab('details'));
  tabUsers?.addEventListener('click', () => {
    if (!isSuper) return;
    switchTab('users');
  });
  tabAuthorised?.addEventListener('click', () => {
    if (!isSuper) return;
    switchTab('authorised');
  });
  tabManage?.addEventListener('click', () => {
    if (!isSuper) return;
    switchTab('manage');
  });

  const onHashChange = () => {
    const base = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
    if (base === 'org') {
      switchTab(getTabFromHash(), { updateHash: false });
    }
  };
  window.addEventListener('hashchange', onHashChange);
  removeHashListener = () => window.removeEventListener('hashchange', onHashChange);

  if (isSuper) {
    manageDataCtrl = createManageDataController({
      profile,
      onDatasetMutated: () => {
        const f = $('org-form');
        if (f) {
          f.querySelectorAll('input, textarea, button').forEach((n) => { n.disabled = true; });
        }
        setState('Data changed in Manage Data. Reload page to sync.', 'dirty');
      }
    });
    manageDataCtrl.wire();
    const initialTab = getTabFromHash();
    if (initialTab !== 'details') {
      await switchTab(initialTab, { updateHash: false });
    }
  }

  const form = $('org-form');
  const saveBtn = $('org-save');
  const discardBtn = $('org-discard');
  if (!form || !saveBtn || !discardBtn) return;

  const ref = doc(db, 'settings', 'org_config');
  let saved = { name: '', tagline: '', phones: [], receiptCode: '', email: '', website: '', address: '' };
  let saving = false;
  let touched = false;

  function addPhoneRow(val, focus) {
    if (phonesHost().querySelectorAll('.org-phone-row').length >= MAX_PHONES) return;
    const row = mk('div', 'org-phone-row');
    const wrap = mk('div', 'ui-input-wrap');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', 'phone');
    wrap.appendChild(ic);
    const inp = mk('input', 'ui-input org-phone-input');
    inp.type = 'tel'; inp.maxLength = 20; inp.autocomplete = 'off';
    inp.value = val || '';
    wrap.appendChild(inp);
    row.appendChild(wrap);
    const del = mk('button', 'ui-btn ghost org-phone-del');
    del.type = 'button';
    del.setAttribute('aria-label', 'Remove this number');
    const di = document.createElement('i');
    di.setAttribute('data-lucide', 'x');
    del.appendChild(di);
    del.addEventListener('click', () => {
      row.remove();
      if (!phonesHost().children.length) addPhoneRow('', false);
      syncPhoneUi(); touched = true; refresh();
    });
    row.appendChild(del);
    phonesHost().appendChild(row);
    syncPhoneUi();
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (focus) inp.focus();
  }

  function syncPhoneUi() {
    const items = phonesHost().querySelectorAll('.org-phone-row');
    items.forEach((row, i) => {
      const inp = row.querySelector('input');
      inp.setAttribute('aria-label', 'Phone number ' + (i + 1));
      inp.placeholder = i === 0 ? 'Main number, e.g. 98765 43210' : 'Number ' + (i + 1);
      row.querySelector('.org-phone-del').hidden = items.length === 1;
    });
    phoneAddBtn().disabled = items.length >= MAX_PHONES;
    const c = $('org-phones-count');
    if (c) c.textContent = items.length + '/' + MAX_PHONES;
  }

  function fillForm(v) {
    KEYS.forEach((k) => {
      if (k === 'phones') return;
      const el = input(k);
      if (el) el.value = v[k] || '';
    });
    phonesHost().textContent = '';
    const list = (v.phones && v.phones.length) ? v.phones : [''];
    list.forEach((p) => addPhoneRow(p, false));
  }

  function sameVal(a, b) {
    return Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a || []) === JSON.stringify(b || []) : a === b;
  }

  function isDirty(v) { return KEYS.some((k) => !sameVal(v[k], saved[k])); }

  function refresh() {
    const v = readForm();
    const dirty = isDirty(v);
    updateCounters();
    syncPhoneUi();
    updatePreview(v);
    if (touched) showErrors(validate(v));
    saveBtn.disabled = saving || !dirty;
    discardBtn.disabled = saving || !dirty;
    if (!saving) setState(dirty ? 'Unsaved changes' : 'All changes saved', dirty ? 'dirty' : '');
  }

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      saved.name = d.orgName || '';
      saved.tagline = d.tagline || '';
      saved.phones = Array.isArray(d.phones) ? d.phones.filter(Boolean) : (d.phone ? [d.phone] : []);
      saved.receiptCode = String(d.receiptCode || '').toUpperCase();
      saved.email = d.email || '';
      saved.website = d.website || '';
      saved.address = d.address || '';
    }
  } catch (e) {
    console.error('[org] load failed', e);
    setState('Could not load details (' + (e.code || 'error') + '). Refresh to retry.', 'error');
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    phoneAddBtn().disabled = true;
    showToast({ type: 'error', message: 'Could not load organisation details. Please refresh to retry.' });
    return;
  }

  fillForm(saved);
  saved = readForm();
  refresh();

  form.addEventListener('input', () => { touched = true; refresh(); });
  unregisterOrgDirty = registerDirty(() => isDirty(readForm()));

  discardBtn.addEventListener('click', () => {
    fillForm(saved);
    touched = false;
    showErrors({});
    refresh();
  });

  phoneAddBtn().addEventListener('click', () => { addPhoneRow('', true); refresh(); });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = readForm();
    const rcEl = input('receiptCode');
    if (rcEl) rcEl.value = v.receiptCode;
    touched = true;
    const err = validate(v);
    showErrors(err);
    const firstBad = KEYS.find((k) => err[k]);
    if (firstBad) {
      setState('Please fix the highlighted fields', 'error');
      if (firstBad === 'phones') { const bi = (err._badPhones || [])[0]; (phoneInputs()[bi || 0] || phoneAddBtn()).focus(); }
      else input(firstBad)?.focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    setState('Saving...', 'dirty');
    try {
      const data = {};
      KEYS.forEach((k) => {
        if (k === 'phones') { data.phones = v.phones; data.phone = v.phones[0] || ''; }
        else { data[DB_FIELD[k]] = v[k]; }
      });
      data.updatedAt = serverTimestamp();
      data.updatedBy = (profile && profile.email) ? profile.email : '';
      await setDoc(ref, data, { merge: true });
      saved = { ...v, phones: [...v.phones] };
      window.APP_CACHE = window.APP_CACHE || {};
      window.APP_CACHE.org = Object.assign({}, window.APP_CACHE.org || {}, {
        orgName: v.name, tagline: v.tagline, phones: v.phones, phone: v.phones[0] || '',
        receiptCode: v.receiptCode, email: v.email, website: v.website, address: v.address
      });
      updateSidebarBrand(v.name, v.tagline);
      syncPublicBranding({ orgName: v.name }).catch(() => { });
      saving = false;
      refresh();
      setState('All changes saved', '');
      showToast({ type: 'success', message: 'Organisation saved.' });
    } catch (e) {
      console.error('[org] save failed', e);
      saving = false;
      refresh();
      setState('Save failed (' + (e.code || 'error') + ')', 'error');
      showToast({ type: 'error', message: 'Save failed (' + (e.code || 'error') + ').' });
    }
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

export function unmount() {
  if (manageDataCtrl) {
    manageDataCtrl.destroy();
    manageDataCtrl = null;
  }
  if (unregisterOrgDirty) {
    unregisterOrgDirty();
    unregisterOrgDirty = null;
  }
  if (unmountUsersTab) {
    unmountUsersTab();
    unmountUsersTab = null;
  }
  if (unmountAuthorisedTab) {
    unmountAuthorisedTab();
    unmountAuthorisedTab = null;
  }
  if (removeHashListener) {
    removeHashListener();
    removeHashListener = null;
  }
}
