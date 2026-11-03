# 01 — MASTER PLAN
# Unique Infotech CMS (`unique-infotech-cms`)

> **Single source of truth. This document overrides every assumption any AI agent or developer may make. Read before writing a single line of code.**

---

## 1. PROJECT IDENTITY

| Field | Value |
|---|---|
| **Project Name** | Unique Infotech CMS |
| **Firebase Project ID** | `unique-infotech-cms` |
| **Local Path** | `C:\Users\Asus\WebstormProjects\unique-infotech-cms` |
| **GitHub Repo** | `https://github.com/revertpixels/unique-infotech-cms` (Private) |
| **Developer Google Account** | `revertpixels@gmail.com` (used for dev + deploy; will transfer to client later) |
| **Super Admin Login Email** | `utpal.goutam@gmail.com` |
| **Hosting** | Firebase Hosting (Blaze Plan, strict free-tier usage) |
| **Budget Alert** | $0.01 Google Cloud Budget Alert ("Zero Cost Safety Alert") |
| **Firestore Region** | `asia-south1` (Mumbai) |
| **Storage Region** | `US-EAST1` (always-free bucket) |
| **Node.js (local)** | 24.19.0 |
| **Firebase CLI** | 15.30.2 |
| **IDE** | WebStorm (primary), VS Code + Kilocode (worker agent) |
| **Current Version** | `1.0.0` |

---

## 2. CLIENT OVERVIEW

### 2.1 The Organization
- **Legal/Operational Name:** Bankura Zilla Youth Computer Training Centre
- **Governed by:** Govt. of West Bengal — Directorate of Youth Services
- **In collaboration with:** Unique Infotech
- **Running since:** 2006
- **Head Office:** Ailakandi, Kenduadihi, Bankura, PIN 722102
- **Contact:** 9474063315 · Email `uniqueabacus2011@gmail.com`
- **Certifications displayed on logo:** Regd. Under C.R. act M.H.R.D, Govt. of India · ISO 9001:2015
- **Branches confirmed from brochure:**
    - **Bishnupur Sadar** — Dakshin Boilapara, B.D.O. Office Road, Near Ramkrishna Biddyapith, Bishnupur. Mobile: 8250708149 / 9883274794.
    - **Makurgram** — Makurgram Nodra Road, Bankura. Mobile: 8918304612 / 9749012861.
    - **Bankura Zilla HO (Kenduadihi)** — Near Fire Station, Bankura. Phone: 9735640989 / 6296653670. (Head Office — Management only, NOT a teaching branch.)
    - *(More branches may be added dynamically by Super Admin.)*

### 2.2 Two Operational Sections (ONE Super Admin for both)
1. **Youth Computer Centre** — multiple branches, fixed-duration semester courses.
2. **School Computer Program (Unique Kids)** — ONE school only (co-located at Head Office campus), monthly fee model, 3 levels.

> A **topbar switcher** (`[Youth Centre | Unique Kids]`) toggles the entire UI context (colors, nav, data) via `body[data-ctx="youth"]` or `body[data-ctx="school"]`.

---

## 3. TECHNOLOGY STACK — LOCKED

### 3.1 ALLOWED
- Plain Vanilla **HTML5 + CSS3 + JavaScript (ES6+)** only.
- **Firebase:** Auth, Firestore (`asia-south1`), Storage (`US-EAST1`), Hosting, Cloud Functions (only if strictly necessary and within free tier).
- **CDN Libraries (pinned versions):**
    - Chart.js `4.4.7` — bar/doughnut charts
    - Lucide Icons `0.344.0` — ALL icons in UI
    - html2pdf.js — fee receipts, reports
    - SheetJS (XLSX) — Excel exports
    - SweetAlert2 — confirmations, alerts, errors
    - Plus Jakarta Sans — Google Fonts

