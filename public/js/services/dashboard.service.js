// dashboard.service.js — Read-only analytics aggregator for Youth Centre Dashboard (#/dashboard).
// Computes KPI strips, Fee Head stacked bars, Branch counts, and Recent Payments cleanly on top
// of buildYouthReportsData so figures match Reports, Payment History, and Pending & Overdue.

import {
  buildYouthReportsData,
  summarizePaymentLedger,
  filterOverdueItems,
  getDatePresetRange,
  toTitleCaseIfCaps,
  todayISO
} from './report.service.js?v=1.8.187';
import { isStudentEligibleForDues } from './payment.service.js?v=1.8.187';

function toIsoDate(ts) {
  if (!ts) return '';
  if (typeof ts === 'string') return ts.slice(0, 10);
  if (typeof ts.toDate === 'function') {
    try { return ts.toDate().toISOString().slice(0, 10); } catch (_) { return ''; }
  }
  const sec = Number(ts.seconds ?? ts._seconds ?? 0);
  if (Number.isFinite(sec) && sec > 0) {
    try { return new Date(sec * 1000).toISOString().slice(0, 10); } catch (_) { return ''; }
  }
  return '';
}

/**
 * Computes the read-only Youth Centre Dashboard model on top of buildYouthReportsData
 * so KPI numbers and chart totals stay 100% identical to Reports, Payment History, and Pending.
 */
