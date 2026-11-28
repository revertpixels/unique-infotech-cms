// school-admissions.page.js � Unique Kids admissions (school context, Super Admin only).
// Kids batches are session-independent: no session field, no branch selector, Head Office
// (branchId 'HO') is used internally. Student IDs are YYYYNNNN from the admission year;
// receipt numbers use the shared Youth counter service with the configured
// organisation receipt code, or the Kids built-in Head Office code (HO). Save runs inside ONE runTransaction: all counter reads first, then all
// writes (counters, student, photo/signature docs, private Aadhaar doc, payment record).
import { db } from '../config/firebase-config.js';
import {
  collection, getDocs, query, where, doc, getDoc, addDoc, updateDoc, serverTimestamp,
  runTransaction, deleteField, writeBatch, deleteDoc, arrayUnion
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.199';
import { registerDirty, confirmLeave, clearDirty } from '../utils/unsaved-guard.js?v=1.8.199';
import { buildStats, buildToolbar, renderPager, PAGE_SIZE } from '../components/list-page.js?v=1.8.199';
import { createSelect } from '../components/ui-select.js?v=1.8.199';
import { createBranchBatchFilter } from '../components/branch-batch-filter.js?v=1.8.199';
import { openMenu } from '../components/ui-menu.js?v=1.8.199';
import { openPopup } from '../components/modal.js?v=1.8.199';
import { createDatePicker } from '../components/ui-datepicker.js?v=1.8.199';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.199';
import { formatINR, formatDateIN, initials } from '../utils/formatter.js?v=1.8.199';
import { validatePhone, validateEmail, validateDOB, validateName, validateRequired } from '../utils/validator.js?v=1.8.199';
import { readStudentId, readReceiptNo, writeCounter } from '../services/admission.service.js?v=1.8.199';
import { isCourseActive, batchAllowsCourse, todayISO } from '../utils/session-rules.js?v=1.8.199';
import { compressTo100KB, readAsDataURL, blobToDataURL, isImageFile } from '../utils/image-compress.js?v=1.8.199';
import { firstMonthlyMonth, formatNoPaymentReason } from '../utils/school-receipt.js?v=1.8.199';
import {
  formatBreakStatusText,
  isBreakOverdueReturn,
  syncOpenKidsBills
} from '../utils/school-billing.js?v=1.8.199';
import {
  createBillingStartSelector,
  openKidsStartBreakModal,
  openKidsResumeBreakModal,
  openKidsUpgradePackageModal
} from '../utils/school-break-modals.js?v=1.8.199';
import { playPaymentSuccessSound } from '../utils/sound.js?v=1.8.199';
import { openPaymentPopup, promptKidsAdmissionSuccess } from '../components/payment-popup.js?v=1.8.199';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.199';
import {
  ensureReferenceData,
  getCachedReferenceData,
  scopeReferenceDataByCtx,
  ensureKidsDataset,
  getCachedKidsDataset,
  syncKidsDatasetDelta,
  isCacheStale,
  scheduleDelayedSkeleton
} from '../services/report.service.js?v=1.8.199';

const COL = 'students';
const GENDERS = [
  { value: 'male', label: 'Male', icon: 'user' },
  { value: 'female', label: 'Female', icon: 'user-circle' },
  { value: 'other', label: 'Other', icon: 'user-x' }
];
const DOC_KEYS = ['photo', 'signature'];
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
  const isHead = profile && profile.role === 'school_head';
  if (!isSuper && !isHead) {
    showToast({ type: 'error', message: `Kids Admissions is restricted to ${getRoleTitle('superadmin')} and ${getRoleTitle('school_head')}.` });
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
  const firstMonthlyHost = $('adm-first-monthly-host');
  const paymentModeFull = $('adm-paymentMode-full');
  const paymentModeDiff = $('adm-paymentMode-difference');
  const paymentModeNone = $('adm-paymentMode-none');
  const noPaymentReasonWrap = $('adm-no-payment-reason-wrap');
  const noPaymentReasonInput = $('adm-noPaymentReason');
  const noPaymentOtherWrap = $('adm-none-other-wrap');
  const noPaymentOtherInput = $('adm-noPaymentOther');
  if ([form, addBtn, saveBtn, cancelBtn, rowsHost, emptyEl, loadingEl, noMatchEl, loadErrorEl, feeBreakdown, feeConfigured, feePrior, feeAdj, feeDue, monthlyFeeEl, firstMonthlyHost, paymentModeFull, paymentModeDiff, paymentModeNone, noPaymentReasonWrap, noPaymentReasonInput, noPaymentOtherWrap, noPaymentOtherInput].some(el => !el)) {
    showToast({ type: 'error', message: 'Admission page assets do not match. Refresh the page before continuing.' }); return;
  }

  let billingStartSel = null;

  // Hide New admission for school_head (view-only).
  if (!isSuper) { addBtn.hidden = true; }

  // ---------- list / filter state (declared first, before any use) ----------
  let students = [], levels = [], batches = [], coursesById = {};
  let page = 1;
  let admDateFilter = 'all';   // 'all'|'today'|'last7'|'thismonth'|'lastmonth'|'last3months'|'thisyear'|'custom'
  let admDateFrom = '', admDateTo = '';
  let dateErrEl = null;
  let dateSel = null, dateCustomWrap = null, fromInp = null, toInp = null;

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
      { value: 'break', label: 'On break' }, { value: 'break-overdue', label: 'Break ended - not rejoined' },
      { value: 'completed', label: 'Completed' }
    ]},
    { id: 'level', label: 'Level', options: [{ value: 'all', label: 'All levels', icon: 'book-open' }] }
  ];
  const tb = buildToolbar({
    placeholder: 'Search name, student ID or parent phone',
    filters: tbFilters,
    onChange: () => { page = 1; render(); },
    onRefresh: () => load({ forceRefresh: true }),
    rowLayout: true
  });
  let bbFilter = null;
  const tbHost = $('adm-toolbar');
  if (tbHost) {
    tbHost.innerHTML = '';
    tbHost.appendChild(tb.el);

    const bbHost = document.createElement('div');
    bbHost.className = 'lp-bb-host';
    bbFilter = createBranchBatchFilter(bbHost, {
      persistKey: 'admissions.school',
      profile,
      ctx: 'school',
      branches: [],
      batches: [],
      onChange: () => { page = 1; render(); }
    });
    tb.addFilterEl(bbHost);

    // Admission date filter dropdown + custom range row (inside row 3 container).
    const dateWrap = document.createElement('div');
    dateWrap.className = 'lp-filter';
    const dateLabel = document.createElement('span');
    dateLabel.className = 'lp-filter-label';
    dateLabel.textContent = 'Admission date';
    const dateSelHost = document.createElement('div');
    dateSelHost.className = 'lp-filter-select';
    dateWrap.appendChild(dateLabel);
    dateWrap.appendChild(dateSelHost);
    dateSel = createSelect(dateSelHost, {
      options: [
        { value: 'all', label: 'All dates', icon: 'calendar-clock' },
        { value: 'today', label: 'Today', icon: 'calendar' },
        { value: 'last7', label: 'Last 7 days', icon: 'calendar' },
        { value: 'thismonth', label: 'This month', icon: 'calendar' },
        { value: 'lastmonth', label: 'Last month', icon: 'calendar' },
        { value: 'last3months', label: 'Last 3 months', icon: 'calendar' },
        { value: 'thisyear', label: 'This year', icon: 'calendar' },
        { value: 'custom', label: 'Custom range', icon: 'calendar' }
      ],
      value: admDateFilter, ariaLabel: 'Admission date filter',
      onChange: (v) => {
        admDateFilter = v;
        admDateFrom = ''; admDateTo = '';
        dateCustomWrap.hidden = v !== 'custom';
        page = 1; render();
      }
    });
    tb.addFilterEl(dateWrap);

    dateCustomWrap = document.createElement('div');
    dateCustomWrap.className = 'lp-date-custom';
    dateCustomWrap.hidden = admDateFilter !== 'custom';
    fromInp = document.createElement('input');
    fromInp.type = 'date';
    fromInp.className = 'lp-date-input';
    toInp = document.createElement('input');
    toInp.type = 'date';
    toInp.className = 'lp-date-input';
    const fromLbl = document.createElement('span');
    fromLbl.className = 'lp-date-label';
    fromLbl.textContent = 'From';
    const toLbl = document.createElement('span');
    toLbl.className = 'lp-date-label';
    toLbl.textContent = 'To';
    dateErrEl = document.createElement('span');
    dateErrEl.className = 'lp-date-err';
    dateErrEl.hidden = true;
    dateCustomWrap.appendChild(fromLbl);
    dateCustomWrap.appendChild(fromInp);
    dateCustomWrap.appendChild(toLbl);
    dateCustomWrap.appendChild(toInp);
    dateCustomWrap.appendChild(dateErrEl);
    tb.rowCustom.appendChild(dateCustomWrap);

    fromInp.addEventListener('change', () => {
      admDateFrom = fromInp.value; page = 1; render();
    });
    toInp.addEventListener('change', () => {
      admDateTo = toInp.value; page = 1; render();
    });
  }

  // ---------- stats (no duplicate) ----------
  const stats = buildStats([
    { label: 'Total students', value: 0, sub: 'All records', icon: 'users', tone: 'indigo' },
    { label: 'Active', value: 0, sub: 'Currently enrolled', icon: 'check-circle', tone: 'green' },
    { label: 'On break', value: 0, sub: 'Currently on break', icon: 'pause-circle', tone: 'amber' },
    { label: 'Admitted this month', value: 0, sub: 'This calendar month', icon: 'calendar', tone: 'blue' }
  ]);
  const statsHost = $('adm-stats');
  if (statsHost) statsHost.appendChild(stats.el);
  // Clicking "Admitted this month" card (index 3) sets the date filter to This month.
  setTimeout(() => {
    const cards = statsHost.querySelectorAll('.lp-stat');
    if (cards[3]) {
      cards[3].style.cursor = 'pointer';
      cards[3].addEventListener('click', () => {
        admDateFilter = 'thismonth';
        admDateFrom = ''; admDateTo = '';
        dateSel.value = 'thismonth';
        dateCustomWrap.hidden = true;
        page = 1; render();
      });
    }
  }, 0);

  // ---------- state ----------
  let editId = null, editRow = null, saved = '', touched = false, saving = false, submitted = false, hydrating = false;
  let alive = true; const uploadVersions = { photo: 0, signature: 0 };
  let loadError = null;
  let loading = true;
  let paymentMode = 'full'; // full | difference | none
  let priorAdmissionPaid = 0; // verified prior admission payments (upgrade flow absent -> 0)
  let amountDue = 0;
  const REASON_LABELS = {
    migrated: 'Migrated / existing student',
    returning: 'Returning after a long break',
    rejoining: 'Rejoining after course ended',
    'previously-paid': 'Admission fee previously paid',
    waiver: 'Approved fee waiver / scholarship',
    other: 'Other approved reason'
  };
  const EXISTING_STUDENT_REASONS = [];

  billingStartSel = createBillingStartSelector(firstMonthlyHost, {
    mode: 'admission',
    anchorDate: localToday(),
    monthlyFee: 0,
    paymentMode: 'full',
    ariaLabel: 'First monthly billing month',
    onChange: () => {
      if (!hydrating) { touched = true; refresh(); }
    }
  });

  function courseOf(id) { return coursesById[id] || {}; }
  function levelName(c) { return c && c.name || ''; }
  function isActive(c) { return isCourseActive(c); }

  // ---------- document state ----------
  const docFiles = {}; // key -> { file, compressedBlob, dataUrl }

  function applyLoadedData(meta, dataset) {
    const scoped = scopeReferenceDataByCtx(meta || {}, 'school');
    students = (dataset?.studentsList || []).slice();
    levels = (scoped.coursesList || []).filter((c) => (c.status || 'active') === 'active');
    coursesById = {};
    levels.forEach((c) => { coursesById[c.id] = c; });
    batches = (scoped.batchesList || []).filter((b) => (b.status || 'active') === 'active');
    tb.setFilterOptions('level', [{ value: 'all', label: 'All levels' }].concat(levels.map((c) => ({ value: c.id, label: c.name || c.id, icon: 'book-open' }))));
    levelSel.setOptions([{ value: '', label: 'Select a level', icon: 'book-open' }].concat(levels.map((c) => ({ value: c.id, label: c.name || c.id, icon: 'book-open' }))));
    if (bbFilter) bbFilter.updateData({ ctx: 'school', batches, courses: levels });
    render();
  }

  // ---------- load ----------
  async function load({ forceRefresh = false, deltaRefresh = false, background = false } = {}) {
    loadError = null;
    if (!forceRefresh && !deltaRefresh) {
      const cachedMeta = getCachedReferenceData(profile);
      const cachedDs = getCachedKidsDataset();
      if (cachedMeta && cachedDs) {
        applyLoadedData(cachedMeta, cachedDs);
        if (!background && (isCacheStale(cachedMeta) || isCacheStale(cachedDs))) {
          load({ deltaRefresh: true, background: true }).catch(() => {});
        }
        return;
      }
    }

    const skelTask = (!background && !students.length)
      ? scheduleDelayedSkeleton(() => {
        if (alive && !students.length) setLoading(true);
      }, 300)
      : null;

    try {
      const [meta, dataset] = await Promise.all([
        ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile }),
        deltaRefresh
          ? syncKidsDatasetDelta({ profile, syncOpenBills: true })
          : ensureKidsDataset({ profile, forceRefresh, syncOpenBills: true })
      ]);
      if (skelTask) skelTask.cancel();
      if (!alive) return;
      if (!background || !deltaRefresh || !dataset.deltaUsed || dataset.changedCount !== 0 || meta?.fromCache === false) {
        applyLoadedData(meta, dataset);
      }
    } catch (e) {
      if (skelTask) skelTask.cancel();
      if (!background && alive) {
        console.error('[school-admissions] load failed', e);
        setError('Could not load admissions (' + (e.code || 'error') + ').');
      }
    }
  }

  const onMutated = () => { if (alive) load({ forceRefresh: false }); };
  window.addEventListener('uic:data-mutated', onMutated);
  window.addEventListener('uic:meta-mutated', onMutated);
  cleanupPage = () => {
    closeReasonMenu();
    alive = false;
    window.removeEventListener('uic:data-mutated', onMutated);
    window.removeEventListener('uic:meta-mutated', onMutated);
    DOC_KEYS.forEach((k) => uploadVersions[k]++);
  };

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
  function statusPill(st, s = null) {
    if (st === 'break') {
      const text = s ? formatBreakStatusText(s) : 'On Break';
      const cls = s && isBreakOverdueReturn(s) ? 'break break-overdue' : 'break';
      return '<span class="adm-pill ' + cls + '">' + text + '</span>';
    }
    const cls = { active: 'active', completed: 'completed', archived: 'archived', inactive: 'inactive', ended: 'archived', break: 'break', dropped: 'inactive' }[st] || 'active';
    const label = { active: 'Active', completed: 'Completed', archived: 'Archived', inactive: 'Inactive', ended: 'Ended', break: 'On Break', dropped: 'Dropped' }[st] || st;
    return '<span class="adm-pill ' + cls + '">' + label + '</span>';
  }

  function admDateRange() {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (yy, mm, dd) => yy + '-' + pad(mm + 1) + '-' + pad(dd);
    let from = '', to = '', err = '';
    switch (admDateFilter) {
      case 'today': from = iso(y, m, d); to = iso(y, m, d); break;
      case 'last7': { const s = new Date(now); s.setDate(d - 6); from = iso(s.getFullYear(), s.getMonth(), s.getDate()); to = iso(y, m, d); break; }
      case 'thismonth': from = iso(y, m, 1); to = iso(y, m, new Date(y, m + 1, 0).getDate()); break;
      case 'lastmonth': { const pm = m === 0 ? 11 : m - 1; const py = m === 0 ? y - 1 : y; from = iso(py, pm, 1); to = iso(py, pm, new Date(py, pm + 1, 0).getDate()); break; }
      case 'last3months': { const s = new Date(now); s.setMonth(m - 2); s.setDate(1); from = iso(s.getFullYear(), s.getMonth(), 1); to = iso(y, m, new Date(y, m + 1, 0).getDate()); break; }
      case 'thisyear': from = iso(y, 0, 1); to = iso(y, 11, 31); break;
      case 'custom': from = admDateFrom; to = admDateTo; break;
    }
    if (admDateFilter === 'custom' && from && to && to < from) err = 'To date must be on or after From date.';
    return { from, to, err };
  }

  function render() {
    if (!rowsHost) return;
    try {
      loading = false;
    rowsHost.hidden = false;
    rowsHost.innerHTML = '';
    loadingEl.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;

    const f = tb.state;
    const dr = admDateRange();
    if (dateErrEl) { dateErrEl.textContent = dr.err || ''; dateErrEl.hidden = !dr.err; }
    const bbVal = bbFilter ? bbFilter.getValue() : { branchId: 'HO', batchId: 'all' };
    const list = students.filter((s) => {
      const curSt = s.status || 'active';
      if (f.status && f.status !== 'all') {
        if (f.status === 'break-overdue') {
          if (curSt !== 'break' || !isBreakOverdueReturn(s)) return false;
        } else if (curSt !== f.status) return false;
      }
      if (f.level && f.level !== 'all') {
        if (String(s.courseId || '') !== String(f.level)) return false;
      }
      if (bbVal.batchId && bbVal.batchId !== 'all' && s.batchId !== bbVal.batchId) return false;
      const ad = s.admissionDate || '';
      if (dr.from && ad < dr.from) return false;
      if (dr.to && ad > dr.to) return false;
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
      stats.update(0, 0, 'All records');
      stats.update(1, 0, 'Currently enrolled');
      stats.update(2, 0, 'Currently on break');
      stats.update(3, 0, 'This calendar month');
      return;
    }

    if (!list.length) {
      noMatchEl.hidden = false;
      footEl.hidden = true;
      stats.update(0, students.length, 'All records');
      stats.update(1, students.filter((s) => (s.status || 'active') === 'active').length, 'Currently enrolled');
      stats.update(2, students.filter((s) => { const st = s.status || 'active'; return st === 'break'; }).length, 'Currently on break');
      const now = new Date();
      stats.update(3, students.filter((s) => { if (!s.admissionDate) return false; const d = new Date(s.admissionDate); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length, 'This calendar month');
      const clearBtn = $('adm-no-match-clear');
      if (clearBtn) {
        clearBtn.onclick = (ev) => { ev.preventDefault(); tb.state.q = ''; tb.state.status = 'all'; tb.state.level = 'all'; if (bbFilter) bbFilter.reset(); admDateFilter = 'all'; admDateFrom = ''; admDateTo = ''; dateSel.value = 'all'; dateCustomWrap.hidden = true; fromInp.value = ''; toInp.value = ''; render(); };
      }
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
        '<td class="hide-md">' + statusPill(s.status || 'active', s) + '</td>';
      const tdAct = mk('td', 'adm-actions');
      const kebab = mk('button', 'ui-kebab');
      kebab.type = 'button';
      kebab.setAttribute('aria-label', 'Actions for ' + (s.name || 'student'));
      kebab.setAttribute('aria-haspopup', 'menu');
      kebab.setAttribute('aria-expanded', 'false');
      const ki = document.createElement('i');
      ki.setAttribute('data-lucide', 'more-vertical');
      kebab.appendChild(ki);
      const st = s.status || 'active';
      const items = [
        { section: 'View', label: 'View details', icon: 'eye', onClick: () => viewDetailsPopup(s) },
        { label: 'View student', icon: 'user', onClick: () => { location.hash = '#/students/' + encodeURIComponent(s.id); } },
        { label: 'View admission receipt', icon: 'file-text', onClick: () => { location.hash = '#/school-admissions/' + s.id + '/receipt'; } },
      ];
      if (isSuper) {
        const live = st === 'active' || st === 'break';
        if (live) {
          items.push({ section: 'Manage' });
          items.push({ label: 'Change batch', icon: 'shuffle', onClick: () => changeBatchPopup(s) });
          items.push({ label: 'Upgrade level / package', icon: 'trending-up', onClick: () => upgradePackagePopup(s) });
          if (st === 'active') items.push({ label: 'Start break', icon: 'pause-circle', onClick: () => startBreakPopup(s) });
          if (st === 'break') items.push({ label: 'Resume / Rejoin', icon: 'play-circle', onClick: () => endBreakPopup(s) });
          items.push({ label: 'Mark course completed', icon: 'graduation-cap', onClick: () => completePopup(s) });
        }
        items.push({ section: 'Danger zone' });
        if (live) items.push({ label: 'Drop student', icon: 'user-x', danger: true, onClick: () => removeStudentPopup(s, 'drop') });
        items.push({ label: 'Delete permanently', icon: 'trash-2', danger: true, onClick: () => removeStudentPopup(s, 'delete') });
      }
      kebab.addEventListener('click', () => openMenu(kebab, items));
      tdAct.appendChild(kebab);
      tr.appendChild(tdAct);
      rowsHost.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const activeN = students.filter((s) => (s.status || 'active') === 'active').length;
    const onBreakN = students.filter((s) => { const st = s.status || 'active'; return st === 'break'; }).length;
    const studentN = students.length;
    const now = new Date();
    const thisMonthN = students.filter((s) => {
      if (!s.admissionDate) return false;
      const d = new Date(s.admissionDate);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    stats.update(0, studentN, 'All records');
    stats.update(1, activeN, 'Currently enrolled');
    stats.update(2, onBreakN, 'Currently on break');
    stats.update(3, thisMonthN, 'This calendar month');
    if (footEl) {
      renderPager(footEl, { page, pageSize: PAGE_SIZE, totalItems: list.length, onPageChange: (p) => { page = p; render(); } });
    }
    } catch (e) {
      console.error('[school-admissions] render failed', e);
      const msg = e && e.message ? e.message : String(e);
      rowsHost.innerHTML = '';
      const tr = mk('tr');
      const td = mk('td', 'adm-empty');
      td.colSpan = 7;
      td.innerHTML = 'Could not load students: ' + msg + '. <button type="button" id="adm-retry" class="ui-btn primary" style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;"><i data-lucide="rotate-ccw"></i>Retry</button>';
      tr.appendChild(td);
      rowsHost.appendChild(tr);
      const retryBtn = $('adm-retry');
      if (retryBtn) retryBtn.addEventListener('click', () => { load(); render(); });
    }
  }

  // ---------- state & rendering ----------

  // ---------- form ----------
  async function openForm(r) {
    if (saving) return;
    if (!form.hidden && isDirty(readForm()) && !await confirmLeave({clear:false})) return;
    DOC_KEYS.forEach(k => { uploadVersions[k]++; setDocPreview(k, null); const i=$('adm-'+k+'-file'); if(i) i.value=''; });
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
    if (billingStartSel) {
      const admCourse = r ? coursesById[r.courseId] : null;
      billingStartSel.setConfig({
        anchorDate: v.admissionDate || localToday(),
        monthlyFee: r ? Number(r.monthlyFee || admCourse?.monthlyFee || 0) : 0,
        paymentMode: r ? (r.paymentMode || 'full') : 'full',
        value: r ? (r.firstMonthlyMonth || firstMonthlyMonth(v.admissionDate)) : undefined,
        resetOverride: !r,
        isLocked: !!r
      });
    }
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

  // ---------- popup UI helpers (v1.8.96) ----------
  const who = () => (profile && profile.email) || '';
  const courseNameOf = (s) => (coursesById[s.courseId] || {}).name || s.courseName || '-';
  const studentSub = (s) => `${s.name || '-'} � ${s.studentId || '-'} � ${courseNameOf(s)} / ${s.batchName || '-'}`;
  const ymOf = (iso) => String(iso || '').slice(0, 7);
  function nextYM(ym) { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return y + '-' + String(m).padStart(2, '0'); }
  function monthsBetween(a, b) { if (!a || !b) return 0; const [y1, m1] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); return Math.max(0, (y2 - y1) * 12 + (m2 - m1)); }

  function fmtYM(ym) {
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || '';
    const [y, m] = ym.split('-').map(Number);
    const mName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] || '';
    return `${mName} ${y}`;
  }

  function pInfoGrid3(rows) {
    const box = mk('div', 'pk-info-grid-3');
    rows.forEach(([k, v, span3, valClass]) => {
      const item = mk('div', 'pk-info-item' + (span3 ? ' span-3' : ''));
      const lbl = mk('div', 'pk-info-label', k);
      const val = mk('div', 'pk-info-val' + (valClass ? ' ' + valClass : ''), v == null || v === '' ? '-' : String(v));
      item.appendChild(lbl);
      item.appendChild(val);
      box.appendChild(item);
    });
    return box;
  }

  function pField(label, el, { half = false, required = false } = {}) {
    const w = mk('div', 'ui-field ' + (half ? 'pk-field-half' : 'pk-field-full'));
    const lr = mk('div', 'ui-label-row');
    const lab = mk('label', null, label);
    if (required) {
      const em = mk('em', null, ' *');
      lab.appendChild(em);
    }
    lr.appendChild(lab);
    w.appendChild(lr);
    w.appendChild(el);
    return w;
  }

  function pFieldRow(f1, f2) {
    const row = mk('div', 'pk-field-row-2');
    row.appendChild(f1);
    row.appendChild(f2);
    return row;
  }

  function pTextarea(placeholder = '') {
    const wrap = mk('div', 'ui-input-wrap top');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', 'file-text');
    wrap.appendChild(ic);
    const ta = document.createElement('textarea');
    ta.className = 'ui-input';
    ta.rows = 2;
    if (placeholder) ta.placeholder = placeholder;
    wrap.appendChild(ta);
    return { wrap, textarea: ta };
  }

  function pTypeConfirm(targetId) {
    const wrap = mk('div', 'ui-input-wrap');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', 'key-round');
    wrap.appendChild(ic);
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'ui-input pk-confirm-id';
    inp.placeholder = targetId || '';
    inp.autocomplete = 'off';
    inp.addEventListener('input', () => {
      if (inp.value.trim() === String(targetId || '')) {
        inp.classList.add('matched');
      } else {
        inp.classList.remove('matched');
      }
    });
    wrap.appendChild(inp);
    return { wrap, input: inp };
  }

  function pNote(text) {
    const n = mk('div', 'pk-note');
    n.innerHTML = `<i data-lucide="info"></i><span>${text}</span>`;
    return n;
  }

  function pWarn(text) {
    const w = mk('div', 'pk-warn');
    w.innerHTML = `<i data-lucide="alert-triangle"></i><span>${text}</span>`;
    return w;
  }

  function pErr(container) {
    const e = mk('div', 'pk-err');
    e.hidden = true;
    container.appendChild(e);
    return e;
  }

  function pCheck(text) {
    const lab = mk('label', 'pk-check-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    lab.appendChild(cb);
    lab.appendChild(mk('span', null, text));
    return { lab, cb };
  }

  function pButtons(popup, label, { icon = '', tone = 'default' } = {}) {
    const foot = mk('div', 'adm-view-foot');
    const c = mk('button', 'ui-btn ghost', 'Cancel');
    c.type = 'button';
    c.addEventListener('click', () => popup.close());
    const ok = mk('button', 'ui-btn ' + (tone === 'danger' ? 'danger' : (tone === 'success' ? 'success' : 'primary')));
    ok.type = 'button';
    ok.disabled = true;
    let originalHtml = '';
    if (icon) {
      originalHtml = `<i data-lucide="${icon}"></i><span>${label}</span>`;
    } else {
      originalHtml = `<span>${label}</span>`;
    }
    ok.innerHTML = originalHtml;
    foot.appendChild(c);
    foot.appendChild(ok);
    popup.container.appendChild(foot);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    function setSaving(isSaving) {
      if (isSaving) {
        ok.disabled = true;
        c.disabled = true;
        ok.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>Saving...</span>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      } else {
        ok.innerHTML = originalHtml;
        c.disabled = false;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }

    return { cancelBtn: c, okBtn: ok, setSaving };
  }

  async function queryByStudent(colName, s) {
    const keys = [...new Set([s.id, s.studentId].filter(Boolean))];
    const out = [];
    for (const k of keys) {
      const snap = await getDocs(query(collection(db, colName), where('studentId', '==', k)));
      snap.docs.forEach(d => { if (!out.some(x => x.id === d.id)) out.push(Object.assign({ id: d.id, _ref: d.ref }, d.data())); });
    }
    return out;
  }
  async function billsFor(s) { try { return await queryByStudent('bills', s); } catch (e) { console.warn('[kids] bills read failed', e); return []; } }
  const dueOf = (bills) => bills.filter(b => b.status === 'unpaid' || b.status === 'partial')
    .reduce((t, b) => t + Math.max(0, Number(b.monthlyFee || 0) - Number(b.paidAmount || 0)), 0);
  const isUntouchedUnpaid = (b) => b.status === 'unpaid' && !(Number(b.paidAmount || 0) > 0);

  // ---------- popup: view details ----------
  async function viewDetailsPopup(s) {
    const popup = openPopup({
      title: 'Student Details',
      subtitle: (s.name || 'Student') + ' • ' + (s.studentId || ''),
      icon: 'eye',
      tone: 'default',
      wide: true,
      saving: () => false,
    });
    const container = popup.container;

    let aadhaarMasked = ' - ';
    try {
      const aadhaarSnap = await getDoc(doc(db, 'students', s.id, 'aadhaar', 'aadhaar'));
      if (aadhaarSnap.exists() && aadhaarSnap.data()?.aadhaar) {
        const a = aadhaarSnap.data().aadhaar;
        aadhaarMasked = '••••-••••-' + a.slice(-4);
      }
    } catch (_) { /* non-fatal */ }

    const bills = await billsFor(s);
    const dues = dueOf(bills);
    const feePaid = s.actualAmountReceived ?? s.admissionFee ?? 0;

    // 1. Academic & Batch Section
    const acadSec = mk('div', 'pk-info-section');
    acadSec.appendChild(mk('div', 'pk-info-section-title', 'Academic & Batch Information'));
    const acadGrid = mk('div', 'pk-info-grid-3');
    [
      ['Student ID', s.studentId || '-'],
      ['Course / Level', s.courseName || courseNameOf(s)],
      ['Batch', s.batchName || '-'],
      ['Status', (s.status || 'active').toUpperCase()],
      ['Admission Date', formatDateIN(s.admissionDate) || '-'],
      ['School Class', s.schoolClass || '-'],
    ].forEach(([l, v]) => {
      const it = mk('div', 'pk-info-item');
      it.appendChild(mk('div', 'pk-info-label', l));
      it.appendChild(mk('div', 'pk-info-val', v));
      acadGrid.appendChild(it);
    });
    acadSec.appendChild(acadGrid);
    container.appendChild(acadSec);

    // 2. Personal & Contact Section
    const personalSec = mk('div', 'pk-info-section');
    personalSec.appendChild(mk('div', 'pk-info-section-title', 'Personal & Guardian Details'));
    const personalGrid = mk('div', 'pk-info-grid-3');
    [
      ['Guardian Name', s.guardianName || '-'],
      ['Mobile Phone', s.phone || '-'],
      ['Alternative Phone', s.altPhone || '-'],
      ['Email Address', s.email || '-'],
      ['Date of Birth', formatDateIN(s.dob) || '-'],
      ['Gender', (s.gender || '-').charAt(0).toUpperCase() + (s.gender || '').slice(1)],
      ['Aadhaar (Masked)', aadhaarMasked],
    ].forEach(([l, v]) => {
      const it = mk('div', 'pk-info-item');
      it.appendChild(mk('div', 'pk-info-label', l));
      it.appendChild(mk('div', 'pk-info-val', v));
      personalGrid.appendChild(it);
    });
    personalSec.appendChild(personalGrid);
    container.appendChild(personalSec);

    // 3. Fee Overview Section
    const feeSec = mk('div', 'pk-info-section');
    feeSec.appendChild(mk('div', 'pk-info-section-title', 'Fee & Dues Overview'));
    const feeGrid = mk('div', 'pk-info-grid-3');
    [
      ['Monthly Fee', formatINR(Number(s.monthlyFee || 0))],
      ['Admission Fee Paid', formatINR(Number(feePaid))],
      ['Outstanding Dues', formatINR(dues), dues > 0 ? 'pk-info-val pk-dues-has' : 'pk-info-val pk-dues-none'],
    ].forEach(([l, v, cls]) => {
      const it = mk('div', 'pk-info-item');
      it.appendChild(mk('div', 'pk-info-label', l));
      const valEl = mk('div', cls || 'pk-info-val', v);
      it.appendChild(valEl);
      feeGrid.appendChild(it);
    });
    feeSec.appendChild(feeGrid);
    container.appendChild(feeSec);

    // Footer
    const foot = mk('div', 'adm-view-foot');
    const closeBtn = mk('button', 'ui-btn ghost', 'Close');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', () => popup.close());
    foot.appendChild(closeBtn);
    container.appendChild(foot);
  }

  // ---------- popup: change batch ----------
  async function changeBatchPopup(s) {
    const curBatch = batches.find((b) => b.id === s.batchId) || {};
    const curTiming = curBatch.timing || curBatch.time || '';
    const course = s.courseId ? (coursesById[s.courseId] || null) : null;

    let destOptions = [];
    try {
      const bSnap = await getDocs(query(collection(db, 'batches'), where('ctx', '==', 'school')));
      const allBatches = bSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      destOptions = allBatches.filter((b) => {
        if (b.ctx !== 'school') return false;
        if ((b.status || 'active') !== 'active') return false;
        if (b.id === s.batchId) return false;
        if (!course || !batchAllowsCourse(b, course.id, levels)) return false;
        return true;
      });
    } catch (e) {
      console.error('[changeBatch] load failed', e);
      showToast({ type: 'error', message: 'Could not load batches.' });
      return;
    }

    if (destOptions.length === 0) {
      showToast({ type: 'error', message: 'No eligible destination batch for this student.' });
      return;
    }

    let saving = false;
    const popup = openPopup({
      title: 'Change Batch',
      subtitle: (s.name || 'Student') + ' • ' + (s.studentId || ''),
      icon: 'shuffle',
      tone: 'default',
      saving: () => saving,
    });
    const c = popup.container;

    // Current Batch Badge
    const curRow = mk('div', 'pk-badge-row');
    const curBadge = mk('div', 'pk-current-badge');
    curBadge.innerHTML = `Current Batch: <strong>${curBatch.name || s.batchName || 'None'}</strong>${curTiming ? ' (' + curTiming + ')' : ''}`;
    curRow.appendChild(curBadge);
    c.appendChild(curRow);

    // Target batch dropdown
    const batchSelectHost = document.createElement('div');
    const batchOpts = [{ value: '', label: 'Select destination batch' }].concat(
      destOptions.map((b) => {
        const timing = b.timing || b.time || '';
        const name = b.name || b.id;
        return {
          value: b.id,
          label: timing ? `${name} (${timing})` : name,
          icon: 'layers'
        };
      })
    );

    let selectedBatchId = '';
    const capInfo = mk('div', 'pk-cap-info');
    createSelect(batchSelectHost, {
      options: batchOpts,
      value: '',
      ariaLabel: 'New batch',
      onChange: (v) => {
        selectedBatchId = v;
        const targetB = destOptions.find(b => b.id === v);
        if (targetB) {
          const cap = Number(targetB.capacity || targetB.maxStudents || 0);
          if (cap > 0) {
            capInfo.textContent = `Batch capacity: max ${cap} seats`;
          } else {
            capInfo.textContent = '';
          }
        } else {
          capInfo.textContent = '';
        }
        check();
      }
    });

    const dateHost = document.createElement('div');
    const dPicker = createDatePicker(dateHost, { value: todayISO(), ariaLabel: 'Effective transfer date', onChange: () => check() });

    const fBatch = pField('New destination batch', batchSelectHost, { required: true });
    fBatch.appendChild(capInfo);
    const fDate = pField('Effective transfer date', dateHost, { required: true });
    c.appendChild(pFieldRow(fBatch, fDate));

    // Reason
    const { wrap: reasonWrap, textarea: reasonTa } = pTextarea('Enter reason for batch change...');
    const fReason = pField('Reason for batch change', reasonWrap, { required: true });
    c.appendChild(fReason);

    // Reassurance note
    c.appendChild(pNote('Past payments and bills remain preserved. Only the batch assignment and class schedule update.'));

    const { cancelBtn, okBtn, setSaving } = pButtons(popup, 'Change Batch', { icon: 'shuffle', tone: 'default' });

    const check = () => {
      okBtn.disabled = saving || !selectedBatchId || !reasonTa.value.trim() || !dPicker.value;
    };
    reasonTa.addEventListener('input', check);
    check();

    okBtn.addEventListener('click', async () => {
      const destBatchId = selectedBatchId;
      const effectiveDate = dPicker.value;
      const reason = reasonTa.value.trim();
      const destBatch = destOptions.find((b) => b.id === destBatchId);
      if (!destBatch) return;

      saving = true;
      setSaving(true);
      try {
        await updateDoc(doc(db, 'students', s.id), {
          batchId: destBatch.id,
          batchName: destBatch.name || destBatch.id,
          batchChangedAt: serverTimestamp(),
          batchHistory: arrayUnion({
            fromBatchId: s.batchId || null,
            fromBatchName: curBatch.name || s.batchName || null,
            toBatchId: destBatch.id,
            toBatchName: destBatch.name || destBatch.id,
            effectiveDate,
            reason,
            by: (profile && profile.email) || 'admin',
            at: new Date().toISOString()
          }),
          updatedAt: serverTimestamp()
        });
        showToast({ type: 'success', message: `Batch changed to ${destBatch.name || destBatch.id}` });
        popup.close();
        load();
      } catch (err) {
        console.error('[school-admissions] change batch failed', err);
        showToast({ type: 'error', message: 'Could not change batch: ' + (err.message || 'error') });
        saving = false;
        setSaving(false);
      }
    });
  }

  // ---------- popup: start break / resume break / upgrade ----------
  function notifyAndReload() {
    window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'kids:lifecycle' } }));
    return load();
  }
  async function startBreakPopup(s) {
    return openKidsStartBreakModal({ student: s, profile, onSuccess: notifyAndReload });
  }
  async function endBreakPopup(s) {
    return openKidsResumeBreakModal({ student: s, profile, onSuccess: notifyAndReload });
  }
  async function upgradePackagePopup(s) {
    return openKidsUpgradePackageModal({ student: s, levels, batches, profile, onSuccess: notifyAndReload });
  }

  // ---------- popup: mark completed ----------
  async function completePopup(s) {
    let saving = false;
    const popup = openPopup({
      title: 'Mark Course Completed',
      subtitle: (s.name || 'Student') + ' • ' + (s.studentId || ''),
      icon: 'graduation-cap',
      tone: 'success',
      saving: () => saving
    });
    const c = popup.container;

    const wait = pNote('Loading student records...');
    c.appendChild(wait);
    const bills = await billsFor(s);
    wait.remove();

    const today = todayISO();
    const months = monthsBetween(ymOf(s.admissionDate), ymOf(today));
    const dues = dueOf(bills);

    // Summary stats
    const grid = mk('div', 'pk-info-grid-3');
    [
      ['Enrolled Since', formatDateIN(s.admissionDate) || '-'],
      ['Total Duration', months + ' month' + (months === 1 ? '' : 's')],
      ['Outstanding Dues', formatINR(dues), dues > 0 ? 'pk-info-val pk-dues-has' : 'pk-info-val pk-dues-none']
    ].forEach(([l, v, cls]) => {
      const it = mk('div', 'pk-info-item');
      it.appendChild(mk('div', 'pk-info-label', l));
      it.appendChild(mk('div', cls || 'pk-info-val', v));
      grid.appendChild(it);
    });
    c.appendChild(grid);

    if (dues > 0) {
      const alert = mk('div', 'pk-alert warning');
      alert.innerHTML = `<i data-lucide="alert-triangle"></i><span>Student has ${formatINR(dues)} in unpaid dues. Unpaid bills will remain recorded in ledger.</span>`;
      c.appendChild(alert);
    }

    const dateHost = document.createElement('div');
    const dPicker = createDatePicker(dateHost, { value: todayISO(), ariaLabel: 'Completion date' });
    c.appendChild(pField('Completion date', dateHost, { required: true }));

    const { wrap: remarkWrap, textarea: remarkTa } = pTextarea('Optional remarks or certificate notes...');
    c.appendChild(pField('Completion remarks', remarkWrap));

    const checkWrap = mk('label', 'pk-check-row');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    checkWrap.appendChild(chk);
    checkWrap.appendChild(document.createTextNode(' I verify that this student has completed all course requirements.'));
    c.appendChild(checkWrap);

    const { wrap: confirmWrap, input: idInp } = pTypeConfirm(s.studentId);
    c.appendChild(pField(`Type student ID (${s.studentId || ''}) to confirm`, confirmWrap, { required: true }));

    const { cancelBtn, okBtn, setSaving } = pButtons(popup, 'Complete Course', { icon: 'graduation-cap', tone: 'success' });

    const check = () => {
      okBtn.disabled = saving || !chk.checked || idInp.value.trim() !== String(s.studentId || '');
    };
    chk.addEventListener('change', check);
    idInp.addEventListener('input', check);
    check();

    okBtn.addEventListener('click', async () => {
      saving = true;
      setSaving(true);
      const completionDate = dPicker.value || todayISO();
      const remarks = remarkTa ? remarkTa.value.trim() : '';

      try {
        await updateDoc(doc(db, 'students', s.id), {
          status: 'completed',
          completedAt: serverTimestamp(),
          completionDate,
          completionRemarks: remarks,
          completedBy: (profile && profile.email) || 'admin',
          updatedAt: serverTimestamp()
        });
        showToast({ type: 'success', message: `${s.name || 'Student'} marked as course completed.` });
        popup.close();
        load();
      } catch (err) {
        console.error('[school-admissions] complete failed', err);
        showToast({ type: 'error', message: 'Could not complete: ' + (err.message || 'error') });
        saving = false;
        setSaving(false);
      }
    });
  }

  // ---------- delete / drop student ----------
  async function purgeStudent(s, meta) {
    const refs = [];
    const add = (r) => { if (!refs.some(x => x.path === r.path)) refs.push(r); };
    for (const colName of ['bills', 'payments', 'waivers', 'breaks', 'transfers', 'enrolments']) {
      (await queryByStudent(colName, s)).forEach(d => add(d._ref));
    }
    for (const sub of ['docs', 'payment', 'aadhaar', 'activity']) {
      const snap = await getDocs(collection(db, COL, s.id, sub));
      snap.docs.forEach(d => add(d.ref));
    }
    try {
      await addDoc(collection(db, 'deletionLog'), {
        ctx: 'school', type: meta.mode, studentCode: s.studentId || '', name: s.name || '',
        courseName: courseNameOf(s), reason: meta.reason || '', lastDay: meta.lastDay || '',
        recordsDeleted: refs.length + 1, by: who(), at: serverTimestamp()
      });
    } catch (e) { console.warn('[kids] deletion log not saved (deploy firestore.rules)', e); }
    for (let i = 0; i < refs.length; i += 400) {
      try {
        const wb = writeBatch(db);
        refs.slice(i, i + 400).forEach(r => wb.delete(r));
        await wb.commit();
      } catch (batchErr) {
        console.warn('[kids] batch delete failed, retrying individually with allSettled', batchErr);
        await Promise.allSettled(refs.slice(i, i + 400).map(r => deleteDoc(r)));
      }
    }
    await deleteDoc(doc(db, COL, s.id));
    return refs.length + 1;
  }

  // ---------- popup: drop / delete ----------
  async function removeStudentPopup(s, mode) {
    const isDrop = mode === 'drop';
    let saving = false;
    const popup = openPopup({
      title: isDrop ? 'Drop Student' : 'Delete Permanently',
      subtitle: (s.name || 'Student') + ' • ' + (s.studentId || ''),
      icon: isDrop ? 'user-x' : 'trash-2',
      tone: 'danger',
      saving: () => saving
    });
    const c = popup.container;

    const wait = pNote('Loading student records...');
    c.appendChild(wait);
    const [bills, payments] = await Promise.all([
      billsFor(s),
      queryByStudent('payments', s)
    ]);
    wait.remove();

    if (isDrop) {
      const alert = mk('div', 'pk-alert warning');
      alert.innerHTML = `<i data-lucide="alert-triangle"></i><span>Dropping halts future attendance and billing for <strong>${s.name || 'Student'}</strong>. Historical payment records remain preserved.</span>`;
      c.appendChild(alert);
    } else {
      const alert = mk('div', 'pk-alert danger');
      alert.innerHTML = `<i data-lucide="alert-octagon"></i><span>Permanent deletion removes this student record, all ${bills.length} bills, and ${payments.length} payment receipts. This action cannot be undone.</span>`;
      c.appendChild(alert);
    }

    let reasonTa = null;
    let lastDayPicker = null;

    if (isDrop) {
      const lastDayHost = document.createElement('div');
      lastDayPicker = createDatePicker(lastDayHost, {
        value: todayISO(),
        max: todayISO(),
        ariaLabel: 'Last day of attendance',
        onChange: () => check()
      });
      const fLast = pField('Last day attended', lastDayHost, { required: true });

      const { wrap: reasonWrap, textarea } = pTextarea('Reason for dropping student...');
      reasonTa = textarea;
      const fReason = pField('Reason for dropping', reasonWrap, { required: true });

      c.appendChild(pFieldRow(fLast, fReason));
      reasonTa.addEventListener('input', check);
    }

    const { wrap: confirmWrap, input: idInp } = pTypeConfirm(s.studentId);
    c.appendChild(pField(`Type student ID (${s.studentId || ''}) to confirm`, confirmWrap, { required: true }));

    const { cancelBtn, okBtn, setSaving } = pButtons(popup, isDrop ? 'Drop Student' : 'Delete Permanently', { icon: isDrop ? 'user-x' : 'trash-2', tone: 'danger' });

    const check = () => {
      const idOk = idInp.value.trim() === String(s.studentId || '');
      if (isDrop) {
        const reasonOk = !!(reasonTa && reasonTa.value.trim());
        const dateOk = !!(lastDayPicker && lastDayPicker.value);
        okBtn.disabled = saving || !idOk || !reasonOk || !dateOk;
      } else {
        okBtn.disabled = saving || !idOk;
      }
    };
    idInp.addEventListener('input', check);
    check();

    okBtn.addEventListener('click', async () => {
      if (saving) return;
      saving = true;
      setSaving(true);
      try {
        const lastDayVal = lastDayPicker ? lastDayPicker.value : '';
        const reasonVal = reasonTa ? reasonTa.value.trim() : '';
        const n = await purgeStudent(s, { mode, reason: reasonVal, lastDay: lastDayVal });
        saving = false;
        setSaving(false);
        popup.close(true);
        showToast({ type: 'success', message: `${s.name || 'Student'} ${isDrop ? 'dropped' : 'deleted'}. ${n} records removed.` });
        load();
      } catch (e) {
        console.error('[kids] delete failed', e);
        showToast({ type: 'error', message: 'Operation failed: ' + (e.message || 'error') });
      } finally {
        saving = false;
        setSaving(false);
        check();
      }
    });
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
      admissionDate: v.admissionDate || '', paymentMode: v.paymentMode || 'full', noPaymentReason: v.noPaymentReason || '', noPaymentOther: v.noPaymentOther || '', firstMonthlyMonth: v.firstMonthlyMonth || '', firstMonthlyEarlyConfirmed: !!v.firstMonthlyEarlyConfirmed, documents: DOC_KEYS.map(k => docFiles[k] ? docFiles[k].dataUrl || 'pending' : '')
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
    if (!saving) setState(dirty ? 'Unsaved changes' : (editId ? 'Existing admission � payment unchanged' : 'New admission � not submitted'), dirty ? 'dirty' : '');
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
      feePrior.textContent = priorAdmissionPaid ? formatINR(priorAdmissionPaid) : '�';
      const adj = configured - due;
      feeAdj.textContent = adj > 0 ? ('- ' + formatINR(adj)) : '�';
      feeDue.textContent = formatINR(due);
    }
    monthlyFeeEl.textContent = c ? formatINR(editId ? Number(editRow.monthlyFee ?? monthly) : monthly) : '—';
    if (billingStartSel && !hydrating) {
      const admDateVal = $('adm-admissionDate').value || localToday();
      const feeNum = editId ? Number(editRow.monthlyFee ?? monthly) : monthly;
      billingStartSel.setConfig({
        anchorDate: admDateVal,
        monthlyFee: feeNum,
        paymentMode: editId ? (editRow.paymentMode || 'full') : paymentMode,
        ...(editId ? { value: editRow.firstMonthlyMonth || firstMonthlyMonth(editRow.admissionDate), isLocked: true } : { isLocked: false })
      });
    }

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
      firstMonthlyMonth: billingStartSel ? (billingStartSel.value || '') : '',
      firstMonthlyEarlyConfirmed: billingStartSel ? billingStartSel.getState().earlyConfirmed : true,
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
    DOC_KEYS.forEach(k => { const d=docFiles[k]; if (!d || !d.dataUrl || d.pending) e[k]='Upload a valid '+(k==='photo'?'student photo':"student's signature")+'.'; });
    if (editId && (v.levelId !== editRow.courseId || v.batchId !== editRow.batchId || v.admissionDate !== editRow.admissionDate))
      e.levelId = 'Existing admission level, batch and admission date cannot be rewritten here. A separate upgrade/transfer flow is required.';
    if (v.paymentMode === 'none') {
      if (!v.noPaymentReason) e.noPaymentReason = 'Select a reason for no payment.';
      else if (v.noPaymentReason === 'other' && !v.noPaymentOther) e.noPaymentOther = 'Please specify the reason.';
      else if (!editId && EXISTING_STUDENT_REASONS.includes(v.noPaymentReason)) {
        e.noPaymentReason = 'This reason requires deliberate existing-student selection and the verified upgrade workflow, which is not available for new admissions. Use Full payment, or No payment with waiver / other reason.';
      }
    }
    if (!editId && !['full', 'none'].includes(v.paymentMode)) e.paymentMode = 'Difference requires the separate verified upgrade workflow.';
    if (!Number.isFinite(amountDue) || amountDue < 0) e.paymentMode = 'Invalid configured admission fee.';
    const bSt = billingStartSel ? billingStartSel.getState() : null;
    if (!editId && (!bSt || !bSt.value)) e.firstMonthlyMonth = 'Select first monthly billing month.';
    else if (!editId && Array.isArray(bSt.options) && !bSt.options.includes(bSt.value)) e.firstMonthlyMonth = 'Select next month or the month after next.';
    return e;
  }

  function showErrors(err) {
    ['name', 'guardianName', 'phone', 'altPhone', 'email', 'aadhaar', 'dob', 'gender', 'address', 'schoolClass', 'levelId', 'batchId', 'admissionDate', 'paymentMode', 'noPaymentReason', 'noPaymentOther', 'firstMonthlyMonth', 'photo', 'signature'].forEach((k) => {
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
    if (saving) return;
    submitted = true;
    const v = readForm(), err = validate(v);
    showErrors(err);
    if (Object.keys(err).length) { focusFirstError(err); return; }
    const updating = !!editId, existingId = editId;

    const selCourse = coursesById[v.levelId] || null;
    const configuredAdm = Number(selCourse?.admissionFee ?? 0);
    const previewCharge = updating
      ? Number(editRow?.actualAmountReceived ?? editRow?.admissionFee ?? 0)
      : (v.paymentMode === 'none' ? 0 : (v.paymentMode === 'difference' ? Math.max(0, configuredAdm - priorAdmissionPaid) : configuredAdm));

    let docs = {};
    try {
      for (const k of DOC_KEYS) {
        const df = docFiles[k];
        if (!df || df.pending || !df.dataUrl) throw new Error("Upload both the student photo and student's signature first.");
        if (df.compressedBlob) docs[k] = { type: 'image/jpeg', mime: 'image/jpeg', name: df.file.name, sizeBytes: df.compressedBlob.size, data: df.dataUrl };
      }
    } catch (e) {
      showToast({ type: 'error', message: e.message || 'Check uploaded photo and signature.' });
      return;
    }

    // Warn if an active Kids student already shares phone + level (matches Youth duplicate phone check).
    if (!updating && v.phone) {
      const dup = students.find((s) => (s.status || 'active') === 'active' && s.courseId === v.levelId && s.phone === v.phone);
      if (dup) {
        const okDup = await confirmDialog({
          title: 'Possible duplicate admission',
          message: `Active student "${dup.name || dup.studentId}" (${dup.studentId || '-'}) already uses phone ${v.phone} in this level. Continue anyway?`,
          confirmText: 'Continue',
          cancelText: 'Cancel'
        });
        if (!okDup) return;
      }
    }

    async function executeKidsAdmissionSave(paymentParams = null) {
      const studentRef = updating ? doc(db, COL, existingId) : doc(collection(db, COL));
      const who = profile?.email || '', admissionYear = v.admissionDate.slice(0, 4);
      const payMethod = String(paymentParams?.mode || (previewCharge > 0 ? 'cash' : '')).toLowerCase().trim();
      const payTxnId = (payMethod && payMethod !== 'cash') ? String(paymentParams?.txnId || '').trim() : '';
      const payRemarks = String(paymentParams?.remarks || '').trim();
      const payDate = paymentParams?.paymentDate || v.admissionDate;

      const result = await runTransaction(db, async tx => {
        const courseSnap = await tx.get(doc(db, 'courses', v.levelId));
        const batchSnap = await tx.get(doc(db, 'batches', v.batchId));
        const existing = updating ? await tx.get(studentRef) : null;
        const course = courseSnap.exists() ? { ...courseSnap.data(), id: courseSnap.id } : null;
        const batch = batchSnap.exists() ? { ...batchSnap.data(), id: batchSnap.id } : null;
        if (!course || course.ctx !== 'school' || !isCourseActive(course)) throw new Error('The selected level is no longer active. Select it again.');
        if (!batch || batch.ctx !== 'school' || (batch.status || 'active') !== 'active' || !batchAllowsCourse(batch, course.id, levels)) throw new Error('The batch is no longer eligible. Select another active Kids batch.');
        if (!updating && !['full', 'none'].includes(v.paymentMode)) throw new Error('Difference payments require the verified upgrade workflow.');
        if (!updating && v.paymentMode === 'none' && !v.noPaymentReason) throw new Error('Enter a reason for no payment.');

        const configured = Number(course.admissionFee ?? 0);
        if (!Number.isFinite(configured) || configured < 0) throw new Error('Invalid admission fee configuration.');
        let charge;
        switch (v.paymentMode) {
          case 'full': charge = configured; break;
          case 'difference': charge = Math.max(0, configured - priorAdmissionPaid); break;
          case 'none': charge = 0; break;
          default: charge = configured;
        }
        const old = existing?.exists() ? existing.data() : null;
        if (updating) charge = Number(old?.actualAmountReceived ?? old?.admissionFee ?? 0);
        if (updating && (!old || old.ctx !== 'school')) throw new Error('The admission no longer exists. Reload the page.');
        if (updating && (old.courseId !== v.levelId || old.batchId !== v.batchId || old.admissionDate !== v.admissionDate || Number(old.admissionFee || 0) !== charge)) throw new Error('An existing payment or level cannot be rewritten through student editing.');
        const shown = coursesById[v.levelId];
        if (!updating && (Number(shown?.admissionFee || 0) !== Number(course.admissionFee || 0) || Number(shown?.monthlyFee || 0) !== Number(course.monthlyFee || 0))) throw new Error('Level fees changed. Refresh the page and review the amount before saving.');

        let sid = null, rc = null, centreCode = old?.receiptCentreCode || '';
        if (!updating) {
          const orgSnap = await tx.get(doc(db, 'settings', 'org_config'));
          const configuredCode = String(orgSnap.exists() ? orgSnap.data().receiptCode || '' : '').trim().toUpperCase();
          if (configuredCode && !/^[A-Z0-9]{2,12}$/.test(configuredCode)) {
            throw new Error('The organisation receipt code is invalid. Use 2-12 letters or digits in Organisation settings.');
          }
          centreCode = configuredCode || 'HO';
          sid = await readStudentId(tx, { org: 'school', sessionYear: admissionYear });
          rc = await readReceiptNo(tx, { org: 'school', type: 'AD', branchCode: centreCode, date: v.admissionDate });
        }
        const studentId = updating ? old.studentId : sid.studentId;
        const receiptNo = updating ? old.receiptNo : rc.receiptNo;
        if (!updating) {
          writeCounter(tx, sid.ref, sid.next, { org: 'school', sessionYear: admissionYear });
          writeCounter(tx, rc.ref, rc.next, { org: 'school', type: 'AD', branchCode: centreCode, date: v.admissionDate });
        }
        const bSt = billingStartSel ? billingStartSel.getState() : null;
        const chosenFirstMonthly = updating ? (old.firstMonthlyMonth || firstMonthlyMonth(v.admissionDate)) : (bSt?.value || firstMonthlyMonth(v.admissionDate));
        const defaultFirstMonthly = updating ? (old.defaultFirstMonthlyMonth || firstMonthlyMonth(v.admissionDate)) : (bSt?.defaultValue || firstMonthlyMonth(v.admissionDate));
        const firstMonthlyChanged = updating ? Boolean(old.firstMonthlyChangedFromDefault) : (chosenFirstMonthly !== defaultFirstMonthly);
        const effMode = updating ? (old.mode || old.paymentMethod || (charge > 0 ? 'cash' : '')) : (charge > 0 ? (payMethod || 'cash') : '');
        const effTxn = updating ? (old.txnId || '') : (charge > 0 ? payTxnId : '');
        const effRem = updating ? (old.paymentRemarks || '') : payRemarks;

        const data = {
          studentId, receiptNo, ...(!updating ? { receiptCentreCode: centreCode } : {}),
          name: v.name, guardianName: v.guardianName, phone: v.phone, altPhone: v.altPhone || '', email: v.email || '',
          dob: v.dob, gender: v.gender, address: v.address, schoolClass: v.schoolClass,
          admissionDate: v.admissionDate, firstMonthlyMonth: chosenFirstMonthly, defaultFirstMonthlyMonth: defaultFirstMonthly, firstMonthlyChangedFromDefault: firstMonthlyChanged,
          status: updating ? old.status : 'active', ctx: 'school', branchId: 'HO', branchName: 'Head Office',
          courseId: course.id, courseName: updating ? old.courseName : course.name, courseLevelName: updating ? old.courseLevelName : course.name,
          admissionFee: updating ? Number(old.admissionFee || 0) : charge,
          configuredAdmissionFee: updating ? Number(old.configuredAdmissionFee ?? old.admissionFee ?? 0) : Number(course.admissionFee || 0),
          monthlyFee: updating ? Number(old.monthlyFee || 0) : Number(course.monthlyFee || 0), batchId: batch.id, batchName: updating ? old.batchName : batch.name,
          paymentMode: updating ? (old.paymentMode || 'full') : v.paymentMode,
          ...(effMode ? { mode: effMode, paymentMethod: effMode } : {}),
          txnId: effTxn,
          ...(effRem ? { paymentRemarks: effRem } : {}),
          ...(!updating && charge > 0 ? { paymentDate: payDate } : {}),
          eligiblePriorAdmissionPayments: updating ? Number(old.eligiblePriorAdmissionPayments || 0) : 0,
          finalAdmissionCharge: updating ? Number(old.finalAdmissionCharge ?? charge) : charge,
          actualAmountReceived: charge,
          noPaymentReason: updating ? (old.noPaymentReason || '') : (v.noPaymentReason || ''),
          noPaymentOther: updating ? (old.noPaymentOther || '') : (v.noPaymentOther || ''),
          updatedAt: serverTimestamp(), updatedBy: who
        };
        if (!updating) { data.createdAt = serverTimestamp(); data.createdBy = who; }
        tx.set(studentRef, data, { merge: updating });
        for (const [key, d] of Object.entries(docs)) tx.set(doc(db, COL, studentRef.id, 'docs', key), { ...d, updatedAt: serverTimestamp() });
        tx.set(doc(db, COL, studentRef.id, 'aadhaar', 'aadhaar'), { studentId, aadhaar: v.aadhaar, updatedAt: serverTimestamp() });
        if (!updating) {
          tx.set(doc(db, COL, studentRef.id, 'payment', 'payment'), {
            studentId, receiptNo, receiptCentreCode: centreCode, admissionFee: charge, configuredAdmissionFee: Number(course.admissionFee || 0), monthlyFee: Number(course.monthlyFee || 0),
            receivedTotal: charge, feeReceived: charge > 0, paymentMode: v.paymentMode,
            ...(charge > 0 ? { mode: payMethod || 'cash', paymentMethod: payMethod || 'cash', txnId: payTxnId, receivedDate: payDate } : { mode: '', paymentMethod: '', txnId: '' }),
            ...(payRemarks ? { remarks: payRemarks } : {}),
            eligiblePriorAdmissionPayments: priorAdmissionPaid, actualAmountReceived: charge,
            noPaymentReason: v.noPaymentReason || '', noPaymentOther: v.noPaymentOther || '',
            admissionDate: v.admissionDate, firstMonthlyMonth: chosenFirstMonthly, defaultFirstMonthlyMonth: defaultFirstMonthly, firstMonthlyChangedFromDefault: firstMonthlyChanged,
            createdAt: serverTimestamp(), createdBy: who
          });
        }
        return { id: studentRef.id, studentId, receiptNo, chosenFirstMonthly, monthlyFee: Number(course.monthlyFee || 0), courseId: course.id, courseName: course.name, batchId: batch.id, batchName: batch.name };
      });
      if (!updating) {
        await syncOpenKidsBills(db, {
          students: [{
            id: result.id, studentId: result.studentId, ctx: 'school', status: 'active',
            courseId: result.courseId, courseName: result.courseName, courseLevelName: result.courseName,
            batchId: result.batchId, batchName: result.batchName,
            monthlyFee: result.monthlyFee, admissionDate: v.admissionDate, firstMonthlyMonth: result.chosenFirstMonthly
          }],
          bills: [], breaks: []
        }).catch(() => {});
      }
      window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: updating ? 'student:edit' : 'student:admit' } }));
      return result;
    }

    const selBatch = batches.find((b) => b.id === v.batchId) || null;
    const chosenFirstMonth = v.firstMonthlyMonth || firstMonthlyMonth(v.admissionDate);
    const billingMonthLabel = formatBillingMonth(chosenFirstMonth);

    function openKidsNoPaymentConfirmPopup() {
      const reasonLabel = v.paymentMode === 'none'
        ? formatNoPaymentReason(v.noPaymentReason, v.noPaymentOther)
        : 'Configured level admission fee is \u20B90';
      const monthlyFeeNum = Number(selCourse?.monthlyFee || 0);
      const popup = openPopup({
        title: 'Confirm admission',
        width: '480px',
        onBeforeClose: () => !saving
      });

      const body = mk('div', 'sp-modal-form');
      const summary = mk('div', 'pf-success-summary');
      summary.style.marginBottom = '6px';

      function addConfirmRow(label, value) {
        const row = mk('div', 'pf-success-row');
        const lbl = mk('span', 'pf-success-label', label);
        const val = mk('span', 'pf-success-val');
        if (typeof value === 'string') val.textContent = value;
        else if (value) val.appendChild(value);
        row.append(lbl, val);
        summary.appendChild(row);
      }

      addConfirmRow('Student', mk('span', 'font-semibold', v.name));
      addConfirmRow('Level', selCourse?.name || '-');
      addConfirmRow('Batch', selBatch?.name || '-');
      addConfirmRow('Admission date', formatDateIN(v.admissionDate) || v.admissionDate || '-');
      const feeBadge = mk('span', '', 'Admission fee: \u20B90 (No payment)');
      feeBadge.style.cssText = 'display:inline-block;background:#FFF7ED;border:1px dashed #FB923C;color:#C2410C;padding:2px 9px;border-radius:9px;font-size:12px;font-weight:600;';
      addConfirmRow('Fee status', feeBadge);
      addConfirmRow('Reason', reasonLabel);

      const billingBanner = mk('div');
      billingBanner.style.cssText = 'background:#EEF2FF;border:1px solid #C7D2FE;color:#312E81;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:500;';
      billingBanner.textContent = `Monthly fee ${formatINR(monthlyFeeNum)} will be billed from ${billingMonthLabel}`;

      const footer = mk('div', 'adm-view-foot');
      footer.style.marginTop = '4px';
      const popCancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
      popCancelBtn.type = 'button';
      const popConfirmBtn = mk('button', 'ui-btn primary', 'Confirm admission');
      popConfirmBtn.type = 'button';

      popCancelBtn.onclick = () => {
        if (saving) return;
        popup.close();
      };

      popConfirmBtn.onclick = async () => {
        if (saving) return;
        saving = true;
        refresh();
        popCancelBtn.disabled = true;
        popConfirmBtn.disabled = true;
        popConfirmBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Saving...';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setState('Saving...', 'dirty');
        try {
          const result = await executeKidsAdmissionSave({ mode: '', txnId: '', remarks: '' });
          saved = {};
          clearDirty();
          saving = false;
          popup.close();
          closeForm();
          load({ forceRefresh: false });
          playPaymentSuccessSound();
          showToast({ type: 'success', message: 'Admission saved! Student ID: ' + result.studentId });
          promptKidsAdmissionSuccess({
            studentDocId: result.id,
            studentId: result.studentId,
            studentName: v.name,
            courseName: result.courseName || selCourse?.name || '',
            batchName: result.batchName || selBatch?.name || '',
            receiptNo: result.receiptNo,
            admFeePaid: 0,
            paymentMode: v.paymentMode || 'none',
            noPaymentReasonLabel: reasonLabel,
            monthlyFee: result.monthlyFee ?? monthlyFeeNum,
            firstMonthlyMonthLabel: billingMonthLabel,
            onAdmitAnother: () => openForm(null)
          });
        } catch (e) {
          saving = false;
          popCancelBtn.disabled = false;
          popConfirmBtn.disabled = false;
          popConfirmBtn.textContent = 'Confirm admission';
          refresh();
          setState('Save failed', 'error');
          showToast({ type: 'error', message: e.message || 'Admission could not be saved. Please retry.' });
        }
      };

      footer.append(popCancelBtn, popConfirmBtn);
      body.append(summary, billingBanner, footer);
      popup.container.appendChild(body);
      if (typeof lucide !== 'undefined') lucide.createIcons();
      popConfirmBtn.focus();
    }

    if (!updating && previewCharge > 0) {
      openPaymentPopup({
        student: {
          name: v.name,
          ctx: 'school',
          courseId: selCourse?.id || v.levelId,
          courseCode: selCourse?.code || '',
          courseName: selCourse?.name || '',
          batchId: v.batchId
        },
        pendingAdmission: {
          org: 'school',
          paymentMode: v.paymentMode,
          admFee: previewCharge,
          courseName: selCourse?.name || '',
          batchName: selBatch?.name || '',
          monthlyFee: Number(selCourse?.monthlyFee || 0),
          firstMonthlyMonthLabel: billingMonthLabel,
          onAdmitAnother: () => openForm(null),
          onConfirmPayment: async (pp) => {
            const res = await executeKidsAdmissionSave(pp);
            saved = {};
            clearDirty();
            closeForm();
            load({ forceRefresh: false });
            return res;
          }
        },
        isAdmission: true,
        profile,
        from: 'school-admissions'
      });
      return;
    }

    if (!updating && (v.paymentMode === 'none' || previewCharge === 0)) {
      openKidsNoPaymentConfirmPopup();
      return;
    }

    saving = true; refresh(); saveBtn.disabled = true; cancelBtn.disabled = true; setState('Saving...', 'dirty');
    try {
      const result = await executeKidsAdmissionSave({ mode: '', txnId: '', remarks: '' });
      closeForm();
      showToast({ type: 'success', message: 'Student details updated. Original payment unchanged.' });
      location.hash = '#/school-admissions/' + encodeURIComponent(result.id) + '/receipt';
    } catch (e) {
      if (alive) { saving = false; refresh(); setState('Save failed', 'error'); showToast({ type: 'error', message: e.message || 'Admission could not be saved. Please retry.' }); }
    } finally {
      saving = false;
      if (alive && !form.hidden) refresh();
    }
  });

  $('adm-load-error-retry').addEventListener('click', () => { load(); });
  $('adm-load-error-back').addEventListener('click', () => { location.hash = '#/dashboard'; });
  $('adm-no-match-clear').addEventListener('click', () => {
    tb.state.q = '';
    tb.state.status = 'all';
    tb.state.level = 'all';
    admDateFilter = 'all'; admDateFrom = ''; admDateTo = '';
    dateSel.value = 'all'; dateCustomWrap.hidden = true; fromInp.value = ''; toInp.value = '';
    render();
  });

  try { await load(); } catch (e) { console.error('[school-admissions] init load', e); setError('Could not load admissions.'); }
  form.addEventListener('reset', () => { touched = false; refresh(); });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