### 3.2 STRICTLY FORBIDDEN
- ❌ **NO** React / Vue / Angular / Svelte / any framework
- ❌ **NO** npm / yarn / pnpm / `node_modules` / `package.json` for the frontend
- ❌ **NO** Webpack / Vite / Rollup / Parcel / any build tool
- ❌ **NO** TypeScript (plain JS only)
- ❌ **NO** Tailwind / Bootstrap / Material UI / any CSS framework
- ❌ **NO** jQuery
- ❌ **NO** emojis in the UI (Lucide SVG icons only)
- ❌ **NO** native `<select>` for primary dropdowns (use custom styled `.dd` component — native only acceptable for small filter bars)
- ❌ **NO** test mode in Firebase (Production rules from day one)
- ❌ **NO** SMS gateway / Email service / student self-portal / attendance / ID cards / certificates / dark mode / HR / payroll / inventory / public website
- ❌ **NO** partial fee payments EVER
- ❌ **NO** scope creep — anything not in this document must be rejected

---

## 4. DUAL CONTEXT: DEEP SPEC

### 4.1 YOUTH COMPUTER CENTRE

#### Courses (from physical brochure, confirmed)
| Code | Name | Duration | Class Required | Base Fee | Breakdown |
|---|---|---|---|---|---|
| CITA | Certificate in Info Tech Apps | 6 months | VIII | ₹2,000 | ₹1,000 admission + 4×₹250 |
| CFAS | Certificate in Financial Accounting | 6 months | VIII | ₹2,000 | ₹1,000 + 4×₹250 |
| CDTP | Certificate in DTP | 6 months | VIII | ₹2,000 | ₹1,000 + 4×₹250 |
| CDTA New | Certificate in Desktop Apps | 6 months | VIII | ₹3,000 (+₹100 study material) | ₹1,000 + 4×₹500 |
| DITA | Diploma in Info Tech Apps | 12 months | — | ₹5,000 Sem 2 | Sem 1 = CITA + ₹5,000 Sem 2 (₹1,000 + 4×₹500 — wait, user said 1000+500×4 for sem 2) |
| DFAS | Diploma in Financial Accounting | 12 months | — | ₹5,000 Sem 2 | Sem 1 = CFAS + Sem 2 |
| DDTP | Diploma in DTP | 12 months | — | ₹5,000 Sem 2 | Sem 1 = CDTP + Sem 2 |
| DDTA | Diploma in Desktop Apps | 12 months | — | ₹5,000 Sem 2 (+₹100 material) | Sem 1 = CDTA + Sem 2 |
| ADITA | Advanced DITA | 6 months | DITA pass | ₹3,000 | Confirmed as **Sem 3 of 18-month package** (CITA → DITA → ADITA) |

**Lateral Entry (course-to-course transfer):**
- CITA → CFAS or CDTP: ₹1,200 (₹700 admission + 2×₹250)
- CDTP → CITA or CFAS: ₹1,200
- CFAS → CITA or CDTP: ₹1,200

#### Course Package Model
- **6-month** = base course only (1 semester, 1 exam fee)
- **12-month** = Sem 1 + Sem 2 package (2 exam fees)
- **18-month** = Sem 1 + Sem 2 + Sem 3 package (3 exam fees)
- Super Admin selects **which base courses serve as Sem 1 / Sem 2 / Sem 3** when creating a 12- or 18-month package.
- **NO direct 12/18-month admission.** Students always start Sem 1 and are upgraded.
- **Sem 2 / Sem 3 admission flow:** Student search by Student ID.
    - If found and active → upgrade directly.
    - If archived (completed Sem 1 earlier) → manual entry allowed with tag `"Completed Sem1"`.

#### Installment Schedule (LOCKED — from client phone call recording)
Example: 6-month course starting January:
| Month | What Happens |
|---|---|
| Month 1 (Jan) | Admission Fee collected |
| Month 2 (Feb) | **Grace Month** — no installment |
| Month 3 (Mar) | 1st Installment due 10th |
| Month 4 (Apr) | 2nd Installment due 10th |
| Month 5 (May) | 3rd Installment due 10th |
| Month 6 (Jun) | 4th Installment due 10th |
| Month 7 (Jul) | **Exam Fee** collected before exam |

