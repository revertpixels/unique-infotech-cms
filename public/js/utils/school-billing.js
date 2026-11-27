// school-billing.js � Monthly bill generation, late fees, and payment allocation
// for Unique Kids (ongoing, session-independent billing).
//
// Canonical bill identity: studentId + month (YYYY-MM). Idempotent generation.
// Late fee: Rs 1/day from the 11th (configured org timezone, not browser UTC).
//
// Money: rupees with 2 decimals; integer paise for comparisons.

import { db } from '../config/firebase-config.js';
import {
  collection, getDocs, query, where, doc, getDoc, addDoc, updateDoc, serverTimestamp,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.180';
import { localToday, monthSeq, nextMonth, previousMonth } from './school-lifecycle.js?v=1.8.180';
import { fineFor } from './session-rules.js?v=1.8.180';

const BILLS_COL = 'bills';
const PAYMENTS_COL = 'payments';
const WAIVERS_COL = 'waivers';
const LATE_FEE_PER_DAY = 1; // Rs 1 per day, organisation-level setting

function rupees(n) { return Math.round(Number(n || 0) * 100) / 100; }

// ---------- bill month helpers ----------

// Is a given month a "billing month" (opened on the 1st)?
// A month is billable once we reach its 1st day.
export function monthIsOpen(monthISO) {
  const today = localToday();
  return monthSeq(monthISO) <= monthSeq(today);
}

// Due date for a month: YYYY-MM-10
export function dueDateForMonth(monthISO) {
  return monthISO + '-10';
}

function fmtMonthLabel(monthISO) {
  if (!monthISO) return '';
  const m = /^(\d{4})-(\d{2})/.exec(String(monthISO));
  if (!m) return String(monthISO);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(dt);
}

// Days late for a given month (as of asOfDate or today in org timezone).
// 0 = on or before the 10th of the billing month; Rs 1/day after the 10th.
export function daysLate(monthISO, asOfDate) {
  if (!monthISO) return 0;
  const today = asOfDate || localToday();
  const due = dueDateForMonth(monthISO);
  return fineFor(due, today);
}

// ---------- bill generation ----------

// Generate bills for a student from startMonth to endMonth (inclusive), skipping
// break months and already-existing bills. Idempotent.
// Returns array of created bill refs.
export async function generateStudentBills(tx, {
  studentId, enrolmentId, courseId, courseName, courseLevelName,
  batchId, batchName, monthlyFee, startMonth, endMonth, breakMonths = new Set()
}) {
  const existing = await getDocs(query(collection(db, 'bills'),
    where('studentId', '==', studentId),
    where('month', '>=', startMonth),
    where('month', '<=', endMonth)));
  const existingIds = new Set(existing.docs.map(d => d.data().month));

  const created = [];
  let m = startMonth;
  while (monthSeq(m) <= monthSeq(endMonth)) {
    if (breakMonths.has(m)) { m = nextMonth(m); continue; }
    if (existingIds.has(m)) { m = nextMonth(m); continue; }
    if (!monthIsOpen(m)) { m = nextMonth(m); continue; } // don't bill future months before opening

    const billRef = doc(collection(db, BILLS_COL));
    tx.set(billRef, {
      id: billRef.id, studentId, enrolmentId, courseId, courseName, courseLevelName,
      batchId, batchName, month: m, monthlyFee: rupees(monthlyFee),
      status: 'unpaid', dueDate: dueDateForMonth(m),
      lateFee: 0, paidAmount: 0,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    created.push({ id: billRef.id, month: m, monthlyFee: rupees(monthlyFee), dueDate: dueDateForMonth(m) });
    m = nextMonth(m);
  }
  return created;
}

// Compute late fee for an unpaid or partial bill as of today (0 for paid/stopped/break-waived).
export function computeLateFee(bill, asOfDate) {
  if (!bill) return 0;
  const st = String(bill.status || 'unpaid').toLowerCase();
  if (st !== 'unpaid' && st !== 'partial') return 0;
  const dl = daysLate(bill.month, asOfDate);
  return dl > 0 ? dl * LATE_FEE_PER_DAY : 0;
}

// ---------- payment recording ----------

// Record a payment against a bill. Handles allocation (bill first, then oldest unpaid).
// Returns { paymentId, allocations: [{billId, amount, lateFeeCovered}] }.
export async function recordPayment(tx, {
  studentId, amount, receivedDate, receivedBy, receivedByName = '', receivedByDesignation = '', allocation = 'auto'
}) {
  amount = rupees(amount);
  let remaining = amount;
  const allocations = [];

  // Get all unpaid/partially-paid bills for this student, oldest first
  const billsSnap = await getDocs(query(collection(db, BILLS_COL),
    where('studentId', '==', studentId),
    where('status', 'in', ['unpaid', 'partial'])));
  const bills = billsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => monthSeq(a.month) - monthSeq(b.month));

  for (const bill of bills) {
    if (remaining <= 0) break;
    const billLate = computeLateFee(bill);
    const billDue = rupees(bill.monthlyFee) + billLate;
    const billRemaining = rupees(billDue) - rupees(bill.paidAmount || 0);
    if (billRemaining <= 0) continue;
    const payThis = Math.min(remaining, billRemaining);
    const lateCovered = Math.min(payThis, billLate);
    const feeCovered = payThis - lateCovered;

    const allocRef = doc(collection(db, PAYMENTS_COL));
    tx.set(allocRef, {
      id: allocRef.id, studentId, billId: bill.id, month: bill.month,
      amount: rupees(payThis), lateFeeCovered: rupees(lateCovered),
      feeCovered: rupees(feeCovered), receivedDate, receivedBy,
      ...(receivedByName ? { receivedByName } : {}),
      ...(receivedByDesignation ? { recordedByDesignation: receivedByDesignation } : {}),
      createdAt: serverTimestamp()
    });

    const newPaid = rupees(bill.paidAmount || 0) + payThis;
    const newStatus = newPaid >= rupees(bill.monthlyFee) + billLate ? 'paid' : 'partial';
    tx.update(doc(db, BILLS_COL, bill.id), {
      paidAmount: rupees(newPaid), status: newStatus, updatedAt: serverTimestamp()
    });

    allocations.push({ billId: bill.id, month: bill.month, amount: rupees(payThis),
      lateFeeCovered: rupees(lateCovered), feeCovered: rupees(feeCovered) });
    remaining = rupees(remaining - payThis);
  }

  const payRef = doc(collection(db, PAYMENTS_COL));
  tx.set(payRef, {
    id: payRef.id, studentId, totalAmount: amount, receivedDate, receivedBy,
    ...(receivedByName ? { receivedByName } : {}),
    ...(receivedByDesignation ? { recordedByDesignation: receivedByDesignation } : {}),
    allocations: allocations.map(a => ({ billId: a.billId, amount: a.amount })),
    createdAt: serverTimestamp()
  });

  return { paymentId: payRef.id, allocations, remaining: rupees(remaining) };
}

// ---------- overdue listing ----------

// Get all overdue unpaid bills for a student (with late fee computed).
export async function getOverdueBills(studentId) {
  const snap = await getDocs(query(collection(db, BILLS_COL),
    where('studentId', '==', studentId),
    where('status', 'in', ['unpaid', 'partial'])));
  const bills = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return bills.filter(b => daysLate(b.month) > 0).map(b => ({
    ...b, lateFee: computeLateFee(b), totalDue: rupees(b.monthlyFee) + computeLateFee(b),
    daysLate: daysLate(b.month)
  }));
}

// ---------- waiver ----------

// Apply a waiver to a bill (reduce outstanding amount). Cannot waive more than outstanding.
export async function applyWaiver(tx, { studentId, billId, amount, reason, waivedBy, waivedAt }) {
  const billRef = doc(db, BILLS_COL, billId);
  const snap = await tx.get(billRef);
  if (!snap.exists()) throw new Error('Bill not found.');
  const bill = snap.data();
  const outstanding = rupees(bill.monthlyFee) + computeLateFee(bill) - rupees(bill.paidAmount || 0);
  amount = rupees(amount);
  if (amount > outstanding) throw new Error('Cannot waive more than outstanding amount (?' + outstanding + ').');

  const waiverRef = doc(collection(db, WAIVERS_COL));
  tx.set(waiverRef, {
    id: waiverRef.id, studentId, billId, amount, reason,
    waivedBy, waivedAt, createdAt: serverTimestamp()
  });
  tx.update(billRef, {
    waivedAmount: rupees((bill.waivedAmount || 0) + amount),
    updatedAt: serverTimestamp(), updatedBy: waivedBy
  });
  return { waiverId: waiverRef.id, amount, remaining: rupees(outstanding - amount) };
}

// ---------- shared Pending & Ledger builders for Unique Kids ----------

export function isKidsStudentEligible(student) {
  if (!student) return false;
  const st = String(student.status || 'active').toLowerCase().trim();
  return st === 'active';
}

export function buildApprovedBreakMonthsMap(breaks = []) {
  const byStudent = new Map();
  for (const br of (breaks || [])) {
    if (!br || String(br.status || '').toLowerCase() !== 'approved') continue;
    const key = br.studentId;
    if (!key || !br.startMonth || !br.endMonth) continue;
    if (!byStudent.has(key)) byStudent.set(key, new Set());
    const set = byStudent.get(key);
    let m = br.startMonth;
    let guard = 0;
    while (m && monthSeq(m + '-01') <= monthSeq(br.endMonth + '-01') && guard < 120) {
      set.add(m);
      m = nextMonth(m + '-01');
      guard += 1;
    }
  }
  return byStudent;
}

export function evaluateKidsPendingBills({ students = [], bills = [], breaks = [], asOfDate } = {}) {
  const today = asOfDate || localToday();
  const currentMonth = today.slice(0, 7);
  const byDocId = new Map();
  const byCode = new Map();
  for (const s of (students || [])) {
    if (s.id) byDocId.set(s.id, s);
    if (s.studentId) byCode.set(String(s.studentId), s);
  }
  const breakMap = buildApprovedBreakMonthsMap(breaks);

  const items = [];
  for (const bill of (bills || [])) {
    if (!bill) continue;
    const st = String(bill.status || 'unpaid').toLowerCase();
    if (st !== 'unpaid' && st !== 'partial') continue;

    const student = byDocId.get(bill.studentId) || byCode.get(String(bill.studentId || ''));
    if (student && !isKidsStudentEligible(student)) continue;
    if (!student) continue; // ignore orphan bills of deleted students

    const breakSet = breakMap.get(student.id) || breakMap.get(student.studentId);
    if (breakSet && breakSet.has(bill.month)) continue;

    const dueDate = bill.dueDate || dueDateForMonth(bill.month);
    const feeTotal = rupees(bill.monthlyFee || 0);
    const paidAmt = rupees(bill.paidAmount || 0);
    const waivedAmt = rupees(bill.waivedAmount || 0);
    const baseRemaining = Math.max(0, rupees(feeTotal - paidAmt - waivedAmt));
    const dl = daysLate(bill.month, today);
    const lf = dl > 0 ? dl * LATE_FEE_PER_DAY : 0;

    if (baseRemaining <= 0 && lf <= 0) continue;

    let status = 'upcoming';
    if (today > dueDate && dl > 0) status = 'overdue';
    else if (bill.month <= currentMonth) status = 'due';

    items.push({
      ctx: 'school',
      billId: bill.id,
      studentDocId: student.id,
      studentId: student.studentId || student.id,
      studentName: student.name || 'Student',
      phone: student.phone || '',
      branchId: student.branchId || 'HO',
      branchCode: 'HO',
      branchName: student.branchName || 'Head Office',
      courseId: bill.courseId || student.courseId || '',
      courseName: bill.courseLevelName || bill.courseName || student.courseName || '',
      batchId: bill.batchId || student.batchId || '',
      batchName: bill.batchName || student.batchName || '',
      sessionId: '',
      sessionName: 'Monthly Billing',
      kind: 'KIDS_MONTHLY',
      whatIsDue: `Monthly Fee (${bill.month || ''})`,
      month: bill.month || '',
      dueDate,
      opens: bill.month ? bill.month + '-01' : dueDate,
      daysLate: status === 'overdue' ? dl : 0,
      lateFee: status === 'overdue' ? lf : 0,
      amount: baseRemaining,
      totalPayable: rupees(baseRemaining + (status === 'overdue' ? lf : 0)),
      status,
      bill,
      student
    });
  }
  return items;
}

export function buildKidsPaymentLedger({ students = [], admissionPayments = [], paymentsDocs = [], waiversDocs = [] } = {}) {
  const byDocId = new Map();
  const byCode = new Map();
  for (const s of (students || [])) {
    if (s.id) byDocId.set(s.id, s);
    if (s.studentId) byCode.set(String(s.studentId), s);
  }
  const resolveStudent = (p) => byDocId.get(p.studentDocId || p.studentId) || byCode.get(String(p.studentId || '')) || null;

  const entries = [];

  const toSec = (ts) => (ts?.seconds) || (typeof ts?.toMillis === 'function' ? Math.floor(ts.toMillis() / 1000) : 0);

  // 1. Kids admission payments (students/{id}/payment/payment)
  for (const ap of (admissionPayments || [])) {
    const s = resolveStudent(ap);
    if (!s) continue;
    const amt = rupees(ap.actualAmountReceived ?? ap.receivedTotal ?? ap.admissionFee ?? 0);
    if (amt <= 0) continue; // Free/no-payment exemptions are not money received
    const date = ap.admissionDate || s.admissionDate || '';
    entries.push({
      id: ap.id || 'adm-' + s.id,
      ctx: 'school',
      date,
      receiptNo: ap.receiptNo || s.receiptNo || '',
      studentDocId: s.id,
      studentId: s.studentId || s.id,
      studentName: s.name || 'Student',
      phone: s.phone || '',
      branchId: s.branchId || 'HO',
      branchCode: 'HO',
      branchName: s.branchName || 'Head Office',
      homeBranchId: s.branchId || 'HO',
      homeBranchCode: 'HO',
      homeBranchName: s.branchName || 'Head Office',
      collectedAtType: 'head_office',
      collectedAtBranchId: 'HO',
      collectedAtBranchCode: 'HO',
      collectedAtBranchName: 'Head Office',
      collectedByRole: String(ap.recordedByRole || '').toLowerCase(),
      isCrossBranch: false,
      courseId: s.courseId || '',
      courseName: s.courseLevelName || s.courseName || '',
      type: 'AD',
      typeLabel: 'Kids admission',
      mode: (ap.paymentMode === 'full' || ap.paymentMode === 'difference') ? 'cash' : (ap.paymentMode || 'cash'),
      txnId: ap.txnId || '',
      amount: amt,
      lateFeePaid: 0,
      lateFeeWaived: 0,
      totalReceived: amt,
      isPureWaiver: false,
      recordedBy: (ap.createdBy || s.createdBy || '').toLowerCase(),
      recordedByName: ap.receivedByName || ap.recordedByName || '',
      recordedByDesignation: ap.recordedByDesignation || '',
      remarks: ap.paymentMode === 'difference' ? 'Upgrade difference admission fee' : 'Admission fee',
      receiptRoute: `#/school-admissions/${encodeURIComponent(s.id)}/receipt`,
      createdAtSec: toSec(ap.createdAt)
    });
  }

  // 2. Root `payments` collection (deduplicate allocation vs parent summary records)
  const allocs = [];
  const summaries = [];
  for (const p of (paymentsDocs || [])) {
    if (p.billId || p.month) allocs.push(p);
    else summaries.push(p);
  }
  const allocKeys = new Set(allocs.map(a => `${a.studentId || ''}|${a.receivedDate || ''}`));

  for (const a of allocs) {
    const s = resolveStudent(a);
    if (!s) continue;
    const lfPaid = rupees(a.lateFeeCovered || 0);
    const feePart = a.feeCovered != null ? rupees(a.feeCovered) : Math.max(0, rupees(Number(a.amount || 0) - lfPaid));
    const totalAmt = a.amount != null ? rupees(a.amount) : rupees(feePart + lfPaid);
    entries.push({
      id: a.id,
      ctx: 'school',
      billId: a.billId || '',
      month: a.month || '',
      billPeriod: a.month ? fmtMonthLabel(a.month) : '',
      dueDate: a.month ? dueDateForMonth(a.month) : '',
      date: a.receivedDate || '',
      receiptNo: a.receiptNo || '—',
      studentDocId: s.id,
      studentId: s.studentId || s.id,
      studentName: s.name || 'Student',
      phone: s.phone || '',
      branchId: s.branchId || 'HO',
      branchCode: 'HO',
      branchName: s.branchName || 'Head Office',
      homeBranchId: s.branchId || 'HO',
      homeBranchCode: 'HO',
      homeBranchName: s.branchName || 'Head Office',
      collectedAtType: 'head_office',
      collectedAtBranchId: 'HO',
      collectedAtBranchCode: 'HO',
      collectedAtBranchName: 'Head Office',
      collectedByRole: String(a.receivedByRole || a.recordedByRole || '').toLowerCase(),
      isCrossBranch: false,
      courseId: s.courseId || '',
      courseName: s.courseLevelName || s.courseName || '',
      type: 'KIDS_MONTHLY',
      typeLabel: `Kids monthly fee${a.month ? ' (' + a.month + ')' : ''}`,
      mode: (a.mode || 'cash').toLowerCase(),
      txnId: a.txnId || '',
      amount: feePart,
      lateFeePaid: lfPaid,
      lateFeeWaived: 0,
      totalReceived: totalAmt,
      isPureWaiver: false,
      recordedBy: (a.receivedBy || '').toLowerCase(),
      recordedByName: a.receivedByName || a.recordedByName || '',
      recordedByDesignation: a.recordedByDesignation || '',
      remarks: a.remarks || (a.month ? `Month ${a.month}` : ''),
      receiptRoute: `#/students/${encodeURIComponent(s.id)}?tab=payments`,
      createdAtSec: toSec(a.createdAt)
    });
  }

  for (const p of summaries) {
    if (allocKeys.has(`${p.studentId || ''}|${p.receivedDate || ''}`)) continue;
    const s = resolveStudent(p);
    if (!s) continue;
    const amt = rupees(p.totalAmount ?? p.amount ?? 0);
    if (amt <= 0) continue;
    entries.push({
      id: p.id,
      ctx: 'school',
      allocations: Array.isArray(p.allocations) ? p.allocations : [],
      date: p.receivedDate || '',
      receiptNo: p.receiptNo || '—',
      studentDocId: s.id,
      studentId: s.studentId || s.id,
      studentName: s.name || 'Student',
      phone: s.phone || '',
      branchId: s.branchId || 'HO',
      branchCode: 'HO',
      branchName: s.branchName || 'Head Office',
      homeBranchId: s.branchId || 'HO',
      homeBranchCode: 'HO',
      homeBranchName: s.branchName || 'Head Office',
      collectedAtType: 'head_office',
      collectedAtBranchId: 'HO',
      collectedAtBranchCode: 'HO',
      collectedAtBranchName: 'Head Office',
      collectedByRole: String(p.receivedByRole || p.recordedByRole || '').toLowerCase(),
      isCrossBranch: false,
      courseId: s.courseId || '',
      courseName: s.courseLevelName || s.courseName || '',
      type: 'KIDS_MONTHLY',
      typeLabel: 'Kids monthly fee',
      mode: (p.mode || 'cash').toLowerCase(),
      txnId: p.txnId || '',
      amount: amt,
      lateFeePaid: 0,
      lateFeeWaived: 0,
      totalReceived: amt,
      isPureWaiver: false,
      recordedBy: (p.receivedBy || '').toLowerCase(),
      recordedByName: p.receivedByName || p.recordedByName || '',
      recordedByDesignation: p.recordedByDesignation || '',
      remarks: p.remarks || '',
      receiptRoute: `#/students/${encodeURIComponent(s.id)}?tab=payments`,
      createdAtSec: toSec(p.createdAt)
    });
  }

  // 3. Root `waivers` collection (shown as waivers, never counted as money received)
  for (const w of (waiversDocs || [])) {
    const s = resolveStudent(w);
    if (!s) continue;
    const wAmt = rupees(w.amount || 0);
    entries.push({
      id: 'waiv-' + w.id,
      ctx: 'school',
      billId: w.billId || '',
      month: w.month || '',
      billPeriod: w.month ? fmtMonthLabel(w.month) : '',
      dueDate: w.month ? dueDateForMonth(w.month) : '',
      date: w.waivedAt || '',
      receiptNo: 'WAIVER',
      studentDocId: s.id,
      studentId: s.studentId || s.id,
      studentName: s.name || 'Student',
      phone: s.phone || '',
      branchId: s.branchId || 'HO',
      branchCode: 'HO',
      branchName: s.branchName || 'Head Office',
      homeBranchId: s.branchId || 'HO',
      homeBranchCode: 'HO',
      homeBranchName: s.branchName || 'Head Office',
      collectedAtType: 'head_office',
      collectedAtBranchId: 'HO',
      collectedAtBranchCode: 'HO',
      collectedAtBranchName: 'Head Office',
      collectedByRole: String(w.waivedByRole || '').toLowerCase(),
      isCrossBranch: false,
      courseId: s.courseId || '',
      courseName: s.courseLevelName || s.courseName || '',
      type: 'WA',
      typeLabel: 'Bill waiver',
      mode: 'waiver',
      txnId: '',
      amount: 0,
      lateFeePaid: 0,
      lateFeeWaived: wAmt,
      waiverReason: w.reason || 'Fee waiver',
      totalReceived: 0,
      isPureWaiver: true,
      recordedBy: (w.waivedBy || '').toLowerCase(),
      recordedByName: w.waivedByName || '',
      recordedByDesignation: w.waivedByDesignation || '',
      remarks: w.reason || 'Fee waiver',
      receiptRoute: `#/students/${encodeURIComponent(s.id)}?tab=payments`,
      createdAtSec: toSec(w.createdAt)
    });
  }

  return entries;
}

