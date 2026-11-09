# Project Decisions Log: Unique Infotech CMS

This document records the architectural and business logic decisions made for the Unique Infotech CMS. It serves as a guide for the AI agent (Kilocode) to understand the "Why" behind the "How," preventing unintended deviations from the client's vision.

---

## 1. Technical Architecture: Vanilla JS vs. Frameworks
- **Decision:** Use 100% Plain Vanilla HTML5, CSS3, and JavaScript (ES6+). No React, Vue, Angular, Tailwind, or Bootstrap.
- **Reasoning:**
    - The project owner is a non-coder. A build-less environment (no `node_modules`, `webpack`, or `vite`) ensures the project remains accessible and portable.
    - Performance: Extreme speed and zero overhead for lower-end hardware used in training centers.
    - Sustainability: Frameworks go out of style; Vanilla JS is permanent.

## 2. UI/UX: Custom Design vs. Component Libraries
- **Decision:** Custom-built UI using the "Hybrid Classic-Modern" philosophy.
- **Reasoning:**
    - Avoiding generic AI-template looks. The client requires a government-grade, dense, and scannable interface.
    - Pinned Font: **Plus Jakarta Sans** (Weights 400-800) for a clean, modern, institutional feel.
    - Pinned Icons: **Lucide SVG (v0.344.0)**. No emojis, no font-awesome.
    - Custom Dropdowns: Native `<select>` is rejected for primary flows to allow for icon integration and consistent styling across devices.

## 3. Financial Logic: The "No Partial Payment" Rule
- **Decision:** Installments must be paid in FULL. No partial payments are allowed (e.g., if an installment is ₹500, the student cannot pay ₹200 today and ₹300 tomorrow).
- **Reasoning:**
    - Simplifies bookkeeping and prevents ledger fragmentation.
    - Reduces human error by Branch Heads.
    - Streamlines the "Fine" calculation logic.

## 4. Student Identification: Atomic ID Format
- **Decision:** Auto-generated `UIC-YYYY-NNNN` (Youth) and `UK-YYYY-NNNN` (School).
- **Reasoning:**
    - Random Firestore IDs are not user-friendly for physical receipts or phone support.
    - Atomic counters ensure no duplicates and a professional, sequential appearance.

## 5. Security: Branch-Level Isolation
- **Decision:** Strict server-side isolation via Firestore Rules. 1 Gmail = 1 Branch.
- **Reasoning:**
    - Branch Heads must never see data from other branches.
    - Super Admin is the only role with global visibility.
    - Immediate access revocation: Changing a Head's email in the Super Admin panel instantly updates the security rule check.

## 6. Storage Strategy: Cost vs. Performance
- **Decision:** Use `US-EAST1` for Firebase Storage despite the database being in `asia-south1`.
- **Reasoning:**
    - `US-EAST1` offers a permanent free tier for storage, whereas `asia-south1` (Mumbai) does not.
    - Since we are auto-compressing images to ~150KB client-side, the latency difference is negligible.

## 7. Youth Course Structure: Package vs. Base
- **Decision:** Students do not admit into "12-month" courses directly. They admit into Semester 1, then "Upgrade" to Semester 2.
- **Reasoning:**
    - Reflects the reality of student dropouts and governmental reporting requirements.
    - Allows for clearer tracking of which "Base Course" (e.g., CITA) is being taught at any given time.

## 8. Fine Policy: The 10th-Day Rule
- **Decision:** ₹1/day fine starts automatically after the 10th of the month.
- **Reasoning:**
    - Standardized across all branches to ensure discipline.
    - The "Waiver" system allows flexibility but requires a reason/audit trail to prevent unauthorized discounts.

## 9. Deployment Protocol: Version Pinning
- **Decision:** Every deployment requires an update to `APP_VERSION` in `app.js` and a query parameter `v=X.X.X` in `index.html`.
- **Reasoning:**
    - Prevents "Cache Issues" where the browser loads old CSS/JS after an update.
    - Critical for a non-coder owner to verify that their changes are actually live.

## 10. Data Privacy: Explicit Export & Delete
- **Decision:** No self-delete for students. Super Admin must perform a multi-step "Secure Delete."
- **Reasoning:**
    - Prevents accidental data loss or malicious deletion by disgruntled staff.
    - The "Archive ZIP" feature ensures a permanent backup exists before data is purged from the cloud.

