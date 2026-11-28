// payment-receipt.page.js — Monthly and Exam Payment Receipt page module.
// Matches reference-templates/monthly-payment-receipt (2).html and monthly-payment-receipt-late-fine (1).html
import { db } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { inWords } from '../utils/admission-receipt.js?v=1.8.201';
import { showToast } from '../components/toast.js?v=1.8.201';
import { fmtDate, todayISO } from '../utils/session-rules.js?v=1.8.201';
import { formatPersonName } from '../utils/formatter.js?v=1.8.201';
import { getStudentPhotoSrc } from '../utils/student-media.js?v=1.8.201';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.201';
import { dueDateForMonth, formatShortMonthYear } from '../utils/school-billing.js?v=1.8.201';
import {
  fetchStudentPayments,
  isInstallmentPaid,
  installmentCourseFee,
  installmentBalanceDue
} from '../services/payment.service.js?v=1.8.201';

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function fmtMoney(num) {
  const n = Number(num || 0);
  return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let studentDocId = '';
let paymentId = '';
let isDownloadingPdf = false;
let fromParam = '';
let autoPrint = false;
let currentUserProfile = null;
let loadedStudentCtx = '';

async function waitForReceiptAssets(root) {
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch (_) { /* non-fatal */ }
  if (!root) return;
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map((img) => {
    if (img.complete) {
      return typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve();
    }
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }));
}

