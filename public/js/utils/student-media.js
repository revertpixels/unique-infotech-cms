// Shared student photo, document source, and display normalization helpers.
// Used identically across live CMS pages, receipts, photo preloading, and offline Archives.

import { formatPersonName, formatGenderDisplay } from './formatter.js?v=1.8.188';

const DOC_KEY_ALIASES = {
  photo: ['photo', 'passportPhoto', 'passport_photo', 'studentPhoto', 'avatar', 'profilePhoto', 'image', 'pic'],
  signature: ['signature', 'studentSignature', 'student_signature', 'sig', 'sign'],
  dobProof: ['dobProof', 'dob_proof', 'dob', 'birthCertificate', 'ageProof'],
  aadhaar: ['aadhaar', 'aadhaarCard', 'aadhar', 'aadhaar_card', 'idProof', 'id_proof'],
  marksheet: ['marksheet', 'mark_sheet', 'academicMarksheet', 'certificate', 'lastMarksheet']
};

/**
 * Extracts a usable image/PDF src (data:, https:, blob:, /, or normalized base64)
 * from any student doc payload or string. Never returns boolean flags like "true".
 */
export function getStudentDocSrc(docEntry, defaultMime = 'image/jpeg') {
  if (!docEntry) return '';
  if (typeof docEntry === 'string') {
    const clean = docEntry.trim();
    if (!clean || clean === 'true' || clean === 'false' || clean === '-' || clean === 'null' || clean === 'undefined') {
      return '';
    }
    if (/^(data:|https?:\/\/|blob:|\/|files\/)/i.test(clean)) {
      return clean;
    }
    // Raw base64 payload stored without data: prefix
    if (clean.length >= 32 && /^[A-Za-z0-9+/=\s]+$/.test(clean)) {
      const compact = clean.replace(/\s+/g, '');
      const isPdf = compact.startsWith('JVBERi0');
      const isPng = compact.startsWith('iVBORw');
      const mime = isPdf ? 'application/pdf' : (isPng ? 'image/png' : (defaultMime || 'image/jpeg'));
      return `data:${mime};base64,${compact}`;
    }
    return '';
  }
  if (typeof docEntry !== 'object') return '';

  const mimeHint = getStudentDocMime(docEntry, defaultMime);
  const candidates = [
    docEntry.data,
    docEntry.dataUrl,
    docEntry.Data,
    docEntry.url,
    docEntry.downloadUrl,
    docEntry.downloadURL,
    docEntry.src,
    docEntry.fileUrl,
    docEntry.imageUrl,
    docEntry.thumbUrl,
    docEntry.base64,
    docEntry.content
  ];
  for (const cand of candidates) {
    const resolved = getStudentDocSrc(cand, mimeHint);
    if (resolved) return resolved;
  }
  // Archive/local asset paths stored in .path
  if (typeof docEntry.path === 'string') {
    const pClean = docEntry.path.trim();
    if (/^(data:|https?:\/\/|blob:|\/|files\/)/i.test(pClean)) {
      return pClean;
    }
  }
  return '';
}

/**
 * Infers MIME type from stored doc metadata, data: URL prefix, or file extension.
 */
export function getStudentDocMime(docEntry, fallbackMime = 'image/jpeg') {
  if (!docEntry) return fallbackMime;
  if (typeof docEntry === 'string') {
    const m = /^data:([^;]+);/i.exec(docEntry.trim());
    if (m) return m[1].toLowerCase();
    if (/\.pdf(\?|$)/i.test(docEntry)) return 'application/pdf';
    if (/\.png(\?|$)/i.test(docEntry)) return 'image/png';
    if (/\.webp(\?|$)/i.test(docEntry)) return 'image/webp';
    return fallbackMime;
  }
  const explicit = String(docEntry.type || docEntry.mime || docEntry.contentType || '').trim().toLowerCase();
  if (explicit.includes('/')) return explicit;
  const raw = docEntry.data || docEntry.dataUrl || docEntry.url || docEntry.downloadUrl || docEntry.src || '';
  if (typeof raw === 'string') {
    const m = /^data:([^;]+);/i.exec(raw.trim());
    if (m) return m[1].toLowerCase();
  }
  const nm = String(docEntry.name || docEntry.path || '').toLowerCase();
  if (nm.endsWith('.pdf')) return 'application/pdf';
  if (nm.endsWith('.png')) return 'image/png';
  if (nm.endsWith('.webp')) return 'image/webp';
  if (nm.endsWith('.gif')) return 'image/gif';
  return fallbackMime;
}

