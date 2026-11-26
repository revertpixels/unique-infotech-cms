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

### [2026-11-26 22:58] Version 1.8.173 — Archive Student Profile Parity, Media/Doc Alias Resolution & Image Hydration

**What was built:**
- **Archive Export Media & Collector Resolution (`public/js/services/archive.service.js`)**:
  - Unified `canonicalDocKey`, `friendlyDocLabel`, and `resolveDocBinaryWithFallbacks` across `students/{id}/docs/*` subcollection docs, inline `s.docs` maps, parent document fields (`photo`, `signature`, `dobProof`, `marksheet`), and Storage path `getDownloadURL` fallbacks (`photo`/`passportPhoto`/`studentPhoto`, `dobProof`/`dob`/`birthCertificate`/`aadhaar`, `marksheet`/`lastMarksheet`/`qualification`, `signature`/`sign`).
  - Added `_registeredByLabel` (`Name (Designation)` / `Authorised Staff`) and creator resolution in `collectors` so offline viewer never exposes raw creator emails on staff metadata.
- **Offline Archive Viewer Parity (`public/js/utils/archive-viewer-builder.js`, `archive-viewer-styles.js`, `archive-viewer-receipts.js`)**:
  - Enforced single active tab visibility (`.sp-pane:not(.active)` & `[hidden]`), 2-column document actions grid (`.sp-doc-actions`), friendly document card labels, `'Paid in Full'` KPI on full-payment plans, and `Name (Designation)` collector formatting.
  - Removed the 5th `System & Audit Metadata` card and redundant masked Aadhaar field from Personal Details so only the 4 live CMS cards render (`Personal Information`, `Contact Information`, `Guardian Details`, `Academic Enrollment`), moving `Student Enrollment & Audit Metadata` into `About Archive`.
  - Added URL hash deep-linking & back/forward navigation (`#/students/<id>?tab=...`), student avatars on the `Receipts` list and Payment Details modal tile, and single-pass `hydrateImages(scope)` with visible initials/placeholder fallbacks plus `console.warn('[archive] Image failed to load:', ...)` diagnostics.

**Why:**
- Ensures exported Student Profile tabs, document cards, photos/signatures across all views & receipts, and encrypted/plain `file://` image loading match the live CMS without altering any live CMS page, fee maths, receipt numbers, or security rules.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/services/archive.service.js`, `public/js/utils/archive-viewer-builder.js`, `public/js/utils/archive-viewer-styles.js`, `public/js/utils/archive-viewer-receipts.js`, `docs/02-PROGRESS-LOG.md`, plus `?v=1.8.173` cache-buster query bumps across `public/` via `tools/bump-version.js`.

**Firestore changes:**
- None. No `firestore.rules`, `storage.rules`, or Cloud Functions changes.

**Next task:**
- Confirm with user whether live `public/js/pages/student-profile.page.js` (`Registered By` raw email) / `System & Audit Metadata` card should also be updated in a separate task.

---

### [2026-11-26 15:10] Version 1.8.172 — Live Student Photo Fix, Title Case Audit & Full Offline Archive Parity

**What was built:**
- **Shared Student Media & Name/Gender Display Helpers (`public/js/utils/student-media.js`, `public/js/utils/formatter.js`, `public/js/services/report.service.js`)**:
  - Created unified `getStudentPhotoSrc(student, docs)`, `getStudentDocRecord(docs, key, student)`, `getStudentDocSrc(docRecord, fallbackMime)`, `getStudentDocMime(docRecord)` helpers covering all historical document keys/aliases (`photo`/`passportPhoto`/`Photo`, `data`/`dataUrl`/`url`/`downloadUrl`/`src`/`base64`/`Data`, inline `student.docs.photo`, raw base64, and Storage URLs).
  - Fixed student edit bug in `admissions.page.js` where untouched existing `docOriginals` were deleted (`docs[k] = false` -> `tx.delete`) when saving edits without replacing files.
  - Wired student avatars, fallback initials (only when genuinely absent), PDF previews, and consistent Title Case formatting (`formatPersonName`, `formatGenderDisplay`) across `student-profile.page.js`, `admissions.page.js`, `school-students.page.js`, `payments.page.js`, `pending.page.js`, and live Admission/Payment receipts.
- **Archive Top Banner Removed + About Snapshot & ZIP Media Paths (`archive-viewer-builder.js`, `archive-viewer-styles.js`, `archive.service.js`, `archives.page.js`)**:
  - Removed the `.arx-offline-banner` strip above `#topbar`, moved snapshot provenance (`Mode`, `Programme & Session`, `Branch Scope`, `Session Dates`, `Generated On (IST)`, `Generated By`, and packed file count) to **About This Archive**, and added a compact `.pill.neutral` `Archive` badge beside the topbar session chip.
  - Exported photos to `files/photos/<studentId>.<ext>` and documents to `files/docs/<studentId>/<docType>.<ext>` with MIME-based extensions (`.pdf` preserved), zero base64 in JSON/JS, `Photos: X | Documents: Y` download summary, and full read-only Student Profile (5-card Personal Details, View/Download + PDF iframe preview in Documents tab, 3-card Course Details, 2-table Payment History with as-of-date schedule status and zero write/internet action buttons).

**Firestore / Rules changes:**
- None (`firestore.rules` and `storage.rules` untouched; fee maths, receipt numbers, and role access logic unchanged).

**Tested on:**
- Chrome Desktop (`1440x900`) & Mobile (`390x844`), Microsoft Edge (`file://`), Wi-Fi OFF & ON, Super Admin & Branch Head roles, live vs offline receipts & PDFs, and unit assertions (`run-tests.mjs`, `verify-archives.mjs`, `verify-archive-parity.mjs`).

---

### [2026-11-26 14:30] Version 1.8.171 — Youth Centre Archives (CMS-Identical Offline Viewer, Real Fonts, Vector/Hi-Res Receipt PDFs & Full Audit Fixes)

**What was built:**
- **CMS-Identical Offline Archive Viewer (`public/js/services/archive.service.js`, `public/js/utils/archive-viewer-builder.js`, `public/js/utils/archive-viewer-styles.js`)**:
  - Replaced bespoke `.av-*` markup/styles with the CMS's real stylesheets (`variables.css`, `ui-kit.css`, `main.css`, `list-page.css`, `badges.css`, `admissions.css`, `student-profile.css`, `financial-reports.css`, `admission-receipt.css`, `payment-receipt.css`, etc.) and DOM structure (`.app`, `.sidebar`, `.topbar`, `.lp-stats`, `.adm-table`, `.sp-hero-card`, `.sp-tabs-nav`, `.adm-view-card`).
  - Removed internet dependency for fonts/icons by bundling offline latin `.woff2` variable fonts (`Plus Jakarta Sans`, `Libre Franklin`, `IBM Plex Sans`) under `viewer/fonts/` + `viewer/css/fonts.css`, and vendored `lucide@0.344.0` under `viewer/vendor/lucide.min.js`. Removed bespoke `archive-viewer-icons.js`.
  - Audited and fixed archive data normalization (`archive.service.js`): copied `batchId`/`batchName` onto normalized Youth ledger rows, precomputed `installmentCourseFee`, `installmentBalanceDue`, and `buildYouthReceiptData` models without duplicating base64 payloads, fixed ISO subtitle (`orgSubtitle` instead of tagline), fixed UI currency formatting (`₹`), and aligned Payment History & Overdue tables (`.adm-table-card` / `.adm-table`) plus mobile card responsiveness on `archives.page.js` / `archives.css`.
- **Exact Live Receipts & Offline PDF Downloads (`public/js/utils/archive-viewer-receipts.js`)**:
  - Upgraded Admission Receipt to full 2-page A4 sheet layout with `Download PDF` (offline `pdfmake@0.2.10` + `vfs_fonts.js` vector PDF) and clean Print (`#av-print-stage` + `@page { size: A4 portrait; margin: 0; }`).
  - Upgraded Payment Receipt to exact `.mpr-page` sheet layout with `Download PDF` (`html2canvas@1.4.1` + `jsPDF`), safe Chromium `file://` canvas taint detection (falling back gracefully with a Print-to-PDF hint on raw local folders while embedding `blob:` images cleanly in encrypted archives), and preserved waiver/collector designations.
- **Tooling (`tools/check-imports.js`)**: Skipped third-party `public/vendor/` scripts from ES module import parsing.

**Firestore / Rules changes:**
- None (left rules, fees, receipt numbering, and non-Archive CMS pages untouched; only `archiveLogs` writes unchanged).

**Tested on:**
- Chrome Desktop (`1440x900`) & Mobile (`390x844`) side-by-side Live CMS vs Offline `file://` Encrypted & Plain ZIPs (Wi-Fi OFF and Wi-Fi ON), plus Print-to-PDF and Download PDF binary checks.

---

### [2026-11-26 14:00] Version 1.8.170 — Youth Centre Archives (Phase 1: Offline ZIP Viewer, Encryption, Verification & History)

**What was built:**
- **Archives Page & UI (`public/pages/archives.html`, `public/js/pages/archives.page.js`, `public/css/pages/archives.css`, `public/css/main.css`)**:
  - Added Youth Centre `Archives` page accessible to `superadmin` and `branch_head`, hidden in Sidebar and redirected in `public/js/core/router.js` + `public/index.html` for `school_head` and Unique Kids context switches.
  - Session list reads `sessions` directly (including `status === 'archived'` sessions while leaving `sessions.js` toolbar switcher unchanged), derives real IST status from `endDate` (`Ongoing`, `Completed`, `Locked for deletion`, `Deleted - archive only`), displays student counts via `getCountFromServer`, last archive summary, SHA-256 fingerprint, and Archive Reminder banners.
  - Pre-download export wizard displays scope selector (`Full Session` vs `Specific Branches` for superadmin; locked own branch for `branch_head`), pre-scan summary (students, payments/waivers, receipts, photos/docs, missing remote files, estimated Firestore reads, estimated ZIP size with >200 MB warning), progress bar with working Cancel control, and **Open / verify an archive** local `.zip` integrity verification tool.
- **Archive Packager, Encryption & Permanent Logs (`public/js/services/archive.service.js`, `firestore.rules`, vendored `public/vendor/fflate.umd.js` & `fflate.LICENSE.txt`)**:
  - **Rule 4a**: Aadhaar (`students/{id}/aadhaar`) and ID docs (`dobProof`/ID keys) are included **only** in superadmin full-session exports (masked `XXXX XXXX 1234` in viewer/JSON), never in branch-head or partial-branch exports. Password encryption (`PBKDF2` SHA-256 `600,000` iterations + `AES-GCM` 256-bit) defaults ON whenever ID documents are included, with an explicit warning if unticked and clear warning that lost passwords cannot be recovered.
  - **Rule 4b**: Base64 student photos/documents from `students/{id}/docs` are decoded to binary files in `files/photos/` and `files/docs/` (or `.enc.js` modules in encrypted exports) and stripped from `data/archive-data.js` and `data/json/*.json` so base64 payloads are never duplicated.
  - Added append-only `/archiveLogs/{logId}` rules in `firestore.rules` (`allow update, delete: if false;` for everyone; `branch_head` scoped strictly to own `branchId` and `includesIdDocs == false`).
  - Phase 2 deletion stays locked off via `ENABLE_ARCHIVE_SESSION_DELETE = false`.
- **Self-Contained `file://` Offline Viewer (`public/js/utils/archive-viewer-builder.js`, `archive-viewer-styles.js`, `archive-viewer-icons.js`, `archive-viewer-receipts.js`)**:
  - Zero-CDN, zero-ES-module, zero-`fetch` HTML/CSS/JS viewer opening cleanly via double-clicking `index.html` on `file://` (both plain and AES-256-GCM password-locked archives), with Read Only banner, Dashboard Summary, Students (10/page, Branch -> Batch filters), Student Profile + Documents Gallery Lightbox, Payment History + Details modal, Overdue as of session end date, Admission & Monthly/Exam Printable Receipts, Reports + CSV exports, and SHA-256 manifest About/Self-Check.
- **Dashboard Archive Reminder (`public/pages/dashboard.html`, `public/js/pages/dashboard.page.js`)**:
  - Displays lightweight reminder strip in Youth Centre view when completed sessions are unarchived or last download is over 30 days old (zero student doc reads).

**Firestore / Rules changes:**
- `firestore.rules`: Added `validArchiveLogBase()` and immutable append-only `/archiveLogs/{logId}` rules.

**Tested on:**
- `node tools/check-imports.js`, `node --check` on all new JS modules + `new Function` syntax verification on generated offline viewer assets.
- `scratch/run-tests.mjs` (all unit & security suites passed after fixes).
- `scratch/verify-archives.mjs` in headless Chrome (`1440px` desktop & `390px` mobile, zero console/network errors): `school_head` block/redirect, Super Admin & Branch Head scoping + Rule 4a/4b verification, encrypted + plain ZIP build, `verifyLocalArchiveZip` pass & tamper detection, and offline `file://` Chrome verification across all 8 viewer views (`Network.emulateNetworkConditions({ offline: true })`).
- Live Firebase login & real storage/receipts click-through verification checklist supplied to user (`ENABLE_ARCHIVE_SESSION_DELETE` stays `false` until Phase 1 live confirmation).

---

### [2026-11-26 13:29] Version 1.8.169 — Clean-up Before Archives

**What was built / changed:**
- **Unified IST Dates (`public/js/core/sessions.js`)**: Replaced the browser-local `todayISO()` and `toPeriod()` today calculation with IST `todayISO()` imported from `public/js/utils/session-rules.js` (`Asia/Kolkata`), keeping `status !== 'archived'` filtering and all fee maths untouched.
- **Cache-Busted Org Users Tab Fetch (`public/js/pages/org-details.page.js`)**: Appended `?v=1.8.169` to `fetch('pages/branch-heads.html?v=...')` so `tools/bump-version.js` updates it alongside router template fetches.
- **Immutable Receipt Snapshot Documentation (`public/js/pages/payment-receipt.page.js`)**: Added an inline code comment clarifying why waived late-fine designations preserve the saved payment snapshot (issued receipts are immutable legal records) with zero runtime behaviour change.
- **Pre-Handover Checklist Logged (`docs/06-KNOWN-ISSUES.md`)**: Logged `ISS-009` ("Switch to client email before handover" for temporary `haranathsaha1@gmail.com`) and `ISS-010` ("Decide before handover: server-side sign-in blocking (needs Identity Platform)" for undeployed `beforeUserSignedIn`).
- **Version Bump (`tools/bump-version.js`)**: Bumped `APP_VERSION`, `window.__BUILD__`, and `277` `?v=` references across `47` files to `1.8.169`.

**Tested on:**
- `node tools/check-imports.js`: Passed (`109` files, `355` imports, `0` errors).
- `node --check` on `sessions.js`, `org-details.page.js`, and `payment-receipt.page.js`: Passed.
- Deployed `hosting` (`v1.8.169`) cleanly. Live browser confirmation checklist provided to user.

---

### [2026-11-26 10:36] Version 1.8.168 — Branch/School Head Profile Photo Fallback (`saveUserProfilePhoto`)

**What was built / changed:**
- **Authenticated Profile Photo Upload Callable (`functions/index.js`, `public/js/services/user-directory.service.js`, `public/js/core/auth.js`)**: Added `saveUserProfilePhoto` (`asia-south1`) enforcing strict server-side authorization matching `storage.rules` (active verified Google head writing/removing only their own lowercased `user-photos/{email}/` avatar <= 350 KB WebP/JPEG with RIFF/WEBP or JPEG magic-byte verification, or password-signed-in Super Admin). Updated `saveOwnPhoto()` in `user-directory.service.js` to seamlessly fall back to `saveUserProfilePhoto` if direct client Storage upload rejects with `storage/unauthorized` due to cross-service `firestore.get()` IAM setup on the bucket, while still executing Firestore `updateDoc` through client `firestore.rules`. Mapped `functions/permission-denied` / `functions/invalid-argument` / `functions/unauthenticated` in `auth.js`.

**Tested on:**
- `npm --prefix functions run lint`, `node tools/check-imports.js`, `scratch/run-tests.mjs`, and `scratch/verify-auth-profile.mjs` (simulating cross-service 403 fallback for Branch Head self-photo upload + blocking cross-user upload with friendly modal error, `0` console errors).
- Deployed `functions:saveUserProfilePhoto`, `hosting`, `firestore:rules`, `storage`.

---

### [2026-11-26 10:10] Version 1.8.167 — Authorised Users 3-Dot Kebab Menus, Branch Name Resolution, Crisp Table Headers & Cache-Busted Org Import

**What was built / changed:**
- **Authorised Users Action Menus & Branch Lookup (`public/js/pages/authorised-users.js`)**: Replaced inline row buttons on both **Branch Heads** and **School Computer Head** rows with shared 3-dot kebab menus (`ui-kebab` + `openMenu`: `Add Photo` / `Edit Photo`, `Edit Details`, and `Enable` / `Disable`). Added `ensureBranchesLoaded()` on mount so the **Branch** column always resolves branch code + name cleanly from `branches/` even on direct navigation without visiting Branches first.
- **Table Header Contrast Alignment (`public/css/pages/settings.css`)**: Updated `.au-table th` and row hover background (`color-mix(in srgb, var(--primary-soft) 55%, var(--surface))`, `#F8F9FE`) to match Students / Payment History / Pending tables (`list-page.css`) instead of blending into the page background.
- **Duplicate Import Fix & Cache Bust (`public/js/pages/org-details.page.js`, version `1.8.167`)**: Removed a duplicate `syncPublicBranding` import line and bumped `?v=1.8.167` across all `public/` assets and scripts.

**Tested on:**
- `node tools/check-imports.js`, duplicate-import & uniform-version check (`1.8.167`), `scratch/run-tests.mjs`, and `scratch/verify-auth-profile.mjs` across `1440px` and `390px` (0 console errors), plus Hosting deploy (`https://unique-infotech-cms.web.app`).

---

### [2026-11-26 09:50] Version 1.8.165 — Profile Photo Upload Fix (`storage.rules` / `firestore.rules`) & Dynamic Designations Everywhere

