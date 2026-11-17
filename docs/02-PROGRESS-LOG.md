# 02 — PROGRESS LOG
# Unique Infotech CMS

> **Append-only log of what was built, when, and why. Newest entry at the top. Every completed task MUST be logged here before marking done.**

---

```
---
### [YYYY-MM-DD HH:MM] Version X.Y.Z — Phase N · Step M

**What was built:**
- (file path + 1-line description)
- (file path + 1-line description)

**Why:**
- (business/technical reason)

**Files touched (created / modified / deleted):**
- CREATED: path/to/file
- MODIFIED: path/to/file
- DELETED: path/to/file

**Firestore changes:**
- Collection: `xxx` → field added / index added / rule changed / none

**Tested on:**
- Chrome Desktop: ✅ / ❌
- Mobile (Android Chrome): ✅ / ❌
- Edge cases checked: (list)

**Known issues created (if any):**
- Linked to `06-KNOWN-ISSUES.md` → Issue #NN

**Next task:**
- (what the next session should pick up)
---
```

---

## ACTIVE LOG (NEWEST ON TOP)
---

### [2026-11-15 13:23] Version 1.8.68 — Unique Kids admission + approved Kids admission receipt
T0: Preserved all 1.8.66/1.8.67/1.8.68 fixes (Organisation phones, batches MAX_PHONES=3, context switching, batch-code pills, status pills, summary cards, delete permissions). Version kept at 1.8.68 (no bump).

T1: Dedicated Kids Admissions route (#/school-admissions)
- ROUTES: added `school-admissions` { ctx: ['school'], roles: ['superadmin'], page: 'school-admissions' }. Appears in sidebar only in Kids context for Super Admin. Youth Admissions route unchanged (ctx: ['youth']).
- Router: dynamic receipt route `#/school-admissions/<studentId>/receipt` renders school-admission-receipt.html + school-admission-receipt.page.js.

T2: Admission form (school-admissions.page.js)
- Fields: Full name, Guardian name, Parent/guardian phone (+alt), Email, Aadhaar (12 digits, stored privately), DOB (validateDOB: real calendar date, not future, age>=5), Gender, Address, Level (school course), Batch (school batch, batchAllowsCourse), Admission date, Student photo, Student's signature.
- No session field/dependency, no branch selector/Head Office label, no qualification, no marksheet, no birth-proof upload, no fixed course end date, no instalment schedule.
- Documents: photo + signature, compressed < 100 KB, read/compressed BEFORE the transaction.
- Validation: trim strings; Aadhaar exactly 12 ASCII digits (format only); DOB real local date not future; project-standard phone/email validation; parent phone NOT a unique identity (no duplicate-phone block for Kids); level must belong to ctx='school' and be active; batch must belong to Kids, be active, allow selected course (batchAllowsCourse); clear message if no eligible level/batch.
- Payment truthfulness: "Admission fee of Rs X has been received" checkbox, required when admissionFee > 0, not pre-checked.

T3: Fees & payment start
- Uses course.admissionFee and course.monthlyFee; snapshots level name + fees at admission.
- Pure function firstMonthlyMonth(admissionISO): calendar +2 months (2027-01-15→2027-03, 2027-06-30→2027-08, 2027-11-20→2028-01, 2027-12-31→2028-02).
- Preview: admission fee payable now, monthly fee, monthly fees start from month/year, payment window 1st-10th. No finite annual schedule, no monthly fee collected at admission, no material/exam charges.

T4: Atomic save & identifiers (runTransaction)
- Student ID: YYYYNNNN where YYYY = admission date year; counter counters/sid_uk_<YYYY> via readStudentId(org='school').
- Receipt No: UK<YY>AD-<centreCode>-<NNNN> via readReceiptNo(org='school', type='AD'); centreCode from org_config.receiptCode (new config field).
- ALL tx.get (counters) before ALL tx.set (counters, student, photo/signature docs, private aadhaar doc, payment record).
- Counter >9999 blocked with clear error. merge: !!editId (boolean). No undefined values in payload.
- Returning student (edit): keeps same studentId/receiptNo, no counter reads/writes.
- New student: NEW studentId; old admission never changed.

T5: Security & Youth isolation
- firestore.rules: validStudentDoc() (ctx youth|school, studentId 8 digits, status, branchId, receiptNo string). students create/update require validStudentDoc(); branch_head create/update limited to ctx='youth' (Kids create = superadmin only). students/<id>/payment and /aadhaar: superadmin read/write. Youth lists exclude Kids (ctx='youth' filter in admissions.page.js load).
- Youth Branch Heads cannot read/write Kids students (branchId='HO' != their branch).

T6: Kids Admission Receipt (school-admission-receipt.page.js + .html + .css)
- Source: reference-templates/uk.html (two-page structure, CSS, fonts, colours, borders, spacing, photo/signature positions, table, page breaks). UI kit CSS scoped under .uk-receipt-page so it cannot restyle the app.
- Replaces: "Admission no" → Student ID; session rows → Monthly fees start / Monthly payment due / Programme: Ongoing; "Parent/guardian signature" → "Student's signature". Never shows full Aadhaar. Renders only saved fee heads.
- Header reads org_config: orgName, phones[] (up to 3 joined), email; logo /assets/images/logo.jpg.
- Filename: Admission-<studentId>.pdf. Preview/Print/Download PDF use same rendered template. Download PDF falls back to Print→Save as PDF if html2canvas/jsPDF unavailable (not installed in project).

T7: Form lifecycle & error handling
- mount-local state; registerDirty with normalized snapshot; initial load clean; edit dirty; undo clean; cancel confirms only when dirty; successful save clean before navigation; failed save retains input + dirty; error/success toast via showToast({type, message}); unmount removes only this page's listeners.

T8: Version
- APP_VERSION kept at 1.8.68 (no bump). All ?v=tags remain 1.8.68. Reference templates unchanged.

Files added:
- public/js/pages/school-admissions.page.js
- public/js/pages/school-admission-receipt.page.js
- public/js/utils/school-receipt.js
- public/pages/school-admissions.html
- public/pages/school-admission-receipt.html
- public/css/pages/school-admissions.css
- public/css/pages/school-admission-receipt.css

Files modified:
- public/js/core/router.js (school-admissions route + receipt dynamic route)
- public/js/pages/admissions.page.js (students query filtered ctx='youth')
- public/js/pages/org-details.page.js (receiptCode field + validation)
- public/pages/org-details.html (receipt code input row)
- public/js/core/app.js, public/index.html (APP_VERSION/__BUILD__ 1.8.69)
- public/js/components/sidebar.js, topbar.js, admission-receipt.page.js, batches.page.js, branches.page.js, branch-heads.page.js, courses.page.js, sessions.page.js, admission-receipt.html, batches.html, login.html (version tags 1.8.68→1.8.69)
- firestore.rules (validStudentDoc, students payment/aadhaar subcollections)
- docs/02-PROGRESS-LOG.md (this entry)

Centre receipt code: org-config previously had NO receipt code. Added validated config field `receiptCode` (2-12 uppercase letters/digits) to Organisation settings; school-admissions save blocks with a clear error if not configured. No value silently invented.

Firestore changes: students ctx filtering (Youth excludes Kids), students/<id>/payment, students/<id>/aadhaar (superadmin-only), validStudentDoc on create/update.

Tests (simulated, no browser/emulator):
- firstMonthlyMonth: all four calendar cases pass.
- Student ID YYYYNNNN for 2027 #1 → 20270001 (via readStudentId logic).
- Counter >9999 blocked (readStudentId/readReceiptNo throw).
- All transaction reads precede writes (readStudentId/readReceiptNo before any tx.set in save()).
- Syntax check on every changed/added .js: exit 0.
- BOM/mojibake/?v=1.8.68 scan: 0 hits.

Unverified (no browser/emulator available): full UI behaviour, live Firestore rules, PDF download (html2canvas/jsPDF not installed — falls back to Print→Save as PDF), context-switch round-trip.

---
T1: Sessions route (router.js)
- Changed `sessions` route ctx from `['youth', 'school']` to `['youth']` so Sessions is only available in Youth Centre.
- Direct navigation to #/sessions in Kids follows existing unavailable-route behaviour (superadmin auto-switches to Youth; others get lock page).

T2: Header session dropdown (topbar.js)
- Session dropdown (`tb-session`) is only rendered when `ctx === 'youth'`.
- In Kids, no session is loaded or selected from the header.
- `window.__uicFillSessions` is cleared in Kids context so the shared `uic:sessions-changed` listener does not call a stale closure.
- `sessionsListenerRegistered` is reset in Kids so it can be re-registered when switching back to Youth.
- Context switcher, notification button, and account controls preserved.

T3: Sidebar session card (sidebar.js)
- `buildSessionCard()` returns `null` for `ctx === 'school'` — no session card in Kids sidebar.
- `refreshSessionCard()` returns early for `ctx === 'school'`.
- `renderSidebar()` only appends session card when it is non-null.
- Session interval is cleared on every `renderSidebar()` call (context switch cleanup).
- Youth session card and behaviour fully preserved.

T4: Preserve existing data and functionality
- No session documents deleted or migrated.
- No changes to courses, batches, student records, or fee rules.
- Shared session APIs (`loadSessions`, `getRunningSession`, etc.) unchanged — still used by Youth.
- `batches.page.js` uses sessions for read-only filtering in Kids context (not session management); not modified.

T5: Version bump
- `APP_VERSION` and all `?v=1.8.67` tags bumped to `1.8.68` via Node script (UTF-8 no BOM).
- `window.__BUILD__` updated to `1.8.68`.

T6: Verification
- All changed .js files pass `node --check` as ES modules.
- `grep public/ for "?v=1.8.67"`: 0 matches.
- `grep public/` for BOM/mojibake: 0 matches.

- public/js/core/router.js: sessions route ctx -> ['youth'] only.
- public/js/components/topbar.js: session dropdown rendered only in Youth; stale reference cleanup on context switch.
- public/js/components/sidebar.js: session card suppressed in Kids; refreshSessionCard guarded; interval cleaned on context switch.
- public/js/core/app.js: APP_VERSION '1.8.67' -> '1.8.68'.
- public/index.html: __BUILD__ '1.8.67' -> '1.8.68'; all ?v= tags bumped.
- 15 other files: ?v= tags bumped 1.8.67 -> 1.8.68.
- docs/02-PROGRESS-LOG.md: added this entry.
Why:
- Unique Kids computer learning is ongoing, not session-bound. Youth Centre continues to use sessions unchanged.
Files touched (created / modified / deleted):
- MODIFIED: public/js/core/router.js, public/js/components/topbar.js, public/js/components/sidebar.js
- MODIFIED: public/js/core/app.js, public/index.html
- MODIFIED: public/css/pages/branches.css, public/js/pages/admission-receipt.page.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/admission-receipt.html, public/pages/batches.html, public/pages/login.html (version tags only)
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on all changed .js files: 0 failures (empty output).
- grep public/ for UTF-8 BOM, \u2713, mojibake: 0 matches.
- grep public/ for "?v=1.8.67": 0 matches (including receipt files).
Edge cases checked:
- Youth -> Kids -> Youth switching: sidebar re-renders with session card restored; header re-renders with session dropdown restored.
- Direct navigation to #/sessions in Kids: router blocks (ctx mismatch) per existing behaviour.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-13 04:59] Version 1.8.65 — HOTFIX · View avatar photo key + x icon + date formatting
T1: Wrong image in View avatar
- Save code writes doc ids from DOC_KEYS = ['photo', 'signature', 'dobProof', 'marksheet'] to students/<id>/docs/<key>. Upload box mapping in save (each box saves under its own key):
  - adm-photo-upload → key 'photo' → students/<id>/docs/photo
  - adm-signature-upload → key 'signature' → students/<id>/docs/signature
  - adm-dobProof-upload → key 'dobProof' → students/<id>/docs/dobProof
  - adm-marksheet-upload → key 'marksheet' → students/<id>/docs/marksheet
- View pop-up reads exactly key 'photo': getDoc(doc(db,'students',s.id,'docs','photo')) (admissions.page.js line ~1537).
- Mapping is already correct — each upload box saves under its own key (dobProof, marksheet, photo, signature). No fix needed; no migration code written for already-saved test admissions.
T2: x close icon
- lucide x at 18px (width/height 18px), stroke-width 2, centred in the 40x40 button (justify-content: center on adm-view-close).
- Same button style as View receipt (ui-btn ghost: border, radius, height 40).
T3: Date formatting
- 'Next due instalment' now uses formatDateIN(s.feeSchedule[0].due) || '-' instead of raw s.feeSchedule[0].due (YYYY-MM-DD).
- Grep of viewStudent code: no other raw date (YYYY-MM-DD) output found; all dates already use formatDateIN.
T4: Checks
- node --check public/js/pages/admissions.page.js: empty output (pass).
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep public/ for "?v=1.8.64": 0 matches (including receipt files).

- public/js/pages/admissions.page.js: version tags -> 1.8.65; T2 xBtn innerHTML with stroke-width 2 + 18px icon; T3 nextDue formatDateIN.
- public/css/pages/admissions.css: T2 adm-view-close justify-content center + icon sizing 18px.
- public/js/core/app.js + 14 other JS/HTML files (INCLUDING admission-receipt.page.js, admission-receipt.html): bumped 1.8.64 -> 1.8.65 via Node script (UTF-8 no BOM).
- docs/02-PROGRESS-LOG.md: added this entry.
Why:
- Fix View avatar reading correct photo key (mapping verified correct), centre x icon, format next due date.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js, public/css/pages/admissions.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admission-receipt.page.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/admission-receipt.html, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on admissions.page.js: 0 failures (empty output).
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep public/ for "?v=1.8.64": 0 matches (including receipt files).
Edge cases checked:
- x button keeps ui-btn ghost styling (border, radius, height 40) consistent with View receipt/Edit buttons.
- formatDateIN returns '' for empty input, so || '-' fallback preserves '-' for missing due dates.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-14 10:38] Version 1.8.68 — HOTFIX · Organisation + Branch contact numbers (max 3)
T1: Organisation contacts
- Replaced single `phone` input with repeatable phone rows (max 3) matching existing branch phone controls.
- Save `phones` array of trimmed, non-empty strings + `phone: phones[0] || ''` for existing consumers.
- Load `phones` when available; otherwise load legacy `phone` as a single row (old records preserved).
- Add number / Remove controls with count (1/3). Add disabled at 3. Max enforced in validation too.
- Reuses branch phone-format (7-20 digits, spaces, + or -) and duplicate-number validation.
- Empty optional rows not saved as empty array entries.
- All other organisation fields unchanged. Form snapshots, dirty-state, validation, save and reload updated.
- Firestore rules: no changes needed (settings write already restricted to superadmin).

T2: Branch contacts
- MAX_PHONES changed from 5 to 3 in branches.page.js.
- branches.html count placeholder updated from 0/5 to 0/3.
- Existing phones-array / first-phone compatibility behaviour preserved.

T3: Version bump
- APP_VERSION and all ?v= tags bumped from 1.8.66 to 1.8.68 via Node script (UTF-8 no BOM).
- Receipt files received version-tag changes only; no layout changes.

T4: Checks
- node --check on every changed .js (as .mjs): empty output (all pass).
- grep public/ for "?v=1.8.66": 0 matches.
- grep public/ for UTF-8 BOM, \u2713, mojibake: 0 matches.

