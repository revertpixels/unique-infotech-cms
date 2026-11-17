// school-admissions.page.js — Unique Kids admissions (school context, Super Admin only).
// Kids batches are session-independent: no session field, no branch selector, Head Office
// (branchId 'HO') is used internally. Student IDs are YYYYNNNN from the admission year;
// receipt numbers use the shared Youth counter service with the configured
// organisation receipt code, or the Kids built-in Head Office code (HO). Save runs inside ONE runTransaction: all counter reads first, then all
// writes (counters, student, photo/signature docs, private Aadhaar doc, payment record).
import { db } from '../config/firebase-config.js';
import {
  collection, getDocs, query, where, doc, getDoc, addDoc, updateDoc, serverTimestamp,
  runTransaction, deleteField
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.68';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.68';
import { buildStats, buildToolbar, renderPager } from '../components/list-page.js?v=1.8.68';
import { createSelect } from '../components/ui-select.js?v=1.8.68';
import { openMenu } from '../components/ui-menu.js?v=1.8.68';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.68';
import { formatINR, formatDateIN, initials } from '../utils/formatter.js?v=1.8.68';
import { validatePhone, validateEmail, validateDOB, validateName, validateRequired } from '../utils/validator.js?v=1.8.68';
import { readStudentId, readReceiptNo, writeCounter } from '../services/admission.service.js?v=1.8.68';
import { isCourseActive, batchAllowsCourse, todayISO } from '../utils/session-rules.js?v=1.8.68';
import { compressTo100KB, readAsDataURL, blobToDataURL, isImageFile } from '../utils/image-compress.js?v=1.8.68';
import { firstMonthlyMonth } from '../utils/school-receipt.js?v=1.8.68';

const COL = 'students';
const GENDERS = [
  { value: 'male', label: 'Male', icon: 'user' },
  { value: 'female', label: 'Female', icon: 'user-circle' },
  { value: 'other', label: 'Other', icon: 'user-x' }
];
const DOC_KEYS = ['photo', 'signature'];
const PAGE_SIZE = 10;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const AADHAAR_RE = /^\d{12}$/;

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-admissions] missing #' + id); return el; }
function $t(id, text) { const el = $(id); if (el) el.textContent = text; }
function $v(id, value) { const el = $(id); if (el) el.value = value ?? ''; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function isDataUrl(v) { return typeof v === 'string' && /^data:image\/[^;]+;base64,/.test(v); }
function num(v) { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

let cleanupPage = null;
export function unmount() { if(cleanupPage) cleanupPage(); cleanupPage=null; }

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  if (!school) {
    showToast({ type: 'error', message: 'Kids Admissions is only available in Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';
  if (!isSuper) {
    showToast({ type: 'error', message: 'Kids Admissions is restricted to Super Admin.' });
    return;
  }

  const form = $('adm-form');
  const addBtn = $('adm-add');
  const saveBtn = $('adm-save');
  const cancelBtn = $('adm-cancel');
  const rowsHost = $('adm-rows');
  const emptyEl = $('adm-empty');
  const loadingEl = $('adm-loading');
  const noMatchEl = $('adm-no-match');
  const loadErrorEl = $('adm-load-error');
  const loadErrorMsg = $('adm-load-error-msg');
  const footEl = $('adm-foot');
  const feeBreakdown = $('adm-fee-breakdown');
  const feeConfigured = $('adm-fee-configured');
  const feePrior = $('adm-fee-prior');
  const feeAdj = $('adm-fee-adj');
  const feeDue = $('adm-fee-due');
  const monthlyFeeEl = $('adm-monthly-fee');
  const firstMonthlyEl = $('adm-first-monthly');
  const paymentModeFull = $('adm-paymentMode-full');
  const paymentModeDiff = $('adm-paymentMode-difference');
  const paymentModeNone = $('adm-paymentMode-none');
  const noPaymentReasonWrap = $('adm-no-payment-reason-wrap');
  const noPaymentReasonInput = $('adm-noPaymentReason');
  const noPaymentOtherWrap = $('adm-none-other-wrap');
  const noPaymentOtherInput = $('adm-noPaymentOther');
  const confirmReceivedWrap = $('adm-confirm-received-wrap');
  const confirmReceivedInput = $('adm-confirmReceived');
  if ([form, addBtn, saveBtn, cancelBtn, rowsHost, emptyEl, loadingEl, noMatchEl, loadErrorEl, feeBreakdown, feeConfigured, feePrior, feeAdj, feeDue, monthlyFeeEl, firstMonthlyEl, paymentModeFull, paymentModeDiff, paymentModeNone, noPaymentReasonWrap, noPaymentReasonInput, noPaymentOtherWrap, noPaymentOtherInput, confirmReceivedWrap, confirmReceivedInput].some(el => !el)) {
    showToast({ type: 'error', message: 'Admission page assets do not match. Refresh the page before continuing.' }); return;
  }

  // ---------- form selects ----------
  const genderSel = createSelect($('adm-gender-host'), {
    options: [{ value: '', label: 'Select gender', icon: 'user' }].concat(GENDERS.map(g => ({ value: g.value, label: g.label, icon: g.icon }))),
    value: '', ariaLabel: 'Gender'
  });

  let levelSel, batchSel;
  levelSel = createSelect($('adm-level-host'), {
    options: [{ value: '', label: 'Select a level', icon: 'book-open' }],
    value: '', ariaLabel: 'Level',
    onChange: () => {
      if (hydrating) return;
      touched = true;
      batchSel.value = '';
      confirmedReceived = false;
      if (confirmReceivedInput) confirmReceivedInput.checked = false;
      refreshFeePreview();
      const course = coursesById[levelSel.value] || null;
      refreshBatchOptions();
      refresh();
    }
  });
  batchSel = createSelect($('adm-batch-host'), {
    options: [{ value: '', label: 'Select a batch', icon: 'layers' }],
    value: '', ariaLabel: 'Batch',
    onChange: () => { if (!hydrating) { touched = true; refresh(); } }
  });
  [paymentModeFull, paymentModeDiff, paymentModeNone].forEach((rb) => {
    rb.addEventListener('change', () => {
      if (hydrating) return;
      touched = true;
      paymentMode = rb.value;
      confirmedReceived = false;
      if (confirmReceivedInput) confirmReceivedInput.checked = false;
      refreshFeePreview();
      refresh();
    });
  });

  noPaymentReasonInput.addEventListener('change', () => {
    if (hydrating) return;
    touched = true;
    const isOther = noPaymentReasonInput.value === 'other';
    noPaymentOtherWrap.hidden = !isOther;
    if (!isOther) noPaymentOtherInput.value = '';
    refresh();
  });

  confirmReceivedInput.addEventListener('change', () => {
    if (hydrating || saving) return;
    confirmedReceived = confirmReceivedInput.checked;
    touched = true; refresh();
  });

  const reasonHost = $('adm-reason-custom');
  const reasonSelect = createSelect(reasonHost, {
    options: Array.from(noPaymentReasonInput.options).map(o => ({value:o.value,label:o.textContent,icon:o.value ? 'check-circle' : 'list'})),
    value: noPaymentReasonInput.value, ariaLabel: 'Reason for no payment',
    onChange: value => {
      if (saving || editId) return;
      noPaymentReasonInput.value = value;
      noPaymentReasonInput.dispatchEvent(new Event('change', {bubbles:true}));
    }
  });
  // Prevent the component's pre-change input event from refreshing stale values.
  reasonHost.addEventListener('input', e => e.stopPropagation());
  const closeReasonMenu = () => {
    const button = reasonHost.querySelector('.ui-select-btn');
    if (button && button.getAttribute('aria-expanded') === 'true') button.click();
  };
  reasonHost.querySelector('.ui-select-btn').setAttribute('aria-labelledby', 'adm-reason-label');
  ['full','difference','none'].forEach(mode => {
    const card = $('adm-mode-card-' + mode), radio = $('adm-paymentMode-' + mode);
    card.addEventListener('click', e => {
      if (radio.disabled || e.target.closest('button,select,option,input,textarea,label,a,.ui-select,.adm-none-reason-wrap')) return;
      radio.click();
    });
  });

  // ---------- toolbar ----------
  const tbFilters = [
    { id: 'status', label: 'Status', options: [
      { value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' },
      { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' }
    ]},
    { id: 'level', label: 'Level', options: [{ value: 'all', label: 'All levels', icon: 'book-open' }] }
  ];
  const tb = buildToolbar({
    placeholder: 'Search name, student ID or parent phone',
    filters: tbFilters,
    onChange: () => { page = 1; render(); },
    onRefresh: () => load()
  });
  const tbHost = $('adm-toolbar');
  if (tbHost) { tbHost.innerHTML = ''; tb.el.classList.add('adm-toolbar-row'); tbHost.appendChild(tb.el); }

  // ---------- stats (no duplicate) ----------
  const stats = buildStats([
    { label: 'Total admissions', value: 0, sub: 'This centre', icon: 'user-plus', tone: 'indigo' },
    { label: 'Active', value: 0, sub: 'Active students', icon: 'check-circle', tone: 'green' },
    { label: 'Inactive', value: 0, sub: 'Inactive students', icon: 'pause-circle', tone: 'amber' }
  ]);
  const statsHost = $('adm-stats');
  if (statsHost) statsHost.appendChild(stats.el);

  // ---------- state ----------
  let students = [], levels = [], batches = [], coursesById = {};
  let page = 1, editId = null, editRow = null, saved = '', touched = false, saving = false, submitted = false, hydrating = false;
  let alive = true; const uploadVersions = { photo: 0, signature: 0 };
  let loadError = null;
  let loading = true;
  let paymentMode = 'full'; // full | difference | none
  let priorAdmissionPaid = 0; // verified prior admission payments (upgrade flow absent -> 0)
  let amountDue = 0;
  let confirmedReceived = false;
  const REASON_LABELS = {
    migrated: 'Migrated / existing student',
    returning: 'Returning after a long break',
    rejoining: 'Rejoining after course ended',
    'previously-paid': 'Admission fee previously paid',
    waiver: 'Approved fee waiver / scholarship',
    other: 'Other approved reason'
  };
  // These reasons imply the student already exists. They are unsupported for brand-new
  // admissions because no verified existing-student / upgrade workflow is available.
  const EXISTING_STUDENT_REASONS = ['migrated', 'returning', 'rejoining', 'previously-paid'];

  function courseOf(id) { return coursesById[id] || {}; }
  function levelName(c) { return c && c.name || ''; }
  function isActive(c) { return isCourseActive(c); }

  // ---------- document state ----------
  cleanupPage=()=>{closeReasonMenu();alive=false;DOC_KEYS.forEach(k=>uploadVersions[k]++);};
  const docFiles = {}; // key -> { file, compressedBlob, dataUrl }

  // ---------- state rendering ----------
  function setLoading(isLoading) {
    loading = isLoading;
    loadingEl.hidden = !isLoading;
    rowsHost.hidden = isLoading;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;
    footEl.hidden = true;
  }

  function setError(msg) {
    loadError = msg;
    loadingEl.hidden = true;
    rowsHost.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = false;
    if (loadErrorMsg) loadErrorMsg.textContent = msg;
    footEl.hidden = true;
  }

  function setDocPreview(key, file) {
    const preview = $('adm-' + key + '-preview');
    const errBox = $('adm-' + key + '-err');
    const sizeEl = $('adm-' + key + '-size');
    const upload = $('adm-' + key + '-upload');
    const emptyEl = upload ? upload.querySelector('.adm-upload-empty') : null;
    if (!preview) return;
    preview.innerHTML = '';
    preview.style.display = 'none';
    if (errBox) errBox.textContent = '';
    if (!file) {
      docFiles[key] = null;
      if (sizeEl) { sizeEl.textContent = ''; sizeEl.className = 'adm-doc-size'; }
      if (emptyEl) emptyEl.style.display = 'flex';
      if (upload) { upload.classList.remove('has-preview'); upload.classList.remove('compressing'); }
      return;
    }
    const df = docFiles[key];
    if (!df || !df.dataUrl) return;
    preview.style.display = 'flex';
    const box = mk('div', 'adm-doc-box');
    box.style.position = 'relative';
    box.style.overflow = 'visible';
    const img = mk('img', 'adm-doc-thumb');
    img.src = df.dataUrl;
    img.style.objectFit = (key === 'photo') ? 'cover' : 'contain';
    if (key === 'signature') img.style.background = '#FFFFFF';
    box.appendChild(img);
    const remove = mk('button', 'adm-doc-remove');
    remove.type = 'button';
    remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    remove.setAttribute('aria-label', 'Remove file');
    remove.addEventListener('click', (ev) => { ev.stopPropagation(); if(saving) return; uploadVersions[key]++; setDocPreview(key, null); $('adm-'+key+'-file').value=''; touched=true; refresh(); });
    box.appendChild(remove);
    preview.appendChild(box);
    if (emptyEl) emptyEl.style.display = 'none';
    if (upload) upload.classList.add('has-preview');
    if (sizeEl && df.compressedBlob) {
      sizeEl.textContent = 'Saved: ' + (df.compressedBlob.size / 1024).toFixed(1) + ' KB';
      sizeEl.className = 'adm-doc-size saved';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ---------- renders ----------
  function statusPill(st) {
    const cls = { active: 'active', completed: 'completed', archived: 'archived', inactive: 'inactive' }[st] || 'active';
    const label = { active: 'Active', completed: 'Completed', archived: 'Archived', inactive: 'Inactive' }[st] || st;
    return '<span class="adm-pill ' + cls + '">' + label + '</span>';
  }

  function render() {
    if (!rowsHost) return;
    loading = false;
    rowsHost.hidden = false;
    rowsHost.innerHTML = '';
    loadingEl.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;

    const f = tb.state;
    const list = students.filter((s) => {
      if (f.status && f.status !== 'all' && (s.status || 'active') !== f.status) return false;
      if (f.level && f.level !== 'all') {
        if (String(s.courseId || '') !== String(f.level)) return false;
      }
      if (f.course && f.course !== 'all') {
        const c = courseOf(s.courseId);
        return (c.courseCode || c.code || c.id) === f.course || (c.name || '') === f.course;
      }
      if (f.q) {
        const hay = [(s.name || ''), (s.studentId || ''), (s.phone || ''), (s.guardianName || '')].join(' ').toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });

    if (students.length === 0) {
      emptyEl.hidden = false;
      footEl.hidden = true;
      stats.update(0, 0);
      stats.update(1, 0);
      stats.update(2, 0);
      return;
    }

    if (!list.length) {
      noMatchEl.hidden = false;
      footEl.hidden = true;
      stats.update(0, students.length);
      stats.update(1, students.filter((s) => (s.status || 'active') === 'active').length);
      stats.update(2, students.filter((s) => { const st = s.status || 'active'; return st === 'completed' || st === 'archived' || st === 'inactive'; }).length);
      return;
    }

    const pageSize = PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * pageSize;
    const pageList = list.slice(start, start + pageSize);

    pageList.forEach((s) => {
      const c = courseOf(s.courseId);
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + (s.studentId || '-') + '</td>' +
        '<td>' +
        '<b>' + (s.name || '-') + '</b><br>' +
        '<span class="adm-sub">' + (s.guardianName || '-') + '</span>' +
        '</td>' +
        '<td class="hide-sm">' + (s.phone || '-') + '</td>' +
        '<td>' +
        '<span>' + (c ? (c.name || '-') : '-') + '</span><br>' +
        '<span class="adm-sub">' + (s.batchName || '-') + '</span>' +
        '</td>' +
        '<td class="hide-sm">' + formatDateIN(s.admissionDate) + '</td>' +
        '<td class="hide-md">' + statusPill(s.status || 'active') + '</td>';
      const tdAct = mk('td', 'adm-actions');
      const kebab = mk('button', 'ui-kebab');
      kebab.type = 'button';
      kebab.setAttribute('aria-label', 'Actions for ' + (s.name || 'student'));
      kebab.setAttribute('aria-haspopup', 'menu');
      kebab.setAttribute('aria-expanded', 'false');
      const ki = document.createElement('i');
      ki.setAttribute('data-lucide', 'more-vertical');
      kebab.appendChild(ki);
      const items = [
        { label: 'View', icon: 'eye', onClick: () => { location.hash = '#/school-admissions/' + s.id + '/receipt'; } },
        { label: 'View admission receipt', icon: 'file-text', onClick: () => { location.hash = '#/school-admissions/' + s.id + '/receipt'; } },
        { label: 'Edit', icon: 'pencil', onClick: async () => {
          if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
          openForm(students.find((x) => x.id === s.id));
        } }
      ];
      kebab.addEventListener('click', () => openMenu(kebab, items));
      tdAct.appendChild(kebab);
      tr.appendChild(tdAct);
      rowsHost.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const activeN = students.filter((s) => (s.status || 'active') === 'active').length;
    const inactiveN = students.filter((s) => { const st = s.status || 'active'; return st === 'completed' || st === 'archived' || st === 'inactive'; }).length;
    const studentN = students.length;
    stats.update(0, students.length);
    stats.update(1, activeN);
    stats.update(2, inactiveN);
    if (footEl) {
      renderPager(footEl, { page, pageSize: PAGE_SIZE, totalItems: list.length, onPageChange: (p) => { page = p; render(); } });
    }
  }

  // ---------- load ----------
  async function load() {
    setLoading(true);
    loadError = null;
    try {
      const sSnap = await getDocs(query(collection(db, COL), where('ctx', '==', 'school')));
      students = sSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      const cSnap = await getDocs(query(collection(db, 'courses'), where('ctx', '==', 'school')));
      levels = cSnap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter(c => (c.status || 'active') === 'active');
      coursesById = {}; levels.forEach((c) => { coursesById[c.id] = c; });
      const bSnap = await getDocs(query(collection(db, 'batches'), where('ctx', '==', 'school')));
      batches = bSnap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter(b => (b.status || 'active') === 'active');
      tb.setFilterOptions('level', [{ value: 'all', label: 'All levels' }].concat(levels.map((c) => ({ value: c.id, label: c.name || c.id, icon: 'book-open' }))));
      levelSel.setOptions([{ value: '', label: 'Select a level', icon: 'book-open' }].concat(levels.map((c) => ({ value: c.id, label: c.name || c.id, icon: 'book-open' }))));
      render();
    } catch (e) {
      console.error('[school-admissions] load failed', e);
      setError('Could not load admissions (' + (e.code || 'error') + ').');
    }
  }

  // ---------- form ----------
  async function openForm(r) {
    if (saving) return;
    if (!form.hidden && isDirty(readForm()) && !await confirmLeave({clear:false})) return;
    DOC_KEYS.forEach(k => { uploadVersions[k]++; setDocPreview(k, null); const i=$('adm-'+k+'-file'); if(i) i.value=''; });
    confirmedReceived = false; confirmReceivedInput.checked = false;
    priorAdmissionPaid = 0;
    editId = r ? r.id : null;
    editRow = r || null;
    const blank = {
      schoolClass: '', name: '', guardianName: '', phone: '', altPhone: '', email: '', aadhaar: '',
      dob: '', gender: '', address: '', levelId: '', batchId: '', admissionDate: '', paymentMode: 'full', noPaymentReason: '', noPaymentOther: '', feeReceived: ''
    };
    const v = r ? Object.assign({}, blank, {
      name: r.name || '', guardianName: r.guardianName || '', phone: r.phone || '', altPhone: r.altPhone || '',
      schoolClass: r.schoolClass || '', email: r.email || '', aadhaar: '', dob: r.dob || '', gender: r.gender || '', address: r.address || '',
      levelId: r.courseId || '', batchId: r.batchId || '', admissionDate: r.admissionDate || '', paymentMode: r.paymentMode || 'full', noPaymentReason: r.noPaymentReason || '', noPaymentOther: r.noPaymentOther || '', feeReceived: false
    }) : Object.assign({}, blank, { admissionDate: localToday() });
    hydrating = true;
    fillForm(v);
    if (r) {
      try {
        const snaps = await Promise.all([
          getDoc(doc(db, COL, r.id, 'aadhaar', 'aadhaar')),
          ...DOC_KEYS.map(k => getDoc(doc(db, COL, r.id, 'docs', k)))
        ]);
        if (!alive) return;
        v.aadhaar = snaps[0].exists() ? (snaps[0].data().aadhaar || '') : '';
        $v('adm-aadhaar', v.aadhaar);
        DOC_KEYS.forEach((k,i) => {
          if(snaps[i+1].exists()) {
            const d=snaps[i+1].data();
            docFiles[k]={dataUrl:d.data, existing:true, name:d.name || k};
            setDocPreview(k,true);
          }
        });
      } catch(e) {
        hydrating=false;
        showToast({type:'error',message:'Could not load the existing admission documents. Please retry.'});
        return;
      }
    }
    hydrating = false;
    submitted = false;
    saved = snapshot(readForm());
    touched = false;
    showErrors({});
    refresh();
    form.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    refresh();
    $('adm-name').focus({ preventScroll: true });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function closeForm() {
    form.hidden = true;
    editId = null;
    editRow = null;
    DOC_KEYS.forEach((k) => { uploadVersions[k]++; setDocPreview(k, null); });
    saved = {};
    touched = false;
    saving = false;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    setState('Fill in the details', '');
    showErrors({});
  }

  function snapshot(v) {
    return JSON.stringify({
      name: v.name || '', guardianName: v.guardianName || '', phone: v.phone || '', altPhone: v.altPhone || '',
      email: v.email || '', aadhaar: v.aadhaar || '', dob: v.dob || '', gender: v.gender || '',
      address: v.address || '', schoolClass: v.schoolClass || '', levelId: v.levelId || '', batchId: v.batchId || '',
      admissionDate: v.admissionDate || '', paymentMode: v.paymentMode || 'full', noPaymentReason: v.noPaymentReason || '', noPaymentOther: v.noPaymentOther || '', confirmedReceived: !!v.confirmReceived, documents: DOC_KEYS.map(k => docFiles[k] ? docFiles[k].dataUrl || 'pending' : '')
    });
  }

  function isDirty(v) { return snapshot(v) !== saved; }

  function refresh() {
    if (form.hidden) return;
    const v = readForm();
    const dirty = isDirty(v);
    updateCounters();
    refreshFeePreview();
    if (submitted) showErrors(validate(v));
    saveBtn.disabled = saving || DOC_KEYS.some(k => docFiles[k]?.pending) || !dirty;
    cancelBtn.disabled = saving;
    if (!saving) setState(dirty ? 'Unsaved changes' : (editId ? 'Existing admission — payment unchanged' : 'New admission — not submitted'), dirty ? 'dirty' : '');
  }

  function updateCounters() {
    document.querySelectorAll('.ui-count[data-for]').forEach((c) => {
      const el = $(c.dataset.for);
      if (el) c.textContent = el.value.length + '/' + el.maxLength;
    });
  }

  function computeAmountDue(c) {
    const configured = c && c.admissionFee != null ? Number(c.admissionFee) : 0;
    if (!Number.isFinite(configured) || configured < 0) return NaN;
    switch (paymentMode) {
      case 'full': return configured;
      case 'difference': return Math.max(0, configured - priorAdmissionPaid);
      case 'none': return 0;
      default: return configured;
    }
  }

  function setFeeModeActive(cardId, active) {
    const card = $(cardId);
    if (card) card.classList.toggle('adm-mode-active', active);
  }

  function refreshFeePreview() {
    if (!editId && paymentMode === 'difference') paymentMode = 'full';
    const c = coursesById[levelSel.value] || null;
    const configured = c && c.admissionFee != null ? Number(c.admissionFee) : 0;
    const monthly = c && c.monthlyFee != null ? Number(c.monthlyFee) : 0;
    const due = editId ? Number(editRow.actualAmountReceived ?? editRow.admissionFee ?? 0) : computeAmountDue(c);
    amountDue = due;

    feeBreakdown.hidden = false;
    $('adm-fee-values').hidden = !c;
    $('adm-fee-placeholder').hidden = !!c;
    $('adm-monthly-values').hidden = !c;
    $('adm-monthly-placeholder').hidden = !!c;
    if (c) {
      feeConfigured.textContent = formatINR(editId ? Number(editRow.configuredAdmissionFee ?? configured) : configured);
      feePrior.textContent = priorAdmissionPaid ? formatINR(priorAdmissionPaid) : '—';
      const adj = configured - due;
      feeAdj.textContent = adj > 0 ? ('− ' + formatINR(adj)) : '—';
      feeDue.textContent = formatINR(due);
    }
    monthlyFeeEl.textContent = c ? formatINR(editId ? Number(editRow.monthlyFee ?? monthly) : monthly) : '—';
    firstMonthlyEl.textContent = c && $('adm-admissionDate').value ? formatBillingMonth(firstMonthlyMonth($('adm-admissionDate').value)) : '—';

    // Difference is unavailable for new admissions (no upgrade / verified-history infrastructure).
    paymentModeDiff.disabled = true;
    paymentModeFull.disabled = !!editId || saving;
    paymentModeNone.disabled = !!editId || saving;
    // Reason dropdown is visible from the start inside the None card. It is disabled
    // unless No payment is selected; the required asterisk only shows when None.
    const isNone = paymentMode === 'none';
    noPaymentReasonWrap.hidden = false;
    noPaymentReasonInput.disabled = !isNone || !!editId || saving;
    noPaymentReasonInput.required = isNone && !editId && !saving;
    reasonSelect.value = noPaymentReasonInput.value;
    const reasonButton = reasonHost.querySelector('.ui-select-btn');
    if (reasonButton) reasonButton.disabled = !isNone || !!editId || saving;
    if (reasonButton) reasonButton.setAttribute('aria-required', isNone && !editId ? 'true' : 'false');
    if (paymentMode !== 'none' || saving || editId) closeReasonMenu();
    // Toggle required asterisk on the label only when No payment is selected.
    const reasonLabel = $('adm-reason-label');
    if (reasonLabel) {
      reasonLabel.innerHTML = 'Reason for no payment' + (isNone ? ' <em>*</em>' : '');
    }
    setFeeModeActive('adm-mode-card-full', paymentMode === 'full');
    setFeeModeActive('adm-mode-card-difference', paymentMode === 'difference');
    setFeeModeActive('adm-mode-card-none', paymentMode === 'none');
    paymentModeFull.checked = paymentMode === 'full';
    paymentModeDiff.checked = paymentMode === 'difference';
    paymentModeNone.checked = paymentMode === 'none';

    // Confirmation required only for a positive amount; never pre-checked.
    const needsConfirm = !!c && !editId && due > 0;
    confirmReceivedWrap.hidden = !needsConfirm;
    if (!needsConfirm) { confirmReceivedInput.checked = false; confirmedReceived = false; }

    // Other explanation only when No payment + Other is selected.
    noPaymentOtherWrap.hidden = !(isNone && noPaymentReasonInput.value === 'other');
    $('adm-paymentMode-err').textContent = c && !Number.isFinite(due) ? 'This level has an invalid admission fee. Correct its configuration before admitting.' : '';
    $('adm-no-payment-note').hidden = !c || due !== 0;
    feePrior.closest('.adm-fee-row').hidden = paymentMode !== 'difference';
    feeAdj.closest('.adm-fee-row').hidden = !c || configured === due;
  }
  function formatBillingMonth(month) {
    if (!/^\d{4}-\d{2}$/.test(month || '')) return 'Select an admission date';
    const [year, number] = month.split('-').map(Number);
    return new Intl.DateTimeFormat('en-IN', {month:'long',year:'numeric'}).format(new Date(year, number - 1, 1));
  }
  function localToday() {
    const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function validCalendarDate(s) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    const [y,m,d]=s.split('-').map(Number); const a=new Date(0); a.setFullYear(y,m-1,d); a.setHours(12,0,0,0);
    return y>=1900 && a.getFullYear()===y && a.getMonth()===m-1 && a.getDate()===d;
  }

  function setState(text, cls) {
    const s = $('adm-state');
    if (!s) return;
    s.textContent = text;
    s.className = 'save-state' + (cls ? ' ' + cls : '');
  }

  function readForm() {
    return {
      name: $('adm-name').value.trim(),
      guardianName: $('adm-guardianName').value.trim(),
      phone: $('adm-phone').value.trim(),
      altPhone: $('adm-altPhone').value.trim(),
      email: $('adm-email').value.trim(),
      aadhaar: $('adm-aadhaar').value.trim(),
      dob: $('adm-dob').value.trim(),
      gender: genderSel.value || '',
      address: $('adm-address').value.trim(),
      schoolClass: $('adm-schoolClass').value.trim(),
      levelId: levelSel.value || '',
      batchId: batchSel.value || '',
      admissionDate: $('adm-admissionDate').value.trim(),
      admissionAmount: String(amountDue ?? 0),
      paymentMode,
      confirmReceived: confirmReceivedInput.checked,
      noPaymentReason: paymentMode === 'none' ? (noPaymentReasonInput ? noPaymentReasonInput.value : '') : '',
      noPaymentOther: paymentMode === 'none' && noPaymentReasonInput.value === 'other' ? (noPaymentOtherInput ? noPaymentOtherInput.value.trim() : '') : ''
    };
  }

  function validate(v) {
    const e = {};
    const errName = validateName(v.name); if (errName) e.name = errName;
    const errGuardian = validateName(v.guardianName); if (errGuardian) e.guardianName = errGuardian;
    const errPhone = validatePhone(v.phone); if (errPhone) e.phone = errPhone;
    if (v.altPhone) { const e2 = validatePhone(v.altPhone); if (e2) e.altPhone = e2; }
    if (v.email) { const e2 = validateEmail(v.email); if (e2) e.email = e2; }
    if (!validCalendarDate(v.dob) || v.dob > localToday()) e.dob = 'Enter a valid date of birth, not in the future.';
    if (!v.gender) e.gender = 'Select gender.';
    const errAddress = validateRequired(v.address, 'Address'); if (errAddress) e.address = errAddress;
    const errSchoolClass = validateRequired(v.schoolClass, 'School class'); if (errSchoolClass) e.schoolClass = errSchoolClass;
    if (!AADHAAR_RE.test(v.aadhaar)) e.aadhaar = 'Aadhaar must be exactly 12 digits.';
    if (!v.levelId) e.levelId = 'Select a level.';
    if (!v.batchId) e.batchId = 'Select a batch.';
    else {
      const course = coursesById[v.levelId];
      const batch = batches.find((b) => b.id === v.batchId);
      if (!course || !isCourseActive(course)) e.levelId = 'Select a valid level.';
      else if (!batch || !batchAllowsCourse(batch, course.id, levels)) e.batchId = 'Selected batch is not valid for this level.';
    }
    if (!v.admissionDate) e.admissionDate = 'Select an admission date.';
    else if (!validCalendarDate(v.admissionDate) || v.admissionDate > localToday()) e.admissionDate = 'Admission date cannot be in the future.';
    DOC_KEYS.forEach(k => { const d=docFiles[k]; if (!d || !d.dataUrl || d.pending) e[k]='Upload a valid '+(k==='photo'?'student photo':"student signature")+'.'; });
    if (editId && (v.levelId !== editRow.courseId || v.batchId !== editRow.batchId || v.admissionDate !== editRow.admissionDate))
      e.levelId = 'Existing admission level, batch and admission date cannot be rewritten here. A separate upgrade/transfer flow is required.';
    if (v.paymentMode === 'none') {
      if (!v.noPaymentReason) e.noPaymentReason = 'Select a reason for no payment.';
      else if (v.noPaymentReason === 'other' && !v.noPaymentOther) e.noPaymentOther = 'Please specify the reason.';
      else if (!editId && EXISTING_STUDENT_REASONS.includes(v.noPaymentReason)) {
        e.noPaymentReason = 'This reason requires deliberate existing-student selection and the verified upgrade workflow, which is not available for new admissions. Use Full payment, or No payment with waiver / other reason.';
      }
    }
    if (!editId && amountDue > 0 && !v.confirmReceived) e.confirmReceived = 'Confirm that the displayed admission amount was received in full.';
    if (!editId && !['full', 'none'].includes(v.paymentMode)) e.paymentMode = 'Difference requires the separate verified upgrade workflow.';
    if (!Number.isFinite(amountDue) || amountDue < 0) e.paymentMode = 'Invalid configured admission fee.';
    return e;
  }

  function showErrors(err) {
    ['name', 'guardianName', 'phone', 'altPhone', 'email', 'aadhaar', 'dob', 'gender', 'address', 'schoolClass', 'levelId', 'batchId', 'admissionDate', 'paymentMode', 'noPaymentReason', 'noPaymentOther', 'confirmReceived', 'photo', 'signature'].forEach((k) => {
      const field = k === 'levelId' ? 'level' : k === 'batchId' ? 'batch' : k;
      const box = $('adm-' + field + '-err');
      if (box) box.textContent = err[k] || '';
    });
  }

  function focusFirstError(err) {
    if (err.name) return $('adm-name').focus();
    if (err.guardianName) return $('adm-guardianName').focus();
    if (err.phone) return $('adm-phone').focus();
    if (err.altPhone) return $('adm-altPhone').focus();
    if (err.email) return $('adm-email').focus();
    if (err.aadhaar) return $('adm-aadhaar').focus();
    if (err.dob) return $('adm-dob').focus();
    if (err.gender) { genderSel.focus(); return; }
    if (err.address) return $('adm-address').focus();
    if (err.schoolClass) return $('adm-schoolClass').focus();
    if (err.levelId) { levelSel.focus(); return; }
    if (err.batchId) { batchSel.focus(); return; }
    if (err.admissionDate) return $('adm-admissionDate').focus();
    if (err.paymentMode) return paymentModeFull.focus();
    if (err.noPaymentReason) return reasonSelect.focus();
    if (err.noPaymentOther) return $('adm-noPaymentOther').focus();
    if (err.confirmReceived) return $('adm-confirmReceived').focus();
    if (err.photo) return $('adm-photo-upload').focus();
    if (err.signature) return $('adm-signature-upload').focus();
  }

  function fillForm(v) {
    $v('adm-name', v.name); $v('adm-guardianName', v.guardianName); $v('adm-phone', v.phone);
    $v('adm-altPhone', v.altPhone); $v('adm-email', v.email); $v('adm-aadhaar', v.aadhaar);
    $v('adm-dob', v.dob); $v('adm-address', v.address); $v('adm-schoolClass', v.schoolClass); $v('adm-admissionDate', v.admissionDate);
    genderSel.value = v.gender || '';
    levelSel.value = v.levelId || '';
    batchSel.value = v.batchId || '';
    paymentMode = v.paymentMode || 'full';
    const savedReason = v.noPaymentReason || '';
    if (Object.prototype.hasOwnProperty.call(REASON_LABELS, savedReason)) {
      noPaymentReasonInput.value = savedReason;
      noPaymentOtherInput.value = v.noPaymentOther || '';
    } else if (savedReason) {
      // Legacy free-text reason: preserve it under "Other" without discarding or rewriting history.
      noPaymentReasonInput.value = 'other';
      noPaymentOtherInput.value = savedReason;
    } else {
      noPaymentReasonInput.value = '';
      noPaymentOtherInput.value = '';
    }
    confirmReceivedInput.checked = false; confirmedReceived = false;
    refreshFeePreview();
    // refresh batch options for the selected level
    refreshBatchOptions();
  }

  function refreshBatchOptions() {
    const course = coursesById[levelSel.value] || null;
    const opts = [{ value: '', label: 'Select a batch', icon: 'layers' }];
    if (course) {
      batches.filter((b) => batchAllowsCourse(b, course.id, levels)).forEach((b) => {
        opts.push({ value: b.id, label: b.name || b.id, icon: 'layers' });
      });
    }
    batchSel.setOptions(opts);
    if (!batchSel.value || !batches.find((b) => b.id === batchSel.value)) batchSel.value = '';
  }

  // File input, click, keyboard and drag/drop share one validated pipeline.
  DOC_KEYS.forEach(key => {
    const input=$('adm-'+key+'-file'), box=$('adm-'+key+'-upload'), err=$('adm-'+key+'-err');
    box.appendChild(input); // Keep input reachable when empty-state content is hidden.
    box.tabIndex=0; box.setAttribute('role','button'); box.setAttribute('aria-label','Upload student '+key);
    async function accept(file) {
      if(saving || !file) return;
      if(!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) { err.textContent='Only JPG, PNG or WEBP images are supported.'; return; }
      if(file.size>MAX_UPLOAD_BYTES) { err.textContent='File too large (max 10 MB).'; return; }
      const token=++uploadVersions[key], previous=docFiles[key];
      docFiles[key]={file,pending:true}; err.textContent=''; box.classList.add('compressing'); refresh();
      try {
        const result=await compressTo100KB(file,key);
        const dataUrl=await blobToDataURL(result.blob);
        if(!alive || uploadVersions[key]!==token) return;
        docFiles[key]={file,compressedBlob:result.blob,dataUrl,pending:false};
        setDocPreview(key,file); touched=true;
      } catch(e) {
        if(uploadVersions[key]===token) { docFiles[key]=previous || null; err.textContent=e.message || 'Could not process image. Try another JPG/PNG/WEBP image.'; }
      } finally {
        input.value='';
        if(uploadVersions[key]===token) { box.classList.remove('compressing'); refresh(); }
      }
    }
    input.addEventListener('change',e=>accept(e.target.files?.[0]));
    box.addEventListener('click',e=>{if(e.target===input || e.target.closest('.adm-doc-remove')) return; if(!saving) input.click();});
    box.addEventListener('keydown',e=>{if(e.target===box && (e.key==='Enter'||e.key===' ')){e.preventDefault();if(!saving)input.click();}});
    box.addEventListener('dragover',e=>{e.preventDefault();box.classList.add('dragover');});
    box.addEventListener('dragleave',()=>box.classList.remove('dragover'));
    box.addEventListener('drop',e=>{e.preventDefault();box.classList.remove('dragover');accept(e.dataTransfer?.files?.[0]);});
  });
  form.addEventListener('input',()=>{if(!hydrating){touched=true;refresh();}});
  form.addEventListener('change',()=>{if(!hydrating){touched=true;refresh();}});
  const unregisterDirty = registerDirty(()=>!form.hidden && !saving && isDirty(readForm()));
  const previousCleanup=cleanupPage; cleanupPage=()=>{previousCleanup();unregisterDirty();};
  cancelBtn.addEventListener('click',async()=>{if(!saving && (!isDirty(readForm()) || await confirmLeave({clear:false}))) closeForm();});
  addBtn.addEventListener('click',()=>openForm(null));
  emptyEl.querySelector('#adm-empty-add').addEventListener('click',()=>openForm(null));

  // ---------- save ----------
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if(saving) return;
    submitted=true;
    const v=readForm(), err=validate(v);
    showErrors(err);
    if(Object.keys(err).length){focusFirstError(err);return;}
    const updating=!!editId, existingId=editId;
    saving=true; refresh(); saveBtn.disabled=true; cancelBtn.disabled=true; setState('Saving...','dirty');
    try {
      const docs={};
      for(const k of DOC_KEYS){
        const df=docFiles[k];
        if(!df || df.pending || !df.dataUrl) throw new Error('Upload both the student photo and signature first.');
        if(df.compressedBlob) docs[k]={type:'image/jpeg',mime:'image/jpeg',name:df.file.name,sizeBytes:df.compressedBlob.size,data:df.dataUrl};
      }
      const studentRef=updating ? doc(db,COL,existingId) : doc(collection(db,COL));
      const who=profile?.email || '', admissionYear=v.admissionDate.slice(0,4);
      const result=await runTransaction(db,async tx=>{
        const courseSnap=await tx.get(doc(db,'courses',v.levelId));
        const batchSnap=await tx.get(doc(db,'batches',v.batchId));
        const existing=updating ? await tx.get(studentRef) : null;
        const course=courseSnap.exists() ? { ...courseSnap.data(),id:courseSnap.id } : null;
        const batch=batchSnap.exists() ? { ...batchSnap.data(),id:batchSnap.id } : null;
        if(!course || course.ctx!=='school' || !isCourseActive(course)) throw new Error('The selected level is no longer active. Select it again.');
        if(!batch || batch.ctx!=='school' || (batch.status || 'active')!=='active' || !batchAllowsCourse(batch,course.id,levels)) throw new Error('The batch is no longer eligible. Select another active Kids batch.');
        if (!updating && !['full', 'none'].includes(v.paymentMode)) throw new Error('Difference payments require the verified upgrade workflow.');
        if (!updating && v.paymentMode === 'none' && !v.noPaymentReason) throw new Error('Enter a reason for no payment.');
        // Revalidate the payable charge from authoritative configuration; never trust a client total.
        const configured = Number(course.admissionFee ?? 0);
        if (!Number.isFinite(configured) || configured < 0) throw new Error('Invalid admission fee configuration.');
        let charge;
        switch (v.paymentMode) {
          case 'full': charge = configured; break;
          case 'difference': charge = Math.max(0, configured - priorAdmissionPaid); break;
          case 'none': charge = 0; break;
          default: charge = configured;
        }
        const old=existing?.exists() ? existing.data() : null;
        if (updating) charge = Number(old?.actualAmountReceived ?? old?.admissionFee ?? 0);
        if (!updating && charge > 0 && !v.confirmReceived) throw new Error('Confirm receipt of the full displayed amount.');
        if(updating && (!old || old.ctx!=='school')) throw new Error('The admission no longer exists. Reload the page.');
        if(updating && (old.courseId!==v.levelId || old.batchId!==v.batchId || old.admissionDate!==v.admissionDate || Number(old.admissionFee || 0)!==charge)) throw new Error('An existing payment or level cannot be rewritten through student editing.');
        const shown=coursesById[v.levelId];
        if(!updating && (Number(shown?.admissionFee || 0)!==Number(course.admissionFee || 0) || Number(shown?.monthlyFee || 0)!==Number(course.monthlyFee || 0))) throw new Error('Level fees changed. Refresh the page and review the amount before saving.');
        let sid=null,rc=null,centreCode=old?.receiptCentreCode || '';
        if(!updating){
          // Match Youth: resolve a centre code, then use the shared transactional
          // ID/receipt counters. Kids has a built-in Head Office (HO), not a
          // selectable branch. Preserve configured prefixes when present.
          const orgSnap = await tx.get(doc(db,'settings','org_config'));
          const configuredCode = String(orgSnap.exists() ? orgSnap.data().receiptCode || '' : '').trim().toUpperCase();
          if (configuredCode && !/^[A-Z0-9]{2,12}$/.test(configuredCode)) {
            throw new Error('The organisation receipt code is invalid. Use 2-12 letters or digits in Organisation settings.');
          }
          centreCode = configuredCode || 'HO';
          sid=await readStudentId(tx,{org:'school',sessionYear:admissionYear});
          rc=await readReceiptNo(tx,{org:'school',type:'AD',branchCode:centreCode,date:v.admissionDate});
        }
        const studentId=updating ? old.studentId : sid.studentId;
        const receiptNo=updating ? old.receiptNo : rc.receiptNo;
        if(!updating){
          writeCounter(tx,sid.ref,sid.next,{org:'school',sessionYear:admissionYear});
          writeCounter(tx,rc.ref,rc.next,{org:'school',type:'AD',branchCode:centreCode,date:v.admissionDate});
        }
        const data={studentId,receiptNo,...(!updating ? {receiptCentreCode:centreCode} : {}),name:v.name,guardianName:v.guardianName,phone:v.phone,altPhone:v.altPhone || '',email:v.email || '',dob:v.dob,gender:v.gender,address:v.address,schoolClass:v.schoolClass,
          admissionDate:v.admissionDate,firstMonthlyMonth:firstMonthlyMonth(v.admissionDate),
          status:updating ? old.status : 'active',ctx:'school',branchId:'HO',branchName:'Head Office',
          courseId:course.id,courseName:updating ? old.courseName : course.name,courseLevelName:updating ? old.courseLevelName : course.name,
          admissionFee:updating ? Number(old.admissionFee || 0) : charge,
          configuredAdmissionFee:updating ? Number(old.configuredAdmissionFee ?? old.admissionFee ?? 0) : Number(course.admissionFee || 0),
          monthlyFee:updating ? Number(old.monthlyFee || 0) : Number(course.monthlyFee || 0),batchId:batch.id,batchName:updating ? old.batchName : batch.name,
          paymentMode:updating ? (old.paymentMode || 'full') : v.paymentMode,eligiblePriorAdmissionPayments:updating ? Number(old.eligiblePriorAdmissionPayments || 0) : 0,finalAdmissionCharge:updating ? Number(old.finalAdmissionCharge ?? charge) : charge,actualAmountReceived:charge,noPaymentReason:updating ? (old.noPaymentReason || '') : (v.noPaymentReason || ''),noPaymentOther:updating ? (old.noPaymentOther || '') : (v.noPaymentOther || ''),
          updatedAt:serverTimestamp(),updatedBy:who};
        if(!updating){data.createdAt=serverTimestamp();data.createdBy=who;}
        tx.set(studentRef,data,{merge:updating});
        for(const [key,d] of Object.entries(docs)) tx.set(doc(db,COL,studentRef.id,'docs',key),{...d,updatedAt:serverTimestamp()});
        tx.set(doc(db,COL,studentRef.id,'aadhaar','aadhaar'),{studentId,aadhaar:v.aadhaar,updatedAt:serverTimestamp()});
        if(!updating) tx.set(doc(db,COL,studentRef.id,'payment','payment'),{
          studentId,receiptNo,receiptCentreCode:centreCode,admissionFee:charge,configuredAdmissionFee:Number(course.admissionFee || 0),monthlyFee:Number(course.monthlyFee || 0),receivedTotal:charge,feeReceived:charge>0,
          paymentMode:v.paymentMode,eligiblePriorAdmissionPayments:priorAdmissionPaid,actualAmountReceived:charge,noPaymentReason:v.noPaymentReason || '',noPaymentOther:v.noPaymentOther || '',
          admissionDate:v.admissionDate,firstMonthlyMonth:firstMonthlyMonth(v.admissionDate),createdAt:serverTimestamp(),createdBy:who});
        return {id:studentRef.id,studentId,receiptNo};
      });
      closeForm();
      showToast({type:'success',message:updating?'Student details updated. Original payment unchanged.':'Admission saved.'});
      location.hash='#/school-admissions/'+encodeURIComponent(result.id)+'/receipt';
    } catch(e){
      if(alive){saving=false;refresh();setState('Save failed','error');showToast({type:'error',message:e.message || 'Admission could not be saved. Please retry.'});}
    } finally {
      saving=false;
      if(alive && !form.hidden) refresh();
    }
  });

  $('adm-load-error-retry').addEventListener('click', () => { load(); });
  $('adm-load-error-back').addEventListener('click', () => { location.hash = '#/dashboard'; });
  $('adm-no-match-clear').addEventListener('click', () => {
    tb.state.q = '';
    tb.state.status = 'all';
    tb.state.level = 'all';
    render();
  });

  try { await load(); } catch (e) { console.error('[school-admissions] init load', e); setError('Could not load admissions.'); }
  form.addEventListener('reset', () => { touched = false; refresh(); });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