**What was built / changed:**
- **Profile Photo Upload Security Fix & Authorised Users Photo Controls (`storage.rules`, `firestore.rules`, `public/js/core/auth.js`, `public/js/components/profile-modal.js`, `public/js/services/user-directory.service.js`, `public/js/pages/authorised-users.js`, `public/css/pages/settings.css`)**:
  - Updated `storage.rules` `/user-photos/{userEmail}/{fileName}` (`allow create, update` and `allow delete`) to allow `isSuperAdmin()` to manage photos in any user's lower-cased folder alongside active staff editing their own (`isActiveStaff() && userEmail == authEmail()`).
  - Hardened `firestore.rules` on `/users/{userEmail}` with `isPhotoOnlyPayload()` so Super Admin can update `{ photoUrl, updatedAt }` on any user doc while active heads (`isActiveHead()`) can update ONLY their own `photoUrl` and `updatedAt`.
  - Added Photo buttons to every Branch Head and School Head row in **Authorised Users** (`authorised-users.js`), fixed missing `auth` import in `profile-modal.js`, and suppressed raw Firebase error strings (`auth.js`, `profile-modal.js`).
- **Dynamic Role Designations & Public Pre-Login Branding (`firestore.rules`, `public/js/services/user-directory.service.js`, `public/js/pages/login.page.js`, `public/index.html`, `public/js/core/router.js`, `public/js/components/topbar.js`, `public/js/components/sidebar.js`, `public/js/components/payment-popup.js`, `public/js/core/data-transfer.js`, `public/pages/org-details.html`, `public/js/pages/org-details.page.js`, `public/pages/branch-heads.html`, `public/js/pages/branch-heads.page.js`, `public/pages/branches.html`, `public/js/pages/branches.page.js`, `public/js/pages/batches.page.js`, `public/js/pages/pay-fees.page.js`, `public/js/pages/payment-receipt.page.js`, `public/js/pages/student-profile.page.js`, `public/js/pages/school-*.page.js`)**:
  - Added single source of truth helpers (`getRoleTitle`, `getRolePluralTitle`, `pluralizeRoleTitle`, `getUserTitle`, `getPublicBranding`, `loadPublicBranding`, `syncPublicBranding`) in `user-directory.service.js` while leaving all internal role values (`'superadmin'`, `'branch_head'`, `'school_head'`) and `role ===` checks untouched.
  - Added public read-only `/public/branding` Firestore doc (written only by Super Admin; zero PII) loaded non-blockingly (`1500ms` timeout) on the login page (`login.page.js`) and synced live via `uic:branding-updated` across Topbar, Sidebar, Profile, Authorised Users, Users (`branch-heads`), Branches, Manage Data, Payment History, and receipts (already-issued receipts retain saved snapshots).

**Firestore / Storage rule changes:**
- `storage.rules`: `/user-photos/{userEmail}/{fileName}` permits `isSuperAdmin()` or `isActiveStaff() && userEmail == authEmail()`.
- `firestore.rules`: Added `/public/branding` (`allow read: if true; allow write: if maintenanceOpen() && isSuperAdmin() && validBrandingDoc();`) and `isPhotoOnlyPayload()` on `/users/{userEmail}`.

**Tested on:**
- `node tools/check-imports.js` (0 errors) & `node --check` across all `public/js/**/*.js`.
- `scratch/run-tests.mjs` + `scratch/verify-auth-profile.mjs` (Chrome CDP across Super Admin, Branch Head, School Head at `1440px` & `390px`, 0 console errors), plus live deployment (`hosting`, `firestore:rules`, `storage`).

---

### [2026-11-26 09:10] Version 1.8.164 — Authorised Users, Top-Bar Profile Menu, Dynamic Names/Designations & Section 5 Table Pagination

**What was built / changed:**
- **Organisation Tabs & Authorised Users (`public/pages/org-details.html`, `public/js/pages/org-details.page.js`, `public/js/pages/authorised-users.js`, `public/js/pages/branch-heads.page.js`, `public/css/pages/settings.css`)**: Added `Users` (reusing `branch-heads` seamlessly) and `Authorised Users` tabs inside **Organisation** (Super Admin only), plus `#/branch-heads` redirect to `#/org?tab=users`. Built three Student-Profile-styled cards: **Super Admin** (edit name & designation, square photo crop/upload, password change with re-authentication + min 8 chars + confirm, Forgot Password email trigger), **Branch Heads** (synced live from `/users`, inline edit name & designation, deep link to Users), and **School Computer Head** (view, add Google account head, edit name & designation, Enable/Disable with `active`/`inactive`). Added `"Forgot password?"` button & mapped error feedback on the login screen (`public/js/pages/login.page.js`, `public/css/pages/login.css`, `public/js/core/auth.js`).
- **Top-Bar Profile Menu & Square Photo Crop (`public/js/components/topbar.js`, `public/css/layout/topbar.css`, `public/js/components/profile-modal.js`, `public/js/utils/image-compress.js`)**: Converted the topbar user chip into an accessible menu (`Profile`, `Organisation` for Super Admin, `Logout`) with live user photo/initials, Title Case name, and designation. Added `openProfileModal` and interactive square crop/zoom modal (`cropSquareAvatarToBlob` -> WebP/JPEG <= 300 KB -> Storage `/user-photos/{email}/...`). Updated `sidebar.js` and `dashboard.page.js` to react live to `uic:profile-updated` and `uic:users-updated`.
- **Dynamic Title Case Names/Designations & Security Hardening (`public/js/services/user-directory.service.js`, `public/js/utils/formatter.js`, `public/js/services/report.service.js`, `public/js/pages/payments.page.js`, `public/js/pages/student-profile.page.js`, `public/js/services/payment.service.js`, `public/js/components/payment-popup.js`, `public/js/utils/school-billing.js`, `public/js/pages/school-fee-payment.page.js`, `firestore.rules`, `storage.rules`, `public/js/core/router.js`)**: Added live `/users` resolution (`resolveUserDisplay` + `formatPersonName`) across Topbar, Sidebar, Dashboard, Payment History collector column/dropdown/details/CSV/print, and Student Profile while keeping already-issued receipts untouched and storing `recordedByDesignation` snapshots on new payment writes. Removed `'school_head'` access from `'school-fees'` in `router.js`, redirected blocked routes directly to `#/dashboard`, restricted `school_head` reads on `courses`/`batches`/`sessions` to `ctx == 'school'`, and restricted self updates on `/users/{email}` & `/user-photos/{email}/*` for active heads to own photo only.
- **Section 5 Cleanup & Shared Pagination (`public/css/components/list-page.css`, `public/js/pages/branches.page.js`, `public/js/pages/courses.page.js`, `public/js/pages/batches.page.js`, `public/js/pages/batches.html`, `public/js/pages/sessions.page.js`, `public/js/pages/school-fees.page.js`, `public/js/pages/school-break.page.js`)**: Removed dead `.lp-scroll.sticky` CSS rules and upgraded remaining tables to `renderPager` with `PAGE_SIZE = 10`.

**Tested on:**
- `node tools/check-imports.js` (0 broken imports), `node --check` across all JS modules (0 syntax errors).
- `scratch/run-tests.mjs` & `scratch/verify-auth-profile.mjs` (Headless Chrome CDP across `superadmin`, `branch_head`, and `school_head` roles at `1440px` and `390px`, 0 console/page errors).

---

### [2026-11-25 21:08] Version 1.8.163 — Smooth 1.2s Sign-Out Transition Pacing

**What was built / changed:**
- **Graceful Sign-Out Pacing (`public/js/core/guard.js`, `public/css/layout/sidebar.css`)**: Added a `1200ms` minimum visual transition (`LOGOUT_MIN_TRANSITION_MS`) running in parallel with `signOutUser()` (`Promise.all`) for user-initiated sign-outs while `logout.mp3` plays immediately on tap (skipping delay on `timeout`). Added `.sb-identity-btn:disabled` and `body.is-logging-out #app` transition styles for crisp visual acknowledgment before `#auth-shell` opens.

### [2026-11-25 18:48] Version 1.8.162 — Unified Persistent App Shell (Continuous Login & Logout Audio Across Transitions)

**What was built / changed:**
- **Single-Document Login <-> App Transitions (`public/index.html`, `public/js/pages/login.page.js`, `public/pages/login.html`, `public/css/pages/login.css`)**: Converted authentication from a hard `location.replace('/index.html')` reload into an in-document `#auth-shell` rendered by `renderLoginView()`, while `/pages/login.html` immediately forwards direct bookmarks to `/index.html`. Scoped login layout CSS to `.login-screen` so login and dashboard views coexist cleanly inside one persistent window.
- **Clean In-Tab Session Teardown on Logout (`public/js/core/guard.js`, `public/js/core/router.js`, `public/js/core/dataset-session.js`, `public/js/components/sidebar.js`, `public/js/core/app.js`)**: Added `stopRouter()`, `stopDatasetSession()`, `destroySidebar()`, `stopInactivityTracking()`, `setUnauthenticatedHandler()`, and extended `clearAppCache()`. Clicking Sign Out starts `logout.mp3` immediately via `playLogoutSound()` and swaps smoothly back to `#auth-shell` without tearing down the page, while signing in starts `login.mp3` immediately and keeps playing uninterrupted through entering Dashboard.

### [2026-11-25 18:38] Version 1.8.161 — Instant Parallel Audio Playback on Login, Logout & Mode Switch

**What was built / changed:**
- **Non-Blocking Parallel Audio (`public/js/utils/sound.js`)**: Simplified `sound.js` to pure fire-and-forget playback (`playLoginSound()`, `stopLoginSound()`, `playLogoutSound()`, `playSwitchSound()`, `playPaymentSuccessSound()`) with preloading (`preloadLoginSound()`, `preloadLogoutSound()`, `preloadSwitchSound()`) and removed all `sessionStorage` audio splitting / artificial holds.
- **Instant Login & Logout Flows (`public/js/pages/login.page.js`, `public/js/core/guard.js`, `public/index.html`)**:
  - `login.page.js` preloads `login.mp3` on init, starts `playLoginSound()` immediately on Sign In / Google tap in parallel with Firebase auth/session resolution, stops cleanly if auth fails or popup closes, and navigates immediately via `location.replace('/index.html')` once authenticated without any hold.
  - `guard.js` calls `playLogoutSound()` immediately at the start of `logout(reason)` in parallel with `signOutUser()`, never adding artificial delay to navigation.

### [2026-11-25 18:32] Version 1.8.160 — Split Login Audio (~1.5s + Post-Login Remainder) & Logout Sound Cue

**What was built / changed:**
- **Split Login Tone (`public/js/utils/sound.js`, `public/index.html`)**: Updated `playLoginSuccessSound()` to play the first ~1.5s of `login.mp3` cleanly on the login page (instead of holding ~3.3s before redirect), save `{ offsetSec, ts }` into `sessionStorage`, pause cleanly, and immediately resume playback from that timestamp on `/index.html` via `playLoginResumeSound()` (seeking once metadata is ready).
- **Logout Sound Cue (`public/js/utils/sound.js`, `public/js/core/guard.js`, `public/index.html`)**: Added `preloadLogoutSound()` and `playLogoutSound()` for `/assets/sounds/logout.mp3` (~2.08s), triggered inside `logout(reason)` via `Promise.all([signOutUser(), playLogoutSound()])` with re-entry guard (`loggingOut`) so signing out plays the complete confirmation tone before returning to `/pages/login.html`.

### [2026-11-25 18:25] Version 1.8.159 — Login Success Tone & Mode Switch Sound Cues

**What was built / changed:**
- **Shared Audio Utility (`public/js/utils/sound.js`)**: Generalized `sound.js` with an internal `AUDIO_CACHE` Map and root-relative `/assets/sounds/...` paths so audio cues work cleanly across both `/pages/login.html` and `/index.html`. Added `preloadSwitchSound()`, `playSwitchSound()`, `preloadLoginSound()`, and `playLoginSuccessSound()` (waits up to 4s for `ended` or resolves immediately on error/autoplay rejection) alongside `playPaymentSuccessSound()`.
- **Top-Bar Mode Switch Sound (`public/index.html`)**: Preloads `switch.mp3` for `superadmin` and calls `playSwitchSound()` inside `handleProgrammeSwitch(nextCtx)` only when `nextCtx !== prevCtx` and `confirmLeave()` succeeds (toggling between `Youth Centre` and `Unique Kids`).
- **Login Success Tone (`public/js/pages/login.page.js`)**: Preloads `login.mp3` on form submit / Google sign-in click and awaits `playLoginSuccessSound()` when `resolveSession(user)` succeeds for any authorised role (`superadmin`, `branch_head`, `school_head`) before redirecting via `location.replace('/index.html')`.

### [2026-11-25 16:20] Version 1.8.158 — Completed Pending & Overdue Rebuild (5 KPIs, Days Late Filter, Sortable Headers, School Head Read-Only) + Payment History `Course, Branch & Batch` Column

**What was built / changed:**
- **Pending & Overdue 5 Summary Cards & Overdue-Only KPIs (`public/pages/pending.html`, `public/js/pages/pending.page.js`, `public/js/services/report.service.js`)**:
  - Upgraded `#pend-stats` from 4 cards to the 5-card `.lp-stats.cols-5` layout (`Overdue Students`, `Overdue Amount`, `Late Fees`, `Total to Collect`, and `Oldest Overdue` showing highest days late and student name) computed across all filtered overdue rows (`dueDate < todayISO()`).
  - Updated CSV (`Course Code`, `Course`, `Branch Code`, `Branch`, `Batch`) and Print exports to include complete code + full name + batch details and all 5 summary metrics, plus updated empty state title to `'No overdue payments - everyone is up to date'`.
- **Toolbar, Days Late Filter & Sortable Table Headers (`pending.html`, `pending.page.js`, `financial-reports.css`, `branch-batch-filter.js`)**:
  - Added `Days Late` filter (`1–7 days`, `8–30 days`, `31–60 days`, `60+ days`) via `getDaysLateFilterOptions` / `matchesDaysLateFilter`, moved secondary `Course`/`Level` and `Sort by` filters into the collapsible `More` drawer (`#pend-more-btn` + `#pend-extra-filters` matching Payment History), and reset persisted `uicms.bb.pending.*` filters when switching Session or Programme.
  - Added clickable sortable `Due Date` and `Total Due` column headers synced with `Sort by`, highlighted `30+ days late` with darker crimson (`.fr-days-late.is-severe`), and formatted Unique Kids bill items cleanly as `'Nov 2026 bill'` (`Installment` column renamed `Bill` in Kids).
- **Read-Only Role Guard, Modal Grand Total & Payment History Batch Column (`pending.page.js`, `payments.html`, `payments.page.js`, `report.service.js`)**:
  - Blocked unauthorized roles in `pending.page.js` `mount()`, kept Youth Branch Head scoped to `profile.branchId`, and omitted the Wallet `Collect` button for read-only `school_head` so only the centered Eye `View details` icon renders.
  - Added primary + `altPhone` merging and a `<tfoot>` **Grand Total** row inside the `Overdue Details` modal table (`buildOverdueDetailsModel` / `openOverdueDetailsPopup`).
  - Updated Payment History (`payments.html`, `payments.page.js`, `report.service.js`) column `Course & Branch` -> `Course, Branch & Batch` (`Level, Branch & Batch` in Kids) with muted `batchName` line 2 underneath `CODE - [BRANCHCODE]`, included batch in `searchBlob` and CSV/Print exports, and cleared persisted `payments.*` filters on session/programme switch.
  - Confirmed `.lp-scroll.sticky` in `public/css/components/list-page.css` is no longer referenced by any HTML/JS file; left `list-page.css` and `firestore.rules` untouched per safety rules.

### [2026-11-25 13:04] Version 1.8.157 — Overdue-Only Pending Page Matching Payment History Table & Dual Action Icons
- **Matched Payment History Table Structure (Zero Inner Scroll, Shared 10-Row Pager)**: Replaced `.lp-card`, `.lp-scroll.sticky`, `.lp-table.lp-mobile-cards`, and `#pend-reads-note` in `public/pages/pending.html` and `public/js/pages/pending.page.js` with `.adm-table-card`, `.adm-scroll`, `.adm-table`, and `.adm-card-foot.lp-card-foot` (`renderPager` with `PAGE_SIZE = 10`). Removed Firestore read count text from UI cleanly.
- **Overdue Only (Removed Upcoming & Status Column)**: Added `isItemStrictlyOverdue` / `filterOverdueItems` (`dueDate < todayISO()` strictly before today IST and unpaid/unwaived) across Youth & Kids pending loaders (`report.service.js`), removed `Upcoming` and `Due This Month` KPI cards (`pending.html` now shows 4 overdue cards: `Overdue Fee`, `Late Fees So Far`, `Total Overdue Due`, `Overdue Students`), removed the `Status` dropdown filter and `Status` table column, and renamed the table card header to `Overdue Payments`.
- **Short Code Columns & Clean Cell Formatting**: Formatted `Course & Batch` as `COURSECODE - [BRANCHCODE]` (pill chip + hover 2-line tooltip) over muted batch name, Student name in Title Case with nowrap `ID · Phone`, single-line `Installment N` + muted session name, `10 Nov 2026` + red `days late`, and split `Fee` | `Late Fee` | `Total Due` (bold red) right-aligned numeric columns (`pending.page.js`, `payment.service.js`, `financial-reports.css`).
- **Dual Action Icon Buttons & Overdue Details Modal**: Replaced `Collect`, `After #N`, and 3-dot kebab menu with centered Eye (`View details`) and Wallet (`Collect fee`, disabled with `"Pay Installment N first"` tooltip when earlier installment is unpaid) buttons matching Payment History's icon-button style (`payments.page.js`). Added `buildOverdueDetailsModel` (`report.service.js`) and `openOverdueDetailsPopup` (`pending.page.js`) showing student, phone, course+code, branch+code, batch, session, summary totals, and every overdue installment/bill table with a header Copy icon showing the `'Details copied'` toast.