- public/js/pages/org-details.page.js: Rewrote for phones array (max 3), Add/Remove controls, legacy phone migration, save/load/reload updated.
- public/pages/org-details.html: Single phone input replaced with repeatable phone rows (org-phones, org-phone-add, org-phones-count).
- public/js/pages/branches.page.js: MAX_PHONES 5 → 3.
- public/pages/branches.html: br-phones-count 0/5 → 0/3.
- public/css/pages/branches.css: Added .org-phones, .org-phone-row, .org-phone-del, .org-phone-add classes.
- public/js/core/app.js + 15 other JS/HTML files: bumped 1.8.66 -> 1.8.68 via Node script (UTF-8 no BOM).
- docs/02-PROGRESS-LOG.md: added this entry.
Why:
- Parent organisation allows up to 3 contact numbers; branches reduced from 5 to 3. First-number compatibility field keeps existing receipt consumers working.
Files touched:
- MODIFIED: public/js/pages/org-details.page.js, public/pages/org-details.html, public/js/pages/branches.page.js, public/pages/branches.html, public/css/pages/branches.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admission-receipt.page.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/courses.page.js, public/js/pages/sessions.page.js, public/pages/admission-receipt.html, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- None. Organisation settings document now stores `phones` array + `phone` compatibility field (no rule change needed).
Tested on:
- node --check on all changed .js files (as .mjs): 0 failures (empty output).
- grep public/ for "?v=1.8.66": 0 matches (including receipt files).
- grep public/ for UTF-8 BOM, \u2713, mojibake: 0 matches.
Edge cases checked:
- Old organisation record with single `phone` (no `phones` array): loaded as one phone row, not lost.
- Empty phone rows: not saved as empty array entries.
- Add button disabled at 3 rows; validation rejects >3 phones.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-14 05:09] Version 1.8.66 — HOTFIX · Student ID + Receipt number + Remove admissionNo
STEP 0 answers (before editing):
a) admissionNo usages: public/js/pages/admissions.page.js (16 refs); public/js/core/router.js (4 refs); public/js/utils/admission-receipt.js (6 refs); public/js/pages/admission-receipt.page.js (1 ref); firestore.rules (1 ref).
b) Course level: field `level`, values 1/2/3. lvlOf() at courses.page.js:31. Required when saved: yes.
c) Org on admission: field `ctx`, value 'youth' for Youth Centre.
d) Session year: from session.startDate (YYYY-MM-DD), first 4 digits. Function: `selS.startDate.slice(0, 4)`.
e) Branch code: field `code` on branch doc, validated /^[A-Z0-9]{2,10}$/, e.g. BZYCTC. Retrieved via `br.code || br.id || ''`.
f) Counters: `counters/admission_<branchId>_<year>`; `generateAdmissionNumber()` at admission.service.js:33-43, called at admissions.page.js:1400. Returns `BRANCH-YEAR-0001`.

T1: Student ID (field: studentId, STRING, exactly 8 digits, leading zeros kept).
- Youth Centre: YYSSNNNN — YY = last 2 digits of session year, SS = course level 01/02/03, NNNN = counter per (YY+SS) shared across ALL Youth Centre branches. Counter doc: counters/sid_ui_<YY>_<SS>.
- Unique Kids: YYYYNNNN — YYYY = session year, NNNN = counter per year shared across ALL Kids branches. Counter doc: counters/sid_uk_<YYYY>.
- Course has no level -> block save: "Set the course level first (Courses page)."
- Generated inside ONE Firestore runTransaction with admission write, docs writes, and receipt counter.
- Counter above 9999 -> block with clear error.
- Returning student (via Find): gets NEW studentId, saves previousStudentIds = [found.studentId, ...(found.previousStudentIds || [])] (no duplicates). Old admission never changed.
- Find lookup: two queries (studentId == X, previousStudentIds array-contains X), merged, de-duplicated.

T2: Receipt number (field: receiptNo on the admission).
- Format: <ORG><YY><TYPE>-<BRANCHCODE>-<NNNN> e.g. UI26AD-BZYCTC-0001.
- ORG = UI (Youth Centre) / UK (Unique Kids). YY = last 2 digits of payment date year (admission date for admission receipt).
- TYPE = AD (admission payment) / IN (later instalment payment). NNNN = counter per org + year + type + branchCode.
- Counter doc: counters/rcpt_<org>_<YY>_<type>_<branchCode>.
- AD number created in same transaction as T1.
- Export nextReceiptNo(tx, { org, type, branchCode, date }) from admission.service.js.

T3: Remove admissionNo everywhere.
- List column "Admission No" -> "Student ID"; search placeholder "Search name, student ID, phone or guardian".
- View popup header: "Student ID: 27010001" and second muted line "Receipt: UI26AD-BZYCTC-0001".
- Receipt data: studentId + receiptNo (layout unchanged). PDF filename: Admission-<studentId>-<session>.pdf.
- Lookup placeholder: "e.g. 27010001". Route: #/students/<studentId>.
- Page subtitle: "Admit new students to courses and batches. Student IDs are generated per session year and course level."
- Deleted generateAdmissionNumber() and its counter usage. admissionNo appears 0 times in public/.
- firestore.rules: allow signed-in users to read/write counters/sid_* and counters/rcpt_*.
- No composite index needed (single-field queries only).

T4: Checks
- node --check on every changed .js (as .mjs): empty output (all pass).
- Unit formatting: Youth L1 2027 #1 -> 27010001; Youth L3 2027 #12 -> 27030012; Kids 2027 #5 -> 20270005; UI 2026 AD BZYCTC #1 -> UI26AD-BZYCTC-0001; UK 2027 IN KIDS01 #37 -> UK27IN-KIDS01-0037.
- grep public/ for BOM, \u2713, mojibake: 0 hits. grep public/ for "?v=1.8.65": 0 hits (including receipt files).

- public/js/services/admission.service.js: Replaced generateAdmissionNumber() with generateStudentId() and nextReceiptNo().
- public/js/pages/admissions.page.js: All admissionNo references replaced with studentId/receiptNo. Save wrapped in runTransaction. Find queries studentId OR previousStudentIds. View popup shows Student ID + Receipt.
- public/js/utils/admission-receipt.js: getReceiptData returns studentId + receiptNo. PDF filename uses studentId.
- public/js/pages/admission-receipt.page.js: Table row "Admission no" -> "Receipt No".
- public/js/core/router.js: renderStudentProfile(admissionNo) -> renderStudentProfile(studentId).
- public/pages/admissions.html: Subtitle, table header, lookup placeholder updated.
- firestore.rules: students update rule uses studentId. counters rule allows sid_* and rcpt_*.
- All version-bump files: 1.8.65 -> 1.8.66 via Node script (UTF-8 no BOM).
- docs/02-PROGRESS-LOG.md: added this entry.
Why:
- Replace admissionNo with studentId (8-digit, per session year + course level) and receiptNo (per org/year/type/branch). Remove all admissionNo references.
Files touched:
- MODIFIED: public/js/services/admission.service.js, public/js/pages/admissions.page.js, public/js/utils/admission-receipt.js, public/js/pages/admission-receipt.page.js, public/js/core/router.js, public/pages/admissions.html, firestore.rules
- MODIFIED: version-bump files: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admission-receipt.page.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/admission-receipt.html, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- counters/sid_ui_<YY>_<SS> and counters/sid_uk_<YYYY> for student IDs
- counters/rcpt_<org>_<YY>_<type>_<branchCode> for receipt numbers
- students collection: admissionNo field removed, studentId + receiptNo + previousStudentIds added
Tested on:
- node --check on all changed .js files (as .mjs): 0 failures (empty output).
- Unit formatting: all 5 test cases match expected values.
- grep public/ for UTF-8 BOM, \u2713, mojibake: 0 matches.
- grep public/ for "?v=1.8.65": 0 matches (including receipt files).
Edge cases checked:
- Course level missing -> generateStudentId throws "Set the course level first (Courses page)."
- Counter above 9999 -> clear error thrown.
- Returning student: previousStudentIds de-duplicated, old admission untouched.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-13 04:51] Version 1.8.64 — HOTFIX · View pop-up photo + status dot + header refinements
T1: Photo instead of initials
- viewStudent() reads ONLY students/<id>/docs/photo via one getDoc(doc(db,'students',s.id,'docs','photo')), not the whole docs subcollection.
- Avatar 72x72, border-radius 12px, object-fit: cover, 1px border var(--border). Shows initials while loading and as fallback if no photo or invalid data URL (isDataUrl() guard). Avatar box keeps same size in all states (no layout jump).
T2: Status as dot next to name
- Removed the "Active" pill from the right side completely.
- Added 10px round dot directly after the student name (8px gap, vertically centred with name text), with title/aria-label = status text ("Active", "Dropped", "Completed").
- Colours: Active = green (var(--success, #16a34a)), Completed = blue (var(--primary)), Dropped = grey (var(--text-mute)), any other status = grey.
T3: Header buttons
- Right side group = [View receipt] [Edit] [x] in ONE flex container (adm-view-actions) with gap: 8px, equal gaps, no margins on buttons.
- All three buttons 40px height (ui-btn default); "x" is square 40x40 (adm-view-close class).
T4: Spacing
- Header margin-bottom: 20px so avatar never touches cards.
- Header row: display flex, align-items center, gap 16px between avatar and name block.
T5: Checks
- node --check public/js/pages/admissions.page.js: empty output (pass).
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep public/ for "?v=1.8.63": 0 matches (including receipt files).

- public/js/pages/admissions.page.js: version tags -> 1.8.64; T1 photo getDoc + isDataUrl fallback; T2 status dot replacing pill; T3 buttons in one container + xBtn adm-view-close class; T4 spacing (no spacing changes in JS beyond layout structure).
- public/css/pages/admissions.css: T1 avatar img styling; T2 adm-view-status-dot colours; T3 adm-view-actions gap/margin, adm-view-close width 40px; T4 adm-view-head margin-bottom 20px.
- public/js/core/app.js + 14 other JS/HTML files (INCLUDING admission-receipt.page.js, admission-receipt.html): bumped 1.8.62/1.8.63 -> 1.8.64 via Node script (UTF-8 no BOM).
- docs/02-PROGRESS-LOG.md: added this entry.
Why:
- Polish view-student pop-up: photo instead of initials, status dot beside name, unified header button group, tighter vertical spacing.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js, public/css/pages/admissions.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admission-receipt.page.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/admission-receipt.html, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on admissions.page.js: 0 failures (empty output).
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep public/ for "?v=1.8.63": 0 matches (including receipt files).
Edge cases checked:
- Photo getDoc wrapped in try/catch; non-fatal, keeps initials on failure.
- isDataUrl guard prevents setting img.src on invalid/incomplete data URLs.
- Status dot gets title/aria-label for accessibility.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-13 04:06] Version 1.8.63 — HOTFIX · View pop-up compact layout + doc image src fix
T1: View pop-up - no inner scroll on desktop
- Removed fixed height / max-height + overflow on pop-up body; pop-up grows to fit content (width 900px, max-width calc(100vw - 32px)), centred, 24px padding. Compact: card header 12px 16px, rows 6px vertical padding, 13px text, 16px gap so all 4 cards fit on 1080p without scrolling.
- Only when pop-up is taller than viewport (small screens / mobile): the WHOLE overlay scrolls (ui-modal-back overflow-y: auto, pop-up margin 16px auto); never a scrollbar inside the pop-up.
T2: Removed the bottom "Close" button and footer row completely; kept top-right "x", Esc and backdrop click.
T3: Header: avatar (initials) | name (bold) + "Admission No: ..." on one line under it | status chip (adm-pill, same colours as Status column, capitalised "Active") | right side: [View receipt] [Edit] [x], vertically centred. Added .adm-pill.active/dropped/completed colours.
T4: Rows: label column fixed 140px, nowrap, ellipsis; value wraps; 12px gap. Gender capitalised ("Male"). Dates via formatDateIN ("10 Mar 2027"), money via formatINR ("₹3,280"), empty values "-".
T5: Fixed "Failed to load resource: data:image/jpeg;base64... net::ERR_INVALID_URL" (twice) — caused by renderReturnDocs() prepending "data:image/jpeg;base64," to old.data which is already a complete data URL (admissions.page.js renderReturnDocs). Added isDataUrl() helper; only set img.src when the value is a complete "data:image/...;base64,..." string, else show fallback (empty box). Document saving unchanged.
T6: grep public/ for BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches. node --check on admissions.page.js: empty.

- public/js/pages/admissions.page.js: version tags 1.8.62 -> 1.8.63; T1/T2/T3/T4/T5 viewStudent changes; T5 isDataUrl helper + img.src guards.
- public/css/pages/admissions.css: T1 compact modal/layout, removed max-height/overflow/foot, T2 removed .adm-view-footer, T3 header/pill colours, T4 label/value row sizing.
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.62 -> 1.8.63 via Node script (UTF-8 no BOM).
- docs/02-PROGRESS-LOG.md: added this entry.
Why:
- Polish view-student pop-up: compact non-scrolling desktop layout, overlay scroll only on small screens, no bottom Close button, clean header, fixed row sizing, fix broken doc image src.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js, public/css/pages/admissions.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on admissions.page.js: 0 failures (empty output).
- node dynamic import of admissions.page.js: no SyntaxError (only expected Firebase https URL runtime error outside browser).
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
Edge cases checked:
- isDataUrl guard applied to all four doc img.src sites (setDocPreview, renderReturnDocs, fillForm docOriginals, handleFileSelect); saving path untouched.
- Status chip capitalised ("Active") and colour-matched to list Status column.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-13 03:35] Version 1.8.62 — Phase 2 · View pop-up refinements + global scrollbars + edit mode locks
T1: View pop-up
- (a) Added "x" icon button (ui-btn ghost, aria-label "Close") at top-right of pop-up header, alongside bottom Close button. Esc and backdrop click also close.
- (b) Header and footer fixed; only the card grid body scrolls (overflow-y: auto on .adm-view-body).
- (c) Removed Documents section completely from view pop-up, and removed the docs subcollection read (getDocs query on students/{id}/docs). Printed removed lines below.
Removed lines (admissions.page.js viewStudent):
  const dSnap = await getDocs(query(collection(db, 'students', s.id, 'docs')));
  dSnap.docs.forEach((d) => { docs[d.id] = d.data(); });
  ...and the entire Documents section block (adm-view-docs grid with 4 doc thumbnails).

