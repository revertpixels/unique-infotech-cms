// Thin archive-specific CSS layer placed cleanly ON TOP OF the copied live CMS stylesheets.
// Never duplicates CMS palette, buttons, tables, sidebar, topbar, or receipt CSS.
export const ARCHIVE_VIEWER_OVERRIDES_CSS = `/* archive-overrides.css — Topbar Archive pill, unlock gate, native select parity, and clean print staging */

/* Topbar Archive chip matching Session and Branch controls */
.arx-tb-session-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.arx-tb-badge {
  flex-shrink: 0;
}

/* Guarantee single active tab pane & compact icon-only Download beside View */
.sp-pane:not(.active),
.sp-pane[hidden] {
  display: none !important;
}

.sp-doc-actions {
  grid-template-columns: minmax(0, 1fr) 38px !important;
}

.sp-doc-dl-icon-btn {
  padding: 0 !important;
  width: 38px !important;
}

.sp-doc-preview-modal-body {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 260px;
  padding: 12px;
  background: var(--bg);
  border-radius: var(--r-card, 10px);
  border: 1px solid var(--border);
  box-sizing: border-box;
  overflow: hidden;
  text-align: center;
}

.sp-doc-preview-modal-body img {
  max-width: 100%;
  max-height: 70vh;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  margin: auto;
  border-radius: 6px;
}

/* Native select styled cleanly to match live .lp-filter .ui-select-btn */
.ui-select-native {
  width: 100%;
  height: 42px;
  padding: 0 32px 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-ctrl, 8px);
  background-color: var(--surface);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B6B6B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  font: inherit;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  text-overflow: ellipsis;
  transition: border-color .15s, box-shadow .15s;
}

.ui-select-native:hover {
  border-color: color-mix(in srgb, var(--primary) 40%, var(--border));
}

.ui-select-native:focus {
  outline: 0;
  border-color: var(--primary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 14%, transparent);
}

/* Sidebar active link reset for archive <button> or <a href> nav items */
.sb-nav a[data-nav] {
  cursor: pointer;
}

/* Subtle interactive link button inside student/payment tables */
.av-row-link {
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  font: inherit;
  font-weight: 700;
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.av-row-link:hover {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* Topbar scope & status chips */
.arx-tb-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r, 6px);
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1;
  box-sizing: border-box;
  white-space: nowrap;
}

.arx-tb-chip svg.lucide {
  width: 15px;
  height: 15px;
  color: var(--text-sec);
  flex-shrink: 0;
}

/* Full-screen receipt container inside .view (removes padding so dark slate receipt stage matches live CMS edge-to-edge) */
.view.is-receipt-mode {
  padding: 0;
}

/* Full-screen unlock gate using CMS card/button tokens */
.arx-unlock-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--bg);
}

.arx-unlock-card {
  width: 100%;
  max-width: 470px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 16px 40px rgba(20, 22, 58, 0.10);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.arx-unlock-ic {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--primary-soft);
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.arx-unlock-ic svg.lucide {
  width: 24px;
  height: 24px;
}

.arx-unlock-card h1 {
  margin: 0;
  font-size: 21px;
  font-weight: 800;
  color: var(--text);
}

.arx-unlock-sub {
  margin: 0;
  font-size: 13.5px;
  color: var(--text-mute);
  line-height: 1.5;
}

.arx-unlock-meta {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--bg);
  font-size: 12.5px;
  color: var(--text-sec);
  line-height: 1.65;
}

.arx-unlock-meta b {
  color: var(--text);
}

.arx-pw-eye {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 30px;
  height: 30px;
  border: 0;
  background: transparent;
  color: var(--text-mute);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 6px;
}

.arx-pw-eye:hover {
  background: var(--bg);
  color: var(--text);
}

/* Override student hero action block on archive so icons wrap neatly */
@media (max-width: 768px) {
  .arx-tb-chip {
    display: inline-flex;
    height: 30px;
    padding: 0 9px;
    font-size: 11.5px;
    max-width: 150px;
  }
  .arx-tb-chip span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .arx-tb-scope-chip {
    display: none;
  }
}

/* Print stage & crisp @media print rules for offline PDF & paper printing */
#av-print-stage {
  display: none;
}

@media print {
  body.av-printing > *:not(#av-print-stage) {
    display: none !important;
  }
  body.av-printing #av-root,
  body.av-printing #av-modal-root,
  body.av-printing #av-toast-root,
  body.av-printing .ui-toast-stack,
  body.av-printing .sidebar,
  body.av-printing .topbar,
  body.av-printing .ar-toolbar,
  body.av-printing .mpr-toolbar {
    display: none !important;
  }
  body.av-printing #av-print-stage {
    display: block !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  body.av-printing {
    background: #ffffff !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  body:not(.av-printing) #av-toast-root,
  body:not(.av-printing) .ui-toast-stack,
  body:not(.av-printing) .sidebar,
  body:not(.av-printing) .topbar,
  body:not(.av-printing) .ar-toolbar,
  body:not(.av-printing) .mpr-toolbar {
    display: none !important;
  }
  body:not(.av-printing) .main,
  body:not(.av-printing) .view {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  .ar-page,
  .mpr-page {
    border: 0 !important;
    box-shadow: none !important;
    margin: 0 auto !important;
  }
  .ar-page {
    page-break-after: always !important;
    break-after: page !important;
  }
  .ar-page:last-child {
    page-break-after: auto !important;
    break-after: auto !important;
  }
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  @page {
    size: A4 portrait;
    margin: 0;
  }
}
`;
