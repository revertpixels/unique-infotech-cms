# Database Map (Firestore): Unique Infotech CMS

This document defines the schema for the `unique-infotech-cms` Firestore database.

## 1. Global Settings (`settings/`)
- **Document: `org_config`**
    - `superAdminEmail`: string (locked to utpal.goutam@gmail.com)
    - `orgName`: string
    - `finePerDay`: number (default: 1)
    - `gracePeriodDays`: number (default: 10)
    - `appVersion`: string
- **Document: `counters`**
    - `youthStudentCount`: number (for UIC-YYYY-NNNN)
    - `schoolStudentCount`: number (for UK-YYYY-NNNN)

## 2. Branches (`branches/`)
- `id`: string (auto-gen)
- `name`: string
- `location`: string
- `contactPhone`: string
- `headEmail`: string (Google Sign-in email)
- `createdAt`: timestamp
- `status`: "active" | "inactive"

## 3. Courses (`courses/`)
- `id`: string
- `name`: string (e.g., CITA)
- `durationMonths`: number
- `isPackage`: boolean
- `semesters`: array [ { semNumber: 1, baseCourseId: string, admissionFee: 1000, installmentFee: 250, examFee: 200 } ]
- `totalFees`: number
- `category`: "youth" | "school"

## 4. Batches (`batches/`)
- `id`: string
- `name`: string (e.g., B1-2025)
- `startTime`: string
- `days`: array (e.g., ["Mon", "Wed"])
- `branchId`: string (reference)
- `courseId`: string (reference)

## 5. Students (`students/`)
- `id`: string (UIC-YYYY-NNNN or UK-YYYY-NNNN)
- `branchId`: string
- `admissionDate`: timestamp
- `currentContext`: "youth" | "school"
- `personal`: { name, dob, fatherName, phone, address, gender }
- `academics`: { currentCourseId, currentSem, batchId, status: "active"|"completed"|"dropped" }
- `documents`: { photoUrl, aadhaarUrl, admitUrl, marksheetUrl, signatureUrl }
- `archived`: boolean (default: false)

## 6. Payments (`payments/`)
- `id`: string (auto-gen)
- `studentId`: string
- `branchId`: string
- `type`: "admission" | "installment" | "exam" | "study-material" | "fine"
- `amount`: number
- `installmentNumber`: number (1-4, if applicable)
- `period`: string (e.g., "Oct 2026")
- `date`: timestamp
- `mode`: "cash" | "upi" | "bank"
- `collectedBy`: string (email of Branch Head)
- `receiptNo`: string
- `fineWaived`: boolean
- `waiverReason`: string
- `waivedBy`: string

## 7. School Module Specifics
- **Levels (`school_levels/`):**
    - `id`: string (Basic, Advance, Level 3)
    - `monthlyFee`: number
    - `admissionFee`: number
- **Monthly Dues Tracker:** Calculated on-the-fly via student's `admissionDate` vs `payments` collection.

## 8. Indexing Requirements (Compound Indexes)
1. **Students:** `branchId` (ASC) + `academics.status` (ASC) + `admissionDate` (DESC)
2. **Payments:** `studentId` (ASC) + `date` (DESC)
3. **Batches:** `branchId` (ASC) + `status` (ASC)

## 9. Security Logic (Firestore Rules)
- **Global Read:** Authenticated users can read their own profile.
- **Branch Head:**
    - `Allow read/write if request.auth.token.email == resource.data.branchHeadEmail`
    - Restricted to documents where `branchId` matches their assigned branch.
- **Super Admin:**
    - `Allow read/write if request.auth.token.email == "utpal.goutam@gmail.com"`
    - Full access to all collections.
- **Public:** No public access.