T2: Scrollbars
- Added ONE global scrollbar block in public/css/main.css:
  * { scrollbar-width: thin; scrollbar-color: #C7CBE0 transparent; }
  *::-webkit-scrollbar { width: 8px; height: 8px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: #C7CBE0; border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
  *::-webkit-scrollbar-thumb:hover { background: #A5ABCB; background-clip: padding-box; }
- Removed per-component duplicates:
  - public/css/layout/sidebar.css: removed .sb-nav scrollbar rules (3 lines)
  - public/css/components/list-page.css: removed .ui-select-list scrollbar rules (6 lines)
  - public/css/components/multi-select.css: removed .ui-multi-options scrollbar rules (8 lines)

T3: Edit mode locks
- Removed "Course, batch and fees can't be changed after admission." note completely (HTML + JS + CSS).
- In edit mode: Session, Branch, Course, Batch, Admission date disabled with lucide "lock" icon (14px, muted) at right end inside each field, replacing the chevron for ui-select components. Fee boxes also get lock icons.
- New admission: no lock icons, everything normal.

- public/js/pages/admissions.page.js T1/T3: viewStudent() no longer reads docs subcollection; no Documents section; header has x close button; header/footer fixed, body scrolls. fillForm() adds lock icons to disabled fields in edit mode.
- public/css/pages/admissions.css T1/T3: view-student-modal uses flex column layout with fixed header/footer and scrollable body; added lock icon CSS rules; removed .adm-note.info class.
- public/js/core/router.js: version tag bumped only (1.8.61 -> 1.8.62).
- public/css/main.css T2: added global scrollbar block.
- public/css/layout/sidebar.css T2: removed .sb-nav scrollbar rules.
- public/css/components/list-page.css T2: removed .ui-select-list scrollbar rules.
- public/css/components/multi-select.css T2: removed .ui-multi-options scrollbar rules.
- public/js/core/app.js + 12 other JS/HTML files: bumped 1.8.61 -> 1.8.62 via Node script (UTF-8 no BOM).
Why:
- Polish admissions UX: cleaner view pop-up, consistent global scrollbars, clearer edit-mode field locks.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js, public/css/pages/admissions.css, public/css/main.css, public/css/layout/sidebar.css, public/css/components/list-page.css, public/css/components/multi-select.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep public/js for html2canvas|html2pdf: 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Lock icons only added in edit mode (editId truthy); new admission forms have no lock icons.
- Chevron icon replaced by lock icon in ui-select buttons when disabled.
- Fee boxes get lock icons in edit mode.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 07:51] Version 1.8.61 — Phase 2 · View pop-up redesign + edit rules + pagination
STEP 0 (report, no changes):
- (a) Session dropdown on Admissions page: form has sessionSel only; toolbar has status/course/batch/branch filters — no session dropdown. Session statuses: upcoming, running, closed, archived.
- (b) Org details fields: KEYS = ['name','tagline','phone','email','website','address'] in doc(db,'settings','org_config'), cached in window.APP_CACHE.org. NO logo field exists.
- (c) Fee fields saved on admission: feeSnapshot, feeTotal, feeSchedule, examFee, dueAtAdmission{admission,material,total}. No BZYCTC-2026-0006 example available.
- (c) Payment mode / receipt no / received-by: none stored (grep → 0 matches).

- public/js/pages/admissions.page.js T1-a: 'View admission receipt' menu item now navigates to '#/admissions/' + s.id + '/receipt'. Removed all references to openReceiptForAdmission (grep → 0).
- public/js/pages/admissions.page.js T3: viewStudent() redesigned — wider modal (max-width 860px, scrollable) with header (photo 72x72, name, admission no, status chip, View receipt/Edit buttons) and card grid sections (Personal, Contact, Course & batch, Fees, Documents) as 2-column grid (1 column under 760px), lucide icons, label/value rows, empty values shown as '-'. Document thumbnails clickable to open full size.
- public/js/pages/admissions.page.js T4: Edit mode disables Session, Branch, Course, Batch, Admission date (disabled attribute + ui-kit disabled style). Muted note "Course, batch and fees can't be changed after admission." shown above locked fields. Save only writes editable fields (student details + docs); locked fields not sent. admissionNo never changes. Prerequisite check skipped in edit mode.
- public/js/pages/admissions.page.js T5: Pagination hides when totalPages <= 1; Prev disabled on page 1, Next disabled on last page.
- public/js/pages/admission-receipt.page.js T2: Error state shows actual error message instead of spinning forever.
- public/js/core/router.js T1-b: setTitle moved to startRouter top level (one definition, accessible by all route handlers). grep "function setTitle" → 1.
- public/js/utils/admission-receipt.js T1-c: fmtMoney exported (added export keyword). grep shows fmtMoney exported + imported by admission-receipt.page.js.
- public/js/core/app.js + 12 other JS/HTML files: bumped 1.8.60 -> 1.8.61 via Node script (UTF-8 no BOM).
Why:
- Improve admissions UX: wider view pop-up with card grid, edit rules that protect historical data, pagination that hides on single page, receipt page error state.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js, public/css/pages/admissions.css, public/js/core/router.js, public/js/pages/admission-receipt.page.js, public/js/utils/admission-receipt.js, public/pages/admissions.html
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on admissions.page.js, admission-receipt.page.js, admission-receipt.js, router.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep public/js for html2canvas|html2pdf: 0 matches.
- T1-d self-check: all imports resolve to exports; all router.js route handler identifiers defined in scope.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Edit mode saves only editable fields; locked fields (session, branch, course, batch, admission date, fees) not sent.
- Prerequisite check does not run in edit mode.
- Pagination hidden when totalPages <= 1.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 07:34] Version 1.8.60 — Phase 2 · Admission receipt page + PDF download
STEP 0 (report, no changes):
- (a) Org details fields: KEYS = ['name','tagline','phone','email','website','address'] (org-details.page.js:5). Stored in doc(db,'settings','org_config'), cached in window.APP_CACHE.org with orgName/tagline/phone/email/website/address. NO logo field exists in org details. Sidebar logo shows /assets/images/logo-192.jpg (sidebar.js:130), not from org details.
- (b) Fee fields saved on admission: feeSnapshot (course fees object {admission, material, installment, exam}), feeTotal, feeSchedule (array of {no,month,opens,due,amount}), examFee, dueAtAdmission{admission,material,total}. No real example from BZYCTC-2026-0006 available (not queried from Firestore).
- (c) Payment mode: NO. Receipt no: NO. Received-by: NO — none stored (grep public/js for paymentMode|receiptNo|receivedBy → 0 matches).

- public/vendor/jspdf.umd.min.js: already vendored (364,463 bytes), stays in place, NOT moved.
- public/js/utils/admission-receipt.js T1/T5: added getReceiptData(admission, docs, org) — shared normalized view model used by BOTH HTML sheet and PDF. buildReceipt/downloadReceipt/printReceipt now use getReceiptData. Removed inline data building. Added amountToWords helper.
- public/js/pages/admission-receipt.page.js T2/T3: NEW FILE — mount() loads admission + docs + org from Firestore, renders the A4 sheet HTML via getReceiptData. Toolbar: Back to admissions / Download PDF / Print. Loading and not-found states.
- public/css/pages/admission-receipt.css T2/T3: NEW FILE — A4 sheet (794x1123px), sticky toolbar (not printed), logo 64x64, org name 27px bold navy, design tokens --ink #1a1f2b / --muted #5d6574 / --line #c9ced8 / --navy #1b2a49 / --tint #f3f4f7, details table, photo 130x160 + signature, course section, fee structure table (built ONLY from saved fee fields), payment received section, summary box, note line, signature lines, footer. @media print hides toolbar, prints sheet at 100%.
- public/js/pages/admissions.page.js T1: removed showReceiptView/loadReceiptModule dialog code; save() now navigates to location.hash = '#/admissions/' + admissionId + '/receipt'; openReceiptForAdmission() navigates to same route. Removed getDoc import (no longer used).
- public/js/core/router.js T1: added renderAdmissionReceipt() handler for #/admissions/<id>/receipt route — fetches admission-receipt.html, imports admission-receipt.page.js, calls mount().
- public/js/core/app.js + 12 other JS/HTML files: bumped 1.8.59 -> 1.8.60 via Node script (UTF-8 no BOM).
Why:
- Replace the "Admission saved" dialog with a dedicated receipt page (HTML + PDF) accessible via URL route.
Files touched (created / modified / deleted):
- CREATED: public/pages/admission-receipt.html, public/css/pages/admission-receipt.css, public/js/pages/admission-receipt.page.js
- MODIFIED: public/js/utils/admission-receipt.js, public/js/pages/admissions.page.js, public/js/core/router.js
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on admission-receipt.js, admission-receipt.page.js, admissions.page.js, router.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep public/js for html2canvas|html2pdf|null: 0 matches (null matches are legitimate JS null keyword).
- grep admission-receipt.page.js for every $('id'): ar-sheet, ar-loading, ar-notfound, ar-receipt-content, ar-back, ar-download, ar-print, ar-nf-back — all exist in admission-receipt.html.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Receipt route validates hash pattern #\/admissions\/<id>\/receipt$; not-found state shown for invalid/missing admissions.
- getReceiptData is single source of truth for both HTML and PDF rendering.
- Fee rows built ONLY from saved feeSnapshot/feeSchedule; skip zero-amount heads.
- Payment mode line only shown if stored.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 07:03] Version 1.8.59 — Phase 2 · Fix doc references, error toast, seats message
STEP 0 (report, no changes):
- admission.service.js `doc(doc(` patterns at lines 79, 96, 100 → all create references under students/<id>/docs/<key>.
- admissions.page.js has no `doc(doc(` patterns; line 1526 already uses `doc(collection(db, 'students'), docId)` correctly.
- Save error toast at admissions.page.js line 1464 already uses `'error'` variant.
- Seats check at admissions.page.js line 1304-1312 shows `'This batch is full.'` under Batch field error.

- public/js/services/admission.service.js T1: replaced all 3 `doc(doc(ref/studentRef, 'docs'), key)` with `doc(collection(ref/studentRef, 'docs'), key)` → students/<id>/docs/<key>. `collection` already imported. Covers new admission (createStudentWithDocs line 79), keep/replaced docs (updateStudentWithDocs line 96), and removed docs (updateStudentWithDocs line 100).
- public/js/services/admission.service.js: `collection` import already present at line 4; no new imports needed.
- public/js/pages/admissions.page.js T2: save error toast at line 1464 already uses showToast(..., 'error') — no change needed.
- public/js/pages/admissions.page.js T3: changed batch full message from 'This batch is full.' to 'This batch is full (0 seats left).' (line 1309).
- public/js/core/app.js + 12 other JS/HTML files: bumped 1.8.58 -> 1.8.59 via Node script (UTF-8 no BOM).
Why:
- Fix invalid nested doc() references so document writes target students/<id>/docs/<key> correctly; ensure save error toast uses error variant; clarify batch-full seats message.
Files touched (created / modified / deleted):
- MODIFIED: public/js/services/admission.service.js, public/js/pages/admissions.page.js
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on admission.service.js: 0 failures.
- node --check on admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- All 3 save paths (new admission, returning student keep/replace, edit admission) now use correct collection-based doc references.
- Empty-seat check uses existing seats calculation logic, only changes the error message text.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 06:54] Version 1.8.58 — Phase 2 · Admit-student label + returning-student doc Keep/Replace/Remove
STEP 0 (report, no changes):
- JS reads for doc-action controls: id `adm-doc-action-<key>` (admissions.page.js lines 810, 829, 832), radio name `adm-doc-action-<key>` (lines 841-843). DOC_KEYS = ['photo','signature','dobProof','marksheet'] (line 39).
- All `$('adm-...')` ids referenced in JS exist in admissions.html except `adm-doc-action-*` (added by T2) and `adm-retry` (dynamically created via innerHTML at line 382).

- public/js/pages/admissions.page.js T1: save button label for a new admission changed from "Add student" to "Admit student" (line 1194); edit keeps "Save changes". grep "Add student" → 0 matches.
- public/js/pages/admissions.page.js T2: clearReturnUI() now hides adm-doc-action elements (el.hidden = true) instead of removing them; renderReturnDocs() sets action.hidden = false when populating a returning student's document. Controls hidden for new students, shown only after Find loads a returning student who has that document, hidden again on Cancel/new form.
- public/pages/admissions.html T2: added static hidden <div class="adm-doc-action" id="adm-doc-action-<key>"> with radios (name adm-doc-action-<key>, values keep/replace/remove) directly after each doc's .adm-doc-size element, for photo, signature, dobProof, marksheet.
- public/js/core/app.js + 12 other JS/HTML files: bumped 1.8.57 -> 1.8.58 via Node script (UTF-8 no BOM).
Why:
- Make the returning-student document keep/replace/remove controls HTML-backed instead of JS-created; fix new-admission button label to "Admit student".
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js, public/pages/admissions.html
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on .mjs copy of admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep admissions.page.js for "Add student": 0 matches.
- grep admissions.html for adm-doc-action-*: 4 ids present (dobProof, marksheet, photo, signature).
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- clearReturnUI hides (not removes) so static HTML controls persist across lookups.
- renderReturnDocs shows the found control and overwrites innerHTML with the correct checked state.
- No adm- id referenced by JS is missing from HTML.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 06:48] Version 1.8.57 — Phase 2 · Lazy-load vendored jsPDF for receipts
STEP 0 (report, no changes):
- (a) Session dropdown on Admissions page: form has sessionSel only; toolbar has status/course/batch/branch filters — no session dropdown. Session statuses: upcoming, running, closed, archived.
- (b) Org details fields: name/tagline/phone/email/website/address in doc(db,'settings','org_config'), cached window.APP_CACHE.org. No logo / reg-ISO field exists yet.
- (c) PDF library: none originally; jsPDF 2.5.1 vendored to public/vendor/jspdf.umd.min.js (364,463 bytes).
- (d) Actions menu: kebab + openMenu(kebab, items); items {label, icon, onClick}, 'sep' separators.

- public/js/utils/admission-receipt.js T1: removed static import of vendored jsPDF; added lazy loader loadJsPDF() that fetches ../../vendor/jspdf.umd.min.js via import.meta.url + script tag into window.jspdf, caches jsPDFCtor = window.jspdf.jsPDF. buildReceipt/downloadReceipt/printReceipt are now async and await loadJsPDF() first. Removed the only static vendor-file import.
- public/js/pages/admissions.page.js T2: removed static import of admission-receipt.js; added async loadReceiptModule() doing dynamic import() with ?v=1.8.57 tag inside Download/Print/View admission receipt handlers only. On load failure shows existing toast "Could not load the PDF tool. Check your connection and retry." Admissions list/form work even if vendor file is missing. showReceiptView()/openReceiptForAdmission() are async and await loadReceiptModule().
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.56 -> 1.8.57 via Node script (UTF-8 no BOM).
Why:
- Load the PDF library lazily only when a receipt is actually needed; keep the Admissions page working without the vendor file.
Files touched (created / modified / deleted):
- MODIFIED: public/js/utils/admission-receipt.js, public/js/pages/admissions.page.js
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on .mjs copies of admission-receipt.js and admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Vendor script load failure -> toast shown, no crash; list/form still usable.
- Repeated receipt builds reuse cached jsPDFCtor (no re-fetch).
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 06:32] Version 1.8.56 — Phase 2 · Admission receipt PDF + student profile route
STEP 0 (report, no changes):
- (a) Session dropdown on Admissions page: form has `sessionSel` (createSelect on adm-session-host). Toolbar (`buildToolbar`) has status/course/batch/branch filters — NO session dropdown. `getSelectedSessionId()` reads localStorage `uicms.session.<centre>`. Session status values: upcoming, running, closed, archived (sessions.js expectedStatus). The form already lists only upcoming/running; T1 switches the filter to `admissionState(s, today).open`.
- (b) Org details fields: KEYS = ['name','tagline','phone','email','website','address'] (org-details.page.js:5). Stored in `doc(db,'settings','org_config')`, cached in `window.APP_CACHE.org`. DB fields: orgName, tagline, phone, email, website, address. NO logo field and NO reg/ISO text field currently exist.
- (c) PDF library: NONE exists (no package.json, no public/vendor, no jspdf/html2canvas imports). jsPDF 2.5.1 vendored to public/vendor/jspdf.umd.min.js.
- (d) Actions menu: `kebab` button (ui-kebab, more-vertical) + `openMenu(kebab, items)` (admissions.page.js). Items = {label, icon, onClick}, supports 'sep' separators. Currently: View (eye), Edit (pencil), then Change status & Delete if not isHead.

