#!/usr/bin/env node
/**
 * backfill-v1.8.192.mjs — Recompute student denormalized financial fields & updatedAt
 * from each student's `payment` subcollection (Youth + Kids, all sessions).
 *
 * STRICT SAFETY:
 *   - Default mode is `--dry-run` (writes NOTHING to Firestore).
 *   - Outputs `review/backfill-dryrun.csv` and flags large changes / decreases in
 *     `review/backfill-dryrun-attention.csv`.
 *   - `--apply` refuses to run when attention rows exist unless `--confirm-decreases` is passed.
 *   - `--apply` logs exact old & new values for every changed field (including `updatedAt`) to
 *     `review/backfill-applied.csv`, batched at max 400 writes/batch, idempotent.
 *   - `--rollback <csv>` restores old values (deleting fields that were `MISSING`) ONLY when
 *     each field's current live value still matches `"new value"`, skipping & reporting docs changed since.
 *
 * Usage:
 *   node tools/backfill-v1.8.192.mjs --dry-run [--project=unique-infotech-cms] [--out=review/backfill-dryrun.csv]
 *   node tools/backfill-v1.8.192.mjs --apply [--confirm-decreases] [--project=unique-infotech-cms] [--out=review/backfill-applied.csv]
 *   node tools/backfill-v1.8.192.mjs --rollback review/backfill-applied.csv [--project=unique-infotech-cms]
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
const { getFirestore, FieldValue, Timestamp } = adminFs;

const INST_PER_SEM = 4;
const MAX_BATCH_WRITES = 400;
const ATTENTION_DELTA_THRESHOLD = 500;

function parseArgs(argv) {
  const args = {
    mode: 'dry-run',
    apply: false,
    dryRun: true,
    confirmDecreases: false,
    rollbackCsv: '',
    project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID || 'unique-infotech-cms',
    out: '',
    attentionOut: 'review/backfill-dryrun-attention.csv'
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') {
      args.mode = 'apply';
      args.apply = true;
      args.dryRun = false;
    } else if (a === '--dry-run') {
      args.mode = 'dry-run';
      args.apply = false;
      args.dryRun = true;
    } else if (a === '--confirm-decreases') {
      args.confirmDecreases = true;
    } else if (a === '--rollback') {
      args.mode = 'rollback';
      args.apply = false;
      args.dryRun = false;
      args.rollbackCsv = argv[++i] || '';
    } else if (a.startsWith('--rollback=')) {
      args.mode = 'rollback';
      args.apply = false;
      args.dryRun = false;
      args.rollbackCsv = a.slice('--rollback='.length).trim();
    } else if (a.startsWith('--project=')) {
      args.project = a.slice('--project='.length).trim() || args.project;
    } else if (a.startsWith('--out=')) {
      args.out = a.slice('--out='.length).trim();
    } else if (a.startsWith('--attention-out=')) {
      args.attentionOut = a.slice('--attention-out='.length).trim() || args.attentionOut;
    } else if (a === '--help' || a === '-h') {
      console.log([
        'Usage:',
        '  node tools/backfill-v1.8.192.mjs [--dry-run] [--project=unique-infotech-cms] [--out=<csv>]',
        '  node tools/backfill-v1.8.192.mjs --apply [--confirm-decreases] [--project=unique-infotech-cms] [--out=<csv>]',
        '  node tools/backfill-v1.8.192.mjs --rollback <appliedCsvPath> [--project=unique-infotech-cms]',
        '',
        'Defaults to --dry-run -> review/backfill-dryrun.csv + review/backfill-dryrun-attention.csv.',
        '--apply writes batched updates (max 400/batch) -> review/backfill-applied.csv.',
        '--rollback <csv> restores old values only if current live values still equal "new value".'
      ].join('\n'));
      process.exit(0);
    }
  }
  if (!args.out && args.mode !== 'rollback') {
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

function summarizePaymentTypes(payments = [], isKids = false) {
  const types = new Set();
  for (const p of (payments || [])) {
    if (!p) continue;
    const raw = String(p.type || '').toUpperCase().trim();
    if (!raw && isKids) types.add('KIDS_ADMISSION');
    else if (raw) types.add(raw);
  }
  return Array.from(types).sort().join(', ') || '(none)';
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

function encodeFieldVal(val) {
  if (val === undefined) return 'MISSING';
  if (val === null) return 'NULL';
  if (val && typeof val === 'object' && typeof val.seconds === 'number') {
    return `ts:${val.seconds}:${val.nanoseconds || 0}`;
  }
  if (typeof val === 'number') return String(roundMoney(val));
  if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val)) return `str:${val}`;
  return `json:${JSON.stringify(val)}`;
}

function decodeFieldVal(str) {
  if (str === 'MISSING') return FieldValue.delete();
  if (str === 'NULL') return null;
  if (str.startsWith('ts:')) {
    const [, secStr, nsStr] = str.split(':');
    return new Timestamp(Number(secStr), Number(nsStr || 0));
  }
  if (str.startsWith('str:')) return str.slice(4);
  if (str.startsWith('json:')) return JSON.parse(str.slice(5));
  const num = Number(str);
  return Number.isFinite(num) ? num : str;
}

function valuesMatch(liveVal, encodedExpected) {
  if (encodedExpected === 'MISSING') return liveVal === undefined;
  if (encodedExpected === 'NULL') return liveVal === null;
  if (encodedExpected.startsWith('ts:')) {
    return encodeFieldVal(liveVal) === encodedExpected;
  }
  const expNum = Number(encodedExpected);
  if (!encodedExpected.startsWith('str:') && !encodedExpected.startsWith('json:') && Number.isFinite(expNum)) {
    return liveVal !== undefined && liveVal !== null && liveVal !== '' && Math.abs(roundMoney(liveVal) - expNum) <= 0.001;
  }
  return encodeFieldVal(liveVal) === encodedExpected;
}

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // skip CR
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
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

function initAdminDb(project) {
  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!getApps().length) {
    if (usingEmulator) initializeApp({ projectId: project });
    else initializeApp({ projectId: project, credential: applicationDefault() });
  }
  return { db: getFirestore(), usingEmulator };
}

export async function runRollback({ rollbackCsv, project = 'unique-infotech-cms' } = {}) {
  if (!rollbackCsv) throw new Error('--rollback requires a CSV file path (e.g. --rollback review/backfill-applied.csv).');
  const csvAbs = path.isAbsolute(rollbackCsv) ? rollbackCsv : path.join(ROOT_DIR, rollbackCsv);
  if (!fs.existsSync(csvAbs)) throw new Error(`Rollback CSV not found: ${csvAbs}`);

  const parsed = parseCsv(fs.readFileSync(csvAbs, 'utf8')).filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
  if (!parsed.length) throw new Error('Rollback CSV is empty.');

  const hdr = parsed[0].map((h) => h.trim().toLowerCase());
  const idx = (name) => hdr.indexOf(name);
  const colDocId = idx('docid');
  const colStuId = idx('studentid');
  const colField = idx('field');
  const colOld = idx('old value');
  const colNew = idx('new value');
  if (colField === -1 || colOld === -1 || colNew === -1 || (colDocId === -1 && colStuId === -1)) {
    throw new Error(`Invalid rollback CSV header: ${parsed[0].join(',')}`);
  }

  const { db, usingEmulator } = initAdminDb(project);
  console.log(`[backfill] Mode: ROLLBACK | Target: ${usingEmulator ? `FIRESTORE EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST})` : 'LIVE FIRESTORE'} | CSV: ${csvAbs}`);

  const byDocKey = new Map();
  for (let i = 1; i < parsed.length; i += 1) {
    const r = parsed[i];
    const docId = colDocId !== -1 ? (r[colDocId] || '').trim() : '';
    const studentId = colStuId !== -1 ? (r[colStuId] || '').trim() : '';
    const key = docId ? `doc:${docId}` : `sid:${studentId}`;
    if (!key || key === 'doc:' || key === 'sid:') continue;
    if (!byDocKey.has(key)) byDocKey.set(key, { docId, studentId, rows: [] });
    byDocKey.get(key).rows.push({
      field: (r[colField] || '').trim(),
      oldVal: r[colOld],
      newVal: r[colNew]
    });
  }

  const entries = Array.from(byDocKey.values());
  const snapshots = await runInChunks(entries, 25, async (entry) => {
    if (entry.docId) {
      const snap = await db.collection('students').doc(entry.docId).get();
      return snap.exists ? snap : null;
    }
    const qSnap = await db.collection('students').where('studentId', '==', entry.studentId).limit(1).get();
    return qSnap.empty ? null : qSnap.docs[0];
  });

  const restores = [];
  const skipped = [];

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const snap = snapshots[i];
    if (!snap) {
      skipped.push({ docId: entry.docId || entry.studentId, studentId: entry.studentId, reason: 'Document not found in Firestore' });
      continue;
    }
    const liveData = snap.data() || {};
    let conflict = null;
    for (const row of entry.rows) {
      if (!valuesMatch(liveData[row.field], row.newVal)) {
        conflict = {
          docId: snap.id,
          studentId: entry.studentId || liveData.studentId || snap.id,
          field: row.field,
          expectedNew: row.newVal,
          actualCurrent: encodeFieldVal(liveData[row.field]),
          reason: `Doc changed since backfill (${row.field}: expected "${row.newVal}", found "${encodeFieldVal(liveData[row.field])}")`
        };
        break;
      }
    }
    if (conflict) {
      skipped.push(conflict);
      continue;
    }

    const patch = {};
    for (const row of entry.rows) {
      patch[row.field] = decodeFieldVal(row.oldVal);
    }
    restores.push({ ref: snap.ref, patch });
  }

  let batchesCommitted = 0;
  for (let i = 0; i < restores.length; i += MAX_BATCH_WRITES) {
    const slice = restores.slice(i, i + MAX_BATCH_WRITES);
    const batch = db.batch();
    for (const item of slice) {
      batch.update(item.ref, item.patch);
    }
    await batch.commit();
    batchesCommitted += 1;
  }

  const summary = {
    mode: 'rollback',
    target: usingEmulator ? `emulator:${process.env.FIRESTORE_EMULATOR_HOST}` : `live:${project}`,
    csvPath: csvAbs,
    totalDocsInCsv: entries.length,
    docsRestored: restores.length,
    docsSkippedChangedSince: skipped.length,
    batchesCommitted,
    skippedDetails: skipped
  };
  console.log('\n=== ROLLBACK SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

export async function runBackfill(options = {}) {
  if (options.mode === 'rollback' || options.rollbackCsv) {
    return runRollback({ rollbackCsv: options.rollbackCsv, project: options.project });
  }

  const {
    apply = false,
    confirmDecreases = false,
    project = 'unique-infotech-cms',
    out = apply ? 'review/backfill-applied.csv' : 'review/backfill-dryrun.csv',
    attentionOut = 'review/backfill-dryrun-attention.csv'
  } = options;

  const { db, usingEmulator } = initAdminDb(project);
  console.log(`[backfill] Mode: ${apply ? 'APPLY (WILL WRITE)' : 'DRY-RUN (0 writes)'}${apply && confirmDecreases ? ' [--confirm-decreases]' : ''}`);
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

  const applyRunTs = Timestamp.now();
  const csvRows = [];
  const attentionRows = [];
  const attentionStudentIds = new Set();
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
    const isKids = s.ctx === 'school';
    if (isKids) kidsCount += 1;
    else youthCount += 1;

    const studentCode = s.studentId || stuDoc.id;
    const branchLabel = resolveBranchLabel(s, branchesById);
    const sessionLabel = resolveSessionLabel(s, sessionsById);
    const paymentTypes = summarizePaymentTypes(paymentLists[i], isKids);

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
        const oldCsv = hasOld ? String(oldNum) : 'MISSING';
        const newCsv = String(newNum);
        csvRows.push([
          stuDoc.id,
          studentCode,
          branchLabel,
          sessionLabel,
          field,
          oldCsv,
          newCsv,
          String(diff)
        ]);

        const reasons = [];
        if ((field === 'paidAmount' || field === 'balanceDue') && diff < 0) {
          reasons.push(`${field} decreased (${diff})`);
        }
        if (Math.abs(diff) > ATTENTION_DELTA_THRESHOLD) {
          reasons.push(`change > Rs ${ATTENTION_DELTA_THRESHOLD} (${diff > 0 ? '+' : ''}${diff})`);
        }
        if (reasons.length) {
          attentionStudentIds.add(stuDoc.id);
          attentionRows.push([
            stuDoc.id,
            studentCode,
            branchLabel,
            sessionLabel,
            field,
            oldCsv,
            newCsv,
            String(diff),
            reasons.join('; '),
            paymentTypes
          ]);
        }
      }
    }

    const missingUpdatedAt = s.updatedAt == null;
    if (missingUpdatedAt) {
      const targetTs = s.createdAt || applyRunTs;
      patch.updatedAt = targetTs;
      fieldCounts.updatedAt += 1;
      brAgg.updatedAtSet += 1;
      docChanged = true;
      csvRows.push([
        stuDoc.id,
        studentCode,
        branchLabel,
        sessionLabel,
        'updatedAt',
        'MISSING',
        encodeFieldVal(targetTs),
        ''
      ]);
    } else if (docChanged) {
      // Record both old & new updatedAt so --rollback can restore exact original updatedAt safely.
      patch.updatedAt = applyRunTs;
      csvRows.push([
        stuDoc.id,
        studentCode,
        branchLabel,
        sessionLabel,
        'updatedAt',
        encodeFieldVal(s.updatedAt),
        encodeFieldVal(applyRunTs),
        ''
      ]);
    }

    if (docChanged) {
      studentsWithChanges += 1;
      brAgg.studentsChanged += 1;
      updates.push({ ref: stuDoc.ref, patch });
    }
  }

  // Always write attention CSV in dry-run (or when attention rows exist before apply refusal)
  const attAbs = path.isAbsolute(attentionOut) ? attentionOut : path.join(ROOT_DIR, attentionOut);
  if (!apply || attentionRows.length > 0) {
    fs.mkdirSync(path.dirname(attAbs), { recursive: true });
    const attHeader = 'docId,studentId,branch,session,field,old value,new value,difference,reasons,payment types';
    const attBody = [attHeader, ...attentionRows.map((r) => r.map(csvEscape).join(','))].join('\n') + '\n';
    fs.writeFileSync(attAbs, attBody, 'utf8');
  }

  if (apply && attentionRows.length > 0 && !confirmDecreases) {
    throw new Error(
      `[backfill] REFUSED --apply: ${attentionRows.length} attention row(s) across ${attentionStudentIds.size} student(s) (paidAmount/balanceDue decrease or |diff| > Rs ${ATTENTION_DELTA_THRESHOLD}). Review ${attAbs} and pass --confirm-decreases to apply.`
    );
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
  const header = 'docId,studentId,branch,session,field,old value,new value,difference';
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
    attentionStudentsCount: attentionStudentIds.size,
    attentionRowsCount: attentionRows.length,
    attentionCsvPath: (!apply || attentionRows.length > 0) ? attAbs : '',
    rupeeDiffPerBranch: branchSummary,
    batchesCommitted,
    csvPath: outAbs
  };

  console.log('\n=== BACKFILL SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  if (!apply && attentionRows.length > 0) {
    console.log(`\n=== DRY-RUN ATTENTION ROWS (${attentionRows.length} total, showing up to 25) ===`);
    for (const r of attentionRows.slice(0, 25)) {
      console.log(`  [${r[2]}] ${r[1]} (${r[0]}) | ${r[4]}: ${r[5]} -> ${r[6]} (diff ${r[7]}) | ${r[8]} | types: ${r[9]}`);
    }
  }
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const opts = parseArgs(process.argv.slice(2));
  runBackfill(opts).catch((err) => {
    console.error('[backfill] FAILED:', err.message || err);
    process.exit(1);
  });
}
