// school-end.page.js � End/drop a Kids or Youth student's current enrolment.
// Super Admin only. Sets status='ended', effective date + reason. Stops future
// monthly bill generation from the following month. Existing bills/payments/receipts
// are preserved. Idempotent (repeated clicks do not duplicate end events).
import { db } from '../config/firebase-config.js';
import { doc, getDoc, getDocs, query, where, updateDoc, runTransaction, serverTimestamp, collection } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.173';
import { localToday, nextMonth } from '../utils/school-lifecycle.js?v=1.8.173';
import { formatINR, formatDateIN } from '../utils/formatter.js?v=1.8.173';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.173';

const COL = 'students';
const ENROLMENTS_COL = 'enrolments';
const BILLS_COL = 'bills';

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-end] missing #' + id); return el; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

const STATE_LOADING = 'loading';
const STATE_READY = 'ready';
const STATE_EMPTY = 'empty';
const STATE_NOT_FOUND = 'notfound';
const STATE_ERROR = 'error';
const STATE_FORBIDDEN = 'forbidden';
const STATE_SUBMITTING = 'submitting';
const STATE_COMPLETED = 'completed';

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  const youth = ctx === 'youth';
  if (!school && !youth) {
    showToast({ type: 'error', message: 'End course is available in Youth Centre and Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';

  const m = location.hash.match(/#\/(school|youth)-end\/([^\/#?]+)/);
  const studentId = m && m[2];

  const form = $('sk-end-form');
  const cancelBtn = $('sk-end-cancel');
  const saveBtn = $('sk-end-save');
  const emptyEl = $('sk-end-empty');
  const emptyOpenBtn = $('sk-end-empty-open');
  const errorEl = $('sk-end-error');
  if (!form || !cancelBtn || !saveBtn || !emptyEl || !emptyOpenBtn || !errorEl) return;

  let state = STATE_LOADING;
  let loadError = null;

  if (!isSuper) {
    setState(STATE_FORBIDDEN, `End course is restricted to ${getRoleTitle('superadmin')}.`);
    return;
  }

  let student, currentEnrolment, outstandingBills = [];

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
        saveBtn.disabled = false;
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

  async function load() {
    setState(STATE_LOADING);
    if (!studentId) {
      setState(STATE_EMPTY);
      return;
    }
    try {
      const [sSnap, eSnap, bSnap] = await Promise.all([
        getDoc(doc(db, COL, studentId)),
        getDocs(query(collection(db, ENROLMENTS_COL), where('studentId', '==', studentId), where('status', '==', 'active'))),
        getDocs(query(collection(db, BILLS_COL), where('studentId', '==', studentId), where('status', 'in', ['unpaid', 'partial'])))
      ]);
      student = sSnap.exists() ? Object.assign({ id: sSnap.id }, sSnap.data()) : null;
      if (!student) { setState(STATE_NOT_FOUND, 'Student not found.'); return; }
      currentEnrolment = eSnap.docs.length ? Object.assign({ id: eSnap.docs[0].id }, eSnap.docs[0].data()) : null;
      outstandingBills = bSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));

      $('sk-end-student-id').textContent = student.studentId || 'Not available';
      $('sk-end-student-name').textContent = student.name || 'Not available';
      $('sk-end-current-batch').textContent = student.batchName || 'Not available';
      $('sk-end-current-level').textContent = student.courseName || 'Not available';
      $('sk-end-effective').value = localToday();

      const dueEl = $('sk-end-outstanding');
      const total = outstandingBills.reduce((a, b) => a + (Number(b.monthlyFee || 0) - Number(b.paidAmount || 0)), 0);
      dueEl.textContent = formatINR(total);
      if (total > 0) {
        dueEl.innerHTML = formatINR(total) + ' <span style="color:var(--danger);font-size:12px;">(existing dues remain payable)</span>';
      }

      if (!currentEnrolment) {
        $('sk-end-effective-err').textContent = 'No active enrolment to end.';
        saveBtn.disabled = true;
      } else {
        $('sk-end-effective-err').textContent = '';
      }

      setState(STATE_READY);
    } catch (e) {
      console.error('[school-end] load failed', e);
      showError('Could not load student (' + (e.code || 'error') + ').');
    }
  }

  emptyOpenBtn.addEventListener('click', () => {
    location.hash = school ? '#/school-students' : '#/students';
  });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!studentId) { showError('No student specified.'); return; }
    const effectiveDate = $('sk-end-effective').value.trim();
    const reason = $('sk-end-reason').value.trim();
    if (!effectiveDate) { showError('Select an effective date.'); return; }
    if (!reason) { showError('Enter a reason.'); return; }
    if (!currentEnrolment) { showError('No active enrolment to end.'); return; }

    setState(STATE_SUBMITTING);
    try {
      const who = (profile && profile.email) || '';
      const effectiveDate = $('sk-end-effective').value.trim();
      const stopFrom = nextMonth(effectiveDate);
      // Read future bills outside the transaction; only writes run inside it.
      const futureSnap = await getDocs(query(collection(db, BILLS_COL),
        where('studentId', '==', studentId), where('month', '>=', stopFrom)));
      const futureIds = futureSnap.docs.map(d => d.id);
      await runTransaction(db, async (tx) => {
        const eRef = doc(db, ENROLMENTS_COL, currentEnrolment.id);
        tx.update(eRef, {
          status: 'ended', endDate: effectiveDate, endReason: reason,
          endedBy: who, endedAt: serverTimestamp(), updatedAt: serverTimestamp()
        });
        futureIds.forEach(id => tx.update(doc(db, BILLS_COL, id), {
          status: 'stopped', stoppedAt: serverTimestamp(), stoppedBy: who
        }));
        tx.update(doc(db, COL, studentId), { status: 'ended', updatedAt: serverTimestamp(), updatedBy: who });
      });
      showToast({ type: 'success', message: 'Course ended. Existing bills remain payable; no future bills will be generated.' });
      setState(STATE_COMPLETED);
      setTimeout(() => { location.hash = school ? '#/school-students' : '#/students'; }, 800);
    } catch (e) {
      console.error('[school-end] end failed', e);
      showError(e.message || 'Could not end course.');
    } finally {
      if (state === STATE_SUBMITTING) setState(STATE_READY);
    }
  });

  cancelBtn.addEventListener('click', () => {
    location.hash = school ? '#/school-students' : '#/students';
  });

  try { await load(); } catch (e) {
    console.error('[school-end] init failed', e);
    showError('Initialisation failed.');
  }
}

