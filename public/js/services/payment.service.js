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
import { readStudentId, readReceiptNo, writeCounter } from './admission.service.js?v=1.8.168';
import { fineFor, todayISO, installmentSchedule, examWindowOf } from '../utils/session-rules.js?v=1.8.168';
import { courseFeeOf } from '../utils/fees.js?v=1.8.168';
import { formatPersonName } from '../utils/formatter.js?v=1.8.168';
import { resolveUserDisplay } from './user-directory.service.js?v=1.8.168';

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
 * Unified calculation of student course package financials.
 * Used everywhere: Student Profile cards, Payment History, Pay Fees, Students list, Dashboard.
 *
 * Rules:
 * - Total fee (course) = 2500 for full plan (fullCourseFee), 3000 for installments (admission + installments).
 *   Study material is NEVER part of the course total anywhere.
 * - Paid (course) = course payments ONLY (FULL / AD / IN).
 *   Strictly excludes study material (MAT), exam (EX), and late fee (LF).
 *   Paid comes ONLY from real course payment records. If records are missing, shows the true lower number.
 * - Outstanding = Total - Paid, never below 0. Full plan: 2500 / 2500 / 0, 100%.
 * - Percent = Total > 0 ? min(100, round((Paid / Total) * 100)) : 0.
 * - Study material is shown only as its own "Study material - Paid at admission" line and in the admission receipt.
 */
export function calculateStudentFinancials(student, allPayments = []) {
  if (!student) {
    return { total: 0, paid: 0, outstanding: 0, percent: 0 };
  }

  const isFull = student.paymentPlan === 'full';

  // 1. Total: course package fee EXCLUDING examination fee AND EXCLUDING study material
  let total = 0;
  if (isFull) {
    total = Number(student.fullPaymentAmount ?? student.dueAtAdmission?.full ?? student.feeTotal ?? 0);
    if (!total || total <= 0) {
      total = courseFeeOf(student) || 0;
    }
  } else {
    const sched = Array.isArray(student.feeSchedule) ? student.feeSchedule : [];
    const instSum = sched.reduce((sum, it) => sum + Number(it.amount || 0), 0);
    const adm = Number(student.admissionFee ?? student.dueAtAdmission?.admission ?? student.feeSnapshot?.admission ?? 0);
    if (instSum > 0 || adm > 0) {
      total = instSum + adm;
    } else {
      total = courseFeeOf(student) || Math.max(0, Number(student.feeTotal || 0) - Number(student.examFee ?? student.feeSnapshot?.exam ?? 0) - Number(student.materialFee ?? student.feeSnapshot?.material ?? 0));
    }
  }

  // 2. Paid: course payments ONLY (FULL / AD / IN)
  // Strictly NOT material (MAT), NOT exam (EX), NOT late fee (LF), NOT waiver (WA).
  const payments = Array.isArray(allPayments) ? allPayments : [];
  let paid = 0;

  const fullReceiptNos = new Set(
    payments.filter(p => String(p.type || '').toUpperCase().trim() === 'FULL').map(p => p.receiptNo).filter(Boolean)
  );

  for (const p of payments) {
    const t = String(p.type || '').toUpperCase().trim();
    // Exclude exam fee, late fee, study material, and waiver
    if (t === 'EX' || t === 'EXAM' || t === 'EXAMINATION') continue;
    if (t === 'LF' || t === 'LATE_FEE' || t === 'LATEFEE') continue;
    if (t === 'MAT' || t === 'MATERIAL' || t === 'STUDY_MATERIAL') continue;
    if (t === 'WA' || t === 'WAIVER') continue;

    if (t === 'FULL') {
      paid += Number(p.amount || 0);
      continue;
    }

    if (t === 'AD' || t === 'ADM' || t === 'ADMISSION') {
      // Deduplicate: if student is on Full plan or FULL payment exists for this receiptNo, ignore extra AD record
      if (isFull || (p.receiptNo && fullReceiptNos.has(p.receiptNo))) {
        continue;
      }
      paid += Number(p.amount || 0);
      continue;
    }

    if (t === 'IN' || t === 'INST' || t === 'INSTALLMENT') {
      paid += Number(p.amount || 0);
      continue;
    }
  }

  if (paid > total && total > 0) {
    console.warn(`[calculateStudentFinancials] Student ${student.studentId || student.id || ''}: paid (${paid}) exceeds total (${total})`);
  }

  const outstanding = Math.max(0, total - paid);
  const percent = total > 0 ? Math.round((paid / total) * 100) : 0;

  return { total, paid, outstanding, percent };
}

/**
 * Builds the receipt menu items for a student.
 * Rules:
 * - Admission = ONE receipt. All items at admission (AD / FULL / MAT) share one receipt number
 *   and open as ONE admission receipt.
 * - Each installment = its own separate receipt.
 * - Exam fee = its own separate receipt.
 * - A FULL, AD or MAT payment is never shown as an "Installment".
 * - A WA (waiver) is never shown as an "Installment".
 */
