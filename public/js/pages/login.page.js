import {
  signInWithPassword,
  signInWithGoogle,
  signOutUser,
  resolveSession,
  sendResetEmailForUser,
  mapAuthError
} from '../core/auth.js?v=1.8.173';
import { preloadLoginSound, playLoginSound, stopLoginSound } from '../utils/sound.js?v=1.8.173';
import { getRoleTitle, getRolePluralTitle, getPublicBranding, loadPublicBranding } from '../services/user-directory.service.js?v=1.8.173';

const URL_REASONS = {
  timeout: true,
  signedout: true,
  'not-authorised': true,
  disabled: true,
  'wrong-method-admin': true,
  'wrong-method-head': true,
  'superadmin-password-only': true,
  network: true
};

function getLoginMessage(key) {
  const saTitle = getRoleTitle('superadmin');
  const bhPlural = getRolePluralTitle('branch_head');
  const shTitle = getRoleTitle('school_head');
  const messages = {
    timeout: 'You were signed out because of inactivity.',
    signedout: 'You have been signed out.',
    'not-authorised': `This account is not authorised to use this system. Please contact the ${saTitle}.`,
    disabled: `This account has been disabled. Please contact the ${saTitle}.`,
    'wrong-method-admin': `This account is a ${saTitle}. Please sign in on the ${saTitle} tab with your email and password. Google sign-in is not allowed for this account.`,
    'superadmin-password-only': `This account is a ${saTitle}. Please sign in on the ${saTitle} tab with your email and password. Google sign-in is not allowed for this account.`,
    'wrong-method-head': `${bhPlural} and ${shTitle} must sign in with Google.`,
    network: 'Network problem. Check your internet connection and try again.',
    'bad-credentials': 'Incorrect email or password.',
    empty: 'Enter your email and password.',
    'too-many': 'Too many attempts. Please wait a few minutes and try again.',
    'popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
    generic: 'Sign-in failed. Please try again.'
  };
  return messages[key] || '';
}

const LOGIN_MARKUP = `
  <div class="login-card">
    <img src="/assets/images/logo-192.jpg" alt="Logo" width="72" height="72">
    <h1>Sign in</h1>
    <p class="subtitle">Choose how you sign in</p>

    <div role="tablist" class="tabs">
      <button role="tab" aria-selected="true" id="tab-admin">Admin</button>
      <button role="tab" aria-selected="false" id="tab-head">Staff</button>
    </div>

    <section id="panel-admin" class="panel" aria-hidden="false">
      <form id="admin-form" novalidate>
        <div class="field">
          <label for="admin-email">Email</label>
          <input type="email" id="admin-email" autocomplete="username" required class="input">
        </div>
        <div class="field">
          <label for="admin-password">Password</label>
          <div class="pw-wrap">
            <input type="password" id="admin-password" autocomplete="current-password" required class="input">
            <button type="button" class="icon-btn" id="toggle-pw" aria-label="Show password">
              <i data-lucide="eye"></i>
            </button>
          </div>
        </div>
        <button type="submit" id="admin-submit" class="btn pri full">
          <i data-lucide="log-in"></i> Sign in
        </button>
        <div class="login-forgot-row">
          <button type="button" id="admin-forgot" class="login-forgot-btn">Forgot password?</button>
        </div>
      </form>
    </section>

    <section id="panel-head" class="panel" hidden aria-hidden="true">
      <p class="head-hint" id="head-hint"></p>
      <button type="button" id="google-btn" class="btn pri full">
        <i data-lucide="log-in"></i> Continue with Google
      </button>
    </section>

    <div id="login-msg" class="msg" role="alert" aria-live="polite" hidden>
      <span id="login-msg-icon" aria-hidden="true"></span>
      <span id="login-msg-text"></span>
    </div>
  </div>
`;

/**
 * Mounts the sign-in UI directly inside the persistent app shell so audio
 * started on sign-in keeps playing seamlessly across transition into Dashboard.
 */
