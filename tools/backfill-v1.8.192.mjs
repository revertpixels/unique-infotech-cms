#!/usr/bin/env node
/**
 * backfill-v1.8.192.mjs — Recompute student denormalized financial fields & updatedAt
 * from each student's `payment` subcollection (Youth + Kids, all sessions).
 *
 * STRICT SAFETY:
 *   - Default mode is `--dry-run` (writes NOTHING to Firestore).
 *   - Must pass `--apply` explicitly to write updates (max 400 writes/batch, idempotent).
 *
 * Usage:
 *   node tools/backfill-v1.8.192.mjs --dry-run [--project=unique-infotech-cms] [--out=review/backfill-dryrun.csv]
 *   node tools/backfill-v1.8.192.mjs --apply   [--project=unique-infotech-cms] [--out=review/backfill-applied.csv]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const fnRequire = createRequire(path.join(ROOT_DIR, 'functions', 'package.json'));
const adminApp = fnRequire('firebase-admin/app');
const adminFs = fnRequire('firebase-admin/firestore');

const { initializeApp, getApps, applicationDefault } = adminApp;
const { getFirestore, FieldValue } = adminFs;

const INST_PER_SEM = 4;
const MAX_BATCH_WRITES = 400;

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: true,
    project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID || 'unique-infotech-cms',
    out: ''
  };
  for (const a of argv) {
    if (a === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (a === '--dry-run') {
      args.apply = false;
      args.dryRun = true;
    } else if (a.startsWith('--project=')) {
      args.project = a.slice('--project='.length).trim() || args.project;
    } else if (a.startsWith('--out=')) {
      args.out = a.slice('--out='.length).trim();
    } else if (a === '--help' || a === '-h') {
      console.log([
        'Usage:',
        '  node tools/backfill-v1.8.192.mjs [--dry-run] [--apply] [--project=unique-infotech-cms] [--out=<csvPath>]',
        '',
        'Defaults to --dry-run -> review/backfill-dryrun.csv.',
        '--apply writes batched updates (max 400/batch) -> review/backfill-applied.csv.'
      ].join('\n'));
      process.exit(0);
    }
  }
  if (!args.out) {
    args.out = args.apply ? 'review/backfill-applied.csv' : 'review/backfill-dryrun.csv';
  }
  return args;
}

const numPos = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const roundMoney = (v) => {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

function courseFeeOf(feesOrDoc) {
  if (!feesOrDoc) return 0;
  const f = feesOrDoc.fees || feesOrDoc.feeSnapshot || feesOrDoc;
  const adm = numPos(f.admission ?? feesOrDoc.admissionFee ?? feesOrDoc.dueAtAdmission?.admission);
  const inst = numPos(f.installment ?? feesOrDoc.installmentFee ?? f.installmentFee);
  return adm + (inst * INST_PER_SEM);
}

/**
 * Recomputes financial totals from `payment` subcollection docs.
 * Matches `calculateStudentFinancials` & `summarizePaymentLedger` parity for Youth,
 * and preserves Kids (`ctx === 'school'`) admission payment format (`payment/payment` without `type`).
 */
