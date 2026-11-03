# 02 — PROGRESS LOG
# Unique Infotech CMS

> **Append-only log of what was built, when, and why. Newest entry at the top. Every completed task MUST be logged here before marking done.**

---

## LOG ENTRY FORMAT (COPY THIS FOR EVERY NEW ENTRY)

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