import { deleteApp, initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  clearIndexedDbPersistence,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';

// These web config values are public identifiers; security is enforced by Firestore and Storage rules.
const firebaseConfig = {
  apiKey: "AIzaSyBD80jBVjpPLHNN_NrZpx7rogMpWK0oMKY",
  authDomain: "unique-infotech-cms.firebaseapp.com",
  projectId: "unique-infotech-cms",
  storageBucket: "unique-infotech-cms.firebasestorage.app",
  messagingSenderId: "169148743700",
  appId: "1:169148743700:web:b14fd8310bc1a5083f6701"
};

// If a multi-tab logout could not wipe IndexedDB persistence immediately, clear it BEFORE
// initializing persistent cache, auth, or restoring any session on this start. Use a disposable
// app instance so terminating for cleanup never leaves the live exported `db` terminated.
if (typeof localStorage !== 'undefined' && localStorage.getItem('uic_pending_idb_clear') === '1') {
  let cleanupApp = null;
  try {
    cleanupApp = initializeApp(firebaseConfig);
    const cleanupDb = getFirestore(cleanupApp);
    await terminate(cleanupDb).catch(() => {});
    await clearIndexedDbPersistence(cleanupDb);
    localStorage.removeItem('uic_pending_idb_clear');
  } catch (err) {
    console.warn('[firebase-config] Deferred clearIndexedDbPersistence failed:', err && err.code ? err.code : err);
  } finally {
    if (cleanupApp) await deleteApp(cleanupApp).catch(() => {});
  }
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (err) {
  firestoreDb = getFirestore(app);
}
export const db = firestoreDb;
export const storage = getStorage(app);
