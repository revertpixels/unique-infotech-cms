// payment.service.js — Shared payment, fine calculation, receipt generation, and activity logging services.
import { db } from '../config/firebase-config.js';
import {
  collection,
  doc,
  getDocs,
  setDoc,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { readReceiptNo, writeCounter } from './admission.service.js?v=1.8.125';
import { fineFor, todayISO } from '../utils/session-rules.js?v=1.8.125';

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
      const da = a.paidOn || a.date || (a.createdAt && a.createdAt.seconds ? new Date(a.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
      const dbDate = b.paidOn || b.date || (b.createdAt && b.createdAt.seconds ? new Date(b.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
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
 * Logs an activity entry to students/{studentDocId}/activity/
 * Supports both standalone execution and batch writes.
 */
export async function logStudentActivity(studentDocId, {
  action,
  summary,
  changes,
  userEmail,
  userRole,
  branchId
}, batch) {
  if (!studentDocId) return null;
  const payload = {
    action: action || 'activity',
    summary: summary || '',
    changes: changes || {},
    by: (userEmail || '').toLowerCase(),
    byRole: userRole || '',
    branchId: branchId || '',
    at: serverTimestamp()
  };
  try {
    const actRef = doc(collection(db, COL, studentDocId, 'activity'));
    if (batch && typeof batch.set === 'function') {
      batch.set(actRef, payload);
      return actRef;
    }
    await setDoc(actRef, payload);
    return actRef;
  } catch (err) {
    console.warn('[payment.service] logStudentActivity failed', err);
    return null;
  }
}

/**
 * Checks whether an installment has been paid
 */
export function isInstallmentPaid(it, paymentsList, student) {
  const itNo = Number(it.no ?? it.installmentNo);
  if (!itNo || !Number.isFinite(itNo)) return false;
  if (it.paid === true || it.isPaid === true || it.status === 'paid' || it.waived === true || it.isWaived === true) {
    return true;
  }
  if (Array.isArray(student?.paidInstallments) && student.paidInstallments.includes(itNo)) {
    return true;
  }
  if (Number(student?.installmentsPaid || 0) >= itNo) {
    return true;
  }
  const list = paymentsList || [];
  const rec = list.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    const pNo = Number(p.installmentNo ?? p.installment ?? p.no ?? p.instNo);
    const isInstType = (t === 'IN' || t === 'INST' || t === 'INSTALLMENT' || t === 'WA');
    return isInstType && pNo === itNo;
  });
  return !!rec;
}

/**
 * Checks whether the admission fee has been paid
 */
export function isAdmissionFeePaid(admFee, paymentsList, student) {
  if (admFee <= 0) return true;
  const list = paymentsList || [];
  const admTxn = list.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'AD' || t === 'ADM' || t === 'ADMISSION';
  });
  if (admTxn) return true;
  const admPaidAtAdmission = Number(student?.dueAtAdmission?.admission ?? student?.dueAtAdmission?.total ?? 0);
  if (admPaidAtAdmission >= admFee && admFee > 0) return true;
  if (student?.receiptNo) return true;
  if (student?.admissionPaid === true || student?.isAdmissionPaid === true) return true;
  return false;
}

/**
 * Checks whether the study material fee has been paid
 */
export function isMaterialFeePaid(matFee, paymentsList, student) {
  if (matFee <= 0) return true;
  const list = paymentsList || [];
  const matTxn = list.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'MAT' || t === 'MATERIAL' || t === 'STUDY_MATERIAL';
  });
  if (matTxn) return true;
  const matPaidAtAdmission = Number(student?.dueAtAdmission?.material || 0);
  if (matPaidAtAdmission >= matFee && matFee > 0) return true;
  if (student?.materialPaid === true || student?.isMaterialPaid === true) return true;
  return false;
}

/**
 * Checks whether the examination fee has been paid
 */
export function isExamFeePaid(examFee, paymentsList, student) {
  if (examFee <= 0) return true;
  const list = paymentsList || [];
  const examTxn = list.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'EX' || t === 'EXAM' || t === 'EXAMINATION';
  });
  if (examTxn) return true;
  if (student?.examPaid === true || student?.isExamPaid === true) return true;
  return false;
}



/**
 * Calculates the total course package fee EXCLUDING examination fee.
 * Sum of: admission fee + study material fee + scheduled installments.
 * Used for all course fee, balance due, and progress percentage displays.
 */