## 11. Interim Security Rules

Both rules files set to deny-all baseline because storage.rules contained corrupted pasted text. Real role-based rules arrive in Phase 1 Step 3.

## 12. Role Lookup via users/{email}

Decision: role documents are stored at users/{lowercased email} (not UID). Reasoning: a Head's UID does not exist before first Google login; keying by email lets Firestore rules check role instantly and lets Super Admin revoke access by editing/deleting one document.

## 13. App Shell: Single Page Shell + Hash Router

Decision: one shell index.html with hash routes (#/dashboard etc.) loading pages/*.html fragments, plus standalone login.html. Firebase SDK loaded from pinned gstatic CDN ES modules, no build step.

## 14. Firestore Security Rules (Phase 1 Step 3)

Decision: Super Admin is recognised by email+password provider and the locked email; Heads need Google provider + verified email + an active users/{email} document; Heads see only their own branch; rules cover users, settings, branches, courses, batches, levels only; everything else denied until its phase; Storage stays deny-all until Phase 3. Reasoning: provider checks stop anyone from self-registering with a Head's email via email/password; short-circuit order avoids needless users-document reads.

## 15. Firestore Region Correction

Decision: Firestore (default) database recreated in asia-south1 (Mumbai) because the original database had been created in nam5 (US multi-region) contrary to the Master Plan. Reasoning: a database location cannot be changed after creation; branch heads use mobile networks in West Bengal, so latency matters; only one bootstrap document existed so recreation cost nothing. Rules and the Super Admin users document were redeployed/recreated.

## 16. Session and Login Design (Phase 1 Step 4)

Decision: session persistence is per-tab (browserSessionPersistence) because branch PCs are shared; 30-minute inactivity logout; Super Admin = password method only, Heads = Google only, both checked in client AND rules; login page shows no organisation name because rules deny unauthenticated reads and nothing may be hardcoded; no-cache hosting headers because ES module imports are not covered by the ?v= query.

## 17. Dashboard Shell Design (Phase 1 Step 5)

Decision: single ROUTES table in router.js drives menu, titles and access; switcher shown to Super Admin only, heads locked to their section; client-side route checks are for usability only and Firestore rules remain the real enforcement; unbuilt pages show a neutral empty state instead of sample data; fragment HTML is injected via innerHTML only from our own static files, all data-derived text uses textContent; app version shown in the sidebar footer so the owner can confirm deployments; org name read from settings/org_config with a neutral fallback.

Module URL rule: every module imported by more than one file must use an identical URL everywhere (including any ?v= query) because the browser treats different URLs as different module instances; app.js keeps ?v=<APP_VERSION> from index.html and sidebar.js; router.js, auth.js and firebase-config.js are imported WITHOUT a query string.

## 18. Brand Palette and Logo Assets

Decision: palette derived from the official client logo (sampled royal blue #323A85); the logo is kept as the untouched official JPG with white background (no transparency attempt); the UI uses resized copies inside a white tile; school teal darkened to #0F766E and text-mute darkened to #6B6B6B for readable contrast (white on the old teal was 3.74:1, old muted grey 3.45:1); the active sidebar item uses a soft glow plus an accent bar because the primary is dark against the sidebar.

Reasoning: logo/UI colour harmony, accessibility, speed on mobile networks, no risk of damaging official artwork.

## 19. Where-Collected Tracking

Decision: every payment records where it was physically collected (paidAt = a branch or head_office) in addition to the student's home branch and who collected it. Branch Heads always record their own branch; the Super Admin chooses the location. Reports get a Collected At column and summary counts.

Reasoning: the Super Admin can take payments for any branch's student, so branch heads' cash handover must be reconcilable.

## 20. Session and Period Model (interim)

Decision: the Youth session is a half-year (Jan-Jun or Jul-Dec) and the School period is a calendar month, both computed from today's date; this is an interim assumption pending client confirmation of the academic session format (pending input #7).

Reasoning: date-based calculations for installments, dues, and fines require a defined period model; deferring to client confirmation avoids rework later.

## 21. Branch Delete Policy (v1.4.2)

- Deleting a branch NEVER cascades. Students, fees and payments are financial records and are never auto-deleted.
- Delete is allowed only when nothing references the branch. Currently checked: users with role branch_head and this branchId.
- When students, batches, fees or payments collections are built, their reference checks MUST be added to tryDelete() in branches.page.js.
- A branch with history is closed by setting status = inactive.
- UI rule: no native <select> in app pages; use createSelect() from js/components/ui-select.js (icon per option).

---

## 22. SYSTEM BUSINESS RULES (LOCKED v1.8.0 — owner-approved, do not change without owner)

### RULE 1 — STUDENT DELETE / REMOVE
(Applies on Batch page and All Students page. UI deferred — build when those pages are built.)

Every student row must have TWO options in the 3-dot menu:

OPTION A — "Delete Student (Hard Delete / Erase All)"
- Permanently erases: profile, admission, all fees, all payments, all receipts, batch enrollment, uploaded docs.
- After this, the student never existed in the system.
- No refund is created or recorded.
- Confirm by typing DELETE.
- Keep a minimal admin audit line only (who/when/name/ID) in udit. Do not keep the student record.

Business reason:
There is no paid "Change Course" feature. Hard Delete is the intentional bypass: admin erases the student, then creates a fresh admission in the new course. Do not "fix" this later by building a transfer engine unless the client pays for it.

OPTION B — "Remove Student (Mark as Left / Soft Remove)"
- Status becomes "left" / "removed".
- All history stays (payments, receipts, enrollment).
- Student drops out of active lists, active batches, and pending fees.
- Visible only under Archives / Left filter.
- Future installments and fees are cancelled (not pending).
- No refund. Institute policy: paid fees are not refunded.
- Confirm by typing REMOVE.
- Optional free-text reason. Audit: who/when/reason.

Summary:
- A = nuclear erase (course-change bypass, no refund)
- B = soft leave (history kept, no refund)

Status: DEFERRED — implement on Batch / Students pages.

### RULE 2 — COURSE FEE EDIT LOCK
(Partial now on Courses page; full lock when Batches page exists.)

If a course has any batch with status active/running (not ended):
- Admission Fee, Installment Amount, Material Fee = READ-ONLY.
- Banner: "This course is locked for fee edits. {N} active batch(es) use this course. Edit fees only after those batches are closed."
- Name, Code, Curriculum, Status, Eligibility stay editable.

EXAM FEE EXCEPTION:
- Exam fee is normally editable anytime (govt can revise it late).
- Once the first exam-fee payment is collected in a batch, that batch freezes exam fee.
- Freeze is per batch, not only on the course: copy value onto the batch as lockedExamFee when collection starts; students in that batch pay the frozen amount until the batch ends.
- Other batches on the same course that have not started exam collection stay free to use an updated exam fee.
- If admin tries to save a locked field: "Cannot change {field}. Batch {name} is running. Allowed only after batch ends."

Status: lock helpers live in courses.page.js (reads atches where courseId == course id and status not in ended/closed/completed/archived/cancelled). With no batches they stay unlocked. Batches page must write courseId, status, and lockedExamFee (when exam collection starts).

### RULE 3 — UNSAVED CHANGES WARNING (ALL form pages)
- Track dirty state on every form (any field different from last saved).
- On any leave attempt while dirty and not saving show modal:
  "You have unsaved changes. If you leave now, your changes will be lost."
  Buttons: [Stay on page] [Leave without saving]
- Stay = cancel navigation. Leave = allow.
- Covers: browser back/refresh/close (beforeunload), in-app router/sidebar/context switch/logout, and the form's own Cancel if dirty.
- Implemented once in public/js/utils/unsaved-guard.js (registerDirty, confirmLeave, clearDirty, isAnyDirty).
- Wired into: Branches, Sessions, Courses, Organisation. EVERY future form page must call registerDirty().

Standing requirement: every new page with a form MUST be wired to unsaved-guard in the same step that builds it.
Includes in-page Cancel / Add / Edit-other-row actions. No page is accepted without it.

### RULE 4 — FILTER BAR / DROPDOWN WIDTH (all list pages)
- Search: flex-grow with max-width ~420px.
- Each filter dropdown: min-width 220px so the longest option fits on ONE line.
- Open dropdown popup: auto width to content (max 380px), options never wrap.
- Flex layout with controlled min-widths; filters are never squeezed.
- Implemented in shared list-page.css, so Courses, Branches, Sessions and every future list page get it.

## 16. Session status must match dates
- Upcoming = start after today
- Running = today within start..end
- Closed = end before today
- Archived = any
No automatic status changes; mismatches flagged for Super Admin.
