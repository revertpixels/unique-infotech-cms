#!/usr/bin/env node
/**
 * export-json-v1.8.193.mjs — Read-only Admin SDK JSON backup of `students` and `payment` subcollections.
 * Fallback when `gcloud firestore export` (Blaze / bucket / gcloud CLI) is unavailable.
 *
 * STRICTLY READ-ONLY: executes zero writes and verifies document counts against server `.count()`.
 *
 * Usage:
 *   node tools/export-json-v1.8.193.mjs [--project=unique-infotech-cms] [--out=review/backup-v1.8.193.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const fnRequire = createRequire(path.join(ROOT_DIR, 'functions', 'package.json'));
const { initializeApp, getApps, applicationDefault } = fnRequire('firebase-admin/app');
const { getFirestore, Timestamp } = fnRequire('firebase-admin/firestore');

function parseArgs(argv) {
  const tsLabel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const args = {
    project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIRESTORE_PROJECT_ID || 'unique-infotech-cms',
    out: `review/backup-v1.8.193-${tsLabel}.json`
  };
  for (const a of argv) {
    if (a.startsWith('--project=')) args.project = a.slice('--project='.length).trim() || args.project;
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length).trim() || args.out;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node tools/export-json-v1.8.193.mjs [--project=unique-infotech-cms] [--out=review/backup-v1.8.193.json]');
      process.exit(0);
    }
  }
  return args;
}

function serializeValue(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Timestamp || (typeof v === 'object' && typeof v.toMillis === 'function' && Number.isFinite(v.seconds))) {
    return {
      __type: 'Timestamp',
      seconds: v.seconds,
      nanoseconds: v.nanoseconds || 0,
      iso: typeof v.toDate === 'function' ? v.toDate().toISOString() : new Date(v.seconds * 1000).toISOString()
    };
  }
  if (v instanceof Date) return { __type: 'Date', iso: v.toISOString() };
  if (Array.isArray(v)) return v.map(serializeValue);
  if (typeof v === 'object') {
    if (typeof v.path === 'string' && typeof v.id === 'string' && v.firestore) {
      return { __type: 'DocumentReference', path: v.path };
    }
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (val !== undefined) out[k] = serializeValue(val);
    }
    return out;
  }
  return v;
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

export async function exportJsonBackup(options = {}) {
  const {
    project = 'unique-infotech-cms',
    out = `review/backup-v1.8.193-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
  } = options;
  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  if (!getApps().length) {
    if (usingEmulator) initializeApp({ projectId: project });
    else initializeApp({ projectId: project, credential: applicationDefault() });
  }
  const db = getFirestore();

  console.log(`[export-json] Mode: READ-ONLY BACKUP | Target: ${usingEmulator ? `EMULATOR (${process.env.FIRESTORE_EMULATOR_HOST})` : 'LIVE FIRESTORE'} | Project: ${project}`);

  const [studentsCountSnap, paymentsCountSnap, studentsSnap] = await Promise.all([
    db.collection('students').count().get(),
    db.collectionGroup('payment').count().get(),
    db.collection('students').get()
  ]);

  const expectedStudents = Number(studentsCountSnap.data().count || 0);
  const expectedPayments = Number(paymentsCountSnap.data().count || 0);

  const studentsDocs = studentsSnap.docs;
  const paymentDocsPerStudent = await runInChunks(studentsDocs, 25, async (stuDoc) => {
    const pSnap = await stuDoc.ref.collection('payment').get();
    return pSnap.docs.map((pd) => ({
      id: pd.id,
      path: pd.ref.path,
      data: serializeValue(pd.data() || {})
    }));
  });

  let actualPayments = 0;
  const students = studentsDocs.map((stuDoc, idx) => {
    const pays = paymentDocsPerStudent[idx] || [];
    actualPayments += pays.length;
    return {
      id: stuDoc.id,
      path: stuDoc.ref.path,
      data: serializeValue(stuDoc.data() || {}),
      payments: pays
    };
  });

  const counts = {
    expectedStudents,
    exportedStudents: students.length,
    expectedPayments,
    exportedPayments: actualPayments
  };

  if (counts.exportedStudents !== counts.expectedStudents || counts.exportedPayments !== counts.expectedPayments) {
    throw new Error(
      `[export-json] Document count mismatch! students ${counts.exportedStudents}/${counts.expectedStudents}, payments ${counts.exportedPayments}/${counts.expectedPayments}`
    );
  }

  const outAbs = path.isAbsolute(out) ? out : path.join(ROOT_DIR, out);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const payload = {
    version: '1.8.193',
    exportedAt: new Date().toISOString(),
    project,
    source: usingEmulator ? `emulator:${process.env.FIRESTORE_EMULATOR_HOST}` : 'live',
    counts,
    students
  };
  fs.writeFileSync(outAbs, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const bytes = fs.statSync(outAbs).size;

  const summary = {
    ...counts,
    countCheckPassed: true,
    outPath: outAbs,
    bytes
  };
  console.log('\n=== JSON EXPORT SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const opts = parseArgs(process.argv.slice(2));
  exportJsonBackup(opts).catch((err) => {
    console.error('[export-json] FAILED:', err);
    process.exit(1);
  });
}
