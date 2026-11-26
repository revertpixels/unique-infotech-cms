import { auth } from '../config/firebase-config.js';
import { openPopup } from './modal.js?v=1.8.171';
import { showToast } from './toast.js?v=1.8.171';
import { confirmDialog } from './ui-confirm.js?v=1.8.171';
import { cropSquareAvatarToBlob, isImageFile, formatBytes } from '../utils/image-compress.js?v=1.8.171';
import { formatPersonName, initials } from '../utils/formatter.js?v=1.8.171';
import {
  getRoleTitle,
  getUserTitle,
  resolveUserDisplay,
  saveOwnPhoto,
  saveUserFields
} from '../services/user-directory.service.js?v=1.8.171';
import { changeSuperAdminPassword, mapAuthError } from '../core/auth.js?v=1.8.171';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeFieldInput({ id, label, type = 'text', value = '', placeholder = '', maxLength, required = false, icon = '' }) {
  const field = el('div', 'ui-field');
  const labelRow = el('div', 'ui-label-row');
  const lbl = document.createElement('label');
  lbl.htmlFor = id;
  lbl.textContent = label;
  if (required) {
    const star = document.createElement('em');
    star.textContent = ' *';
    lbl.appendChild(star);
  }
  labelRow.appendChild(lbl);

  const wrap = el('div', 'ui-input-wrap' + (icon ? '' : ' no-icon'));
  if (icon) {
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', icon);
    wrap.appendChild(ic);
  }
  const inp = document.createElement('input');
  inp.id = id;
  inp.type = type;
  inp.className = 'ui-input';
  inp.value = value;
  inp.placeholder = placeholder;
  if (maxLength) inp.maxLength = maxLength;
  wrap.appendChild(inp);

  field.append(labelRow, wrap);
  return { field, inp, wrap };
}

/**
 * Interactive square crop + zoom popup used by Topbar Profile and Super Admin Authorised Users.
 */
