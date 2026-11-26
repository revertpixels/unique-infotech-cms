# File Index & Architecture Map: Unique Infotech CMS

This document details the exact file structure of the `unique-infotech-cms` project. Every file, its responsibility, and its system dependencies are mapped below.

---

## Project Structure Overview

```text
unique-infotech-cms/
├── .firebaserc
├── .gitignore
├── firebase.json
├── firestore.indexes.json
├── firestore.rules
├── storage.rules
├── docs/
│   ├── 01-MASTER-PLAN.md
│   ├── 02-PROGRESS-LOG.md
│   ├── 03-DECISIONS.md
│   ├── 04-DATABASE-MAP.md
│   ├── 05-FILE-INDEX.md
│   ├── 06-KNOWN-ISSUES.md
│   └── 07-HANDOFF-PROMPT.md
└── public/
    ├── 404.html
    ├── index.html
    ├── temp_ref_dashboard.html
    ├── assets/
    │   ├── icons/
    │   └── images/
    │       ├── favicon-32.png
    │       ├── apple-touch-icon.png
    │       ├── logo.jpg
    │       ├── logo-192.jpg
    │       └── logo-512.jpg
    ├── css/
    │   ├── main.css
    │   ├── base/
    │   │   ├── reset.css
    │   │   ├── typography.css
    │   │   └── variables.css
    │   ├── components/
    │   │   ├── badges.css
    │   │   ├── buttons.css
    │   │   ├── cards.css
    │   │   ├── course-view.css
    │   │   ├── dropdown.css
    │   │   ├── forms.css
    │   │   ├── modal.css
    │   │   └── tables.css
    │   ├── layout/
    │   │   ├── grid.css
    │   │   ├── sidebar.css
    │   │   └── topbar.css
    │   └── pages/
    │       ├── auth.css
    │       ├── dashboard.css
    │       ├── financial-reports.css
    │       ├── archives.css
│       └── login.css
    ├── js/
    │   ├── components/
    │   │   ├── branch-batch-filter.js
    │   │   ├── confirm.js
    │   │   ├── dropdown.js
    │   │   ├── list-page.js
    │   │   ├── modal.js
    │   │   ├── payment-popup.js
    │   │   ├── profile-modal.js
    │   │   ├── sidebar.js
    │   │   ├── toast.js
    │   │   ├── topbar.js
    │   │   └── ui-select.js
    │   ├── config/
    │   │   └── firebase-config.js
    │   ├── core/
    │   │   ├── app.js
    │   │   ├── auth.js
    │   │   ├── guard.js
    │   │   └── router.js
    │   ├── pages/
    │   │   ├── admissions.page.js
    │   │   ├── archives.page.js
    │   │   ├── authorised-users.js
    │   │   ├── branch-heads.page.js
    │   │   ├── batches.page.js
    │   │   ├── branches.page.js
    │   │   ├── courses.page.js
    │   │   ├── dashboard.page.js
    │   │   ├── login.page.js
    │   │   ├── org.page.js
    │   │   ├── pay-fees.page.js
    │   │   ├── payments.page.js
    │   │   ├── pending.page.js
    │   │   ├── reports.page.js
    │   │   ├── school.page.js
    │   │   └── students.page.js
    │   ├── services/
    │   │   ├── admission.service.js
    │   │   ├── archive.service.js
    │   │   ├── branch.service.js
    │   │   ├── course.service.js
    │   │   ├── payment.service.js
    │   │   ├── report.service.js
    │   │   ├── school.service.js
    │   │   ├── student.service.js
    │   │   └── user-directory.service.js
    │   └── utils/
    │       ├── archive-viewer-builder.js
    │       ├── archive-viewer-receipts.js
    │       ├── archive-viewer-styles.js
    │       ├── date.utils.js
    │       ├── formatter.js
    │       ├── helpers.js
    │       ├── pdf.utils.js
    │       ├── sound.js
    │       └── validator.js
    ├── vendor/
    │   ├── archive/
    │   │   ├── fonts/
    │   │   │   ├── ibm-plex-sans-1.woff2
    │   │   │   ├── libre-franklin-2.woff2
    │   │   │   └── plus-jakarta-sans-3.woff2
    │   │   ├── fonts.css
    │   │   ├── html2canvas.min.js
    │   │   ├── lucide.min.js
    │   │   └── pdfmake.min.js
    │   ├── fflate.LICENSE.txt
    │   ├── fflate.umd.js
    │   ├── jspdf.umd.min.js
    │   ├── pdfmake.min.js
    │   └── vfs_fonts.js
    └── pages/
        ├── admissions.html
        ├── archives.html
        ├── branch-heads.html
        ├── batches.html
        ├── branches.html
        ├── courses.html
        ├── dashboard.html
        ├── login.html
        ├── org-details.html
        ├── pay-fees.html
        ├── payments.html
        ├── pending.html
        ├── reports.html
        ├── school-fees.html
        ├── school-students.html
        └── students.html
`router.js` is added to `public/js/core/` as the single source of truth for dashboard routes, menu, titles and access control. `user-directory.service.js` serves as the single source of truth for dynamic role/user titles (`getRoleTitle`, `getUserTitle`, `/public/branding`) and profile photo uploads (`/user-photos/{email}/...`).

**TEMPORARY:** `temp_ref_dashboard.html` at the project root — owner's visual reference containing demo data; not deployed; delete after Phase 2.

## Cloud Functions & Developer Tools
- `functions/package.json`: Cloud Functions dependencies (`firebase-admin`, `firebase-functions`).
- `functions/index.js`: 2nd Gen Identity blocking function `beforeUserSignedIn` (region `asia-south1`) to hard-block Google sign-in for Super Admin accounts before credentials/tokens are issued.
- `tools/check-imports.js`: ES module import resolver validating that all relative imports across `public/` resolve to existing files (0 broken imports).
- `tools/bump-version.js`: Automated version increment and query-parameter cache buster tool.
- `tools/delete-test-students.js`: Super Admin Node CLI utility to safely list and delete test students, payment records, activities, and documents.