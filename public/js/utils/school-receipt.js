// school-receipt.js � pure view-model builders for the Kids admission receipt.
// No Firebase, no DOM. Safe to unit-test in plain Node.

import { formatDateIN, formatPersonName, formatGenderDisplay } from './formatter.js?v=1.8.188';
import { getStudentPhotoSrc, getStudentDocSrc } from './student-media.js?v=1.8.188';

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

// First monthly-fee month = calendar month two months after the admission date.
// Local year/month arithmetic (no day-of-month overflow).
//   2027-01-15 -> 2027-03
//   2027-06-30 -> 2027-08
//   2027-11-20 -> 2028-01
//   2027-12-31 -> 2028-02
export function firstMonthlyMonth(admissionISO) {
  if (!admissionISO) return '';
  const p = String(admissionISO).split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return '';
  let total = p[0] * 12 + (p[1] - 1) + 2;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return ny + '-' + String(nm).padStart(2, '0');
}

export function formatYM(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || '';
  const [y, m] = ym.split('-').map(Number);
  const mName = MONTH_NAMES[m - 1] || '';
  return `${mName} ${y}`;
}

export function fmtRs(n) {
  if (n == null || n === '') return 'Rs. 0.00';
  const num = Number(n);
  if (!Number.isFinite(num)) return 'Rs. 0.00';
  return 'Rs. ' + num.toFixed(2);
}

// Masks 12-digit Aadhaar into "XXXX XXXX 1234" (shows only the last 4 digits).
export function maskAadhaar(raw) {
  if (!raw) return '-';
  const clean = String(raw).replace(/\D/g, '');
  if (clean.length < 4) return '-';
  const last4 = clean.slice(-4);
  return `XXXX XXXX ${last4}`;
}

export function inWords(num) {
  const n = Math.floor(Number(num) || 0);
  if (n === 0) return 'Rupees Zero Only';

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertTwoDigits(val) {
    if (val < 20) return a[val];
    const tens = b[Math.floor(val / 10)];
    const units = a[val % 10];
    return units ? tens + ' ' + units : tens;
  }

  function convertThreeDigits(val) {
    let str = '';
    if (val >= 100) {
      str += a[Math.floor(val / 100)] + ' Hundred';
      val %= 100;
      if (val > 0) str += ' ';
    }
    if (val > 0) {
      str += convertTwoDigits(val);
    }
    return str;
  }

  let words = '';
  let rem = n;

  const crore = Math.floor(rem / 10000000);
  rem %= 10000000;
  if (crore > 0) {
    words += convertThreeDigits(crore) + ' Crore ';
  }

  const lakh = Math.floor(rem / 100000);
  rem %= 100000;
  if (lakh > 0) {
    words += convertThreeDigits(lakh) + ' Lakh ';
  }

  const thousand = Math.floor(rem / 1000);
  rem %= 1000;
  if (thousand > 0) {
    words += convertThreeDigits(thousand) + ' Thousand ';
  }

  if (rem > 0) {
    words += convertThreeDigits(rem);
  }

  return 'Rupees ' + words.trim() + ' Only';
}

export function formatNoPaymentReason(reason, other) {
  if (reason === 'staff_child') return 'Staff child';
  if (reason === 'scholarship') return 'Scholarship / Concession';
  if (reason === 'trial') return 'Free trial';
  if (reason === 'other') return other ? `Other: ${other}` : 'Special approval';
  return reason || 'Approved exemption';
}

