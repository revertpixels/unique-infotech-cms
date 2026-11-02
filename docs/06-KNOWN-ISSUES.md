# Known Issues & Pending Client Inputs: Unique Infotech CMS

This document tracks unresolved items, pending client inputs, technical debt, and edge cases under surveillance.

---

## 1. Pending Client Inputs (Non-Blocking for Phase 1)

| # | Item | Current Interim Workaround | Required Action | Status |
|---|---|---|---|---|
| 1 | Official PNG Logo | Using interim `public/assets/images/logo.jpg` (116.61 KB JPEG from Facebook page) | Client to provide high-res PNG with transparent background | Pending |
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
| ISS-003 | 2026-11-02 | `firebase.json` shows Firestore location `nam5`, docs say `asia-south1`; Node 11.17.0 listed but Firebase CLI 15.x needs a newer Node | Medium | Environment | Open | Verify in Firebase Console and via `node --version` / `firebase --version` |
| ISS-004 | 2026-11-02 | `04-DATABASE-MAP.md` conflicts with Master Plan (batches carry `branchId`; no `users` or `audit` collection; rule references nonexistent `branchHeadEmail`) | High | Docs / Security | Open | Must be corrected before Phase 1 Step 3 (security rules) |