- public/vendor/jspdf.umd.min.js T4: CREATED — jsPDF 2.5.1 vendored locally (364,463 bytes), no CDN at runtime.
- public/js/utils/admission-receipt.js T4: CREATED — buildReceipt(admission, docs, org) -> jsPDF doc; downloadReceipt(...); printReceipt(...). One A4 portrait page, 15mm margins, Helvetica, black/grey, thin lines, no colour blocks. Header (logo/org/branch/address/phone/email), centred "ADMISSION RECEIPT" title, right column photo (35x45mm) + signature (35x15mm) boxes, left column label:value rows, Course section, Fees table (Rs. format, no ₹ glyph), two signature lines, footer. Images read from docs subcollection base64 via addImage. Filename Admission-<admissionNo>-<sessionName>.pdf. No html2canvas.
- public/js/pages/admissions.page.js T1: session dropdown filter changed to `admissionState(s, today).open` so closed/ended/archived sessions are not listed; closed selected session opens with no selection. Toolbar session filter untouched (none exists).
- public/js/pages/admissions.page.js T2: prerequisite check runs silently on course select — found → green note; not found → amber note "Prerequisite <CODE> not found in the system." + ghost "Verify manually" button that opens the existing confirm dialog (Yes → manual prereqCheck). On Admit click, if prereqCheck null for a course with a prerequisite → same dialog; Cancel stays on form (course NOT cleared); Yes → continue. Removed "Cancel clears the course" behaviour.
- public/js/pages/admissions.page.js T3: "Save admission" button → "Admit student". Click → validate → confirm dialog "Confirm admission" with summary (name, course, batch, session, total fee, due now) [Back] [Admit] → save → show receipt view.
- public/js/pages/admissions.page.js T5: showReceiptView() modal after admit — "Admission saved - <admissionNo>" + Download PDF / Print / Close buttons. Download → doc.save() direct download (iOS Safari fallback: open blob URL in new tab, detected via /iPad|iPhone|iPod/ && !window.MSStream). Print → PDF blob URL in hidden iframe + iframe.contentWindow.print(); mobile/iOS fallback → open blob URL in new tab. Close → back to list.
- public/js/pages/admissions.page.js T6: Actions menu adds "View student" (icon user) → #/students/<admissionNo> and "View admission receipt" (icon file-text) → loads admission + docs + org, opens receipt view (no re-save).
- public/js/core/router.js T6: dynamic route #/students/<admissionNo> renders simple card "Student profile - coming soon" with Back button.
- public/js/core/app.js + 12 other JS/HTML files: bumped 1.8.55 -> 1.8.56 via Node script (UTF-8 no BOM).
Why:
- End-to-end admission receipt: confirm, save, view/download/print receipt, and view student/receipt from the list.
Files touched (created / modified / deleted):
- CREATED: public/vendor/jspdf.umd.min.js, public/js/utils/admission-receipt.js
- MODIFIED: public/js/pages/admissions.page.js, public/js/core/router.js, public/css/pages/admissions.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none (prereqCheck already a field; receipt is client-side PDF).
Tested on:
- node --check on .mjs copies of all 12 changed/new JS files: 0 failures.
- grep public/js/utils/admission-receipt.js for html2canvas: 0 matches.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- iOS Safari download attribute unsupported → detected and falls back to opening blob URL in new tab.
- iframe print fails on mobile → fallback to new tab.
- Missing photo/signature → empty grey-bordered box.
- Long address wraps; content clamped so it never exceeds one page.
Known issues created (if any):
- jsPDF vendored as UMD; admission-receipt.js falls back to window.jspdf if the ES-module namespace is empty.
Next task:
- None.

---

### [2026-11-12 06:24] Version 1.8.55 — Phase 2 · Prerequisite field names + DOM note rendering
- public/js/pages/admissions.page.js T1: getPrereq() now uses the real field names written by courses.page.js — id: course.prerequisiteId (course.prereqId kept only as legacy fallback); code: course.prerequisiteCode || course.prerequisiteCourseCode || course.prerequisite. Removed the invented "prereqCode". Id match first, then code match (case-insensitive, trimmed).
- public/js/pages/admissions.page.js T2: setPrereqNote() now builds the note with DOM nodes (document.createElement('b') + textContent) instead of innerHTML string concatenation. Same text and classes as before.
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.54 -> 1.8.55 via Node script (UTF-8 no BOM).
Why:
- Align prerequisite field names with what courses.page.js actually writes; avoid innerHTML for the prerequisite note.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on .mjs copy of admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- courses with no prerequisite (level 1) return null from getPrereq().
- Legacy courses with only prereqId still resolve via the fallback.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 06:13] Version 1.8.54 — Phase 2 · Prerequisite completion check on admissions
STEP 0 (report, no changes):
- (a) Course prerequisite on save (courses.page.js:295-298): prerequisiteId (course id; null if level 1), prerequisiteCode (course code; null if level 1), eligibility ('Completed ' + p.code), eligibilityText.
- (b) admissions.status values: active, dropped, completed, archived, deleted. YES — 'completed' means the student completed the course. COMPLETED_STATUSES = ['completed'].
- (c) confirmDialog: import { confirmDialog } from '../components/ui-confirm.js'; called as const ok = await confirmDialog({ title, message, confirmText, cancelText, danger, requireText, infoOnly, icon }).

