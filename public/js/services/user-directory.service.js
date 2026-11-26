import { db, storage } from '../config/firebase-config.js';
import {
  collection,
  doc,
  getDocs,
  updateDoc,
  setDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
import { formatPersonName } from '../utils/formatter.js?v=1.8.164';

export const ROLE_LABELS = {
  superadmin: 'Super Admin',
  branch_head: 'Branch Head',
  school_head: 'School Computer Head'
};

export function defaultDesignationForRole(role) {
  return ROLE_LABELS[role] || 'Staff';
}

function ensureUsersCache() {
  window.APP_CACHE = window.APP_CACHE || {};
  if (!window.APP_CACHE.usersByEmail || typeof window.APP_CACHE.usersByEmail !== 'object') {
    window.APP_CACHE.usersByEmail = {};
  }
  if (!Array.isArray(window.APP_CACHE.usersList)) {
    window.APP_CACHE.usersList = [];
  }
  return window.APP_CACHE;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeUserRecord(raw = {}, docId = '') {
  const email = normalizeEmail(raw.email || docId);
  const role = raw.role || '';
  const nameRaw = String(raw.name || '').trim();
  const desigRaw = String(raw.designation || '').trim();
  return {
    ...raw,
    email,
    role,
    name: nameRaw,
    displayName: formatPersonName(nameRaw || email) || email,
    designation: desigRaw,
    displayDesignation: formatPersonName(desigRaw || defaultDesignationForRole(role)),
    photoUrl: String(raw.photoUrl || '').trim(),
    phone: String(raw.phone || '').trim(),
    branchId: raw.branchId || null,
    status: raw.status || 'active'
  };
}

function syncCurrentProfile(normalized) {
  const cur = window.APP_CACHE && window.APP_CACHE.currentUser;
  if (!cur || !normalized || normalizeEmail(cur.email) !== normalized.email) return false;
  cur.name = normalized.name || cur.name || '';
  cur.designation = normalized.designation || '';
  cur.photoUrl = normalized.photoUrl || '';
  cur.phone = normalized.phone || '';
  if (normalized.role) cur.role = normalized.role;
  return true;
}

/**
 * Loads the `/users` directory into `window.APP_CACHE.usersByEmail` and `usersList`
 * so every screen resolves user names, designations, and photos dynamically.
 */
export async function loadUsersDirectory({ forceRefresh = false } = {}) {
  const cache = ensureUsersCache();
  if (!forceRefresh && cache.usersLoaded && cache.usersList.length) {
    return { byEmail: cache.usersByEmail, list: cache.usersList };
  }
  try {
    const snap = await getDocs(collection(db, 'users'));
    const byEmail = {};
    const list = [];
    snap.forEach((d) => {
      const rec = normalizeUserRecord(d.data() || {}, d.id);
      if (!rec.email) return;
      byEmail[rec.email] = rec;
      list.push(rec);
      syncCurrentProfile(rec);
    });
    list.sort((a, b) => a.displayName.localeCompare(b.displayName));
    cache.usersByEmail = byEmail;
    cache.usersList = list;
    cache.usersLoaded = true;
    return { byEmail, list };
  } catch (err) {
    console.warn('[user-directory] loadUsersDirectory failed:', err && err.code ? err.code : err);
    return { byEmail: cache.usersByEmail, list: cache.usersList };
  }
}

export function clearUsersDirectoryCache() {
  if (!window.APP_CACHE) return;
  window.APP_CACHE.usersByEmail = {};
  window.APP_CACHE.usersList = [];
  window.APP_CACHE.usersLoaded = false;
}

export function getUserFromDirectory(email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  const cache = ensureUsersCache();
  if (cache.usersByEmail[key]) return cache.usersByEmail[key];
  const cur = cache.currentUser;
  if (cur && normalizeEmail(cur.email) === key) {
    return normalizeUserRecord(cur, key);
  }
  return null;
}

/**
 * Resolves live display name (Title Case), designation, and photo for any staff email,
 * falling back cleanly to recorded snapshot fields if the user doc is absent.
 */
export function resolveUserDisplay(email, fallbackName = '', fallbackDesignation = '') {
  const key = normalizeEmail(email);
  const live = key ? getUserFromDirectory(key) : null;
  const fallbackNameClean = String(fallbackName || '').trim();
  const rawName = (live && live.name) || fallbackNameClean || key || '-';
  const name = rawName === '-' ? '-' : (formatPersonName(rawName) || rawName);

  const fallbackDesigClean = String(fallbackDesignation || '').trim();
  const rawDesignation = (live && live.designation)
    || fallbackDesigClean
    || (live && live.role ? defaultDesignationForRole(live.role) : '');
  const designation = rawDesignation ? (formatPersonName(rawDesignation) || rawDesignation) : '';

  return {
    email: key,
    name,
    designation,
    photoUrl: (live && live.photoUrl) || '',
    role: (live && live.role) || '',
    branchId: (live && live.branchId) || null,
    status: (live && live.status) || '',
    found: Boolean(live)
  };
}

export function updateCachedUser(email, patch = {}) {
  const key = normalizeEmail(email);
  if (!key) return null;
  const cache = ensureUsersCache();
  const prev = cache.usersByEmail[key] || { email: key };
  const merged = normalizeUserRecord({ ...prev, ...patch, email: key }, key);
  cache.usersByEmail[key] = merged;

  const idx = cache.usersList.findIndex((u) => u.email === key);
  if (idx >= 0) cache.usersList[idx] = merged;
  else cache.usersList.push(merged);
  cache.usersList.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const isCurrent = syncCurrentProfile(merged);
  window.dispatchEvent(new CustomEvent('uic:users-updated', { detail: { email: key, user: merged } }));
  if (isCurrent) {
    window.dispatchEvent(new CustomEvent('uic:profile-updated', { detail: { email: key, profile: cache.currentUser } }));
  }
  return merged;
}

/**
 * Updates allowed fields on `/users/{email}` (Super Admin updating any staff doc,
 * or staff doc creation via merge when adding a head).
 */
export async function saveUserFields(email, fields = {}, { create = false } = {}) {
  const key = normalizeEmail(email);
  if (!key) throw new Error('Valid user email is required.');

  const payload = { updatedAt: serverTimestamp() };
  if ('name' in fields) {
    payload.name = formatPersonName(fields.name || '') || '';
  }
  if ('designation' in fields) {
    payload.designation = formatPersonName(fields.designation || '') || '';
  }
  if ('phone' in fields) {
    payload.phone = String(fields.phone || '').trim();
  }
  if ('photoUrl' in fields) {
    payload.photoUrl = String(fields.photoUrl || '').trim();
  }
  if ('status' in fields) {
    payload.status = (fields.status === 'inactive' || fields.status === 'disabled') ? 'inactive' : 'active';
  }
  if ('role' in fields) {
    payload.role = fields.role;
  }
  if ('branchId' in fields) {
    payload.branchId = fields.branchId || null;
  }

  const userRef = doc(db, 'users', key);
  if (create) {
    await setDoc(userRef, {
      ...payload,
      email: key,
      createdAt: serverTimestamp()
    }, { merge: true });
  } else {
    if (fields._ensureRequired && key) {
      payload.email = key;
      payload.role = fields._ensureRequired.role || 'superadmin';
      payload.status = fields._ensureRequired.status || 'active';
    }
    await updateDoc(userRef, payload);
  }

  const localPatch = { ...payload };
  delete localPatch.updatedAt;
  return updateCachedUser(key, localPatch);
}

function extractStoragePathFromUrl(url) {
  const str = String(url || '').trim();
  const match = str.match(/\/o\/([^?]+)/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return '';
  }
}

/**
 * Uploads or removes the signed-in user's square avatar in Storage under
 * `/user-photos/{email}/...` and updates ONLY `photoUrl` + `updatedAt` on `/users/{email}`.
 */
export async function saveOwnPhoto(email, { blob = null, mime = 'image/webp', remove = false } = {}) {
  const key = normalizeEmail(email);
  if (!key) throw new Error('User email is required.');

  const existing = getUserFromDirectory(key);
  const oldPath = existing ? extractStoragePathFromUrl(existing.photoUrl) : '';
  let nextUrl = '';

  if (!remove) {
    if (!blob) throw new Error('No cropped image ready to upload.');
    const ext = mime === 'image/jpeg' ? 'jpg' : 'webp';
    const path = `user-photos/${key}/avatar_${Date.now()}.${ext}`;
    const refObj = storageRef(storage, path);
    await uploadBytes(refObj, blob, {
      contentType: mime,
      cacheControl: 'public,max-age=31536000'
    });
    nextUrl = await getDownloadURL(refObj);
  }

  await updateDoc(doc(db, 'users', key), {
    photoUrl: nextUrl,
    updatedAt: serverTimestamp()
  });

  if (oldPath && oldPath.startsWith(`user-photos/${key}/`)) {
    deleteObject(storageRef(storage, oldPath)).catch(() => {});
  }

  updateCachedUser(key, { photoUrl: nextUrl });
  return nextUrl;
}
