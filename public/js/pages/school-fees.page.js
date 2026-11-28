// school-fees.page.js — Unique Kids Collect Fees page (Pay Fees style + All Bills tab).
// Uses warm shared cache (`ensureKidsDataset`, `loadKidsPaymentHistory`) with instant render
// and silent background delta refresh. Supports search, student card, month-wise bills with
// break-month protection, Collect / Collect All Due, Today's collections, and All Bills tab.

import { db } from '../config/firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { showToast } from '../components/toast.js?v=1.8.201';
import { PAGE_SIZE, buildStats, buildToolbar, renderPager } from '../components/list-page.js?v=1.8.201';
import { formatINR, formatDateIN, formatPersonName } from '../utils/formatter.js?v=1.8.201';
import { getRoleTitle } from '../services/user-directory.service.js?v=1.8.201';
import { localToday, monthSeq } from '../utils/school-lifecycle.js?v=1.8.201';
import { firstMonthlyMonth } from '../utils/school-receipt.js?v=1.8.201';
import { getStudentPhotoSrc } from '../utils/student-media.js?v=1.8.201';
import { markRouteScrollHandled } from '../utils/dom-scroll.js?v=1.8.201';
import { openPaymentPopup } from '../components/payment-popup.js?v=1.8.201';
import {
  addMonthsYM,
  ymRange,
  daysLate,
  computeLateFee,
  formatShortMonthYear,
  formatBreakPeriod,
  formatBreakStatusText,
  isBreakOverdueReturn,
  resolveEffectiveBreakMonthRange
} from '../utils/school-billing.js?v=1.8.201';
import {
  ensureReferenceData,
  getCachedReferenceData,
  scopeReferenceDataByCtx,
  ensureKidsDataset,
  getCachedKidsDataset,
  syncKidsDatasetDelta,
  loadKidsPaymentHistory,
  getCachedKidsHistory,
  modeDisplayMeta,
  isCacheStale,
  scheduleDelayedSkeleton
} from '../services/report.service.js?v=1.8.201';

let cleanupPage = null;
export function unmount() { if (cleanupPage) cleanupPage(); cleanupPage = null; }

const studentPhotoCache = new Map();

function $(id) { return document.getElementById(id); }
function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function rupees(n) { return Math.round(Number(n || 0) * 100) / 100; }

async function getKidsStudentPhoto(student) {
  if (!student || !student.id) return '';
  const direct = getStudentPhotoSrc(student, null);
  if (direct) return direct;
  if (studentPhotoCache.has(student.id)) {
    return studentPhotoCache.get(student.id);
  }
  const p = (async () => {
    try {
      const snap = await getDoc(doc(db, 'students', student.id, 'docs', 'photo'));
      if (snap.exists()) {
        return getStudentPhotoSrc(student, { photo: { id: snap.id, ...snap.data() } }) || '';
      }
    } catch (_) {}
    return '';
  })();
  studentPhotoCache.set(student.id, p);
  const url = await p;
  studentPhotoCache.set(student.id, url);
  return url;
}

function formatCollectionTime(entry) {
  const sec = Number(entry?.createdAtSec || 0);
  if (sec > 0) {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      }).format(new Date(sec * 1000));
    } catch (_) {}
  }
  return 'Today';
}

function formatEntryMonthsLabel(entry) {
  if (entry.type === 'AD') return 'Admission';
  if (entry.type === 'UPGRADE') return 'Level Upgrade';
  if (Array.isArray(entry.months) && entry.months.length > 1) {
    const ms = entry.months.slice().sort();
    return `${formatShortMonthYear(ms[0])} – ${formatShortMonthYear(ms[ms.length - 1])} (${ms.length} mo)`;
  }
  if (entry.month) return formatShortMonthYear(entry.month) || entry.month;
  if (entry.billPeriod) return entry.billPeriod;
  return 'Monthly Fee';
}

function isStudentMatchingQuery(s, qRaw) {
  const q = qRaw.trim();
  if (!q) return false;
  const digits = q.replace(/\D/g, '');
  const sid = String(s.studentId || '').toLowerCase();
  const name = String(s.name || '').toLowerCase();
  const phoneDigits = String(s.phone || '').replace(/\D/g, '');
  const altDigits = String(s.altPhone || s.guardianPhone || '').replace(/\D/g, '');

  if (digits.length >= 3 && /^\d+$/.test(q)) {
    return sid.includes(digits) || phoneDigits.includes(digits) || altDigits.includes(digits);
  }
  const lower = q.toLowerCase();
  return name.includes(lower) || sid.includes(lower) || phoneDigits.includes(lower);
}

function statusSortRank(st) {
  const low = String(st || 'active').toLowerCase();
  if (low === 'active') return 0;
  if (low === 'break') return 1;
  return 2;
}

