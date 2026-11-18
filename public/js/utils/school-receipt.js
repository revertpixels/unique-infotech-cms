// school-receipt.js — pure view-model builders for the Kids admission receipt.
// No Firebase, no DOM. Safe to unit-test in plain Node.

import { formatDateIN } from './formatter.js?v=1.8.71';

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

// Build the receipt view-model from saved snapshots. Never recomputes fees from
// current course settings; uses only what was saved at admission.
export function buildSchoolReceiptData({ admission, photo, signature, org, payment } = {}) {
  const a = admission || {};
  const p = payment || {};
  const o = org || {};
  const phones = Array.isArray(o.phones) ? o.phones.filter(Boolean) : (o.phone ? [o.phone] : []);
  // Prefer the saved admission/payment snapshot, not a setting changed later.
  const receiptCodeFromNumber = String(a.receiptNo || p.receiptNo || '').match(/^UK\d{2}AD-([A-Z0-9]{2,12})-\d{4}$/);
  const centreCode = String(a.receiptCentreCode || p.receiptCentreCode ||
    (receiptCodeFromNumber ? receiptCodeFromNumber[1] : '') || o.receiptCode || 'HO');
  const gender = a.gender ? String(a.gender).charAt(0).toUpperCase() + String(a.gender).slice(1) : '';
  return {
    studentName: a.name || '',
    schoolClass: a.schoolClass || '',
    guardianName: a.guardianName || '',
    dob: formatDateIN(a.dob),
    gender,
    phone: a.phone || '',
    altPhone: a.altPhone || '',
    address: a.address || '',
    studentId: a.studentId || '',
    receiptNo: a.receiptNo || '',
    admissionDate: formatDateIN(a.admissionDate),
    level: a.courseLevelName || a.level || '',
    batch: a.batchName || '',
    firstMonthly: firstMonthlyMonth(a.admissionDate),
    admissionFee: p.admissionFee != null ? Number(p.admissionFee) : Number(a.admissionFee || 0),
    monthlyFee: a.monthlyFee != null ? Number(a.monthlyFee) : 0,
    receivedTotal: p.receivedTotal != null ? Number(p.receivedTotal) : 0,
    feeReceived: p.feeReceived != null ? Boolean(p.feeReceived) : false,
    photoUrl: photo && photo.data ? photo.data : '',
    signatureUrl: signature && signature.data ? signature.data : '',
    orgPhones: phones,
    orgEmail: o.email || '',
    orgName: o.orgName || '',
    centreCode,
    today: formatDateIN(a.admissionDate)
  };
}