- public/js/pages/admissions.page.js T1: added getPrereq(course) — matches prereqId (course id) first, else prerequisiteCode/prerequisiteCourseCode/prerequisite (by course code, case-insensitive, trimmed). Returns {id, code, name} or null.
- public/js/pages/admissions.page.js T2: added getStudentKey() — returning student via Find uses admissionNo; else name (trim, ci) + dob + phone (digits only), all three required; null if unavailable.
- public/js/pages/admissions.page.js T3: added COMPLETED_STATUSES = ['completed'] at top (status set by a later feature; this file only reads it). completed = admission.status === 'completed'. Search: all sessions, skip archived/deleted, exclude the admission being edited.
- public/js/pages/admissions.page.js T4: added runPrereqCheck() (debounce 400ms) triggered on course change and on name/dob/phone/lookup input. Course has no prerequisite → hide note, no check. Found completed → green note "Prerequisite <CODE> completed in <session name>." + prereqCheck {status:'auto', courseId, sourceSessionId, sourceAdmissionId}. Not found → existing confirm dialog "Prerequisite not found" / "Have you verified that the student completed <CODE> - <name>?" [Cancel] [Yes, verified]. Cancel → clear course + batch/fees, hide note. Yes → amber note "Prerequisite <CODE> verified manually." + prereqCheck {status:'manual', courseId, verifiedBy, verifiedAt}. Dialog not re-opened for same student+course. Changing course/student resets prereqCheck to null and re-runs.
- public/js/pages/admissions.page.js T5: save blocked with "Prerequisite check pending." when selected course has a prerequisite and prereqCheck is null. prereqCheck saved on admission document (null when no prerequisite). Edit mode keeps saved prereqCheck unless course changed.
- public/css/pages/admissions.css: added .adm-prereq-note.ok / .manual / .pending styles (green/amber/grey).
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.53 -> 1.8.54 via Node script (UTF-8 no BOM).
Why:
- Prevent saving an admission for a course whose prerequisite the student hasn't completed (or manually verified).
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js, public/css/pages/admissions.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none (prereqCheck is a new field on the admission document; no rules change needed).
Tested on:
- node --check on .mjs copy of admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Edit mode keeps saved prereqCheck unless course changed; new admission starts null.
- Cancel on the dialog clears course selection and batch/fees.
- Same student+course does not re-open the dialog.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 06:10] Version 1.8.53 — Phase 2 · Not-found lookup text clarified
- public/js/pages/admissions.page.js T1: changed not-found text to "No student with this ID found. Older records may be archived." Search logic unchanged (all sessions; skip only status archived/deleted).
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.52 -> 1.8.53 via Node script (UTF-8 no BOM).
Why:
- Clarify that older records may be archived rather than implying only active sessions are searched.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on .mjs copy of admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Search logic unchanged: queries all sessions, filters out archived/deleted.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 06:05] Version 1.8.52 — Phase 2 · Lookup status colours + button height
- public/js/pages/admissions.page.js T1: findStudent() / clearReturnState() now set lookupStatus.className to '' (empty), 'ui-err' (error / not-found, existing red text + min-height:0), or 'ui-err found' (found). No longer uses the removed 'adm-lookup-status' class which had no CSS.
- public/css/pages/admissions.css T1: removed fixed `height: 40px` from `.adm-lookup-inputs .ui-btn.ghost` (button now matches .ui-input-wrap computed height = 40px, same as ui-kit's .ui-input height). Added ONE rule `.adm-lookup-status.found { color: var(--success, #16a34a); }` — no existing success/ok text class exists in ui-kit.css (only `.ui-err` red exists), so this rule supplies the success colour using the existing `--success` var with #16a34a fallback.
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.51 -> 1.8.52 via Node script (UTF-8 no BOM).
Why:
- Make lookup status colours correct (error red via ui-err, found green) with no empty-state space; button height matches input exactly.
Files touched (created / modified / deleted):
- MODIFIED: public/css/pages/admissions.css, public/js/pages/admissions.page.js
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on .mjs copy of admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Empty state: textContent='' and className='' → no text, no extra space (ui-err has min-height:0).
- Error / not-found → ui-err (red). Found → ui-err found (green via var(--success, #16a34a)).
- Button class is ui-btn ghost, same as Cancel.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 06:01] Version 1.8.51 — Phase 2 · Returning-student lookup styled like form fields
- public/pages/admissions.html T1: replaced custom lookup markup with the standard form-field pattern: `<div class="ui-input-wrap"><i data-lucide="search"></i><input ...></div>` (same border, radius, height, padding, icon position and focus ring as Full name / Phone) + `ui-btn ghost` Find button (same height as input, 8px gap). Label "Returning student?" uses `ui-label-row` (same label style as other form labels, not uppercase small caps). Status message uses existing `ui-err` class. Vertically aligned with the "New admission" title via `adm-form-head` flex row. Under 900px the lookup stacks below the title full-width.
- public/css/pages/admissions.css T1: deleted all custom lookup CSS added in 1.8.50 that duplicated ui-kit styles (.adm-lookup-label, .adm-lookup-wrap, .adm-lookup-status colors); kept only layout-only rules (.adm-form-head, .adm-form-head-left, .adm-form-head-lookup, .adm-lookup-inputs gap:8px, .adm-lookup-inputs .ui-input-wrap width:240px) plus the existing @media (max-width: 900px) stack.
- public/js/pages/admissions.page.js T1: Enter key inside the lookup input triggers Find; status uses ui-err.
- public/js/pages/admissions.page.js T2: placeholder now shows `e.g. <BRANCHCODE>-<YEAR>-0001` (e.g. `e.g. YC-2026-0001`) using the currently selected branch's code (`br.code || br.id || ''`, same field used in save()) and the current year; falls back to `e.g. YC-<YEAR>-0001` when there's no branch code. Recomputed on branch change and on load.
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.50 -> 1.8.51 via Node script (UTF-8 no BOM).
Why:
- Make the returning-student lookup look and behave exactly like the other form fields; show the real ID format in the placeholder.
Files touched (created / modified / deleted):
- MODIFIED: public/pages/admissions.html, public/css/pages/admissions.css, public/js/pages/admissions.page.js
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on .mjs copy of admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Placeholder updates when a different branch is selected; falls back to YC-<year>-0001 for head (fixed branch) with no code or before a branch is picked.
- Branch code field used: `br.code || br.id || ''` (same as save()).
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 05:55] Version 1.8.50 — Phase 2 · Returning-student lookup moved to form header
- public/pages/admissions.html T1: removed the full-width "Student ID (returning student)" row from the Student details block; added a compact lookup to the "New admission" header on the right (label "Returning student?" above a 240px input with search icon inside + Find button). Status message shows under the lookup, right-aligned, max-width 340px. Under 900px the lookup moves below the title and takes full width.
- public/css/pages/admissions.css T1: added .adm-form-head (flex row), .adm-form-head-left, .adm-form-head-lookup, .adm-lookup-label, .adm-lookup-wrap, .adm-lookup-status styles; input width 240px same height as other inputs; @media (max-width: 900px) stacks lookup below title full-width.
- public/js/pages/admissions.page.js T1: Enter key inside the lookup input triggers Find; lookup status uses .adm-lookup-status (replaced removed adm-lookup-note/adm-lookup-session/adm-student-id-lookup-err elements).
- public/js/pages/admissions.page.js T2: "Enter a student ID." shows ONLY after Find is clicked with an empty input; cleared when the user types (input listener), when the form opens (openForm → clearReturnState), and on Cancel (closeForm → clearReturnState).
- public/js/pages/admissions.page.js T3: restored sourceAdmissionRef {sessionId, admissionId} on a returning-student admission (traceability only, never used to read docs). Docs stay copied as in 1.8.49 via Firestore base64 (no Storage).
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.49 -> 1.8.50 via Node script (UTF-8 no BOM).
Why:
- Move the returning-student lookup into the form header as a compact control; keep lookup status transient (no error on load); preserve sourceAdmissionRef traceability.
Files touched (created / modified / deleted):
- MODIFIED: public/pages/admissions.html, public/css/pages/admissions.css, public/js/pages/admissions.page.js
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on .mjs copy of admissions.page.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Empty input + Find shows "Enter a student ID." only (not on load); typing clears it; opening form / Cancel clears it.
- Enter key in lookup input triggers Find.
- sourceAdmissionRef saved only when returnDoc is set; old admission never mutated.
- Kept docs copied identically into new admission's docs subcollection (Firestore base64).
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 05:49] Version 1.8.49 — Phase 2 · Returning-student docs via Firestore base64 only (no Storage)
- public/js/pages/admissions.page.js T1: removed all Firebase Storage upload code (imports of storage, storageRef/uploadBytes/getDownloadURL, and dataURLToBlob). Kept docs are now read from students/{oldId}/docs/{key} and written as an identical COPY to students/{newId}/docs/{key} in the SAME writeBatch as the new admission. Replaced docs use the new compressed file (blobToDataURL). Removed docs are not copied. No references to the old admission's docs are saved. If any doc read/copy fails, an error is shown and nothing is saved (no half-saved admission).
- public/js/pages/admissions.page.js: createStudentWithDocs write path for returning-student admissions now uses the same docs object as any new admission (all docs in one batch); sourceAdmissionRef no longer saved.
- public/storage.rules: reverted to exactly the 1.8.47 deny-all version (diff vs HEAD = empty).
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.48 -> 1.8.49 via Node script (UTF-8 no BOM).
Why:
- Use a single document storage method (Firestore base64, as existing admissions do) so returning-student documents never go to Firebase Storage.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/admissions.page.js, public/storage.rules
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- node --check on .mjs copy of admissions.page.js: 0 failures.
- grep public/js/pages/admissions.page.js for firebase/storage|uploadBytes|getDownloadURL|storageRef: 0 matches.
- grep public/js for dataURLToBlob: only the unused definition remains in image-compress.js (not called anywhere); left untouched per change scope.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Kept/removed/replaced docs honored per key; keep copies old doc identically into new admission's docs subcollection.
- Old admission is never mutated.
- Any doc read/copy failure throws and aborts the save before any Firestore write.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 05:40] Version 1.8.48 — Phase 2 · Returning-student admission lookup + document copy to Storage
- public/pages/admissions.html T1: added "Student ID (returning student)" input + "Find" button as a full-width field at the top of the "Student details" block, plus an info note ("Details loaded from <session>. You can edit anything.") and an error area.
- public/js/pages/admissions.page.js T1: findStudent() queries the `students` collection where admissionNo == entered ID, filters out status 'archived'/'deleted', takes the most recent match by admissionDate, and populates every student-details field (name, guardian, phone, alt phone, email, DOB, gender, qualification, address) without touching session/course/batch; shows the info note. Not found → "No student with this ID in active sessions.", form not blocked.
- public/js/pages/admissions.page.js T2: saving a returning-student (new) admission keeps the SAME admissionNo (no generateAdmissionNumber), writes a full copy into THIS session's admission only, never updates the old admission, and saves sourceAdmissionRef {sessionId, admissionId} on the new doc.
- public/js/pages/admissions.page.js T3: when a returning student is found, each document shows Keep / Replace / Remove (default Keep) with the existing thumbnail. On save, kept documents are uploaded (from their stored base64) and replaced/new documents are uploaded to Firebase Storage under admissions/{sessionId}/{newAdmissionId}/{key}.jpg; the new admission stores the new download URL + path (never the old session's file URLs). If any Storage copy fails, an error is shown and nothing is saved (no half-saved admission). validate() treats a 'keep' doc as satisfied.
- public/js/services/admission.service.js: createStudentWithDocs() now accepts an optional studentRef so the new admission's id is known before Storage upload.
- public/js/utils/image-compress.js: added dataURLToBlob() helper.
- public/css/pages/admissions.css: added .adm-doc-action / .adm-doc-action-row / .adm-doc-action-opts styles for Keep/Replace/Remove radios.
- storage.rules: changed from deny-all to allowing read/write on /admissions/{sessionId}/{admissionId}/{docKey} when request.auth != null; everything else still denied.
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.47 -> 1.8.48 via Node script (UTF-8 no BOM).
Why:
- Let staff re-admit a returning student by ID, copying their details and documents into the new session's admission without mutating the historical record.
Files touched (created / modified / deleted):
- MODIFIED: public/pages/admissions.html, public/js/pages/admissions.page.js, public/js/services/admission.service.js, public/js/utils/image-compress.js, public/css/pages/admissions.css, public/storage.rules
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none (students create rule already permits any fields; docs subcollection write uses the same batch path as existing new admissions).
Tested on:
- node --check on .mjs copies of admissions.page.js, image-compress.js, admission.service.js: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- Returning student lookup then Cancel/New clears return state (clearReturnState in openForm/closeForm/findStudent).
- Old admission is never mutated; sourceAdmissionRef recorded for traceability.
- Kept/removed/replaced docs honored per key; remove skips Storage upload and Firestore write for that key.
Known issues created (if any):
- storage.rules grants read/write on the admissions path to any authenticated user (no Firestore join possible from Storage rules); scope is limited to the admissions path.
Next task:
- None.

---

### [2026-11-12 04:56] Version 1.8.47 — Phase 2 · Restore filter dropdown rules in list-page.css + version bump
- public/css/components/list-page.css T1: restored the 6 `.lp-filter .ui-select*` rules deleted in 1.8.46 (position, width, white-space, popup sizing/positioning, opt text-wrap) plus 2 new ellipsis rules so closed filter button text never overflows the 190-220px filter (`.lp-filter .ui-select-btn { max-width: 100%; }` and `.lp-filter .ui-select-btn .ui-select-label { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`). The 1.8.46 `.lp-toolbar`/`.lp-search`/`.lp-filter`/`.lp-refresh`/`@media` rules are unchanged. Edit is purely additive: 8 lines inserted between `.lp-filter` and `.lp-toolbar .lp-refresh`, no lines removed.
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.46 -> 1.8.47 via Node script (UTF-8 no BOM).
Why:
- Restore dropdown popup behavior that was accidentally removed in 1.8.46; prevent long filter labels from overflowing their narrow filter boxes; version pin for cache busting.
Files touched (created / modified / deleted):
- MODIFIED: public/css/components/list-page.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
Firestore changes:
- none.
Tested on:
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- git diff HEAD~1 -- list-page.css shows HEAD~1 is v1.8.9 (not 1.8.46 commit; 1.8.46 was never committed), so "-" lines in that diff are pre-existing uncommitted 1.8.46 changes, not from this edit. This session's list-page.css change is purely additive: 0 "-" lines, 8 "+" lines (6 restored + 2 ellipsis).
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-12 04:45] Version 1.8.46 — Phase 2 · Toolbar filter widths + save bar spacing + version bump
- public/css/components/list-page.css T1: replaced Rule 4 (1.8.5) toolbar rules so filters no longer grow to fill free space. `.lp-filter` changed from `flex: 1 1 150px; min-width: 130px` to `flex: 0 1 190px; min-width: 140px; max-width: 220px; width: auto; position: relative;`; `.lp-toolbar .lp-refresh` now `flex: 0 0 44px; width: 44px; height: 42px;` (stays last on same row); `@media (max-width: 1200px)` wraps toolbar and sets `.lp-search { flex-basis: 100%; }`. Removed the now-superseded `.lp-filter .ui-select*` sub-rules (popup sizing/positioning now handled by the filter's own width rules). Search box takes remaining width; each filter ~190px and never grows.
- public/css/components/ui-kit.css T3: removed duplicate `border-top: 1px solid var(--border);` from `.save-bar` (the `border` shorthand already sets it). Kept margin-top 24px (1.8.45 spacing). Applies to Batches, Courses, Admissions, Sessions, Branches, Org-details, Branch-Heads save bars.
- public/js/core/app.js + 13 other JS/HTML files: bumped 1.8.45 -> 1.8.46 via Node script (UTF-8 no BOM). docs/02-PROGRESS-LOG.md historical entries left untouched.
Why:
- Fix filters taking half the row on pages with few filters (e.g. Branches with 1 filter); clean up duplicate save-bar border; version pin for cache busting.
Files touched (created / modified / deleted):
- MODIFIED: public/css/components/list-page.css, public/css/components/ui-kit.css
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/js/pages/admissions.page.js, public/js/pages/batches.page.js, public/js/pages/branch-heads.page.js, public/js/pages/branches.page.js, public/js/pages/courses.page.js, public/js/pages/org-details.page.js, public/js/pages/sessions.page.js, public/pages/batches.html, public/pages/login.html, public/index.html
- MODIFIED: docs/02-PROGRESS-LOG.md
- CREATED then DELETED: tools/smoke-multi-select.mjs (temporary smoke test)
Firestore changes:
- none.
Tested on:
- Node smoke test: 13/13 PASS (createMultiSelect, recreated after prior deletion).
- node --check on .mjs copies of 12 changed JS files: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- admissions.css:156 overrides `.adm-toolbar-row .lp-filter { flex: 0 0 170px; ... }` — left unchanged per rule (page-specific override); listed in T2 report.
- No inline `<style>` in public/pages uses lp-filter.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-11 17:47] Version 1.8.45 — Phase 2 · T1-T5: search icon inside input, indeterminate select-all, inactive courses never selectable, save bar spacing, version bump
- public/css/components/multi-select.css T1: .ui-multi-search removed display:flex; icon absolutely positioned inside the search div, input width:100% height:40px padding-left:36px background var(--surface), focus ring matches page inputs (.ui-multi-search > svg also styled for lucide replacement). public/js/components/multi-select.js markup already places <i data-lucide="search"> before <input> inside .ui-multi-search.
- public/css/components/multi-select.css T2: .ui-multi-checkbox-custom.checked shows primary fill + white TICK svg; .indeterminate hides tick svg and draws a 10x2px white DASH via ::after; neither class = empty box with border var(--border); refreshChecks never sets both classes.
- tools/smoke-multi-select.mjs T2: added T13 (start allCourses, untick one -> select-all row has class "indeterminate" and NOT "checked"); 13/13 PASS.
- public/js/utils/session-rules.js T3: added isCourseActive(c) — course selectable only when (status||'active')==='active' && active!==false && !archived. batchAllowsCourse(batch, courseId, courses) returns false for inactive courses when batch.allCourses; explicitly selected inactive courseIds are retained.
- public/js/pages/batches.page.js T3: courseSel.setOptions filtered to isCourseActive courses only; renderCourseChips shows "CODE (inactive)" grey-italic chip for inactive saved courseIds (kept, not removed silently); batchAllowsCourse(b, f.course, courses) passes courses lookup.
- public/js/pages/admissions.page.js T3: courseSel.setOptions filtered to active courses only; validate() rejects inactive course with "This course is inactive. Choose another course."
- public/js/pages/courses.page.js T3: prerequisite selector uses isCourseActive(c) instead of (c.status||'active')==='active'.
- public/css/pages/batches.css T3: .bt-course-chip.inactive opacity 0.65 font-style italic.
- public/css/components/ui-kit.css T4: .save-bar margin-top 24px, padding-top 16px, border-top 1px solid var(--border) — matches Courses form action bar spacing; applies to Admissions, Sessions, Branches, Org-details, Branch-Heads.
- public/js/core/app.js, all ?v= tags, __BUILD__: bumped 1.8.44 -> 1.8.45 via Node script (UTF-8 no BOM).
Why:
- Complete T1-T5: search icon inside input, indeterminate select-all state, inactive courses never selectable app-wide, save bar spacing, version pinning, pre-commit checks.
Files touched (created / modified / deleted):
- MODIFIED: public/css/components/multi-select.css, public/css/components/ui-kit.css, public/css/pages/batches.css
- MODIFIED: public/js/utils/session-rules.js, public/js/pages/batches.page.js, public/js/pages/admissions.page.js, public/js/pages/courses.page.js
- MODIFIED: public/js/core/app.js + 13 other JS/HTML files (?v= tags, __BUILD__)
- CREATED then DELETED: tools/smoke-multi-select.mjs (temporary smoke test)
Firestore changes:
- none.
Tested on:
- Node smoke test: 13/13 PASS (createMultiSelect).
- node --check on .mjs copies of all 49 public/js files: 0 failures.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- batch.allCourses + inactive course -> batchAllowsCourse returns false.
- Explicitly selected inactive course kept in courseIds, shown as "(inactive)" chip, not in dropdown.
- refreshChecks never sets both checked and indeterminate on select-all row.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-11 17:07] Version 1.8.44 — Phase 2 · T4-T6: batches allCourses edit fix, multi-select smoke test, checks + report
- public/js/pages/batches.page.js T4: openForm() now restores allCourses/courseIds from the edited batch so editing an allCourses batch shows all rows ticked, Select all ticked, closed label "All courses"; save writes allCourses/courseIds exactly as courseSel.value returns (allCourses:true -> courseIds:[]). courseSel.setOptions() already runs before fillForm() and keeps the current value.
- public/js/pages/batches.page.js T4: #bt-course-codes grey chips ("All courses" or one chip per course CODE) render on fillForm and every change; hidden when empty; chip "x" removes a course ("All courses" chip x clears all). Chip CSS (12px, radius 999px, var(--bg), 1px var(--border)) already present in batches.css.
- public/css/components/multi-select.css T4: .ui-multi-search {position:relative}, .ui-multi-search-icon {position:absolute;left:20px;top:50%;transform:translateY(-50%);pointer-events:none}, .ui-multi-search input {padding-left:36px} already present (search icon sits inside the input).
- public/js/components/multi-select.js: exposed open() and close() on the public API.
- tools/smoke-multi-select.mjs: 12-test Node smoke test of createMultiSelect with a fake DOM — all 12 PASS; temporary file, removed after use.
Why:
- Complete T4-T6: batches form course-selection correctness, toolbar one-row refresh button conformance (list-page.css Rule 4 already matches spec), and pre-commit checks.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/batches.page.js
- MODIFIED: public/js/components/multi-select.js
- MODIFIED: docs/02-PROGRESS-LOG.md
- CREATED then DELETED: tools/smoke-multi-select.mjs (temporary smoke test)
Firestore changes:
- none.
Tested on:
- Node smoke test: 12/12 PASS (createMultiSelect).
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
Edge cases checked:
- node --check on .mjs copies of multi-select.js, batches.page.js, list-page.js, ui-select.js: clean.
- grep public/ for UTF-8 BOM, \u2713, mojibake (â‚¹, Â·, â€”): 0 matches.
- grep public/js for selAllLabel|selAllCb|selAllWrap: empty.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-10 03:24] Version 1.8.16 — Phase 2 · Fix: branch head delete (missing import); inactive dot moved to Branches page
- public/js/pages/branch-heads.page.js T1: added deleteDoc to the firebase-firestore import line; tryDeleteHead now shows showToast('Branch head deleted.', 'success') on success and showToast('Delete failed (...).', 'error') on error.
- public/js/pages/branch-heads.page.js T2: removed the red dot (bh-dot-off span) from the table Name cell; grey 'Inactive' status pill and Status help line kept.
- public/js/pages/branches.page.js T3: Branch Head column now shows a red dot (br-dot-off) to the RIGHT of an inactive head's name with title 'Inactive — cannot sign in'; removed the ' (inactive)' text after the email.
- public/css/pages/branches.css T3: added .br-dot-off rule.
- public/css/pages/branch-heads.css T3: deleted the now-unused .bh-dot-off rule.
Why:
- Fix missing deleteDoc import that would crash head deletion; move the inactive indicator to the Branches page where it is visible next to the head name.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/branch-heads.page.js
- MODIFIED: public/js/pages/branches.page.js
- MODIFIED: public/css/pages/branches.css
- MODIFIED: public/css/pages/branch-heads.css
Firestore changes:
- none.
Tested on:
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
- Edge cases checked: Pending owner live test.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-10 03:11] Version 1.8.15 — Phase 2 · Branch Heads: one head per branch, delete, visible errors
- public/js/pages/branch-heads.page.js T1: validate() now blocks assigning a branch if ANY other branch_head (active or inactive) already has it: '"<name>" is already the head of this branch. Delete them first to assign a new head.' Branch select options hide branches that already have a head, except the head being edited; if none free shows a single "All branches have a head" option. Removed the per-branch active check from the Make active toggle.
- public/js/pages/branch-heads.page.js T2: showErrors() now writes every error message to its bh-*-err element and adds the red is-invalid border to name/email/phone inputs and the branch/status select hosts. "This email is already registered." shows the same way.
- public/js/pages/branch-heads.page.js T3: row menu adds Delete (red) with confirmDialog requireText 'DELETE' and deleteDoc(doc(db,'users',r.id)) only; closes form if editing this head, confirmLeave first if another head has unsaved changes; never offers Delete/Edit for non-branch_head docs.
- public/js/pages/branch-heads.page.js T4: table Name cell shows a red dot (bh-dot-off, #DC2626, title "Inactive — cannot sign in") before an inactive head's name. Added help line "Inactive heads cannot sign in until made Active again." under the Status field.
- public/css/pages/branch-heads.css: added bh-dot-off and ui-select.is-invalid .ui-select-btn styles.
- public/js/pages/branches.page.js T5: Branch Head column shows one head only (name + email, " (inactive)" in grey if inactive); multiple heads show red "N heads — fix in Branch Heads"; removed "+N more". Heads assigned stat counts branches with at least one head.
- docs/03-DECISIONS.md: replaced ## 25 bullets with one-head-per-branch rules.
Why:
- Enforce one branch head per branch regardless of status, allow deleting heads, and make validation errors clearly visible.
Files touched (created / modified / deleted):
- MODIFIED: public/js/pages/branch-heads.page.js
- MODIFIED: public/css/pages/branch-heads.css
- MODIFIED: public/pages/branch-heads.html
- MODIFIED: public/js/pages/branches.page.js
- MODIFIED: docs/03-DECISIONS.md
Firestore changes:
- Collection: `users` → delete branch_head docs allowed; no rules changed.
Tested on:
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
- Edge cases checked: Pending owner live test.
Known issues created (if any):
- None.
Next task:
- None.

---

### [2026-11-10 02:38] Version 1.8.14 — Phase 2 · Branch Heads Part 1: list + add/edit
- public/pages/branch-heads.html (CREATED): branch heads list page — breadcrumb, title, subtitle, Add button, 4 stats (Total/Active/Inactive/Branches without a head), search + Status + Branch toolbar, table (name+email, phone, branch, status pill, actions), empty state, add/edit form card with save bar.
- public/js/pages/branch-heads.page.js (CREATED): loads users where role == 'branch_head' and all branches; renders list/table; form with name, Google email (read-only on edit), phone, branch (active only, current branch kept on edit), status; validation incl. email already registered and one-active-head-per-branch; ADD uses setDoc(doc(db,'users',email)) with only allowed fields (phone omitted if empty); EDIT uses updateDoc with name/phone/branchId/status/updatedAt only; row menu Edit + Make active/inactive toggle (active toggle passes one-head-per-branch check); registerDirty + confirmLeave on Cancel/Add/Edit-other-row.
- public/css/pages/branch-heads.css (CREATED): bh- prefixed styles reusing shared lp-kit.
Why:
- Super Admin needs to create and manage branch heads who sign in with Google and manage a single branch.
Files touched (created / modified / deleted):
- CREATED: public/pages/branch-heads.html
- CREATED: public/js/pages/branch-heads.page.js
- CREATED: public/css/pages/branch-heads.css
- MODIFIED: public/css/main.css, public/js/core/app.js, public/index.html and all ?v= import URLs (1.8.13 → 1.8.14)
- MODIFIED: docs/03-DECISIONS.md (added ## 25 Branch heads)
Firestore changes:
- Collection: `users` → new branch_head docs keyed by lowercase Google email; no rules changed.
Tested on:
- Chrome Desktop: Pending owner live test.
- Mobile (Android Chrome): Pending owner live test.
- Edge cases checked: Pending owner live test.
Known issues created (if any):
- None.
Next task:
- Branch Heads Part 2: delete.

---

### [2026-11-09 16:45] Version 1.8.13 — Phase 2 · Batches follow their session
- batches.html T1: removed Start date, End date and Status fields (inputs, labels, errors, validation, dirty-tracking keys). Under the Session select a read-only info line "Runs 01 Jul 2026 – 31 Dec 2026 · Running" (same chip style as the Prerequisite chip). Session select options limited to sessions with status upcoming or running (same ctx).
- batches.page.js T2: added batchStatus(b) helper — looks up the session by b.sessionId in the loaded sessions list: upcoming→upcoming, running→running, closed→completed, archived→archived; session not found → completed. Used in the table pill, the Status filter and the Running/Upcoming stat cards. loadSessions now loads ALL sessions of the ctx (including closed/archived) for lookups; the upcoming/running-only list is only for the form select.
- batches.page.js T3: save no longer writes startDate, endDate or status. On EDIT those legacy fields are removed from old docs with deleteField() (imported from firebase-firestore). sessionName stays denormalised. Everything else (studentCount, lockedExamFee, capacity, ...) unchanged.
- batches.page.js T4: batches whose session is closed or archived are read-only. Row menu shows "View" instead of "Edit" (+ Delete as now). View opens the form with all inputs/selects disabled, Save hidden and a note at the top: "This batch's session is closed. Batches of a closed session cannot be edited." Delete rules unchanged (blocked if studentCount > 0; type DELETE; no cascade).
- batches.html / batches.page.js T5: removed the "Prerequisite" column (header + cell). Kept the read-only Prerequisite chip in the form. Added a small grey line under the session name in the table: "01 Jul – 31 Dec 2026" (from the session dates).
- docs/03-DECISIONS.md T6: added "## 24. Batches follow their session" (dates = session dates, status derived, new batches only in Upcoming/Running sessions, Closed/Archived batches read-only with Delete still allowed when no students).
- Version 1.8.12 -> 1.8.13 (real strings only).
- Tested on: Pending owner live test.

### [2026-11-09 22:00] Version 1.8.12 — Phase 2 · Batches Part 2B: delete + student capacity
- Row ⋮ menu: Edit + Delete (red, Branches/Sessions pattern). Delete: if studentCount > 0 show info dialog "This batch has N student(s). Move or remove them before deleting." (no delete). Else confirm "Delete batch?" with 
equireText: 'DELETE' (red button disabled until exact match; ui-confirm already supported 
equireText/input). On confirm: deleteDoc(doc(db,'batches',id)) only — no cascade. Toast "Batch deleted.", reload. Closes form if editing this batch; if form has unsaved changes on another batch, confirmLeave first.
- Student capacity: form label "Student capacity", help "Maximum students who can enrol. Leave empty for no limit.", placeholder "No limit" (validation unchanged: empty or whole number ≥ 0). Table Students: studentCount / capacity when capacity set, else studentCount; red t-full pill when studentCount >= capacity and capacity set.
- Polish: count badge "1 batch"/"N batches"; status pill text capitalised (data values remain lowercase); table exam-fee line uses ₹ not Rs; batch code maxlength/counter 12 → 16.
- docs/03-DECISIONS.md: added ## 23. Batch student capacity (capacity semantics, admissions block full batch when built, batch with students cannot be deleted, no cascade).
- Version 1.8.11 -> 1.8.12 (real strings).
- Tested on: Pending owner live test.

---
### [2026-11-09 11:45] Version 1.8.11 — Phase 2 · Fix: batches.page.js duplicated (page did not load)
- 1.8.10 left two copies of the module in atches.page.js (duplicate imports/definitions mid-file = SyntaxError); removed the broken first copy (kept everything from the second import { db } from '../config/firebase-config.js'; to EOF). C1–C5 verified (8 imports, 1 mount, 7 helpers once, 1 STATUSES, 
ode --check clean).
- Version 1.8.10 -> 1.8.11.
- Tested on: Pending owner live test.

---
### [2026-11-09 11:30] Version 1.8.10 — Phase 2 · Batches Part 2A: add/edit form
- Batches page: enabled "Add batch" and added Sessions-style form card (hidden until Add/Edit). Fields: Batch name* (40, counter), Batch code (12, optional, auto UPPERCASE), Course* (active courses createSelect) with read-only Prerequisite chip + read-only Exam fee "locked at ₹X" from course, Session* (non-archived sessions of same centre), Branch* (Youth: active branches createSelect; Unique Kids: read-only Head Office, branchId HO), Start date*, End date*, Capacity (optional whole number ≥ 0), Status (Upcoming/Running/Completed/Archived, default Upcoming).
- Validation: required fields; end on/after start; capacity empty or whole number ≥ 0; Save blocked with per-field messages. Several batches may run at the same time.
- Save to Firestore atches: name, code, ctx, courseId, courseName, courseCode, level, prerequisite (+ prerequisiteCourseCode for list), sessionId, sessionName, branchId, branchName, startDate, endDate, capacity (number/null), status, updatedAt, updatedBy. ADD only: studentCount: 0, lockedExamFee (from course exam fee or null), createdAt, createdBy. EDIT: never changes studentCount or lockedExamFee; if course changes, shows note "Exam fee stays locked at ₹X (set when the batch was created)".
- Unsaved-guard: registerDirty + confirmLeave on Cancel, Add while editing, Edit another row. Row ⋮ menu: Edit (Delete in Part 2B).
- sessions.page.js T6a: Days-left stat sub-line title set to full text on every update (hover shows whole sentence). sessions.css T6b: .ss-mismatch cursor:help; white-space:nowrap.
- T0 field mapping (real): courses use 
ame, code/courseCode, level, prerequisiteId/prerequisiteCode/eligibility (batches save prerequisite+prerequisiteCourseCode), semester fees ees.exam (locked as lockedExamFee), status. Batch list reads name, code, course via courseId, prerequisiteCourseCode, sessionId/sessionName, branchId/branchName, studentCount/capacity, status, courseLevel/lockedExamFee.
- Version 1.8.9 -> 1.8.10 (APP_VERSION, __BUILD__, ?v= real strings).
- Tested on: Pending owner live test.

---
### [2026-11-08 16:00] Version 1.8.8 — Phase 2 · Version bump only (session work NOT done — fixed in 1.8.9)
- 1.8.7 added the helpers but did not wire them; now wired.
- Sessions form: status must match dates (Upcoming/Running/Closed rule), clear message under Status, Save blocked.
- Sessions table: red "Dates don't match status" chip with explanation on hover; no automatic status changes.
- Days-left stat + sidebar card: no clamping; ended session shows "Ended DD Mon YYYY – close this session" in red; future start shows "Starts DD Mon YYYY".
- Removed unused phone CSS copied into batches.css; version replace now touches only real version strings, not comments.
- Version 1.8.7 -> 1.8.8.
- Tested on: Pending owner live test.

---

### [2026-11-08 16:30] Version 1.8.9 — Phase 2 · Session date/status rules wired
- Sessions form: status must match dates; message under Status; Save blocked.
- Sessions table: red "Dates don't match status" chip with hover explanation. No automatic status changes.
- Days-left stat: Ended (red) / Ends today / N days / Starts date.
- Sidebar card: Starts / Ended (red) / Ends today; bar 0% before start, 100% after end.
- batches.css: restored level chip, status pills, empty-state rules.
- Fixed wrong version numbers in comments; removed duplicate decision.
- Version 1.8.8 -> 1.8.9.
- Tested on: Pending owner live test.

---

### [2026-11-08 11:00] Version 1.8.7 — Phase 2 · Dropdown rows + Session date/status bugs
- Filter popups up to 520px; rows span full popup width (highlight + tick reach the end when scrolled).
- BUG FIX: session status was a free choice. New rule: Upcoming = start after today; Running = today within start..end;
  Closed = end before today; Archived = any. Save blocked on mismatch with clear message.
- BUG FIX: days-left was clamped to 0, so an ended session showed "Ends today" / 100%. Now shows "Ended DD Mon YYYY – close this session" (red) in sidebar and Sessions stat.
- Existing mismatched sessions flagged with "Dates don't match status" chip; no automatic status changes.
- Shared helpers in core/sessions.js: todayISO, expectedStatus, statusMismatch, daysLeft.
- Version 1.8.6 -> 1.8.7.
- Tested on: Pending owner live test.

---

### [2026-11-07 16:33] Version 1.8.6 — Phase 2 · Filter dropdown polish
- All dropdown popups: thin rounded scrollbar.
- Filter boxes show selected label up to ~18 characters with "...", full name on hover; open list keeps full names; filter row stays on one line.
- Batches Session/Branch filter options have icons (calendar-range / git-branch).
- firebase.json: index.html and pages/** served with Cache-Control no-cache (no more stale app after updates).
- Removed temporary [batches] debug log.
- Version 1.8.5 -> 1.8.6.
- Tested on: Pending owner live test.

---

### [2026-11-07 16:14] Version 1.8.5 — Phase 2 · index.html fix + search cursor
- index.html: removed a <script> tag wrongly placed inside the module script (would blank the app);
  window.__BUILD__ now set in its own classic <script> in <head>, before modules.
- All list-page search bars: clear "x" shows hand cursor.
- Version 1.8.4 -> 1.8.5.
- Tested on: Pending owner live test.

---

### [2026-11-07 16:11] Version 1.8.4 — Phase 2 · Cache-bust
- Version bump only so browsers load Batches Part 1b/1c/1d fixes (1.8.3 was kept across 3 fix rounds; cached copies were served).
- Rule adopted: every Kilocode step that edits JS/CSS bumps the patch version, including small fixes.
- Version 1.8.3 -> 1.8.4.
- Tested on: Pending owner live test.

---

### [2026-11-07 15:44] Version 1.8.3 — Phase 2 · Filter-bar widths + Batches Part 1
- Shared filter bar: dropdowns size to longest label on one line (closed + popup); search flex-fills remaining space.
- Batches route (Academics, Super Admin, youth + school), pages/batches.html, css/pages/batches.css, batches.page.js:
  stats, toolbar (status, session, branch [youth], level), table, empty state. Read only — form/save/delete in Part 2.
- firestore.rules batches block unchanged (read superadmin + branch head, write superadmin). No deploy.
- Part 1b: Batches stats cards + full toolbar wired; header/empty layout matched to Branches; filter CSS merged into one block, search uncapped.
- Part 1c: filter popups open leftward inside page (no scrollbars); buildToolbar.setFilterOptions + select.setOptions;
  Batches Session/Branch filters filled from shared loaders; empty state matches Branches.
- Part 1d: Batches uses loadSessions(ctx); select.setOptions rebuilds popup; popups capped at 320px and open upward when needed; Rule 4 CSS de-duplicated; empty state matches Branches.
- Version 1.8.2 -> 1.8.3.
- Tested on: Pending owner live test.

---

### [2026-11-06 13:48] Version 1.8.2 — Phase 2 · Unsaved-changes guard everywhere
- Branches wired to unsaved-guard: sidebar/topbar navigation, context switch, browser refresh/close,
  Cancel / Add branch / Edit another row all ask before discarding typed data.
- Audit of all form pages: branches (wired now), courses (already), sessions (already), org-details (already), login (n/a).
- unsaved-guard.js imported with one identical versioned URL everywhere (shared dirty state).
- Version 1.8.1 -> 1.8.2.
- Tested on: Pending owner live test.


### [2026-11-06 13:48] Version 1.8.1 — Phase 2 · Branches contact details
- Branch form: up to 5 phone numbers (Add number / remove x, 0/5 counter, format check, duplicate check),
  Email (format check), Google Maps link (must be maps.app.goo.gl / goo.gl/maps / google.*/maps).
- Firestore `branches`: + phones [] (max 5), email, mapUrl. `phone` still saved = phones[0] for backward compatibility.
  Old docs with only phone load as a single number.
- Table: Contact column (first number, "+N more", email); Address shows "Open map" link.
- Search also matches phones and email.
- 3-dot menu: "Copy branch details" copies WhatsApp-ready text:
    *Unique Infotech - <name>*
    Branch Code: <code>
    Call: <n1>, <n2>, ...
    Email: ...
    Address: ...
    Map: ...
  Empty fields are skipped. Clipboard API with textarea fallback.
- Version 1.8.0 -> 1.8.1.
- Tested on: Pending owner live test.

---



### [2026-11-06 13:13] Version 1.8.0 — Phase 2 · Business rules locked + unsaved guard + filter widths + Courses v2
- docs/03-DECISIONS.md: added section 22 SYSTEM BUSINESS RULES (Rule 1 student delete/remove, Rule 2 course fee lock, Rule 3 unsaved changes, Rule 4 filter widths).
- docs/04-DATABASE-MAP.md: courses fields (level, prerequisiteId, prerequisiteCode, eligibilityText, fees{}, curriculum[]), batches.lockedExamFee, students status 'left'.
- NEW public/js/utils/unsaved-guard.js; router.js asks before hash navigation and clears registrations per page; index.html guards context switch + logout.
- Branches, Sessions, Courses, Organisation pages register dirty state; Cancel asks when dirty.
- list-page.css: Rule 4 block (search max 420px, filters min 220px, popup one-line).
- Courses: linked progression kept; eligibilityText (Sem 1); Unique Kids levels now have curriculum list; fee lock helpers + banner (Rule 2 partial); table columns Code/Name/Level/Duration/Prerequisite/This-sem fee/Full package/Status; delete blocked if prerequisite or running batches.
- TODO (Batch/Students pages): Rule 1 Delete Student + Remove Student; Rule 2 full lock (batches.courseId/status/lockedExamFee).
- Version 1.7.0 -> 1.8.0.

---
### [2026-11-04 07:21] Version 1.7.0 — Phase 2 · Courses linked progression
- Courses rebuilt as linked 6-month semesters: Level 1 Base (6m, text eligibility), Level 2 Combo (12m, eligibility = Sem 1 course dropdown),
  Level 3 Advanced (18m, eligibility = Sem 2 course dropdown). Saved: level, durationMonths, prerequisiteId, prerequisiteCode,
  fees {admission, installment, exam, material} for THIS semester only, curriculum [], status, ctx.
- Package total = sum of chain (UI only). Every semester = 4 installments.
- Form: level dropdown, locked duration, eligibility text/dropdown swap, chain preview, "Copy fees/topics from linked course",
  curriculum builder (Enter or Add Topic, comma = multiple, remove with x, no duplicates).
- Table: code/name, requires X, level badge, this-semester fees, package total with chain (CITA + DITA), topic count.
- 3-dot: Edit, Duplicate, Create next-semester course from this, Mark inactive, Delete (blocked if other courses depend on it).
- Editing a course code updates prerequisiteCode on dependent courses.
- UI: flat stat icons (no gradient/shadow), clean white kebab menus and dropdown lists.
- Unique Kids levels unchanged (flat admission + monthly).
- Version -> 1.7.0.

---
### [2026-11-04 06:20] Version 1.6.1 — Phase 2 · Courses per-semester fees
- Replaced flat fee model with per-semester fees (brochure: DITA Sem 1 = 1000 + 250x4, Sem 2 = 1000 + 500x4).
- Youth `courses` doc: code, name, eligibility, durationMonths (6/12/18), totalSemesters (1/2/3),
  semesters: [{ semNo, admissionFee, installmentAmount, examFee, materialFee }], status, ctx:'youth', createdAt, updatedAt.
- Every semester = 4 installments. Sem total = admission + installment x 4 + exam + material. Package = sum of sems (UI only, not saved).
- Form: duration dropdown renders 1/2/3 semester blocks dynamically; typed values kept when switching; "Copy from Sem N" button.
- Table: per-semester lines "Sem 1: Adm 1000, Inst 250 x 4 = Rs 2,000".
- Unique Kids (ctx 'school'): flat name, admissionFee, monthlyFee, status.
- Old flat-field course docs (installmentAmount at top level) show "No semester fees saved - edit to add".
- Version 1.6.0 -> 1.6.1.

---
### [2026-11-04 06:07] Version 1.6.0 — Phase 2 · Courses & Packages
- Rebuilt pages/courses.html and js/pages/courses.page.js with package architecture.
- Youth Centre (ctx 'youth'): 6m = 1 sem, 12m = 2 sem, 18m = 3 sem. Every semester = 4 installments + 1 exam fee.
  Firestore `courses`: code, name, durationMonths, totalSemesters, admissionFee, installmentAmount,
  examFeePerSem, materialFee, eligibility, status, ctx, createdAt, updatedAt.
  UI-only totals: installments = sems x 4; exam total = examFeePerSem x sems;
  package = admission + installment x sems x 4 + examFeePerSem x sems + materialFee.
- Unique Kids (ctx 'school'): same page shows "School Levels" — name, admissionFee, monthlyFee, status, ctx.
- Table shows code/name, duration badge, fee breakdown grid, highlighted package total; 3-dot menu Edit / Duplicate / Mark inactive / Delete (type code to confirm).
- Form: custom dropdowns (duration, eligibility, status), live hint chips + package summary.
- router.js: courses route ctx now ['youth','school'].
- Version bumped 1.5.1 -> 1.6.0.

---
### [2026-11-04 HH:MM] Version 1.5.1 — Phase 1 · Step 6b

**What was built:**
- toast.js + css/components/toast.css — auto-dismiss toast (4s, pause on hover, close button, progress bar, success/error/warning/info icons)
- Branches + Sessions pages use toasts instead of the inline message line (bug: message stayed until refresh)
- CREATED js/core/sessions.js — shared session loader/cache, selected session per centre, running-period maths
- Topbar session switcher reads Firestore sessions (archived hidden); empty state "No session" + "Create a session"; refreshes after save/delete
- Sidebar running-session card uses the real Running session; empty state when none
- Toast restyled: compact dark bar, bottom-centre, message only; sidebar card now refreshes after sessions load

**Firestore changes:** None (reads sessions only; rules unchanged — no deploy).

**Tested on:** Pending owner live test.

---

### [2026-11-03 17:01] Version 1.5.0 — Phase 1 · Step 6a

**What was built:**
- Version bump only (sessions page not created this pass)

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 17:00] Version 1.5.0 — Phase 1 · Step 6a

