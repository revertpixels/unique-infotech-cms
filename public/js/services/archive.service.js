// archive.service.js — Session-wise Youth Centre archive exporter, local ZIP verifier,
// permanent append-only archiveLogs manager, and reminder helpers.
// Phase 2 deletion remains disabled until approved via ENABLE_ARCHIVE_SESSION_DELETE = false.

import { auth, db, storage } from '../config/firebase-config.js';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  getCountFromServer,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  ref as storageRef,
  getDownloadURL
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
import { APP_VERSION } from '../core/app.js?v=1.8.184';
import { todayISO, installmentSchedule, getOrgTimezone } from '../utils/session-rules.js?v=1.8.184';
import {
  calculateStudentFinancials,
  evaluateYouthStudentDues,
  normalizeYouthPaymentsLedger,
  installmentCourseFee,
  installmentBalanceDue
} from './payment.service.js?v=1.8.184';
import {
  loadUsersDirectory,
  resolveUserDisplay,
  getUserTitle
} from './user-directory.service.js?v=1.8.184';
import { formatPersonName, formatGenderDisplay } from '../utils/formatter.js?v=1.8.184';
import { getStudentPhotoSrc, getStudentDocRecord, getStudentDocSrc, getStudentDocMime } from '../utils/student-media.js?v=1.8.184';
import { buildOfflineViewerAssets } from '../utils/archive-viewer-builder.js?v=1.8.184';
import { buildYouthReceiptData } from '../utils/admission-receipt.js?v=1.8.184';

/** Feature flag keeping Phase 2 session deletion OFF until Phase 1 is verified and approved. */
export const ENABLE_ARCHIVE_SESSION_DELETE = false;

const PBKDF2_ITERATIONS = 600000;
const CHUNK_SUBCOLLECTION_READS = 10;
const ID_DOC_KEY_RE = /^(aadhaar|aadhar|id|idproof|idcard|pan|voter|passport)/i;

let fflateLoader = null;

const VIEWER_CSS_PATHS = [
  'css/main.css',
  'css/base/reset.css',
  'css/base/variables.css',
  'css/base/typography.css',
  'css/components/ui-kit.css',
  'css/components/toast.css',
  'css/components/list-page.css',
  'css/components/course-view.css',
  'css/components/doc-card.css',
  'css/components/badges.css',
  'css/components/buttons.css',
  'css/components/forms.css',
  'css/components/cards.css',
  'css/components/dropdown.css',
  'css/components/tables.css',
  'css/components/multi-select.css',
  'css/layout/grid.css',
  'css/layout/sidebar.css',
  'css/layout/topbar.css',
  'css/pages/settings.css',
  'css/pages/branches.css',
  'css/pages/branch-heads.css',
  'css/pages/admissions.css',
  'css/pages/admission-receipt.css',
  'css/pages/batches.css',
  'css/pages/sessions.css',
  'css/pages/dashboard.css',
  'css/pages/school-admissions.css',
  'css/pages/school-admission-receipt.css',
  'css/pages/school-students.css',
  'css/pages/school-fees.css',
  'css/pages/school-fee-payment.css',
  'css/pages/school-transfer.css',
  'css/pages/school-end.css',
  'css/pages/school-break.css',
  'css/pages/school-delete.css',
  'css/pages/student-profile.css',
  'css/pages/pay-fees.css',
  'css/pages/payment-receipt.css',
  'css/pages/financial-reports.css',
  'css/pages/archives.css'
];

const VIEWER_BINARY_ASSETS = [
  { src: 'vendor/archive/fonts.css', dest: 'viewer/css/fonts.css', compress: true, isText: true },
  { src: 'vendor/archive/fonts/ibm-plex-sans-1.woff2', dest: 'viewer/fonts/ibm-plex-sans-1.woff2', compress: false },
  { src: 'vendor/archive/fonts/libre-franklin-2.woff2', dest: 'viewer/fonts/libre-franklin-2.woff2', compress: false },
  { src: 'vendor/archive/fonts/plus-jakarta-sans-3.woff2', dest: 'viewer/fonts/plus-jakarta-sans-3.woff2', compress: false },
  { src: 'vendor/archive/lucide.min.js', dest: 'viewer/vendor/lucide.min.js', compress: true },
  { src: 'vendor/archive/pdfmake.min.js', dest: 'viewer/vendor/pdfmake.min.js', compress: true },
  { src: 'vendor/vfs_fonts.js', dest: 'viewer/vendor/vfs_fonts.js', compress: true },
  { src: 'vendor/archive/html2canvas.min.js', dest: 'viewer/vendor/html2canvas.min.js', compress: true },
  { src: 'vendor/jspdf.umd.min.js', dest: 'viewer/vendor/jspdf.umd.min.js', compress: true }
];

let viewerStaticCache = null;

async function collectViewerStaticAssets() {
  if (viewerStaticCache) return viewerStaticCache;
  const enc = new TextEncoder();
  const out = [];

  await Promise.all(VIEWER_CSS_PATHS.map(async (rel) => {
    try {
      const resp = await fetch(`/${rel}?v=${APP_VERSION}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      let text = await resp.text();
      text = text.replace(/@import\s+url\([^)]*fonts\.googleapis[^)]*\)\s*;?/gi, '/* local woff2 loaded by viewer/css/fonts.css */');
      out.push({ path: `viewer/${rel}`, bytes: enc.encode(text), compress: true });
    } catch (err) {
      console.warn('[archives] CSS bundle warning:', rel, err?.message || err);
    }
  }));

  await Promise.all(VIEWER_BINARY_ASSETS.map(async (item) => {
    try {
      const resp = await fetch(`/${item.src}?v=${APP_VERSION}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      out.push({ path: item.dest, bytes: new Uint8Array(buf), compress: Boolean(item.compress) });
    } catch (err) {
      console.warn('[archives] asset bundle warning:', item.src, err?.message || err);
    }
  }));

  viewerStaticCache = out;
  return out;
}

/**
 * Dynamically loads the vendored local fflate UMD bundle (no CDN).
 */
export function loadFflate() {
  if (typeof window !== 'undefined' && window.fflate && typeof window.fflate.Zip === 'function') {
    return Promise.resolve(window.fflate);
  }
  if (!fflateLoader) {
    fflateLoader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `/vendor/fflate.umd.js?v=${APP_VERSION}`;
      s.onload = () => {
        if (window.fflate && typeof window.fflate.Zip === 'function') {
          resolve(window.fflate);
        } else {
          fflateLoader = null;
          reject(new Error('ZIP engine failed to initialize cleanly.'));
        }
      };
      s.onerror = () => {
        fflateLoader = null;
        reject(new Error('Could not load bundled ZIP library (/vendor/fflate.umd.js).'));
      };
      document.head.appendChild(s);
    });
  }
  return fflateLoader;
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function maskAadhaarValue(raw) {
  if (!raw) return '-';
  const clean = String(raw).replace(/\D/g, '');
  if (clean.length < 4) return '-';
  return `XXXX XXXX ${clean.slice(-4)}`;
}

function nowISTString() {
  try {
    const tz = getOrgTimezone() || 'Asia/Kolkata';
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: tz,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(new Date()) + ' IST';
  } catch (_) {
    return new Date().toISOString();
  }
}

function daysBetweenISO(fromISO, toISO) {
  if (!fromISO || !toISO) return null;
  const a = String(fromISO).slice(0, 10).split('-').map(Number);
  const b = String(toISO).slice(0, 10).split('-').map(Number);
  if (a.length !== 3 || b.length !== 3) return null;
  const ua = Date.UTC(a[0], a[1] - 1, a[2]);
  const ub = Date.UTC(b[0], b[1] - 1, b[2]);
  if (!Number.isFinite(ua) || !Number.isFinite(ub)) return null;
  return Math.round((ub - ua) / 86400000);
}

/**
 * Computes real session status strictly from IST endDate rather than manual flags alone.
 */
export function computeArchiveSessionStatus(session, today = todayISO()) {
  if (!session) return { key: 'unknown', label: 'Unknown', tone: 'muted' };
  const raw = String(session.status || '').toLowerCase();
  if (raw === 'deleted') {
    return { key: 'deleted', label: 'Deleted - archive only', tone: 'muted' };
  }
  if (raw === 'locked_for_deletion') {
    return { key: 'locked_for_deletion', label: 'Locked for deletion', tone: 'warning' };
  }
  if (session.endDate && String(session.endDate) < today) {
    return { key: 'completed', label: 'Completed', tone: 'paid' };
  }
  if (session.startDate && String(session.startDate) > today) {
    return { key: 'upcoming', label: 'Upcoming', tone: 'sky' };
  }
  return { key: 'ongoing', label: 'Ongoing', tone: 'neutral' };
}

