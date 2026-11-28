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
  runTransaction, writeBatch, arrayUnion
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.198';
import { localToday, monthSeq, nextMonth, previousMonth } from './school-lifecycle.js?v=1.8.198';
import { firstMonthlyMonth } from './school-receipt.js?v=1.8.198';
import { fineFor } from './session-rules.js?v=1.8.198';
import { readReceiptNo, writeCounter } from '../services/admission.service.js?v=1.8.198';

const BILLS_COL = 'bills';
const PAYMENTS_COL = 'payments';
const WAIVERS_COL = 'waivers';
const BREAKS_COL = 'breaks';
const ENROLMENTS_COL = 'enrolments';
const STUDENTS_COL = 'students';
const LATE_FEE_PER_DAY = 1; // Rs 1 per day, organisation-level setting

function rupees(n) { return Math.round(Number(n || 0) * 100) / 100; }

// ---------- calendar YYYY-MM helpers ----------

export function addMonthsYM(ym, delta) {
  if (!ym) return '';
  const m = /^(\d{4})-(\d{2})/.exec(String(ym));
  if (!m) return '';
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + Number(delta || 0);
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return ny + '-' + String(nm).padStart(2, '0');
}

export function ymRange(fromYM, toYM) {
  const out = [];
  if (!fromYM || !toYM) return out;
  let cur = String(fromYM).slice(0, 7);
  const end = String(toYM).slice(0, 7);
  let guard = 0;
  while (cur && monthSeq(cur) <= monthSeq(end) && guard < 120) {
    out.push(cur);
    cur = addMonthsYM(cur, 1);
    guard += 1;
  }
  return out;
}

export function formatLongMonthYear(ym) {
  if (!ym || !/^\d{4}-\d{2}/.test(String(ym))) return String(ym || '');
  const parts = String(ym).slice(0, 7).split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, 1));
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(dt);
}

export function formatShortMonthYear(ym) {
  if (!ym || !/^\d{4}-\d{2}/.test(String(ym))) return String(ym || '');
  const parts = String(ym).slice(0, 7).split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, 1));
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(dt);
}

export function formatBreakPeriod(fromYM, toYM) {
  const a = String(fromYM || '').slice(0, 7);
  const b = String(toYM || '').slice(0, 7);
  if (!a && !b) return '-';
  if (!b || a === b) return formatShortMonthYear(a || b);
  if (!a) return formatShortMonthYear(b);
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  const m1Short = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short' }).format(new Date(Date.UTC(y1, m1 - 1, 1)));
  const m2Short = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', month: 'short' }).format(new Date(Date.UTC(y2, m2 - 1, 1)));
  if (y1 === y2) return `${m1Short}-${m2Short} ${y1}`;
  return `${m1Short} ${y1}-${m2Short} ${y2}`;
}

export function formatBreakStatusText(studentOrBreak, asOfDate) {
  const fromYM = studentOrBreak?.startMonth || studentOrBreak?.breakFrom || '';
  const toYM = studentOrBreak?.plannedEndMonth || studentOrBreak?.endMonth || studentOrBreak?.breakTo || '';
  const period = (fromYM || toYM) ? ` (${formatBreakPeriod(fromYM, toYM)})` : '';
  if (isBreakOverdueReturn(studentOrBreak, asOfDate)) {
    return `On Break${period} · Rejoin overdue`;
  }
  return `On Break${period}`;
}

// Compute allowed start month and explanatory message under Rule 1 & Rule 3:
// Breaks ALWAYS start from the NEXT month or later; current month can never become a break month.
export function computeStartBreakRange({ requestDate, today } = {}) {
  const todayStr = today || localToday();
  const currentYM = todayStr.slice(0, 7);
  const reqYM = (requestDate && /^\d{4}-\d{2}/.test(requestDate)) ? requestDate.slice(0, 7) : currentYM;
  const anchorYM = reqYM > currentYM ? reqYM : currentYM;
  const minStartMonth = addMonthsYM(currentYM, 1);
  const autoStartMonth = addMonthsYM(anchorYM, 1);
  const anchorLabel = formatLongMonthYear(anchorYM);
  const startLabel = formatShortMonthYear(autoStartMonth);
  const notice = `${anchorLabel} is charged in full; break starts ${startLabel}`;
  return { currentYM, anchorYM, minStartMonth, autoStartMonth, notice };
}

export function isBreakOverdueReturn(record, asOfDate) {
  if (!record) return false;
  const st = String(record.status || '').toLowerCase().trim();
  const isOngoingBreak = (st === 'break' || st === 'active' || st === 'approved') && !record.actualReturnDate && !record.actualReturnMonth;
  if (!isOngoingBreak) return false;
  const endYM = String(record.plannedEndMonth || record.endMonth || record.breakTo || '').slice(0, 7);
  if (!endYM) return false;
  const curYM = String(asOfDate || localToday()).slice(0, 7);
  return curYM > endYM;
}

