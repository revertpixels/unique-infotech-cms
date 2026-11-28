// school-break-modals.js — Shared UI controls & modals for Unique Kids:
// - Selectable "First monthly billing month" control (Admission + Upgrade)
// - Start Break modal (whole months from next month, unpaid dues warning)
// - Resume / Rejoin modal (rejoin date, early/late return handling)
// - Upgrade / Change Package modal (uses shared billing-start selector)

import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.199';
import { openPopup } from '../components/modal.js?v=1.8.199';
import { openPaymentPopup } from '../components/payment-popup.js?v=1.8.199';
import { createSelect } from '../components/ui-select.js?v=1.8.199';
import { createDatePicker, createMonthPicker } from '../components/ui-datepicker.js?v=1.8.199';
import { formatINR } from '../utils/formatter.js?v=1.8.199';
import { isCourseActive, batchAllowsCourse } from '../utils/session-rules.js?v=1.8.199';
import { resolveUserDisplay } from '../services/user-directory.service.js?v=1.8.199';
import { localToday, monthSeq } from './school-lifecycle.js?v=1.8.199';
import {
  addMonthsYM,
  formatBreakPeriod,
  formatLongMonthYear,
  formatShortMonthYear,
  computeStartBreakRange,
  computeBillingStartBounds,
  computeKidsStudentDues,
  startKidsBreak,
  resumeKidsBreak,
  upgradeKidsPackage,
  isBreakOverdueReturn
} from './school-billing.js?v=1.8.199';

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function pField(label, el, { half = false, required = false } = {}) {
  const w = mk('div', 'ui-field ' + (half ? 'pk-field-half' : 'pk-field-full'));
  const lr = mk('div', 'ui-label-row');
  const lab = mk('label', null, label);
  if (required) lab.appendChild(mk('em', null, ' *'));
  lr.appendChild(lab);
  w.append(lr, el);
  return w;
}

function pFieldRow(f1, f2) {
  const row = mk('div', 'pk-field-row-2');
  row.append(f1, f2);
  return row;
}

function pTextarea(placeholder = '') {
  const wrap = mk('div', 'ui-input-wrap top');
  const ic = document.createElement('i');
  ic.setAttribute('data-lucide', 'file-text');
  const ta = document.createElement('textarea');
  ta.className = 'ui-input';
  ta.rows = 2;
  if (placeholder) ta.placeholder = placeholder;
  wrap.append(ic, ta);
  return { wrap, textarea: ta };
}

function pNote(text) {
  const n = mk('div', 'pk-note');
  const ic = document.createElement('i');
  ic.setAttribute('data-lucide', 'info');
  const sp = mk('span', null, text);
  n.append(ic, sp);
  return n;
}

