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

// ---------- admission number (transaction-safe counter) ----------

export async function generateAdmissionNumber(branchId, year) {
  const counterId = 'admission_' + branchId + '_' + year;
  const counterRef = doc(db, COUNTER_COL, counterId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = snap.exists() ? (Number(snap.data().seq || 0) + 1) : 1;
    tx.set(counterRef, { seq: next, branchId, year, updatedAt: serverTimestamp() }, { merge: true });
    const seqStr = String(next).padStart(4, '0');
    return branchId.toUpperCase() + '-' + year + '-' + seqStr;
  });
}

// ---------- writes ----------

export async function createStudent(data) {
  const payload = Object.assign({}, data, {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  const ref = await addDoc(collection(db, COL), payload);
  return ref.id;
}

export async function updateStudent(id, data) {
  const payload = Object.assign({}, data, { updatedAt: serverTimestamp() });
  await updateDoc(doc(db, COL, id), payload);
}

export async function deleteStudent(id) {
  await deleteDoc(doc(db, COL, id));
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
        const docRef = doc(doc(ref, 'docs'), key);
        batch.set(docRef, Object.assign({}, docData, { updatedAt: serverTimestamp() }));
      }
    });
  }
  await batch.commit();
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
        const docRef = doc(doc(studentRef, 'docs'), key);
        batch.set(docRef, Object.assign({}, docData, { updatedAt: serverTimestamp() }));
      } else {
        // Remove existing doc if data is null/false
        const docRef = doc(doc(studentRef, 'docs'), key);
        batch.delete(docRef);
      }
    });
  }
  await batch.commit();
}