// Allowed options and default for "First monthly billing month" dropdown (Kids Admissions & Upgrades):
// - Only TWO options are allowed: next month (+1) or month after next (+2) from anchor date.
// - Full / Difference payment -> default is month after next (+2 months; gap month in between).
// - No payment -> default is next month (+1 month).
export function computeBillingStartBounds({ anchorDate, today, paymentMode = 'full', mode = 'admission' } = {}) {
  const refDate = anchorDate || today || localToday();
  const anchorYM = String(refDate).slice(0, 7);
  const nextMonthYM = addMonthsYM(anchorYM, 1);
  const afterNextMonthYM = addMonthsYM(anchorYM, 2);
  const modeKey = String(paymentMode || 'full').toLowerCase().trim();
  const defaultYM = modeKey === 'none' ? nextMonthYM : afterNextMonthYM;
  return {
    anchorYM,
    mode,
    paymentMode: modeKey,
    nextMonthYM,
    afterNextMonthYM,
    options: [nextMonthYM, afterNextMonthYM],
    defaultYM,
    minYM: nextMonthYM,
    maxYM: afterNextMonthYM
  };
}

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
  studentId, studentCode = '', enrolmentId = '', courseId = '', courseName = '', courseLevelName = '',
  batchId = '', batchName = '', monthlyFee = 0, startMonth, endMonth, breakMonths = new Set()
}) {
  const existing = await getDocs(query(collection(db, 'bills'),
    where('studentId', '==', studentId),
    where('month', '>=', startMonth),
    where('month', '<=', endMonth)));
  const existingMonths = new Set(existing.docs.map(d => d.data().month));
  if (studentCode && studentCode !== studentId) {
    const existingCode = await getDocs(query(collection(db, 'bills'),
      where('studentId', '==', studentCode),
      where('month', '>=', startMonth),
      where('month', '<=', endMonth)));
    existingCode.docs.forEach(d => existingMonths.add(d.data().month));
  }

  const created = [];
  let m = startMonth;
  while (monthSeq(m) <= monthSeq(endMonth)) {
    if (breakMonths.has(m)) { m = nextMonth(m); continue; }
    if (existingMonths.has(m)) { m = nextMonth(m); continue; }
    if (!monthIsOpen(m)) { m = nextMonth(m); continue; } // don't bill future months before opening

    const billId = `${studentId}_${m}`;
    const billRef = doc(db, BILLS_COL, billId);
    const billObj = {
      id: billRef.id, ctx: 'school', studentId, ...(studentCode ? { studentCode } : {}),
      enrolmentId, courseId, courseName, courseLevelName,
      batchId, batchName, month: m, monthlyFee: rupees(monthlyFee),
      status: 'unpaid', dueDate: dueDateForMonth(m),
      lateFee: 0, paidAmount: 0,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    tx.set(billRef, billObj);
    created.push(billObj);
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
  studentId, amount, receivedDate, receivedBy, receivedByName = '', receivedByDesignation = '',
  mode = 'cash', txnId = '', remarks = '', allocation = 'auto'
}) {
  amount = rupees(amount);
  const cleanMode = String(mode || 'cash').toLowerCase().trim() || 'cash';
  const cleanTxn = cleanMode !== 'cash' ? String(txnId || '').trim() : '';
  const cleanRemarks = String(remarks || '').trim();
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
    const billDue = Math.max(0, rupees(bill.monthlyFee) + billLate - rupees(bill.waivedAmount || 0));
    const billRemaining = rupees(billDue) - rupees(bill.paidAmount || 0);
    if (billRemaining <= 0) continue;
    const payThis = Math.min(remaining, billRemaining);
    const lateCovered = Math.min(payThis, billLate);
    const feeCovered = payThis - lateCovered;

    const allocRef = doc(collection(db, PAYMENTS_COL));
    tx.set(allocRef, {
      id: allocRef.id, ctx: 'school', studentId, billId: bill.id, month: bill.month,
      amount: rupees(payThis), lateFeeCovered: rupees(lateCovered),
      feeCovered: rupees(feeCovered), mode: cleanMode,
      ...(cleanTxn ? { txnId: cleanTxn } : { txnId: '' }),
      ...(cleanRemarks ? { remarks: cleanRemarks } : {}),
      receivedDate, receivedBy,
      ...(receivedByName ? { receivedByName } : {}),
      ...(receivedByDesignation ? { recordedByDesignation: receivedByDesignation } : {}),
      createdAt: serverTimestamp()
    });

    const newPaid = rupees(bill.paidAmount || 0) + payThis;
    const newStatus = newPaid >= billDue ? 'paid' : 'partial';
    tx.update(doc(db, BILLS_COL, bill.id), {
      paidAmount: rupees(newPaid), status: newStatus, paymentMode: cleanMode,
      ...(cleanTxn ? { txnId: cleanTxn } : {}),
      updatedAt: serverTimestamp()
    });

    allocations.push({ billId: bill.id, month: bill.month, amount: rupees(payThis),
      lateFeeCovered: rupees(lateCovered), feeCovered: rupees(feeCovered) });
    remaining = rupees(remaining - payThis);
  }

  const payRef = doc(collection(db, PAYMENTS_COL));
  tx.set(payRef, {
    id: payRef.id, ctx: 'school', studentId, totalAmount: amount, receivedDate, receivedBy,
    mode: cleanMode, txnId: cleanTxn, ...(cleanRemarks ? { remarks: cleanRemarks } : {}),
    ...(receivedByName ? { receivedByName } : {}),
    ...(receivedByDesignation ? { recordedByDesignation: receivedByDesignation } : {}),
    allocations: allocations.map(a => ({ billId: a.billId, amount: a.amount })),
    createdAt: serverTimestamp()
  });

  return { paymentId: payRef.id, allocations, remaining: rupees(remaining) };
}

/**
 * Fetches unpaid/partial Unique Kids monthly bills for a student sorted oldest first.
 */
export async function fetchOpenKidsBillsForStudent(student) {
  if (!student) return [];
  const keys = [...new Set([student.id, student.studentId].filter(Boolean))];
  const bills = [];
  for (const k of keys) {
    const snap = await getDocs(query(
      collection(db, BILLS_COL),
      where('studentId', '==', k),
      where('status', 'in', ['unpaid', 'partial'])
    )).catch(() => null);
    if (snap) {
      snap.docs.forEach((d) => {
        if (!bills.some((x) => x.id === d.id)) bills.push({ id: d.id, ...d.data() });
      });
    }
  }
  return bills.sort((a, b) => monthSeq(a.month) - monthSeq(b.month));
}

/**
 * Atomically records payment for a specific Unique Kids monthly bill inside a Firestore transaction,
 * generating a sequential Kids receipt number (`UK<YY>MN-<CENTRE>-<NNNN>`), saving payment mode +
 * transaction ID, handling optional Super Admin late-fine waiver, and updating bill status.
 */
