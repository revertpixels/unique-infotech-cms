# Kilo Kids Student-Lifecycle & Payment Implementation — Checkpoint

## COMPLETED (this turn - initial inspection)

### Working tree state
- `git status`: Untracked new Kids files (school-admissions.*, school-receipt.*, school-receipt.css, school-receipt.html, school-receipt.js) + modified existing files
- `git log -5`: Latest commits on 1.8.69 line
- Version: 1.8.69 (NOT bumping - keeping as instructed)

### Key conventions discovered
- Kids context: `ctx === 'school'`; Youth context: `ctx === 'youth'`
- Kids courses: `courses` collection with `ctx='school'`, fields: `admissionFee`, `monthlyFee`
- Kids batches: `batches` collection with `ctx='school'`, `branchId='HO'` internally
- Kids Student ID: `YYYYNNNN` via `readStudentId(tx, {org:'school', sessionYear: <admissionYear>})`
- Receipt number: `UK<YY>AD-<centreCode>-<NNNN>` via `readReceiptNo(tx, {org:'school', type:'AD', branchCode, date})`
- Custom select: `createSelect(host, {options, value, ariaLabel, onChange})` — dispatches `input` event on change, NOT `change`
- Toast API: `showToast({type:'success'|'error', message:'...'})`
- Unsaved guard: `registerDirty(() => condition)`, `confirmLeave({clear:false})`, `clearDirty()`
- Validator: `validateName`, `validatePhone`, `validateEmail`, `validateDOB`, `validateRequired`
- Formatter: `formatINR`, `formatDateIN`, `initials`
- session-rules: `isCourseActive`, `batchAllowsCourse`, `todayISO`, `batchCourseLabel`, `batchCourseTooltip`
- image-compress: `compressTo100KB`, `readAsDataURL`, `blobToDataURL`, `isImageFile`
- list-page: `buildStats`, `buildToolbar`
- ui-confirm: `confirmDialog({title, message, confirmText, danger, requireText, infoOnly})`

### Bugs already fixed in school-admissions.page.js (this session)
1. Level dropdown: Added `levelSel.setOptions()` in `load()` — was never populated
2. Date validation: Changed `new Date()` UTC comparison to `v.admissionDate > todayISO()` (string sort)
3. School class field: Added HTML input + JS read/validate/snapshot/fillForm
4. Checkbox styling: Added CSS reset for checkbox/radio/file in school-admissions.css
5. Removed duplicate `addEventListener('change')` on custom selects
6. Fee default on level change: clears batch, clears feeReceived, updates fee preview
7. `studentId` scoped properly in receipt page for `downloadPdf()`

## PENDING IMPLEMENTATION

### Phase 1: Kids student lifecycle model & helpers (school-lifecycle.js)
- Upgrade: same ID, new enrolment, new receipt, destination level progression > current
- Return: same ID, new enrolment, monthly billing next month
- End/end course: effective date, reason, stop future bills, keep existing bills
- Break: calendar months, skip fee, conflict check with paid months
- Waiver: explicit amount/reason/staff, original bill retained
- Batch-only transfer: Youth & Kids, no fee/session changes

### Phase 2: Monthly billing & payment system (school-billing.js)
- firstMonthlyMonth(): admission date +2 calendar months
- Returning student: next calendar month
- Level upgrade: new fee starts next month, current month unchanged
- Bill generation: student-month uniqueness, idempotent, no break months
- Late fee: Rs 1/day from 11th, timezone-aware

### Phase 3: Kids pages
- school-students.page.js + .html: list with Student ID, name, guardian, phone, level, batch, admission date, status, actions
- school-fees.page.js + .html: monthly fee collection, pending/overdue
- school-transfer.page.js + .html: batch-only transfer (Youth & Kids)
- school-end.page.js + .html: end course with effective date + reason
- school-break.page.js + .html: break management
- school-delete.page.js + .html: permanent delete (Super Admin)

### Phase 4: Router + sidebar + rules
- router.js: add routes for school-students, school-fees, school-transfer, school-end, school-break, school-delete
- sidebar.js: add Kids menu items under Students group
- firestore.rules: enrolments, bills, payments, waivers, breaks, transfers, deletes

### Phase 5: Courses progressionOrder
- courses.page.js: add progressionOrder field for Kids levels (ctx='school')
- Validate: unique progressionOrder among active Kids levels, admissionFee non-decreasing

### Version: Keep at 1.8.69 (do NOT bump per task instruction)