export function buildReceiptMenuItems(s, payments = []) {
  if (!s) return [];
  const isSchool = s.ctx === 'school';
  const admReceiptRoute = isSchool
    ? `#/school-admissions/${s.id || s.studentId}/receipt`
    : `#/admissions/${s.id || s.studentId}/receipt`;

  const admReceiptNo = s.admissionReceiptNo || s.receiptNo || s.fullReceiptNo || '';

  // 1. Single Admission Receipt item
  const items = [
    {
      label: admReceiptNo ? `Admission receipt - ${admReceiptNo}` : 'Admission receipt',
      icon: 'file-text',
      onClick: () => { location.hash = admReceiptRoute; }
    }
  ];

  const seenReceiptNos = new Set();
  if (admReceiptNo) seenReceiptNos.add(admReceiptNo);

  // 2. Only list real installment (IN) and exam (EX) payments as separate receipts
  (payments || []).forEach(p => {
    const t = String(p.type || '').toUpperCase().trim();
    // Exclude admission payments, material, late fee, and waivers
    if (t === 'AD' || t === 'ADM' || t === 'ADMISSION' || t === 'FULL' || t === 'MAT' || t === 'MATERIAL' || t === 'WA' || t === 'WAIVER' || t === 'LF' || t === 'LATE_FEE' || t === 'LATEFEE') return;
    if (p.receiptNo && seenReceiptNos.has(p.receiptNo)) return;
    if (p.receiptNo) seenReceiptNos.add(p.receiptNo);

    if (t === 'EX' || t === 'EXAM' || t === 'EXAMINATION') {
      items.push({
        label: `Exam fee - ${p.receiptNo || 'Receipt'}`,
        icon: 'receipt',
        onClick: () => {
          location.hash = `#/payments/${s.id}/${p.id}/receipt?from=profile`;
        }
      });
    } else if (t === 'IN' || t === 'INST' || t === 'INSTALLMENT') {
      const no = p.installmentNo != null ? p.installmentNo : '';
      const mo = p.month ? ` (${p.month})` : '';
      items.push({
        label: `Installment ${no}${mo} - ${p.receiptNo || 'Receipt'}`,
        icon: 'receipt',
        onClick: () => {
          location.hash = `#/payments/${s.id}/${p.id}/receipt?from=profile`;
        }
      });
    }
  });

  return items;
}

/**
 * One-time repair helper: if a student has an admission receipt number
 * but is missing their AD or FULL (and/or MAT) subcollection payment record(s),
 * creates the missing record(s) with the student's existing receipt number and persists them to Firestore.
 */
export async function repairStudentAdmissionPayment(student, payments = []) {
  if (!student || !student.id) return [];
  const rcptNo = student.admissionReceiptNo || student.receiptNo || student.fullReceiptNo;
  if (!rcptNo) return [];

  const isFull = student.paymentPlan === 'full';
  const hasFull = payments.some(p => String(p.type || '').toUpperCase().trim() === 'FULL');
  const hasAd = payments.some(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'AD' || t === 'ADM' || t === 'ADMISSION';
  });
  const hasMat = payments.some(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'MAT' || t === 'MATERIAL' || t === 'STUDY_MATERIAL';
  });

  const pDate = student.admissionDate || student.fullPaidOn || student.admissionPaidOn || todayISO();
  const branchId = student.branchId || 'HO';
  const branchCode = student.branchCode || 'HO';
  const branchName = student.branchName || '';

  const added = [];

  if (isFull && !hasFull) {
    const fullAmt = Number(student.fullPaymentAmount || student.dueAtAdmission?.full || student.feeTotal || 0);
    if (fullAmt > 0) {
      const pRef = doc(collection(db, COL, student.id, 'payment'));
      const pData = {
        amount: fullAmt,
        baseAmount: fullAmt,
        lateFee: 0,
        lateFeeAmount: 0,
        lateFeeWaived: false,
        waived: false,
        waiverReason: '',
        total: fullAmt,
        date: pDate,
        paidOn: pDate,
        type: 'FULL',
        typeName: 'Full course fee',
        installmentNo: null,
        month: '',
        mode: 'cash',
        txnId: '',
        receiptNo: rcptNo,
        remarks: 'One-time system repair of missing admission payment record',
        recordedBy: 'system-repair',
        recordedByRole: 'system',
        recordedByName: 'System Repair',
        recordedAtBranchId: branchId,
        recordedAtBranchCode: branchCode,
        recordedAtBranchName: branchName,
        createdAt: serverTimestamp()
      };
      await setDoc(pRef, pData);
      const record = { id: pRef.id, ...pData };
      payments.push(record);
      added.push(record);
      console.log(`[repairStudentAdmissionPayment] Repaired FULL payment for ${student.studentId || student.id}: receipt ${rcptNo}, Rs ${fullAmt}`);
    }
  } else if (!isFull && !hasAd) {
    const admFee = Number(student.dueAtAdmission?.admission ?? student.feeSnapshot?.admission ?? student.admissionFee ?? 0);
    if (admFee > 0) {
      const pRef = doc(collection(db, COL, student.id, 'payment'));
      const pData = {
        amount: admFee,
        baseAmount: admFee,
        lateFee: 0,
        lateFeeAmount: 0,
        lateFeeWaived: false,
        waived: false,
        waiverReason: '',
        total: admFee,
        date: pDate,
        paidOn: pDate,
        type: 'AD',
        typeName: 'Admission fee',
        installmentNo: null,
        month: '',
        mode: 'cash',
        txnId: '',
        receiptNo: rcptNo,
        remarks: 'One-time system repair of missing admission payment record',
        recordedBy: 'system-repair',
        recordedByRole: 'system',
        recordedByName: 'System Repair',
        recordedAtBranchId: branchId,
        recordedAtBranchCode: branchCode,
        recordedAtBranchName: branchName,
        createdAt: serverTimestamp()
      };
      await setDoc(pRef, pData);
      const record = { id: pRef.id, ...pData };
      payments.push(record);
      added.push(record);
      console.log(`[repairStudentAdmissionPayment] Repaired AD payment for ${student.studentId || student.id}: receipt ${rcptNo}, Rs ${admFee}`);
    }
  }

  // Material fee repair
  const matFee = Number(student.dueAtAdmission?.material ?? student.feeSnapshot?.material ?? student.materialFee ?? 0);
  if (matFee > 0 && !hasMat) {
    const matRef = doc(collection(db, COL, student.id, 'payment'));
    const matData = {
      amount: matFee,
      baseAmount: matFee,
      lateFee: 0,
      lateFeeAmount: 0,
      lateFeeWaived: false,
      waived: false,
      waiverReason: '',
      total: matFee,
      date: pDate,
      paidOn: pDate,
      type: 'MAT',
      typeName: 'Study material',
      installmentNo: null,
      month: '',
      mode: 'cash',
      txnId: '',
      receiptNo: rcptNo,
      remarks: 'One-time system repair of missing material fee record',
      recordedBy: 'system-repair',
      recordedByRole: 'system',
      recordedByName: 'System Repair',
      recordedAtBranchId: branchId,
      recordedAtBranchCode: branchCode,
      recordedAtBranchName: branchName,
      createdAt: serverTimestamp()
    };
    await setDoc(matRef, matData);
    const record = { id: matRef.id, ...matData };
    payments.push(record);
    added.push(record);
    console.log(`[repairStudentAdmissionPayment] Repaired MAT payment for ${student.studentId || student.id}: receipt ${rcptNo}, Rs ${matFee}`);
  }

  return added;
}

