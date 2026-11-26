// Self-contained stylesheet for the offline ZIP archive viewer (zero CDN, zero external fonts, file:// safe).
export const ARCHIVE_VIEWER_CSS = `:root {
  --primary: #323A85;
  --primary-hover: #262D6E;
  --primary-soft: #EEF0FA;
  --bg: #F6F6F8;
  --surface: #FFFFFF;
  --border: #EAEAEA;
  --border-strong: #D4D4D4;
  --sidebar-bg: #14163A;
  --sidebar-text: #B3B8D6;
  --sidebar-hover: #1F2352;
  --text: #171717;
  --text-sec: #525252;
  --text-mute: #6B6B6B;
  --success: #16A34A;
  --success-soft: #F0FDF4;
  --warning: #D97706;
  --warning-soft: #FFFBEB;
  --danger: #DC2626;
  --danger-soft: #FEF2F2;
  --info: #2563EB;
  --info-soft: #EFF6FF;
  --violet: #7C3AED;
  --violet-soft: #F3E8FF;
  --r-sm: 4px;
  --r: 6px;
  --r-lg: 8px;
  --r-card: 10px;
  --r-ctrl: 8px;
  --font-main: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  --navy: #333B84;
  --deep: #291670;
  --line: #B9BFDC;
  --ink: #1D1A3A;
  --muted: #5B5F85;
  --tint: #ECEEFA;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; font-family: var(--font-main); font-size: 14px; color: var(--text); background: var(--bg); min-height: 100%; }
button, input, select { font: inherit; }
svg.lucide { width: 16px; height: 16px; flex-shrink: 0; vertical-align: middle; }

/* Unlock gate */
.av-unlock-screen { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; background: var(--bg); }
.av-unlock-card { width: 100%; max-width: 440px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 28px; box-shadow: 0 10px 32px rgba(16, 24, 40, .08); display: flex; flex-direction: column; gap: 14px; }
.av-unlock-ic { width: 48px; height: 48px; border-radius: 12px; background: var(--primary-soft); color: var(--primary); display: flex; align-items: center; justify-content: center; }
.av-unlock-ic svg.lucide { width: 22px; height: 22px; }
.av-unlock-card h1 { margin: 0; font-size: 20px; font-weight: 800; color: var(--text); }
.av-unlock-sub { margin: 0; font-size: 13.5px; color: var(--text-sec); line-height: 1.5; }
.av-unlock-meta { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; color: var(--text-sec); display: flex; flex-direction: column; gap: 3px; }
.av-field { display: flex; flex-direction: column; gap: 6px; }
.av-field label { font-size: 12.5px; font-weight: 700; color: var(--text); }
.av-pw-row { position: relative; display: flex; align-items: center; }
.av-input { width: 100%; height: 42px; padding: 0 40px 0 12px; border: 1px solid var(--border-strong); border-radius: var(--r-ctrl); background: var(--surface); color: var(--text); }
.av-input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary) 14%, transparent); }
.av-eye { position: absolute; right: 8px; background: none; border: 0; cursor: pointer; color: var(--text-mute); padding: 6px; display: inline-flex; }
.av-err { padding: 9px 12px; border-radius: 8px; background: var(--danger-soft); color: var(--danger); border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border)); font-size: 13px; }
.av-warn { padding: 9px 12px; border-radius: 8px; background: var(--warning-soft); color: #78350F; border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border)); font-size: 12.5px; line-height: 1.45; display: flex; align-items: flex-start; gap: 8px; }

/* App shell */
.av-shell { display: flex; min-height: 100vh; }
.av-sidebar { width: 256px; flex-shrink: 0; background: var(--sidebar-bg); color: var(--sidebar-text); display: flex; flex-direction: column; padding: 14px 12px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
.av-brand { display: flex; align-items: center; gap: 11px; padding: 8px 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 12px; }
.av-brand-logo { width: 40px; height: 40px; border-radius: 10px; background: #fff; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-weight: 800; color: var(--primary); }
.av-brand-logo img { width: 100%; height: 100%; object-fit: contain; }
.av-brand-t { display: flex; flex-direction: column; min-width: 0; }
.av-brand-t b { color: #fff; font-size: 14.5px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.av-brand-t span { font-size: 11.5px; color: var(--sidebar-text); opacity: .85; }
.av-nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
.av-nav-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--sidebar-text); text-align: left; cursor: pointer; font-weight: 600; font-size: 13.5px; transition: background .15s, color .15s; }
.av-nav-btn:hover { background: var(--sidebar-hover); color: #fff; }
.av-nav-btn.is-active { background: var(--primary); color: #fff; }
.av-sb-foot { padding: 12px 10px 4px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 11.5px; color: var(--sidebar-text); opacity: .85; line-height: 1.45; }

.av-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.av-banner { background: #1E2563; color: #FFFFFF; padding: 8px 18px; font-size: 12.5px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; border-bottom: 1px solid rgba(255,255,255,0.14); }
.av-banner-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.av-banner-tag { background: rgba(255,255,255,0.16); padding: 2px 8px; border-radius: 999px; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; font-weight: 800; }
.av-topbar { height: 58px; background: var(--surface); border-bottom: 1px solid var(--border); padding: 0 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; position: sticky; top: 0; z-index: 20; }
.av-topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.av-topbar-title { margin: 0; font-size: 17px; font-weight: 800; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.av-menu-btn { display: none; width: 38px; height: 38px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); align-items: center; justify-content: center; cursor: pointer; }
.av-view { padding: 20px; max-width: 1400px; width: 100%; margin: 0 auto; }

/* Buttons & Badges */
.ui-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 38px; padding: 0 14px; border-radius: var(--r-ctrl); font-weight: 600; font-size: 13.5px; cursor: pointer; border: 1px solid transparent; background: var(--surface); color: var(--text); transition: background .15s, border-color .15s; text-decoration: none; white-space: nowrap; }
.ui-btn.primary { background: var(--primary); color: #fff; }
.ui-btn.primary:hover { background: var(--primary-hover); }
.ui-btn.ghost { background: var(--surface); border-color: var(--border); color: var(--text); }
.ui-btn.ghost:hover { background: var(--bg); border-color: var(--border-strong); }
.ui-btn.sm { height: 32px; padding: 0 10px; font-size: 12.5px; }
.ui-btn:disabled { opacity: .5; cursor: not-allowed; }
.ui-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }

.pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.pill.paid { background: var(--success-soft); color: var(--success); }
.pill.overdue { background: var(--danger-soft); color: var(--danger); }
.pill.due, .pill.warning { background: var(--warning-soft); color: var(--warning); }
.pill.sky { background: var(--info-soft); color: var(--info); }
.pill.neutral { background: var(--primary-soft); color: var(--primary); }
.pill.waived, .pill.purple { background: var(--violet-soft); color: var(--violet); }
.pill.muted { background: var(--bg); color: var(--text-mute); border: 1px solid var(--border); }

/* Stat Cards, Toolbar & Tables */
.pg-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.pg-head h2 { margin: 0; font-size: 21px; font-weight: 800; }
.pg-head p { margin: 3px 0 0; font-size: 13px; color: var(--text-mute); }
.lp-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }
.lp-stats.cols-5 { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.lp-stat { --t: var(--primary); display: flex; align-items: center; gap: 13px; padding: 15px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-card); }
.lp-stat.indigo { --t: #3730A3; } .lp-stat.green { --t: #15803D; } .lp-stat.amber { --t: #B45309; } .lp-stat.red { --t: #B91C1C; } .lp-stat.sky { --t: #0369A1; } .lp-stat.violet { --t: #6D28D9; }
.lp-stat-ic { width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: color-mix(in srgb, var(--t) 10%, #fff); color: var(--t); }
.lp-stat-ic svg.lucide { width: 20px; height: 20px; }
.lp-stat-txt { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.lp-stat-label { font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--t); }
.lp-stat-value { font-size: 21px; font-weight: 800; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.lp-stat-sub { font-size: 12px; color: var(--text-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.lp-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; padding: 14px 16px; margin-bottom: 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-card); }
.lp-search { flex: 2 1 230px; position: relative; min-width: 180px; }
.lp-search svg.lucide { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-mute); pointer-events: none; }
.lp-search input { width: 100%; height: 40px; padding: 0 12px 0 36px; border: 1px solid var(--border); border-radius: var(--r-ctrl); background: var(--surface); }
.lp-filter { display: flex; flex-direction: column; gap: 4px; flex: 1 1 140px; min-width: 130px; }
.lp-filter label { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--text-mute); }
.lp-select { height: 40px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--r-ctrl); background: var(--surface); color: var(--text); }
.bb-pair { display: flex; gap: 8px; flex: 2 1 280px; padding: 0; margin: 0; border: 0; background: transparent; }

.lp-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-card); overflow: hidden; margin-bottom: 16px; }
.lp-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 18px; border-bottom: 1px solid var(--border); }
.lp-card-title { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 800; }
.lp-count { font-size: 12px; font-weight: 800; color: var(--primary); background: var(--primary-soft); padding: 2px 10px; border-radius: 999px; }
.lp-scroll { overflow-x: auto; }
.lp-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.lp-table th { text-align: left; font-size: 11.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--primary); background: color-mix(in srgb, var(--primary-soft) 60%, var(--surface)); padding: 11px 16px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.lp-table td { padding: 12px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.lp-table tbody tr:last-child td { border-bottom: 0; }
.lp-table tbody tr:hover td { background: #F8F9FE; }
.lp-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.lp-table .act { text-align: right; white-space: nowrap; }
.lp-sub { display: block; font-size: 12px; color: var(--text-mute); margin-top: 2px; }
.lp-card-foot { padding: 11px 16px; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--text-mute); }
.adm-pager { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.av-link-btn { background: none; border: 0; padding: 0; font-weight: 700; color: var(--primary); cursor: pointer; text-align: left; }
.av-link-btn:hover { text-decoration: underline; }

/* Student cells & avatars */
.av-st-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.av-avatar { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border); background: var(--primary-soft); flex-shrink: 0; }
.av-avatar-fb { width: 34px; height: 34px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); font-weight: 800; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }

/* Profile hero + docs + ledger */
.sp-hero { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
.sp-hero-left { display: flex; align-items: center; gap: 18px; min-width: 0; flex: 1; }
.sp-avatar-lg { width: 96px; height: 96px; border-radius: 14px; background: var(--primary-soft); color: var(--primary); font-size: 28px; font-weight: 800; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--border); flex-shrink: 0; }
.sp-avatar-lg img { width: 100%; height: 100%; object-fit: cover; }
.sp-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 16px 18px; }
.sp-kv span { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-mute); font-weight: 700; }
.sp-kv strong { display: block; font-size: 14px; color: var(--text); margin-top: 2px; word-break: break-word; }
.sp-docs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; padding: 16px 18px; }
.sp-doc-card { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); cursor: pointer; }
.sp-doc-img-box { height: 150px; background: #F1F4FA; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.sp-doc-img-box img { width: 100%; height: 100%; object-fit: cover; }
.sp-doc-meta { padding: 10px 12px; }

/* Modal */
.ui-modal-back { position: fixed; inset: 0; z-index: 9999; background: rgba(16, 24, 40, .5); display: flex; align-items: center; justify-content: center; padding: 16px; }
.ui-modal { width: 100%; max-width: 720px; max-height: calc(100vh - 32px); background: var(--surface); border-radius: 12px; border: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 60px rgba(16,24,40,.25); }
.ui-modal.wide { max-width: 880px; }
.adm-view-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.adm-view-body { padding: 18px; overflow-y: auto; flex: 1; }
.adm-view-foot { padding: 12px 18px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.av-det-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
.av-det-box { border: 1px solid var(--border); border-radius: 8px; padding: 12px; background: var(--bg); }
.av-det-box h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--primary); }
.av-det-row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px; border-bottom: 1px dashed var(--border); }
.av-det-row:last-child { border-bottom: 0; }

/* Offline Receipt Sheets (Admission 2-page & Monthly Payment) */
.rcpt-stage { background: #E4E6F0; padding: 18px 10px; overflow: auto; }
.ar-page, .mpr-page { width: 794px; min-height: 1040px; margin: 0 auto 20px; background: #fff; border: 1px solid var(--line); padding: 28px 42px; color: var(--ink); font-size: 12.5px; position: relative; }
.ar-page .hd, .mpr-hd { display: flex; align-items: center; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid var(--navy); position: relative; margin-bottom: 6px; }
.ar-page .logo, .mpr-logo { width: 64px; height: 64px; flex: none; display: grid; place-items: center; background: var(--navy); color: #fff; font-weight: 800; font-size: 24px; }
.ar-page .logo.img, .mpr-logo.img { background: none; }
.ar-page .logo img, .mpr-logo img { width: 100%; height: 100%; object-fit: contain; }
.ar-page .hd h1, .mpr-hd h1 { margin: 0 0 2px; font-size: 26px; font-weight: 800; color: var(--deep); }
.ar-page .iso, .mpr-iso { font-size: 12.5px; font-weight: 600; color: var(--navy); }
.ar-page .br, .mpr-br { font-size: 12px; font-weight: 600; color: #2B2850; }
.ar-page .ct, .mpr-ct { font-size: 11px; color: #2B2850; line-height: 1.5; }
.ar-page .title, .mpr-title { text-align: center; margin: 18px 0 3px; font-size: 17px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--navy); }
.ar-page .rno, .mpr-rno { text-align: center; font-size: 12px; color: var(--muted); margin-bottom: 12px; }
table.d, table.mpr-d { width: 100%; border-collapse: collapse; border: 1px solid var(--line); }
table.d th, table.mpr-d th { width: 150px; text-align: left; font-weight: 600; color: var(--muted); background: var(--tint); padding: 5px 9px; border-bottom: 1px solid var(--line); }
table.d td, table.mpr-d td { padding: 5px 9px; border-bottom: 1px solid var(--line); font-weight: 500; }
table.d td.pc, table.mpr-d td.mpr-pc { width: 132px; text-align: center; vertical-align: middle; border-left: 1px solid var(--line); background: #fff; padding: 6px; }
.ar-page .photo, .mpr-photo { width: 96px; height: 114px; margin: 0 auto; border: 1px solid var(--line); display: grid; place-items: center; overflow: hidden; background: #F8FAFC; }
.ar-page .photo img, .mpr-photo img { width: 100%; height: 100%; object-fit: cover; }
.ar-page .sig { width: 116px; height: 42px; margin: 0 auto 4px; border: 1px solid var(--line); display: grid; place-items: center; overflow: hidden; background: #fff; }
.ar-page .sig img { max-width: 100%; max-height: 100%; object-fit: contain; }
.ar-page .cap { font-size: 10.5px; color: var(--muted); }
.ar-page .sec, .mpr-sec { margin-top: 16px; }
.ar-page .sec h4, .mpr-sec h4 { margin: 0 0 8px; font-size: 14px; color: var(--navy); border-bottom: 2px solid var(--navy); padding-bottom: 3px; display: flex; justify-content: space-between; }
.ar-page .mods { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px 14px; }
.ar-page .mods > div { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.ar-page .mods i { font-style: normal; width: 18px; height: 18px; border-radius: 50%; background: var(--tint); color: var(--navy); font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; }
table.fe, table.mpr-fe { width: 100%; border-collapse: collapse; border: 1px solid var(--line); }
table.fe th, table.mpr-fe th { background: var(--tint); color: var(--navy); text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); }
table.fe td, table.mpr-fe td { padding: 6px 10px; border-bottom: 1px solid var(--line); }
table.fe th:last-child, table.fe td:last-child, table.mpr-fe th:last-child, table.mpr-fe td:last-child { text-align: right; }
table.fe tfoot td { font-weight: 800; background: var(--tint); }
.mpr-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; border: 1px solid var(--line); padding: 8px 10px; margin-bottom: 10px; background: #FAFBFD; }
.mpr-meta em { display: block; font-style: normal; font-size: 10.5px; color: var(--muted); text-transform: uppercase; }
.pbox, .mpr-pbox { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
.pcell, .mpr-pcell { border: 1px solid var(--line); background: var(--tint); padding: 9px 12px; }
.pcell em, .mpr-pcell em { display: block; font-style: normal; font-size: 11px; color: var(--muted); }
.pcell b, .mpr-pcell b { display: block; font-size: 17px; color: var(--deep); margin: 2px 0; }
.pcell .w, .mpr-pcell .w { font-size: 11px; color: var(--muted); }
.imp, .mpr-imp { margin-top: 10px; padding: 8px 10px; border: 1px solid var(--line); background: #FAFBFD; font-size: 11.5px; }
.terms, .mpr-terms { padding-left: 18px; margin: 6px 0 0; font-size: 11.5px; line-height: 1.5; }
.sigs, .mpr-sigs { display: flex; justify-content: space-between; margin-top: 38px; padding-top: 6px; font-size: 12px; font-weight: 600; }
.sigs > div, .mpr-sigs > div { border-top: 1px solid var(--muted); padding-top: 4px; min-width: 150px; text-align: center; }
.ft, .mpr-ft { display: flex; justify-content: space-between; margin-top: 18px; padding-top: 6px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); }
.ar-page .mini { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 2px solid var(--navy); margin-bottom: 12px; }
.ar-page .mini .l { display: flex; align-items: center; gap: 10px; }
.ar-page .mini img { width: 34px; height: 34px; object-fit: contain; }

/* Responsive <= 900px */
.av-sb-backdrop { display: none; position: fixed; inset: 0; background: rgba(16, 24, 40, .45); z-index: 35; }
@media (max-width: 1120px) {
  .lp-stats, .lp-stats.cols-5 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 900px) {
  .av-sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 40; transform: translateX(-100%); transition: transform .2s ease; }
  body.sb-open .av-sidebar { transform: translateX(0); }
  body.sb-open .av-sb-backdrop { display: block; }
  .av-menu-btn { display: inline-flex; }
  .av-view { padding: 14px; }
  .sp-grid, .av-det-grid { grid-template-columns: 1fr; }
  .lp-table.av-mobile-cards thead { display: none; }
  .lp-table.av-mobile-cards, .lp-table.av-mobile-cards tbody, .lp-table.av-mobile-cards tr, .lp-table.av-mobile-cards td { display: block; width: 100%; }
  .lp-table.av-mobile-cards tr { border-bottom: 6px solid var(--bg); padding: 6px 0; }
  .lp-table.av-mobile-cards td { display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: right; padding: 8px 14px; border-bottom: 1px solid var(--border); }
  .lp-table.av-mobile-cards td::before { content: attr(data-label); font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-mute); text-align: left; }
  .rcpt-stage { padding: 8px 0; }
  .ar-page, .mpr-page { width: 100%; min-height: auto; padding: 16px; }
}
@media (max-width: 560px) {
  .lp-stats, .lp-stats.cols-5 { grid-template-columns: 1fr; }
}
@media print {
  .av-sidebar, .av-topbar, .av-banner, .adm-view-head, .adm-view-foot, .no-print { display: none !important; }
  .ui-modal-back { position: static; background: none; padding: 0; }
  .ui-modal { max-width: none; max-height: none; border: 0; box-shadow: none; }
  .adm-view-body, .rcpt-stage { padding: 0; overflow: visible; background: #fff; }
  .ar-page, .mpr-page { border: 0; margin: 0; box-shadow: none; page-break-after: always; }
}
`;