export async function mount({ container, profile, ctx }) {
  currentUserProfile = profile || null;
  loadedStudentCtx = ctx || '';
  const isSuper = profile && profile.role === 'superadmin';
  const isBranchHead = profile && profile.role === 'branch_head';
  const isSchoolHead = profile && profile.role === 'school_head';

  if (!isSuper && !isBranchHead && !isSchoolHead) {
    showToast({ type: 'error', message: 'You do not have permission to view payment receipts.' });
    return;
  }

  // Parse hash: #/payments/<studentDocId>/<paymentId>/receipt?from=...&print=...
  const rawHash = location.hash || '';
  const m = rawHash.match(/#\/payments\/([^\/#?]+)\/([^\/#?]+)\/receipt/);
  studentDocId = m && m[1];
  paymentId = m && m[2];

  fromParam = '';
  autoPrint = false;
  const qIdx = rawHash.indexOf('?');
  if (qIdx !== -1) {
    const q = new URLSearchParams(rawHash.slice(qIdx));
    fromParam = q.get('from') || '';
    if (q.get('print') === '1') autoPrint = true;
  }

  if (!studentDocId || !paymentId) {
    $('mpr-loading').hidden = true;
    $('mpr-notfound').hidden = false;
    return;
  }

  bindActions();
  await loadAndRenderReceipt();
}

function bindActions() {
  const backBtn = $('mpr-back');
  const nfBackBtn = $('mpr-nf-back');
  const profileBtn = $('mpr-profile');
  const printBtn = $('mpr-print');
  const dlBtn = $('mpr-download');

  const goBack = () => {
    if (fromParam === 'pay-fees') {
      location.hash = `#/pay-fees?student=${encodeURIComponent(studentDocId)}`;
    } else if (fromParam === 'profile') {
      location.hash = `#/students/${encodeURIComponent(studentDocId)}?tab=payments`;
    } else if (fromParam === 'payments') {
      location.hash = '#/payments';
    } else if (fromParam === 'school-payments') {
      location.hash = '#/school-payments';
    } else if (fromParam === 'school-fees') {
      location.hash = studentDocId ? `#/school-fees?student=${encodeURIComponent(studentDocId)}` : '#/school-fees';
    } else if (fromParam === 'school-pending') {
      location.hash = '#/school-pending';
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      location.hash = loadedStudentCtx === 'school' ? '#/school-students' : '#/students';
    }
  };

  if (backBtn) backBtn.onclick = goBack;
  if (nfBackBtn) nfBackBtn.onclick = goBack;

  if (profileBtn) {
    profileBtn.onclick = () => {
      if (studentDocId) location.hash = `#/students/${encodeURIComponent(studentDocId)}?tab=payments`;
    };
  }

  if (printBtn) {
    printBtn.onclick = () => window.print();
  }

  if (dlBtn) {
    dlBtn.onclick = () => downloadReceiptPdf();
  }
}

async function loadAndRenderReceipt() {
  const loading = $('mpr-loading');
  const notfound = $('mpr-notfound');
  const stage = $('mpr-stage');
  const sheet = $('mpr-sheet');

  loading.hidden = false;
  notfound.hidden = true;
  stage.hidden = true;

  try {
    // 1. Fetch student doc
    const studentSnap = await getDoc(doc(db, 'students', studentDocId));
    if (!studentSnap.exists()) {
      loading.hidden = true;
      notfound.hidden = false;
      return;
    }
    const student = Object.assign({ id: studentSnap.id }, studentSnap.data());
    loadedStudentCtx = student.ctx || loadedStudentCtx || '';

    const userRole = currentUserProfile && currentUserProfile.role;
    if (userRole === 'school_head' && student.ctx !== 'school') {
      showToast({ type: 'error', message: 'You only have permission to view Unique Kids payment receipts.' });
      loading.hidden = true;
      notfound.hidden = false;
      return;
    }
    if (userRole === 'branch_head' && student.ctx === 'school') {
      showToast({ type: 'error', message: 'You do not have permission to view Unique Kids payment receipts.' });
      loading.hidden = true;
      notfound.hidden = false;
      return;
    }

    const isKids = student.ctx === 'school';

    // 2. Fetch payment doc
    let payment = null;
    if (isKids) {
      const keys = [...new Set([studentDocId, student.studentId].filter(Boolean))];
      if (paymentId === 'latest') {
        const list = [];
        for (const k of keys) {
          const snap = await getDocs(query(collection(db, 'payments'), where('studentId', '==', k))).catch(() => null);
          if (snap) snap.docs.forEach((d) => { if (!list.some((x) => x.id === d.id)) list.push({ id: d.id, ...d.data() }); });
        }
        list.sort((a, b) => String(b.receivedDate || b.date || '').localeCompare(String(a.receivedDate || a.date || '')));
        payment = list[0] || null;
        if (!payment) {
          const subPayments = await fetchStudentPayments(studentDocId).catch(() => []);
          payment = subPayments[0] || null;
        }
      } else {
        const rootSnap = await getDoc(doc(db, 'payments', paymentId)).catch(() => null);
        if (rootSnap && rootSnap.exists()) {
          const pData = rootSnap.data();
          const belongs = pData.studentDocId === studentDocId ||
            pData.studentId === studentDocId ||
            (student.studentId && (pData.studentId === student.studentId || pData.studentCode === student.studentId));
          if (belongs) payment = Object.assign({ id: rootSnap.id }, pData);
        }
        if (!payment) {
          const pSnap = await getDoc(doc(db, 'students', studentDocId, 'payment', paymentId)).catch(() => null);
          if (pSnap && pSnap.exists()) payment = Object.assign({ id: pSnap.id }, pSnap.data());
        }
      }
    } else if (paymentId === 'latest') {
      const allPayments = await fetchStudentPayments(studentDocId);
      payment = allPayments[0] || null;
    } else {
      const pSnap = await getDoc(doc(db, 'students', studentDocId, 'payment', paymentId));
      if (pSnap.exists()) {
        payment = Object.assign({ id: pSnap.id }, pSnap.data());
      }
    }

    if (!payment) {
      loading.hidden = true;
      notfound.hidden = false;
      return;
    }

    // Admission payments (AD, FULL, MAT) share one admission receipt; redirect to admission receipt
    const pType = String(payment.type || '').toUpperCase().trim();
    const isKidsMonthlyOrUpgrade = isKids && (Boolean(payment.billId) || pType === 'KIDS_MONTHLY' || pType === 'UPGRADE');
    const isAdmRcpt = !isKidsMonthlyOrUpgrade && (
      pType === 'AD' || pType === 'FULL' || pType === 'MAT' ||
      (payment.receiptNo && (payment.receiptNo === student.admissionReceiptNo || payment.receiptNo === student.receiptNo || payment.receiptNo === student.fullReceiptNo))
    );
    if (isAdmRcpt) {
      const admRoute = (isKids ? '#/school-admissions/' : '#/admissions/') + studentDocId + '/receipt' + (autoPrint ? '?print=1' : '');
      location.replace(admRoute);
      return;
    }

    // 3. Fetch org info & branch details (matching admission receipt logic)
    let org = window.APP_CACHE?.org || {};
    try {
      if (!org.orgName) {
        const orgSnap = await getDoc(doc(db, 'settings', 'org_config'));
        if (orgSnap.exists()) org = orgSnap.data();
      }
    } catch (_) {}
    const orgLogo = org.logo || org.logoUrl || '/assets/images/logo-192.jpg';

    let branch = null;
    if (!isKids && student.branchId) {
      try {
        const bSnap = await getDoc(doc(db, 'branches', student.branchId));
        if (bSnap.exists()) branch = bSnap.data();
      } catch (_) {}
    }

    // 4. Fetch student ledger data
    const allStudentPayments = isKids ? [] : await fetchStudentPayments(studentDocId);
    const kidsBills = [];
    if (isKids) {
      const keys = [...new Set([studentDocId, student.studentId].filter(Boolean))];
      for (const k of keys) {
        const bSnap = await getDocs(query(collection(db, 'bills'), where('studentId', '==', k))).catch(() => null);
        if (bSnap) bSnap.docs.forEach((d) => { if (!kidsBills.some((x) => x.id === d.id)) kidsBills.push({ id: d.id, ...d.data() }); });
      }
    }

    // 5. Fetch student photo using shared getStudentPhotoSrc helper
    let photoUrl = getStudentPhotoSrc(student, null);
    if (!photoUrl) {
      try {
        const docsMap = {};
        const photoDoc = await getDoc(doc(db, 'students', studentDocId, 'docs', 'photo'));
        if (photoDoc.exists()) docsMap.photo = { id: photoDoc.id, ...photoDoc.data() };
        photoUrl = getStudentPhotoSrc(student, docsMap);
        if (!photoUrl) {
          const allDocs = await getDocs(collection(db, 'students', studentDocId, 'docs'));
          allDocs.docs.forEach((d) => { docsMap[d.id] = { id: d.id, ...d.data() }; });
          photoUrl = getStudentPhotoSrc(student, docsMap);
        }
      } catch (_) {}
    }

    if (isKids) {
      renderKidsReceiptHTML({
        student,
        payment,
        org,
        orgLogo,
        bills: kidsBills,
        photoUrl
      });
    } else {
      renderReceiptHTML({
        student,
        payment,
        org,
        orgLogo,
        branch,
        allPayments: allStudentPayments,
        photoUrl
      });
    }

    loading.hidden = true;
    stage.hidden = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (autoPrint) {
      await waitForReceiptAssets($('mpr-sheet'));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.print();
    }
  } catch (err) {
    console.error('[payment-receipt] load error', err);
    loading.hidden = true;
    notfound.hidden = false;
  }
}

/**
 * Builds the receipt layout according to reference templates
 */
function renderReceiptHTML({ student, payment, org, orgLogo, branch, allPayments, photoUrl }) {
  const sheet = $('mpr-sheet');
  sheet.innerHTML = '';

  const orgName = org.orgName || 'Unique Infotech';
  const orgSub = org.orgSubtitle || org.isoLine || org.isoText || 'An ISO 9001:2015 Certified Organisation';
  const branchRaw = branch?.name || student.branchName || 'BANKURA ZILLA YOUTH COMPUTER TRAINING CENTRE';
  const branchName = formatPersonName(branchRaw) || branchRaw;
  const orgPhones = org.phones || org.phone || '9851771893, 9832147650, 8641209375';
  const orgEmail = org.email || 'utpal.goutam@gmail.com';
  const branchPhones = branch?.phone || branch?.phones || '9733518246, 7003624981, 9475036218';

  const payType = String(payment.type || 'IN').toUpperCase();
  const isExam = payType === 'EX';
  const isInstallment = payType === 'IN' || payType === 'INST';
  const instNo = payment.installmentNo || 1;

  // Course fee & balance calculations strictly for installments (excluding admission, material, and exam fees)
  const totalCourseFee = isExam
    ? Number(payment.amount || 0)
    : installmentCourseFee(student);
  const paidAmount = Number(payment.amount || 0);
  const lateFee = Number(payment.lateFee || payment.lateFeeAmount || 0);
  const totalReceived = Number(payment.total ?? (paidAmount + (payment.waived ? 0 : lateFee)));
  const balanceDue = isExam
    ? 0
    : installmentBalanceDue(student, allPayments);

  const pDateStr = fmtDate(payment.paidOn || payment.date);
  const rNo = payment.receiptNo || 'RCPT-PREVIEW';

  // Words for amount
  let amountWords = '';
  if (lateFee > 0 && !payment.waived) {
    amountWords = `(Instalment Rs. ${paidAmount} + late fine Rs. ${lateFee})`;
  } else {
    amountWords = `(${inWords(totalReceived)})`;
  }

  // Next installment hint
  const sched = student.feeSchedule || [];
  let nextDueHint = '';
  if (isInstallment) {
    const nextItem = sched.find(it => Number(it.no ?? it.installmentNo) === instNo + 1);
    if (nextItem && balanceDue > 0) {
      nextDueHint = `Next: Rs. ${Number(nextItem.amount || 0)} on ${fmtDate(nextItem.due)}`;
    }
  }

  const titleText = isExam ? 'Board Examination Fee Receipt' : 'Monthly Fee Payment Receipt';

  const html = `
    <!-- Header -->
    <div class="mpr-hd">
      <div class="mpr-logo ${orgLogo ? 'img' : ''}">
        ${orgLogo ? `<img src="${escapeHtml(orgLogo)}" alt="Logo" onerror="this.parentElement.classList.remove('img'); this.remove();" />` : `<span>UI</span>`}
      </div>
      <div>
        <h1>${escapeHtml(orgName)}</h1>
        <div class="mpr-iso">${escapeHtml(orgSub)}</div>
        <div class="mpr-br">${escapeHtml(branchName)}</div>
        <div class="mpr-ct">
          <b>${escapeHtml(orgName)}:</b> ${escapeHtml(orgPhones)} &nbsp;|&nbsp; <b>Email:</b> ${escapeHtml(orgEmail)}<br>
          <b>Branch Contact:</b> ${escapeHtml(branchPhones)}
        </div>
      </div>
    </div>

    <!-- Title & Receipt Number -->
    <div class="mpr-title">${titleText}</div>
    <div class="mpr-rno">Receipt no: <strong>${escapeHtml(rNo)}</strong> &nbsp;|&nbsp; Date: <strong>${escapeHtml(pDateStr)}</strong></div>

    <!-- Student Details Table -->
    <table class="mpr-d">
      <tr>
        <th>Student name</th>
        <td><strong>${escapeHtml(formatPersonName(student.name || '') || '—')}</strong></td>
        <td class="mpr-pc" rowspan="5">
          <div class="mpr-photo">
            ${photoUrl ? `<img src="${photoUrl}" alt="Student photo" onerror="this.remove();" />` : `<span>Photo</span>`}
          </div>
        </td>
      </tr>
      <tr>
        <th>Guardian name</th>
        <td>${escapeHtml(formatPersonName(student.guardianName || student.fatherName || '') || '—')}</td>
      </tr>
      <tr>
        <th>Student ID</th>
        <td><strong>${escapeHtml(student.studentId || '—')}</strong></td>
      </tr>
      <tr>
        <th>Course</th>
        <td>${escapeHtml(student.courseName || student.courseCode || '—')}</td>
      </tr>
      <tr>
        <th>Batch / Session</th>
        <td>${escapeHtml(student.batchName || 'Standard')} &nbsp;|&nbsp; ${escapeHtml(student.sessionName || '—')}</td>
      </tr>
    </table>

    <!-- Payment details section -->
    <div class="mpr-sec">
      <h4>
        <span class="mpr-ht">
          <svg class="mpr-ic" viewBox="0 0 24 24"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
          Payment details
        </span>
      </h4>
      <div class="mpr-meta">
        <div>
          <em>Paid for</em>
          <b>${isExam ? 'Board Examination Fee' : `Instalment ${instNo} of ${sched.length || 4}`}</b>
        </div>
        <div>
          <em>Due date</em>
          <b>${isInstallment ? fmtDate(sched[instNo - 1]?.due) : 'At Exam Registration'}</b>
        </div>
        <div>
          <em>Date of payment</em>
          <b>${escapeHtml(pDateStr)}</b>
        </div>
        <div>
          <em>Late fine</em>${/* Keep the stored waivedByDesignation / recordedByDesignation snapshot: issued receipts are immutable legal records. */ ''}
          <b>${payment.waived ? `Waived (${payment.waivedByDesignation || payment.recordedByDesignation || getRoleTitle('superadmin')})` : (lateFee > 0 ? fmtMoney(lateFee) : 'Rs. 0.00')}</b>
        </div>
      </div>

      <div class="mpr-pbox">
        <div class="mpr-pcell">
          <em>Amount received</em>
          <b>${fmtMoney(totalReceived)}</b>
          <span class="w">${escapeHtml(amountWords)}</span>
        </div>
        <div class="mpr-pcell bal">
          <em>Balance due</em>
          <b>${fmtMoney(balanceDue)}</b>
          ${nextDueHint ? `<span class="w">${escapeHtml(nextDueHint)}</span>` : ''}
        </div>
      </div>

      ${!isExam ? `
        <div class="mpr-imp">
          <b>Important - Examination fee:</b> The examination fee is not included in the total course fee shown above. It will be charged as per the Government order in force at the time of the examination, and is payable in addition to the balance due.
        </div>
      ` : ''}
    </div>

    <!-- Fee ledger table -->
    <div class="mpr-sec">
      <h4>
        <span class="mpr-ht">
          <svg class="mpr-ic" viewBox="0 0 24 24"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>
          Fee ledger
        </span>
        <small>${isExam ? `Examination fee ${fmtMoney(paidAmount)}` : `Course fee (installments) ${fmtMoney(totalCourseFee)}`}</small>
      </h4>
      <table class="mpr-fe">
        <thead>
          <tr>
            <th>Fee head</th>
            <th>Due</th>
            <th>Status</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${isExam ? `
            <tr class="cur">
              <td>Board Examination fee (this receipt)</td>
              <td>Exam registration</td>
              <td><span class="mpr-pill">Paid</span></td>
              <td>${fmtMoney(paidAmount)}</td>
            </tr>
          ` : `
            <!-- Installments only (no admission fee, no study material, no exam fee) -->
            ${sched.map(it => {
              const itNo = Number(it.no ?? it.installmentNo);
              const isCur = isInstallment && itNo === instNo;
              const paid = isInstallmentPaid(it, allPayments, student);
              return `
                <tr class="${isCur ? 'cur' : ''}">
                  <td>Instalment ${itNo} of ${sched.length || 4} ${isCur ? '(this receipt)' : ''}</td>
                  <td>${fmtDate(it.due)}</td>
                  <td><span class="mpr-pill ${paid ? '' : 'due'}">${paid ? 'Paid' : 'Due'}</span></td>
                  <td>${fmtMoney(it.amount || 0)}</td>
                </tr>
              `;
            }).join('')}
          `}
        </tbody>
      </table>
    </div>

    <!-- Terms -->
    <div class="mpr-sec">
      <ol class="mpr-terms">
        <li>Fees once paid are not refundable or transferable.</li>
        <li>Please keep this receipt safe. It is computer-generated and valid with the authorised signature.</li>
      </ol>
    </div>

    <!-- Signatures & Footer -->
    <div class="mpr-sigs">
      <div>Student's signature</div>
      <div>Authorised signatory</div>
    </div>
    <div class="mpr-ft">
      <span>${escapeHtml(orgName)} &nbsp;|&nbsp; Generated on ${fmtDate(payment.paidOn || payment.date || todayISO())}</span>
      <span>Page 1 of 1</span>
    </div>
  `;

  sheet.innerHTML = html;
}

/**
 * Builds Unique Kids Monthly / Upgrade Payment Receipt layout
 */
function renderKidsReceiptHTML({ student, payment, org, orgLogo, bills, photoUrl }) {
  const sheet = $('mpr-sheet');
  sheet.innerHTML = '';

  const orgName = org.orgName || 'Unique Infotech';
  const orgSub = org.orgSubtitle || org.isoLine || org.isoText || 'An ISO 9001:2015 Certified Organisation';
  const branchName = 'Unique Kids — School Computer Program (Head Office)';
  const orgPhones = Array.isArray(org.phones) && org.phones.length ? org.phones.join(', ') : (org.phones || org.phone || '9851771893, 9832147650, 8641209375');
  const orgEmail = org.email || 'utpal.goutam@gmail.com';

  const payType = String(payment.type || 'KIDS_MONTHLY').toUpperCase().trim();
  const isUpgrade = payType === 'UPGRADE';
  const monthStr = payment.month || '';
  const batchMonths = Array.isArray(payment.months) && payment.months.length
    ? payment.months.slice().sort()
    : (Array.isArray(payment.allocations) ? payment.allocations.map((a) => a.month).filter(Boolean).sort() : []);
  const batchBillIds = new Set(
    Array.isArray(payment.billIds) && payment.billIds.length
      ? payment.billIds
      : (Array.isArray(payment.allocations) ? payment.allocations.map((a) => a.billId).filter(Boolean) : [])
  );
  if (payment.billId) batchBillIds.add(payment.billId);
  const allBills = Array.isArray(bills) ? [...bills] : [];
  allBills.sort((a, b) => String(a.month || '').localeCompare(String(b.month || '')));

  const thisBill = allBills.find((b) => b.id === payment.billId)
    || allBills.find((b) => monthStr && b.month === monthStr)
    || null;
  const coveredBills = allBills.filter((b) => batchBillIds.has(b.id) || (batchMonths.includes(b.month)));

  const pDateStr = fmtDate(payment.receivedDate || payment.paidOn || payment.date);
  const rNo = payment.receiptNo || thisBill?.receiptNo || 'RCPT-PREVIEW';

  const methodCode = String(payment.mode || payment.paymentMethod || 'cash').toLowerCase().trim() || 'cash';
  const METHOD_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank Transfer', cheque: 'Cheque' };
  const methodLabel = METHOD_LABELS[methodCode] || methodCode.toUpperCase();
  const txnIdStr = String(payment.txnId || '').trim();
  const remarksStr = String(payment.remarks || '').trim();

  const lateFee = Number(payment.lateFeeCovered ?? payment.lateFee ?? payment.lateFeeAmount ?? 0);
  const waivedAmt = Number(payment.lateFeeWaived || 0);
  const feePaid = Number(payment.feeCovered ?? (payment.amount != null ? Math.max(0, Number(payment.amount) - lateFee) : 0));
  const totalReceived = Number(payment.amount ?? payment.totalAmount ?? payment.total ?? (feePaid + lateFee));

  const openBills = allBills.filter((b) => {
    const st = String(b.status || 'unpaid').toLowerCase();
    return st === 'unpaid' || st === 'partial';
  });
  const openBalance = openBills.reduce((sum, b) => (
    sum + Math.max(0, Number(b.monthlyFee || 0) - Number(b.paidAmount || 0) - Number(b.waivedAmount || 0))
  ), 0);

  let amountWords = '';
  if (lateFee > 0 && waivedAmt <= 0) {
    amountWords = `(Tuition Rs. ${feePaid} + late fine Rs. ${lateFee})`;
  } else {
    amountWords = `(${inWords(totalReceived)})`;
  }

  const paidForText = isUpgrade
    ? (String(payment.paymentMode || '').toLowerCase() === 'full' ? 'Level Upgrade (Full Admission)' : 'Level Upgrade Difference')
    : (batchMonths.length > 1
      ? `Monthly Fees (${formatShortMonthYear(batchMonths[0])} – ${formatShortMonthYear(batchMonths[batchMonths.length - 1])}, ${batchMonths.length} months)`
      : (monthStr ? `Monthly Fee (${formatShortMonthYear(monthStr)})` : 'Monthly Tuition Fee'));
  const dueDateText = isUpgrade
    ? 'At Upgrade'
    : (batchMonths.length > 1
      ? `10th of each month (${batchMonths.length} bills)`
      : (thisBill?.dueDate ? fmtDate(thisBill.dueDate) : (monthStr ? fmtDate(dueDateForMonth(monthStr)) : '—')));
  const lateFineText = (waivedAmt > 0 || payment.waived)
    ? `Waived (${payment.waivedByDesignation || payment.recordedByDesignation || getRoleTitle('superadmin')})`
    : (lateFee > 0 ? fmtMoney(lateFee) : 'Rs. 0.00');

  const ledgerBills = [];
  coveredBills.forEach((b) => {
    if (!ledgerBills.some((x) => x.id === b.id)) ledgerBills.push(b);
  });
  if (thisBill && !ledgerBills.some((x) => x.id === thisBill.id)) ledgerBills.push(thisBill);
  openBills.forEach((b) => {
    if (!ledgerBills.some((x) => x.id === b.id)) ledgerBills.push(b);
  });
  if (ledgerBills.length === 0 && !isUpgrade) {
    allBills.slice(-6).forEach((b) => ledgerBills.push(b));
  }

  const titleText = isUpgrade ? 'Level Upgrade Fee Receipt' : 'Monthly Fee Payment Receipt';
  const classAndBilling = `${student.schoolClass ? 'Class ' + student.schoolClass + ' | ' : ''}Monthly Billing`;

  const html = `
    <!-- Header -->
    <div class="mpr-hd">
      <div class="mpr-logo ${orgLogo ? 'img' : ''}">
        ${orgLogo ? `<img src="${escapeHtml(orgLogo)}" alt="Logo" onerror="this.parentElement.classList.remove('img'); this.remove();" />` : `<span>UI</span>`}
      </div>
      <div>
        <h1>${escapeHtml(orgName)}</h1>
        <div class="mpr-iso">${escapeHtml(orgSub)}</div>
        <div class="mpr-br">${escapeHtml(branchName)}</div>
        <div class="mpr-ct">
          <b>${escapeHtml(orgName)}:</b> ${escapeHtml(orgPhones)} &nbsp;|&nbsp; <b>Email:</b> ${escapeHtml(orgEmail)}
        </div>
      </div>
    </div>

    <!-- Title & Receipt Number -->
    <div class="mpr-title">${escapeHtml(titleText)}</div>
    <div class="mpr-rno">Receipt no: <strong>${escapeHtml(rNo)}</strong> &nbsp;|&nbsp; Date: <strong>${escapeHtml(pDateStr)}</strong></div>

    <!-- Student Details Table -->
    <table class="mpr-d">
      <tr>
        <th>Student name</th>
        <td><strong>${escapeHtml(formatPersonName(student.name || '') || '—')}</strong></td>
        <td class="mpr-pc" rowspan="5">
          <div class="mpr-photo">
            ${photoUrl ? `<img src="${photoUrl}" alt="Student photo" onerror="this.remove();" />` : `<span>Photo</span>`}
          </div>
        </td>
      </tr>
      <tr>
        <th>Guardian name</th>
        <td>${escapeHtml(formatPersonName(student.guardianName || student.fatherName || '') || '—')}</td>
      </tr>
      <tr>
        <th>Student ID</th>
        <td><strong>${escapeHtml(student.studentId || '—')}</strong></td>
      </tr>
      <tr>
        <th>Level / Course</th>
        <td>${escapeHtml(student.courseLevelName || student.courseName || '—')}</td>
      </tr>
      <tr>
        <th>Class &amp; Billing</th>
        <td>${escapeHtml(classAndBilling)}</td>
      </tr>
    </table>

    <!-- Payment details section -->
    <div class="mpr-sec">
      <h4>
        <span class="mpr-ht">
          <svg class="mpr-ic" viewBox="0 0 24 24"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
          Payment details
        </span>
      </h4>
      <div class="mpr-meta">
        <div>
          <em>Paid for</em>
          <b>${escapeHtml(paidForText)}</b>
        </div>
        <div>
          <em>Due date</em>
          <b>${escapeHtml(dueDateText)}</b>
        </div>
        <div>
          <em>Date of payment</em>
          <b>${escapeHtml(pDateStr)}</b>
        </div>
        <div>
          <em>Late fine</em>
          <b>${escapeHtml(lateFineText)}</b>
        </div>
      </div>
      <div style="padding:7px 12px;border:1px solid #b9bfdc;border-top:0;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;font-size:12px;background:#f8f9ff;">
        <span>Payment mode: <strong>${escapeHtml(methodLabel)}</strong></span>
        <span>Transaction / Ref ID: <strong style="font-family:monospace;">${escapeHtml(txnIdStr || '—')}</strong></span>
        ${remarksStr ? `<span>Remarks: <strong>${escapeHtml(remarksStr)}</strong></span>` : ''}
      </div>

      <div class="mpr-pbox">
        <div class="mpr-pcell">
          <em>Amount received</em>
          <b>${fmtMoney(totalReceived)}</b>
          <span class="w">${escapeHtml(amountWords)}</span>
        </div>
        <div class="mpr-pcell bal">
          <em>Open bills balance</em>
          <b>${fmtMoney(openBalance)}</b>
          <span class="w">${openBalance > 0 ? `${openBills.length} unpaid monthly bill${openBills.length === 1 ? '' : 's'}` : 'All generated monthly bills cleared'}</span>
        </div>
      </div>
    </div>

    <!-- Monthly Bill Ledger -->
    <div class="mpr-sec">
      <h4>
        <span class="mpr-ht">
          <svg class="mpr-ic" viewBox="0 0 24 24"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>
          Fee ledger
        </span>
        <small>Monthly fee ${fmtMoney(student.monthlyFee || thisBill?.monthlyFee || feePaid)}</small>
      </h4>
      <table class="mpr-fe">
        <thead>
          <tr>
            <th>Fee period</th>
            <th>Due date</th>
            <th>Status</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${isUpgrade || ledgerBills.length === 0 ? `
            <tr class="cur">
              <td>${escapeHtml(paidForText)} (this receipt)</td>
              <td>${escapeHtml(dueDateText)}</td>
              <td><span class="mpr-pill">Paid</span></td>
              <td>${fmtMoney(totalReceived)}</td>
            </tr>
          ` : ledgerBills.map((b) => {
            const st = String(b.status || 'unpaid').toLowerCase();
            const allocMatch = Array.isArray(payment.allocations)
              ? payment.allocations.find((a) => a.billId === b.id || (b.month && a.month === b.month))
              : null;
            const isCur = Boolean(allocMatch) || batchBillIds.has(b.id) || (thisBill && b.id === thisBill.id) || (monthStr && b.month === monthStr);
            const pillCls = st === 'paid' ? '' : (st === 'partial' ? 'due' : 'due');
            const stLabel = st === 'paid' ? 'Paid' : (st === 'partial' ? 'Partial' : 'Due');
            const rowAmt = isCur
              ? (allocMatch ? Number(allocMatch.amountPaid ?? (allocMatch.feeCovered + allocMatch.lateFeeCovered)) : totalReceived)
              : Number(b.monthlyFee || 0);
            return `
              <tr class="${isCur ? 'cur' : ''}">
                <td>${escapeHtml(b.month ? formatShortMonthYear(b.month) : 'Monthly bill')} ${isCur ? '(this receipt)' : ''}</td>
                <td>${escapeHtml(fmtDate(b.dueDate || (b.month ? dueDateForMonth(b.month) : '')))}</td>
                <td><span class="mpr-pill ${pillCls}">${stLabel}</span></td>
                <td>${fmtMoney(rowAmt)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- Terms -->
    <div class="mpr-sec">
      <ol class="mpr-terms">
        <li>Fees once paid are not refundable or transferable.</li>
        <li>Monthly bills open on the 1st and are due by the 10th of each month.</li>
        <li>Please keep this receipt safe. It is computer-generated and valid with the authorised signature.</li>
      </ol>
    </div>

    <!-- Signatures & Footer -->
    <div class="mpr-sigs">
      <div>Parent / Guardian's signature</div>
      <div>Authorised signatory</div>
    </div>
    <div class="mpr-ft">
      <span>${escapeHtml(orgName)} &nbsp;|&nbsp; Generated on ${fmtDate(payment.receivedDate || payment.paidOn || payment.date || todayISO())}</span>
      <span>Page 1 of 1</span>
    </div>
  `;

  sheet.innerHTML = html;
}

/**
 * Downloads pixel-perfect vector or high-res PDF
 */
async function downloadReceiptPdf() {
  if (isDownloadingPdf) return;
  const dlBtn = $('mpr-download');
  if (dlBtn) dlBtn.textContent = 'Preparing PDF…';
  isDownloadingPdf = true;

  try {
    // Dynamically load html2canvas and jspdf if not loaded
    if (!window.html2canvas) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    if (!window.jspdf) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }

    const page = $('mpr-sheet');
    // Ensure fonts and all images are settled before rendering canvas
    await waitForReceiptAssets(page);

    const canvas = await window.html2canvas(page, {
      scale: 3,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      onclone: (clonedDoc) => {
        const p = clonedDoc.getElementById('mpr-sheet');
        if (p) {
          p.style.margin = '0';
          p.style.border = 'none';
          p.style.boxShadow = 'none';
        }
      }
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    const filename = `Payment-Receipt-${studentDocId}-${paymentId}.pdf`;
    pdf.save(filename);
    showToast({ type: 'success', message: 'Receipt PDF downloaded successfully.' });
  } catch (e) {
    console.error('[payment-receipt] PDF download failed', e);
    showToast({ type: 'error', message: 'Could not create PDF. Opening Print dialog instead...' });
    window.print();
  } finally {
    isDownloadingPdf = false;
    if (dlBtn) {
      dlBtn.innerHTML = '<i data-lucide="download"></i> Download PDF';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