**FORMULA:** `Admission Month + 2 months = 1st Installment month`, then 4 consecutive monthly installments due by 10th.

#### Exam Fee Logic (LOCKED)
- Dynamically added per course by Super Admin at course creation time.
- 6-month course = 1 exam fee
- 12-month course = 2 exam fees (one at end of each semester)
- 18-month course = 3 exam fees (one at end of each semester)

#### Fine Rule (LOCKED)
- **₹1 per day** applied **automatically** after the 10th of the installment month.
- Branch Head / School Head can **waive** fines, BUT every waiver MUST appear in reports with: who waived, when, amount waived, reason.
- Fine is calculated on-the-fly at display time (not stored), based on `today - dueDate` where `today > 10th of due month`.

#### Late Admission Rule
- If a student is admitted into a batch that is already running:
    - Student owes the **full fee** regardless of join date.
    - All past-due installments are auto-marked as **Due + Fine applied**.
    - Branch Head may edit/adjust due dates manually (adjustment is logged).

#### Student ID Format (LOCKED — our decision)
- Pattern: `UIC-YYYY-NNNN`
    - `UIC` = Unique Infotech Centre
    - `YYYY` = Admission year (4 digits)
    - `NNNN` = Zero-padded sequential number (0001, 0002, ... 9999)
- Example: `UIC-2025-0001`
- Auto-generated by Firestore counter document (atomic increment).

#### Payment Modes (LOCKED)
- Cash
- UPI
- Bank Transfer

Every payment MUST record **"Collected By"** (branch head name + email + timestamp).

Every payment MUST also record **where it was physically collected** (`paidAt`): either a branch or `head_office`, in addition to the student's home branch and who collected it. Branch Heads always record their own branch (not editable). The Super Admin chooses the location (default Head Office, or any branch) when taking a payment for any student. Receipts print a "Collected At" line.

#### Required Student Documents (upload during admission)
| Document | Required | Max Size | Target Size (post-compression) |
|---|---|---|---|
| Birth Certificate / Aadhaar / Madhyamik Admit Card | Yes (any one) | 2 MB | ~150 KB |
| Higher Qualification Marksheet | Yes | 2 MB | ~150 KB |
| Passport Photo | Yes | 2 MB | ~150 KB |
| Signature | Yes | 2 MB | ~150 KB |

**Compression:** Client-side using `<canvas>` resize before upload. Target ~150 KB each.

---

### 4.2 UNIQUE KIDS (SCHOOL COMPUTER PROGRAM)

- **Official Name:** "School Computer Program (Unique Kids)" — NEVER "Compu Kids".
- **ONE school only**, co-located at Head Office campus.
- **Levels:** Basic, Advance, Level 3 (names + fees 100% dynamic via Settings page).
- **Fee Model:**
    - 1-time **Admission Fee** (set per level in Settings)
    - **Monthly Fee** (differs per level, set in Settings)
    - Optional **Study Material** (flexible items/prices)
- **Fine Rule:** ₹1/day after 10th of each month (same as Youth).
- **Student ID Format:** `UK-YYYY-NNNN` (Unique Kids)
- **School Head:** 1 only, Google Sign-in, scoped exclusively to Unique Kids module.

---

## 5. ROLES & SECURITY

### 5.1 Role Definitions

| Role | Count | Login Method | Scope |
|---|---|---|---|
| **Super Admin** | 1 only | Email + Password | Full access, both sections, all branches |
| **Youth Branch Head** | 1 per branch | Google Sign-in ONLY | ONE branch only, Youth section only |
| **School Head** | 1 only | Google Sign-in ONLY | Unique Kids section only |

