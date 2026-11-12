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