export function recomputeStudentFromPayments(student, payments = []) {
  const isKids = student?.ctx === 'school';
  const list = Array.isArray(payments) ? payments : [];

  if (isKids) {
    let paidCourse = 0;
    let moneyCollected = 0;
    const fullReceiptNos = new Set(
      list.filter((p) => String(p?.type || '').toUpperCase().trim() === 'FULL' && p?.receiptNo).map((p) => p.receiptNo)
    );
    const isFull = student?.paymentPlan === 'full';

    for (const p of list) {
      if (!p) continue;
      const rawType = String(p.type || '').toUpperCase().trim();
      if (!rawType) {
        // Kids admission payment doc (students/{id}/payment/payment) stores actualAmountReceived/receivedTotal without `type`.
        const amt = (p.paymentMode === 'none')
          ? 0
          : roundMoney(p.actualAmountReceived ?? p.receivedTotal ?? p.total ?? p.amount ?? p.admissionFee ?? 0);
        if (amt > 0) {
          paidCourse = roundMoney(paidCourse + amt);
          moneyCollected = roundMoney(moneyCollected + amt);
        }
        continue;
      }
      if (rawType === 'WA' || rawType === 'WAIVER') continue;

      const isCourse = rawType === 'FULL'
        || rawType === 'AD' || rawType === 'ADM' || rawType === 'ADMISSION'
        || rawType === 'IN' || rawType === 'INST' || rawType === 'INSTALLMENT';

      if ((rawType === 'AD' || rawType === 'ADM' || rawType === 'ADMISSION')
        && (isFull || (p.receiptNo && fullReceiptNos.has(p.receiptNo)))) {
        continue;
      }

      const amt = Number(p.amount || 0);
      if (isCourse) paidCourse = roundMoney(paidCourse + amt);

      const lfVal = Number(p.lateFee ?? p.lateFeeAmount ?? 0);
      const isLateWaived = !!(p.waived || p.lateFeeWaived);
      const lfPaid = isLateWaived ? 0 : lfVal;
      const recv = p.total != null ? Number(p.total) : (amt + lfPaid);
      moneyCollected = roundMoney(moneyCollected + recv);
    }

    const total = Number(
      student.feeTotal
      ?? student.finalAdmissionCharge
      ?? student.admissionFee
      ?? student.configuredAdmissionFee
      ?? paidCourse
    );
    const balanceDue = Math.max(0, roundMoney(total - paidCourse));
    return {
      paidAmount: paidCourse,
      totalPaid: paidCourse,
      balanceDue,
      moneyCollected
    };
  }

  // Youth (or legacy default)
  const isFull = student?.paymentPlan === 'full';
  let total = 0;
  if (isFull) {
    total = Number(student.fullPaymentAmount ?? student.dueAtAdmission?.full ?? student.feeTotal ?? 0);
    if (!total || total <= 0) total = courseFeeOf(student) || 0;
  } else {
    const sched = Array.isArray(student.feeSchedule) ? student.feeSchedule : [];
    const instSum = sched.reduce((acc, it) => acc + Number(it?.amount || 0), 0);
    const adm = Number(student.admissionFee ?? student.dueAtAdmission?.admission ?? student.feeSnapshot?.admission ?? 0);
    if (instSum > 0 || adm > 0) {
      total = instSum + adm;
    } else {
      total = courseFeeOf(student)
        || Math.max(0, Number(student.feeTotal || 0) - Number(student.examFee ?? student.feeSnapshot?.exam ?? 0) - Number(student.materialFee ?? student.feeSnapshot?.material ?? 0));
    }
  }

  const fullReceiptNos = new Set(
    list.filter((p) => String(p?.type || '').toUpperCase().trim() === 'FULL' && p?.receiptNo).map((p) => p.receiptNo)
  );

  let paidCourse = 0;
  let moneyCollected = 0;

  for (const p of list) {
    if (!p) continue;
    const t = String(p.type || '').toUpperCase().trim();
    const isAd = t === 'AD' || t === 'ADM' || t === 'ADMISSION';
    const isFullPay = t === 'FULL';
    const isInst = t === 'IN' || t === 'INST' || t === 'INSTALLMENT';
    const isWaiver = t === 'WA' || t === 'WAIVER';

    // Legacy FULL + AD deduplication (matches calculateStudentFinancials & normalizeYouthPaymentsLedger)
    if (isAd && (isFull || (p.receiptNo && fullReceiptNos.has(p.receiptNo)))) {
      continue;
    }

    if (isWaiver) continue;

    const amt = Number(p.amount || 0);
    if (isFullPay || isAd || isInst) {
      paidCourse = roundMoney(paidCourse + amt);
    }

    const lfVal = Number(p.lateFee ?? p.lateFeeAmount ?? 0);
    const isLateWaived = !!(p.waived || p.lateFeeWaived);
    const lfPaid = isLateWaived ? 0 : lfVal;
    const recv = p.total != null ? Number(p.total) : (amt + lfPaid);
    moneyCollected = roundMoney(moneyCollected + recv);
  }

  const balanceDue = Math.max(0, roundMoney(total - paidCourse));
  return {
    paidAmount: paidCourse,
    totalPaid: paidCourse,
    balanceDue,
    moneyCollected
  };
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function resolveBranchLabel(s, branchesById) {
  const br = (s?.branchId && branchesById[s.branchId]) || {};
  return br.code || br.branchCode || s?.branchCode || s?.branchId || 'HO';
}

function resolveSessionLabel(s, sessionsById) {
  if (s?.ctx === 'school') return 'Kids (Monthly)';
  const sess = (s?.sessionId && sessionsById[s.sessionId]) || {};
  return s?.sessionName || sess.name || s?.sessionId || '(none)';
}

async function runInChunks(items, size, fn) {
  const results = new Array(items.length);
  for (let i = 0; i < items.length; i += size) {
    const slice = items.slice(i, i + size);
    const out = await Promise.all(slice.map((item, j) => fn(item, i + j)));
    for (let j = 0; j < out.length; j += 1) results[i + j] = out[j];
  }
  return results;
}

export async function runBackfill(options = {}) {
  const { apply = false, project = 'unique-infotech-cms', out = apply ? 'review/backfill-applied.csv' : 'review/backfill-dryrun.csv' } = options;
  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  if (!getApps().length) {
    if (usingEmulator) {
      initializeApp({ projectId: project });
    } else {
      initializeApp({ projectId: project, credential: applicationDefault() });
    }
  }
  const db = getFirestore();

  console.log(`[backfill] Mode: ${apply ? 'APPLY (WILL WRITE)' : 'DRY-RUN (0 writes)'}`);
  console.log(`[backfill] Target: ${usingEmulator ? `FIRESTORE EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST})` : 'LIVE FIRESTORE'} | Project: ${project}`);

  const [branchesSnap, sessionsSnap, studentsSnap] = await Promise.all([
    db.collection('branches').get(),
    db.collection('sessions').get(),
    db.collection('students').get()
  ]);

  const branchesById = {};
  branchesSnap.docs.forEach((d) => { branchesById[d.id] = d.data() || {}; });
  const sessionsById = {};
  sessionsSnap.docs.forEach((d) => { sessionsById[d.id] = d.data() || {}; });

  const studentDocs = studentsSnap.docs;
  console.log(`[backfill] Loaded ${studentDocs.length} student docs (${branchesSnap.size} branches, ${sessionsSnap.size} sessions). Reading payment subcollections...`);

  const paymentLists = await runInChunks(studentDocs, 25, async (stuDoc) => {
    const pSnap = await stuDoc.ref.collection('payment').get();
    return pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  });

  const csvRows = [];
  const updates = [];
  const fieldCounts = {
    moneyCollected: 0,
    paidAmount: 0,
    totalPaid: 0,
    balanceDue: 0,
    updatedAt: 0
  };
  const branchDiffs = new Map();
  let youthCount = 0;
  let kidsCount = 0;
  let studentsWithChanges = 0;

  const ensureBranchAgg = (brLabel) => {
    if (!branchDiffs.has(brLabel)) {
      branchDiffs.set(brLabel, {
        studentsChanged: 0,
        moneyCollectedDiff: 0,
        paidAmountDiff: 0,
        totalPaidDiff: 0,
        balanceDueDiff: 0,
        updatedAtSet: 0
      });
    }
    return branchDiffs.get(brLabel);
  };

  for (let i = 0; i < studentDocs.length; i += 1) {
    const stuDoc = studentDocs[i];
    const s = stuDoc.data() || {};
    if (s.ctx === 'school') kidsCount += 1;
    else youthCount += 1;

    const studentCode = s.studentId || stuDoc.id;
    const branchLabel = resolveBranchLabel(s, branchesById);
    const sessionLabel = resolveSessionLabel(s, sessionsById);

    const recomputed = recomputeStudentFromPayments(s, paymentLists[i]);
    const patch = {};
    const brAgg = ensureBranchAgg(branchLabel);
    let docChanged = false;

    for (const field of ['moneyCollected', 'paidAmount', 'totalPaid', 'balanceDue']) {
      const oldRaw = s[field];
      const hasOld = oldRaw !== undefined && oldRaw !== null && oldRaw !== '';
      const oldNum = hasOld ? roundMoney(oldRaw) : null;
      const newNum = roundMoney(recomputed[field]);
      if (oldNum === null || Math.abs(newNum - oldNum) > 0.001) {
        const diff = roundMoney(newNum - (oldNum ?? 0));
        patch[field] = newNum;
        fieldCounts[field] += 1;
        brAgg[`${field}Diff`] = roundMoney(brAgg[`${field}Diff`] + diff);
        docChanged = true;
        csvRows.push([
          studentCode,
          branchLabel,
          sessionLabel,
          field,
          hasOld ? String(oldNum) : 'MISSING',
          String(newNum),
          String(diff)
        ]);
      }
    }

    const missingUpdatedAt = s.updatedAt == null;
    if (missingUpdatedAt) {
      patch.updatedAt = s.createdAt || FieldValue.serverTimestamp();
      fieldCounts.updatedAt += 1;
      brAgg.updatedAtSet += 1;
      docChanged = true;
      csvRows.push([
        studentCode,
        branchLabel,
        sessionLabel,
        'updatedAt',
        'MISSING',
        s.createdAt ? 'createdAt' : 'serverTimestamp',
        ''
      ]);
    } else if (docChanged) {
      // Advance updatedAt only when another financial field actually changed so delta sync picks it up;
      // a subsequent re-run will see matching financial fields & non-null updatedAt and skip cleanly.
      patch.updatedAt = FieldValue.serverTimestamp();
    }

    if (docChanged) {
      studentsWithChanges += 1;
      brAgg.studentsChanged += 1;
      updates.push({ ref: stuDoc.ref, patch });
    }
  }

  let batchesCommitted = 0;
  if (apply && updates.length > 0) {
    for (let i = 0; i < updates.length; i += MAX_BATCH_WRITES) {
      const slice = updates.slice(i, i + MAX_BATCH_WRITES);
      const batch = db.batch();
      for (const item of slice) {
        batch.update(item.ref, item.patch);
      }
      await batch.commit();
      batchesCommitted += 1;
    }
  }

  const outAbs = path.isAbsolute(out) ? out : path.join(ROOT_DIR, out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const header = 'studentId,branch,session,field,old value,new value,difference';
  const csvBody = [header, ...csvRows.map((r) => r.map(csvEscape).join(','))].join('\n') + '\n';
  fs.writeFileSync(outAbs, csvBody, 'utf8');

  const branchSummary = {};
  for (const [br, agg] of Array.from(branchDiffs.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (agg.studentsChanged > 0 || agg.moneyCollectedDiff !== 0 || agg.paidAmountDiff !== 0 || agg.balanceDueDiff !== 0) {
      branchSummary[br] = agg;
    }
  }

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    target: usingEmulator ? `emulator:${process.env.FIRESTORE_EMULATOR_HOST}` : `live:${project}`,
    totalStudents: studentDocs.length,
    youthStudents: youthCount,
    kidsStudents: kidsCount,
    studentsNeedingChanges: studentsWithChanges,
    studentsUnchanged: studentDocs.length - studentsWithChanges,
    changesPerField: fieldCounts,
    rupeeDiffPerBranch: branchSummary,
    batchesCommitted,
    csvPath: outAbs
  };

  console.log('\n=== BACKFILL SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const opts = parseArgs(process.argv.slice(2));
  runBackfill(opts).catch((err) => {
    console.error('[backfill] FAILED:', err);
    process.exit(1);
  });
}