### 5.2 Security Rules (LOCKED)
- **1 email = 1 role = 1 branch** strictly enforced via Firestore `users/{uid}` document.
- Changing a Head's assigned email **immediately revokes old access** (Firestore rule checks live email match).
- **Firestore Security Rules** enforce `role + branchId` isolation server-side (NOT client-side filtering alone).
- **Auto-logout** after 30-45 min of inactivity (user activity tracked via `lastActivityAt` + timer).
- **Multi-step secure delete** for archives:
    1. Super Admin re-enters password
    2. Explicit consent checkbox
    3. 2–3 SweetAlert2 confirmations before final delete
- **Head Office** = Management only, NOT a teaching branch (not selectable as admission branch).

### 5.3 Super Admin Powers
- Create / edit / delete branches, courses, batches, branch heads
- Admit students, collect fees, waive fines (across all branches)
- Generate reports, export Excel/PDF
- Access archives, delete students (secure multi-step)
- Edit Organization Settings (contact info, receipt text, levels, fees)

### 5.4 Branch Head Powers
- See ONLY their assigned branch's students, batches, fees
- Admit students into their branch's running batches
- Collect fees (Cash, UPI, Bank Transfer)
- Waive fines (logged in reports)
- Print/download receipts
- Cannot create branches, courses, batches, or other branch heads
- Cannot access Reports or Archives
- Cannot access Unique Kids section

### 5.5 School Head Powers
- Same as Branch Head but scoped to Unique Kids
- Cannot access Youth section at all

---

## 6. UI/UX DESIGN SYSTEM — LOCKED

### 6.1 Typography
- **Primary font (body + headings):** `Plus Jakarta Sans` (Google Fonts, weights 400/500/600/700/800)
- Base font size: `13.5px` (desktop)
- Line height: `1.5`

### 6.2 Color Tokens (CSS Variables)
Defined in `public/css/base/variables.css` — single source of truth.

**Youth Context (default, `body[data-ctx="youth"]`):**
- `--primary: #323A85` (royal blue, derived from the official client logo)
- `--primary-hover: #262D6E`
- `--primary-soft: #EEF0FA`
- `--primary-light: #5B66C4`

**School Context (`body[data-ctx="school"]`):**
- `--primary: #0F766E` (teal)
- `--primary-hover: #0B5E58`
- `--primary-soft: #E6F6F4`
- `--primary-light: #2DD4BF`

**Sidebar (always dark):**
- `--sidebar-bg: #14163A`
- `--sidebar-text: #B3B8D6`
- `--sidebar-hover: #1F2352`
- `--sidebar-border: #1F2352`

**Surfaces:**
- `--bg: #F6F6F8`
- `--surface: #FFFFFF`
- `--border: #EAEAEA`
- `--border-strong: #D4D4D4`

**Status:**
- Success `#16A34A` / soft `#F0FDF4`
- Warning `#D97706` / soft `#FFFBEB`
- Danger `#DC2626` / soft `#FEF2F2`
- Info `#2563EB` / soft `#EFF6FF`
- Amber `#F59E0B` / soft `#FFFBEB`

**Branding assets:** `logo.jpg` is the untouched official original (white background, kept as JPG by decision). The UI uses `logo-192.jpg` inside a white tile. PDF receipts and reports use `logo-512.jpg`.

### 6.3 Icon System
- **Lucide Icons v0.344.0** via CDN
- Used as `<i data-lucide="icon-name"></i>` then `lucide.createIcons()`
- Default size: 16px (nav: 17px, kpi: 17px)
- **STRICTLY ZERO EMOJIS ANYWHERE IN UI**

