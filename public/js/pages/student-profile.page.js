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
import { showToast } from '../components/toast.js?v=1.8.107';
import { openPopup } from '../components/modal.js?v=1.8.107';
import { createSelect } from '../components/ui-select.js?v=1.8.107';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.107';
import { openMenu } from '../components/ui-menu.js?v=1.8.107';
import { formatINR, formatDateIN, initials } from '../utils/formatter.js?v=1.8.107';
import { validatePhone, validateEmail, validateDOB, validateName } from '../utils/validator.js?v=1.8.107';
import { registerDirty } from '../utils/unsaved-guard.js?v=1.8.107';
import { compressTo100KB, blobToDataURL, isImageFile, formatBytes } from '../utils/image-compress.js?v=1.8.107';
import { todayISO } from '../utils/session-rules.js?v=1.8.107';
import { getSelectedSessionId } from '../core/sessions.js?v=1.8.107';
import {
  fetchStudentPayments,
  recordPaymentTx,
  logStudentActivity,
  calculateLateFee,
  courseFeeWithoutExam,
  courseBalanceWithoutExam
} from '../services/payment.service.js?v=1.8.107';

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
      usersCache ? null : (isSuper ? getDocs(collection(db, 'users')).catch(() => null) : null),
      coursesCache ? null : getDocs(collection(db, 'courses')).catch(() => null),
      sessionsCache ? null : getDocs(collection(db, 'sessions')).catch(() => null),
      batchesCache ? null : getDocs(collection(db, 'batches')).catch(() => null)
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
        const item = { id: d.id, name: u.name || '', email: em, role: u.role || '', branchId: u.branchId || '' };
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

  renderHeader();
  renderMetrics();

  await Promise.all([
    loadDocs(),
    loadPayments()
  ]);

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

  setTxt('sp-name', s.name || '-');
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
  setTxt('sp-branch-text', s.branchName || 'Head Office');

  // Avatar Initials fallback
  const initialsEl = $('sp-avatar-initials');
  const imgEl = $('sp-avatar-img');
  initialsEl.textContent = initials(s.name || 'Student');
  initialsEl.hidden = false;
  imgEl.hidden = true;

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
      if (!payments || payments.length === 0) {
        location.hash = (s.ctx === 'school' ? '#/school-admissions/' : '#/admissions/') + (s.id || s.studentId) + '/receipt';
        return;
      }
      const receiptItems = [
        {
          label: 'Admission receipt',
          icon: 'file-text',
          onClick: () => { location.hash = (s.ctx === 'school' ? '#/school-admissions/' : '#/admissions/') + (s.id || s.studentId) + '/receipt'; }
        }
      ];
      payments.forEach(p => {
        const type = String(p.type || '').toUpperCase();
        let label = '';
        if (type === 'EX') {
          label = `Exam fee - ${p.receiptNo || 'Receipt'}`;
        } else {
          const no = p.installmentNo || 1;
          const mo = p.month ? ` - ${p.month}` : '';
          label = `Installment ${no}${mo} - ${p.receiptNo || 'Receipt'}`;
        }
        receiptItems.push({
          label,
          icon: 'receipt',
          onClick: () => {
            location.hash = `#/payments/${s.id}/${p.id}/receipt?from=profile`;
          }
        });
      });
      openMenu(receiptBtn, receiptItems);
    };
  }

  // Payment Notify Button (Always visible per AI reference layout)
  const total = courseFeeWithoutExam(s);
  const outstanding = courseBalanceWithoutExam(s, paymentsCache);

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

  const total = courseFeeWithoutExam(s);
  const outstanding = courseBalanceWithoutExam(s, paymentsCache);
  const paid = Math.max(0, total - outstanding);

  setTxt('sp-m-total-fee', formatINR(total));
  setTxt('sp-m-paid', formatINR(paid));
  setTxt('sp-m-outstanding', formatINR(outstanding));

  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const barText = $('sp-progress-text');
  if (barText) barText.textContent = pct + '% of course total';
  const barFill = $('sp-stats-bar-fill');
  if (barFill) barFill.style.width = pct + '%';

  // Installment count
  const sched = s.feeSchedule || [];
  let instPaidCount = 0;
  sched.forEach((it) => {
    if (isInstallmentPaid(it, paymentsCache, s)) {
      instPaidCount++;
    }
  });

  setTxt('sp-m-inst-paid', instPaidCount + ' of ' + (sched.length || 4));
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

  setTxt('sp-dt-name', s.name || '-');
  setTxt('sp-dt-dob', formatDateIN(s.dob || '-'));
  setTxt('sp-dt-gender', s.gender || '-');
  setTxt('sp-dt-qual', s.qualification || '-');

  setTxt('sp-dt-phone', s.phone || '-');
  setTxt('sp-dt-altphone', s.altPhone || '-');
  setTxt('sp-dt-email', s.email || '-');
  setTxt('sp-dt-address', s.address || '-');

  setTxt('sp-dt-guardian', s.guardianName || '-');

  setTxt('sp-dt-course', (s.courseCode ? s.courseCode + ' — ' : '') + (s.courseName || '-'));
  setTxt('sp-dt-batch', s.batchName || '-');
  setTxt('sp-dt-session', s.sessionName || '-');
  setTxt('sp-dt-branch', s.branchName || '-');

  setTxt('sp-dt-docid', s.id || '-');
  setTxt('sp-dt-receiptno', s.receiptNo || '-');
  setTxt('sp-dt-createdby', s.createdBy || '-');
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
 * TAB 2: Documents (Pipeline: compressTo100KB -> blobToDataURL)
 */
