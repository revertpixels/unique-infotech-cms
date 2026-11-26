import { formatPersonName } from '../utils/formatter.js?v=1.8.168';
import { resolveUserDisplay } from '../services/user-directory.service.js?v=1.8.168';

let dashProfileCleanup = null;

export function mount({ container, profile }) {
  unmount();
  const el = document.getElementById('dash-greeting');
  function updateGreeting() {
    if (!el) return;
    const disp = resolveUserDisplay(profile?.email, profile?.name, profile?.designation);
    const nameText = disp.name || formatPersonName(profile?.name || profile?.email) || profile?.email || '';
    el.textContent = 'Welcome, ' + nameText;
  }
  updateGreeting();
  const onUpdate = () => updateGreeting();
  window.addEventListener('uic:profile-updated', onUpdate);
  window.addEventListener('uic:users-updated', onUpdate);
  dashProfileCleanup = () => {
    window.removeEventListener('uic:profile-updated', onUpdate);
    window.removeEventListener('uic:users-updated', onUpdate);
  };
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

export function unmount() {
  if (dashProfileCleanup) {
    dashProfileCleanup();
    dashProfileCleanup = null;
  }
}
