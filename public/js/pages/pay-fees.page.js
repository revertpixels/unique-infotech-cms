// pay-fees.page.js — Pay Fees page module (Youth Centre only)
import { db } from '../config/firebase-config.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  runTransaction,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createSelect } from '../components/ui-select.js?v=1.8.140';
import { openPopup } from '../components/modal.js?v=1.8.140';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.140';
import { showToast } from '../components/toast.js?v=1.8.140';
import { getSelectedSessionId, getCachedSessions } from '../core/sessions.js?v=1.8.140';
import { todayISO, fmtDate, examWindowOf, installmentSchedule } from '../utils/session-rules.js?v=1.8.140';
import { openPaymentPopup } from '../components/payment-popup.js?v=1.8.140';
import {
  calculateLateFee,
  fetchStudentPayments,
  isInstallmentPaid,
  isExamFeePaid,
  courseFeeWithoutExam,
  courseBalanceWithoutExam,
  calculateStudentFinancials,
  repairStudentAdmissionPayment
} from '../services/payment.service.js?v=1.8.140';

let currentUserProfile = null;
let currentCtx = 'youth';
let activeSession = null;
let youthCourses = [];
let allStudentsCache = [];
let currentStudent = null;
let currentPayments = [];

const studentPhotoCache = new Map();

async function getStudentPhoto(studentDocId) {
  if (!studentDocId) return null;
  if (studentPhotoCache.has(studentDocId)) {
    return studentPhotoCache.get(studentDocId);
  }
  const fetchPromise = (async () => {
    try {
      const snap = await getDoc(doc(db, 'students', studentDocId, 'docs', 'photo'));
      if (snap.exists()) {
        const d = snap.data();
        const url = d && (d.data || d.dataUrl || d.url);
        return url || null;
      }
    } catch (e) {
      console.warn('[pay-fees] failed to load student photo', studentDocId, e);
    }
    return null;
  })();
  studentPhotoCache.set(studentDocId, fetchPromise);
  const res = await fetchPromise;
  studentPhotoCache.set(studentDocId, res);
  return res;
}
let sessionChangeListener = null;

function $(id) {
  return document.getElementById(id);
}