async function loadDocs() {
  if (!currentStudent) return;
  docsCache = {};
  try {
    const snap = await getDocs(collection(db, COL, currentStudent.id, 'docs'));
    snap.docs.forEach((d) => {
      docsCache[d.id] = d.data();
    });
  } catch (e) {
    console.warn('[student-profile] loadDocs error', e);
  }

  // Update photo avatar
  const photoDoc = docsCache['photo'];
  if (photoDoc && photoDoc.data) {
    const imgEl = $('sp-avatar-img');
    const initEl = $('sp-avatar-initials');
    if (imgEl && initEl) {
      imgEl.src = photoDoc.data;
      imgEl.hidden = false;
      initEl.hidden = true;
    }
  }
}

function renderDocumentsTab() {
  const grid = $('sp-docs-grid');
  if (!grid) return;
  grid.textContent = '';

  DOC_KEYS.forEach(({ key, label }) => {
    const docData = docsCache[key];
    const isPresent = !!docData && !!docData.data;

    const card = mk('div', 'sp-doc-card');

    if (isPresent) {
      // Top image or PDF container filling 4:3 (object-fit cover)
      const previewArea = mk('div', 'sp-doc-preview-area');
      const isPdf = (docData.type || docData.mime || '').includes('pdf');
      if (isPdf) {
        const pdfWrap = mk('div', 'sp-doc-top-pdf');
        pdfWrap.title = 'Click to preview document';
        pdfWrap.innerHTML = '<i data-lucide="file-text"></i><span>PDF Document</span>';
        pdfWrap.onclick = () => openDocPreviewModal(label, docData);
        previewArea.appendChild(pdfWrap);
      } else {
        const img = mk('img', 'sp-doc-top-img');
        img.src = docData.data;
        img.alt = label;
        img.title = 'Click to preview document';
        img.onclick = () => openDocPreviewModal(label, docData);
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
      prevBtn.textContent = 'View';
      prevBtn.onclick = () => openDocPreviewModal(label, docData);

      const dlBtn = mk('button', 'ui-btn ghost sm');
      dlBtn.type = 'button';
      dlBtn.title = 'Download file';
      dlBtn.textContent = 'Download';
      dlBtn.onclick = () => downloadDocFile(docData, (currentStudent.studentId || currentStudent.id) + '_' + key);

      const repBtn = mk('button', 'ui-btn ghost sm');
      repBtn.type = 'button';
      repBtn.title = 'Replace document';
      repBtn.textContent = 'Replace';
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

function openDocPreviewModal(label, docData) {
  const popup = openPopup({
    title: label,
    subtitle: docData.name || '',
    icon: 'eye',
    wide: true
  });

  // Add download button to the left of the cross (close) icon in the header
  const xBtn = popup.el.querySelector('.adm-view-close');
  if (xBtn && xBtn.parentElement) {
    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'ui-btn ghost adm-view-close';
    dlBtn.setAttribute('aria-label', 'Download document');
    dlBtn.title = 'Download document';
    dlBtn.innerHTML = '<i data-lucide="download" width="18" height="18"></i>';
    dlBtn.onclick = (e) => {
      e.stopPropagation();
      downloadDocFile(docData, (currentStudent.studentId || currentStudent.id) + '_' + label);
    };
    xBtn.parentElement.insertBefore(dlBtn, xBtn);
  }

  const isPdf = (docData.type || docData.mime || '').includes('pdf');
  const body = mk('div', 'sp-doc-preview-modal-body');

  if (isPdf) {
    const iframe = document.createElement('iframe');
    iframe.src = docData.data;
    iframe.style.width = '100%';
    iframe.style.height = '72vh';
    iframe.style.border = 'none';
    body.appendChild(iframe);
  } else {
    const img = mk('img');
    img.src = docData.data;
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
  const a = document.createElement('a');
  a.href = docData.data;
  a.download = docData.name || (defaultName + (docData.mime?.includes('pdf') ? '.pdf' : '.jpg'));
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Replace Document Modal (drag-and-drop + compressTo100KB pipeline)
 */
function openDocReplaceModal(key, label, existingDoc, droppedFile) {
  const s = currentStudent;
  const popup = openPopup({
    title: (existingDoc ? 'Replace ' : 'Upload ') + label,
    subtitle: `${s.name} • ${s.studentId || s.id}`,
    icon: 'upload'
  });

  const container = mk('div', 'sp-modal-form');

  if (existingDoc && existingDoc.data) {
    const curRow = mk('div', 'pk-note');
    curRow.innerHTML = `<i data-lucide="file-check"></i><span>Current file: <b>${existingDoc.name || label}</b> (${formatBytes(existingDoc.sizeBytes || 0)})</span>`;
    container.appendChild(curRow);
  }

  const dropZone = mk('div', 'sp-drop-zone');
  dropZone.innerHTML = '<i data-lucide="upload-cloud" width="36" height="36" style="color:var(--primary);margin-bottom:8px;"></i>' +
    '<div style="font-size:14px;font-weight:700;color:var(--text);">Choose a file or drag & drop here</div>' +
    '<div style="font-size:12px;color:var(--text-mute);margin-top:2px;">JPG, PNG, PDF up to 10MB (auto-compressed to 100KB)</div>';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,application/pdf';
  fileInput.style.display = 'none';

  dropZone.onclick = () => fileInput.click();
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

  const previewWrap = mk('div', '');
  previewWrap.style.textAlign = 'center';
  const sizeLine = mk('div', 'pk-note');
  sizeLine.style.display = 'none';
  container.append(previewWrap, sizeLine);

  const footer = mk('div', 'adm-view-foot');
  const cancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.onclick = () => popup.close();

  const saveBtn = mk('button', 'ui-btn primary', existingDoc ? 'Replace Document' : 'Upload Document');
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

    sizeLine.style.display = 'flex';
    sizeLine.textContent = 'Compressing and optimizing document...';
    saveBtn.disabled = true;

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

        const nImg = mk('img');
        nImg.src = dataUrl;
        nImg.style.maxHeight = '140px';
        nImg.style.borderRadius = 'var(--r)';
        nImg.style.border = '1px solid var(--border)';
        previewWrap.appendChild(nImg);

        sizeLine.textContent = `Optimized size: ${formatBytes(compressedBlob.size)} (Original: ${formatBytes(file.size)})`;
      } else if (file.type === 'application/pdf') {
        const dataUrl = await blobToDataURL(file);
        readyPayload = {
          type: 'application/pdf',
          mime: 'application/pdf',
          name: file.name,
          sizeBytes: file.size,
          data: dataUrl
        };
        previewWrap.innerHTML = `<div style="color:var(--danger);"><i data-lucide="file-text" width="28" height="28"></i><div style="font-size:12px;margin-top:4px;">${file.name}</div></div>`;
        sizeLine.textContent = `PDF file size: ${formatBytes(file.size)}`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }

      saveBtn.disabled = false;
    } catch (e) {
      console.error('[student-profile] processFile failed', e);
      sizeLine.textContent = 'Optimization failed: ' + e.message;
      showToast({ type: 'error', message: e.message || 'File processing failed' });
    }
  }

  if (droppedFile) {
    processFile(droppedFile);
  }

  saveBtn.onclick = async () => {
    if (!readyPayload) return;

    if (existingDoc) {
      const ok = await confirmDialog({
        title: 'Overwrite Existing Document?',
        message: `Are you sure you want to replace "${label}" for ${s.name}? This will permanently update the stored document.`,
        confirmText: 'Overwrite document'
      });
      if (!ok) return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Uploading...';
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
        summary: `${existingDoc ? 'Replaced' : 'Uploaded'} ${label} (${readyPayload.name})`,
        changes: { [key]: { from: existingDoc ? existingDoc.name : 'none', to: readyPayload.name } },
        userEmail: authEmail,
        userRole: currentUserProfile.role,
        branchId: currentUserProfile.branchId
      }, batch);

      await batch.commit();

      showToast({ type: 'success', message: `${label} saved successfully.` });
      popup.close();

      await loadDocs();
      renderDocumentsTab();
    } catch (err) {
      console.error('[student-profile] document upload failed', err);
      showToast({ type: 'error', message: 'Upload failed: ' + (err.message || 'Save error') });
      saveBtn.disabled = false;
      saveBtn.textContent = existingDoc ? 'Replace Document' : 'Upload Document';
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
  setTxt('sp-c-branch-name', s.branchName || '-');

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

  const rows = [
    { label: 'Admission Fee', amount: snap.admission || s.admissionFee || 0 },
    { label: 'Study Material & Kit', amount: snap.material || s.materialFee || 0 },
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
  if (sched.length === 0) {
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
    const payBtn = mk('button', 'ui-btn primary sm sp-table-action-btn');
    payBtn.type = 'button';
    payBtn.title = `Record payment for ${label}`;
    payBtn.innerHTML = `<i data-lucide="${icon || 'credit-card'}"></i><span>Pay</span>`;
    payBtn.onclick = () => openRecordPaymentModal(payType);
    actionTd.appendChild(payBtn);
  } else {
    const receiptBtn = mk('button', 'ui-btn ghost sm sp-table-action-btn');
    receiptBtn.type = 'button';
    receiptBtn.title = `View receipt for ${label}`;
    receiptBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
    receiptBtn.onclick = () => {
      if (isAdmission) {
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

  // 1. Admission Fee row (At Admission)
  if (admFee > 0) {
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
      isAdmission: !matTxn
    });

    tr.append(noTd, monthTd, dueTd, schedTd, paidTd, paidOnTd, statusTd, actionTd);
    tbody.appendChild(tr);
  }

  // 3. Installments (1..N)
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
      const errMsg = mk('span', 'pf-action-disabled text-danger text-xs', 'Exam fee not set for this course in this session. Contact Super Admin.');
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

  // Initial admission payment fallback if not in subcollection
  const hasAdDoc = paymentsCache.some(p => p.type === 'AD');
  if (!hasAdDoc && currentStudent.receiptNo) {
    const dueAt = currentStudent.dueAtAdmission || {};
    const admPaid = Number(dueAt.total ?? ((dueAt.admission || 0) + (dueAt.material || 0)));
    txns.push({
      date: currentStudent.admissionDate || '',
      receiptNo: currentStudent.receiptNo,
      type: 'AD',
      amount: admPaid,
      mode: 'Cash / Bank',
      txnId: 'Admission',
      recordedAtBranchId: currentStudent.branchId || '',
      recordedAtBranchCode: currentStudent.branchCode || '',
      recordedAtBranchName: currentStudent.branchName || 'Branch',
      recordedBy: currentStudent.createdBy || '-',
      remarks: 'Admission fee & study material',
      waived: false
    });
  }

  paymentsCache.forEach((p) => txns.push(p));

  txns.sort((a, b) => {
    const da = a.date || '';
    const dbDate = b.date || '';
    return dbDate.localeCompare(da);
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

    const typeLabel = t.type === 'AD' ? 'Admission' :
      (t.type === 'IN' ? ('Inst #' + (t.installmentNo || '')) :
        (t.type === 'EX' ? 'Exam Fee' : (t.type === 'MAT' ? 'Study Material' : (t.type || 'Payment'))));

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

    let headName = t.recordedByName || '';
    if (!headName && usersCache) {
      if (emailNorm && usersCache.byEmail && usersCache.byEmail[emailNorm]) {
        headName = usersCache.byEmail[emailNorm].name || '';
      }
      if (!headName && branchId && usersCache.byBranch && usersCache.byBranch[branchId]) {
        headName = usersCache.byBranch[branchId].name || '';
      }
    }
    if (!headName && emailNorm && currentUserProfile && currentUserProfile.email && emailNorm === currentUserProfile.email.toLowerCase()) {
      headName = currentUserProfile.name || '';
    }
    if (!headName && email && email !== '-') {
      headName = t.userRole === 'superadmin' ? 'Super Admin' : 'Branch Head';
    }

    const collectorTd = mk('td', 'sp-collector-cell');
    let collectorText = branchDisplay;
    if (email && email !== '-') {
      collectorText += ' - ' + email;
    }
    if (headName) {
      collectorText += ' by ' + headName;
    }
    collectorTd.textContent = collectorText;
    collectorTd.title = (branchName || branchDisplay) + (email && email !== '-' ? ' • ' + email : '') + (headName ? ' • ' + headName : '');

    const remarksTd = mk('td', '', t.remarks || (t.waiverReason ? `Waived: ${t.waiverReason}` : '—'));

    const actionTd = mk('td', 'act');
    const receiptBtn = mk('button', 'ui-btn ghost sm sp-table-action-btn');
    receiptBtn.type = 'button';
    receiptBtn.title = 'View Receipt';
    receiptBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
    receiptBtn.onclick = () => {
      if (t.type === 'AD') {
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
 * Record Payment Popup
 */
async function openRecordPaymentModal(preselectedOption) {
  const s = currentStudent;
  if (!s) return;
  const isSuper = currentUserProfile.role === 'superadmin';
  const sched = s.feeSchedule || [];
  const snap = s?.feeSnapshot || {};
  const admFee = Number(snap.admission ?? s?.admissionFee ?? s?.dueAtAdmission?.admission ?? 0);
  const instFee = Number(snap.installment ?? s?.feeSnapshot?.installment ?? 0);
  const matFee = Number(snap.material ?? s?.materialFee ?? s?.studyMaterialFee ?? 0);
  const examFee = Number(snap.exam ?? s?.examFee ?? 0);

  // Refresh payments cache from Firestore to ensure latest accurate data
  try {
    const fresh = await fetchStudentPayments(s.id);
    if (fresh && Array.isArray(fresh)) {
      paymentsCache = fresh;
    }
  } catch (_) {}

  const typeOptions = [];

  // 1. Admission Fee (only if not yet collected and amount > 0)
  if (admFee > 0 && !isAdmissionFeePaid(admFee, paymentsCache, s)) {
    typeOptions.push({
      value: 'AD',
      label: `Admission Fee — ${formatINR(admFee)}`,
      icon: 'credit-card'
    });
  }

  // 2. Study Material Fee (only if not yet collected and amount > 0)
  if (matFee > 0 && !isMaterialFeePaid(matFee, paymentsCache, s)) {
    typeOptions.push({
      value: 'MAT',
      label: `Study Material Fee — ${formatINR(matFee)}`,
      icon: 'book-open'
    });
  }

  // 3. Installments (1..N) (only pending / uncollected installments)
  sched.forEach((it) => {
    const itNo = Number(it.no ?? it.installmentNo);
    if (!isInstallmentPaid(it, paymentsCache, s)) {
      typeOptions.push({
        value: 'IN_' + itNo,
        label: `Installment ${itNo} (${it.month || 'Month ' + itNo}) — ${formatINR(it.amount || instFee)}`,
        icon: 'credit-card'
      });
    }
  });

  // 4. Examination Fee (only if not yet collected and amount > 0, and not blocked by session fees)
  let sessionExamFee = examFee;
  let canCollectExam = examFee > 0;
  if (s.ctx === 'youth') {
    const studentSess = (sessionsCache && (sessionsCache.byId?.[s.sessionId] || sessionsCache.byName?.[(s.sessionName || '').toLowerCase().trim()])) || null;
    if (studentSess && studentSess.examFeeCollection?.started === true) {
      if (studentSess.examFeeCollection.fees && s.courseId && Object.prototype.hasOwnProperty.call(studentSess.examFeeCollection.fees, s.courseId)) {
        sessionExamFee = Number(studentSess.examFeeCollection.fees[s.courseId]);
      } else {
        canCollectExam = false; // Exam fee not set for this course in this session.
      }
    }
  }

  if (canCollectExam && sessionExamFee > 0 && !isExamFeePaid(sessionExamFee, paymentsCache, s)) {
    typeOptions.push({
      value: 'EX',
      label: `Examination Fee — ${formatINR(sessionExamFee)}`,
      icon: 'award'
    });
  }

  if (preselectedOption === 'EX' && !canCollectExam) {
    showToast({ type: 'error', message: 'Exam fee not set for this course in this session. Contact Super Admin.' });
    return;
  }

  // If all fee heads are already collected, notify user
  if (typeOptions.length === 0) {
    showToast({ type: 'info', message: 'All scheduled fees for this student have already been collected.' });
    return;
  }

  let initialTypeVal = typeOptions[0]?.value;
  if (preselectedOption) {
    let targetVal = '';
    if (preselectedOption === 'AD') targetVal = 'AD';
    else if (preselectedOption === 'MAT') targetVal = 'MAT';
    else if (preselectedOption === 'EX') targetVal = 'EX';
    else if (String(preselectedOption).startsWith('IN_')) targetVal = String(preselectedOption);
    else targetVal = 'IN_' + preselectedOption;

    const found = typeOptions.find(o => o.value === targetVal);
    if (found) {
      initialTypeVal = found.value;
    } else {
      showToast({ type: 'info', message: 'Selected fee item has already been collected.' });
    }
  }

  const popup = openPopup({
    title: 'Record Payment',
    subtitle: `${s.name} • ${s.studentId || s.id}`,
    icon: 'credit-card',
    wide: true
  });

  const form = mk('form', 'sp-modal-form');
  form.onsubmit = (e) => e.preventDefault();

  // Payment Type (customized UI dropdown)
  const typeGroup = mk('div', 'ui-field');
  const typeLabelRow = mk('div', 'ui-label-row');
  const typeLbl = mk('label', 'ui-label');
  typeLbl.textContent = 'Payment Type ';
  const typeEm = mk('em', '', '*');
  typeLbl.appendChild(typeEm);
  typeLabelRow.appendChild(typeLbl);

  const typeHost = mk('div', '');
  typeGroup.append(typeLabelRow, typeHost);

  const typeSel = createSelect(typeHost, {
    options: typeOptions,
    value: initialTypeVal,
    ariaLabel: 'Payment Type',
    onChange: () => recalculate()
  });

  // Summary box (Soft tinted area, no harsh borders)
  const infoBox = mk('div', 'sp-pay-summary-box');

  const cellSched = mk('div', 'sp-stat-col');
  cellSched.innerHTML = '<span class="sp-kv-label">Scheduled Fee</span><span class="sp-stat-val">Rs 0.00</span>';
  const baseValEl = cellSched.querySelector('.sp-stat-val');

  const cellFine = mk('div', 'sp-stat-col');
  cellFine.innerHTML = '<span class="sp-kv-label">Late Fine</span><span class="sp-stat-val">Rs 0.00</span>';
  const fineValEl = cellFine.querySelector('.sp-stat-val');

  const cellTotal = mk('div', 'sp-stat-col');
  cellTotal.innerHTML = '<span class="sp-kv-label">Total Payable</span><span class="sp-stat-val" style="font-weight:600;">Rs 0.00</span>';
  const totalValEl = cellTotal.querySelector('.sp-stat-val');

  infoBox.append(cellSched, cellFine, cellTotal);

  const amtInput = document.createElement('input');
  amtInput.type = 'hidden';
  const lateInput = document.createElement('input');
  lateInput.type = 'hidden';

  // Super Admin Waiver Option
  let waiveGroup = null;
  let waiveCheckbox = null;
  let waiveReasonInput = null;

  if (isSuper) {
    waiveGroup = mk('div', '');
    waiveGroup.style.background = 'var(--warning-soft)';
    waiveGroup.style.padding = '10px 14px';
    waiveGroup.style.borderRadius = 'var(--r)';
    waiveGroup.style.border = '1px solid color-mix(in srgb, var(--warning) 30%, transparent)';
    waiveGroup.style.margin = '0';
    waiveGroup.style.marginTop = '-4px';

    const checkLabel = mk('label', 'pk-check-row');
    checkLabel.style.margin = '0';
    waiveCheckbox = document.createElement('input');
    waiveCheckbox.type = 'checkbox';
    checkLabel.append(waiveCheckbox, mk('span', 'font-semibold', 'Waive late fee fine (Super Admin)'));

    const reasonWrap = mk('div', 'ui-field');
    reasonWrap.style.marginTop = '10px';
    reasonWrap.hidden = true;
    const rLabelRow = mk('div', 'ui-label-row');
    const rLbl = mk('label', 'ui-label', 'Audit Waiver Reason *');
    rLabelRow.appendChild(rLbl);
    const rInputWrap = mk('div', 'ui-input-wrap');
    waiveReasonInput = document.createElement('input');
    waiveReasonInput.type = 'text';
    waiveReasonInput.placeholder = 'Enter justification for waiving fine';
    waiveReasonInput.className = 'ui-input';
    waiveReasonInput.style.paddingLeft = '12px';
    rInputWrap.appendChild(waiveReasonInput);
    reasonWrap.append(rLabelRow, rInputWrap);

    waiveCheckbox.onchange = () => {
      reasonWrap.hidden = !waiveCheckbox.checked;
      recalculate();
    };

    waiveGroup.append(checkLabel, reasonWrap);
  }

  // Payment Mode (customized UI dropdown)
  const modeGroup = mk('div', 'ui-field');
  const modeLabelRow = mk('div', 'ui-label-row');
  const modeLbl = mk('label', 'ui-label', 'Payment Mode *');
  modeLabelRow.appendChild(modeLbl);
  const modeHost = mk('div', '');
  modeGroup.append(modeLabelRow, modeHost);

  const MODE_OPTIONS = [
    { value: 'cash', label: 'Cash', icon: 'banknote' },
    { value: 'upi', label: 'UPI', icon: 'smartphone' },
    { value: 'card', label: 'Card', icon: 'credit-card' },
    { value: 'bank', label: 'Bank Transfer', icon: 'building' },
    { value: 'cheque', label: 'Cheque', icon: 'file-text' }
  ];

  // Transaction ID
  const txnGroup = mk('div', 'ui-field');
  const txnLabelRow = mk('div', 'ui-label-row');
  const txnLabel = mk('label', 'ui-label');
  txnLabelRow.appendChild(txnLabel);
  const txnWrap = mk('div', 'ui-input-wrap');
  const txnInput = document.createElement('input');
  txnInput.type = 'text';
  txnInput.className = 'ui-input';
  txnInput.style.paddingLeft = '12px';
  txnWrap.appendChild(txnInput);
  txnGroup.append(txnLabelRow, txnWrap);

  const onModeChange = (modeVal) => {
    const isCash = modeVal === 'cash';
    txnInput.disabled = isCash;
    txnInput.required = false;
    if (isCash) {
      txnInput.value = '';
      txnLabel.innerHTML = 'Transaction / Reference ID <span style="font-weight: normal; color: var(--text-mute); font-size: 11.5px;">(N/A for Cash)</span>';
      txnInput.placeholder = 'Not applicable for Cash payments';
      txnWrap.classList.add('is-disabled');
    } else {
      txnLabel.innerHTML = 'Transaction / Reference ID <span style="font-weight: normal; color: var(--text-mute); font-size: 11.5px;">(Optional)</span>';
      txnInput.placeholder = 'Optional for ' + modeVal.toUpperCase();
      txnWrap.classList.remove('is-disabled');
    }
  };

  const modeSel = createSelect(modeHost, {
    options: MODE_OPTIONS,
    value: 'cash',
    ariaLabel: 'Payment Mode',
    onChange: onModeChange
  });

  // Initialize Cash state (disabled)
  onModeChange('cash');

  // Mode & Transaction ID Row (Side by side)
  const modeTxnRow = mk('div', 'sp-form-row-2');
  modeTxnRow.append(modeGroup, txnGroup);

  // Payment Date
  const dateGroup = mk('div', 'ui-field');
  const dateLabelRow = mk('div', 'ui-label-row');
  const dateLbl = mk('label', 'ui-label', 'Payment Date *');
  dateLabelRow.appendChild(dateLbl);
  const dateWrap = mk('div', 'ui-input-wrap');
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'ui-input';
  dateInput.style.paddingLeft = '12px';
  dateInput.value = todayISO();
  dateWrap.appendChild(dateInput);
  dateGroup.append(dateLabelRow, dateWrap);

  // Remarks
  const remGroup = mk('div', 'ui-field');
  const remLabelRow = mk('div', 'ui-label-row');
  const remLbl = mk('label', 'ui-label', 'Remarks / Note');
  remLabelRow.appendChild(remLbl);
  const remWrap = mk('div', 'ui-input-wrap top');
  const remInput = document.createElement('textarea');
  remInput.className = 'ui-input';
  remInput.rows = 3;
  remInput.style.padding = '8px 12px';
  remInput.style.height = '72px';
  remInput.style.minHeight = '72px';
  remInput.style.resize = 'vertical';
  remInput.placeholder = 'Optional notes';
  remWrap.appendChild(remInput);
  remGroup.append(remLabelRow, remWrap);

  function recalculate() {
    const val = typeSel.value;
    let baseAmt = 0;
    let fineAmt = 0;

    if (val === 'AD') {
      baseAmt = admFee;
      fineAmt = 0;
    } else if (val === 'EX') {
      baseAmt = sessionExamFee;
      fineAmt = 0;
    } else if (val === 'MAT') {
      baseAmt = matFee;
      fineAmt = 0;
    } else if (val && val.startsWith('IN_')) {
      const instNo = Number(val.slice(3));
      const schedItem = sched.find(it => Number(it.no) === instNo);
      baseAmt = schedItem ? Number(schedItem.amount || instFee) : instFee;
      if (schedItem) {
        fineAmt = calculateLateFee(schedItem.due, dateInput.value || todayISO());
      }
    }

    if (waiveCheckbox && waiveCheckbox.checked) {
      fineAmt = 0;
    }

    amtInput.value = baseAmt;
    lateInput.value = fineAmt;
    totalValEl.textContent = formatINR(baseAmt + fineAmt);
    baseValEl.textContent = formatINR(baseAmt);
    fineValEl.textContent = formatINR(fineAmt);
    if (fineAmt > 0) {
      fineValEl.style.color = '#c92a2a';
    } else {
      fineValEl.style.color = 'inherit';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  dateInput.onchange = recalculate;
  recalculate();

  form.append(typeGroup, infoBox, amtInput, lateInput);
  if (waiveGroup) form.appendChild(waiveGroup);
  form.append(modeTxnRow, dateGroup, remGroup);

  const footer = mk('div', 'adm-view-foot');
  const cancelBtn = mk('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.onclick = () => popup.close();

  const saveBtn = mk('button', 'ui-btn primary', 'Confirm & Record Payment');
  saveBtn.type = 'button';

  footer.append(cancelBtn, saveBtn);
  form.appendChild(footer);
  popup.container.appendChild(form);

  saveBtn.onclick = async () => {
    if (waiveCheckbox && waiveCheckbox.checked && !waiveReasonInput.value.trim()) {
      showToast({ type: 'error', message: 'Waiver reason is required to waive late fine.' });
      waiveReasonInput.focus();
      return;
    }

    const val = typeSel.value;
    if (!val) {
      showToast({ type: 'error', message: 'Please select a valid payment type.' });
      return;
    }
    const isExam = val === 'EX';
    const isMat = val === 'MAT';
    const isAdm = val === 'AD';
    const instNo = (isExam || isMat || isAdm) ? null : Number(val.slice(3));
    const payType = isExam ? 'EX' : (isMat ? 'MAT' : (isAdm ? 'AD' : 'IN'));
    const baseAmount = Number(amtInput.value);
    const lateAmount = Number(lateInput.value);

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Processing...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    try {
      const authEmail = getAuthEmail();
      const res = await runTransaction(db, async (tx) => {
        return await recordPaymentTx(tx, {
          studentDoc: s,
          type: payType,
          installmentNo: instNo,
          amount: baseAmount,
          lateFeeAmount: lateAmount,
          mode: modeSel.value,
          txnId: txnInput.value.trim(),
          remarks: remInput.value.trim(),
          waived: waiveCheckbox ? waiveCheckbox.checked : false,
          waiverReason: waiveCheckbox && waiveCheckbox.checked ? waiveReasonInput.value.trim() : '',
          paymentDate: dateInput.value,
          userEmail: authEmail,
          userName: currentUserProfile.name || '',
          userRole: currentUserProfile.role,
          branchId: currentUserProfile.branchId || s.branchId,
          branchCode: s.branchCode || '',
          branchName: s.branchName
        });
      });

      showToast({ type: 'success', message: 'Payment recorded! Receipt No: ' + res.receiptNo });
      popup.close();

      await Promise.all([
        resolveStudent(s.studentId || s.id).then(fresh => { if (fresh) currentStudent = fresh; }),
        loadPayments()
      ]);

      renderMetrics();
      renderPaymentsTab();
    } catch (err) {
      console.error('[student-profile] payment transaction failed', err);
      showToast({ type: 'error', message: 'Payment failed: ' + (err.message || 'Transaction error') });
      saveBtn.disabled = false;
      saveBtn.textContent = 'Confirm & Record Payment';
    }
  };
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
  const popup = openPopup({
    title: 'Notify Payment Dues',
    subtitle: `${s.name} • Outstanding: ${formatINR(outstanding)}`,
    icon: 'bell'
  });

  const branchPhone = currentUserProfile.branchPhone || 'our branch office';
  const defaultMsg =
    `Dear ${s.name},\n\n` +
    `This is a friendly reminder regarding your course "${s.courseName || 'Computer Course'}" at ${s.branchName || 'Unique Infotech'}.\n` +
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