export function buildYouthDashboardData({
  entries = [],
  pendingReport = null,
  activeSession = null,
  prevPendingReport = null,
  prevSession = null,
  branchesList = [],
  coursesList = [],
  batchesList = [],
  branchesById = {},
  coursesById = {},
  batchesById = {},
  profile = null,
  branchFilter = 'all',
  asOfDate = todayISO()
} = {}) {
  const isSuper = profile?.role === 'superadmin';
  const isBranchHead = !isSuper && profile?.role === 'branch_head' && !!profile?.branchId;
  const effectiveBranchId = isBranchHead ? profile.branchId : (branchFilter || 'all');
  const sessId = activeSession?.id || '';
  const today = String(asOfDate || todayISO());

  const reports = buildYouthReportsData({
    entries,
    pendingReport,
    activeSession,
    prevPendingReport,
    prevSession,
    branchesList,
    coursesList,
    batchesList,
    branchesById,
    coursesById,
    batchesById,
    profile,
    filters: {
      branchId: effectiveBranchId,
      batchId: 'all',
      courseId: 'all',
      datePreset: 'session',
      dateFrom: '',
      dateTo: ''
    },
    asOfDate: today
  });

  const structEntries = (entries || []).filter((e) => {
    if (!e || (e.ctx && e.ctx !== 'youth')) return false;
    if (sessId && e.sessionId && e.sessionId !== sessId) return false;
    if (effectiveBranchId !== 'all' && e.branchId !== effectiveBranchId) return false;
    return true;
  });

  const allSessionStudents = Object.values(pendingReport?.studentsById || {}).filter(Boolean);
  const scopedStudents = allSessionStudents.filter((s) => {
    if (!s || (s.ctx && s.ctx !== 'youth')) return false;
    if (sessId && s.sessionId && s.sessionId !== sessId) return false;
    if (effectiveBranchId !== 'all' && s.branchId !== effectiveBranchId) return false;
    return true;
  });
  const isNonDroppedStu = (s) => !['dropped', 'left', 'inactive', 'deleted']
    .includes(String(s?.status || 'active').toLowerCase().trim());
  const scopedNonDropped = scopedStudents.filter(isNonDroppedStu);

  const rawOverdueItems = filterOverdueItems(pendingReport?.items || [], today);
  const filteredOverdueItems = rawOverdueItems.filter((it) => (
    effectiveBranchId === 'all' || it.branchId === effectiveBranchId
  ));

  // Today, Session & This Month Collections (same ledger helper as Payment History)
  const sessionPaySummary = summarizePaymentLedger(structEntries);
  const todayEntries = structEntries.filter((e) => String(e.date || '').slice(0, 10) === today);
  const todaySummary = summarizePaymentLedger(todayEntries);

  const { dateFrom: monthFrom, dateTo: monthTo } = getDatePresetRange('month', today, activeSession);
  const monthEntries = structEntries.filter((e) => {
    const d = String(e.date || '').slice(0, 10);
    return Boolean(d && (!monthFrom || d >= monthFrom) && (!monthTo || d <= monthTo));
  });
  const monthSummary = summarizePaymentLedger(monthEntries);

  const admissionsThisMonth = scopedStudents.filter((s) => {
    const adm = String(s.admissionDate || toIsoDate(s.createdAt) || '').slice(0, 10);
    return Boolean(adm && (!monthFrom || adm >= monthFrom) && (!monthTo || adm <= monthTo));
  }).length;

  // Batches & branches count for header subtitle + Active Students chip
  const batchFilling = reports.students?.batchFilling || [];
  const runningBatchesCount = batchFilling.length;
  const activeBatchesSet = new Set(
    scopedStudents.filter((s) => isStudentEligibleForDues(s) && s.batchId).map((s) => s.batchId)
  );
  const activeBatchesCount = activeBatchesSet.size || runningBatchesCount;

  const youthBranches = (branchesList || []).filter((b) => (
    b && (!b.ctx || b.ctx === 'youth') && (effectiveBranchId === 'all' || b.id === effectiveBranchId)
  ));
  const activeBranchesCount = youthBranches.length || (effectiveBranchId === 'all' ? 0 : 1);

  const overdueStudentSet = new Set(filteredOverdueItems.map((it) => it.studentDocId).filter(Boolean));
  const overdueStudentCount = overdueStudentSet.size;
  const studentsWithBalanceCount = Number(reports.dues?.studentsWithBalanceCount || 0);

  // Collection by Fee Head (Collected vs Overdue per Admission, Inst 1..N, Exam, Material)
  let maxInstNo = Math.max(
    4,
    Number(Array.isArray(activeSession?.installments) ? activeSession.installments.length : (activeSession?.installmentCount || 0))
  );
  structEntries.forEach((e) => {
    if (e.isPureWaiver || e.type === 'WA' || Number(e.totalReceived || 0) <= 0) return;
    const t = String(e.type || '').toUpperCase();
    if (t === 'AD' || t === 'ADMISSION' || t === 'FULL' || t === 'MAT' || t === 'EX') return;
    const no = Number(e.installmentNo || 0);
    if (no > maxInstNo && no <= 24) maxInstNo = no;
  });
  filteredOverdueItems.forEach((it) => {
    const no = Number(it.installmentNo || 0);
    if (no > maxInstNo && no <= 24) maxInstNo = no;
  });

  const feeHeadOrder = ['AD'];
  for (let i = 1; i <= maxInstNo; i += 1) feeHeadOrder.push(`IN_${i}`);
  feeHeadOrder.push('EX', 'MAT');

  const feeHeadMeta = {
    AD: { label: 'Admission / Full', shortLabel: 'Adm' },
    EX: { label: 'Exam Fee', shortLabel: 'Exam' },
    MAT: { label: 'Material Fee', shortLabel: 'Material' }
  };
  for (let i = 1; i <= maxInstNo; i += 1) {
    feeHeadMeta[`IN_${i}`] = { label: `Installment ${i}`, shortLabel: `Inst ${i}` };
  }

  const feeHeadBuckets = new Map();
  feeHeadOrder.forEach((key) => {
    const m = feeHeadMeta[key];
    feeHeadBuckets.set(key, { key, label: m.label, shortLabel: m.shortLabel, collected: 0, overdue: 0 });
  });

  structEntries.forEach((e) => {
    const total = Number(e.totalReceived || 0);
    if (e.isPureWaiver || e.type === 'WA' || total <= 0) return;
    if (e.isAdmissionGroup && Array.isArray(e.breakdown) && e.breakdown.length) {
      let sumParts = 0;
      e.breakdown.forEach((b) => {
        const bAmt = Number(b.amount || 0);
        if (bAmt <= 0) return;
        sumParts += bAmt;
        const bt = String(b.type || '').toUpperCase();
        const k = bt === 'MAT' ? 'MAT' : 'AD';
        feeHeadBuckets.get(k).collected += bAmt;
      });
      const remainder = total - sumParts;
      if (remainder > 0) feeHeadBuckets.get('AD').collected += remainder;
      return;
    }
    const t = String(e.type || '').toUpperCase();
    if (t === 'MAT') feeHeadBuckets.get('MAT').collected += total;
    else if (t === 'EX') feeHeadBuckets.get('EX').collected += total;
    else if (t === 'AD' || t === 'ADMISSION' || t === 'FULL') feeHeadBuckets.get('AD').collected += total;
    else {
      const no = Math.max(1, Number(e.installmentNo || 1));
      const key = `IN_${no}`;
      if (!feeHeadBuckets.has(key)) {
        feeHeadBuckets.set(key, { key, label: `Installment ${no}`, shortLabel: `Inst ${no}`, collected: 0, overdue: 0 });
      }
      feeHeadBuckets.get(key).collected += total;
    }
  });

  filteredOverdueItems.forEach((it) => {
    const amt = Number(it.amount || 0);
    if (amt <= 0) return;
    const k = String(it.kind || '').toUpperCase();
    if (k === 'MAT') feeHeadBuckets.get('MAT').overdue += amt;
    else if (k === 'EX') feeHeadBuckets.get('EX').overdue += amt;
    else if (k === 'AD' || k === 'ADMISSION') feeHeadBuckets.get('AD').overdue += amt;
    else {
      const no = Math.max(1, Number(it.installmentNo || 1));
      const key = `IN_${no}`;
      if (!feeHeadBuckets.has(key)) {
        feeHeadBuckets.set(key, { key, label: `Installment ${no}`, shortLabel: `Inst ${no}`, collected: 0, overdue: 0 });
      }
      feeHeadBuckets.get(key).overdue += amt;
    }
  });

  const feeHeadBars = Array.from(feeHeadBuckets.values());

  // Students by Branch (using exact same non-dropped student population as Students by Course)
  const branchStuMap = new Map();
  youthBranches.forEach((b) => {
    const code = String(b.code || b.branchCode || b.shortCode || '').trim();
    const cleanName = toTitleCaseIfCaps(b.name || b.branchName || code || b.id) || code || b.id;
    branchStuMap.set(b.id, {
      branchId: b.id,
      label: cleanName,
      shortLabel: code || cleanName,
      count: 0
    });
  });
  scopedNonDropped.forEach((s) => {
    const bId = s.branchId || 'UNASSIGNED';
    if (!branchStuMap.has(bId)) {
      const br = branchesById[bId] || {};
      const code = String(br.code || br.branchCode || s.branchCode || '').trim();
      const cleanName = toTitleCaseIfCaps(br.name || s.branchName || code || bId) || 'Unassigned';
      branchStuMap.set(bId, {
        branchId: bId,
        label: cleanName,
        shortLabel: code || cleanName,
        count: 0
      });
    }
    branchStuMap.get(bId).count += 1;
  });

  const branchRows = Array.from(branchStuMap.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const maxBranchStu = Math.max(1, ...branchRows.map((r) => r.count));
  const studentsByBranch = branchRows.map((r) => ({
    ...r,
    pct: r.count > 0 ? Math.max(4, Math.round((r.count / maxBranchStu) * 100)) : 0
  }));

  // Last 5 Recent Money Receipts sorted descending
  const recentPayments = structEntries
    .filter((e) => !e.isPureWaiver && e.type !== 'WA' && Number(e.totalReceived || 0) > 0)
    .slice()
    .sort((a, b) => (
      String(b.date || '').localeCompare(String(a.date || '')) ||
      Number(b.createdAtSec || 0) - Number(a.createdAtSec || 0) ||
      String(b.receiptNo || '').localeCompare(String(a.receiptNo || ''))
    ))
    .slice(0, 5);

  return {
    effectiveBranchId,
    isBranchHead,
    today,
    reports,
    kpis: {
      activeStudents: {
        value: Number(reports.kpis.activeStudents.value || 0),
        activeBatchesCount
      },
      newAdmissions: {
        value: Number(reports.kpis.newAdmissions.value || 0),
        thisMonth: admissionsThisMonth
      },
      feeCollection: {
        value: Number(reports.kpis.totalCollected.value || 0),
        receipts: Number(sessionPaySummary.moneyReceipts || 0),
        collectionRate: Number(reports.kpis.collectionRate.value || 0),
        totalCourseFee: Number(reports.kpis.collectionRate.totalCourseFee || 0)
      },
      overdueFees: {
        value: Number(reports.kpis.overdueAmount.value || 0),
        studentCount: overdueStudentCount
      },
      todayCollection: {
        value: Number(todaySummary.totalCollected || 0),
        receipts: Number(todaySummary.moneyReceipts || 0)
      },
      monthCollection: {
        value: Number(monthSummary.totalCollected || 0),
        receipts: Number(monthSummary.moneyReceipts || 0)
      },
      outstandingDues: {
        value: Number(reports.kpis.outstandingDues.value || 0),
        studentsWithBalanceCount
      },
      collectionRate: {
        value: Number(reports.kpis.collectionRate.value || 0),
        totalCourseFee: Number(reports.kpis.collectionRate.totalCourseFee || 0)
      }
    },
    headerMeta: {
      runningBatchesCount,
      activeBranchesCount
    },
    feeHeadBars,
    feeHeadTotals: {
      collected: Number(reports.kpis.totalCollected.value || 0),
      overdue: Number(reports.kpis.overdueAmount.value || 0)
    },
    studentsByBranch,
    totalBranchStudents: scopedNonDropped.length,
    studentsByCourse: reports.students?.byCourse || [],
    totalCourseStudents: Number(reports.students?.totalCount || 0),
    trendPoints: reports.money?.trendPoints || [],
    useDailyTrend: Boolean(reports.money?.useDailyTrend),
    modeSlices: reports.money?.modeSlices || [],
    totalCollected: Number(reports.money?.totalCollected || 0),
    recentPayments,
    ageingSlices: reports.dues?.ageingSlices || [],
    overdueTotal: Number(reports.dues?.overdueTotal || 0)
  };
}
