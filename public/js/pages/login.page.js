import { signInWithPassword, signInWithGoogle, signOutUser, resolveSession } from '../core/auth.js';
import { auth } from '../config/firebase-config.js';

const URL_REASONS = {
  timeout: true,
  signedout: true,
  'not-authorised': true,
  disabled: true,
  'wrong-method-admin': true,
  'wrong-method-head': true,
  network: true
};

const MESSAGES = {
  timeout: 'You were signed out because of inactivity.',
  signedout: 'You have been signed out.',
  'not-authorised': 'This account is not authorised to use this system. Please contact the Super Admin.',
  disabled: 'This account has been disabled. Please contact the Super Admin.',
  'wrong-method-admin': 'The Super Admin must sign in with email and password.',
  'wrong-method-head': 'Branch and School Heads must sign in with Google.',
  network: 'Network problem. Check your internet connection and try again.',
  'bad-credentials': 'Incorrect email or password.',
  empty: 'Enter your email and password.',
  'too-many': 'Too many attempts. Please wait a few minutes and try again.',
  'popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  generic: 'Sign-in failed. Please try again.'
};

const tabAdmin = document.getElementById('tab-admin');
const tabHead = document.getElementById('tab-head');
const panelAdmin = document.getElementById('panel-admin');
const panelHead = document.getElementById('panel-head');
const adminForm = document.getElementById('admin-form');
const adminSubmit = document.getElementById('admin-submit');
const googleBtn = document.getElementById('google-btn');
const togglePw = document.getElementById('toggle-pw');
const adminPw = document.getElementById('admin-password');
const msg = document.getElementById('login-msg');
const msgIcon = document.getElementById('login-msg-icon');
const msgText = document.getElementById('login-msg-text');

let running = false;

function showMessage(key) {
  const text = MESSAGES[key] || '';
  msgText.textContent = text;
  msg.className = 'msg ' + (key === 'timeout' || key === 'signedout' ? 'info' : 'error');
  msgIcon.replaceChildren();
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', key === 'timeout' || key === 'signedout' ? 'info' : 'alert-circle');
  msgIcon.appendChild(icon);
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
  msg.hidden = false;
}

function hideMessage() {
  msg.hidden = true;
}

function setRunning(isRunning) {
  running = isRunning;
  adminSubmit.disabled = isRunning;
  googleBtn.disabled = isRunning;
  if (isRunning) {
    adminSubmit.classList.add('loading');
  } else {
    adminSubmit.classList.remove('loading');
  }
}

function switchTab(activeAdmin) {
  if (activeAdmin) {
    tabAdmin.setAttribute('aria-selected', 'true');
    tabHead.setAttribute('aria-selected', 'false');
    panelAdmin.hidden = false;
    panelAdmin.setAttribute('aria-hidden', 'false');
    panelHead.hidden = true;
    panelHead.setAttribute('aria-hidden', 'true');
  } else {
    tabAdmin.setAttribute('aria-selected', 'false');
    tabHead.setAttribute('aria-selected', 'true');
    panelAdmin.hidden = true;
    panelAdmin.setAttribute('aria-hidden', 'true');
    panelHead.hidden = false;
    panelHead.setAttribute('aria-hidden', 'false');
  }
  hideMessage();
}

tabAdmin.addEventListener('click', () => switchTab(true));
tabHead.addEventListener('click', () => switchTab(false));

togglePw.addEventListener('click', () => {
  if (adminPw.type === 'password') {
    adminPw.type = 'text';
    togglePw.querySelector('i').setAttribute('data-lucide', 'eye-off');
  } else {
    adminPw.type = 'password';
    togglePw.querySelector('i').setAttribute('data-lucide', 'eye');
  }
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
});

async function handleAuthResult(user) {
  const result = await resolveSession(user);
  if (result.ok) {
    location.replace('/index.html');
    return;
  }
  await signOutUser();
  showMessage(result.reason);
}

adminForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (running) return;
  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;
  if (!email || !password) {
    showMessage('empty');
    return;
  }
  hideMessage();
  setRunning(true);
  try {
    const user = await signInWithPassword(email, password);
    await handleAuthResult(user);
  } catch (err) {
    const code = err && err.code ? err.code : '';
    let reason;
    if (code === 'auth/invalid-credential' || code === 'auth/invalid-email' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      reason = 'bad-credentials';
    } else if (code === 'auth/too-many-requests') {
      reason = 'too-many';
    } else if (code === 'auth/network-request-failed') {
      reason = 'network';
    } else {
      reason = 'generic';
    }
    showMessage(reason);
  } finally {
    setRunning(false);
  }
});

googleBtn.addEventListener('click', async () => {
  if (running) return;
  hideMessage();
  setRunning(true);
  try {
    const user = await signInWithGoogle();
    await handleAuthResult(user);
  } catch (err) {
    const code = err && err.code ? err.code : '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      // show nothing
    } else if (code === 'auth/popup-blocked') {
      showMessage('popup-blocked');
    } else if (code === 'auth/network-request-failed') {
      showMessage('network');
    } else {
      showMessage('generic');
    }
  } finally {
    setRunning(false);
  }
});

(async () => {
  lucide.createIcons();
  const params = new URLSearchParams(location.search);
  const reason = params.get('reason');
  if (reason && URL_REASONS[reason]) {
    showMessage(reason);
  }
  await auth.authStateReady();
  if (auth.currentUser) {
    const result = await resolveSession(auth.currentUser);
    if (result.ok) {
      location.replace('/index.html');
    } else {
      await signOutUser();
      showMessage(result.reason);
    }
  }
})();