function pButtons(popup, label, { icon = '', tone = 'default' } = {}) {
  const foot = mk('div', 'adm-view-foot');
  const cancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => popup.close());
  const okBtn = mk('button', 'ui-btn ' + (tone === 'danger' ? 'danger' : (tone === 'success' ? 'success' : 'primary')));
  okBtn.type = 'button';
  okBtn.disabled = true;
  const originalHtml = icon ? `<i data-lucide="${icon}"></i><span>${label}</span>` : `<span>${label}</span>`;
  okBtn.innerHTML = originalHtml;
  foot.append(cancelBtn, okBtn);
  popup.container.appendChild(foot);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  function setSaving(isSaving) {
    if (isSaving) {
      okBtn.disabled = true;
      cancelBtn.disabled = true;
      okBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i><span>Saving...</span>';
    } else {
      okBtn.innerHTML = originalHtml;
      cancelBtn.disabled = false;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  return { cancelBtn, okBtn, setSaving };
}

/**
 * Shared First Monthly Billing Month selector (used on Kids Admission form AND Upgrade modal).
 * Only TWO choices are allowed: next month (+1) or month after next (+2).
 * Default resets whenever paymentMode changes:
 * - full / difference -> month after next (+2)
 * - none -> next month (+1)
 */
export function createBillingStartSelector(host, {
  mode = 'admission',
  anchorDate = localToday(),
  monthlyFee = 0,
  paymentMode = 'full',
  ariaLabel = 'First monthly billing month',
  onChange
} = {}) {
  host.innerHTML = '';
  const pickerHost = mk('div', 'sk-bill-start-picker');
  const previewEl = mk('div', 'sk-bill-start-preview');
  host.append(pickerHost, previewEl);

  let curAnchor = anchorDate;
  let curFee = Number(monthlyFee || 0);
  let curMode = String(paymentMode || 'full').toLowerCase().trim();
  let bounds = computeBillingStartBounds({ anchorDate: curAnchor, paymentMode: curMode, mode });
  let manualOverride = false;
  let locked = false;
  let curValue = bounds.defaultYM;

  function buildOpts(b, extraVal) {
    const opts = [
      { value: b.nextMonthYM, label: `${formatLongMonthYear(b.nextMonthYM)} (Next month)`, icon: 'calendar' },
      { value: b.afterNextMonthYM, label: `${formatLongMonthYear(b.afterNextMonthYM)} (Month after next)`, icon: 'calendar-clock' }
    ];
    if (extraVal && !opts.some((o) => o.value === extraVal)) {
      opts.unshift({ value: extraVal, label: formatLongMonthYear(extraVal), icon: 'calendar' });
    }
    return opts;
  }

  const sel = createSelect(pickerHost, {
    options: buildOpts(bounds),
    value: curValue,
    ariaLabel,
    onChange: (val) => {
      curValue = val || bounds.defaultYM;
      manualOverride = curValue !== bounds.defaultYM;
      syncUI();
      if (onChange) onChange(getState());
    }
  });

  function getState() {
    const val = curValue || bounds.defaultYM;
    return {
      value: val,
      defaultValue: bounds.defaultYM,
      minValue: bounds.minYM,
      maxValue: bounds.maxYM,
      options: bounds.options.slice(),
      anchorMonth: bounds.anchorYM,
      paymentMode: curMode,
      changedFromDefault: val !== bounds.defaultYM,
      needsEarlyConfirm: false,
      earlyConfirmed: true
    };
  }

  function syncUI() {
    const st = getState();
    const feeText = curFee > 0 ? formatINR(curFee) : '₹0';
    if (st.value) {
      previewEl.textContent = `Monthly fee ${feeText} will be billed from ${formatLongMonthYear(st.value)}`;
      if (mode === 'upgrade') {
        const prevM = formatLongMonthYear(addMonthsYM(st.value, -1));
        previewEl.textContent += ` (previous package stops after ${prevM}).`;
      }
    } else {
      previewEl.textContent = 'Select billing start month.';
    }
    const btn = pickerHost.querySelector('.ui-select-btn, button');
    if (btn) btn.disabled = locked;
  }

  syncUI();

  return {
    getState,
    get value() { return curValue; },
    setConfig({ anchorDate: nextAnchor, monthlyFee: nextFee, paymentMode: nextPayMode, value: explicitValue, resetOverride = false, isLocked = false } = {}) {
      const prevMode = curMode;
      if (nextAnchor !== undefined) curAnchor = nextAnchor || localToday();
      if (nextFee !== undefined) curFee = Number(nextFee || 0);
      if (nextPayMode !== undefined) curMode = String(nextPayMode || 'full').toLowerCase().trim();
      locked = !!isLocked;

      const modeChanged = curMode !== prevMode;
      bounds = computeBillingStartBounds({ anchorDate: curAnchor, paymentMode: curMode, mode });

      if (resetOverride || modeChanged) {
        manualOverride = false;
      }

      if (explicitValue !== undefined) {
        curValue = explicitValue || bounds.defaultYM;
        manualOverride = curValue !== bounds.defaultYM;
      } else if (modeChanged || resetOverride || !manualOverride || !bounds.options.includes(curValue)) {
        curValue = bounds.defaultYM;
        manualOverride = false;
      }

      sel.setOptions(buildOpts(bounds, locked ? curValue : ''));
      sel.value = curValue;
      syncUI();
    }
  };
}

/**
 * Shared Start Break popup (Unique Kids only, Super Admin only).
 */
export async function openKidsStartBreakModal({ student, profile, onSuccess } = {}) {
  if (!student || !student.id) return;
  let saving = false;
  const popup = openPopup({
    title: 'Start Student Break',
    subtitle: `${student.name || 'Student'} • ${student.studentId || ''}`,
    icon: 'pause-circle',
    tone: 'amber',
    saving: () => saving
  });
  const c = popup.container;

  const wait = pNote('Checking existing bills & unpaid dues...');
  c.appendChild(wait);

  const keys = [...new Set([student.id, student.studentId].filter(Boolean))];
  const bills = [];
  const breaks = [];
  try {
    for (const k of keys) {
      const [bSnap, brSnap] = await Promise.all([
        getDocs(query(collection(db, 'bills'), where('studentId', '==', k))),
        getDocs(query(collection(db, 'breaks'), where('studentId', '==', k)))
      ]);
      bSnap.docs.forEach((d) => { if (!bills.some((x) => x.id === d.id)) bills.push({ id: d.id, ...d.data() }); });
      brSnap.docs.forEach((d) => { if (!breaks.some((x) => x.id === d.id)) breaks.push({ id: d.id, ...d.data() }); });
    }
  } catch (err) {
    console.warn('[school-break-modals] dues check warning:', err);
  }
  wait.remove();

  const today = localToday();
  const dues = computeKidsStudentDues(student, bills, breaks, today);

  if (dues.totalDue > 0) {
    const dueWarn = mk('div', 'pk-alert warning');
    dueWarn.innerHTML = `<i data-lucide="alert-triangle"></i><span><strong>Unpaid dues warning:</strong> Student has <strong>${formatINR(dues.totalDue)}</strong> pending (${dues.billCount} unpaid bill${dues.billCount === 1 ? '' : 's'}). Existing dues stay payable; you can still start the break.</span>`;
    c.appendChild(dueWarn);
  }

  const ruleRange = computeStartBreakRange({ requestDate: today, today });
  const ruleBanner = mk('div', 'pk-note sk-break-rule-note');
  const ruleIcon = document.createElement('i');
  ruleIcon.setAttribute('data-lucide', 'calendar-check');
  const ruleTxt = mk('span', null, ruleRange.notice);
  ruleBanner.append(ruleIcon, ruleTxt);
  c.appendChild(ruleBanner);

  // Request / Notice Date (mid-month rule helper)
  const reqHost = mk('div');
  const reqPicker = createDatePicker(reqHost, {
    value: today,
    min: today.slice(0, 7) + '-01',
    ariaLabel: 'Break notice date',
    onChange: (dt) => {
      const nextR = computeStartBreakRange({ requestDate: dt || today, today });
      ruleTxt.textContent = nextR.notice;
      if (fromPicker) {
        fromPicker.setMin(nextR.minStartMonth);
        fromPicker.value = nextR.autoStartMonth;
      }
      if (toPicker) {
        const effFrom = fromPicker.value;
        toPicker.setMin(effFrom);
        if (!toPicker.value || toPicker.value < effFrom) toPicker.value = effFrom;
      }
      check();
    }
  });
  c.appendChild(pField('Break notice / effective request date (full current month rule)', reqHost));

  const fromHost = mk('div');
  const toHost = mk('div');
  const fromPicker = createMonthPicker(fromHost, {
    value: ruleRange.autoStartMonth,
    min: ruleRange.minStartMonth,
    ariaLabel: 'Break start month',
    onChange: (fromYM) => {
      if (toPicker) {
        toPicker.setMin(fromYM);
        if (!toPicker.value || toPicker.value < fromYM) toPicker.value = fromYM;
      }
      const prevM = formatLongMonthYear(addMonthsYM(fromYM, -1));
      ruleTxt.textContent = `${prevM} is charged in full; break starts ${formatShortMonthYear(fromYM)} (whole months, ₹0 monthly fee).`;
      check();
    }
  });
  const toPicker = createMonthPicker(toHost, {
    value: ruleRange.autoStartMonth,
    min: ruleRange.autoStartMonth,
    ariaLabel: 'Planned end month',
    onChange: () => check()
  });

  c.appendChild(pFieldRow(
    pField('Break start month (from next month)', fromHost, { half: true, required: true }),
    pField('Planned end month (inclusive)', toHost, { half: true, required: true })
  ));

  const { wrap: reasonWrap, textarea: reasonTa } = pTextarea('Enter reason for student break...');
  c.appendChild(pField('Reason for break', reasonWrap, { required: true }));

  c.appendChild(pNote('Monthly bills will NOT be generated during break months and they will never appear overdue.'));

  const { okBtn, setSaving } = pButtons(popup, 'Start Break', { icon: 'pause-circle', tone: 'primary' });

  const check = () => {
    const fVal = fromPicker.value || '';
    const tVal = toPicker.value || '';
    const rVal = reasonTa.value.trim();
    const minS = ruleRange.minStartMonth;
    okBtn.disabled = saving || !fVal || !tVal || !rVal || fVal < minS || tVal < fVal;
  };
  reasonTa.addEventListener('input', check);
  check();
  if (typeof lucide !== 'undefined') lucide.createIcons();

  okBtn.addEventListener('click', async () => {
    saving = true;
    setSaving(true);
    try {
      const who = (profile && profile.email) || 'admin';
      const disp = resolveUserDisplay(who, profile?.name, profile?.designation);
      await startKidsBreak({
        db,
        student,
        startMonth: fromPicker.value,
        plannedEndMonth: toPicker.value,
        reason: reasonTa.value.trim(),
        actorEmail: who,
        actorName: disp.name || profile?.name || '',
        actorDesignation: disp.designation || profile?.designation || '',
        asOfDate: today
      });
      showToast({ type: 'success', message: `Break recorded for ${student.name || 'Student'} (${formatBreakPeriod(fromPicker.value, toPicker.value)}).` });
      window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'break:start' } }));
      popup.close(true);
      if (onSuccess) await onSuccess();
    } catch (err) {
      console.error('[school-break-modals] startBreak failed', err);
      showToast({ type: 'error', message: err.message || 'Could not start break.' });
      saving = false;
      setSaving(false);
    }
  });
}

