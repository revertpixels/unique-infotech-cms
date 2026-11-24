#!/usr/bin/env node

/**
 * tools/delete-test-students.js
 *
 * Super Admin CLI script to clean up test student records.
 * Deletes each student document with its payment, activity, docs, and aadhaar subcollections,
 * as well as associated storage files.
 *
 * Usage:
 *   node tools/delete-test-students.js
 *   node tools/delete-test-students.js --reset-counters
 */

import readline from 'readline';

const API_KEY = 'AIzaSyBD80jBVjpPLHNN_NrZpx7rogMpWK0oMKY';
const PROJECT_ID = 'unique-infotech-cms';
const STORAGE_BUCKET = 'unique-infotech-cms.firebasestorage.app';

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o`;

function ask(question, hidden = false) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Transform Firestore REST format into JS object
function parseFirestoreDoc(doc) {
  if (!doc || !doc.fields) return { _name: doc?.name };
  const out = { _name: doc.name, _id: doc.name.split('/').pop() };
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = parseValue(v);
  }
  return out;
}

function parseValue(val) {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
  if (val.doubleValue !== undefined) return parseFloat(val.doubleValue);
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.timestampValue !== undefined) return val.timestampValue;
  if (val.nullValue !== undefined) return null;
  if (val.mapValue !== undefined) {
    const res = {};
    for (const [mk, mv] of Object.entries(val.mapValue.fields || {})) {
      res[mk] = parseValue(mv);
    }
    return res;
  }
  if (val.arrayValue !== undefined) {
    return (val.arrayValue.values || []).map(parseValue);
  }
  return val;
}

async function signInSuperAdmin() {
  console.log('--- Super Admin Authentication Required ---');
  let email = process.env.SUPERADMIN_EMAIL;
  let password = process.env.SUPERADMIN_PASSWORD;

  if (!email) {
    email = await ask('Enter Super Admin Email: ');
  }
  if (!password) {
    password = await ask('Enter Password: ');
  }

  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim().toLowerCase(),
      password,
      returnSecureToken: true
    })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Authentication failed');
  }

  const idToken = data.idToken;
  const userEmail = data.email.toLowerCase();

  // Verify superadmin role in Firestore users collection
  const userRes = await fetch(`${FIRESTORE_BASE}/users/${encodeURIComponent(userEmail)}`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });

  if (!userRes.ok) {
    throw new Error('Could not fetch user record from Firestore.');
  }

  const userDoc = await userRes.json();
  const parsedUser = parseFirestoreDoc(userDoc);

  if (parsedUser.role !== 'superadmin') {
    throw new Error(`User ${userEmail} does not have role 'superadmin'. Current role: ${parsedUser.role}`);
  }

  console.log(`Authenticated as Super Admin: ${userEmail}\n`);
  return idToken;
}

async function listStudents(idToken) {
  let allStudents = [];
  let pageToken = '';

  do {
    const url = new URL(`${FIRESTORE_BASE}/students`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}` }
    });

    if (!res.ok) {
      throw new Error(`Failed to list students: ${res.statusText}`);
    }

    const data = await res.json();
    if (data.documents) {
      allStudents = allStudents.concat(data.documents.map(parseFirestoreDoc));
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  return allStudents;
}

async function deleteSubcollection(idToken, studentDocName, subcollection) {
  let subDocs = [];
  let pageToken = '';

  do {
    const url = new URL(`${studentDocName}/${subcollection}`);
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${idToken}` }
    });

    if (!res.ok) {
      // Subcollection might not exist or empty, ignore 404
      break;
    }

    const data = await res.json();
    if (data.documents) {
      subDocs = subDocs.concat(data.documents);
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken);

  for (const doc of subDocs) {
    await fetch(`https://firestore.googleapis.com/v1/${doc.name}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` }
    });
  }

  return subDocs.length;
}

