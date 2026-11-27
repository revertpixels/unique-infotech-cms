// payment-receipt.page.js — Monthly and Exam Payment Receipt page module.
// Matches reference-templates/monthly-payment-receipt (2).html and monthly-payment-receipt-late-fine (1).html
import { db } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, collection } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { inWords } from '../utils/admission-receipt.js?v=1.8.194';
import { showToast } from '../components/toast.js?v=1.8.194';
import { fmtDate, todayISO } from '../utils/session-rules.js?v=1.8.194';
import { formatPersonName } from '../utils/formatter.js?v=1.8.194';
import { getStudentPhotoSrc } from '../utils/student-media.js?v=1.8.194';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.194';
import {
  fetchStudentPayments,
  isInstallmentPaid,
  installmentCourseFee,
  installmentBalanceDue
} from '../services/payment.service.js?v=1.8.194';

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
  const isSuper = profile && profile.role === 'superadmin';
  const isBranchHead = profile && profile.role === 'branch_head';

  if (!isSuper && !isBranchHead) {
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
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      location.hash = `#/students`;
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

    // 2. Fetch payment doc
    let payment = null;
    if (paymentId === 'latest') {
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
    const isAdmRcpt = pType === 'AD' || pType === 'FULL' || pType === 'MAT' ||
      (payment.receiptNo && (payment.receiptNo === student.admissionReceiptNo || payment.receiptNo === student.receiptNo || payment.receiptNo === student.fullReceiptNo));
    if (isAdmRcpt) {
      const admRoute = (student.ctx === 'school' ? '#/school-admissions/' : '#/admissions/') + studentDocId + '/receipt';
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
    if (student.branchId) {
      try {
        const bSnap = await getDoc(doc(db, 'branches', student.branchId));
        if (bSnap.exists()) branch = bSnap.data();
      } catch (_) {}
    }

    // 4. Fetch all payments for ledger
    const allStudentPayments = await fetchStudentPayments(studentDocId);

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

    renderReceiptHTML({
      student,
      payment,
      org,
      orgLogo,
      branch,
      allPayments: allStudentPayments,
      photoUrl
    });

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
