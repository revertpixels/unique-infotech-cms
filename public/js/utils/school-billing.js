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
import { showToast } from '../components/toast.js?v=1.8.140';
import { localToday, monthSeq, nextMonth, previousMonth } from './school-lifecycle.js?v=1.8.140';

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

// Days late for a given month (as of today). 0 = on or before 10th.
export function daysLate(monthISO) {
  const today = localToday();
  const due = dueDateForMonth(monthISO);
  if (monthSeq(today) <= monthSeq(due.slice(0, 7))) return 0;
  const p1 = today.split('-').map(Number);
  const p2 = due.split('-').map(Number);
  const d1 = new Date(p1[0], p1[1] - 1, p1[2]);
  const d2 = new Date(p2[0], p2[1] - 1, p2[2]);
  const diff = Math.floor((d1 - d2) / (1000 * 60 * 60 * 24));
  return diff > 0 ? diff : 0;
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

// Compute late fee for an unpaid bill as of today.
export function computeLateFee(bill) {
  if (bill.status === 'paid') return 0;
  const dl = daysLate(bill.month);
  return dl > 0 ? dl * LATE_FEE_PER_DAY : 0;
}

// ---------- payment recording ----------

// Record a payment against a bill. Handles allocation (bill first, then oldest unpaid).
// Returns { paymentId, allocations: [{billId, amount, lateFeeCovered}] }.
export async function recordPayment(tx, {
  studentId, amount, receivedDate, receivedBy, allocation = 'auto'
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

