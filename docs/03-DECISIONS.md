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