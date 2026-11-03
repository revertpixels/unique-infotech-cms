# 04 — DATABASE MAP (Firestore)
# Unique Infotech CMS (`unique-infotech-cms`)

> Corrected 2026-11-02 (Phase 1 Step 3). Aligned with `01-MASTER-PLAN.md` and Decisions 12 and 13. Where this file and the Master Plan disagree, the Master Plan wins, and this file must be fixed.
> **Rules status** column shows what is enforced by the live `firestore.rules` today. Everything not listed as live is DENIED by default.

---

## 0. Conventions (apply to every collection)

- **Root collections only.** No subcollections (Master Plan 7.1).
- **Money** is stored as whole rupees (integer). No decimals, no paise.
- **Timestamps** use Firestore `Timestamp` (server time for audit-relevant fields). Month periods are strings `"YYYY-MM"`.
- **Emails** are always stored lowercase.
- **Denormalise names** needed for display (branchName, courseName, studentName) so lists never need extra reads.
- **No names, designations, emails or fees are hardcoded in code.** Everything is read from these collections. (Single exception: the Super Admin identity is locked in `firestore.rules`; see section 11.)
- **Files** are stored in Storage; Firestore keeps the **storage path**, never a permanent download URL.

---

## 1. `users/{lowercased email}` — role registry (Decision 12)

Document ID = the person's lowercase email. Created and edited ONLY by the Super Admin.

| Field | Type | Notes |
|---|---|---|
| `email` | string | Must equal the document ID |
| `name` | string | Display name, entered by Super Admin |
| `phone` | string | Optional |
| `role` | string | `superadmin` (created once, manually in Firebase Console) / `branch_head` / `school_head` |
| `branchId` | string | Required for `branch_head`; absent for `school_head` and `superadmin` |
| `status` | string | `active` / `inactive` |
| `createdAt`, `createdBy`, `updatedAt` | timestamp / string / timestamp | Audit info |

Rules: Heads can read ONLY their own document. Super Admin can read, list, create, update, delete. **Live in Step 3.**

Access revocation: set `status` to `inactive` or delete the document. Effect is immediate on the next request.

Uniqueness ("1 email = 1 branch", "1 head per branch", "only 1 School Head"): 1 email = 1 role is guaranteed by the document ID. The other two are enforced by the Super Admin screen using a transaction in Phase 2 (Firestore rules cannot count documents).

---

## 2. `settings/`

**`settings/org_config`** (live, Super Admin write, any active user read)

`orgName`, `tagline`, `address`, `phones` (array), `contactEmail`, `registrationText`, `receiptHeaderText`, `receiptFooterText`, `signatoryName`, `signatoryTitle`, `finePerDay` (number, default 1), `fineAfterDay` (number, default 10), `updatedAt`, `updatedBy`.

Removed from the old map: `superAdminEmail` (lives in rules, not data) and `appVersion` (lives only in `app.js`).

**`settings/counters`** (rules added in Phase 3 — needs Head write inside `runTransaction`)

Sequence numbers for student IDs and receipts. Exact shape decided at Phase 3 (see OPEN-1, OPEN-2).

---

## 3. `branches/{autoId}` — Youth branches (live)

`name`, `location`, `phone`, `headEmail` (lowercase, links to `users`), `status` (`active`/`inactive`), `createdAt`, `createdBy`, `updatedAt`.

Head Office is NOT a branch document (management only, not selectable for admission). Its address lives in `org_config`.

Rules: Super Admin full access. A Branch Head can `get` only the branch whose ID equals their `users.branchId`.

---

## 4. `courses/{autoId}` — Youth courses (live)