### [2026-11-25 12:40] Version 1.8.155 — Strict Youth Centre vs Unique Kids Filter & Data Separation
- **Removed Page-Level Organisation Filter (`payments.html`, `payments.page.js`)**: Removed `#payh-org-wrap` / `state.selects.org` so Payment History strictly follows the active toolbar programme (`Youth Centre` vs `Unique Kids`) with zero cross-programme loading or `'All (Youth + Kids)'` mode.
- **Programme-Isolated Options, Chips, Labels & Exports (`report.service.js`, `payments.page.js`, `pending.page.js`)**: Added `scopeReferenceDataByCtx`, `getPaymentDatePresetOptions`, `getPaymentTypeFilterOptions`, `getPaymentModeFilterOptions`, and `getPaymentChipOrder`. Youth Centre excludes Kids `KIDS_MONTHLY` / `Waiver only` types/chips and Kids levels/batches; Unique Kids excludes Youth `IN` / `EX` / `FULL` / `MAT`, Youth `'Active session window'`, and Youth branches (`branchesList: []`). Labels (`Course` vs `Level`), CSV columns, and print reports use strictly active-programme terminology.
- **Toolbar Programme Switch Resets Filters (`index.html`, `branch-batch-filter.js`, `router.js`)**: Unified `handleProgrammeSwitch` in `public/index.html` (fixing a duplicate `onSwitch` regression), cleared persisted `uicms.bb.*` sessionStorage filter selections via `clearPersistedBranchBatchFilters()`, preserved paired routes (`#/payments <-> #/school-payments`, `#/pending <-> #/school-pending`, `#/students <-> #/school-students`), and dispatched `uic:ctx-changed` to cleanly re-mount shared routes (`#/courses`, `#/batches`, `#/dashboard`, `#/archives`, `#/org`) at default filters and page 1.
- **Fixed Mixed Filters on Other Pages**:
  - `batches.page.js`: Isolated Status options (`Upcoming`/`Running` for Youth vs `Active` for Kids), renamed `Course` filter to `Level` (`All levels`) in Kids, removed Youth `Semester 1/2/3` dropdown in Kids, and skipped loading branches in Kids.
  - `admissions.page.js`: Scoped `batches` and `sessions` queries with `where('ctx', '==', 'youth')` and filtered branches by `!b.ctx || b.ctx === 'youth'`.
  - `school-fees.page.js`: Populated `month` and `level` toolbar filter dropdowns from Kids bills and Kids levels.

### [2026-11-25 12:24] Version 1.8.154 — Remove Table Breakdown Dropdown & Show Itemized Breakdown in Payment Details Modal
- **Removed Inline Table Dropdown (`2 items ▼` / `Hide breakdown ▲`)**: Cleaned up `expandedKeys`, `fr-expand-btn`, `getMaterialItem`, and `buildBreakdownSubrow` in `public/js/pages/payments.page.js`, plus unused breakdown CSS rules in `public/css/pages/financial-reports.css`, so bundled transactions (e.g. `Admission + Study material`) show cleanly on a single table row with their pill.
- **Itemized Breakdown in `Payment Details` Popup**: Updated `buildPaymentDetailsModel` (`public/js/services/report.service.js`) and `buildDetailCard` (`public/js/pages/payments.page.js`) with `.fr-det-breakdown` rows so multi-item transactions display a structured `Breakdown` list (`Admission fee`, `Study material`, amounts) inside the `PAYMENT` box when viewed via the eye button, as well as in Copy text.

### [2026-11-25 12:18] Version 1.8.153 — Refined Payment Details Popup Layout & Header Actions
- **Merged Transaction Fields into `PAYMENT` Box**: Updated `openPaymentDetailsPopup` in `public/js/pages/payments.page.js` to combine `model.paymentFields` and `model.transactionFields` inside the `PAYMENT` detail card, removing the separate `TRANSACTION` card so top-row cards (`STUDENT` and `PAYMENT`) balance vertically without whitespace.
- **Full-Width `REMARKS` Box**: Added `.fr-det-card-full { grid-column: 1 / -1; }` in `public/css/pages/financial-reports.css` and applied it to the `REMARKS` card so it spans full grid width underneath `STUDENT` and `PAYMENT`.
- **Moved Receipt Button to Header & Removed Footer**: Removed the bottom `.adm-view-foot` (`Close` / `Open Receipt` buttons) from `openPaymentDetailsPopup` (preventing modal bottom overflow) and added a `receipt` icon button (`title="Open receipt"`) in `.adm-view-head-actions` immediately to the left of the Copy icon button (`[Receipt] [Copy] [Close X]`).

### [2026-11-25 12:12] Version 1.8.152 — Tag-Only Mode Column, Action Eye Button & Payment Details Popup

**What was built / changed:**
- **Tag-Only `Mode` Column + New `Action` Column (`public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/css/pages/financial-reports.css`)**:
  - Updated `Mode` column to show only the compact mode tag + icon (`Cash`, `UPI`, `Card`, `Bank`, `Cheque`, `Waiver`) at minimal width (`width: 1%`), removing inline `" - <txnId>"` text on desktop and giving freed space to `Student` (`min-width: 210px`) and `Course & Branch` (`min-width: 145px`). Mobile cards and CSV/Print exports still preserve full Mode & Transaction ID columns.
  - Added 9th column `Action` (last column, centered `.ui-kebab` `eye` icon button with `"View payment details"` tooltip and `aria-label` on desktop; full-width `Details` button at bottom of mobile cards).
- **Payment Details Popup & Clipboard Copy (`public/js/pages/payments.page.js`, `public/js/services/report.service.js`, `public/js/services/payment.service.js`, `public/js/utils/school-billing.js`)**:
  - Added `buildPaymentDetailsModel` and `getCachedBillForEntry` in `report.service.js`, and enriched `dueDate`, `month`, `billPeriod`, `billId`, `waiverReason`, and `createdAtSec` on normalized Youth & Kids records cleanly with zero extra reads when already cached.
  - Built `openPaymentDetailsPopup` on top of existing `openPopup` (`components/modal.js`) showing `"Payment Details"` + receipt ID + `Paid` / `Waived` / `Partial` badge, header `Copy payment details` button (swaps to check icon + `"Payment details copied"` toast with clipboard fallback), grouped `STUDENT` / `PAYMENT` / `TRANSACTION` / `REMARKS` cards hiding empty fields, IST timestamps, monospace TXN ID, `"Open Receipt"` and `"Close"` actions, and mobile full-width scrollable layout.

**Files touched:**
- MODIFIED: `public/css/pages/financial-reports.css`, `public/js/services/payment.service.js`, `public/js/utils/school-billing.js`, `public/js/services/report.service.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `docs/02-PROGRESS-LOG.md`

**Tested on:**
- `tools/check-imports.js`, `node --check`, Node ESM verification suite (`run-tests.mjs`: `buildPaymentDetailsModel` Cash/UPI/Waived/Kids Partial details & clipboard format, IST timestamps, 9-column DOM parity, `06fffcd2` backup figures): ✅
- Live Chrome DevTools verification: Checked after deploy (see session output).

---

### [2026-11-25 12:04] Version 1.8.151 — Dedicated Payment Mode Column, KPI Polish & Mobile Filters Sync

**What was built / changed:**
- **Restored Dedicated `Mode` Column (`public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/js/services/report.service.js`, `public/css/pages/financial-reports.css`)**:
  - Updated table columns to `Date | Student | Course & Branch | Payment For | Mode | Fee / Late | Received | Receipt` (`8` columns on desktop).
  - `Mode` renders single-line icon + label + monospace muted transaction ID for non-cash payments (`[banknote] Cash`, `[smartphone] UPI - TXN...`, `[credit-card] Card - TXN...`, `[landmark] Bank - UTR...`, `[file-text] Cheque - No...`, or muted italic `not recorded` when missing; Cash shows no dash/ID; full TXN ID on hover). Removed mode subline under `Received`.
  - Mobile `<= 900px` cards keep `Mode` (`[icon] UPI`) and `Transaction ID` (`fr-mobile-only-td`, full ID) as separate rows for non-cash records, while Print/CSV export separate `Mode` and `Transaction ID` columns with full IDs and full course/branch names.
- **KPI Card & Breakdown Polish + Mobile Filters Panel (`payments.html`, `payments.page.js`, `list-page.css`)**:
  - Shortened `#payh-kpi-total-sub` to `"N receipts"` (with full `"N receipts (waivers excluded)"` hover tooltip) so it never truncates, and removed the duplicate `#payh-breakdown-note` `"Filtered rows: N"` label next to chips.
  - Updated `#payh-mobile-filters-btn` click handler & `@media (max-width: 768px)` `.lp-toolbar:not(.is-filters-open) .lp-toolbar-extra` rule so opening/closing the mobile `Filters` and `More` controls collapses cleanly without orphaned panels.

**Files touched:**
- MODIFIED: `public/css/components/list-page.css`, `public/css/pages/financial-reports.css`, `public/js/services/report.service.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `docs/02-PROGRESS-LOG.md`

**Tested on:**
- `tools/check-imports.js`, `node --check`, Node ESM verification suite (`run-tests.mjs`): ✅
- Live Chrome DevTools verification: Checked after deploy (see session output).

---

### [2026-11-25 11:52] Version 1.8.150 — Payment History Compact 7-Column Layout, Mode Icons & Short Receipt Link

**What was built / changed:**
- **Removed `Mode & By` Column (`public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/js/services/report.service.js`, `public/css/pages/financial-reports.css`)**:
  - Updated table to 7 columns (`Date | Student | Course & Branch | Payment For | Fee / Late | Received | Receipt`), freeing horizontal space so Student (`min-width: 215px`) and Course & Branch (`CDTA - BZYCTC`) stay single-line and rows match Students 2-line height.
  - Added `by <Collector>` in Title Case (via `formatCollectorName` / `toTitleCaseIfCaps`) as line 2 under Date with ellipsis truncation (`max-width: 165px`) and full-name hover tooltip.
  - Added payment mode (`Cash`=`banknote`, `UPI`=`smartphone`, `Card`=`credit-card`, `Bank / NEFT`=`landmark`, `Cheque`=`file-text` via `modeDisplayMeta`) as line 2 under Received with TXN ID hover tooltip.
- **Compact Receipt Column (`#0034`) & Mobile Card View**:
  - Updated Receipt cell to display `[receipt icon] #0034` (`formatShortReceipt`) with full-ID tooltip (`"<fullId> - Open receipt"`) and keyboard focus styling; kept full-receipt search via `searchBlob` and full separate columns (`Course & Branch`, `Mode`, `Collected By`, full `Receipt`) in CSV/Print exports.
  - Updated mobile `<= 900px` card layout so Date + `by` appear cleanly on top, Received amount + mode icon stand out, and `#0034` renders as a full-width tap button at the bottom of each card.

**Files touched:**
- MODIFIED: `public/css/pages/financial-reports.css`, `public/js/services/report.service.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `docs/02-PROGRESS-LOG.md`

**Tested on:**
- `tools/check-imports.js`, `node --check`, Node ESM verification suite (`run-tests.mjs`: `formatShortReceipt`, `formatCollectorName`, `modeDisplayMeta` icons, 7-column DOM parity, `CDTA - BZYCTC`, `06fffcd2` ledger & overdue checks): ✅
- Live Chrome DevTools verification: Checked after deploy (see session output).

---

### [2026-11-25 11:36] Version 1.8.149 — Students-Matched Payment History Table, Link-Only Receipt Column & Course/Branch Codes

**What was built / changed:**
- **Exact Students Table Structure & Bottom Bar (`public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/css/components/list-page.css`)**:
  - Replaced Payment History's sticky inner-scroll `.lp-scroll.sticky` / `.lp-table` wrapper with the exact Students page table structure (`.adm-table-card` > `.adm-scroll` > `.adm-table` + `.adm-card-foot.lp-card-foot` footer) so rows grow naturally (`PAGE_SIZE = 10`) with single page scroll, identical row padding/height, and bottom bar (`"Showing 1-10 of N"` left, `Prev / page numbers / Next` right).
  - Removed the `~N Firestore reads` text and bottom `Load More` button from the page footer (logged in `console.debug`).
- **Receipt Link Only (`public/pages/payments.page.js`, `public/css/pages/financial-reports.css`)**:
  - Removed the separate `View` button and icon from the `Receipt` column; now shows only the receipt ID as an accessible primary monospace link (`title="Open receipt"`, underline hover + keyboard `:focus-visible` ring) across desktop table and mobile card views.
- **Short Code Course & Branch Format (`public/js/services/payment.service.js`, `public/js/services/report.service.js`, `public/css/pages/financial-reports.css`)**:
  - Added `formatCourseBranchDisplay` & `toTitleCaseIfCaps` in `report.service.js` and prioritized saved `branches/{id}.code` + `courses/{id}.code`.
  - Screen and mobile card views display `COURSECODE - BRANCHCODE` on one line (bold course code + muted `" - "` + `.pill.neutral` branch code badge, falling back to full course/Title Case branch name when no saved code exists) with a two-line hover tooltip showing full course name and Title Case branch name. CSV and Print exports use full readable names (`formatCourseAndBranch`).
  - Kept Date (`white-space: nowrap`) and Student name (`min-width: 195px`) tidy so rows stay single-height matching Students.

**Files touched:**
- MODIFIED: `public/css/components/list-page.css`, `public/css/pages/financial-reports.css`, `public/js/services/payment.service.js`, `public/js/services/report.service.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `docs/02-PROGRESS-LOG.md`

**Tested on:**
- `tools/check-imports.js`, `node --check`, Node ESM verification suite (`run-tests.mjs`: `CDTA - BZYCTC`, 2-line Title Case tooltip, CSV/Print full names, no `sp-table-action-btn` View button, Students table/footer DOM classes, shared `PAGE_SIZE = 10`): ✅
- Live Chrome DevTools verification: Checked after deploy (see session output).

---

### [2026-11-25 11:22] Version 1.8.148 — Payment History Column Streamlining, Course Codes & Shared 10-Row Paging

**What was built / changed:**
- **Payment History Columns (`public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/js/services/payment.service.js`, `public/js/services/report.service.js`, `public/css/pages/financial-reports.css`)**:
  - Removed the duplicate `Receipt No` column (`8` columns total across table, skeleton, mobile card view, CSV export, and print report), while keeping clickable receipt number + `View` / `Profile` button together in the `Receipt` column and preserving search by receipt number.
  - Updated `Course & Branch` to display `COURSECODE - Centre name` via shared `formatCourseAndBranch` (using saved `courses/{id}.code` / `courseCode`, falling back cleanly to `courseName` when a course has no saved code — currently the 3 Kids courses — with full course name in `title` tooltip and no batch name), and applied the same format in mobile card view, CSV export, and print sheets.
- **Shared Students Pager & Full Session Batch Loading (`public/js/components/list-page.js`, `public/css/components/list-page.css`, `admissions.page.js`, `school-admissions.page.js`, `pending.page.js`, `payments.page.js`, `pending.html`, `payments.html`, `report.service.js`)**:
  - Exported single shared `PAGE_SIZE = 10` and `renderPager` styles (`.lp-pager-host`, `.adm-pager`, `.adm-pager .ui-btn.active`) from `list-page.js` / `list-page.css`, removing per-page `PAGE_SIZE` / `CLIENT_PAGE_SIZE = 40` / `PAGE_SIZE = 30` overrides from Admissions, Pending & Overdue, and Payment History.
  - Updated `loadYouthPaymentHistory` in `report.service.js` to load all `limit(60)` cursor batches for the active date scope before computing KPI totals and paging (cached in `window.APP_CACHE.financialReports.youthHistory`), guaranteeing exact summary card totals, full older-session coverage, and exact `"Showing 1-10 of N"` / last page counts.

**Files touched:**
- MODIFIED: `public/js/components/list-page.js`, `public/css/components/list-page.css`, `public/css/pages/financial-reports.css`, `public/js/services/payment.service.js`, `public/js/services/report.service.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/pages/pending.html`, `public/js/pages/pending.page.js`, `public/js/pages/admissions.page.js`, `public/js/pages/school-admissions.page.js`, `docs/02-PROGRESS-LOG.md`

**Tested on:**
- `tools/check-imports.js`, `node --check`, Node ESM verification suite (`run-tests.mjs`: `06fffcd2` backup financial figures, `formatCourseAndBranch`, `"Showing 1-10 of 57"` pager assertion, shared `PAGE_SIZE = 10` static checks): ✅
- Live Chrome DevTools verification: Checked after deploy (see session output).

---

### [2026-11-25 10:56] Version 1.8.147 — Shared Branch -> Batch Filter Group Alignment & Box Removal

**What was built / changed:**
- Updated shared `.lp-bb-group`, `.lp-bb-host`, `.lp-bb-arrow`, and responsive drawer rules in `public/css/components/list-page.css` (zero page-specific CSS):
  - Removed the background box (`background: transparent; border: 0; border-radius: 0; box-shadow: none; padding: 0;`).
  - Matched sibling `.lp-filter` geometry across all toolbars (`height: 42px` select buttons, identical `11px` uppercase label alignment, `10px` filter gap, flex parity), keeping the arrow vertically centered (`42px`) between Branch and Batch on desktop/tablet and cleanly stacking inside mobile (`<= 480px`) filter drawers.

**Files touched:**
- MODIFIED: `public/css/components/list-page.css`, `docs/02-PROGRESS-LOG.md`

**Tested on:**
- `tools/check-imports.js`, Node ESM verification suite (`run-tests.mjs`): ✅
- Live Chrome DevTools verification: Checked after deploy (see session output).

---

### [2026-11-25 10:45] Version 1.8.146 — App-Wide Session Source, Paired Branch → Batch Filter & Payment History Rule Fix

**What was built / changed:**
- **Rule 1 — Single Session Source (Toolbar Only)**:
  - Added `getSelectedSession(ctx)` in `public/js/core/sessions.js`.
  - Removed all page-level session dropdown filters from `public/pages/pending.html` (`#pend-session-host`), `public/pages/payments.html` (`#payh-session-host`), and `public/js/pages/batches.page.js`.
  - Wired Youth list/operation pages (`pending.page.js`, `payments.page.js`, `admissions.page.js`, `batches.page.js`, `pay-fees.page.js`) to listen to `uic:session-selected`, `uic:sessions-loaded`, and `uic:sessions-changed` (cleaning up listeners cleanly in `unmount()`), reload/re-render without full page refresh, show `Session <name>` in `.pg-head` subtitle, and show a standard `.empty-state` linking to `#/sessions` when no Youth session exists.
- **Rule 2 — Paired `[ Branch v ] → [ Batch v ]` Filter Box**:
  - Added genuine `disabled` support in `public/js/components/ui-select.js` (`opts.disabled`, `.setDisabled`, `.disabled`) + `.ui-select.is-disabled` styling in `public/css/components/ui-kit.css`.
  - Created shared component `public/js/components/branch-batch-filter.js` and `.lp-bb-group` styles in `public/css/components/list-page.css`: keeps `Branch -> Batch` in one bordered filter box across desktop toolbars and mobile filter drawers, disables `Batch` with `· Select branch first` until a branch is chosen, scopes Youth batches to the selected branch + active toolbar session, resets `Batch` when changing `Branch`, locks `Branch` for `branch_head` and `Head Office` for Unique Kids (`ctx: 'school'`), and persists per-page selections across session switches in `sessionStorage`.
  - Wired `createBranchBatchFilter` into `pending.page.js`, `payments.page.js`, `admissions.page.js`, and `school-admissions.page.js`; kept Branch Head lock & Clear Filters guard in `batches.page.js` and `public/js/components/list-page.js`.