export function courseFeeWithoutExam(student) {
  if (!student) return 0;
  const sched = Array.isArray(student.feeSchedule) ? student.feeSchedule : [];
  const instSum = sched.reduce((sum, it) => sum + Number(it.amount || 0), 0);
  const adm = Number(student.admissionFee ?? student.feeSnapshot?.admission ?? 0);
  const mat = Number(student.materialFee ?? student.feeSnapshot?.material ?? 0);
  if (instSum > 0 || adm > 0 || mat > 0) {
    return instSum + adm + mat;
  }
  const exam = Number(student.examFee ?? student.feeSnapshot?.exam ?? 0);
  const total = Number(student.feeTotal ?? 0);
  return Math.max(0, total - exam);
}

/**
 * Calculates student balance due EXCLUDING examination fee.
 * Subtracts payments made towards admission, material, and installments.
 */
export function courseBalanceWithoutExam(student, allPayments) {
  if (!student) return 0;
  const total = courseFeeWithoutExam(student);
  const payments = Array.isArray(allPayments) ? allPayments : [];
  const examPaymentsSum = payments
    .filter(p => ['EX', 'EXAM', 'EXAMINATION'].includes(String(p.type || '').toUpperCase()))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const rawPaid = Number(student.paidAmount ?? student.totalPaid ?? 0);
  const paidWithoutExam = Math.max(0, rawPaid - examPaymentsSum);
  return Math.max(0, total - paidWithoutExam);
}

/**
 * Calculates the course fee from scheduled installments ONLY.
 * Sum of student.feeSchedule[].amount only (no admission fee, no study material fee, no exam fee).
 */
export function installmentCourseFee(student) {
  if (!student) return 0;
  const sched = Array.isArray(student.feeSchedule) ? student.feeSchedule : [];
  return sched.reduce((sum, it) => sum + Number(it.amount || 0), 0);
}

/**
 * Calculates the balance due for installments ONLY.
 * installmentCourseFee(student) minus the sum of payments whose type is installment (IN / INST) only.
 * Does not subtract admission, material, exam or late fee payments. Minimum 0.
 */
export function installmentBalanceDue(student, allPayments) {
  if (!student) return 0;
  const total = installmentCourseFee(student);
  const payments = Array.isArray(allPayments) ? allPayments : [];
  const instPaid = payments
    .filter(p => {
      const t = String(p.type || '').toUpperCase().trim();
      return t === 'IN' || t === 'INST' || t === 'INSTALLMENT';
    })
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  return Math.max(0, total - instPaid);
}

/**
 * Records a payment inside a single atomic Firestore transaction.
 * - Reads student doc inside transaction to check if already paid
 * - Reads and increments receipt counter
 * - Writes payment subcollection doc
 * - Updates student doc (totals, paid installments, balance)
 * - Writes activity log doc
 */