| Field | Type | Notes |
|---|---|---|
| `code` | string | e.g. CITA |
| `name` | string | |
| `category` | string | `youth` |
| `durationMonths` | number | 6, 12 or 18 |
| `isPackage` | boolean | `false` = base course, `true` = 12/18-month package |
| `semesters` | array | `[{ semNumber, baseCourseId, admissionFee, installmentFee, installmentCount (4), examFee, studyMaterialFee }]` — a base course has exactly 1 entry; a 12-month package 2; an 18-month package 3 |
| `totalFees` | number | Denormalised sum, calculated by the app |
| `status` | string | `active` / `inactive` |

Rules: Super Admin write. Read by Super Admin and active Branch Heads only (School Head cannot read Youth data).

---

## 5. `batches/{autoId}` — GLOBAL, same for all branches (live)

Corrected: the old map wrongly had `branchId`. Batches are created only by the Super Admin and are shared by all branches.

`name`, `courseId`, `courseName`, `startDate`, `endDate`, `status` (`active`/`closed`), `createdAt`, `createdBy`.

Rules: Super Admin write. Read by Super Admin and active Branch Heads.

---

## 6. `levels/{autoId}` — Unique Kids levels (live)

Renamed from `school_levels` to match Master Plan 7.1.

`name` (e.g. Basic, Advance, Level 3 — all dynamic), `admissionFee`, `monthlyFee`, `status`, `order`, `createdAt`, `updatedAt`.

Study material items for School: `settings/school_material` document (added in Phase 5).

Rules: Super Admin write. Read by Super Admin and the active School Head.

---

## 7. `students/{UIC-YYYY-NNNN}` — Youth students (rules in Phase 3)

| Field | Notes |
|---|---|
| `section` | `youth` |
| `branchId`, `branchName` | Isolation key |
| `admissionDate` | Timestamp |
| `personal` | `{ name, dob, fatherName, phone, address, gender }` |
| `academics` | `{ courseId, courseName, currentSem, batchId, batchName, status }` — status `active`/`completed`/`dropped` |
| `tags` | e.g. `completedSem1Manual` for the manual Sem 2/3 entry of archived students |
| `documents` | Storage PATHS: `{ photoPath, idProofPath, idProofType, marksheetPath, signaturePath }` |
| `feePlan` | Snapshot of the fees at admission/upgrade, per semester, so later fee edits never change an existing student's dues |
| `dues` | Per semester: admission, installments 1-4 (each with `amount`, `dueDate`, `paymentId` or null), exam, material. This lets Pay Fees work from ONE `getDoc` |
| `archived` | boolean, default false |
| `createdBy`, `createdAt`, `updatedAt` | Audit |

Each admission = one student record (a person taking two courses has two records, per Known Issue B).

Planned rules: Branch Head reads/writes only where `branchId` equals their own; create must carry their own `branchId`; delete is Super Admin only.

---

## 8. `schoolStudents/{UK-YYYY-NNNN}` — Unique Kids (rules in Phase 5)

`section` (`school`), `levelId`, `levelName`, `admissionDate`, `personal`, `status`, `admissionPaid`, `paidMonths` (array of `"YYYY-MM"`), material fields, `documents` (see OPEN-4), audit fields, `archived`.

Monthly dues are calculated on the fly from `admissionDate` and `paidMonths`. Only the School Head and Super Admin can access.

---

## 9. `payments/{autoId}` — both sections (rules in Phase 4)

Corrected: fines are NOT a payment type. A fine is calculated on the fly and recorded on the payment that clears the due.

| Field | Notes |
|---|---|
| `section` | `youth` / `school` |
| `studentId`, `studentName` | Denormalised |
| `branchId` | Youth only — the STUDENT's home branch (ownership key, used for Branch Head read access). Not the collection location. |
| `paidAt` | Map: `{ type: "branch" \| "head_office", branchId?, branchName? }`. Required and immutable. When type is "branch", branchId and branchName are included. Records where the payment was physically collected. |
| `type` | `admission` / `installment` / `exam` / `material` / `monthly` |
| `semNumber`, `installmentNumber`, `periodMonth` | As applicable |
| `amount` | Base amount (full, never partial) |
| `fineCharged` | Fine collected with this payment (0 if none) |
| `fineWaived` | boolean |
| `waiver` | `{ amount, reason, by, at }` — required when waived; also written to `audit` |
| `totalReceived` | `amount + fineCharged` |
| `mode` | `cash` / `upi` / `bank` |
| `collectedBy` | Map: `{ email, name, role }`. Records who collected the payment. Branch Heads always record their own email/name/role (not editable). |
| `collectedAt` | Server timestamp |
| `receiptNo` | See OPEN-2 |

