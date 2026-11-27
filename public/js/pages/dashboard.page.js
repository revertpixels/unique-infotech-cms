import { formatPersonName } from '../utils/formatter.js?v=1.8.177';
import { resolveUserDisplay } from '../services/user-directory.service.js?v=1.8.177';
import { getContext } from '../core/app.js?v=1.8.177';
import { loadDashboardArchiveReminder } from '../services/archive.service.js?v=1.8.177';

let dashProfileCleanup = null;

export function mount({ container, profile, ctx }) {
  unmount();
  const el = document.getElementById('dash-greeting');
  const remHost = document.getElementById('dash-archive-reminder');
  let alive = true;

  function updateGreeting() {
    if (!el) return;
    const disp = resolveUserDisplay(profile?.email, profile?.name, profile?.designation);
    const nameText = disp.name || formatPersonName(profile?.name || profile?.email) || profile?.email || '';
    el.textContent = 'Welcome, ' + nameText;
  }
  updateGreeting();

  async function updateArchiveReminder() {
    if (!remHost) return;
    const activeCtx = ctx || getContext();
    const canSeeArchives = activeCtx === 'youth' && (profile?.role === 'superadmin' || profile?.role === 'branch_head');
    if (!canSeeArchives) {
      remHost.hidden = true;
      remHost.innerHTML = '';
      return;
    }
    const rem = await loadDashboardArchiveReminder({ profile });
    if (!alive || !remHost) return;
    if (!rem || (rem.unarchivedCount === 0 && !rem.staleArchive)) {
      remHost.hidden = true;
      remHost.innerHTML = '';
      return;
    }

    const parts = [];
    if (rem.unarchivedCount > 0) {
      const names = rem.unarchivedNames.slice(0, 2).join(', ');
      const extra = rem.unarchivedNames.length > 2 ? ` +${rem.unarchivedNames.length - 2} more` : '';
      parts.push(`${rem.unarchivedCount} completed session${rem.unarchivedCount === 1 ? '' : 's'} not downloaded yet (${names}${extra}).`);
    }
    if (rem.staleArchive) {
      if (rem.daysSinceLast === null) {
        parts.push('No Youth archive downloaded yet.');
      } else {
        parts.push(`Last archive download was ${rem.daysSinceLast} days ago.`);
      }
    }

    remHost.hidden = false;
    remHost.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'arx-reminder' + (rem.unarchivedCount > 0 ? '' : ' is-info');

    const main = document.createElement('div');
    main.className = 'arx-reminder-main';
    const icBox = document.createElement('div');
    icBox.className = 'arx-reminder-ic';
    icBox.innerHTML = `<i data-lucide="${rem.unarchivedCount > 0 ? 'archive' : 'clock'}"></i>`;
    const txt = document.createElement('div');
    txt.className = 'arx-reminder-txt';
    const b = document.createElement('strong');
    b.textContent = 'Archive reminder: ';
    txt.append(b, document.createTextNode(parts.join(' ')));
    main.append(icBox, txt);

    const link = document.createElement('a');
    link.href = '#/archives';
    link.className = 'ui-btn ghost sm';
    link.textContent = 'Open Archives';

    box.append(main, link);
    remHost.appendChild(box);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  updateArchiveReminder();

  const onUpdate = () => updateGreeting();
  window.addEventListener('uic:profile-updated', onUpdate);
  window.addEventListener('uic:users-updated', onUpdate);
  dashProfileCleanup = () => {
    alive = false;
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