export async function recordKidsBillPayment({
  studentDoc,
  bill,
  mode = 'cash',
  txnId = '',
  remarks = '',
  waived = false,
  waiverReason = '',
  paymentDate,
  userEmail = '',
  userName = '',
  userDesignation = '',
  userRole = ''
} = {}) {
  if (!studentDoc || !studentDoc.id) throw new Error('Student record is required.');
  if (!bill || !bill.id) throw new Error('Select a monthly bill to pay.');

  const payDate = paymentDate || localToday();
  const cleanMode = String(mode || 'cash').toLowerCase().trim() || 'cash';
  const cleanTxn = cleanMode !== 'cash' ? String(txnId || '').trim() : '';
  const cleanRemarks = String(remarks || '').trim();
  const cleanEmail = String(userEmail || '').toLowerCase().trim();
  const cleanWaiverReason = waived ? String(waiverReason || '').trim() : '';
  if (waived && !cleanWaiverReason) throw new Error('Waiver reason is required to waive late fine.');

  return runTransaction(db, async (tx) => {
    const billRef = doc(db, BILLS_COL, bill.id);
    const orgRef = doc(db, 'settings', 'org_config');
    const orgSnap = await tx.get(orgRef);
    const liveBillSnap = await tx.get(billRef);
    if (!liveBillSnap.exists()) throw new Error('Monthly bill no longer exists.');
    const liveBill = { id: liveBillSnap.id, ...liveBillSnap.data() };
    const st = String(liveBill.status || 'unpaid').toLowerCase();
    if (st !== 'unpaid' && st !== 'partial') {
      throw new Error('This monthly bill has already been settled.');
    }

    const configuredCode = String(orgSnap.exists() ? orgSnap.data().receiptCode || '' : '').trim().toUpperCase();
    const centreCode = /^[A-Z0-9]{2,12}$/.test(configuredCode) ? configuredCode : (studentDoc.receiptCentreCode || 'HO');
    const rc = await readReceiptNo(tx, { org: 'school', type: 'MN', branchCode: centreCode, date: payDate });

    const monthlyFee = rupees(liveBill.monthlyFee || 0);
    const priorPaid = rupees(liveBill.paidAmount || 0);
    const priorWaived = rupees(liveBill.waivedAmount || 0);
    const baseRemaining = Math.max(0, rupees(monthlyFee - priorPaid - priorWaived));
    const computedLate = computeLateFee(liveBill, payDate);
    const waivedAmt = (waived && computedLate > 0) ? rupees(computedLate) : 0;
    const latePaid = (waived && computedLate > 0) ? 0 : rupees(computedLate);
    const totalPaid = rupees(baseRemaining + latePaid);
    if (totalPaid <= 0 && waivedAmt <= 0) {
      throw new Error('Nothing due for this monthly bill.');
    }

    const allocRef = doc(collection(db, PAYMENTS_COL));
    writeCounter(tx, rc.ref, rc.next, { org: 'school', type: 'MN', branchCode: centreCode, date: payDate });

    tx.set(allocRef, {
      id: allocRef.id,
      ctx: 'school',
      type: 'KIDS_MONTHLY',
      studentId: studentDoc.id,
      studentDocId: studentDoc.id,
      ...(studentDoc.studentId ? { studentCode: studentDoc.studentId } : {}),
      billId: liveBill.id,
      month: liveBill.month || '',
      receiptNo: rc.receiptNo,
      receiptCentreCode: centreCode,
      amount: totalPaid,
      feeCovered: baseRemaining,
      lateFeeCovered: latePaid,
      lateFeeWaived: waivedAmt,
      waived: waivedAmt > 0,
      waiverReason: cleanWaiverReason,
      mode: cleanMode,
      txnId: cleanTxn,
      remarks: cleanRemarks || (liveBill.month ? `Monthly fee (${liveBill.month})` : 'Monthly fee'),
      receivedDate: payDate,
      receivedBy: cleanEmail,
      ...(userName ? { receivedByName: userName } : {}),
      ...(userDesignation ? { recordedByDesignation: userDesignation } : {}),
      ...(userRole ? { receivedByRole: userRole } : {}),
      createdAt: serverTimestamp()
    });

    tx.update(billRef, {
      ctx: 'school',
      paidAmount: rupees(priorPaid + totalPaid),
      lateFee: rupees(latePaid),
      ...(waivedAmt > 0 ? { lateFeeWaived: rupees((liveBill.lateFeeWaived || 0) + waivedAmt), waived: true, waiverReason: cleanWaiverReason } : {}),
      status: 'paid',
      receiptNo: rc.receiptNo,
      lastPaymentId: allocRef.id,
      paymentMode: cleanMode,
      txnId: cleanTxn,
      updatedAt: serverTimestamp(),
      updatedBy: cleanEmail
    });

    if (waivedAmt > 0) {
      const waiverRef = doc(collection(db, WAIVERS_COL));
      tx.set(waiverRef, {
        id: waiverRef.id,
        ctx: 'school',
        studentId: studentDoc.id,
        ...(studentDoc.studentId ? { studentCode: studentDoc.studentId } : {}),
        billId: liveBill.id,
        month: liveBill.month || '',
        amount: waivedAmt,
        reason: cleanWaiverReason,
        receiptNo: rc.receiptNo,
        waivedBy: cleanEmail,
        ...(userName ? { waivedByName: userName } : {}),
        ...(userDesignation ? { waivedByDesignation: userDesignation } : {}),
        ...(userRole ? { waivedByRole: userRole } : {}),
        waivedAt: payDate,
        createdAt: serverTimestamp()
      });
    }

    return {
      studentDocId: studentDoc.id,
      paymentId: allocRef.id,
      billId: liveBill.id,
      month: liveBill.month || '',
      receiptNo: rc.receiptNo,
      feeCovered: baseRemaining,
      lateFeePaid: latePaid,
      lateFeeWaived: waivedAmt,
      totalPaid,
      mode: cleanMode,
      txnId: cleanTxn
    };
  });
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

export function resolveEffectiveBreakMonthRange(br) {
  if (!br) return [];
  const st = String(br.status || '').toLowerCase().trim();
  const start = String(br.startMonth || br.breakFrom || '').slice(0, 7);
  const plannedEnd = String(br.plannedEndMonth || br.endMonth || br.breakTo || '').slice(0, 7);
  if (!start || !plannedEnd) return [];

  if (st === 'active' || st === 'approved') {
    return ymRange(start, plannedEnd);
  }
  if (st === 'completed') {
    const retM = String(br.actualReturnMonth || (br.actualReturnDate ? br.actualReturnDate.slice(0, 7) : '')).slice(0, 7);
    if (!retM) {
      const eff = String(br.effectiveEndMonth || plannedEnd).slice(0, 7);
      return monthSeq(eff) >= monthSeq(start) ? ymRange(start, eff) : [];
    }
    // Rejoin month itself is charged in FULL; all months from startMonth up to < rejoinMonth stay paused/unbilled.
    const lastPaused = addMonthsYM(retM, -1);
    if (monthSeq(lastPaused) < monthSeq(start)) return [];
    return ymRange(start, lastPaused);
  }
  return [];
}

export function buildApprovedBreakMonthsMap(breaks = []) {
  const byStudent = new Map();
  for (const br of (breaks || [])) {
    if (!br) continue;
    const months = resolveEffectiveBreakMonthRange(br);
    if (!months.length) continue;
    const keys = [br.studentId, br.studentCode].filter(Boolean);
    for (const key of keys) {
      if (!byStudent.has(key)) byStudent.set(key, new Set());
      const set = byStudent.get(key);
      for (const m of months) set.add(m);
    }
  }
  return byStudent;
}

export function computeKidsStudentDues(student, bills = [], breaks = [], asOfDate) {
  const today = asOfDate || localToday();
  const breakMap = buildApprovedBreakMonthsMap(breaks);
  const breakSet = new Set([
    ...(breakMap.get(student?.id) || []),
    ...(student?.studentId ? (breakMap.get(student.studentId) || []) : [])
  ]);
  const keys = new Set([student?.id, student?.studentId].filter(Boolean));
  let baseDue = 0;
  let lateFeeDue = 0;
  let billCount = 0;
  for (const b of (bills || [])) {
    if (!b || !keys.has(b.studentId)) continue;
    const st = String(b.status || 'unpaid').toLowerCase();
    if (st !== 'unpaid' && st !== 'partial') continue;
    if (breakSet.has(b.month)) continue;
    const fee = rupees(b.monthlyFee || 0);
    const paid = rupees(b.paidAmount || 0);
    const waived = rupees(b.waivedAmount || 0);
    const rem = Math.max(0, rupees(fee - paid - waived));
    const lf = daysLate(b.month, today);
    if (rem <= 0 && lf <= 0) continue;
    baseDue = rupees(baseDue + rem);
    lateFeeDue = rupees(lateFeeDue + lf);
    billCount += 1;
  }
  return {
    baseDue,
    lateFeeDue,
    totalDue: rupees(baseDue + lateFeeDue),
    billCount
  };
}

// Idempotently generate open monthly bills for active Kids students (`ctx === 'school'`).
// Never bills future months (> currentMonth), ended/completed/dropped students,
// students currently on break (even past plannedEndMonth), or months inside a break range.
export async function syncOpenKidsBills(dbInstance, {
  students = [],
  bills = [],
  breaks = [],
  asOfDate
} = {}) {
  const targetDb = dbInstance || db;
  const today = asOfDate || localToday();
  const currentMonth = today.slice(0, 7);
  const breakMap = buildApprovedBreakMonthsMap(breaks);

  const existingByStudentMonth = new Map();
  for (const b of (bills || [])) {
    if (!b || !b.studentId || !b.month) continue;
    if (!existingByStudentMonth.has(b.studentId)) existingByStudentMonth.set(b.studentId, new Set());
    existingByStudentMonth.get(b.studentId).add(b.month);
  }

  const newBills = [];
  for (const s of (students || [])) {
    if (!s || (s.ctx && s.ctx !== 'school')) continue;
    if (!isKidsStudentEligible(s)) continue; // skips 'break', 'ended', 'completed', 'dropped'

    const startMonth = s.firstMonthlyMonth || firstMonthlyMonth(s.admissionDate);
    if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) continue;
    if (monthSeq(startMonth) > monthSeq(currentMonth)) continue;

    const monthlyFee = rupees(s.monthlyFee || 0);
    const existingForStudent = new Set([
      ...(existingByStudentMonth.get(s.id) || []),
      ...(s.studentId ? (existingByStudentMonth.get(s.studentId) || []) : [])
    ]);
    const breakForStudent = new Set([
      ...(breakMap.get(s.id) || []),
      ...(s.studentId ? (breakMap.get(s.studentId) || []) : [])
    ]);

    let m = startMonth;
    let guard = 0;
    while (m && monthSeq(m) <= monthSeq(currentMonth) && guard < 120) {
      if (!existingForStudent.has(m) && !breakForStudent.has(m)) {
        const billId = `${s.id}_${m}`;
        const billRef = doc(targetDb, BILLS_COL, billId);
        newBills.push({
          ref: billRef,
          data: {
            id: billRef.id,
            ctx: 'school',
            studentId: s.id,
            ...(s.studentId ? { studentCode: s.studentId } : {}),
            enrolmentId: s.activeEnrolmentId || '',
            courseId: s.courseId || '',
            courseName: s.courseName || s.courseLevelName || '',
            courseLevelName: s.courseLevelName || s.courseName || '',
            batchId: s.batchId || '',
            batchName: s.batchName || '',
            month: m,
            monthlyFee,
            status: 'unpaid',
            dueDate: dueDateForMonth(m),
            lateFee: 0,
            paidAmount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          }
        });
        existingForStudent.add(m);
      }
      m = addMonthsYM(m, 1);
      guard += 1;
    }
  }

  if (newBills.length > 0) {
    for (let i = 0; i < newBills.length; i += 400) {
      const wb = writeBatch(targetDb);
      newBills.slice(i, i + 400).forEach((item) => wb.set(item.ref, item.data));
      await wb.commit();
    }
  }

  return newBills.map((x) => ({
    ...x.data,
    createdAt: { seconds: Math.floor(Date.now() / 1000) }
  }));
}

