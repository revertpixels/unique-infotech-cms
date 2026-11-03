# Known Issues & Pending Client Inputs: Unique Infotech CMS

This document tracks unresolved items, pending client inputs, technical debt, and edge cases under surveillance.

---

## 1. Pending Client Inputs (Non-Blocking for Phase 1)

| # | Item | Current Interim Workaround | Required Action | Status |
|---|---|---|---|---|
| 1 | Official PNG Logo | Official logo received as JPG (white background), accepted by the owner; web-size copies created | Client to provide high-res PNG with transparent background (optional) | Received (vector file optional) |
| 2 | Google Sign-in Support Email | Using fallback configuration | Client to specify designated Google account for OAuth | Pending |
| 3 | Initial Branch Head Gmails | Test emails configured | Client to provide 1 Google email per active branch | Pending |
| 4 | School Level 3 Course Name & Fee | Configurable dynamically in Settings | Client to confirm official level name and monthly fee | Pending |
| 5 | Official Receipt Header & Legal Text | Standard template text active | Client to provide exact registration text, tagline, and signatory title | Pending |
| 6 | Batch Naming Standard | Standard format `B1-2025` active | Client to confirm preferred batch nomenclature | Pending |
| 7 | Academic Session Format | Using `2025-26` | Client to confirm if financial year or calendar year applies | Pending |

---

## 2. Technical Edge Cases & Guardrails

### A. Late Admission Due Calculations
- **Issue:** A student taking admission late in a month or mid-semester may trigger past-due alerts incorrectly.
- **Mitigation:** The system calculates dues strictly from the recorded `admissionDate`. `Month 1 = Admission`, `Month 2 = Grace`, `Months 3-6 = Installments 1-4`.

### B. Dual Course Enrollment in Same Branch
- **Issue:** Can a student enroll in two separate courses concurrently?
- **Decision:** Each admission generates a distinct Student ID (`UIC-YYYY-NNNN`). A student taking two courses will hold two separate student records to preserve financial clarity per course.

### C. Concurrent Document Counter Increments
- **Issue:** Two Branch Heads enrolling students at the exact same second could trigger duplicate Student IDs.
- **Mitigation:** Uses Firestore `runTransaction` on `settings/counters` to guarantee atomic increments.

---

## 3. Known Issues Log

| ID | Date Reported | Description | Severity | Affected Module | Status | Resolution / Notes |
|---|---|---|---|---|---|---|
| ISS-001 | 2026-10-31 | Initial project creation baseline | Info | Global | Logged | Operational setup complete |
| ISS-002 | 2026-11-02 | `storage.rules` contained ~320 KB of pasted web text; `06-KNOWN-ISSUES.md` contained pasted instruction wrapper | High | Repo / Security | Resolved | Rules replaced with deny-all baseline; 06 cleaned (Phase 1 Step 1) |
| ISS-003 | 2026-11-02 | `firebase.json` shows Firestore location `nam5`, docs say `asia-south1`; Node 11.17.0 listed but Firebase CLI 15.x needs a newer Node | Medium | Environment | Resolved | Firestore database was found in nam5 (US) instead of asia-south1. Deleted and recreated in asia-south1 on 2026-11-02 before any real data existed. Node version corrected to 24.19.0 in Master Plan. Storage bucket region still to be verified (not blocking). |
| ISS-004 | 2026-11-02 | `04-DATABASE-MAP.md` conflicts with Master Plan (batches carry `branchId`; no `users` or `audit` collection; rule references nonexistent `branchHeadEmail`) | High | Docs / Security | Open | Must be corrected before Phase 1 Step 3 (security rules) |
| ISS-005 | 2026-11-02 | No real favicon yet (public/assets/images/favicon.ico is an empty placeholder; browser requested /favicon.ico and got 404). Interim: blank data-URI icon in index.html. | Low | UI / Branding | Resolved | Official logo received; favicon-32.png and apple-touch-icon.png added |
| ISS-006 | 2026-11-03 | Youth session (half-year) and School period (calendar month) are an interim assumption in date.utils.js; confirm with client (pending #7). | Low | UI | Open | — |
| ISS-007 | 2026-11-03 | temp_ref_dashboard.html at project root is a temporary reference with demo data; delete after Phase 2. | Low | Housekeeping | Open | Delete after Phase 2. |
| ISS-008 | 2026-11-03 | Step 5c is split into 5c-1 palette/logo/docs, 5c-2 sidebar, 5c-3 topbar+dropdown+date utils, 5c-4 dashboard content. Existing dropdown.js, date.utils.js and pages/dashboard.css from the earlier mislabelled entry do not match the spec (wrong API, hardcoded due-day, UTC date bug, unlinked CSS) and are replaced in 5c-3/5c-4. | Medium | Process | Open | Rework in 5c-3/5c-4. |