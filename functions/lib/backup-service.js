'use strict';

/**
 * Server-side Backup, Master Delete, Validate, and Restore service for Unique Infotech CMS.
 *
 * Security & survival invariants:
 * - Only active Super Admin users (role === 'superadmin', status === 'active' in `users/{email}`,
 *   signed in with `password` provider) can invoke any backup/manage-data endpoint.
 * - `users/{email}` documents with `role === 'superadmin'` are NEVER backed up, NEVER deleted by
 *   Master Delete, and NEVER overwritten during Restore.
 * - `users/{email}` documents with `role === 'branch_head' | 'school_head'` ARE backed up,
 *   cleared on Master Delete, and restored with their branches.
 * - Operational collections `_system/*`, `_system_backup_manifests/*`, `_system_backup_operations/*`
 *   and Storage prefix `system-backups/` stay untouched across Clear/Restore.
 */

const crypto = require('crypto');
const zlib = require('zlib');
const { Timestamp, GeoPoint } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');

const PROJECT_ID = 'unique-infotech-cms';
const FORMAT = 'unique-infotech-cms-firestore-backup';
const FORMAT_VERSION = 1;
const CREATOR = 'unique-infotech-cms-backup-tool';
const BACKUP_MARKER = '__uicBackupType__';

const MAX_BACKUP_BYTES = 95 * 1024 * 1024;
const MAX_DOCUMENTS = 50000;
const LOCK_TTL_MS = 12 * 60 * 1000;
const REAUTH_MAX_AGE_SEC = 15 * 60;
const BATCH_SIZE = 150;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;

const MAX_NORMAL_BACKUPS = 5;
const MAX_SAFETY_BACKUPS = 2;
const MAX_OPERATION_HISTORY = 20;

const QUOTA_LIMITS = {
  reads: 50000,
  writes: 20000,
  deletes: 20000
};

const MEDIA_PREFIXES = ['students/', 'documents/', 'org/', 'logos/', 'site/'];
const FREE_STORAGE_LOCATIONS = new Set(['US-CENTRAL1', 'US-EAST1', 'US-WEST1']);

const ROOT_COLLECTIONS = [
  'settings',
  'branches',
  'courses',
  'levels',
  'batches',
  'sessions',
  'counters',
  'users',
  'students',
  'enrolments',
  'bills',
  'payments',
  'waivers',
  'breaks',
  'transfers',
  'deletionLog'
];

const NESTED_COLLECTIONS = [
  { group: 'docs', pattern: /^students\/[^/]+\/docs\/[^/]+$/ },
  { group: 'aadhaar', pattern: /^students\/[^/]+\/aadhaar\/[^/]+$/ },
  { group: 'payment', pattern: /^students\/[^/]+\/payment\/[^/]+$/ },
  { group: 'activity', pattern: /^students\/[^/]+\/activity\/[^/]+$/ }
];

const SCOPE = [
  ...ROOT_COLLECTIONS,
  'students/{studentId}/docs',
  'students/{studentId}/aadhaar',
  'students/{studentId}/payment',
  'students/{studentId}/activity'
];

