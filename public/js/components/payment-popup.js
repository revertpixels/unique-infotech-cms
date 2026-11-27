// payment-popup.js — Single Shared Payment Popup for Student Profile and Pay Fees
import { auth } from '../config/firebase-config.js';
import { openPopup } from './modal.js?v=1.8.184';
import { createSelect } from './ui-select.js?v=1.8.184';
import { formatINR, formatDateIN } from '../utils/formatter.js?v=1.8.184';
import { todayISO } from '../utils/session-rules.js?v=1.8.184';
import { getRoleTitle, resolveUserDisplay } from '../services/user-directory.service.js?v=1.8.184';
import { showToast } from './toast.js?v=1.8.184';
import { playPaymentSuccessSound } from '../utils/sound.js?v=1.8.184';
import {
  recordPayment,
  recordAdmissionWithPayment,
  fetchStudentPayments,
  calculateLateFee,
  isInstallmentPaid,
  isAdmissionFeePaid,
  isMaterialFeePaid,
  isExamFeePaid
} from '../services/payment.service.js?v=1.8.184';

function formatDateTime(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return '-';
  const day = String(dt.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[dt.getMonth()];
  const year = dt.getFullYear();
  let hours = dt.getHours();
  const minutes = String(dt.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
}

/**
 * Redesigned "Payment recorded" modal dialog with Open receipt, Print, Done actions.
 */
export function promptOpenReceipt({
  studentDocId,
  paymentId,
  receiptNo,
  student,
  forText,
  amount,
  lateFee,
  totalPaid,
  mode,
  txnId,
  date,
  from = 'pay-fees'
}) {
  const prevFocus = document.activeElement;

  const back = document.createElement('div');
  back.className = 'ui-modal-back pf-success-back';

  const modal = document.createElement('div');
  modal.className = 'ui-modal pf-success-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    back.remove();
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch (_) {}
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  document.addEventListener('keydown', onKey);

  // Close X button in top right
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'pf-success-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = '<i data-lucide="x"></i>';
  closeBtn.onclick = () => close();

  // Green check icon with subtle emerald halo
  const iconWrap = document.createElement('div');
  iconWrap.className = 'pf-success-icon-wrap';
  iconWrap.innerHTML = '<i data-lucide="check"></i>';

  const title = document.createElement('h3');
  title.className = 'pf-success-title';
  title.textContent = 'Payment Recorded!';

  const subtitle = document.createElement('p');
  subtitle.className = 'pf-success-subtitle';
  subtitle.textContent = 'Receipt generated & student ledger updated.';

  // Summary box
  const summary = document.createElement('div');
  summary.className = 'pf-success-summary';

  function addRow(label, valueHtml) {
    const row = document.createElement('div');
    row.className = 'pf-success-row';
    const lbl = document.createElement('span');
    lbl.className = 'pf-success-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'pf-success-val';
    val.innerHTML = valueHtml;
    row.append(lbl, val);
    summary.appendChild(row);
  }

  const stName = student?.name || 'Student';
  const stId = student?.studentId || '';
  const modeVal = (mode || 'Cash').toUpperCase();
  const modeClass = (mode || 'cash').toLowerCase();

  // Receipt No with monospace badge
  addRow(
    'Receipt No.',
    `<span style="font-family:monospace; font-weight:700; color:#3730A3; background:#EEF2FF; border:1px solid #E0E7FF; padding:2px 8px; border-radius:6px; font-size:12px;">${receiptNo || '—'}</span>`
  );

  // Student name and ID
  addRow(
    'Student',
    `<span class="font-semibold">${stName}</span>${stId ? ` <span style="font-weight:400; color:var(--text-mute, #64748b); font-size:12px;">(${stId})</span>` : ''}`
  );

  // For / Fee Head
  addRow('Fee Head', forText || 'Fee payment');

  // Scheduled amount
  addRow('Amount', `<span class="font-semibold">${formatINR(amount)}</span>`);

  // Late fee (if any)
  if (lateFee > 0) {
    addRow('Late Fee', `<span style="color:var(--danger, #dc2626); font-weight:600;">+ ${formatINR(lateFee)}</span>`);
  }

  // Payment Mode
  addRow(
    'Payment Mode',
    `<span class="la-mode ${modeClass}">${modeVal}</span>${txnId ? ` <span style="font-size:11.5px; color:var(--text-mute, #64748b); font-family:monospace;">(${txnId})</span>` : ''}`
  );

  // Date & Time
  addRow('Date & Time', `<span style="color:var(--text-mute, #64748b); font-size:12px;">${formatDateTime(date || new Date())}</span>`);

  // Divider
  const divider = document.createElement('div');
  divider.style.borderTop = '1px dashed var(--border, #cbd5e1)';
  divider.style.margin = '4px 0 2px';
  summary.appendChild(divider);

  // Total Paid
  const totalRow = document.createElement('div');
  totalRow.className = 'pf-success-row is-total-row';
  totalRow.style.alignItems = 'baseline';
  const totalLbl = document.createElement('span');
  totalLbl.className = 'pf-success-label';
  totalLbl.style.fontSize = '14px';
  totalLbl.style.fontWeight = '700';
  totalLbl.style.color = 'var(--text, #0f172a)';
  totalLbl.textContent = 'Total Paid';
  const totalVal = document.createElement('span');
  totalVal.className = 'pf-success-val is-total';
  totalVal.style.fontSize = '18px';
  totalVal.style.fontWeight = '800';
  totalVal.style.color = 'var(--success, #16a34a)';
  totalVal.textContent = formatINR(totalPaid);
  totalRow.append(totalLbl, totalVal);
  summary.appendChild(totalRow);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'pf-success-actions';

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'ui-btn primary';
  openBtn.style.flex = '1.2';
  openBtn.innerHTML = '<i data-lucide="receipt"></i><span>Open Receipt</span>';
  openBtn.onclick = () => {
    close();
    if (from === 'admissions') {
      location.hash = `#/admissions/${studentDocId}/receipt`;
    } else {
      location.hash = `#/payments/${studentDocId}/${paymentId}/receipt?from=${from}`;
    }
  };

  const printBtn = document.createElement('button');
  printBtn.type = 'button';
  printBtn.className = 'ui-btn ghost';
  printBtn.style.flex = '0.9';
  printBtn.innerHTML = '<i data-lucide="printer"></i><span>Print</span>';
  printBtn.onclick = () => {
    close();
    if (from === 'admissions') {
      location.hash = `#/admissions/${studentDocId}/receipt?print=1`;
    } else {
      location.hash = `#/payments/${studentDocId}/${paymentId}/receipt?from=${from}&print=1`;
    }
  };

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'ui-btn ghost';
  doneBtn.style.flex = '0.8';
  doneBtn.textContent = 'Done';
  doneBtn.onclick = () => {
    close();
  };

  actions.append(openBtn, printBtn, doneBtn);

  modal.append(closeBtn, iconWrap, title, subtitle, summary, actions);
  back.appendChild(modal);
  document.body.appendChild(back);

  if (typeof lucide !== 'undefined') lucide.createIcons();
  openBtn.focus();
}

/**
 * Opens the single shared Record / Collect Payment popup.
 *
 * Rules:
 * - Super Admin: waive checkbox is ALWAYS rendered in DOM.
 *   - If late fine == 0: disabled = true (greyed, cannot tick).
 *   - If late fine > 0: disabled = false. If ticked, reason box is required and fine becomes 0.
 * - Branch Head: waive checkbox and reason box are NOT rendered in DOM at all.
 * - Payment fields read-only for EVERYONE:
 *   - Date is fixed to todayISO(), cannot be edited.
 *   - Amount, late fine, scheduled items are display-only.
 *   - Full due amount must be paid.
 */
export async function openPaymentPopup({
  student,
  pendingAdmission,
  isAdmission = false,
  profile,
  preselectedOption,
  sessionsCache,
  activeSession,
  payments,
  from = 'pay-fees',
  onSuccess
}) {
  const s = student;
  if (!s) return;
  const isSuper = profile?.role === 'superadmin';
  const sched = Array.isArray(s.feeSchedule) ? s.feeSchedule : [];
  const snap = s?.feeSnapshot || {};
  const admFee = Number(snap.admission ?? s?.admissionFee ?? s?.dueAtAdmission?.admission ?? 0);
  const instFee = Number(snap.installment ?? s?.feeSnapshot?.installment ?? 0);
  const matFee = Number(snap.material ?? s?.materialFee ?? s?.studyMaterialFee ?? 0);
  const examFee = Number(snap.exam ?? s?.examFee ?? 0);

  const typeOptions = [];

  if (isAdmission || pendingAdmission) {
    const pa = pendingAdmission || {};
    if (pa.isFull || s.paymentPlan === 'full') {
      const fullAmt = Number(pa.fullAmt || s.fullPaymentAmount || s.dueAtAdmission?.full || s.feeTotal || 0);
      const actualMatFee = Number(pa.matFee ?? s.dueAtAdmission?.material ?? matFee ?? 0);
      const totalFullCollection = fullAmt + actualMatFee;
      const matLabel = actualMatFee > 0 ? ` + Study Material (Rs ${formatINR(actualMatFee)})` : '';
      typeOptions.push({
        value: 'FULL',
        label: `Course Fee (Paid in Full: Rs ${formatINR(fullAmt)})${matLabel} — Total Rs ${formatINR(totalFullCollection)}`,
        icon: 'award'
      });
    } else {
      const admTotal = Number(pa.admFee ?? admFee) + Number(pa.matFee ?? matFee);
      const isWithMat = Number(pa.matFee ?? matFee) > 0;
      typeOptions.push({
        value: 'AD',
        label: `${isWithMat ? 'Admission & Material Fee' : 'Admission Fee'} — Rs ${formatINR(admTotal)}`,
        icon: 'credit-card'
      });
    }
  } else {
    // Use provided payments or refresh fresh from Firestore
    let paymentsList = Array.isArray(payments) ? payments : [];
    try {
      const fresh = await fetchStudentPayments(s.id);
      if (fresh && Array.isArray(fresh)) {
        paymentsList = fresh;
      }
    } catch (_) {}

    // 0. Course Fee Paid in Full (if full payment plan and not yet paid)
    if (s.paymentPlan === 'full' && !s.fullPaid) {
      const fullAmt = Number(s.fullPaymentAmount || s.feeTotal || 0);
      typeOptions.push({
        value: 'FULL',
        label: `Course Fee (Paid in Full) — ${formatINR(fullAmt)}`,
        icon: 'award'
      });
    }

    // 1. Admission Fee (only if not full-payment plan, not yet collected, and amount > 0)
    if (s.paymentPlan !== 'full' && admFee > 0 && !isAdmissionFeePaid(admFee, paymentsList, s)) {
      typeOptions.push({
        value: 'AD',
        label: `Admission Fee — ${formatINR(admFee)}`,
        icon: 'credit-card'
      });
    }

    // 2. Study Material Fee (only if not full-payment plan, not yet collected, and amount > 0)
    if (s.paymentPlan !== 'full' && matFee > 0 && !isMaterialFeePaid(matFee, paymentsList, s)) {
      typeOptions.push({
        value: 'MAT',
        label: `Study Material Fee — ${formatINR(matFee)}`,
        icon: 'book-open'
      });
    }

    // 3. Installments (1..N) (only for installments plan)
    if (s.paymentPlan !== 'full') {
      sched.forEach((it) => {
        const itNo = Number(it.no ?? it.installmentNo);
        if (!isInstallmentPaid(it, paymentsList, s)) {
          typeOptions.push({
            value: 'IN_' + itNo,
            label: `Installment ${itNo} (${it.month || 'Month ' + itNo}) — ${formatINR(it.amount || instFee)}`,
            icon: 'credit-card',
            schedItem: it
          });
        }
      });
    }

    // 4. Examination Fee (only if not yet collected and amount > 0, and not blocked by session fees)
    let sessionExamFee = examFee;
    let canCollectExam = examFee > 0;
    if (s.ctx === 'youth') {
      let studentSess = activeSession || null;
      if (!studentSess && sessionsCache) {
        studentSess = sessionsCache.byId?.[s.sessionId] || sessionsCache.byName?.[(s.sessionName || '').toLowerCase().trim()] || null;
      }
      if (studentSess && studentSess.examFeeCollection?.started === true) {
        if (studentSess.examFeeCollection.fees && s.courseId && Object.prototype.hasOwnProperty.call(studentSess.examFeeCollection.fees, s.courseId)) {
          sessionExamFee = Number(studentSess.examFeeCollection.fees[s.courseId]);
        } else {
          canCollectExam = false;
        }
      }
    }

    if (canCollectExam && sessionExamFee > 0 && !isExamFeePaid(sessionExamFee, paymentsList, s)) {
      typeOptions.push({
        value: 'EX',
        label: `Examination Fee — ${formatINR(sessionExamFee)}`,
        icon: 'award'
      });
    }

    if (preselectedOption === 'EX' && !canCollectExam) {
      showToast({ type: 'error', message: `Exam fee not set for this course in this session. Contact ${getRoleTitle('superadmin')}.` });
      return;
    }
  }

  if (typeOptions.length === 0) {
    showToast({ type: 'info', message: 'All scheduled fees for this student have already been collected.' });
    return;
  }

  let initialTypeVal = typeOptions[0]?.value;
  if (preselectedOption) {
    let targetVal = '';
    if (preselectedOption === 'FULL') targetVal = 'FULL';
    else if (preselectedOption === 'AD') targetVal = 'AD';
    else if (preselectedOption === 'MAT') targetVal = 'MAT';
    else if (preselectedOption === 'EX') targetVal = 'EX';
    else if (String(preselectedOption).startsWith('IN_')) targetVal = String(preselectedOption);
    else targetVal = 'IN_' + preselectedOption;

    const found = typeOptions.find(o => o.value === targetVal);
    if (found) {
      initialTypeVal = found.value;
    } else {
      showToast({ type: 'info', message: 'Selected fee item has already been collected.' });
    }
  }

  const courseCodeOrName = s.courseCode || s.courseName || pendingAdmission?.courseCode || pendingAdmission?.courseName || pendingAdmission?.studentData?.courseCode || pendingAdmission?.studentData?.courseName || '';
  const studentSubtitle = (isAdmission || pendingAdmission)
    ? `${s.name || 'New Student'} • ${courseCodeOrName || 'Admission'}`
    : `${s.name || 'Student'} • ${s.studentId || s.id || courseCodeOrName || 'Student'}`;

  const popup = openPopup({
    title: (isAdmission || pendingAdmission) ? 'Collect Admission Fee' : 'Record Payment',
    subtitle: studentSubtitle,
    icon: 'wallet',
    wide: true
  });

  const form = document.createElement('form');
  form.className = 'sp-modal-form';
  form.onsubmit = (e) => e.preventDefault();

  // Payment Type
  const typeGroup = document.createElement('div');
  typeGroup.className = 'ui-field';
  const typeLabelRow = document.createElement('div');
  typeLabelRow.className = 'ui-label-row';
  const typeLbl = document.createElement('label');
  typeLbl.className = 'ui-label';
  typeLbl.textContent = 'Payment Type ';
  const typeEm = document.createElement('em');
  typeEm.textContent = '*';
  typeLbl.appendChild(typeEm);
  typeLabelRow.appendChild(typeLbl);

  const typeHost = document.createElement('div');
  typeGroup.append(typeLabelRow, typeHost);

  const typeSel = createSelect(typeHost, {
    options: typeOptions,
    value: initialTypeVal,
    ariaLabel: 'Payment Type',
    onChange: () => recalculate()
  });

  // Summary box
  const infoBox = document.createElement('div');
  infoBox.className = 'sp-pay-summary-box';

  const cellSched = document.createElement('div');
  cellSched.className = 'sp-stat-col';
  cellSched.innerHTML = '<span class="sp-kv-label">Scheduled Fee</span><span class="sp-stat-val">Rs 0.00</span>';
  const baseValEl = cellSched.querySelector('.sp-stat-val');

  const cellFine = document.createElement('div');
  cellFine.className = 'sp-stat-col';
  cellFine.innerHTML = '<span class="sp-kv-label">Late Fine</span><span class="sp-stat-val">Rs 0.00</span>';
  const fineValEl = cellFine.querySelector('.sp-stat-val');

  const cellTotal = document.createElement('div');
  cellTotal.className = 'sp-stat-col';
  cellTotal.innerHTML = '<span class="sp-kv-label">Total Payable</span><span class="sp-stat-val" style="font-weight:600;">Rs 0.00</span>';
  const totalValEl = cellTotal.querySelector('.sp-stat-val');

  infoBox.append(cellSched, cellFine, cellTotal);

  const amtInput = document.createElement('input');
  amtInput.type = 'hidden';
  const lateInput = document.createElement('input');
  lateInput.type = 'hidden';

  // Waive late fee option:
  // - Super Admin: Box is visible ONLY when late fine > 0. If fine == 0, hidden completely.
  //   When checked, reason dropdown is displayed and fine is waived (total drops).
  // - Branch Head: NOT rendered at all (omitted from DOM).
  let waiveGroup = null;
  let waiveCheckbox = null;
  let reasonSel = null;
  let rOtherInput = null;
  let rOtherWrap = null;
  let reasonWrap = null;
  let checkLabel = null;
  let checkText = null;

  function getWaiverReason() {
    if (!waiveCheckbox || !waiveCheckbox.checked) return '';
    const selVal = reasonSel?.value || '';
    if (selVal === 'Other Reason') {
      return rOtherInput?.value.trim() || '';
    }
    return selVal;
  }

  if (isSuper) {
    waiveGroup = document.createElement('div');
    waiveGroup.style.background = 'var(--warning-soft, #fffbeb)';
    waiveGroup.style.padding = '10px 14px';
    waiveGroup.style.borderRadius = 'var(--r, 8px)';
    waiveGroup.style.border = '1px solid color-mix(in srgb, var(--warning, #f59e0b) 35%, transparent)';
    waiveGroup.style.margin = '0';
    waiveGroup.style.marginTop = '-4px';
    waiveGroup.style.transition = 'background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease';
    waiveGroup.hidden = true; // Hidden unless late fine > 0

    checkLabel = document.createElement('label');
    checkLabel.className = 'pk-check-row';
    checkLabel.style.margin = '0';
    checkLabel.style.display = 'flex';
    checkLabel.style.alignItems = 'center';
    checkLabel.style.gap = '8px';
    checkLabel.style.cursor = 'pointer';

    waiveCheckbox = document.createElement('input');
    waiveCheckbox.type = 'checkbox';

    checkText = document.createElement('span');
    checkText.className = 'font-semibold';
    checkText.style.fontSize = '13px';
    checkText.textContent = 'Waive late fee fine';

    checkLabel.append(waiveCheckbox, checkText);

    reasonWrap = document.createElement('div');
    reasonWrap.className = 'ui-field';
    reasonWrap.style.marginTop = '10px';
    reasonWrap.hidden = true;

    const rLabelRow = document.createElement('div');
    rLabelRow.className = 'ui-label-row';
    const rLbl = document.createElement('label');
    rLbl.className = 'ui-label';
    rLbl.textContent = 'Waiver Reason ';
    const rEm = document.createElement('em');
    rEm.textContent = '*';
    rLbl.appendChild(rEm);
    rLabelRow.appendChild(rLbl);

    const rSelectHost = document.createElement('div');

    rOtherWrap = document.createElement('div');
    rOtherWrap.className = 'ui-input-wrap';
    rOtherWrap.style.marginTop = '6px';
    rOtherWrap.hidden = true;

    rOtherInput = document.createElement('input');
    rOtherInput.type = 'text';
    rOtherInput.placeholder = 'Specify waiver reason...';
    rOtherInput.className = 'ui-input';
    rOtherInput.style.paddingLeft = '12px';
    rOtherWrap.appendChild(rOtherInput);

    const WAIVER_REASONS = [
      { value: '', label: 'Select reason...', icon: 'help-circle' },
      { value: 'Medical Emergency', label: 'Medical Emergency', icon: 'heart-pulse' },
      { value: 'Financial Hardship', label: 'Financial Hardship', icon: 'wallet' },
      { value: 'Technical / Banking Delay', label: 'Technical / Banking Delay', icon: 'clock' },
      { value: 'Administrative Approval', label: 'Administrative Approval', icon: 'shield-check' },
      { value: 'Other Reason', label: 'Other Reason (specify below)', icon: 'edit-3' }
    ];

    reasonSel = createSelect(rSelectHost, {
      options: WAIVER_REASONS,
      value: '',
      ariaLabel: 'Waiver Reason',
      onChange: (val) => {
        rOtherWrap.hidden = val !== 'Other Reason';
        if (val !== 'Other Reason') {
          rOtherInput.value = '';
        } else {
          rOtherInput.focus();
        }
      }
    });

    reasonWrap.append(rLabelRow, rSelectHost, rOtherWrap);

    waiveCheckbox.onchange = () => {
      reasonWrap.hidden = !waiveCheckbox.checked;
      if (!waiveCheckbox.checked) {
        if (reasonSel) reasonSel.value = '';
        if (rOtherInput) rOtherInput.value = '';
        if (rOtherWrap) rOtherWrap.hidden = true;
      }
      recalculate();
    };

    waiveGroup.append(checkLabel, reasonWrap);
  }

  // Payment Mode
  const modeGroup = document.createElement('div');
  modeGroup.className = 'ui-field';
  const modeLabelRow = document.createElement('div');
  modeLabelRow.className = 'ui-label-row';
  const modeLbl = document.createElement('label');
  modeLbl.className = 'ui-label';
  modeLbl.textContent = 'Payment Mode *';
  modeLabelRow.appendChild(modeLbl);
  const modeHost = document.createElement('div');
  modeGroup.append(modeLabelRow, modeHost);

  const MODE_OPTIONS = [
    { value: 'cash', label: 'Cash', icon: 'banknote' },
    { value: 'upi', label: 'UPI', icon: 'smartphone' },
    { value: 'card', label: 'Card', icon: 'credit-card' },
    { value: 'bank', label: 'Bank Transfer', icon: 'building' },
    { value: 'cheque', label: 'Cheque', icon: 'file-text' }
  ];

  // Transaction ID
  const txnGroup = document.createElement('div');
  txnGroup.className = 'ui-field';
  const txnLabelRow = document.createElement('div');
  txnLabelRow.className = 'ui-label-row';
  const txnLabel = document.createElement('label');
  txnLabel.className = 'ui-label';
  txnLabelRow.appendChild(txnLabel);
  const txnWrap = document.createElement('div');
  txnWrap.className = 'ui-input-wrap';
  const txnInput = document.createElement('input');
  txnInput.type = 'text';
  txnInput.className = 'ui-input';
  txnInput.style.paddingLeft = '12px';
  txnWrap.appendChild(txnInput);
  txnGroup.append(txnLabelRow, txnWrap);

  const onModeChange = (modeVal) => {
    const isCash = modeVal === 'cash';
    txnInput.disabled = isCash;
    txnInput.required = false;
    if (isCash) {
      txnInput.value = '';
      txnLabel.innerHTML = 'Transaction / Reference ID <span style="font-weight: normal; color: var(--text-mute, #64748b); font-size: 11.5px;">(N/A for Cash)</span>';
      txnInput.placeholder = 'Not applicable for Cash payments';
      txnWrap.classList.add('is-disabled');
    } else {
      txnLabel.innerHTML = 'Transaction / Reference ID <span style="font-weight: normal; color: var(--text-mute, #64748b); font-size: 11.5px;">(Optional)</span>';
      txnInput.placeholder = 'Optional for ' + modeVal.toUpperCase();
      txnWrap.classList.remove('is-disabled');
    }
  };

  const modeSel = createSelect(modeHost, {
    options: MODE_OPTIONS,
    value: 'cash',
    ariaLabel: 'Payment Mode',
    onChange: onModeChange
  });

  onModeChange('cash');

  const modeTxnRow = document.createElement('div');
  modeTxnRow.className = 'sp-form-row-2';
  modeTxnRow.append(modeGroup, txnGroup);

  // Payment Date — Fixed to todayISO(), read-only / disabled for EVERYONE
  const dateGroup = document.createElement('div');
  dateGroup.className = 'ui-field';
  const dateLabelRow = document.createElement('div');
  dateLabelRow.className = 'ui-label-row';
  const dateLbl = document.createElement('label');
  dateLbl.className = 'ui-label';
  dateLbl.textContent = 'Payment Date *';
  dateLabelRow.appendChild(dateLbl);
  const dateWrap = document.createElement('div');
  dateWrap.className = 'ui-input-wrap is-disabled';
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'ui-input';
  dateInput.style.paddingLeft = '12px';
  dateInput.value = todayISO();
  dateInput.disabled = true;
  dateInput.readOnly = true;
  dateInput.title = 'Payment date is fixed to today';
  dateWrap.appendChild(dateInput);
  dateGroup.append(dateLabelRow, dateWrap);

  // Remarks
  const remGroup = document.createElement('div');
  remGroup.className = 'ui-field';
  const remLabelRow = document.createElement('div');
  remLabelRow.className = 'ui-label-row';
  const remLbl = document.createElement('label');
  remLbl.className = 'ui-label';
  remLbl.textContent = 'Remarks / Note';
  remLabelRow.appendChild(remLbl);
  const remWrap = document.createElement('div');
  remWrap.className = 'ui-input-wrap top';
  const remInput = document.createElement('textarea');
  remInput.className = 'ui-input';
  remInput.rows = 3;
  remInput.style.padding = '8px 12px';
  remInput.style.height = '72px';
  remInput.style.minHeight = '72px';
  remInput.style.resize = 'vertical';
  remInput.placeholder = 'Optional notes';
  remWrap.appendChild(remInput);
  remGroup.append(remLabelRow, remWrap);

  function recalculate() {
    const val = typeSel.value;
    let baseAmt = 0;
    let fineAmt = 0;

    if (isAdmission || pendingAdmission) {
      const pa = pendingAdmission || {};
      if (val === 'AD') {
        baseAmt = Number(pa.admFee ?? admFee) + Number(pa.matFee ?? matFee);
        fineAmt = 0;
      } else if (val === 'FULL') {
        const fullAmt = Number(pa.fullAmt || s.fullPaymentAmount || s.dueAtAdmission?.full || s.feeTotal || 0);
        const actualMatFee = Number(pa.matFee ?? s.dueAtAdmission?.material ?? matFee ?? 0);
        baseAmt = fullAmt + actualMatFee;
        fineAmt = 0;
      }
    } else if (val === 'AD') {
      baseAmt = admFee;
      fineAmt = 0;
    } else if (val === 'FULL') {
      const fullAmt = Number(s.fullPaymentAmount || s.dueAtAdmission?.full || s.feeTotal || 0);
      const actualMatFee = !s.materialPaid ? Number(s.dueAtAdmission?.material ?? matFee ?? 0) : 0;
      baseAmt = fullAmt + actualMatFee;
      fineAmt = 0;
    } else if (val === 'EX') {
      baseAmt = sessionExamFee;
      fineAmt = 0;
    } else if (val === 'MAT') {
      baseAmt = matFee;
      fineAmt = 0;
    } else if (val && val.startsWith('IN_')) {
      const instNo = Number(val.slice(3));
      const schedItem = sched.find(it => Number(it.no ?? it.installmentNo) === instNo);
      baseAmt = schedItem ? Number(schedItem.amount || instFee) : instFee;
      if (schedItem) {
        fineAmt = calculateLateFee(schedItem.due, todayISO());
      }
    }

    if (isSuper && waiveCheckbox && waiveGroup) {
      if (fineAmt === 0) {
        waiveGroup.hidden = true;
        waiveCheckbox.disabled = true;
        waiveCheckbox.checked = false;
        if (reasonWrap) reasonWrap.hidden = true;
        if (reasonSel) reasonSel.value = '';
        if (rOtherInput) rOtherInput.value = '';
        if (rOtherWrap) rOtherWrap.hidden = true;
      } else {
        waiveGroup.hidden = false;
        waiveCheckbox.disabled = false;
        if (reasonWrap) reasonWrap.hidden = !waiveCheckbox.checked;
        if (waiveCheckbox.checked) {
          fineAmt = 0;
        }
      }
    }

    amtInput.value = baseAmt;
    lateInput.value = fineAmt;
    totalValEl.textContent = formatINR(baseAmt + fineAmt);
    baseValEl.textContent = formatINR(baseAmt);
    fineValEl.textContent = formatINR(fineAmt);
    if (fineAmt > 0) {
      fineValEl.style.color = '#c92a2a';
    } else {
      fineValEl.style.color = 'inherit';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  recalculate();

  form.append(typeGroup, infoBox, amtInput, lateInput);
  if (waiveGroup) form.appendChild(waiveGroup);
  form.append(modeTxnRow, dateGroup, remGroup);

  const footer = document.createElement('div');
  footer.className = 'adm-view-foot';
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  footer.style.gap = '10px';
  footer.style.marginTop = '8px';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ui-btn ghost';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => popup.close();

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'ui-btn primary';
  saveBtn.textContent = 'Confirm & Record Payment';

  footer.append(cancelBtn, saveBtn);
  form.appendChild(footer);
  popup.container.appendChild(form);

  saveBtn.onclick = async () => {
    const waived = isSuper && !!(waiveCheckbox && waiveCheckbox.checked);
    const waiverReason = waived ? getWaiverReason() : '';

    if (waived && !waiverReason) {
      showToast({ type: 'error', message: 'Waiver reason is required to waive late fine.' });
      if (rOtherWrap && !rOtherWrap.hidden && rOtherInput) {
        rOtherInput.focus();
      }
      return;
    }

    const val = typeSel.value;
    if (!val) {
      showToast({ type: 'error', message: 'Please select a valid payment type.' });
      return;
    }

    const isExam = val === 'EX';
    const isMat = val === 'MAT';
    const isAdm = val === 'AD';
    const isFull = val === 'FULL';
    const instNo = (isExam || isMat || isAdm || isFull) ? null : Number(val.slice(3));
    const payType = isExam ? 'EX' : (isMat ? 'MAT' : (isAdm ? 'AD' : (isFull ? 'FULL' : 'IN')));

    let schedItem = null;
    if (payType === 'IN') {
      schedItem = sched.find(it => Number(it.no ?? it.installmentNo) === instNo);
    }
    const monthLabel = schedItem?.month || (instNo != null ? `Month ${instNo}` : '');

    const baseAmount = Number(amtInput.value);
    const lateAmount = Number(lateInput.value);

    if (isAdmission || pendingAdmission) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Processing...';
      if (typeof lucide !== 'undefined') lucide.createIcons();

      try {
        const authEmail = auth?.currentUser?.email || profile?.email || '';
        const userDisp = resolveUserDisplay(authEmail, profile?.name, profile?.designation);
        const res = await recordAdmissionWithPayment({
          pendingAdmission,
          paymentParams: {
            mode: modeSel.value,
            txnId: txnInput.value.trim(),
            remarks: remInput.value.trim(),
            userEmail: authEmail,
            userName: userDisp.name || profile?.name || '',
            userDesignation: userDisp.designation || profile?.designation || '',
            userRole: profile?.role || '',
            branchId: profile?.branchId || pendingAdmission.branchId,
            branchCode: pendingAdmission.branchCode,
            branchName: pendingAdmission.branchName
          }
        });

        showToast({ type: 'success', message: 'Admission & payment recorded! Student ID: ' + res.studentId + ' | Receipt No: ' + res.receiptNo });
        playPaymentSuccessSound();
        popup.close();

        const forText = pendingAdmission.isFull
          ? (Number(pendingAdmission.matFee || 0) > 0 ? 'Course Fee (Paid in Full) & Study Material' : 'Course Fee (Paid in Full)')
          : (Number(pendingAdmission.matFee || 0) > 0 ? 'Admission & Material Fee' : 'Admission Fee');

        promptOpenReceipt({
          studentDocId: res.studentDocId,
          paymentId: res.paymentId,
          receiptNo: res.receiptNo,
          student: { name: s.name, studentId: res.studentId },
          forText,
          amount: res.totalPaid,
          lateFee: 0,
          totalPaid: res.totalPaid,
          mode: modeSel.value,
          txnId: txnInput.value.trim(),
          date: new Date(),
          from: 'admissions'
        });

        if (typeof onSuccess === 'function') {
          await onSuccess({ res, studentDocId: res.studentDocId, studentId: res.studentId, receiptNo: res.receiptNo, paymentId: res.paymentId });
        }
      } catch (err) {
        console.error('[payment-popup] admission payment transaction failed', err);
        showToast({ type: 'error', message: 'Admission save failed: ' + (err.message || 'Transaction error') });
        saveBtn.disabled = false;
        saveBtn.textContent = 'Confirm & Record Payment';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Processing...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
      const authEmail = auth?.currentUser?.email || profile?.email || '';
      const userDisp = resolveUserDisplay(authEmail, profile?.name, profile?.designation);
      const res = await recordPayment({
        studentDoc: s,
        type: payType,
        installmentNo: instNo,
        month: monthLabel,
        amount: baseAmount,
        lateFeeAmount: lateAmount,
        mode: modeSel.value,
        txnId: txnInput.value.trim(),
        remarks: remInput.value.trim(),
        waived,
        waiverReason,
        paymentDate: todayISO(),
        userEmail: authEmail,
        userName: userDisp.name || profile?.name || '',
        userDesignation: userDisp.designation || profile?.designation || '',
        userRole: profile?.role || '',
        branchId: profile?.branchId || s.branchId,
        branchCode: s.branchCode || '',
        branchName: s.branchName || ''
      });

      showToast({ type: 'success', message: 'Payment recorded! Receipt No: ' + res.receiptNo });
      playPaymentSuccessSound();
      popup.close();

      const forText = isExam
        ? 'Board Examination Fee'
        : (isMat ? 'Study Material Fee' : (isAdm ? 'Admission Fee' : (isFull ? 'Course Fee (Paid in Full)' : `Installment ${instNo}${monthLabel ? ` - ${monthLabel}` : ''}`)));

      const actualLate = waived ? 0 : lateAmount;
      const totalPaid = baseAmount + actualLate;

      // Redesigned success dialog
      promptOpenReceipt({
        studentDocId: res.studentDocId || s.id,
        paymentId: res.paymentId,
        receiptNo: res.receiptNo,
        student: s,
        forText,
        amount: baseAmount,
        lateFee: actualLate,
        totalPaid,
        mode: modeSel.value,
        txnId: txnInput.value.trim(),
        date: new Date(),
        from
      });

      if (typeof onSuccess === 'function') {
        await onSuccess({ res, paymentId: res.paymentId, receiptNo: res.receiptNo });
      }
    } catch (err) {
      console.error('[payment-popup] payment transaction failed', err);
      showToast({ type: 'error', message: 'Payment failed: ' + (err.message || 'Transaction error') });
      saveBtn.disabled = false;
      saveBtn.textContent = 'Confirm & Record Payment';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  };

  if (typeof lucide !== 'undefined') lucide.createIcons();
}
