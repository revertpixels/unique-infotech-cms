// student-profile.page.js — Student Profile matching Admission Receipt Design System (v1.8.99)
import { auth, db } from '../config/firebase-config.js';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.194';
import { openPopup } from '../components/modal.js?v=1.8.194';
import { createSelect } from '../components/ui-select.js?v=1.8.194';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.194';
import { openMenu } from '../components/ui-menu.js?v=1.8.194';
import { formatINR, formatDateIN, formatPersonName, formatGenderDisplay, initials } from '../utils/formatter.js?v=1.8.194';
import { validatePhone, validateEmail, validateDOB, validateName } from '../utils/validator.js?v=1.8.194';
import { registerDirty } from '../utils/unsaved-guard.js?v=1.8.194';
import { resolveUserDisplay, getRoleTitle, loadUsersDirectory } from '../services/user-directory.service.js?v=1.8.194';
import { compressTo100KB, blobToDataURL, isImageFile, formatBytes } from '../utils/image-compress.js?v=1.8.194';
import { getStudentPhotoSrc, getStudentDocRecord, getStudentDocSrc, getStudentDocMime } from '../utils/student-media.js?v=1.8.194';
import { todayISO } from '../utils/session-rules.js?v=1.8.194';
import { getSelectedSessionId } from '../core/sessions.js?v=1.8.194';
import { openPaymentPopup } from '../components/payment-popup.js?v=1.8.194';
import {
  fetchStudentPayments,
  recordPaymentTx,
  logStudentActivity,
  calculateLateFee,
  courseFeeWithoutExam,
  courseBalanceWithoutExam,
  calculateStudentFinancials,
  buildReceiptMenuItems,
  repairStudentAdmissionPayment
} from '../services/payment.service.js?v=1.8.194';
import { courseFeeOf, discountOf } from '../utils/fees.js?v=1.8.194';

const COL = 'students';
const QUALIFICATIONS = ['VIII Pass', 'Secondary (X) Pass', 'Higher Secondary (XII) Pass', 'ITI', 'Diploma', 'Undergraduate (Graduate)', 'Postgraduate', 'Other'];
const DOC_KEYS = [
  { key: 'dobProof', label: 'Date of Birth Proof', icon: 'calendar' },
  { key: 'marksheet', label: 'Academic Marksheet', icon: 'file-text' },
  { key: 'photo', label: 'Passport Photo', icon: 'image' },
  { key: 'signature', label: 'Student Signature', icon: 'pen-tool' }
];

let currentUserProfile = null;
let currentCtx = 'youth';
let currentStudent = null;
let sessionDocsList = [];
let activeTab = 'personal';
let docsCache = {};
let paymentsCache = [];
let branchesCache = null;
let usersCache = null;
let coursesCache = null;
let sessionsCache = null;
let batchesCache = null;
let unregisterDirtyFn = null;

async function getMyBranchId() {
  if (currentUserProfile && currentUserProfile.branchId) {
    return currentUserProfile.branchId;
  }
  try {
    const em = getAuthEmail();
    if (em) {
      const uSnap = await getDoc(doc(db, 'users', em));
      if (uSnap.exists()) {
        const u = uSnap.data();
        if (u.branchId) {
          if (currentUserProfile) currentUserProfile.branchId = u.branchId;
          return u.branchId;
        }
      }
    }
  } catch (_) {}
  return null;
}

async function ensureMetadataCache() {
  if (branchesCache && usersCache && coursesCache && sessionsCache) return;
  try {
    const isSuper = currentUserProfile && currentUserProfile.role === 'superadmin';
    const isHead = currentUserProfile && currentUserProfile.role === 'branch_head';
    let myBranch = currentUserProfile && currentUserProfile.branchId;
    if (!myBranch && isHead) {
      myBranch = await getMyBranchId();
    }

    const [bSnap, uSnap, cSnap, sSnap, btSnap] = await Promise.all([
      branchesCache ? null : (isSuper ? getDocs(collection(db, 'branches')).catch(() => null) : (myBranch ? getDoc(doc(db, 'branches', myBranch)).catch(() => null) : null)),
      usersCache ? null : getDocs(collection(db, 'users')).catch(() => null),
      coursesCache ? null : getDocs(collection(db, 'courses')).catch(() => null),
      sessionsCache ? null : getDocs(collection(db, 'sessions')).catch(() => null),
      batchesCache ? null : getDocs(collection(db, 'batches')).catch(() => null),
      loadUsersDirectory({ forceRefresh: false }).catch(() => null)
    ]);
    if (!branchesCache) branchesCache = {};
    if (bSnap) {
      if (bSnap.docs) {
        bSnap.docs.forEach(d => {
          branchesCache[d.id] = { id: d.id, ...d.data() };
        });
      } else if (bSnap.exists && bSnap.exists()) {
        branchesCache[bSnap.id] = { id: bSnap.id, ...bSnap.data() };
      }
    }
    if (window.APP_CACHE && Array.isArray(window.APP_CACHE.branches)) {
      window.APP_CACHE.branches.forEach(b => {
        if (b && b.id && !branchesCache[b.id]) {
          branchesCache[b.id] = b;
        }
      });
    }

    if (!usersCache) usersCache = { byEmail: {}, byBranch: {} };
    if (uSnap && uSnap.docs) {
      uSnap.docs.forEach(d => {
        const u = d.data();
        const em = (u.email || d.id || '').toLowerCase().trim();
        const item = { id: d.id, name: u.name || '', designation: u.designation || '', email: em, role: u.role || '', branchId: u.branchId || '' };
        if (em) usersCache.byEmail[em] = item;
        if (u.branchId && (u.role === 'branch_head' || !usersCache.byBranch[u.branchId])) {
          usersCache.byBranch[u.branchId] = item;
        }
      });
    }
    if (currentUserProfile && currentUserProfile.email) {
      const em = currentUserProfile.email.toLowerCase().trim();
      const item = {
        id: em,
        name: currentUserProfile.name || '',
        designation: currentUserProfile.designation || '',
        email: em,
        role: currentUserProfile.role || '',
        branchId: currentUserProfile.branchId || ''
      };
      if (!usersCache.byEmail[em]) usersCache.byEmail[em] = item;
      if (currentUserProfile.branchId && !usersCache.byBranch[currentUserProfile.branchId]) {
        usersCache.byBranch[currentUserProfile.branchId] = item;
      }
    }

    if (cSnap && cSnap.docs) {
      coursesCache = { byId: {}, byCode: {} };
      cSnap.docs.forEach(d => {
        const c = { id: d.id, ...d.data() };
        coursesCache.byId[d.id] = c;
        const code = (c.code || c.courseCode || '').toUpperCase().trim();
        if (code) coursesCache.byCode[code] = c;
      });
    } else if (!coursesCache) {
      coursesCache = { byId: {}, byCode: {} };
    }

    if (sSnap && sSnap.docs) {
      sessionsCache = { byId: {}, byName: {} };
      sSnap.docs.forEach(d => {
        const sess = { id: d.id, ...d.data() };
        sessionsCache.byId[d.id] = sess;
        const nameKey = (sess.name || '').toLowerCase().trim();
        if (nameKey) sessionsCache.byName[nameKey] = sess;
      });
    } else if (!sessionsCache) {
      sessionsCache = { byId: {}, byName: {} };
    }

    if (btSnap && btSnap.docs) {
      batchesCache = { byId: {} };
      btSnap.docs.forEach(d => {
        batchesCache[d.id] = { id: d.id, ...d.data() };
      });
    } else if (!batchesCache) {
      batchesCache = { byId: {} };
    }
  } catch (err) {
    console.warn('[student-profile] ensureMetadataCache error:', err);
  }
}

function formatBranchDisplay(name, code) {
  if (!name && !code) return 'HO';
  let abbr = '';
  if (name) {
    const cleaned = name.trim();
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      abbr = words.map(w => w[0].toUpperCase()).join('');
    } else {
      abbr = cleaned;
    }
  }
  const mainPart = abbr || name || code || 'Branch';
  const c = (code || '').trim();
  if (c && c.toUpperCase() !== mainPart.toUpperCase()) {
    return `${mainPart} (${c})`;
  }
  return mainPart;
}

