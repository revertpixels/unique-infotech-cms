// payment.service.js — Shared payment, fine calculation, receipt generation, and activity logging services.
import { db } from '../config/firebase-config.js';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { readReceiptNo, writeCounter } from './admission.service.js?v=1.8.96';
import { fineFor, todayISO } from '../utils/session-rules.js?v=1.8.96';

const COL = 'students';

/**
 * Calculates late fee for an installment as of a given date (defaults to today).
 * Late fine is Rs 1/day for every day after the due date (10th of due month).
 */
export function calculateLateFee(dueISO, asOfDate) {
  return fineFor(dueISO, asOfDate || todayISO());
}

/**
 * Fetches all payment subcollection records for a student doc.
 * Returns array sorted by payment date / createdAt descending.
 */
export async function fetchStudentPayments(studentDocId) {
  if (!studentDocId) return [];
  try {
    const snap = await getDocs(collection(db, COL, studentDocId, 'payment'));
    const list = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    list.sort((a, b) => {
      const da = a.date || (a.createdAt && a.createdAt.seconds ? new Date(a.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
      const dbDate = b.date || (b.createdAt && b.createdAt.seconds ? new Date(b.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
      if (da !== dbDate) return dbDate.localeCompare(da);
      const ca = a.createdAt && a.createdAt.seconds ? a.createdAt.seconds : 0;
      const cb = b.createdAt && b.createdAt.seconds ? b.createdAt.seconds : 0;
      return cb - ca;
    });
    return list;
  } catch (e) {
    console.error('[payment.service] fetchStudentPayments failed', e);
    return [];
  }
}

/**
 * Fetches activity log records for a student doc.
 */
export async function fetchStudentActivities(studentDocId) {
  if (!studentDocId) return [];
  try {
    const snap = await getDocs(collection(db, COL, studentDocId, 'activity'));
    const list = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    list.sort((a, b) => {
      const ca = a.at && a.at.seconds ? a.at.seconds : 0;
      const cb = b.at && b.at.seconds ? b.at.seconds : 0;
      return cb - ca;
    });
    return list;
  } catch (e) {
    console.error('[payment.service] fetchStudentActivities failed', e);
    return [];
  }
}

/**
 * Records a payment inside a Firestore transaction.
 * Generates an atomic receipt number from counters, logs activity, and updates student totals.
 */
export async function recordPaymentTx(tx, {
  studentDoc,
  type, // 'IN' (Installment) | 'EX' (Exam) | 'WA' (Waiver)
  installmentNo,
  amount,
  lateFeeAmount,
  mode,
  txnId,
  remarks,
  waived,
  waiverReason,
  paymentDate,
  userEmail,
  userName,
  userRole,
  branchId,
  branchCode,
  branchName
}) {
  const pDate = paymentDate || todayISO();
  const org = studentDoc.ctx || 'youth';
  const bCode = branchCode || studentDoc.branchCode || 'HO';

  // 1. Transaction Read: Receipt counter
  const rc = await readReceiptNo(tx, {
    org,
    type: type || 'IN',
    branchCode: bCode,
    date: pDate
  });

  // 2. Transaction Writes
  // Write counter increment
  writeCounter(tx, rc.ref, rc.next, {
    org,
    type: type || 'IN',
    branchCode: bCode,
    date: pDate
  });

  const paymentRef = doc(collection(db, COL, studentDoc.id, 'payment'));
  const activityRef = doc(collection(db, COL, studentDoc.id, 'activity'));

  const numAmount = Number(amount || 0);
  const numLate = Number(lateFeeAmount || 0);
  const currentPaid = Number(studentDoc.paidAmount ?? studentDoc.totalPaid ?? 0);
  const newPaid = currentPaid + numAmount;
  const newBalance = Math.max(0, Number(studentDoc.feeTotal || 0) - newPaid);

  const paymentData = {
    amount: numAmount,
    date: pDate,
    type: type || 'IN',
    installmentNo: installmentNo != null ? Number(installmentNo) : null,
    mode: mode || 'cash',
    txnId: mode !== 'cash' ? (txnId || '') : '',
    receiptNo: rc.receiptNo,
    lateFeeAmount: numLate,
    waived: !!waived,
    waiverReason: waived ? (waiverReason || '') : '',
    remarks: remarks || '',
    recordedBy: (userEmail || '').toLowerCase(),
    recordedByName: userName || '',
    recordedAtBranchId: branchId || studentDoc.branchId || 'HO',
    recordedAtBranchCode: bCode,
    recordedAtBranchName: branchName || studentDoc.branchName || '',
    createdAt: serverTimestamp()
  };

  tx.set(paymentRef, paymentData);

  // Update student doc (preserves branchId, studentId, ctx, status so validStudentDoc passes)
  const studentRef = doc(db, COL, studentDoc.id);
  tx.update(studentRef, {
    paidAmount: newPaid,
    totalPaid: newPaid,
    balanceDue: newBalance,
    updatedAt: serverTimestamp(),
    updatedBy: (userEmail || '').toLowerCase()
  });

  // Activity log entry (append-only)
  const feeTypeDesc = type === 'EX' ? 'Exam fee payment' :
    (type === 'MAT' ? 'Study material fee payment' : `Installment ${installmentNo || ''} payment`);
  const summaryText = feeTypeDesc +
    `: Rs ${numAmount}` + (numLate > 0 ? ` (+ Rs ${numLate} late fee)` : '') + (waived ? ' [Waived]' : '');

  tx.set(activityRef, {
    action: 'payment_recorded',
    summary: summaryText,
    changes: {
      paidAmount: { from: currentPaid, to: newPaid },
      balanceDue: { from: studentDoc.balanceDue || 0, to: newBalance }
    },
    by: (userEmail || '').toLowerCase(),
    byRole: userRole || '',
    branchId: branchId || studentDoc.branchId || '',
    at: serverTimestamp()
  });

  return {
    paymentId: paymentRef.id,
    receiptNo: rc.receiptNo,
    amount: numAmount,
    lateFeeAmount: numLate,
    date: pDate
  };
}

/**
 * Appends an activity log entry to students/{studentDocId}/activity/{auto}.
 * If batch is provided, adds to batch; otherwise sets directly.
 */
export async function logStudentActivity(studentDocId, {
  action,
  summary,
  changes,
  userEmail,
  userRole,
  branchId
}, batch) {
  if (!studentDocId) return;
  const actRef = doc(collection(db, COL, studentDocId, 'activity'));
  const payload = {
    action: action || 'update',
    summary: summary || '',
    changes: changes || {},
    by: (userEmail || '').toLowerCase(),
    byRole: userRole || '',
    branchId: branchId || '',
    at: serverTimestamp()
  };

  if (batch) {
    batch.set(actRef, payload);
  } else {
    await setDoc(actRef, payload);
  }
}