function createService({ db, bucket, now = Date.now, hook = async () => {} }) {
  const maintenanceRef = db.doc('_system/maintenance');
  const stateRef = db.doc('_system/client_state');
  const manifests = db.collection('_system_backup_manifests');
  const operations = db.collection('_system_backup_operations');

  async function assertSuperAdmin(request, { requireRecentAuth = false } = {}) {
    const auth = request && request.auth;
    const email = auth && auth.token && typeof auth.token.email === 'string'
      ? auth.token.email.toLowerCase().trim()
      : '';
    const signInProvider = auth && auth.token && auth.token.firebase
      ? auth.token.firebase.sign_in_provider
      : '';

    if (!auth || !auth.uid || !email || signInProvider !== 'password') {
      throw new HttpsError(
        'permission-denied',
        'Only an active Super Admin signed in with email and password can use Manage Data.'
      );
    }

    const userSnap = await db.collection('users').doc(email).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userData || userData.role !== 'superadmin' || userData.status !== 'active') {
      throw new HttpsError(
        'permission-denied',
        'Active Super Admin role permissions are required.'
      );
    }

    if (requireRecentAuth) {
      const authTime = Number(auth.token.auth_time || 0);
      const ageSec = Math.floor(now() / 1000) - authTime;
      if (!Number.isFinite(authTime) || authTime <= 0 || ageSec > REAUTH_MAX_AGE_SEC) {
        throw new HttpsError(
          'failed-precondition',
          'REAUTH_REQUIRED: Recent password confirmation expired. Re-enter your password to continue.'
        );
      }
    }

    return { uid: auth.uid, email };
  }

  function newId() {
    return crypto.randomUUID();
  }

  function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function encodeValue(value) {
    if (value === undefined || value === null) return null;
    if (value instanceof Timestamp) {
      return { [BACKUP_MARKER]: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    if (value instanceof GeoPoint) {
      return { [BACKUP_MARKER]: 'geopoint', latitude: value.latitude, longitude: value.longitude };
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return { [BACKUP_MARKER]: 'bytes', base64: Buffer.from(value).toString('base64') };
    }
    if (value && value.constructor && value.constructor.name === 'DocumentReference' && typeof value.path === 'string') {
      return { [BACKUP_MARKER]: 'reference', path: value.path };
    }
    if (Array.isArray(value)) return value.map(encodeValue);
    if (typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, BACKUP_MARKER)) {
        return {
          [BACKUP_MARKER]: 'map',
          entries: Object.keys(value).map((key) => [key, encodeValue(value[key])])
        };
      }
      const output = Object.create(null);
      Object.keys(value).forEach((key) => {
        output[key] = encodeValue(value[key]);
      });
      return output;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new HttpsError('failed-precondition', 'A record contains a non-finite number and cannot be backed up safely.');
    }
    return value;
  }

  function decodeValue(value) {
    if (Array.isArray(value)) return value.map(decodeValue);
    if (!value || typeof value !== 'object') return value;

    const type = value[BACKUP_MARKER];
    if (type === 'map') {
      if (!Array.isArray(value.entries)) throw new HttpsError('invalid-argument', 'The backup contains an invalid object map.');
      const mapped = Object.create(null);
      for (const pair of value.entries) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') {
          throw new HttpsError('invalid-argument', 'The backup contains an invalid object map.');
        }
        mapped[pair[0]] = decodeValue(pair[1]);
      }
      return mapped;
    }
    if (type === 'timestamp') {
      if (!Number.isInteger(value.seconds) || !Number.isInteger(value.nanoseconds)
        || value.nanoseconds < 0 || value.nanoseconds >= 1000000000) {
        throw new HttpsError('invalid-argument', 'The backup contains an invalid timestamp.');
      }
      return new Timestamp(value.seconds, value.nanoseconds);
    }
    if (type === 'geopoint') {
      if (typeof value.latitude !== 'number' || typeof value.longitude !== 'number') {
        throw new HttpsError('invalid-argument', 'The backup contains an invalid map location.');
      }
      return new GeoPoint(value.latitude, value.longitude);
    }
    if (type === 'bytes') {
      if (typeof value.base64 !== 'string') throw new HttpsError('invalid-argument', 'The backup contains invalid binary data.');
      return Buffer.from(value.base64, 'base64');
    }
    if (type === 'reference') {
      if (typeof value.path !== 'string' || value.path.split('/').length % 2 !== 0) {
        throw new HttpsError('invalid-argument', 'The backup contains an invalid document reference.');
      }
      return db.doc(value.path);
    }

    const output = Object.create(null);
    Object.keys(value).forEach((key) => {
      output[key] = decodeValue(value[key]);
    });
    return output;
  }

  function countKey(path) {
    const parts = path.split('/');
    if (parts.length === 2) return parts[0];
    if (parts.length === 4 && parts[0] === 'students' && ['docs', 'aadhaar', 'payment', 'activity'].includes(parts[2])) {
      return `students/{studentId}/${parts[2]}`;
    }
    return '';
  }

  function emptyCounts() {
    const result = Object.create(null);
    SCOPE.forEach((name) => { result[name] = 0; });
    return result;
  }

  function countsForDocuments(documents) {
    const counts = emptyCounts();
    documents.forEach((entry) => {
      const key = countKey(entry.path);
      if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += 1;
    });
    return counts;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    const result = Object.create(null);
    Object.keys(value).sort().forEach((key) => { result[key] = stableValue(value[key]); });
    return result;
  }

  function validatePath(path) {
    if (typeof path !== 'string' || path.length > 500 || path.startsWith('/') || path.endsWith('/')) return false;
    const parts = path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return false;

    if (parts.length === 2) return ROOT_COLLECTIONS.includes(parts[0]);
    if (parts.length === 4) return NESTED_COLLECTIONS.some((item) => item.pattern.test(path));
    return false;
  }

  function relevantGroupDoc(path) {
    return NESTED_COLLECTIONS.some((item) => item.pattern.test(path));
  }

  function mediaPath(path) {
    if (typeof path !== 'string' || !path || path.length >= 1024) return false;
    if (path.startsWith('/') || path.endsWith('/')) return false;
    const parts = path.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..')) return false;
    if (parts[0] === 'system-backups') return false;
    return MEDIA_PREFIXES.includes(`${parts[0]}/`) && parts.length >= 2 && parts.length <= 5;
  }

  function validBase64(s) {
    return typeof s === 'string' && s.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(s)
      && Buffer.from(s, 'base64').toString('base64') === s;
  }

  function validateFiles(files) {
    if (!Array.isArray(files) || files.length > MAX_DOCUMENTS) {
      throw new HttpsError('invalid-argument', 'Invalid backup file list.');
    }
    const seen = new Set();
    for (const f of files) {
      if (!isPlainObject(f) || !mediaPath(f.path) || seen.has(f.path) || !validBase64(f.base64)
        || !isPlainObject(f.metadata) || sha256(Buffer.from(f.base64, 'base64')) !== f.sha256) {
        throw new HttpsError('invalid-argument', 'Invalid, duplicate or corrupted Storage file in backup.');
      }
      seen.add(f.path);
      if (JSON.stringify(f.metadata).length > 16384) {
        throw new HttpsError('invalid-argument', 'File metadata is too large.');
      }
    }
  }

  function validatePayload(payload) {
    if (!isPlainObject(payload)
      || payload.format !== FORMAT
      || payload.version !== FORMAT_VERSION
      || payload.projectId !== PROJECT_ID
      || payload.creator !== CREATOR
      || typeof payload.backupId !== 'string'
      || !/^[a-f0-9-]{30,40}$/i.test(payload.backupId)
      || typeof payload.createdAt !== 'string'
      || !Number.isFinite(Date.parse(payload.createdAt))
      || !['download', 'pre-restore-safety', 'pre-clear-safety'].includes(payload.kind)
      || !Array.isArray(payload.scope)
      || JSON.stringify(payload.scope) !== JSON.stringify(SCOPE)
      || !Array.isArray(payload.documents)
      || payload.documents.length > MAX_DOCUMENTS) {
      throw new HttpsError(
        'invalid-argument',
        'This file is not a valid Unique Infotech CMS backup, or it belongs to a different project/version. No data was changed.'
      );
    }

    const seen = new Set();
    for (const entry of payload.documents) {
      if (!isPlainObject(entry) || !validatePath(entry.path) || !isPlainObject(entry.data)) {
        throw new HttpsError('invalid-argument', 'The backup contains an invalid record or unsupported collection path. No data was changed.');
      }
      if (seen.has(entry.path)) {
        throw new HttpsError('invalid-argument', 'The backup contains duplicate records. No data was changed.');
      }
      if (entry.path.startsWith('users/')) {
        const docEmail = entry.path.slice('users/'.length);
        const role = String(entry.data.role || '');
        if (role === 'superadmin') {
          throw new HttpsError('invalid-argument', 'Backup cannot contain or overwrite Super Admin accounts. No data was changed.');
        }
        if (!['branch_head', 'school_head'].includes(role) || docEmail !== docEmail.toLowerCase() || entry.data.email !== docEmail) {
          throw new HttpsError('invalid-argument', 'Backup contains an invalid user role record. No data was changed.');
        }
      }
      seen.add(entry.path);
      decodeValue(entry.data);
    }

    const orphanCount = payload.documents.filter((e) => e.path.split('/').length === 4 && !seen.has(e.path.split('/').slice(0, 2).join('/'))).length;
    const counts = countsForDocuments(payload.documents);
    if (!isPlainObject(payload.counts)
      || JSON.stringify(stableValue(payload.counts)) !== JSON.stringify(stableValue(counts))
      || payload.documentCount !== payload.documents.length) {
      throw new HttpsError('invalid-argument', 'The backup summary counts do not match its contents. No data was changed.');
    }

    validateFiles(payload.files);
    return {
      counts,
      documentCount: payload.documents.length,
      orphanCount,
      fileCount: payload.files.length
    };
  }

  function buildPayload(documents, backupId, kind, files = []) {
    const sorted = documents.slice().sort((a, b) => a.path.localeCompare(b.path));
    const counts = countsForDocuments(sorted);
    return {
      format: FORMAT,
      version: FORMAT_VERSION,
      creator: CREATOR,
      projectId: PROJECT_ID,
      backupId,
      kind: kind || 'download',
      createdAt: new Date(now()).toISOString(),
      scope: SCOPE.slice(),
      documentCount: sorted.length,
      counts,
      documents: sorted,
      files
    };
  }

  function withoutGeneration(data) {
    const result = { ...data };
    delete result._datasetGeneration;
    delete result._writeNonce;
    return result;
  }

  async function snapshotCurrentDatabase() {
    const result = [];
    let bytes = 0;
    const queries = ROOT_COLLECTIONS.map((name) => db.collection(name));
    NESTED_COLLECTIONS.forEach((n) => queries.push(db.collectionGroup(n.group)));

    for (const query of queries) {
      let after;
      while (true) {
        const page = await (after ? query.startAfter(after) : query).limit(500).get();
        for (const snap of page.docs) {
          if (!validatePath(snap.ref.path)) {
            const parts = snap.ref.path.split('/');
            if ((parts.length === 2 && ROOT_COLLECTIONS.includes(parts[0])) || relevantGroupDoc(snap.ref.path)) {
              throw new HttpsError('failed-precondition', 'A record has an unsupported path. No deletion started: ' + snap.ref.path);
            }
            continue;
          }
          const data = snap.data();
          if (snap.ref.path.startsWith('users/') && data && data.role === 'superadmin') {
            continue;
          }
          const entry = { path: snap.ref.path, data: encodeValue(withoutGeneration(data)) };
          bytes += Buffer.byteLength(JSON.stringify(entry));
          if (result.length >= MAX_DOCUMENTS || bytes > MAX_BACKUP_BYTES) {
            throw new HttpsError('resource-exhausted', 'Backup limit exceeded (50,000 documents / 95 MiB including files). No deletion started.');
          }
          result.push(entry);
        }
        if (page.size < 500) break;
        after = page.docs[page.docs.length - 1];
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  function mediaMetadata(meta) {
    const result = {};
    for (const key of ['contentType', 'cacheControl', 'contentDisposition', 'contentEncoding', 'contentLanguage', 'metadata']) {
      if (meta[key] != null) result[key] = meta[key];
    }
    if (result.metadata) {
      result.metadata = { ...result.metadata };
      delete result.metadata.datasetGeneration;
      if (!Object.keys(result.metadata).length) delete result.metadata;
    }
    return result;
  }

  async function listMedia() {
    const files = [];
    let pageToken;
    do {
      const [page, next] = await bucket.getFiles({ autoPaginate: false, maxResults: 500, pageToken });
      for (const file of page) {
        if (!file.name || file.name.endsWith('/')) continue;
        if (file.name.startsWith('system-backups/')) continue;
        if (!mediaPath(file.name)) {
          throw new HttpsError('failed-precondition', 'Unsupported Storage file path: ' + file.name);
        }
        files.push(file);
        if (files.length > MAX_DOCUMENTS) {
          throw new HttpsError('resource-exhausted', 'Too many Storage files.');
        }
      }
      pageToken = next && next.pageToken;
    } while (pageToken);
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function snapshot() {
    const documents = await snapshotCurrentDatabase();
    const files = [];
    let bytes = Buffer.byteLength(JSON.stringify(documents));
    for (const file of await listMedia()) {
      const [meta] = await file.getMetadata();
      bytes += Math.ceil(Number(meta.size) / 3) * 4 + 2048;
      if (bytes > MAX_BACKUP_BYTES) {
        throw new HttpsError('resource-exhausted', 'Backup exceeds 95 MiB including Storage files; no deletion started.');
      }
      const [data] = await bucket.file(file.name, { generation: meta.generation }).download();
      files.push({
        path: file.name,
        base64: data.toString('base64'),
        sha256: sha256(data),
        metadata: mediaMetadata(meta)
      });
    }
    return { documents, files };
  }

  async function countLiveState() {
    const countTasks = ROOT_COLLECTIONS.map(async (name) => {
      const q = name === 'users'
        ? db.collection('users').where('role', '!=', 'superadmin')
        : db.collection(name);
      const agg = await q.count().get();
      return { key: name, count: Number(agg.data().count || 0) };
    });
    NESTED_COLLECTIONS.forEach((n) => {
      countTasks.push((async () => {
        const agg = await db.collectionGroup(n.group).count().get();
        return { key: `students/{studentId}/${n.group}`, count: Number(agg.data().count || 0) };
      })());
    });
    const [countItems, mediaFiles] = await Promise.all([
      Promise.all(countTasks),
      listMedia().catch(() => [])
    ]);
    const counts = emptyCounts();
    let totalDocs = 0;
    countItems.forEach((item) => {
      counts[item.key] = item.count;
      totalDocs += item.count;
    });
    return { documentCount: totalDocs, fileCount: mediaFiles.length, counts };
  }

  function digest(state) {
    return sha256(JSON.stringify(stableValue({
      documents: state.documents.slice().sort((a, b) => a.path.localeCompare(b.path)),
      files: state.files.slice().sort((a, b) => a.path.localeCompare(b.path))
    })));
  }

  function payloadState(payload) {
    return {
      documents: payload.documents.filter((e) => validatePath(e.path)),
      files: payload.files || []
    };
  }

  function info(m) {
    return {
      backupId: m.backupId,
      storagePath: m.storagePath,
      filename: `unique-infotech-cms-${m.kind}-${m.backupId}.json`,
      createdAt: typeof m.createdAt === 'string' ? m.createdAt : m.createdAt.toDate().toISOString(),
      documentCount: m.documentCount,
      fileCount: m.fileCount || 0,
      sizeBytes: m.sizeBytes,
      sha256: m.sha256,
      kind: m.kind
    };
  }

  async function pruneOldBackups(protectedIds = new Set()) {
    try {
      const snap = await manifests.orderBy('createdAt', 'desc').get();
      let normalKept = 0;
      let safetyKept = 0;
      const toDelete = [];

      for (const doc of snap.docs) {
        const m = doc.data() || {};
        const id = m.backupId || doc.id;
        const isProtected = protectedIds.has(id);

        if (m.kind === 'download') {
          normalKept += 1;
          if (!isProtected && normalKept > MAX_NORMAL_BACKUPS) toDelete.push({ doc, m });
        } else if (m.kind === 'pre-clear-safety' || m.kind === 'pre-restore-safety') {
          safetyKept += 1;
          if (!isProtected && safetyKept > MAX_SAFETY_BACKUPS) toDelete.push({ doc, m });
        }
      }

      for (const item of toDelete) {
        if (typeof item.m.storagePath === 'string' && /^system-backups\/[^/]+\/backup-[a-f0-9-]{30,40}\.json$/i.test(item.m.storagePath)) {
          try {
            await bucket.file(item.m.storagePath).delete();
          } catch (err) {
            if (Number(err && err.code) !== 404) {
              logger.warn('Could not delete expired backup file', { storagePath: item.m.storagePath, message: err.message });
              continue;
            }
          }
        }
        await item.doc.ref.delete();
      }
      return toDelete.length;
    } catch (err) {
      logger.warn('Backup retention cleanup warning', { message: err && err.message ? err.message : String(err) });
      return 0;
    }
  }

  async function pruneOldOperations() {
    try {
      const snap = await operations.orderBy('startedAt', 'desc').get();
      let kept = 0;
      for (const doc of snap.docs) {
        const op = doc.data() || {};
        if (op.active === true) continue;
        kept += 1;
        if (kept > MAX_OPERATION_HISTORY) {
          await doc.ref.delete();
        }
      }
    } catch (err) {
      logger.warn('Operation history cleanup warning', { message: err && err.message ? err.message : String(err) });
    }
  }

  async function writeArtifact(state, kind, actor, extraProtectedIds = new Set()) {
    const backupId = newId();
    const payload = buildPayload(state.documents, backupId, kind, state.files);
    validatePayload(payload);
    const buffer = Buffer.from(JSON.stringify(payload));
    if (buffer.length > MAX_BACKUP_BYTES) {
      throw new HttpsError('resource-exhausted', 'Backup exceeds 95 MiB; no deletion started.');
    }
    const storagePath = `system-backups/${actor.uid}/backup-${backupId}.json`;
    const manifest = {
      backupId,
      storagePath,
      ownerUid: actor.uid,
      ownerEmail: actor.email,
      projectId: PROJECT_ID,
      format: FORMAT,
      version: FORMAT_VERSION,
      createdAt: Timestamp.fromDate(new Date(payload.createdAt)),
      kind,
      documentCount: state.documents.length,
      fileCount: state.files.length,
      counts: payload.counts,
      sizeBytes: buffer.length,
      sha256: sha256(buffer)
    };
    await hook('artifactSave', manifest);
    await bucket.file(storagePath).save(buffer, {
      resumable: false,
      validation: 'crc32c',
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'application/json',
        cacheControl: 'private, no-store, max-age=0',
        metadata: { backupId, ownerUid: actor.uid }
      }
    });

    // Read back and verify BEFORE publishing the manifest or touching live data.
    const [readback] = await bucket.file(storagePath).download();
    if (sha256(readback) !== manifest.sha256) throw new Error('Backup readback checksum failed.');
    const parsed = JSON.parse(readback.toString());
    validatePayload(parsed);
    if (digest(payloadState(parsed)) !== digest(state)) throw new Error('Backup round-trip digest verification failed.');
    await manifests.doc(backupId).set(manifest);

    // Retention cleanup runs only AFTER the new backup is verified and registered.
    const protectedIds = new Set(extraProtectedIds);
    protectedIds.add(backupId);
    const maintSnap = await maintenanceRef.get();
    if (maintSnap.exists) {
      const md = maintSnap.data() || {};
      if (md.safetyBackup?.backupId) protectedIds.add(md.safetyBackup.backupId);
      if (md.previousSafetyBackup?.backupId) protectedIds.add(md.previousSafetyBackup.backupId);
    }
    await pruneOldBackups(protectedIds);

    return info(manifest);
  }

  function incomingPathFor(uid, path) {
    return typeof uid === 'string' && uid.length > 0 && typeof path === 'string'
      && new RegExp(`^system-backups/${uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/incoming-[a-f0-9-]{30,40}\\.json$`, 'i').test(path);
  }

  function savedBackupPath(path) {
    return typeof path === 'string'
      && /^system-backups\/[^/]+\/backup-[a-f0-9-]{30,40}\.json$/i.test(path);
  }

  async function readRegistered(actor, storagePath, expectedHash, incoming) {
    if (incoming && !incomingPathFor(actor.uid, storagePath)) {
      throw new HttpsError('invalid-argument', 'Invalid incoming backup path.');
    }
    if (!incoming && !savedBackupPath(storagePath)) {
      throw new HttpsError('invalid-argument', 'Invalid saved backup path.');
    }
    const file = bucket.file(storagePath);
    const [meta] = await file.getMetadata();
    if (Number(meta.size) <= 0 || Number(meta.size) > MAX_BACKUP_BYTES || meta.contentType !== 'application/json') {
      throw new HttpsError('invalid-argument', 'Invalid backup size or content type.');
    }
    const [bytes] = await bucket.file(storagePath, { generation: meta.generation }).download();
    const hash = sha256(bytes);
    if (bytes.length > MAX_BACKUP_BYTES || (expectedHash && expectedHash !== hash)) {
      throw new HttpsError('invalid-argument', 'Backup file changed after validation preview. Select and validate it again.');
    }
    let payload;
    try {
      payload = JSON.parse(bytes.toString());
    } catch {
      throw new HttpsError('invalid-argument', 'Invalid backup JSON file.');
    }
    const validation = validatePayload(payload);
    const ms = await manifests.doc(payload.backupId).get();
    if (!ms.exists) {
      throw new HttpsError('failed-precondition', 'Backup registration is missing in this project. Only unmodified backups registered in this project can be restored.');
    }
    const manifest = ms.data();
    if (manifest.sha256 !== hash || manifest.projectId !== PROJECT_ID) {
      throw new HttpsError('permission-denied', 'Backup authenticity check failed. The file may have been tampered with or created elsewhere.');
    }
    return { payload, validation, hash, generation: meta.generation, sizeBytes: bytes.length };
  }

  async function removeIncoming(uid, path, generation) {
    if (!incomingPathFor(uid, path) || !generation) return;
    try {
      await bucket.file(path).delete({ ifGenerationMatch: generation });
    } catch (err) {
      if (Number(err.code) !== 404) logger.warn('Temporary incoming upload retained', { code: err.code });
    }
  }

  async function clientState() {
    const s = await stateRef.get();
    return s.exists ? s.data() : { generation: 'initial', active: false, mode: '' };
  }

  async function acquire(mode, expectedGeneration, actor, targetBackupId = null) {
    const id = newId();
    const started = now();
    return db.runTransaction(async (t) => {
      const [ms, cs] = await Promise.all([t.get(maintenanceRef), t.get(stateRef)]);
      const current = ms.exists ? ms.data() : {};
      const state = cs.exists ? cs.data() : { generation: 'initial' };
      if (typeof expectedGeneration !== 'string' || state.generation !== expectedGeneration) {
        throw new HttpsError('failed-precondition', 'Business data changed in another session. Reload this page before continuing.');
      }
      if (current.active && current.lockedUntil && current.lockedUntil.toMillis() > started) {
        throw new HttpsError('aborted', 'Another maintenance operation is running. Wait for it to finish and refresh status.');
      }
      const recovering = !!current.active && ['clear', 'restore'].includes(current.mode);
      if (recovering && mode !== current.mode) {
        throw new HttpsError('failed-precondition', `An interrupted ${current.mode} must be completed first. The CMS remains locked.`);
      }
      const generation = ['clear', 'restore'].includes(mode) ? newId() : state.generation;
      const lock = {
        active: true,
        mode,
        operationId: id,
        generation,
        actorUid: actor.uid,
        actorEmail: actor.email,
        startedAt: Timestamp.fromMillis(started),
        lockedUntil: Timestamp.fromMillis(started + LOCK_TTL_MS),
        recovering,
        phase: 'preparing',
        targetBackupId: targetBackupId || current.targetBackupId || null,
        previousOperationId: current.operationId || null,
        previousSafetyBackup: current.safetyBackup || null
      };
      t.set(maintenanceRef, lock);
      t.set(stateRef, { generation, active: true, mode });
      t.set(operations.doc(id), lock);
      return lock;
    });
  }

  function checkLock(snap, lock) {
    if (!snap.exists || !snap.data().active || snap.data().operationId !== lock.operationId
      || now() > lock.lockedUntil.toMillis() - 60000) {
      throw new HttpsError('aborted', 'Operation lock ownership or time budget expired. Recovery is required.');
    }
  }

  async function checkpoint(lock, fields) {
    await db.runTransaction(async (t) => {
      checkLock(await t.get(maintenanceRef), lock);
      t.update(maintenanceRef, fields);
      t.update(operations.doc(lock.operationId), fields);
    });
  }

  async function assertLock(lock) {
    checkLock(await maintenanceRef.get(), lock);
  }

  async function release(lock, result) {
    await hook('release', lock);
    await db.runTransaction(async (t) => {
      checkLock(await t.get(maintenanceRef), lock);
      t.update(maintenanceRef, { active: false, phase: 'complete', result });
      t.set(stateRef, { generation: lock.generation, active: false, mode: '' });
      t.update(operations.doc(lock.operationId), { active: false, phase: 'complete', result });
    });
  }

  function chunks(entries) {
    const out = [];
    let chunk = [];
    let bytes = 0;
    for (const entry of entries) {
      const size = Buffer.byteLength(JSON.stringify(entry)) * 2 + 2048;
      if (chunk.length && (chunk.length >= BATCH_SIZE || bytes + size > MAX_BATCH_BYTES)) {
        out.push(chunk);
        chunk = [];
        bytes = 0;
      }
      chunk.push(entry);
      bytes += size;
    }
    if (chunk.length) out.push(chunk);
    return out;
  }

  async function getProtectedUserPaths() {
    const superSnap = await db.collection('users').where('role', '==', 'superadmin').get();
    return new Set(superSnap.docs.map((d) => d.ref.path));
  }

  async function commitEntries(lock, entries, deleting, protectedUserPaths) {
    async function commit(part) {
      await hook(deleting ? 'deleteBatch' : 'writeBatch', part);
      try {
        await db.runTransaction(async (t) => {
          checkLock(await t.get(maintenanceRef), lock);
          for (const e of part) {
            if (protectedUserPaths.has(e.path)) {
              throw new HttpsError('failed-precondition', 'Refused to modify protected Super Admin user record.');
            }
            if (deleting) {
              t.delete(db.doc(e.path));
            } else {
              t.set(db.doc(e.path), decodeValue(e.data));
            }
          }
        });
      } catch (err) {
        if (part.length > 1 && /maximum.*size|too (?:large|big)|10\s*(?:MiB|MB)|request.*size/i.test(err.message || '')) {
          const half = Math.ceil(part.length / 2);
          await commit(part.slice(0, half));
          await commit(part.slice(half));
        } else {
          throw err;
        }
      }
    }
    for (const part of chunks(entries)) await commit(part);
  }

  async function replaceState(lock, state) {
    const protectedUserPaths = await getProtectedUserPaths();
    const current = await snapshotCurrentDatabase();
    // Delete deepest paths (student subcollections) before parent student documents.
    await commitEntries(
      lock,
      current.sort((a, b) => b.path.split('/').length - a.path.split('/').length),
      true,
      protectedUserPaths
    );

    for (const f of await listMedia()) {
      await assertLock(lock);
      const [meta] = await f.getMetadata();
      await hook('deleteMedia', f.name);
      await f.delete({ ifGenerationMatch: meta.generation });
    }

    await commitEntries(lock, state.documents, false, protectedUserPaths);
    for (const f of state.files) {
      await assertLock(lock);
      await hook('writeMedia', f.path);
      await bucket.file(f.path).save(Buffer.from(f.base64, 'base64'), {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          ...f.metadata,
          metadata: {
            ...(f.metadata.metadata || {}),
            datasetGeneration: lock.generation
          }
        }
      });
    }
  }

  async function verifiedReplace(lock, state) {
    await replaceState(lock, state);
    await hook('verify', state);
    if (digest(await snapshot()) !== digest(state)) {
      throw new Error('Post-operation verification digest failed.');
    }
  }

  function memoryTelemetry(startedMs, startMem) {
    const endMem = process.memoryUsage();
    const toMiB = (n) => Math.round((n / (1024 * 1024)) * 10) / 10;
    return {
      durationMs: Math.max(0, Date.now() - startedMs),
      startRssMiB: toMiB(startMem.rss),
      endRssMiB: toMiB(endMem.rss),
      heapUsedMiB: toMiB(endMem.heapUsed)
    };
  }

  async function operate(mode, request) {
    const startedWall = Date.now();
    const startMem = process.memoryUsage();
    const actor = await assertSuperAdmin(request, { requireRecentAuth: true });
    const data = request.data || {};

    if (mode === 'clear' && data.confirmation !== 'DELETE ALL DATA') {
      throw new HttpsError('invalid-argument', 'Type DELETE ALL DATA to confirm Master Delete.');
    }
    if (mode === 'restore' && (data.confirmation !== 'RESTORE' || !/^[a-f0-9]{64}$/.test(data.expectedSha256 || ''))) {
      throw new HttpsError('invalid-argument', 'Restore confirmation and validated checksum are required.');
    }

    let source;
    if (mode === 'restore') {
      source = await readRegistered(actor, data.storagePath, data.expectedSha256, true);
    }

    const lock = await acquire(mode, data.expectedGeneration, actor, source?.payload?.backupId || null);
    let destructive = false;
    let safety = null;
    let beforeEmpty = false;
    let result;
    let keepLocked = lock.recovering;

    try {
      const before = await snapshot();
      beforeEmpty = before.documents.length === 0 && before.files.length === 0;

      if (mode === 'restore' && !lock.recovering && !beforeEmpty) {
        throw new HttpsError(
          'failed-precondition',
          'Master Delete must remove all current CMS records and files before importing a backup.'
        );
      }

      if (mode === 'backup') {
        safety = await writeArtifact(before, 'download', actor);
        await checkpoint(lock, { phase: 'snapshot-verified' });
      } else if (mode === 'clear' || !beforeEmpty) {
        safety = await writeArtifact(before, `pre-${mode}-safety`, actor);
        await checkpoint(lock, { safetyBackup: safety, phase: 'snapshot-verified' });
      } else {
        await checkpoint(lock, { phase: 'snapshot-verified' });
      }

      if (mode === 'backup') {
        result = {
          ok: true,
          backup: safety,
          message: 'Backup created, read-back verified, and ready for download.'
        };
      } else {
        await checkpoint(lock, { phase: 'replacing' });
        destructive = true;
        const target = mode === 'clear' ? { documents: [], files: [] } : payloadState(source.payload);
        await verifiedReplace(lock, target);
        result = {
          ok: true,
          safetyBackup: safety,
          documentCount: target.documents.length,
          fileCount: target.files.length,
          message: mode === 'clear'
            ? 'Master Delete completed. All CMS data and files are verified empty while Super Admin access remains intact.'
            : 'Restore completed and verified. All records, counters, and files match the backup.'
        };
      }
      keepLocked = false;
    } catch (err) {
      logger.error('CMS Manage Data operation failed', {
        mode,
        operationId: lock.operationId,
        errorMessage: err.message
      });

      if (destructive && (safety || beforeEmpty)) {
        try {
          await checkpoint(lock, { phase: 'rolling-back' });
          let rollbackState = { documents: [], files: [] };
          if (safety) {
            const saved = await readRegistered(actor, safety.storagePath, safety.sha256, false);
            rollbackState = payloadState(saved.payload);
          }
          await verifiedReplace(lock, rollbackState);
          keepLocked = lock.recovering;
          result = {
            ok: false,
            rolledBack: !keepLocked,
            safetyBackup: safety,
            message: keepLocked
              ? 'Recovery failed. Initial state was restored; system remains locked.'
              : 'Operation failed; previous CMS state was restored and verified.'
          };
        } catch (rollbackError) {
          keepLocked = true;
          result = {
            ok: false,
            safetyBackup: safety,
            message: 'Operation and rollback could not be verified. The CMS remains locked. Check recovery status and retry the same operation after the lock cooldown.'
          };
        }
      } else {
        result = { ok: false, safetyBackup: safety, message: err.message };
      }
    }

    if (!keepLocked) {
      try {
        await release(lock, result);
        await pruneOldOperations();
      } catch (err) {
        keepLocked = true;
        result = {
          ...result,
          ok: false,
          message: 'The operation completed but could not unlock cleanly. Refresh recovery status.'
        };
      }
    }

    if (keepLocked) {
      result = { ...result, ok: false, recoveryRequired: true };
      try {
        await checkpoint(lock, { phase: 'recovery-required', lastError: result.message });
      } catch {
        /* Never bypass lock fencing. */
      }
    }

    if (source && result.ok) {
      await removeIncoming(actor.uid, data.storagePath, source.generation);
    }

    const metrics = memoryTelemetry(startedWall, startMem);
    logger.info('CMS Manage Data telemetry', { mode, ok: !!result.ok, ...metrics });

    return {
      ...result,
      metrics,
      operationId: lock.operationId,
      generation: lock.generation
    };
  }

  async function getBucketDetails() {
    try {
      const [meta] = await bucket.getMetadata();
      const location = String(meta.location || '').toUpperCase();
      return {
        name: bucket.name,
        location: location || 'UNKNOWN',
        storageClass: meta.storageClass || 'STANDARD',
        freeTierEligible: FREE_STORAGE_LOCATIONS.has(location)
      };
    } catch (err) {
      logger.warn('Could not read Storage bucket metadata', { message: err && err.message });
      return {
        name: bucket.name,
        location: 'UNKNOWN',
        storageClass: 'UNKNOWN',
        freeTierEligible: null
      };
    }
  }

  async function hasActiveIncomingUpload() {
    const incomingRe = /^system-backups\/[^/]+\/incoming-[a-f0-9-]{30,40}\.json$/i;
    try {
      let pageToken;
      do {
        const [page, next] = await bucket.getFiles({
          prefix: 'system-backups/',
          autoPaginate: false,
          maxResults: 500,
          pageToken
        });
        for (const file of page) {
          if (!file || !file.name || !incomingRe.test(file.name)) continue;
          const timeCreated = file.metadata && file.metadata.timeCreated
            ? Date.parse(file.metadata.timeCreated)
            : NaN;
          // If an incoming file was staged recently (within lock TTL) or lacks a timestamp,
          // treat validation/restore as active so manifests are never deleted under it.
          if (!Number.isFinite(timeCreated) || (now() - timeCreated) <= LOCK_TTL_MS) {
            return true;
          }
        }
        pageToken = next && next.pageToken;
      } while (pageToken);
      return false;
    } catch (err) {
      logger.warn('Could not inspect incoming uploads; pausing orphan manifest cleanup.', {
        message: err && err.message ? err.message : String(err)
      });
      return true;
    }
  }

  async function getCmsBackupStatus(request) {
    await assertSuperAdmin(request);
    const [s, m, activeOpsSnap, h, live, bucketInfo, activeIncoming] = await Promise.all([
      clientState(),
      maintenanceRef.get(),
      operations.where('active', '==', true).get(),
      manifests.orderBy('createdAt', 'desc').get(),
      countLiveState(),
      getBucketDetails(),
      hasActiveIncomingUpload()
    ]);

    const lock = m.exists ? m.data() : {};
    const activeOpDocs = activeOpsSnap.docs || [];
    const hasActiveOperation = !!lock.active || activeOpDocs.length > 0 || activeIncoming;

    const protectedIds = new Set();
    if (lock.active) {
      if (lock.targetBackupId) protectedIds.add(lock.targetBackupId);
      if (lock.safetyBackup?.backupId) protectedIds.add(lock.safetyBackup.backupId);
      if (lock.previousSafetyBackup?.backupId) protectedIds.add(lock.previousSafetyBackup.backupId);
      if (lock.result?.backup?.backupId) protectedIds.add(lock.result.backup.backupId);
      if (lock.result?.safetyBackup?.backupId) protectedIds.add(lock.result.safetyBackup.backupId);
    }
    for (const opDoc of activeOpDocs) {
      const op = opDoc.data() || {};
      if (op.targetBackupId) protectedIds.add(op.targetBackupId);
      if (op.backupId) protectedIds.add(op.backupId);
      if (op.safetyBackup?.backupId) protectedIds.add(op.safetyBackup.backupId);
      if (op.previousSafetyBackup?.backupId) protectedIds.add(op.previousSafetyBackup.backupId);
    }

    // Returns 'exists', 'missing', or 'unknown' so transient Storage errors never delete manifests.
    const existenceChecks = new Map();
    function checkStorageFile(storagePath) {
      if (typeof storagePath !== 'string' || !savedBackupPath(storagePath)) {
        return Promise.resolve('invalid');
      }
      if (!existenceChecks.has(storagePath)) {
        existenceChecks.set(storagePath, (async () => {
          try {
            const [exists] = await bucket.file(storagePath).exists();
            return exists === false ? 'missing' : 'exists';
          } catch (error) {
            logger.warn('Could not verify backup file existence; retaining manifest.', {
              storagePath,
              message: error && error.message ? error.message : String(error)
            });
            return 'unknown';
          }
        })());
      }
      return existenceChecks.get(storagePath);
    }

    const checked = await Promise.all(h.docs.map(async (doc) => {
      const data = doc.data() || {};
      const id = data.backupId || doc.id;
      const fileState = await checkStorageFile(data.storagePath);

      if (fileState === 'missing') {
        if (!hasActiveOperation && !protectedIds.has(id)) {
          try {
            await doc.ref.delete();
          } catch (delErr) {
            logger.warn('Could not delete orphan backup manifest', {
              backupId: id,
              message: delErr && delErr.message ? delErr.message : String(delErr)
            });
          }
        }
        return null;
      }

      if (fileState === 'invalid') {
        return null;
      }

      return info(data);
    }));

    const savedSafetyBackup = lock.safetyBackup || lock.previousSafetyBackup || null;
    const safetyState = savedSafetyBackup ? await checkStorageFile(savedSafetyBackup.storagePath) : 'missing';
    const visibleSafetyBackup = (safetyState === 'exists' || safetyState === 'unknown') ? savedSafetyBackup : null;

    return {
      ok: true,
      generation: s.generation,
      active: !!lock.active,
      mode: lock.mode || '',
      phase: lock.phase || '',
      operationId: lock.operationId || '',
      recoveryAfter: lock.lockedUntil ? lock.lockedUntil.toMillis() : 0,
      safetyBackup: visibleSafetyBackup,
      lastResult: lock.result || null,
      backups: checked.filter(Boolean).slice(0, 20),
      liveCounts: live,
      bucketInfo,
      quotaLimits: QUOTA_LIMITS,
      retention: { normal: MAX_NORMAL_BACKUPS, safety: MAX_SAFETY_BACKUPS }
    };
  }

  async function downloadCmsBackup(request) {
    const actor = await assertSuperAdmin(request, { requireRecentAuth: true });
    const data = request.data || {};
    const storagePath = String(data.storagePath || '');
    if (!savedBackupPath(storagePath) || !storagePath.startsWith(`system-backups/${actor.uid}/backup-`)) {
      throw new HttpsError('permission-denied', 'Backup path does not belong to the active Super Admin.');
    }

    const match = storagePath.match(/backup-([a-f0-9-]{30,40})\.json$/i);
    const backupId = typeof data.backupId === 'string' && /^[a-f0-9-]{30,40}$/i.test(data.backupId)
      ? data.backupId
      : (match ? match[1] : '');
    if (!backupId) {
      throw new HttpsError('invalid-argument', 'Invalid backup identifier.');
    }

    const ms = await manifests.doc(backupId).get();
    if (!ms.exists) {
      throw new HttpsError('not-found', 'Backup manifest record not found.');
    }
    const manifest = ms.data();
    if (manifest.projectId !== PROJECT_ID || manifest.storagePath !== storagePath) {
      throw new HttpsError('permission-denied', 'Backup manifest mismatch.');
    }

    const [bytes] = await bucket.file(storagePath).download();
    if (sha256(bytes) !== manifest.sha256) {
      throw new HttpsError('data-loss', 'Stored backup file failed server SHA-256 verification.');
    }

    const filename = info(manifest).filename;
    const RAW_CHUNK_BYTES = 5 * 1024 * 1024;
    if (typeof data.offset === 'number') {
      const offset = Math.max(0, Math.floor(data.offset));
      const chunkLen = Math.min(RAW_CHUNK_BYTES, Math.max(1, Math.floor(Number(data.chunkBytes) || RAW_CHUNK_BYTES)));
      const slice = bytes.subarray(offset, offset + chunkLen);
      const nextOffset = offset + slice.length;
      return {
        ok: true,
        mode: 'chunk',
        backupId,
        filename,
        sha256: manifest.sha256,
        totalBytes: bytes.length,
        offset,
        nextOffset,
        done: nextOffset >= bytes.length,
        dataBase64: slice.toString('base64')
      };
    }

    const gz = zlib.gzipSync(bytes);
    if (gz.length <= 6 * 1024 * 1024) {
      return {
        ok: true,
        mode: 'gzip-base64',
        backupId,
        filename,
        sha256: manifest.sha256,
        totalBytes: bytes.length,
        done: true,
        dataBase64: gz.toString('base64')
      };
    }

    const slice = bytes.subarray(0, RAW_CHUNK_BYTES);
    return {
      ok: true,
      mode: 'chunk',
      backupId,
      filename,
      sha256: manifest.sha256,
      totalBytes: bytes.length,
      offset: 0,
      nextOffset: slice.length,
      done: slice.length >= bytes.length,
      dataBase64: slice.toString('base64')
    };
  }

  async function validateCmsBackup(request) {
    const data = request.data || {};
    if (data.action === 'discard') {
      const actor = await assertSuperAdmin(request);
      if (incomingPathFor(actor.uid, data.storagePath)) {
        try {
          await bucket.file(data.storagePath).delete();
        } catch (err) {
          if (Number(err && err.code) !== 404) {
            logger.warn('Could not discard incoming upload', { message: err && err.message });
          }
        }
      }
      return { ok: true };
    }

    const actor = await assertSuperAdmin(request, { requireRecentAuth: true });
    let storagePath = data.storagePath;
    let stagedHere = false;

    if (data.action === 'stage-validate') {
      if (typeof data.dataBase64 !== 'string' || !data.dataBase64.length || data.dataBase64.length > 10 * 1024 * 1024) {
        throw new HttpsError('invalid-argument', 'Uploaded backup payload is empty or too large for staged verification.');
      }
      const rawBuf = Buffer.from(data.dataBase64, 'base64');
      let jsonBuf;
      if (data.encoding === 'gzip-base64') {
        try {
          jsonBuf = zlib.gunzipSync(rawBuf, { maxOutputLength: MAX_BACKUP_BYTES + 1024 });
        } catch {
          throw new HttpsError('invalid-argument', 'Uploaded file could not be unpacked or exceeds the 95 MiB backup limit. No data was changed.');
        }
      } else if (data.encoding === 'utf8-base64') {
        jsonBuf = rawBuf;
      } else {
        throw new HttpsError('invalid-argument', 'Unsupported backup upload encoding.');
      }
      if (!jsonBuf.length || jsonBuf.length > MAX_BACKUP_BYTES) {
        throw new HttpsError('invalid-argument', 'Uploaded backup file is empty or exceeds 95 MiB. No data was changed.');
      }
      storagePath = `system-backups/${actor.uid}/incoming-${newId()}.json`;
      await bucket.file(storagePath).save(jsonBuf, {
        resumable: false,
        validation: 'crc32c',
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType: 'application/json',
          cacheControl: 'private, no-store, max-age=0',
          metadata: { ownerUid: actor.uid, originalName: String(data.fileName || 'backup.json').slice(0, 120) }
        }
      });
      stagedHere = true;
    }

    let source;
    try {
      source = await readRegistered(actor, storagePath, null, true);
    } catch (err) {
      const isRejectedPayload = err instanceof HttpsError
        && ['invalid-argument', 'permission-denied', 'failed-precondition'].includes(err.code);
      if ((stagedHere || isRejectedPayload) && incomingPathFor(actor.uid, storagePath)) {
        await bucket.file(storagePath).delete().catch(() => {});
      }
      throw err;
    }

    const [s, m, live] = await Promise.all([
      clientState(),
      maintenanceRef.get(),
      countLiveState()
    ]);
    const lock = m.exists ? m.data() : {};

    return {
      ok: true,
      storagePath,
      ...source.validation,
      backupId: source.payload.backupId,
      createdAt: source.payload.createdAt,
      sha256: source.hash,
      sizeBytes: source.sizeBytes,
      currentDocumentCount: live.documentCount,
      currentFileCount: live.fileCount,
      recoveryMode: !!lock.active && lock.mode === 'restore',
      generation: s.generation,
      quotaLimits: QUOTA_LIMITS
    };
  }

  return {
    createCmsBackup: (r) => operate('backup', r),
    clearCmsData: (r) => operate('clear', r),
    restoreCmsBackup: (r) => operate('restore', r),
    validateCmsBackup,
    downloadCmsBackup,
    getCmsBackupStatus,
    _test: {
      encodeValue,
      decodeValue,
      validatePayload,
      buildPayload,
      snapshot,
      digest,
      writeArtifact,
      chunks,
      acquire,
      release,
      removeIncoming,
      replaceState,
      pruneOldBackups,
      pruneOldOperations,
      constants: {
        ROOT_COLLECTIONS,
        NESTED_COLLECTIONS,
        SCOPE,
        MAX_BACKUP_BYTES,
        MAX_NORMAL_BACKUPS,
        MAX_SAFETY_BACKUPS,
        MAX_OPERATION_HISTORY
      }
    }
  };
}

module.exports = { createService };
