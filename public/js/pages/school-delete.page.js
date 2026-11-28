// school-delete.page.js � Permanent delete of a Kids student (Super Admin only).
// PERMANENT DELETION IS CURRENTLY DISABLED. A trusted recursive deletion path
// (removing personal details, private Aadhaar, documents, enrolments, bills,
// payments, allocations, breaks, waivers, transfers, and related storage) is not
// yet available and verified. The form is shown read-only with the delete button
// disabled. No browser-only partial-delete fallback is provided.
import { db } from '../config/firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.196';
import { formatINR, formatDateIN } from '../utils/formatter.js?v=1.8.196';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.196';

const COL = 'students';

function $(id) { const el = document.getElementById(id); if (!el) console.warn('[school-delete] missing #' + id); return el; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

const STATE_LOADING = 'loading';
const STATE_READY = 'ready';
const STATE_EMPTY = 'empty';
const STATE_NOT_FOUND = 'notfound';
const STATE_ERROR = 'error';
const STATE_FORBIDDEN = 'forbidden';

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  if (!school) {
    showToast({ type: 'error', message: 'Delete is only available in Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';

  const m = location.hash.match(/#\/(school|youth)-delete\/([^\/#?]+)/);
  const studentId = m && m[2];

  const form = $('sk-delete-form');
  const cancelBtn = $('sk-delete-cancel');
  const saveBtn = $('sk-delete-save');
  const emptyEl = $('sk-delete-empty');
  const emptyOpenBtn = $('sk-delete-empty-open');
  const errorEl = $('sk-delete-error');
  if (!form || !cancelBtn || !saveBtn || !emptyEl || !emptyOpenBtn || !errorEl) return;

  let state = STATE_LOADING;
  let loadError = null;

  if (!isSuper) {
    setState(STATE_FORBIDDEN, `Permanent delete is restricted to ${getRoleTitle('superadmin')}.`);
    return;
  }

  let student;

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
        saveBtn.disabled = true; // permanent deletion disabled
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
      const sSnap = await getDoc(doc(db, COL, studentId));
      student = sSnap.exists() ? Object.assign({ id: sSnap.id }, sSnap.data()) : null;
      if (!student) { setState(STATE_NOT_FOUND, 'Student not found.'); return; }

      $('sk-del-student-id').textContent = student.studentId || 'Not available';
      $('sk-del-student-name').textContent = student.name || 'Not available';

      setState(STATE_READY);
    } catch (e) {
      console.error('[school-delete] load failed', e);
      showError('Could not load student (' + (e.code || 'error') + ').');
    }
  }

  emptyOpenBtn.addEventListener('click', () => {
    location.hash = '#/school-students';
  });

  cancelBtn.addEventListener('click', () => {
    location.hash = '#/school-students';
  });

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    showToast({ type: 'info', message: 'Permanent deletion is not available yet.' });
  });

  try { await load(); } catch (e) {
    console.error('[school-delete] init failed', e);
    showError('Initialisation failed.');
  }
}

