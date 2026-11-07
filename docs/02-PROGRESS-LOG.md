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