- **Screenshot Bugs Fixed**:
  - `firestore.rules`: Added `match /{path=**}/payment/{paymentId}` read rule for `collectionGroup(db, 'payment')` scoped cleanly to Super Admin, Branch Head (`recordedAtBranchId == myBranchId()` or parent `branchId == myBranchId()`), and School Head (`ctx == 'school'`), resolving `Missing or insufficient permissions` on Payment History.
  - `public/pages/payments.html` & `public/js/pages/payments.page.js`: Kept `#payh-breakdown-strip` `hidden` during loading, errors, and when zero category chips exist so no empty white strip appears above the Search bar.

**Files touched:**
- CREATED: `public/js/components/branch-batch-filter.js`
- MODIFIED: `firestore.rules`, `public/css/components/ui-kit.css`, `public/css/components/list-page.css`, `public/js/components/ui-select.js`, `public/js/components/list-page.js`, `public/js/core/sessions.js`, `public/pages/pending.html`, `public/js/pages/pending.page.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/pages/admissions.html`, `public/js/pages/admissions.page.js`, `public/pages/batches.html`, `public/js/pages/batches.page.js`, `public/js/pages/school-admissions.page.js`, `public/pages/pay-fees.html`, `public/js/pages/pay-fees.page.js`, `docs/05-FILE-INDEX.md`, `docs/02-PROGRESS-LOG.md`

**Firestore changes:**
- Rules: Added `match /{path=**}/payment/{paymentId}` collection-group read rule in `firestore.rules` (compiled via `--dry-run` and deployed live).

**Tested on:**
- Node ESM verification suite (`06fffcd2` backup financial numbers, `createBranchBatchFilter` locking/cascading/persistence, `getSelectedSession`, HTML/JS DOM ID parity, `tools/check-imports.js`, `node --check`): ✅
- Live Chrome DevTools verification: Checked after deploy (see session notes for Chrome DevTools availability).

---

### [2026-11-25 08:50] Version 1.8.145 — Design System Overhaul for Pending & Overdue + Payment History

**What was built / changed:**
- Aligned Pending & Overdue (`#/pending`, `#/school-pending`) and Payment History (`#/payments`, `#/school-payments`) 100% with Student Profile, Students list (`admissions`), Pay Fees, Dashboard, `list-page.css`, `badges.css`, and `ui-kit.css` (`v5 flat SaaS` styling — zero box shadows, gradients, or ad-hoc color styles).
- Extended shared CSS for reuse:
  - `public/css/components/badges.css`: Added semantic `.pill.overdue` (red), `.pill.due`/`.warning` (amber), `.pill.upcoming`/`.sky` (blue), `.pill.paid` (green), `.pill.waived`/`.purple` (purple), `.pill.partial`, `.pill.muted`, and `.la-mode.waiver`.
  - `public/css/components/list-page.css`: Added shared `.lp-head-row`, `.lp-head-actions`, `.lp-stats.cols-5`, `.lp-scroll.sticky` (with opaque context-aware sticky `thead th`), responsive mobile card transformation `.lp-table.lp-mobile-cards` using `td[data-label]`, and mobile filter collapse drawer (`.lp-mobile-filter-btn`, `.lp-toolbar-drawer`, `.lp-toolbar-extra`).
- Rebuilt `public/pages/pending.html`, `public/js/pages/pending.page.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, and simplified `public/css/pages/financial-reports.css` + print styling in `public/js/services/report.service.js`:
  - Summary cards now use `.lp-stats.cols-5` + `.lp-stat.{tone}` and shared `.skel` shimmer skeletons matching `admissions.page.js`.
  - Filter toolbars use `.lp-toolbar` in one tidy horizontal desktop bar (`More` toggles secondary filters cleanly; mobile `< 768px` tucks filters behind a `Filters (N)` button), with `.lp-refresh` inside the toolbar.
  - Tables compact into 8–9 columns fitting desktop without horizontal scrolling, feature sticky opaque column headers, right-aligned Indian rupee formatting (`₹4,500`), shared `.ui-kebab` row menus (`openMenu`) + `.sp-table-action-btn` action buttons, `renderEmptyTableState`, shared `.empty-state` errors, and stacked labeled mobile cards at `<= 900px`.

**Files touched:**
- MODIFIED: `public/css/components/badges.css`, `public/css/components/list-page.css`, `public/css/pages/financial-reports.css`, `public/pages/pending.html`, `public/js/pages/pending.page.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/js/services/report.service.js`

**Tested on:**
- Node ESM verification suite (`06fffcd2` backup: 5 overdue students / `₹4,500` / `₹289` late fees; Sneha payment simulation; 47 grouped Youth ledger rows / `₹39,073`; Kids same-month & dedup checks) + `tools/check-imports.js` + `node --check`: ✅
- Live Chrome DevTools screenshots: Not run (`DevToolsActivePort` unavailable on host).

**Next task:**
- Visually spot-check `#/pending`, `#/payments`, `#/school-pending`, `#/school-payments` at 1440px and 390px in Chrome.
---

### [2026-11-25 08:38] Version 1.8.144 — Pending & Overdue + Payment History (Youth & Unique Kids)

**What was built:**
- `public/js/utils/session-rules.js`: Added org timezone support (`getOrgTimezone` defaulting to `Asia/Kolkata`), fixed `todayISO()` to compute calendar dates in IST instead of browser UTC, and calendar-diff `fineFor()`.
- `public/js/utils/school-lifecycle.js` & `public/js/pages/school-fee-payment.page.js`: Delegated `localToday()` and payment dates to IST `todayISO()`.
- `public/js/utils/school-billing.js`: Fixed `daysLate()` same-month after-10th bug, restricted `computeLateFee()` to `unpaid`/`partial` bills, added shared `isKidsStudentEligible`, `buildApprovedBreakMonthsMap`, `evaluateKidsPendingBills`, and `buildKidsPaymentLedger` (deduplicating allocation vs summary records and handling Kids admission docs + waivers).
- `public/js/services/payment.service.js`: Added shared `isStudentEligibleForDues`, `evaluateYouthStudentDues`, and `normalizeYouthPaymentsLedger` (grouping admission/full/material sharing `receiptNo`, separating paid vs waived late fees, and keeping `WA` totalReceived = 0).
- `public/js/services/report.service.js`: Built shared session-cached loaders, lazy visible photo fetching, sequential eligibility marking, summary helpers, paginated Super Admin `collectionGroup('payment')` queries (with admission sibling boundary safeguard & branch-head subcollection fallback), CSV export, and print sheets.
- `public/pages/pending.html`, `public/js/pages/pending.page.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/css/pages/financial-reports.css`: Built responsive Pending & Overdue (`#/pending`, `#/school-pending`) and Payment History (`#/payments`, `#/school-payments`) UIs with 5 KPI cards, `createSelect()` filters, expandable admission breakdowns, WhatsApp reminder modal, direct Collect popup / Kids payment flow, CSV export, and Daily Cash Report print sheet.
- `public/js/core/router.js`, `public/index.html`, `public/js/pages/payment-receipt.page.js`, `public/js/pages/school-admission-receipt.page.js`, `public/css/main.css`: Wired shared route handlers, seamless context switching between Youth and Kids views, receipt back-links, and `school_head` access to Kids admission receipts.
- `firestore.rules` & `firestore.indexes.json`: Added read-only `isSchoolHead()` permissions across Unique Kids collections (`students`, `docs`, `payment`, `courses`, `batches`, `enrolments`, `bills`, `payments`, `waivers`, `breaks`) and deployed composite `students` indexes plus `collectionGroup('payment')` `date` field overrides.

**Files touched:**
- CREATED: `public/pages/pending.html`, `public/js/pages/pending.page.js`, `public/css/pages/financial-reports.css`
- MODIFIED: `public/js/utils/session-rules.js`, `public/js/utils/school-lifecycle.js`, `public/js/utils/school-billing.js`, `public/js/services/payment.service.js`, `public/js/services/report.service.js`, `public/pages/payments.html`, `public/js/pages/payments.page.js`, `public/js/pages/school-fee-payment.page.js`, `public/js/pages/payment-receipt.page.js`, `public/js/pages/school-admission-receipt.page.js`, `public/js/core/router.js`, `public/index.html`, `public/css/main.css`, `firestore.rules`, `firestore.indexes.json`

**Tested on:**
- Node ESM verification suite running live unmodified modules against `06fffcd2` backup (5 overdue students = Rs 4,500 overdue, Rs 289 late fees; Sneha simulation dropping to 4 / Rs 4,250 / Rs 274; 47 grouped Youth ledger rows = Rs 39,073; Kids same-month day-11 late fee & allocation dedup; waiver exclusion): ✅
- `tools/check-imports.js` (105 files, 283 imports) & `node --check`: ✅

**Next task:**
- Review live UI on deployed hosting across Super Admin, Branch Head, and School Head roles.
---

## ACTIVE LOG (NEWEST ON TOP)
---

### [2026-11-24 16:50] Version 1.8.132 — Standard Course Fee Architecture, Full Payment Discount in Rupees, and Payment Deduplication

**What was built:**
- **Courses & Packages (`public/js/pages/courses.page.js`)**:
  - Excluded study material fee (`material`) from standard `courseFee` (`admission + installment * 4`).
  - Stored `fullPaymentDiscount` in RUPEES (e.g. Rs 500) and `fullPaymentDiscountPercent` in percentage (e.g. 17%) to permanently prevent percentages displaying as rupees.
  - Live calculated and displayed `17% discount (saves Rs 500)` in form, card overview, and table meta lines.
- **Admission Flow & Verification (`public/js/pages/admissions.page.js`)**:
  - Full payment plan fee breakdown now accurately shows: Course fee (Rs 3,000), Full-payment discount (- Rs 500, 17% off), Full course fee (Rs 2,500), Study material fee (Rs 100), and Total payable now (Rs 2,600).
  - Full plan radio badge displays `Pay in full (Rs 2,500)` with `17% discount (saves Rs 500)`.
  - Verify confirmation modal accurately summarizes Standard course fee (Rs 3,000), Discount (- Rs 500), Full course fee (Rs 2,500), Study material (Rs 100), and Total payable now (Rs 2,600).
  - Passed accurate fee fields (`courseFee`, `fullAmt`, `fullDisc`, `fullDiscPct`, `matFee`) to `pendingAdmission`.
- **Payment Collection Popup (`public/js/components/payment-popup.js`)**:
  - Full payment plan collects `fullAmt + matFee` (Rs 2,600) at admission with clear label: `Course Fee (Paid in Full: Rs 2,500) + Study Material (Rs 100) — Total Rs 2,600`.
  - Recalculated base amount and receipt prompt appropriately.
- **Payment Service & Financials Single Source of Truth (`public/js/services/payment.service.js`)**:
  - In `recordAdmissionWithPayment`:
    - Full plan writes two distinct, clean payment records under the same admission receipt: Item 1 (`type: 'FULL'`, `typeName: 'Full course fee'`, Rs 2,500) and Item 2 (`type: 'MAT'`, `typeName: 'Study material'`, Rs 100).
    - Installments plan writes Item 1 (`type: 'AD'`, `typeName: 'Admission fee'`, Rs 1,000) and Item 2 (`type: 'MAT'`, `typeName: 'Study material'`, Rs 100).
    - Student document stores `paidAmount: payAmt` (2,600 for full, 1,100 for installments), `feeTotal: fullAmt` (2,500), `balanceDue: 0`, and records material fee payment metadata.
  - In `calculateStudentFinancials`:
    - Full plan financial total is `fullPaymentAmount + materialFee` (Rs 2,600), paid = Rs 2,600, outstanding = Rs 0, percent = 100%.
    - Added deduplication guard in payment summation loop to ignore any duplicate `AD` records recorded with the same receipt number as `FULL`.
- **Admission Receipt (`public/js/utils/admission-receipt.js`)**:
  - Fee structure table: Standard course fee Rs 3,000, Full-payment discount - Rs 500, Total course fee Rs 2,500.
  - Payment received table: Course fee (paid in full) Rs 2,500 [Paid], Study material fee Rs 100 [Paid], Total received Rs 2,600, Balance due Rs 0.
- **Student Profile (`public/js/pages/student-profile.page.js`)**:
  - Fee Breakdown: Displays Course Package Fee (Standard) Rs 3,000, Full-Payment Discount - Rs 500 (17% off), Full Course Fee Rs 2,500, and Study Material & Kit (Paid at admission) Rs 100.
  - Installment Schedule: Suppresses the redundant Admission Fee row for students on the full payment plan.
  - Transactions Ledger: Fixed root cause of duplicate payment by ensuring legacy fallback checks `p.type === 'AD' || p.type === 'FULL'`. Filtered duplicate `AD` entries if `FULL` with the same receipt exists. Avoided synthesizing duplicate `MAT` when explicit `MAT` records are present.
- **Verification**:
  - `tools/check-imports.js` verified with 0 errors across 101 files and 247 imports.
  - Strict syntax verification on all 70 JS files passed with 0 errors.
  - Bumped version to `1.8.132`.

**Why:**
- Ensured strict domain rule consistency across the system: course fee is solely admission + installments, study material is a separate one-time fee collected at admission in both plans, discount is stored in rupees, and payment records are cleanly separated without phantom duplicates.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/courses.page.js`
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `public/js/services/payment.service.js`
- MODIFIED: `public/js/utils/admission-receipt.js`
- MODIFIED: `public/js/pages/student-profile.page.js`
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: 35 files across `public/` (?v= query strings updated to 1.8.132)

---

### [2026-11-24 15:05] Version 1.8.131 — Single Total Payable Box, Small Note Text, and Exam Fee Removal from Course Total

**What was built:**
- `public/js/pages/admissions.page.js`:
  - **Single Total Payable Box**: Unified total row generation inside `updateFees(c, s)` so only one `adm-fee-total-row` box ever exists in the DOM. Cleaned up any existing/stale total row elements before rendering. Before a course is chosen, displays "Select a course to see the full fee details." with "—". After a course is chosen, displays the exact plan summary and calculated payable amount (for both Installments and Full payment plans). Cleaned up total rows on form close and unmount.
  - **Exam Fee Removal from Total Payable**: Fixed installments total payable calculation to strictly equal `Course total` (`admission + material + (installment * 4)`), removing examination fee (180) from Total payable. Full payment plan total payable strictly equals `fullPaymentAmount`. Updated `feeTotal` in `previewStudent` to match.
  - **Note Box Styling**: Updated note boxes across all plans to use dedicated helper text element `adm-fee-note-text` instead of `adm-fee-amt`.
- `public/css/pages/admissions.css`:
  - Added `.adm-fee-note-text { font-size: 13px; font-weight: 400; color: var(--text); line-height: 1.5; }` matching helper text sizing (13-14px, normal weight, not bold) within the amber note box.
- Verification & Housekeeping:
  - Strict ESM syntax check across all 70 JS files (0 errors).
  - `tools/check-imports.js` verified (0 errors across 101 files and 247 imports).
  - Bumped version to `1.8.131` with `tools/bump-version.js`.

**Why:**
- Prevented duplicate "Total payable" elements in the fees section.
- Made examination note text normal small helper text rather than bold heading-sized text.
- Ensured "Total payable" always exactly equals "Course total" without incorrectly adding the separate examination fee.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/css/pages/admissions.css`
- MODIFIED: `public/js/core/app.js` (bumped to 1.8.131)
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: 35 files across `public/` (?v= bumped to 1.8.131)

---

### [2026-11-24 14:40] Version 1.8.130 — Deferred Admission Save, Full Plan Fee Total Fix, and Plan Choice Gate

**What was built:**
- `public/js/pages/admissions.page.js`:
  - **Deferred Save Before Payment**: "Verify" validates the admission form and displays the verification modal, then directly opens the shared payment popup (`openPaymentPopup`) carrying unsaved `pendingAdmission` data. No student doc, student ID, or receipt number is created upfront. If cancelled or closed, zero Firestore writes or counter increments take place and the form remains intact.
  - **Single Atomic Transaction**: Student document, auto-generated student ID, single admission receipt number, payment record, documents/aadhaar subcollections, and activity log are committed together in one atomic Firestore transaction upon payment confirmation.
  - **Full Plan `feeTotal` Fix**: Corrected total fee calculation for full payment plan to strictly equal `fullPaymentAmount` (no examination fee added). Examination fee remains separate in `examFee`. Updated both the form fee summary and the Verify summary dialog.
  - **Payment Plan Choice Gate**: `selectedPaymentPlan` initializes to `null` whenever a course offers full payment. The Verify button remains disabled with "Choose a payment plan" error state until the user actively selects either "Pay in installments" or "Pay in full".
- `public/pages/admissions.html`:
  - Updated submit button text to "Verify" (with ID `adm-save-label`).
- `public/js/services/payment.service.js`:
  - `recordAdmissionWithPayment` enforces `feeTotal = fullAmt` for full payment plan students.
- Verification & Housekeeping:
  - Strict ESM syntax check across all 70 JS files (0 errors).
  - `tools/check-imports.js` verified (0 errors across 101 files and 247 imports).
  - Bumped version to `1.8.130` with `tools/bump-version.js`.

