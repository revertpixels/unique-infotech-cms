import { db } from '../config/firebase-config.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { openPopup } from '../components/modal.js?v=1.8.193';
import { showToast } from '../components/toast.js?v=1.8.193';
import { confirmDialog } from '../components/ui-confirm.js?v=1.8.193';
import { openMenu } from '../components/ui-menu.js?v=1.8.193';
import { PAGE_SIZE, renderPager } from '../components/list-page.js?v=1.8.193';
import { formatPersonName, initials } from '../utils/formatter.js?v=1.8.193';
import { sendResetEmailForUser, mapAuthError } from '../core/auth.js?v=1.8.193';
import { openPhotoCropModal, openChangePasswordModal } from '../components/profile-modal.js?v=1.8.193';
import {
  getRoleTitle,
  getRolePluralTitle,
  loadUsersDirectory,
  resolveUserDisplay,
  saveUserFields
} from '../services/user-directory.service.js?v=1.8.193';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function makeAvatar(photoUrl, name, email) {
  const box = el('span', 'au-avatar');
  if (photoUrl) {
    const img = document.createElement('img');
    img.src = photoUrl;
    img.alt = name || email || '';
    box.appendChild(img);
  } else {
    box.textContent = initials(name || email || '?');
  }
  return box;
}

function makeUiInput({ id, label, type = 'text', value = '', placeholder = '', maxLength, required = false, icon = '' }) {
  const field = el('div', 'ui-field');
  const labelRow = el('div', 'ui-label-row');
  const lbl = document.createElement('label');
  lbl.htmlFor = id;
  lbl.textContent = label;
  if (required) {
    const em = document.createElement('em');
    em.textContent = ' *';
    lbl.appendChild(em);
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
  return { field, inp };
}

/**
 * Opens modal to edit Name and Designation on any user record (Super Admin, Branch Head, or School Head).
 */
function openEditUserModal(userRec, { title = 'Edit User Details', fallbackDesig = '' } = {}) {
  let busy = false;
  const roleDefault = fallbackDesig || getRoleTitle(userRec.role);
  const disp = resolveUserDisplay(userRec.email, userRec.name, userRec.designation || roleDefault);

  const popup = openPopup({
    title,
    subtitle: userRec.email,
    icon: 'pencil',
    saving: () => busy
  });

  const form = el('form', 'pm-form');
  form.noValidate = true;

  const nameObj = makeUiInput({
    id: 'au-edit-name',
    label: 'Full Name',
    value: disp.name,
    maxLength: 80,
    required: true,
    icon: 'user'
  });
  const desigObj = makeUiInput({
    id: 'au-edit-desig',
    label: 'Designation',
    value: disp.designation || roleDefault,
    placeholder: roleDefault ? `e.g. ${roleDefault}` : 'Enter designation',
    maxLength: 60,
    required: true,
    icon: 'badge-check'
  });

  const errBox = el('div', 'pm-inline-error');
  errBox.hidden = true;

  const actions = el('div', 'pm-modal-actions-right');
  const cancelBtn = el('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => popup.close());
  const saveBtn = el('button', 'ui-btn primary');
  saveBtn.type = 'submit';
  saveBtn.innerHTML = '<i data-lucide="check"></i> Save Details';
  actions.append(cancelBtn, saveBtn);

  form.append(nameObj.field, desigObj.field, errBox, actions);
  popup.container.appendChild(form);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const cleanName = formatPersonName(nameObj.inp.value);
    const cleanDesig = formatPersonName(desigObj.inp.value) || fallbackDesig;
    if (!cleanName || cleanName.length < 2) {
      errBox.textContent = 'Enter a valid full name (at least 2 characters).';
      errBox.hidden = false;
      nameObj.inp.focus();
      return;
    }
    if (!cleanDesig) {
      errBox.textContent = 'Enter a designation.';
      errBox.hidden = false;
      desigObj.inp.focus();
      return;
    }

    busy = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    errBox.hidden = true;
    try {
      await saveUserFields(userRec.email, {
        name: cleanName,
        designation: cleanDesig,
        _ensureRequired: userRec.role === 'superadmin' ? { role: 'superadmin', status: userRec.status || 'active' } : undefined
      });
      showToast({ type: 'success', title: 'Updated', message: `${cleanName} updated.` });
      busy = false;
      popup.close(true);
    } catch (err) {
      errBox.textContent = mapAuthError(err, 'Could not update user details.');
      errBox.hidden = false;
      busy = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="check"></i> Save Details';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  });
}

/**
 * Opens modal to add a new School Computer Head (`role: 'school_head'`).
 */
function openAddSchoolHeadModal(existingEmails) {
  let busy = false;
  const shTitle = getRoleTitle('school_head');
  const popup = openPopup({
    title: `Add ${shTitle}`,
    subtitle: 'Authorise a Google account for Unique Kids',
    icon: 'user-plus',
    saving: () => busy
  });

  const form = el('form', 'pm-form');
  form.noValidate = true;

  const emailObj = makeUiInput({
    id: 'au-sh-email',
    label: 'Google Email',
    type: 'email',
    placeholder: 'name@gmail.com',
    maxLength: 100,
    required: true,
    icon: 'mail'
  });
  const nameObj = makeUiInput({
    id: 'au-sh-name',
    label: 'Full Name',
    placeholder: 'e.g. Debashis Roy',
    maxLength: 80,
    required: true,
    icon: 'user'
  });
  const desigObj = makeUiInput({
    id: 'au-sh-desig',
    label: 'Designation',
    value: shTitle,
    maxLength: 60,
    required: true,
    icon: 'badge-check'
  });
  const phoneObj = makeUiInput({
    id: 'au-sh-phone',
    label: 'Phone (optional)',
    type: 'tel',
    placeholder: '10-digit mobile number',
    maxLength: 20,
    icon: 'phone'
  });

  const note = el('p', 'pm-hint', 'They sign in on the login screen with "Continue with Google" using this email.');
  const errBox = el('div', 'pm-inline-error');
  errBox.hidden = true;

  const actions = el('div', 'pm-modal-actions-right');
  const cancelBtn = el('button', 'ui-btn ghost', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => popup.close());
  const saveBtn = el('button', 'ui-btn primary');
  saveBtn.type = 'submit';
  saveBtn.innerHTML = '<i data-lucide="user-check"></i> Authorise User';
  actions.append(cancelBtn, saveBtn);

  form.append(emailObj.field, nameObj.field, desigObj.field, phoneObj.field, note, errBox, actions);
  popup.container.appendChild(form);
  if (typeof lucide !== 'undefined') lucide.createIcons();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const email = (emailObj.inp.value || '').trim().toLowerCase();
    const cleanName = formatPersonName(nameObj.inp.value);
    const cleanDesig = formatPersonName(desigObj.inp.value) || shTitle;
    const phone = (phoneObj.inp.value || '').trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errBox.textContent = 'Enter a valid Google email address.';
      errBox.hidden = false;
      emailObj.inp.focus();
      return;
    }
    if (existingEmails.has(email)) {
      errBox.textContent = 'An account with this email already exists.';
      errBox.hidden = false;
      emailObj.inp.focus();
      return;
    }
    if (!cleanName || cleanName.length < 2) {
      errBox.textContent = 'Enter a valid full name.';
      errBox.hidden = false;
      nameObj.inp.focus();
      return;
    }
    if (phone && !/^\d{10}$/.test(phone)) {
      errBox.textContent = 'Phone must be 10 digits or left blank.';
      errBox.hidden = false;
      phoneObj.inp.focus();
      return;
    }

    busy = true;
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    errBox.hidden = true;
    try {
      await saveUserFields(email, {
        email,
        name: cleanName,
        designation: cleanDesig,
        phone,
        role: 'school_head',
        branchId: null,
        status: 'active',
        photoUrl: ''
      }, { create: true });
      showToast({ type: 'success', title: 'Authorised', message: `${cleanName} added as ${cleanDesig}.` });
      busy = false;
      popup.close(true);
    } catch (err) {
      errBox.textContent = mapAuthError(err, `Failed to add ${shTitle}.`);
      errBox.hidden = false;
      busy = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      saveBtn.innerHTML = '<i data-lucide="user-check"></i> Authorise User';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  });
}

/**
 * Renders the three Authorised Users cards (Primary Admin, Branch Heads, and School Head).
 */
function createRowKebabCell(u, disp, { roleTitle, editModalTitle } = {}) {
  const tdAct = el('td', 'au-actions-col act');
  tdAct.dataset.label = 'Actions';
  const isOff = u.status === 'inactive' || u.status === 'disabled';

  const kebab = el('button', 'ui-kebab');
  kebab.type = 'button';
  kebab.setAttribute('aria-label', `Actions for ${disp.name || u.email}`);
  kebab.setAttribute('aria-haspopup', 'menu');
  kebab.setAttribute('aria-expanded', 'false');
  const ki = document.createElement('i');
  ki.setAttribute('data-lucide', 'more-vertical');
  kebab.appendChild(ki);

  kebab.addEventListener('click', () => {
    openMenu(kebab, [
      {
        label: disp.photoUrl ? 'Edit Photo' : 'Add Photo',
        icon: 'camera',
        onClick: () => {
          openPhotoCropModal({
            email: u.email,
            name: disp.name,
            currentPhotoUrl: disp.photoUrl
          });
        }
      },
      {
        label: 'Edit Details',
        icon: 'pencil',
        onClick: () => {
          openEditUserModal(u, { title: editModalTitle, fallbackDesig: roleTitle });
        }
      },
      'sep',
      {
        label: isOff ? 'Enable' : 'Disable',
        icon: isOff ? 'play-circle' : 'pause-circle',
        danger: !isOff,
        onClick: async () => {
          const nextStatus = isOff ? 'active' : 'inactive';
          const ok = await confirmDialog({
            title: isOff ? `Enable ${roleTitle}?` : `Disable ${roleTitle}?`,
            message: isOff
              ? `Allow ${disp.name} (${u.email}) to sign in again.`
              : `${disp.name} (${u.email}) will immediately lose access.`,
            confirmText: isOff ? 'Enable' : 'Disable',
            danger: !isOff
          });
          if (!ok) return;
          try {
            await saveUserFields(u.email, { status: nextStatus });
            showToast({
              type: 'success',
              title: isOff ? 'Enabled' : 'Disabled',
              message: `${disp.name} is now ${nextStatus === 'active' ? 'active' : 'inactive'}.`
            });
          } catch (err) {
            showToast({ type: 'error', title: 'Update failed', message: mapAuthError(err, 'Could not change status.') });
          }
        }
      }
    ]);
  });

  tdAct.appendChild(kebab);
  return tdAct;
}

export async function mountAuthorisedUsers({ container, profile, onSwitchToUsers } = {}) {
  if (!container) return () => {};
  let active = true;
  let bhPage = 1;
  let shPage = 1;

  container.textContent = '';
  const root = el('div', 'au-wrap');
  container.appendChild(root);

  async function ensureBranchesLoaded() {
    const cached = window.APP_CACHE && Array.isArray(window.APP_CACHE.branches) ? window.APP_CACHE.branches : [];
    if (cached.length && cached.some((b) => b && b.id && b.name)) return cached;
    try {
      const snap = await getDocs(collection(db, 'branches'));
      const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      loaded.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      window.APP_CACHE = window.APP_CACHE || {};
      window.APP_CACHE.branches = loaded;
      return loaded;
    } catch (err) {
      console.warn('[authorised-users] branches load failed:', err && err.code ? err.code : err);
      return cached;
    }
  }

  function branchLabel(branchId) {
    if (!branchId) return null;
    const branches = (window.APP_CACHE && Array.isArray(window.APP_CACHE.branches)) ? window.APP_CACHE.branches : [];
    const hit = branches.find((b) => b.id === branchId || (b.code && b.code === branchId));
    if (!hit) return { code: '', name: 'Branch unavailable', missing: true };
    return {
      code: String(hit.code || hit.shortCode || hit.branchCode || '').trim(),
      name: hit.name || hit.code || branchId,
      missing: false
    };
  }

  async function renderAll() {
    if (!active) return;
    const { list } = await loadUsersDirectory({ forceRefresh: false });
    if (!active) return;

    const allUsers = list || [];
    const existingEmails = new Set(allUsers.map((u) => u.email));
    const superUser = allUsers.find((u) => u.role === 'superadmin')
      || resolveUserDisplay(profile.email, profile.name, profile.designation);
    const branchHeads = allUsers.filter((u) => u.role === 'branch_head');
    const schoolHeads = allUsers.filter((u) => u.role === 'school_head');

    root.textContent = '';

    const saTitle = getRoleTitle('superadmin');
    const bhTitle = getRoleTitle('branch_head');
    const bhPlural = getRolePluralTitle('branch_head');
    const shTitle = getRoleTitle('school_head');

    // =========================================================================
    // A) PRIMARY ADMIN CARD
    // =========================================================================
    const saDisp = resolveUserDisplay(superUser.email, superUser.name, superUser.designation || saTitle);
    const saCard = el('section', 'au-card');
    const saHead = el('div', 'au-card-head');
    const saTitleGroup = el('div', 'au-card-title-group');
    saTitleGroup.appendChild(el('h2', 'au-card-title', saTitle));
    saTitleGroup.appendChild(el('p', 'au-card-sub', 'Primary owner profile, display identity, and password security'));

    const saActions = el('div', 'au-card-actions');
    const btnSaEdit = el('button', 'ui-btn ghost pm-btn-sm');
    btnSaEdit.type = 'button';
    btnSaEdit.innerHTML = '<i data-lucide="pencil"></i> Edit Name &amp; Designation';
    btnSaEdit.addEventListener('click', () => {
      openEditUserModal(superUser, { title: `Edit ${saTitle} Profile`, fallbackDesig: saTitle });
    });

    const btnSaPhoto = el('button', 'ui-btn ghost pm-btn-sm');
    btnSaPhoto.type = 'button';
    btnSaPhoto.innerHTML = `<i data-lucide="camera"></i> ${saDisp.photoUrl ? 'Change Photo' : 'Add Photo'}`;
    btnSaPhoto.addEventListener('click', () => {
      openPhotoCropModal({
        email: superUser.email,
        name: saDisp.name,
        currentPhotoUrl: saDisp.photoUrl
      });
    });

    const btnSaPw = el('button', 'ui-btn ghost pm-btn-sm');
    btnSaPw.type = 'button';
    btnSaPw.innerHTML = '<i data-lucide="key-round"></i> Change Password';
    btnSaPw.addEventListener('click', () => openChangePasswordModal({ email: superUser.email }));

    const btnSaForgot = el('button', 'ui-btn ghost pm-btn-sm');
    btnSaForgot.type = 'button';
    btnSaForgot.innerHTML = '<i data-lucide="mail"></i> Forgot Password';
    btnSaForgot.addEventListener('click', async () => {
      btnSaForgot.disabled = true;
      try {
        await sendResetEmailForUser(superUser.email);
        showToast({
          type: 'info',
          title: 'Reset email sent',
          message: `Password reset link sent to ${superUser.email}.`
        });
      } catch (err) {
        showToast({
          type: 'error',
          title: 'Could not send reset email',
          message: mapAuthError(err, 'Unable to send reset link.')
        });
      } finally {
        btnSaForgot.disabled = false;
      }
    });

    saActions.append(btnSaEdit, btnSaPhoto, btnSaPw, btnSaForgot);
    saHead.append(saTitleGroup, saActions);

    const saBody = el('div', 'au-super-row');
    saBody.appendChild(makeAvatar(saDisp.photoUrl, saDisp.name, superUser.email));
    const saInfo = el('div', 'au-super-info');
    saInfo.appendChild(el('div', 'au-super-name', saDisp.name));
    const saMeta = el('div', 'au-super-meta');
    saMeta.appendChild(el('span', 'au-role-chip', saDisp.designation || saTitle));
    saMeta.appendChild(el('span', 'au-email-text', superUser.email));
    saInfo.appendChild(saMeta);
    saBody.appendChild(saInfo);

    saCard.append(saHead, saBody);
    root.appendChild(saCard);

    // =========================================================================
    // B) BRANCH HEADS CARD (Read live from Users records — zero duplication)
    // =========================================================================
    const bhCard = el('section', 'au-card');
    const bhHead = el('div', 'au-card-head');
    const bhTitleGroup = el('div', 'au-card-title-group');
    const bhHeadingRow = el('div', 'au-title-with-count');
    bhHeadingRow.appendChild(el('h2', 'au-card-title', bhPlural));
    bhHeadingRow.appendChild(el('span', 'au-count-pill', String(branchHeads.length)));
    bhTitleGroup.appendChild(bhHeadingRow);
    bhTitleGroup.appendChild(el('p', 'au-card-sub', 'Synced live from user records. Create accounts or change branches in the Users tab.'));

    const bhActions = el('div', 'au-card-actions');
    const manageUsersBtn = el('button', 'ui-btn ghost pm-btn-sm');
    manageUsersBtn.type = 'button';
    manageUsersBtn.innerHTML = '<i data-lucide="users"></i> Manage in Users';
    manageUsersBtn.addEventListener('click', () => {
      if (typeof onSwitchToUsers === 'function') onSwitchToUsers();
    });
    bhActions.appendChild(manageUsersBtn);
    bhHead.append(bhTitleGroup, bhActions);
    bhCard.appendChild(bhHead);

    const bhTableWrap = el('div', 'au-table-wrap');
    const bhTable = el('table', 'au-table lp-table lp-mobile-cards');
    bhTable.innerHTML = `
      <thead>
        <tr>
          <th>User</th>
          <th>Designation</th>
          <th>Branch</th>
          <th>Status</th>
          <th class="au-actions-col">Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const bhTbody = bhTable.querySelector('tbody');

    if (!branchHeads.length) {
      const tr = document.createElement('tr');
      tr.className = 'lp-table-empty-row';
      const td = document.createElement('td');
      td.colSpan = 5;
      td.className = 'au-empty-cell lp-table-empty-td';
      td.textContent = `No ${bhPlural} added yet. Use the Users tab to add a ${bhTitle}.`;
      tr.appendChild(td);
      bhTbody.appendChild(tr);
    } else {
      const totalPages = Math.max(1, Math.ceil(branchHeads.length / PAGE_SIZE));
      if (bhPage > totalPages) bhPage = totalPages;
      const start = (bhPage - 1) * PAGE_SIZE;
      const slice = branchHeads.slice(start, start + PAGE_SIZE);
      slice.forEach((u) => {
        const disp = resolveUserDisplay(u.email, u.name, u.designation || bhTitle);
        const br = branchLabel(u.branchId);
        const tr = document.createElement('tr');

        const tdUser = el('td', 'lp-td-primary');
        tdUser.dataset.label = 'User';
        const userCell = el('div', 'au-user-cell');
        userCell.appendChild(makeAvatar(disp.photoUrl, disp.name, u.email));
        const txt = el('div', 'au-user-text');
        txt.appendChild(el('div', 'au-user-name', disp.name));
        txt.appendChild(el('div', 'au-user-email', u.email));
        userCell.appendChild(txt);
        tdUser.appendChild(userCell);

        const tdDesig = el('td', '', disp.designation || bhTitle);
        tdDesig.dataset.label = 'Designation';

        const tdBranch = el('td');
        tdBranch.dataset.label = 'Branch';
        if (!br) {
          tdBranch.appendChild(el('span', 'bh-branch-missing', 'Not assigned'));
        } else if (br.missing) {
          tdBranch.appendChild(el('span', 'bh-branch-missing', br.name));
        } else {
          if (br.code) tdBranch.appendChild(el('span', 'pill neutral', br.code));
          tdBranch.appendChild(el('span', 'au-branch-name', (br.code ? ' ' : '') + br.name));
        }

        const tdStatus = el('td');
        tdStatus.dataset.label = 'Status';
        const isOff = u.status === 'inactive' || u.status === 'disabled';
        tdStatus.appendChild(el('span', `bh-pill ${isOff ? 'off' : 'on'}`, isOff ? 'Inactive' : 'Active'));

        const tdAct = createRowKebabCell(u, disp, {
          roleTitle: bhTitle,
          editModalTitle: `Edit ${bhTitle} Details`
        });

        tr.append(tdUser, tdDesig, tdBranch, tdStatus, tdAct);
        bhTbody.appendChild(tr);
      });
    }

    bhTableWrap.appendChild(bhTable);
    bhCard.appendChild(bhTableWrap);

    if (branchHeads.length > 0) {
      const bhPager = el('div', 'au-card-foot');
      bhCard.appendChild(bhPager);
      renderPager(bhPager, {
        page: bhPage,
        pageSize: PAGE_SIZE,
        totalItems: branchHeads.length,
        showWhenSingle: true,
        onPageChange: (next) => { bhPage = next; renderAll(); }
      });
    }
    root.appendChild(bhCard);

    // =========================================================================
    // C) SCHOOL HEAD CARD
    // =========================================================================
    const shCard = el('section', 'au-card');
    const shHead = el('div', 'au-card-head');
    const shTitleGroup = el('div', 'au-card-title-group');
    const shHeadingRow = el('div', 'au-title-with-count');
    shHeadingRow.appendChild(el('h2', 'au-card-title', shTitle));
    shHeadingRow.appendChild(el('span', 'au-count-pill', String(schoolHeads.length)));
    shTitleGroup.appendChild(shHeadingRow);
    shTitleGroup.appendChild(el('p', 'au-card-sub', 'Unique Kids read-only access for attendance, documents, and reporting'));

    const shActions = el('div', 'au-card-actions');
    const addShBtn = el('button', 'ui-btn primary pm-btn-sm');
    addShBtn.type = 'button';
    const addShIcon = document.createElement('i');
    addShIcon.setAttribute('data-lucide', 'plus');
    addShBtn.append(addShIcon, ` Add ${shTitle}`);
    addShBtn.addEventListener('click', () => openAddSchoolHeadModal(existingEmails));
    shActions.appendChild(addShBtn);
    shHead.append(shTitleGroup, shActions);
    shCard.appendChild(shHead);

    const shTableWrap = el('div', 'au-table-wrap');
    const shTable = el('table', 'au-table lp-table lp-mobile-cards');
    shTable.innerHTML = `
      <thead>
        <tr>
          <th>User</th>
          <th>Designation</th>
          <th>Status</th>
          <th class="au-actions-col">Actions</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const shTbody = shTable.querySelector('tbody');

    if (!schoolHeads.length) {
      const tr = document.createElement('tr');
      tr.className = 'lp-table-empty-row';
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'au-empty-cell lp-table-empty-td';
      td.textContent = `No ${shTitle} configured yet. Click "Add ${shTitle}" to authorise one.`;
      tr.appendChild(td);
      shTbody.appendChild(tr);
    } else {
      const totalPages = Math.max(1, Math.ceil(schoolHeads.length / PAGE_SIZE));
      if (shPage > totalPages) shPage = totalPages;
      const start = (shPage - 1) * PAGE_SIZE;
      const slice = schoolHeads.slice(start, start + PAGE_SIZE);

      slice.forEach((u) => {
        const disp = resolveUserDisplay(u.email, u.name, u.designation || shTitle);
        const tr = document.createElement('tr');

        const tdUser = el('td', 'lp-td-primary');
        tdUser.dataset.label = 'User';
        const userCell = el('div', 'au-user-cell');
        userCell.appendChild(makeAvatar(disp.photoUrl, disp.name, u.email));
        const txt = el('div', 'au-user-text');
        txt.appendChild(el('div', 'au-user-name', disp.name));
        txt.appendChild(el('div', 'au-user-email', u.email));
        userCell.appendChild(txt);
        tdUser.appendChild(userCell);

        const tdDesig = el('td', '', disp.designation || shTitle);
        tdDesig.dataset.label = 'Designation';

        const tdStatus = el('td');
        tdStatus.dataset.label = 'Status';
        const isOff = u.status === 'inactive' || u.status === 'disabled';
        tdStatus.appendChild(el('span', `bh-pill ${isOff ? 'off' : 'on'}`, isOff ? 'Inactive' : 'Active'));

        const tdAct = createRowKebabCell(u, disp, {
          roleTitle: shTitle,
          editModalTitle: `Edit ${shTitle}`
        });

        tr.append(tdUser, tdDesig, tdStatus, tdAct);
        shTbody.appendChild(tr);
      });
    }

    shTableWrap.appendChild(shTable);
    shCard.appendChild(shTableWrap);

    if (schoolHeads.length > 0) {
      const shPager = el('div', 'au-card-foot');
      shCard.appendChild(shPager);
      renderPager(shPager, {
        page: shPage,
        pageSize: PAGE_SIZE,
        totalItems: schoolHeads.length,
        showWhenSingle: true,
        onPageChange: (next) => { shPage = next; renderAll(); }
      });
    }

    root.appendChild(shCard);

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  const onUsersUpdated = () => { renderAll(); };
  window.addEventListener('uic:users-updated', onUsersUpdated);
  window.addEventListener('uic:branding-updated', onUsersUpdated);

  await Promise.all([loadUsersDirectory({ forceRefresh: true }), ensureBranchesLoaded()]);
  await renderAll();

  return () => {
    active = false;
    window.removeEventListener('uic:users-updated', onUsersUpdated);
    window.removeEventListener('uic:branding-updated', onUsersUpdated);
  };
}