function tsSecondsOf(val) {
  if (!val) return 0;
  if (typeof val.seconds === 'number') return val.seconds;
  if (typeof val.toMillis === 'function') return Math.floor(val.toMillis() / 1000);
  if (val instanceof Date) return Math.floor(val.getTime() / 1000);
  return 0;
}

function sanitizeFilenamePart(str, fallback = 'Item') {
  const clean = String(str || '')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || fallback;
}

export function buildArchiveZipFilename(sessionName, scopeTag, dateISO = todayISO()) {
  const sPart = sanitizeFilenamePart(sessionName, 'Session');
  const bPart = sanitizeFilenamePart(scopeTag || 'AllBranches', 'AllBranches');
  const dPart = String(dateISO || todayISO()).slice(0, 10);
  return `UniqueInfotech_Youth_${sPart}_${bPart}_${dPart}.zip`;
}

export function formatBytesCompact(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function sha256HexFromBuffer(buf) {
  return crypto.subtle.digest('SHA-256', buf).then((digest) => {
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  });
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const clean = String(b64 || '').replace(/\s+/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function mimeToExt(mime = '') {
  const m = String(mime || '').toLowerCase();
  if (m.includes('webp')) return 'webp';
  if (m.includes('png')) return 'png';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('gif')) return 'gif';
  return 'jpg';
}

function decodeDocBinary(docData = {}) {
  const raw = String(docData.data || docData.Data || docData.base64 || '').trim();
  if (!raw) return null;
  let mime = String(docData.type || docData.mime || 'image/jpeg').toLowerCase();
  let b64 = raw;
  const m = raw.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) {
    mime = m[1].toLowerCase();
    b64 = m[2];
  }
  try {
    const bytes = base64ToBytes(b64);
    if (!bytes.length) return null;
    return { bytes, mime, ext: mimeToExt(mime) };
  } catch (_) {
    return null;
  }
}

async function fetchUrlBinaryWithRetry(url, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const mime = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
      return { bytes: new Uint8Array(buf), mime, ext: mimeToExt(mime) };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw lastErr || new Error('Download failed');
}

function isIdDocumentKey(key = '') {
  return ID_DOC_KEY_RE.test(String(key || '').trim());
}

function canonicalDocKey(rawKey = '') {
  const k = String(rawKey || '').trim();
  const low = k.toLowerCase();
  if (/^(photo|passportphoto|passport_photo|studentphoto|avatar|profilephoto|image|pic)$/.test(low)) return 'photo';
  if (/^(signature|studentsignature|student_signature|sign|sig)$/.test(low)) return 'signature';
  if (/^(aadhaar|aadhar|aadhaarcard|aadhaar_card|idproof|id_proof)$/.test(low)) return 'aadhaar';
  if (/^(dobproof|dob_proof|dob|birthcertificate|ageproof)$/.test(low)) return 'dobProof';
  if (/^(marksheet|lastmarksheet|last_marksheet|academicmarksheet|academic_marksheet|qualification)$/.test(low)) return 'marksheet';
  return k || 'doc';
}

function friendlyDocLabel(key = '', rawLabel = '') {
  const canon = canonicalDocKey(key);
  const labels = {
    photo: 'Passport Photo',
    signature: 'Student Signature',
    dobProof: 'Date of Birth Proof',
    aadhaar: 'Aadhaar Card',
    marksheet: 'Academic Marksheet'
  };
  const rawTrim = String(rawLabel || '').trim();
  if (labels[canon] && (!rawTrim || rawTrim.toLowerCase() === String(key || '').toLowerCase() || rawTrim.toLowerCase() === canon.toLowerCase())) {
    return labels[canon];
  }
  if (rawTrim) return rawTrim;
  return labels[canon] || formatPersonName(String(key).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')) || 'Document';
}

async function resolveDocBinaryWithFallbacks(d, fallbackSrc = '') {
  const mimeHint = getStudentDocMime(d);
  const docSrc = getStudentDocSrc(d, mimeHint) || fallbackSrc || '';
  let bin = decodeDocBinary({
    data: docSrc && docSrc.startsWith('data:') ? docSrc : '',
    type: mimeHint
  });
  let remoteUrl = (docSrc && /^https?:\/\//i.test(docSrc))
    ? docSrc
    : (d?.url && /^https?:\/\//i.test(d.url) ? d.url : '');
  if (!bin && !remoteUrl && d?.storagePath && storage) {
    try {
      remoteUrl = await getDownloadURL(storageRef(storage, d.storagePath));
    } catch (_) {}
  }
  if (!bin && remoteUrl) {
    bin = await fetchUrlBinaryWithRetry(remoteUrl, 2);
  }
  return { bin, remoteUrl };
}

function csvCell(v) {
  let s = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsvText(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

function scrubStudentForArchive(rawStudent = {}, { includeIdDocs = false } = {}) {
  const clean = { ...rawStudent };
  delete clean.data;
  delete clean.photo;
  delete clean.photoUrl;
  delete clean.photoDataUrl;
  delete clean.signature;
  delete clean.signatureUrl;
  if (clean.docs && typeof clean.docs === 'object' && !Array.isArray(clean.docs)) {
    const flags = {};
    for (const [k, v] of Object.entries(clean.docs)) {
      flags[k] = Boolean(v);
    }
    clean.docs = flags;
  }
  const rawAadhaar = clean.aadhaar || clean.aadhaarNo || clean.aadhaarNumber || '';
  clean.aadhaarMasked = includeIdDocs ? maskAadhaarValue(rawAadhaar) : '-';
  delete clean.aadhaar;
  delete clean.aadhaarNo;
  delete clean.aadhaarNumber;
  return clean;
}

function buildArchiveReports(students = [], ledger = [], branchesById = {}, coursesById = {}) {
  const branchMap = new Map();
  const courseMap = new Map();
  const modeMap = new Map();

  for (const s of students) {
    const bId = s.branchId || 'UNKNOWN';
    if (!branchMap.has(bId)) {
      const bObj = branchesById[bId] || {};
      branchMap.set(bId, {
        branchId: bId,
        code: s.branchCode || bObj.code || bObj.branchCode || bObj.shortCode || '',
        name: s.branchName || bObj.name || bId,
        students: 0,
        receipts: 0,
        collected: 0
      });
    }
    branchMap.get(bId).students += 1;

    const cId = s.courseId || s.courseCode || 'UNKNOWN';
    if (!courseMap.has(cId)) {
      const cObj = coursesById[cId] || {};
      courseMap.set(cId, {
        courseId: cId,
        code: cObj.courseCode || cObj.code || s.courseCode || '',
        name: s.courseName || cObj.name || cId,
        students: 0,
        collected: 0
      });
    }
    courseMap.get(cId).students += 1;
  }

  for (const row of ledger) {
    if (row.isPureWaiver) continue;
    const recv = Number(row.totalReceived || 0);
    const bId = row.branchId || 'UNKNOWN';
    if (!branchMap.has(bId)) {
      branchMap.set(bId, {
        branchId: bId,
        code: row.branchCode || '',
        name: row.branchName || bId,
        students: 0,
        receipts: 0,
        collected: 0
      });
    }
    branchMap.get(bId).receipts += 1;
    branchMap.get(bId).collected += recv;

    const cId = row.courseId || row.courseCode || 'UNKNOWN';
    if (!courseMap.has(cId)) {
      courseMap.set(cId, {
        courseId: cId,
        code: row.courseCode || '',
        name: row.courseName || cId,
        students: 0,
        collected: 0
      });
    }
    courseMap.get(cId).collected += recv;

    const modeKey = String(row.mode || 'cash').toLowerCase().trim() || 'cash';
    if (!modeMap.has(modeKey)) {
      modeMap.set(modeKey, { mode: modeKey, count: 0, amount: 0 });
    }
    modeMap.get(modeKey).count += 1;
    modeMap.get(modeKey).amount += recv;
  }

  const byBranch = Array.from(branchMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const byCourse = Array.from(courseMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const byMode = Array.from(modeMap.values()).sort((a, b) => b.amount - a.amount);
  return { byBranch, byCourse, byMode };
}

/**
 * Computes user-friendly archive reminder state for both the Dashboard and Archives page.
 */
export function computeArchiveReminders(sessions = [], logs = [], today = todayISO()) {
  const downloadLogs = (logs || []).filter((l) => l.action === 'DOWNLOAD');
  const downloadedSessionIds = new Set(downloadLogs.map((l) => l.sessionId).filter(Boolean));
  const completedSessions = (sessions || []).filter((s) => computeArchiveSessionStatus(s, today).key === 'completed');
  const unarchivedCompleted = completedSessions.filter((s) => !downloadedSessionIds.has(s.id));

  let latestDownloadDate = '';
  for (const log of downloadLogs) {
    const dStr = String(log.createdAtISO || '').slice(0, 10);
    if (dStr && (!latestDownloadDate || dStr > latestDownloadDate)) {
      latestDownloadDate = dStr;
    }
  }
  const daysSinceLast = latestDownloadDate ? daysBetweenISO(latestDownloadDate, today) : null;
  const staleArchive = Boolean(downloadLogs.length > 0 && daysSinceLast != null && daysSinceLast > 30);

  return {
    completedCount: completedSessions.length,
    unarchivedCount: unarchivedCompleted.length,
    unarchivedNames: unarchivedCompleted.map((s) => s.name || s.id),
    latestDownloadDate,
    daysSinceLast,
    staleArchive
  };
}

/**
 * Loads Youth sessions (including archived), scoped branches/courses/batches,
 * and permanent archiveLogs (branch-isolated for branch_head).
 */
export async function loadArchiveOverviewData({ profile } = {}) {
  const isSuper = profile?.role === 'superadmin';
  const isBranchHead = profile?.role === 'branch_head' && Boolean(profile?.branchId);
  if (!isSuper && !isBranchHead) {
    throw new Error('Archives access is limited to authorised Youth Centre staff.');
  }

  const branchesPromise = isBranchHead
    ? getDoc(doc(db, 'branches', profile.branchId)).then((d) => (d.exists() ? [{ id: d.id, ...d.data() }] : []))
    : getDocs(collection(db, 'branches')).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));

  const logsPromise = isBranchHead
    ? getDocs(query(collection(db, 'archiveLogs'), where('branchId', '==', profile.branchId)))
      .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    : getDocs(query(collection(db, 'archiveLogs'), orderBy('createdAt', 'desc'), limit(250)))
      .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));

  const [sessSnap, branches, coursesSnap, batchesSnap, logs] = await Promise.all([
    getDocs(query(collection(db, 'sessions'), where('ctx', '==', 'youth'))),
    branchesPromise,
    getDocs(query(collection(db, 'courses'), where('ctx', '==', 'youth'))),
    getDocs(query(collection(db, 'batches'), where('ctx', '==', 'youth'))),
    logsPromise.catch((err) => {
      console.warn('[archives] archiveLogs load warning:', err && err.code ? err.code : err);
      return [];
    }),
    loadUsersDirectory({ forceRefresh: false })
  ]);

  const sessions = sessSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

  const courses = coursesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const batches = batchesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  branches.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  logs.sort((a, b) => {
    const ta = tsSecondsOf(a.createdAt) || Date.parse(a.createdAtISO || '') / 1000 || 0;
    const tb = tsSecondsOf(b.createdAt) || Date.parse(b.createdAtISO || '') / 1000 || 0;
    return tb - ta;
  });

  // Live student count per session via aggregate getCountFromServer (zero student doc reads)
  const studentCounts = {};
  await Promise.all(sessions.map(async (s) => {
    try {
      const qCount = isBranchHead
        ? query(collection(db, 'students'), where('ctx', '==', 'youth'), where('sessionId', '==', s.id), where('branchId', '==', profile.branchId))
        : query(collection(db, 'students'), where('ctx', '==', 'youth'), where('sessionId', '==', s.id));
      const agg = await getCountFromServer(qCount);
      studentCounts[s.id] = Number(agg.data().count || 0);
    } catch (_) {
      studentCounts[s.id] = null;
    }
  }));

  return {
    sessions,
    branches,
    courses,
    batches,
    logs,
    studentCounts,
    reminders: computeArchiveReminders(sessions, logs)
  };
}

/**
 * Lightweight dashboard reminder loader (0 student reads — only Youth sessions & archiveLogs).
 */
export async function loadDashboardArchiveReminder({ profile } = {}) {
  const isSuper = profile?.role === 'superadmin';
  const isBranchHead = profile?.role === 'branch_head' && Boolean(profile?.branchId);
  if (!isSuper && !isBranchHead) return null;
  try {
    const [sessSnap, logSnap] = await Promise.all([
      getDocs(query(collection(db, 'sessions'), where('ctx', '==', 'youth'))),
      isBranchHead
        ? getDocs(query(collection(db, 'archiveLogs'), where('branchId', '==', profile.branchId)))
        : getDocs(query(collection(db, 'archiveLogs'), orderBy('createdAt', 'desc'), limit(120)))
    ]);
    const sessions = sessSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const logs = logSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return computeArchiveReminders(sessions, logs);
  } catch (err) {
    console.warn('[archives] dashboard reminder skipped:', err && err.code ? err.code : err);
    return null;
  }
}

/**
 * Reads all data for a single Youth session ONCE (scoped to branch for branch_head),
 * evaluates totals/overdue using shared payment.service.js rules, decodes base64 docs
 * to binary files without duplicating base64 into archive-data/JSON, and prepares the
 * pre-download summary + in-memory export snapshot.
 */
export async function scanSessionForExport({
  session,
  profile,
  allBranches = [],
  allCourses = [],
  allBatches = [],
  scopeType = 'full',
  selectedBranchIds = [],
  onProgress,
  isCancelled
} = {}) {
  if (!session || !session.id) throw new Error('Select a valid Youth session.');
  const isSuper = profile?.role === 'superadmin';
  const isBranchHead = profile?.role === 'branch_head' && Boolean(profile?.branchId);
  if (!isSuper && !isBranchHead) throw new Error('Only authorised Youth staff can archive sessions.');

  const effectiveScope = isBranchHead ? 'branch' : (scopeType === 'branches' ? 'branches' : 'full');
  const includeIdDocs = true;

  const branchSet = isBranchHead
    ? new Set([profile.branchId])
    : (effectiveScope === 'branches' ? new Set(selectedBranchIds.filter(Boolean)) : null);

  if (effectiveScope === 'branches' && (!branchSet || branchSet.size === 0)) {
    throw new Error('Select at least one branch to export.');
  }

  let firestoreReads = 0;
  const emit = (pct, label) => {
    if (typeof onProgress === 'function') onProgress({ pct, label });
  };

  emit(5, 'Reading session students...');

  // Query students cleanly respecting Firestore branch isolation rules
  let stSnap;
  if (isBranchHead) {
    stSnap = await getDocs(query(
      collection(db, 'students'),
      where('ctx', '==', 'youth'),
      where('sessionId', '==', session.id),
      where('branchId', '==', profile.branchId)
    ));
  } else if (branchSet && branchSet.size === 1) {
    const onlyBr = Array.from(branchSet)[0];
    stSnap = await getDocs(query(
      collection(db, 'students'),
      where('ctx', '==', 'youth'),
      where('sessionId', '==', session.id),
      where('branchId', '==', onlyBr)
    ));
  } else {
    stSnap = await getDocs(query(
      collection(db, 'students'),
      where('ctx', '==', 'youth'),
      where('sessionId', '==', session.id)
    ));
  }
  firestoreReads += Math.max(1, stSnap.size);

  if (isCancelled && isCancelled()) throw new Error('CANCELLED');

  const rawStudents = stSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => !branchSet || branchSet.has(s.branchId));

  // Scope branches, courses, batches & org config (1 read for org_config)
  let org = (window.APP_CACHE && window.APP_CACHE.org) || null;
  if (!org) {
    try {
      const orgSnap = await getDoc(doc(db, 'settings', 'org_config'));
      firestoreReads += 1;
      org = orgSnap.exists() ? orgSnap.data() : {};
    } catch (_) {
      org = {};
    }
  }

  const branches = branchSet
    ? allBranches.filter((b) => branchSet.has(b.id))
    : allBranches.slice();
  const branchesById = {};
  branches.forEach((b) => { branchesById[b.id] = b; });

  const coursesById = {};
  allCourses.forEach((c) => { coursesById[c.id] = c; });

  const batches = branchSet
    ? allBatches.filter((b) => branchSet.has(b.branchId))
    : allBatches.slice();
  const batchesById = {};
  batches.forEach((b) => { batchesById[b.id] = b; });

  // Read each student's payment, docs, and (ONLY in superadmin full export) aadhaar subcollections once
  const paymentsByStudent = {};
  const rawPaymentsFlat = [];
  const rawDocsByStudent = {};
  const rawAadhaarByStudent = {};
  let processed = 0;

  for (let i = 0; i < rawStudents.length; i += CHUNK_SUBCOLLECTION_READS) {
    if (isCancelled && isCancelled()) throw new Error('CANCELLED');
    const slice = rawStudents.slice(i, i + CHUNK_SUBCOLLECTION_READS);

    await Promise.all(slice.map(async (s) => {
      const readsList = [
        getDocs(collection(db, 'students', s.id, 'payment')),
        getDocs(collection(db, 'students', s.id, 'docs'))
      ];
      if (includeIdDocs) {
        readsList.push(
          getDoc(doc(db, 'students', s.id, 'aadhaar', 'aadhaar')).catch(() => null)
        );
      }

      const [pSnap, dSnap, aSnap] = await Promise.all(readsList);
      firestoreReads += Math.max(1, pSnap.size) + Math.max(1, dSnap.size) + (includeIdDocs ? 1 : 0);

      const stPays = pSnap.docs.map((pd) => ({ id: pd.id, studentDocId: s.id, ...pd.data() }));
      paymentsByStudent[s.id] = stPays;
      stPays.forEach((p) => rawPaymentsFlat.push(p));

      const stDocs = [];
      dSnap.docs.forEach((dd) => {
        stDocs.push({ id: dd.id, ...(dd.data() || {}) });
      });
      rawDocsByStudent[s.id] = stDocs;

      if (includeIdDocs && aSnap && typeof aSnap.exists === 'function' && aSnap.exists()) {
        rawAadhaarByStudent[s.id] = aSnap.data() || {};
      }
    }));

    processed += slice.length;
    const pct = 10 + Math.round((processed / Math.max(1, rawStudents.length)) * 45);
    emit(pct, `Reading student records & payments (${processed}/${rawStudents.length})...`);
    await tick();
  }

  if (isCancelled && isCancelled()) throw new Error('CANCELLED');

  // Extract media files to binary (decoding base64 to real files and fetching any Storage URLs with retry)
  emit(58, 'Decoding photos & documents...');
  const mediaFiles = []; // { path, bytes, mime, studentId, docKey }
  const missingFiles = [];
  const docsByStudent = {};
  const scrubbedStudents = [];
  const studentsById = {};
  let photoCount = 0;
  let docFileCount = 0;
  let idDocCount = 0;
  let mediaBytesTotal = 0;
  const usedSafeSids = new Set();

  for (let i = 0; i < rawStudents.length; i++) {
    if (isCancelled && isCancelled()) throw new Error('CANCELLED');
    const rawS = rawStudents[i];
    const cleanS = scrubStudentForArchive({
      ...rawS,
      ...(rawAadhaarByStudent[rawS.id] || {})
    }, { includeIdDocs });
    if (rawAadhaarByStudent[rawS.id] && includeIdDocs) idDocCount += 1;

    const stDocsList = rawDocsByStudent[rawS.id] || [];
    const baseSafeSid = sanitizeFilenamePart(rawS.studentId || rawS.id, rawS.id);
    const safeSid = usedSafeSids.has(baseSafeSid)
      ? sanitizeFilenamePart(`${baseSafeSid}_${rawS.id}`, rawS.id)
      : baseSafeSid;
    usedSafeSids.add(safeSid);
    const outDocs = [];
    const exportedCanonKeys = new Set();
    let photoPath = '';
    const stDocsMap = {};
    stDocsList.forEach((dd) => {
      const kName = String(dd.id || dd.key || 'doc').trim();
      stDocsMap[kName] = dd;
    });

    // Also inspect any inline student document objects/URLs when absent from docs subcollection
    const extraInlineDocs = [];
    const checkInlineKeys = ['photo', 'signature', 'dobProof', 'aadhaar', 'marksheet'];
    checkInlineKeys.forEach((ck) => {
      const hasSub = stDocsList.some((dd) => canonicalDocKey(dd.id || dd.key) === ck);
      if (hasSub) return;
      const rec = getStudentDocRecord(stDocsMap, ck, rawS);
      if (rec && getStudentDocSrc(rec, getStudentDocMime(rec))) {
        extraInlineDocs.push({ ...rec, id: rec.id || ck, key: ck });
      }
    });
    if (rawS.docs && typeof rawS.docs === 'object' && !Array.isArray(rawS.docs)) {
      Object.entries(rawS.docs).forEach(([dk, val]) => {
        if (!val || typeof val !== 'object') return;
        const canon = canonicalDocKey(dk);
        const alreadyListed = stDocsList.concat(extraInlineDocs).some((dd) => canonicalDocKey(dd.id || dd.key) === canon);
        if (!alreadyListed && getStudentDocSrc(val, getStudentDocMime(val))) {
          extraInlineDocs.push({ ...val, id: val.id || dk, key: dk });
        }
      });
    }

    const combinedDocsList = stDocsList.concat(extraInlineDocs);
    for (const d of combinedDocsList) {
      const rawKey = String(d.id || d.key || d.docType || 'doc').trim();
      const canonKey = canonicalDocKey(rawKey);
      if (exportedCanonKeys.has(canonKey)) continue;
      const isIdDoc = isIdDocumentKey(rawKey) || isIdDocumentKey(canonKey);
      if (isIdDoc && !includeIdDocs) continue;
      if (isIdDoc && includeIdDocs) idDocCount += 1;

      const isPhoto = canonKey === 'photo';
      let bin = null;
      let remoteUrl = '';
      try {
        const res = await resolveDocBinaryWithFallbacks(d);
        bin = res.bin;
        remoteUrl = res.remoteUrl;
      } catch (err) {
        missingFiles.push({
          studentId: rawS.studentId || rawS.id,
          key: canonKey,
          path: d.storagePath || d.url || canonKey,
          reason: err && err.message ? err.message : 'Download failed'
        });
      }

      if (bin && bin.bytes) {
        exportedCanonKeys.add(canonKey);
        const safeDocType = sanitizeFilenamePart(canonKey, 'file');
        const relPath = isPhoto
          ? `files/photos/${safeSid}.${bin.ext}`
          : `files/docs/${safeSid}/${safeDocType}.${bin.ext}`;
        const displayFname = isPhoto ? `${safeSid}.${bin.ext}` : `${safeDocType}.${bin.ext}`;
        mediaFiles.push({ path: relPath, bytes: bin.bytes, mime: bin.mime });
        mediaBytesTotal += bin.bytes.byteLength;
        if (isPhoto) {
          photoPath = relPath;
          photoCount += 1;
        } else {
          docFileCount += 1;
        }
        outDocs.push({
          studentDocId: rawS.id,
          key: canonKey,
          label: friendlyDocLabel(canonKey, d.label),
          name: d.name || displayFname,
          mime: bin.mime,
          sizeBytes: bin.bytes.byteLength,
          path: relPath
        });
      } else if ((d.storagePath || remoteUrl) && !missingFiles.some((m) => m.studentId === (rawS.studentId || rawS.id) && m.key === canonKey)) {
        missingFiles.push({
          studentId: rawS.studentId || rawS.id,
          key: canonKey,
          path: d.storagePath || remoteUrl,
          reason: 'Binary document payload unavailable'
        });
      }
    }

    // Fallback: resolve photo via shared getStudentPhotoSrc helper (legacy inline fields)
    if (!photoPath) {
      const fallbackPhotoSrc = getStudentPhotoSrc(rawS, stDocsMap);
      if (fallbackPhotoSrc) {
        let bin = null;
        try {
          const res = await resolveDocBinaryWithFallbacks({ data: fallbackPhotoSrc.startsWith('data:') ? fallbackPhotoSrc : '', url: /^https?:\/\//i.test(fallbackPhotoSrc) ? fallbackPhotoSrc : '' }, fallbackPhotoSrc);
          bin = res.bin;
        } catch (err) {
          missingFiles.push({
            studentId: rawS.studentId || rawS.id,
            key: 'photo',
            path: fallbackPhotoSrc,
            reason: err && err.message ? err.message : 'Photo download failed'
          });
        }
        if (bin && bin.bytes) {
          const relPath = `files/photos/${safeSid}.${bin.ext}`;
          mediaFiles.push({ path: relPath, bytes: bin.bytes, mime: bin.mime });
          mediaBytesTotal += bin.bytes.byteLength;
          photoPath = relPath;
          photoCount += 1;
          outDocs.unshift({
            key: 'photo',
            label: 'Passport Photo',
            name: `${safeSid}.${bin.ext}`,
            mime: bin.mime,
            sizeBytes: bin.bytes.byteLength,
            path: relPath
          });
        }
      }
    }

    // Resolve student creator display (Name + Designation) without leaking raw email in UI
    const creatorKey = String(rawS.createdBy || '').trim().toLowerCase();
    if (creatorKey) {
      const crDisp = resolveUserDisplay(creatorKey, '', '');
      const rawCrName = crDisp.name && crDisp.name !== '-' ? formatPersonName(crDisp.name) : '';
      const crName = rawCrName && !rawCrName.includes('@') ? rawCrName : '';
      const crDesig = crDisp.designation ? formatPersonName(crDisp.designation) : '';
      if (crName) {
        cleanS._registeredByLabel = crDesig ? `${crName} (${crDesig})` : crName;
      } else {
        cleanS._registeredByLabel = crDesig ? `Authorised Staff (${crDesig})` : 'Authorised Staff';
      }
    } else {
      cleanS._registeredByLabel = '-';
    }

    if (photoPath) {
      cleanS._photoPath = photoPath;
      cleanS.photo = photoPath;
    } else {
      cleanS._photoPath = '';
    }
    docsByStudent[rawS.id] = outDocs;
    scrubbedStudents.push(cleanS);
    studentsById[rawS.id] = cleanS;

    if (i % 15 === 0) await tick();
  }

  // Embed org logo cleanly into files/org/logo.jpg
  let orgLogoPath = '';
  try {
    const logoBin = await fetchUrlBinaryWithRetry('/assets/images/logo-192.jpg', 1);
    if (logoBin && logoBin.bytes) {
      orgLogoPath = `files/org/logo.${logoBin.ext}`;
      mediaFiles.push({ path: orgLogoPath, bytes: logoBin.bytes, mime: logoBin.mime });
      mediaBytesTotal += logoBin.bytes.byteLength;
    }
  } catch (err) {
    missingFiles.push({ path: '/assets/images/logo-192.jpg', reason: err?.message || 'Logo unavailable' });
  }

  emit(75, 'Computing fees, overdue snapshot & ledger...');

  const today = todayISO();
  const isCompleted = computeArchiveSessionStatus(session, today).key === 'completed';
  const asOfDate = (isCompleted && session.endDate) ? session.endDate : today;
  const defaultSchedule = installmentSchedule(session);

  // Overdue items as of session end date (or today if ongoing), plus live receipt/ledger snapshots
  const overdueItems = [];
  for (const st of scrubbedStudents) {
    const rawPays = paymentsByStudent[st.id] || [];
    const evalRes = evaluateYouthStudentDues(st, rawPays, session, {
      asOfDate,
      coursesById,
      branchesById,
      batchesById
    });
    st._financials = evalRes.financials || calculateStudentFinancials(st, rawPays);
    st._installmentCourseFee = installmentCourseFee(st);
    st._installmentBalanceDue = installmentBalanceDue(st, rawPays);
    const admPay = rawPays.find((p) => ['AD', 'ADMISSION', 'FULL', 'MAT'].includes(String(p.type || '').toUpperCase())) || rawPays[0] || null;
    const admModel = buildYouthReceiptData({
      admission: st,
      photo: null,
      signature: null,
      org,
      payment: admPay,
      aadhaar: includeIdDocs ? rawAadhaarByStudent[st.id] : null,
      branch: branchesById[st.branchId] || {},
      course: coursesById[st.courseId] || {},
      session
    });
    delete admModel.orgLogo;
    delete admModel.photoUrl;
    delete admModel.signatureUrl;
    admModel.generatedDate = asOfDate ? formatPersonName(admModel.generatedDate) : admModel.generatedDate;
    st._admissionReceiptModel = admModel;

    for (const item of (evalRes.items || [])) {
      if (item.status === 'overdue') {
        const cleanItem = { ...item };
        delete cleanItem.student;
        overdueItems.push(cleanItem);
      }
    }
  }

  const ledger = normalizeYouthPaymentsLedger(rawPaymentsFlat, studentsById, {
    branchesById,
    coursesById,
    requireParentStudent: true
  });

  // Resolve minimal collector info (name + designation at export time, zero extra user PII)
  const cleanStaffName = (v) => {
    const s = formatPersonName(String(v || '').trim());
    return (!s || s === '-' || s.includes('@')) ? '' : s;
  };
  const collectors = {};
  const ledgerByStudent = {};
  let collectedTotal = 0;
  let lateFeesCollected = 0;
  let lateFeesWaived = 0;
  let receiptCount = 0;

  for (let i = 0; i < ledger.length; i++) {
    const entry = ledger[i];
    const stObj = studentsById[entry.studentDocId] || null;
    if (stObj) {
      if (!entry.batchId && stObj.batchId) entry.batchId = stObj.batchId;
      if (!entry.batchName && stObj.batchName) entry.batchName = stObj.batchName;
    }
    const colDisp = resolveUserDisplay(entry.recordedBy, entry.recordedByName, entry.recordedByDesignation);
    const colName = cleanStaffName(colDisp.name) || cleanStaffName(entry.recordedByName) || '';
    const colDesig = cleanStaffName(colDisp.designation || entry.recordedByDesignation || '');
    entry.recordedByName = colName;
    entry.recordedByDesignation = colDesig;
    entry.rowKey = `youth:${entry.id || i}:${entry.studentDocId || ''}`;
    entry.searchBlob = [entry.receiptNo, entry.studentName, entry.studentId, entry.phone, entry.txnId, entry.typeLabel, entry.remarks, colName].filter(Boolean).join(' ');

    const recKey = String(entry.recordedBy || '').trim().toLowerCase();
    if (recKey && (!collectors[recKey] || (!collectors[recKey].name || collectors[recKey].name === 'Authorised Staff'))) {
      collectors[recKey] = {
        key: recKey,
        name: colName || 'Authorised Staff',
        designation: colDesig || 'Staff',
        role: colDisp.role || ''
      };
    }
    if (stObj && stObj.createdBy) {
      const crKey2 = String(stObj.createdBy).trim().toLowerCase();
      if (crKey2 && !collectors[crKey2]) {
        const crDisp2 = resolveUserDisplay(crKey2, '', '');
        const crN = cleanStaffName(crDisp2.name);
        const crD = cleanStaffName(crDisp2.designation);
        collectors[crKey2] = {
          key: crKey2,
          name: crN || 'Authorised Staff',
          designation: crD || 'Staff',
          role: crDisp2.role || ''
        };
      }
    }
    if (!ledgerByStudent[entry.studentDocId]) ledgerByStudent[entry.studentDocId] = [];
    ledgerByStudent[entry.studentDocId].push(entry);

    if (!entry.isPureWaiver) {
      collectedTotal += Number(entry.totalReceived || 0);
      lateFeesCollected += Number(entry.lateFeePaid || 0);
      if (entry.receiptNo) receiptCount += 1;
    }
    lateFeesWaived += Number(entry.lateFeeWaived || 0);
  }

  for (const st of scrubbedStudents) {
    if (!st._registeredByLabel || /^Authorised Staff/i.test(st._registeredByLabel)) {
      const ck = String(st.createdBy || '').trim().toLowerCase();
      const col = ck ? collectors[ck] : null;
      if (col && col.name && col.name !== 'Authorised Staff') {
        st._registeredByLabel = col.designation ? `${col.name} (${col.designation})` : col.name;
      }
    }
  }

  const overdueStudentSet = new Set(overdueItems.map((it) => it.studentDocId));
  const overdueAmount = overdueItems.reduce((a, b) => a + Number(b.amount || 0), 0);
  const overdueLateFees = overdueItems.reduce((a, b) => a + Number(b.lateFee || 0), 0);

  const scopeBranches = branches.map((b) => ({
    id: b.id,
    code: b.code || b.branchCode || b.shortCode || '',
    name: b.name || b.id
  }));
  const scopeLabel = effectiveScope === 'full'
    ? 'All branches'
    : (scopeBranches.map((b) => b.code || b.name).join(', ') || 'Selected branches');
  const scopeTag = effectiveScope === 'full'
    ? 'AllBranches'
    : (scopeBranches.length === 1 ? (scopeBranches[0].code || scopeBranches[0].name) : `${scopeBranches.length}Branches`);

  const generatorDisp = resolveUserDisplay(profile.email, profile.name, profile.designation);
  const generatedByName = formatPersonName(generatorDisp.name || profile.name || profile.email) || profile.email;
  const generatedByDesignation = getUserTitle(profile);
  const generatedByLabel = `${generatedByName}, ${generatedByDesignation}`;

  const reports = buildArchiveReports(scrubbedStudents, ledger, branchesById, coursesById);

  const approxJsonBytes = scrubbedStudents.length * 1400 + rawPaymentsFlat.length * 600 + 80000;
  const estimatedZipBytes = mediaBytesTotal + Math.round(approxJsonBytes * 0.35) + 45000;

  emit(100, 'Summary ready');

  return {
    session: {
      id: session.id,
      name: session.name || session.id,
      ctx: 'youth',
      startDate: session.startDate || '',
      endDate: session.endDate || '',
      status: session.status || ''
    },
    profile,
    scopeType: effectiveScope,
    scopeLabel,
    scopeTag,
    branchIds: scopeBranches.map((b) => b.id),
    branchId: effectiveScope === 'branch' ? (scopeBranches[0]?.id || '') : (effectiveScope === 'branches' && scopeBranches.length === 1 ? scopeBranches[0].id : ''),
    scopeBranches,
    includeIdDocs,
    idDocCount,
    hasAadhaarDocs: Boolean(Object.keys(rawAadhaarByStudent).length > 0 || mediaFiles.some((f) => /aadhaar/i.test(f.path))),
    org,
    orgLogoPath,
    branches,
    branchesById,
    courses: allCourses,
    coursesById,
    batches,
    batchesById,
    defaultSchedule,
    asOfDate,
    today,
    students: scrubbedStudents,
    studentsById,
    paymentsByStudent,
    rawPaymentsFlat,
    ledger,
    ledgerByStudent,
    overdue: overdueItems,
    docsByStudent,
    collectors,
    reports,
    mediaFiles,
    missingFiles,
    counts: {
      students: scrubbedStudents.length,
      payments: rawPaymentsFlat.length,
      ledgerCount: ledger.length,
      receipts: receiptCount,
      photos: photoCount,
      docs: docFileCount,
      files: mediaFiles.length,
      missingFiles: missingFiles.length,
      overdue: overdueItems.length,
      overdueStudents: overdueStudentSet.size
    },
    totals: {
      collected: collectedTotal,
      lateFeesCollected,
      lateFeesWaived,
      overdueAmount,
      overdueLateFees
    },
    readsUsed: firestoreReads,
    estimatedZipBytes,
    over200MB: estimatedZipBytes > 200 * 1024 * 1024,
    generatedByName,
    generatedByDesignation,
    generatedByLabel
  };
}

/**
 * Writes an immutable append-only log entry to /archiveLogs.
 */
export async function appendArchiveLog({
  action,
  profile,
  session,
  scopeType = 'full',
  scopeLabel = 'All branches',
  branchId = '',
  branchIds = [],
  includesIdDocs = false,
  encrypted = false,
  filename = '',
  sizeBytes = 0,
  zipSha256 = '',
  manifestSha256 = '',
  counts = {},
  totals = {},
  error = ''
} = {}) {
  const userEmail = String(auth?.currentUser?.email || profile?.email || '').trim().toLowerCase();
  const userUid = String(auth?.currentUser?.uid || '').trim();
  const disp = resolveUserDisplay(userEmail, profile?.name, profile?.designation);
  const byName = formatPersonName(disp.name || profile?.name || userEmail) || userEmail;
  const byDesignation = getUserTitle(profile);
  const payload = {
    action,
    ctx: 'youth',
    sessionId: String(session?.id || ''),
    sessionName: String(session?.name || ''),
    scopeType,
    scopeLabel,
    branchId: String(branchId || ''),
    branchIds: Array.isArray(branchIds) ? branchIds : [],
    includesIdDocs: Boolean(includesIdDocs),
    encrypted: Boolean(encrypted),
    filename: String(filename || ''),
    sizeBytes: Number(sizeBytes || 0),
    zipSha256: String(zipSha256 || ''),
    manifestSha256: String(manifestSha256 || ''),
    counts: {
      students: Number(counts.students || 0),
      payments: Number(counts.payments || 0),
      receipts: Number(counts.receipts || 0),
      files: Number(counts.files || 0),
      missingFiles: Number(counts.missingFiles || 0)
    },
    totals: {
      collected: Number(totals.collected || 0),
      overdueAmount: Number(totals.overdueAmount || 0),
      lateFeesCollected: Number(totals.lateFeesCollected || 0)
    },
    appVersion: APP_VERSION,
    error: String(error || '').slice(0, 400),
    byEmail: userEmail,
    byUid: userUid,
    byName,
    byDesignation,
    byRole: profile?.role || 'branch_head',
    dateISO: todayISO(),
    createdAt: serverTimestamp(),
    createdAtISO: `${todayISO()}T${new Date().toISOString().slice(11)}`
  };
  const ref = await addDoc(collection(db, 'archiveLogs'), payload);
  return { id: ref.id, ...payload };
}

/**
 * Generates the self-contained offline ZIP (plain or AES-256-GCM encrypted) using bundled fflate,
 * yields between chunks, verifies cancellation, writes manifest SHA-256s, downloads ZIP, and logs to archiveLogs.
 */
export async function buildAndDownloadArchiveZip({
  snapshot,
  encrypt = false,
  password = '',
  triggerBrowserDownload = true,
  onProgress,
  isCancelled
} = {}) {
  if (!snapshot) throw new Error('Scan snapshot is required before building ZIP.');
  if (encrypt && String(password || '').length < 6) {
    throw new Error('Archive password must be at least 6 characters long.');
  }

  const fflate = await loadFflate();
  const generatedAtIST = nowISTString();
  const filename = buildArchiveZipFilename(snapshot.session.name, snapshot.scopeTag, snapshot.today);

  const emit = (pct, stage) => {
    if (typeof onProgress === 'function') onProgress({ pct, stage });
  };

  try {
    emit(8, 'Preparing structured session data...');

    const viewerAssets = buildOfflineViewerAssets({
      sessionName: snapshot.session.name,
      orgName: (snapshot.org && snapshot.org.orgName) || 'Unique Infotech',
      scopeLabel: snapshot.scopeLabel,
      generatedAtIST,
      generatedByLabel: snapshot.generatedByLabel,
      isEncrypted: encrypt,
      includesIdDocs: snapshot.includeIdDocs,
      counts: snapshot.counts,
      totals: snapshot.totals
    });
    const bundledStaticAssets = await collectViewerStaticAssets();
    const jsonDataCount = 10;
    const csvDataCount = 3;
    const mediaEntryCount = encrypt ? snapshot.mediaFiles.length : snapshot.mediaFiles.length * 2;
    // Viewer + static assets + archive-data.js + json + csv + media + manifest.json
    const packedFileCount = bundledStaticAssets.length + viewerAssets.length + 1 + jsonDataCount + csvDataCount + mediaEntryCount + 1;

    const meta = {
      schemaVersion: 1,
      appVersion: APP_VERSION,
      sessionId: snapshot.session.id,
      sessionName: snapshot.session.name,
      asOfDate: snapshot.asOfDate,
      scopeType: snapshot.scopeType,
      scopeLabel: snapshot.scopeLabel,
      branches: snapshot.scopeBranches,
      includesIdDocs: snapshot.includeIdDocs,
      encrypted: Boolean(encrypt),
      generatedAtIST,
      generatedByName: snapshot.generatedByName,
      generatedByDesignation: snapshot.generatedByDesignation,
      generatedByLabel: snapshot.generatedByLabel,
      packedFileCount,
      missingFiles: snapshot.missingFiles
    };

    const archivePayload = {
      meta,
      session: snapshot.session,
      org: snapshot.org,
      orgLogoPath: snapshot.orgLogoPath,
      branches: snapshot.branches,
      branchesById: snapshot.branchesById,
      courses: snapshot.courses,
      coursesById: snapshot.coursesById,
      batches: snapshot.batches,
      batchesById: snapshot.batchesById,
      defaultSchedule: snapshot.defaultSchedule,
      students: snapshot.students,
      studentsById: snapshot.studentsById,
      paymentsByStudent: snapshot.paymentsByStudent,
      ledger: snapshot.ledger,
      ledgerByStudent: snapshot.ledgerByStudent,
      overdue: snapshot.overdue,
      docsByStudent: snapshot.docsByStudent,
      collectors: snapshot.collectors,
      reports: snapshot.reports,
      stats: {
        studentCount: snapshot.counts.students,
        branchCount: snapshot.scopeBranches.length,
        paymentCount: snapshot.counts.payments,
        ledgerCount: snapshot.counts.ledgerCount,
        receiptCount: snapshot.counts.receipts,
        collectedTotal: snapshot.totals.collected,
        lateFeesCollected: snapshot.totals.lateFeesCollected,
        lateFeesWaived: snapshot.totals.lateFeesWaived,
        overdueCount: snapshot.counts.overdue,
        overdueStudentCount: snapshot.counts.overdueStudents,
        overdueAmount: snapshot.totals.overdueAmount,
        overdueLateFees: snapshot.totals.overdueLateFees
      }
    };

    const jsonDataEntries = [
      { path: 'data/json/meta.json', text: JSON.stringify(meta, null, 2) },
      { path: 'data/json/session.json', text: JSON.stringify(snapshot.session, null, 2) },
      { path: 'data/json/org.json', text: JSON.stringify(snapshot.org, null, 2) },
      { path: 'data/json/branches.json', text: JSON.stringify(snapshot.branches, null, 2) },
      { path: 'data/json/courses.json', text: JSON.stringify(snapshot.courses, null, 2) },
      { path: 'data/json/batches.json', text: JSON.stringify(snapshot.batches, null, 2) },
      { path: 'data/json/collectors.json', text: JSON.stringify(snapshot.collectors, null, 2) },
      { path: 'data/json/students.json', text: JSON.stringify(snapshot.students, null, 2) },
      { path: 'data/json/payments.json', text: JSON.stringify(snapshot.ledger, null, 2) },
      { path: 'data/json/overdue.json', text: JSON.stringify(snapshot.overdue, null, 2) }
    ];

    const csvEntries = [
      {
        path: 'data/csv/students.csv',
        text: buildCsvText(
          ['Student ID', 'Name', 'Guardian', 'Phone', 'Branch', 'Course', 'Batch', 'Admission Date', 'Plan', 'Status', 'Total Fee', 'Paid', 'Balance'],
          snapshot.students.map((s) => {
            const fin = s._financials || {};
            return [s.studentId, s.name, s.guardianName || s.fatherName, s.phone, s.branchCode || s.branchName, s.courseCode || s.courseName, s.batchName, s.admissionDate, s.paymentPlan, s.status, fin.total || s.feeTotal || 0, fin.paid || 0, fin.outstanding || 0];
          })
        )
      },
      {
        path: 'data/csv/payments.csv',
        text: buildCsvText(
          ['Date', 'Receipt No', 'Student ID', 'Student Name', 'Branch', 'Course', 'Batch', 'Payment For', 'Mode', 'TXN ID', 'Fee Amount', 'Late Fee Paid', 'Late Fee Waived', 'Total Received', 'Collected By', 'Designation'],
          snapshot.ledger.map((p) => [p.date, p.receiptNo, p.studentId, p.studentName, p.branchCode || p.branchName, p.courseCode || p.courseName, p.batchName, p.typeLabel || p.type, p.mode, p.txnId, p.amount, p.lateFeePaid, p.lateFeeWaived, p.totalReceived, p.recordedByName, p.recordedByDesignation])
        )
      },
      {
        path: 'data/csv/overdue.csv',
          text: buildCsvText(
            ['Student ID', 'Student Name', 'Phone', 'Branch', 'Course', 'Batch', 'Installment', 'Due Date', 'Days Late', 'Fee', 'Late Fee', 'Total Due'],
            snapshot.overdue.map((o) => [o.studentId, o.studentName, o.phone, o.branchCode || o.branchName, o.courseCode || o.courseName, o.batchName, o.whatIsDue, o.dueDate, o.daysLate, o.amount, o.lateFee, o.totalPayable])
          )
      }
    ];

    let aesKey = null;
    let kdfSaltB64 = '';
    const enc = new TextEncoder();

    if (encrypt) {
      emit(16, 'Deriving AES-256 encryption key...');
      await tick();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      kdfSaltB64 = bytesToBase64(salt);
      const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
      aesKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );
    }

    async function encryptPayloadBytes(plainBytes, aadPath) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: enc.encode(aadPath) },
        aesKey,
        plainBytes
      );
      return {
        ivB64: bytesToBase64(iv),
        bytes: new Uint8Array(ct)
      };
    }

    // Build data/archive-data.js (plain or encrypted AES-GCM envelope)
    const serializedDataJson = JSON.stringify(archivePayload);
    let archiveDataJsText;
    if (encrypt) {
      emit(24, 'Encrypting archive dataset...');
      const encMain = await encryptPayloadBytes(enc.encode(serializedDataJson), 'data/archive-data.js');
      const envelope = {
        v: 1,
        encrypted: true,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, saltB64: kdfSaltB64 },
        cipher: { name: 'AES-GCM', ivB64: encMain.ivB64, aad: 'data/archive-data.js', dataB64: bytesToBase64(encMain.bytes) },
        hintMeta: {
          orgName: (snapshot.org && snapshot.org.orgName) || 'Unique Infotech',
          sessionName: snapshot.session.name,
          scopeLabel: snapshot.scopeLabel,
          generatedAtIST,
          generatedByLabel: snapshot.generatedByLabel,
          studentCount: snapshot.counts.students,
          paymentCount: snapshot.counts.payments
        }
      };
      archiveDataJsText = `window.ARCHIVE_ENVELOPE = ${JSON.stringify(envelope)};\n`;
    } else {
      archiveDataJsText = `window.ARCHIVE_DATA = ${serializedDataJson};\n`;
    }

    // Assemble ZIP sequentially via streaming fflate.Zip so memory stays low
    const zipChunks = [];
    const manifestFiles = [];
    let zipStreamErr = null;
    const zip = new fflate.Zip((err, chunk, final) => {
      if (err) zipStreamErr = err;
      if (chunk && chunk.length) zipChunks.push(chunk);
    });

    async function pushZipEntry(relPath, uint8Bytes, { compress = true } = {}) {
      if (isCancelled && isCancelled()) throw new Error('CANCELLED');
      if (zipStreamErr) throw zipStreamErr;
      const hashHex = await sha256HexFromBuffer(uint8Bytes);
      manifestFiles.push({ path: relPath, sizeBytes: uint8Bytes.byteLength, sha256: hashHex });
      const entry = compress ? new fflate.ZipDeflate(relPath, { level: 6 }) : new fflate.ZipPassThrough(relPath);
      zip.add(entry);
      entry.push(uint8Bytes, true);
    }

    // 1. Viewer HTML / README / CSS overrides / Classic JS + real live CMS CSS/Fonts/Vendor libs (precomputed above)
    for (const sa of bundledStaticAssets) {
      await pushZipEntry(sa.path, sa.bytes, { compress: sa.compress });
    }
    for (const asset of viewerAssets) {
      await pushZipEntry(asset.path, enc.encode(asset.content), { compress: true });
    }
    // 2. Archive main script
    await pushZipEntry('data/archive-data.js', enc.encode(archiveDataJsText), { compress: true });

    // 3. JSON + CSV exports (encrypted inside encrypted archives so no unencrypted PII sits on disk)
    emit(38, encrypt ? 'Encrypting JSON & CSV exports...' : 'Compressing JSON & CSV exports...');
    await tick();

    for (const je of jsonDataEntries) {
      if (encrypt) {
        const encJ = await encryptPayloadBytes(enc.encode(je.text), je.path);
        const wrapped = JSON.stringify({ encrypted: true, path: je.path, ivB64: encJ.ivB64, dataB64: bytesToBase64(encJ.bytes) });
        await pushZipEntry(je.path + '.enc', enc.encode(wrapped), { compress: true });
      } else {
        await pushZipEntry(je.path, enc.encode(je.text), { compress: true });
      }
    }
    for (const ce of csvEntries) {
      if (encrypt) {
        const encC = await encryptPayloadBytes(enc.encode(ce.text), ce.path);
        const wrapped = JSON.stringify({ encrypted: true, path: ce.path, ivB64: encC.ivB64, dataB64: bytesToBase64(encC.bytes) });
        await pushZipEntry(ce.path + '.enc', enc.encode(wrapped), { compress: true });
      } else {
        await pushZipEntry(ce.path, enc.encode(ce.text), { compress: true });
      }
    }

    // 4. Media files in chunks (stored uncompressed as PassThrough + lazy .js blob sidecar when plain, encrypted script wrappers when encrypted)
    const totalMedia = snapshot.mediaFiles.length;
    for (let i = 0; i < totalMedia; i++) {
      const mf = snapshot.mediaFiles[i];
      if (encrypt) {
        const encM = await encryptPayloadBytes(mf.bytes, mf.path);
        const payloadObj = { ivB64: encM.ivB64, mime: mf.mime, byteLength: mf.bytes.byteLength, dataB64: bytesToBase64(encM.bytes) };
        const scriptTxt = `window.__ARC_REGISTER_ENC_FILE&&window.__ARC_REGISTER_ENC_FILE(${JSON.stringify(mf.path)},${JSON.stringify(payloadObj)});\n`;
        await pushZipEntry(mf.path + '.enc.js', enc.encode(scriptTxt), { compress: false });
      } else {
        await pushZipEntry(mf.path, mf.bytes, { compress: false });
        const rawPayload = { mime: mf.mime, byteLength: mf.bytes.byteLength, dataB64: bytesToBase64(mf.bytes) };
        const rawScriptTxt = `window.__ARC_REGISTER_RAW_FILE&&window.__ARC_REGISTER_RAW_FILE(${JSON.stringify(mf.path)},${JSON.stringify(rawPayload)});\n`;
        await pushZipEntry(mf.path + '.js', enc.encode(rawScriptTxt), { compress: true });
      }
      if (i % 6 === 0) {
        const pct = 45 + Math.round(((i + 1) / Math.max(1, totalMedia)) * 45);
        emit(pct, `${encrypt ? 'Encrypting' : 'Packing'} photos & documents (${i + 1}/${totalMedia})...`);
        await tick();
      }
    }

    // 5. Write manifest.json with per-file SHA-256 checksums
    emit(93, 'Writing manifest & SHA-256 checksums...');
    const manifestObj = {
      schemaVersion: 1,
      appVersion: APP_VERSION,
      session: snapshot.session,
      scope: { type: snapshot.scopeType, label: snapshot.scopeLabel },
      branches: snapshot.scopeBranches,
      counts: snapshot.counts,
      totals: snapshot.totals,
      encrypted: Boolean(encrypt),
      includesIdDocs: snapshot.includeIdDocs,
      generatedBy: {
        name: snapshot.generatedByName,
        designation: snapshot.generatedByDesignation,
        role: snapshot.profile?.role || ''
      },
      generatedAtIST,
      missingFiles: snapshot.missingFiles,
      files: manifestFiles
    };
    const manifestBytes = enc.encode(JSON.stringify(manifestObj, null, 2));
    const manifestSha256 = await sha256HexFromBuffer(manifestBytes);
    const mEntry = new fflate.ZipDeflate('manifest.json', { level: 6 });
    zip.add(mEntry);
    mEntry.push(manifestBytes, true);

    zip.end();
    if (zipStreamErr) throw zipStreamErr;

    emit(97, 'Computing final ZIP checksum...');
    const zipBlob = new Blob(zipChunks, { type: 'application/zip' });
    const zipBuf = await zipBlob.arrayBuffer();
    const zipSha256 = await sha256HexFromBuffer(zipBuf);

    if (triggerBrowserDownload && typeof document !== 'undefined') {
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    emit(99, 'Recording permanent archive history...');
    await appendArchiveLog({
      action: 'DOWNLOAD',
      profile: snapshot.profile,
      session: snapshot.session,
      scopeType: snapshot.scopeType,
      scopeLabel: snapshot.scopeLabel,
      branchId: snapshot.branchId,
      branchIds: snapshot.branchIds,
      includesIdDocs: snapshot.includeIdDocs,
      encrypted: Boolean(encrypt),
      filename,
      sizeBytes: zipBlob.size,
      zipSha256,
      manifestSha256,
      counts: snapshot.counts,
      totals: snapshot.totals
    }).catch((err) => {
      console.warn('[archives] archiveLogs write warning:', err && err.code ? err.code : err);
    });

    // Update lightweight session archive metadata ONLY for Super Admin full export
    if (snapshot.profile?.role === 'superadmin' && snapshot.scopeType === 'full') {
      updateDoc(doc(db, 'sessions', snapshot.session.id), {
        lastArchiveAt: serverTimestamp(),
        lastArchiveDate: snapshot.today,
        lastArchiveFilename: filename,
        lastArchiveSha256: zipSha256,
        lastArchiveSummary: {
          students: snapshot.counts.students,
          payments: snapshot.counts.payments,
          receipts: snapshot.counts.receipts,
          collected: snapshot.totals.collected
        }
      }).catch((err) => {
        console.warn('[archives] session summary metadata update warning:', err && err.code ? err.code : err);
      });
    }

    emit(100, 'Archive ready');
    return {
      ok: true,
      filename,
      sizeBytes: zipBlob.size,
      zipSha256,
      manifestSha256,
      manifest: manifestObj,
      blob: zipBlob
    };
  } catch (err) {
    if (err && err.message === 'CANCELLED') {
      throw err;
    }
    await appendArchiveLog({
      action: 'FAILED',
      profile: snapshot.profile,
      session: snapshot.session,
      scopeType: snapshot.scopeType,
      scopeLabel: snapshot.scopeLabel,
      branchId: snapshot.branchId,
      branchIds: snapshot.branchIds,
      includesIdDocs: snapshot.includeIdDocs,
      encrypted: Boolean(encrypt),
      filename,
      counts: snapshot.counts,
      totals: snapshot.totals,
      error: err && err.message ? err.message : String(err)
    }).catch(() => {});
    throw err;
  }
}

/**
 * Verifies any locally selected archive ZIP in-browser (no upload) by reading manifest.json
 * and checking SHA-256 of every listed file against extracted bytes.
 */
export async function verifyLocalArchiveZip(file, { profile, logToFirestore = true, onProgress } = {}) {
  if (!file) throw new Error('Select a .zip archive file first.');
  const fflate = await loadFflate();
  const emit = (pct, msg) => { if (typeof onProgress === 'function') onProgress({ pct, msg }); };

  emit(15, 'Reading ZIP bytes locally...');
  const buf = await file.arrayBuffer();
  const rawBytes = new Uint8Array(buf);
  const zipSha256 = await sha256HexFromBuffer(rawBytes);

  emit(40, 'Decompressing ZIP index...');
  const entries = fflate.unzipSync(rawBytes);
  const manifestEntry = entries['manifest.json'];
  if (!manifestEntry) {
    throw new Error('Not a valid Unique Infotech archive: missing manifest.json.');
  }

  let manifest;
  try {
    manifest = JSON.parse(fflate.strFromU8(manifestEntry));
  } catch (_) {
    throw new Error('Corrupted manifest.json inside ZIP.');
  }
  const manifestSha256 = await sha256HexFromBuffer(manifestEntry);

  const requiredFiles = [
    'index.html',
    'README.txt',
    'data/archive-data.js',
    'viewer/css/fonts.css',
    'viewer/css/main.css',
    'viewer/css/archive-overrides.css',
    'viewer/js/receipts.js',
    'viewer/js/app.js'
  ];
  const missingViewer = requiredFiles.filter((p) => !entries[p]);

  const listed = Array.isArray(manifest.files) ? manifest.files : [];
  const mismatches = [];
  const missing = [];
  let verifiedCount = 0;

  for (let i = 0; i < listed.length; i++) {
    const item = listed[i];
    const actualBytes = entries[item.path];
    if (!actualBytes) {
      missing.push(item.path);
      continue;
    }
    const actualHex = await sha256HexFromBuffer(actualBytes);
    if (actualHex !== item.sha256) {
      mismatches.push({ path: item.path, expected: item.sha256, actual: actualHex });
    } else {
      verifiedCount += 1;
    }
    if (i % 10 === 0) {
      emit(50 + Math.round(((i + 1) / Math.max(1, listed.length)) * 45), `Checking SHA-256 (${i + 1}/${listed.length})...`);
      await tick();
    }
  }

  const ok = missingViewer.length === 0 && missing.length === 0 && mismatches.length === 0 && listed.length > 0;

  if (logToFirestore && profile && manifest?.session?.id) {
    const scopeBranchId = profile.role === 'branch_head'
      ? (profile.branchId || '')
      : (Array.isArray(manifest.branches) && manifest.branches.length === 1 && manifest.scope?.type !== 'full' ? (manifest.branches[0].id || '') : '');
    const logBranchIds = Array.isArray(manifest.branches) ? manifest.branches.map((b) => b.id).filter(Boolean) : [];
    const allowedLog = profile.role === 'superadmin' || (profile.role === 'branch_head' && logBranchIds.length === 1 && logBranchIds[0] === profile.branchId);
    if (allowedLog) {
      await appendArchiveLog({
        action: 'VERIFY',
        profile,
        session: manifest.session,
        scopeType: profile.role === 'branch_head' ? 'branch' : (manifest.scope?.type || 'full'),
        scopeLabel: manifest.scope?.label || 'Archive',
        branchId: scopeBranchId,
        branchIds: logBranchIds,
        includesIdDocs: Boolean(manifest.includesIdDocs),
        encrypted: Boolean(manifest.encrypted),
        filename: file.name,
        sizeBytes: file.size,
        zipSha256,
        manifestSha256,
        counts: manifest.counts || {},
        totals: manifest.totals || {},
        error: ok ? '' : `Failed integrity: ${missing.length} missing, ${mismatches.length} tampered`
      }).catch(() => {});
    }
  }

  emit(100, ok ? 'Archive integrity verified' : 'Integrity mismatch found');
  return {
    ok,
    filename: file.name,
    sizeBytes: file.size,
    zipSha256,
    manifestSha256,
    manifest,
    checkedCount: listed.length,
    verifiedCount,
    missingViewer,
    missing,
    mismatches
  };
}
