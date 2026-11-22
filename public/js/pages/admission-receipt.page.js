// admission-receipt.page.js — Youth Admission Receipt page module.
// Renders the approved Youth admission receipt (matching reference-templates/Ui.html)
// from saved Firestore snapshots. Provides vector PDF download via pdfmake.
import { db } from '../config/firebase-config.js';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.101';
import { createSelect } from '../components/ui-select.js?v=1.8.101';
import { buildYouthReceiptData, fmtRs } from '../utils/admission-receipt.js?v=1.8.101';
import { downloadYouthReceiptPdf } from '../utils/admission-receipt-pdf.js?v=1.8.101';

const COL = 'students';
let studentDocId = '';
let currentReceiptData = null;
let sessionSelectInstance = null;
let isDownloadingPdf = false;

function $(id) {
  const el = document.getElementById(id);
  if (!el) console.warn('[admission-receipt] missing #' + id);
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
  const isSuper = profile && profile.role === 'superadmin';
  const isBranchHead = profile && profile.role === 'branch_head';
  if (!isSuper && !isBranchHead) {
    showToast({ type: 'error', message: 'Youth Admission Receipt is restricted.' });
    return;
  }

  const sheet = $('ar-sheet');
  const loading = $('ar-loading');
  const notFound = $('ar-notfound');
  if (!sheet || !loading || !notFound) return;

  // Extract docId from hash: #/admissions/<docId>/receipt
  const m = location.hash.match(/#\/admissions\/([^\/#?]+)\/receipt/);
  studentDocId = m && m[1];
  if (!studentDocId) {
    loading.hidden = true;
    notFound.hidden = false;
    return;
  }

  await loadReceipt(studentDocId);
}

async function loadReceipt(docId) {
  const sheet = $('ar-sheet');
  const loading = $('ar-loading');
  const notFound = $('ar-notfound');
  if (!sheet || !loading || !notFound) return;

  loading.hidden = false;
  notFound.hidden = true;
  sheet.innerHTML = '';

  let admission = null;
  let photo = null;
  let signature = null;
  let payment = null;
  let org = {};
  let aadhaar = null;
  let branch = null;
  let course = null;
  let session = null;

  try {
    const [sSnap, orgSnap] = await Promise.all([
      getDoc(doc(db, COL, docId)),
      getDoc(doc(db, 'settings', 'org_config'))
    ]);

    if (!sSnap.exists()) {
      loading.hidden = true;
      notFound.hidden = false;
      return;
    }
    admission = Object.assign({ id: sSnap.id }, sSnap.data());
    if (admission.ctx && admission.ctx !== 'youth') {
      loading.hidden = true;
      notFound.hidden = false;
      return;
    }

    org = orgSnap.exists() ? orgSnap.data() : {};

    // Aadhaar doc (students/<id>/aadhaar/aadhaar)
    try {
      const aSnap = await getDoc(doc(db, COL, docId, 'aadhaar', 'aadhaar'));
      if (aSnap.exists()) aadhaar = aSnap.data();
    } catch (_) { /* non-fatal */ }

    // Payment doc (students/<id>/payment/payment or collection fallback)
    try {
      const pDocSnap = await getDoc(doc(db, COL, docId, 'payment', 'payment'));
      if (pDocSnap.exists()) {
        payment = Object.assign({ id: pDocSnap.id }, pDocSnap.data());
      } else {
        const pColSnap = await getDocs(collection(db, COL, docId, 'payment'));
        if (!pColSnap.empty) {
          const first = pColSnap.docs[0];
          payment = Object.assign({ id: first.id }, first.data());
        }
      }
    } catch (_) { /* non-fatal */ }

    // Docs (photo, signature from subcollection)
    try {
      const [photoSnap, sigSnap] = await Promise.all([
        getDoc(doc(db, COL, docId, 'docs', 'photo')),
        getDoc(doc(db, COL, docId, 'docs', 'signature'))
      ]);
      if (photoSnap.exists()) photo = photoSnap.data();
      if (sigSnap.exists()) signature = sigSnap.data();
    } catch (_) { /* non-fatal */ }

    // Linked docs: branch, course, session
    try {
      const fetchers = [];
      if (admission.branchId) fetchers.push(getDoc(doc(db, 'branches', admission.branchId)));
      else fetchers.push(Promise.resolve(null));

      if (admission.courseId) fetchers.push(getDoc(doc(db, 'courses', admission.courseId)));
      else fetchers.push(Promise.resolve(null));

      if (admission.sessionId) fetchers.push(getDoc(doc(db, 'sessions', admission.sessionId)));
      else fetchers.push(Promise.resolve(null));

      const [bSnap, cSnap, sessSnap] = await Promise.all(fetchers);
      if (bSnap && bSnap.exists()) branch = bSnap.data();
      if (cSnap && cSnap.exists()) course = cSnap.data();
      if (sessSnap && sessSnap.exists()) session = sessSnap.data();
    } catch (_) { /* non-fatal */ }

    // Build standardized receipt data
    currentReceiptData = buildYouthReceiptData({
      admission,
      photo,
      signature,
      org,
      payment,
      aadhaar,
      branch,
      course,
      session
    });

    // Render HTML
    sheet.innerHTML = renderReceiptHtml(currentReceiptData);
    loading.hidden = true;
    notFound.hidden = true;

    // Setup action bar
    setupActionBar(admission);

    // Setup session select
    setupSessionSelect(admission);

    if (typeof lucide !== 'undefined') {
      lucide.createIcons();
    }
  } catch (err) {
    console.error('[admission-receipt] load error', err);
    loading.hidden = true;
    notFound.hidden = false;
    const p = notFound.querySelector('p');
    if (p) p.textContent = 'Could not load receipt: ' + (err.message || 'unknown error');
  }
}

function setupActionBar(admission) {
  const backBtn = $('ar-back');
  const profileBtn = $('ar-profile-btn');
  const downloadBtn = $('ar-download');
  const printBtn = $('ar-print');
  const nfBackBtn = $('ar-nf-back');

  if (backBtn) {
    backBtn.onclick = () => {
      location.hash = '#/admissions';
    };
  }

  if (nfBackBtn) {
    nfBackBtn.onclick = () => {
      location.hash = '#/admissions';
    };
  }

  if (profileBtn) {
    const sid = admission.studentId || '';
    profileBtn.onclick = () => {
      location.hash = '#/students/' + sid;
    };
  }

  if (downloadBtn) {
    downloadBtn.onclick = async () => {
      if (isDownloadingPdf || !currentReceiptData) return;
      isDownloadingPdf = true;
      const originalHtml = downloadBtn.innerHTML;
      downloadBtn.disabled = true;
      downloadBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Preparing...';
      if (typeof lucide !== 'undefined') lucide.createIcons();

      try {
        await downloadYouthReceiptPdf(currentReceiptData);
        showToast({ type: 'success', message: 'Receipt downloaded successfully' });
      } catch (err) {
        console.error('[admission-receipt] PDF download failed', err);
        showToast({
          type: 'error',
          message: 'Could not create PDF. Use Print -> Save as PDF instead.'
        });
      } finally {
        downloadBtn.disabled = false;
        downloadBtn.innerHTML = originalHtml;
        isDownloadingPdf = false;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    };
  }

  if (printBtn) {
    printBtn.onclick = () => {
      window.print();
    };
  }
}

async function setupSessionSelect(admission) {
  const host = $('ar-session-select');
  if (!host) return;
  host.innerHTML = '';

  const studentId = admission.studentId;
  if (!studentId) {
    renderSessionChip(host, admission.sessionName || 'Current session');
    return;
  }

  try {
    const q = query(
      collection(db, COL),
      where('studentId', '==', studentId),
      where('ctx', '==', 'youth')
    );
    const snap = await getDocs(q);

    const admissions = [];
    snap.forEach((d) => {
      admissions.push(Object.assign({ id: d.id }, d.data()));
    });

    if (admissions.length <= 1) {
      renderSessionChip(host, admission.sessionName || 'Current session');
      return;
    }

    const items = admissions.map((adm) => {
      const sName = adm.sessionName || adm.sessionId || 'Session';
      const cCode = adm.courseCode || adm.courseId || '';
      const label = cCode ? `${sName} (${cCode})` : sName;
      return {
        value: adm.id,
        label: label
      };
    });

    sessionSelectInstance = createSelect({
      items,
      value: admission.id,
      icon: 'calendar',
      ariaLabel: 'Switch session receipt',
      onChange: (newDocId) => {
        if (!newDocId || newDocId === studentDocId) return;
        studentDocId = newDocId;
        history.replaceState(null, '', `#/admissions/${newDocId}/receipt`);
        loadReceipt(newDocId);
      }
    });

    host.appendChild(sessionSelectInstance.el);
  } catch (e) {
    console.warn('[admission-receipt] could not query other sessions', e);
    renderSessionChip(host, admission.sessionName || 'Current session');
  }
}

function renderSessionChip(host, sessionName) {
  host.innerHTML = '';
  const chip = document.createElement('div');
  chip.className = 'ar-session-chip';
  const label = sessionName ? `Session: ${sessionName}` : 'Session';
  chip.title = label;
  chip.innerHTML = `<i data-lucide="calendar"></i><span>${escapeHtml(label)}</span>`;
  host.appendChild(chip);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderReceiptHtml(data) {
  const logoHtml = data.orgLogo
    ? `<div class="logo img"><img src="${escapeHtml(data.orgLogo)}" alt="${escapeHtml(data.orgName)} logo"></div>`
    : `<div class="logo"><span>UI</span></div>`;

  const photoHtml = data.photoUrl
    ? `<div class="photo"><img src="${escapeHtml(data.photoUrl)}" alt="Student photo"></div>`
    : `<div class="photo"><span>Photo</span></div>`;

  const sigHtml = data.signatureUrl
    ? `<div class="sig"><img src="${escapeHtml(data.signatureUrl)}" alt="Student signature"></div>`
    : `<div class="sig"><span style="color:var(--muted);font-size:11px">Signature</span></div>`;

  // modules list
  const modsHtml = (data.modules || []).map((m, idx) => `<div><i>${idx + 1}</i>${escapeHtml(m)}</div>`).join('');

  // fee structure rows
  const feeRowsHtml = (data.feeStructureRows || []).map(r => `<tr><td>${escapeHtml(r.head)}</td><td>${escapeHtml(r.due)}</td><td>${fmtRs(r.amount)}</td></tr>`).join('');

  // payment received rows
  const payRowsHtml = (data.paymentReceivedRows || []).map(r => `<tr><td>${escapeHtml(r.description)}</td><td><span class="pill">${escapeHtml(r.status)}</span></td><td>${fmtRs(r.amount)}</td></tr>`).join('');

  return `
<!-- ================= PAGE 1 ================= -->
<div class="ar-page">
  <div class="hd">
    ${logoHtml}
    <div>
      <h1>${escapeHtml(data.orgName)}</h1>
      <div class="iso">${escapeHtml(data.isoLine)}</div>
      <div class="br">${escapeHtml(data.branchName)}</div>
      <div class="ct"><b>${escapeHtml(data.orgName)}:</b> ${escapeHtml(data.orgPhones)} &nbsp;|&nbsp; <b>Email:</b> ${escapeHtml(data.orgEmail)}<br><b>${escapeHtml(data.branchCode)}:</b> ${escapeHtml(data.branchPhones)}</div>
    </div>
  </div>

  <div class="title">Admission Receipt</div>
  <div class="rno">Receipt no: ${escapeHtml(data.receiptNo)} &nbsp;|&nbsp; Date: ${escapeHtml(data.receiptDate)}</div>

  <table class="d">
    <tr><th>Student name</th><td>${escapeHtml(data.studentName)}</td><td class="pc" rowspan="6">${photoHtml}</td></tr>
    <tr><th>Guardian name</th><td>${escapeHtml(data.guardianName)}</td></tr>
    <tr><th>Date of birth</th><td>${escapeHtml(data.dob)}</td></tr>
    <tr><th>Gender</th><td>${escapeHtml(data.gender)}</td></tr>
    <tr><th>Mobile number</th><td>${escapeHtml(data.phone)}</td></tr>
    <tr><th>Alt. mobile number</th><td>${escapeHtml(data.altPhone)}</td></tr>
    <tr><th>Email</th><td>${escapeHtml(data.email)}</td><td class="pc" rowspan="4">${sigHtml}<div class="cap">Student's signature</div></td></tr>
    <tr><th>Qualification</th><td>${escapeHtml(data.qualification)}</td></tr>
    <tr><th>Address</th><td>${escapeHtml(data.address)}</td></tr>
    <tr><th>Aadhaar No.</th><td>${escapeHtml(data.aadhaarMasked)}</td></tr>
    <tr><th>Admission no</th><td colspan="2">${escapeHtml(data.studentId)}</td></tr>
    <tr><th>Student ID</th><td colspan="2">${escapeHtml(data.studentId)}</td></tr>
    <tr><th>Admission date</th><td colspan="2">${escapeHtml(data.admissionDate)}</td></tr>
    <tr><th>Course</th><td colspan="2">${escapeHtml(data.courseFullName)}</td></tr>
    <tr><th>Course code</th><td colspan="2">${escapeHtml(data.courseCode)}</td></tr>
    <tr><th>Duration</th><td colspan="2">${escapeHtml(data.duration)}</td></tr>
    <tr><th>Batch</th><td colspan="2">${escapeHtml(data.batchName)}</td></tr>
    <tr><th>Session</th><td colspan="2">${escapeHtml(data.sessionName)}</td></tr>
    <tr><th>Session begins</th><td colspan="2">${escapeHtml(data.sessionBegins)}</td></tr>
    <tr><th>Session ends</th><td colspan="2">${escapeHtml(data.sessionEnds)}</td></tr>
    <tr><th>Branch</th><td colspan="2">${escapeHtml(data.branchName)}</td></tr>
    <tr><th>Branch address</th><td colspan="2">${escapeHtml(data.branchAddress)}</td></tr>
  </table>

  <div class="sec sp1">
    <h4>
      <span class="ht">
        <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        Course syllabus
      </span>
      <small>${escapeHtml(data.courseCode)} - ${escapeHtml(data.duration)}</small>
    </h4>
    <div class="mods">
      ${modsHtml}
    </div>
  </div>

  <div class="ft">
    <span>${escapeHtml(data.orgName)} &nbsp;|&nbsp; Generated on ${escapeHtml(data.generatedDate)}</span>
    <span>Page 1 of 2</span>
  </div>
</div>

<!-- ================= PAGE 2 ================= -->
<div class="ar-page">
  <div class="mini">
    <div class="l">
      ${logoHtml}
      <div><b>${escapeHtml(data.orgName)}</b><span>${escapeHtml(data.branchName)}</span></div>
    </div>
    <div class="r">Receipt no: <b>${escapeHtml(data.receiptNo)}</b><br>Student: <b>${escapeHtml(data.studentName)}</b> &nbsp;|&nbsp; ID: <b>${escapeHtml(data.studentId)}</b></div>
  </div>

  <div class="sec">
    <h4>
      <span class="ht">
        <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/></svg>
        Fee structure
      </span>
    </h4>
    <table class="fe">
      <thead><tr><th>Fee head</th><th>Due</th><th>Amount</th></tr></thead>
      <tbody>
        ${feeRowsHtml}
      </tbody>
      <tfoot><tr><td colspan="2">Total course fee</td><td>${fmtRs(data.totalCourseFee ?? data.feeTotal)}</td></tr></tfoot>
    </table>
  </div>

  <div class="sec sp2">
    <h4>
      <span class="ht">
        <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
        Payment received at admission
      </span>
      <small>Date: ${escapeHtml(data.receiptDate)}</small>
    </h4>
    <table class="fe">
      <thead><tr><th>Description</th><th>Status</th><th>Amount</th></tr></thead>
      <tbody>
        ${payRowsHtml}
      </tbody>
    </table>
    <div class="pbox">
      <div class="pcell"><em>Total received</em><b>${fmtRs(data.receivedAmount)}</b><span class="w">(${escapeHtml(data.amountInWords)})</span></div>
      <div class="pcell bal"><em>Balance due</em><b>${fmtRs(data.balanceDue)}</b><span class="w">(${escapeHtml(data.balanceDueWords)})</span></div>
    </div>
    <div class="imp">
      <div><b>Important - Examination fee:</b> The examination fee is not included in the total course fee shown above. It will be charged as per the Government order in force at the time of the examination, and is payable in addition to the balance due.</div>
    </div>
  </div>

  <div class="sec sp2">
    <h4>
      <span class="ht">
        <svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/></svg>
        Terms &amp; conditions
      </span>
    </h4>
    <ol class="terms">
      <li>Prerequisite: no prior qualification or computer knowledge is required for this course.</li>
      <li>Examination: the examination will be held as per notice after completion of the course.</li>
      <li>Certification: the certificate is issued only on passing the examination.</li>
      <li>Fees once paid are not refundable or transferable.</li>
      <li>Instalments must be paid on or before the due date. A late fine of Rs. 1 per day will be charged after the due date.</li>
      <li>The examination fee, as notified, must be paid before the student can appear for the examination.</li>
      <li>Keep this receipt safe. It is required for all future payments and certificate collection. Please remember your Student ID (${escapeHtml(data.studentId)}), as it is needed to pay your instalments in our system.</li>
      <li>This is a computer-generated receipt and is valid with the authorised signature.</li>
    </ol>
  </div>

  <div class="sigs">
    <div>Student's signature</div>
    <div>Authorised signatory</div>
  </div>
  <div class="note">Thank you for choosing Unique Infotech. We wish you success in your course.</div>
  <div class="ft">
    <span>${escapeHtml(data.orgName)} &nbsp;|&nbsp; Generated on ${escapeHtml(data.generatedDate)}</span>
    <span>Page 2 of 2</span>
  </div>
</div>
`;
}