export function openPhotoCropModal({ email, name, currentPhotoUrl = '', onSaved } = {}) {
  let busy = false;
  let selectedFile = null;
  let decodedImg = null;
  let objectUrl = '';
  let zoom = 1;
  let fx = 0;
  let fy = 0;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let startFx = 0;
  let startFy = 0;

  const popup = openPopup({
    title: 'Profile Photo',
    subtitle: 'Crop a square headshot (compressed under 300 KB)',
    icon: 'camera',
    saving: () => busy,
    onClose: () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }
    }
  });

  const wrap = el('div', 'pm-crop-wrap');

  const stageRow = el('div', 'pm-crop-stage-row');
  const stage = el('div', 'pm-crop-stage');
  stage.setAttribute('aria-label', 'Square photo crop area. Drag image to position.');

  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 240;
  canvas.className = 'pm-crop-canvas';

  const placeholder = el('div', 'pm-crop-empty');
  if (currentPhotoUrl) {
    const curImg = document.createElement('img');
    curImg.src = currentPhotoUrl;
    curImg.alt = formatPersonName(name || email || 'User');
    placeholder.appendChild(curImg);
  } else {
    placeholder.appendChild(el('span', 'pm-crop-initials', initials(name || email || '?')));
  }

  const guide = el('div', 'pm-crop-guide');
  stage.append(placeholder, canvas, guide);

  const controls = el('div', 'pm-crop-controls');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif';
  fileInput.hidden = true;

  const pickBtn = el('button', 'ui-btn ghost');
  pickBtn.type = 'button';
  pickBtn.innerHTML = '<i data-lucide="upload"></i> Choose Image';
  pickBtn.addEventListener('click', () => fileInput.click());

  const fileMeta = el('div', 'pm-crop-meta', 'JPG, PNG or WebP. Drag preview to re-center.');

  const zoomGroup = el('div', 'pm-zoom-row');
  zoomGroup.hidden = true;
  const zoomLabel = el('label', 'pm-zoom-label', 'Zoom');
  const zoomInput = document.createElement('input');
  zoomInput.type = 'range';
  zoomInput.min = '1';
  zoomInput.max = '3';
  zoomInput.step = '0.05';
  zoomInput.value = '1';
  zoomInput.className = 'pm-zoom-slider';
  const zoomVal = el('span', 'pm-zoom-val', '1.0x');
  const resetBtn = el('button', 'ui-btn ghost pm-btn-sm', 'Center');
  resetBtn.type = 'button';

  zoomGroup.append(zoomLabel, zoomInput, zoomVal, resetBtn);
  controls.append(fileInput, pickBtn, fileMeta, zoomGroup);
  stageRow.append(stage, controls);
  wrap.appendChild(stageRow);

  const errBox = el('div', 'pm-inline-error');
  errBox.hidden = true;
  wrap.appendChild(errBox);

  const footer = el('div', 'pm-modal-actions');
  const removeBtn = el('button', 'ui-btn pm-btn-danger-outline');
  removeBtn.type = 'button';
  removeBtn.innerHTML = '<i data-lucide="trash-2"></i> Remove Photo';
  removeBtn.hidden = !currentPhotoUrl;

  const rightBtns = el('div', 'pm-modal-actions-right');
  const cancelBtn = el('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  const saveBtn = el('button', 'ui-btn primary');
  saveBtn.type = 'button';
  saveBtn.innerHTML = '<i data-lucide="check"></i> Save Photo';
  saveBtn.disabled = true;
  rightBtns.append(cancelBtn, saveBtn);
  footer.append(removeBtn, rightBtns);
  wrap.appendChild(footer);

  popup.container.appendChild(wrap);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  function drawPreview() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!decodedImg) {
      canvas.hidden = true;
      placeholder.hidden = false;
      guide.hidden = true;
      return;
    }
    canvas.hidden = false;
    placeholder.hidden = true;
    guide.hidden = false;

    const size = canvas.width;
    const nw = decodedImg.naturalWidth || decodedImg.width;
    const nh = decodedImg.naturalHeight || decodedImg.height;
    const baseScale = Math.max(size / nw, size / nh);
    const drawW = nw * baseScale * zoom;
    const drawH = nh * baseScale * zoom;
    const maxDx = Math.max(0, (drawW - size) / 2);
    const maxDy = Math.max(0, (drawH - size) / 2);
    const drawX = (size - drawW) / 2 + fx * maxDx;
    const drawY = (size - drawH) / 2 + fy * maxDy;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decodedImg, drawX, drawY, drawW, drawH);
  }

  drawPreview();

  function showError(msg) {
    errBox.textContent = msg;
    errBox.hidden = !msg;
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!isImageFile(file)) {
      showError('Please choose a JPG, PNG or WebP image file.');
      return;
    }
    showError('');
    selectedFile = file;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);

    const img = new Image();
    img.onload = () => {
      decodedImg = img;
      zoom = 1;
      fx = 0;
      fy = 0;
      zoomInput.value = '1';
      zoomVal.textContent = '1.0x';
      zoomGroup.hidden = false;
      saveBtn.disabled = false;
      stage.classList.add('has-image');
      fileMeta.textContent = `${file.name} (${formatBytes(file.size)}) — Drag image to position.`;
      drawPreview();
    };
    img.onerror = () => {
      showError('Could not read the selected image.');
    };
    img.src = objectUrl;
  });

  zoomInput.addEventListener('input', () => {
    zoom = Number(zoomInput.value) || 1;
    zoomVal.textContent = zoom.toFixed(1) + 'x';
    drawPreview();
  });

  resetBtn.addEventListener('click', () => {
    zoom = 1;
    fx = 0;
    fy = 0;
    zoomInput.value = '1';
    zoomVal.textContent = '1.0x';
    drawPreview();
  });

  stage.addEventListener('pointerdown', (e) => {
    if (!decodedImg) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startFx = fx;
    startFy = fy;
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!dragging || !decodedImg) return;
    const size = canvas.width;
    const nw = decodedImg.naturalWidth || decodedImg.width;
    const nh = decodedImg.naturalHeight || decodedImg.height;
    const baseScale = Math.max(size / nw, size / nh);
    const maxDx = Math.max(0, (nw * baseScale * zoom - size) / 2);
    const maxDy = Math.max(0, (nh * baseScale * zoom - size) / 2);
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (maxDx > 0) fx = Math.max(-1, Math.min(1, startFx + dx / maxDx));
    if (maxDy > 0) fy = Math.max(-1, Math.min(1, startFy + dy / maxDy));
    drawPreview();
  });

  const endDrag = () => { dragging = false; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  function setBusy(v, label) {
    busy = v;
    pickBtn.disabled = v;
    saveBtn.disabled = v || !selectedFile;
    removeBtn.disabled = v;
    cancelBtn.disabled = v;
    if (label) saveBtn.textContent = label;
  }

  cancelBtn.addEventListener('click', () => popup.close());

  saveBtn.addEventListener('click', async () => {
    if (busy || !selectedFile || !decodedImg) return;
    showError('');
    setBusy(true, 'Uploading...');
    try {
      const { blob, mime } = await cropSquareAvatarToBlob(decodedImg, { zoom, fx, fy }, { maxBytes: 300 * 1024, size: 512 });
      const isSelf = ((auth.currentUser?.email || '').toLowerCase() === String(email || '').trim().toLowerCase());
      const url = await saveOwnPhoto(email, { blob, mime, remove: false });
      showToast({
        type: 'success',
        title: 'Photo saved',
        message: isSelf ? 'Your profile photo has been updated.' : `${name || email}'s profile photo has been updated.`
      });
      busy = false;
      popup.close(true);
      if (typeof onSaved === 'function') onSaved(url);
    } catch (err) {
      showError(mapAuthError(err, 'Failed to upload profile photo. Please try again.'));
      setBusy(false);
      saveBtn.innerHTML = '<i data-lucide="check"></i> Save Photo';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  });

  removeBtn.addEventListener('click', async () => {
    if (busy) return;
    const isSelf = ((auth.currentUser?.email || '').toLowerCase() === String(email || '').trim().toLowerCase());
    const ok = await confirmDialog({
      title: 'Remove profile photo?',
      message: isSelf
        ? 'Your initials will be shown instead of your photo across the system.'
        : `${name || email}'s initials will be shown instead of their photo across the system.`,
      confirmText: 'Remove Photo',
      danger: true
    });
    if (!ok) return;
    showError('');
    setBusy(true, 'Removing...');
    try {
      await saveOwnPhoto(email, { remove: true });
      showToast({
        type: 'info',
        title: 'Photo removed',
        message: isSelf ? 'Profile photo cleared.' : `${name || email}'s profile photo has been cleared.`
      });
      busy = false;
      popup.close(true);
      if (typeof onSaved === 'function') onSaved('');
    } catch (err) {
      showError(mapAuthError(err, 'Failed to remove profile photo.'));
      setBusy(false);
    }
  });
}

/**
 * Opens "Change Password" popup for the Super Admin (re-authenticates before updating).
 */
export function openChangePasswordModal({ email } = {}) {
  let busy = false;
  const saTitle = getRoleTitle('superadmin');
  const popup = openPopup({
    title: 'Change Password',
    subtitle: email ? `Account: ${email}` : `${saTitle} account security`,
    icon: 'key-round',
    saving: () => busy
  });

  const form = el('form', 'pm-form');
  form.noValidate = true;

  function buildPwField(id, labelText, placeholder) {
    const field = el('div', 'ui-field');
    const row = el('div', 'ui-label-row');
    const lbl = el('label', '', labelText);
    lbl.htmlFor = id;
    row.appendChild(lbl);

    const wrap = el('div', 'ui-input-wrap pm-pw-wrap');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', 'lock');
    const inp = document.createElement('input');
    inp.type = 'password';
    inp.id = id;
    inp.className = 'ui-input';
    inp.placeholder = placeholder;
    inp.autocomplete = id === 'pm-pw-current' ? 'current-password' : 'new-password';
    const eyeBtn = el('button', 'pm-pw-eye');
    eyeBtn.type = 'button';
    eyeBtn.setAttribute('aria-label', 'Show password');
    eyeBtn.innerHTML = '<i data-lucide="eye"></i>';
    eyeBtn.addEventListener('click', () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      eyeBtn.innerHTML = show ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    });
    wrap.append(ic, inp, eyeBtn);
    field.append(row, wrap);
    return { field, inp };
  }

  const cur = buildPwField('pm-pw-current', 'Current password', 'Enter current password');
  const next = buildPwField('pm-pw-new', 'New password (min 8 characters)', 'At least 8 characters');
  const conf = buildPwField('pm-pw-confirm', 'Confirm new password', 'Re-enter new password');

  const errBox = el('div', 'pm-inline-error');
  errBox.hidden = true;

  const actions = el('div', 'pm-modal-actions-right');
  const cancelBtn = el('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => popup.close());
  const saveBtn = el('button', 'ui-btn primary');
  saveBtn.type = 'submit';
  saveBtn.innerHTML = '<i data-lucide="check"></i> Update Password';
  actions.append(cancelBtn, saveBtn);

  form.append(cur.field, next.field, conf.field, errBox, actions);
  popup.container.appendChild(form);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  function showErr(msg) {
    errBox.textContent = msg;
    errBox.hidden = !msg;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    showErr('');
    const currentPassword = cur.inp.value;
    const newPassword = next.inp.value;
    const confirmPassword = conf.inp.value;

    if (!currentPassword) {
      showErr('Enter your current password.');
      cur.inp.focus();
      return;
    }
    if (newPassword.length < 8) {
      showErr('New password must be at least 8 characters long.');
      next.inp.focus();
      return;
    }
    if (newPassword !== confirmPassword) {
      showErr('New password and confirmation do not match.');
      conf.inp.focus();
      return;
    }
    if (newPassword === currentPassword) {
      showErr('Choose a new password that is different from your current password.');
      next.inp.focus();
      return;
    }

    busy = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = 'Updating...';
    try {
      await changeSuperAdminPassword(currentPassword, newPassword);
      showToast({ type: 'success', title: 'Password updated', message: `Your ${saTitle} password has been changed.` });
      busy = false;
      popup.close(true);
    } catch (err) {
      showErr(mapAuthError(err, 'Could not update password. Please verify your current password.'));
      busy = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="check"></i> Update Password';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  });
}

/**
 * Opens "My Profile" popup from the topbar user chip dropdown for all roles.
 */
export function openProfileModal({ profile, onOpenOrganisation } = {}) {
  if (!profile) return;
  const isSuper = profile.role === 'superadmin';
  let busy = false;

  const popup = openPopup({
    title: 'My Profile',
    subtitle: isSuper ? 'Manage your display name, designation, and photo' : 'Your account details and profile photo',
    icon: 'user',
    saving: () => busy
  });

  const body = el('div', 'pm-profile-wrap');

  function resolveBranchText() {
    if (!profile.branchId) return '';
    const branches = (window.APP_CACHE && Array.isArray(window.APP_CACHE.branches)) ? window.APP_CACHE.branches : [];
    const hit = branches.find((b) => b.id === profile.branchId);
    if (hit) {
      const code = hit.code || hit.shortCode || hit.branchCode || '';
      return code ? `${hit.name} (${code})` : (hit.name || profile.branchId);
    }
    return profile.branchName || profile.branchId;
  }

  function renderContent() {
    body.textContent = '';
    const disp = resolveUserDisplay(profile.email, profile.name, profile.designation);
    const desigText = getUserTitle(profile);
    const saTitle = getRoleTitle('superadmin');
    const roleTitle = getRoleTitle(profile.role);

    const header = el('div', 'pm-hero');
    const avatarBox = el('div', 'pm-avatar');
    if (disp.photoUrl) {
      const img = document.createElement('img');
      img.src = disp.photoUrl;
      img.alt = disp.name;
      avatarBox.appendChild(img);
    } else {
      avatarBox.textContent = initials(disp.name || profile.email);
    }

    const identity = el('div', 'pm-identity');
    identity.appendChild(el('div', 'pm-name', disp.name));
    identity.appendChild(el('div', 'pm-desig', desigText));
    identity.appendChild(el('div', 'pm-email', profile.email || ''));

    const photoBtn = el('button', 'ui-btn ghost pm-btn-sm pm-photo-btn');
    photoBtn.type = 'button';
    photoBtn.innerHTML = `<i data-lucide="camera"></i> ${disp.photoUrl ? 'Change photo' : 'Upload photo'}`;
    photoBtn.addEventListener('click', () => {
      openPhotoCropModal({
        email: profile.email,
        name: disp.name,
        currentPhotoUrl: disp.photoUrl,
        onSaved: () => renderContent()
      });
    });

    header.append(avatarBox, identity, photoBtn);
    body.appendChild(header);

    const metaGrid = el('div', 'pm-meta-grid');
    const addMeta = (label, val) => {
      const item = el('div', 'pm-meta-item');
      item.appendChild(el('span', 'pm-meta-k', label));
      item.appendChild(el('strong', 'pm-meta-v', val || '-'));
      metaGrid.appendChild(item);
    };
    addMeta('Role Title', roleTitle || profile.role);
    addMeta('Designation', desigText);
    if (profile.branchId) {
      addMeta('Assigned Branch', resolveBranchText());
    } else if (profile.role === 'school_head') {
      addMeta('Unit', 'Unique Kids');
    }
    body.appendChild(metaGrid);

    if (isSuper) {
      const form = el('form', 'pm-super-form');
      form.noValidate = true;

      const row = el('div', 'pm-grid-2');
      const nameObj = makeFieldInput({
        id: 'pm-self-name',
        label: 'Display Name',
        value: disp.name,
        maxLength: 80,
        required: true,
        icon: 'user'
      });
      const desigObj = makeFieldInput({
        id: 'pm-self-desig',
        label: 'Designation',
        value: desigText,
        placeholder: 'e.g. Director',
        maxLength: 60,
        required: true,
        icon: 'badge-check'
      });

      row.append(nameObj.field, desigObj.field);
      form.appendChild(row);

      const errBox = el('div', 'pm-inline-error');
      errBox.hidden = true;
      form.appendChild(errBox);

      const actions = el('div', 'pm-modal-actions');
      const authLinkBtn = el('button', 'ui-btn ghost');
      authLinkBtn.type = 'button';
      authLinkBtn.innerHTML = '<i data-lucide="shield-check"></i> Authorised Users &amp; Password';
      authLinkBtn.addEventListener('click', () => {
        popup.close(true);
        if (typeof onOpenOrganisation === 'function') onOpenOrganisation();
      });

      const saveBtn = el('button', 'ui-btn primary');
      saveBtn.type = 'submit';
      saveBtn.innerHTML = '<i data-lucide="save"></i> Save Changes';
      actions.append(authLinkBtn, saveBtn);
      form.appendChild(actions);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (busy) return;
        const cleanName = formatPersonName(nameObj.inp.value);
        const cleanDesig = formatPersonName(desigObj.inp.value) || saTitle;
        if (!cleanName || cleanName.length < 2) {
          errBox.textContent = 'Enter a valid name (at least 2 characters).';
          errBox.hidden = false;
          nameObj.inp.focus();
          return;
        }
        errBox.hidden = true;
        busy = true;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
          await saveUserFields(profile.email, {
            name: cleanName,
            designation: cleanDesig,
            _ensureRequired: { role: 'superadmin', status: 'active' }
          });
          showToast({ type: 'success', title: 'Profile updated', message: 'Name and designation saved.' });
          busy = false;
          renderContent();
        } catch (err) {
          errBox.textContent = mapAuthError(err, 'Failed to save profile details.');
          errBox.hidden = false;
          busy = false;
          saveBtn.disabled = false;
          saveBtn.innerHTML = '<i data-lucide="save"></i> Save Changes';
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
      });

      body.appendChild(form);
    } else {
      const note = el('div', 'pm-readonly-note', `Only the ${saTitle} can change your name, designation, or role. You can update or remove your own profile photo above.`);
      body.appendChild(note);
      const footer = el('div', 'pm-modal-actions-right');
      const doneBtn = el('button', 'ui-btn primary', 'Done');
      doneBtn.type = 'button';
      doneBtn.addEventListener('click', () => popup.close());
      footer.appendChild(doneBtn);
      body.appendChild(footer);
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  popup.container.appendChild(body);
  renderContent();
}