function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function formatINR(val) {
  const n = Number(val || 0);
  return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateIN(iso) {
  return fmtDate(iso);
}

function formatAnyDate(val) {
  if (!val) return '';
  let d = null;
  if (typeof val?.toDate === 'function') {
    d = val.toDate();
  } else if (val?.seconds) {
    d = new Date(val.seconds * 1000);
  } else if (val instanceof Date) {
    d = val;
  } else if (typeof val === 'string') {
    if (val.includes('T')) {
      d = new Date(val);
    } else {
      return fmtDate(val);
    }
  }
  if (d && !isNaN(d.getTime())) {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return fmtDate(val);
}

function getAuthEmail() {
  const cacheUser = window.APP_CACHE?.currentUser;
  if (cacheUser && cacheUser.email) return cacheUser.email.toLowerCase();
  return (currentUserProfile && currentUserProfile.email) ? currentUserProfile.email.toLowerCase() : '';
}

export async function mount({ container, profile, ctx }) {
  currentUserProfile = profile;
  currentCtx = ctx || 'youth';

  if (currentCtx !== 'youth') {
    showToast({ type: 'warning', message: 'Pay Fees is only available in the Youth Centre section.' });
    return;
  }

  const isSuper = profile && profile.role === 'superadmin';
  const isBranchHead = profile && profile.role === 'branch_head';

  if (!isSuper && !isBranchHead) {
    showToast({ type: 'error', message: 'You do not have permission to access Pay Fees.' });
    return;
  }

  await initData();
  bindEvents();

  // Check if URL has ?student=<studentDocId>
  const rawHash = location.hash || '';
  const qIdx = rawHash.indexOf('?');
  if (qIdx !== -1) {
    const params = new URLSearchParams(rawHash.slice(qIdx));
    const studentDocIdParam = params.get('student');
    if (studentDocIdParam) {
      await loadStudentDirectly(studentDocIdParam);
    }
  }
}

async function loadStudentDirectly(docId) {
  if (!docId) return;
  let st = allStudentsCache.find(s => s.id === docId || s.studentId === docId);
  if (!st) {
    try {
      const snap = await getDoc(doc(db, 'students', docId));
      if (snap.exists()) {
        st = Object.assign({ id: snap.id }, snap.data());
      }
    } catch (_) { }
  }
  if (!st) return;

  const isBranchHead = currentUserProfile && currentUserProfile.role === 'branch_head';
  const myBranch = currentUserProfile && currentUserProfile.branchId;
  if (isBranchHead && myBranch && st.branchId && st.branchId !== myBranch) {
    showToast({ type: 'error', message: 'You do not have access to students from other branches.' });
    return;
  }

  const searchInput = $('pf-search-input');
  if (searchInput) {
    searchInput.value = st.studentId || st.name || '';
    const clearBtn = $('pf-search-clear');
    if (clearBtn) clearBtn.hidden = false;
  }

  openStudentPanel(st);
}

export function unmount() {
  if (sessionChangeListener) {
    window.removeEventListener('uic:session-selected', sessionChangeListener);
    sessionChangeListener = null;
  }
}

/**
 * Loads session info, active courses and initial students cache
 */
async function initData() {
  const selectedSessionId = getSelectedSessionId('youth');
  const cachedSessions = getCachedSessions('youth');
  activeSession = cachedSessions.find(s => s.id === selectedSessionId) || null;

  if (!activeSession && selectedSessionId) {
    try {
      const sSnap = await getDoc(doc(db, 'sessions', selectedSessionId));
      if (sSnap.exists()) {
        activeSession = Object.assign({ id: sSnap.id }, sSnap.data());
      }
    } catch (e) {
      console.warn('[pay-fees] failed to load session doc', e);
    }
  }

  const sessionBadge = $('pf-session-badge');
  if (sessionBadge) {
    sessionBadge.textContent = activeSession ? (activeSession.name || activeSession.id) : 'No session selected';
  }

  // Load Youth courses
  try {
    const cSnap = await getDocs(query(collection(db, 'courses'), where('ctx', '==', 'youth')));
    youthCourses = cSnap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  } catch (e) {
    console.warn('[pay-fees] failed to load courses', e);
  }

  // Load students for active session
  await loadStudents();
  updateExamFeeButtonDot();
}

/**
 * Loads students from Firestore scoped to youth and branch if branch head
 */
async function loadStudents() {
  try {
    const isBranchHead = currentUserProfile && currentUserProfile.role === 'branch_head';
    const myBranchId = currentUserProfile?.branchId;

    let q;
    if (isBranchHead && myBranchId) {
      q = query(
        collection(db, 'students'),
        where('ctx', '==', 'youth'),
        where('branchId', '==', myBranchId)
      );
    } else {
      q = query(collection(db, 'students'), where('ctx', '==', 'youth'));
    }

    const snap = await getDocs(q);
    allStudentsCache = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  } catch (e) {
    console.error('[pay-fees] loadStudents error', e);
    showToast({ type: 'error', message: 'Failed to load students list.' });
  }
}

let currentSuggestions = [];
let highlightedSuggestionIndex = -1;

function closeSearchDropdown() {
  const dd = $('pf-search-dropdown');
  if (dd) {
    dd.hidden = true;
    dd.textContent = '';
  }
  currentSuggestions = [];
  highlightedSuggestionIndex = -1;
}

function updateSuggestionHighlight() {
  const dd = $('pf-search-dropdown');
  if (!dd) return;
  const items = dd.querySelectorAll('.pf-suggest-item');
  items.forEach((item, idx) => {
    if (idx === highlightedSuggestionIndex) {
      item.classList.add('is-selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('is-selected');
    }
  });
}

function renderSearchDropdown(matches) {
  const dd = $('pf-search-dropdown');
  if (!dd) return;
  dd.textContent = '';
  currentSuggestions = matches.slice(0, 10);
  highlightedSuggestionIndex = -1;

  if (currentSuggestions.length === 0) {
    closeSearchDropdown();
    return;
  }

  currentSuggestions.forEach((st, idx) => {
    const item = mk('div', 'pf-suggest-item');
    item.dataset.index = idx;

    const avatar = mk('div', 'pf-suggest-avatar');
    const inits = (st.name || 'ST').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    avatar.textContent = inits;
    getStudentPhoto(st.id).then(photoUrl => {
      if (photoUrl && avatar.isConnected) {
        const img = document.createElement('img');
        img.src = photoUrl;
        img.alt = st.name || '';
        img.onload = () => {
          if (avatar.isConnected) {
            avatar.textContent = '';
            avatar.appendChild(img);
          }
        };
      }
    });

    const info = mk('div', 'pf-suggest-info');
    const top = mk('div', 'pf-suggest-top');
    const name = mk('span', 'pf-suggest-name', st.name || 'Unnamed');
    const id = mk('span', 'pf-suggest-id', st.studentId || st.id);
    top.append(name, id);

    const sub = mk('div', 'pf-suggest-sub');
    const crs = mk('span', '', st.courseName || st.courseCode || '—');
    const dot = mk('span', 'pf-suggest-dot', '•');
    const bch = mk('span', '', st.batchName || 'Standard');
    sub.append(crs, dot, bch);

    info.append(top, sub);
    item.append(avatar, info);

    item.addEventListener('mouseenter', () => {
      highlightedSuggestionIndex = idx;
      updateSuggestionHighlight();
    });

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const input = $('pf-search-input');
      if (input) input.value = st.studentId || st.name || '';
      closeSearchDropdown();
      openStudentPanel(st);
    });

    dd.appendChild(item);
  });

  dd.hidden = false;
}

function bindEvents() {
  const searchInput = $('pf-search-input');
  const searchBtn = $('pf-search-btn');
  const clearBtn = $('pf-search-clear');

  if (searchInput) {
    searchInput.oninput = () => {
      const val = searchInput.value.trim();
      if (clearBtn) clearBtn.hidden = !val;
      if (!val) {
        closeSearchDropdown();
        return;
      }

      const selectedSessionId = getSelectedSessionId('youth');
      let scoped = allStudentsCache.filter(s => {
        if (selectedSessionId && s.sessionId && s.sessionId !== selectedSessionId) {
          return false;
        }
        return true;
      });

      const digitsOnly = val.replace(/\D/g, '');
      let matches = [];
      if (digitsOnly.length === 8 && /^\d{8}$/.test(val)) {
        matches = scoped.filter(s => String(s.studentId || '').trim() === val);
      } else if (digitsOnly.length >= 3 && /^\d+$/.test(val)) {
        matches = scoped.filter(s => {
          const sid = String(s.studentId || '');
          const p1 = String(s.phone || '').replace(/\D/g, '');
          const p2 = String(s.altPhone || s.guardianPhone || '').replace(/\D/g, '');
          return sid.includes(val) || p1.includes(val) || p2.includes(val);
        });
      } else {
        const lower = val.toLowerCase();
        matches = scoped.filter(s => {
          const name = String(s.name || '').toLowerCase();
          const sid = String(s.studentId || '').toLowerCase();
          return name.includes(lower) || sid.includes(lower);
        });
      }
      renderSearchDropdown(matches);
    };

    searchInput.onkeydown = (e) => {
      const dd = $('pf-search-dropdown');
      const isDropdownOpen = dd && !dd.hidden && currentSuggestions.length > 0;

      if (e.key === 'ArrowDown') {
        if (isDropdownOpen) {
          e.preventDefault();
          highlightedSuggestionIndex = (highlightedSuggestionIndex + 1) % currentSuggestions.length;
          updateSuggestionHighlight();
        }
      } else if (e.key === 'ArrowUp') {
        if (isDropdownOpen) {
          e.preventDefault();
          highlightedSuggestionIndex = (highlightedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
          updateSuggestionHighlight();
        }
      } else if (e.key === 'Escape') {
        closeSearchDropdown();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isDropdownOpen && highlightedSuggestionIndex >= 0 && currentSuggestions[highlightedSuggestionIndex]) {
          const chosen = currentSuggestions[highlightedSuggestionIndex];
          if (searchInput) searchInput.value = chosen.studentId || chosen.name || '';
          closeSearchDropdown();
          openStudentPanel(chosen);
        } else {
          closeSearchDropdown();
          executeSearch();
        }
      }
    };
  }

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.pf-search-input-wrap');
    if (wrap && !wrap.contains(e.target)) {
      closeSearchDropdown();
    }
  });

  if (searchBtn) {
    searchBtn.onclick = () => {
      closeSearchDropdown();
      executeSearch();
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearBtn.hidden = true;
      closeSearchDropdown();
      resetSearchResults();
    };
  }

  // Copy student ID button
  const copyBtn = $('pf-btn-copy-id');
  if (copyBtn) {
    copyBtn.onclick = () => {
      if (currentStudent?.studentId) {
        navigator.clipboard.writeText(currentStudent.studentId).then(() => {
          showToast({ type: 'success', message: 'Student ID copied: ' + currentStudent.studentId });
        });
      }
    };
  }

  // View full profile button
  const profileBtn = $('pf-btn-view-profile');
  if (profileBtn) {
    profileBtn.onclick = () => {
      if (currentStudent?.id) {
        location.hash = '#/students/' + currentStudent.id;
      }
    };
  }

  // Exam fee collection mode toggle (top-right header)
  const examModeBtn = $('pf-btn-exam-mode');
  if (examModeBtn) {
    examModeBtn.onclick = () => showExamFeeView();
  }

  // Back to payments button from exam view
  const evBackBtn = $('pf-ev-back-btn');
  if (evBackBtn) {
    evBackBtn.onclick = () => showPaymentsView();
  }

  // View all payments button
  const allPayBtn = $('pf-btn-all-payments');
  if (allPayBtn) {
    allPayBtn.onclick = () => {
      if (currentStudent?.id) {
        location.hash = '#/students/' + currentStudent.id + '?tab=payments';
      }
    };
  }

  // Listen to top bar session change
  sessionChangeListener = async (e) => {
    await initData();
    resetSearchResults();
  };
  window.addEventListener('uic:session-selected', sessionChangeListener);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function resetSearchResults() {
  currentStudent = null;
  currentPayments = [];
  $('pf-panel').hidden = true;
  $('pf-multi-card').hidden = true;
  $('pf-empty-state').hidden = true;
  closeSearchDropdown();
  try {
    if (location.hash.startsWith('#/pay-fees')) {
      history.replaceState(null, '', '#/pay-fees');
    }
  } catch (_) { }
}

