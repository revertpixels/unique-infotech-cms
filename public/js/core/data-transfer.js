/* data-transfer.js — Manage Data (Backup, Master Delete, Validate, Restore) for Super Admin only. */
import { app, auth, storage } from '../config/firebase-config.js';
import {
  EmailAuthProvider,
  reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFunctions,
  httpsCallable
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js';
import {
  ref as storageRef,
  uploadBytesResumable
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
import { showToast } from '../components/toast.js?v=1.8.191';
import { getDatasetGeneration, initDatasetSession } from './dataset-session.js?v=1.8.191';
import { getRoleTitle, getRolePluralTitle } from '../services/user-directory.service.js?v=1.8.191';

const MAX_BYTES = 95 * 1024 * 1024;
const UNLOCK_IDLE_MS = 10 * 60 * 1000;
const UNLOCK_HARD_MS = 12 * 60 * 1000;

function getCollectionLabel(key) {
  if (key === 'users') {
    return `${getRoleTitle('branch_head')} & ${getRoleTitle('school_head')} Users`;
  }
  return COLLECTION_LABELS[key] || key;
}

const COLLECTION_LABELS = {
  settings: 'Organisation & System Settings',
  branches: 'Youth Branches',
  courses: 'Courses & School Levels',
  levels: 'School Levels (Legacy)',
  batches: 'Batches',
  sessions: 'Academic Sessions',
  counters: 'Student ID & Receipt Counters',
  users: 'Authorised Users',
  students: 'Students (Youth & Unique Kids)',
  enrolments: 'Kids Enrolments',
  bills: 'Kids Monthly Bills',
  payments: 'Kids Monthly Payments',
  waivers: 'Fee Waivers',
  breaks: 'Approved Breaks',
  transfers: 'Batch Transfers',
  deletionLog: 'Deletion & Drop Audit Logs',
  'students/{studentId}/docs': 'Student Photos, Signatures & Docs',
  'students/{studentId}/aadhaar': 'Student Aadhaar Records',
  'students/{studentId}/payment': 'Student Payment Subcollection',
  'students/{studentId}/activity': 'Student Activity Logs'
};

const QUOTA = { reads: 50000, writes: 20000, deletes: 20000 };

function $(id) {
  return document.getElementById(id);
}

function fmtBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MiB';
}

function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-IN');
}

function estimateQuota(op, liveDocs, targetDocs) {
  const n = Number(liveDocs || 0);
  const b = Number(targetDocs || 0);
  if (op === 'backup') {
    return { reads: n + 12, writes: 5, deletes: 0 };
  }
  if (op === 'clear') {
    return { reads: 3 * n + 15, writes: 5, deletes: n };
  }
  return { reads: 2 * n + b + 15, writes: b + 5, deletes: n };
}

function quotaSummaryText(est) {
  return `Est. Firestore usage: ~${fmtInt(est.reads)} reads, ~${fmtInt(est.writes)} writes, ~${fmtInt(est.deletes)} deletes (free daily limit: 50k reads / 20k writes / 20k deletes).`;
}

function isNearQuota(est) {
  return est.reads >= QUOTA.reads * 0.8
    || est.writes >= QUOTA.writes * 0.8
    || est.deletes >= QUOTA.deletes * 0.8;
}

function isOverQuota(est) {
  return est.reads >= QUOTA.reads
    || est.writes >= QUOTA.writes
    || est.deletes >= QUOTA.deletes;
}