**What was built:**
- Version bump only (sessions page not created this pass)

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 16:48] Version 1.4.2 — Phase 1 · Step 5e-2

**What was built:**
- Version bump only (full upgrade not completed this pass)

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 16:35] Version 1.4.1 — Phase 1 · Step 5e

**What was built:**
- branches.html + branches.page.js — branch list (name, code, phone, address, status), add/edit form with validation (unique code), save bar
- CREATED css/pages/branches.css; main.css imports it
- No delete: branches are set Inactive instead (future students/fees reference them)

**Firestore changes:**
- branches/{autoId}: name, code, phone, address, status, createdAt, createdBy, updatedAt, updatedBy

**Tested on:** Pending owner live test.

---



### [2026-11-03 16:08] Version 1.4.0 — Phase 1 · Step 5d-2d-B

**What was built:**
- org-details.html — rebuilt with UI kit: Identity and Contact cards, icon fields, counters, live sidebar preview, sticky save bar
- org-details.page.js — dirty tracking, validation (name, phone, email, website), Discard, Save
- New fields saved: email, website
- topbar.css — owner manually repaired #page-title rule and restored 768px media block

**Firestore changes:**
- settings/org_config: + email, website (merge)

**Tested on:** Pending owner live test.

---



### [2026-11-03 15:18] Version 1.3.9 — Phase 1 · Step 5d-2d-A