export async function mount({ container, profile, ctx }) {
  const school = ctx === 'school';
  if (!school) {
    showToast({ type: 'error', message: 'Kids Fees is only available in Unique Kids.' });
    return;
  }
  const isSuper = profile && profile.role === 'superadmin';
  if (!isSuper) {
    showToast({ type: 'error', message: `Kids Fees is restricted to ${getRoleTitle('superadmin')}.` });
    return;
  }

  const rowsHost = $('sf-rows');
  const emptyEl = $('sf-empty');
  const loadingEl = $('sf-loading');
  const noMatchEl = $('sf-no-match');
  const loadErrorEl = $('sf-load-error');
  const loadErrorMsg = $('sf-load-error-msg');
  const footEl = $('sf-foot');
  if (!rowsHost || !emptyEl || !loadingEl || !noMatchEl || !loadErrorEl) return;

  // ---------- tabs ----------
  const collectTabBtn = $('sf-tab-collect');
  const allTabBtn = $('sf-tab-all');
  const collectView = $('sf-collect-view');
  const allView = $('sf-all-view');
  let activeTab = 'collect';

  function setTab(nextTab) {
    activeTab = nextTab === 'all' ? 'all' : 'collect';
    if (collectTabBtn) {
      collectTabBtn.classList.toggle('is-active', activeTab === 'collect');
      collectTabBtn.setAttribute('aria-selected', String(activeTab === 'collect'));
    }
    if (allTabBtn) {
      allTabBtn.classList.toggle('is-active', activeTab === 'all');
      allTabBtn.setAttribute('aria-selected', String(activeTab === 'all'));
    }
    if (collectView) collectView.hidden = activeTab !== 'collect';
    if (allView) allView.hidden = activeTab !== 'all';
    if (activeTab === 'all') renderAllBillsTab();
    else if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  if (collectTabBtn) collectTabBtn.addEventListener('click', () => setTab('collect'));
  if (allTabBtn) allTabBtn.addEventListener('click', () => setTab('all'));

  // ---------- All Bills toolbar & stats (preserved contracts) ----------
  const tbFilters = [
    {
      id: 'status', label: 'Status', options: [
        { value: 'all', label: 'All statuses' }, { value: 'unpaid', label: 'Unpaid' },
        { value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' },
        { value: 'overdue', label: 'Overdue' }, { value: 'break-waived', label: 'Break (No fee)' }
      ]
    },
    { id: 'month', label: 'Month', options: [{ value: 'all', label: 'All months', icon: 'calendar' }] },
    { id: 'level', label: 'Level', options: [{ value: 'all', label: 'All levels', icon: 'book-open' }] }
  ];
  const tb = buildToolbar({
    placeholder: 'Search student name, Student ID or phone',
    filters: tbFilters,
    onChange: () => { page = 1; renderAllBillsTab(); },
    onRefresh: () => load({ forceRefresh: true })
  });
  const tbHost = $('sk-toolbar');
  if (tbHost) { tbHost.innerHTML = ''; tb.el.classList.add('sf-toolbar-row'); tbHost.appendChild(tb.el); }

  const stats = buildStats([
    { label: 'Total bills', value: 0, sub: 'This centre', icon: 'file-text', tone: 'indigo' },
    { label: 'Unpaid', value: 0, sub: 'Outstanding bills', icon: 'alert-circle', tone: 'amber' },
    { label: 'Paid', value: 0, sub: 'Fully paid', icon: 'check-circle', tone: 'green' },
    { label: 'Overdue', value: 0, sub: 'Late fines due', icon: 'alert-triangle', tone: 'red' }
  ]);
  const statsHost = $('sk-stats');
  if (statsHost) statsHost.appendChild(stats.el);

  // ---------- page state ----------
  let bills = [];
  let breaks = [];
  let students = [];
  let levels = [];
  let coursesById = {};
  let historyEntries = [];
  let currentStudent = null;
  let page = 1;
  let alive = true;
  let currentSuggestions = [];
  let highlightedIndex = -1;

  function findStudentByKey(key, code = '') {
    return students.find((x) =>
      x.id === key ||
      (code && x.studentId === code) ||
      (x.studentId && x.studentId === key)
    ) || null;
  }

  function resolvePaymentIdForBill(b, stu) {
    if (b?.lastPaymentId) return b.lastPaymentId;
    const keys = new Set([stu?.id, stu?.studentId, b?.studentId, b?.studentCode].filter(Boolean));
    const match = historyEntries.find((e) => {
      if (!e || e.isPureWaiver) return false;
      if (!keys.has(e.studentDocId) && !keys.has(e.studentId)) return false;
      if (b.id && (e.billId === b.id || (Array.isArray(e.billIds) && e.billIds.includes(b.id)))) return true;
      if (b.receiptNo && e.receiptNo === b.receiptNo) return true;
      return b.month && e.month === b.month;
    });
    return match?.id || 'latest';
  }

  function setLoading(isLoading) {
    loadingEl.hidden = !isLoading;
    rowsHost.hidden = isLoading;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;
    footEl.hidden = true;
  }

  function setError(msg) {
    loadingEl.hidden = true;
    rowsHost.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = false;
    if (loadErrorMsg) loadErrorMsg.textContent = msg;
    footEl.hidden = true;
  }

  function applyLoadedData(meta, dataset, hist) {
    const scoped = scopeReferenceDataByCtx(meta || {}, 'school');
    students = (dataset?.studentsList || []).filter((s) => s.status !== 'deleted');
    const studentKeys = new Set();
    students.forEach((s) => {
      if (s.id) studentKeys.add(s.id);
      if (s.studentId) studentKeys.add(String(s.studentId));
    });
    bills = (dataset?.bills || [])
      .filter((b) => studentKeys.has(b.studentId))
      .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')));
    breaks = (dataset?.breaks || []).slice();
    levels = (scoped.coursesList || []).filter((c) => (c.status || 'active') === 'active');
    coursesById = {};
    (scoped.coursesList || []).forEach((c) => { coursesById[c.id] = c; });

    if (hist && Array.isArray(hist.entries)) {
      historyEntries = hist.entries.slice();
    }

    const months = Array.from(new Set(bills.map((b) => b.month).filter(Boolean))).sort().reverse();
    tb.setFilterOptions('month', [{ value: 'all', label: 'All months', icon: 'calendar' }].concat(
      months.map((m) => ({ value: m, label: m, icon: 'calendar' }))
    ));
    tb.setFilterOptions('level', [{ value: 'all', label: 'All levels', icon: 'book-open' }].concat(
      levels.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''))
        .map((c) => ({ value: c.id, label: c.name || c.id, icon: 'book-open' }))
    ));

    const allCountEl = $('sf-all-count');
    if (allCountEl) {
      allCountEl.textContent = String(bills.length);
      allCountEl.hidden = bills.length === 0;
    }

    if (currentStudent) {
      const updated = findStudentByKey(currentStudent.id, currentStudent.studentId);
      if (updated) currentStudent = updated;
      renderStudentPanel();
    }
    renderTodayCollections();
    renderAllBillsTab();
  }

  async function load({ forceRefresh = false, deltaRefresh = false, background = false } = {}) {
    const today = localToday();
    if (!forceRefresh && !deltaRefresh) {
      const cachedMeta = getCachedReferenceData(profile);
      const cachedDs = getCachedKidsDataset();
      const cachedHist = getCachedKidsHistory();
      if (cachedMeta && cachedDs) {
        applyLoadedData(cachedMeta, cachedDs, cachedHist);
        if (!cachedHist) {
          loadKidsPaymentHistory({ profile }).then((h) => {
            if (!alive) return;
            historyEntries = h?.entries || [];
            renderTodayCollections();
            if (currentStudent) renderStudentPanel();
          }).catch(() => {});
        }
        if (!background && (isCacheStale(cachedMeta) || isCacheStale(cachedDs) || cachedDs.billsSyncedAsOf !== today)) {
          load({ deltaRefresh: true, background: true }).catch(() => {});
        }
        return;
      }
    }

    const skelTask = (!background && !bills.length && activeTab === 'all')
      ? scheduleDelayedSkeleton(() => {
        if (alive && !bills.length && activeTab === 'all') setLoading(true);
      }, 300)
      : null;

    try {
      const [meta, dataset, hist] = await Promise.all([
        ensureReferenceData({ forceRefresh: forceRefresh && !deltaRefresh, profile }),
        deltaRefresh
          ? syncKidsDatasetDelta({ profile, syncOpenBills: true })
          : ensureKidsDataset({ profile, forceRefresh, syncOpenBills: true }),
        loadKidsPaymentHistory({
          profile,
          forceRefresh: forceRefresh && !deltaRefresh,
          deltaRefresh
        }).catch(() => getCachedKidsHistory())
      ]);
      if (skelTask) skelTask.cancel();
      if (!alive) return;
      if (!background || !deltaRefresh || !dataset.deltaUsed || dataset.changedCount !== 0 || meta?.fromCache === false || (hist && !hist.fromCache)) {
        applyLoadedData(meta, dataset, hist);
      }
      const inp = $('sf-search-input');
      const panel = $('sf-panel');
      if (inp && inp.value.trim() && (!panel || panel.hidden) && document.activeElement === inp) {
        inp.dispatchEvent(new Event('input'));
      }
    } catch (e) {
      if (skelTask) skelTask.cancel();
      if (!background && alive) {
        console.error('[school-fees] load failed', e);
        setError('Could not load fees (' + (e.code || 'error') + ').');
      }
    }
  }

  const onMutated = () => { if (alive) load({ forceRefresh: false }); };
  window.addEventListener('uic:data-mutated', onMutated);
  window.addEventListener('uic:meta-mutated', onMutated);

  // ---------- Search Dropdown & Matching ----------
  function closeSearchDropdown() {
    const dd = $('sf-search-dropdown');
    if (dd) {
      dd.hidden = true;
      dd.textContent = '';
    }
    currentSuggestions = [];
    highlightedIndex = -1;
  }

  function updateSuggestionHighlight() {
    const dd = $('sf-search-dropdown');
    if (!dd) return;
    dd.querySelectorAll('.pf-suggest-item').forEach((item, idx) => {
      if (idx === highlightedIndex) {
        item.classList.add('is-selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('is-selected');
      }
    });
  }

  function renderSearchDropdown(matches) {
    const dd = $('sf-search-dropdown');
    if (!dd) return;
    dd.textContent = '';
    currentSuggestions = matches.slice(0, 10);
    highlightedIndex = -1;

    if (!currentSuggestions.length) {
      closeSearchDropdown();
      return;
    }

    currentSuggestions.forEach((st, idx) => {
      const item = mk('div', 'pf-suggest-item');
      item.dataset.index = String(idx);

      const avatar = mk('div', 'pf-suggest-avatar');
      avatar.textContent = (st.name || 'ST').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      getKidsStudentPhoto(st).then((url) => {
        if (url && avatar.isConnected) {
          const img = document.createElement('img');
          img.src = url;
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
      const name = mk('span', 'pf-suggest-name', formatPersonName(st.name || 'Unnamed'));
      const id = mk('span', 'pf-suggest-id', st.studentId || st.id);
      top.append(name, id);

      const sub = mk('div', 'pf-suggest-sub');
      const lvlName = (coursesById[st.courseId]?.name) || st.courseLevelName || st.courseName || '—';
      const crs = mk('span', '', lvlName);
      const dot = mk('span', 'pf-suggest-dot', '•');
      const bch = mk('span', '', st.batchName || 'Standard');
      sub.append(crs, dot, bch);
      if ((st.status || '').toLowerCase() === 'break') {
        sub.append(mk('span', 'pf-suggest-dot', '•'), mk('span', '', 'On Break'));
      }

      info.append(top, sub);
      item.append(avatar, info);

      item.addEventListener('mouseenter', () => {
        highlightedIndex = idx;
        updateSuggestionHighlight();
      });
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const input = $('sf-search-input');
        if (input) input.value = st.studentId || st.name || '';
        closeSearchDropdown();
        openStudentPanel(st);
      });
      dd.appendChild(item);
    });

    dd.hidden = false;
  }

  function findMatchingStudents(term) {
    const clean = term.trim();
    if (!clean) return [];
    return students
      .filter((s) => isStudentMatchingQuery(s, clean))
      .sort((a, b) => {
        const sr = statusSortRank(a.status) - statusSortRank(b.status);
        if (sr !== 0) return sr;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }

  function resetSearchResults() {
    currentStudent = null;
    $('sf-panel').hidden = true;
    $('sf-multi-card').hidden = true;
    $('sf-search-empty').hidden = true;
    closeSearchDropdown();
    try {
      if (location.hash.startsWith('#/school-fees')) {
        history.replaceState(null, '', '#/school-fees');
      }
    } catch (_) {}
  }

  function executeSearch() {
    const inp = $('sf-search-input');
    const term = (inp ? inp.value : '').trim();
    if (!term) {
      showToast({ type: 'warning', message: 'Enter a student name, Student ID or phone number.' });
      return;
    }

    const matches = findMatchingStudents(term);
    if (!matches.length) {
      $('sf-panel').hidden = true;
      $('sf-multi-card').hidden = true;
      const es = $('sf-search-empty');
      if (es) {
        es.hidden = false;
        $('sf-search-empty-title').textContent = 'No student found';
        $('sf-search-empty-msg').textContent = `No Unique Kids student matches "${term}".`;
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    $('sf-search-empty').hidden = true;
    const exactId = matches.find((s) => String(s.studentId || '').toLowerCase() === term.toLowerCase());
    if (matches.length === 1 || exactId) {
      $('sf-multi-card').hidden = true;
      openStudentPanel(exactId || matches[0]);
      return;
    }

    $('sf-panel').hidden = true;
    renderMultiStudentList(matches);
  }

  function renderMultiStudentList(matches) {
    const card = $('sf-multi-card');
    const list = $('sf-multi-list');
    const cnt = $('sf-multi-count');
    card.hidden = false;
    cnt.textContent = String(matches.length);
    list.textContent = '';

    matches.forEach((st) => {
      const item = mk('div', 'pf-student-choice');
      const avatar = mk('div', 'pf-choice-avatar');
      avatar.textContent = (st.name || 'ST').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      getKidsStudentPhoto(st).then((url) => {
        if (url && avatar.isConnected) {
          const img = document.createElement('img');
          img.src = url;
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
      const lvlName = (coursesById[st.courseId]?.name) || st.courseLevelName || st.courseName || 'Level';
      body.appendChild(mk('div', 'pf-choice-name', formatPersonName(st.name || 'Unnamed')));
      const meta = mk('div', 'pf-choice-meta');
      const statusTxt = (st.status || '').toLowerCase() === 'break'
        ? ` • ${formatBreakStatusText(st)}`
        : '';
      meta.innerHTML =
        `<span><strong>ID:</strong> ${esc(st.studentId || '—')} &nbsp;|&nbsp; <strong>Phone:</strong> ${esc(st.phone || '—')}</span>` +
        `<span>${esc(lvlName)} &bull; ${esc(st.batchName || 'Batch')}${esc(statusTxt)}</span>`;
      body.appendChild(meta);

      const act = mk('div', 'pf-choice-action');
      act.innerHTML = '<i data-lucide="chevron-right"></i>';
      item.append(avatar, body, act);
      item.addEventListener('click', () => {
        card.hidden = true;
        openStudentPanel(st);
      });
      list.appendChild(item);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ---------- Build Student Month-Wise Bills List (incl. greyed Break months) ----------
  function getStudentBreakMonthsSet(student) {
    const keys = new Set([student.id, student.studentId].filter(Boolean));
    const map = new Map(); // ym -> reason/break period
    const addRange = (fromYM, toYM, brObj) => {
      if (!fromYM || !toYM) return;
      ymRange(fromYM, toYM).forEach((ym) => {
        if (!map.has(ym)) map.set(ym, brObj);
      });
    };

    const stBreaks = breaks.filter((br) => keys.has(br.studentId) || (br.studentCode && keys.has(br.studentCode)));
    stBreaks.forEach((br) => {
      const st = String(br.status || '').toLowerCase().trim();
      if (st === 'active' || st === 'approved') {
        addRange(br.startMonth, br.plannedEndMonth || br.endMonth, br);
      } else if (st === 'completed') {
        const eff = resolveEffectiveBreakMonthRange(br);
        if (eff) addRange(eff.from, eff.to, br);
      }
    });

    if ((student.status || '').toLowerCase() === 'break' && student.breakFrom) {
      addRange(student.breakFrom, student.breakTo || student.breakFrom, {
        startMonth: student.breakFrom,
        plannedEndMonth: student.breakTo || student.breakFrom,
        reason: student.breakReason || 'Student break'
      });
    }
    return map;
  }

  function buildStudentMonthRows(student) {
    const keys = new Set([student.id, student.studentId].filter(Boolean));
    const stuBills = bills.filter((b) => keys.has(b.studentId));
    const breakMonthMap = getStudentBreakMonthsSet(student);
    const byMonth = new Map();

    stuBills.forEach((b) => {
      if (!b.month) return;
      const brInfo = breakMonthMap.get(b.month);
      const st = String(b.status || 'unpaid').toLowerCase();
      // If inside an active/completed break and unpaid untouched, treat as break-waived
      if (brInfo && st === 'unpaid' && !(Number(b.paidAmount || 0) > 0)) {
        byMonth.set(b.month, {
          ...b,
          status: 'break-waived',
          monthlyFee: 0,
          _breakInfo: brInfo
        });
      } else {
        byMonth.set(b.month, { ...b, _breakInfo: brInfo || null });
      }
    });

    // Ensure break months (including future planned break months like Jan-Mar 2027)
    // appear cleanly as greyed "Break - no fee" rows even when no bill doc was created.
    breakMonthMap.forEach((brInfo, ym) => {
      if (!byMonth.has(ym)) {
        byMonth.set(ym, {
          id: `break_${student.id}_${ym}`,
          studentId: student.id,
          month: ym,
          monthlyFee: 0,
          paidAmount: 0,
          status: 'break-waived',
          _syntheticBreak: true,
          _breakInfo: brInfo
        });
      }
    });

    return Array.from(byMonth.values()).sort((a, b) => monthSeq(a.month) - monthSeq(b.month));
  }

  function openStudentPanel(student) {
    currentStudent = student;
    closeSearchDropdown();
    setTab('collect');
    try {
      const targetHash = `#/school-fees?student=${encodeURIComponent(student.id)}`;
      if (location.hash !== targetHash) history.replaceState(null, '', targetHash);
    } catch (_) {}
    $('sf-multi-card').hidden = true;
    $('sf-search-empty').hidden = true;
    $('sf-panel').hidden = false;
    renderStudentPanel();
  }

  function renderStudentPanel() {
    const s = currentStudent;
    if (!s) return;

    const lvlName = (coursesById[s.courseId]?.name) || s.courseLevelName || s.courseName || '—';
    $('sf-student-name').textContent = formatPersonName(s.name || 'Unnamed');
    $('sf-student-id').textContent = s.studentId || s.id || '—';
    $('sf-level-name').textContent = lvlName;
    $('sf-batch-name').textContent = s.batchName || '—';
    $('sf-phone-text').textContent = s.phone || '—';

    const statusEl = $('sf-student-status');
    const stLow = String(s.status || 'active').toLowerCase();
    const today = localToday();
    if (stLow === 'break') {
      const keys = new Set([s.id, s.studentId].filter(Boolean));
      const ongoingBr = breaks.find((b) =>
        (keys.has(b.studentId) || (b.studentCode && keys.has(b.studentCode))) &&
        ['active', 'approved'].includes(String(b.status || '').toLowerCase()) &&
        !b.actualReturnDate
      );
      const fromYM = ongoingBr?.startMonth || s.breakFrom || '';
      const toYM = ongoingBr?.plannedEndMonth || ongoingBr?.endMonth || s.breakTo || fromYM;
      const periodText = fromYM ? formatBreakPeriod(fromYM, toYM) : '';
      const isOvd = isBreakOverdueReturn(ongoingBr || s, today);
      statusEl.textContent = periodText
        ? (isOvd ? `On Break (${periodText}) · Rejoin overdue` : `On Break (${periodText})`)
        : 'On Break';
      statusEl.className = 'pill ' + (isOvd ? 'break-overdue' : 'break');
    } else if (stLow === 'active') {
      statusEl.textContent = 'Active';
      statusEl.className = 'pill up';
    } else {
      const cap = stLow.charAt(0).toUpperCase() + stLow.slice(1);
      statusEl.textContent = cap;
      statusEl.className = 'pill ' + (stLow === 'dropped' ? 'inactive' : 'completed');
    }

    // Photo / Initials
    const avatarText = $('sf-avatar-text');
    const avatarImg = $('sf-avatar-img');
    avatarText.textContent = (s.name || 'ST').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    avatarText.hidden = false;
    avatarImg.hidden = true;
    avatarImg.src = '';
    const thisId = s.id;
    getKidsStudentPhoto(s).then((url) => {
      if (currentStudent && currentStudent.id === thisId && url && avatarImg.isConnected) {
        avatarImg.onload = () => {
          if (currentStudent && currentStudent.id === thisId) {
            avatarImg.hidden = false;
            avatarText.hidden = true;
          }
        };
        avatarImg.onerror = () => {
          avatarImg.hidden = true;
          avatarText.hidden = false;
        };
        avatarImg.src = url;
      }
    });

    const rows = buildStudentMonthRows(s);
    const payableBills = rows.filter((b) => ['unpaid', 'partial'].includes(String(b.status || 'unpaid').toLowerCase()));
    const paidRows = rows.filter((b) => String(b.status || '').toLowerCase() === 'paid');

    const totalBaseDue = rupees(payableBills.reduce((sum, b) => (
      sum + Math.max(0, rupees(b.monthlyFee || 0) - rupees(b.paidAmount || 0) - rupees(b.waivedAmount || 0))
    ), 0));
    const totalLateDue = rupees(payableBills.reduce((sum, b) => sum + computeLateFee(b, today), 0));
    const totalPaidSum = rupees(paidRows.reduce((sum, b) => sum + rupees(b.paidAmount || b.monthlyFee || 0), 0));

    const startMonthYM = s.firstMonthlyMonth || firstMonthlyMonth(s.admissionDate);
    $('sf-m-rate').textContent = formatINR(Number(s.monthlyFee || 0));
    $('sf-m-start').textContent = startMonthYM ? `From ${formatShortMonthYear(startMonthYM)}` : 'Ongoing billing';
    $('sf-m-paid').textContent = formatINR(totalPaidSum);
    $('sf-m-paid-count').textContent = `${paidRows.length} month${paidRows.length === 1 ? '' : 's'} settled`;
    $('sf-m-due').textContent = formatINR(totalBaseDue);
    $('sf-m-due-count').textContent = `${payableBills.length} bill${payableBills.length === 1 ? '' : 's'} unpaid`;
    $('sf-m-late').textContent = formatINR(totalLateDue);

    const billsCountEl = $('sf-bills-count');
    if (billsCountEl) billsCountEl.textContent = `${rows.length} month${rows.length === 1 ? '' : 's'}`;

    const collectAllBtn = $('sf-btn-collect-all');
    const collectAllLbl = $('sf-btn-collect-all-lbl');
    if (collectAllBtn) {
      if (payableBills.length > 0) {
        collectAllBtn.hidden = false;
        if (collectAllLbl) {
          collectAllLbl.textContent = payableBills.length > 1
            ? `Collect all due (${formatINR(totalBaseDue + totalLateDue)})`
            : `Collect due (${formatINR(totalBaseDue + totalLateDue)})`;
        }
        collectAllBtn.onclick = () => {
          openPaymentPopup({
            student: { ...s, ctx: 'school' },
            profile,
            preselectedOption: payableBills.length > 1 ? 'BILL_ALL' : undefined,
            preselectedBillId: payableBills.length === 1 ? payableBills[0].id : '',
            bills: payableBills,
            from: 'school-fees',
            onSuccess: () => load({ forceRefresh: false })
          });
        };
      } else {
        collectAllBtn.hidden = true;
      }
    }

    const tbody = $('sf-student-bills-tbody');
    if (tbody) {
      tbody.textContent = '';
      if (!rows.length) {
        const tr = mk('tr');
        const td = mk('td', 'text-mute text-center', startMonthYM
          ? `No monthly bills due yet. Monthly billing starts ${formatShortMonthYear(startMonthYM)}.`
          : 'No monthly bills generated for this student yet.');
        td.colSpan = 6;
        td.style.padding = '18px 12px';
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        rows.forEach((b) => {
          const st = String(b.status || 'unpaid').toLowerCase();
          const tr = mk('tr', st === 'break-waived' ? 'sf-row-break' : '');
          const monthLabel = formatShortMonthYear(b.month) || b.month || '—';

          // Month
          const tdMonth = mk('td');
          tdMonth.appendChild(mk('strong', '', monthLabel));
          if (b.dueDate && (st === 'unpaid' || st === 'partial')) {
            tdMonth.appendChild(mk('div', 'pf-status-sub', `Due ${formatDateIN(b.dueDate)}`));
          } else if (st === 'break-waived' && b._breakInfo?.startMonth) {
            tdMonth.appendChild(mk('div', 'pf-status-sub', `Break (${formatBreakPeriod(b._breakInfo.startMonth, b._breakInfo.plannedEndMonth || b._breakInfo.endMonth)})`));
          }

          // Fee
          const tdFee = mk('td', 'num');
          tdFee.textContent = st === 'break-waived' ? '₹0.00' : formatINR(b.monthlyFee || 0);

          // Late fine
          const dl = (st === 'unpaid' || st === 'partial') ? daysLate(b.month, today) : 0;
          const lateNow = (st === 'unpaid' || st === 'partial') ? computeLateFee(b, today) : 0;
          const tdLate = mk('td', 'num');
          if (st === 'break-waived' || st === 'stopped' || st === 'cancelled') {
            tdLate.className = 'num text-mute';
            tdLate.textContent = '—';
          } else if (st === 'paid') {
            if (b.waived) {
              tdLate.innerHTML = '<span class="text-mute">Waived</span>';
            } else {
              const pLate = Number(b.lateFee || 0);
              tdLate.textContent = formatINR(pLate);
              if (pLate <= 0) tdLate.classList.add('text-mute');
            }
          } else {
            tdLate.textContent = formatINR(lateNow);
            if (lateNow > 0) tdLate.className = 'num text-danger font-semibold';
            else tdLate.classList.add('text-mute');
          }

          // Status
          const tdSt = mk('td');
          if (st === 'paid') {
            tdSt.innerHTML = '<span class="uk-pill active">Paid</span>';
          } else if (st === 'break-waived') {
            tdSt.innerHTML = '<span class="uk-pill break-grey">Break - no fee</span>';
          } else if (st === 'stopped' || st === 'cancelled') {
            tdSt.innerHTML = '<span class="uk-pill completed">Stopped</span>';
          } else if (dl > 0) {
            tdSt.innerHTML = `<span class="uk-pill overdue">Overdue</span><div class="pf-status-sub">${dl} day${dl === 1 ? '' : 's'} late</div>`;
          } else if (st === 'partial') {
            tdSt.innerHTML = '<span class="uk-pill unpaid">Partial</span>';
          } else {
            tdSt.innerHTML = '<span class="uk-pill unpaid">Unpaid</span>';
          }

          // Receipt no.
          const tdRcpt = mk('td');
          if (st === 'paid' && b.receiptNo) {
            const pId = resolvePaymentIdForBill(b, s);
            const rLink = mk('a', 'pf-receipt-link sf-rcpt-code', b.receiptNo);
            rLink.href = `#/payments/${encodeURIComponent(s.id)}/${encodeURIComponent(pId)}/receipt?from=school-fees`;
            tdRcpt.appendChild(rLink);
          } else {
            tdRcpt.innerHTML = '<span class="text-mute">—</span>';
          }

          // Action
          const tdAct = mk('td', 'act');
          if (st === 'unpaid' || st === 'partial') {
            const btn = mk('button', 'ui-btn primary sm pf-btn-collect');
            btn.type = 'button';
            btn.innerHTML = '<i data-lucide="wallet"></i><span>Collect</span>';
            btn.addEventListener('click', () => {
              openPaymentPopup({
                student: { ...s, ctx: 'school' },
                profile,
                preselectedBillId: b.id,
                bills: payableBills,
                from: 'school-fees',
                onSuccess: () => load({ forceRefresh: false })
              });
            });
            tdAct.appendChild(btn);
          } else if (st === 'paid') {
            const pId = resolvePaymentIdForBill(b, s);
            const rBtn = mk('button', 'ui-btn ghost sm pf-btn-receipt');
            rBtn.type = 'button';
            rBtn.innerHTML = '<i data-lucide="receipt"></i><span>Receipt</span>';
            rBtn.addEventListener('click', () => {
              location.hash = `#/payments/${encodeURIComponent(s.id)}/${encodeURIComponent(pId)}/receipt?from=school-fees`;
            });
            tdAct.appendChild(rBtn);
          } else if (st === 'break-waived') {
            tdAct.appendChild(mk('span', 'sf-break-locked', 'No fee'));
          } else {
            tdAct.appendChild(mk('span', 'text-mute', '—'));
          }

          tr.append(tdMonth, tdFee, tdLate, tdSt, tdRcpt, tdAct);
          tbody.appendChild(tr);
        });
      }
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ---------- Today's Collections List ----------
  function renderTodayCollections() {
    const tbody = $('sf-today-tbody');
    const emptyBox = $('sf-today-empty');
    const countEl = $('sf-today-count');
    const totalEl = $('sf-today-total');
    if (!tbody || !emptyBox || !countEl || !totalEl) return;

    const today = localToday();
    const todayItems = historyEntries
      .filter((e) => !e.isPureWaiver && Number(e.totalReceived || 0) > 0 && String(e.date || '').slice(0, 10) === today)
      .slice()
      .sort((a, b) => Number(b.createdAtSec || 0) - Number(a.createdAtSec || 0));

    const sumToday = rupees(todayItems.reduce((sum, e) => sum + Number(e.totalReceived || 0), 0));
    countEl.textContent = `${todayItems.length} collection${todayItems.length === 1 ? '' : 's'}`;
    totalEl.textContent = formatINR(sumToday);

    tbody.textContent = '';
    if (!todayItems.length) {
      emptyBox.hidden = false;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }

    emptyBox.hidden = true;
    todayItems.forEach((entry) => {
      const tr = mk('tr');
      const tdTime = mk('td', 'text-mute', formatCollectionTime(entry));

      const tdStu = mk('td');
      const stuBtn = mk('button', 'sf-today-student-btn', formatPersonName(entry.studentName || 'Student'));
      stuBtn.type = 'button';
      stuBtn.addEventListener('click', () => {
        const match = findStudentByKey(entry.studentDocId, entry.studentId);
        if (match) openStudentPanel(match);
      });
      tdStu.appendChild(stuBtn);
      if (entry.studentId) {
        tdStu.appendChild(mk('div', 'pf-status-sub', entry.studentId));
      }

      const tdMonth = mk('td', '', formatEntryMonthsLabel(entry));
      const tdAmt = mk('td', 'num font-semibold', formatINR(entry.totalReceived || 0));

      const metaMode = modeDisplayMeta(entry);
      const tdMode = mk('td');
      tdMode.innerHTML = `<span class="la-mode ${esc(metaMode.cls || '')}">${esc(metaMode.label || 'Cash')}</span>`;

      const tdRcpt = mk('td');
      if (entry.receiptNo && entry.receiptNo !== '—') {
        const link = mk('a', 'pf-receipt-link sf-rcpt-code', entry.receiptNo);
        if (entry.type === 'AD') {
          link.href = `#/school-admissions/${encodeURIComponent(entry.studentDocId)}/receipt`;
        } else {
          link.href = `#/payments/${encodeURIComponent(entry.studentDocId)}/${encodeURIComponent(entry.id || 'latest')}/receipt?from=school-fees`;
        }
        tdRcpt.appendChild(link);
      } else {
        tdRcpt.innerHTML = '<span class="text-mute">—</span>';
      }

      tr.append(tdTime, tdStu, tdMonth, tdAmt, tdMode, tdRcpt);
      tbody.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ---------- Tab 2: All Bills List ----------
  function renderAllBillsTab() {
    if (!rowsHost) return;
    rowsHost.hidden = false;
    rowsHost.innerHTML = '';
    loadingEl.hidden = true;
    emptyEl.hidden = true;
    noMatchEl.hidden = true;
    loadErrorEl.hidden = true;

    const f = tb.state || {};
    const q = (f.q || '').toLowerCase();

    const studentName = (id) => { const s = findStudentByKey(id); return s ? (s.name || '-') : '-'; };
    const studentPhone = (id) => { const s = findStudentByKey(id); return s ? (s.phone || '-') : '-'; };
    const studentId_ = (id) => { const s = findStudentByKey(id); return s ? (s.studentId || '-') : '-'; };

    const list = bills.filter((b) => {
      const st = String(b.status || 'unpaid').toLowerCase();
      if (f.status && f.status !== 'all') {
        if (f.status === 'overdue') {
          if ((st !== 'unpaid' && st !== 'partial') || daysLate(b.month) <= 0) return false;
        } else if (st !== f.status) return false;
      }
      if (f.month && f.month !== 'all' && b.month !== f.month) return false;
      if (f.level && f.level !== 'all') {
        if (String(b.courseId || '') !== String(f.level)) return false;
      }
      if (q) {
        const hay = [studentName(b.studentId), studentId_(b.studentId), studentPhone(b.studentId)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const unpaidN = bills.filter((b) => b.status === 'unpaid' || b.status === 'partial').length;
    const paidN = bills.filter((b) => b.status === 'paid').length;
    const overdueN = bills.filter((b) => (b.status === 'unpaid' || b.status === 'partial') && daysLate(b.month) > 0).length;
    stats.update(0, bills.length);
    stats.update(1, unpaidN);
    stats.update(2, paidN);
    stats.update(3, overdueN);

    if (bills.length === 0) {
      emptyEl.hidden = false;
      footEl.hidden = true;
      return;
    }

    if (!list.length) {
      noMatchEl.hidden = false;
      footEl.hidden = true;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > totalPages) page = totalPages;
    const pageList = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    pageList.forEach((b) => {
      const s = findStudentByKey(b.studentId, b.studentCode) || {};
      const c = coursesById[b.courseId] || {};
      const late = computeLateFee(b);
      const st = String(b.status || 'unpaid').toLowerCase();
      const canPay = st === 'unpaid' || st === 'partial';
      const stText = st === 'paid'
        ? 'Paid'
        : (st === 'partial'
          ? 'Partial (' + Math.round((Number(b.paidAmount || 0) / Number(b.monthlyFee || 1)) * 100) + '%)'
          : (st === 'break-waived'
            ? 'Break - no fee'
            : (st === 'stopped' || st === 'cancelled' ? 'Stopped' : 'Unpaid')));
      const tr = mk('tr', st === 'break-waived' ? 'sf-row-break' : '');
      tr.innerHTML =
        `<td class="sf-id">${esc(s.studentId || '-')}</td>` +
        `<td>${esc(formatPersonName(s.name || '') || '-')}</td>` +
        `<td class="hide-sm">${esc(s.phone || '-')}</td>` +
        `<td>${esc(c.name || b.courseName || '-')}</td>` +
        `<td>${esc(b.month || '-')}</td>` +
        `<td>${st === 'break-waived' ? '₹0' : esc(formatINR(b.monthlyFee))}</td>` +
        `<td>${esc(stText)}</td>` +
        `<td>${late > 0 ? esc(formatINR(late)) : '-'}</td>` +
        `<td class="sk-actions">` +
        (canPay ? `<button type="button" class="sk-act pay" data-id="${esc(b.id)}" title="Collect payment"><i data-lucide="credit-card"></i><span>Collect</span></button>` : `<span class="text-mute">—</span>`) +
        `</td>`;
      rowsHost.appendChild(tr);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();

    if (footEl) {
      footEl.hidden = list.length === 0;
      renderPager(footEl, {
        page,
        pageSize: PAGE_SIZE,
        totalItems: list.length,
        showWhenSingle: true,
        onPageChange: (next) => { page = next; renderAllBillsTab(); }
      });
    }

    rowsHost.querySelectorAll('.pay').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bill = bills.find((x) => x.id === btn.dataset.id);
        if (!bill) return;
        const matchedStu = findStudentByKey(bill.studentId, bill.studentCode);
        const stuObj = matchedStu
          ? { ...matchedStu, ctx: 'school' }
          : { id: bill.studentId, studentId: bill.studentCode || bill.studentId, name: bill.studentName || 'Student', ctx: 'school', courseId: bill.courseId || '', courseName: bill.courseName || '' };
        const stuBills = bills.filter((x) => x.studentId === bill.studentId || (stuObj.studentId && x.studentId === stuObj.studentId));
        openPaymentPopup({
          student: stuObj,
          profile,
          preselectedBillId: bill.id,
          bills: stuBills,
          from: 'school-fees',
          onSuccess: () => load({ forceRefresh: false })
        });
      });
    });
  }

  // ---------- Bind Events ----------
  const searchInput = $('sf-search-input');
  const searchBtn = $('sf-search-btn');
  const clearBtn = $('sf-search-clear');

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const val = searchInput.value.trim();
      if (clearBtn) clearBtn.hidden = !val;
      if (!val) {
        closeSearchDropdown();
        return;
      }
      renderSearchDropdown(findMatchingStudents(val));
    });

    searchInput.addEventListener('keydown', (e) => {
      const dd = $('sf-search-dropdown');
      const isOpen = dd && !dd.hidden && currentSuggestions.length > 0;
      if (e.key === 'ArrowDown') {
        if (isOpen) {
          e.preventDefault();
          highlightedIndex = (highlightedIndex + 1) % currentSuggestions.length;
          updateSuggestionHighlight();
        }
      } else if (e.key === 'ArrowUp') {
        if (isOpen) {
          e.preventDefault();
          highlightedIndex = (highlightedIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
          updateSuggestionHighlight();
        }
      } else if (e.key === 'Escape') {
        closeSearchDropdown();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isOpen && highlightedIndex >= 0 && currentSuggestions[highlightedIndex]) {
          const chosen = currentSuggestions[highlightedIndex];
          searchInput.value = chosen.studentId || chosen.name || '';
          closeSearchDropdown();
          openStudentPanel(chosen);
        } else {
          closeSearchDropdown();
          executeSearch();
        }
      }
    });
  }

  const onOutsideClick = (e) => {
    const wrap = container ? container.querySelector('.pf-search-input-wrap') : document.querySelector('#sf-collect-view .pf-search-input-wrap');
    if (wrap && !wrap.contains(e.target)) closeSearchDropdown();
  };
  document.addEventListener('click', onOutsideClick);

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      closeSearchDropdown();
      executeSearch();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearBtn.hidden = true;
      resetSearchResults();
    });
  }

  const copyBtn = $('sf-btn-copy-id');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (currentStudent?.studentId) {
        navigator.clipboard?.writeText(currentStudent.studentId).then(() => {
          showToast({ type: 'success', message: 'Student ID copied: ' + currentStudent.studentId });
        }).catch(() => {});
      }
    });
  }

  const profileBtn = $('sf-btn-view-profile');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      if (currentStudent?.id) location.hash = '#/students/' + encodeURIComponent(currentStudent.id);
    });
  }

  const allPayBtn = $('sf-btn-all-payments');
  if (allPayBtn) {
    allPayBtn.addEventListener('click', () => {
      if (currentStudent?.id) location.hash = '#/students/' + encodeURIComponent(currentStudent.id) + '?tab=payments';
    });
  }

  $('sf-load-error-retry').addEventListener('click', () => { load({ forceRefresh: true }); });
  $('sf-load-error-back').addEventListener('click', () => { location.hash = '#/dashboard'; });
  $('sf-no-match-clear').addEventListener('click', () => {
    tb.state.q = '';
    tb.state.status = 'all';
    tb.state.month = 'all';
    tb.state.level = 'all';
    renderAllBillsTab();
  });

  cleanupPage = () => {
    alive = false;
    window.removeEventListener('uic:data-mutated', onMutated);
    window.removeEventListener('uic:meta-mutated', onMutated);
    document.removeEventListener('click', onOutsideClick);
  };

  try {
    await load();
  } catch (e) {
    console.error('[school-fees] init load', e);
    setError('Could not load fees.');
  }

  // Deep-link ?student=<id> or ?tab=all
  const qIdx = (location.hash || '').indexOf('?');
  let openedDirect = false;
  if (qIdx !== -1) {
    const params = new URLSearchParams(location.hash.slice(qIdx));
    const stParam = params.get('student');
    const tabParam = params.get('tab');
    if (tabParam === 'all') {
      setTab('all');
    } else if (stParam) {
      let targetStu = findStudentByKey(stParam);
      if (!targetStu) {
        try {
          const snap = await getDoc(doc(db, 'students', stParam));
          if (snap.exists() && snap.data()?.ctx === 'school') {
            targetStu = { id: snap.id, ...snap.data() };
          }
        } catch (_) {}
      }
      if (targetStu) {
        openedDirect = true;
        if (searchInput) {
          searchInput.value = targetStu.studentId || targetStu.name || '';
          if (clearBtn) clearBtn.hidden = false;
        }
        markRouteScrollHandled();
        openStudentPanel(targetStu);
      }
    }
  }
  if (!openedDirect && activeTab === 'collect') {
    requestAnimationFrame(() => {
      if (searchInput && searchInput.focus) searchInput.focus({ preventScroll: true });
    });
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
