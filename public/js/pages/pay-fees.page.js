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
import { createSelect } from '../components/ui-select.js?v=1.8.101';
import { openPopup } from '../components/modal.js?v=1.8.101';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.101';
import { showToast } from '../components/toast.js?v=1.8.101';
import { getSelectedSessionId, getCachedSessions } from '../core/sessions.js?v=1.8.101';
import { todayISO, fmtDate, examWindowOf } from '../utils/session-rules.js?v=1.8.101';
import {
  calculateLateFee,
  fetchStudentPayments,
  isInstallmentPaid,
  isExamFeePaid,
  recordPaymentTx
} from '../services/payment.service.js?v=1.8.101';

let currentUserProfile = null;
let currentCtx = 'youth';
let activeSession = null;
let youthCourses = [];
let allStudentsCache = [];
let currentStudent = null;
let currentPayments = [];
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

function bindEvents() {
  const searchInput = $('pf-search-input');
  const searchBtn = $('pf-search-btn');
  const clearBtn = $('pf-search-clear');

  if (searchInput) {
    searchInput.oninput = () => {
      if (clearBtn) clearBtn.hidden = !searchInput.value.trim();
    };

    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch();
      }
    };
  }

  if (searchBtn) {
    searchBtn.onclick = () => executeSearch();
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearBtn.hidden = true;
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

    // Avatar
    const avatar = mk('div', 'pf-choice-avatar');
    if (st.photoUrl) {
      const img = document.createElement('img');
      img.src = st.photoUrl;
      img.alt = st.name || '';
      avatar.appendChild(img);
    } else {
      const initials = (st.name || 'ST').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      avatar.textContent = initials;
    }

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

  // Photo / Initials
  const avatarText = $('pf-avatar-text');
  const avatarImg = $('pf-avatar-img');
  if (student.photoUrl) {
    avatarImg.src = student.photoUrl;
    avatarImg.hidden = false;
    avatarText.hidden = true;
  } else {
    avatarImg.hidden = true;
    avatarText.hidden = false;
    const initials = (student.name || 'ST').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    avatarText.textContent = initials;
  }

  // Load payments
  currentPayments = await fetchStudentPayments(student.id);

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

  const total = Number(s.feeTotal || 0);
  const paid = Number(s.paidAmount ?? s.totalPaid ?? 0);
  const outstanding = Math.max(0, total - paid);

  // Calculate late fee as of today for all overdue unpaid installments
  let totalLateFeeToday = 0;
  const sched = s.feeSchedule || [];
  const today = todayISO();

  sched.forEach(it => {
    if (!isInstallmentPaid(it, currentPayments, s)) {
      if (today > it.due) {
        totalLateFeeToday += calculateLateFee(it.due, today);
      }
    }
  });

  $('pf-m-total').textContent = formatINR(total);
  $('pf-m-paid').textContent = formatINR(paid);
  $('pf-m-outstanding').textContent = formatINR(outstanding);
  $('pf-m-latefee').textContent = formatINR(totalLateFeeToday);

  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
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
    const pill = mk('span', statusClass, statusLabel);
    statusTd.appendChild(pill);
    if (isPaid && paidRec) {
      const sub = mk('div', 'text-xs text-mute mt-1', `${paidRec.receiptNo || ''} (${formatDateIN(paidRec.paidOn || paidRec.date)})`);
      statusTd.appendChild(sub);
    }

    // Action column with sequential payment check
    const actTd = mk('td', 'act');

    if (isPaid) {
      const receiptBtn = mk('button', 'ui-btn ghost sm pf-btn-receipt');
      receiptBtn.type = 'button';
      receiptBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
      receiptBtn.onclick = () => {
        const paymentId = paidRec?.id || 'latest';
        location.hash = `#/payments/${s.id}/${paymentId}/receipt`;
      };
      actTd.appendChild(receiptBtn);
    } else if (!foundOldestUnpaid) {
      // This is the OLDEST unpaid installment -> CAN COLLECT!
      foundOldestUnpaid = true;
      const collectBtn = mk('button', 'ui-btn primary sm pf-btn-collect');
      collectBtn.type = 'button';
      collectBtn.innerHTML = '<i data-lucide="wallet"></i><span>Collect</span>';
      collectBtn.onclick = () => openCollectPaymentModal({
        type: 'IN',
        installmentNo: itNo,
        month: it.month,
        due: it.due,
        amount: schedAmt,
        lateFee: lateFine,
        title: `Collect Installment ${itNo} (${it.month})`
      });
      actTd.appendChild(collectBtn);
    } else {
      // Later unpaid installment -> DISABLED
      tr.classList.add('pf-row-locked');
      const hint = mk('span', 'pf-action-disabled', 'Pay previous first');
      actTd.appendChild(hint);
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
  const session = activeSession;
  const examCollectionStarted = session?.examFeeCollection?.started === true;
  const examWindow = examWindowOf(session);
  const today = todayISO();

  // If exam fee collection is NOT started
  if (!examCollectionStarted) {
    const banner = mk('div', 'pf-exam-banner');
    const left = mk('div', 'pf-exam-banner-left');
    left.innerHTML = `<div class="pf-exam-banner-icon"><i data-lucide="lock"></i></div>
      <div>
        <div class="pf-exam-banner-title">Exam Fee Collection Not Started</div>
        <div class="pf-exam-banner-sub">Exam fee collection for ${session?.name || 'this session'} has not started yet. Opens on ${formatDateIN(examWindow.from)}.</div>
      </div>`;
    banner.appendChild(left);

    // If Super Admin and today >= examWindow.from, allow starting exam fee collection
    if (isSuper) {
      const canStart = !examWindow.from || today >= examWindow.from;
      if (canStart) {
        const startBtn = mk('button', 'ui-btn primary sm');
        startBtn.type = 'button';
        startBtn.innerHTML = '<i data-lucide="play-circle"></i><span>Start Exam Fee Collection</span>';
        startBtn.onclick = () => handleStartExamFeeCollection();
        banner.appendChild(startBtn);
      }
    }

    container.appendChild(banner);
    return;
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

  const lockedFee = session.examFeeCollection?.fees?.[s.courseId] ?? examFee;
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
    const sub = mk('div', 'text-xs text-mute mt-1', `${examTxn.receiptNo || ''} (${formatDateIN(examTxn.paidOn || examTxn.date)})`);
    statusTd.appendChild(sub);
  }

  const actTd = mk('td', 'act');
  if (isPaid) {
    const receiptBtn = mk('button', 'ui-btn ghost sm pf-btn-receipt');
    receiptBtn.type = 'button';
    receiptBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
    receiptBtn.onclick = () => {
      const paymentId = examTxn?.id || 'latest';
      location.hash = `#/payments/${s.id}/${paymentId}/receipt`;
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
    collectBtn.onclick = () => openCollectPaymentModal({
      type: 'EX',
      amount: lockedFee,
      lateFee: 0,
      title: 'Collect Board Examination Fee'
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
    renderExamFeeSection();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (e) {
    console.error('[pay-fees] handleStartExamFeeCollection error', e);
    showToast({ type: 'error', message: 'Failed to start exam fee collection: ' + (e.message || e) });
  }
}

/**
 * Opens Collect Payment Popup (Part 2.3)
 */
function openCollectPaymentModal({ type, installmentNo, month, due, amount, lateFee, title }) {
  const s = currentStudent;
  if (!s) return;

  const isSuper = currentUserProfile && currentUserProfile.role === 'superadmin';
  const popup = openPopup({
    title: title || 'Record Fee Payment',
    subtitle: `${s.name} • ID: ${s.studentId}`,
    icon: 'wallet'
  });

  const form = mk('div', 'pf-modal-form');

  // Summary box showing read-only figures
  const summaryBox = mk('div', 'pf-calc-summary-box');
  summaryBox.innerHTML = `
    <div class="pf-calc-cell">
      <span class="pf-calc-label">Base Fee</span>
      <span class="pf-calc-val" id="pf-f-base">${formatINR(amount)}</span>
    </div>
    <div class="pf-calc-cell">
      <span class="pf-calc-label">Late Fee</span>
      <span class="pf-calc-val ${lateFee > 0 ? 'text-danger' : ''}" id="pf-f-late">${formatINR(lateFee)}</span>
    </div>
    <div class="pf-calc-cell total">
      <span class="pf-calc-label">Total Payable</span>
      <span class="pf-calc-val" id="pf-f-total">${formatINR(amount + lateFee)}</span>
    </div>
  `;
  form.appendChild(summaryBox);

  // Waive Late Fee option (Super Admin only, and only if lateFee > 0)
  let waiveCheckbox = null;
  let waiveReasonInput = null;
  let waiveGroup = null;

  if (isSuper && lateFee > 0) {
    waiveGroup = mk('div', 'pf-waive-box');
    const label = document.createElement('label');
    waiveCheckbox = document.createElement('input');
    waiveCheckbox.type = 'checkbox';
    label.append(waiveCheckbox, document.createTextNode('Waive late fee fine (Super Admin)'));
    waiveGroup.appendChild(label);

    const reasonWrap = mk('div', 'ui-field mt-2');
    reasonWrap.hidden = true;
    reasonWrap.innerHTML = '<div class="ui-label-row"><label class="ui-label">Waiver Reason <span class="text-danger">*</span></label></div>';
    const reasonInputWrap = mk('div', 'ui-input-wrap');
    waiveReasonInput = document.createElement('input');
    waiveReasonInput.type = 'text';
    waiveReasonInput.className = 'ui-input';
    waiveReasonInput.placeholder = 'Provide reason for waiving late fine...';
    reasonInputWrap.appendChild(waiveReasonInput);
    reasonWrap.appendChild(reasonInputWrap);
    waiveGroup.appendChild(reasonWrap);

    waiveCheckbox.onchange = () => {
      reasonWrap.hidden = !waiveCheckbox.checked;
      if (waiveCheckbox.checked) {
        $('pf-f-late').textContent = 'Rs. 0.00 (Waived)';
        $('pf-f-total').textContent = formatINR(amount);
      } else {
        $('pf-f-late').textContent = formatINR(lateFee);
        $('pf-f-total').textContent = formatINR(amount + lateFee);
      }
    };

    form.appendChild(waiveGroup);
  }

  // Row with Payment Mode & Txn ID
  const modeTxnRow = mk('div', 'pf-modal-row-2');

  const modeGroup = mk('div', 'ui-field');
  modeGroup.innerHTML = '<div class="ui-label-row"><label class="ui-label">Payment Mode <span class="text-danger">*</span></label></div>';
  const modeHost = mk('div');
  modeGroup.appendChild(modeHost);

  const txnGroup = mk('div', 'ui-field');
  txnGroup.innerHTML = '<div class="ui-label-row"><label class="ui-label">Transaction / Reference ID <span class="text-danger" id="pf-f-txn-req" hidden>*</span></label></div>';
  const txnWrap = mk('div', 'ui-input-wrap');
  const txnInput = document.createElement('input');
  txnInput.type = 'text';
  txnInput.className = 'ui-input';
  txnInput.placeholder = 'Optional for cash';
  txnWrap.appendChild(txnInput);
  txnGroup.appendChild(txnWrap);

  const modeOptions = [
    { value: 'cash', label: 'Cash', icon: 'banknote' },
    { value: 'upi', label: 'UPI / QR', icon: 'smartphone' },
    { value: 'card', label: 'Debit / Credit Card', icon: 'credit-card' },
    { value: 'bank', label: 'Bank Transfer (NEFT/IMPS)', icon: 'landmark' },
    { value: 'cheque', label: 'Cheque / Draft', icon: 'file-text' }
  ];

  const modeSel = createSelect(modeHost, {
    options: modeOptions,
    value: 'cash',
    ariaLabel: 'Payment Mode',
    onChange: (val) => {
      const mode = (val && val.value !== undefined) ? val.value : modeSel.value;
      const isCash = mode === 'cash';
      const reqStar = $('pf-f-txn-req');
      if (reqStar) reqStar.hidden = isCash;
      if (isCash) {
        txnInput.placeholder = 'Optional for cash';
      } else {
        txnInput.placeholder = `Required for ${mode.toUpperCase()}`;
      }
    }
  });

  modeTxnRow.append(modeGroup, txnGroup);
  form.appendChild(modeTxnRow);

  // Payment Date & Remarks
  const dateGroup = mk('div', 'ui-field');
  dateGroup.innerHTML = '<div class="ui-label-row"><label class="ui-label">Payment Date <span class="text-danger">*</span></label></div>';
  const dateWrap = mk('div', 'ui-input-wrap');
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'ui-input';
  dateInput.value = todayISO();
  dateWrap.appendChild(dateInput);
  dateGroup.appendChild(dateWrap);

  const remGroup = mk('div', 'ui-field');
  remGroup.innerHTML = '<div class="ui-label-row"><label class="ui-label">Remarks / Note</label></div>';
  const remWrap = mk('div', 'ui-input-wrap');
  const remInput = document.createElement('textarea');
  remInput.className = 'ui-input';
  remInput.rows = 2;
  remInput.placeholder = 'Optional transaction notes...';
  remWrap.appendChild(remInput);
  remGroup.appendChild(remWrap);

  form.append(dateGroup, remGroup);

  // Modal Footer
  const foot = mk('div', 'adm-view-foot');
  const cancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.onclick = () => popup.close();

  const saveBtn = mk('button', 'ui-btn primary', 'Confirm & Record Payment');
  saveBtn.type = 'button';

  foot.append(cancelBtn, saveBtn);
  form.appendChild(foot);
  popup.container.appendChild(form);

  if (typeof lucide !== 'undefined') lucide.createIcons();

  // Save handler with validation and atomic transaction
  saveBtn.onclick = async () => {
    const mode = modeSel.value;
    const isCash = mode === 'cash';
    const txnVal = txnInput.value.trim();
    const isWaived = waiveCheckbox ? waiveCheckbox.checked : false;
    const waiverReason = waiveReasonInput ? waiveReasonInput.value.trim() : '';

    if (!isCash && !txnVal) {
      showToast({ type: 'error', message: 'Transaction / reference number is required for non-cash payment.' });
      txnInput.focus();
      return;
    }

    if (isWaived && !waiverReason) {
      showToast({ type: 'error', message: 'Waiver reason is required when late fee is waived.' });
      waiveReasonInput.focus();
      return;
    }

    // Disable button to prevent double submission
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Processing...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
      const authEmail = getAuthEmail();
      const res = await runTransaction(db, async (tx) => {
        return await recordPaymentTx(tx, {
          studentDoc: s,
          type,
          installmentNo: type === 'IN' ? installmentNo : null,
          month: month || '',
          amount,
          lateFeeAmount: isWaived ? 0 : lateFee,
          mode,
          txnId: txnVal,
          remarks: remInput.value.trim(),
          waived: isWaived,
          waiverReason,
          paymentDate: dateInput.value || todayISO(),
          userEmail: authEmail,
          userName: currentUserProfile.name || '',
          userRole: currentUserProfile.role,
          branchId: currentUserProfile.branchId || s.branchId,
          branchCode: s.branchCode || '',
          branchName: s.branchName
        });
      });

      popup.close();
      showToast({ type: 'success', message: 'Payment recorded: ' + res.receiptNo });

      // Refresh student panel & cache
      await loadStudents();
      const freshStudent = allStudentsCache.find(st => st.id === s.id);
      if (freshStudent) {
        currentStudent = freshStudent;
      }
      currentPayments = await fetchStudentPayments(s.id);
      renderPaymentSummary();
      renderInstallmentScheduleTable();
      renderExamFeeSection();

      // Show receipt view confirmation
      promptOpenReceipt(res.studentDocId, res.paymentId, res.receiptNo);
    } catch (err) {
      console.error('[pay-fees] payment transaction failed', err);
      showToast({ type: 'error', message: 'Payment failed: ' + (err.message || 'Transaction error') });
      saveBtn.disabled = false;
      saveBtn.textContent = 'Confirm & Record Payment';
    }
  };
}

/**
 * Prompts user to view receipt immediately
 */
function promptOpenReceipt(studentDocId, paymentId, receiptNo) {
  const receiptHash = `#/payments/${studentDocId}/${paymentId}/receipt`;
  const confirmPopup = openPopup({
    title: 'Payment Receipt Ready',
    subtitle: `Receipt No: ${receiptNo}`,
    icon: 'check-circle'
  });

  const body = mk('div', 'p-4 text-center');
  body.innerHTML = `
    <p style="font-size:14.5px; margin-bottom:18px;">Payment successfully collected and recorded with receipt <strong>${receiptNo}</strong>.</p>
    <div style="display:flex; justify-content:center; gap:12px;">
      <button type="button" id="pf-rec-stay" class="ui-btn ghost">Stay on page</button>
      <button type="button" id="pf-rec-open" class="ui-btn primary"><i data-lucide="receipt"></i> Open Receipt</button>
    </div>
  `;
  confirmPopup.container.appendChild(body);

  const stayBtn = document.getElementById('pf-rec-stay');
  const openBtn = document.getElementById('pf-rec-open');

  if (stayBtn) stayBtn.onclick = () => confirmPopup.close();
  if (openBtn) {
    openBtn.onclick = () => {
      confirmPopup.close();
      location.hash = receiptHash;
    };
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}
