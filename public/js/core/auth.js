import { auth, db } from '../config/firebase-config.js';
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  setPersistence,
  browserSessionPersistence,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

export function mapAuthError(err) {
  const code = err && err.code ? err.code : '';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'Incorrect current password.';
  }
  if (code === 'auth/weak-password') {
    return 'Password is too weak. Use at least 8 characters with letters and numbers.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (code === 'auth/requires-recent-login') {
    return 'For security, please sign out and sign in again before changing your password.';
  }
  if (code === 'auth/user-not-found') {
    return 'No email/password account matches that address.';
  }
  if (code === 'auth/invalid-email') {
    return 'Enter a valid email address.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network problem. Check your internet connection and try again.';
  }
  return (err && err.message) ? err.message : 'Authentication request failed. Please try again.';
}

export async function changeSuperAdminPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user || !user.email) {
    const err = new Error('No active user session.');
    err.code = 'auth/requires-recent-login';
    throw err;
  }
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

export async function sendResetEmailForUser(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) {
    const err = new Error('Email is required.');
    err.code = 'auth/invalid-email';
    throw err;
  }
  await sendPasswordResetEmail(auth, clean);
}

export async function signInWithPassword(email, password) {
  await setPersistence(auth, browserSessionPersistence);
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  const user = cred.user;

  // 1. Email verification (main protection for Super Admin)
  if (user && !user.emailVerified) {
    const sessionKey = 'email_verification_sent_' + (user.email || user.uid);
    try {
      if (!sessionStorage.getItem(sessionKey)) {
        await sendEmailVerification(user);
        sessionStorage.setItem(sessionKey, 'true');
      }
    } catch (err) {
      console.warn('[auth] sendEmailVerification error:', err);
    }
    try {
      sessionStorage.setItem('pending_verification_notice', 'Please open the verification email we sent and click the link.');
    } catch (_) {}
  }

  return user;
}

export async function signInWithGoogle() {
  await setPersistence(auth, browserSessionPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutUser() {
  return signOut(auth);
}

export async function resolveSession(user) {
  const email = user.email.toLowerCase();
  let tokenResult;
  try {
    tokenResult = await user.getIdTokenResult();
  } catch {
    return { ok: false, reason: 'network' };
  }
  const method = tokenResult.signInProvider;
  let data;
  try {
    const snap = await getDoc(doc(db, 'users', email));
    if (!snap.exists()) {
      return { ok: false, reason: 'not-authorised' };
    }
    data = snap.data();
  } catch (err) {
    if (err && err.code === 'unavailable') {
      return { ok: false, reason: 'network' };
    }
    return { ok: false, reason: 'not-authorised' };
  }
  if (data.status !== 'active') {
    return { ok: false, reason: 'disabled' };
  }
  if (data.role === 'superadmin') {
    // Super Admin must NEVER be able to sign in with Google or any non-password method
    if (method === 'google.com' || method !== 'password') {
      return { ok: false, reason: 'superadmin-password-only' };
    }
  } else if (data.role === 'branch_head' || data.role === 'school_head') {
    if (method !== 'google.com') {
      return { ok: false, reason: 'wrong-method-head' };
    }
  } else {
    return { ok: false, reason: 'not-authorised' };
  }
  return {
    ok: true,
    profile: {
      email,
      name: data.name || '',
      designation: data.designation || '',
      photoUrl: data.photoUrl || '',
      phone: data.phone || '',
      role: data.role,
      branchId: data.branchId || null
    }
  };
}
