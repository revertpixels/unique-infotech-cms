// Receipt PDF generator for admissions.
// jsPDF is loaded lazily from the vendored copy at public/vendor/jspdf.umd.min.js (jsPDF 2.5.1).
// No static import - the library is only fetched when a receipt is actually built/printed.
// getReceiptData() is shared with admission-receipt.page.js so the HTML sheet and PDF never diverge.

const PAGE_W = 210;   // A4 width in mm
const PAGE_H = 297;   // A4 height in mm
const M = 15;         // margin in mm
const R = PAGE_W - M; // right content edge

const BLACK = '#1A1F2B';
const GREY = '#5D6574';
const LINE_GREY = '#C9CED8';
const NAVY = '#1B2A49';

let jsPDFCtor = null;

async function loadJsPDF() {
  if (jsPDFCtor) return jsPDFCtor;
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/jspdf.umd.min.js', import.meta.url).href;
      s.onload = res;
      s.onerror = () => rej(new Error('Could not load PDF library'));
      document.head.appendChild(s);
    });
  }
  jsPDFCtor = window.jspdf.jsPDF;
  return jsPDFCtor;
}

// Money: "Rs. 12,500.00" (jsPDF default fonts have no rupee glyph - never print ₹).
export function fmtMoney(n) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const a = Math.abs(v).toFixed(2);
  const parts = a.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '- Rs. ' : 'Rs. ') + parts.join('.');
}

function isImageDoc(d) {
  return !!(d && (d.data || d.Data || d.url || d.path));
}

function imageSrc(d) {
  if (!d) return null;
  let data = d.data || d.Data || d.url || d.path || '';
  if (data && !data.startsWith('data:')) {
    const mime = String(d.type || d.mime || 'image/jpeg').toLowerCase();
    data = (mime.includes('png') ? 'data:image/png;base64,' : 'data:image/jpeg;base64,') + data;
  }
  return data || null;
}

function imageFormat(d) {
  if (!d) return undefined;
  const mime = String(d.type || d.mime || '').toLowerCase();
  return mime.includes('png') ? 'PNG' : 'JPEG';
}

