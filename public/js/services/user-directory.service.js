import { app, auth, db, storage } from '../config/firebase-config.js';
import {
  collection,
  doc,
  getDoc,
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
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js';
import { formatPersonName } from '../utils/formatter.js?v=1.8.197';

const DEFAULT_ROLE_TITLES = {
  superadmin: 'Super Admin',
  branch_head: 'Branch Head',
  school_head: 'School Computer Head'
};

function ensureUsersCache() {
  window.APP_CACHE = window.APP_CACHE || {};
  if (!window.APP_CACHE.usersByEmail || typeof window.APP_CACHE.usersByEmail !== 'object') {
    window.APP_CACHE.usersByEmail = {};
  }
  if (!Array.isArray(window.APP_CACHE.usersList)) {
    window.APP_CACHE.usersList = [];
  }
  if (!window.APP_CACHE.branding || typeof window.APP_CACHE.branding !== 'object') {
    window.APP_CACHE.branding = {
      superAdminTitle: '',
      branchHeadTitle: '',
      schoolHeadTitle: '',
      orgName: ''
    };
  }
  return window.APP_CACHE;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function defaultDesignationForRole(role) {
  return DEFAULT_ROLE_TITLES[role] || 'Staff';
}

export function pluralizeRoleTitle(title) {
  const s = String(title || '').trim();
  if (!s) return 'Users';
  const parts = s.split(/\s+/);
  const last = parts[parts.length - 1];
  const lower = last.toLowerCase();
  if (lower === 'staff' || lower === 'faculty' || /s$/i.test(lower)) {
    return s;
  }
  let pluralLast;
  if (/[^aeiou]y$/i.test(last)) {
    pluralLast = last.slice(0, -1) + 'ies';
  } else if (/(x|z|ch|sh)$/i.test(last)) {
    pluralLast = last + 'es';
  } else {
    pluralLast = last + 's';
  }
  parts[parts.length - 1] = pluralLast;
  return parts.join(' ');
}

function deriveBrandingFromUsersList(usersList = []) {
  const cache = ensureUsersCache();
  const b = { ...cache.branding };
  const findDesig = (role) => {
    const active = usersList.find((u) => u.role === role && u.status === 'active' && u.designation);
    if (active) return active.designation;
    const any = usersList.find((u) => u.role === role && u.designation);
    return any ? any.designation : '';
  };
  if (!b.superAdminTitle) b.superAdminTitle = findDesig('superadmin');
  if (!b.branchHeadTitle) b.branchHeadTitle = findDesig('branch_head');
  if (!b.schoolHeadTitle) b.schoolHeadTitle = findDesig('school_head');
  if (!b.orgName && cache.org && cache.org.orgName) b.orgName = cache.org.orgName;
  cache.branding = b;
}

function applyBrandingCache(next = {}, { notify = false } = {}) {
  const cache = ensureUsersCache();
  const prev = cache.branding;
  const merged = {
    superAdminTitle: next.superAdminTitle !== undefined ? String(next.superAdminTitle || '').trim() : prev.superAdminTitle,
    branchHeadTitle: next.branchHeadTitle !== undefined ? String(next.branchHeadTitle || '').trim() : prev.branchHeadTitle,
    schoolHeadTitle: next.schoolHeadTitle !== undefined ? String(next.schoolHeadTitle || '').trim() : prev.schoolHeadTitle,
    orgName: next.orgName !== undefined ? String(next.orgName || '').trim() : prev.orgName
  };
  cache.branding = merged;
  if (notify && typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('uic:branding-updated', { detail: getPublicBranding() }));
  }
  return getPublicBranding();
}

/**
 * Single source of truth for a role's display title:
 * uses Authorised Users / public branding designation first, then default fallback only.
 */
export function getRoleTitle(role) {
  const cache = ensureUsersCache();
  const b = cache.branding || {};
  if (role === 'superadmin') {
    const fromUsers = (cache.usersList || []).find((u) => u.role === 'superadmin' && u.designation)?.designation;
    const raw = b.superAdminTitle || fromUsers || DEFAULT_ROLE_TITLES.superadmin;
    return formatPersonName(raw) || DEFAULT_ROLE_TITLES.superadmin;
  }
  if (role === 'branch_head') {
    const fromUsers = (cache.usersList || []).find((u) => u.role === 'branch_head' && u.designation)?.designation;
    const raw = b.branchHeadTitle || fromUsers || DEFAULT_ROLE_TITLES.branch_head;
    return formatPersonName(raw) || DEFAULT_ROLE_TITLES.branch_head;
  }
  if (role === 'school_head') {
    const fromUsers = (cache.usersList || []).find((u) => u.role === 'school_head' && u.designation)?.designation;
    const raw = b.schoolHeadTitle || fromUsers || DEFAULT_ROLE_TITLES.school_head;
    return formatPersonName(raw) || DEFAULT_ROLE_TITLES.school_head;
  }
  return 'Staff';
}

export function getRolePluralTitle(role) {
  return pluralizeRoleTitle(getRoleTitle(role));
}

/**
 * Resolves the display designation/title for a user:
 * user's own designation -> role's Authorised Users designation -> default fallback.
 */
export function getUserTitle(userOrEmail, fallbackRole = '') {
  if (userOrEmail && typeof userOrEmail === 'object') {
    const live = userOrEmail.email ? getUserFromDirectory(userOrEmail.email) : null;
    const ownDesig = (live && live.designation) || String(userOrEmail.designation || '').trim();
    if (ownDesig) return formatPersonName(ownDesig) || ownDesig;
    const role = (live && live.role) || userOrEmail.role || fallbackRole;
    return role ? getRoleTitle(role) : 'Staff';
  }
  const key = normalizeEmail(userOrEmail);
  const live = key ? getUserFromDirectory(key) : null;
  if (live && live.designation) return formatPersonName(live.designation) || live.designation;
  const role = (live && live.role) || fallbackRole;
  return role ? getRoleTitle(role) : 'Staff';
}

export function getPublicBranding() {
  const cache = ensureUsersCache();
  return {
    superAdminTitle: getRoleTitle('superadmin'),
    branchHeadTitle: getRoleTitle('branch_head'),
    schoolHeadTitle: getRoleTitle('school_head'),
    orgName: (cache.branding && cache.branding.orgName) || (cache.org && cache.org.orgName) || 'Unique Infotech'
  };
}

/**
 * Fetches `/public/branding` safely with a short timeout so the login screen
 * never blocks or fails if offline or unseeded.
 */
export async function loadPublicBranding({ timeoutMs = 1500, notify = true } = {}) {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'public', 'branding')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
    ]);
    if (snap && typeof snap.exists === 'function' && snap.exists()) {
      const d = snap.data() || {};
      return applyBrandingCache({
        superAdminTitle: d.superAdminTitle || '',
        branchHeadTitle: d.branchHeadTitle || '',
        schoolHeadTitle: d.schoolHeadTitle || '',
        orgName: d.orgName || ''
      }, { notify });
    }
  } catch (_) {
    // Non-fatal: login & screens smoothly use cached or default titles
  }
  return getPublicBranding();
}