### 6.4 Component System
- **Buttons:** `.btn`, `.btn.pri`, `.btn-act`, `.btn-act.sec`, `.btn-collect`, `.btn-ghost`, `.btn-more`, `.icon-btn`
- **Cards:** `.card`, `.card-header`, `.card-body`, `.view-all`
- **Tables:** `.data-table` (always with `.table-scroll` wrapper for mobile overflow)
- **Dropdowns:** `.dd`, `.dd-btn`, `.dd-menu` (custom animated — NOT native `<select>` for primary flows)
- **Modals:** `.modal`, `.modal-box`, `.modal-head`, `.modal-body`
- **Floating action menu (3-dot row actions):** `.btn-more` + `.amenu` (position:fixed, auto-flips up/down, bottom-sheet on mobile)
- **Toast:** `.toast` (bottom-center, dark, icon + message, auto-dismiss 2.6s)
- **Badges:** `.pill` (up/down/neutral), `.due-tag` (overdue/soon/calm), `.la-mode` (cash/upi/bank)

### 6.5 Design Philosophy (LOCKED)
> **Hybrid: Classic Institutional Structure + Modern Clean SaaS UX.**
> - High information density, scannable at a glance
> - Deep navy-indigo (from the official logo) / teal institutional tones
> - Crisp borders, flat surfaces, zero drop-shadow fluff on data cards
> - Serious, government-grade feel — NEVER generic AI "startup" template look
> - No gradients on data surfaces (gradients only inside sidebar session card and chart fills)

### 6.6 Every Inner Page MUST Have (LOCKED)
1. **Top KPI Summary Strip** — key numbers relevant to that page (connected, single-border strip style)
2. **Quick Filter Bar** — Search input + Branch dropdown + Batch/Level dropdown + Status + Date Range
3. **Primary Data Table** — paginated (`limit(20)`), with floating 3-dot action menu per row
4. **Empty states** — never show blank areas; always show skeleton or empty-state illustration + CTA
5. **Loading states** — subtle skeleton loaders (NOT spinners)
6. **Mobile responsive** — tables scroll horizontally, action menu becomes bottom sheet

### 6.7 Responsive Breakpoints
- Desktop: > 1300px (full layout)
- Tablet: 769–1300px (sidebar collapses on toggle, KPI 3-col or 2-col, charts stack)
- Mobile: ≤ 768px (sidebar hidden off-screen with backdrop, KPI 1-col, bottom-sheet menus, search box hidden from topbar)

---

## 7. PERFORMANCE SAFEGUARDS — LOCKED (ALL 5 MANDATORY)

### 7.1 Flat Data Design
- Firestore uses **root collections only** (`students`, `payments`, `batches`, `branches`, `courses`, `schoolStudents`, `levels`, `users`, `audit`).
- **NO nested subcollections** that would force sequential reads.
- Common lookups denormalized (e.g., `student.branchName`, `student.courseName` stored on the doc for display).

### 7.2 Pagination
- Every list query uses `.limit(20)` + `startAfter(lastDoc)` cursor-based pagination.
- "Load more" button at bottom of table — NEVER load full collection.

### 7.3 Targeted Fee Lookup
- Pay Fees screen flow:
    1. Branch Head types Student ID (`UIC-YYYY-XXXX`)
    2. ONE `getDoc(doc(db, "students", studentId))` call
    3. Pulls dues, calculates fine on-the-fly, shows pay button
- **NEVER** scan whole `students` collection on Pay Fees screen.

### 7.4 Client-Side Image Compression
- Every image upload (photos, documents) runs through `<canvas>` resize before `uploadBytes()`.
- Target: ~150 KB each (max 200 KB).
- Max dimension: 1200px long edge.
- Format: JPEG @ quality 0.75.
- Utility file: `public/js/utils/helpers.js` → function `compressImage(file, maxKB=150)`.

### 7.5 In-Memory Session Cache
- On login, cache common static data in a `window.APP_CACHE` object:
    - `branches` (all branches)
    - `courses` (all course templates)
    - `levels` (Unique Kids levels)
    - `currentUser` (role, branchId, name, email)
- Cache invalidated on logout or on manual refresh.
- Pages read from `APP_CACHE` first; only hit Firestore for live data (students, payments).