async function queryStudentDocs(targetDb, colName, student) {
  const keys = [...new Set([student.id, student.studentId].filter(Boolean))];
  const out = [];
  for (const k of keys) {
    const snap = await getDocs(query(collection(targetDb, colName), where('studentId', '==', k)));
    snap.docs.forEach((d) => {
      if (!out.some((x) => x.id === d.id)) out.push({ id: d.id, _ref: d.ref, ...d.data() });
    });
  }
  return out;
}

export async function startKidsBreak({
  db: dbOverride,
  student,
  startMonth,
  plannedEndMonth,
  reason,
  actorEmail = 'admin',
  actorName = '',
  actorDesignation = '',
  asOfDate
} = {}) {
  const targetDb = dbOverride || db;
  if (!student || !student.id) throw new Error('Student record is required.');
  const curYM = String(asOfDate || localToday()).slice(0, 7);
  const minAllowedStart = addMonthsYM(curYM, 1);
  if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) throw new Error('Select a break start month.');
  if (monthSeq(startMonth) < monthSeq(minAllowedStart)) {
    throw new Error(`Break cannot start in the current or past month. Earliest start month is ${formatShortMonthYear(minAllowedStart)}.`);
  }
  if (!plannedEndMonth || !/^\d{4}-\d{2}$/.test(plannedEndMonth) || monthSeq(plannedEndMonth) < monthSeq(startMonth)) {
    throw new Error('Planned end month must be the same as or after start month.');
  }
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new Error('Enter a reason for the break.');

  const [bills, existingBreaks] = await Promise.all([
    queryStudentDocs(targetDb, BILLS_COL, student),
    queryStudentDocs(targetDb, BREAKS_COL, student)
  ]);

  const activeExisting = existingBreaks.find((b) => ['active', 'approved'].includes(String(b.status || '').toLowerCase()) && !b.actualReturnDate);
  if (activeExisting || String(student.status || '').toLowerCase() === 'break') {
    throw new Error('Student already has an active break. Resume the existing break before starting another.');
  }

  const ymList = ymRange(startMonth, plannedEndMonth);
  const ymSet = new Set(ymList);
  const breakRef = doc(collection(targetDb, BREAKS_COL));
  const nowIso = new Date().toISOString();

  const wb = writeBatch(targetDb);
  let cancelledCount = 0;
  for (const b of bills) {
    if (ymSet.has(b.month) && String(b.status || '').toLowerCase() === 'unpaid' && !(Number(b.paidAmount || 0) > 0)) {
      wb.update(b._ref, {
        ctx: 'school',
        status: 'break-waived',
        breakId: breakRef.id,
        cancelReason: 'Student break: ' + cleanReason,
        stoppedAt: serverTimestamp(),
        stoppedBy: actorEmail,
        updatedAt: serverTimestamp()
      });
      cancelledCount += 1;
    }
  }

  const breakPayload = {
    id: breakRef.id,
    ctx: 'school',
    studentId: student.id,
    studentCode: student.studentId || '',
    studentName: student.name || '',
    startMonth,
    endMonth: plannedEndMonth,
    plannedEndMonth,
    effectiveEndMonth: plannedEndMonth,
    actualReturnDate: null,
    actualReturnMonth: null,
    endedEarly: false,
    reason: cleanReason,
    status: 'active',
    billsWaived: cancelledCount,
    startedBy: actorEmail,
    startedByName: actorName || '',
    startedByDesignation: actorDesignation || '',
    startedAtISO: nowIso,
    startedAt: serverTimestamp(),
    resumedBy: null,
    resumedAt: null,
    resumedAtISO: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  wb.set(breakRef, breakPayload);

  const histEntry = {
    breakId: breakRef.id,
    from: startMonth,
    to: plannedEndMonth,
    actualReturnDate: null,
    actualReturnMonth: null,
    reason: cleanReason,
    status: 'active',
    by: actorEmail,
    byName: actorName || '',
    at: nowIso,
    billsCancelled: cancelledCount
  };

  wb.update(doc(targetDb, STUDENTS_COL, student.id), {
    ...(student.ctx ? {} : { ctx: 'school' }),
    ...(student.branchId ? {} : { branchId: 'HO', branchName: 'Head Office' }),
    status: 'break',
    activeBreakId: breakRef.id,
    breakFrom: startMonth,
    breakTo: plannedEndMonth,
    breakReason: cleanReason,
    breakStartedBy: actorEmail,
    breakApprovedAt: serverTimestamp(),
    breakHistory: arrayUnion(histEntry),
    updatedAt: serverTimestamp(),
    updatedBy: actorEmail
  });

  await wb.commit();
  return { breakId: breakRef.id, breakDoc: breakPayload, billsWaived: cancelledCount };
}

