const { beforeUserSignedIn, HttpsError } = require('firebase-functions/v2/identity');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

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
