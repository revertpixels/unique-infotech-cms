// school-admission-receipt.page.js — Renders the approved Kids admission receipt
// (reference-templates/uk.html design) from saved snapshots. Scope: Super Admin.
// Reads: students/<id>, students/<id>/docs (photo, signature), students/<id>/payment,
// settings/org_config. Never shows full Aadhaar.
import { db } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.71';
import { buildSchoolReceiptData } from '../utils/school-receipt.js?v=1.8.71';

const COL = 'students';
const DOC_KEYS = ['photo', 'signature'];

let studentId = '';

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-admission-receipt] missing #' + id); return el; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function icon(name) { const i = document.createElement('i'); i.setAttribute('data-lucide', name); return i; }

export async function mount({ container, profile, ctx }) {
  const isSuper = profile && profile.role === 'superadmin';
  if (!isSuper) {
    showToast({ type: 'error', message: 'Kids Admission Receipt is restricted to Super Admin.' });
    return;
  }

  const sheet = $('uk-sheet');
  const loading = $('uk-loading');
  const notFound = $('uk-notfound');
  if (!sheet || !loading || !notFound) return;

  // studentId from route hash: #/school-admissions/<studentId>/receipt
  const m = location.hash.match(/#\/school-admissions\/([^\/#?]+)\/receipt/);
  studentId = m && m[1];
  if (!studentId) {
    loading.hidden = true;
    notFound.hidden = false;
    return;
  }

  let admission, photo, signature, payment, org;
  try {
    const [sSnap, orgSnap] = await Promise.all([
      getDoc(doc(db, COL, studentId)),
      getDoc(doc(db, 'settings', 'org_config'))
    ]);
    admission = sSnap.exists() ? Object.assign({ id: sSnap.id }, sSnap.data()) : null;
    org = orgSnap && orgSnap.exists() ? orgSnap.data() : {};
    if (!admission || admission.ctx !== 'school') {
      loading.hidden = true;
      notFound.hidden = false;
      return;
    }
    const [pSnap, phSnap, sgSnap] = await Promise.all([
      getDocs(query(collection(doc(db, COL, studentId), 'payment'))),
      getDoc(doc(db, COL, studentId, 'docs', 'photo')),
      getDoc(doc(db, COL, studentId, 'docs', 'signature'))
    ]);
    payment = pSnap.docs.length ? Object.assign({ id: pSnap.docs[0].id }, pSnap.docs[0].data()) : null;
    photo = phSnap.exists() ? Object.assign({ id: phSnap.id }, phSnap.data()) : null;
    signature = sgSnap.exists() ? Object.assign({ id: sgSnap.id }, sgSnap.data()) : null;
  } catch (e) {
    console.error('[school-admission-receipt] load failed', e);
    loading.hidden = true;
    notFound.hidden = false;
    showToast({ type: 'error', message: 'Could not load receipt (' + (e.code || 'error') + ').' });
    return;
  }

  loading.hidden = true;
  const data = buildSchoolReceiptData({ admission, photo, signature, org, payment });
  renderSheet(sheet, data);

  $('uk-back').addEventListener('click', () => { location.hash = '#/school-admissions'; });
  $('uk-print').addEventListener('click', () => { window.print(); });
  $('uk-download').addEventListener('click', downloadPdf);
}

function renderSheet(sheet, d) {
  sheet.innerHTML = '';
  const stage = mk('div', 'uk-stage');

  // ---------------- PAGE 1 ----------------
  const p1 = mk('div', 'uk-page');

  const hd = mk('div', 'uk-hd');
  const logo = mk('div', 'uk-logo uk-receipt-logo');
  const logoImg = mk('img');
  logoImg.src = '/assets/images/logo.jpg';
  logoImg.alt = 'Unique Infotech logo';
  logoImg.onload = function () { this.parentNode.classList.add('img'); if(this.previousElementSibling) this.previousElementSibling.remove(); };
  logoImg.onerror = function () { this.remove(); };
  logo.appendChild(logoImg);
  const hdInfo = mk('div');
  const h1 = mk('h1');
  h1.textContent = (d.orgName || 'Unique Infotech');
  const iso = mk('div', 'uk-iso');
  iso.textContent = 'An ISO 9001:2015 Certified Organisation';
  const br = mk('div', 'uk-br');
  br.textContent = 'SCHOOL COMPUTER PROGRAM (UNIQUE KIDS)';
  const ct = mk('div', 'uk-ct');
  ct.innerHTML = '<b>' + escapeHtml(d.orgName || 'Unique Infotech') + ':</b> ' + escapeHtml(d.orgPhones.join(', ')) + ' &nbsp;|&nbsp; <b>Email:</b> ' + escapeHtml(d.orgEmail || 'utpal.goutam@gmail.com');
  hdInfo.append(h1, iso, br, ct);
  hd.append(logo, hdInfo);

  const title = mk('div', 'uk-title');
  title.textContent = 'Admission Receipt';

  const rno = mk('div', 'uk-rno');
  rno.textContent = 'Receipt no: ' + escapeHtml(d.receiptNo) + '  |  Date: ' + (d.today || '');

  const table = mk('table', 'uk-d');
  const rows = [
    ['Student name', d.studentName],
    ['Parent / Guardian', d.guardianName],
    ['Date of birth', d.dob],
    ['Gender', d.gender],
    ['Mobile number', d.phone],
    ['Alt. mobile number', d.altPhone],
    ['Class / Standard', d.schoolClass],
    ['School name', 'Unique Kids'],
    ['Address', d.address],
    ['Student ID', d.studentId],
    ['Admission date', d.admissionDate],
    ['Level', d.level],
    ['Batch', d.batch],
    ['Monthly fees start', d.firstMonthly],
    ['Monthly payment due', 'By the 10th of every month'],
    ['Programme', 'Ongoing'],
    ['Centre', 'Unique Kids - School Computer Program (Head Office campus)'],
    ['Centre address', 'Ailakandi, Kenduadihi, Bankura, West Bengal - 722101']
  ];
  rows.forEach(([label, value], i) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = label;
    tr.appendChild(th);
    const td = document.createElement('td');
    td.textContent = value || '-';
    tr.appendChild(td);
    // photo cell after row 0 (Student name), signature cell after row 6 (Class / Standard) -> matches uk.html rows
    if (i === 0) {
      const pc = document.createElement('td');
      pc.className = 'uk-pc';
      pc.rowSpan = 6;
      const photoBox = mk('div', 'uk-photo');
      if (d.photoUrl) {
        const img = document.createElement('img');
        img.src = d.photoUrl;
        photoBox.appendChild(img);
      } else {
        photoBox.textContent = 'Photo';
      }
      pc.appendChild(photoBox);
      tr.appendChild(pc);
    }
    if (i === 6) {
      const pc = document.createElement('td');
      pc.className = 'uk-pc';
      pc.rowSpan = 3;
      const sigBox = mk('div', 'uk-sig');
      const img = document.createElement('img');
      if (d.signatureUrl) {
        img.src = d.signatureUrl;
        sigBox.appendChild(img);
      }
      const cap = mk('div', 'uk-cap');
      cap.textContent = "Student's signature";
      sigBox.appendChild(cap);
      pc.appendChild(sigBox);
      tr.appendChild(pc);
    }
    table.appendChild(tr);
  });

  const ft1 = mk('div', 'uk-ft');
  ft1.innerHTML = '<span>Unique Kids &nbsp;|&nbsp; Generated on ' + escapeHtml(d.today || '') + '</span><span>Page 1 of 2</span>';

  p1.append(hd, title, rno, table, ft1);

  // ---------------- PAGE 2 ----------------
  const p2 = mk('div', 'uk-page');

  const mini = mk('div', 'uk-mini');
  const miniL = mk('div', 'uk-l');
  const mlogo = mk('div', 'uk-logo uk-mini-logo');
  const mlogoImg = document.createElement('img');
  mlogoImg.src = '/assets/images/logo.jpg';
  mlogoImg.alt = 'Unique Infotech logo';
  mlogoImg.onload = function () { this.parentNode.classList.add('img'); if(this.previousElementSibling) this.previousElementSibling.remove(); };
  mlogoImg.onerror = function () { this.remove(); };
  mlogo.appendChild(mlogoImg);
  const mname = mk('div');
  const mb = mk('b');
  mb.textContent = escapeHtml(d.orgName || 'Unique Infotech');
  const mspan = document.createElement('span');
  mspan.textContent = 'SCHOOL COMPUTER PROGRAM (UNIQUE KIDS)';
  mname.append(mb, mspan);
  miniL.append(mlogo, mname);
  const miniR = mk('div', 'uk-r');
  miniR.innerHTML = 'Receipt no: <b>' + escapeHtml(d.receiptNo) + '</b><br>Student: <b>' + escapeHtml(d.studentName) + '</b> &nbsp;|&nbsp; ID: <b>' + escapeHtml(d.studentId) + '</b>';
  mini.append(miniL, miniR);

  // Fee structure section
  const sec1 = mk('div', 'uk-sec');
  const h41 = mk('h4');
  const ht1 = mk('span', 'uk-ht');
  const ic1 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ic1.setAttribute('class', 'uk-ic');
  ic1.setAttribute('viewBox', '0 0 24 24');
  ic1.setAttribute('aria-hidden', 'true');
  ic1.innerHTML = '<path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3"/><path d="M9 13c6.667 0 6.667-10 0-10"/>';
  ht1.appendChild(ic1);
  ht1.appendChild(document.createTextNode('Fee structure'));
  const small1 = document.createElement('small');
  small1.textContent = ' ' + (d.level || 'Basic level');
  h41.append(ht1, small1);
  sec1.appendChild(h41);

  const tfe = document.createElement('table');
  tfe.className = 'uk-fe';
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  ['Fee head', 'Due', 'Amount'].forEach((t) => { const th = document.createElement('th'); th.textContent = t; trh.appendChild(th); });
  thead.appendChild(trh);
  tfe.appendChild(thead);
  const tbody = document.createElement('tbody');
  // Render only actual saved fee heads.
  const admissionFee = d.admissionFee || 0;
  if (admissionFee > 0) {
    const r1 = document.createElement('tr');
    r1.innerHTML = '<td>Admission fee (one-time)</td><td>At admission</td><td>' + formatINR(d.admissionFee) + '</td>';
    tbody.appendChild(r1);
  }
  const monthlyFee = d.monthlyFee || 0;
  if (monthlyFee > 0) {
    const r2 = document.createElement('tr');
    r2.innerHTML = '<td>Monthly fee (recurring)</td><td>Monthly, due by 10th</td><td>' + formatINR(d.monthlyFee) + '</td>';
    tbody.appendChild(r2);
  }
  if (tbody.children.length === 0) {
    const r0 = document.createElement('tr');
    r0.innerHTML = '<td colspan="3">No fee heads saved.</td>';
    tbody.appendChild(r0);
  }
  tfe.appendChild(tbody);
  sec1.appendChild(tfe);
  p2.appendChild(mini);
  p2.appendChild(sec1);

  // Payment received at admission
  const sec2 = mk('div', 'uk-sec uk-sp2');
  const h42 = mk('h4');
  const ht2 = mk('span', 'uk-ht');
  const ic2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ic2.setAttribute('class', 'uk-ic');
  ic2.setAttribute('viewBox', '0 0 24 24');
  ic2.setAttribute('aria-hidden', 'true');
  ic2.innerHTML = '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>';
  ht2.appendChild(ic2);
  ht2.appendChild(document.createTextNode('Payment received at admission'));
  const small2 = document.createElement('small');
  small2.textContent = ' Date: ' + (d.admissionDate || '');
  h42.append(ht2, small2);
  sec2.appendChild(h42);

  const tfe2 = document.createElement('table');
  tfe2.className = 'uk-fe';
  const thead2 = document.createElement('thead');
  const trh2 = document.createElement('tr');
  ['Description', 'Status', 'Amount'].forEach((t) => { const th = document.createElement('th'); th.textContent = t; trh2.appendChild(th); });
  thead2.appendChild(trh2);
  tfe2.appendChild(thead2);
  const tbody2 = document.createElement('tbody');
  const rPay = document.createElement('tr');
  const pill = document.createElement('span');
  pill.className = 'uk-pill';
  pill.textContent = d.feeReceived ? 'Paid' : 'Pending';
  rPay.innerHTML = '<td>Admission fee</td><td></td><td>' + formatINR(d.receivedTotal || 0) + '</td>';
  rPay.children[1].appendChild(pill);
  tbody2.appendChild(rPay);
  tfe2.appendChild(tbody2);
  sec2.appendChild(tfe2);

  const pbox = mk('div', 'uk-pbox');
  const pcell1 = mk('div', 'uk-pcell');
  pcell1.innerHTML = '<em>Total received</em><b>' + formatINR(d.receivedTotal || 0) + '</b><span class="uk-w">(Rupees ' + inWords(d.receivedTotal || 0) + ' Only)</span>';
  const pcell2 = mk('div', 'uk-pcell uk-bal');
  pcell2.innerHTML = '<em>Monthly fee</em><b>' + formatINR(d.monthlyFee || 0) + '</b><span class="uk-w">per month, due by the 10th</span>';
  pbox.append(pcell1, pcell2);
  sec2.appendChild(pbox);

  const imp = mk('div', 'uk-imp');
  imp.innerHTML = '<div><b>Important - Monthly fee:</b> The monthly fee is not included in the amount received today. It must be paid on or before the 10th of every month. A late fine of Rs. 1 per day is charged after the 10th.</div>';
  sec2.appendChild(imp);
  p2.appendChild(sec2);

  // Terms & conditions
  const sec3 = mk('div', 'uk-sec uk-sp2');
  const h43 = mk('h4');
  const ht3 = mk('span', 'uk-ht');
  const ic3 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ic3.setAttribute('class', 'uk-ic');
  ic3.setAttribute('viewBox', '0 0 24 24');
  ic3.setAttribute('aria-hidden', 'true');
  ic3.innerHTML = '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/>';
  ht3.appendChild(ic3);
  ht3.appendChild(document.createTextNode('Terms & conditions'));
  h43.appendChild(ht3);
  sec3.appendChild(h43);
  const terms = mk('ol', 'uk-terms');
  [
    'Eligibility: no prior computer knowledge is required for this programme.',
    'The monthly fee must be paid on or before the 10th of every month. A late fine of Rs. 1 per day will be charged after the 10th.',
    'Fees once paid are not refundable or transferable.',
    'Keep this receipt safe. It is required for all future payments. Please remember your Student ID (' + escapeHtml(d.studentId) + '), as it is needed to pay the monthly fee in our system.',
    'This is a computer-generated receipt and is valid with the authorised signature.'
  ].forEach((t) => { const li = document.createElement('li'); li.textContent = t; terms.appendChild(li); });
  sec3.appendChild(terms);
  p2.appendChild(sec3);

  const sigs = mk('div', 'uk-sigs');
  const s1 = mk('div');
  s1.textContent = "Student's signature";
  const s2 = mk('div');
  s2.textContent = 'Authorised signatory';
  sigs.append(s1, s2);
  p2.appendChild(sigs);

  const note = mk('div', 'uk-note');
  note.textContent = 'Thank you for choosing Unique Kids. We wish your child a joyful and successful learning journey.';
  p2.appendChild(note);

  const ft2 = mk('div', 'uk-ft');
  ft2.innerHTML = '<span>Unique Kids &nbsp;|&nbsp; Generated on ' + escapeHtml(d.today || '') + '</span><span>Page 2 of 2</span>';
  p2.appendChild(ft2);

  stage.append(p1, p2);
  sheet.appendChild(stage);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatINR(n) {
  if (n == null || n === '') return '₹0';
  return '₹' + Number(n).toLocaleString('en-IN');
}

function inWords(n) {
  const num = Math.floor(Number(n) || 0);
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function belowThousand(x) {
    let out = '';
    if (x >= 100) { out += ones[Math.floor(x / 100)] + ' Hundred'; x %= 100; if (x) out += ' '; }
    if (x >= 20) { out += tens[Math.floor(x / 10)]; x %= 10; if (x) out += ' '; }
    if (x > 0) out += ones[x];
    return out;
  }
  let out = '';
  const crore = Math.floor(num / 10000000);
  if (crore) { out += belowThousand(crore) + ' Crore'; num %= 10000000; if (num) out += ' '; }
  const lakh = Math.floor(num / 100000);
  if (lakh) { out += belowThousand(lakh) + ' Lakh'; num %= 100000; if (num) out += ' '; }
  const thousand = Math.floor(num / 1000);
  if (thousand) { out += belowThousand(thousand) + ' Thousand'; num %= 1000; if (num) out += ' '; }
  if (num) out += belowThousand(num);
  return out || 'Zero';
}

async function downloadPdf() {
  const btn = $('uk-download');
  const original = btn.textContent;
  btn.textContent = 'Preparing…';
  try {
    if (typeof window.jspdf === 'undefined' || typeof html2canvas === 'undefined') {
      showToast('PDF download needs html2canvas + jsPDF. Use Print &rarr; Save as PDF instead.', 'error');
      btn.textContent = original;
      window.print();
      return;
    }
    window.scrollTo(0, 0);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    pdf.setProperties({ title: 'Unique Kids Admission Receipt', subject: 'Unique Kids Admission Receipt', author: 'Unique Infotech' });
    const pages = [...document.querySelectorAll('.uk-page')];
    for (let i = 0; i < pages.length; i++) {
      const canvas = await html2canvas(pages[i], {
        scale: 4, backgroundColor: '#fff', scrollX: 0, scrollY: 0, windowWidth: 1000, useCORS: true,
        onclone: (d) => {
          d.querySelector('.uk-toolbar').style.display = 'none';
          d.querySelectorAll('.uk-page').forEach((p) => { p.style.margin = '0'; p.style.border = '0'; });
          d.body.style.background = '#fff';
        }
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
    }
      pdf.save('Admission-' + studentId + '.pdf');
  } catch (err) {
    console.error(err);
    showToast('Could not create PDF. Use Print &rarr; Save as PDF.', 'error');
    window.print();
  } finally {
    btn.textContent = original;
  }
}