export async function recordPaymentTx(tx, {
  studentDoc,
  type, // 'IN' (Installment) | 'EX' (Exam) | 'AD' (Admission) | 'MAT' (Material)
  installmentNo,
  month,
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
  // Payment date is always todayISO(), ignoring any client-provided date
  const pDate = todayISO();
  const isSuperAdminUser = (userRole === 'superadmin');
  const actualWaived = isSuperAdminUser && !!waived;
  const actualWaiverReason = actualWaived ? (waiverReason || '') : '';

  const org = studentDoc.ctx || 'youth';
  const bCode = branchCode || studentDoc.branchCode || 'HO';
  const studentRef = doc(db, COL, studentDoc.id);

  // 1. Transaction Read: Student doc fresh verification
  const studentSnap = await tx.get(studentRef);
  if (!studentSnap.exists()) {
    throw new Error('Student document does not exist.');
  }
  const sData = studentSnap.data();

  // Double-payment guard inside transaction
  const paidInsts = Array.isArray(sData.paidInstallments) ? [...sData.paidInstallments] : [];
  if (type === 'IN') {
    const instNo = Number(installmentNo);
    if (paidInsts.includes(instNo)) {
      throw new Error(`Installment ${instNo} has already been paid for this student.`);
    }
  } else if (type === 'EX') {
    if (sData.examPaid === true) {
      throw new Error('Exam fee has already been paid for this student.');
    }
  }

  // 2. Transaction Read: Receipt counter
  const rc = await readReceiptNo(tx, {
    org,
    type: type || 'IN',
    branchCode: bCode,
    date: pDate
  });

  // 3. Transaction Writes
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
  const totalAmount = numAmount + (actualWaived ? 0 : numLate);

  const currentPaid = Number(sData.paidAmount ?? sData.totalPaid ?? 0);
  const newPaid = currentPaid + numAmount;
  const newBalance = Math.max(0, Number(sData.feeTotal || studentDoc.feeTotal || 0) - newPaid);

  const paymentData = {
    amount: numAmount,
    lateFee: numLate,
    lateFeeAmount: numLate,
    lateFeeWaived: actualWaived,
    waived: actualWaived,
    waiverReason: actualWaiverReason,
    total: totalAmount,
    date: pDate,
    paidOn: pDate,
    type: type || 'IN',
    installmentNo: installmentNo != null ? Number(installmentNo) : null,
    month: month || '',
    mode: mode || 'cash',
    txnId: mode !== 'cash' ? (txnId || '') : '',
    receiptNo: rc.receiptNo,
    remarks: remarks || '',
    recordedBy: (userEmail || '').toLowerCase(),
    recordedByRole: userRole || '',
    recordedByName: userName || '',
    recordedAtBranchId: branchId || sData.branchId || 'HO',
    recordedAtBranchCode: bCode,
    recordedAtBranchName: branchName || sData.branchName || '',
    createdAt: serverTimestamp()
  };

  tx.set(paymentRef, paymentData);

  // Update student doc fields
  const studentUpdate = {
    paidAmount: newPaid,
    totalPaid: newPaid,
    balanceDue: newBalance,
    updatedAt: serverTimestamp(),
    updatedBy: (userEmail || '').toLowerCase()
  };

  if (type === 'IN') {
    const instNo = Number(installmentNo);
    if (!paidInsts.includes(instNo)) {
      paidInsts.push(instNo);
      paidInsts.sort((a, b) => a - b);
    }
    studentUpdate.paidInstallments = paidInsts;
    studentUpdate.installmentsPaid = paidInsts.length;

    // Also update feeSchedule items if present
    if (Array.isArray(sData.feeSchedule)) {
      studentUpdate.feeSchedule = sData.feeSchedule.map(item => {
        if (Number(item.no ?? item.installmentNo) === instNo) {
          return {
            ...item,
            paid: true,
            paidOn: pDate,
            receiptNo: rc.receiptNo,
            lateFee: numLate,
            waived: actualWaived
          };
        }
        return item;
      });
    }
  } else if (type === 'EX') {
    studentUpdate.examPaid = true;
    studentUpdate.examPaidOn = pDate;
    studentUpdate.examReceiptNo = rc.receiptNo;
  } else if (type === 'AD') {
    studentUpdate.admissionPaid = true;
    studentUpdate.admissionPaidOn = pDate;
  } else if (type === 'MAT') {
    studentUpdate.materialPaid = true;
    studentUpdate.materialPaidOn = pDate;
  }

  tx.update(studentRef, studentUpdate);

  // Activity log entry (append-only)
  const feeLabel = type === 'EX'
    ? 'Exam fee'
    : (type === 'MAT' ? 'Study material fee' : (type === 'AD' ? 'Admission fee' : `Installment ${installmentNo}`));

  const summary = `Collected ${rc.receiptNo} - ${feeLabel} Rs ${numAmount}` +
    (numLate > 0 ? (actualWaived ? ` (late fee Rs ${numLate} waived)` : ` (+ Rs ${numLate} late fee)`) : '') +
    ` via ${mode || 'cash'}`;

  tx.set(activityRef, {
    action: 'payment_recorded',
    summary,
    receiptNo: rc.receiptNo,
    type,
    installmentNo: installmentNo != null ? Number(installmentNo) : null,
    amount: numAmount,
    lateFee: numLate,
    waived: actualWaived,
    mode: mode || 'cash',
    changes: {
      paidAmount: { from: currentPaid, to: newPaid },
      balanceDue: { from: sData.balanceDue || 0, to: newBalance }
    },
    by: (userEmail || '').toLowerCase(),
    byRole: userRole || '',
    branchId: branchId || sData.branchId || '',
    at: serverTimestamp()
  });

  return {
    receiptNo: rc.receiptNo,
    paymentId: paymentRef.id,
    studentDocId: studentDoc.id
  };
}

/**
 * Convenience wrapper to execute recordPaymentTx within a Firestore transaction.
 */
export async function recordPayment(params) {
  return await runTransaction(db, (tx) => recordPaymentTx(tx, params));
}
