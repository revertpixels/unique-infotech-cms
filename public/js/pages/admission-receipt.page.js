// Admission receipt page module.
// Loads admission + docs + org from Firestore and renders the receipt sheet.
// Provides getReceiptData(admission, docs, org) shared by the HTML sheet and the PDF.
import { db } from '../config/firebase-config.js';
import { collection, getDocs, query, where, doc, getDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { getReceiptData, fmtMoney } from '../utils/admission-receipt.js?v=1.8.65';

const DOC_KEYS = ['photo', 'signature', 'dobProof', 'marksheet'];

function $(id) { return document.getElementById(id); }

// ---------- page mount ----------
export async function mount({ container, profile }) {
  const sheet = $('ar-sheet');
  const loading = $('ar-loading');
  const notfound = $('ar-notfound');
  const content = $('ar-receipt-content');

  const hash = location.hash;
  const m = hash.match(/^#\/admissions\/([^\/]+)\/receipt$/);
  if (!m) {
    notfound.hidden = false;
    loading.hidden = true;
    return;
  }
  const admissionId = m[1];

  try {
    const snap = await getDoc(doc(db, 'students', admissionId));
    if (!snap.exists()) {
      notfound.hidden = false;
      loading.hidden = true;
      return;
    }
    const admission = Object.assign({ id: snap.id }, snap.data());

    const docsSnap = await getDocs(query(collection(db, 'students', admissionId, 'docs')));
    const docs = {};
    docsSnap.docs.forEach((d) => { docs[d.id] = d.data(); });

    const orgSnap = await getDoc(doc(db, 'settings', 'org_config'));
    const org = orgSnap.exists() ? orgSnap.data() : null;

    renderReceipt(admission, docs, org);
    loading.hidden = true;
    content.hidden = false;
  } catch (e) {
    console.error('[admission-receipt] load failed', e);
    loading.hidden = true;
    notfound.hidden = false;
    const notfoundMsg = notfound.querySelector('p');
    if (notfoundMsg) notfoundMsg.textContent = 'Failed to load receipt: ' + (e.message || 'error');
  }
}

function renderReceipt(admission, docs, org) {
  const data = getReceiptData(admission, docs, org);
  const content = $('ar-receipt-content');

  const logoHtml = data.orgLogo ? ('<img src="' + escapeHtml(data.orgLogo) + '" alt="org logo">')
    : ('<div class="ar-org-logo-initials">' + escapeHtml(initials(data.orgName)) + '</div>');

  const photoHtml = data.photoData ? ('<img src="' + escapeHtml('data:' + (data.photoFmt === 'PNG' ? 'image/png' : 'image/jpeg') + ';base64,' + data.photoData) + '" alt="photo">')
    : ('<div class="ar-doc-photo-empty">No photo</div>');
  const sigHtml = data.sigData ? ('<img src="' + escapeHtml('data:' + (data.sigFmt === 'PNG' ? 'image/png' : 'image/jpeg') + ';base64,' + data.sigData) + '" alt="signature">')
    : ('<div class="ar-doc-sig-caption" style="margin-top:0">No signature</div>');

  const addressLines = data.address ? String(data.address).split(/\n/) : [];
  const addrHtml = addressLines.map(function (l) { return '<div class="ar-org-addr">' + escapeHtml(l) + '</div>'; }).join('');

  const feeRowsHtml = data.feeRows.map(function (r) {
    return '<tr><td>' + escapeHtml(r.head) + '</td><td>' + escapeHtml(r.type) + '</td><td>' + escapeHtml(r.due) + '</td><td class="ar-amount">' + fmtMoney(r.amount) + '</td></tr>';
  }).join('');

  const paymentModeHtml = data.paymentMode ? ('<p class="ar-payment-mode"><strong>Payment mode:</strong> ' + escapeHtml(data.paymentMode) + '</p>') : '';

  content.innerHTML =
    '<div class="ar-receipt">' +
    '<div class="ar-org">' +
    '<div class="ar-org-wrap">' +
    '<div class="ar-org-logo">' + logoHtml + '</div>' +
    '<div class="ar-org-info">' +
    '<h2 class="ar-org-name">' + escapeHtml(data.orgName) + '</h2>' +
    '<p class="ar-org-branch">' + escapeHtml(data.branchName) + '</p>' +
    addrHtml +
    '<p class="ar-org-contact">' + [data.orgPhone, data.orgEmail].filter(Boolean).join('  |  ') + '</p>' +
    '</div>' +
    '</div>' +
    '<div class="ar-rule2"></div>' +
    '</div>' +
    '<div class="ar-title-block">' +
    '<h1 class="ar-receipt-title">ADMISSION RECEIPT</h1>' +
    '<p class="ar-receipt-meta">Receipt no: <strong>' + escapeHtml(data.receiptNo) + '</strong>   |   Date: <strong>' + escapeHtml(data.receiptDate) + '</strong></p>' +
    '</div>' +
    '<div class="ar-section">' +
    '<table class="ar-details-table">' +
    '<tr><td class="ar-label">Admission no</td><td class="ar-value">' + escapeHtml(data.admissionNo) + '</td></tr>' +
    '<tr><td class="ar-label">Student ID</td><td class="ar-value">' + escapeHtml(data.studentId) + '</td></tr>' +
    '<tr><td class="ar-label">Admission date</td><td class="ar-value">' + escapeHtml(data.admissionDate) + '</td></tr>' +
    '<tr><td class="ar-label">Session</td><td class="ar-value">' + escapeHtml(data.sessionName) + '</td></tr>' +
    '<tr><td class="ar-label">Branch</td><td class="ar-value">' + escapeHtml(data.branchName) + '</td></tr>' +
    '<tr><td class="ar-label">Student name</td><td class="ar-value">' + escapeHtml(data.studentName) + '</td></tr>' +
    '<tr><td class="ar-label">Guardian name</td><td class="ar-value">' + escapeHtml(data.guardianName) + '</td></tr>' +
    '<tr><td class="ar-label">Date of birth</td><td class="ar-value">' + escapeHtml(data.dob) + '</td></tr>' +
    '<tr><td class="ar-label">Gender</td><td class="ar-value">' + escapeHtml(data.gender) + '</td></tr>' +
    '<tr><td class="ar-label">Phone</td><td class="ar-value">' + escapeHtml(data.phone) + '</td></tr>' +
    '<tr><td class="ar-label">Alt phone</td><td class="ar-value">' + escapeHtml(data.altPhone) + '</td></tr>' +
    '<tr><td class="ar-label">Email</td><td class="ar-value">' + escapeHtml(data.email) + '</td></tr>' +
    '<tr><td class="ar-label">Highest qualification</td><td class="ar-value">' + escapeHtml(data.qualification) + '</td></tr>' +
    '<tr><td class="ar-label">Address</td><td class="ar-value">' + escapeHtml(data.address || '-') + '</td></tr>' +
    '</table>' +
    '</div>' +
    '<div class="ar-doc-side">' +
    '<div class="ar-doc-box ar-doc-photo">' + photoHtml + '</div>' +
    '<div class="ar-doc-box ar-doc-sig">' + sigHtml + '</div>' +
    '<div class="ar-doc-sig-caption">Student\'s signature</div>' +
    '</div>' +
    '<div class="ar-section ar-section-course">' +
    '<h3 class="ar-section-title">Course</h3>' +
    '<div class="ar-course-row"><span class="ar-course-code">' + escapeHtml(data.courseCode) + '</span><span class="ar-course-name"> - ' + escapeHtml(data.courseName) + '</span></div>' +
    '<div class="ar-course-meta">Batch: ' + escapeHtml(data.batchName) + '</div>' +
    (data.duration ? '<div class="ar-course-meta">Duration: ' + escapeHtml(data.duration) + '</div>' : '') +
    '<div class="ar-prereq-row"><strong>Prerequisite:</strong> ' + escapeHtml(data.prereqLine) + '</div>' +
    '</div>' +
    '<div class="ar-section">' +
    '<h3 class="ar-section-title">Fee structure</h3>' +
    '<table class="ar-fee-table">' +
    '<thead><tr><th style="width:52%">Fee head</th><th style="width:18%">Type</th><th style="width:18%">Due</th><th style="width:12%" class="ar-amount">Amount</th></tr></thead>' +
    '<tbody>' + feeRowsHtml + '</tbody>' +
    '<tr class="ar-total"><td colspan="3">Total course fee</td><td class="ar-amount">' + fmtMoney(data.feeTotal) + '</td></tr>' +
    '</table>' +
    '</div>' +
    '<div class="ar-section">' +
    '<h3 class="ar-section-title">Payment received at admission</h3>' +
    '<table class="ar-payment-table">' +
    '<tr><td>Admission fee</td><td class="ar-amount">' + fmtMoney(data.admissionFee) + '</td></tr>' +
    '<tr><td>Study material fee</td><td class="ar-amount">' + fmtMoney(data.materialFee) + '</td></tr>' +
    '<tr class="ar-total"><td>Total received</td><td class="ar-amount">' + fmtMoney(data.receivedTotal) + '</td></tr>' +
    '</table>' +
    paymentModeHtml +
    '<div class="ar-words-box"><strong>Amount received in words:</strong> Rupees ' + data.amountInWords + '</div>' +
    '</div>' +
    '<div class="ar-summary">' +
    '<div class="ar-summary-card">' +
    '<div class="ar-summary-head">Summary</div>' +
    '<div class="ar-summary-body">' +
    '<div class="ar-summary-row"><span>Total course fee</span><span class="ar-val">' + fmtMoney(data.feeTotal) + '</span></div>' +
    '<div class="ar-summary-row"><span>Received now</span><span class="ar-val">' + fmtMoney(data.receivedTotal) + '</span></div>' +
    '<div class="ar-summary-row ar-double"><span>Balance payable</span><span class="ar-val">' + fmtMoney(data.balance) + '</span></div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<p class="ar-note">Instalments are due on the 10th of each month. Late payment: Rs. 1 per day after the 10th. Exam fee must be paid before the session ends.</p>' +
    '<div class="ar-signatures">' +
    '<div class="ar-sig-line"><div class="ar-sig-rule"></div><div class="ar-sig-label">Student / Guardian signature</div></div>' +
    '<div class="ar-sig-line"><div class="ar-sig-rule"></div><div class="ar-sig-label">Authorised signatory</div></div>' +
    '</div>' +
    '<div class="ar-footer">' +
    '<span>Generated on ' + new Date().toLocaleString() + '</span>' +
    '<span>This is a computer-generated receipt.</span>' +
    '<span>Page 1 of 1</span>' +
    '</div>' +
    '</div>' +
    '</div>';

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Toolbar handlers
  const backBtn = $('ar-back');
  const dlBtn = $('ar-download');
  const prBtn = $('ar-print');
  if (backBtn) backBtn.addEventListener('click', function () { location.hash = '#/admissions'; });
  if (dlBtn) dlBtn.addEventListener('click', async function () {
    try {
      const mod = await import('../utils/admission-receipt.js?v=1.8.65');
      await mod.downloadReceipt(admission, docs, org);
    } catch (e) {
      console.error('[receipt] download failed', e);
    }
  });
  if (prBtn) prBtn.addEventListener('click', function () { window.print(); });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function initials(s) {
  if (!s) return 'UI';
  return String(s).split(/\s+/).map(function (w) { return w.charAt(0); }).slice(0, 2).join('').toUpperCase();
}