/**
 * Calculates the total course package fee EXCLUDING examination fee.
 * Delegates to calculateStudentFinancials for single source of truth.
 */
export function courseFeeWithoutExam(student) {
  return calculateStudentFinancials(student, []).total;
}

/**
 * Calculates student balance due EXCLUDING examination fee.
 * Delegates to calculateStudentFinancials for single source of truth.
 */
export function courseBalanceWithoutExam(student, allPayments) {
  return calculateStudentFinancials(student, allPayments).outstanding;
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
  userDesignation,
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
  } else if (type === 'FULL') {
    if (sData.fullPaid === true) {
      throw new Error('Course fee has already been paid in full for this student.');
    }
  }

  // 2. Transaction Read: Receipt counter
  const counterType = type === 'FULL' ? 'AD' : (type || 'IN');
  const rc = await readReceiptNo(tx, {
    org,
    type: counterType,
    branchCode: bCode,
    date: pDate
  });

  // 3. Transaction Writes
  // Write counter increment
  writeCounter(tx, rc.ref, rc.next, {
    org,
    type: counterType,
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

  const recDisp = resolveUserDisplay(userEmail, userName, userDesignation);
  const recName = recDisp.name && recDisp.name !== '-' ? recDisp.name : (formatPersonName(userName || '') || userName || '');
  const recDesig = recDisp.designation || userDesignation || '';

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
    recordedByName: recName,
    recordedByDesignation: recDesig,
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
    studentUpdate.admissionReceiptNo = rc.receiptNo;
  } else if (type === 'MAT') {
    studentUpdate.materialPaid = true;
    studentUpdate.materialPaidOn = pDate;
    studentUpdate.materialReceiptNo = rc.receiptNo;
  } else if (type === 'FULL') {
    studentUpdate.fullPaid = true;
    studentUpdate.fullPaidOn = pDate;
    studentUpdate.fullReceiptNo = rc.receiptNo;
    studentUpdate.paymentPlan = 'full';
    studentUpdate.admissionPaid = true;
    studentUpdate.admissionPaidOn = pDate;
  }

  tx.update(studentRef, studentUpdate);

  // Activity log entry (append-only)
  const feeLabel = type === 'EX'
    ? 'Exam fee'
    : (type === 'MAT' ? 'Study material fee' : (type === 'AD' ? 'Admission fee' : (type === 'FULL' ? 'Course fee (Paid in full)' : `Installment ${installmentNo}`)));

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

/**
 * Records a new student admission and their admission payment in a single atomic transaction.
 * - Reads studentId counter and receipt counter
 * - Increments both counters
 * - Writes student document with complete financial records, payment plan ('full' | 'installments'),
 *   and feeSchedule (empty for full plan, 4 pending installments for installment plan)
 * - Writes student document subcollections: docs, aadhaar (if provided), payment, activity
 * Returns { ok: true, studentDocId, studentId, receiptNo, paymentId, studentData, totalPaid }
 */
export async function recordAdmissionWithPayment({
  pendingAdmission,
  paymentParams
}) {
  const pa = pendingAdmission || {};
  const pp = paymentParams || {};
  const pDate = todayISO();

  return await runTransaction(db, async (tx) => {
    // 1. Transaction Reads: Counters first
    const sid = await readStudentId(tx, {
      org: 'youth',
      sessionYear: pa.sessionYear,
      level: pa.courseLevel
    });

    const rc = await readReceiptNo(tx, {
      org: 'youth',
      type: 'AD',
      branchCode: pa.branchCode,
      date: pDate
    });

    // 2. Transaction Writes: Increment counters
    writeCounter(tx, sid.ref, sid.next, {
      org: 'youth',
      sessionYear: pa.sessionYear,
      level: pa.courseLevel
    });

    writeCounter(tx, rc.ref, rc.next, {
      org: 'youth',
      type: 'AD',
      branchCode: pa.branchCode,
      date: pDate
    });

    // 3. Prepare student document
    const studentRef = doc(collection(db, COL));
    const studentId = sid.studentId;
    const receiptNo = rc.receiptNo;

    let previousStudentIds = undefined;
    if (pa.returnDoc) {
      previousStudentIds = [pa.returnDoc.studentId, ...(pa.returnDoc.previousStudentIds || [])];
      previousStudentIds = [...new Set(previousStudentIds)];
    }

    const isFull = !!pa.isFull;
    const fullAmt = Number(pa.fullAmt || 0);
    const fullDisc = Number(pa.fullDisc || 0);
    const admFee = Number(pa.admFee || 0);
    const matFee = Number(pa.matFee || 0);
    const instFee = Number(pa.instFee || 0);
    const examFee = Number(pa.examFee || 0);

    const primaryAmt = isFull ? fullAmt : admFee;
    const payAmt = isFull ? (fullAmt + matFee) : (admFee + matFee);
    const balanceDue = isFull ? 0 : (instFee * 4);
    const courseFee = Number(pa.courseFee || (admFee + instFee * 4));
    const feeTotal = isFull ? fullAmt : courseFee;

    const studentData = {
      studentId: studentId,
      receiptNo: receiptNo,
      paymentPlan: isFull ? 'full' : 'installments',
      fullPaymentAmount: isFull ? fullAmt : null,
      fullPaymentDiscountRs: isFull ? Number(pa.fullDiscRs || pa.fullDisc || 0) : null,
      fullPaymentDiscountPct: isFull ? Number(pa.fullDiscPct || 0) : null,
      fullPaymentDiscount: isFull ? Number(pa.fullDiscRs || pa.fullDisc || 0) : null,
      fullPaid: isFull,
      fullPaidOn: isFull ? pDate : null,
      fullReceiptNo: isFull ? receiptNo : null,
      admissionPaid: true,
      admissionPaidOn: pDate,
      admissionReceiptNo: receiptNo,
      materialPaid: matFee > 0,
      materialPaidOn: matFee > 0 ? pDate : null,
      materialReceiptNo: matFee > 0 ? receiptNo : null,
      name: pa.studentData.name,
      guardianName: pa.studentData.guardianName,
      phone: pa.studentData.phone,
      altPhone: pa.studentData.altPhone || '',
      email: pa.studentData.email || '',
      dob: pa.studentData.dob,
      gender: pa.studentData.gender,
      qualification: pa.studentData.qualification,
      address: pa.studentData.address,
      ctx: 'youth',
      status: 'active',
      docs: {},
      createdAt: serverTimestamp(),
      createdBy: (pp.userEmail || pa.userEmail || '').toLowerCase(),
      updatedAt: serverTimestamp(),
      updatedBy: (pp.userEmail || pa.userEmail || '').toLowerCase(),
      branchId: pa.branchId,
      branchName: pa.branchName,
      branchCode: pa.branchCode,
      courseId: pa.courseId,
      courseCode: pa.studentData.courseCode || '',
      courseName: pa.studentData.courseName || '',
      batchId: pa.batchId,
      batchName: pa.studentData.batchName || '',
      sessionId: pa.sessionId,
      sessionName: pa.studentData.sessionName || '',
      admissionDate: pa.studentData.admissionDate || pDate,
      feeTotal: feeTotal,
      paidAmount: primaryAmt,
      totalPaid: primaryAmt,
      balanceDue: balanceDue,
      feeSnapshot: pa.feeSnapshot || {},
      feeSchedule: isFull
        ? []
        : (pa.sched || []).map((it) => ({
            no: it.no,
            month: it.month,
            opens: it.opens,
            due: it.due,
            amount: instFee,
            paid: false,
            status: 'pending'
          })),
      paidInstallments: [],
      installmentsPaid: 0,
      examFee: examFee,
      dueAtAdmission: isFull
        ? { full: fullAmt, material: matFee, total: payAmt }
        : { admission: admFee, material: matFee, total: payAmt },
      prereqCheck: pa.prereqCheck || null,
      ...(previousStudentIds !== undefined ? { previousStudentIds } : {}),
      ...(pa.sourceAdmission ? { sourceAdmission: pa.sourceAdmission } : {})
    };

    // Filter undefined fields
    Object.keys(studentData).forEach((k) => {
      if (studentData[k] === undefined) delete studentData[k];
    });

    const docsMap = pa.docs || {};
    Object.keys(docsMap).forEach((k) => {
      studentData.docs[k] = !!docsMap[k];
    });

    // Write student doc
    tx.set(studentRef, studentData);

    // Write docs subcollection
    Object.entries(docsMap).forEach(([key, docData]) => {
      if (docData) {
        const docRef = doc(collection(studentRef, 'docs'), key);
        tx.set(docRef, Object.assign({}, docData, { updatedAt: serverTimestamp() }));
      }
    });

    // Write aadhaar subcollection if present
    if (pa.aadhaar) {
      const aadhaarRef = doc(db, COL, studentRef.id, 'aadhaar', 'aadhaar');
      tx.set(aadhaarRef, {
        studentId: studentId,
        aadhaar: pa.aadhaar,
        updatedAt: serverTimestamp()
      });
    }

    // Write payment subcollection record(s):
    // Full plan: one 'FULL' record for fullAmt, plus one 'MAT' record if matFee > 0
    // Installments plan: one 'AD' record for admFee, plus one 'MAT' record if matFee > 0
    const admEmail = (pp.userEmail || pa.userEmail || '').toLowerCase();
    const admDisp = resolveUserDisplay(admEmail, pp.userName, pp.userDesignation);
    const admRecName = admDisp.name && admDisp.name !== '-' ? admDisp.name : (formatPersonName(pp.userName || '') || pp.userName || '');
    const admRecDesig = admDisp.designation || pp.userDesignation || '';

    const paymentRef = doc(collection(studentRef, 'payment'));
    const paymentData = {
      amount: primaryAmt,
      baseAmount: primaryAmt,
      lateFee: 0,
      lateFeeAmount: 0,
      lateFeeWaived: false,
      waived: false,
      waiverReason: '',
      total: primaryAmt,
      date: pDate,
      paidOn: pDate,
      type: isFull ? 'FULL' : 'AD',
      typeName: isFull ? 'Full course fee' : 'Admission fee',
      installmentNo: null,
      month: '',
      mode: pp.mode || 'cash',
      txnId: pp.mode !== 'cash' ? (pp.txnId || '') : '',
      receiptNo: receiptNo,
      remarks: pp.remarks || '',
      recordedBy: admEmail,
      recordedByRole: pp.userRole || '',
      recordedByName: admRecName,
      recordedByDesignation: admRecDesig,
      recordedAtBranchId: pp.branchId || pa.branchId || 'HO',
      recordedAtBranchCode: pp.branchCode || pa.branchCode || 'HO',
      recordedAtBranchName: pp.branchName || pa.branchName || '',
      createdAt: serverTimestamp()
    };
    tx.set(paymentRef, paymentData);

    if (matFee > 0) {
      const matPaymentRef = doc(collection(studentRef, 'payment'));
      const matPaymentData = {
        amount: matFee,
        baseAmount: matFee,
        lateFee: 0,
        lateFeeAmount: 0,
        lateFeeWaived: false,
        waived: false,
        waiverReason: '',
        total: matFee,
        date: pDate,
        paidOn: pDate,
        type: 'MAT',
        typeName: 'Study material',
        installmentNo: null,
        month: '',
        mode: pp.mode || 'cash',
        txnId: pp.mode !== 'cash' ? (pp.txnId || '') : '',
        receiptNo: receiptNo,
        remarks: pp.remarks || '',
        recordedBy: admEmail,
        recordedByRole: pp.userRole || '',
        recordedByName: admRecName,
        recordedByDesignation: admRecDesig,
        recordedAtBranchId: pp.branchId || pa.branchId || 'HO',
        recordedAtBranchCode: pp.branchCode || pa.branchCode || 'HO',
        recordedAtBranchName: pp.branchName || pa.branchName || '',
        createdAt: serverTimestamp()
      };
      tx.set(matPaymentRef, matPaymentData);
    }

    // Write activity subcollection record
    const activityRef = doc(collection(studentRef, 'activity'));
    const summary = isFull
      ? `Admitted on Full Payment plan with payment of Rs ${payAmt} (Course fee Rs ${fullAmt}${matFee > 0 ? ' + Study material Rs ' + matFee : ''}, Receipt: ${receiptNo}) via ${pp.mode || 'cash'}`
      : `Admitted on Installments plan with payment of Rs ${payAmt} (Admission fee Rs ${admFee}${matFee > 0 ? ' + Study material Rs ' + matFee : ''}, Receipt: ${receiptNo}) via ${pp.mode || 'cash'}`;

    tx.set(activityRef, {
      action: 'admission_and_payment',
      summary: summary,
      receiptNo: receiptNo,
      type: isFull ? 'FULL' : 'AD',
      amount: payAmt,
      lateFee: 0,
      waived: false,
      mode: pp.mode || 'cash',
      changes: {
        paidAmount: { from: 0, to: primaryAmt },
        balanceDue: { from: feeTotal, to: balanceDue }
      },
      by: (pp.userEmail || pa.userEmail || '').toLowerCase(),
      byRole: pp.userRole || '',
      branchId: pp.branchId || pa.branchId || '',
      at: serverTimestamp()
    });

    return {
      ok: true,
      studentDocId: studentRef.id,
      studentId: studentId,
      receiptNo: receiptNo,
      paymentId: paymentRef.id,
      studentData: studentData,
      totalPaid: payAmt
    };
  });
}

// ---------- Shared Dues & Payment History Evaluators (Single Source of Truth) ----------

const NON_ELIGIBLE_STUDENT_STATUSES = new Set([
  'inactive', 'dropped', 'left', 'completed', 'ended', 'transferred', 'deleted', 'archived'
]);

/**
 * Only active students accrue pending/overdue installments or bills.
 * Left/dropped/inactive/ended/completed/transferred/deleted students are excluded from Pending & Overdue
 * while retaining full historical receipts in Payment History.
 */
export function isStudentEligibleForDues(student) {
  if (!student) return false;
  const st = String(student.status || 'active').toLowerCase().trim();
  return !NON_ELIGIBLE_STUDENT_STATUSES.has(st);
}

/**
 * Computes Youth student pending & overdue fee items + financials using shared single-source rules.
 * - Course installments: full-plan students never appear for installments; unpaid installments become
 *   Upcoming (< opens), Due (opens .. due), or Overdue (> due, late fee Rs 1/day via calculateLateFee).
 * - Exam fee: due ONLY inside examWindowOf(session) (4th installment due + 1 day .. session end),
 *   never overdue before that.
 */
export function evaluateYouthStudentDues(student, paymentsList = [], session = null, { asOfDate, course, coursesById, branchesById, batchesById } = {}) {
  const financials = calculateStudentFinancials(student, paymentsList);
  if (!student || student.ctx === 'school' || !isStudentEligibleForDues(student)) {
    return { eligible: false, items: [], financials };
  }

  const today = asOfDate || todayISO();
  const cObj = course || (coursesById && coursesById[student.courseId]) || null;
  const brObj = (branchesById && branchesById[student.branchId]) || null;
  const baObj = (batchesById && batchesById[student.batchId]) || null;

  const baseMeta = {
    ctx: 'youth',
    studentDocId: student.id,
    studentId: student.studentId || student.id || '',
    studentName: student.name || 'Student',
    phone: student.phone || '',
    branchId: student.branchId || '',
    branchCode: student.branchCode || brObj?.code || brObj?.branchCode || brObj?.shortCode || '',
    branchName: student.branchName || brObj?.name || '',
    courseId: student.courseId || '',
    courseCode: cObj?.courseCode || cObj?.code || student.courseCode || '',
    courseName: student.courseName || cObj?.name || '',
    batchId: student.batchId || '',
    batchName: student.batchName || baObj?.name || '',
    sessionId: student.sessionId || session?.id || '',
    sessionName: student.sessionName || session?.name || '',
    student,
    financials
  };

  const items = [];
  const isFull = student.paymentPlan === 'full';

  if (!isFull) {
    const fallbackSched = session ? installmentSchedule(session) : [];
    const rawSched = Array.isArray(student.feeSchedule) && student.feeSchedule.length ? student.feeSchedule : fallbackSched;
    const defaultInstAmt = Number(student.feeSnapshot?.installment ?? cObj?.fees?.installment ?? 0);

    for (const it of rawSched) {
      const no = Number(it.no ?? it.installmentNo);
      if (!no || !Number.isFinite(no)) continue;
      if (isInstallmentPaid(it, paymentsList, student)) continue;

      const month = it.month || '';
      const opens = it.opens || (month ? `${month}-01` : '');
      const dueDate = it.due || (month ? `${month}-10` : '');
      const amt = Number(it.amount ?? defaultInstAmt ?? 0);

      let status = 'upcoming';
      let daysLate = 0;
      let lateFee = 0;
      if (dueDate && today > dueDate) {
        status = 'overdue';
        daysLate = calculateLateFee(dueDate, today);
        lateFee = daysLate;
      } else if (opens && today >= opens) {
        status = 'due';
      }

      items.push({
        ...baseMeta,
        kind: 'IN',
        installmentNo: no,
        preselectedOption: 'IN_' + no,
        whatIsDue: `Installment ${no}${month ? ' (' + month + ')' : ''}`,
        month,
        opens,
        dueDate,
        amount: amt,
        daysLate,
        lateFee,
        totalPayable: amt + lateFee,
        status
      });
    }
  }

  // Exam fee: due ONLY inside the exam window (day after 4th installment due until session end).
  if (session) {
    const ew = examWindowOf(session);
    const inExamWindow = !!(ew.from && today >= ew.from && (!ew.to || today <= ew.to));
    if (inExamWindow) {
      const feesMap = session.examFeeCollection?.fees;
      const hasLockedSessionFee = session.examFeeCollection?.started === true &&
        feesMap && student.courseId && Object.prototype.hasOwnProperty.call(feesMap, student.courseId);
      const examFee = hasLockedSessionFee
        ? Number(feesMap[student.courseId])
        : Number(cObj?.fees?.exam ?? student.feeSnapshot?.exam ?? student.examFee ?? 0);

      if (examFee > 0 && !isExamFeePaid(examFee, paymentsList, student)) {
        items.push({
          ...baseMeta,
          kind: 'EX',
          installmentNo: null,
          preselectedOption: 'EX',
          whatIsDue: 'Examination Fee',
          month: '',
          opens: ew.from,
          dueDate: ew.to || ew.from,
          amount: examFee,
          daysLate: 0,
          lateFee: 0,
          totalPayable: examFee,
          status: 'due'
        });
      }
    }
  }

  return { eligible: true, items, financials };
}

/**
 * Normalizes raw Youth `students/{id}/payment/*` docs into ledger entries for Payment History:
 * - Groups admission items (AD / FULL / MAT) sharing the same receipt number into ONE row with breakdown
 *   so totals are never double counted.
 * - Keeps each IN and EX payment as its own row with exact paid vs waived late fee split.
 * - Flags pure waivers (WA) so they never add to money received.
 */
export function normalizeYouthPaymentsLedger(paymentsList = [], studentsById = new Map(), { branchesById = {}, coursesById = {}, requireParentStudent = false } = {}) {
  const byStudentFullReceipts = new Map();
  const groupedAdmissions = new Map();
  const rows = [];

  // Pass 1: collect FULL receipt numbers per student for legacy AD deduplication.
  for (const p of (paymentsList || [])) {
    if (!p) continue;
    const sDocId = p.studentDocId || p._studentDocId || '';
    const s = studentsById instanceof Map ? studentsById.get(sDocId) : studentsById[sDocId];
    if (requireParentStudent && (!s || s.ctx === 'school')) continue;
    const t = String(p.type || '').toUpperCase().trim();
    if (t === 'FULL' && p.receiptNo) {
      if (!byStudentFullReceipts.has(sDocId)) byStudentFullReceipts.set(sDocId, new Set());
      byStudentFullReceipts.get(sDocId).add(p.receiptNo);
    }
  }

  const labelForType = (t, p) => {
    if (t === 'FULL') return 'Full course fee';
    if (t === 'AD' || t === 'ADM' || t === 'ADMISSION') return 'Admission fee';
    if (t === 'MAT' || t === 'MATERIAL' || t === 'STUDY_MATERIAL') return 'Study material';
    if (t === 'EX' || t === 'EXAM' || t === 'EXAMINATION') return 'Exam fee';
    if (t === 'IN' || t === 'INST' || t === 'INSTALLMENT') {
      const no = p?.installmentNo != null ? p.installmentNo : '';
      return `Installment ${no}`.trim();
    }
    if (t === 'WA' || t === 'WAIVER') return 'Fee waiver';
    return t || 'Payment';
  };

  for (const p of (paymentsList || [])) {
    if (!p) continue;
    const sDocId = p.studentDocId || p._studentDocId || '';
    const s = studentsById instanceof Map ? studentsById.get(sDocId) : studentsById[sDocId];
    if (requireParentStudent && (!s || s.ctx === 'school')) continue;
    if (s && s.ctx === 'school') continue;

    const rawType = String(p.type || '').toUpperCase().trim();
    const isAd = rawType === 'AD' || rawType === 'ADM' || rawType === 'ADMISSION';
    const isFull = rawType === 'FULL';
    const isMat = rawType === 'MAT' || rawType === 'MATERIAL' || rawType === 'STUDY_MATERIAL';
    const isWaiver = rawType === 'WA' || rawType === 'WAIVER';
    const isFullStudent = s?.paymentPlan === 'full';
    const fullSet = byStudentFullReceipts.get(sDocId);

    if (isAd && (isFullStudent || (p.receiptNo && fullSet && fullSet.has(p.receiptNo)))) {
      continue;
    }

    const branchId = p.recordedAtBranchId || s?.branchId || '';
    const brObj = branchesById[branchId] || {};
    const cObj = (s && coursesById[s.courseId]) || {};
    const date = p.paidOn || p.date || (p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toISOString().slice(0, 10) : '');
    const mode = (p.mode || 'cash').toLowerCase();
    const txnId = p.txnId || '';
    const recordedBy = (p.recordedBy || s?.createdBy || '').toLowerCase();
    const recordedByName = p.recordedByName || '';
    const recordedByDesignation = p.recordedByDesignation || '';

    if (isAd || isFull || isMat) {
      const rcptKey = `${sDocId}|${p.receiptNo || s?.admissionReceiptNo || s?.receiptNo || p.id}`;
      const normSub = isFull ? 'FULL' : (isMat ? 'MAT' : 'AD');
      const amt = Number(p.amount || 0);
      const lfVal = Number(p.lateFee ?? p.lateFeeAmount ?? 0);
      const waived = !!(p.waived || p.lateFeeWaived);
      const lfPaid = waived ? 0 : lfVal;
      const lfWaived = waived ? lfVal : 0;

      if (!groupedAdmissions.has(rcptKey)) {
        groupedAdmissions.set(rcptKey, {
          id: p.id,
          ctx: 'youth',
          isAdmissionGroup: true,
          date,
          receiptNo: p.receiptNo || s?.admissionReceiptNo || s?.receiptNo || '',
          studentDocId: sDocId,
          studentId: s?.studentId || sDocId,
          studentName: s?.name || 'Student',
          phone: s?.phone || '',
          branchId,
          branchCode: brObj.code || brObj.branchCode || p.recordedAtBranchCode || s?.branchCode || '',
          branchName: p.recordedAtBranchName || s?.branchName || brObj.name || '',
          courseId: s?.courseId || '',
          courseCode: cObj.courseCode || cObj.code || s?.courseCode || '',
          courseName: s?.courseName || cObj.name || '',
          sessionId: s?.sessionId || '',
          sessionName: s?.sessionName || '',
          type: 'ADMISSION',
          subTypes: new Set(),
          breakdown: [],
          mode,
          txnId,
          amount: 0,
          lateFeePaid: 0,
          lateFeeWaived: 0,
          totalReceived: 0,
          isPureWaiver: false,
          recordedBy,
          recordedByName,
          recordedByDesignation,
          remarks: p.remarks || '',
          receiptRoute: sDocId ? `#/admissions/${encodeURIComponent(sDocId)}/receipt` : '',
          createdAtSec: p.createdAt?.seconds || (typeof p.createdAt?.toMillis === 'function' ? Math.floor(p.createdAt.toMillis() / 1000) : 0)
        });
      }

      const grp = groupedAdmissions.get(rcptKey);
      grp.subTypes.add(normSub);
      grp.breakdown.push({
        id: p.id,
        type: normSub,
        label: labelForType(normSub, p),
        amount: amt
      });
      grp.amount += amt;
      grp.lateFeePaid += lfPaid;
      grp.lateFeeWaived += lfWaived;
      grp.totalReceived += (p.total != null ? Number(p.total) : (amt + lfPaid));
      if (!grp.waiverReason && p.waiverReason) grp.waiverReason = p.waiverReason;
      if (!isMat && p.id) grp.id = p.id;
      if (date && (!grp.date || date > grp.date)) grp.date = date;
      if (!grp.txnId && txnId) grp.txnId = txnId;
      if (!grp.recordedBy && recordedBy) grp.recordedBy = recordedBy;
      if (!grp.recordedByName && recordedByName) grp.recordedByName = recordedByName;
      if (!grp.recordedByDesignation && recordedByDesignation) grp.recordedByDesignation = recordedByDesignation;
      continue;
    }

    const normType = (rawType === 'INST' || rawType === 'INSTALLMENT')
      ? 'IN'
      : (rawType === 'EXAM' || rawType === 'EXAMINATION')
        ? 'EX'
        : (isWaiver ? 'WA' : (rawType || 'IN'));

    const amt = isWaiver ? 0 : Number(p.amount || 0);
    const lfVal = Number(p.lateFee ?? p.lateFeeAmount ?? 0);
    const isLateWaived = !!(p.waived || p.lateFeeWaived);
    const lfPaid = (!isWaiver && !isLateWaived) ? lfVal : 0;
    const lfWaived = isWaiver
      ? (Number(p.amount || 0) || lfVal || 0)
      : (isLateWaived ? lfVal : 0);
    const totalRecv = isWaiver
      ? 0
      : (p.total != null ? Number(p.total) : (amt + lfPaid));

    const instNo = p.installmentNo != null ? Number(p.installmentNo) : null;
    const schedMatch = instNo && Array.isArray(s?.feeSchedule)
      ? s.feeSchedule.find((it) => Number(it.no ?? it.installmentNo) === instNo)
      : null;
    const instMonth = p.month || schedMatch?.month || '';
    const dueDate = p.dueDate || schedMatch?.due || (instMonth ? `${instMonth}-10` : '');

    rows.push({
      id: p.id,
      ctx: 'youth',
      isAdmissionGroup: false,
      date,
      receiptNo: p.receiptNo || '',
      studentDocId: sDocId,
      studentId: s?.studentId || sDocId,
      studentName: s?.name || 'Student',
      phone: s?.phone || '',
      branchId,
      branchCode: brObj.code || brObj.branchCode || p.recordedAtBranchCode || s?.branchCode || '',
      branchName: p.recordedAtBranchName || s?.branchName || brObj.name || '',
      courseId: s?.courseId || '',
      courseCode: cObj.courseCode || cObj.code || s?.courseCode || '',
      courseName: s?.courseName || cObj.name || '',
      sessionId: s?.sessionId || '',
      sessionName: s?.sessionName || '',
      type: normType,
      subTypes: new Set([normType]),
      typeLabel: labelForType(normType, p),
      installmentNo: instNo,
      month: instMonth,
      dueDate,
      breakdown: [],
      mode: isWaiver ? 'waiver' : mode,
      txnId,
      amount: amt,
      lateFeePaid: lfPaid,
      lateFeeWaived: lfWaived,
      waiverReason: p.waiverReason || '',
      totalReceived: totalRecv,
      isPureWaiver: isWaiver,
      recordedBy,
      recordedByName,
      recordedByDesignation,
      remarks: p.remarks || '',
      receiptRoute: sDocId ? `#/payments/${encodeURIComponent(sDocId)}/${encodeURIComponent(p.id || 'latest')}/receipt?from=payments` : '',
      createdAtSec: p.createdAt?.seconds || (typeof p.createdAt?.toMillis === 'function' ? Math.floor(p.createdAt.toMillis() / 1000) : 0)
    });
  }

  for (const grp of groupedAdmissions.values()) {
    const hasFull = grp.subTypes.has('FULL');
    const hasAd = grp.subTypes.has('AD');
    const hasMat = grp.subTypes.has('MAT');
    if (hasFull && hasMat) grp.typeLabel = 'Full course fee + Study material';
    else if (hasFull) grp.typeLabel = 'Full course fee';
    else if (hasAd && hasMat) grp.typeLabel = 'Admission + Study material';
    else if (hasAd) grp.typeLabel = 'Admission fee';
    else if (hasMat) grp.typeLabel = 'Study material';
    else grp.typeLabel = 'Admission';

    grp.type = hasFull ? 'FULL' : (hasAd ? 'AD' : 'MAT');
    grp.breakdown.sort((a, b) => {
      const order = { FULL: 1, AD: 1, MAT: 2 };
      return (order[a.type] || 9) - (order[b.type] || 9);
    });
    rows.push(grp);
  }

  rows.sort((a, b) => {
    const da = a.date || '';
    const dbDate = b.date || '';
    if (da !== dbDate) return dbDate.localeCompare(da);
    const ca = Number(a.createdAtSec || 0);
    const cb = Number(b.createdAtSec || 0);
    if (ca !== cb) return cb - ca;
    return String(b.receiptNo || '').localeCompare(String(a.receiptNo || ''));
  });

  return rows;
}
