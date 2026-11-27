// admission.service.js — all Firestore reads/writes for the Admissions page
import { db } from '../config/firebase-config.js';
import {
  collection, getDocs, query, where, doc, addDoc, updateDoc, deleteDoc,
  runTransaction, serverTimestamp, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const COL = 'students';
const COUNTER_COL = 'counters';

// ---------- reads ----------

export async function listStudentsRaw() {
  const snap = await getDocs(collection(db, COL));
  return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
}

export async function checkDuplicatePhone({ branchId, courseId, phone, excludeId }) {
  if (!phone) return null;
  const snap = await getDocs(query(
    collection(db, COL),
    where('branchId', '==', branchId),
    where('courseId', '==', courseId),
    where('phone', '==', phone),
    where('status', '==', 'active')
  ));
  const dup = snap.docs.find((d) => d.id !== excludeId);
  return dup ? Object.assign({ id: dup.id }, dup.data()) : null;
}

// ---------- T1: student id counter read (inside a runTransaction) ----------
// Youth Centre: YYSSNNNN   YY = last 2 digits of session year, SS = course level 01/02/03,
// NNNN = counter per (YY + SS), shared across ALL Youth Centre branches.
// Counter doc: counters/sid_ui_<YY>_<SS>
// Unique Kids: YYYYNNNN     YYYY = session year, NNNN = counter per year, shared across ALL Kids branches.
// Counter doc: counters/sid_uk_<YYYY>
// Throws if level missing or counter would exceed 9999. Does ONLY tx.get (no write).
export function readStudentId(tx, { org, sessionYear, level }) {
  let counterId, prefix;
  if (org === 'youth') {
    if (!level || ![1, 2, 3].includes(Number(level))) {
      throw new Error('Set the course level first (Courses page).');
    }
    const yy = String(sessionYear).slice(-2);
    const ss = String(level).padStart(2, '0');
    counterId = 'sid_ui_' + yy + '_' + ss;
    prefix = yy + ss;
  } else {
    const yyyy = String(sessionYear).slice(0, 4);
    counterId = 'sid_uk_' + yyyy;
    prefix = yyyy;
  }
  const counterRef = doc(db, COUNTER_COL, counterId);
  return tx.get(counterRef).then((snap) => {
    const next = snap.exists() ? (Number(snap.data().seq || 0) + 1) : 1;
    if (next > 9999) {
      throw new Error('Student ID counter exceeded 9999 for ' + counterId + '.');
    }
    const seqStr = String(next).padStart(4, '0');
    return { ref: counterRef, next: next, studentId: prefix + seqStr };
  });
}

// ---------- T2: receipt number counter read (inside a runTransaction) ----------
// Format: <ORG><YY><TYPE>-<BRANCHCODE>-<NNNN>
//   ORG = UI (Youth Centre) / UK (Unique Kids)
//   YY = last 2 digits of payment date year (admission date for admission receipt)
//   TYPE = AD (admission payment) / IN (later instalment payment)
//   NNNN = counter per org + year + type + BRANCH
// Counter doc: counters/rcpt_<org>_<YY>_<type>_<branchCode>
// Does ONLY tx.get (no write).
export function readReceiptNo(tx, { org, type, branchCode, date }) {
  const orgCode = org === 'youth' ? 'UI' : 'UK';
  const yy = String(date).slice(2, 4);
  const counterId = 'rcpt_' + orgCode + '_' + yy + '_' + type + '_' + branchCode;
  const counterRef = doc(db, COUNTER_COL, counterId);
  return tx.get(counterRef).then((snap) => {
    const next = snap.exists() ? (Number(snap.data().seq || 0) + 1) : 1;
    if (next > 9999) {
      throw new Error('Receipt counter exceeded 9999 for ' + counterId + '.');
    }
    const seqStr = String(next).padStart(4, '0');
    return { ref: counterRef, next: next, receiptNo: orgCode + yy + type + '-' + branchCode + '-' + seqStr };
  });
}

// ---------- counter write (inside a runTransaction) ----------
// Does ONLY tx.set (no read).
export function writeCounter(tx, ref, next, extra) {
  tx.set(ref, { seq: next, ...extra, updatedAt: serverTimestamp() }, { merge: true });
}

// ---------- writes ----------

function emitDataMutated(reason) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('uic:data-mutated', { detail: { reason } }));
  }
}

export async function createStudent(data) {
  const payload = Object.assign({}, data, {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const ref = await addDoc(collection(db, COL), payload);
  emitDataMutated('student:create');
  return ref.id;
}

export async function updateStudent(id, data) {
  const payload = Object.assign({}, data, { updatedAt: serverTimestamp() });
  await updateDoc(doc(db, COL, id), payload);
  emitDataMutated('student:update');
}

export async function deleteStudent(id) {
  await deleteDoc(doc(db, COL, id));
  emitDataMutated('student:delete');
}

// ---------- student + docs (single writeBatch) ----------

export async function createStudentWithDocs(data, docs, studentRef) {
  const ref = studentRef || doc(collection(db, COL));
  const batch = writeBatch(db);
  const payload = Object.assign({}, data, {
    id: ref.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(ref, payload);
  if (docs) {
    Object.entries(docs).forEach(([key, docData]) => {
      if (docData) {
        const docRef = doc(collection(ref, 'docs'), key);
        batch.set(docRef, Object.assign({}, docData, { updatedAt: serverTimestamp() }));
      }
    });
  }
  await batch.commit();
  emitDataMutated('student:create-with-docs');
  return ref.id;
}

export async function updateStudentWithDocs(id, data, docs) {
  const batch = writeBatch(db);
  const studentRef = doc(db, COL, id);
  const payload = Object.assign({}, data, { updatedAt: serverTimestamp() });
  batch.update(studentRef, payload);
  if (docs) {
    Object.entries(docs).forEach(([key, docData]) => {
      if (docData) {
        const docRef = doc(collection(studentRef, 'docs'), key);
        batch.set(docRef, Object.assign({}, docData, { updatedAt: serverTimestamp() }));
      } else {
        // Remove existing doc if data is null/false
        const docRef = doc(collection(studentRef, 'docs'), key);
        batch.delete(docRef);
      }
    });
  }
  await batch.commit();
  emitDataMutated('student:update-with-docs');
}