async function deleteStorageFiles(idToken, student) {
  const prefixes = [
    `students/${student._id}/`,
    student.studentId ? `students/${student.studentId}/` : null
  ].filter(Boolean);

  let deletedCount = 0;

  for (const prefix of prefixes) {
    try {
      const listUrl = new URL(STORAGE_BASE);
      listUrl.searchParams.set('prefix', prefix);

      const res = await fetch(listUrl.toString(), {
        headers: { Authorization: `Bearer ${idToken}` }
      });

      if (!res.ok) continue;

      const data = await res.json();
      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const deleteUrl = `${STORAGE_BASE}/${encodeURIComponent(item.name)}`;
          await fetch(deleteUrl, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${idToken}` }
          });
          deletedCount++;
        }
      }
    } catch (_) {}
  }

  return deletedCount;
}

async function resetReceiptCounters(idToken) {
  console.log('\nChecking receipt counters to reset (--reset-counters specified)...');
  const res = await fetch(`${FIRESTORE_BASE}/counters?pageSize=100`, {
    headers: { Authorization: `Bearer ${idToken}` }
  });

  if (!res.ok) {
    console.warn('Could not read counters collection.');
    return;
  }

  const data = await res.json();
  const counterDocs = (data.documents || []).map(parseFirestoreDoc);
  const rcptCounters = counterDocs.filter(c => c._id && c._id.startsWith('rcpt_'));

  for (const c of rcptCounters) {
    await fetch(`${FIRESTORE_BASE}/counters/${c._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` }
    });
    console.log(`   Deleted receipt counter: ${c._id}`);
  }

  console.log(`Reset ${rcptCounters.length} receipt counter documents.`);
}

async function main() {
  const resetCounters = process.argv.includes('--reset-counters');

  console.log('====================================================');
  console.log('       Unique Infotech CMS — Test Data Cleanup       ');
  console.log('====================================================\n');

  let idToken;
  try {
    idToken = await signInSuperAdmin();
  } catch (err) {
    console.error('Login failed:', err.message);
    process.exit(1);
  }

  console.log('Fetching students list from Firestore...');
  const students = await listStudents(idToken);

  if (students.length === 0) {
    console.log('No students found in the database. Nothing to delete.');
    if (resetCounters) {
      await resetReceiptCounters(idToken);
    }
    process.exit(0);
  }

  console.log(`\nFound ${students.length} student(s) in the database:\n`);
  console.log(
    'No.'.padEnd(5) +
    'Student ID'.padEnd(15) +
    'Name'.padEnd(25) +
    'Phone'.padEnd(15) +
    'Course'.padEnd(20) +
    'Admission Date'
  );
  console.log('-'.repeat(90));

  students.forEach((s, i) => {
    const num = String(i + 1).padEnd(5);
    const sid = String(s.studentId || s._id).padEnd(15);
    const name = String(s.name || '-').padEnd(25).slice(0, 24) + ' ';
    const phone = String(s.phone || '-').padEnd(15);
    const course = String(s.courseCode || s.courseName || '-').padEnd(20).slice(0, 19) + ' ';
    const date = String(s.admissionDate || '-');
    console.log(num + sid + name + phone + course + date);
  });

  console.log('\n' + '!'.repeat(90));
  console.log(`WARNING: This will permanently delete ALL ${students.length} student records,`);
  console.log('their payment subcollections, activity logs, uploaded docs, and storage files.');
  if (resetCounters) {
    console.log('FLAG DETECTED: Receipt counters (counters/rcpt_*) will ALSO be reset.');
  } else {
    console.log('NOTE: Receipt counters will be PRESERVED. (Pass --reset-counters to reset them).');
  }
  console.log('!'.repeat(90) + '\n');

  const answer = await ask('Type YES to permanently delete all listed students: ');

  if (answer !== 'YES') {
    console.log('\nOperation cancelled. No changes were made.');
    process.exit(0);
  }

  console.log(`\nBeginning deletion of ${students.length} students...\n`);

  let deletedCount = 0;
  for (let i = 0; i < students.length; i++) {
    const s = students[i];
    const sName = `projects/${PROJECT_ID}/databases/(default)/documents/students/${s._id}`;

    process.stdout.write(`[${i + 1}/${students.length}] Deleting ${s.studentId || s._id} (${s.name || 'Unknown'})... `);

    // Delete subcollections
    await deleteSubcollection(idToken, sName, 'payment');
    await deleteSubcollection(idToken, sName, 'activity');
    await deleteSubcollection(idToken, sName, 'docs');
    await deleteSubcollection(idToken, sName, 'aadhaar');

    // Delete storage files
    await deleteStorageFiles(idToken, s);

    // Delete main document
    const delRes = await fetch(`${FIRESTORE_BASE}/students/${s._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${idToken}` }
    });

    if (delRes.ok) {
      process.stdout.write('DONE\n');
      deletedCount++;
    } else {
      process.stdout.write(`FAILED (${delRes.statusText})\n`);
    }
  }

  if (resetCounters) {
    await resetReceiptCounters(idToken);
  }

  console.log('\n====================================================');
  console.log(`Cleanup complete! Successfully deleted ${deletedCount} student(s).`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