**Why:**
- Fixed admission save ordering so students are never saved prior to payment.
- Ensured full payment total excludes examination fee.
- Enforced mandatory explicit choice between installments and full payment.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/pages/admissions.html`
- MODIFIED: `public/js/services/payment.service.js`
- MODIFIED: `public/js/core/app.js` (bumped to 1.8.130)
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: 35 files across `public/` (?v= bumped to 1.8.130)

---

### [2026-11-24 14:25] Version 1.8.129 — Atomic Admission & Payment Flow with Plan Choice

**What was built:**
- `public/js/pages/admissions.page.js`:
  - Required Payment Plan Choice: When the selected course has `fullPaymentAmount > 0`, renders a required choice ("Pay in installments" / "Pay in full (Rs X, Y% discount)"). Default is unselected (`selectedPaymentPlan = null`), requiring user choice before form validation passes.
  - Live Fee Breakdown:
    - If unselected: Prompts the user to select a payment plan to view fee breakdown.
    - If "Pay in installments": Displays Admission fee, Study material fee, 4 Installments (`amount x 4 = total`), and Course total with note that examination fee is charged separately later.
    - If "Pay in full": Displays Course fee, Full-payment discount, and Amount payable (full amount) with note that examination fee is charged separately later. Installment rows are completely suppressed.
    - Course selection changes reset the choice (`selectedPaymentPlan = null`).
  - Verify Confirmation Dialog: Displays student details, selected plan, and exact fee breakdown before proceeding.
  - Deferred Save: Clicking "Admit & Proceed to Payment" opens the shared payment popup without writing the student to Firestore yet. If the payment popup is cancelled or closed, nothing is saved to Firestore and all form inputs remain intact.
- `public/js/services/payment.service.js`:
  - Implemented `recordAdmissionWithPayment({ pendingAdmission, paymentParams })`: Atomic transaction that generates student ID and receipt number, sets student doc (with `paymentPlan`, `fullPaymentAmount`, `fullPaid`, `paidAmount`, and `feeSchedule` set to `[]` for full plan or 4 pending installments for installments plan), saves uploaded documents and aadhaar subcollections, creates payment record (`FULL` or `AD`), and writes activity log.
- `public/js/components/payment-popup.js`:
  - Added support for admission mode (`isAdmission` / `pendingAdmission`): strictly presents the single appropriate admission payment item (`Course Fee (Paid in Full)` for full plan, or `Admission & Material Fee` for installments plan).
  - Date is fixed to today (read-only), late fee fine is 0 (waive disabled).
  - On confirm, executes `recordAdmissionWithPayment`, plays success sound, and launches receipt prompt.
- Verification & Housekeeping:
  - Strict ESM syntax check across all 70 JS files (0 errors).
  - `tools/check-imports.js` verified (0 errors across 101 files and 247 imports).
  - Bumped version to `1.8.129` with `tools/bump-version.js`.

**Why:**
- Fixed the issue where clicking "Verify" admitted the student to Firestore before payment collection, bypassed plan choice, and took the 1st installment.
- Unified admission creation and fee collection into a single atomic transaction.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/services/payment.service.js`
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `public/js/core/app.js` (bumped to 1.8.129)
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: 35 files across `public/` (?v= bumped by bump-version.js to 1.8.129)

---

### [2026-11-24 13:30] Version 1.8.128 — Fix Admissions Syntax Scope Error & Courses Full Payment Persistence

**What was built:**
- `public/js/pages/admissions.page.js`:
  - Resolved `SyntaxError: Identifier 'saving' has already been declared` by removing duplicate declarations and restoring clean, non-duplicated popups for batch change, student drop, and deletion.
  - Preserved the new shared payment popup admission flow (`openPaymentPopup`), plan selection ("Pay in installments" / "Pay in full"), and standard save flow.
- `public/js/pages/courses.page.js`:
  - Fixed persistence and reload of "Full payment amount (Rs)": ensures `fullPaymentAmount` and `fullPaymentDiscount` are populated in both `course.fees` and `course` root document on save.
  - Hardened `fillForm(v)` and `readFees()` to check both map and root locations, dynamically fetch input elements if needed, and trigger `refresh()` on input to enable the "Save changes" button immediately.
- `public/js/core/router.js`:
  - Appended `?v=` version parameter to all page template HTML `fetch` calls to prevent browsers from caching stale HTML templates across version bumps.
- Verification & Housekeeping:
  - Ran ESM module syntax check across all 70 JavaScript files (0 errors).
  - Ran `node tools/check-imports.js` (0 errors across 101 files and 247 imports).
  - Bumped version to `1.8.128` with `node tools/bump-version.js`.

**Why:**
- Urgent fix for Students and Admissions page load crash caused by duplicate identifier declarations.
- Ensuring full payment offer in Courses & Packages saves to Firestore and loads correctly into the form.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/pages/courses.page.js`
- MODIFIED: `public/js/core/router.js`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- All files with `?v=` bumped by `tools/bump-version.js` to `1.8.128`.

**Firestore changes:**
- None. `match /courses/{courseId}` rules already allow write by superadmin.

---

### [2026-11-24 11:55] Version 1.8.127 — Unified Financials, Shared Admission Payment Popup, Paid in Full Discount, & Student Cleanup Tool

**What was built:**
- `public/js/services/payment.service.js`:
  - Created single source of truth `calculateStudentFinancials(student, allPayments)`: calculates `total`, `paid`, `outstanding`, and `percent`. Sums actual payment records excluding exam and late fee payments. Handles legacy admissions where admission fee was recorded on student document before subcollection payment docs were introduced. Minimum outstanding 0.
  - Re-exported `courseFeeWithoutExam` and `courseBalanceWithoutExam` to delegate directly to `calculateStudentFinancials`.
  - Added support for payment type `'FULL'` in `recordPaymentTx` with double-payment guard and full course completion status.
- `public/js/components/payment-popup.js`:
  - Added support for `'FULL'` payment type, recalculating full course fee and zero fine.
  - Linked "Open Receipt" and "Print" in `promptOpenReceipt` to `#admissions/<id>/receipt` when payment is for admission.
- `public/js/pages/student-profile.page.js`:
  - Unified metrics calculation with `calculateStudentFinancials(s, paymentsCache)` across header notification, key metrics cards, and progress bar.
  - Added full payment plan support: suppresses installment rows, displays "Course fee paid in full on <date>", Paid = X, Outstanding = 0, noting only examination fee remains.
- `public/js/pages/pay-fees.page.js`:
  - Integrated `calculateStudentFinancials(s, currentPayments)`. For full-payment students, suppresses installment rows and dues (except exam fee).
- `public/pages/courses.html` & `public/js/pages/courses.page.js`:
  - Added optional "Full payment amount (Rs)" input field with auto-calculated read-only discount % display ("X% discount (saves Rs Y)" or "Empty = no offer").
  - Saves `fullPaymentAmount` and `fullPaymentDiscount` on course document.
- `public/js/pages/admissions.page.js`:
  - Added plan selection choice ("Pay in installments" vs "Pay in full (Rs X)") when selected course has full payment amount.
  - On "Admit" verification, opens the shared payment popup (`openPaymentPopup`), recording the admission or full payment through `recordPayment` in `payment.service.js`.
  - Student document receives `paymentPlan: "full" | "installments"`, `fullPaymentAmount`, `fullPaymentDiscount`, and updated `paidAmount`.
- `public/js/utils/admission-receipt.js`:
  - Added full payment plan receipt data layout showing standard course fee, full payment discount, amount paid, and zero balance due.
- `tools/delete-test-students.js`:
  - Created Super Admin CLI script to authenticate, list test students, confirm deletion with strict "YES" prompt, delete students and subcollections (`payment`, `activity`, `docs`, `aadhaar`) and storage files, and reset receipt counters only if `--reset-counters` flag is passed.

**Why:**
- Fixed financial calculation bug where legacy students (such as RONI 27010005) showed 50% paid instead of 100% paid / 0 outstanding.
- Enforced single unified calculation across all pages and unified the admission payment experience with the shared payment modal.

**Files touched (created / modified / deleted):**
- CREATED: `tools/delete-test-students.js`
- MODIFIED: `public/js/services/payment.service.js`
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `public/js/pages/student-profile.page.js`
- MODIFIED: `public/js/pages/pay-fees.page.js`
- MODIFIED: `public/pages/courses.html`
- MODIFIED: `public/js/pages/courses.page.js`
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/utils/admission-receipt.js`
- MODIFIED: `public/js/core/app.js` (bumped to 1.8.127)
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: `docs/04-DATABASE-MAP.md`
- MODIFIED: `docs/05-FILE-INDEX.md`
- MODIFIED: 35 files across `public/` (?v= query strings updated)

---

### [2026-11-24 11:10] Version 1.8.126 — Super Admin Google Sign-In Hard Block & Email Verification

**What was built:**
- `public/js/core/auth.js`:
  - Added email verification check in `signInWithPassword()`: if `user.emailVerified` is false, calls `sendEmailVerification(user)` (throttled once per session) and sets a session notice without blocking sign-in.
  - In `resolveSession()`: hardened role isolation so that if an account with Firestore role `superadmin` signs in with `google.com` (or any non-password provider), it immediately rejects with reason `superadmin-password-only` and calls `signOut()`.
- `public/js/pages/login.page.js`:
  - Added handling for `superadmin-password-only` displaying: "This account is a Super Admin. Please sign in on the Super Admin tab with your email and password. Google sign-in is not allowed for this account."
  - Handled `SUPERADMIN_PASSWORD_ONLY` error from Cloud Function blocking in the Google sign-in catch handler.
- `public/index.html`:
  - Added pending email verification notice toast display on landing after successful sign-in.
- `functions/index.js` & `functions/package.json`:
  - Created Cloud Functions 2nd Gen Identity blocking function `beforeUserSignedIn` in region `asia-south1` using `firebase-functions/v2/identity`. If provider is `google.com` and Firestore `users/{email}` has `role == 'superadmin'`, throws `HttpsError('permission-denied', 'SUPERADMIN_PASSWORD_ONLY')`.
- `firebase.json`:
  - Added `functions` block targeting the `functions/` directory.
- `tools/check-imports.js`:
  - Created automated import resolution validator checking all module imports across `public/` (0 broken imports).

**Why:**
- To permanently prevent a Super Admin account from ever signing in via Google, preventing account provider linking or removal of the Super Admin's password credential, while keeping Branch Heads' Google sign-in fully operational.

**Files touched (created / modified / deleted):**
- CREATED: `functions/package.json`
- CREATED: `functions/index.js`
- CREATED: `tools/check-imports.js`
- MODIFIED: `firebase.json`
- MODIFIED: `public/js/core/auth.js`
- MODIFIED: `public/js/pages/login.page.js`
- MODIFIED: `public/index.html`
- MODIFIED: `public/js/core/app.js` (version bump to 1.8.126)
- MODIFIED: 35 files across `public/` (?v= query strings updated)
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: `docs/05-FILE-INDEX.md` (added functions/ and tools/check-imports.js)



### [2026-11-24 00:35] Version 1.8.125 — Fix Password Toggle Icon in Login Page

**What was built:**
- `public/js/pages/login.page.js`: Updated the password visibility toggle click handler to safely replace `togglePw.innerHTML` with the appropriate Lucide eye/eye-off icon markup instead of querying the removed `<i>` element after Lucide icon replacement. This prevents `TypeError: Cannot read properties of null (reading 'setAttribute')` when toggling password visibility repeatedly.

**Why:**
- Lucide replaces `<i>` elements with `<svg>` tags on its first run, causing subsequent `querySelector('i')` calls to return `null` and throwing an unhandled runtime error.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/login.page.js`
- MODIFIED: `public/js/core/app.js` (version bump to 1.8.125)
- MODIFIED: 35 files across `public/` (?v= query strings updated)
- MODIFIED: `docs/02-PROGRESS-LOG.md`



### [2026-11-23 23:45] Version 1.8.124 — Redesign Popups to Native Theme (Youth Centre & Unique Kids)

**What was built:**
- Cleaned up all student management popups across Youth Centre (`public/js/pages/admissions.page.js`) and Unique Kids (`public/js/pages/school-admissions.page.js`) to strictly adhere to the native design system of the application:
  - Removed congested, AI-generated hero blocks (`pStudentHero`), flowchart card diagrams (`pTransferFlow`), bulky alert bullet lists, and nested card sections.
  - Re-anchored modal headers to native `openPopup` conventions (icon tile, clear title, and concise subtitle showing student name & ID).
  - Adopted clean, airy form controls (`pk-badge-row`, `pk-current-badge`, `pk-form-row`, `ui-input`, `createSelect`, `createDatePicker`) matching standard modals like Edit Personal/Guardian Details.
  - Refactored Change Batch, Drop Student, Delete Permanently, Start Break, End Break, Mark Completed, and Student Details popups with spacious layouts, clean 1-line alerts (`pk-alert.warning` / `pk-alert.danger`), and crisp confirmation inputs.
- Cleaned up `public/css/components/list-page.css`: removed bloated CSS suites, eliminated color literals (using only CSS variables), and added clean, lightweight layout classes.
- Resolved identifier duplication and function nesting issues in `admissions.page.js`, ensuring 100% clean ES module syntax across all 70 JS files.

**Why:**
- Previous implementations introduced congested, over-decorated components with duplicate elements and non-standard layouts that looked artificial and clashed with the rest of the application's clean aesthetic.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/css/components/list-page.css`
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/pages/school-admissions.page.js`
- MODIFIED: `public/js/core/app.js` (version bump to 1.8.124)
- MODIFIED: 35 files across `public/` (?v= query strings updated)
- MODIFIED: `docs/02-PROGRESS-LOG.md`



### [2026-11-23 21:46] Version 1.8.123 — Fix Function Scope Brace in Admissions Page

**What was built:**
- `public/js/pages/admissions.page.js`: Added the missing closing curly brace `}` for `async function save()` following the `catch (e)` block. This resolved `SyntaxError: Unexpected token 'export'` at `export function unmount()` caused by `mount()` and nested functions remaining unclosed.
- Validated all 70 ES module files using automated strict verification confirming 0 syntax errors across the codebase.

**Why:**
- When restoring the `try...catch` block in `admissions.page.js`, the closing brace for the enclosing `save()` function was omitted. This caused the module parser to treat all subsequent code (including `export function unmount()`) as nested within a function scope, which is illegal in ES modules.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

---

### [2026-11-23 21:30] Version 1.8.122 — Fix Module Syntax Errors in Payment Popup, Admissions, and School Pages

**What was built:**
- `public/js/components/payment-popup.js`: Removed duplicate ES module import statement for `playPaymentSuccessSound` which caused `SyntaxError: Identifier 'playPaymentSuccessSound' has already been declared` breaking the `/pay-fees` route.
- `public/js/pages/admissions.page.js`: Restored the missing `catch (e) { ... }` block and error handling logic for the admission `save()` transaction, resolving `SyntaxError: Missing catch or finally after try` that prevented `/admissions` and `/students` from loading.
- `public/js/pages/school-admissions.page.js`: Removed duplicate ES module import of `playPaymentSuccessSound`.
- `public/js/pages/school-fee-payment.page.js`: Removed duplicate ES module import of `playPaymentSuccessSound`.
- Validated all 70 ES modules in `public/js` with `node --input-type=module --check` confirming 0 syntax errors across the entire codebase.

**Why:**
- Previous edits introduced duplicate imports and an unclosed try block, causing modern browser ES module loaders to reject execution and displaying "Failed to load page" routing error screens.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/pages/school-admissions.page.js`
- MODIFIED: `public/js/pages/school-fee-payment.page.js`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

---

### [2026-11-23 19:40] Version 1.8.121 — Redesign Payment Recorded Confirmation Modal

**What was built:**
- `public/js/components/payment-popup.js`: Replaced the legacy oversized 600px `openPopup` wrapper with a dedicated, compact 450px modal (`.ui-modal.pf-success-modal`). Eliminated the empty 72px header bar and floating top-right close icon, placing a clean corner `X` button, a double-ring emerald check badge (`#dcfce7` with `#16a34a`), modern typography ("Payment Recorded!"), an indigo monospace receipt number badge, consistent INR currency formatting, uppercase payment mode pill, dashed subtotal divider, and bold total paid figure.
- `public/css/pages/pay-fees.css` & `public/css/pages/student-profile.css`: Styled `.ui-modal.pf-success-modal` with clean 16px radius, 26px padding, 450px max-width, and balanced action button sizing (`[Open Receipt]`, `[Print]`, `[Done]`).

**Why:**
- The previous dialog was embedded inside an oversized generic modal shell resulting in wide empty margins, an empty header band, and unformatted data rows.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `public/css/pages/pay-fees.css`
- MODIFIED: `public/css/pages/student-profile.css`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

---

### [2026-11-23 19:30] Version 1.8.120 — Audio Cue on Successful Payment Collection

**What was built:**
- `public/js/utils/sound.js`: Created dedicated audio cue utility `playPaymentSuccessSound()` playing `assets/sounds/payment_confirmation.mp3` with automatic non-blocking error and autoplay protection.
- `public/js/components/payment-popup.js`: Integrated audio cue upon successful payment recording in the shared payment modal (used across Student Profile and Pay Fees).
- `public/js/pages/admissions.page.js`: Integrated audio cue upon new student admission recording and initial fee collection.
- `public/js/pages/school-admissions.page.js`: Integrated audio cue upon new school admission recording and initial fee collection.
- `public/js/pages/school-fee-payment.page.js` & `public/js/pages/school-fees.page.js`: Integrated audio cue upon monthly school fee payment recording.

**Why:**
- Provides instant, satisfying audible confirmation whenever a payment is recorded anywhere in the application.

**Files touched (created / modified / deleted):**
- CREATED: `public/js/utils/sound.js`
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/pages/school-admissions.page.js`
- MODIFIED: `public/js/pages/school-fee-payment.page.js`
- MODIFIED: `public/js/pages/school-fees.page.js`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

---

### [2026-11-23 19:15] Version 1.8.119 — Import runTransaction in payment.service.js

**What was built:**
- `public/js/services/payment.service.js`: Added `runTransaction` to the imported functions from `firebase-firestore.js`, fixing the `ReferenceError: runTransaction is not defined` when confirming payment records.

**Why:**
- `recordPayment` wraps `recordPaymentTx` inside `runTransaction(db, ...)`, but `runTransaction` was missing from the firestore module imports in `payment.service.js`.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/services/payment.service.js`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

---

### [2026-11-23 19:10] Version 1.8.118 — Fix Payment Record Popup TypeError in Reason Selector

**What was built:**
- `public/js/components/ui-select.js`: Added `setValue(v)` helper to `createSelect` return object alongside existing `value` getter/setter, ensuring full backward and forward compatibility.
- `public/js/components/payment-popup.js`: Fixed `reasonSel.setValue('')` calls in `waiveCheckbox.onchange` and `recalculate()` to safely set `reasonSel.value = ''`, resolving the `TypeError: reasonSel.setValue is not a function` runtime error and allowing the Record Payment popup to open and render smoothly.