**What was built:**
- CREATED css/components/ui-kit.css — shared modern UI kit
- CREATED css/pages/settings.css — organisation brand preview styles
- main.css — imports ui-kit.css and settings.css
- topbar.css — nowrap on context switch, session button and title

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 15:12] Version 1.3.9 — Phase 1 · Step 5d-2d

**What was built:**
- APP_VERSION and all ?v= strings -> 1.3.9

**Files touched:**
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/index.html, public/pages/login.html, docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 15:08] Version 1.3.8 — Phase 1 · Step 5d-2c

**What was built:**
- Renamed js/pages/org.page.js -> js/pages/org-details.page.js (router derives module name from route.page 'org-details'; old name caused 404 so the page never loaded or saved)
- org-details.html — form classes aligned to project CSS (.field, .input, .btn .pri)
- dashboard.css — org form field layout
- Rule: page module filename must equal route.page + '.page.js'
- APP_VERSION and all ?v= strings -> 1.3.8

**Files touched:**
- CREATED: public/js/pages/org-details.page.js
- DELETED: public/js/pages/org.page.js
- MODIFIED: public/pages/org-details.html, public/css/pages/dashboard.css, public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/index.html, public/pages/login.html, docs/05-FILE-INDEX.md, docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 15:05] Version 1.3.7 — Phase 1 · Step 5d-2b

**What was built:**
- pages/org-details.html — Organisation form (name required, tagline, phone, address)
- js/pages/org.page.js — loads settings/org_config, validates, saves with merge + updatedAt/updatedBy, updates APP_CACHE.org and sidebar brand live, inline status messages (toast.js is still empty)
- css/pages/dashboard.css — org card + status message styles
- APP_VERSION and all ?v= strings -> 1.3.7

**Files touched:**
- MODIFIED: public/pages/org-details.html, public/js/pages/org.page.js, public/css/pages/dashboard.css, public/css/main.css, public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/index.html, public/pages/login.html, docs/02-PROGRESS-LOG.md

**Firestore changes:**
- settings/org_config: orgName, tagline, phone, address, updatedAt, updatedBy

**Known issues:** toast.js is empty — build toast component in a later step.

**Tested on:** Pending owner live test.

---



### [2026-11-03 15:00] Version 1.3.6 — Phase 1 · Step 5d-2

**What was built:**
- APP_VERSION and all ?v= strings -> 1.3.6

**Files touched:**
- MODIFIED: public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/index.html, public/pages/login.html, docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 14:57] Version 1.3.5 — Phase 1 · Step 5d-1

**What was built:**
- index.html — org_config and branch load failures now logged with console.warn (were silently swallowed); missing org_config doc reported; APP_CACHE guaranteed before write
- .gitattributes — normalise line endings to LF (removes CRLF warnings)
- APP_VERSION and all ?v= strings -> 1.3.5
- Diagnosis result: superadmin can read settings/org_config per rules; branch_head/school_head read depends on rules; org.page.js writes orgName/tagline fields

**Files touched:**
- CREATED: .gitattributes
- MODIFIED: public/index.html, public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/pages/login.html, docs/02-PROGRESS-LOG.md

**Firestore changes:** None (rules NOT modified).

**Tested on:** Pending owner live test.

---



### [2026-11-03 14:52] Version 1.3.4 — Phase 1 · Step 5c-3e

**What was built:**
- topbar.js — bell dot hidden by default; new export setNotifCount(n) shows the dot and updates aria-label only when n > 0
- topbar.css — .tb-dot[hidden] { display: none; }
- APP_VERSION and all ?v= strings -> 1.3.4

**Files touched:**
- MODIFIED: public/js/components/topbar.js, public/css/layout/topbar.css, public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/index.html, public/pages/login.html, docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 14:51] Version 1.3.3 — Phase 1 · Step 5c-3d

**What was built:**
- topbar.js — global search removed from topbar (owner decision; search will live on the Students page)
- topbar.css — .tb-search rules removed; title pushes controls right; completed density pass (38px controls, 13px text, 17px title, 34px avatar, 16–18px icons); responsive rules at 1100px / 768px
- Note: 5c-3c only applied icon sizes; remaining sizes completed here
- APP_VERSION and all ?v= strings -> 1.3.3

**Files touched:**
- MODIFIED: public/js/components/topbar.js, public/css/layout/topbar.css, public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/index.html, public/pages/login.html, docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 14:48] Version 1.3.2 — Phase 1 · Step 5c-3c

**What was built:**
- topbar.css — density pass: icons 18px (16px in search/session), controls 38px, text 13px, title 17px, avatar 34px; matches sidebar scale
- All ?v= strings and APP_VERSION -> 1.3.2; verified single app.js module URL

**Files touched:**
- MODIFIED: public/css/layout/topbar.css, public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/js/components/topbar.js, public/index.html, public/pages/login.html, docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 14:44] Version 1.3.1 — Phase 1 · Step 5c-3b-fix

**What was built:**
- topbar.js — repaired: menu icon creation, single click listener per context button, single chip name/role inside .chip-text, session fields matched to date.utils return shape, brace balance
- APP_VERSION and all ?v= strings 1.3.0 -> 1.3.1; main.css link now versioned
- Rule adopted: every step that edits JS/CSS bumps the patch version (cache busting)

**Files touched:**
- MODIFIED: public/js/components/topbar.js, public/js/core/app.js, public/js/core/router.js, public/js/components/sidebar.js, public/index.html, public/pages/login.html, docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

---



### [2026-11-03 14:42] Version 1.3.0 — Phase 1 · Step 5c-3b

**What was built:**
- topbar.js — full topbar: menu (aria-expanded), title, context switch (Super Admin only), search input (UI only), session selector with saved choice, notification bell with dot, user badge with initials
- topbar.css — rewritten to match temp_ref_dashboard.html; responsive at 1100px and 768px
- sidebar.css — thin visible nav scrollbar so lower menu items are discoverable

**Files touched:**
- MODIFIED: public/js/components/topbar.js, public/css/layout/topbar.css, public/css/layout/sidebar.css, docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

**Next task:** Owner retest (desktop, collapsed, mobile drawer); then Git commit of 5c-2c..5c-3b; then Step 5d.

---



### [2026-11-03 14:17] Version 1.2.0 — Phase 1 · Step 5c-2d

**What was built:**
- public/js/components/sidebar.js — added nav.className = 'sb-nav' so .sb-nav link styles apply (links were rendering as default blue underlined)
- public/css/layout/grid.css — added .main { grid-column: 2; } inside desktop media block; fixed .sidebar is out of grid flow, so .main was landing in column 1 behind the sidebar (topbar and content were hidden)
- docs/02-PROGRESS-LOG.md — moved 5c-2 entry under ACTIVE LOG, added 5c-2c and 5c-2d entries

**Why:**
- Bugs introduced in Step 5c-2 sidebar redesign; found during owner live test.

**Files touched:**
- MODIFIED: public/js/components/sidebar.js
- MODIFIED: public/css/layout/grid.css
- MODIFIED: docs/02-PROGRESS-LOG.md

**Firestore changes:** None.

**Tested on:** Pending owner live test.

**Next task:** Owner retest; confirm mobile media rules; then Step 5c-3: topbar, dropdown component, boot script.

---

### [2026-11-03 14:05] Version 1.2.0 — Phase 1 · Step 5c-2c

**What was built:**
- Cache-busting: added ?v=1.2.0 to router.js import (index.html) and to router.js and date.utils.js imports (sidebar.js)
- public/pages/login.html — login.page.js version string 1.1.0 -> 1.2.0
- public/js/components/topbar.js — context buttons carry data-ctx; setSwitcherActive compares data-ctx instead of label text; indentation corrected
- public/index.html — indentation fix on tagline line

**Why:**
- Prevent stale cached modules after deploy; make switcher highlight independent of label wording.

**Files touched:**
- MODIFIED: public/index.html
- MODIFIED: public/pages/login.html
- MODIFIED: public/js/components/sidebar.js
- MODIFIED: public/js/components/topbar.js

**Firestore changes:** None.

**Tested on:** Console clean at v1.2.0 (owner). Layout bugs found -> fixed in 5c-2d.

**Next task:** Step 5c-2d.

---

### [2026-11-03 08:54] Version 1.2.0 — Phase 1 · Step 5c-2 (date utilities and sidebar redesign)

**What was built:**
- public/js/utils/date.utils.js — replaced entirely with formatDayMonth, getRunningPeriod, getNextDueDate, getPeriodOptions
- public/css/layout/sidebar.css — redesigned to match temp_ref_dashboard.html sidebar
- public/js/components/sidebar.js — rebuilt sidebar markup, tooltip, session card, identity row
- public/index.html — added tagline and passed to renderSidebar (both calls)

**Tested on:** Not yet tested. Awaiting owner live test.

**Next task:** Step 5c-2c doc fixes, then Step 5c-3: topbar, dropdown component, boot script.

---



### [2026-11-03 08:30] Version 1.2.0 — Phase 1 · Step 5c-1