/**
 * Normalizes a docs collection (Map, Object, or Array) and retrieves the record matching `key`
 * (checking exact ID, case-insensitive key, documented aliases, and `.key`/`.docType` fields).
 */
export function getStudentDocRecord(docs, key, student = null) {
  const aliases = (DOC_KEY_ALIASES[key] || [key]).map((x) => String(x).toLowerCase());
  const matchesKey = (candKey, itemObj) => {
    const kNorm = String(candKey || '').trim().toLowerCase();
    if (kNorm && aliases.includes(kNorm)) return true;
    if (itemObj && typeof itemObj === 'object') {
      const iKey = String(itemObj.key || itemObj.docType || itemObj.field || itemObj.id || '').trim().toLowerCase();
      if (iKey && aliases.includes(iKey)) return true;
      const lbl = String(itemObj.label || '').trim().toLowerCase();
      if (key === 'photo' && (lbl.includes('photo') || lbl.includes('passport'))) return true;
      if (key === 'signature' && lbl.includes('signature')) return true;
    }
    return false;
  };

  if (Array.isArray(docs)) {
    for (const item of docs) {
      if (!item) continue;
      if (matchesKey(item.id || item.key, item) && getStudentDocSrc(item)) return item;
    }
    for (const item of docs) {
      if (item && matchesKey(item.id || item.key, item)) return item;
    }
  } else if (docs instanceof Map) {
    for (const [k, v] of docs.entries()) {
      if (matchesKey(k, v) && getStudentDocSrc(v)) {
        return typeof v === 'string' ? { id: key, key, data: v } : Object.assign({ id: k }, v);
      }
    }
  } else if (docs && typeof docs === 'object') {
    for (const alias of (DOC_KEY_ALIASES[key] || [key])) {
      if (Object.prototype.hasOwnProperty.call(docs, alias)) {
        const val = docs[alias];
        if (getStudentDocSrc(val)) {
          return typeof val === 'string' ? { id: key, key, data: val } : Object.assign({ id: alias }, val);
        }
      }
    }
    for (const [k, v] of Object.entries(docs)) {
      if (matchesKey(k, v) && getStudentDocSrc(v)) {
        return typeof v === 'string' ? { id: key, key, data: v } : Object.assign({ id: k }, v);
      }
    }
  }

  // Fallback to inline student.docs[key] when it holds a real URL/object (ignore boolean flags)
  if (student && student.docs && typeof student.docs === 'object' && !Array.isArray(student.docs)) {
    for (const alias of (DOC_KEY_ALIASES[key] || [key])) {
      const inlineVal = student.docs[alias];
      if (getStudentDocSrc(inlineVal)) {
        return typeof inlineVal === 'string' ? { id: key, key, data: inlineVal } : Object.assign({ id: alias }, inlineVal);
      }
    }
  }
  return null;
}

/**
 * Shared single source of truth for resolving a student's photo across all live CMS screens,
 * popups, receipts, and offline archives. Returns empty string only when no photo exists.
 */
export function getStudentPhotoSrc(student, docs) {
  const fromDoc = getStudentDocSrc(getStudentDocRecord(docs, 'photo', student), 'image/jpeg');
  if (fromDoc) return fromDoc;

  if (!student || typeof student !== 'object') return '';
  const directFields = [
    student._photoPath,
    student.photoUrl,
    student.photoDataUrl,
    student.photo,
    student.avatarUrl,
    student.avatar,
    student.imageUrl,
    student.image,
    student.profilePhoto,
    student.passportPhoto
  ];
  for (const val of directFields) {
    const resolved = getStudentDocSrc(val, 'image/jpeg');
    if (resolved) return resolved;
  }
  return '';
}

/**
 * Formats student / guardian / centre display names consistently in Title Case
 * while keeping short branch codes intact when embedded and leaving stored Firestore data untouched.
 */
export function formatDisplayTitle(value, fallback = '') {
  const out = formatPersonName(value);
  return out || fallback;
}

export { formatPersonName, formatGenderDisplay };
