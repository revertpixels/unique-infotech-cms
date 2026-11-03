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
    │       └── login.css
    ├── js/
    │   ├── components/
    │   │   ├── confirm.js
    │   │   ├── dropdown.js
    │   │   ├── modal.js
    │   │   ├── sidebar.js
    │   │   ├── toast.js
    │   │   └── topbar.js
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
    │   │   ├── branch-heads.page.js
    │   │   ├── batches.page.js
    │   │   ├── branches.page.js
    │   │   ├── courses.page.js
    │   │   ├── dashboard.page.js
    │   │   ├── login.page.js
    │   │   ├── org.page.js
    │   │   ├── pay-fees.page.js
    │   │   ├── payments.page.js
    │   │   ├── reports.page.js
    │   │   ├── school.page.js
    │   │   └── students.page.js
    │   ├── services/
    │   │   ├── admission.service.js
    │   │   ├── branch.service.js
    │   │   ├── course.service.js
    │   │   ├── payment.service.js
    │   │   ├── report.service.js
    │   │   ├── school.service.js
    │   │   └── student.service.js
    │   └── utils/
    │       ├── date.utils.js
    │       ├── formatter.js
    │       ├── helpers.js
    │       ├── pdf.utils.js
    │       └── validator.js
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
        ├── reports.html
        ├── school-fees.html
        ├── school-students.html
        └── students.html
router.js is added to public/js/core/ as the single source of truth for dashboard routes, menu, titles and access control.

**TEMPORARY:** `temp_ref_dashboard.html` at the project root — owner's visual reference containing demo data; not deployed; delete after Phase 2.