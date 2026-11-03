import { auth, db } from '../config/firebase-config.js';
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  setPersistence,
  browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

export async function signInWithPassword(email, password) {
  await setPersistence(auth, browserSessionPersistence);
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
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
    if (method !== 'password') {
      return { ok: false, reason: 'wrong-method-admin' };
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
