// school-lifecycle.js � Unique Kids student lifecycle helpers (upgrade, return,
// transfer, end, break, waiver, permanent delete).
//
// Canonical data model (separates identity from enrolment):
//
//   students/{id}               � permanent student identity (ctx='school')
//   students/{id}/docs/{key}    � photo, signature
//   students/{id}/aadhaar/aadhaar � private Aadhaar (Super Admin only)
//   students/{id}/payment/payment � immutable admission-payment record
//   enrolments/{id}             � one enrolment episode per admission/upgrade/return
//   bills/{id}                  � monthly bills (student-month unique)
//   payments/{id}               � monthly payments + allocations
//   waivers/{id}                � bill waivers (explicit, reason, staff)
//   breaks/{id}                 � approved break month ranges
//   transfers/{id}              � batch-only transfer audit
//   counters/sid_uk_<YYYY>      � Kids student ID counter (YYYYNNNN)
//   counters/rcpt_uk_<YY>_<type>_<branchCode> � receipt counter
//
// Money: rupees with 2 decimals in display/storage; integer paise used for
// comparisons. No floating-point drift (round to 2dp after every op).
//
// All runTransaction callbacks: tx.get first, then tx.set/tx.delete. No UI,
// no file compression, no external side effects inside callbacks.

import { db } from '../config/firebase-config.js';
import {
  collection, getDocs, query, where, doc, getDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, runTransaction, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.181';
import { firstMonthlyMonth } from './school-receipt.js?v=1.8.181';
import { isCourseActive, todayISO } from './session-rules.js?v=1.8.181';
const ENROLMENTS_COL = 'enrolments';
const BILLS_COL = 'bills';
const PAYMENTS_COL = 'payments';
const WAIVERS_COL = 'waivers';
const BREAKS_COL = 'breaks';
const TRANSFERS_COL = 'transfers';
const STUDENTS_COL = 'students';
const DOCS_COL = 'docs';
const AADHAAR_COL = 'aadhaar';
const PAYMENT_SUBCOL = 'payment';
const COUNTERS_COL = 'counters';

// ---------- helpers ----------

function pad4(n) { return String(n).padStart(4, '0'); }
function rupees(n) { return Math.round(Number(n || 0) * 100) / 100; }
function paise(n) { return Math.round(Number(n || 0) * 100); }

// localToday: YYYY-MM-DD in organisation timezone (Asia/Kolkata by default, never UTC)
export function localToday() {
  return todayISO();
}

// nextMonth: calendar +1 month
export function nextMonth(iso) {
  if (!iso) return '';
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return '';
  let total = p[0] * 12 + (p[1] - 1) + 1;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return ny + '-' + String(nm).padStart(2, '0');
}

// previousMonth: calendar -1 month
export function previousMonth(iso) {
  if (!iso) return '';
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3 || p.some((n) => !Number.isFinite(n))) return '';
  let total = p[0] * 12 + (p[1] - 1) - 1;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return ny + '-' + String(nm).padStart(2, '0');
}

// monthSeq: sortable integer for YYYY-MM
export function monthSeq(iso) {
  if (!iso) return 0;
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3) return 0;
  return p[0] * 12 + (p[1] - 1);
}

// ---------- student identity ----------

// Generate a new Kids Student ID: YYYYNNNN where YYYY = admission date year.
// Counter doc: counters/sid_uk_<YYYY>
export async function generateStudentIdTx(tx, admissionYear) {
  const counterId = 'sid_uk_' + admissionYear;
  const counterRef = doc(db, COUNTERS_COL, counterId);
  const snap = await tx.get(counterRef);
  const next = snap.exists() ? (Number(snap.data().seq || 0) + 1) : 1;
  if (next > 9999) throw new Error('Student ID counter exceeded 9999 for ' + counterId + '.');
  tx.set(counterRef, { seq: next, org: 'school', admissionYear, updatedAt: serverTimestamp() }, { merge: true });
  return admissionYear + pad4(next);
}