export function renderLoginView(container, { reason = '', onAuthenticated } = {}) {
  if (!container) return { unmount() {} };
  container.innerHTML = LOGIN_MARKUP;
  container.hidden = false;

  const tabAdmin = container.querySelector('#tab-admin');
  const tabHead = container.querySelector('#tab-head');
  const headHint = container.querySelector('#head-hint');
  const panelAdmin = container.querySelector('#panel-admin');
  const panelHead = container.querySelector('#panel-head');
  const adminForm = container.querySelector('#admin-form');
  const adminEmail = container.querySelector('#admin-email');
  const adminSubmit = container.querySelector('#admin-submit');
  const adminForgot = container.querySelector('#admin-forgot');
  const googleBtn = container.querySelector('#google-btn');
  const togglePw = container.querySelector('#toggle-pw');
  const adminPw = container.querySelector('#admin-password');
  const msg = container.querySelector('#login-msg');
  const msgIcon = container.querySelector('#login-msg-icon');
  const msgText = container.querySelector('#login-msg-text');

  let running = false;
  let active = true;
  let activeMessageKey = '';

  function applyBrandingTitles() {
    const saTitle = getRoleTitle('superadmin');
    const bhTitle = getRoleTitle('branch_head');
    const bhPlural = getRolePluralTitle('branch_head');
    const shTitle = getRoleTitle('school_head');
    if (tabAdmin) tabAdmin.textContent = saTitle;
    if (tabHead) tabHead.textContent = `${bhTitle} / ${shTitle}`;
    if (headHint) headHint.textContent = `${bhPlural} and ${shTitle} sign in with their Google account.`;
    const branding = getPublicBranding();
    if (branding && branding.orgName) {
      document.title = `Sign in - ${branding.orgName}`;
    }
    if (activeMessageKey && msg && !msg.hidden && msgText) {
      msgText.textContent = getLoginMessage(activeMessageKey);
    }
  }

  function showMessage(keyOrOpts) {
    const isKey = typeof keyOrOpts === 'string';
    activeMessageKey = isKey ? keyOrOpts : '';
    const opts = isKey
      ? {
          type: (keyOrOpts === 'timeout' || keyOrOpts === 'signedout') ? 'info' : 'error',
          text: getLoginMessage(keyOrOpts)
        }
      : (keyOrOpts || {});
    const text = opts.text || '';
    if (!text) return;
    const tone = opts.type === 'info' || opts.type === 'success' ? 'info' : 'error';
    msgText.textContent = text;
    msg.className = 'msg ' + tone;
    msgIcon.replaceChildren();
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', tone === 'info' ? 'check-circle' : 'alert-circle');
    msgIcon.appendChild(icon);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    msg.hidden = false;
  }

  function hideMessage() {
    activeMessageKey = '';
    msg.hidden = true;
  }

  applyBrandingTitles();
  loadPublicBranding({ timeoutMs: 1500, notify: false }).then(() => {
    if (active) applyBrandingTitles();
  }).catch(() => {});

  function setRunning(isRunning) {
    running = isRunning;
    adminSubmit.disabled = isRunning;
    if (adminForgot) adminForgot.disabled = isRunning;
    googleBtn.disabled = isRunning;
    adminSubmit.classList.toggle('loading', isRunning);
  }

  function switchTab(activeAdmin) {
    tabAdmin.setAttribute('aria-selected', String(activeAdmin));
    tabHead.setAttribute('aria-selected', String(!activeAdmin));
    panelAdmin.hidden = !activeAdmin;
    panelAdmin.setAttribute('aria-hidden', String(!activeAdmin));
    panelHead.hidden = activeAdmin;
    panelHead.setAttribute('aria-hidden', String(activeAdmin));
    hideMessage();
  }

  tabAdmin.addEventListener('click', () => switchTab(true));
  tabHead.addEventListener('click', () => switchTab(false));

  togglePw.addEventListener('click', () => {
    if (adminPw.type === 'password') {
      adminPw.type = 'text';
      togglePw.innerHTML = '<i data-lucide="eye-off"></i>';
    } else {
      adminPw.type = 'password';
      togglePw.innerHTML = '<i data-lucide="eye"></i>';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  });

  if (adminForgot) {
    adminForgot.addEventListener('click', async () => {
      if (running) return;
      const email = (adminEmail?.value || '').trim();
      if (!email) {
        showMessage({ type: 'error', text: `Enter your ${getRoleTitle('superadmin')} email above first, then click Forgot password.` });
        if (adminEmail) adminEmail.focus();
        return;
      }
      hideMessage();
      setRunning(true);
      try {
        await sendResetEmailForUser(email);
        if (active) {
          showMessage({
            type: 'info',
            text: `Password reset email sent to ${email}. Check your inbox and spam folder.`
          });
        }
      } catch (err) {
        if (active) {
          showMessage({
            type: 'error',
            text: mapAuthError(err, 'Could not send password reset email.')
          });
        }
      } finally {
        if (active) setRunning(false);
      }
    });
  }

  async function handleAuthResult(user) {
    const result = await resolveSession(user);
    if (!active) return;
    if (result.ok) {
      if (adminPw) adminPw.value = '';
      if (typeof onAuthenticated === 'function') {
        await onAuthenticated(result.profile);
      } else {
        location.replace('/index.html');
      }
      return;
    }
    stopLoginSound();
    await signOutUser().catch(() => {});
    if (active) showMessage(result.reason);
  }

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (running) return;
    const email = (adminEmail?.value || '').trim();
    const password = adminPw?.value || '';
    if (!email || !password) {
      showMessage('empty');
      return;
    }
    hideMessage();
    setRunning(true);
    playLoginSound();
    try {
      const user = await signInWithPassword(email, password);
      await handleAuthResult(user);
    } catch (err) {
      stopLoginSound();
      const code = err && err.code ? err.code : '';
      let errReason;
      if (code === 'auth/invalid-credential' || code === 'auth/invalid-email' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        errReason = 'bad-credentials';
      } else if (code === 'auth/too-many-requests') {
        errReason = 'too-many';
      } else if (code === 'auth/network-request-failed') {
        errReason = 'network';
      } else {
        errReason = 'generic';
      }
      if (active) showMessage(errReason);
    } finally {
      if (active) setRunning(false);
    }
  });

  googleBtn.addEventListener('click', async () => {
    if (running) return;
    hideMessage();
    setRunning(true);
    playLoginSound();
    try {
      const user = await signInWithGoogle();
      await handleAuthResult(user);
    } catch (err) {
      stopLoginSound();
      const code = err && err.code ? err.code : '';
      const errDetails = ((err && err.message) || '') + ' ' + ((err && err.code) || '') + ' ' + JSON.stringify((err && err.customData) || '');
      if (!active) return;
      if (errDetails.includes('SUPERADMIN_PASSWORD_ONLY') || code === 'auth/blocking-cloud-function-error') {
        showMessage('superadmin-password-only');
      } else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        // user closed popup cleanly
      } else if (code === 'auth/popup-blocked') {
        showMessage('popup-blocked');
      } else if (code === 'auth/network-request-failed') {
        showMessage('network');
      } else {
        showMessage('generic');
      }
    } finally {
      if (active) setRunning(false);
    }
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
  preloadLoginSound();
  if (reason && URL_REASONS[reason]) {
    showMessage(reason);
  }

  return {
    unmount() {
      active = false;
      container.textContent = '';
      container.hidden = true;
    }
  };
}
