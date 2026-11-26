// school-admission-receipt.page.js � Renders the approved Kids admission receipt
// (matching reference-templates/uk.html design) from saved Firestore snapshots.
// Scope: Super Admin.
import { db } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.170';
import { createSelect } from '../components/ui-select.js?v=1.8.170';
import { formatDateIN } from '../utils/formatter.js?v=1.8.170';
import { buildSchoolReceiptData, fmtRs } from '../utils/school-receipt.js?v=1.8.170';
import { downloadSchoolReceiptPdf } from '../utils/school-receipt-pdf.js?v=1.8.170';

const COL = 'students';
let studentDocId = '';
let currentReceiptData = null;
let currentStudentId = '';
let courseSelectInstance = null;
let isDownloadingPdf = false;

function $(id) {
  const el = document.getElementById(id);
  if (!el) console.warn('[school-admission-receipt] missing #' + id);
  return el;
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

export async function mount({ container, profile, ctx }) {
  const isAllowed = profile && (profile.role === 'superadmin' || profile.role === 'school_head');
  if (!isAllowed) {
    showToast({ type: 'error', message: 'Kids Admission Receipt is restricted.' });
    return;
  }

  const sheet = $('uk-sheet');
  const loading = $('uk-loading');
  const notFound = $('uk-notfound');
  if (!sheet || !loading || !notFound) return;

  // Extract docId from hash: #/school-admissions/<docId>/receipt
  const m = location.hash.match(/#\/school-admissions\/([^\/#?]+)\/receipt/);
  studentDocId = m && m[1];
  if (!studentDocId) {
    loading.hidden = true;
    notFound.hidden = false;
    return;
  }

  loading.hidden = false;
  notFound.hidden = true;
  sheet.innerHTML = '';

  let admission = null;
  let photo = null;
  let signature = null;
  let payment = null;
  let org = {};
  let aadhaar = null;

  try {
    const [sSnap, orgSnap] = await Promise.all([
      getDoc(doc(db, COL, studentDocId)),
      getDoc(doc(db, 'settings', 'org_config'))
    ]);

    if (!sSnap.exists()) {
      loading.hidden = true;
      notFound.hidden = false;
      return;
    }
    admission = Object.assign({ id: sSnap.id }, sSnap.data());
    if (admission.ctx && admission.ctx !== 'school') {
      loading.hidden = true;
      notFound.hidden = false;
      return;
    }

    org = orgSnap.exists() ? orgSnap.data() : {};
    currentStudentId = admission.studentId || '';

    // Aadhaar doc (students/<id>/aadhaar/aadhaar)
    try {
      const aSnap = await getDoc(doc(db, COL, studentDocId, 'aadhaar', 'aadhaar'));
      if (aSnap.exists()) aadhaar = aSnap.data();
    } catch (_) { /* non-fatal */ }

    // Payment doc (students/<id>/payment/payment or collection fallback)
    try {
      const pDocSnap = await getDoc(doc(db, COL, studentDocId, 'payment', 'payment'));
      if (pDocSnap.exists()) {
        payment = Object.assign({ id: pDocSnap.id }, pDocSnap.data());
      } else {
        const pColSnap = await getDocs(collection(db, COL, studentDocId, 'payment'));
        if (pColSnap.docs.length > 0) {
          payment = Object.assign({ id: pColSnap.docs[0].id }, pColSnap.docs[0].data());
        }
      }
    } catch (_) { /* non-fatal */ }

    // Media docs (photo & signature)
    try {
      const [phSnap, sgSnap] = await Promise.all([
        getDoc(doc(db, COL, studentDocId, 'docs', 'photo')),
        getDoc(doc(db, COL, studentDocId, 'docs', 'signature'))
      ]);
      if (phSnap.exists()) photo = Object.assign({ id: phSnap.id }, phSnap.data());
      if (sgSnap.exists()) signature = Object.assign({ id: sgSnap.id }, sgSnap.data());
    } catch (_) { /* non-fatal */ }

  } catch (e) {
    console.error('[school-admission-receipt] load failed', e);
    loading.hidden = true;
    notFound.hidden = false;
    showToast({ type: 'error', message: 'Could not load receipt: ' + (e.message || e.code || e) });
    return;
  }

  loading.hidden = true;
  const data = buildSchoolReceiptData({ admission, photo, signature, org, payment, aadhaar });
  currentReceiptData = data;
  renderReceipt(sheet, data);

  // Setup Toolbar buttons
  const backBtn = $('uk-back');
  if (backBtn) backBtn.onclick = () => { location.hash = '#/school-admissions'; };
  const nfBackBtn = $('uk-nf-back');
  if (nfBackBtn) nfBackBtn.onclick = () => { location.hash = '#/school-admissions'; };
  const printBtn = $('uk-print');
  if (printBtn) printBtn.onclick = () => { window.print(); };
  const dlBtn = $('uk-download');
  if (dlBtn) dlBtn.onclick = downloadPdf;

  const profBtn = $('uk-profile-btn');
  if (profBtn) {
    profBtn.onclick = () => {
      showToast({ type: 'info', message: 'Student profile page is coming next' });
    };
  }

  // Course dropdown: load sibling course admissions for this child
  await setupCourseSelect(admission);
}

async function setupCourseSelect(admission) {
  const courseHost = $('uk-course-select');
  if (!courseHost) return;

  let siblingDocs = [];
  if (admission.studentId) {
    try {
      const qSnap = await getDocs(query(
        collection(db, COL),
        where('studentId', '==', admission.studentId)
      ));
      siblingDocs = qSnap.docs
        .map(d => Object.assign({ id: d.id }, d.data()))
        .filter(d => !d.ctx || d.ctx === 'school');
    } catch (e) {
      console.warn('[school-admission-receipt] query sibling courses failed', e);
      siblingDocs = [admission];
    }
  }

  if (!siblingDocs.some(d => d.id === admission.id)) {
    siblingDocs.unshift(admission);
  }

  // Sort newest admissionDate first
  siblingDocs.sort((a, b) => {
    const da = a.admissionDate || '';
    const db = b.admissionDate || '';
    if (db !== da) return db.localeCompare(da);
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  const courseOptions = siblingDocs.map(s => {
    const level = s.courseLevelName || s.courseName || s.level || 'Course';
    const date = s.admissionDate ? formatDateIN(s.admissionDate) : '-';
    const rawStatus = s.status || 'active';
    const status = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
    return {
      value: s.id,
      label: `${level} - ${date} - ${status}`,
      icon: 'book-open'
    };
  });

  let selectedDocId = admission.id;
  if (studentDocId && siblingDocs.some(s => s.id === studentDocId)) {
    selectedDocId = studentDocId;
  } else {
    const activeCourse = siblingDocs.find(s => s.status === 'active' || s.status === 'break');
    selectedDocId = activeCourse ? activeCourse.id : siblingDocs[0].id;
  }

  courseHost.textContent = '';
  courseSelectInstance = createSelect(courseHost, {
    options: courseOptions,
    value: selectedDocId,
    onChange: (newDocId) => {
      if (newDocId !== studentDocId) {
        switchReceiptCourse(newDocId);
      }
    }
  });

  if (courseOptions.length <= 1) {
    const btn = courseHost.querySelector('.ui-select-btn');
    if (btn) btn.disabled = true;
    courseHost.classList.add('disabled');
  } else {
    courseHost.classList.remove('disabled');
  }
}

async function switchReceiptCourse(newDocId) {
  const sheet = $('uk-sheet');
  const loading = $('uk-loading');
  if (!sheet) return;

  studentDocId = newDocId;
  history.replaceState(null, '', '#/school-admissions/' + newDocId + '/receipt');

  try {
    const [sSnap, orgSnap] = await Promise.all([
      getDoc(doc(db, COL, newDocId)),
      getDoc(doc(db, 'settings', 'org_config'))
    ]);

    if (!sSnap.exists()) {
      showToast({ type: 'error', message: 'Could not load selected course receipt.' });
      return;
    }
    const admission = Object.assign({ id: sSnap.id }, sSnap.data());
    const org = orgSnap.exists() ? orgSnap.data() : {};

    let aadhaar = null;
    try {
      const aSnap = await getDoc(doc(db, COL, newDocId, 'aadhaar', 'aadhaar'));
      if (aSnap.exists()) aadhaar = aSnap.data();
    } catch (_) { /* non-fatal */ }

    let payment = null;
    try {
      const pDocSnap = await getDoc(doc(db, COL, newDocId, 'payment', 'payment'));
      if (pDocSnap.exists()) {
        payment = Object.assign({ id: pDocSnap.id }, pDocSnap.data());
      } else {
        const pColSnap = await getDocs(collection(db, COL, newDocId, 'payment'));
        if (pColSnap.docs.length > 0) {
          payment = Object.assign({ id: pColSnap.docs[0].id }, pColSnap.docs[0].data());
        }
      }
    } catch (_) { /* non-fatal */ }

    let photo = null;
    let signature = null;
    try {
      const [phSnap, sgSnap] = await Promise.all([
        getDoc(doc(db, COL, newDocId, 'docs', 'photo')),
        getDoc(doc(db, COL, newDocId, 'docs', 'signature'))
      ]);
      if (phSnap.exists()) photo = Object.assign({ id: phSnap.id }, phSnap.data());
      if (sgSnap.exists()) signature = Object.assign({ id: sgSnap.id }, sgSnap.data());
    } catch (_) { /* non-fatal */ }

    const data = buildSchoolReceiptData({ admission, photo, signature, org, payment, aadhaar });
    currentReceiptData = data;
    renderReceipt(sheet, data);
    if (courseSelectInstance) {
      courseSelectInstance.value = newDocId;
    }
  } catch (err) {
    console.error('[school-admission-receipt] switch course failed', err);
    showToast({ type: 'error', message: 'Failed to switch course receipt: ' + (err.message || err) });
  }
}

function renderReceipt(container, d) {
  const stage = document.createElement('div');
  stage.className = 'uk-stage';

  // ==========================================
  // PAGE 1: STUDENT DETAILS & REGISTRATION
  // ==========================================
  const p1 = document.createElement('div');
  p1.className = 'uk-page';

  // Header
  const hd = document.createElement('div');
  hd.className = 'uk-hd';
  hd.innerHTML = `
    <div class="uk-logo">
      <span>UI</span>
      <img src="/assets/images/logo.jpg" alt="${escapeHtml(d.orgName)} logo" onload="this.parentNode.classList.add('img');if(this.previousElementSibling)this.previousElementSibling.remove();" onerror="this.remove()">
    </div>
    <div>
      <h1>${escapeHtml(d.orgName)}</h1>
      <div class="uk-iso">${escapeHtml(d.isoLine)}</div>
      <div class="uk-br">${escapeHtml(d.programLine)}</div>
      <div class="uk-ct">
        <b>${escapeHtml(d.orgName)}:</b> ${escapeHtml(d.orgPhones.join(', '))} &nbsp;|&nbsp; <b>Email:</b> ${escapeHtml(d.orgEmail)}
      </div>
    </div>
  `;

  // Receipt Title & Meta
  const title = document.createElement('div');
  title.className = 'uk-title';
  title.textContent = 'Admission Receipt';

  const rno = document.createElement('div');
  rno.className = 'uk-rno';
  rno.innerHTML = `Receipt no: <b>${escapeHtml(d.receiptNo)}</b> &nbsp;|&nbsp; Date: <b>${escapeHtml(d.admissionDate)}</b>`;

  // Student Details Table (with Aadhaar No. and Student's signature)
  const table = document.createElement('table');
  table.className = 'uk-d';

  const photoHtml = d.photoUrl
    ? `<img src="${d.photoUrl}" alt="Student photo">`
    : `<span>Photo</span>`;

  const sigHtml = d.signatureUrl
    ? `<img src="${d.signatureUrl}" alt="Student's signature">`
    : `<span style="color:var(--muted);font-size:11px;">Signature</span>`;

  table.innerHTML = `
    <tbody>
      <tr>
        <th>Student name</th>
        <td><b>${escapeHtml(d.studentName)}</b></td>
        <td class="uk-pc" rowspan="7">
          <div class="uk-photo">${photoHtml}</div>
        </td>
      </tr>
      <tr>
        <th>Parent / Guardian</th>
        <td>${escapeHtml(d.guardianName)}</td>
      </tr>
      <tr>
        <th>Date of birth</th>
        <td>${escapeHtml(d.dob)}</td>
      </tr>
      <tr>
        <th>Aadhaar No.</th>
        <td>${escapeHtml(d.aadhaar)}</td>
      </tr>
      <tr>
        <th>Gender</th>
        <td>${escapeHtml(d.gender)}</td>
      </tr>
      <tr>
        <th>Mobile number</th>
        <td>${escapeHtml(d.phone)}</td>
      </tr>
      <tr>
        <th>Alt. mobile number</th>
        <td>${escapeHtml(d.altPhone)}</td>
      </tr>
      <tr>
        <th>Class / Standard</th>
        <td>${escapeHtml(d.schoolClass)}</td>
        <td class="uk-pc" rowspan="3">
          <div class="uk-sig">${sigHtml}</div>
          <div class="uk-cap">Student's signature</div>
        </td>
      </tr>
      <tr>
        <th>School name</th>
        <td>${escapeHtml(d.schoolName)}</td>
      </tr>
      <tr>
        <th>Address</th>
        <td>${escapeHtml(d.address)}</td>
      </tr>
      <tr>
        <th>Admission no</th>
        <td colspan="2">${escapeHtml(d.admissionNo)}</td>
      </tr>
      <tr>
        <th>Student ID</th>
        <td colspan="2"><b>${escapeHtml(d.studentId)}</b></td>
      </tr>
      <tr>
        <th>Admission date</th>
        <td colspan="2">${escapeHtml(d.admissionDate)}</td>
      </tr>
      <tr>
        <th>Level</th>
        <td colspan="2">${escapeHtml(d.level)}</td>
      </tr>
      <tr>
        <th>Batch</th>
        <td colspan="2">${escapeHtml(d.batch)}</td>
      </tr>
      <tr>
        <th>First monthly bill</th>
        <td colspan="2">${escapeHtml(d.firstMonthlyMonthFormatted)}</td>
      </tr>
      <tr>
        <th>Monthly fee due</th>
        <td colspan="2">By the 10th of every month</td>
      </tr>
      <tr>
        <th>Centre</th>
        <td colspan="2">${escapeHtml(d.centreName)}</td>
      </tr>
      <tr>
        <th>Centre address</th>
        <td colspan="2">${escapeHtml(d.centreAddress)}</td>
      </tr>
    </tbody>
  `;

  // Page 1 Footer
  const ft1 = document.createElement('div');
  ft1.className = 'uk-ft';
  ft1.innerHTML = `<span>Unique Kids &nbsp;|&nbsp; Generated on ${escapeHtml(d.today)}</span><span>Page 1 of 2</span>`;

  p1.append(hd, title, rno, table, ft1);

  // ==========================================
  // PAGE 2: FEES, PAYMENT & TERMS
  // ==========================================
  const p2 = document.createElement('div');
  p2.className = 'uk-page';

  // Mini Header
  const mini = document.createElement('div');
  mini.className = 'uk-mini';
  mini.innerHTML = `
    <div class="l">
      <div class="uk-logo">
        <span>UI</span>
        <img src="/assets/images/logo.jpg" alt="${escapeHtml(d.orgName)} logo" onload="this.parentNode.classList.add('img');if(this.previousElementSibling)this.previousElementSibling.remove();" onerror="this.remove()">
      </div>
      <div>
        <b>${escapeHtml(d.orgName)}</b>
        <span>${escapeHtml(d.programLine)}</span>
      </div>
    </div>
    <div class="r">
      Receipt no: <b>${escapeHtml(d.receiptNo)}</b><br>
      Student: <b>${escapeHtml(d.studentName)}</b> &nbsp;|&nbsp; ID: <b>${escapeHtml(d.studentId)}</b>
    </div>
  `;

  // Section 1: Fee structure
  const sec1 = document.createElement('div');
  sec1.className = 'uk-sec';
  sec1.innerHTML = `
    <h4>
      <span class="uk-ht">
        <svg class="uk-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>
        Fee structure
      </span>
      <small>${escapeHtml(d.level)} level</small>
    </h4>
    <table class="uk-fe">
      <thead><tr><th>Fee head</th><th>Due</th><th>Amount</th></tr></thead>
      <tbody>
        <tr><td>Admission fee (one-time)</td><td>At admission</td><td>${fmtRs(d.configuredAdmissionFee)}</td></tr>
      </tbody>
      <tfoot>
        <tr><td colspan="2">Payable at admission</td><td>${fmtRs(d.configuredAdmissionFee)}</td></tr>
      </tfoot>
    </table>
  `;

  // Section 2: Payment received at admission
  const sec2 = document.createElement('div');
  sec2.className = 'uk-sec sp2';

  let paymentRows = '';
  if (d.paymentMode === 'difference') {
    paymentRows = `
      <tr><td>Configured admission fee</td><td><span class="uk-pill">Payable</span></td><td>${fmtRs(d.configuredAdmissionFee)}</td></tr>
      <tr><td>Eligible prior admission payment</td><td><span class="uk-pill">Adjusted</span></td><td>- ${fmtRs(d.eligiblePriorAdmissionPayments)}</td></tr>
      <tr><td>Admission fee difference paid</td><td><span class="uk-pill">Paid</span></td><td>${fmtRs(d.actualAmountReceived)}</td></tr>
    `;
  } else if (d.paymentMode === 'none') {
    paymentRows = `
      <tr><td>Admission fee (one-time)</td><td><span class="uk-pill due">No payment (${escapeHtml(d.noPaymentReasonFormatted)})</span></td><td>${fmtRs(0)}</td></tr>
    `;
  } else {
    // Full payment
    paymentRows = `
      <tr><td>Admission fee (one-time)</td><td><span class="uk-pill">Paid</span></td><td>${fmtRs(d.actualAmountReceived)}</td></tr>
    `;
  }

  sec2.innerHTML = `
    <h4>
      <span class="uk-ht">
        <svg class="uk-ic" viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
        Payment received at admission
      </span>
      <small>Date: ${escapeHtml(d.admissionDate)}</small>
    </h4>
    <table class="uk-fe">
      <thead><tr><th>Description</th><th>Status</th><th>Amount</th></tr></thead>
      <tbody>
        ${paymentRows}
      </tbody>
    </table>
    <div class="uk-pbox">
      <div class="uk-pcell">
        <em>Total received</em>
        <b>${fmtRs(d.actualAmountReceived)}</b>
        <span class="w">(${escapeHtml(d.amountInWords)})</span>
      </div>
      <div class="uk-pcell bal">
        <em>Monthly fee</em>
        <b>${fmtRs(d.monthlyFee)}</b>
        <span class="w">per month, due by the 10th</span>
      </div>
    </div>
    <div class="uk-imp">
      <div>
        <b>Important - Monthly fee:</b> The monthly fee is not included in the amount received today. It must be paid on or before the 10th of every month. A late fine of Rs. 1 per day is charged after the 10th. First monthly bill starts from ${escapeHtml(d.firstMonthlyMonthFormatted)}.
      </div>
    </div>
  `;

  // Section 3: Terms & conditions
  const sec3 = document.createElement('div');
  sec3.className = 'uk-sec sp2';
  sec3.innerHTML = `
    <h4>
      <span class="uk-ht">
        <svg class="uk-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/></svg>
        Terms &amp; conditions
      </span>
    </h4>
    <ol class="uk-terms">
      <li>Eligibility: no prior computer knowledge is required for this programme.</li>
      <li>The monthly fee must be paid on or before the 10th of every month. A late fine of Rs. 1 per day will be charged after the 10th.</li>
      <li>Fees once paid are not refundable or transferable.</li>
      <li>Study material, once issued, is not returnable.</li>
      <li>Keep this receipt safe. It is required for all future payments. Please remember your Student ID (${escapeHtml(d.studentId)}), as it is needed to pay the monthly fee in our system.</li>
      <li>This is a computer-generated receipt and is valid with the authorised signature.</li>
    </ol>
  `;

  // Signatures Area � "Issued by: <email>" removed; Student's signature
  const sigs = document.createElement('div');
  sigs.className = 'uk-sigs';
  sigs.innerHTML = `
    <div>Student's signature</div>
    <div>Authorised signatory</div>
  `;

  // Note
  const note = document.createElement('div');
  note.className = 'uk-note';
  note.textContent = 'Thank you for choosing Unique Kids. We wish your child a joyful and successful learning journey.';

  // Page 2 Footer
  const ft2 = document.createElement('div');
  ft2.className = 'uk-ft';
  ft2.innerHTML = `<span>Unique Kids &nbsp;|&nbsp; Generated on ${escapeHtml(d.today)}</span><span>Page 2 of 2</span>`;

  p2.append(mini, sec1, sec2, sec3, sigs, note, ft2);

  stage.append(p1, p2);
  container.innerHTML = '';
  container.appendChild(stage);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function downloadPdf() {
  if (isDownloadingPdf) return;
  const btn = $('uk-download');
  if (!btn) return window.print();

  isDownloadingPdf = true;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Preparing...';
  if (typeof lucide !== 'undefined') lucide.createIcons();

  try {
    const safeReceiptNo = String((currentReceiptData && currentReceiptData.receiptNo) || studentDocId || 'Receipt')
      .replace(/\//g, '')
      .trim()
      .replace(/\s+/g, '_');
    const safeStudentName = String((currentReceiptData && currentReceiptData.studentName) || 'STUDENT')
      .replace(/\//g, '')
      .trim()
      .replace(/\s+/g, '_')
      .toUpperCase();
    const fileName = `Receipt_${safeReceiptNo}_${safeStudentName}.pdf`;

    await downloadSchoolReceiptPdf(currentReceiptData, fileName);
    showToast({ type: 'success', message: 'Receipt downloaded' });
  } catch (err) {
    console.error('[school-admission-receipt] downloadPdf failed', err);
    showToast({ type: 'error', message: 'Could not create PDF' });
  } finally {
    isDownloadingPdf = false;
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}
