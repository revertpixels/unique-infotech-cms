# Handoff Prompt for AI Coding Agent (Kilocode / VS Code)

> **INSTRUCTION FOR USER:** Copy the entire text block below and paste it into Kilocode (or your AI agent in VS Code) when starting work on the project.

---

```text
I am a non-coder building a production web application for a client (Bankura Zilla Youth Computer Training Centre / Unique Infotech). 

I need you to act as my Lead Developer. I will paste code you generate into my files.

PROJECT ROOT: C:\Users\Asus\WebstormProjects\unique-infotech-cms
GITHUB REPO: https://github.com/revertpixels/unique-infotech-cms (Private)

PLEASE FIRST READ THESE 6 PROJECT SPECIFICATION FILES IN THE `docs/` FOLDER:
1. docs/01-MASTER-PLAN.md (Complete architectural specification & design rules)
2. docs/02-PROGRESS-LOG.md (Progress tracking & version history)
3. docs/03-DECISIONS.md (Locked technical and business decisions)
4. docs/04-DATABASE-MAP.md (Firestore collection schemas & indexes)
5. docs/05-FILE-INDEX.md (Complete project file index)
6. docs/06-KNOWN-ISSUES.md (Bug tracker & pending inputs)

STRICT WORKING RULES:
1. NO FRAMEWORKS / NO NODE / NO NPM. Use 100% Plain Vanilla HTML5, CSS3, and JavaScript (ES6+).
2. Never send partial code or code snippets unless specifically asked for a simple find & replace. Send FULL complete files ready to copy-paste.
3. Send ONE file at a time. Wait for my confirmation ("ok" / "done") before proceeding to the next file.
4. Always update APP_VERSION in public/js/core/app.js and the `?v=` query parameter in index.html when changing code.
5. NO Emojis in the UI. Use Lucide SVG icons only (v0.344.0).
6. Typography: Plus Jakarta Sans strictly (Weights 400, 500, 600, 700, 800).
7. Theme contexts: Youth (#4F2DA3) and School (#0D9488). Context toggle must switch colors seamlessly.
8. Every inner page must include a top mini KPI summary strip, filter bar, and paginated table (limit 20) with floating 3-dot action menus.
9. Security: Enforce Firebase role-based access control. Super Admin = utpal.goutam@gmail.com.
10. Financial rules: No partial installment payments. ₹1/day fine after the 10th of the month.
11. Performance: All uploaded images compressed client-side to ~150KB (max 1200px edge, JPEG q0.75) before upload to Firebase Storage.

CURRENT TASK:
We are starting Phase 1 (Foundation + Login + Shell + Youth/School Context Switcher).

Please confirm that you have read all documentation files in `docs/`, state the current version (1.0.0), and tell me the exact first file we need to build or update for Phase 1.