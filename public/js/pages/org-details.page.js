import { db } from '../config/firebase-config.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

function $(id) { return document.getElementById(id); }

function showMsg(text, isError) {
  const el = $('org-msg');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
  el.classList.toggle('is-ok', !isError);
}

function updateSidebarBrand(orgName, tagline) {
  const box = document.querySelector('.sb-brand .brand-txt');
  if (!box) return;
  const h3 = box.querySelector('h3');
  if (h3) h3.textContent = orgName;
  let p = box.querySelector('p');
  if (tagline) {
    if (!p) { p = document.createElement('p'); box.appendChild(p); }
    p.textContent = tagline;
  } else if (p) {
    p.remove();
  }
}

export async function mount({ profile }) {
  const form = $('org-form');
  const btn = $('org-save');
  if (!form || !btn) return;
  const ref = doc(db, 'settings', 'org_config');

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      $('org-name').value = d.orgName || '';
      $('org-tagline').value = d.tagline || '';
      $('org-phone').value = d.phone || '';
      $('org-address').value = d.address || '';
    }
  } catch (e) {
    console.error('[org] load failed', e);
    showMsg('Could not load organisation details (' + (e.code || 'error') + ').', true);
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const orgName = $('org-name').value.trim();
    const tagline = $('org-tagline').value.trim();
    const phone = $('org-phone').value.trim();
    const address = $('org-address').value.trim();
    if (!orgName) {
      showMsg('Institute name is required.', true);
      $('org-name').focus();
      return;
    }
    btn.disabled = true;
    showMsg('Saving...', false);
    try {
      await setDoc(ref, {
        orgName, tagline, phone, address,
        updatedAt: serverTimestamp(),
        updatedBy: (profile && profile.email) ? profile.email : ''
      }, { merge: true });
      window.APP_CACHE = window.APP_CACHE || {};
      window.APP_CACHE.org = Object.assign({}, window.APP_CACHE.org || {}, { orgName, tagline, phone, address });
      updateSidebarBrand(orgName, tagline);
      showMsg('Organisation saved.', false);
    } catch (e) {
      console.error('[org] save failed', e);
      showMsg('Save failed (' + (e.code || 'error') + ').', true);
    } finally {
      btn.disabled = false;
    }
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}