// Build the receipt view-model from saved snapshots. Never recomputes fees from
// current course settings; uses only what was saved at admission.
// Basic details (name, guardian, phone, address...) are read LIVE from the student doc.
export function buildSchoolReceiptData({ admission, photo, signature, org, payment, aadhaar } = {}) {
  const a = admission || {};
  const p = payment || {};
  const o = org || {};
  const rawAadhaar = (aadhaar && (aadhaar.aadhaar || aadhaar.number)) || (a && a.aadhaar) || (typeof aadhaar === 'string' ? aadhaar : '');
  const aadhaarMasked = maskAadhaar(rawAadhaar);
  const phones = Array.isArray(o.phones) && o.phones.length > 0 ? o.phones.filter(Boolean) : (o.phone ? [o.phone] : ['9851771893', '9832147650', '8641209375']);
  
  const receiptCodeFromNumber = String(a.receiptNo || p.receiptNo || '').match(/^UK\d{2}AD-([A-Z0-9]{2,12})-\d{4}$/);
  const centreCode = String(a.receiptCentreCode || p.receiptCentreCode ||
    (receiptCodeFromNumber ? receiptCodeFromNumber[1] : '') || o.receiptCode || 'HO');
  const gender = a.gender ? String(a.gender).charAt(0).toUpperCase() + String(a.gender).slice(1) : '-';

  const rawFirstMonthly = (p && p.firstMonthlyMonth) || a.firstMonthlyMonth || firstMonthlyMonth(a.admissionDate);
  const firstMonthlyFormatted = formatYM(rawFirstMonthly);

  // Financial values: always from payment doc or fallback to saved snapshot in student doc.
  // NEVER recalculated from current course settings.
  const configuredFee = Number((p && p.configuredAdmissionFee) ?? a.configuredAdmissionFee ?? (p && p.admissionFee) ?? a.admissionFee ?? 0);
  const priorPayment = Number((p && p.eligiblePriorAdmissionPayments) ?? a.eligiblePriorAdmissionPayments ?? 0);
  const receivedAmount = Number((p && (p.actualAmountReceived ?? p.receivedTotal)) ?? a.actualAmountReceived ?? (p && p.admissionFee) ?? a.admissionFee ?? 0);
  const monthlyFeeVal = Number((p && p.monthlyFee) ?? a.monthlyFee ?? 0);
  const paymentMode = (p && p.paymentMode) || a.paymentMode || 'full';
  const noPaymentReason = (p && p.noPaymentReason) || a.noPaymentReason || '';
  const noPaymentOther = (p && p.noPaymentOther) || a.noPaymentOther || '';

  return {
    studentName: formatPersonName(a.name || '') || '-',
    schoolClass: a.schoolClass || '-',
    schoolName: 'Unique Kids',
    guardianName: formatPersonName(a.guardianName || '') || '-',
    dob: formatDateIN(a.dob) || '-',
    aadhaar: aadhaarMasked,
    gender: formatGenderDisplay(a.gender, '-'),
    phone: a.phone || '-',
    altPhone: a.altPhone || '-',
    address: a.address || '-',
    studentId: a.studentId || '-',
    admissionNo: a.studentId || a.receiptNo || '-',
    receiptNo: (p && p.receiptNo) || a.receiptNo || '-',
    admissionDate: formatDateIN(a.admissionDate) || '-',
    level: a.courseLevelName || a.courseName || a.level || '-',
    batch: a.batchName || '-',
    firstMonthly: rawFirstMonthly || '-',
    firstMonthlyMonthFormatted: firstMonthlyFormatted || '-',
    
    // Money fields
    configuredAdmissionFee: configuredFee,
    eligiblePriorAdmissionPayments: priorPayment,
    actualAmountReceived: receivedAmount,
    amountInWords: inWords(receivedAmount),
    monthlyFee: monthlyFeeVal,
    feeReceived: p.feeReceived != null ? Boolean(p.feeReceived) : (receivedAmount > 0),
    paymentMode,
    noPaymentReason,
    noPaymentOther,
    noPaymentReasonFormatted: formatNoPaymentReason(noPaymentReason, noPaymentOther),
    
    // Media & Docs
    photoUrl: getStudentPhotoSrc(a, photo ? { photo } : null),
    signatureUrl: getStudentDocSrc(signature, 'image/jpeg'),
    
    // Org branding
    orgPhones: phones,
    orgEmail: o.email || 'utpal.goutam@gmail.com',
    orgName: o.orgName || 'Unique Infotech',
    isoLine: o.isoText || 'An ISO 9001:2015 Certified Organisation',
    programLine: 'SCHOOL COMPUTER PROGRAM (UNIQUE KIDS)',
    centreName: 'Unique Kids - School Computer Program (Head Office campus)',
    centreAddress: o.address || 'Ailakandi, Kenduadihi, Bankura, West Bengal - 722101',
    centreCode,
    today: formatDateIN(a.admissionDate) || formatDateIN(new Date().toISOString().slice(0, 10)),
    issuedBy: (p && p.createdBy) || a.createdBy || a.updatedBy || ''
  };
}