### 7.6 Additional Firestore Optimizations
- All compound queries have **matching indexes** declared in `firestore.indexes.json`.
- Use `where() + orderBy() + limit()` combinations only when indexed.
- `onSnapshot()` listeners used sparingly (dashboard live counters only, NOT for lists).
- Unsubscribe from listeners on page navigation (prevent cost leaks).

---

## 8. IMPLEMENTATION PHASES

### Phase 0: Environment Setup ✅ COMPLETE
- Firebase project created (`unique-infotech-cms`)
- Blaze Plan + $0.01 Budget Alert
- Auth: Email/Password enabled
- Firestore: `asia-south1` Production mode
- Storage: `US-EAST1` always-free bucket
- `firebase init` done; `.firebaserc`, `firebase.json`, `firestore.indexes.json`, `.gitignore` populated
- Full folder structure created in `public/`
- Logo saved: `public/assets/images/logo.jpg` (interim, awaiting official PNG)
- GitHub repo initialized and pushed: `github.com/revertpixels/unique-infotech-cms`

### Phase 1: Foundation + Login + Dashboard Shell
**Deliverables:**
- `firebase-config.js` with project credentials
- `app.js` with `APP_VERSION = '1.0.0'`
- Login page (`login.html`): Email+Password for Super Admin, Google Sign-in for Branch/School Heads
- Auth service (`auth.js`): sign-in, sign-out, role detection
- Session guard (`guard.js`): auto-logout, route protection
- Dashboard shell (`index.html`): sidebar, topbar, switcher — DYNAMIC placeholders (no sample data)
- Context switcher wiring (`[data-ctx]` toggle)
- Custom dropdown component (`dropdown.js`)
- Toast component (`toast.js`)
- Modal component (`modal.js`)
- Sidebar collapse + mobile drawer (`sidebar.js`)
- Topbar wiring (`topbar.js`)

### Phase 2: Super Admin Core
- Branches CRUD page (`branches.html` + `branches.page.js`)
- Courses CRUD page (6/12/18-month packages, exam fee setup per semester)
- Batches CRUD page (global, Super Admin only, start/end dates, course link)
- Branch Heads CRUD (Google email assignment, instant revocation on email change)
- Organization Settings (name, address, phones, receipt header text, signatory name)

### Phase 3: Student Management
- Student Admissions form (full data entry, document uploads with compression)
- Auto Student ID generation (`UIC-YYYY-NNNN` for Youth, `UK-YYYY-NNNN` for School)
- Student list page (paginated, filtered)
- Student detail page (full profile, payment history, documents)
- Semester upgrade flow (Sem 1 → Sem 2 → Sem 3)
- Late admission handling (auto-mark past dues + fines)

### Phase 4: Fee Collection & Receipts
- Pay Fees screen (Student ID lookup → single doc fetch → dues display → pay button)
- Fine calculator (₹1/day after 10th, calculated on-the-fly)
- Fine waiver flow (reason required, logged in `audit` collection)
- Payment History (paginated, filterable by date/branch/mode)
- Receipt generation (html2pdf.js, 3 formats: Student copy / Office copy / Merged)
- Receipt includes "Collected By" audit field

### Phase 5: Unique Kids (School Module)
- Levels & Fees Settings page (dynamic level creation, admission fee, monthly fee)
- School Students registry
- School Admissions form
- School Pay Fees (monthly fee model)
- School Payment History & Receipts

### Phase 6: Reports & Archives
- Reports page (date-range + single-date filter). Reports have columns **Collected By** and **Collected At**. The report footer shows counts and totals grouped by **Collected At**, by **Collected By**, and by payment mode, plus counts of receipts, waivers and fines. A settlement view per branch separates cash physically collected by the branch head (`paidAt` = their branch and `collectedBy` = them) from payments the Super Admin collected for that branch's students (`paidAt` = head_office or another branch).
- Excel export (SheetJS) — all data types
- PDF export (html2pdf.js)
- Archive module (Super Admin only):
    - Self-contained offline ZIP: HTML viewer + JSON data + compressed images
    - Download always available
    - Multi-step secure delete (password re-entry + consent + 2-3 confirmations)