function wrapText(doc, text, maxWidth, fontSize) {
  doc.setFontSize(fontSize);
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const trial = (cur ? cur + ' ' : '') + w;
    if (doc.getTextWidth(trial) <= maxWidth || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- shared data builder (HTML sheet + PDF) ----------
// Returns a normalized receipt view model so HTML and PDF can never diverge.
export function getReceiptData(admission, docs, org) {
  const orgName = (org && org.orgName) || 'Unique Infotech CMS';
  const branchName = (org && org.branchName) || (admission.branchName || '');
  const orgAddress = (org && org.address) || '';
  const orgPhone = (org && org.phone) || '';
  const orgEmail = (org && org.email) || '';
  const orgLogo = (org && org.logo) || null;

  const feeSnapshot = admission.feeSnapshot || {};
  const feeTotal = Number(admission.feeTotal || 0);
  const feeSchedule = Array.isArray(admission.feeSchedule) ? admission.feeSchedule : [];
  const dueAt = admission.dueAtAdmission || {};
  const paid = Number(dueAt.total || 0);
  const balance = feeTotal - paid;
  const examFee = Number(admission.examFee || 0);
  const materialFee = Number(feeSnapshot.material || 0);
  const admissionFee = Number(feeSnapshot.admission || 0);
  const receivedTotal = Number(feeSnapshot.receivedTotal || paid);

  const pc = admission.prereqCheck || null;
  let prereqLine = 'Not required';
  if (pc && pc.status === 'auto') {
    prereqLine = 'Verified automatically (' + (pc.sourceSessionId || '') + ')';
  } else if (pc && pc.status === 'manual') {
    const v = pc.verifiedAt;
    let vStr = '';
    if (v && typeof v.toDate === 'function') vStr = v.toDate().toLocaleDateString();
    else if (v) vStr = new Date(v).toLocaleDateString();
    prereqLine = 'Verified manually' + (vStr ? ' on ' + vStr : '');
  }

  const photoD = (docs && docs.photo) ? docs.photo : null;
  const sigD = (docs && docs.signature) ? docs.signature : null;

  return {
    studentId: admission.studentId || '-',
    receiptNo: admission.receiptNo || '-',
    admissionDate: admission.admissionDate || '-',
    sessionName: admission.sessionName || '-',
    branchName: branchName,
    studentName: admission.name || '-',
    guardianName: admission.guardianName || '-',
    dob: admission.dob || '-',
    gender: admission.gender || '-',
    phone: admission.phone || '-',
    altPhone: admission.altPhone || '-',
    email: admission.email || '-',
    qualification: admission.qualification || '-',
    address: admission.address || '-',
    courseCode: admission.courseCode || admission.courseId || '-',
    courseName: admission.courseName || '-',
    batchName: admission.batchName || '-',
    duration: admission.duration || '',
    prereqLine: prereqLine,
    orgName: orgName,
    orgAddress: orgAddress,
    orgPhone: orgPhone,
    orgEmail: orgEmail,
    orgLogo: orgLogo,
    photoData: photoD ? (photoD.data || photoD.Data || photoD.url || photoD.path || null) : null,
    photoFmt: photoD ? imageFormat(photoD) : null,
    sigData: sigD ? (sigD.data || sigD.Data || sigD.url || sigD.path || null) : null,
    sigFmt: sigD ? imageFormat(sigD) : null,
    receiptNo: admission.receiptNo || '-',
    receiptDate: admission.admissionDate || '-',
    feeRows: buildFeeRows(feeSnapshot, feeSchedule),
    feeTotal: feeTotal,
    paid: paid,
    balance: balance,
    admissionFee: admissionFee,
    materialFee: materialFee,
    examFee: examFee,
    receivedTotal: receivedTotal,
    paymentMode: admission.paymentMode || null,
    amountInWords: amountToWords(receivedTotal),
  };
}

const INST_COUNT = 4;

function buildFeeRows(feeSnapshot, feeSchedule) {
  const rows = [];
  const f = feeSnapshot || {};
  if (Number(f.admission || 0) > 0) {
    rows.push({ head: 'Admission fee', type: 'One-time', due: 'At admission', amount: Number(f.admission) });
  }
  if (Number(f.material || 0) > 0) {
    rows.push({ head: 'Study material fee', type: 'One-time', due: 'At admission', amount: Number(f.material) });
  }
  if (Array.isArray(feeSchedule)) {
    feeSchedule.forEach(function (it, i) {
      const amt = Number(it.amount || 0);
      if (amt > 0) {
        rows.push({ head: 'Instalment ' + (it.no || (i + 1)) + ' of ' + INST_COUNT, type: 'Monthly', due: it.due || '-', amount: amt });
      }
    });
  }
  if (Number(f.exam || 0) > 0) {
    rows.push({ head: 'Exam fee', type: 'One-time', due: 'Before session end', amount: Number(f.exam) });
  }
  return rows;
}

function amountToWords(n) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function convertChunk(num) {
    if (num === 0) return '';
    if (num < 20) return ones[num];
    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + convertChunk(num % 100) : '');
    return '';
  }
  const v = Math.round(Number(n) || 0);
  if (v === 0) return 'Zero';
  const crore = Math.floor(v / 10000000);
  const lakh = Math.floor((v % 10000000) / 100000);
  const thousand = Math.floor((v % 100000) / 1000);
  const hundred = v % 1000;
  let words = '';
  if (crore > 0) words += ones[crore] + ' Crore';
  if (lakh > 0) words += (words ? ' ' : '') + ones[lakh] + ' Lakh';
  if (thousand > 0) words += (words ? ' ' : '') + ones[thousand] + ' Thousand';
  if (hundred > 0) words += (words ? ' ' : '') + convertChunk(hundred);
  return words + ' Only';
}