export async function resumeKidsBreak({
  db: dbOverride,
  student,
  breakDoc = null,
  returnDate,
  actorEmail = 'admin',
  actorName = '',
  actorDesignation = '',
  asOfDate
} = {}) {
  const targetDb = dbOverride || db;
  if (!student || !student.id) throw new Error('Student record is required.');
  if (!returnDate || !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) throw new Error('Select a valid return date.');

  const rejoinMonth = returnDate.slice(0, 7);
  const currentMonth = String(asOfDate || localToday()).slice(0, 7);
  const nowIso = new Date().toISOString();

  const [bills, existingBreaks] = await Promise.all([
    queryStudentDocs(targetDb, BILLS_COL, student),
    queryStudentDocs(targetDb, BREAKS_COL, student)
  ]);

  const resolvedFromDb =
    (breakDoc?.id ? existingBreaks.find((b) => b.id === breakDoc.id) : null)
    || existingBreaks.find((b) => student.activeBreakId && b.id === student.activeBreakId)
    || existingBreaks.find((b) => ['active', 'approved'].includes(String(b.status || '').toLowerCase()) && !b.actualReturnDate)
    || null;
  const targetBreak = resolvedFromDb || breakDoc || null;
  const targetRef = targetBreak?._ref || (targetBreak?.id ? doc(targetDb, BREAKS_COL, targetBreak.id) : null);

  const startMonth = targetBreak?.startMonth || student.breakFrom || rejoinMonth;
  const plannedEnd = targetBreak?.plannedEndMonth || targetBreak?.endMonth || student.breakTo || rejoinMonth;
  const effectiveEndMonth = monthSeq(rejoinMonth) > monthSeq(startMonth) ? addMonthsYM(rejoinMonth, -1) : null;
  const endedEarly = monthSeq(rejoinMonth) <= monthSeq(plannedEnd);

  const wb = writeBatch(targetDb);

  if (targetRef) {
    wb.update(targetRef, {
      ctx: 'school',
      status: 'completed',
      actualReturnDate: returnDate,
      actualReturnMonth: rejoinMonth,
      effectiveEndMonth,
      endedEarly,
      resumedBy: actorEmail,
      resumedByName: actorName || '',
      resumedByDesignation: actorDesignation || '',
      resumedAtISO: nowIso,
      resumedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } else {
    const legacyRef = doc(collection(targetDb, BREAKS_COL));
    wb.set(legacyRef, {
      id: legacyRef.id,
      ctx: 'school',
      studentId: student.id,
      studentCode: student.studentId || '',
      studentName: student.name || '',
      startMonth,
      endMonth: plannedEnd,
      plannedEndMonth: plannedEnd,
      effectiveEndMonth,
      actualReturnDate: returnDate,
      actualReturnMonth: rejoinMonth,
      endedEarly,
      reason: student.breakReason || 'Student break',
      status: 'completed',
      startedBy: student.breakStartedBy || actorEmail,
      startedAtISO: null,
      resumedBy: actorEmail,
      resumedByName: actorName || '',
      resumedByDesignation: actorDesignation || '',
      resumedAtISO: nowIso,
      resumedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  // Restore any paused/cancelled break bills from rejoinMonth onward so rejoin month is billed in FULL.
  const touchedMonths = new Set();
  for (const b of bills) {
    touchedMonths.add(b.month);
    const st = String(b.status || '').toLowerCase();
    if (monthSeq(b.month) >= monthSeq(rejoinMonth) && (st === 'break-waived' || st === 'cancelled')) {
      wb.update(b._ref, {
        ctx: 'school',
        status: 'unpaid',
        cancelReason: null,
        breakId: null,
        stoppedAt: null,
        stoppedBy: null,
        updatedAt: serverTimestamp(),
        updatedBy: actorEmail
      });
    }
  }

  // Create full monthly bills for any open months from rejoinMonth up to currentMonth missing a bill doc.
  const otherBreaks = existingBreaks.filter((b) => !targetBreak || b.id !== targetBreak.id);
  const otherBreakMap = buildApprovedBreakMonthsMap(otherBreaks);
  const skipOther = new Set([
    ...(otherBreakMap.get(student.id) || []),
    ...(student.studentId ? (otherBreakMap.get(student.studentId) || []) : [])
  ]);

  const createdMonths = [];
  if (monthSeq(rejoinMonth) <= monthSeq(currentMonth)) {
    let m = rejoinMonth;
    let guard = 0;
    while (m && monthSeq(m) <= monthSeq(currentMonth) && guard < 120) {
      if (!touchedMonths.has(m) && !skipOther.has(m)) {
        const billRef = doc(targetDb, BILLS_COL, `${student.id}_${m}`);
        wb.set(billRef, {
          id: billRef.id,
          ctx: 'school',
          studentId: student.id,
          ...(student.studentId ? { studentCode: student.studentId } : {}),
          enrolmentId: student.activeEnrolmentId || '',
          courseId: student.courseId || '',
          courseName: student.courseName || student.courseLevelName || '',
          courseLevelName: student.courseLevelName || student.courseName || '',
          batchId: student.batchId || '',
          batchName: student.batchName || '',
          month: m,
          monthlyFee: rupees(student.monthlyFee || 0),
          status: 'unpaid',
          dueDate: dueDateForMonth(m),
          lateFee: 0,
          paidAmount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        createdMonths.push(m);
      }
      m = addMonthsYM(m, 1);
      guard += 1;
    }
  }

  // Update breakHistory array cleanly if matching entry exists, else leave past entries intact and append completion detail
  const existingHist = Array.isArray(student.breakHistory) ? student.breakHistory.slice() : [];
  let matchedIdx = -1;
  for (let i = existingHist.length - 1; i >= 0; i--) {
    const h = existingHist[i];
    if ((targetBreak && h.breakId === targetBreak.id) || (!h.actualReturnDate && h.from === startMonth && h.to === plannedEnd)) {
      matchedIdx = i;
      break;
    }
  }
  if (matchedIdx !== -1) {
    existingHist[matchedIdx] = {
      ...existingHist[matchedIdx],
      status: 'completed',
      actualReturnDate: returnDate,
      actualReturnMonth: rejoinMonth,
      effectiveEndMonth,
      endedEarly,
      resumedBy: actorEmail,
      resumedByName: actorName || '',
      resumedAt: nowIso
    };
  } else {
    existingHist.push({
      breakId: targetBreak?.id || null,
      from: startMonth,
      to: plannedEnd,
      actualReturnDate: returnDate,
      actualReturnMonth: rejoinMonth,
      effectiveEndMonth,
      endedEarly,
      reason: student.breakReason || targetBreak?.reason || 'Student break',
      status: 'completed',
      by: student.breakStartedBy || actorEmail,
      resumedBy: actorEmail,
      resumedByName: actorName || '',
      resumedAt: nowIso
    });
  }

  wb.update(doc(targetDb, STUDENTS_COL, student.id), {
    ...(student.ctx ? {} : { ctx: 'school' }),
    ...(student.branchId ? {} : { branchId: 'HO', branchName: 'Head Office' }),
    status: 'active',
    activeBreakId: null,
    breakFrom: null,
    breakTo: null,
    breakReason: null,
    breakReturnDate: returnDate,
    breakReturnMonth: rejoinMonth,
    breakResumedBy: actorEmail,
    breakResumedAt: serverTimestamp(),
    breakHistory: existingHist,
    updatedAt: serverTimestamp(),
    updatedBy: actorEmail
  });

  await wb.commit();
  return { rejoinMonth, endedEarly, effectiveEndMonth, createdMonths };
}

export async function upgradeKidsPackage({
  db: dbOverride,
  student,
  newCourse,
  newBatch,
  billingStartMonth,
  defaultStartMonth,
  paymentMode = 'difference',
  diffCharge = 0,
  mode = 'cash',
  txnId = '',
  remarks = '',
  noPaymentReason = '',
  noPaymentOther = '',
  actorEmail = 'admin',
  actorName = '',
  actorDesignation = '',
  actorRole = '',
  paidDate,
  asOfDate
} = {}) {
  const targetDb = dbOverride || db;
  if (!student || !student.id) throw new Error('Student record is required.');
  if (!newCourse || !newCourse.id) throw new Error('Select the destination level.');
  if (!newBatch || !newBatch.id) throw new Error('Select the destination batch.');
  if (!billingStartMonth || !/^\d{4}-\d{2}$/.test(billingStartMonth)) throw new Error('Select when the new monthly fee starts.');

  const today = asOfDate || paidDate || localToday();
  const currentMonth = today.slice(0, 7);
  const newMonthly = rupees(newCourse.monthlyFee || 0);
  const prevPaid = rupees(student.actualAmountReceived ?? student.admissionFee ?? 0);
  const newConfiguredAdm = rupees(newCourse.admissionFee || 0);
  const charge = rupees(diffCharge || 0);
  const cleanMode = charge > 0 ? (String(mode || 'cash').toLowerCase().trim() || 'cash') : '';
  const cleanTxn = (charge > 0 && cleanMode !== 'cash') ? String(txnId || '').trim() : '';
  const cleanRemarks = String(remarks || '').trim();

  const [bills, enrols, breaks] = await Promise.all([
    queryStudentDocs(targetDb, BILLS_COL, student),
    queryStudentDocs(targetDb, ENROLMENTS_COL, student),
    queryStudentDocs(targetDb, BREAKS_COL, student)
  ]);

  const prevEndMonth = addMonthsYM(billingStartMonth, -1);
  const breakMap = buildApprovedBreakMonthsMap(breaks);
  const skipSet = new Set([
    ...(breakMap.get(student.id) || []),
    ...(student.studentId ? (breakMap.get(student.studentId) || []) : [])
  ]);
  const newEnrolRef = doc(collection(targetDb, ENROLMENTS_COL));
  const nowIso = new Date().toISOString();

  function applyUpgradeWrites(writer, { payRef = null, receiptNo = '', centreCode = '' } = {}) {
    for (const en of enrols) {
      if (String(en.status || '').toLowerCase() === 'active') {
        writer.update(en._ref, {
          status: 'upgraded',
          billingTo: prevEndMonth,
          upgradedAt: serverTimestamp(),
          upgradedBy: actorEmail,
          updatedAt: serverTimestamp()
        });
      }
    }

    writer.set(newEnrolRef, {
      id: newEnrolRef.id,
      ctx: 'school',
      studentId: student.id,
      studentCode: student.studentId || '',
      type: 'upgrade',
      courseId: newCourse.id,
      courseName: newCourse.name || newCourse.id,
      courseLevelName: newCourse.name || newCourse.id,
      batchId: newBatch.id,
      batchName: newBatch.name || newBatch.id,
      admissionFee: charge,
      monthlyFee: newMonthly,
      firstMonthlyMonth: billingStartMonth,
      defaultFirstMonthlyMonth: defaultStartMonth || billingStartMonth,
      firstMonthlyChangedFromDefault: Boolean(defaultStartMonth && billingStartMonth !== defaultStartMonth),
      billingFrom: billingStartMonth,
      billingTo: null,
      status: 'active',
      previousCourseId: student.courseId || '',
      previousCourseName: student.courseName || '',
      createdAt: serverTimestamp(),
      createdBy: actorEmail
    });

    // Update untouched unpaid bills from billingStartMonth onward to the new level & monthly fee (no double billing),
    // leaving earlier months untouched on the old package.
    const existingMonthSet = new Set();
    for (const b of bills) {
      existingMonthSet.add(b.month);
      if (monthSeq(b.month) >= monthSeq(billingStartMonth) && String(b.status || '').toLowerCase() === 'unpaid' && !(Number(b.paidAmount || 0) > 0)) {
        writer.update(b._ref, {
          ctx: 'school',
          enrolmentId: newEnrolRef.id,
          courseId: newCourse.id,
          courseName: newCourse.name || newCourse.id,
          courseLevelName: newCourse.name || newCourse.id,
          batchId: newBatch.id,
          batchName: newBatch.name || newBatch.id,
          monthlyFee: newMonthly,
          updatedAt: serverTimestamp(),
          updatedBy: actorEmail
        });
      }
    }

    // Generate open bills >= billingStartMonth up to currentMonth if active and not on break.
    if (isKidsStudentEligible(student) && monthSeq(billingStartMonth) <= monthSeq(currentMonth)) {
      let m = billingStartMonth;
      let guard = 0;
      while (m && monthSeq(m) <= monthSeq(currentMonth) && guard < 120) {
        if (!existingMonthSet.has(m) && !skipSet.has(m)) {
          const bRef = doc(targetDb, BILLS_COL, `${student.id}_${m}`);
          writer.set(bRef, {
            id: bRef.id,
            ctx: 'school',
            studentId: student.id,
            ...(student.studentId ? { studentCode: student.studentId } : {}),
            enrolmentId: newEnrolRef.id,
            courseId: newCourse.id,
            courseName: newCourse.name || newCourse.id,
            courseLevelName: newCourse.name || newCourse.id,
            batchId: newBatch.id,
            batchName: newBatch.name || newBatch.id,
            month: m,
            monthlyFee: newMonthly,
            status: 'unpaid',
            dueDate: dueDateForMonth(m),
            lateFee: 0,
            paidAmount: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
        m = addMonthsYM(m, 1);
        guard += 1;
      }
    }

    if (charge > 0 && payRef) {
      writer.set(payRef, {
        id: payRef.id,
        ctx: 'school',
        type: 'UPGRADE',
        studentId: student.id,
        studentDocId: student.id,
        studentCode: student.studentId || '',
        courseId: newCourse.id,
        courseName: newCourse.name || newCourse.id,
        receiptNo,
        receiptCentreCode: centreCode,
        amount: charge,
        feeCovered: charge,
        totalAmount: charge,
        paymentMode,
        mode: cleanMode,
        paymentMethod: cleanMode,
        txnId: cleanTxn,
        receivedDate: today,
        receivedBy: actorEmail,
        ...(actorName ? { receivedByName: actorName } : {}),
        ...(actorDesignation ? { recordedByDesignation: actorDesignation } : {}),
        ...(actorRole ? { receivedByRole: actorRole } : {}),
        remarks: cleanRemarks || `Level upgrade (${student.courseName || '-'} -> ${newCourse.name || newCourse.id})`,
        createdAt: serverTimestamp()
      });
    }

    writer.update(doc(targetDb, STUDENTS_COL, student.id), {
      ...(student.ctx ? {} : { ctx: 'school' }),
      ...(student.branchId ? {} : { branchId: 'HO', branchName: 'Head Office' }),
      courseId: newCourse.id,
      courseName: newCourse.name || newCourse.id,
      courseLevelName: newCourse.name || newCourse.id,
      batchId: newBatch.id,
      batchName: newBatch.name || newBatch.id,
      monthlyFee: newMonthly,
      configuredAdmissionFee: newConfiguredAdm,
      firstMonthlyMonth: billingStartMonth,
      defaultFirstMonthlyMonth: defaultStartMonth || billingStartMonth,
      firstMonthlyChangedFromDefault: Boolean(defaultStartMonth && billingStartMonth !== defaultStartMonth),
      activeEnrolmentId: newEnrolRef.id,
      upgradeDifferencePaid: rupees(Number(student.upgradeDifferencePaid || 0) + charge),
      actualAmountReceived: rupees(prevPaid + charge),
      packageHistory: arrayUnion({
        type: 'upgrade',
        fromCourseId: student.courseId || '',
        fromCourseName: student.courseName || '',
        toCourseId: newCourse.id,
        toCourseName: newCourse.name || newCourse.id,
        toBatchId: newBatch.id,
        toBatchName: newBatch.name || newBatch.id,
        newMonthlyFee: newMonthly,
        billingStartMonth,
        defaultStartMonth: defaultStartMonth || billingStartMonth,
        changedFromDefault: Boolean(defaultStartMonth && billingStartMonth !== defaultStartMonth),
        paymentMode,
        diffPaid: charge,
        ...(charge > 0 ? { mode: cleanMode, txnId: cleanTxn, receiptNo, paymentId: payRef?.id || '' } : {}),
        noPaymentReason: noPaymentReason || '',
        noPaymentOther: noPaymentOther || '',
        by: actorEmail,
        at: nowIso
      }),
      updatedAt: serverTimestamp(),
      updatedBy: actorEmail
    });
  }

  let paymentId = '';
  let receiptNo = '';

  if (charge > 0) {
    await runTransaction(targetDb, async (tx) => {
      const orgSnap = await tx.get(doc(targetDb, 'settings', 'org_config'));
      const configuredCode = String(orgSnap.exists() ? orgSnap.data().receiptCode || '' : '').trim().toUpperCase();
      const centreCode = /^[A-Z0-9]{2,12}$/.test(configuredCode) ? configuredCode : (student.receiptCentreCode || 'HO');
      const rc = await readReceiptNo(tx, { org: 'school', type: 'UP', branchCode: centreCode, date: today });
      const payRef = doc(collection(targetDb, PAYMENTS_COL));
      paymentId = payRef.id;
      receiptNo = rc.receiptNo;
      writeCounter(tx, rc.ref, rc.next, { org: 'school', type: 'UP', branchCode: centreCode, date: today });
      applyUpgradeWrites(tx, { payRef, receiptNo, centreCode });
    });
  } else {
    const wb = writeBatch(targetDb);
    applyUpgradeWrites(wb);
    await wb.commit();
  }

  return {
    enrolmentId: newEnrolRef.id,
    billingStartMonth,
    charge,
    paymentId,
    receiptNo,
    studentDocId: student.id,
    studentId: student.studentId || ''
  };
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
      mode: String(ap.mode || ap.paymentMethod || ((ap.paymentMode === 'full' || ap.paymentMode === 'difference') ? 'cash' : (ap.paymentMode || 'cash'))).toLowerCase(),
      txnId: ap.txnId || '',
      amount: amt,
      lateFeePaid: 0,
      lateFeeWaived: 0,
      totalReceived: amt,
      isPureWaiver: false,
      recordedBy: (ap.createdBy || s.createdBy || '').toLowerCase(),
      recordedByName: ap.receivedByName || ap.recordedByName || '',
      recordedByDesignation: ap.recordedByDesignation || '',
      remarks: ap.paymentRemarks || ap.remarks || (ap.paymentMode === 'difference' ? 'Upgrade difference admission fee' : 'Admission fee'),
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
      receiptRoute: a.id ? `#/payments/${encodeURIComponent(s.id)}/${encodeURIComponent(a.id)}/receipt?from=school-payments` : `#/students/${encodeURIComponent(s.id)}?tab=payments`,
      createdAtSec: toSec(a.createdAt)
    });
  }

  for (const p of summaries) {
    if (String(p.type || '').toUpperCase() !== 'UPGRADE' && allocKeys.has(`${p.studentId || ''}|${p.receivedDate || ''}`)) continue;
    const s = resolveStudent(p);
    if (!s) continue;
    const amt = rupees(p.totalAmount ?? p.amount ?? 0);
    if (amt <= 0) continue;
    const isUpgrade = String(p.type || '').toUpperCase() === 'UPGRADE';
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
      courseId: p.courseId || s.courseId || '',
      courseName: p.courseName || s.courseLevelName || s.courseName || '',
      type: isUpgrade ? 'UPGRADE' : 'KIDS_MONTHLY',
      typeLabel: isUpgrade ? 'Upgrade difference' : 'Kids monthly fee',
      mode: String(p.mode || p.paymentMethod || 'cash').toLowerCase(),
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
      receiptRoute: (isUpgrade && p.id)
        ? `#/payments/${encodeURIComponent(s.id)}/${encodeURIComponent(p.id)}/receipt?from=school-payments`
        : (isUpgrade ? `#/students/${encodeURIComponent(s.id)}?tab=course` : `#/students/${encodeURIComponent(s.id)}?tab=payments`),
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

