import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
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

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
