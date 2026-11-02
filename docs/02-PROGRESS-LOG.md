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