/**
 * Executes student search per Part 2.1 specifications:
 * - 8 digits -> exact student ID
 * - 10 digits -> phone or alt phone
 * - text -> student name prefix or substring
 * - scoped to top bar session automatically
 */
function executeSearch() {
  const input = $('pf-search-input');
  const term = (input ? input.value : '').trim();

  if (!term) {
    showToast({ type: 'warning', message: 'Please enter a student ID, phone number or name.' });
    return;
  }

  const selectedSessionId = getSelectedSessionId('youth');
  const sessionName = activeSession ? (activeSession.name || activeSession.id) : 'the active session';

  // Filter students by active session
  let scoped = allStudentsCache.filter(s => {
    if (selectedSessionId && s.sessionId && s.sessionId !== selectedSessionId) {
      return false;
    }
    return true;
  });

  const digitsOnly = term.replace(/\D/g, '');
  let matches = [];

  if (digitsOnly.length === 8 && /^\d{8}$/.test(term)) {
    // 8 digits -> exact student ID
    matches = scoped.filter(s => String(s.studentId || '').trim() === term);
  } else if (digitsOnly.length === 10 && /^\d{10}$/.test(term)) {
    // 10 digits -> phone or alt phone
    matches = scoped.filter(s => {
      const p1 = String(s.phone || '').replace(/\D/g, '');
      const p2 = String(s.altPhone || s.guardianPhone || '').replace(/\D/g, '');
      return p1 === digitsOnly || p2 === digitsOnly;
    });
  } else {
    // Text search: name prefix or substring (case-insensitive)
    const lower = term.toLowerCase();
    matches = scoped.filter(s => {
      const name = String(s.name || '').toLowerCase();
      const sId = String(s.studentId || '').toLowerCase();
      return name.startsWith(lower) || name.includes(lower) || sId.includes(lower);
    });
  }

  if (matches.length === 0) {
    $('pf-panel').hidden = true;
    $('pf-multi-card').hidden = true;
    const emptyState = $('pf-empty-state');
    emptyState.hidden = false;
    $('pf-empty-title').textContent = 'No student found';
    $('pf-empty-msg').textContent = `No student found matching "${term}" in ${sessionName}.`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  $('pf-empty-state').hidden = true;

  if (matches.length === 1) {
    $('pf-multi-card').hidden = true;
    openStudentPanel(matches[0]);
  } else {
    // Show multiple matches list
    $('pf-panel').hidden = true;
    renderMultiStudentList(matches);
  }
}

/**
 * Renders list of matching students when >1 matches found
 */
function renderMultiStudentList(students) {
  const card = $('pf-multi-card');
  const list = $('pf-multi-list');
  const count = $('pf-multi-count');

  card.hidden = false;
  count.textContent = students.length;
  list.textContent = '';

  students.forEach(st => {
    const item = mk('div', 'pf-student-choice');

    // Avatar (initials first, swap photo when loaded without blocking)
    const avatar = mk('div', 'pf-choice-avatar');
    const initials = (st.name || 'ST').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    avatar.textContent = initials;

    getStudentPhoto(st.id).then(photoUrl => {
      if (photoUrl && avatar.isConnected) {
        const img = document.createElement('img');
        img.src = photoUrl;
        img.alt = st.name || '';
        img.onload = () => {
          if (avatar.isConnected) {
            avatar.textContent = '';
            avatar.appendChild(img);
          }
        };
      }
    });

    const body = mk('div', 'pf-choice-body');
    const nameEl = mk('div', 'pf-choice-name', st.name || 'Unnamed Student');
    const metaEl = mk('div', 'pf-choice-meta');
    metaEl.innerHTML = `<span><strong>ID:</strong> ${st.studentId || '—'} &nbsp;|&nbsp; <strong>Phone:</strong> ${st.phone || '—'}</span>` +
      `<span>${st.courseName || st.courseCode || 'Course'} &bull; ${st.batchName || 'Batch'}</span>`;

    body.append(nameEl, metaEl);

    const action = mk('div', 'pf-choice-action');
    action.innerHTML = '<i data-lucide="chevron-right"></i>';

    item.append(avatar, body, action);
    item.onclick = () => {
      card.hidden = true;
      openStudentPanel(st);
    };

    list.appendChild(item);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Opens student payment panel (Part 2.2)
 */
async function openStudentPanel(student) {
  currentStudent = student;
  closeSearchDropdown();
  try {
    const newHash = `#/pay-fees?student=${encodeURIComponent(student.id)}`;
    if (location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  } catch (_) { }
  $('pf-multi-card').hidden = true;
  $('pf-empty-state').hidden = true;
  const panel = $('pf-panel');
  panel.hidden = false;

  // Fill Header Data
  $('pf-student-name').textContent = student.name || 'Unnamed';
  $('pf-student-id').textContent = student.studentId || '—';
  $('pf-course-name').textContent = student.courseName || student.courseCode || '—';
  $('pf-batch-name').textContent = student.batchName || '—';
  $('pf-session-name').textContent = student.sessionName || (activeSession ? activeSession.name : '—');
  $('pf-branch-name').textContent = student.branchName || student.branchCode || '—';

  const statusEl = $('pf-student-status');
  const stStatus = student.status || 'active';
  statusEl.textContent = stStatus.charAt(0).toUpperCase() + stStatus.slice(1);
  statusEl.className = 'pill ' + (stStatus === 'active' ? 'up' : 'neutral');

  // Photo / Initials (Show initials first, swap in photo from docs/photo when loaded)
  const avatarText = $('pf-avatar-text');
  const avatarImg = $('pf-avatar-img');
  const initials = (student.name || 'ST').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  avatarText.textContent = initials;
  avatarText.hidden = false;
  avatarImg.hidden = true;
  avatarImg.src = '';

  const thisStudentDocId = student.id;
  getStudentPhoto(thisStudentDocId).then(photoUrl => {
    if (currentStudent && currentStudent.id === thisStudentDocId && photoUrl) {
      avatarImg.onload = () => {
        if (currentStudent && currentStudent.id === thisStudentDocId) {
          avatarImg.hidden = false;
          avatarText.hidden = true;
        }
      };
      avatarImg.onerror = () => {
        avatarImg.hidden = true;
        avatarText.hidden = false;
      };
      avatarImg.src = photoUrl;
    }
  });

  // Load payments
  currentPayments = await fetchStudentPayments(student.id);
  if (currentPayments && student.ctx !== 'school') {
    await repairStudentAdmissionPayment(student, currentPayments).catch(() => {});
  }

  // Render Metrics & Installment Table
  renderPaymentSummary();
  renderInstallmentScheduleTable();
  renderExamFeeSection();

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Renders Financial Summary Cards (Part 2.2a)
 */
function renderPaymentSummary() {
  const s = currentStudent;
  if (!s) return;

  const { total, paid, outstanding, percent: pct } = calculateStudentFinancials(s, currentPayments);

  // Calculate late fee as of today for all overdue unpaid installments
  let totalLateFeeToday = 0;
  if (s.paymentPlan !== 'full') {
    const sched = s.feeSchedule || [];
    const today = todayISO();

    sched.forEach(it => {
      if (!isInstallmentPaid(it, currentPayments, s)) {
        if (today > it.due) {
          totalLateFeeToday += calculateLateFee(it.due, today);
        }
      }
    });
  }

  $('pf-m-total').textContent = formatINR(total);
  $('pf-m-paid').textContent = formatINR(paid);
  $('pf-m-outstanding').textContent = formatINR(outstanding);
  $('pf-m-latefee').textContent = formatINR(totalLateFeeToday);

  $('pf-m-pct').textContent = pct + '% of total fee';
}

/**
 * Renders Installment Table with strict sequential payment rule (Part 2.2b)
 * Installments are paid in FULL only, one at a time, oldest unpaid first:
 * ONLY that row has a "Collect" button.
 */
function renderInstallmentScheduleTable() {
  const tbody = $('pf-inst-tbody');
  tbody.textContent = '';

  const s = currentStudent;
  if (s.paymentPlan === 'full') {
    const tr = mk('tr');
    const td = mk('td', 'text-center font-semibold text-success', `Course fee paid in full on ${formatDateIN(s.fullPaidOn || s.admissionDate || todayISO())}. No installments due. Only examination fee remains.`);
    td.colSpan = 8;
    td.style.padding = '18px 12px';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const sched = s.feeSchedule || [];
  const today = todayISO();

  if (sched.length === 0) {
    const tr = mk('tr');
    const td = mk('td', 'text-mute text-center', 'No installment schedule configured for this student.');
    td.colSpan = 8;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  let foundOldestUnpaid = false;

  sched.forEach((it) => {
    const tr = mk('tr');
    const itNo = Number(it.no ?? it.installmentNo);
    const paidRec = currentPayments.find(p => {
      const t = String(p.type || '').toUpperCase().trim();
      const pNo = Number(p.installmentNo ?? p.installment ?? p.no ?? p.instNo);
      return (t === 'IN' || t === 'INST' || t === 'INSTALLMENT' || t === 'WA') && pNo === itNo;
    });

    const isPaid = isInstallmentPaid(it, currentPayments, s);
    const isWaived = (paidRec && paidRec.waived) || !!it.waived;

    let statusLabel = 'Upcoming';
    let statusClass = 'pill';
    let lateFine = 0;

    if (isWaived) {
      statusLabel = 'Waived';
      statusClass = 'pill up';
    } else if (isPaid) {
      statusLabel = 'Paid';
      statusClass = 'pill up';
    } else {
      if (today > it.due) {
        lateFine = calculateLateFee(it.due, today);
        statusLabel = 'Overdue';
        statusClass = 'pill down';
      } else if (today >= it.opens) {
        statusLabel = 'Due';
        statusClass = 'pill warn';
      } else {
        statusLabel = 'Upcoming';
        statusClass = 'pill';
      }
    }

    const headTd = mk('td', 'font-semibold', 'Installment ' + it.no);
    const monthTd = mk('td', '', it.month || '-');
    const dueTd = mk('td', 'font-semibold', formatDateIN(it.due));
    const schedAmt = Number(it.amount || 0);
    const amtTd = mk('td', 'num', formatINR(schedAmt));
    const lateTd = mk('td', 'num ' + (lateFine > 0 && !isPaid ? 'text-danger font-semibold' : 'text-mute'), isPaid ? '—' : formatINR(lateFine));
    const totalTd = mk('td', 'num font-semibold', isPaid ? formatINR(paidRec?.amount || schedAmt) : formatINR(schedAmt + lateFine));

    const statusTd = mk('td');
    let subDateText = '';
    if (isWaived) {
      statusLabel = 'Waived';
      statusClass = 'pill violet';
      subDateText = (paidRec?.paidOn || paidRec?.date || it.waivedOn) ? 'on ' + formatDateIN(paidRec?.paidOn || paidRec?.date || it.waivedOn) : '';
    } else if (isPaid) {
      statusLabel = 'Paid';
      statusClass = 'pill up';
      subDateText = (paidRec?.paidOn || paidRec?.date) ? 'on ' + formatDateIN(paidRec.paidOn || paidRec.date) : '';
    } else {
      if (today > it.due) {
        lateFine = calculateLateFee(it.due, today);
        statusLabel = 'Overdue';
        statusClass = 'pill down';
        subDateText = 'since ' + formatDateIN(it.due);
      } else if (today >= it.opens) {
        statusLabel = 'Due';
        statusClass = 'pill warn';
        subDateText = 'by ' + formatDateIN(it.due);
      } else {
        statusLabel = 'Upcoming';
        statusClass = 'pill';
        subDateText = it.opens ? 'from ' + formatDateIN(it.opens) : (it.due ? 'due ' + formatDateIN(it.due) : '');
      }
    }

    const pill = mk('span', statusClass, statusLabel);
    statusTd.appendChild(pill);
    if (subDateText) {
      const sub = mk('div', 'pf-status-sub', subDateText);
      statusTd.appendChild(sub);
    }

    // Action column with sequential payment check
    const actTd = mk('td', 'act');

    if (isPaid) {
      const receiptBtn = mk('button', 'ui-btn ghost sm pf-btn-receipt');
      receiptBtn.type = 'button';
      if (paidRec?.receiptNo) {
        receiptBtn.title = `Receipt: ${paidRec.receiptNo}`;
      }
      receiptBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
      receiptBtn.onclick = () => {
        const paymentId = paidRec?.id || 'latest';
        location.hash = `#/payments/${s.id}/${paymentId}/receipt?from=pay-fees`;
      };
      actTd.appendChild(receiptBtn);
    } else if (!foundOldestUnpaid) {
      // This is the OLDEST unpaid installment -> CAN COLLECT!
      foundOldestUnpaid = true;
      const collectBtn = mk('button', 'ui-btn primary sm pf-btn-collect');
      collectBtn.type = 'button';
      collectBtn.innerHTML = '<i data-lucide="wallet"></i><span>Collect</span>';
      collectBtn.onclick = () => openPaymentPopup({
        student: currentStudent,
        profile: currentUserProfile,
        preselectedOption: 'IN_' + itNo,
        activeSession,
        payments: currentPayments,
        from: 'pay-fees',
        onSuccess: async () => {
          await loadStudents();
          const freshStudent = allStudentsCache.find(st => st.id === currentStudent?.id);
          if (freshStudent) {
            currentStudent = freshStudent;
          }
          currentPayments = await fetchStudentPayments(currentStudent.id);
          renderPaymentSummary();
          renderInstallmentScheduleTable();
          renderExamFeeSection();
        }
      });
      actTd.appendChild(collectBtn);
    } else {
      // Later unpaid installment -> muted dash
      const dash = mk('span', 'text-mute', '—');
      actTd.appendChild(dash);
    }

    tr.append(headTd, monthTd, dueTd, amtTd, lateTd, totalTd, statusTd, actTd);
    tbody.appendChild(tr);
  });
}

/**
 * Renders Exam Fee Section (Part 2.4)
 */
function renderExamFeeSection() {
  const container = $('pf-exam-content');
  container.textContent = '';

  const s = currentStudent;
  if (!s) return;

  const course = youthCourses.find(c => c.id === s.courseId) || {};
  const examFee = Number(course.fees?.exam || s.feeSnapshot?.exam || 0);

  // If course has no exam fee
  if (examFee <= 0) {
    const banner = mk('div', 'pf-exam-banner');
    banner.innerHTML = `<div class="pf-exam-banner-left">
      <div class="pf-exam-banner-icon"><i data-lucide="info"></i></div>
      <div>
        <div class="pf-exam-banner-title">No Exam Fee Applicable</div>
        <div class="pf-exam-banner-sub">This course (${course.name || course.code || s.courseName || 'Course'}) has no examination fee configured.</div>
      </div>
    </div>`;
    container.appendChild(banner);
    return;
  }

  const isSuper = currentUserProfile && currentUserProfile.role === 'superadmin';
  const isBranchHead = currentUserProfile && currentUserProfile.role === 'branch_head';
  const session = activeSession;
  const examCollectionStarted = session?.examFeeCollection?.started === true;
  const examWindow = examWindowOf(session);
  const sessionSched = installmentSchedule(session);
  const lastDue = sessionSched.length ? sessionSched[sessionSched.length - 1].due : (examWindow.from || session?.endDate || '');
  const today = todayISO();

  // If exam fee collection is NOT started
  if (!examCollectionStarted) {
    const banner = mk('div', 'pf-exam-banner');
    const left = mk('div', 'pf-exam-banner-left');
    const availText = examWindow.from ? `Available from ${formatDateIN(examWindow.from)}` : 'Available from session end';
    left.innerHTML = `<div class="pf-exam-banner-icon"><i data-lucide="lock"></i></div>
      <div>
        <div class="pf-exam-banner-title">Exam Fee Collection Not Started</div>
        <div class="pf-exam-banner-sub">Exam fee collection for ${session?.name || 'this session'} has not started yet. ${availText}.</div>
      </div>`;
    banner.appendChild(left);
    container.appendChild(banner);
    return;
  }

  // When exam fee collection IS started:
  // For Branch Head, show a small read-only line:
  // "Started on <date> - exam fee can be collected"
  if (isBranchHead) {
    const startedRaw = session?.examFeeCollection?.startedAt;
    const startedDateStr = formatAnyDate(startedRaw) || formatDateIN(examWindow.from) || 'recently';
    const statusLine = mk('div', 'pf-exam-status-line success');
    statusLine.innerHTML = `<i data-lucide="check-circle"></i><span>Started on ${startedDateStr} - exam fee can be collected</span>`;
    container.appendChild(statusLine);
  }

  // Exam fee collection IS started: show exam fee table row
  const tableWrap = mk('div', 'pf-exam-table-wrap');
  const table = mk('table', 'adm-table pf-table');
  table.innerHTML = `<thead>
    <tr>
      <th>Fee Head</th>
      <th>Session</th>
      <th>Due Date</th>
      <th class="num">Amount</th>
      <th class="num">Late Fee</th>
      <th class="num">Total Payable</th>
      <th>Status</th>
      <th class="adm-actions">Action</th>
    </tr>
  </thead>`;

  const tbody = mk('tbody');
  const tr = mk('tr');

  // Verify courseId is in session.examFeeCollection.fees without fallback
  const feesMap = session.examFeeCollection?.fees;
  const isCourseInFees = feesMap && s.courseId && Object.prototype.hasOwnProperty.call(feesMap, s.courseId);

  if (!isCourseInFees) {
    const headTd = mk('td', 'font-semibold', 'Board Examination Fee');
    const sessTd = mk('td', '', session.name || '-');
    const dueTd = mk('td', '', session.endDate ? formatDateIN(session.endDate) : '—');
    const amtTd = mk('td', 'num text-mute', '—');
    const lateTd = mk('td', 'num text-mute', '—');
    const totalTd = mk('td', 'num text-mute', '—');
    const statusTd = mk('td');
    statusTd.appendChild(mk('span', 'pill down', 'Not Set'));
    const actTd = mk('td', 'act');
    const errMsg = mk('span', 'pf-action-disabled text-danger', 'Exam fee not set for this course in this session. Contact Super Admin.');
    actTd.appendChild(errMsg);

    tr.append(headTd, sessTd, dueTd, amtTd, lateTd, totalTd, statusTd, actTd);
    tbody.appendChild(tr);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    container.appendChild(tableWrap);
    return;
  }

  const lockedFee = Number(feesMap[s.courseId]);
  const isPaid = isExamFeePaid(lockedFee, currentPayments, s);

  const examTxn = currentPayments.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'EX' || t === 'EXAM' || t === 'EXAMINATION';
  });

  const sched = s.feeSchedule || [];
  const allInstPaid = sched.every(it => isInstallmentPaid(it, currentPayments, s));

  const headTd = mk('td', 'font-semibold', 'Board Examination Fee');
  const sessTd = mk('td', '', session.name || '-');
  const dueTd = mk('td', '', session.endDate ? formatDateIN(session.endDate) : '—');
  const amtTd = mk('td', 'num', formatINR(lockedFee));
  const lateTd = mk('td', 'num text-mute', 'Rs. 0.00');
  const totalTd = mk('td', 'num font-semibold', formatINR(lockedFee));

  const statusTd = mk('td');
  const pill = mk('span', 'pill ' + (isPaid ? 'up' : 'neutral'), isPaid ? 'Paid' : 'Unpaid');
  statusTd.appendChild(pill);
  if (isPaid && examTxn) {
    const sub = mk('div', 'pf-status-sub', `on ${formatDateIN(examTxn.paidOn || examTxn.date)}`);
    statusTd.appendChild(sub);
  }

  const actTd = mk('td', 'act');
  if (isPaid) {
    const receiptBtn = mk('button', 'ui-btn ghost sm pf-btn-receipt');
    receiptBtn.type = 'button';
    if (examTxn?.receiptNo) {
      receiptBtn.title = `Receipt: ${examTxn.receiptNo}`;
    }
    receiptBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
    receiptBtn.onclick = () => {
      const paymentId = examTxn?.id || 'latest';
      location.hash = `#/payments/${s.id}/${paymentId}/receipt?from=pay-fees`;
    };
    actTd.appendChild(receiptBtn);
  } else if (!allInstPaid) {
    // Cannot pay exam fee until all 4 installments are paid
    const hint = mk('span', 'pf-action-disabled', 'Pay all installments first');
    actTd.appendChild(hint);
  } else {
    // Can collect exam fee!
    const collectBtn = mk('button', 'ui-btn primary sm pf-btn-collect');
    collectBtn.type = 'button';
    collectBtn.innerHTML = '<i data-lucide="wallet"></i><span>Collect</span>';
    collectBtn.onclick = () => openPaymentPopup({
      student: currentStudent,
      profile: currentUserProfile,
      preselectedOption: 'EX',
      activeSession,
      payments: currentPayments,
      from: 'pay-fees',
      onSuccess: async () => {
        await loadStudents();
        const freshStudent = allStudentsCache.find(st => st.id === currentStudent?.id);
        if (freshStudent) {
          currentStudent = freshStudent;
        }
        currentPayments = await fetchStudentPayments(currentStudent.id);
        renderPaymentSummary();
        renderInstallmentScheduleTable();
        renderExamFeeSection();
      }
    });
    actTd.appendChild(collectBtn);
  }

  tr.append(headTd, sessTd, dueTd, amtTd, lateTd, totalTd, statusTd, actTd);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
}

/**
 * Handles starting exam fee collection for the active session (Part 2.4)
 */
async function handleStartExamFeeCollection() {
  const session = activeSession;
  if (!session) return;

  const confirmed = await confirmDialog({
    title: `Start Exam Fee Collection for ${session.name || 'this session'}`,
    message: 'Starting exam fee collection will lock the exam fee for all courses in this session at their current values. This cannot be undone. Continue?',
    confirmText: 'Lock & Start Collection',
    cancelText: 'Cancel',
    danger: false
  });

  if (!confirmed) return;

  try {
    // Build fees map: { <courseId>: course.fees.exam }
    const feesMap = {};
    youthCourses.forEach(c => {
      feesMap[c.id] = Number(c.fees?.exam || 0);
    });

    const authEmail = getAuthEmail();
    const sessionRef = doc(db, 'sessions', session.id);

    await updateDoc(sessionRef, {
      examFeeCollection: {
        started: true,
        startedAt: serverTimestamp(),
        startedBy: authEmail,
        fees: feesMap
      },
      updatedAt: serverTimestamp()
    });

    session.examFeeCollection = {
      started: true,
      startedBy: authEmail,
      fees: feesMap
    };

    showToast({ type: 'success', message: 'Exam fee collection started and fees locked for this session.' });
    updateExamFeeButtonDot();
    renderExamFeeSection();
    renderExamFeeManagementView();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    console.error('[pay-fees] handleStartExamFeeCollection error', e);
    showToast({ type: 'error', message: 'Failed to start exam fee collection: ' + (e.message || e) });
  }
}

/**
 * Updates status dot on top-right "Exam fee" button
 */
function updateExamFeeButtonDot() {
  const dot = $('pf-exam-dot');
  if (!dot) return;
  const isStarted = activeSession?.examFeeCollection?.started === true;
  dot.className = 'pf-status-dot ' + (isStarted ? 'dot-green' : 'dot-grey');
  dot.title = isStarted ? 'Exam fee collection active' : 'Exam fee collection not started';
}

/**
 * Toggles view to the dedicated Exam Fee Collection management panel
 */
function showExamFeeView() {
  const paymentsContainer = $('pf-payments-container');
  const examView = $('pf-exam-view');
  if (paymentsContainer) paymentsContainer.hidden = true;
  if (examView) examView.hidden = false;

  renderExamFeeManagementView();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Toggles view back to normal Payments & search view
 */
function showPaymentsView() {
  const paymentsContainer = $('pf-payments-container');
  const examView = $('pf-exam-view');
  if (examView) examView.hidden = true;
  if (paymentsContainer) paymentsContainer.hidden = false;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Renders the dedicated Exam Fee Collection management panel (Item 5)
 */
function renderExamFeeManagementView() {
  const session = activeSession;
  const isSuper = currentUserProfile && currentUserProfile.role === 'superadmin';
  const isStarted = session?.examFeeCollection?.started === true;
  const examWindow = examWindowOf(session);
  const today = todayISO();
  const canStart = !examWindow.from || today >= examWindow.from;

  updateExamFeeButtonDot();

  // Session titles
  const nameEl = $('pf-ev-session-name');
  if (nameEl) nameEl.textContent = session ? (session.name || session.id) : 'Active Session';
  const titleEl = $('pf-ev-session-title');
  if (titleEl) titleEl.textContent = session ? (session.name || session.id) : '—';

  // Status pill
  const pill = $('pf-ev-status-pill');
  if (pill) {
    pill.textContent = isStarted ? 'Started' : 'Not Started';
    pill.className = 'pill ' + (isStarted ? 'up' : 'neutral');
  }

  // Consistent date wording: "Available from <day after last due date>"
  const availEl = $('pf-ev-availability');
  if (availEl) {
    availEl.textContent = examWindow.from ? `Available from ${formatDateIN(examWindow.from)}` : 'Available from session end';
  }

  // Calculate students paid vs pending for active session
  const sessionStudents = allStudentsCache.filter(st => {
    if (!session) return false;
    return st.sessionId === session.id;
  });
  const paidCount = sessionStudents.filter(st => {
    return st.examPaid === true || (Array.isArray(st.payments) && st.payments.some(p => p.type === 'EX'));
  }).length;
  const pendingCount = Math.max(0, sessionStudents.length - paidCount);

  const paidEl = $('pf-ev-stats-paid');
  if (paidEl) paidEl.textContent = String(paidCount);
  const pendingEl = $('pf-ev-stats-pending');
  if (pendingEl) pendingEl.textContent = String(pendingCount);

  // Started metadata
  const metaLine = $('pf-ev-started-meta');
  if (metaLine) {
    if (isStarted) {
      metaLine.hidden = false;
      const startedAtStr = formatAnyDate(session?.examFeeCollection?.startedAt) || (examWindow.from ? formatDateIN(examWindow.from) : 'Recently');
      const startedByStr = session?.examFeeCollection?.startedBy || 'Super Admin';
      metaLine.innerHTML = `<i data-lucide="check-circle" class="text-success"></i><span>Collection started on <strong>${startedAtStr}</strong> by <strong>${startedByStr}</strong>. Locked fees apply to all students.</span>`;
    } else {
      metaLine.hidden = true;
      metaLine.textContent = '';
    }
  }

  // Actions area
  const actionsArea = $('pf-ev-actions');
  if (actionsArea) {
    actionsArea.textContent = '';
    if (isSuper) {
      if (!isStarted) {
        const startBtn = mk('button', 'ui-btn primary sm');
        startBtn.type = 'button';
        if (canStart) {
          startBtn.innerHTML = '<i data-lucide="play-circle"></i><span>Start Exam Fee Collection</span>';
          startBtn.onclick = () => handleStartExamFeeCollection();
        } else {
          startBtn.disabled = true;
          startBtn.style.opacity = '0.65';
          startBtn.style.cursor = 'not-allowed';
          const availText = examWindow.from ? formatDateIN(examWindow.from) : 'end of session';
          startBtn.innerHTML = `<i data-lucide="lock"></i><span>Available from ${availText}</span>`;
        }
        actionsArea.appendChild(startBtn);
      } else {
        const badge = mk('span', 'pill up', 'Collection Active');
        actionsArea.appendChild(badge);
      }
    }
  }

  // Courses Table
  const tbody = $('pf-ev-courses-tbody');
  if (tbody) {
    tbody.textContent = '';
    const hintEl = $('pf-ev-lock-hint');
    if (hintEl) {
      hintEl.textContent = isStarted ? 'Fees locked for this session' : 'Super Admin can edit fees before collection starts';
    }

    youthCourses.forEach(c => {
      const tr = mk('tr');
      const codeTd = mk('td', 'font-semibold font-mono', c.code || c.courseCode || '-');
      const nameTd = mk('td', '', c.name || '-');
      const levelTd = mk('td', '', c.level ? `Sem ${c.level}` : '-');

      const feeAmount = isStarted
        ? Number(session?.examFeeCollection?.fees?.[c.id] ?? c.fees?.exam ?? 0)
        : Number(c.fees?.exam ?? 0);

      const feeTd = mk('td', 'num font-semibold');
      const statusTd = mk('td');
      const actTd = mk('td', 'adm-actions');

      if (isStarted) {
        feeTd.textContent = formatINR(feeAmount);
        statusTd.innerHTML = '<span class="pill up"><i data-lucide="lock"></i> Locked</span>';
        actTd.innerHTML = '<span class="text-xs text-mute">—</span>';
      } else if (isSuper) {
        // Editable for Super Admin until started
        feeTd.textContent = formatINR(feeAmount);
        statusTd.innerHTML = '<span class="pill warn">Editable</span>';

        const editBtn = mk('button', 'ui-btn ghost sm');
        editBtn.type = 'button';
        editBtn.innerHTML = '<i data-lucide="edit-2"></i><span>Edit</span>';
        editBtn.onclick = () => {
          feeTd.textContent = '';
          const inp = mk('input', 'pf-fee-edit-input');
          inp.type = 'number';
          inp.min = '0';
          inp.step = '10';
          inp.value = feeAmount;

          const saveBtn = mk('button', 'ui-btn primary sm');
          saveBtn.type = 'button';
          saveBtn.textContent = 'Save';
          saveBtn.onclick = async () => {
            const newFee = Number(inp.value || 0);
            try {
              await updateDoc(doc(db, 'courses', c.id), {
                'fees.exam': newFee,
                updatedAt: serverTimestamp()
              });
              c.fees = c.fees || {};
              c.fees.exam = newFee;
              showToast({ type: 'success', message: `Exam fee updated for ${c.code || c.name}` });
              renderExamFeeManagementView();
            } catch (err) {
              console.error('[pay-fees] update course exam fee failed', err);
              showToast({ type: 'error', message: 'Failed to update exam fee: ' + (err.message || err) });
            }
          };

          const cancelBtn = mk('button', 'ui-btn ghost sm');
          cancelBtn.type = 'button';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.onclick = () => renderExamFeeManagementView();

          feeTd.appendChild(inp);
          actTd.textContent = '';
          actTd.append(saveBtn, cancelBtn);
          inp.focus();
        };
        actTd.appendChild(editBtn);
      } else {
        // Branch Head: read-only
        feeTd.textContent = formatINR(feeAmount);
        statusTd.innerHTML = '<span class="pill neutral">Configured</span>';
        actTd.innerHTML = '<span class="text-xs text-mute">Read-only</span>';
      }

      tr.append(codeTd, nameTd, levelTd, feeTd, statusTd, actTd);
      tbody.appendChild(tr);
    });
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}