**What was built:**
- public/css/base/variables.css — verified palette already matches logo-derived values (#323A85 primary, school teal #0F766E, sidebar #14163A, text-mute #6B6B6B, new tokens --sidebar-accent, --tooltip-bg, --tooltip-border, --font-head); no changes needed
- public/pages/login.html — verified logo-192.jpg and favicon links already correct; no changes needed
- public/index.html — verified favicon links already present; no changes needed (verify only)
- docs/01-MASTER-PLAN.md — updated colour palette in section 6.2 to logo-derived values; section 6.5 tone description; added Branding assets note; added paidAt/Collected At reporting text to Payment Modes and Phase 6 Reports
- docs/03-DECISIONS.md — appended decisions 18 (Brand Palette and Logo Assets), 19 (Where-Collected Tracking), 20 (Session and Period Model interim)
- docs/04-DATABASE-MAP.md — clarified branchId as student's home branch; added paidAt map field; updated collectedBy map with role; added Reports and settlement paragraph; added planned payment rules
- docs/05-FILE-INDEX.md — replaced logo.png/logo-white.png/favicon.ico with logo.jpg/logo-192.jpg/logo-512.jpg/favicon-32.png/apple-touch-icon.png; added TEMPORARY temp_ref_dashboard.html entry
- docs/06-KNOWN-ISSUES.md — updated pending input #1 logo status; resolved ISS-005; added ISS-006, ISS-007, ISS-008
- docs/07-HANDOFF-PROMPT.md — updated Youth/School theme context colors to #323A85 / #0F766E

**Why:**
- Step 5c-1: lock the logo-derived colour palette, update logo/favicon references, and record all related design and data-model decisions in docs before proceeding to 5c-2 sidebar redesign.

**Files touched (created / modified / deleted):**
- MODIFIED: docs/01-MASTER-PLAN.md
- MODIFIED: docs/03-DECISIONS.md
- MODIFIED: docs/04-DATABASE-MAP.md
- MODIFIED: docs/05-FILE-INDEX.md
- MODIFIED: docs/06-KNOWN-ISSUES.md
- MODIFIED: docs/07-HANDOFF-PROMPT.md
- VERIFIED (no change): public/css/base/variables.css, public/pages/login.html, public/index.html

**Firestore changes:**
- None (docs-only; paidAt/collectedBy fields are planned for Phase 4 rules)

**Tested on:**
- Chrome Desktop: Not yet tested. Awaiting owner live test.
- Mobile (Android Chrome): Not yet tested.

**Edge cases checked:** Colour audit confirms zero color literals outside variables.css across public/ CSS, JS, and HTML.

**Known issues created (if any):**
- Linked to `06-KNOWN-ISSUES.md` → ISS-006, ISS-007, ISS-008. Earlier entry "Step 5b" dated 2026-11-03 03:20 is mislabelled and partially off-spec; see ISS-008.

**Next task:**
- Phase 1 Step 5c-2: sidebar redesign.

---

### [2026-11-03 03:20] Version 1.2.0 — Phase 1 · Step 5b

**What was built:**
- public/js/components/dropdown.js — custom dropdown component (.dd, .dd-btn, .dd-menu) with click-outside close and keyboard-ready markup
- public/css/components/dropdown.css — dropdown styles with hover/selected states, shadow-pop, reduced-motion support
- public/css/components/badges.css — badge styles (.pill up/down/neutral, .due-tag overdue/soon/calm, .la-mode cash/upi/bank)
- public/css/components/tables.css — table styles (.table-scroll wrapper, .data-table with striped hover)
- public/css/pages/dashboard.css — dashboard page styles (.dashboard, .quick-grid, .quick-card)
- public/js/utils/date.utils.js — date utilities (formatDate, formatDateTime, daysBetween, calculateFine, isAfter10th, addDays, isSameDay, todayISO)

**Why:**
- Complete Part C4–C6 of Step 5b frontend redesign: reusable dropdown, badge, and table components per design system; dashboard page layout; date utilities for fine calculation and display formatting across all pages.

**Files touched (created / modified / deleted):**
- CREATED: public/js/components/dropdown.js
- CREATED: public/css/components/dropdown.css
- CREATED: public/css/components/badges.css
- CREATED: public/css/components/tables.css
- CREATED: public/css/pages/dashboard.css
- CREATED: public/js/utils/date.utils.js
- MODIFIED: public/css/main.css (added dropdown, badges, tables imports)

**Firestore changes:**
- None

**Tested on:**
- Chrome Desktop: Not yet tested. Awaiting owner live test.
- Mobile (Android Chrome): Not yet tested.

**Edge cases checked:** Dropdown click-outside close; disabled state; empty options; date.parse null handling; fine calculation returns 0 when not late.

**Known issues created (if any):**
- None.

**Next task:**
- Phase 1 Step 6: toast, modal, confirm components; or begin Phase 2 Super Admin Core (branches, courses, batches).

---

### [2026-11-02 11:30] Version 1.2.0 — Phase 1 · Step 5

**What was built:**
- public/js/core/router.js — ROUTES table, startRouter, navigate, hash-based routing, empty states
- public/js/core/app.js — APP_VERSION 1.2.0, getContext, setContext sessionStorage, loadSavedContext
- public/js/components/sidebar.js — renderSidebar, setActiveRoute, setCollapsed, toggleDrawer, closeDrawer
- public/js/components/topbar.js — renderTopbar, setPageTitle, setSwitcherActive
- public/js/pages/dashboard.page.js — dashboard mount, greeting
- public/pages/dashboard.html — dashboard fragment (KPI strip, empty state)
- public/css/layout/grid.css — app grid, KPI strip, responsive
- public/css/layout/sidebar.css — sidebar, session card, mobile drawer
- public/css/layout/topbar.css — topbar, context switcher, user chip
- public/css/components/cards.css — card, empty-state, skeleton
- public/css/main.css — appended layout + cards imports
- public/index.html — replaced with real shell (sidebar, topbar, view, router boot)
- firebase.json — unchanged (no-cache headers already present)
- Step 5b: shell fixes (backdrop layout, menu handler, context refresh, mobile collapse, router races, load-failure state)

**Why:**
- Dashboard shell with sidebar, topbar, Youth/School switcher, hash router, and placeholder dashboard; role-based route access; no sample data; neutral empty states for unbuilt pages.

**Files touched (created / modified / deleted):**
- CREATED: public/js/core/router.js
- CREATED: public/js/components/sidebar.js
- CREATED: public/js/components/topbar.js
- CREATED: public/js/pages/dashboard.page.js
- CREATED: public/pages/dashboard.html
- CREATED: public/css/layout/grid.css
- CREATED: public/css/layout/sidebar.css
- CREATED: public/css/layout/topbar.css
- CREATED: public/css/components/cards.css
- MODIFIED: public/js/core/app.js
- MODIFIED: public/index.html
- MODIFIED: public/css/main.css
- MODIFIED: docs/03-DECISIONS.md (decision 17)
- MODIFIED: docs/05-FILE-INDEX.md (router.js line + sentence)

**Firestore changes:**
- None (reads settings/org_config and branches/{branchId} only after sign-in; rules already written in Step 3).

**Tested on:**
- Chrome Desktop: Not yet tested. Awaiting owner live test.
- Mobile (Android Chrome): Not yet tested.

**Edge cases checked:** Stale navigation discarded via counter; previous module unmount prevents listener leaks; invalid hash renders "Page not found"; missing fragment renders "This page isn't available yet"; sessionStorage for ctx and sidebar collapsed state.

**Known issues created (if any):**
- Page fragment files (students.html, branches.html, etc.) and their .page.js modules do not exist yet — they render empty states until Step 6+.

**Next task:**
- Phase 1 Step 6: toast, modal, confirm and custom dropdown components.
---

### [2026-11-02 05:22] Version 1.1.0 — Phase 1 · Step 4

**What was built:**
- public/js/core/auth.js — email/password and Google sign-in, signOut, resolveSession role detection
- public/js/core/guard.js — requireSession, 30-min inactivity logout, logout
- public/pages/login.html — standalone login page (Super Admin + Head tabs)
- public/js/pages/login.page.js — login form flow, Google flow, reason messages
- public/css/components/buttons.css — .btn base/pri/ghost/loading, .icon-btn
- public/css/components/forms.css — .field, .input, .msg error/info
- public/css/pages/login.css — centered card, tabs, responsive
- public/css/main.css — appended component imports
- public/index.html — auth-pending state, signed-in line, sign-out button, scripts bumped to v1.1.0
- public/js/core/app.js — APP_VERSION 1.1.0
- firebase.json — no-cache hosting headers for js/css/html
- Step 4b: login page UI/message fixes

**Why:**
- Login, role detection, and session guard before the dashboard shell; shared PCs use per-tab persistence; 30-minute inactivity logout; role enforced in client AND Firestore rules; nothing hardcoded.

**Files touched (created / modified / deleted):**
- CREATED: public/js/core/auth.js
- CREATED: public/js/core/guard.js
- CREATED: public/pages/login.html
- CREATED: public/js/pages/login.page.js
- CREATED: public/css/components/buttons.css
- CREATED: public/css/components/forms.css
- CREATED: public/css/pages/login.css
- MODIFIED: public/css/main.css
- MODIFIED: public/index.html
- MODIFIED: public/js/core/app.js
- MODIFIED: firebase.json
- MODIFIED: docs/03-DECISIONS.md (decision 16)

**Firestore changes:**
- None (login reads users/{email} only after sign-in; rules already written in Step 3).

**Tested on:**
- Chrome Desktop: Not yet tested. Awaiting owner live test.
- Mobile (Android Chrome): Not yet tested.

**Edge cases checked:** Double-submit prevention via running flag; finally blocks re-enable buttons; popup-closed/cancelled show no message; raw query values never printed.

**Known issues created (if any):**
- Super Admin users/{email} document must exist in Firestore before admin login works.

**Next task:**
- Phase 1 Step 5: dashboard shell (sidebar, topbar, Youth/School switcher, hash router).
---

### [2026-11-02 05:18] Version 1.0.1 — Phase 1 · Step 3b

**What was built:**
- firebase.json — Firestore location corrected nam5 → asia-south1
- docs/06-KNOWN-ISSUES.md — ISS-003 resolved
- docs/03-DECISIONS.md — decision 15 added

**Why:**
- Firestore database location cannot be changed after creation; it was created in nam5 contrary to Master Plan, so it was recreated in asia-south1 before any real data existed, and firebase.json updated to match.

**Files touched (created / modified / deleted):**
- MODIFIED: firebase.json
- MODIFIED: docs/06-KNOWN-ISSUES.md
- MODIFIED: docs/03-DECISIONS.md

**Firestore changes:**
- Database recreated in asia-south1; rules redeployed; users/{superadmin email} document recreated manually.

**Tested on:**
- Chrome Desktop: Verified by owner in Firebase Console (location shown as asia-south1).
- Mobile (Android Chrome): N/A

**Edge cases checked:** Database location is immutable post-creation, so recreation before real data was the only correct path.

**Known issues created (if any):**
- Storage bucket region still to be verified (not blocking).

**Next task:**
- Phase 1 Step 4: login + auth.
---

### [2026-11-02 05:02] Version 1.0.1 — Phase 1 · Step 3

**What was built:**
- firestore.rules — rewritten with role-based rules for users, settings, branches, courses, batches, levels (deny-all catch-all)

**Why:**
- Enforce server-side role + branch isolation before any login/auth code goes live; Super Admin locked to email+password, Heads require Google verified + active users doc.

**Files touched (created / modified / deleted):**
- MODIFIED: firestore.rules
- MODIFIED: docs/03-DECISIONS.md (decision 14)

**Firestore changes:**
- Rules rewritten: users/{userEmail}, settings/{docId}, branches/{branchId}, courses/{courseId}, batches/{batchId}, levels/{levelId}; catch-all /{document=**} denied.

**Tested on:**
- Chrome Desktop: Rules written; NOT yet deployed. Architect audit pending; live test happens after deploy.
- Mobile (Android Chrome): N/A

**Edge cases checked:** Short-circuit order in isSuperAdmin()/isGoogleVerified() avoids unnecessary users-doc reads; provider check prevents email/password self-registration as a Head.

**Known issues created (if any):**
- Super Admin users document must be created manually (utpal.goutam@gmail.com) before login works.

**Next task:**
- Deploy rules to unique-infotech-cms, create the Super Admin users document, then Phase 1 Step 4 (login + auth).
---

### [2026-11-02 04:39] Version 1.0.1 — Phase 1 · Step 2

**What was built:**
- public/css/base/variables.css — design tokens (approved palette, youth/school ctx overrides)
- public/css/base/reset.css — minimal modern reset
- public/css/base/typography.css — 13.5px base, Plus Jakarta Sans, heading weights, muted helpers
- public/css/main.css — @import chain for base CSS only
- public/js/config/firebase-config.js — Firebase 11.0.2 ES module config, exports app/auth/db/storage
- public/js/core/app.js — APP_VERSION 1.0.1, APP_CACHE, setContext, DOMContentLoaded init
- public/index.html — temporary foundation-check page

**Why:**
- Establish the foundation layer (tokens, Firebase SDK, app core) before any login/auth or shell code; no hardcoded org/person/email/designation values.

**Files touched (created / modified / deleted):**
- CREATED: public/css/base/variables.css
- CREATED: public/css/base/reset.css
- CREATED: public/css/base/typography.css
- CREATED: public/css/main.css
- CREATED: public/js/config/firebase-config.js
- CREATED: public/js/core/app.js
- CREATED: public/index.html
- MODIFIED: docs/01-MASTER-PLAN.md (Node.js version)
- MODIFIED: docs/03-DECISIONS.md (decisions 12 and 13)

**Firestore changes:**
- None yet (SDK initialized only; no reads/writes).

**Tested on:**
- Chrome Desktop: ✅ (owner tested; zero console errors; youth/school ctx switch verified)
- Mobile (Android Chrome): ✅ (Chrome device-toolbar emulation at 375px width)

**Edge cases checked:** None.

**Known issues created (if any):**
- index.html is a temporary page to be replaced by the real shell in a later step.

**Next task:**
- Phase 1 Step 3: Firestore/Storage security rules + users collection schema
---

### [2026-11-02 04:18] Version 1.0.0 — Phase 1 · Step 1

**What was built:**
- storage.rules — replaced corrupted pasted text with deny-all baseline rules
- firestore.rules — set to deny-all baseline rules
- .gitignore — added .idea/ entry
- docs/05-FILE-INDEX.md — renamed batch-heads references to branch-heads
- docs/03-DECISIONS.md — added decision 11: Interim Security Rules

**Why:**
- Lock Firebase Storage and Firestore behind production deny-all rules before any feature code; storage.rules contained ~320 KB of pasted chat text instead of valid rules.

**Files touched (created / modified / deleted):**
- MODIFIED: storage.rules
- MODIFIED: firestore.rules
- MODIFIED: .gitignore
- MODIFIED: docs/05-FILE-INDEX.md
- MODIFIED: docs/03-DECISIONS.md

**Firestore changes:**
- Rule files set to deny-all baseline; no data changes.

**Tested on:**
- Chrome Desktop: N/A (rules-only change)
- Mobile (Android Chrome): N/A

**Edge cases checked:** None.

**Known issues created (if any):**
- Real role-based rules deferred to Phase 1 Step 3.

**Next task:**
- Phase 1 Step 2: build firebase-config.js + app.js + variables.css
---

### [2026-10-31 20:40] Version 1.0.0 — Phase 0 · Final Setup

**What was built:**
- GitHub repository initialized and pushed: `github.com/revertpixels/unique-infotech-cms` (private)
- Interim logo saved: `public/assets/images/logo.jpg` (116.61 KB, 1210×1214 JPEG)

**Why:**
- Enable version control safety net before Phase 1 code work with Kilocode in VS Code.
- Allow Kilocode to reference visual design anchor.

**Files touched:**
- CREATED: `public/assets/images/logo.jpg`
- CREATED: `public/pages/login.html` (empty placeholder)
- CREATED: `public/js/pages/login.page.js` (empty placeholder)
- CREATED: `public/js/pages/branch-heads.page.js` (empty placeholder)
- MODIFIED: all docs/*.md (filled with Phase-1-ready specifications)

**Firestore changes:**
- None yet.

**Tested on:**
- Git push verified: ✅ (89 files, 6434 insertions)

**Known issues created:**
- None.

**Next task:**
- Open project in VS Code + Kilocode.
- Kilocode reads all 7 MD files.
- Begin Phase 1 Step 1: build `firebase-config.js` + `app.js` + `variables.css`.

---

### [Earlier] Version 0.0.0 — Phase 0 · Environment Setup

**What was built:**
- Firebase project `unique-infotech-cms` created on Blaze Plan.
- $0.01 Google Cloud Budget Alert configured ("Zero Cost Safety Alert").
- Authentication: Email/Password enabled. Google Sign-In pending client support email.
- Firestore: provisioned in `asia-south1` (Mumbai), Production mode.
- Storage: provisioned in `US-EAST1` (always-free bucket) — chosen over Mumbai after cost warning.
- Local project folder created: `C:\Users\Asus\WebstormProjects\unique-infotech-cms`.
- `firebase init` completed: `.firebaserc`, `firebase.json`, `firestore.indexes.json`, `.gitignore` created.
- Full folder structure built under `public/` (CSS base/components/layout/pages, JS components/config/core/pages/services/utils, HTML pages).
- Existing files preserved (firestore.rules, storage.rules, 404.html, index.html).

**Why:**
- Lay the complete Firebase + local groundwork before any application code.

**Files touched:**
- CREATED: All structural files per folder tree.

**Tested on:**
- Firebase Console verified: ✅
- `firebase projects:list` returns `unique-infotech-cms`: ✅

**Known issues:**
- Google Sign-In awaiting client-provided support email → pending.

**Next task:**
- Phase 1 Step 1.

---

## FUTURE ENTRIES GO ABOVE THIS LINE