export function createManageDataController({ profile, onLockChange, onDatasetMutated } = {}) {
  let unlocked = false;
  let unlockedAt = 0;
  let busy = false;
  let preview = null;
  let incomingPath = '';
  let status = null;
  let idleTimer = null;
  let hardTimer = null;
  let destroyed = false;

  const functionsInstance = getFunctions(app, 'asia-south1');

  async function callFn(name, data = {}) {
    const fn = httpsCallable(functionsInstance, name, { timeout: 540000 });
    const res = await fn(data);
    return res.data;
  }

  function showStatusMessage(text, type = 'info') {
    const box = $('md-op-status');
    if (!box) return;
    box.hidden = false;
    box.className = 'md-alert md-alert-' + type;
    box.textContent = text;
  }

  function clearStatusMessage() {
    const box = $('md-op-status');
    if (!box) return;
    box.hidden = true;
    box.textContent = '';
  }

  function setProgress(pct, text) {
    const wrap = $('md-progress-wrap');
    const bar = $('md-progress');
    const label = $('md-progress-text');
    if (!wrap || !bar || !label) return;
    if (pct === null) {
      wrap.hidden = true;
      bar.value = 0;
      label.textContent = '';
    } else {
      wrap.hidden = false;
      bar.value = pct;
      label.textContent = text || '';
    }
  }

  function clearLockTimers() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
  }

  function bumpActivity() {
    if (!unlocked || destroyed) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      lock('Manage Data locked due to inactivity. Re-enter your password to continue.');
    }, UNLOCK_IDLE_MS);
  }

  function updateGateButton() {
    const pw = $('md-gate-pw');
    const ack = $('md-gate-ack');
    const btn = $('md-gate-unlock');
    if (!pw || !ack || !btn) return;
    btn.disabled = !pw.value || !ack.checked;
  }

  function updateActionButtons() {
    const clearBtn = $('md-clear-btn');
    const clearAck = $('md-clear-ack');
    const clearTxt = $('md-clear-confirm');
    if (clearBtn && clearAck && clearTxt) {
      clearBtn.disabled = busy || !clearAck.checked || clearTxt.value.trim() !== 'DELETE ALL DATA';
    }

    const restoreBtn = $('md-restore-btn');
    const restoreAck = $('md-restore-ack');
    const restoreTxt = $('md-restore-confirm');
    if (restoreBtn && restoreAck && restoreTxt) {
      const blockedByNonEmpty = !preview || (!preview.recoveryMode && (preview.currentDocumentCount > 0 || preview.currentFileCount > 0));
      restoreBtn.disabled = busy || blockedByNonEmpty || !restoreAck.checked || restoreTxt.value.trim() !== 'RESTORE';
    }

    const cancelSel = $('md-cancel-file-btn');
    if (cancelSel) cancelSel.disabled = busy || (!incomingPath && !$('md-backup-file')?.files?.length);
  }

  function setBusy(val) {
    busy = val;
    for (const id of ['md-create-backup-btn', 'md-validate-btn', 'md-backup-file', 'md-refresh-btn', 'md-lock-btn']) {
      const el = $(id);
      if (el) el.disabled = busy;
    }
    updateActionButtons();
  }

  function resetPreview() {
    preview = null;
    const p = $('md-preview');
    if (p) p.hidden = true;
    const ack = $('md-restore-ack');
    if (ack) ack.checked = false;
    const txt = $('md-restore-confirm');
    if (txt) txt.value = '';
    updateActionButtons();
  }

  async function cleanupSelection() {
    const uid = auth.currentUser?.uid || '';
    if (incomingPath && uid && new RegExp('^system-backups/' + uid + '/incoming-[a-f0-9-]{30,40}\\.json$', 'i').test(incomingPath)) {
      try {
        await callFn('validateCmsBackup', { action: 'discard', storagePath: incomingPath });
      } catch {
        // Best-effort cleanup of abandoned incoming upload; server overwrite/expiry keeps bucket clean.
      }
    }
    incomingPath = '';
    resetPreview();
  }

  function lock(noticeMessage) {
    clearLockTimers();
    unlocked = false;
    unlockedAt = 0;
    busy = false;
    const gate = $('md-gate');
    const workspace = $('md-workspace');
    if (gate) gate.hidden = false;
    if (workspace) workspace.hidden = true;
    const pw = $('md-gate-pw');
    const ack = $('md-gate-ack');
    const gateErr = $('md-gate-err');
    if (pw) { pw.value = ''; pw.type = 'password'; }
    if (ack) ack.checked = false;
    if (gateErr) {
      gateErr.hidden = !noticeMessage;
      gateErr.textContent = noticeMessage || '';
    }
    updateGateButton();
    if (typeof onLockChange === 'function') onLockChange(false);
  }

  function handleReauthError(err) {
    const msg = String(err?.message || err || '');
    if (msg.includes('REAUTH_REQUIRED') || /recent password/i.test(msg)) {
      lock('Password confirmation expired. Re-enter your password to continue.');
      return true;
    }
    return false;
  }

  function renderQuotaBox(elId, op, liveDocs, targetDocs) {
    const box = $(elId);
    if (!box) return;
    const est = estimateQuota(op, liveDocs, targetDocs);
    const over = isOverQuota(est);
    const near = isNearQuota(est);
    const countPart = op === 'restore'
      ? `Live: ${fmtInt(liveDocs)} records · Backup: ${fmtInt(targetDocs)} records`
      : `Live scope: ${fmtInt(liveDocs)} records`;
    box.className = 'md-quota ' + (over ? 'danger' : near ? 'warning' : 'info');
    box.textContent = `${countPart} · ${quotaSummaryText(est)}`
      + (over ? ' WARNING: Exceeds daily free-tier quota; Blaze usage charges may apply.'
        : near ? ' WARNING: Approaching daily free-tier quota.' : '');
  }

  function renderStatus() {
    if (!status) return;
    const stateEl = $('md-recovery-state');
    if (stateEl) {
      if (status.active) {
        stateEl.className = 'md-alert md-alert-danger';
        stateEl.textContent = `MAINTENANCE ACTIVE (${status.mode} · ${status.phase}). All CMS reads/writes are blocked. If interrupted, retry ${status.mode === 'clear' ? 'Master Delete' : status.mode === 'restore' ? 'Restore' : 'Backup'} after ${new Date(status.recoveryAfter).toLocaleString()}.`;
      } else {
        stateEl.className = 'md-alert md-alert-info';
        stateEl.textContent = 'System ready. No maintenance lock active. Retention policy keeps the last 5 normal backups and last 2 safety backups.';
      }
    }

    const bucketNote = $('md-bucket-info');
    if (bucketNote && status.bucketInfo) {
      const b = status.bucketInfo;
      const tierTxt = b.freeTierEligible === true
        ? 'No-cost Storage tier eligible'
        : b.freeTierEligible === false
          ? 'Paid region (outside US-CENTRAL1/US-EAST1/US-WEST1 free Storage tier)'
          : 'Bucket metadata unavailable until first file write';
      bucketNote.textContent = `Bucket: ${b.name || '—'} · Location: ${b.location || '—'} (${tierTxt})`;
    }

    const liveDocs = Number(status.liveCounts?.documentCount || 0);
    const liveFiles = Number(status.liveCounts?.fileCount || 0);
    const liveBadge = $('md-live-summary');
    if (liveBadge) {
      liveBadge.textContent = `${fmtInt(liveDocs)} records · ${fmtInt(liveFiles)} Storage files`;
    }
    renderQuotaBox('md-backup-quota', 'backup', liveDocs, liveDocs);
    renderQuotaBox('md-clear-quota', 'clear', liveDocs, 0);

    const listEl = $('md-backup-history');
    if (listEl) {
      listEl.textContent = '';
      const combined = [...(status.safetyBackup ? [status.safetyBackup] : []), ...(status.backups || [])];
      const seen = new Set();
      const unique = [];
      for (const item of combined) {
        if (!item || !item.backupId || seen.has(item.backupId)) continue;
        seen.add(item.backupId);
        unique.push(item);
      }

      if (!unique.length) {
        const empty = document.createElement('div');
        empty.className = 'md-empty-list';
        empty.textContent = 'No saved backups found in Storage.';
        listEl.appendChild(empty);
      } else {
        for (const b of unique) {
          const row = document.createElement('div');
          row.className = 'md-backup-row';

          const meta = document.createElement('div');
          meta.className = 'md-backup-meta';

          const top = document.createElement('div');
          top.className = 'md-backup-top';
          const badge = document.createElement('span');
          const isSafety = b.kind === 'pre-clear-safety' || b.kind === 'pre-restore-safety';
          badge.className = 'md-kind-badge ' + (isSafety ? 'safety' : 'normal');
          badge.textContent = b.kind === 'pre-clear-safety'
            ? 'Pre-Delete Safety'
            : b.kind === 'pre-restore-safety'
              ? 'Pre-Restore Safety'
              : 'Full Backup';

          const dt = document.createElement('strong');
          dt.textContent = new Date(b.createdAt).toLocaleString();
          top.append(badge, dt);

          const sub = document.createElement('div');
          sub.className = 'md-backup-sub';
          sub.textContent = `${fmtInt(b.documentCount)} records · ${fmtInt(b.fileCount || 0)} files · ${fmtBytes(b.sizeBytes)} · ID: ${b.backupId}`;

          meta.append(top, sub);

          const dlBtn = document.createElement('button');
          dlBtn.type = 'button';
          dlBtn.className = 'md-btn md-btn-outline';
          dlBtn.innerHTML = '<i data-lucide="download"></i><span>Download</span>';
          dlBtn.onclick = async () => {
            try {
              dlBtn.disabled = true;
              await downloadBackup(b);
              showStatusMessage('Backup downloaded and SHA-256 verified.', 'success');
            } catch (err) {
              showStatusMessage(err.message || 'Download failed.', 'danger');
            } finally {
              dlBtn.disabled = false;
            }
          };

          row.append(meta, dlBtn);
          listEl.appendChild(row);
        }
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }

  async function refreshStatus() {
    status = await callFn('getCmsBackupStatus');
    renderStatus();
    return status;
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToBase64(bytes) {
    const parts = [];
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      parts.push(String.fromCharCode(...bytes.subarray(i, i + step)));
    }
    return btoa(parts.join(''));
  }

  async function gzipBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function gunzipBytes(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function downloadBackup(backup) {
    const first = await callFn('downloadCmsBackup', {
      backupId: backup.backupId,
      storagePath: backup.storagePath
    });
    if (!first || !first.ok) {
      throw new Error(first?.message || 'Backup download failed.');
    }

    let bytes;
    if (first.mode === 'gzip-base64') {
      bytes = await gunzipBytes(base64ToBytes(first.dataBase64));
    } else if (first.mode === 'chunk') {
      const parts = [base64ToBytes(first.dataBase64)];
      let nextOffset = first.nextOffset;
      let done = !!first.done;
      while (!done) {
        const next = await callFn('downloadCmsBackup', {
          backupId: backup.backupId,
          storagePath: backup.storagePath,
          offset: nextOffset
        });
        parts.push(base64ToBytes(next.dataBase64));
        nextOffset = next.nextOffset;
        done = !!next.done;
      }
      const total = parts.reduce((sum, arr) => sum + arr.length, 0);
      bytes = new Uint8Array(total);
      let pos = 0;
      for (const arr of parts) {
        bytes.set(arr, pos);
        pos += arr.length;
      }
    } else {
      throw new Error('Unexpected backup download response.');
    }

    const expectedSha = backup.sha256 || first.sha256 || '';
    if (expectedSha) {
      const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
      const hashHex = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, '0')).join('');
      if (hashHex !== expectedSha) {
        throw new Error('Downloaded backup SHA-256 checksum failed. Do not use this file.');
      }
    }

    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = first.filename || backup.filename || `unique-infotech-cms-backup-${backup.backupId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function renderPreview() {
    if (!preview) return;
    $('md-preview').hidden = false;
    $('md-preview-total').textContent = `${fmtInt(preview.documentCount)} records / ${fmtInt(preview.fileCount)} files`;
    $('md-preview-date').textContent = new Date(preview.createdAt).toLocaleString();
    $('md-preview-size').textContent = fmtBytes(preview.sizeBytes);
    $('md-preview-id').textContent = preview.backupId;
    $('md-preview-sha').textContent = preview.sha256;

    const tbody = $('md-preview-counts');
    tbody.textContent = '';
    for (const [key, count] of Object.entries(preview.counts || {})) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = getCollectionLabel(key);
      const td2 = document.createElement('td');
      td2.className = 'num';
      td2.textContent = fmtInt(count);
      tr.append(td1, td2);
      tbody.appendChild(tr);
    }

    const curState = $('md-preview-current');
    if (preview.recoveryMode) {
      curState.className = 'md-alert md-alert-warning';
      curState.textContent = 'Recovery mode active: a previous restore may be partial. Restoring this validated backup will replace that state after lock cooldown.';
    } else if (preview.currentDocumentCount > 0 || preview.currentFileCount > 0) {
      curState.className = 'md-alert md-alert-danger';
      curState.textContent = `BLOCKED: Live database currently has ${fmtInt(preview.currentDocumentCount)} records and ${fmtInt(preview.currentFileCount)} Storage files. Run Master Delete above first until both are 0.`;
    } else {
      curState.className = 'md-alert md-alert-success';
      curState.textContent = 'Live database is clean (0 records, 0 Storage files). Ready to restore.';
    }

    const warnEl = $('md-preview-warning');
    warnEl.textContent = `Restore replaces the entire CMS state using exact document IDs, receipt numbers, counters, student files, and ${getRoleTitle('branch_head')}/${getRoleTitle('school_head')} users. ${getRoleTitle('superadmin')} login always remains untouched.`
      + (preview.orphanCount ? ` Notice: ${preview.orphanCount} parentless student subcollection records were found in this backup and will be preserved exactly.` : '');

    renderQuotaBox('md-restore-quota', 'restore', preview.currentDocumentCount, preview.documentCount);
    updateActionButtons();
  }

  async function onCreateBackup() {
    if (busy || !unlocked) return;
    bumpActivity();
    setBusy(true);
    clearStatusMessage();
    showStatusMessage('Creating full server backup and running read-back checksum verification...', 'info');
    try {
      await initDatasetSession();
      const current = await refreshStatus();
      const result = await callFn('createCmsBackup', {
        expectedGeneration: current.generation || getDatasetGeneration()
      });
      if (!result.ok) throw new Error(result.message || 'Backup failed.');
      await refreshStatus();
      await downloadBackup(result.backup);
      const t = result.metrics ? ` (${result.metrics.durationMs} ms, RSS ${result.metrics.endRssMiB} MiB)` : '';
      showStatusMessage(`Backup created, SHA-256 verified, and downloaded${t}.`, 'success');
      showToast({ type: 'success', message: 'Full backup downloaded and verified.' });
    } catch (err) {
      if (handleReauthError(err)) return;
      showStatusMessage((err.message || 'Backup failed.') + ' Refresh status to check if a partial record exists.', 'danger');
    } finally {
      setBusy(false);
      if (unlocked) refreshStatus().catch(() => {});
    }
  }

  async function onValidateBackup() {
    if (busy || !unlocked) return;
    bumpActivity();
    const file = $('md-backup-file')?.files?.[0];
    if (!file || file.size <= 0 || file.size > MAX_BYTES || !file.name.toLowerCase().endsWith('.json')) {
      showStatusMessage('Select a valid .json backup file (up to 95 MiB).', 'warning');
      return;
    }
    const uid = auth.currentUser?.uid;
    if (!uid) {
      lock('Session lost. Re-enter password.');
      return;
    }

    setBusy(true);
    clearStatusMessage();
    try {
      await cleanupSelection();
      setProgress(20, 'Preparing backup file for server verification...');
      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const gzBytes = await gzipBytes(rawBytes);
      const useGzip = !!(gzBytes && gzBytes.length <= 6 * 1024 * 1024);

      if (useGzip || rawBytes.length <= 6 * 1024 * 1024) {
        const encoding = useGzip ? 'gzip-base64' : 'utf8-base64';
        const dataBase64 = bytesToBase64(useGzip ? gzBytes : rawBytes);
        setProgress(65, 'Uploading compressed backup and verifying checksum on server...');
        preview = await callFn('validateCmsBackup', {
          action: 'stage-validate',
          fileName: file.name,
          encoding,
          dataBase64
        });
        incomingPath = preview.storagePath || '';
      } else {
        incomingPath = `system-backups/${uid}/incoming-${crypto.randomUUID()}.json`;
        const task = uploadBytesResumable(storageRef(storage, incomingPath), file, {
          contentType: 'application/json',
          cacheControl: 'private, no-store'
        });
        await new Promise((resolve, reject) => {
          task.on(
            'state_changed',
            (snap) => {
              const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 85) : 10;
              setProgress(pct, `Uploading backup for server verification (${pct}%)...`);
            },
            reject,
            resolve
          );
        });
        setProgress(95, 'Verifying checksum, format, paths, and manifest registration on server...');
        preview = await callFn('validateCmsBackup', { storagePath: incomingPath });
      }

      renderPreview();
      showStatusMessage('Backup validated cleanly. Review the record breakdown and warnings below before restoring.', 'success');
    } catch (err) {
      await cleanupSelection();
      if (handleReauthError(err)) return;
      showStatusMessage(err.message || 'Backup validation failed. No live data was changed.', 'danger');
    } finally {
      setProgress(null, '');
      setBusy(false);
    }
  }

  async function onDestructive(mode) {
    if (busy || !unlocked) return;
    bumpActivity();
    updateActionButtons();
    const btnId = mode === 'clear' ? 'md-clear-btn' : 'md-restore-btn';
    if ($(btnId)?.disabled) return;

    const confirmText = mode === 'clear'
      ? `MASTER DELETE: All CMS students, photos/docs, payments, bills, enrolments, counters, courses, batches, sessions, branches, org details, ${getRolePluralTitle('branch_head')} & ${getRoleTitle('school_head')}, and Storage files will be permanently deleted after creating a safety backup. Your ${getRoleTitle('superadmin')} login and saved backups stay safe. Continue?`
      : 'RESTORE BACKUP: All validated records, counters, and files from this snapshot will be written live with their original IDs and receipt numbers. Continue?';

    if (!window.confirm(confirmText)) return;

    setBusy(true);
    clearStatusMessage();
    showStatusMessage(
      mode === 'clear'
        ? 'Creating pre-delete safety backup, deleting all business records, and verifying empty database. Keep this page open...'
        : 'Restoring records and files from validated backup and verifying integrity. Keep this page open...',
      'warning'
    );

    try {
      const current = await refreshStatus();
      const payload = mode === 'clear'
        ? {
            expectedGeneration: current.generation,
            confirmation: 'DELETE ALL DATA'
          }
        : {
            expectedGeneration: current.generation,
            confirmation: 'RESTORE',
            storagePath: incomingPath,
            expectedSha256: preview.sha256
          };

      const result = await callFn(mode === 'clear' ? 'clearCmsData' : 'restoreCmsBackup', payload);
      const t = result.metrics ? ` (${result.metrics.durationMs} ms, RSS ${result.metrics.endRssMiB} MiB)` : '';
      showStatusMessage(
        (result.message || '') + t + (result.ok ? ' Click "Reload page" to refresh cached app state.' : ''),
        result.ok ? 'success' : 'danger'
      );

      if (result.ok) {
        if (mode === 'clear') {
          $('md-clear-ack').checked = false;
          $('md-clear-confirm').value = '';
        } else {
          incomingPath = '';
          $('md-backup-file').value = '';
          resetPreview();
        }
        const reloadBtn = $('md-reload-btn');
        if (reloadBtn) reloadBtn.hidden = false;
        if (typeof onDatasetMutated === 'function') onDatasetMutated(mode);
        showToast({ type: 'success', message: mode === 'clear' ? 'Master Delete completed.' : 'Restore completed.' });
      }
    } catch (err) {
      if (handleReauthError(err)) return;
      showStatusMessage((err.message || 'Operation failed.') + ' Refresh recovery status before retrying.', 'danger');
      const reloadBtn = $('md-reload-btn');
      if (reloadBtn) reloadBtn.hidden = false;
    } finally {
      setBusy(false);
      if (unlocked) refreshStatus().catch(() => {});
    }
  }

  async function onUnlockSubmit(ev) {
    ev.preventDefault();
    const pwEl = $('md-gate-pw');
    const ackEl = $('md-gate-ack');
    const errEl = $('md-gate-err');
    const unlockBtn = $('md-gate-unlock');
    if (!pwEl || !ackEl || !unlockBtn) return;

    const password = pwEl.value;
    if (!password || !ackEl.checked) return;

    const user = auth.currentUser;
    if (!user || !user.email) {
      lock('No active password session found. Please sign in again.');
      return;
    }

    unlockBtn.disabled = true;
    unlockBtn.textContent = 'Verifying password...';
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }

    try {
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
      await user.getIdToken(true);
      await initDatasetSession();

      pwEl.value = '';
      pwEl.type = 'password';
      unlocked = true;
      unlockedAt = Date.now();

      $('md-gate').hidden = true;
      $('md-workspace').hidden = false;

      clearLockTimers();
      bumpActivity();
      hardTimer = setTimeout(() => {
        lock('Password verification window expired (12 minutes). Re-enter your password to continue.');
      }, UNLOCK_HARD_MS);

      if (typeof onLockChange === 'function') onLockChange(true);
      clearStatusMessage();
      await refreshStatus();
      updateActionButtons();
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (err) {
      const code = err && err.code ? err.code : '';
      let msg = 'Password verification failed. Check your password and try again.';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        msg = `Incorrect ${getRoleTitle('superadmin')} password.`;
      } else if (code === 'auth/too-many-requests') {
        msg = 'Too many incorrect password attempts. Wait a few minutes before retrying.';
      } else if (err && err.message) {
        msg = err.message;
      }
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = msg;
      }
    } finally {
      unlockBtn.innerHTML = '<i data-lucide="unlock"></i><span>Verify Password &amp; Open Manage Data</span>';
      updateGateButton();
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }

  function applyRoleTitles() {
    const saTitle = getRoleTitle('superadmin');
    const bhTitle = getRoleTitle('branch_head');
    const shTitle = getRoleTitle('school_head');
    const dangerLabel = $('md-danger-label');
    if (dangerLabel) {
      const span = dangerLabel.querySelector('span');
      if (span) span.textContent = `DANGER ZONE · ${saTitle.toUpperCase()} ONLY`;
    }
    const intro = $('md-gate-intro');
    if (intro) {
      intro.textContent = `Manage Data controls full database backups, permanent Master Delete, and system restores. Re-enter your ${saTitle} password and confirm the risk notice to unlock.`;
    }
    const riskHeads = $('md-risk-heads');
    if (riskHeads) {
      riskHeads.textContent = '';
      const strong = document.createElement('strong');
      strong.textContent = 'Master Delete';
      riskHeads.append(strong, ` permanently deletes all students, photos/docs, payments, bills, enrolments, counters, courses, batches, sessions, branches, org details, ${bhTitle}/${shTitle} users, and Storage files.`);
    }
    const riskSurv = $('md-risk-survives');
    if (riskSurv) {
      riskSurv.textContent = '';
      const strong = document.createElement('strong');
      strong.textContent = `Your ${saTitle} access survives`;
      riskSurv.append(strong, ' Master Delete and Restore, and saved backups remain private in Storage.');
    }
    const pwLabel = $('md-gate-pw-label');
    if (pwLabel) pwLabel.textContent = `${saTitle} Password`;
    const clearScope = $('md-clear-scope');
    if (clearScope) {
      clearScope.textContent = '';
      const s1 = document.createElement('strong');
      s1.textContent = 'PERMANENT DELETION SCOPE:';
      const s2 = document.createElement('strong');
      s2.textContent = 'Preserves:';
      clearScope.append(
        s1,
        ` Deletes students (Youth & Kids), photos/docs/signatures/Aadhaar, payments, bills, enrolments, waivers, breaks, transfers, deletion logs, counters, courses, levels, batches, sessions, branches, org config, ${bhTitle}/${shTitle} users, and business Storage files. `,
        s2,
        ` ${saTitle} login & saved backups.`
      );
    }
    if (preview) renderPreview();
  }

  function wire() {
    if (!profile || profile.role !== 'superadmin') return;

    applyRoleTitles();
    window.addEventListener('uic:branding-updated', applyRoleTitles);

    const emailNote = $('md-gate-email');
    if (emailNote) emailNote.textContent = auth.currentUser?.email || profile.email || '';

    const gateForm = $('md-gate-form');
    if (gateForm) gateForm.addEventListener('submit', onUnlockSubmit);

    const pwToggle = $('md-gate-pw-toggle');
    if (pwToggle) {
      pwToggle.addEventListener('click', () => {
        const pw = $('md-gate-pw');
        if (!pw) return;
        pw.type = pw.type === 'password' ? 'text' : 'password';
        pwToggle.innerHTML = pw.type === 'password'
          ? '<i data-lucide="eye"></i>'
          : '<i data-lucide="eye-off"></i>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      });
    }

    $('md-gate-pw')?.addEventListener('input', updateGateButton);
    $('md-gate-ack')?.addEventListener('change', updateGateButton);
    $('md-lock-btn')?.addEventListener('click', () => lock());
    $('md-refresh-btn')?.addEventListener('click', () => {
      bumpActivity();
      refreshStatus().catch((e) => {
        if (!handleReauthError(e)) showStatusMessage(e.message || 'Could not refresh status.', 'danger');
      });
    });
    $('md-reload-btn')?.addEventListener('click', () => location.reload());
    $('md-create-backup-btn')?.addEventListener('click', onCreateBackup);
    $('md-validate-btn')?.addEventListener('click', onValidateBackup);
    $('md-cancel-file-btn')?.addEventListener('click', async () => {
      if (busy) return;
      bumpActivity();
      await cleanupSelection();
      const inp = $('md-backup-file');
      if (inp) inp.value = '';
      updateActionButtons();
    });
    $('md-backup-file')?.addEventListener('change', () => {
      bumpActivity();
      resetPreview();
    });
    $('md-clear-btn')?.addEventListener('click', () => onDestructive('clear'));
    $('md-restore-btn')?.addEventListener('click', () => onDestructive('restore'));

    for (const id of ['md-clear-ack', 'md-clear-confirm', 'md-restore-ack', 'md-restore-confirm']) {
      $(id)?.addEventListener('input', () => {
        bumpActivity();
        updateActionButtons();
      });
      $(id)?.addEventListener('change', () => {
        bumpActivity();
        updateActionButtons();
      });
    }

    const ws = $('md-workspace');
    if (ws) {
      ['pointerdown', 'keydown'].forEach((evt) => {
        ws.addEventListener(evt, bumpActivity, { passive: true });
      });
    }

    lock();
  }

  function destroy() {
    destroyed = true;
    window.removeEventListener('uic:branding-updated', applyRoleTitles);
    clearLockTimers();
    if (unlocked) lock();
  }

  return {
    wire,
    lock,
    destroy,
    isUnlocked: () => unlocked,
    isBusy: () => busy,
    unlockedAt: () => unlockedAt
  };
}