function setTxt(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function $(id) {
  return document.getElementById(id);
}

function mk(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function getAuthEmail() {
  if (auth && auth.currentUser && auth.currentUser.email) {
    return auth.currentUser.email.toLowerCase();
  }
  return (currentUserProfile && currentUserProfile.email ? currentUserProfile.email : '').toLowerCase();
}

export async function mount({ container, profile, ctx }) {
  currentUserProfile = profile || {};
  currentCtx = ctx || 'youth';

  // Parse location.hash: #/students/<id>?tab=<tabName>
  const hash = location.hash;
  const match = hash.match(/#\/students\/([^?#]+)(?:\?tab=([a-z-]+))?/);
  const routeParam = match ? match[1] : '';
  const initialTab = (match && match[2]) || 'personal';

  if (!routeParam) {
    showError('Invalid student ID', 'No student identifier was provided in the URL.');
    return;
  }

  showLoading(true);
  initTabListeners();
  await ensureMetadataCache();

  try {
    const student = await resolveStudent(routeParam);
    if (!student) {
      showError('Student not found', 'Could not locate any student with identifier: ' + routeParam);
      return;
    }

    // Role verification
    const isSuper = currentUserProfile.role === 'superadmin';
    const isHead = currentUserProfile.role === 'branch_head';
    let myBranch = currentUserProfile.branchId;
    if (!myBranch && isHead) {
      myBranch = await getMyBranchId();
    }
    if (!isSuper && isHead && myBranch && student.branchId && student.branchId !== myBranch) {
      showError('Access restricted', 'You only have permission to view students in your assigned branch.');
      return;
    }

    currentStudent = student;
    await renderProfile(initialTab);
  } catch (err) {
    console.error('[student-profile] mount failed', err);
    showError('Error loading student', err.message || 'An unexpected error occurred.');
  } finally {
    showLoading(false);
  }
}

export function unmount() {
  if (unregisterDirtyFn) {
    unregisterDirtyFn();
    unregisterDirtyFn = null;
  }
  currentStudent = null;
  sessionDocsList = [];
  docsCache = {};
  paymentsCache = [];
}

function showLoading(show) {
  const loading = $('sp-loading');
  const content = $('sp-content');
  const error = $('sp-error');
  if (loading) loading.hidden = !show;
  if (content && show) content.hidden = true;
  if (error && show) error.hidden = true;
}

function showError(title, desc) {
  const loading = $('sp-loading');
  const content = $('sp-content');
  const error = $('sp-error');
  if (loading) loading.hidden = true;
  if (content) content.hidden = true;
  if (error) {
    error.hidden = false;
    const t = $('sp-error-title');
    const d = $('sp-error-desc');
    if (t) t.textContent = title;
    if (d) d.textContent = desc;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

/**
 * Resolves student by Firestore docId or studentId.
 */
async function resolveStudent(param) {
  const isSuper = currentUserProfile && currentUserProfile.role === 'superadmin';
  const isHead = currentUserProfile && currentUserProfile.role === 'branch_head';
  let bId = currentUserProfile && currentUserProfile.branchId;
  if (!bId && isHead) {
    bId = await getMyBranchId();
  }

  // 1. Try directly as doc ID
  try {
    const docSnap = await getDoc(doc(db, COL, param));
    if (docSnap.exists()) {
      const data = Object.assign({ id: docSnap.id }, docSnap.data());
      if (isHead && bId && data.branchId && data.branchId !== bId) {
        return null;
      }
      if (data.studentId) {
        await loadSessionDocs(data.studentId);
      }
      return data;
    }
  } catch (_) { /* fallback to query by studentId */ }

  // 2. Query by studentId
  try {
    const constraints = [where('studentId', '==', param)];
    if (!isSuper && isHead && bId) {
      constraints.push(where('branchId', '==', bId));
    }
    const q = query(collection(db, COL), ...constraints);
    const snap = await getDocs(q);
    if (snap.empty) return null;

    sessionDocsList = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));

    // Prioritize active topbar session, else latest
    const topbarSessionId = getSelectedSessionId();
    if (topbarSessionId) {
      const matchSession = sessionDocsList.find(s => s.sessionId === topbarSessionId);
      if (matchSession) return matchSession;
    }

    sessionDocsList.sort((a, b) => {
      const da = a.admissionDate || '';
      const dbDate = b.admissionDate || '';
      return dbDate.localeCompare(da);
    });

    return sessionDocsList[0];
  } catch (err) {
    console.error('[student-profile] resolveStudent query error:', err);
    throw err;
  }
}

async function loadSessionDocs(studentId) {
  try {
    const isSuper = currentUserProfile && currentUserProfile.role === 'superadmin';
    const isHead = currentUserProfile && currentUserProfile.role === 'branch_head';
    let bId = currentUserProfile && currentUserProfile.branchId;
    if (!bId && isHead) {
      bId = await getMyBranchId();
    }

    const constraints = [where('studentId', '==', studentId)];
    if (!isSuper && isHead && bId) {
      constraints.push(where('branchId', '==', bId));
    }
    const q = query(collection(db, COL), ...constraints);
    const snap = await getDocs(q);
    sessionDocsList = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
  } catch (_) {
    sessionDocsList = currentStudent ? [currentStudent] : [];
  }
}

/**
 * Main Profile Render
 */
async function renderProfile(tabName) {
  const content = $('sp-content');
  if (content) content.hidden = false;

  await Promise.all([
    loadDocs(),
    loadPayments()
  ]);

  renderHeader();
  renderMetrics();

  switchTab(tabName || activeTab || 'personal');
}

/**
 * Robust Clipboard copy with document.execCommand fallback
 */
async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    /* fallback to execCommand below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, 99999);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (err) {
    console.error('[student-profile] copyText failed', err);
    return false;
  }
}

/**
 * Render Header
 */
function renderHeader() {
  const s = currentStudent;
  if (!s) return;

  setTxt('sp-name', formatPersonName(s.name || '') || '-');
  setTxt('sp-student-id', s.studentId || s.id || '-');

  // Copy Student ID handler (chip & icon)
  const chipEl = $('sp-id-chip');
  const copyBtn = $('sp-copy-id-btn');

  const doCopy = async (ev) => {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    const idVal = s.studentId || s.id || $('sp-student-id')?.textContent?.trim() || '';
    if (!idVal || idVal === '-') return;

    const ok = await copyText(idVal);
    if (ok) {
      showToast({ type: 'success', message: 'Copied Student ID: ' + idVal });
      if (copyBtn) {
        copyBtn.innerHTML = '<i data-lucide="check" width="14" height="14" style="color:#16A34A;"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
        setTimeout(() => {
          if (copyBtn) {
            copyBtn.innerHTML = '<i data-lucide="copy" width="14" height="14"></i>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
          }
        }, 1500);
      }
    } else {
      showToast({ type: 'warning', message: 'Student ID: ' + idVal });
    }
  };

  if (copyBtn) copyBtn.onclick = doCopy;
  if (chipEl) chipEl.onclick = doCopy;

  // Status badge matching AI image (.sp-status-badge with dot)
  const statusEl = $('sp-status');
  const statusTxt = $('sp-status-text');
  const rawStatus = (s.status || 'active').toLowerCase();
  const isOk = rawStatus === 'running' || rawStatus === 'active' || rawStatus === 'completed' || rawStatus === 'passed';
  const isDrop = rawStatus === 'dropped' || rawStatus === 'inactive' || rawStatus === 'deleted';
  const pillCls = isOk ? 'active' : (isDrop ? 'dropped' : 'neutral');
  if (statusEl) {
    statusEl.className = 'sp-status-badge ' + pillCls;
  }
  if (statusTxt) {
    statusTxt.textContent = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);
  }

  // Meta items
  setTxt('sp-course-text', (s.courseCode ? s.courseCode + ' — ' : '') + (s.courseName || '-'));
  setTxt('sp-batch-text', s.batchName || 'General Batch');
  setTxt('sp-session-text', s.sessionName || 'Session');
  setTxt('sp-branch-text', formatPersonName(s.branchName || '') || 'Head Office');

  // Avatar
  renderAvatar();

  // Contact quick buttons (WhatsApp, Call, Mail, Receipt)
  const phone = (s.phone || '').replace(/\D/g, '');
  const waBtn = $('sp-btn-wa');
  if (waBtn) {
    if (phone.length === 10) {
      waBtn.href = 'https://wa.me/91' + phone;
      waBtn.classList.remove('disabled');
      waBtn.title = 'WhatsApp +91 ' + phone;
    } else {
      waBtn.removeAttribute('href');
      waBtn.classList.add('disabled');
      waBtn.title = 'Phone number invalid';
    }
  }

  const callBtn = $('sp-btn-call');
  if (callBtn) {
    if (phone.length >= 10) {
      callBtn.href = 'tel:' + phone;
      callBtn.classList.remove('disabled');
      callBtn.title = 'Call ' + (s.phone || phone);
    } else {
      callBtn.removeAttribute('href');
      callBtn.classList.add('disabled');
      callBtn.title = 'Phone number missing';
    }
  }

  const mailBtn = $('sp-btn-mail');
  if (mailBtn) {
    if (s.email) {
      mailBtn.href = 'mailto:' + s.email;
      mailBtn.classList.remove('disabled');
      mailBtn.title = 'Email ' + s.email;
    } else {
      mailBtn.removeAttribute('href');
      mailBtn.classList.add('disabled');
      mailBtn.title = 'Email not provided';
    }
  }

  // 4th action button: View Receipts Menu
  const receiptBtn = $('sp-btn-receipt');
  if (receiptBtn) {
    receiptBtn.onclick = async () => {
      const payments = paymentsCache && paymentsCache.length ? paymentsCache : await fetchStudentPayments(s.id).catch(() => []);
      const receiptItems = buildReceiptMenuItems(s, payments);
      openMenu(receiptBtn, receiptItems);
    };
  }

  // Payment Notify Button (Always visible per AI reference layout)
  const { total, outstanding } = calculateStudentFinancials(s, paymentsCache);

  const notifyBtn = $('sp-btn-notify');
  if (notifyBtn) {
    notifyBtn.onclick = () => openNotifyModal(outstanding);
    if (outstanding > 0) {
      notifyBtn.title = 'Notify dues: ' + formatINR(outstanding);
    } else {
      notifyBtn.title = 'Notify dues (No outstanding balance)';
    }
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Payment Status Check Helpers
 */
function isAdmissionFeePaid(admFee, paymentsList, student) {
  if (admFee <= 0) return true;
  const list = paymentsList || [];
  const admTxn = list.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'AD' || t === 'ADM' || t === 'ADMISSION';
  });
  if (admTxn) return true;
  const admPaidAtAdm = Number(student?.dueAtAdmission?.admission ?? student?.dueAtAdmission?.total ?? 0);
  if (admPaidAtAdm > 0) return true;
  if (student?.receiptNo) return true;
  if (student?.admissionPaid === true || student?.isAdmissionPaid === true) return true;
  return false;
}

function isMaterialFeePaid(matFee, paymentsList, student) {
  if (matFee <= 0) return true;
  const list = paymentsList || [];
  const matTxn = list.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'MAT' || t === 'MATERIAL' || t === 'STUDY_MATERIAL' || t === 'STUDYMATERIAL';
  });
  if (matTxn) return true;
  const matPaidAtAdm = Number(student?.dueAtAdmission?.material || 0);
  if (matPaidAtAdm > 0) return true;
  if (student?.materialPaid === true || student?.isMaterialPaid === true) return true;
  return false;
}

function isInstallmentPaid(it, paymentsList, student) {
  const itNo = Number(it.no ?? it.installmentNo);
  if (!itNo || !Number.isFinite(itNo)) return false;
  if (it.paid === true || it.isPaid === true || it.status === 'paid' || it.waived === true || it.isWaived === true) {
    return true;
  }
  if (Array.isArray(student?.paidInstallments) && student.paidInstallments.includes(itNo)) {
    return true;
  }
  if (Number(student?.installmentsPaid || 0) >= itNo) {
    return true;
  }
  const list = paymentsList || [];
  const rec = list.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    const pNo = Number(p.installmentNo ?? p.installment ?? p.no ?? p.instNo);
    const isInstType = (t === 'IN' || t === 'INST' || t === 'INSTALLMENT' || t === 'WA');
    return isInstType && pNo === itNo;
  });
  return !!rec;
}

function isExamFeePaid(examFee, paymentsList, student) {
  if (examFee <= 0) return true;
  const list = paymentsList || [];
  const examTxn = list.find(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'EX' || t === 'EXAM' || t === 'EXAMINATION';
  });
  if (examTxn) return true;
  if (student?.examPaid === true || student?.isExamPaid === true) return true;
  return false;
}

/**
 * Render Key Metrics
 */
function renderMetrics() {
  const s = currentStudent;
  if (!s) return;

  const { total, paid, outstanding, percent: pct } = calculateStudentFinancials(s, paymentsCache);

  setTxt('sp-m-total-fee', formatINR(total));
  setTxt('sp-m-paid', formatINR(paid));
  setTxt('sp-m-outstanding', formatINR(outstanding));

  const barText = $('sp-progress-text');
  if (barText) barText.textContent = pct + '% of course total';
  const barFill = $('sp-stats-bar-fill');
  if (barFill) barFill.style.width = pct + '%';

  // Installment count
  if (s.paymentPlan === 'full') {
    setTxt('sp-m-inst-paid', 'Paid in Full');
  } else {
    const sched = s.feeSchedule || [];
    let instPaidCount = 0;
    sched.forEach((it) => {
      if (isInstallmentPaid(it, paymentsCache, s)) {
        instPaidCount++;
      }
    });

    setTxt('sp-m-inst-paid', instPaidCount + ' of ' + (sched.length || 4));
  }
}

/**
 * Tab Navigation Listeners
 */
function initTabListeners() {
  const tabs = ['personal', 'documents', 'course', 'payments'];
  tabs.forEach((tab) => {
    const btn = $('sp-tab-' + tab);
    if (btn) {
      btn.onclick = () => switchTab(tab);
    }
  });
}

