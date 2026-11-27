// school-transfer.page.js � Batch-only transfer for Youth and Kids.
// Changes batch membership only. Does NOT change course/level, fees, billing dates,
// or Student ID. Kids: school context, compatible active Kids batch.
// Youth: youth context, same authorised branch/session/course.
import { db } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, query, where, updateDoc, runTransaction, serverTimestamp, collection } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.181';
import { formatINR, formatDateIN } from '../utils/formatter.js?v=1.8.181';
import { isCourseActive, batchAllowsCourse } from '../utils/session-rules.js?v=1.8.181';
import { localToday } from '../utils/school-lifecycle.js?v=1.8.181';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.181';

const COL = 'students';
const ENROLMENTS_COL = 'enrolments';
const BATCHES_COL = 'batches';

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-transfer] missing #' + id); return el; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

const STATE_LOADING = 'loading';
const STATE_READY = 'ready';
const STATE_EMPTY = 'empty';
const STATE_NOT_FOUND = 'notfound';
const STATE_FORBIDDEN = 'forbidden';
const STATE_ERROR = 'error';
const STATE_SUBMITTING = 'submitting';
const STATE_COMPLETED = 'completed';

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  const youth = ctx === 'youth';
  if (!school && !youth) {
    showToast({ type: 'error', message: 'Batch transfer is available in Youth Centre and Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';
  const isHead = profile && profile.role === 'branch_head';

  // studentId from route: #/school-transfer/<studentId> or #/youth-transfer/<studentId>
  const m = location.hash.match(/#\/(school|youth)-transfer\/([^\/#?]+)/);
  const studentId = m && m[2];

  const form = $('sk-transfer-form');
  const cancelBtn = $('sk-transfer-cancel');
  const saveBtn = $('sk-transfer-save');
  const emptyEl = $('sk-transfer-empty');
  const emptyOpenBtn = $('sk-transfer-empty-open');
  const errorEl = $('sk-transfer-error');
  const destErr = $('sk-transfer-dest-err');
  if (!form || !cancelBtn || !saveBtn || !emptyEl || !emptyOpenBtn || !errorEl || !destErr) return;

  let state = STATE_LOADING;
  let loadError = null;

  if (!isSuper && !isHead) {
    setState(STATE_FORBIDDEN, `Batch transfer is restricted to ${getRoleTitle('superadmin')} or ${getRoleTitle('branch_head')}.`);
    return;
  }

  let currentBatch, currentCourse, currentLevel, branches = [], sessions = [], courses = [], batches = [];

  // ---------- state rendering ----------
  function setState(newState, err) {
    state = newState;
    loadError = err;
    form.hidden = true;
    emptyEl.hidden = true;
    errorEl.hidden = true;
    errorEl.textContent = '';
    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    switch (newState) {
      case STATE_LOADING:
        form.hidden = false;
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        break;
      case STATE_READY:
        form.hidden = false;
        saveBtn.disabled = true;
        cancelBtn.disabled = false;
        break;
      case STATE_EMPTY:
        emptyEl.hidden = false;
        break;
      case STATE_NOT_FOUND:
        errorEl.hidden = false;
        errorEl.textContent = err || 'Student not found.';
        break;
      case STATE_FORBIDDEN:
        errorEl.hidden = false;
        errorEl.textContent = err || 'Access denied.';
        break;
      case STATE_ERROR:
        errorEl.hidden = false;
        errorEl.textContent = err || 'Could not load student. Please retry.';
        break;
      case STATE_SUBMITTING:
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        break;
      case STATE_COMPLETED:
        form.hidden = false;
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        break;
    }
  }

  function showError(msg) {
    setState(STATE_ERROR, msg);
  }

  // ---------- load current student + batch ----------
  async function load() {
    setState(STATE_LOADING);
    if (!studentId) {
      setState(STATE_EMPTY);
      return;
    }
    try {
      const [sSnap, cSnap, bSnap] = await Promise.all([
        getDoc(doc(db, COL, studentId)),
        getDocs(query(collection(db, 'courses'), where('ctx', '==', ctx))),
        getDocs(query(collection(db, BATCHES_COL), where('ctx', '==', ctx)))
      ]);
      const sData = sSnap.exists() ? Object.assign({ id: sSnap.id }, sSnap.data()) : null;
      if (!sData) { setState(STATE_NOT_FOUND, 'Student not found.'); return; }
      courses = cSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(c => (c.status || 'active') === 'active');
      batches = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data())).filter(b => (b.status || 'active') === 'active');

      currentBatch = batches.find(b => b.id === sData.batchId) || null;
      currentCourse = courses.find(c => c.id === sData.courseId) || null;
      currentLevel = currentCourse ? courses.find(c => c.id === currentCourse.courseId || c.id === currentCourse.id) : null;

      // populate destination batches (compatible with current course for Kids; branch/session/course for Youth)
      const destHost = $('sk-transfer-dest-host');
      const opts = [{ value: '', label: 'Select destination batch', icon: 'layers' }];
      if (school) {
        if (currentCourse) {
          batches.filter(b => batchAllowsCourse(b, currentCourse.id, courses)).forEach(b => {
            if (b.id === currentBatch.id) return; // destination must not include current batch
            opts.push({ value: b.id, label: b.name || b.id, icon: 'layers' });
          });
        }
      } else {
        // Youth: same branch and session
        const myBranch = sData.branchId;
        const mySession = sData.sessionId;
        if (currentCourse) {
          batches.filter(b => batchAllowsCourse(b, currentCourse.id, courses) &&
            b.branchId === myBranch && b.sessionId === mySession && b.id !== currentBatch.id).forEach(b => {
            opts.push({ value: b.id, label: b.name || b.id, icon: 'layers' });
          });
        }
      }
      destHost.innerHTML = '';
      opts.forEach(o => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.tabIndex = -1;
        li.dataset.value = o.value;
        li.appendChild(document.createElement('span')).textContent = o.label;
        li.appendChild(document.createElement('i')).setAttribute('data-lucide', o.icon || 'circle');
        li.addEventListener('click', () => { selectDest(o.value); });
        destHost.appendChild(li);
      });
      if (typeof lucide !== 'undefined') lucide.createIcons();

      // current summary - read-only labelled facts
      $('sk-transfer-student-id').textContent = sData.studentId || 'Not available';
      $('sk-transfer-student-name').textContent = sData.name || 'Not available';
      $('sk-transfer-current-batch').textContent = currentBatch ? (currentBatch.name || currentBatch.id) : 'Not available';
      const courseLabel = currentCourse ? (currentCourse.name || currentCourse.id) : 'Not available';
      const levelLabel = currentLevel && currentLevel.id !== currentCourse.id ? (currentLevel.name || currentLevel.id) : null;
      $('sk-transfer-current-course').textContent = courseLabel;
      $('sk-transfer-current-level').textContent = levelLabel || 'Not available';
      const sep = $('sk-transfer-level-sep');
      if (sep) sep.hidden = !levelLabel;

      if (opts.length <= 1) {
        $('sk-transfer-dest-err').textContent = 'No eligible destination batch for this student.';
        saveBtn.disabled = true;
      } else {
        $('sk-transfer-dest-err').textContent = '';
      }

      setState(STATE_READY);
    } catch (e) {
      console.error('[school-transfer] load failed', e);
      showError('Could not load student (' + (e.code || 'error') + ').');
    }
  }

  let selectedDest = null;
  function selectDest(id) {
    selectedDest = id;
    const li = destHost.querySelector('[data-value="' + id + '"]');
    destHost.querySelectorAll('li').forEach(l => l.classList.remove('selected'));
    if (li) li.classList.add('selected');
    $('sk-transfer-dest-err').textContent = '';
    saveBtn.disabled = !id;
  }

  const destHost = $('sk-transfer-dest-host');
  const noteInput = $('sk-transfer-note');

  emptyOpenBtn.addEventListener('click', () => {
    location.hash = school ? '#/school-students' : '#/students';
  });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!studentId) { showError('No student specified.'); return; }
    if (!selectedDest) { showError('Select a destination batch.'); return; }
    setState(STATE_SUBMITTING);
    try {
      const newBatch = batches.find(b => b.id === selectedDest);
      if (!newBatch) throw new Error('Destination batch not found.');
      const who = (profile && profile.email) || '';
      const now = localToday();
      // Capacity read happens outside the transaction; only writes run inside it.
      const allStudentsSnap = await getDocs(query(collection(db, COL), where('ctx', '==', ctx)));
      const allStudents = allStudentsSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      await runTransaction(db, async (tx) => {
        // re-validate current membership inside transaction
        const sRef = doc(db, COL, studentId);
        const sSnap = await tx.get(sRef);
        if (!sSnap.exists()) throw new Error('Student no longer exists.');
        const sData = sSnap.data();
        const curBatch = batches.find(b => b.id === sData.batchId);
        if (!curBatch || curBatch.id === selectedDest) throw new Error('Batch unchanged or no longer valid.');
        // capacity check against the preloaded snapshot
        if (newBatch.capacity != null && newBatch.capacity > 0) {
          const sameBatch = allStudents.filter(s => s.batchId === newBatch.id && s.id !== studentId).length;
          if (sameBatch >= newBatch.capacity) throw new Error('Destination batch is full.');
        }
        // update student batch
        tx.update(sRef, {
          batchId: newBatch.id, batchName: newBatch.name,
          updatedAt: serverTimestamp(), updatedBy: who
        });
        // update enrolment if exists
        const eSnap = await tx.get(query(collection(db, ENROLMENTS_COL), where('studentId', '==', studentId)));
        eSnap.docs.forEach(d => tx.update(d.ref, {
          batchId: newBatch.id, batchName: newBatch.name, updatedAt: serverTimestamp()
        }));
        // transfer audit
        const tRef = doc(collection(db, 'transfers'));
        tx.set(tRef, {
          id: tRef.id, studentId,
          oldBatchId: curBatch.id, oldBatchName: curBatch.name,
          newBatchId: newBatch.id, newBatchName: newBatch.name,
          effectiveDate: now, transferredBy: who, transferredAt: serverTimestamp(),
          note: noteInput.value.trim() || ''
        });
      });
      showToast({ type: 'success', message: 'Batch transferred.' });
      setState(STATE_COMPLETED);
      setTimeout(() => { location.hash = school ? '#/school-students' : '#/students'; }, 800);
    } catch (e) {
      console.error('[school-transfer] transfer failed', e);
      showError(e.message || 'Transfer failed.');
    } finally {
      if (state === STATE_SUBMITTING) setState(STATE_READY);
    }
  });

  cancelBtn.addEventListener('click', () => {
    location.hash = school ? '#/school-students' : '#/students';
  });

  try { await load(); } catch (e) {
    console.error('[school-transfer] init failed', e);
    showError('Initialisation failed.');
  }
}