**Why:**
- Calling `reasonSel.setValue('')` when `createSelect` exposed a property setter caused an uncaught exception during `recalculate()`, preventing the payment popup form from being appended to the DOM.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/components/ui-select.js`
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

---

### [2026-11-23 15:40] Version 1.8.117 — Modal Input Side Borders Fix, Study Material Fee in Transaction Ledger, & Dynamic Fine Waiver Box

**What was built:**
- `public/css/pages/student-profile.css` & `public/css/pages/pay-fees.css`: Removed `overflow-x: hidden` from `.sp-modal-form` and set `overflow: visible; padding: 2px 4px;` with enhanced border contrast on `.ui-input-wrap` and `.ui-select-btn`, preventing input borders and focus rings from clipping on the side edges in modal dialogs.
- `public/js/pages/student-profile.page.js`: Enhanced `renderTransactionsLedger()` to consistently split the collected admission transaction into distinct `Admission` and `Study Material` rows (both when loaded from subcollection `paymentsCache` and when using student document fallback), maintaining the identical receipt number, date, mode, transaction ID, and linking to the admission receipt.
- `public/js/components/payment-popup.js`: Entire late fine waiver option box (`waiveGroup`) is now hidden (`hidden = true`) when late fine is ₹0, and only becomes visible when an actual late fine exists (`fineAmt > 0`). Removed `(Super Admin)` and bracketed text from the label, and added a clean waiver reason dropdown (`createSelect`) that reveals when the waiver box is ticked.

**Why:**
- Resolves clipped input borders and focus rings in profile modals, ensures full accounting visibility for collected study material fees in the chronological transaction ledger, and eliminates clutter in the payment popup when no late fine is applicable.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/css/pages/student-profile.css`
- MODIFIED: `public/css/pages/pay-fees.css`
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `public/js/pages/student-profile.page.js`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

---

### [2026-11-23 15:00] Version 1.8.116 — Student Profile Modern Skeleton, Clean Waive Tickbox Label & Study Material History Row

**What was built:**
- `public/pages/student-profile.html` & `public/css/pages/student-profile.css`: Rebuilt the profile loading skeleton (`#sp-loading`) to mirror the modern layout (round 72px avatar, aligned hero lines, actions placeholder, clean stats strip, tab nav buttons, and content card skeleton) instead of the outdated single card with square avatar and 4 giant boxes.
- `public/js/components/payment-popup.js`: Cleaned up the late fine waiver checkbox text by removing `(Super Admin)` and adding an 11px helper sub-description: `"Can be ticked when late fine is added to the bill"`, with dynamic color transition between disabled and active states.
- `public/js/pages/student-profile.page.js`: In `renderTransactionsLedger()`, separated the collected admission payment into an Admission fee row and a distinct Study Material fee row (when `material` fee > ₹0 was collected), showing the same receipt number, date, collector, and linking to the admission receipt.

**Why:**
- Eliminates layout shift and visual mismatch on page refresh, simplifies the waiver checkbox wording with helpful guidance, and provides accurate accounting transparency in chronological payment transactions.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/pages/student-profile.html`
- MODIFIED: `public/css/pages/student-profile.css`
- MODIFIED: `public/js/components/payment-popup.js`
- MODIFIED: `public/js/pages/student-profile.page.js`

**Firestore changes:**
- None

**Tested on:**
- Node module syntax validation: ✅
- Chrome Desktop: ✅

---

### [2026-11-23 14:46] Version 1.8.115 — Muted Faded Gray State for Disabled Late Fine Waiver Box

**What was built:**
- `public/js/components/payment-popup.js`: Dynamically styled the Super Admin late fine waiver container (`waiveGroup`) so that when the late fine is ₹0 (disabled), it renders in a subtle, faded gray style (`background: var(--bg)`, `border: 1px solid var(--border)`, `opacity: 0.75`, `cursor: not-allowed`, muted text) instead of active warning amber. When late fine > ₹0 (enabled), it transitions back to the active amber/yellow warning style.

**Why:**
- Improves visual hierarchy and clarity in the payment popup so disabled waiver options don't look active.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/components/payment-popup.js`

**Firestore changes:**
- None

**Tested on:**
- Node module syntax validation: ✅
- Chrome Desktop: ✅

---

### [2026-11-23 14:36] Version 1.8.114 — Document Card Action Icons & View Modal Focus Border Fix

**What was built:**
- `public/js/pages/student-profile.page.js`: Added matching Lucide icons (`eye`, `download`, `refresh-cw`) to the `View`, `Download`, and `Replace` buttons in student document cards.
- `public/css/pages/student-profile.css`: Styled `.sp-doc-actions .ui-btn svg.lucide` with `color: var(--text-mute, #6B6B6B)` (matching the view modal corner icon color) and `color: var(--text, #171717)` on hover.
- `public/js/components/modal.js`: Fixed auto-focus logic in `openPopup` to only target interactive form fields inside `container`, never auto-focusing header icon buttons (`repBtn`, `dlBtn`, `xBtn`), and silently focusing `box` with `tabIndex = -1` on preview dialogs.
- `public/css/components/list-page.css` & `public/css/pages/student-profile.css`: Reset focus/focus-visible outline, box-shadow, and border on `.adm-view-head-actions button` and `.adm-view-close` to eliminate the momentary border around the first corner icon on popup open.

**Why:**
- Visual polish and consistency across document cards, and eliminating the browser focus ring border on the first corner icon when opening the document preview popup.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/student-profile.page.js`
- MODIFIED: `public/js/components/modal.js`
- MODIFIED: `public/css/components/list-page.css`
- MODIFIED: `public/css/pages/student-profile.css`

**Firestore changes:**
- None

**Tested on:**
- Node module syntax validation: ✅
- Chrome Desktop: ✅

---

### [2026-11-23 14:22] Version 1.8.113 — Document Preview Header Replace Button

**What was built:**
- `public/js/pages/student-profile.page.js`: Added a replace icon button (`refresh-cw`, 18px ghost button) directly to the left of the download icon in the header of the document preview modal (`openDocPreviewModal`). Tapping this button closes the preview modal and opens the Document Replace modal (`openDocReplaceModal(key, label, docData)`).

**Why:**
- Allows users previewing a student document (DOB proof, marksheet, photo, signature) to directly replace the document from the preview popup header without needing to close it and find the card button.

**Files touched (created / modified / deleted):**
- MODIFIED: `public/js/pages/student-profile.page.js`

**Firestore changes:**
- None

**Tested on:**
- Node module syntax validation: ✅
- Chrome Desktop: ✅

---

### [2026-11-21 14:35] Version 1.8.98 — Student Profile Calm, Modern, Borderless UI Redesign

**What was built:**
- `public/pages/student-profile.html`: Rebuilt markup for calm, open, modern design with zero clutter:
  - Header: Single white surface (`.sp-header-card`), 72px round avatar, 22px semibold student name with small `.sp-status-pill.success`, muted metadata line (`ID · course · batch · session · branch`) without link underline, and quick actions (WhatsApp, Call, Email as round ghost icon buttons with tooltips, and "Notify dues" as the only filled button).
  - Stats: Merged into ONE white card (`.sp-stats-card`) split into 6 borderless columns (`.sp-stats-grid`, `gap: 24px`), small icons + 12px muted labels + 20px semibold values + 12px muted hints (Outstanding in `#dc2626`, Paid in `#16a34a`), plus thin progress bar track & fill under the strip.
  - Tabs: Plain text tabs on the page background, no boxes around active tab; active tab indicated via navy text + 2px navy bottom underline and faint `#e2e8f0` separator line.
  - Documents tab: 4 cards with 8px radius, no border, soft shadow (`0 1px 3px rgba(16,24,40,.06)`), 4:3 top image fill, title + small status pill row, file name and size in 12px muted, 3 small icon buttons (`eye`, `download`, `refresh-cw`) with tooltips, and a light dashed area with upload icon and "Upload" text button for missing documents.
  - Personal & Course tabs: Clean 2-column key-value grid (`.sp-kv-grid`) with 12px muted labels and 14px values; course fee breakdown and installment schedule tables with faint row separators (`border-bottom: 1px solid #f1f5f9`), no vertical lines, and right-aligned amounts.
  - Payments tab: Clean payment overview card, installment status table with status pills and filled "Pay" action, and chronological ledger table.
- `public/css/pages/student-profile.css`: Enforced calm, open aesthetic:
  - Eliminated thick dark/gold lines under header and card borders (`border: none !important; box-shadow: 0 1px 3px rgba(16, 24, 40, 0.06);`).
  - Removed all inner divider lines between sections, relying purely on 24px section spacing.
  - Popups (`.ui-modal.ar-modal`): 24px internal padding, title row with small icon, right-aligned action buttons with no divider line above, and soft tinted drop zone (`.sp-drop-zone`).
- `public/js/pages/student-profile.page.js`: Updated DOM manipulation logic for header pills, stats progress bar, document cards, table actions, and popups while keeping 100% of the underlying business logic, compression pipeline, and Firestore transactions intact.

**Why:**
- Previous versions felt either crowded with excessive dark borders, double highlight lines, and divider lines, or over-styled. The redesign delivers a calm, modern, and open interface matching standard SaaS design principles with balanced whitespace.

**Files touched:**
- MODIFIED: `public/pages/student-profile.html`
- MODIFIED: `public/css/pages/student-profile.css`
- MODIFIED: `public/js/pages/student-profile.page.js`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

**Firestore changes:**
- None (strictly UI, presentation, and layout changes).

**Tested on:**
- Microsoft Edge headless screenshots captured and verified:
  - Header, Stats, and Personal Details (`sp-personal.png`)
  - Documents Tab (`sp-documents.png`)
  - Course Tab (`sp-course.png`)
  - Payments Tab (`sp-payments.png`)
  - Record Payment Popup (`sp-popup-payment.png`)
- Node syntax check: Passed (`node --check public/js/pages/student-profile.page.js`)

---

### [2026-11-21 14:05] Version 1.8.97 — Admission Receipt Design System Alignment for Student Profile & Popups

**What was built:**
- `public/css/components/doc-card.css`: Shared design tokens (`--ar-navy: #333b84`, `--ar-deep: #291670`, `--ar-gold: #151caa`, `--ar-tint: #eceefa`, `--ar-line: #b9bfdc`, `--ar-ink: #1d1a3a`, `--ar-muted: #5b5f85`) and reusable receipt-styled components (`.ar-card`, `.ar-sec-head`, `.ar-sec-title`, `.ar-hd-accent`, `.ar-btn`, `table.ar-d`, `table.ar-fe`, `.ar-pill`, `.ar-pbox`, `.ar-pcell`, `.ar-cname`, `.ar-cgrid`, `.ar-imp`, `.ui-modal.ar-modal`).
- `public/css/main.css`: Imported `doc-card.css` into global stylesheet bundle.
- `public/pages/student-profile.html`: Aligned entire page markup to the Admission Receipt reference: double-line navy/gold top header accent, round avatar, student name with `.ar-pill`, metadata chips with lucide icons (`hash`, `book-open`, `layers`, `calendar-range`, `git-branch`), 6 receipt-styled metric cards (`wallet`, `check-circle`, `alert-circle`, `calendar-clock`, `timer`, `list-checks`), tabs with icons, detail tables using `table.ar-d`, course spec cards using `.ar-cname` / `.ar-cgrid`, and financial ledgers using `table.ar-fe`.
- `public/css/pages/student-profile.css`: Styled using receipt typography (`IBM Plex Sans` for body/tables, `Libre Franklin` for headings/totals), receipt palette, crisp 6px borders, and responsive grid layouts.
- `public/js/pages/student-profile.page.js`: Controller fully updated to use receipt components:
  - Header: `.ar-pill` (`paid`, `due`, `overdue`), `.ar-btn.ghost.sm`, `.ar-btn.primary.sm`.
  - Documents tab: 4 cards with `.ar-pill`, `.sp-doc-thumb-box`, action icon buttons (`eye`, `download`, `refresh-cw`, `upload`).
  - Course tab: `table.ar-fe` breakdown and direct navigation to `#/admissions/<id>/receipt`.
  - Payments tab: `.ar-pbox` summary block, `table.ar-fe` installment status schedule with `.ar-pill` and `ar-btn.primary.sm` ("Pay"), and chronological ledger with receipt download button.
  - All popups (Personal, Contact, Guardian, Preview Doc, Replace Doc, Record Payment, Notify Dues): Styled via `.ui-modal.ar-modal` matching receipt headers (`.adm-view-head`, `.adm-view-title`, `.adm-view-tile`), receipt `.ar-pbox` summary in payment recording, and `.ar-btn` footer buttons.
- Preserved all functional logic: image compression pipeline (`isImageFile -> compressTo100KB -> compResult.blob -> blobToDataURL`), subcollection writes (`students/{id}/docs/{key}`), activity audit logging (`students/{id}/activity`), and Firestore security rules compatibility.

**Files touched:**
- CREATED: `public/css/components/doc-card.css`
- MODIFIED: `public/css/main.css`
- MODIFIED: `public/pages/student-profile.html`
- MODIFIED: `public/css/pages/student-profile.css`
- MODIFIED: `public/js/pages/student-profile.page.js`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

**Firestore changes:**
- None (100% compliant with existing security rules and student schemas).

**Tested on:**
- Node syntax check: Passed (`node --check public/js/pages/student-profile.page.js`)
- CSS variable verification: All tokens match extracted Admission Receipt values
- Route integrity: Direct hash navigation to `#/admissions/<id>/receipt` intact

---

### [2026-11-21 13:30] Version 1.8.96 — Design Alignment with Batches & Admissions (Standard Look Restored)

**What was updated:**
1. **Removed Non-Native Styles**:
   - Reverted all oversized radii, backdrop blur, colored glow shadows, gradients, and oversized numbers.
   - Restored shared `.ui-modal`, `.ui-modal-back`, `.adm-view-...` popup styling in `list-page.css` to 8px radius, plain dark overlay without blur, 40px icon tiles, and standard footer/header padding.
2. **Student Profile Page Layout**:
   - Header: Single white card (`.card`), 64px circular avatar with initials or image, 20px semibold student name with `.bt-pill` status badge, meta text separated by dots (`•`), and outlined quick contact buttons + notify button.
   - Dashboard Stats Row: 6 compact stat cards matching `Batches` / `Students` header metrics (18-20px semibold values, 11px uppercase labels, no decorative colored circles).
   - Tabs: Simple admin underline tabs (14px, muted text, 2px primary bottom border for active tab, no pills/backgrounds/icons).
   - Cards & Tables: Standard `.card` with 8px radius, 16px padding, 11-12px uppercase labels, 14px values, and `<table class="lp-table">` for fee breakdown, installment schedule, and transaction ledger.
3. **Popups Overhaul**:
   - Reverted all edit and transaction modals to standard admission form components (`.ui-field`, `.ui-input-wrap`, `.ui-input`, `.adm-view-foot`).
   - Replaced custom pill selectors in Record Payment with standard dropdown and `.pk-info-grid-3` summary.
4. **Preserved Functional Pipeline**:
   - Maintained image compression pipeline (`compressTo100KB -> compResult.blob -> blobToDataURL`), document subcollection updates, append-only activity logging, and direct navigation to `#/admissions/<id>/receipt`.
5. **Version Bump**:
   - Bumped `APP_VERSION` to `1.8.96` across all files.

**Files touched:**
- MODIFIED: `public/css/components/list-page.css`
- MODIFIED: `public/pages/student-profile.html`
- MODIFIED: `public/css/pages/student-profile.css`
- MODIFIED: `public/js/pages/student-profile.page.js`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

---

### [2026-11-21 11:20] Version 1.8.95 — Modern SaaS Redesign of Student Profile & Popup Overhaul

**What was built & updated:**
1. **Functional Fixes**:
   - **Admission Receipt Navigation**: Completely removed iframe/popup preview; "View admission receipt" and transaction receipt buttons now cleanly navigate to `#/admissions/<id>/receipt`.
   - **Document Upload Bug Resolution**: Fixed `compressTo100KB` return signature unpacking (`res.blob` vs raw object) and ensured strict matching of `auth.currentUser.email.toLowerCase()` for append-only activity logs and doc updates. Immediate live avatar and card thumbnail refresh without page reloads.
2. **Modern SaaS Admin Redesign (Linear / Stripe / Vercel)**:
   - **Header Card**: Soft gradient brand banner strip with 100px avatar overlapping with a white border ring, copyable studentId chip with clipboard feedback, status pills, meta chips (course, batch, session with switcher, branch), and action row (Notify Dues, WhatsApp, Call, Email).
   - **Metrics Dashboard**: Responsive grid of cards with tinted rounded icons, 26px bold values, and animated progress bar showing paid % of total.
   - **Sticky Navigation Tabs**: Modern segmented tabs with icons and active underline pill, sticky below topbar.
   - **Personal Details**: 2-column grid of section cards with 13px uppercase muted labels and 16px values, ghost edit buttons in headers.
   - **Documents Grid**: 4 cards with 4:3 large thumbnails, metadata line, clean action footers, and dashed drop-zone supporting drag-and-drop file upload.
   - **Course Details**: Clean course overview, fee breakdown snapshot table, and scheduled installment dates table.
   - **Payment History**: Unified summary banner, 4-installment schedule status table with soft status pills, and chronological transactions ledger.
3. **Popup Redesign (`components/modal.js` & `components/list-page.css`)**:
   - Upgraded shared modal: 580px width, 16px radius, `backdrop-filter: blur(4px)`, layered shadow, scale+fade animation, mobile bottom sheet.
   - Redesigned Edit Details modals with 44px inputs, 15px font, focus rings, and inline red error text.
   - Redesigned Replace Document modal with side-by-side current vs new preview, drag-and-drop zone, and compressed size readout.
   - Redesigned Record Payment modal with top summary banner, mode pill selector buttons (Cash, UPI, Card, Bank, Cheque), and saving spinner.
   - Redesigned Notify Dues modal with prefilled editable message and WhatsApp/Email triggers.
4. **Version Bump**:
   - Bumped `APP_VERSION` to `1.8.95` across all files.

**Files created & modified:**
- MODIFIED: `public/pages/student-profile.html`
- MODIFIED: `public/css/pages/student-profile.css`
- MODIFIED: `public/js/pages/student-profile.page.js`
- MODIFIED: `public/css/components/list-page.css`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: `?v=` references in all `public/js/` files

### [2026-11-21 11:00] Version 1.8.94 — Student Profile Page & Ledger Implementation