Payments are immutable. Only Super Admin may delete (secure delete flow).

**Reports and settlement:** Reports include the columns **Collected By** and **Collected At**. The report footer shows counts and totals grouped by **Collected At**, by **Collected By**, and by payment mode, plus counts of receipts, waivers and fines. A settlement view per branch separates "collected physically by the branch head" (`paidAt.type == "branch"` and `paidAt.branchId ==` the Branch Head's own `branchId` and `collectedBy.email ==` the Branch Head's email) from "collected by the Super Admin for their students" (`paidAt.type == "head_office"` or `paidAt.branchId !=` the Branch Head's own `branchId`).

**Planned rules:** A Branch Head may create payments only for students of their own branch and only with `paidAt.type == "branch"` and `paidAt.branchId ==` their own `branchId`. The Super Admin may create payments for any student with any `paidAt`.

---

## 10. `audit/{autoId}` — critical actions only (rules in Phase 4)

`action` (`fine_waiver`, `due_date_edit`, `student_delete`, `role_change`, `archive_download`, `archive_delete`), `actorEmail`, `actorRole`, `targetType`, `targetId`, `details` (map), `createdAt`.

Planned rules: any active user may CREATE entries where `actorEmail` is their own email; only Super Admin may read; nobody may update or delete.

---

## 11. Security model (implemented in `firestore.rules`)

| Identity | How it is recognised in rules |
|---|---|
| **Super Admin** | Sign-in provider is `password` AND email equals the locked Super Admin email. (Locked decision; changing it requires a rules redeploy.) |
| **Branch / School Head** | Sign-in provider is `google.com` AND email is verified AND `users/{email}` exists with `status == active`. Role and branch come from that document. |
| **Anyone else** | No access. Anyone who self-registers with email/password gets a token but matches neither identity above. |

Why the provider checks matter: without them, someone could create an email/password account using a Head's email address and inherit that Head's access.

Access matrix (Step 3 state):

| Collection | Super Admin | Branch Head | School Head |
|---|---|---|---|
| `users` | full | read own doc | read own doc |
| `settings` | full | read | read |
| `branches` | full | read own branch | none |
| `courses` | full | read | none |
| `batches` | full | read | none |
| `levels` | full | none | read |
| everything else | denied until its phase | denied | denied |

Cost note: each rules check for a Head reads their `users` document once (billed as a read, free tier covers 50,000/day).

---

## 12. Indexes (declared in `firestore.indexes.json` when each page is built)

Planned, none needed yet:
1. `students`: `branchId` ASC + `academics.status` ASC + `admissionDate` DESC
2. `students`: `branchId` ASC + `admissionDate` DESC
3. `payments`: `studentId` ASC + `collectedAt` DESC
4. `payments`: `branchId` ASC + `collectedAt` DESC
5. `payments`: `section` ASC + `collectedAt` DESC

---

## 13. Open questions for the owner (not blocking Step 3)

| # | Question | Needed by |
|---|---|---|
| OPEN-1 | Does the 4-digit student number restart at 0001 every year (UIC-2027-0001), or keep counting across years? | Phase 3 |
| OPEN-2 | Receipt number format (e.g. per-branch or global, yearly reset)? | Phase 4 |
| OPEN-3 | Lateral entry (CITA to CFAS, 1,200 rupees) is in the Master Plan but not modelled. How should it appear in admission? | Phase 3 |
| OPEN-4 | Which documents are required for Unique Kids students? | Phase 5 |