import { db } from '../config/firebase-config.js';
import { registerDirty, confirmLeave } from '../utils/unsaved-guard.js?v=1.8.140';
import { collection, getDocs, query, where, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { createSelect } from '../components/ui-select.js';
import { openMenu } from '../components/ui-menu.js';
import { confirmDialog } from '../components/ui-confirm.js';
import { showToast } from '../components/toast.js';
import { buildStats, buildToolbar, renderEmptyTableState } from '../components/list-page.js?v=1.8.140';
import { INST_PER_SEM, feeTotal, courseFeeOf, discountOf } from '../utils/fees.js?v=1.8.140';
import { isCourseActive } from '../utils/session-rules.js?v=1.8.140';

const ENDED = ['ended', 'closed', 'completed', 'archived', 'cancelled'];
const LOCK_FIELDS = { admission: 'Admission fee', installment: 'Installment amount', material: 'Material fee' };
const LEVELS = [
  { value: '1', label: 'Semester 1 (Base Course)', icon: 'layers' },
  { value: '2', label: 'Semester 2 (Combo Course)', icon: 'git-merge' },
  { value: '3', label: 'Semester 3 (Advanced Course)', icon: 'award' }
];
const LEVEL_NAME = { 1: 'Sem 1 - Base', 2: 'Sem 2 - Combo', 3: 'Sem 3 - Advanced' };
const DURATION = { 1: 6, 2: 12, 3: 18 };
const STATUSES = [
  { value: 'active', label: 'Active', icon: 'check-circle' },
  { value: 'inactive', label: 'Inactive', icon: 'pause-circle' }
];

const $ = (id) => document.getElementById(id);
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function icon(name) { const i = document.createElement('i'); i.setAttribute('data-lucide', name); return i; }
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
const rs = (n) => 'Rs ' + (Number(n) || 0).toLocaleString('en-IN');
const lvlOf = (c) => [1, 2, 3].includes(Number(c && c.level)) ? Number(c.level) : 1;

export async function mount({ ctx, profile }) {
  try {
    const isHead = profile && profile.role === 'branch_head';
    const mode = ctx === 'school' ? 'school' : 'youth';
    const Y = mode === 'youth';
    const T = Y
      ? { title: 'Courses & Packages', sub: 'Base courses (Sem 1), combo courses (Sem 2) and advanced courses (Sem 3).', add: 'Add Course', card: 'All courses', one: 'course', many: 'courses' }
      : { title: 'School Levels', sub: 'Define Unique Kids levels with admission and monthly fee.', add: 'Add Level', card: 'All levels', one: 'level', many: 'levels' };

    $('cs-title').textContent = T.title;
    $('cs-crumb').textContent = T.title;
    $('cs-sub').textContent = T.sub;
    $('cs-add-label').textContent = T.add;
    $('cs-card-title').textContent = T.card;
    if (isHead) {
      const addBtn = $('cs-add');
      if (addBtn) addBtn.hidden = true;
    }
    document.querySelectorAll('#cs-form [data-only]').forEach((n) => { n.hidden = n.dataset.only !== mode; });
    if (!Y) {
      $('cs-name-label').innerHTML = 'Level name <em>*</em>';
      $('cs-name').placeholder = 'e.g. Level 1';
      $('cs-form-help').textContent = 'Set the admission fee and monthly fee for this level.';
    }

    const form = $('cs-form'), saveBtn = $('cs-save'), cancelBtn = $('cs-cancel');
    const f = {
      code: $('cs-code'), name: $('cs-name'), elig: $('cs-elig'),
      admission: $('cs-f-admission'), installment: $('cs-f-installment'), exam: $('cs-f-exam'), material: $('cs-f-material'),
      fullPayment: $('cs-f-full'), discount: $('cs-f-discount'),
      kAdmission: $('cs-admission'), kMonthly: $('cs-monthly'), topicIn: $('cs-topic-input')
    };

    let all = [], byId = {}, editId = null, saved = '', saving = false;
    let topics = [];
    let batches = [];

    // ---------- Rule 2: fee lock helpers (unlocked while no running batches exist) ----------
    const isRunning = (b) => !ENDED.includes(String(b.status || 'active').toLowerCase());
    function runningBatchesFor(courseId) {
      return courseId ? batches.filter((b) => b.courseId === courseId && isRunning(b)) : [];
    }
    function examFrozenBatchesFor(courseId) {
      return runningBatchesFor(courseId).filter((b) => b.lockedExamFee !== undefined && b.lockedExamFee !== null);
    }
    let sessions = [];
    function paintLock() {
      const banner = $('cs-lock-banner');
      if (!banner) return;
      const run = Y ? runningBatchesFor(editId) : [];
      const locked = run.length > 0;
      [f.admission, f.installment, f.material].forEach((el) => {
        if (!el) return;
        el.readOnly = locked;
        if (el.parentElement) el.parentElement.classList.toggle('is-locked', locked);
      });

      // Lock the exam fee field ONLY for a course whose id is in examFeeCollection.fees of a session where examFeeCollection.started == true
      const sessionWithLockedExam = (sessions || []).find((s) =>
        s.examFeeCollection &&
        s.examFeeCollection.started === true &&
        s.examFeeCollection.fees &&
        editId &&
        Object.prototype.hasOwnProperty.call(s.examFeeCollection.fees, editId)
      );
      const isExamLocked = !!sessionWithLockedExam;
      if (f.exam) {
        f.exam.readOnly = isExamLocked;
        if (f.exam.parentElement) f.exam.parentElement.classList.toggle('is-locked', isExamLocked);
      }

      banner.hidden = !locked && !isExamLocked;
      if (locked || isExamLocked) {
        let parts = [];
        if (locked) {
          const frozen = examFrozenBatchesFor(editId);
          parts.push('This course is locked for fee edits. ' + run.length + ' active batch(es) use this course. Edit fees only after those batches are closed.'
            + (frozen.length ? ' Exam fee is frozen inside: ' + frozen.map((b) => b.name || b.id).join(', ') + ' - a new exam fee applies only to other batches.' : ' Exam fee can still be updated.'));
        }
        if (isExamLocked) {
          parts.push(`Locked - exam fee collection started for ${sessionWithLockedExam.name || 'this session'}`);
        }
        banner.textContent = parts.join(' ');
      }
    }
    async function loadBatches() {
      try {
        const [bSnap, sSnap] = await Promise.all([
          getDocs(collection(db, 'batches')),
          getDocs(query(collection(db, 'sessions'), where('ctx', '==', 'youth')))
        ]);
        batches = bSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        sessions = sSnap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      } catch (e) {
        console.warn('[courses] batches/sessions not readable yet - fee lock stays open', e && e.code);
        batches = [];
        sessions = [];
      }
    }
    let prereqSel = null;
    let prereqId = '';

    const levelSel = Y ? createSelect($('cs-level'), { options: LEVELS, value: '1', ariaLabel: 'Course level', onChange: () => { prereqId = ''; applyLevel(); refresh(); } }) : null;
    const stSel = createSelect($('cs-status'), { options: STATUSES, value: 'active', ariaLabel: 'Status', onChange: () => refresh() });

    // ---------- linked chain helpers ----------
    function chainOf(course) {
      // returns [base, ..., course] following prerequisiteId (max 3 steps, cycle-safe)
      const out = [];
      const seen = new Set();
      let cur = course;
      while (cur && out.length < 3 && !seen.has(cur.id || '__new__')) {
        seen.add(cur.id || '__new__');
        out.unshift(cur);
        cur = cur.prerequisiteId ? byId[cur.prerequisiteId] : null;
      }
      return out;
    }
    const packageTotal = (course) => chainOf(course).reduce((t, c) => t + feeTotal(c.fees), 0);
    const curLevel = () => (Y ? Number(levelSel.value) : 1);

    // ---------- level / eligibility swap ----------
    function applyLevel() {
      if (!Y) return;
      const lv = curLevel();
      $('cs-duration-text').textContent = DURATION[lv] + ' Months';
      $('cs-duration-note').textContent = lv === 1 ? 'Fixed - Semester 1' : 'Fixed - ' + (lv - 1) * 6 + ' + 6 months';
      $('cs-fee-title').firstChild.textContent = 'Semester ' + lv + ' fees';
      $('cs-fee-title').lastChild.textContent = 'This 6-month semester only - 4 installments';
      f.code.placeholder = lv === 1 ? 'e.g. CITA' : (lv === 2 ? 'e.g. DITA' : 'e.g. PDCA');
      f.name.placeholder = lv === 1 ? 'e.g. Certificate in Information Technology Application' : (lv === 2 ? 'e.g. Diploma in Information Technology Application' : 'e.g. Post Diploma in Computer Application');
      const textWrap = $('cs-elig-text-wrap'), selWrap = $('cs-elig-sel-wrap');
      textWrap.hidden = lv !== 1;
      selWrap.hidden = lv === 1;
      $('cs-prereq-err').textContent = '';
      if (lv === 1) {
        prereqId = '';
      } else {
        const need = lv - 1;
        const opts = all.filter((c) => lvlOf(c) === need && c.id !== editId && isCourseActive(c) || (lvlOf(c) === need && c.id === prereqId && isCourseActive(c)))
          .map((c) => ({ value: c.id, label: c.code + ' - ' + (c.name || ''), icon: need === 1 ? 'layers' : 'git-merge' }));
        $('cs-prereq-label').innerHTML = 'Eligibility - must have completed a Semester ' + need + ' course <em>*</em>';
        const host = $('cs-prereq');
        const empty = $('cs-prereq-empty');
        if (!opts.length) {
          host.hidden = true; host.textContent = ''; prereqSel = null; prereqId = '';
          empty.hidden = false;
          empty.textContent = 'No active Semester ' + need + ' course exists yet. Create a Semester ' + need + ' course first, then come back.';
        } else {
          host.hidden = false; empty.hidden = true;
          if (!opts.some((o) => o.value === prereqId)) prereqId = opts[0].value;
          prereqSel = createSelect(host, { options: opts, value: prereqId, ariaLabel: 'Prerequisite course', onChange: (v) => { prereqId = (v && v.value !== undefined) ? v.value : prereqSel.value; paintChain(); paintSum(); refresh(); } });
        }
      }
      $('cs-copy-fees').hidden = lv === 1 || !prereqId;
      $('cs-copy-topics').hidden = lv === 1 || !prereqId;
      paintChain();
      paintSum();
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    function currentPrereq() {
      if (!Y || curLevel() === 1) return null;
      const id = prereqSel ? prereqSel.value : prereqId;
      prereqId = id || '';
      return id ? byId[id] || null : null;
    }

    // ---------- chain + totals ----------
    function readFees() {
      const fe = {
        admission: num(f.admission.value),
        installment: num(f.installment.value),
        exam: num(f.exam.value),
        material: num(f.material.value)
      };
      const fullInput = f.fullPayment || $('cs-f-full');
      const fullAmt = num(fullInput ? fullInput.value : 0);
      if (fullAmt > 0) {
        fe.fullPaymentAmount = fullAmt;
        const disc = discountOf({ fees: { admission: fe.admission, installment: fe.installment, fullPaymentAmount: fullAmt } });
        fe.fullPaymentDiscountRs = disc.rs;
        fe.fullPaymentDiscountPct = disc.pct;
        fe.fullPaymentDiscount = disc.rs;
      } else {
        fe.fullPaymentAmount = null;
        fe.fullPaymentDiscountRs = null;
        fe.fullPaymentDiscountPct = null;
        fe.fullPaymentDiscount = null;
      }
      return fe;
    }
    function updateFullDiscount() {
      const fullInput = f.fullPayment || $('cs-f-full');
      const discInput = f.discount || $('cs-f-discount');
      if (!Y || !fullInput || !discInput) return;
      const fe = readFees();
      const fullAmt = num(fullInput.value);
      const disc = discountOf({ fees: { admission: fe.admission, installment: fe.installment, fullPaymentAmount: fullAmt } });
      if (disc.rs > 0) {
        discInput.value = disc.pct + '% discount (saves ' + rs(disc.rs) + ')';
      } else if (fullAmt > 0) {
        discInput.value = '0% discount (no savings)';
      } else {
        discInput.value = '';
        discInput.placeholder = 'No offer (empty)';
      }
    }
    function draftCourse() {
      const p = currentPrereq();
      return { id: editId || '__new__', code: f.code.value.trim().toUpperCase() || 'NEW', name: f.name.value.trim(), level: curLevel(), prerequisiteId: p ? p.id : null, fees: readFees() };
    }
    function paintChain() {
      const box = $('cs-chain');
      box.textContent = '';
      const p = currentPrereq();
      if (!Y || curLevel() === 1 || !p) { box.hidden = true; return; }
      box.hidden = false;
      const chain = chainOf(draftCourse());
      const row = mk('div', 'cs-chain-row');
      chain.forEach((c, i) => {
        if (i) row.appendChild(mk('span', 'cs-chain-arrow', '+'));
        const isCur = i === chain.length - 1;
        const step = mk('div', 'cs-chain-step' + (isCur ? ' cur' : ''), (isCur ? (f.code.value.trim().toUpperCase() || 'This course') : c.code));
        step.appendChild(mk('span', '', 'Sem ' + (i + 1) + ' - ' + rs(feeTotal(c.fees))));
        row.appendChild(step);
      });
      box.appendChild(row);
      const foot = mk('div', 'cs-chain-foot');
      foot.appendChild(mk('span', '', 'A student must complete ' + p.code + ' before joining this course. Package covers ' + chain.length * 6 + ' months.'));
      box.appendChild(foot);
    }
    function paintSemTotal() {
      const fe = readFees();
      $('cs-sem-calc').textContent = rs(fe.admission) + ' + ' + rs(fe.installment) + ' x 4' + (fe.material ? ' (+ ' + rs(fe.material) + ' material)' : '');
      $('cs-sem-total').textContent = rs(courseFeeOf(fe));
    }
    function paintSum() {
      if (!Y) return;
      paintSemTotal();
      const chain = chainOf(draftCourse());
      const total = chain.reduce((t, c) => t + feeTotal(c.fees), 0);
      const box = $('cs-sum');
      box.textContent = '';
      const left = mk('div', '', curLevel() === 1 ? 'Course fee (6 months)' : 'Full package fee (' + chain.length * 6 + ' months)');
      const parts = chain.map((c, i) => 'Sem ' + (i + 1) + ' ' + rs(feeTotal(c.fees)));
      left.appendChild(mk('small', '', parts.join(' + ') + ' - ' + chain.length * INST_PER_SEM + ' installments'));
      box.append(left, mk('div', '', rs(total)));
    }

    // ---------- curriculum builder ----------
    function paintTopics() {
      const ul = $('cs-topics');
      ul.textContent = '';
      topics.forEach((t, i) => {
        const li = mk('li');
        li.appendChild(mk('span', '', t));
        const x = mk('button');
        x.type = 'button';
        x.setAttribute('aria-label', 'Remove ' + t);
        x.appendChild(icon('x'));
        x.addEventListener('click', () => { topics.splice(i, 1); paintTopics(); refresh(); });
        li.appendChild(x);
        ul.appendChild(li);
      });
      $('cs-topics-empty').hidden = topics.length > 0;
      $('cs-topic-count').textContent = topics.length + (topics.length === 1 ? ' topic' : ' topics');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    function addTopic() {
      const raw = f.topicIn.value.trim().replace(/\s+/g, ' ');
      if (!raw) { f.topicIn.focus(); return; }
      raw.split(',').map((s) => s.trim()).filter(Boolean).forEach((t) => {
        if (!topics.some((x) => x.toLowerCase() === t.toLowerCase())) topics.push(t);
      });
      f.topicIn.value = '';
      f.topicIn.focus();
      paintTopics();
      refresh();
    }
    $('cs-topic-add').addEventListener('click', addTopic);
    f.topicIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addTopic(); } });
    if (Y) {
      $('cs-copy-fees').addEventListener('click', () => {
        const p = currentPrereq(); if (!p) return;
        const pf = p.fees || {};
        f.admission.value = num(pf.admission) || ''; f.installment.value = num(pf.installment) || '';
        f.exam.value = num(pf.exam) || ''; f.material.value = num(pf.material) || '';
        paintChain(); paintSum(); refresh();
        showToast({ type: 'success', message: 'Fees copied from ' + p.code });
      });
      $('cs-copy-topics').addEventListener('click', () => {
        const p = currentPrereq(); if (!p) return;
        (p.curriculum || []).forEach((t) => { if (!topics.some((x) => x.toLowerCase() === String(t).toLowerCase())) topics.push(String(t)); });
        paintTopics(); refresh();
        showToast({ type: 'success', message: 'Topics copied from ' + p.code });
      });
      [f.admission, f.installment, f.exam, f.material, f.code, f.fullPayment].forEach((el) => {
        if (el) el.addEventListener('input', () => { paintChain(); paintSum(); updateFullDiscount(); refresh(); });
      });
    }

    // ---------- stats + toolbar + table head ----------
    const stats = buildStats(Y ? [
      { label: 'Total courses', value: 0, sub: 'Youth Centre', icon: 'layers', tone: 'indigo' },
      { label: 'Base courses', value: 0, sub: 'Semester 1 - 6 months', icon: 'book-open', tone: 'sky' },
      { label: 'Combo / Advanced', value: '0 / 0', sub: 'Semester 2 / Semester 3', icon: 'git-merge', tone: 'violet' },
      { label: 'Active', value: 0, sub: 'Open for admission', icon: 'check-circle', tone: 'green' }
    ] : [
      { label: 'Total levels', value: 0, sub: 'Unique Kids', icon: 'layers', tone: 'indigo' },
      { label: 'Active', value: 0, sub: 'Open for admission', icon: 'check-circle', tone: 'green' },
      { label: 'Avg monthly fee', value: 'Rs 0', sub: 'Across all levels', icon: 'indian-rupee', tone: 'sky' },
      { label: 'Avg admission', value: 'Rs 0', sub: 'Across all levels', icon: 'receipt', tone: 'amber' }
    ]);
    $('cs-stats').appendChild(stats.el);

    const filters = [];
    if (Y) filters.push({ id: 'level', label: 'Level', options: [{ value: 'all', label: 'All levels', icon: 'layers' }, { value: '1', label: 'Sem 1 - Base', icon: 'book-open' }, { value: '2', label: 'Sem 2 - Combo', icon: 'git-merge' }, { value: '3', label: 'Sem 3 - Advanced', icon: 'award' }] });
    if (!isHead) filters.push({ id: 'status', label: 'Status', options: [{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] });
    const tb = buildToolbar({ placeholder: Y ? 'Search code, name, eligibility or topic' : 'Search level', filters, onChange: () => render(), onRefresh: () => load() });
    $('cs-toolbar').appendChild(tb.el);

    $('cs-head').innerHTML = Y
      ? '<tr><th>Code</th><th>Name</th><th>Level</th><th>Duration</th><th>Prerequisite</th><th>This-sem fee</th><th class="num">Full package</th><th>Status</th><th class="br-actions">Actions</th></tr>'
      : '<tr><th>Level</th><th class="num">Admission</th><th class="num">Monthly fee</th><th>Topics</th><th>Status</th><th class="br-actions">Actions</th></tr>';

    // ---------- form read / fill ----------
    function readForm() {
      const v = { name: f.name.value.trim(), status: stSel.value, ctx: mode };
      if (Y) {
        const lv = curLevel();
        const p = currentPrereq();
        v.code = f.code.value.trim().toUpperCase();
        v.level = lv;
        v.durationMonths = DURATION[lv];
        v.prerequisiteId = lv === 1 ? null : (p ? p.id : null);
        v.prerequisiteCode = lv === 1 ? null : (p ? p.code : null);
        v.eligibilityText = lv === 1 ? f.elig.value.trim() : null;
        v.eligibility = lv === 1 ? v.eligibilityText : (p ? 'Completed ' + p.code : '');
        v.fees = readFees();
        v.fullPaymentAmount = v.fees.fullPaymentAmount || null;
        v.fullPaymentDiscountRs = v.fees.fullPaymentDiscountRs || null;
        v.fullPaymentDiscountPct = v.fees.fullPaymentDiscountPct || null;
        v.fullPaymentDiscount = v.fees.fullPaymentDiscount || null;
        v.curriculum = topics.slice();
      } else {
        v.admissionFee = num(f.kAdmission.value);
        v.monthlyFee = num(f.kMonthly.value);
        v.curriculum = topics.slice();
      }
      return v;
    }
    function fillForm(v) {
      f.name.value = v.name || '';
      stSel.value = v.status || 'active';
      if (Y) {
        f.code.value = v.code || '';
        levelSel.value = String(lvlOf(v));
        prereqId = v.prerequisiteId || '';
        f.elig.value = lvlOf(v) === 1 ? (v.eligibilityText || v.eligibility || '') : '';
        const fe = v.fees || {};
        f.admission.value = fe.admission ? fe.admission : '';
        f.installment.value = fe.installment ? fe.installment : '';
        f.exam.value = fe.exam ? fe.exam : '';
        f.material.value = fe.material ? fe.material : '';
        const fullInput = f.fullPayment || $('cs-f-full');
        const fp = (fe.fullPaymentAmount != null && fe.fullPaymentAmount !== '')
          ? fe.fullPaymentAmount
          : (v.fullPaymentAmount != null && v.fullPaymentAmount !== '' ? v.fullPaymentAmount : '');
        if (fullInput) fullInput.value = (fp && Number(fp) > 0) ? fp : '';
        updateFullDiscount();
        topics = Array.isArray(v.curriculum) ? v.curriculum.map(String) : [];
        f.topicIn.value = '';
        applyLevel();
        paintTopics();
      } else {
        f.kAdmission.value = v.admissionFee != null ? v.admissionFee : '';
        f.kMonthly.value = v.monthlyFee != null ? v.monthlyFee : '';
        topics = Array.isArray(v.curriculum) ? v.curriculum.map(String) : [];
        f.topicIn.value = '';
        paintTopics();
      }
    }
    const snapshot = () => JSON.stringify(readForm());
    function setState(text, cls) { const s = $('cs-state'); s.textContent = text; s.className = 'save-state' + (cls ? ' ' + cls : ''); }
    function refresh() {
      if (form.hidden) return;
      const dirty = snapshot() !== saved;
      saveBtn.disabled = saving || !dirty;
      cancelBtn.disabled = saving;
      if (!saving) setState(dirty ? 'Unsaved changes' : (editId ? 'No changes yet' : 'Fill in the details'), dirty ? 'dirty' : '');
    }
    function validate(v) {
      const e = {};
      if (!v.name) e.name = Y ? 'Course full name is required.' : 'Level name is required.';
      if (Y) {
        if (!v.code) e.code = 'Course code is required.';
        else if (!/^[A-Z0-9]{2,10}$/.test(v.code)) e.code = '2-10 letters or digits, no spaces.';
        else if (all.some((r) => r.id !== editId && (r.code || '').toUpperCase() === v.code)) e.code = 'Code already used by another course.';
        if (v.level > 1 && !v.prerequisiteId) e.prereq = 'Select the Semester ' + (v.level - 1) + ' course a student must complete first.';
        if (v.level > 1 && v.prerequisiteId === editId) e.prereq = 'A course cannot be its own prerequisite.';
        if (!v.fees.installment) e.fees = 'Enter the installment amount for this semester.';
        const run = runningBatchesFor(editId);
        if (run.length && byId[editId]) {
          const oldFees = byId[editId].fees || {};
          const changed = Object.keys(LOCK_FIELDS).find((k) => num(oldFees[k]) !== num(v.fees[k]));
          if (changed) e.fees = 'Cannot change ' + LOCK_FIELDS[changed] + '. Batch ' + (run[0].name || run[0].id) + ' is running. Allowed only after batch ends.';
        }
        if (editId) {
          const old = byId[editId];
          const dependents = all.filter((c) => c.prerequisiteId === editId);
          if (old && dependents.length && lvlOf(old) !== v.level) e.code = e.code || ('Level cannot change: ' + dependents.map((d) => d.code).join(', ') + ' depend on this course.');
        }
      } else {
        if (all.some((r) => r.id !== editId && (r.name || '').toLowerCase() === v.name.toLowerCase())) e.name = 'This level already exists.';
        if (!v.monthlyFee) e.monthly = 'Enter the monthly fee.';
      }
      return e;
    }
    function showErrors(e) {
      ['code', 'name', 'prereq', 'fees', 'admission', 'monthly'].forEach((k) => { const b = $('cs-' + k + '-err'); if (b) b.textContent = e[k] || ''; });
    }
    function blank() {
      return Y ? { name: '', code: '', level: 1, eligibility: '', prerequisiteId: null, fees: {}, curriculum: [], status: 'active' }
        : { name: '', admissionFee: 0, monthlyFee: 0, status: 'active' };
    }
    function openForm(r, isCopy) {
      if (isHead) return;
      editId = r && !isCopy ? r.id : null;
      const base = Object.assign(blank(), r ? JSON.parse(JSON.stringify(r)) : {});
      if (isCopy) { base.code = ''; base.name = (base.name || '') + ' (copy)'; }
      form.hidden = false;
      fillForm(base);
      saved = isCopy ? '' : snapshot();
      $('cs-form-title').textContent = editId ? 'Edit ' + T.one : 'New ' + T.one;
      $('cs-save-label').textContent = editId ? 'Save changes' : T.add;
      showErrors({});
      paintLock();
      refresh();
      if (typeof lucide !== 'undefined') lucide.createIcons();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      (Y && !editId ? f.code : f.name).focus({ preventScroll: true });
    }
    function closeForm() { form.hidden = true; editId = null; saved = ''; showErrors({}); }

    // ---------- course view popup (shared by Super Admin & Branch Head, Youth & School) ----------
    function openCourseView(row) {
      const triggerEl = document.activeElement;
      const back = mk('div', 'ui-modal-back');
      const modal = mk('div', 'ui-modal course-view-modal');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      const titleId = 'cv-title-' + Math.random().toString(36).slice(2, 8);
      modal.setAttribute('aria-labelledby', titleId);

      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      function closeModal() {
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prevOverflow;
        if (back.parentNode) back.parentNode.removeChild(back);
        if (triggerEl && typeof triggerEl.focus === 'function') {
          try { triggerEl.focus(); } catch (e) {}
        }
      }

      function onKey(ev) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeModal();
        }
      }
      document.addEventListener('keydown', onKey);
      back.addEventListener('click', (ev) => {
        if (ev.target === back) closeModal();
      });

      // Header band
      const head = mk('div', 'cv-head');
      const headMain = mk('div', 'cv-head-main');
      const topRow = mk('div', 'cv-head-top');

      const isOn = (row.status || 'active') === 'active';
      const statusPill = mk('span', 'cv-status-pill ' + (isOn ? 'active' : 'inactive'), isOn ? 'Active' : 'Inactive');

      if (Y) {
        const codeChip = mk('span', 'cv-code-chip', row.code || '-');
        topRow.append(codeChip, statusPill);
        const title = mk('h2', 'cv-title', row.name || '-');
        title.id = titleId;
        const lv = lvlOf(row);
        const dur = row.durationMonths || DURATION[lv] || (lv * 6);
        const sub = mk('div', 'cv-sub', (LEVEL_NAME[lv] || ('Semester ' + lv)) + ' • ' + dur + ' months');
        headMain.append(topRow, title, sub);
      } else {
        topRow.append(statusPill);
        const title = mk('h2', 'cv-title', row.name || '-');
        title.id = titleId;
        const sub = mk('div', 'cv-sub', 'Unique Kids Level');
        headMain.append(topRow, title, sub);
      }

      const closeBtn = mk('button', 'cv-close-btn');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.appendChild(icon('x'));
      closeBtn.addEventListener('click', closeModal);
      head.append(headMain, closeBtn);

      // Body
      const body = mk('div', 'cv-body');

      if (Y) {
        const lv = lvlOf(row);
        const dur = row.durationMonths || DURATION[lv] || (lv * 6);
        const fe = row.fees || {};

        // 1. Course details
        const secDetails = mk('div', 'cv-sec');
        const secDetailsH = mk('div', 'cv-sec-head');
        secDetailsH.appendChild(mk('h3', 'cv-sec-title', 'Course details'));
        secDetails.appendChild(secDetailsH);

        const grid = mk('div', 'cv-grid-2');
        const dLvl = mk('div', 'cv-kv');
        dLvl.appendChild(mk('span', 'cv-k', 'Level'));
        dLvl.appendChild(mk('span', 'cv-v', LEVEL_NAME[lv] || ('Semester ' + lv)));

        const dDur = mk('div', 'cv-kv');
        dDur.appendChild(mk('span', 'cv-k', 'Duration'));
        dDur.appendChild(mk('span', 'cv-v', dur + ' months'));
        grid.append(dLvl, dDur);

        const dReq = mk('div', 'cv-kv span-2');
        if (lv === 1) {
          dReq.appendChild(mk('span', 'cv-k', 'Eligibility'));
          dReq.appendChild(mk('span', 'cv-v', row.eligibilityText || row.eligibility || 'None required'));
        } else {
          dReq.appendChild(mk('span', 'cv-k', 'Prerequisite'));
          const p = row.prerequisiteId ? byId[row.prerequisiteId] : null;
          const pCode = row.prerequisiteCode || (p ? p.code : null) || 'Not linked';
          const pName = p && p.name ? (' - ' + p.name) : '';
          dReq.appendChild(mk('span', 'cv-v', pCode + pName));
        }
        grid.appendChild(dReq);
        secDetails.appendChild(grid);
        body.appendChild(secDetails);

        // 2. Fees for this semester
        const secFees = mk('div', 'cv-sec');
        const secFeesH = mk('div', 'cv-sec-head');
        secFeesH.appendChild(mk('h3', 'cv-sec-title', 'Fees for this semester'));
        secFees.appendChild(secFeesH);

        const feeTable = mk('table', 'cv-table');
        const tbTbody = mk('tbody');

        function addFeeRow(label, val, note) {
          const tr = mk('tr');
          const tdL = mk('td', 'cv-cell-label', label);
          if (note) tdL.appendChild(mk('span', 'cv-cell-note', note));
          const tdV = mk('td', 'cv-cell-val', rs(val));
          tr.append(tdL, tdV);
          tbTbody.appendChild(tr);
        }

        addFeeRow('Admission fee', num(fe.admission));
        addFeeRow('Installment', num(fe.installment) * 4, rs(num(fe.installment)) + ' x 4 installments');
        if (num(fe.exam) > 0) addFeeRow('Exam fee', num(fe.exam));
        if (num(fe.material) > 0) addFeeRow('Study material', num(fe.material));
        const viewFullAmt = num(fe.fullPaymentAmount) || num(r.fullPaymentAmount);
        const disc = discountOf(fe || r);
        if (viewFullAmt > 0) {
          const discText = disc.rs > 0 ? (disc.pct + '% discount (saves ' + rs(disc.rs) + ')') : 'Instant offer';
          addFeeRow('Paid in full offer', viewFullAmt, discText);
        }

        const trTot = mk('tr', 'cv-row-total');
        const tdTotL = mk('td', 'cv-cell-label', 'Total semester fee');
        const tdTotV = mk('td', 'cv-cell-val', rs(feeTotal(fe)));
        trTot.append(tdTotL, tdTotV);
        tbTbody.appendChild(trTot);

        feeTable.appendChild(tbTbody);
        secFees.appendChild(feeTable);
        body.appendChild(secFees);

        // 3. Full package
        const chain = chainOf(row);
        const secPkg = mk('div', 'cv-sec');
        const secPkgH = mk('div', 'cv-sec-head');
        secPkgH.appendChild(mk('h3', 'cv-sec-title', 'Full package'));
        secPkg.appendChild(secPkgH);

        const pkgTable = mk('table', 'cv-table');
        const pkgTbody = mk('tbody');
        chain.forEach((c) => {
          const tr = mk('tr');
          const tdC = mk('td', 'cv-cell-label');
          const rowWrap = mk('div', 'cv-pkg-row');
          rowWrap.appendChild(mk('span', 'cv-pkg-name', c.name || '-'));
          rowWrap.appendChild(mk('span', 'cv-code-chip-sm', c.code || '-'));
          tdC.appendChild(rowWrap);
          const tdV = mk('td', 'cv-cell-val', rs(feeTotal(c.fees)));
          tr.append(tdC, tdV);
          pkgTbody.appendChild(tr);
        });

        const trPkgTot = mk('tr', 'cv-row-total');
        const tdPkgL = mk('td', 'cv-cell-label', 'Package total');
        tdPkgL.appendChild(mk('span', 'cv-cell-note', (chain.length * INST_PER_SEM) + ' total installments'));
        const tdPkgV = mk('td', 'cv-cell-val', rs(packageTotal(row)));
        trPkgTot.append(tdPkgL, tdPkgV);
        pkgTbody.appendChild(trPkgTot);

        pkgTable.appendChild(pkgTbody);
        secPkg.appendChild(pkgTable);
        body.appendChild(secPkg);

        // 4. Topics
        const secTopics = mk('div', 'cv-sec');
        const secTopicsH = mk('div', 'cv-sec-head');
        secTopicsH.appendChild(mk('h3', 'cv-sec-title', 'Topics'));
        secTopics.appendChild(secTopicsH);

        const cur = row.curriculum || [];
        if (cur.length) {
          const ul = mk('ul', 'cv-topic-list');
          cur.forEach((t) => {
            ul.appendChild(mk('li', 'cv-topic-item', String(t)));
          });
          secTopics.appendChild(ul);
        } else {
          secTopics.appendChild(mk('p', 'cv-empty-note', 'No topics added'));
        }
        body.appendChild(secTopics);

        // 5. Running batches (Super Admin only - Correction 3)
        if (!isHead) {
          const run = runningBatchesFor(row.id);
          if (run.length) {
            body.appendChild(mk('p', 'cv-batch-note', run.length + ' running batch' + (run.length === 1 ? '' : 'es') + ' use this course'));
          }
        }
      } else {
        // School levels
        const secFees = mk('div', 'cv-sec');
        const secFeesH = mk('div', 'cv-sec-head');
        secFeesH.appendChild(mk('h3', 'cv-sec-title', 'Fees'));
        secFees.appendChild(secFeesH);

        const feeTable = mk('table', 'cv-table');
        const tbTbody = mk('tbody');

        const trAdm = mk('tr');
        trAdm.append(mk('td', 'cv-cell-label', 'Admission fee'), mk('td', 'cv-cell-val', rs(row.admissionFee)));
        tbTbody.appendChild(trAdm);

        const trMo = mk('tr');
        trMo.append(mk('td', 'cv-cell-label', 'Monthly fee'), mk('td', 'cv-cell-val', rs(row.monthlyFee) + ' / month'));
        tbTbody.appendChild(trMo);

        feeTable.appendChild(tbTbody);
        secFees.appendChild(feeTable);
        body.appendChild(secFees);

        const secTopics = mk('div', 'cv-sec');
        const secTopicsH = mk('div', 'cv-sec-head');
        secTopicsH.appendChild(mk('h3', 'cv-sec-title', 'Topics'));
        secTopics.appendChild(secTopicsH);

        const cur = row.curriculum || [];
        if (cur.length) {
          const ul = mk('ul', 'cv-topic-list');
          cur.forEach((t) => {
            ul.appendChild(mk('li', 'cv-topic-item', String(t)));
          });
          secTopics.appendChild(ul);
        } else {
          secTopics.appendChild(mk('p', 'cv-empty-note', 'No topics added'));
        }
        body.appendChild(secTopics);
      }

      modal.append(head, body);
      back.appendChild(modal);
      document.body.appendChild(back);

      if (typeof lucide !== 'undefined') lucide.createIcons();
      closeBtn.focus();
    }

    // ---------- table ----------
    function render() {
      const tbody = $('cs-rows');
      tbody.textContent = '';
      const st = tb.state;
      const rows = all.filter((r) => {
        if (isHead && (r.status || 'active') !== 'active') return false;
        if (!isHead && st.status && st.status !== 'all' && (r.status || 'active') !== st.status) return false;
        if (Y && st.level && st.level !== 'all' && String(lvlOf(r)) !== st.level) return false;
        if (st.q) {
          const hay = [r.name, r.code, r.eligibility, r.prerequisiteCode].concat(r.curriculum || []).map((x) => String(x || '').toLowerCase());
          if (!hay.some((x) => x.includes(st.q))) return false;
        }
        return true;
      });
      const listForStats = isHead ? all.filter((r) => (r.status || 'active') === 'active') : all;
      const activeN = listForStats.filter((r) => (r.status || 'active') === 'active').length;
      if (Y) {
        const c = (l) => listForStats.filter((r) => lvlOf(r) === l).length;
        stats.update(0, listForStats.length);
        stats.update(1, c(1));
        stats.update(2, c(2) + ' / ' + c(3));
        stats.update(3, activeN);
      } else {
        const avg = (k) => listForStats.length ? Math.round(listForStats.reduce((s, r) => s + num(r[k]), 0) / listForStats.length) : 0;
        stats.update(0, listForStats.length);
        stats.update(1, activeN);
        stats.update(2, rs(avg('monthlyFee')));
        stats.update(3, rs(avg('admissionFee')));
      }
      $('cs-count').textContent = listForStats.length + ' ' + (listForStats.length === 1 ? T.one : T.many);
      const foot = $('cs-foot');
      foot.hidden = !listForStats.length;
      foot.textContent = rows.length === listForStats.length ? 'Showing all ' + listForStats.length : 'Showing ' + rows.length + ' of ' + listForStats.length;
      if (!rows.length) {
        if (listForStats.length) {
          renderEmptyTableState(tbody, {
            colSpan: Y ? 9 : 6,
            title: 'No matching ' + T.many.toLowerCase(),
            desc: 'No ' + T.many.toLowerCase() + ' match your current search or filter criteria.',
            onClear: () => {
              tb.state.q = '';
              if (tb.state.level) tb.state.level = 'all';
              if (tb.state.status) tb.state.status = 'all';
              render();
            }
          });
        } else {
          const tr = mk('tr');
          const td = mk('td', 'lp-empty', isHead ? 'No active ' + T.many + ' available.' : 'No ' + T.many + ' yet. Click "' + T.add + '" to create one.');
          td.colSpan = Y ? 9 : 6;
          tr.appendChild(td);
          tbody.appendChild(tr);
        }
      }
      rows.forEach((r) => {
        const tr = mk('tr');
        const isOn = (r.status || 'active') === 'active';
        if (Y) {
          const lv = lvlOf(r);
          const fe = r.fees || {};
          const pre = lv === 1 ? null : (r.prerequisiteCode || (byId[r.prerequisiteId] || {}).code || 'missing');
          const tdCode = mk('td');
          tdCode.appendChild(mk('div', 'cs-code', r.code || '-'));
          const tdName = mk('td');
          tdName.appendChild(mk('div', 'cs-name', r.name || '-'));
          tdName.appendChild(mk('div', 'cs-meta', (lv === 1 ? 'Eligibility: ' + (r.eligibilityText || r.eligibility || 'Not set') + ' - ' : '') + (r.curriculum || []).length + ' topics'
            + (runningBatchesFor(r.id).length ? ' - fee locked' : '')));
          const tdLvl = mk('td');
          tdLvl.appendChild(mk('span', 'cs-lvl l' + lv, LEVEL_NAME[lv]));
          const tdDur = mk('td', '', (r.durationMonths || DURATION[lv]) + ' months');
          const tdPre = mk('td');
          if (pre) tdPre.appendChild(mk('span', 'cs-code', pre)); else tdPre.appendChild(mk('span', 'cs-meta', 'None (base)'));
          const tdFee = mk('td');
          tdFee.appendChild(mk('div', 'cs-feeline', rs(feeTotal(fe))));
          const parts = ['Adm ' + num(fe.admission), 'Inst ' + num(fe.installment) + ' x 4'];
          if (num(fe.exam)) parts.push('Exam ' + num(fe.exam));
          if (num(fe.material)) parts.push('Mat ' + num(fe.material));
          const rowFullAmt = num(fe.fullPaymentAmount) || num(r.fullPaymentAmount);
          const disc = discountOf(fe || r);
          if (rowFullAmt) parts.push('Full ' + rs(rowFullAmt) + (disc.pct ? ' (' + disc.pct + '% off)' : ''));
          tdFee.appendChild(mk('div', 'cs-meta', parts.join(', ')));
          const chain = chainOf(r);
          const tdTot = mk('td', 'num cs-total-cell', rs(packageTotal(r)));
          tdTot.appendChild(mk('small', '', chain.map((c) => c.code).join(' + ') + ' - ' + chain.length * INST_PER_SEM + ' inst.'));
          tr.append(tdCode, tdName, tdLvl, tdDur, tdPre, tdFee, tdTot);
        } else {
          tr.append(mk('td', 'cs-name', r.name || '-'), mk('td', 'num', rs(r.admissionFee)), mk('td', 'num', rs(r.monthlyFee) + ' / month'), mk('td', 'cs-meta', (r.curriculum || []).length + ' topics'));
        }
        const tdS = mk('td');
        tdS.appendChild(mk('span', 'br-pill ' + (isOn ? 'on' : 'off'), isOn ? 'Active' : 'Inactive'));
        const tdA = mk('td', 'br-actions');
        if (isHead) {
          const btn = mk('button', 'ui-kebab');
          btn.type = 'button';
          btn.setAttribute('aria-label', 'View ' + (r.name || r.code || T.one));
          btn.title = 'View';
          btn.appendChild(icon('eye'));
          btn.addEventListener('click', () => openCourseView(r));
          tdA.appendChild(btn);
        } else {
          const k = mk('button', 'ui-kebab');
          k.type = 'button';
          k.setAttribute('aria-label', 'Actions for ' + (r.name || T.one));
          k.appendChild(icon('more-vertical'));
          const items = [
            { label: 'View', icon: 'eye', onClick: () => openCourseView(r) },
            'sep',
            { label: 'Edit', icon: 'pencil', onClick: () => openForm(r) },
            { label: 'Duplicate', icon: 'copy', onClick: () => openForm(r, true) }
          ];
          if (Y && lvlOf(r) < 3) items.push({ label: 'Create Semester ' + (lvlOf(r) + 1) + ' course from this', icon: 'git-merge', onClick: () => createNext(r) });
          items.push('sep', { label: isOn ? 'Mark inactive' : 'Mark active', icon: 'archive', onClick: () => toggle(r) }, 'sep', { label: 'Delete', icon: 'trash-2', danger: true, onClick: () => del(r) });
          k.addEventListener('click', () => openMenu(k, items));
          tdA.appendChild(k);
        }
        tr.append(tdS, tdA);
        tbody.appendChild(tr);
      });
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    function createNext(r) {
      openForm({ name: '', code: '', level: lvlOf(r) + 1, prerequisiteId: r.id, fees: {}, curriculum: [], status: 'active' }, true);
      f.name.value = '';
      $('cs-form-title').textContent = 'New Semester ' + (lvlOf(r) + 1) + ' course (after ' + r.code + ')';
      refresh();
    }

    // ---------- data ----------
    async function load() {
      try {
        await loadBatches();
        const snap = await getDocs(collection(db, 'courses'));
        all = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).filter((r) => (r.ctx || 'youth') === mode);
        byId = {};
        all.forEach((c) => { byId[c.id] = c; });
        all.sort((a, b) => Y ? (lvlOf(a) - lvlOf(b) || (a.code || '').localeCompare(b.code || '')) : (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
      } catch (e) {
        console.error('[courses] load failed', e);
        showToast({ type: 'error', message: 'Could not load ' + T.many + ' (' + (e.code || 'error') + ')' });
        all = []; byId = {};
      }
      render();
    }
    async function toggle(r) {
      const next = (r.status || 'active') === 'active' ? 'inactive' : 'active';
      try { await updateDoc(doc(db, 'courses', r.id), { status: next, updatedAt: serverTimestamp() }); showToast({ type: 'success', message: 'Status updated' }); await load(); }
      catch (e) { showToast({ type: 'error', message: 'Status update failed (' + (e.code || 'error') + ')' }); }
    }
    async function del(r) {
      if (runningBatchesFor(r.id).length) {
        showToast({ type: 'error', message: 'Cannot delete ' + (r.code || r.name) + ': it has running batches' });
        return;
      }
      const dependents = all.filter((c) => c.prerequisiteId === r.id);
      if (dependents.length) {
        showToast({ type: 'error', message: 'Cannot delete ' + r.code + ': ' + dependents.map((d) => d.code).join(', ') + ' depend on it' });
        return;
      }
      const key = Y ? (r.code || 'DELETE') : 'DELETE';
      const ok = await confirmDialog({ title: 'Delete ' + T.one + '?', message: 'This permanently deletes "' + (r.name || '') + '". Students already admitted keep their saved fee details.', confirmText: 'Delete ' + T.one, danger: true, requireText: key });
      if (!ok) return;
      try { await deleteDoc(doc(db, 'courses', r.id)); if (editId === r.id) closeForm(); showToast({ type: 'success', message: (Y ? 'Course' : 'Level') + ' deleted' }); await load(); }
      catch (e) { showToast({ type: 'error', message: 'Delete failed (' + (e.code || 'error') + ')' }); }
    }
    async function save() {
      const v = readForm();
      const err = validate(v);
      showErrors(err);
      const bad = Object.keys(err)[0];
      if (bad) {
        setState('Please fix the highlighted fields', 'error');
        const focusMap = { code: 'cs-code', name: 'cs-name', fees: 'cs-f-installment', monthly: 'cs-monthly' };
        const el = $(focusMap[bad] || ''); if (el && el.focus) el.focus();
        return;
      }
      saving = true; saveBtn.disabled = true; cancelBtn.disabled = true; setState('Saving...', 'dirty');
      const data = Object.assign({}, v, { updatedAt: serverTimestamp() });
      try {
        const wasEdit = !!editId;
        if (wasEdit) await updateDoc(doc(db, 'courses', editId), data);
        else { data.createdAt = serverTimestamp(); await addDoc(collection(db, 'courses'), data); }
        if (wasEdit && Y) {
          const deps = all.filter((c) => c.prerequisiteId === editId && c.prerequisiteCode !== v.code);
          await Promise.all(deps.map((c) => updateDoc(doc(db, 'courses', c.id), { prerequisiteCode: v.code, eligibility: 'Completed ' + v.code, updatedAt: serverTimestamp() })));
        }
        saving = false; closeForm(); await load();
        showToast({ type: 'success', message: (Y ? 'Course' : 'Level') + (wasEdit ? ' updated' : ' added') });
      } catch (e) {
        saving = false; refresh(); setState('Save failed (' + (e.code || 'error') + ')', 'error');
        showToast({ type: 'error', message: 'Save failed (' + (e.code || 'error') + ')' });
      }
    }

    $('cs-add').addEventListener('click', () => openForm(null));
    cancelBtn.addEventListener('click', async () => {
      if (!form.hidden && !saveBtn.disabled && !(await confirmLeave({ clear: false }))) return;
      closeForm();
    });
    registerDirty(() => !form.hidden && !saveBtn.disabled && !saving);
    form.addEventListener('input', () => refresh());
    form.addEventListener('submit', (ev) => { ev.preventDefault(); save(); });
    await load();
  } catch (e) {
    console.error('[courses] mount failed', e);
    showToast({ type: 'error', message: 'Courses page failed to load' });
  }
}
