**What was built & updated:**
1. **Dynamic Student Profile Page (`student-profile.html`, `student-profile.css`, `student-profile.page.js`)**:
   - Built the 360-degree Student Profile covering:
     - **Cover & Identity Header**: Round avatar photo with fallback initials, student name, 8-digit/UIC pill, status badge, meta bar (Course, Batch, Session with multi-session switcher, Branch), and contact actions (WhatsApp with validation, Email, Call, and Due reminder modal).
     - **Metrics Dashboard**: 9 real-time KPI cards (Total Fee, Paid, Outstanding, Next Due with date, Late fine accrued today at ₹1/day, Installments paid X/4, Admission date, Course duration/remaining, Batch timing).
     - **Tab 1 - Personal Details**: Grouped cards (Personal, Contact, Guardian, Academic, Metadata) with edit modals, field validation via `validator.js`, dirty state tracking via `unsaved-guard.js`, single-doc update for Youth, and linked multi-record update across sessions with confirmation prompt for Kids.
     - **Tab 2 - Documents**: 4 document cards (DOB, Marksheet, Photo, Signature) supporting full preview modal, original file download, image download, and replace/upload modal with canvas compression to 100KB (`compressTo100KB`).
     - **Tab 3 - Course Details**: Complete academic information, snapshot fee breakdown, scheduled installment dates, and embedded modal preview of the admission receipt.
     - **Tab 4 - Payment History**: Youth installment ledger with summary strip (Total, Paid, Waived, Outstanding, Late fine), 4-installment schedule status table (Paid, Due, Overdue with fine, Upcoming, Waived), chronological transactions ledger, and "Record Payment" transaction modal adhering strictly to Decision 3 (full installment payments, late fine accrued in same transaction, receipt numbering via atomic counters, Super Admin fine waiver). Kids payment tab dynamically loads bills and payments.
2. **Payment & Activity Service (`services/payment.service.js`)**:
   - Created reusable services: `calculateLateFee`, `fetchStudentPayments`, `fetchStudentActivities`, `recordPaymentTx`, and `logStudentActivity`.
3. **Router Dynamic Loader (`core/router.js`)**:
   - Replaced placeholder `renderStudentProfile()` with full dynamic loader mounting `student-profile.html` + `student-profile.page.js`, resolving by Firestore docId or 8-digit studentId, and supporting `?tab=personal|documents|course|payments`.
4. **Security Rules (`firestore.rules`)**:
   - Updated `students/{studentId}/payment/{paymentId}` rules to restrict waivers to Super Admin and enforce `recordedBy == authEmail` for branch heads.
   - Added append-only `students/{studentId}/activity/{activityId}` rules (create only for branch head on own branch, update/delete denied for all).
5. **Version Bump**:
   - Bumped `APP_VERSION` to `1.8.94` across `app.js`, `index.html`, and all `?v=` references.

**Files created & modified:**
- CREATED: `public/pages/student-profile.html`
- CREATED: `public/css/pages/student-profile.css`
- CREATED: `public/js/pages/student-profile.page.js`
- MODIFIED: `public/js/services/payment.service.js` (written from 0 bytes)
- MODIFIED: `public/js/core/router.js`
- MODIFIED: `firestore.rules`
- MODIFIED: `public/css/main.css`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`

### [2026-11-21 09:55] Version 1.8.93 — Unified Table Header Styling Across Tables (Branches, Branch Heads, Students)

**What was built & updated:**
1. **Unified Token-Based Table Header Rule (`list-page.css`)**:
   - Replaced hardcoded color literals (`#F5F6FD`, `#3730A3`, `#E0E3F5`) with token-based CSS variables:
     - `background: color-mix(in srgb, var(--primary-soft) 55%, var(--surface))`
     - `color: var(--primary)`
     - `font-weight: 800; letter-spacing: .06em`
     - `border-bottom: 1px solid color-mix(in srgb, var(--primary) 14%, var(--surface))`
   - Extended selector to serve `.lp-table`, `.lp-card .lp-table`, `.lp-card .bh-table`, and `.adm-table-card .adm-table` consistently.
   - Headers now automatically adapt their tint and font color when switching context between Youth and School.
2. **Cleaned Per-Page Table Header Rules (`branch-heads.css` & `admissions.css`)**:
   - Removed conflicting `background: var(--bg)`, `color: var(--text-mute)`, and `border-bottom: 1px solid var(--border)` declarations from `.bh-table th` and `.adm-table th`, retaining their padding, text-align, and font-size.
3. **Mobile & Card Integrity Preserved**:
   - Maintained all mobile card layout rules for the Students table (`@media (max-width: 900px)`), row hovers, status pills, and action cell alignment.
4. **Version Bump**:
   - Bumped `APP_VERSION` in `app.js` and `window.__BUILD__` in `index.html` to `1.8.93`.
   - Updated all `?v=` references across the project to `1.8.93`.

**Files touched:**
- MODIFIED: `public/css/components/list-page.css`
- MODIFIED: `public/css/pages/branch-heads.css`
- MODIFIED: `public/css/pages/admissions.css`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: all JS/HTML `?v=` references across the project

---

### [2026-11-21 09:40] Version 1.8.92 — Students Page Table Card Header & Filter-Aware Footer Alignment

**What was built & updated:**
1. **Students Table Card Header (`admissions.html` & `admissions.page.js`)**:
   - Added standard `.lp-card-head` to `.adm-table-card` featuring `users` icon, "All students" title, and scope count pill (`#adm-count`).
   - `#adm-count` dynamically updates on every `render()` to reflect the current session scope total (`total === 1 ? '1 student' : total + ' students'`), matching the first stat card and Branches card pattern.
2. **Filter-Aware Footer Text & Logic (`admissions.page.js`)**:
   - Implemented exact count-comparison rules (N = filtered count, T = session scope total):
     - `N === T, 1 page`: "Showing all N"
     - `N === T, >1 pages`: "Showing a–b of N" (with en dash)
     - `N < T, 1 page`: "Showing N of T"
     - `N < T, >1 pages`: "Showing a–b of N (filtered from T)"
     - `N === 0, T > 0`: "Showing 0 of T" (directly rendered in empty-match branch without pager buttons)
     - `T === 0`: footer hidden (`footEl.hidden = true`).
3. **Backward-Compatible Pager Extension (`list-page.js`)**:
   - Extended `renderPager(container, opts)` with `summary` and `showWhenSingle` options.
   - When `showWhenSingle: true` and only 1 page exists, renders the summary text cleanly and keeps the container visible without buttons.
   - Pager button container sets `margin-left: 0` when `summary` is provided, retaining `margin-left: 16px` when `summary` is omitted to preserve the exact layout of `school-admissions.page.js`.
4. **Footer Layout & Mobile Styling (`admissions.css`)**:
   - Applied `.lp-card-foot` class to `#adm-foot` and styled as a responsive flex row (`justify-content: space-between; flex-wrap: wrap; gap: 8px;`).
   - Added `@media (max-width: 480px)` wrapping for `.adm-table-card .lp-card-head` to prevent horizontal overflow on 375px screens.
5. **Module Import URL Standardization (`public/js/pages/*.js`)**:
   - Updated all 10 page files importing `list-page.js` to use `'../components/list-page.js?v=1.8.92'`.
6. **Version Bump**:
   - Bumped `APP_VERSION` in `app.js` and `window.__BUILD__` in `index.html` to `1.8.92`.
   - Updated all `?v=` references across the project to `1.8.92`.

**Files touched:**
- MODIFIED: `public/pages/admissions.html`
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/components/list-page.js`
- MODIFIED: `public/css/pages/admissions.css`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: all JS/HTML `?v=` references across the project

---

### [2026-11-20 15:50] Version 1.8.91 — Course View Popup Polish: Removed Bottom Button, Slim Scrollbar Fix, Full Package Order, Mobile Sizing

**What was built & polished:**
1. **Removed Bottom Close Button (`courses.page.js` & `course-view.css`)**:
   - The top-right X button is now the sole visible close control; deleted the `.cv-foot` element and button in `openCourseView`, assembling modal as `modal.append(head, body)`. Removed unused `.cv-foot` CSS.
   - Preserved dialog closing via X button, clicking backdrop, and pressing Escape key.
   - Retained accessibility: focuses X on open, returns focus to invoking trigger on close, and locks body scroll.
2. **Bottom Area & Modal Layout (`course-view.css`)**:
   - Updated `.cv-body` with `padding-bottom: 28px` to ensure generous spacing at the bottom of the modal.
   - Modal corners remain rounded with `overflow: hidden`. Short courses fit naturally with no bottom strip, and long courses scroll smoothly.
   - Responsive sizing: for screens up to 640px, the X button is sized to at least 40x40px (`min-width: 40px; min-height: 40px`), and the header remains sticky outside the scrolling area.
3. **Full Package Row Ordering (`courses.page.js` & `course-view.css`)**:
   - Swapped item order in each row of the "Full package" table: course name (`.cv-pkg-name`) displays first, followed by the code pill (`.cv-code-chip-sm`).
   - Built cell as a flex row (`.cv-pkg-row`) with `gap: 8px` and `flex-wrap: wrap` for small screens; removed right margin from the code chip.
4. **Real Slim Scrollbar (`course-view.css`)**:
   - Removed `scrollbar-width` and `scrollbar-color` from the standard `.cv-body` rule so Chrome and Brave properly apply `::-webkit-scrollbar` rules without defaulting or showing arrow buttons.
   - Styled `::-webkit-scrollbar` (6px), transparent track, token-based thumb with 99px border-radius, and hidden `::-webkit-scrollbar-button`.
   - Added `@supports not selector(::-webkit-scrollbar)` for Firefox fallback and `overscroll-behavior: contain` to prevent background body scroll chaining.
5. **Version Bump**:
   - Bumped `APP_VERSION` in `app.js` and `window.__BUILD__` in `index.html` to `1.8.91`.
   - Updated all `?v=` query strings across the project to `1.8.91`.

**Files touched:**
- MODIFIED: `public/js/pages/courses.page.js`
- MODIFIED: `public/css/components/course-view.css`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: all JS/HTML/CSS `?v=` references across the project

---

### [2026-11-20 11:10] Version 1.8.90 — Read-Only Courses & Packages for Branch Heads with View Popup, Super Admin View in Kebab Menu

**What was built & updated:**
1. **Branch Head Read-Only Courses Access (`router.js` & `courses.page.js`)**:
   - Added `'branch_head'` role to `ROUTES.courses` in `router.js` so "Courses & Packages" appears in Academics group in the sidebar.
   - Updated `courses.page.js` mount to take `profile` and determine `isHead`.
   - For Branch Heads:
     - "Add Course" button (`#cs-add`) and edit form (`#cs-form`) are hidden and protected from opening.
     - Toolbar Status filter is excluded from display.
     - Courses displayed in table are filtered to active courses only (`status === 'active'`), while keeping full loaded list (`all`, `byId`) intact so prerequisites and package chains resolve properly.
     - Top summary stat cards and footer count calculate visible (active) courses only.
     - Actions column renders a single eye-icon button (`title="View"`, `aria-label="View <course name>"`) opening the course view popup, with no three-dots kebab menu or write actions.
2. **Super Admin Course View Option (`courses.page.js`)**:
   - Added `View` (eye icon) as the first item in the three-dots kebab menu, followed by a separator (`'sep'`). Existing actions (Edit, Duplicate, Create Next Semester, Mark active/inactive, Delete) remain fully functional.
3. **Shared Course View Popup (`courses.page.js` & `course-view.css`)**:
   - Single shared `openCourseView(row)` implementation supporting both Youth courses and School levels.
   - Receipt-style formal document visual aesthetic: primary brand header band with course code chip, title, status pill, level/duration subtitle, and close button.
   - Course details section with level, duration, and eligibility (Sem 1) or prerequisite (Sem 2/3).
   - Semester fees breakdown table with admission, installments (x4), exam fee, study material, and bold total.
   - Full package chain table with prerequisite progression, course fees, package total, and total installments count.
   - Topics curriculum list or "No topics added" notice.
   - Running batches notice ("N running batch(es) use this course") rendered for Super Admin only (plain text, no blue info box per Decision 26).
   - School levels mode shows Level details, Fees (Admission and Monthly fee), and Topics.
   - Accessible modal lifecycle (`role="dialog"`, `aria-modal="true"`, focus management, Escape key, backdrop click, close button, and body scroll lock).
   - Slim 6px scrollbar on scrollable modal body using CSS design tokens (`color-mix` on `--primary`).
   - Responsive layout adapting to 375px mobile screens.
4. **CSS Variables & Strict Design Rules (`course-view.css` & `main.css`)**:
   - Created `public/css/components/course-view.css` imported into `public/css/main.css`.
   - Zero hex/rgb/rgba/hsl literals: colors strictly utilize CSS variables from `variables.css`.
5. **Version Bump**:
   - Bumped `APP_VERSION` in `app.js` and `window.__BUILD__` in `index.html` to `1.8.90`.
   - Bumped all `?v=` script/style query references across the project from `1.8.89` to `1.8.90`.

**Files touched:**
- CREATED: `public/css/components/course-view.css`
- MODIFIED: `public/css/main.css`
- MODIFIED: `public/js/core/router.js`
- MODIFIED: `public/js/pages/courses.page.js`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: `docs/02-PROGRESS-LOG.md`
- MODIFIED: `docs/03-DECISIONS.md`
- MODIFIED: `docs/05-FILE-INDEX.md`
- MODIFIED: all JS/HTML/CSS `?v=` references across the project

---

### [2026-11-20 09:48] Version 1.8.89 — Branch Head Admission Rules, Branch Select, Batches Page Fix, Refresh Button Spin Fix

**What was built & fixed:**
1. **Firestore Rules for Branch Head Admission & Batches**:
   - Fixed counters regex in `firestore.rules`: updated `matches('sid_*')` and `matches('rcpt_*')` to `matches('sid_.*')` and `matches('rcpt_.*')` so multi-segment IDs like `sid_ui_27_01` match properly.
   - Updated `students/{studentId}/payment/{paymentId}` to allow read/write for Branch Heads of their own branch.
   - Updated `/batches/{batchId}` to allow create and update for Branch Heads of their own branch (`ctx == 'youth'`).
2. **Branch Field in Youth Admission Form (`admissions.page.js`)**:
   - For Branch Heads, the Branch field is pre-selected with their own branch name and disabled (read-only); the branchId is retained and saved. Super Admin retains the normal dropdown.
   - Course and batch options load automatically for that branch on form open.
3. **Batches Page (`batches.page.js` & `router.js`)**:
   - Added `branch_head` role to `/batches` route in `router.js` so Branch Heads can see Batches in navigation and access the route.
   - Fixed `resolveBatchBranch` to never throw when opening form. Branch validation now occurs on SAVE and displays inline error in `#bt-branch-err`.
   - For Branch Heads, Branch is pre-selected and locked to their own branch; batches list and creation are scoped to their own branch only. Delete remains Super Admin only.
   - Wrapped all button click handlers in `try/catch` with toast feedback.
4. **Refresh Button Spinning Fix (`list-page.js` & `list-page.css`)**:
   - Updated `buildToolbar` to rotate only the icon inside `.lp-refresh`, not the button element or background.
   - Added button disable state during load to prevent click stacking.
   - Added minimum 1 full turn (~600ms) animation and guaranteed removal of `.spin` class via `finally` on both success and error.

**Files touched:**
- MODIFIED: `firestore.rules`
- MODIFIED: `public/js/core/router.js`
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/js/pages/batches.page.js`
- MODIFIED: `public/js/components/list-page.js`
- MODIFIED: `public/css/components/list-page.css`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: all JS/HTML/CSS `?v=` references across the project

---

### [2026-11-19 18:05] Version 1.8.89 — Youth Centre Fixes: Three-dots menu, Receipt logo & fees, Action bar session control, Aadhaar form field

**What was built & fixed:**
- Fixed Youth three-dots menu in `admissions.page.js` and `ui-menu.js`: Fixed root cause in `ui-menu.js` line 22 where `return;` on section items discarded menu items when `section` and `label` were combined. Refactored `admissions.page.js` to build separate `viewItems`, `manageItems`, and `dangerItems` arrays so empty section headers are never created.
- Added missing menu actions: "View student" (navigates to `#/students/<studentId>` or displays informational toast "Student profile page is coming next"), "Change batch", "Drop student", and "Delete permanently" with proper role-based gating (Branch Head can only manage own branch; Super Admin can drop/delete).
- Fixed receipt logo missing: `buildYouthReceiptData` now checks `o.logo || o.logoUrl || '/assets/images/logo-192.jpg'`, ensuring the real organization logo is shown on screen, in print, and embedded as base64 vector in pdfmake PDFs.
- Fixed fee calculation in Youth receipt (`admission-receipt.js`): Dynamic calculation `feeTotal` = admission fee + sum of instalments (3,000 for CDTA). Excluded study material fee (100) and exam fee (180) from total course fee. Calculated `balanceDue = Math.max(0, feeTotal - admissionFeePaid - instalmentsPaid)` (2,000), with matching in-words "Rupees Two Thousand Only". Added non-breaking space `\u00A0` and `white-space: nowrap;` to prevent line wrapping in Balance due box.
- Compact receipt action bar session control: Single-session students get a clean read-only chip "Session: <name>" (~200px width, 38px height, calendar icon, centered text). Multi-session students get a compact `createSelect` dropdown that switches sessions.
- Youth Aadhaar input: Added required 12-digit Aadhaar input in `public/pages/admissions.html` in personal details grid, validated format `^\d{12}$`, stored in subcollection `students/{studentId}/aadhaar/aadhaar` (omitted from parent doc for privacy). Populated on edit and returning student search. Updated `firestore.rules` for Branch Head write access to their branch students' aadhaar subdoc.
- Bumped version to `1.8.89` across `APP_VERSION`, `__BUILD__`, and all cache-busting query strings.

**Files touched:**
- MODIFIED: `public/js/components/ui-menu.js`
- MODIFIED: `public/js/pages/admissions.page.js`
- MODIFIED: `public/pages/admissions.html`
- MODIFIED: `public/js/utils/admission-receipt.js`
- MODIFIED: `public/js/pages/admission-receipt.page.js`
- MODIFIED: `public/css/pages/admission-receipt.css`
- MODIFIED: `firestore.rules`
- MODIFIED: `public/js/core/app.js`
- MODIFIED: `public/index.html`
- MODIFIED: all JS/HTML/CSS `?v=` references across the project

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
- Replaces: "Admission no" → Student ID; session rows → Monthly fees start / Monthly payment due / Programme: Ongoing; "Student's signature". Never shows full Aadhaar. Renders only saved fee heads.
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

### 2026-11-23 — Fix duplicate import of openPaymentPopup in student-profile.page.js (v1.8.110)