---

## 9. VERSIONING PROTOCOL

- Current version: `1.0.0`
- Every code change updates **TWO places simultaneously**:
    1. `public/js/core/app.js` → `const APP_VERSION = 'X.Y.Z';`
    2. `public/index.html` → `<script src="js/core/app.js?v=X.Y.Z"></script>` (cache-bust query param)
- Before every `firebase deploy`:
    1. AI must ask user to confirm both version lines match
    2. User sends both lines back for verification
    3. Only then proceed to deploy
- Version bump rules:
    - **Patch (0.0.X):** bug fixes, small tweaks
    - **Minor (0.X.0):** new feature, new page
    - **Major (X.0.0):** phase complete, major refactor

---

## 10. BACKUP & SAFETY STRATEGY

1. **GitHub (primary):** every working change committed and pushed. Daily commits mandatory.
2. **Google Drive Desktop sync:** project folder lives inside Drive-synced folder → auto-backup.
3. **Weekly manual ZIP snapshot** → separate "Snapshots" Drive folder.
4. **Firebase automatic backups:** Firestore scheduled exports (if enabled later).

---

## 11. DATA PRIVACY & COMPLIANCE

- Static **Privacy Policy page** exists (`public/pages/privacy.html` — to be added in Phase 1).
- **No DPDP consent checkboxes on admission forms** (data entered by Branch Head, not by students).
- **Export Student Data** feature (JSON/Excel) and **Permanent Delete** feature cover data-subject rights.
- **No SMS / no Email notifications** to students (out of scope).
- **No student self-portal.**
- **No audit log for every click** — only critical actions logged (payments, waivers, deletions, role changes).

---

## 12. WHAT KILOCODE / ANY AI AGENT MUST ALWAYS DO

1. **READ `docs/01-MASTER-PLAN.md` through `07-HANDOFF-PROMPT.md` BEFORE WRITING ANY CODE.**
2. **ASK the user to confirm** before making any decision not covered in these docs. Never assume.
3. **UPDATE `docs/02-PROGRESS-LOG.md`** after every completed task.
4. **UPDATE `docs/06-KNOWN-ISSUES.md`** if any bug/limitation found.
5. **NEVER delete working code** without logging reason in `03-DECISIONS.md`.
6. **NEVER add scope creep** (ID cards, certificates, dark mode, SMS, etc.).
7. **ALWAYS use existing CSS tokens** from `variables.css` — never hardcode colors.
8. **ALWAYS use Lucide icons** — never emojis.
9. **ALWAYS paginate** lists (`limit(20)`).
10. **ALWAYS compress images** client-side before upload.
11. **ALWAYS use `UIC-YYYY-NNNN` / `UK-YYYY-NNNN`** for student IDs.
12. **ALWAYS log waivers and deletions** in `audit` collection.
13. **ALWAYS bump APP_VERSION** on code changes.
14. **ALWAYS test in Chrome AND mobile view** before marking done.
15. **ALWAYS commit to GitHub** after each working increment.

---

## 13. WHAT KILOCODE / ANY AI AGENT MUST NEVER DO

- ❌ Install `npm` packages
- ❌ Create `package.json` or `node_modules`
- ❌ Introduce React / Vue / Tailwind / jQuery / TypeScript
- ❌ Change the color palette without written approval
- ❌ Use emojis in UI
- ❌ Allow partial fee payments
- ❌ Skip pagination
- ❌ Store uncompressed images
- ❌ Fetch full `students` collection on Pay Fees screen
- ❌ Hardcode names, emails, designations (ALL dynamic from Firestore)
- ❌ Modify Firestore Security Rules without logging in `03-DECISIONS.md`
- ❌ Deploy without user confirming version numbers
- ❌ Add features outside the 6-phase plan

---

**End of Master Plan. All other MD files reference this one.**