import { auth, db } from '../config/firebase-config.js';
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  setPersistence,
  browserSessionPersistence,
  sendEmailVerification
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

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
      role: data.role,
      branchId: data.branchId || null
    }
  };
}