// ---------- enrolment ----------

// Create a new enrolment document. Returns the enrolment doc ref id.
export async function createEnrolmentTx(tx, { studentId, type, courseId, courseName, courseLevelName,
  batchId, batchName, progressionOrder, admissionDate, firstMonthlyMonth: fmm,
  admissionFee, monthlyFee, feeSnapshot, status, previousEnrolmentId, createdBy }) {
  const enrolRef = doc(collection(db, ENROLMENTS_COL));
  const data = {
    studentId, type, courseId, courseName, courseLevelName,
    batchId, batchName, progressionOrder,
    admissionDate, firstMonthlyMonth: fmm,
    admissionFee: rupees(admissionFee), monthlyFee: rupees(monthlyFee),
    feeSnapshot, status: status || 'active',
    createdAt: serverTimestamp(), createdBy: createdBy || null,
    billingFrom: fmm, billingTo: null,
    previousEnrolmentId: previousEnrolmentId || null
  };
  tx.set(enrolRef, data);
  return enrolRef.id;
}

// ---------- bills ----------

// Generate monthly bills for a student from startMonth (inclusive) to endMonth (inclusive, exclusive of break months).
// Idempotent: skips existing bill doc IDs (studentId + month).
export async function generateBillsTx(tx, { studentId, enrolmentId, courseId, courseName, courseLevelName,
  batchId, batchName, monthlyFee, startMonth, endMonth, breakMonths = new Set(), existingBillIds = new Set() }) {
  const created = [];
  let m = startMonth;
  while (monthSeq(m) <= monthSeq(endMonth)) {
    if (breakMonths.has(m)) { m = nextMonth(m); continue; }
    const billId = studentId + '|' + m;
    if (existingBillIds.has(billId)) { m = nextMonth(m); continue; }
    const billRef = doc(collection(db, BILLS_COL));
    tx.set(billRef, {
      id: billRef.id, studentId, enrolmentId, courseId, courseName, courseLevelName,
      batchId, batchName, month: m, monthlyFee: rupees(monthlyFee),
      status: 'unpaid', dueDate: m + '-10',
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    created.push(billRef.id);
    m = nextMonth(m);
  }
  return created;
}

// ---------- payments ----------

// Record a monthly payment. Returns payment doc ref id.
export async function recordPaymentTx(tx, { studentId, billId, month, amount, receivedDate, receivedBy }) {
  const payRef = doc(collection(db, PAYMENTS_COL));
  tx.set(payRef, {
    id: payRef.id, studentId, billId, month,
    amount: rupees(amount), receivedDate, receivedBy,
    createdAt: serverTimestamp()
  });
  // Mark bill paid
  const billRef = doc(db, BILLS_COL, billId);
  tx.update(billRef, { status: 'paid', paidAt: serverTimestamp(), paidBy: receivedBy });
  return payRef.id;
}

// ---------- break records ----------

export async function createBreakTx(tx, { studentId, startMonth, endMonth, reason, requestedBy, requestedAt,
  status = 'pending', approvedBy, approvedAt, modifiedBy, modifiedAt }) {
  const breakRef = doc(collection(db, BREAKS_COL));
  tx.set(breakRef, {
    id: breakRef.id, studentId, startMonth, endMonth, reason,
    status, requestedBy, requestedAt, approvedBy, approvedAt, modifiedBy, modifiedAt,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  return breakRef.id;
}

// ---------- waivers ----------

export async function createWaiverTx(tx, { studentId, billId, amount, reason, waivedBy, waivedAt }) {
  const waiverRef = doc(collection(db, WAIVERS_COL));
  tx.set(waiverRef, {
    id: waiverRef.id, studentId, billId, amount: rupees(amount), reason,
    waivedBy, waivedAt, createdAt: serverTimestamp()
  });
  return waiverRef.id;
}

// ---------- batch transfers ----------

export async function createTransferTx(tx, { studentId, oldBatchId, oldBatchName, newBatchId, newBatchName,
  effectiveDate, transferredBy, transferredAt, note }) {
  const transferRef = doc(collection(db, TRANSFERS_COL));
  tx.set(transferRef, {
    id: transferRef.id, studentId, oldBatchId, oldBatchName, newBatchId, newBatchName,
    effectiveDate, transferredBy, transferredAt, note, createdAt: serverTimestamp()
  });
  return transferRef.id;
}

// ---------- end course ----------

export async function endEnrolmentTx(tx, enrolmentId, { effectiveDate, reason, endedBy, endedAt }) {
  const enrolRef = doc(db, ENROLMENTS_COL, enrolmentId);
  const enrolSnap = await tx.get(enrolRef);
  if (!enrolSnap.exists()) throw new Error('Enrolment not found.');
  const studentId = enrolSnap.data().studentId;
  tx.update(enrolRef, {
    status: 'ended', endDate: effectiveDate, endReason: reason,
    endedBy, endedAt, updatedAt: serverTimestamp()
  });
  // Stop future billing: mark bills from next month as stopped (not paid, not generatable)
  const next = nextMonth(effectiveDate);
  const futureBills = await tx.get(query(collection(db, BILLS_COL),
    where('studentId', '==', studentId), where('month', '>=', next)));
  futureBills.forEach(d => tx.update(d.ref, { status: 'stopped', stoppedAt: serverTimestamp(), stoppedBy: endedBy }));
}

// ---------- validation helpers ----------

// Validate progression order: unique among active Kids levels, admissionFee non-decreasing.
// Returns {ok, error}.
export function validateProgressionOrder(levels, editedLevel) {
  const active = levels.filter(l => (l.status || 'active') === 'active');
  // uniqueness of progressionOrder
  const orders = active.filter(l => l.id !== editedLevel.id && l.progressionOrder != null)
    .map(l => l.progressionOrder);
  if (editedLevel.progressionOrder != null && orders.includes(editedLevel.progressionOrder)) {
    return { ok: false, error: 'Progression order already in use by another active level.' };
  }
  // admissionFee non-decreasing with progression
  const sorted = active.filter(l => l.progressionOrder != null).sort((a, b) => a.progressionOrder - b.progressionOrder);
  const editedIdx = sorted.findIndex(l => l.id === editedLevel.id);
  // check lower neighbour
  if (editedIdx > 0) {
    const lower = sorted[editedIdx - 1];
    if (editedLevel.admissionFee != null && lower.admissionFee != null && editedLevel.admissionFee < lower.admissionFee) {
      return { ok: false, error: 'Admission fee cannot decrease as progression advances.' };
    }
  }
  // check higher neighbour
  if (editedIdx < sorted.length - 1) {
    const higher = sorted[editedIdx + 1];
    if (editedLevel.admissionFee != null && higher.admissionFee != null && editedLevel.admissionFee > higher.admissionFee) {
      return { ok: false, error: 'A lower progression level cannot have a higher admission fee.' };
    }
  }
  return { ok: true };
}

// Check if any active Kids level lacks progressionOrder
export function levelsNeedOrder(levels) {
  const active = levels.filter(l => (l.status || 'active') === 'active');
  return active.filter(l => l.progressionOrder == null);
}

// ---------- Aadhaar uniqueness (client-side precheck only) ----------

// Check Aadhaar uniqueness against existing student docs.
// NOTE: Frontend precheck only; server-side HMAC lookup required for production.
export async function checkAadhaarUniqueness(aadhaar, excludeStudentId) {
  const snap = await getDocs(query(collection(db, STUDENTS_COL), where('ctx', '==', 'school')));
  const dup = snap.docs.find(d => {
    const data = d.data();
    if (d.id === excludeStudentId) return false;
    return data.aadhaar === aadhaar;
  });
  return { unique: !dup, existingStudentId: dup ? dup.id : null, existingName: dup ? (dup.data().name || '') : '' };
}