function switchTab(tab) {
  activeTab = tab;
  const tabs = ['personal', 'documents', 'course', 'payments'];
  tabs.forEach((t) => {
    const btn = $('sp-tab-' + t);
    const pane = $('sp-pane-' + t);
    const isActive = t === tab;
    if (btn) {
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    if (pane) {
      pane.hidden = !isActive;
      pane.classList.toggle('active', isActive);
    }
  });

  // Keep ?tab= in hash
  const baseHash = location.hash.split('?')[0];
  if (baseHash) {
    history.replaceState(null, '', baseHash + '?tab=' + tab);
  }

  if (tab === 'personal') renderPersonalTab();
  if (tab === 'documents') renderDocumentsTab();
  if (tab === 'course') renderCourseTab();
  if (tab === 'payments') renderPaymentsTab();

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * TAB 1: Personal Details
 */
function renderPersonalTab() {
  const s = currentStudent;
  if (!s) return;

  setTxt('sp-dt-name', formatPersonName(s.name || '') || '-');
  setTxt('sp-dt-dob', formatDateIN(s.dob || '-'));
  setTxt('sp-dt-gender', formatGenderDisplay(s.gender, '-'));
  setTxt('sp-dt-qual', s.qualification || '-');

  setTxt('sp-dt-phone', s.phone || '-');
  setTxt('sp-dt-altphone', s.altPhone || '-');
  setTxt('sp-dt-email', s.email || '-');
  setTxt('sp-dt-address', s.address || '-');

  setTxt('sp-dt-guardian', formatPersonName(s.guardianName || '') || '-');

  setTxt('sp-dt-course', (s.courseCode ? s.courseCode + ' — ' : '') + (s.courseName || '-'));
  setTxt('sp-dt-batch', s.batchName || '-');
  setTxt('sp-dt-session', s.sessionName || '-');
  setTxt('sp-dt-branch', formatPersonName(s.branchName || '') || '-');

  const isSuper = currentUserProfile?.role === 'superadmin';
  const auditCard = $('sp-audit-card');
  if (auditCard) {
    auditCard.hidden = !isSuper;
    auditCard.style.display = isSuper ? '' : 'none';
  }

  setTxt('sp-dt-docid', s.id || '-');
  setTxt('sp-dt-receiptno', s.receiptNo || '-');
  let regByDisp = '-';
  const rawCreator = String(s.createdBy || '').trim();
  if (rawCreator) {
    const u = resolveUserDisplay(rawCreator, s.createdByName, s.createdByDesignation);
    const cleanName = u.name && u.name !== '-' && !u.name.includes('@') ? formatPersonName(u.name) : '';
    const cleanDesig = u.designation && !u.designation.includes('@') ? formatPersonName(u.designation) : '';
    if (cleanName) regByDisp = cleanDesig ? `${cleanName} (${cleanDesig})` : cleanName;
    else if (!rawCreator.includes('@')) regByDisp = formatPersonName(rawCreator);
    else regByDisp = cleanDesig ? `Authorised Staff (${cleanDesig})` : 'Authorised Staff';
  }
  setTxt('sp-dt-createdby', regByDisp);
  setTxt('sp-dt-createdat', s.createdAt && s.createdAt.seconds ? formatDateIN(new Date(s.createdAt.seconds * 1000).toISOString().slice(0, 10)) : '-');

  // Edit Handlers
  $('sp-edit-personal').onclick = () => openEditPersonalModal();
  $('sp-edit-contact').onclick = () => openEditContactModal();
  $('sp-edit-guardian').onclick = () => openEditGuardianModal();
}

function openEditPersonalModal() {
  const s = currentStudent;
  const popup = openPopup({
    title: 'Edit Personal Details',
    subtitle: `${s.name} • ${s.studentId || s.id}`,
    icon: 'user'
  });

  const form = mk('form', 'sp-modal-form');
  form.onsubmit = (e) => e.preventDefault();

  const nameField = createFormField('Full Name', 'text', s.name || '', true);
  const dobField = createFormField('Date of Birth', 'date', s.dob || '', true);

  // Gender select (customized UI dropdown)
  const genderGroup = mk('div', 'ui-field');
  const gLabelRow = mk('div', 'ui-label-row');
  const gLbl = mk('label', 'ui-label');
  gLbl.textContent = 'Gender ';
  const gEm = mk('em', '', '*');
  gLbl.appendChild(gEm);
  gLabelRow.appendChild(gLbl);
  const gHost = mk('div', '');
  genderGroup.append(gLabelRow, gHost);

  const GENDER_OPTIONS = [
    { value: 'Male', label: 'Male', icon: 'user' },
    { value: 'Female', label: 'Female', icon: 'user-circle' },
    { value: 'Other', label: 'Other', icon: 'user-x' }
  ];
  const initialGender = GENDER_OPTIONS.find(g => g.value.toLowerCase() === (s.gender || '').toLowerCase())?.value || 'Male';
  const genderSel = createSelect(gHost, {
    options: GENDER_OPTIONS,
    value: initialGender,
    ariaLabel: 'Gender'
  });
  const genderField = { group: genderGroup, input: genderSel };

  // Educational qualification: same dropdown as the admission form
  const qualGroup = mk('div', 'ui-field');
  const qLabelRow = mk('div', 'ui-label-row');
  const qLbl = mk('label', 'ui-label');
  qLbl.textContent = 'Educational Qualification';
  qLabelRow.appendChild(qLbl);
  const qHost = mk('div', '');
  qualGroup.append(qLabelRow, qHost);
  const qList = QUALIFICATIONS.slice();
  if (s.qualification && !qList.includes(s.qualification)) qList.push(s.qualification);
  const qualSel = createSelect(qHost, {
    options: [{ value: '', label: 'Select qualification', icon: 'award' }].concat(qList.map(q => ({ value: q, label: q, icon: 'award' }))),
    value: s.qualification || '',
    ariaLabel: 'Educational Qualification'
  });
  const qualField = { group: qualGroup, input: qualSel };

  form.append(nameField.group, dobField.group, genderField.group, qualField.group);

  const footer = mk('div', 'adm-view-foot');
  const cancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.onclick = () => popup.close();

  const saveBtn = mk('button', 'ui-btn primary', 'Save Changes');
  saveBtn.type = 'button';

  footer.append(cancelBtn, saveBtn);
  form.appendChild(footer);
  popup.container.appendChild(form);

  const unreg = registerDirty(() => {
    return nameField.input.value !== (s.name || '') ||
           dobField.input.value !== (s.dob || '') ||
           genderSel.value.toLowerCase() !== (s.gender || '').toLowerCase() ||
           qualField.input.value !== (s.qualification || '');
  });

  saveBtn.onclick = async () => {
    nameField.clearError();
    dobField.clearError();

    const nameErr = validateName(nameField.input.value);
    const dobErr = validateDOB(dobField.input.value);
    if (nameErr) { nameField.setError(nameErr); return; }
    if (dobErr) { dobField.setError(dobErr); return; }

    const updates = {
      name: nameField.input.value.trim(),
      dob: dobField.input.value,
      gender: genderSel.value,
      qualification: String(qualField.input.value || '').trim()
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Saving...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
      await saveStudentProfileUpdates(updates);
      unreg();
      popup.close();
      showToast({ type: 'success', message: 'Personal details updated successfully.' });
      await renderProfile(activeTab);
    } catch (err) {
      console.error('[student-profile] save personal updates failed', err);
      showToast({ type: 'error', message: 'Update failed: ' + (err.message || 'Unknown error') });
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  };
}

function openEditContactModal() {
  const s = currentStudent;
  const popup = openPopup({
    title: 'Edit Contact Details',
    subtitle: `${s.name} • ${s.studentId || s.id}`,
    icon: 'phone'
  });

  const form = mk('form', 'sp-modal-form');
  form.onsubmit = (e) => e.preventDefault();

  const phoneField = createFormField('Mobile Phone (10 digits)', 'tel', s.phone || '', true);
  const altPhoneField = createFormField('Alternative Phone', 'tel', s.altPhone || '', false);
  const emailField = createFormField('Email Address', 'email', s.email || '', false);
  const addrField = createTextareaFormField('Residential Address', s.address || '', true);

  form.append(phoneField.group, altPhoneField.group, emailField.group, addrField.group);

  const footer = mk('div', 'adm-view-foot');
  const cancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.onclick = () => popup.close();

  const saveBtn = mk('button', 'ui-btn primary', 'Save Changes');
  saveBtn.type = 'button';

  footer.append(cancelBtn, saveBtn);
  form.appendChild(footer);
  popup.container.appendChild(form);

  const unreg = registerDirty(() => {
    return phoneField.input.value !== (s.phone || '') ||
           altPhoneField.input.value !== (s.altPhone || '') ||
           emailField.input.value !== (s.email || '') ||
           addrField.input.value !== (s.address || '');
  });

  saveBtn.onclick = async () => {
    phoneField.clearError();
    emailField.clearError();

    const phoneErr = validatePhone(phoneField.input.value);
    const emailErr = emailField.input.value.trim() ? validateEmail(emailField.input.value.trim()) : '';
    if (phoneErr) { phoneField.setError(phoneErr); return; }
    if (emailErr) { emailField.setError(emailErr); return; }

    const updates = {
      phone: phoneField.input.value.trim(),
      altPhone: altPhoneField.input.value.trim(),
      email: emailField.input.value.trim(),
      address: addrField.input.value.trim()
    };

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Saving...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
      await saveStudentProfileUpdates(updates);
      unreg();
      popup.close();
      showToast({ type: 'success', message: 'Contact details updated successfully.' });
      await renderProfile(activeTab);
    } catch (err) {
      console.error('[student-profile] save contact updates failed', err);
      showToast({ type: 'error', message: 'Update failed: ' + (err.message || 'Unknown error') });
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  };
}

function openEditGuardianModal() {
  const s = currentStudent;
  const popup = openPopup({
    title: 'Edit Guardian Details',
    subtitle: `${s.name} • ${s.studentId || s.id}`,
    icon: 'shield'
  });

  const form = mk('form', 'sp-modal-form');
  form.onsubmit = (e) => e.preventDefault();

  const guardianField = createFormField('Guardian Name', 'text', s.guardianName || '', true);
  form.append(guardianField.group);

  const footer = mk('div', 'adm-view-foot');
  const cancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.onclick = () => popup.close();

  const saveBtn = mk('button', 'ui-btn primary', 'Save Changes');
  saveBtn.type = 'button';

  footer.append(cancelBtn, saveBtn);
  form.appendChild(footer);
  popup.container.appendChild(form);

  const unreg = registerDirty(() => guardianField.input.value !== (s.guardianName || ''));

  saveBtn.onclick = async () => {
    guardianField.clearError();
    const val = guardianField.input.value.trim();
    if (!val) {
      guardianField.setError('Guardian name cannot be empty.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Saving...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
      await saveStudentProfileUpdates({ guardianName: val });
      unreg();
      popup.close();
      showToast({ type: 'success', message: 'Guardian details updated successfully.' });
      await renderProfile(activeTab);
    } catch (err) {
      console.error('[student-profile] save guardian updates failed', err);
      showToast({ type: 'error', message: 'Update failed: ' + (err.message || 'Unknown error') });
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  };
}

async function saveStudentProfileUpdates(updates) {
  const authEmail = getAuthEmail();
  const userRole = currentUserProfile.role || '';
  const branchId = currentUserProfile.branchId || currentStudent.branchId || '';

  if (currentStudent.ctx === 'school') {
    const sid = currentStudent.studentId;
    const isSuper = currentUserProfile && currentUserProfile.role === 'superadmin';
    const isHead = currentUserProfile && currentUserProfile.role === 'branch_head';
    const constraints = [where('studentId', '==', sid)];
    if (!isSuper && isHead && branchId) {
      constraints.push(where('branchId', '==', branchId));
    }
    const q = query(collection(db, COL), ...constraints);
    const snap = await getDocs(q);
    const count = snap.size;

    const ok = await confirmDialog({
      title: 'Update Linked Records?',
      message: `This student belongs to Unique Kids. Saving will update ${count} linked record(s) across sessions. Do you want to continue?`,
      confirmText: 'Update all records'
    });
    if (!ok) return;

    const batch = writeBatch(db);
    snap.docs.forEach((d) => {
      batch.update(d.ref, Object.assign({}, updates, {
        updatedAt: serverTimestamp(),
        updatedBy: authEmail
      }));
    });

    await logStudentActivity(currentStudent.id, {
      action: 'profile_updated',
      summary: 'Updated profile fields across ' + count + ' linked record(s)',
      changes: updates,
      userEmail: authEmail,
      userRole,
      branchId
    }, batch);

    await batch.commit();
  } else {
    const ref = doc(db, COL, currentStudent.id);
    const batch = writeBatch(db);
    batch.update(ref, Object.assign({}, updates, {
      updatedAt: serverTimestamp(),
      updatedBy: authEmail
    }));

    await logStudentActivity(currentStudent.id, {
      action: 'profile_updated',
      summary: 'Updated profile details: ' + Object.keys(updates).join(', '),
      changes: updates,
      userEmail: authEmail,
      userRole,
      branchId
    }, batch);

    await batch.commit();
  }

  Object.assign(currentStudent, updates);
}

function createFormField(label, type, value, required, { placeholder = '' } = {}) {
  const group = mk('div', 'ui-field');
  const labelRow = mk('div', 'ui-label-row');
  const lbl = mk('label', 'ui-label');
  lbl.textContent = label + ' ';
  if (required) {
    const em = mk('em', '', '*');
    lbl.appendChild(em);
  }
  labelRow.appendChild(lbl);

  const wrap = mk('div', 'ui-input-wrap');
  const input = document.createElement('input');
  input.type = type;
  input.value = value || '';
  input.className = 'ui-input';
  input.style.paddingLeft = '12px';
  if (placeholder) input.placeholder = placeholder;
  if (required) input.required = true;
  wrap.appendChild(input);

  const errEl = mk('div', 'ui-err');
  group.append(labelRow, wrap, errEl);

  return {
    group,
    input,
    setError: (msg) => { errEl.textContent = msg; wrap.classList.add('is-invalid'); input.focus(); },
    clearError: () => { errEl.textContent = ''; wrap.classList.remove('is-invalid'); }
  };
}

function createTextareaFormField(label, value, required, { placeholder = '' } = {}) {
  const group = mk('div', 'ui-field');
  const labelRow = mk('div', 'ui-label-row');
  const lbl = mk('label', 'ui-label');
  lbl.textContent = label + ' ';
  if (required) {
    const em = mk('em', '', '*');
    lbl.appendChild(em);
  }
  labelRow.appendChild(lbl);

  const wrap = mk('div', 'ui-input-wrap');
  const input = document.createElement('textarea');
  input.value = value || '';
  input.className = 'ui-input';
  input.style.paddingLeft = '12px';
  input.rows = 3;
  if (placeholder) input.placeholder = placeholder;
  if (required) input.required = true;
  wrap.appendChild(input);

  const errEl = mk('div', 'ui-err');
  group.append(labelRow, wrap, errEl);

  return {
    group,
    input,
    setError: (msg) => { errEl.textContent = msg; wrap.classList.add('is-invalid'); input.focus(); },
    clearError: () => { errEl.textContent = ''; wrap.classList.remove('is-invalid'); }
  };
}

/**
 * Render Avatar: displays student's photo if present (from docs/photo subcollection or doc fields),
 * otherwise falls back cleanly to their initials.
 */
function renderAvatar() {
  const s = currentStudent;
  const initialsEl = $('sp-avatar-initials');
  const imgEl = $('sp-avatar-img');
  if (!initialsEl || !imgEl) return;

  const name = s?.name || 'Student';
  initialsEl.textContent = initials(name);

  const photoSrc = getStudentPhotoSrc(s, docsCache);

  if (photoSrc) {
    imgEl.hidden = false;
    initialsEl.hidden = true;
    imgEl.onerror = () => {
      imgEl.hidden = true;
      initialsEl.hidden = false;
    };
    imgEl.src = photoSrc;
  } else {
    imgEl.removeAttribute('src');
    imgEl.hidden = true;
    initialsEl.hidden = false;
  }
}

/**
 * TAB 2: Documents (Pipeline: compressTo100KB -> blobToDataURL)
 */
async function loadDocs() {
  if (!currentStudent) return;
  docsCache = {};
  try {
    const snap = await getDocs(collection(db, COL, currentStudent.id, 'docs'));
    snap.docs.forEach((d) => {
      docsCache[d.id] = { id: d.id, ...d.data() };
    });
  } catch (e) {
    console.warn('[student-profile] loadDocs error', e);
  }

  // Update photo avatar
  renderAvatar();
}

function renderDocumentsTab() {
  const grid = $('sp-docs-grid');
  if (!grid) return;
  grid.textContent = '';

  const shownDocIds = new Set();
  const displayItems = DOC_KEYS.map((item) => {
    const rec = getStudentDocRecord(docsCache, item.key, currentStudent);
    if (rec && rec.id) shownDocIds.add(String(rec.id).toLowerCase());
    shownDocIds.add(String(item.key).toLowerCase());
    return { key: item.key, label: item.label, docData: rec };
  });

  // Also include any additional uploaded document keys saved under docs/ (e.g. aadhaar, certificate)
  Object.entries(docsCache || {}).forEach(([k, val]) => {
    const low = String(k || '').toLowerCase();
    const recKey = String(val?.key || val?.docType || k).toLowerCase();
    if (shownDocIds.has(low) || shownDocIds.has(recKey)) return;
    if (!getStudentDocSrc(val)) return;
    shownDocIds.add(low);
    displayItems.push({
      key: k,
      label: val?.label || formatPersonName(k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')) || 'Document',
      docData: val
    });
  });

  displayItems.forEach(({ key, label, docData }) => {
    const docSrc = getStudentDocSrc(docData, getStudentDocMime(docData));
    const isPresent = !!docData && !!docSrc;

    const card = mk('div', 'sp-doc-card');

    if (isPresent) {
      // Top image or PDF container filling 4:3 (object-fit cover)
      const previewArea = mk('div', 'sp-doc-preview-area');
      const mime = getStudentDocMime(docData);
      const isPdf = mime.includes('pdf') || /^data:application\/pdf/i.test(docSrc);
      if (isPdf) {
        const pdfWrap = mk('div', 'sp-doc-top-pdf');
        pdfWrap.title = 'Click to preview document';
        pdfWrap.innerHTML = '<i data-lucide="file-text"></i><span>PDF Document</span>';
        pdfWrap.onclick = () => openDocPreviewModal(key, label, docData);
        previewArea.appendChild(pdfWrap);
      } else {
        const img = mk('img', 'sp-doc-top-img');
        img.src = docSrc;
        img.alt = label;
        img.title = 'Click to preview document';
        img.onclick = () => openDocPreviewModal(key, label, docData);
        previewArea.appendChild(img);
      }
      card.appendChild(previewArea);

      // Card body
      const body = mk('div', 'sp-doc-body');

      // Title 14px semibold + status pill on the same row
      const head = mk('div', 'sp-doc-title-row');
      head.appendChild(mk('h4', 'sp-doc-title', label));
      const pill = mk('span', 'pill up', 'Uploaded');
      head.appendChild(pill);
      body.appendChild(head);

      // File name and size in 12px muted
      const meta = mk('div', 'sp-doc-meta');
      const sizeStr = formatBytes ? formatBytes(docData.sizeBytes || 0) : ((docData.sizeBytes || 0) + ' B');
      meta.textContent = `${docData.name || 'document'} · ${sizeStr}`;
      body.appendChild(meta);

      // Action buttons: Preview, Download, Replace using .ui-btn.ghost.sm
      const foot = mk('div', 'sp-doc-actions');

      const prevBtn = mk('button', 'ui-btn ghost sm');
      prevBtn.type = 'button';
      prevBtn.title = 'Preview document';
      prevBtn.innerHTML = '<i data-lucide="eye"></i><span>View</span>';
      prevBtn.onclick = () => openDocPreviewModal(key, label, docData);

      const dlBtn = mk('button', 'ui-btn ghost sm');
      dlBtn.type = 'button';
      dlBtn.title = 'Download file';
      dlBtn.innerHTML = '<i data-lucide="download"></i><span>Download</span>';
      dlBtn.onclick = () => downloadDocFile(docData, (currentStudent.studentId || currentStudent.id) + '_' + key);

      const repBtn = mk('button', 'ui-btn ghost sm');
      repBtn.type = 'button';
      repBtn.title = 'Replace document';
      repBtn.innerHTML = '<i data-lucide="refresh-cw"></i><span>Replace</span>';
      repBtn.onclick = () => openDocReplaceModal(key, label, docData);

      foot.append(prevBtn, dlBtn, repBtn);
      body.appendChild(foot);
      card.appendChild(body);
    } else {
      // Missing Card
      const body = mk('div', 'sp-doc-body');

      // Title + small status pill
      const head = mk('div', 'sp-doc-title-row');
      head.appendChild(mk('h4', 'sp-doc-title', label));
      const pill = mk('span', 'pill neutral', 'Missing');
      head.appendChild(pill);
      body.appendChild(head);

      // Dashed area with upload icon
      const dropZone = mk('div', 'sp-doc-dashed-zone');
      dropZone.innerHTML = '<i data-lucide="upload-cloud"></i><span>Click or drop file to upload</span>';
      dropZone.onclick = () => openDocReplaceModal(key, label, null);
      dropZone.ondragover = (ev) => { ev.preventDefault(); dropZone.classList.add('dragover'); };
      dropZone.ondragleave = () => dropZone.classList.remove('dragover');
      dropZone.ondrop = (ev) => {
        ev.preventDefault();
        dropZone.classList.remove('dragover');
        if (ev.dataTransfer.files && ev.dataTransfer.files[0]) {
          openDocReplaceModal(key, label, null, ev.dataTransfer.files[0]);
        }
      };
      body.appendChild(dropZone);

      // Upload text button
      const foot = mk('div', 'sp-doc-actions');
      const upBtn = mk('button', 'ui-btn primary sm');
      upBtn.type = 'button';
      upBtn.innerHTML = '<i data-lucide="upload"></i><span>Upload Document</span>';
      upBtn.onclick = () => openDocReplaceModal(key, label, null);
      foot.appendChild(upBtn);
      body.appendChild(foot);

      card.appendChild(body);
    }

    grid.appendChild(card);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function openDocPreviewModal(keyOrLabel, labelOrDocData, maybeDocData) {
  let key, label, docData;
  if (maybeDocData !== undefined) {
    key = keyOrLabel;
    label = labelOrDocData;
    docData = maybeDocData;
  } else {
    label = keyOrLabel;
    docData = labelOrDocData;
    const found = DOC_KEYS.find(k => k.label === label);
    key = found ? found.key : '';
  }
  if (!docData) return;

  const popup = openPopup({
    title: label,
    subtitle: docData.name || '',
    icon: 'eye',
    wide: true
  });

  // Add replace and download buttons to the left of the cross (close) icon in the header
  const xBtn = popup.el.querySelector('.adm-view-close');
  if (xBtn && xBtn.parentElement) {
    const actionsWrap = xBtn.parentElement;

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'ui-btn ghost adm-view-close';
    dlBtn.setAttribute('aria-label', 'Download document');
    dlBtn.title = 'Download document';
    dlBtn.innerHTML = '<i data-lucide="download" width="18" height="18"></i>';
    dlBtn.onclick = (e) => {
      e.stopPropagation();
      downloadDocFile(docData, (currentStudent.studentId || currentStudent.id) + '_' + (key || label));
    };

    const repBtn = document.createElement('button');
    repBtn.type = 'button';
    repBtn.className = 'ui-btn ghost adm-view-close';
    repBtn.setAttribute('aria-label', 'Replace document');
    repBtn.title = 'Replace document';
    repBtn.innerHTML = '<i data-lucide="refresh-cw" width="18" height="18"></i>';
    repBtn.onclick = (e) => {
      e.stopPropagation();
      popup.close();
      openDocReplaceModal(key, label, docData || (key ? docsCache[key] : null));
    };

    actionsWrap.insertBefore(dlBtn, xBtn);
    actionsWrap.insertBefore(repBtn, dlBtn);

    // Prevent header icon buttons from getting focused or keeping focus ring on open
    requestAnimationFrame(() => {
      if (document.activeElement && actionsWrap.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    });
  }

  const docSrc = getStudentDocSrc(docData, getStudentDocMime(docData));
  const mime = getStudentDocMime(docData);
  const isPdf = mime.includes('pdf') || /^data:application\/pdf/i.test(docSrc);
  const body = mk('div', 'sp-doc-preview-modal-body');

  if (isPdf) {
    const iframe = document.createElement('iframe');
    iframe.src = docSrc;
    iframe.style.width = '100%';
    iframe.style.height = '72vh';
    iframe.style.border = 'none';
    body.appendChild(iframe);
  } else {
    const img = mk('img');
    img.src = docSrc;
    img.alt = label;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '72vh';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    body.appendChild(img);
  }

  // Remove the close and download button from down: only append body, no footer!
  popup.container.appendChild(body);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function downloadDocFile(docData, defaultName) {
  const src = getStudentDocSrc(docData, getStudentDocMime(docData));
  if (!src) return;
  const mime = getStudentDocMime(docData);
  const a = document.createElement('a');
  a.href = src;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.download = docData.name || (defaultName + (mime.includes('pdf') ? '.pdf' : '.jpg'));
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Replace Document Modal (drag-and-drop + compressTo100KB pipeline)
 */
function openDocReplaceModal(key, label, existingDoc, droppedFile) {
  const s = currentStudent;
  const existingSrc = getStudentDocSrc(existingDoc, getStudentDocMime(existingDoc));
  const isReplacing = !!(existingDoc && existingSrc);
  const popup = openPopup({
    title: (isReplacing ? 'Replace ' : 'Upload ') + label,
    subtitle: `${s.name} • ${s.studentId || s.id}`,
    icon: 'upload',
    wide: isReplacing
  });

  const container = mk('div', 'sp-modal-form');

  let curRow = null;
  if (isReplacing) {
    curRow = mk('div', 'sp-doc-current-bar');
    curRow.innerHTML = `
      <div class="sp-doc-current-icon"><i data-lucide="file-check"></i></div>
      <div class="sp-doc-current-text">
        <span class="sp-doc-current-label">Current Document</span>
        <span class="sp-doc-current-name">${existingDoc.name || label} <span class="sp-doc-current-size">(${formatBytes(existingDoc.sizeBytes || 0)})</span></span>
      </div>
    `;
    container.appendChild(curRow);
  }

  const dropZone = mk('div', 'sp-drop-zone');

  const emptyWrap = mk('div', 'sp-drop-empty');
  emptyWrap.innerHTML = `
    <div class="sp-drop-icon-tile">
      <i data-lucide="upload-cloud"></i>
    </div>
    <div class="sp-drop-title">Choose a file or drag & drop here</div>
    <div class="sp-drop-subtitle">JPG, PNG, PDF up to 10MB (auto-compressed to 100KB)</div>
  `;

  const loadingWrap = mk('div', 'sp-drop-loading');
  loadingWrap.style.display = 'none';
  loadingWrap.innerHTML = `
    <i data-lucide="loader-2" class="spin"></i>
    <span>Optimizing and compressing document...</span>
  `;

  const previewWrap = mk('div', isReplacing ? 'sp-doc-compare-grid' : 'sp-replace-preview-card');
  previewWrap.style.display = 'none';

  dropZone.append(emptyWrap, loadingWrap, previewWrap);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,application/pdf';
  fileInput.style.display = 'none';

  dropZone.onclick = (e) => {
    if (e.target.closest('#sp-change-file-btn')) {
      fileInput.click();
      return;
    }
    if (!readyPayload) {
      fileInput.click();
    }
  };

  dropZone.ondragover = (ev) => { ev.preventDefault(); dropZone.classList.add('dragover'); };
  dropZone.ondragleave = () => dropZone.classList.remove('dragover');
  dropZone.ondrop = (ev) => {
    ev.preventDefault();
    dropZone.classList.remove('dragover');
    if (ev.dataTransfer.files && ev.dataTransfer.files[0]) {
      processFile(ev.dataTransfer.files[0]);
    }
  };

  fileInput.onchange = () => {
    if (fileInput.files && fileInput.files[0]) {
      processFile(fileInput.files[0]);
    }
  };

  container.append(dropZone, fileInput);

  const footer = mk('div', 'adm-view-foot');
  const cancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.onclick = () => popup.close();

  const saveBtn = mk('button', 'ui-btn primary', isReplacing ? 'Replace Document' : 'Upload Document');
  saveBtn.type = 'button';
  saveBtn.disabled = true;

  footer.append(cancelBtn, saveBtn);
  container.appendChild(footer);
  popup.container.appendChild(container);

  if (typeof lucide !== 'undefined') lucide.createIcons();

  let readyPayload = null;

  async function processFile(file) {
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      showToast({ type: 'error', message: 'File is too large. Maximum size is 10MB.' });
      return;
    }

    if (curRow) curRow.style.display = 'none';
    emptyWrap.style.display = 'none';
    previewWrap.style.display = 'none';
    loadingWrap.style.display = 'flex';
    dropZone.classList.remove('has-file');
    saveBtn.disabled = true;
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
      previewWrap.textContent = '';

      if (isImageFile(file)) {
        const kind = key === 'photo' ? 'photo' : (key === 'signature' ? 'signature' : 'doc');
        const compResult = await compressTo100KB(file, kind);
        const compressedBlob = compResult.blob;
        const dataUrl = await blobToDataURL(compressedBlob);

        readyPayload = {
          type: 'image/jpeg',
          mime: 'image/jpeg',
          name: file.name,
          sizeBytes: compressedBlob.size,
          data: dataUrl
        };
      } else if (file.type === 'application/pdf') {
        const dataUrl = await blobToDataURL(file);
        readyPayload = {
          type: 'application/pdf',
          mime: 'application/pdf',
          name: file.name,
          sizeBytes: file.size,
          data: dataUrl
        };
      }

      if (isReplacing) {
        // Render Side-by-Side Comparison
        const isOldPdf = (existingDoc.type || existingDoc.mime || '').includes('pdf') || String(existingDoc.name || '').endsWith('.pdf');
        const isNewPdf = readyPayload.type === 'application/pdf';

        const oldCol = mk('div', 'sp-compare-col old');
        oldCol.innerHTML = `
          <div class="sp-compare-header">
            <span class="sp-compare-badge old">Current Document</span>
            <span class="sp-compare-filename" title="${existingDoc.name || label}">${existingDoc.name || label}</span>
          </div>
          <div class="sp-compare-preview">
            ${isOldPdf 
              ? `<div class="sp-replace-pdf-wrap"><i data-lucide="file-text"></i><span>PDF Document</span></div>`
              : `<img src="${existingSrc}" alt="Current">`
            }
          </div>
          <div class="sp-compare-footer">
            <span class="sp-compare-pill old">Will be replaced</span>
            <span class="text-xs text-mute">${formatBytes(existingDoc.sizeBytes || 0)}</span>
          </div>
        `;

        const arrow = mk('div', 'sp-compare-arrow');
        arrow.innerHTML = '<i data-lucide="arrow-right"></i>';

        const newCol = mk('div', 'sp-compare-col new');
        newCol.innerHTML = `
          <div class="sp-compare-header">
            <span class="sp-compare-badge new">New Document</span>
            <span class="sp-compare-filename" title="${readyPayload.name}">${readyPayload.name}</span>
          </div>
          <div class="sp-compare-preview">
            ${isNewPdf
              ? `<div class="sp-replace-pdf-wrap"><i data-lucide="file-text"></i><span>${readyPayload.name}</span></div>`
              : `<img src="${readyPayload.data}" alt="New">`
            }
          </div>
          <div class="sp-compare-footer">
            <span class="sp-replace-meta-pill"><i data-lucide="check-circle-2"></i> Ready · ${formatBytes(readyPayload.sizeBytes)}</span>
            <button type="button" class="ui-btn ghost sm" id="sp-change-file-btn">
              <i data-lucide="refresh-cw"></i><span>Change</span>
            </button>
          </div>
        `;

        previewWrap.className = 'sp-doc-compare-grid';
        previewWrap.append(oldCol, arrow, newCol);
      } else {
        // Single preview card for fresh upload
        const isNewPdf = readyPayload.type === 'application/pdf';
        previewWrap.className = 'sp-replace-preview-card';
        if (isNewPdf) {
          const pdfWrap = mk('div', 'sp-replace-pdf-wrap');
          pdfWrap.innerHTML = `
            <i data-lucide="file-text"></i>
            <span style="font-weight:600;font-size:13px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${file.name}</span>
          `;
          const pill = mk('div', 'sp-replace-meta-pill');
          pill.innerHTML = `<i data-lucide="check-circle-2"></i><span>Ready · PDF ${formatBytes(file.size)}</span>`;
          const actRow = mk('div', 'sp-replace-actions');
          const changeBtn = mk('button', 'ui-btn ghost sm');
          changeBtn.id = 'sp-change-file-btn';
          changeBtn.type = 'button';
          changeBtn.innerHTML = '<i data-lucide="refresh-cw"></i><span>Change file</span>';
          actRow.appendChild(changeBtn);
          previewWrap.append(pdfWrap, pill, actRow);
        } else {
          const imgWrap = mk('div', 'sp-replace-img-wrap');
          const nImg = mk('img');
          nImg.src = readyPayload.data;
          nImg.alt = file.name;
          imgWrap.appendChild(nImg);

          const pill = mk('div', 'sp-replace-meta-pill');
          pill.innerHTML = `<i data-lucide="check-circle-2"></i><span>Ready · ${formatBytes(readyPayload.sizeBytes)} (Original: ${formatBytes(file.size)})</span>`;

          const actRow = mk('div', 'sp-replace-actions');
          const changeBtn = mk('button', 'ui-btn ghost sm');
          changeBtn.id = 'sp-change-file-btn';
          changeBtn.type = 'button';
          changeBtn.innerHTML = '<i data-lucide="refresh-cw"></i><span>Change file</span>';
          actRow.appendChild(changeBtn);

          previewWrap.append(imgWrap, pill, actRow);
        }
      }

      loadingWrap.style.display = 'none';
      previewWrap.style.display = isReplacing ? 'grid' : 'flex';
      dropZone.classList.add('has-file');
      saveBtn.disabled = false;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      console.error('[student-profile] processFile failed', e);
      loadingWrap.style.display = 'none';
      emptyWrap.style.display = 'flex';
      if (curRow) curRow.style.display = 'flex';
      dropZone.classList.remove('has-file');
      showToast({ type: 'error', message: e.message || 'File processing failed' });
      readyPayload = null;
      saveBtn.disabled = true;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }

  if (droppedFile) {
    processFile(droppedFile);
  }

  saveBtn.onclick = async () => {
    if (!readyPayload) return;

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Replacing...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
      const authEmail = getAuthEmail();
      const docRef = doc(collection(db, COL, s.id, 'docs'), key);
      const studentRef = doc(db, COL, s.id);
      const batch = writeBatch(db);

      batch.set(docRef, Object.assign({}, readyPayload, {
        updatedAt: serverTimestamp()
      }));

      batch.update(studentRef, {
        [`docs.${key}`]: true,
        updatedAt: serverTimestamp(),
        updatedBy: authEmail
      });

      await logStudentActivity(s.id, {
        action: 'document_replaced',
        summary: `${isReplacing ? 'Replaced' : 'Uploaded'} ${label} (${readyPayload.name})`,
        changes: { [key]: { from: isReplacing ? (existingDoc.name || label) : 'none', to: readyPayload.name } },
        userEmail: authEmail,
        userRole: currentUserProfile.role,
        branchId: currentUserProfile.branchId
      }, batch);

      await batch.commit();

      showToast({ type: 'success', message: `${label} replaced successfully.` });
      popup.close();

      await loadDocs();
      renderDocumentsTab();
    } catch (err) {
      console.error('[student-profile] document upload failed', err);
      showToast({ type: 'error', message: 'Upload failed: ' + (err.message || 'Save error') });
      saveBtn.disabled = false;
      saveBtn.textContent = isReplacing ? 'Replace Document' : 'Upload Document';
    }
  };
}

/**
 * TAB 3: Course Details
 */
async function renderCourseTab() {
  const s = currentStudent;
  if (!s) return;

  await ensureMetadataCache();

  // 1. Resolve Course
  let course = (coursesCache && (coursesCache.byId?.[s.courseId] || coursesCache.byCode?.[(s.courseCode || '').toUpperCase().trim()])) || null;
  if (!course && s.courseId) {
    try {
      const cDoc = await getDoc(doc(db, 'courses', s.courseId));
      if (cDoc.exists()) {
        course = { id: cDoc.id, ...cDoc.data() };
        if (coursesCache) {
          if (!coursesCache.byId) coursesCache.byId = {};
          if (!coursesCache.byCode) coursesCache.byCode = {};
          coursesCache.byId[cDoc.id] = course;
          const cd = (course.code || course.courseCode || '').toUpperCase().trim();
          if (cd) coursesCache.byCode[cd] = course;
        }
      }
    } catch (_) {}
  }

  // 2. Resolve Session
  let sess = (sessionsCache && (sessionsCache.byId?.[s.sessionId] || sessionsCache.byName?.[(s.sessionName || '').toLowerCase().trim()])) || null;
  if (!sess && s.sessionId) {
    try {
      const sDoc = await getDoc(doc(db, 'sessions', s.sessionId));
      if (sDoc.exists()) {
        sess = { id: sDoc.id, ...sDoc.data() };
        if (sessionsCache) {
          if (!sessionsCache.byId) sessionsCache.byId = {};
          if (!sessionsCache.byName) sessionsCache.byName = {};
          sessionsCache.byId[sDoc.id] = sess;
          const sn = (sess.name || '').toLowerCase().trim();
          if (sn) sessionsCache.byName[sn] = sess;
        }
      }
    } catch (_) {}
  }

  // 3. Resolve Batch
  let batch = (batchesCache && batchesCache.byId?.[s.batchId]) || null;
  if (!batch && s.batchId) {
    try {
      const bDoc = await getDoc(doc(db, 'batches', s.batchId));
      if (bDoc.exists()) {
        batch = { id: bDoc.id, ...bDoc.data() };
        if (batchesCache) {
          if (!batchesCache.byId) batchesCache.byId = {};
          batchesCache.byId[bDoc.id] = batch;
        }
      }
    } catch (_) {}
  }

  // Course Name & Code
  setTxt('sp-c-name', s.courseName || course?.name || '-');
  setTxt('sp-c-code', s.courseCode || course?.code || course?.courseCode || '-');

  // Course Level (1 = Base, 2 = Combo, 3 = Advanced)
  const lv = Number(course?.level || (s.studentId && s.studentId.length === 8 ? s.studentId.slice(2, 4) : 1));

  // Course Duration (Months)
  let dur = course?.durationMonths || course?.duration;
  if (!dur && lv) {
    dur = lv === 1 ? 6 : (lv === 2 ? 12 : (lv === 3 ? 18 : 6));
  }
  if (!dur && s.courseDuration) {
    dur = s.courseDuration;
  }
  if (!dur) dur = 6;
  const durStr = String(dur).toLowerCase().includes('month') ? String(dur) : `${dur} Months`;
  setTxt('sp-c-duration', durStr);

  // Prerequisites Resolution
  let prereqDisplay = '';
  const pId = course?.prerequisiteId || s.prereqCheck?.courseId || null;
  const pCode = course?.prerequisiteCode || batch?.prerequisiteCourseCode || batch?.prerequisite || s.prerequisite || null;

  let prereqCourse = null;
  if (pId) {
    prereqCourse = coursesCache?.byId?.[pId] || null;
    if (!prereqCourse) {
      try {
        const pDoc = await getDoc(doc(db, 'courses', pId));
        if (pDoc.exists()) {
          prereqCourse = { id: pDoc.id, ...pDoc.data() };
          if (coursesCache) {
            if (!coursesCache.byId) coursesCache.byId = {};
            coursesCache.byId[pDoc.id] = prereqCourse;
          }
        }
      } catch (_) {}
    }
  } else if (pCode && coursesCache?.byCode?.[String(pCode).trim().toUpperCase()]) {
    prereqCourse = coursesCache.byCode[String(pCode).trim().toUpperCase()];
  }

  if (prereqCourse) {
    const cCode = prereqCourse.code || prereqCourse.courseCode || pCode;
    const cName = prereqCourse.name || prereqCourse.courseName || '';
    prereqDisplay = cName ? `${cCode} — ${cName}` : cCode;
  } else if (pCode && String(pCode).trim().toLowerCase() !== 'none') {
    prereqDisplay = String(pCode).trim();
  } else if (course?.eligibility && !course.eligibility.toLowerCase().startsWith('class')) {
    prereqDisplay = course.eligibility;
  } else if (lv === 2) {
    prereqDisplay = course?.eligibility || 'Requires Semester 1 Base Course';
  } else if (lv === 3) {
    prereqDisplay = course?.eligibility || 'Requires Semester 2 Combo Course';
  } else {
    // Base course (Level 1)
    const elig = course?.eligibilityText || course?.eligibility;
    if (elig && !elig.toLowerCase().includes('completed')) {
      prereqDisplay = `None (Base Course — ${elig})`;
    } else {
      prereqDisplay = 'None (Base Course)';
    }
  }

  if (s.prereqCheck) {
    if (s.prereqCheck.status === 'auto') {
      prereqDisplay += ' (Verified)';
    } else if (s.prereqCheck.status === 'manual') {
      prereqDisplay += ' (Verified manually)';
    }
  }
  setTxt('sp-c-prereq', prereqDisplay || 'None (Base Course)');

  // Batch Name & Timing
  setTxt('sp-c-batch-name', s.batchName || batch?.name || '-');
  setTxt('sp-c-batch-timing', s.batchTiming || batch?.timing || batch?.schedule || 'Standard Batch Schedule');

  // Session Dates
  let sStart = s.sessionStartDate || sess?.startDate || sess?.startISO || '';
  let sEnd = s.sessionEndDate || sess?.endDate || sess?.endISO || '';

  // Smart deduction from session name if direct dates missing
  if (!sStart || !sEnd) {
    const sName = s.sessionName || sess?.name || '';
    const yearMatch = sName.match(/\b(20\d{2})\b/);
    const yr = yearMatch ? yearMatch[1] : '';
    if (yr) {
      if (/1st|jan/i.test(sName)) {
        if (!sStart) sStart = `${yr}-01-01`;
        if (!sEnd) sEnd = `${yr}-06-30`;
      } else if (/2nd|jul/i.test(sName)) {
        if (!sStart) sStart = `${yr}-07-01`;
        if (!sEnd) sEnd = `${yr}-12-31`;
      }
    }
  }

  // Deduce from feeSchedule installment months if still missing
  if (!sStart && Array.isArray(s.feeSchedule) && s.feeSchedule.length > 0 && s.feeSchedule[0].month) {
    const parts = String(s.feeSchedule[0].month).split('-').map(Number);
    if (parts.length === 2) {
      let startMo = parts[1] - 2;
      let startYr = parts[0];
      if (startMo <= 0) {
        startMo += 12;
        startYr -= 1;
      }
      sStart = `${startYr}-${String(startMo).padStart(2, '0')}-01`;
      let endMo = startMo + 5;
      let endYr = startYr;
      if (endMo > 12) {
        endMo -= 12;
        endYr += 1;
      }
      const endDays = [31, (endYr % 4 === 0 ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      sEnd = `${endYr}-${String(endMo).padStart(2, '0')}-${String(endDays[endMo - 1]).padStart(2, '0')}`;
    }
  }

  setTxt('sp-c-sess-start', sStart ? formatDateIN(sStart) : '-');
  setTxt('sp-c-sess-end', sEnd ? formatDateIN(sEnd) : '-');
  setTxt('sp-c-branch-name', formatPersonName(s.branchName || '') || '-');

  // Fee breakdown table
  const tbody = $('sp-fee-breakdown-tbody');
  tbody.textContent = '';
  const snap = s.feeSnapshot || {};

  const studentSess = (sessionsCache && (sessionsCache.byId?.[s.sessionId] || sessionsCache.byName?.[(s.sessionName || '').toLowerCase().trim()])) || null;
  const examStarted = studentSess?.examFeeCollection?.started === true;
  let lockedExamFee = 0;
  if (examStarted && studentSess?.examFeeCollection?.fees && s.courseId && Object.prototype.hasOwnProperty.call(studentSess.examFeeCollection.fees, s.courseId)) {
    lockedExamFee = Number(studentSess.examFeeCollection.fees[s.courseId]);
  }

  if (s.paymentPlan === 'full') {
    const fullAmt = Number(s.fullPaymentAmount || s.dueAtAdmission?.full || s.feeTotal || 0);
    const instFee = Number(snap.installment || 0);
    const admFee = Number(snap.admission || 0);
    const matFee = Number(snap.material || s.materialFee || s.studyMaterialFee || 0);
    const stdFee = courseFeeOf(s) || ((admFee + instFee * 4 > 0) ? (admFee + instFee * 4) : Number(s.feeTotal || fullAmt));
    const disc = discountOf(s);

    const tr1 = mk('tr');
    tr1.append(mk('td', '', 'Course Package Fee (Standard)'), mk('td', 'num font-semibold', formatINR(stdFee)));
    tbody.appendChild(tr1);
    if (disc.rs > 0) {
      const trDisc = mk('tr');
      const discLabel = `Full-Payment Discount (${disc.pct}% off)`;
      trDisc.append(mk('td', 'text-success', discLabel), mk('td', 'num font-semibold text-success', '-' + formatINR(disc.rs)));
      tbody.appendChild(trDisc);
    }
    const totalTr = mk('tr');
    totalTr.append(
      mk('td', 'font-bold', 'Full Course Fee'),
      mk('td', 'num font-bold text-success', formatINR(fullAmt))
    );
    tbody.appendChild(totalTr);

    if (matFee > 0) {
      const trMat = mk('tr');
      trMat.append(
        mk('td', '', 'Study Material & Kit (Paid at admission)'),
        mk('td', 'num font-semibold', formatINR(matFee))
      );
      tbody.appendChild(trMat);
    }
  } else {
    const matFee = Number(snap.material || s.materialFee || s.studyMaterialFee || 0);
    const rows = [
      { label: 'Admission Fee', amount: snap.admission || s.admissionFee || 0 },
      { label: 'Tuition Fee (Per Installment)', amount: snap.installment || 0 },
      { label: 'Total Scheduled Installments', amount: (snap.installment || 0) * (s.feeSchedule?.length || 4) }
    ];

    rows.forEach((r) => {
      const tr = mk('tr');
      tr.append(mk('td', '', r.label), mk('td', 'num font-semibold', formatINR(r.amount)));
      tbody.appendChild(tr);
    });

    const totalTr = mk('tr');
    totalTr.append(
      mk('td', 'font-bold', 'Total Course Package Fee'),
      mk('td', 'num font-bold text-success', formatINR(courseFeeWithoutExam(s)))
    );
    tbody.appendChild(totalTr);

    if (matFee > 0) {
      const trMat = mk('tr');
      trMat.append(
        mk('td', '', 'Study Material & Kit (Paid at admission)'),
        mk('td', 'num font-semibold', formatINR(matFee))
      );
      tbody.appendChild(trMat);
    }
  }

  if (examStarted) {
    const examPaid = isExamFeePaid(lockedExamFee, paymentsCache, s);
    const examTr = mk('tr');
    examTr.append(
      mk('td', 'font-semibold', `Exam fee (locked): Rs ${formatINR(lockedExamFee)} — ${examPaid ? 'Paid' : 'Due'}`),
      mk('td', 'num font-bold', formatINR(lockedExamFee))
    );
    tbody.appendChild(examTr);
  }

  // Scheduled installment table
  const schedTbody = $('sp-sched-tbody');
  schedTbody.textContent = '';
  const sched = s.feeSchedule || [];
  if (s.paymentPlan === 'full') {
    const tr = mk('tr');
    const td = mk('td', 'text-center font-semibold text-success', `Course fee paid in full on ${formatDateIN(s.fullPaidOn || s.admissionDate || todayISO())}. Paid: Rs ${formatINR(Number(s.fullPaymentAmount || s.feeTotal || 0))}, Outstanding: Rs 0. Only the examination fee remains.`);
    td.colSpan = 5;
    td.style.padding = '16px 12px';
    tr.appendChild(td);
    schedTbody.appendChild(tr);
  } else if (sched.length === 0) {
    const tr = mk('tr');
    const td = mk('td', 'text-mute text-center', 'No installment schedule configured.');
    td.colSpan = 5;
    tr.appendChild(td);
    schedTbody.appendChild(tr);
  } else {
    sched.forEach((it) => {
      const tr = mk('tr');
      tr.append(
        mk('td', 'font-semibold', 'Installment ' + it.no),
        mk('td', '', it.month || '-'),
        mk('td', '', formatDateIN(it.opens)),
        mk('td', 'font-semibold', formatDateIN(it.due)),
        mk('td', 'num font-semibold', formatINR(it.amount || snap.installment || 0))
      );
      schedTbody.appendChild(tr);
    });
  }

  // Navigate directly to the existing receipt page
  $('sp-view-receipt-btn').onclick = () => {
    location.hash = '#/admissions/' + currentStudent.id + '/receipt';
  };
}

/**
 * TAB 4: Payment History
 */
async function loadPayments() {
  if (!currentStudent) return;
  await Promise.all([
    fetchStudentPayments(currentStudent.id).then(res => { paymentsCache = res; }),
    ensureMetadataCache()
  ]);
  if (paymentsCache && currentStudent.ctx !== 'school') {
    await repairStudentAdmissionPayment(currentStudent, paymentsCache).catch(err => {
      console.warn('Admission payment repair check skipped:', err);
    });
  }
}

function renderPaymentsTab() {
  const s = currentStudent;
  if (!s) return;

  if (s.ctx === 'school') {
    $('sp-youth-payments-wrap').hidden = true;
    $('sp-kids-payments-wrap').hidden = false;
    renderKidsPaymentsTab();
    return;
  }

  $('sp-youth-payments-wrap').hidden = false;
  $('sp-kids-payments-wrap').hidden = true;

  const sched = s.feeSchedule || [];

  const recordBtn = $('sp-btn-record-payment');
  if (recordBtn) recordBtn.onclick = () => openRecordPaymentModal();

  renderInstallmentStatusTable(sched);
  renderTransactionsLedger();

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderFeeActionCell(actionTd, { isPaid, isWaived, payType, label, icon, paymentId, isAdmission }) {
  if (!isPaid && !isWaived) {
    const payBtn = mk('button', 'ui-btn primary sm pf-btn-collect sp-table-action-btn');
    payBtn.type = 'button';
    payBtn.title = `Collect payment for ${label}`;
    payBtn.innerHTML = '<i data-lucide="wallet"></i><span>Collect</span>';
    payBtn.onclick = () => openRecordPaymentModal(payType);
    actionTd.appendChild(payBtn);
  } else {
    const receiptBtn = mk('button', 'ui-btn ghost sm sp-table-action-btn');
    receiptBtn.type = 'button';
    receiptBtn.title = `View receipt for ${label}`;
    receiptBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
    receiptBtn.onclick = () => {
      if (isAdmission || payType === 'AD' || payType === 'FULL' || payType === 'MAT') {
        const receiptRoute = currentStudent?.ctx === 'school'
          ? '#/school-admissions/' + currentStudent.id + '/receipt'
          : '#/admissions/' + currentStudent.id + '/receipt';
        location.hash = receiptRoute;
      } else {
        const pId = paymentId || 'latest';
        location.hash = `#/payments/${currentStudent.id}/${pId}/receipt?from=profile`;
      }
    };
    actionTd.appendChild(receiptBtn);
  }
}

function renderInstallmentStatusTable(sched) {
  const tbody = $('sp-inst-tbody');
  tbody.textContent = '';

  const s = currentStudent;
  const snap = s?.feeSnapshot || {};
  const admFee = Number(snap.admission ?? s?.admissionFee ?? s?.dueAtAdmission?.admission ?? 0);
  const matFee = Number(snap.material ?? s?.materialFee ?? s?.studyMaterialFee ?? 0);
  const examFee = Number(snap.exam ?? s?.examFee ?? 0);

  if (sched.length === 0 && admFee === 0 && matFee === 0 && examFee === 0) {
    const tr = mk('tr');
    const td = mk('td', 'text-mute text-center', 'No scheduled fee items.');
    td.colSpan = 8;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  // 1. Admission Fee row (At Admission) — skip for full payment plan
  if (admFee > 0 && s.paymentPlan !== 'full') {
    const tr = mk('tr');
    const admTxn = paymentsCache.find(p => {
      const t = String(p.type || '').toUpperCase().trim();
      return t === 'AD' || t === 'ADM' || t === 'ADMISSION';
    });
    const admPaidAtAdmission = Number(s?.dueAtAdmission?.admission ?? s?.dueAtAdmission?.total ?? 0);
    const isPaid = isAdmissionFeePaid(admFee, paymentsCache, s);
    const isWaived = admTxn && admTxn.waived;
    const paidAmt = admTxn ? (admTxn.amount || admFee) : (admPaidAtAdmission > 0 ? admPaidAtAdmission : admFee);
    const paidDate = admTxn?.date || s.admissionDate || null;

    const noTd = mk('td', 'font-semibold', 'Admission Fee');
    const monthTd = mk('td', 'text-mute', 'At Admission');
    const dueTd = mk('td', '', '—');
    const schedTd = mk('td', 'num', formatINR(admFee));
    const paidTd = mk('td', 'num font-semibold text-success', isPaid ? formatINR(paidAmt) : '—');
    const paidOnTd = mk('td', '', isPaid && paidDate ? formatDateIN(paidDate) : '—');

    const statusTd = mk('td');
    statusTd.appendChild(mk('span', 'pill ' + (isPaid ? 'up' : 'neutral'), isWaived ? 'Waived' : (isPaid ? 'Paid' : 'Pending')));

    const actionTd = mk('td', 'act');
    renderFeeActionCell(actionTd, {
      isPaid,
      isWaived,
      payType: 'AD',
      label: 'Admission Fee',
      icon: 'credit-card',
      isAdmission: true
    });

    tr.append(noTd, monthTd, dueTd, schedTd, paidTd, paidOnTd, statusTd, actionTd);
    tbody.appendChild(tr);
  }

  // 2. Study Material Fee row (At Admission - right after Admission Fee)
  if (matFee > 0) {
    const tr = mk('tr');
    const matTxn = paymentsCache.find(p => {
      const t = String(p.type || '').toUpperCase().trim();
      return t === 'MAT' || t === 'MATERIAL' || t === 'STUDY_MATERIAL';
    });
    const matPaidAtAdmission = Number(s?.dueAtAdmission?.material || 0);
    const isPaid = isMaterialFeePaid(matFee, paymentsCache, s);
    const isWaived = matTxn && matTxn.waived;
    const paidAmt = matTxn ? (matTxn.amount || matFee) : (matPaidAtAdmission > 0 ? matPaidAtAdmission : 0);
    const paidDate = matTxn?.date || (matPaidAtAdmission > 0 ? s.admissionDate : null);

    const noTd = mk('td', 'font-semibold', 'Study Material Fee');
    const monthTd = mk('td', 'text-mute', 'At Admission');
    const dueTd = mk('td', '', '—');
    const schedTd = mk('td', 'num', formatINR(matFee));
    const paidTd = mk('td', 'num font-semibold text-success', isPaid ? formatINR(paidAmt) : '—');
    const paidOnTd = mk('td', '', isPaid && paidDate ? formatDateIN(paidDate) : '—');

    const statusTd = mk('td');
    statusTd.appendChild(mk('span', 'pill ' + (isPaid ? 'up' : 'neutral'), isWaived ? 'Waived' : (isPaid ? 'Paid' : 'Pending')));

    const actionTd = mk('td', 'act');
    renderFeeActionCell(actionTd, {
      isPaid,
      isWaived,
      payType: 'MAT',
      label: 'Study Material Fee',
      icon: 'credit-card',
      paymentId: matTxn?.id,
      isAdmission: true
    });

    tr.append(noTd, monthTd, dueTd, schedTd, paidTd, paidOnTd, statusTd, actionTd);
    tbody.appendChild(tr);
  }

  // 3. Installments (1..N) or Paid in Full
  if (s.paymentPlan === 'full') {
    const fullAmt = Number(s.fullPaymentAmount || s.feeTotal || 0);
    const paidOn = s.fullPaidOn || s.admissionDate || todayISO();
    const tr = mk('tr');
    const descTd = mk('td', 'font-semibold', 'Course fee paid in full on ' + formatDateIN(paidOn));
    descTd.colSpan = 3;
    const schedTd = mk('td', 'num font-semibold', formatINR(fullAmt));
    const paidTd = mk('td', 'num font-semibold text-success', formatINR(fullAmt));
    const paidOnTd = mk('td', '', formatDateIN(paidOn));
    const statusTd = mk('td');
    statusTd.appendChild(mk('span', 'pill up', 'Paid in Full'));
    const actionTd = mk('td', 'act');
    const fullPaymentRec = paymentsCache.find(p => p.type === 'FULL' || p.type === 'AD');
    renderFeeActionCell(actionTd, {
      isPaid: true,
      isWaived: false,
      payType: 'FULL',
      label: 'Course Fee',
      icon: 'receipt',
      paymentId: fullPaymentRec?.id
    });
    tr.append(descTd, schedTd, paidTd, paidOnTd, statusTd, actionTd);
    tbody.appendChild(tr);

    const noteTr = mk('tr');
    const noteTd = mk('td', 'text-mute text-center', 'Paid = ' + formatINR(fullAmt) + ', Outstanding = Rs 0. Only the examination fee remains.');
    noteTd.colSpan = 8;
    noteTd.style.fontSize = '12px';
    noteTd.style.padding = '8px';
    noteTr.appendChild(noteTd);
    tbody.appendChild(noteTr);
  } else {
    sched.forEach((it) => {
      const tr = mk('tr');
      const itNo = Number(it.no ?? it.installmentNo);
      const paidRec = paymentsCache.find(p => {
        const t = String(p.type || '').toUpperCase().trim();
        const pNo = Number(p.installmentNo ?? p.installment ?? p.no ?? p.instNo);
        return (t === 'IN' || t === 'INST' || t === 'INSTALLMENT' || t === 'WA') && pNo === itNo;
      });
      const isPaid = isInstallmentPaid(it, paymentsCache, s);
      const isWaived = (paidRec && paidRec.waived) || !!it.waived;

      let statusLabel = 'Upcoming';
      let statusClass = 'upcoming';
      let lateFine = 0;

      if (isWaived) {
        statusLabel = 'Waived';
        statusClass = 'success';
      } else if (isPaid) {
        statusLabel = 'Paid';
        statusClass = 'success';
      } else {
        const today = todayISO();
        if (today > it.due) {
          lateFine = calculateLateFee(it.due, today);
          statusLabel = 'Overdue' + (lateFine > 0 ? ` (+Rs ${lateFine})` : '');
          statusClass = 'danger';
        } else if (today >= it.opens) {
          statusLabel = 'Due';
          statusClass = 'warning';
        } else {
          statusLabel = 'Upcoming';
          statusClass = 'neutral';
        }
      }

      const noTd = mk('td', 'font-semibold', 'Installment ' + it.no);
      const monthTd = mk('td', '', it.month || '-');
      const dueTd = mk('td', 'font-semibold', formatDateIN(it.due));
      const schedTd = mk('td', 'num', formatINR(it.amount || 0));
      const paidTd = mk('td', 'num font-semibold text-success', isPaid ? formatINR(paidRec?.amount || it.amount || 0) : '—');
      const paidOnTd = mk('td', '', isPaid && paidRec ? formatDateIN(paidRec.date) : '—');

      const statusTd = mk('td');
      const pill = mk('span', 'pill ' + (isPaid ? 'up' : (statusClass === 'danger' ? 'down' : 'neutral')), statusLabel);
      statusTd.appendChild(pill);

      const actionTd = mk('td', 'act');
      renderFeeActionCell(actionTd, {
        isPaid,
        isWaived,
        payType: it.no,
        label: 'Installment ' + it.no,
        icon: 'credit-card',
        paymentId: paidRec?.id
      });

      tr.append(noTd, monthTd, dueTd, schedTd, paidTd, paidOnTd, statusTd, actionTd);
      tbody.appendChild(tr);
    });
  }

  // 4. Examination Fee row: only show if exam fee collection has started
  let sessionExamFee = 0;
  let examFeeNotSetInSession = false;
  let showExamFeeRow = false;
  if (s.ctx === 'youth') {
    const studentSess = (sessionsCache && (sessionsCache.byId?.[s.sessionId] || sessionsCache.byName?.[(s.sessionName || '').toLowerCase().trim()])) || null;
    if (studentSess && studentSess.examFeeCollection?.started === true) {
      showExamFeeRow = true;
      if (studentSess.examFeeCollection.fees && s.courseId && Object.prototype.hasOwnProperty.call(studentSess.examFeeCollection.fees, s.courseId)) {
        sessionExamFee = Number(studentSess.examFeeCollection.fees[s.courseId]);
      } else {
        examFeeNotSetInSession = true;
      }
    }
  }

  if (showExamFeeRow) {
    const tr = mk('tr');
    const examTxn = paymentsCache.find(p => {
      const t = String(p.type || '').toUpperCase().trim();
      return t === 'EX' || t === 'EXAM' || t === 'EXAMINATION';
    });
    const isPaid = isExamFeePaid(sessionExamFee, paymentsCache, s);
    const isWaived = examTxn && examTxn.waived;
    const paidAmt = examTxn ? (examTxn.amount || sessionExamFee) : 0;
    const paidDate = examTxn?.date || null;

    const noTd = mk('td', 'font-semibold', 'Examination Fee');
    const monthTd = mk('td', 'text-mute', 'Pre-Exam');
    const dueTd = mk('td', '', '—');
    const schedTd = mk('td', 'num', examFeeNotSetInSession ? '—' : formatINR(sessionExamFee));
    const paidTd = mk('td', 'num font-semibold text-success', isPaid ? formatINR(paidAmt) : '—');
    const paidOnTd = mk('td', '', isPaid && paidDate ? formatDateIN(paidDate) : '—');

    const statusTd = mk('td');
    statusTd.appendChild(mk('span', 'pill ' + (isPaid ? 'up' : (examFeeNotSetInSession ? 'down' : 'neutral')), isWaived ? 'Waived' : (isPaid ? 'Paid' : (examFeeNotSetInSession ? 'Not Set' : 'Pending'))));

    const actionTd = mk('td', 'act');
    if (examFeeNotSetInSession && !isPaid) {
      const errMsg = mk('span', 'pf-action-disabled text-danger text-xs', `Exam fee not set for this course in this session. Contact ${getRoleTitle('superadmin')}.`);
      actionTd.appendChild(errMsg);
    } else {
      renderFeeActionCell(actionTd, {
        isPaid,
        isWaived,
        payType: 'EX',
        label: 'Examination Fee',
        icon: 'credit-card',
        paymentId: examTxn?.id
      });
    }

    tr.append(noTd, monthTd, dueTd, schedTd, paidTd, paidOnTd, statusTd, actionTd);
    tbody.appendChild(tr);
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderTransactionsLedger() {
  const tbody = $('sp-txns-tbody');
  tbody.textContent = '';

  const txns = [];
  const s = currentStudent;
  if (!s) return;

  const snap = s.feeSnapshot || {};
  const dueAt = s.dueAtAdmission || {};
  const admFee = Number(snap.admission ?? s.admissionFee ?? dueAt.admission ?? 0);
  const matFee = Number(snap.material ?? s.materialFee ?? s.studyMaterialFee ?? dueAt.material ?? 0);

  // Check if paymentsCache already has an explicit separate MAT payment
  const hasSeparateMatDoc = paymentsCache.some(p => {
    const t = String(p.type || '').toUpperCase().trim();
    return t === 'MAT' || t === 'MATERIAL' || t === 'STUDY_MATERIAL';
  });

  // Study material fee was collected at admission if student was admitted, matFee > 0, and either:
  // - isMaterialFeePaid returns true
  // - or student has admission receiptNo and fee was set (admission fee & study material collected together at admission)
  const isMatCollectedAtAdm = matFee > 0 && !hasSeparateMatDoc && (
    isMaterialFeePaid(matFee, paymentsCache, s) ||
    Number(dueAt.material || 0) > 0 ||
    s.materialPaid === true ||
    s.isMaterialPaid === true ||
    Boolean(s.receiptNo)
  );

  // Initial admission payment fallback if not in subcollection
  // ONLY for legacy students where no payments subcollection exists at all
  const hasAdOrFullDoc = paymentsCache.some(p => p.type === 'AD' || p.type === 'FULL');
  if (!hasAdOrFullDoc && s.receiptNo) {
    const totalPaid = Number(dueAt.total ?? ((dueAt.admission || 0) + (isMatCollectedAtAdm ? matFee : 0)));
    let admPaid = admFee;
    if (dueAt.admission !== undefined && Number(dueAt.admission) > 0) {
      admPaid = Number(dueAt.admission);
    } else if (isMatCollectedAtAdm && totalPaid > matFee) {
      admPaid = totalPaid - matFee;
    } else if (totalPaid > 0 && !isMatCollectedAtAdm) {
      admPaid = totalPaid;
    }

    txns.push({
      date: s.admissionDate || '',
      receiptNo: s.receiptNo,
      type: s.paymentPlan === 'full' ? 'FULL' : 'AD',
      amount: admPaid,
      mode: s.paymentMode || 'Cash / Bank',
      txnId: s.txnId || 'Admission',
      recordedAtBranchId: s.branchId || '',
      recordedAtBranchCode: s.branchCode || '',
      recordedAtBranchName: s.branchName || 'Branch',
      recordedBy: s.createdBy || '-',
      remarks: s.paymentPlan === 'full' ? 'Full course fee' : 'Admission fee',
      waived: false
    });

    if (isMatCollectedAtAdm) {
      txns.push({
        date: s.admissionDate || '',
        receiptNo: s.receiptNo,
        type: 'MAT',
        amount: matFee,
        mode: s.paymentMode || 'Cash / Bank',
        txnId: s.txnId || 'Admission',
        recordedAtBranchId: s.branchId || '',
        recordedAtBranchCode: s.branchCode || '',
        recordedAtBranchName: s.branchName || 'Branch',
        recordedBy: s.createdBy || '-',
        remarks: 'Study material fee',
        waived: false,
        isAdmissionMat: true
      });
    }
  }

  const fullReceiptNos = new Set(
    paymentsCache.filter(p => String(p.type || '').toUpperCase() === 'FULL').map(p => p.receiptNo).filter(Boolean)
  );
  const hasExplicitMatDoc = paymentsCache.some(p => p.type === 'MAT');

  // Payments from subcollection
  paymentsCache.forEach((p) => {
    const t = String(p.type || '').toUpperCase().trim();
    if (t === 'AD') {
      // Deduplicate: ignore duplicate AD if student is on Full plan or if FULL payment exists with same receiptNo
      if (s.paymentPlan === 'full' || (p.receiptNo && fullReceiptNos.has(p.receiptNo))) {
        return;
      }
      let admAmt = p.amount;
      // Only subtract matFee if matFee was bundled into p.amount and NOT recorded as a separate MAT doc
      if (!hasExplicitMatDoc && isMatCollectedAtAdm && p.amount > matFee) {
        admAmt = p.amount - matFee;
      }
      txns.push(Object.assign({}, p, {
        amount: admAmt,
        remarks: p.remarks && p.remarks.includes('&') ? 'Admission fee' : (p.remarks || 'Admission fee')
      }));

      if (!hasExplicitMatDoc && isMatCollectedAtAdm) {
        txns.push({
          date: p.date || s.admissionDate || '',
          receiptNo: p.receiptNo || s.receiptNo || '',
          type: 'MAT',
          amount: matFee,
          mode: p.mode || s.paymentMode || 'Cash / Bank',
          txnId: p.txnId || 'Admission',
          recordedAtBranchId: p.recordedAtBranchId || s.branchId || '',
          recordedAtBranchCode: p.recordedAtBranchCode || s.branchCode || '',
          recordedAtBranchName: p.recordedAtBranchName || s.branchName || 'Branch',
          recordedBy: p.recordedBy || s.createdBy || '-',
          recordedByName: p.recordedByName || '',
          remarks: 'Study material fee',
          waived: false,
          isAdmissionMat: true
        });
      }
    } else {
      txns.push(p);
    }
  });

  txns.sort((a, b) => {
    const da = a.date || '';
    const dbDate = b.date || '';
    if (da !== dbDate) {
      return dbDate.localeCompare(da);
    }
    const order = { AD: 1, FULL: 1, MAT: 2, IN: 3, EX: 4 };
    const oa = order[a.type] || 5;
    const ob = order[b.type] || 5;
    return oa - ob;
  });

  if (txns.length === 0) {
    const tr = mk('tr');
    const td = mk('td', 'text-mute text-center', 'No payment transactions recorded yet.');
    td.colSpan = 9;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  txns.forEach((t) => {
    const tr = mk('tr');

    const typeLabel = t.type === 'AD' ? 'Admission fee' :
      (t.type === 'FULL' ? 'Full course fee' :
        (t.type === 'IN' ? ('Installment ' + (t.installmentNo || '')) :
          (t.type === 'EX' ? 'Exam fee' : (t.type === 'MAT' ? 'Study material' : (t.type || 'Payment')))));

    const amountStr = formatINR(t.amount || 0) + (t.lateFeeAmount ? ` (+ Rs ${t.lateFeeAmount})` : '');

    const dateTd = mk('td', '', formatDateIN(t.date));
    const rcptTd = mk('td', 'font-semibold font-mono', t.receiptNo || '-');

    const typeTd = mk('td');
    let pillStyle = t.waived ? 'neutral' : (t.type === 'MAT' ? 'sky' : (t.type === 'EX' ? 'purple' : 'up'));
    const typePill = mk('span', 'pill ' + pillStyle, t.waived ? (typeLabel + ' [Waived]') : typeLabel);
    typeTd.appendChild(typePill);

    const amtTd = mk('td', 'num font-semibold text-success', amountStr);
    const modeTd = mk('td');
    const mBadge = mk('span', 'la-mode ' + (t.mode || 'cash').toLowerCase(), (t.mode || 'cash').toUpperCase());
    modeTd.appendChild(mBadge);
    const txnIdTd = mk('td', 'font-mono text-mute', t.txnId || '—');

    // Merged: Collected at + Recorded by
    // Format: 'BZYCTC (Branch code) - xyz@gmail.com by BRANCH HEAD NAME'
    const branchId = t.recordedAtBranchId || currentStudent.branchId || '';
    const branchInfo = (branchesCache && branchesCache[branchId]) || {};
    const branchName = t.recordedAtBranchName || branchInfo.name || currentStudent.branchName || '';
    const branchCode = t.recordedAtBranchCode || branchInfo.code || currentStudent.branchCode || '';
    const branchDisplay = formatBranchDisplay(branchName, branchCode);

    const email = t.recordedBy || currentStudent.createdBy || '-';
    const emailNorm = (email || '').toLowerCase().trim();

    const dirDisp = emailNorm && emailNorm !== '-'
      ? resolveUserDisplay(emailNorm, t.recordedByName, t.recordedByDesignation)
      : { found: false, name: '', designation: '' };
    const localCached = emailNorm && usersCache && usersCache.byEmail && usersCache.byEmail[emailNorm];
    const branchFallback = branchId && usersCache && usersCache.byBranch && usersCache.byBranch[branchId];

    let headName = (dirDisp.found && dirDisp.name)
      || (localCached && localCached.name)
      || t.recordedByName
      || (branchFallback && branchFallback.name)
      || '';
    if (!headName && emailNorm && currentUserProfile && currentUserProfile.email && emailNorm === currentUserProfile.email.toLowerCase()) {
      headName = currentUserProfile.name || '';
    }
    if (!headName && email && email !== '-') {
      headName = getRoleTitle(t.userRole === 'superadmin' ? 'superadmin' : (t.userRole || 'branch_head'));
    }
    headName = headName ? (formatPersonName(headName) || headName) : '';
    const headDesig = (dirDisp.found && dirDisp.designation)
      || (localCached && localCached.designation ? formatPersonName(localCached.designation) : '')
      || (t.recordedByDesignation ? formatPersonName(t.recordedByDesignation) : '');

    const collectorTd = mk('td', 'sp-collector-cell');
    let collectorText = branchDisplay;
    if (email && email !== '-') {
      collectorText += ' - ' + email;
    }
    if (headName) {
      collectorText += ' by ' + headName + (headDesig ? ' (' + headDesig + ')' : '');
    }
    collectorTd.textContent = collectorText;
    collectorTd.title = (branchName || branchDisplay)
      + (email && email !== '-' ? ' • ' + email : '')
      + (headName ? ' • ' + headName + (headDesig ? ' (' + headDesig + ')' : '') : '');

    const remarksTd = mk('td', '', t.remarks || (t.waiverReason ? `Waived: ${t.waiverReason}` : '—'));

    const actionTd = mk('td', 'act');
    const receiptBtn = mk('button', 'ui-btn ghost sm sp-table-action-btn');
    receiptBtn.type = 'button';
    receiptBtn.title = 'View Receipt';
    receiptBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
    receiptBtn.onclick = () => {
      const isAdmReceipt = t.type === 'AD' || t.type === 'FULL' || t.type === 'MAT' ||
        (t.receiptNo && (t.receiptNo === currentStudent.admissionReceiptNo || t.receiptNo === currentStudent.receiptNo || t.receiptNo === currentStudent.fullReceiptNo));

      if (isAdmReceipt) {
        const receiptRoute = currentStudent?.ctx === 'school'
          ? '#/school-admissions/' + currentStudent.id + '/receipt'
          : '#/admissions/' + currentStudent.id + '/receipt';
        location.hash = receiptRoute;
      } else {
        const paymentId = t.id || 'latest';
        location.hash = `#/payments/${currentStudent.id}/${paymentId}/receipt?from=profile`;
      }
    };
    actionTd.appendChild(receiptBtn);

    tr.append(dateTd, rcptTd, typeTd, amtTd, modeTd, txnIdTd, collectorTd, remarksTd, actionTd);
    tbody.appendChild(tr);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/**
 * Record Payment Popup (Uses shared component)
 */
async function openRecordPaymentModal(preselectedOption) {
  if (!currentStudent) return;
  await openPaymentPopup({
    student: currentStudent,
    profile: currentUserProfile,
    preselectedOption,
    sessionsCache: {
      byId: (sessionDocsList || []).reduce((acc, s) => { acc[s.id] = s; return acc; }, {}),
      byName: (sessionDocsList || []).reduce((acc, s) => { if (s.name) acc[s.name.toLowerCase().trim()] = s; return acc; }, {})
    },
    payments: paymentsCache,
    from: 'profile',
    onSuccess: async () => {
      await Promise.all([
        resolveStudent(currentStudent.studentId || currentStudent.id).then(fresh => { if (fresh) currentStudent = fresh; }),
        loadPayments()
      ]);
      renderMetrics();
      renderPaymentsTab();
    }
  });
}

/**
 * Kids Payments Tab (ctx: 'school')
 */
async function renderKidsPaymentsTab() {
  const tbody = $('sp-kids-bills-tbody');
  tbody.textContent = '';

  try {
    const q = query(collection(db, 'bills'), where('studentId', '==', currentStudent.studentId || currentStudent.id));
    const snap = await getDocs(q);

    if (snap.empty) {
      const tr = mk('tr');
      const td = mk('td', 'text-mute text-center', 'No bills generated for this student yet.');
      td.colSpan = 7;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    const bills = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    bills.sort((a, b) => (b.month || '').localeCompare(a.month || ''));

    bills.forEach((b) => {
      const tr = mk('tr');
      const isPaid = b.status === 'paid';

      const monthTd = mk('td', 'font-semibold', b.month || '-');
      const dueTd = mk('td', '', formatDateIN(b.dueDate));
      const feeTd = mk('td', 'num', formatINR(b.monthlyFee || 0));
      const lateTd = mk('td', 'num text-danger', formatINR(b.lateFee || 0));
      const paidTd = mk('td', 'num font-semibold text-success', formatINR(b.paidAmount || 0));

      const statusTd = mk('td');
      const badge = mk('span', 'ar-pill ' + (isPaid ? 'paid' : 'due'), b.status || 'unpaid');
      statusTd.appendChild(badge);

      const actionTd = mk('td', 'act');
      if (!isPaid && currentUserProfile.role === 'superadmin') {
        const payBtn = mk('a', 'ar-btn primary sm', 'Pay Bill');
        payBtn.href = '#/school-fee-payment?billId=' + b.id;
        actionTd.appendChild(payBtn);
      } else {
        actionTd.textContent = '—';
      }

      tr.append(monthTd, dueTd, feeTd, lateTd, paidTd, statusTd, actionTd);
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error('[student-profile] renderKidsPaymentsTab error', e);
  }
}

/**
 * Payment Reminder Modal (WhatsApp / Email notification)
 */
function openNotifyModal(outstanding) {
  const s = currentStudent;
  const studentDisplayName = formatPersonName(s.name || '') || '-';
  const branchDisplayName = formatPersonName(s.branchName || '') || 'Unique Infotech';
  const popup = openPopup({
    title: 'Notify Payment Dues',
    subtitle: `${studentDisplayName} • Outstanding: ${formatINR(outstanding)}`,
    icon: 'bell'
  });

  const branchPhone = currentUserProfile.branchPhone || 'our branch office';
  const defaultMsg =
    `Dear ${studentDisplayName},\n\n` +
    `This is a friendly reminder regarding your course "${s.courseName || 'Computer Course'}" at ${branchDisplayName}.\n` +
    `Your current outstanding balance is ${formatINR(outstanding)}.\n` +
    `Kindly note that late fine of Rs 1/day accrues after the 10th of the due month.\n\n` +
    `Please clear the pending fees at the earliest. For queries, contact ${branchPhone}.\n\n` +
    `Thank you,\nUnique Infotech Management`;

  const form = mk('div', 'sp-modal-form');

  const group = mk('div', 'ui-field');
  const labelRow = mk('div', 'ui-label-row');
  labelRow.appendChild(mk('label', 'ui-label', 'Editable Reminder Message'));
  group.appendChild(labelRow);

  const wrap = mk('div', 'ui-input-wrap');
  const textarea = document.createElement('textarea');
  textarea.className = 'ui-input';
  textarea.style.paddingLeft = '12px';
  textarea.rows = 7;
  textarea.value = defaultMsg;
  wrap.appendChild(textarea);
  group.appendChild(wrap);
  form.appendChild(group);

  const footer = mk('div', 'adm-view-foot');
  const closeBtn = mk('button', 'ui-btn ghost', 'Close');
  closeBtn.type = 'button';
  closeBtn.onclick = () => popup.close();

  const phone = (s.phone || '').replace(/\D/g, '');
  const waBtn = mk('button', 'ui-btn primary');
  waBtn.type = 'button';
  waBtn.innerHTML = '<i data-lucide="message-circle"></i><span>Send WhatsApp</span>';
  if (phone.length === 10) {
    waBtn.onclick = () => {
      const url = `https://wa.me/91${phone}?text=${encodeURIComponent(textarea.value)}`;
      window.open(url, '_blank');
      popup.close();
    };
  } else {
    waBtn.disabled = true;
    waBtn.title = 'Phone number missing or invalid';
  }

  const mailBtn = mk('button', 'ui-btn ghost');
  mailBtn.type = 'button';
  mailBtn.innerHTML = '<i data-lucide="mail"></i><span>Send Email</span>';
  if (s.email) {
    mailBtn.onclick = () => {
      const subject = encodeURIComponent('Fee Payment Reminder — Unique Infotech');
      const body = encodeURIComponent(textarea.value);
      window.location.href = `mailto:${s.email}?subject=${subject}&body=${body}`;
      popup.close();
    };
  } else {
    mailBtn.disabled = true;
    mailBtn.title = 'Email not provided';
  }

  footer.append(closeBtn, mailBtn, waBtn);
  form.appendChild(footer);
  popup.container.appendChild(form);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
