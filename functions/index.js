const { beforeUserSignedIn, HttpsError } = require('firebase-functions/v2/identity');
const { onCall } = require('firebase-functions/v2/https');
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
