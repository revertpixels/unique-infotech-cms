import { db } from '../config/firebase-config.js';
import { registerDirty } from '../utils/unsaved-guard.js?v=1.8.13';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const KEYS = ['name', 'tagline', 'phone', 'email', 'website', 'address'];
const DB_FIELD = { name: 'orgName', tagline: 'tagline', phone: 'phone', email: 'email', website: 'website', address: 'address' };

function $(id) { return document.getElementById(id); }
function input(k) { return $('org-' + k); }

function readForm() {
  const v = {};
  KEYS.forEach((k) => { const el = input(k); v[k] = el ? el.value.trim() : ''; });
  return v;
}

function fillForm(v) {
  KEYS.forEach((k) => { const el = input(k); if (el) el.value = v[k] || ''; });
}

function validate(v) {
  const err = {};
  if (!v.name) err.name = 'Institute name is required.';
  else if (v.name.length < 2) err.name = 'Name is too short.';
  if (v.phone && !/^[0-9+\-\s()]{7,20}$/.test(v.phone)) err.phone = 'Use digits, spaces, + or - only.';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) err.email = 'Enter a valid email address.';
  if (v.website && !/^(https?:\/\/)?[^\s.]+(\.[^\s.]+)+$/i.test(v.website)) err.website = 'Enter a valid website, e.g. www.example.com';
  return err;
}

function showErrors(err) {
  KEYS.forEach((k) => {
    const box = $('org-' + k + '-err');
    const el = input(k);
    if (box) box.textContent = err[k] || '';
    if (el && el.parentElement) el.parentElement.classList.toggle('is-invalid', !!err[k]);
  });
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

export async function mount({ profile }) {
  const form = $('org-form');
  const saveBtn = $('org-save');
  const discardBtn = $('org-discard');
  if (!form || !saveBtn || !discardBtn) return;
  const ref = doc(db, 'settings', 'org_config');
  let saved = { name: '', tagline: '', phone: '', email: '', website: '', address: '' };
  let saving = false;
  let touched = false;

  function isDirty(v) { return KEYS.some((k) => v[k] !== saved[k]); }

  function refresh() {
    const v = readForm();
    const dirty = isDirty(v);
    updateCounters();
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
      KEYS.forEach((k) => { saved[k] = d[DB_FIELD[k]] || ''; });
    }
  } catch (e) {
    console.error('[org] load failed', e);
    setState('Could not load details (' + (e.code || 'error') + ')', 'error');
  }
  fillForm(saved);
  refresh();

  form.addEventListener('input', () => { touched = true; refresh(); });

  registerDirty(() => !saveBtn.disabled && !saving);
  discardBtn.addEventListener('click', () => {
    fillForm(saved);
    touched = false;
    showErrors({});
    refresh();
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = readForm();
    touched = true;
    const err = validate(v);
    showErrors(err);
    const firstBad = KEYS.find((k) => err[k]);
    if (firstBad) {
      setState('Please fix the highlighted fields', 'error');
      input(firstBad).focus();
      return;
    }
    saving = true;
    saveBtn.disabled = true;
    discardBtn.disabled = true;
    setState('Saving...', 'dirty');
    try {
      const data = {};
      KEYS.forEach((k) => { data[DB_FIELD[k]] = v[k]; });
      data.updatedAt = serverTimestamp();
      data.updatedBy = (profile && profile.email) ? profile.email : '';
      await setDoc(ref, data, { merge: true });
      saved = Object.assign({}, v);
      window.APP_CACHE = window.APP_CACHE || {};
      window.APP_CACHE.org = Object.assign({}, window.APP_CACHE.org || {}, {
        orgName: v.name, tagline: v.tagline, phone: v.phone, email: v.email, website: v.website, address: v.address
      });
      updateSidebarBrand(v.name, v.tagline);
      saving = false;
      refresh();
      setState('All changes saved', '');
    } catch (e) {
      console.error('[org] save failed', e);
      saving = false;
      refresh();
      setState('Save failed (' + (e.code || 'error') + ')', 'error');
    }
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}
