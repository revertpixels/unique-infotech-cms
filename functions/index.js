const crypto = require('crypto');
const { beforeUserSignedIn, HttpsError } = require('firebase-functions/v2/identity');
const { onCall, HttpsError: HttpsCallError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { createService } = require('./lib/backup-service');

admin.initializeApp({
  storageBucket: 'unique-infotech-cms.firebasestorage.app'
});

const db = getFirestore();
const bucket = getStorage().bucket();
const backupService = createService({ db, bucket });

/**
 * Blocking Cloud Function: beforeUserSignedIn
 *
 * Runs BEFORE sign-in completes in Firebase Authentication.
 * If the user attempts to sign in via Google (google.com) AND the Firestore document
 * `users/{lowercase email}` has `role === 'superadmin'`, this function blocks the
 * sign-in before tokens are issued and prevents linking/overriding of the password credential.
 *
 * Region: asia-south1 (matches Firestore database region).
 */
exports.beforeUserSignedIn = beforeUserSignedIn({ region: 'asia-south1' }, async (event) => {
  const user = event.data;
  const credential = event.credential;
  const additionalUserInfo = event.additionalUserInfo;

  // Identify sign-in provider
  const signInProvider = credential?.signInMethod ||
                         credential?.providerId ||
                         additionalUserInfo?.providerId ||
                         (user && user.providerData && user.providerData[0]?.providerId) ||
                         '';

  const isGoogle = signInProvider === 'google.com' ||
                   credential?.providerId === 'google.com' ||
                   credential?.signInMethod === 'google.com' ||
                   additionalUserInfo?.providerId === 'google.com';

  if (isGoogle && user && user.email) {
    const email = user.email.toLowerCase().trim();
    const userDoc = await db.collection('users').doc(email).get();

    if (userDoc.exists && userDoc.data()?.role === 'superadmin') {
      throw new HttpsError('permission-denied', 'SUPERADMIN_PASSWORD_ONLY');
    }
  }

  return {};
});

const CALLABLE_OPTS = {
  region: 'asia-south1',
  timeoutSeconds: 540,
  memory: '512MiB',
  minInstances: 0,
  maxInstances: 1,
  concurrency: 1
};

for (const name of [
  'createCmsBackup',
  'clearCmsData',
  'restoreCmsBackup',
  'validateCmsBackup',
  'downloadCmsBackup',
  'getCmsBackupStatus'
]) {
  exports[name] = onCall(CALLABLE_OPTS, backupService[name]);
}

const PHOTO_FN_OPTS = {
  region: 'asia-south1',
  timeoutSeconds: 60,
  memory: '256MiB',
  minInstances: 0,
  maxInstances: 2,
  concurrency: 10
};

function isValidAvatarMagic(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (mime === 'image/webp') {
    return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (mime === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  return false;
}

/**
 * Authenticated profile photo uploader/remover fallback when direct Storage
 * cross-service Firestore rules cannot evaluate cleanly for non-superadmin heads.
 * Enforces identical rules: Super Admin (password) for any target, or active
 * verified Google head for their own lowercased email folder only (<= 350 KB WebP/JPEG).
 */
exports.saveUserProfilePhoto = onCall(PHOTO_FN_OPTS, async (request) => {
  const token = request.auth && request.auth.token;
  if (!request.auth || !token || !token.email) {
    throw new HttpsCallError('unauthenticated', 'Sign-in is required.');
  }

  const callerEmail = String(token.email).trim().toLowerCase();
  const signInProvider = token.firebase && token.firebase.sign_in_provider;
  const emailVerified = token.email_verified === true;
  const targetEmail = String((request.data && request.data.targetEmail) || '').trim().toLowerCase();

  if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail) || targetEmail.includes('/')) {
    throw new HttpsCallError('invalid-argument', 'A valid target email is required.');
  }

  const isSuperAdmin = signInProvider === 'password' && callerEmail === 'haranathsaha1@gmail.com';
  if (!isSuperAdmin) {
    if (signInProvider !== 'google.com' || !emailVerified || targetEmail !== callerEmail) {
      throw new HttpsCallError('permission-denied', 'You can only update your own profile photo.');
    }
    const callerSnap = await db.collection('users').doc(callerEmail).get();
    const callerData = callerSnap.exists ? callerSnap.data() : null;
    const okRole = callerData && (callerData.role === 'branch_head' || callerData.role === 'school_head');
    if (!callerData || callerData.status !== 'active' || !okRole) {
      throw new HttpsCallError('permission-denied', 'Account is not authorised or active.');
    }
  }

  const prefix = `user-photos/${targetEmail}/`;
  const oldPath = String((request.data && request.data.oldPath) || '').trim();
  const remove = Boolean(request.data && request.data.remove === true);

  if (remove) {
    if (oldPath && oldPath.startsWith(prefix)) {
      await bucket.file(oldPath).delete({ ignoreNotFound: true }).catch(() => {});
    }
    return { photoUrl: '' };
  }

  const mime = String((request.data && request.data.mime) || '').trim().toLowerCase();
  if (mime !== 'image/webp' && mime !== 'image/jpeg') {
    throw new HttpsCallError('invalid-argument', 'Unsupported image format.');
  }

  const rawBase64 = String((request.data && request.data.base64) || '').trim();
  if (!rawBase64) {
    throw new HttpsCallError('invalid-argument', 'Image payload is required.');
  }

  const buffer = Buffer.from(rawBase64, 'base64');
  if (!buffer.length || buffer.length > 350 * 1024) {
    throw new HttpsCallError('invalid-argument', 'Image must be 350 KB or smaller.');
  }
  if (!isValidAvatarMagic(buffer, mime)) {
    throw new HttpsCallError('invalid-argument', 'Invalid image file data.');
  }

  const ext = mime === 'image/jpeg' ? 'jpg' : 'webp';
  const filePath = `${prefix}avatar_${Date.now()}.${ext}`;
  const downloadToken = crypto.randomUUID();

  await bucket.file(filePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: mime,
      cacheControl: 'public,max-age=31536000',
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    }
  });

  if (oldPath && oldPath.startsWith(prefix) && oldPath !== filePath) {
    await bucket.file(oldPath).delete({ ignoreNotFound: true }).catch(() => {});
  }

  const photoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${downloadToken}`;
  return { photoUrl };
});