/**
 * Writes clean public role titles and org name (zero PII) to `/public/branding`
 * whenever Authorised Users designations or Organisation Details change.
 */
export async function syncPublicBranding(overrides = {}) {
  const cache = ensureUsersCache();
  const prev = cache.branding || {};
  const next = {
    superAdminTitle: overrides.superAdminTitle !== undefined
      ? String(overrides.superAdminTitle || '').trim() || DEFAULT_ROLE_TITLES.superadmin
      : (prev.superAdminTitle || getRoleTitle('superadmin')),
    branchHeadTitle: overrides.branchHeadTitle !== undefined
      ? String(overrides.branchHeadTitle || '').trim() || DEFAULT_ROLE_TITLES.branch_head
      : (prev.branchHeadTitle || getRoleTitle('branch_head')),
    schoolHeadTitle: overrides.schoolHeadTitle !== undefined
      ? String(overrides.schoolHeadTitle || '').trim() || DEFAULT_ROLE_TITLES.school_head
      : (prev.schoolHeadTitle || getRoleTitle('school_head')),
    orgName: overrides.orgName !== undefined
      ? String(overrides.orgName || '').trim()
      : ((cache.org && cache.org.orgName) || prev.orgName || 'Unique Infotech')
  };
  applyBrandingCache(next, { notify: true });
  try {
    await setDoc(doc(db, 'public', 'branding'), {
      ...next,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn('[user-directory] syncPublicBranding warning:', err && err.code ? err.code : err);
  }
  return getPublicBranding();
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
    displayDesignation: formatPersonName(desigRaw || getRoleTitle(role)),
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
    deriveBrandingFromUsersList(list);
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
  window.APP_CACHE.branding = {
    superAdminTitle: '',
    branchHeadTitle: '',
    schoolHeadTitle: '',
    orgName: ''
  };
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
 * falling back cleanly to role branding and then snapshot fields if user doc is absent.
 */
export function resolveUserDisplay(email, fallbackName = '', fallbackDesignation = '') {
  const key = normalizeEmail(email);
  const live = key ? getUserFromDirectory(key) : null;
  const fallbackNameClean = String(fallbackName || '').trim();
  const rawName = (live && live.name) || fallbackNameClean || key || '-';
  const name = rawName === '-' ? '-' : (formatPersonName(rawName) || rawName);

  const fallbackDesigClean = String(fallbackDesignation || '').trim();
  const rawDesignation = (live && live.designation)
    || (live && live.role ? getRoleTitle(live.role) : '')
    || fallbackDesigClean;
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

  // Keep live role title cache synced immediately on designation updates
  if ('designation' in patch && merged.designation) {
    if (merged.role === 'superadmin') applyBrandingCache({ superAdminTitle: merged.designation }, { notify: true });
    else if (merged.role === 'branch_head') applyBrandingCache({ branchHeadTitle: merged.designation }, { notify: true });
    else if (merged.role === 'school_head') applyBrandingCache({ schoolHeadTitle: merged.designation }, { notify: true });
  }

  const isCurrent = syncCurrentProfile(merged);
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('uic:users-updated', { detail: { email: key, user: merged } }));
    if (isCurrent) {
      window.dispatchEvent(new CustomEvent('uic:profile-updated', { detail: { email: key, profile: cache.currentUser } }));
    }
  }
  return merged;
}

/**
 * Updates allowed fields on `/users/{email}` and automatically keeps `/public/branding`
 * synced when designations change.
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
  const updated = updateCachedUser(key, localPatch);

  if (('designation' in fields || create) && updated && updated.designation) {
    const brandingPatch = {};
    if (updated.role === 'superadmin') brandingPatch.superAdminTitle = updated.designation;
    else if (updated.role === 'branch_head') brandingPatch.branchHeadTitle = updated.designation;
    else if (updated.role === 'school_head') brandingPatch.schoolHeadTitle = updated.designation;
    if (Object.keys(brandingPatch).length) {
      await syncPublicBranding(brandingPatch);
    }
  }
  return updated;
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

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result || '');
      const commaIdx = res.indexOf(',');
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read cropped image.'));
    reader.readAsDataURL(blob);
  });
}

async function callProfilePhotoFn(payload) {
  const fns = getFunctions(app, 'asia-south1');
  const fn = httpsCallable(fns, 'saveUserProfilePhoto');
  const res = await fn(payload);
  return res && res.data ? res.data : {};
}

/**
 * Uploads or removes a square avatar in Storage under `/user-photos/{lowercased-email}/...`
 * and updates ONLY `photoUrl` + `updatedAt` on `/users/{email}`.
 */
export async function saveOwnPhoto(email, { blob = null, mime = 'image/webp', remove = false } = {}) {
  const key = normalizeEmail(email);
  if (!key) throw new Error('User email is required.');

  const callerEmail = normalizeEmail(auth && auth.currentUser ? auth.currentUser.email : '');
  const isSelfCaller = Boolean(callerEmail && callerEmail === key);
  const existing = getUserFromDirectory(key);
  const oldPath = existing ? extractStoragePathFromUrl(existing.photoUrl) : '';
  let nextUrl = '';
  let usedCallableFallback = false;

  if (!remove) {
    if (!blob) throw new Error('No cropped image ready to upload.');
    const ext = mime === 'image/jpeg' ? 'jpg' : 'webp';
    const path = `user-photos/${key}/avatar_${Date.now()}.${ext}`;
    const refObj = storageRef(storage, path);
    try {
      await uploadBytes(refObj, blob, {
        contentType: mime,
        cacheControl: 'public,max-age=31536000'
      });
      nextUrl = await getDownloadURL(refObj);
    } catch (uploadErr) {
      if (uploadErr && uploadErr.code === 'storage/unauthorized' && isSelfCaller) {
        const base64 = await blobToBase64(blob);
        const fnRes = await callProfilePhotoFn({
          targetEmail: key,
          mime,
          base64,
          oldPath,
          remove: false
        });
        nextUrl = String(fnRes.photoUrl || '').trim();
        if (!nextUrl) throw uploadErr;
        usedCallableFallback = true;
      } else {
        throw uploadErr;
      }
    }
  }

  const userRef = doc(db, 'users', key);
  try {
    await updateDoc(userRef, {
      photoUrl: nextUrl,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    const cur = window.APP_CACHE && window.APP_CACHE.currentUser;
    if (err && err.code === 'not-found' && cur && cur.role === 'superadmin' && normalizeEmail(cur.email) === key) {
      await setDoc(userRef, {
        email: key,
        role: 'superadmin',
        status: 'active',
        name: cur.name || '',
        designation: cur.designation || getRoleTitle('superadmin'),
        photoUrl: nextUrl,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } else {
      throw err;
    }
  }

  if (!usedCallableFallback && oldPath && oldPath.startsWith(`user-photos/${key}/`)) {
    deleteObject(storageRef(storage, oldPath)).catch(() => {
      if (isSelfCaller) {
        callProfilePhotoFn({ targetEmail: key, remove: true, oldPath }).catch(() => {});
      }
    });
  }

  updateCachedUser(key, { photoUrl: nextUrl });
  return nextUrl;
}