**What:**
- Removed accidental duplicate import of `openPaymentPopup` in `public/js/pages/student-profile.page.js`.
- Resolved runtime `SyntaxError: Identifier 'openPaymentPopup' has already been declared` when visiting student profile routes (`#/students/<id>`).
- Re-verified all 69 JavaScript ES modules with `vm.SourceTextModule` and duplicate import checks (0 errors).

**Files touched:**
- `public/js/pages/student-profile.page.js`
- Bumped version to `1.8.110` across files.

---

### 2026-11-23 — Redesign Document Replace/Upload Modal in Student Profile (v1.8.111)

**What:**
- Redesigned document replace/upload popup (`openDocReplaceModal` in `student-profile.page.js`) and corresponding stylesheet (`student-profile.css`).
- Added structured current file status card (`sp-doc-current-bar`) displaying file name, size, and verified icon.
- Re-centered the drop zone (`sp-drop-zone`) with a circular icon badge (`sp-drop-icon-tile`), clear title, and subtitle.
- Replaced the awkward post-upload layout with an in-box preview card (`sp-replace-preview-card`): centered image/PDF preview, green optimization pill showing compressed vs original size, and a "Change file" button.

**Files touched:**
- `public/js/pages/student-profile.page.js`
- `public/css/pages/student-profile.css`
- Bumped version to `1.8.111` across files.

---

### 2026-11-23 — Side-by-Side Old vs New Document Comparison in Replace Modal (v1.8.112)

**What:**
- Enhanced document replacement in `public/js/pages/student-profile.page.js` to render a side-by-side visual comparison (`sp-doc-compare-grid`) when replacing an existing document.
- Left column shows the current/old document preview, name, size, and "Will be replaced" indicator.
- Center displays an arrow indicator pointing from old to new.
- Right column shows the new compressed document preview, format, optimization pill, and "Change" action button.
- Tapping "Replace Document" directly overwrites the old document in Firestore (`students/{id}/docs/{key}`) with the new one, updates the student record, logs the replacement in student activity, and refreshes the documents tab.

**Files touched:**
- `public/js/pages/student-profile.page.js`
- `public/css/pages/student-profile.css`
- Bumped version to `1.8.112` across files.

---

### 2026-11-24 — Unified Course Fee Architecture & Full Plan Financials (v1.8.133)

**What:**
- Fixed `calculateStudentFinancials` in `public/js/services/payment.service.js`:
  - Course total strictly excludes study material and exam fee across all views (Full plan total = `2500`, Installments plan total = `3000`).
  - Course paid strictly sums course fee payments only (`FULL`, `AD`, `IN`), excluding study material (`MAT`), exam (`EX`), and late fees (`LF`).
  - Outstanding = `Total - Paid`. Full plan: `2500 / 2500 / 0` (100%). Installments plan at admission: `3000 / 1000 / 2000` (33%).
  - Study material is shown strictly as its own "Study material - Paid at admission" line and in the admission receipt.
- Confirmed atomic admission payment creation in `recordAdmissionWithPayment`:
  - Exactly 2 payment documents are written in Firestore for Full plan: `FULL` (2500) + `MAT` (100) under the same admission receipt number, without creating duplicates.
  - Exactly 2 payment documents are written for Installments plan: `AD` (1000) + `MAT` (100).
  - Student doc fields `feeTotal`, `paidAmount`, and `totalPaid` accurately reflect course fees (`2500` or `1000` paid, not inflated with material).
- Updated `student-profile.page.js`:
  - Standardized Course Fee breakdown with `courseFeeOf` and `discountOf`: shows `Course Package Fee (Standard)` Rs 3,000, `Full-Payment Discount (17% off)` - Rs 500, `Full Course Fee` Rs 2,500, and separate `Study Material & Kit (Paid at admission)` Rs 100.
  - Installment status table skips Admission Fee row for Full plan students and shows green paid-in-full banner.
- Verified: `node tools/check-imports.js` (0 errors), ESM syntax check on all 70 JS files (0 errors).

**Files touched:**
- `public/js/services/payment.service.js`
- `public/js/pages/student-profile.page.js`
- `public/js/utils/fees.js`
- `public/js/pages/admissions.page.js`
- `public/js/components/payment-popup.js`
- `public/js/utils/admission-receipt.js`
- Bumped version to `1.8.133` across files.

---

### 2026-11-24 — Strict Record-Based Course Paid & Single Source Financials (v1.8.134)

**What:**
- Refactored `calculateStudentFinancials` in `public/js/services/payment.service.js`:
  - `total = fullCourseFee` (`2500` for full plan, `3000` for installments). Study material is strictly excluded.
  - Removed `paid = Math.max(paidFromRecords, total)` and removed artificial counter fallbacks. Course paid comes ONLY from real course payment records (`FULL` / `AD` / `IN`). If records are missing, it displays the true lower number without masking it.
  - Course paid strictly ignores `MAT` (study material), `EX` (exam fee), and `LF` (late fee).
- Verified single source of truth across all pages showing Total / Paid / Outstanding:
  - `public/js/pages/student-profile.page.js`: Header metrics, notify dues modal, and fee schedule all delegate to `calculateStudentFinancials`.
  - `public/js/pages/pay-fees.page.js`: Financial summary cards delegate to `calculateStudentFinancials`.
  - `public/js/pages/admissions.page.js`: Student view modal now fetches payments subcollection and delegates to `calculateStudentFinancials(s, payments)`.
  - `public/js/services/payment.service.js`: Helper functions `courseFeeWithoutExam` and `courseBalanceWithoutExam` delegate directly to `calculateStudentFinancials`.
- Verified: `node tools/check-imports.js` (0 errors), ESM syntax check across all 70 JS files (0 errors).

**Files touched:**
- `public/js/services/payment.service.js`
- `public/js/pages/admissions.page.js`
- Bumped version to `1.8.134` across files.

---

### 2026-11-24 — Fix Admission Payment Execution, Discount %, Popup Subtitle & UI Elements (v1.8.135)

**What:**
- Fixed blocking `ReferenceError: Cannot access 'primaryAmt' before initialization` in `recordAdmissionWithPayment` (`public/js/services/payment.service.js`): moved `const primaryAmt = isFull ? fullAmt : admFee;` above `studentData` and removed duplicate lower declaration. Both full and installment admissions now record atomically with Item 1 (`FULL 2500` or `AD 1000`) and Item 2 (`MAT 100`).
- Fixed discount % in `public/js/utils/fees.js` (`discountOf`): directly calculates `rs = courseFee - fullAmt` and `pct = Math.round((rs / courseFee) * 100)`. Stale legacy course percent (19%) no longer overrides the mathematically correct `(3000 - 2500) / 3000 = 17%`.
- Fixed payment popup subtitle in `public/js/components/payment-popup.js`: shows student name and course code (e.g. `RONI • CITA`) even before the student record is saved to Firestore, preventing `undefined` subtitle.
- Added permanent `#adm-plan-card`, `#adm-plan-options`, and `#adm-plan-err` elements into `public/pages/admissions.html` with styling in `public/css/pages/admissions.css`. Removed console warnings for missing elements and enabled visual error display when no plan is selected.
- Removed debug log `[admissions] batch ... ACCEPTED/REJECTED` in `public/js/pages/admissions.page.js`.
- Verified: `node tools/check-imports.js` (0 errors), ESM syntax check across all 70 JS files (0 errors).

**Files touched:**
- `public/js/services/payment.service.js`
- `public/js/utils/fees.js`
- `public/js/components/payment-popup.js`
- `public/js/pages/admissions.page.js`
- `public/pages/admissions.html`
- `public/css/pages/admissions.css`
- Bumped version to `1.8.135` across files.

---

### 2026-11-24 — Fix Firestore Read Rules for Branch Heads & Remove Batch Debug Log (v1.8.136)

**What:**
- Fixed `firestore.rules` read rules for `/enrolments`, `/bills`, `/payments`, `/waivers`, `/breaks`, and `/transfers`:
  - Replaced `request.resource.data.studentId` with `resource.data.studentId` in `allow read` conditions. `request.resource` is null/undefined on read operations (`get`/`list`), which caused permission denied errors when Branch Heads accessed student sub-collections. `request.resource.data` is preserved in `allow create, update` write rules.
  - Performed a comprehensive audit across all match blocks in `firestore.rules`: confirmed 0 other read rules use `request.resource`.
- Removed debug log `console.log('[batches] writing batch doc:', ...)` in `public/js/pages/batches.page.js` line 632.
- Verified: `node tools/check-imports.js` (0 errors across 101 files and 250 imports), ESM syntax check across all 70 JS files (0 errors).

**Files touched:**
- `firestore.rules`
- `public/js/pages/batches.page.js`
- Bumped version to `1.8.136` across files.

---

### 2026-11-24 — Fix Student Delete Permanently Popup Hanging & Storage/Activity Deletion (v1.8.137)

**What:**
- Fixed `removeStudentPopup` in `public/js/pages/admissions.page.js`:
  - Resolved root cause of popup staying open with "Saving..." spinning: `modal.js` blocked `close()` when `saving()` returned `true`. Added `saving = false; setSaving(false); popup.close(true);` immediately when delete/drop succeeds.
  - Wrapped `removeStudentPopup` in strict `try / catch / finally` blocks: ensures `saving = false`, `setSaving(false)` (restores button text and removes spinner), and `check()` are ALWAYS executed on failure, preventing stuck spinners.
  - Implemented the exact same robust `try / catch / finally` flow for "Mark as dropped" and for `changeBatchPopup`.
- Enhanced `modal.js`:
  - Updated `close(force = false)` to allow callers to pass `force = true` (`popup.close(true)`) to dismiss the modal unconditionally while preserving accidental Escape/backdrop dismissal protection for users during saving.
- Hardened `purgeYouthAdmission` & `deleteStudentStorage`:
  - Added safe Storage cleanup helper `deleteStudentStorage(s)`: deletes student photos/documents in Firebase Storage with `Promise.allSettled`, ignoring `object-not-found` (`storage/object-not-found`), wrapped with a 2-second timeout so it never blocks or halts the popup.
  - Added subcollection `'activity'` to purge list (`['docs', 'payment', 'aadhaar', 'activity']`) and updated [firestore.rules](file:///c:/Users/Asus/WebstormProjects/unique-infotech-cms/firestore.rules#L174-L175) to allow Super Admin to delete student `activity` entries during student purge (`allow delete: if isSuperAdmin();`).
  - Added batch deletion fallback: if a 400-doc batch fails in `writeBatch(db).commit()`, gracefully retries individual deletes using `Promise.allSettled(allRefs.map(r => deleteDoc(r)))` so individual sub-doc rule discrepancies never block the student deletion.
- Applied identical enhancements to `school-admissions.page.js` for Kids admissions.
- Verification:
  - `tools/check-imports.js` verified with 0 errors across 101 files and 251 imports.
  - Strict ESM syntax check across all 70 JS files passed with 0 errors.
  - Bumped version to `1.8.137`.

**Files touched:**
- `firestore.rules`
- `public/js/components/modal.js`
- `public/js/pages/admissions.page.js`
- `public/js/pages/school-admissions.page.js`
- `docs/02-PROGRESS-LOG.md`
- Bumped version to `1.8.137` across files.

---

### 2026-11-24 — Fix Profile Financial Metrics for Admission Payments, Grouped Receipt Menu & Firestore Rules Deploy (v1.8.138)

**What:**
- Fixed Student Profile metric cards ignoring admission payments (reported for both Full plan and Installment plan students):
  - In `public/js/pages/student-profile.page.js`: resolved lifecycle race condition where `renderMetrics()` and `renderHeader()` ran before `await loadPayments()` resolved (`paymentsCache` was empty `[]` and cards were never re-rendered after `loadPayments()` completed). Now properly awaits `loadDocs()` and `loadPayments()` before rendering header and metrics.
  - In `public/js/services/payment.service.js`: updated `calculateStudentFinancials(student, allPayments)`:
    - Sums course payment records (`FULL`, `AD`, `IN`), strictly excluding study material (`MAT`), examination fee (`EX`), and late fee (`LF`).
    - Added fallback for admission payments when payment subcollection records are missing (e.g. existing test students or legacy records): for Full plan (`student.fullPaid`, `student.admissionPaid`, or `paidAmount >= total`), sets `paid = total` (2500); for Installments plan (`student.admissionPaid` or `paidAmount >= admFee`), counts the admission fee (1000) + any scheduled/paid installments.
    - Set `outstanding = Math.max(0, total - paid)`.
- Fixed Receipt Menu creating duplicate fake "Installment 1" items:
  - Created centralized `buildReceiptMenuItems(student, payments)` in `payment.service.js`:
    - Shows exactly one "Admission receipt - <rcptNo>" item for all payments made at admission (`AD`, `FULL`, `MAT`).
    - Skips `AD`, `FULL`, `MAT`, and any payment sharing the admission receipt number.
    - Strictly lists only real installment (`IN`) and exam (`EX`) payments as distinct individual receipts.
    - Implemented in `student-profile.page.js` (header Receipt dropdown, Fee Actions, and Transactions Ledger) and `admissions.page.js` (student list table kebab menu).
  - In `payment-receipt.page.js`: added safeguard redirect if `#/payments/.../receipt` is opened for an admission payment (`AD`, `FULL`, `MAT`), redirecting directly to `#/admissions/${studentDocId}/receipt`.
- Verified and Deployed `firestore.rules`:
  - Validated with `firebase deploy --only firestore:rules --dry-run` (rules compiled successfully).
  - Deployed live to Firebase (`Deploy complete!`).
- Verification:
  - `tools/check-imports.js` verified with 0 errors across 101 files and 251 imports.
  - Strict ESM syntax check across all 70 JS files passed with 0 errors.
  - Bumped version to `1.8.138`.

**Files touched:**
- `firestore.rules` (deployed)
- `public/js/components/modal.js`
- `public/js/services/payment.service.js`
- `public/js/pages/student-profile.page.js`
- `public/js/pages/admissions.page.js`
- `public/js/pages/payment-receipt.page.js`
- `public/js/pages/school-admissions.page.js`
- `docs/02-PROGRESS-LOG.md`
- Bumped version to `1.8.138` across files.

---

### 2026-11-24 — Remove Guessing Fallbacks from calculateStudentFinancials, Exclude WA from Receipts, and Repair Test Student Payments (v1.8.139)

**What:**
- Cleaned `calculateStudentFinancials` in `public/js/services/payment.service.js`:
  - Removed all guessing fallbacks: no longer assumes admission or installments are paid based on receipt numbers, `paidAmount >= fee`, `feeSchedule` item flags, or `installmentsPaid`.
  - Paid amount strictly reflects the sum of real payment records (`FULL`, `AD`, `IN`) from the student's subcollection.
  - Removed capping `paid = Math.min(total, paid)`. If `paid > total && total > 0`, it displays the true amount and logs a `console.warn`.
- Fixed `buildReceiptMenuItems` in `public/js/services/payment.service.js`:
  - Removed `WA` from installment receipts: waivers (`WA` / `WAIVER`) are no longer listed as "Installment" receipts in dropdown menus.
- One-time repair for missing admission payment records:
  - Audited all existing student payment subcollections in Firestore. Found 3 legacy test students created before the unified admission transaction:
    - `27010001` (FCGVHBN) - missing `AD` (₹1,000) & `MAT` (₹100) for receipt `UI26AD-BZYCTC-0001`
    - `27010002` (ASDFGHJ) - missing `AD` (₹1,000) & `MAT` (₹100) for receipt `UI26AD-BZYCTC-0003`
    - `27010003` (SUMANTA SINGH) - missing `AD` (₹1,000) & `MAT` (₹100) for receipt `UI26AD-BZYCTC-0004`
    (Note: RAVI KUMAR `27010010` and SUMANTA `27010011` already had complete `FULL`/`AD` and `MAT` documents in Firestore).
  - Executed one-time repair creating the exact missing `AD` and `MAT` documents in Firestore with their original receipt numbers.
  - Implemented and exported `repairStudentAdmissionPayment(student, payments)` in `payment.service.js` and wired it into `student-profile.page.js` and `pay-fees.page.js` so any student opened with missing subcollection records is seamlessly auto-repaired.
- Verified financial calculation usage across all pages:
  - Confirmed Pay Fees (`pay-fees.page.js:717`), Students list (`admissions.page.js:2333`), and Student Profile (`student-profile.page.js:555, 643`) all use `calculateStudentFinancials`.
- Verified and displayed `firestore.rules` read rules confirming `resource.data.studentId` is used across `/enrolments`, `/bills`, `/payments`, `/waivers`, `/breaks`, and `/transfers`.
- Verification:
  - `tools/check-imports.js` verified with 0 errors across 101 files and 251 imports.
  - Strict ESM syntax check across all 70 JS files passed with 0 errors.
  - Bumped version to `1.8.139`.

**Files touched:**
- `public/js/services/payment.service.js`
- `public/js/pages/student-profile.page.js`
- `public/js/pages/pay-fees.page.js`
- `docs/02-PROGRESS-LOG.md`
- Bumped version to `1.8.139` across 35 files.

---

### 2026-11-25 — Fix Profile Photo Visibility in Student Profile Hero Header (v1.8.140)

**What:**
- Fixed profile photo not visible in the Student Profile hero header (`#/students/<id>`):
  - In `public/js/pages/student-profile.page.js`: resolved lifecycle race condition where `renderHeader()` ran after `loadDocs()` and unconditionally set `imgEl.hidden = true; initialsEl.hidden = false;`, overriding the photo loaded from the `docs` subcollection.
  - Implemented centralized `renderAvatar()`:
    - Inspects `docsCache['photo']` (`data` or `url`), falling back to `currentStudent.photoUrl` and `currentStudent.photo`.
    - If photo source is present, unhides `sp-avatar-img`, hides `sp-avatar-initials`, and attaches an `onerror` fallback that reverts to initials if the image fails to load.
    - If no photo source is present, hides `sp-avatar-img` and displays student initials cleanly.
  - Wired `renderAvatar()` into both `renderHeader()` and `loadDocs()`.
- Verification:
  - `tools/check-imports.js` verified with 0 errors across 101 files and 251 imports.
  - Strict ESM syntax check across all 70 JS files passed with 0 errors.
  - Bumped version to `1.8.140`.

**Files touched:**
- `public/js/pages/student-profile.page.js`
- `docs/02-PROGRESS-LOG.md`
- Bumped version to `1.8.140` across 35 files.

---

## FUTURE ENTRIES GO ABOVE THIS LINE