/**
 * Shared Resume / Rejoin popup (Unique Kids only, Super Admin only).
 */
export async function openKidsResumeBreakModal({ student, breakDoc = null, profile, onSuccess } = {}) {
  if (!student || !student.id) return;
  let saving = false;
  const popup = openPopup({
    title: 'Resume / Rejoin Student',
    subtitle: `${student.name || 'Student'} • ${student.studentId || ''}`,
    icon: 'play-circle',
    tone: 'default',
    saving: () => saving
  });
  const c = popup.container;

  const startYM = breakDoc?.startMonth || student.breakFrom || '';
  const plannedEndYM = breakDoc?.plannedEndMonth || breakDoc?.endMonth || student.breakTo || '';
  const reason = breakDoc?.reason || student.breakReason || 'No reason specified';
  const today = localToday();

  const curRow = mk('div', 'pk-badge-row');
  const curBadge = mk('div', 'pk-current-badge');
  curBadge.innerHTML = `Break Period: <strong>${formatBreakPeriod(startYM, plannedEndYM)}</strong> — ${reason}`;
  curRow.appendChild(curBadge);
  c.appendChild(curRow);

  if (isBreakOverdueReturn(breakDoc || student, today)) {
    const overdueAlert = mk('div', 'pk-alert warning');
    overdueAlert.innerHTML = `<i data-lucide="clock"></i><span><strong>Planned break ended:</strong> Months while away stayed unbilled. Monthly billing will resume in full from the rejoin month.</span>`;
    c.appendChild(overdueAlert);
  }

  const previewNote = pNote('');
  const previewSpan = previewNote.querySelector('span');

  const dateHost = mk('div');
  const dPicker = createDatePicker(dateHost, {
    value: today,
    ariaLabel: 'Rejoin date',
    onChange: (val) => syncPreview(val)
  });

  function syncPreview(val) {
    const dt = val || today;
    const rejoinYM = dt.slice(0, 7);
    const rLabel = formatLongMonthYear(rejoinYM);
    if (plannedEndYM && monthSeq(rejoinYM) <= monthSeq(plannedEndYM)) {
      previewSpan.textContent = `Early return: remaining planned break months are cancelled. ${rLabel} will be billed in FULL.`;
    } else {
      previewSpan.textContent = `Normal billing continues in FULL from ${rLabel}.`;
    }
  }
  syncPreview(today);

  c.appendChild(pField('Rejoin date', dateHost, { required: true }));
  c.appendChild(previewNote);

  const { okBtn, setSaving } = pButtons(popup, 'Resume / Rejoin', { icon: 'play-circle', tone: 'primary' });
  okBtn.disabled = false;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  okBtn.addEventListener('click', async () => {
    saving = true;
    setSaving(true);
    try {
      const returnDate = dPicker.value || today;
      const who = (profile && profile.email) || 'admin';
      const disp = resolveUserDisplay(who, profile?.name, profile?.designation);
      await resumeKidsBreak({
        db,
        student,
        breakDoc,
        returnDate,
        actorEmail: who,
        actorName: disp.name || profile?.name || '',
        actorDesignation: disp.designation || profile?.designation || '',
        asOfDate: today
      });
      showToast({ type: 'success', message: `${student.name || 'Student'} rejoined (billing from ${formatShortMonthYear(returnDate.slice(0, 7))}).` });
      window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'break:resume' } }));
      popup.close(true);
      if (onSuccess) await onSuccess();
    } catch (err) {
      console.error('[school-break-modals] resumeBreak failed', err);
      showToast({ type: 'error', message: err.message || 'Could not resume student.' });
      saving = false;
      setSaving(false);
    }
  });
}