// ---------- buildReceipt ----------
// admission: the saved admission document
// docs: { key: {data, type, name, ...} } base64 doc map (photo, signature, dobProof, marksheet)
// org: { orgName, branchName, address, phone, email, ... }
export async function buildReceipt(admission, docs, org) {
  const ctor = await loadJsPDF();
  const doc = new ctor({ unit: 'mm', format: 'a4' });
  doc.setProperties({
    title: 'Admission Receipt - ' + (admission.studentId || ''),
    author: (org && org.orgName) || 'Unique Infotech CMS'
  });

  const data = getReceiptData(admission, docs, org);
  let y = M;

  // ---------- Header ----------
  // Logo (left, max 18mm high) + org name bold + branch + address + phone/email
  const logoSrc = data.orgLogo ? imageSrc({ data: data.orgLogo, type: 'image/jpeg' }) : null;
  const logoFmt = data.orgLogo ? 'JPEG' : undefined;
  if (logoSrc) {
    try {
      doc.addImage(logoSrc, logoFmt, M, y, undefined, 18);
    } catch (e) { /* logo render non-fatal */ }
  }
  let orgX = M + (logoSrc ? 22 : 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(BLACK);
  doc.text(data.orgName, orgX, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(GREY);
  doc.text(data.branchName, orgX, y + 10);
  if (data.orgAddress) {
    const addrLines = wrapText(doc, data.orgAddress, R - orgX - M, 8.5);
    addrLines.forEach((l, i) => doc.text(l, orgX, y + 14 + i * 4.5));
    y += 14 + addrLines.length * 4.5;
  } else {
    y += 14;
  }
  const contact = [data.orgPhone, data.orgEmail].filter(Boolean).join('  |  ');
  if (contact) {
    doc.text(contact, orgX, y + 3);
    y += 8;
  }
  y += 2;
  doc.setDrawColor(LINE_GREY);
  doc.setLineWidth(0.4);
  doc.line(M, y, R, y);
  y += 6;

  // ---------- Title centred ----------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(BLACK);
  doc.text('ADMISSION RECEIPT', PAGE_W / 2, y, { align: 'center' });
  y += 7;

  // ---------- Receipt meta ----------
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(GREY);
  doc.text('Receipt no: ' + data.receiptNo + '   |   Date: ' + data.receiptDate, PAGE_W / 2, y, { align: 'center' });
  y += 7;

  // ---------- Details (two columns) ----------
  const labelW = 44;
  const colX = R - 40; // right column x
  const photoY = y;
  const valX = M + labelW;
  const valMaxW = colX - valX - 4;

  // Photo box 35x45mm
  doc.setDrawColor(LINE_GREY);
  doc.setLineWidth(0.4);
  doc.rect(colX, photoY, 35, 45);
  const photoSrc = data.photoData ? ('data:' + (data.photoFmt === 'PNG' ? 'image/png' : 'image/jpeg') + ';base64,' + data.photoData) : null;
  if (photoSrc) {
    try { doc.addImage(photoSrc, data.photoFmt, colX + 1, photoY + 1, 33, 33); } catch (e) { /* non-fatal */ }
  }

  // Label:value rows
  const rows = [
    ['Receipt No', data.receiptNo],
    ['Student ID', data.studentId],
    ['Admission date', data.admissionDate],
    ['Session', data.sessionName],
    ['Branch', data.branchName],
    ['Student name', data.studentName],
    ['Guardian name', data.guardianName],
    ['Date of birth', data.dob],
    ['Gender', data.gender],
    ['Phone', data.phone],
    ['Alt phone', data.altPhone],
    ['Email', data.email],
    ['Highest qualification', data.qualification]
  ];
  doc.setFontSize(8.5);
  let yRow = y;
  rows.forEach(function (row) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(BLACK);
    doc.text(row[0], M, yRow);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(BLACK);
    const vl = wrapText(doc, row[1], valMaxW, 8.5);
    vl.forEach(function (l, i) { doc.text(l, valX, yRow + i * 4.2); });
    yRow += Math.max(4.6, vl.length * 4.2 + 1);
  });
  if (data.address) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(BLACK);
    doc.text('Address', M, yRow);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(BLACK);
    const al = wrapText(doc, data.address, valMaxW, 8.5);
    al.forEach(function (l, i) { doc.text(l, valX, yRow + i * 4.2); });
    yRow += al.length * 4.2 + 2;
  }
  y = Math.max(yRow, photoY + 45 + 10) + 6;

  // Signature box below photo
  const sigY = photoY + 45 + 5;
  doc.rect(colX, sigY, 35, 15);
  const sigSrc = data.sigData ? ('data:' + (data.sigFmt === 'PNG' ? 'image/png' : 'image/jpeg') + ';base64,' + data.sigData) : null;
  if (sigSrc) {
    try { doc.addImage(sigSrc, data.sigFmt, colX + 1, sigY + 1, 33, 11); } catch (e) { /* non-fatal */ }
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(GREY);
  doc.text("Student's signature", colX, sigY + 16, { align: 'center' });

  // ---------- Section: Course ----------
  y += 4;
  doc.setDrawColor(LINE_GREY);
  doc.line(M, y, R, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(BLACK);
  doc.text('Course', M, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(BLACK);
  doc.text((data.courseCode ? data.courseCode + '  -  ' : '') + data.courseName, M, y);
  y += 4.5;
  doc.text('Batch: ' + data.batchName, M, y);
  y += 4.5;
  if (data.duration) { doc.text('Duration: ' + data.duration, M, y); y += 4.5; }
  doc.text('Prerequisite: ' + data.prereqLine, M, y);
  y += 7;

  // ---------- Section: Fees ----------
  doc.setDrawColor(LINE_GREY);
  doc.line(M, y, R, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(BLACK);
  doc.text('Fee structure', M, y);
  y += 5;

  const colItem = M;
  const colType = colItem + 55;
  const colDue = colType + 40;
  const colAmt = colDue + 45;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text('Fee head', colItem, y);
  doc.text('Type', colType, y);
  doc.text('Due', colDue, y);
  doc.text('Amount', colAmt, y, { align: 'right' });
  y += 4.5;
  doc.setLineWidth(0.3);
  doc.line(M, y, R, y);
  y += 3.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  data.feeRows.forEach(function (r) {
    doc.text(r.head, colItem, y);
    doc.text(r.type, colType, y);
    doc.text(r.due, colDue, y);
    doc.text(fmtMoney(r.amount), colAmt, y, { align: 'right' });
    y += 5;
  });
  doc.line(M, y, R, y);
  y += 4.5;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BLACK);
  doc.text('Total course fee', colItem, y);
  doc.text(fmtMoney(data.feeTotal), colAmt, y, { align: 'right' });
  y += 6;

  // ---------- Section: Payment received ----------
  doc.setDrawColor(LINE_GREY);
  doc.line(M, y, R, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(BLACK);
  doc.text('Payment received at admission', M, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(BLACK);
  doc.text('Admission fee', colItem, y);
  doc.text(fmtMoney(data.admissionFee), colAmt, y, { align: 'right' });
  y += 4.5;
  doc.text('Study material fee', colItem, y);
  doc.text(fmtMoney(data.materialFee), colAmt, y, { align: 'right' });
  y += 4.5;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(BLACK);
  doc.text('Total received', colItem, y);
  doc.text(fmtMoney(data.receivedTotal), colAmt, y, { align: 'right' });
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(BLACK);
  if (data.paymentMode) {
    doc.text('Payment mode: ' + data.paymentMode, colItem, y);
    y += 5;
  }

  // Words box
  doc.setDrawColor(LINE_GREY);
  doc.setLineWidth(0.3);
  doc.rect(M, y, R - M, 12);
  doc.setFontSize(7.5);
  doc.setTextColor(GREY);
  doc.text('Amount received in words: Rupees ' + amountToWords(data.receivedTotal), M + 3, y + 6);
  y += 14;

  // ---------- Summary box (right aligned) ----------
  const sumW = 55;
  const sumX = R - sumW;
  doc.setDrawColor(LINE_GREY);
  doc.setLineWidth(0.4);
  doc.rect(sumX, y, sumW, 26);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text('Summary', sumX + 4, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text('Total course fee', sumX + 4, y + 11);
  doc.text(fmtMoney(data.feeTotal), sumX + sumW - 4, y + 11, { align: 'right' });
  doc.text('Received now', sumX + 4, y + 16);
  doc.text(fmtMoney(data.receivedTotal), sumX + sumW - 4, y + 16, { align: 'right' });
  doc.setLineWidth(0.8);
  doc.line(sumX + 4, y + 18.5, sumX + sumW - 4, y + 18.5);
  doc.text('Balance payable', sumX + 4, y + 22);
  doc.text(fmtMoney(data.balance), sumX + sumW - 4, y + 22, { align: 'right' });
  y += 28;

  // ---------- Note ----------
  doc.setFontSize(7.5);
  doc.setTextColor(GREY);
  const noteLines = wrapText(doc, 'Instalments are due on the 10th of each month. Late payment: Rs. 1 per day after the 10th. Exam fee must be paid before the session ends.', R - 2 * M, 7.5);
  noteLines.forEach(function (l) { doc.text(l, M, y); y += 4.5; });
  y += 4;

  // ---------- Signature lines ----------
  const sigLineY = PAGE_H - M - 28;
  doc.setDrawColor(LINE_GREY);
  doc.setLineWidth(0.4);
  doc.line(M, sigLineY, M + 55, sigLineY);
  doc.line(R - 55, sigLineY, R, sigLineY);
  doc.setFontSize(7.5);
  doc.setTextColor(GREY);
  doc.text('Student / Guardian signature', M + 27.5, sigLineY + 4, { align: 'center' });
  doc.text('Authorised signatory', R - 27.5, sigLineY + 4, { align: 'center' });

  // ---------- Footer ----------
  const footerY = PAGE_H - M - 8;
  doc.setFontSize(7);
  doc.setTextColor(GREY);
  doc.text('Generated on ' + new Date().toLocaleString(), M, footerY);
  doc.text('This is a computer-generated receipt.', (M + R) / 2, footerY, { align: 'center' });
  doc.text('Page 1 of 1', R, footerY, { align: 'right' });

  return doc;
}

// ---------- downloadReceipt ----------
export async function downloadReceipt(admission, docs, org) {
  const doc = await buildReceipt(admission, docs, org);
  const sessionName = (admission.sessionName || 'session').replace(/[\s\/]+/g, '-');
  const fileName = 'Admission-' + (admission.studentId || 'admission') + '-' + sessionName + '.pdf';
  doc.save(fileName);
}

// ---------- printReceipt ----------
export async function printReceipt(admission, docs, org) {
  const doc = await buildReceipt(admission, docs, org);
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isMobile = /Android|webOS|iPhone|iPad|iPod/.test(navigator.userAgent);
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    const printIt = () => {
      try { iframe.contentWindow.print(); } catch (e) { fallback(); }
    };
    if (isIOS || isMobile) {
      fallback();
    } else {
      iframe.onload = printIt;
    }
  } catch (e) {
    fallback();
  }
  function fallback() {
    const win = window.open(url, '_blank');
    if (!win) {
      location.href = url;
    }
  }
}