/**
 * Shared Course Upgrade / Package Change modal (uses the exact same First monthly billing month selector).
 */
export async function openKidsUpgradePackageModal({ student, levels = [], batches = [], profile, onSuccess, draft = null } = {}) {
  if (!student || !student.id) return;
  let saving = false;
  const today = localToday();

  const popup = openPopup({
    title: 'Upgrade Course / Change Package',
    subtitle: `${student.name || 'Student'} • ${student.studentId || ''}`,
    icon: 'trending-up',
    tone: 'default',
    wide: true,
    saving: () => saving
  });
  const c = popup.container;

  // Load metadata if omitted
  let useLevels = levels.filter((l) => (l.ctx === 'school') && isCourseActive(l));
  let useBatches = batches.filter((b) => (b.ctx === 'school') && (b.status || 'active') === 'active');
  if (!useLevels.length || !useBatches.length) {
    const [cSnap, bSnap] = await Promise.all([
      getDocs(query(collection(db, 'courses'), where('ctx', '==', 'school'))),
      getDocs(query(collection(db, 'batches'), where('ctx', '==', 'school')))
    ]);
    useLevels = cSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => isCourseActive(l));
    useBatches = bSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => (b.status || 'active') === 'active');
  }

  const prevPaid = Number(student.actualAmountReceived ?? student.admissionFee ?? 0);
  const curBadge = mk('div', 'pk-current-badge');
  curBadge.innerHTML = `Current Level: <strong>${student.courseName || '-'}</strong> (${formatINR(Number(student.monthlyFee || 0))}/mo) · Prior Admission Paid: <strong>${formatINR(prevPaid)}</strong>`;
  const badgeRow = mk('div', 'pk-badge-row');
  badgeRow.appendChild(curBadge);
  c.appendChild(badgeRow);

  const lvlHost = mk('div');
  const batHost = mk('div');
  const lvlOpts = [{ value: '', label: 'Select new level / package', icon: 'book-open' }].concat(
    useLevels.map((l) => ({
      value: l.id,
      label: `${l.name || l.id} (${formatINR(Number(l.monthlyFee || 0))}/mo)`,
      icon: 'book-open'
    }))
  );

  let selectedLevelId = draft?.levelId || '';
  let selectedBatchId = draft?.batchId || '';
  let paymentMode = draft?.paymentMode || 'difference';

  function buildBatchOptionsForLevel(levelId) {
    const cr = useLevels.find((l) => l.id === levelId) || null;
    const bOpts = [{ value: '', label: 'Select destination batch', icon: 'layers' }];
    if (cr) {
      useBatches.filter((b) => batchAllowsCourse(b, cr.id, useLevels)).forEach((b) => {
        bOpts.push({ value: b.id, label: b.name || b.id, icon: 'layers' });
      });
    }
    return bOpts;
  }

  const initialBatchOpts = buildBatchOptionsForLevel(selectedLevelId);
  if (selectedBatchId && !initialBatchOpts.some((o) => o.value === selectedBatchId)) {
    selectedBatchId = '';
  }

  const batchSel = createSelect(batHost, {
    options: initialBatchOpts,
    value: selectedBatchId,
    ariaLabel: 'New batch',
    onChange: (v) => { selectedBatchId = v; check(); }
  });

  const levelSel = createSelect(lvlHost, {
    options: lvlOpts,
    value: selectedLevelId,
    ariaLabel: 'New level',
    onChange: (v) => {
      selectedLevelId = v;
      const cr = useLevels.find((l) => l.id === v) || null;
      const bOpts = buildBatchOptionsForLevel(v);
      batchSel.setOptions(bOpts);
      if (cr && student.batchId && bOpts.some((o) => o.value === student.batchId)) {
        selectedBatchId = student.batchId;
        batchSel.value = student.batchId;
      } else {
        selectedBatchId = '';
        batchSel.value = '';
      }
      syncBillingAndFee();
      check();
    }
  });

  c.appendChild(pFieldRow(
    pField('New level / package', lvlHost, { half: true, required: true }),
    pField('New batch', batHost, { half: true, required: true })
  ));

  const modeHost = mk('div');
  const feeSummaryEl = pNote('');
  const feeSummaryTxt = feeSummaryEl.querySelector('span');
  createSelect(modeHost, {
    options: [
      { value: 'difference', label: 'Difference payment (new admission - prior paid)', icon: 'credit-card' },
      { value: 'none', label: 'No admission payment (upgraded student)', icon: 'shield-off' },
      { value: 'full', label: 'Full admission fee', icon: 'banknote' }
    ],
    value: paymentMode,
    ariaLabel: 'Admission fee option',
    onChange: (v) => { paymentMode = v; syncBillingAndFee(); check(); }
  });
  c.appendChild(pField('Upgrade admission fee option', modeHost, { required: true }));
  c.appendChild(feeSummaryEl);

  const startHost = mk('div');
  const billingSelector = createBillingStartSelector(startHost, {
    mode: 'upgrade',
    anchorDate: today,
    monthlyFee: 0,
    paymentMode,
    ariaLabel: 'New package billing starts from',
    onChange: () => check()
  });
  c.appendChild(pField('First monthly billing month (New package)', startHost, { required: true }));

  const { okBtn, setSaving } = pButtons(popup, 'Upgrade Package', { icon: 'trending-up', tone: 'primary' });

  function calcCharge() {
    const cr = useLevels.find((l) => l.id === selectedLevelId);
    if (!cr) return 0;
    const cfg = Number(cr.admissionFee || 0);
    if (paymentMode === 'none') return 0;
    if (paymentMode === 'full') return cfg;
    return Math.max(0, cfg - prevPaid);
  }

  function syncBillingAndFee(explicitBillingStart) {
    const cr = useLevels.find((l) => l.id === selectedLevelId) || null;
    const chg = calcCharge();
    feeSummaryTxt.textContent = cr
      ? `New admission fee: ${formatINR(Number(cr.admissionFee || 0))} · Upgrade amount due now: ${formatINR(chg)}`
      : 'Select a new level to preview upgrade charges and monthly fee.';
    billingSelector.setConfig({
      anchorDate: today,
      monthlyFee: cr ? Number(cr.monthlyFee || 0) : 0,
      paymentMode,
      ...(explicitBillingStart !== undefined ? { value: explicitBillingStart } : {})
    });
  }

  function check() {
    const st = billingSelector.getState();
    okBtn.disabled = saving || !selectedLevelId || !selectedBatchId || !st.value;
  }

  syncBillingAndFee(draft?.billingStartMonth);
  check();
  if (typeof lucide !== 'undefined') lucide.createIcons();

  okBtn.addEventListener('click', async () => {
    const cr = useLevels.find((l) => l.id === selectedLevelId);
    const br = useBatches.find((b) => b.id === selectedBatchId);
    if (!cr || !br) return;
    const st = billingSelector.getState();
    const chg = calcCharge();
    const who = (profile && profile.email) || 'admin';
    const disp = resolveUserDisplay(who, profile?.name, profile?.designation);

    if (chg > 0) {
      const savedDraft = {
        levelId: selectedLevelId,
        batchId: selectedBatchId,
        paymentMode,
        billingStartMonth: st.value
      };
      popup.close(true);
      openPaymentPopup({
        student: { ...student, ctx: 'school', courseCode: cr.code || cr.courseCode || '', courseName: cr.name || cr.id },
        pendingAdmission: {
          org: 'school',
          isUpgrade: true,
          paymentMode,
          admFee: chg,
          courseName: cr.name || cr.id,
          onConfirmPayment: async (pp) => {
            const upgRes = await upgradeKidsPackage({
              db,
              student,
              newCourse: cr,
              newBatch: br,
              billingStartMonth: st.value,
              defaultStartMonth: st.defaultValue,
              paymentMode,
              diffCharge: chg,
              mode: pp.mode,
              txnId: pp.txnId,
              remarks: pp.remarks,
              actorEmail: who,
              actorName: disp.name || profile?.name || '',
              actorDesignation: disp.designation || profile?.designation || '',
              actorRole: profile?.role || '',
              paidDate: pp.paymentDate || today,
              asOfDate: today
            });
            window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'student:upgrade' } }));
            return upgRes;
          }
        },
        isAdmission: true,
        profile,
        from: 'profile',
        onSuccess: async () => {
          if (onSuccess) await onSuccess();
        },
        onCancel: () => {
          openKidsUpgradePackageModal({ student, levels: useLevels, batches: useBatches, profile, onSuccess, draft: savedDraft });
        }
      });
      return;
    }

    saving = true;
    setSaving(true);
    try {
      await upgradeKidsPackage({
        db,
        student,
        newCourse: cr,
        newBatch: br,
        billingStartMonth: st.value,
        defaultStartMonth: st.defaultValue,
        paymentMode,
        diffCharge: 0,
        actorEmail: who,
        actorName: disp.name || profile?.name || '',
        actorDesignation: disp.designation || profile?.designation || '',
        actorRole: profile?.role || '',
        paidDate: today,
        asOfDate: today
      });
      showToast({ type: 'success', message: `Upgraded to ${cr.name || cr.id}; new fee starts ${formatShortMonthYear(st.value)}.` });
      window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason: 'student:upgrade' } }));
      popup.close(true);
      if (onSuccess) await onSuccess();
    } catch (err) {
      console.error('[school-break-modals] upgrade failed', err);
      showToast({ type: 'error', message: err.message || 'Could not upgrade package.' });
      saving = false;
      setSaving(false);
    }
  });
}
