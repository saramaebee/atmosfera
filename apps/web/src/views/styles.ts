// Embedded stylesheet — inlined into every page. Kept long-ish because we
// have no static asset pipeline (deliberate: no premature infra). When this
// grows past ~600 lines, move to a real CSS file + Hono static middleware.
export const STYLES = `
  :root {
    color-scheme: dark;

    --bg: #07090f;
    --bg-grad-from: rgba(99, 102, 241, 0.10);
    --bg-grad-to: transparent;

    --surface-1: #0f131c;
    --surface-2: #161b27;
    --surface-3: #1d2330;
    --surface-hover: #232a3a;

    --border: rgba(255, 255, 255, 0.06);
    --border-strong: rgba(255, 255, 255, 0.12);
    --border-accent: rgba(129, 140, 248, 0.35);

    --fg: #ebedf2;
    --fg-muted: #8d95a8;
    --fg-dim: #5b6378;

    --accent: #818cf8;
    --accent-strong: #6366f1;
    --accent-press: #4f46e5;
    --accent-glow: rgba(99, 102, 241, 0.45);

    --ok: #34d399;
    --ok-bg: rgba(52, 211, 153, 0.10);
    --ok-border: rgba(52, 211, 153, 0.28);

    --danger: #f87171;
    --danger-bg: rgba(248, 113, 113, 0.10);
    --danger-border: rgba(248, 113, 113, 0.28);

    --warn: #fbbf24;
    --warn-bg: rgba(251, 191, 36, 0.10);
    --warn-border: rgba(251, 191, 36, 0.28);

    --owner: #c084fc;
    --owner-bg: rgba(192, 132, 252, 0.12);
    --owner-border: rgba(192, 132, 252, 0.35);

    --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.4);
    --shadow-md: 0 4px 12px -2px rgba(0, 0, 0, 0.5);
    --shadow-lg: 0 16px 40px -8px rgba(0, 0, 0, 0.6);
    --shadow-accent: 0 0 0 1px rgba(99, 102, 241, 0.2), 0 8px 24px -8px var(--accent-glow);

    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 14px;
    --radius-xl: 20px;

    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text',
      system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --font-mono: ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo,
      Consolas, monospace;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
  }

  body {
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.55;
    font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11', 'ss01';
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
    min-height: 100vh;
    background-image:
      radial-gradient(1200px 600px at 15% -10%, var(--bg-grad-from), var(--bg-grad-to)),
      radial-gradient(900px 500px at 95% 5%, rgba(192, 132, 252, 0.06), transparent 70%);
    background-attachment: fixed;
  }

  a {
    color: var(--accent);
    text-decoration: none;
    transition: color 0.12s ease;
  }
  a:hover { color: #a5b4fc; }

  ::selection {
    background: var(--accent-strong);
    color: white;
  }

  /* ── Top bar ───────────────────────────────────────────────────────── */

  .topbar {
    position: sticky;
    top: 0;
    z-index: 50;
    backdrop-filter: blur(16px) saturate(140%);
    -webkit-backdrop-filter: blur(16px) saturate(140%);
    background: rgba(15, 19, 28, 0.72);
    border-bottom: 1px solid var(--border);
  }
  .topbar-inner {
    max-width: 1320px;
    margin: 0 auto;
    padding: 14px 28px;
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--fg);
    font-size: 15px;
  }
  .brand:hover { color: var(--fg); }
  .brand-mark {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: linear-gradient(135deg, #6366f1, #c084fc);
    box-shadow: 0 4px 10px -2px var(--accent-glow);
    display: grid;
    place-items: center;
    color: white;
  }
  .topbar-spacer { flex: 1; }

  .user-chip {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 5px 10px 5px 5px;
    border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--fg);
    font-size: 13px;
  }
  .user-chip img,
  .user-chip .avatar-fallback {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
  }
  .avatar-fallback {
    background: linear-gradient(135deg, var(--surface-3), var(--surface-2));
    display: inline-grid;
    place-items: center;
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-muted);
  }

  /* ── Layout ────────────────────────────────────────────────────────── */

  main {
    max-width: 1320px;
    margin: 0 auto;
    padding: 36px 28px 80px;
  }

  .layout-with-sidebar {
    display: grid;
    grid-template-columns: 232px 1fr;
    gap: 36px;
    align-items: start;
  }
  @media (max-width: 860px) {
    .layout-with-sidebar { grid-template-columns: 1fr; }
  }

  .sidebar {
    position: sticky;
    top: 80px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
  }
  .sidebar-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 10px 14px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 6px;
  }
  .sidebar-header .icon { width: 32px; height: 32px; }
  .sidebar-header .name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sidebar-section-label {
    padding: 12px 10px 4px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fg-dim);
  }
  .sidebar a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    color: var(--fg-muted);
    font-size: 13px;
    font-weight: 500;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .sidebar a:hover {
    background: var(--surface-2);
    color: var(--fg);
  }
  .sidebar a.active {
    background: linear-gradient(180deg, rgba(99, 102, 241, 0.18), rgba(99, 102, 241, 0.08));
    color: var(--fg);
    box-shadow: inset 0 0 0 1px var(--border-accent);
  }
  .sidebar a.active svg { color: var(--accent); }
  .sidebar svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--fg-dim);
  }

  /* ── Headings + text ───────────────────────────────────────────────── */

  h1 {
    font-size: 26px;
    line-height: 1.2;
    letter-spacing: -0.02em;
    font-weight: 600;
    margin: 0 0 8px;
  }
  h2 {
    font-size: 16px;
    line-height: 1.3;
    letter-spacing: -0.01em;
    font-weight: 600;
    margin: 0 0 12px;
  }
  h3 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-dim);
    margin: 0 0 12px;
  }
  p { margin: 0 0 12px; }
  p.lead {
    font-size: 15px;
    color: var(--fg-muted);
    margin-bottom: 24px;
    max-width: 720px;
  }
  .muted { color: var(--fg-muted); }
  .dim { color: var(--fg-dim); }
  code {
    font-family: var(--font-mono);
    font-size: 12.5px;
    background: var(--surface-2);
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }

  /* ── Page header ───────────────────────────────────────────────────── */

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 32px;
    flex-wrap: wrap;
  }
  .page-header .titles { min-width: 0; flex: 1; }

  /* ── Cards ─────────────────────────────────────────────────────────── */

  .card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 22px;
    margin-bottom: 20px;
    box-shadow: var(--shadow-sm);
  }
  .card-tight { padding: 16px; }
  .card h2:first-child,
  .card h3:first-child { margin-top: 0; }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }

  /* ── Guild grid + cards ────────────────────────────────────────────── */

  .guild-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
  }

  .guild-card {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: var(--fg);
    transition: transform 0.15s ease, background 0.15s ease,
                border-color 0.15s ease, box-shadow 0.15s ease;
    position: relative;
    overflow: hidden;
  }
  .guild-card::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), transparent 60%);
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
  }
  .guild-card:hover {
    background: var(--surface-2);
    border-color: var(--border-accent);
    transform: translateY(-1px);
    box-shadow: var(--shadow-accent);
    text-decoration: none;
  }
  .guild-card:hover::before { opacity: 1; }

  .guild-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: var(--surface-3);
    flex-shrink: 0;
    overflow: hidden;
    display: grid;
    place-items: center;
    font-weight: 600;
    color: var(--fg-muted);
    font-size: 17px;
    letter-spacing: -0.02em;
  }
  .guild-icon img { width: 100%; height: 100%; object-fit: cover; }
  .guild-icon-sm { width: 28px; height: 28px; border-radius: 8px; font-size: 12px; }
  .guild-icon-lg {
    width: 72px;
    height: 72px;
    border-radius: 16px;
    font-size: 26px;
    box-shadow: var(--shadow-md);
  }

  .guild-card .meta { flex: 1; min-width: 0; }
  .guild-card .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }
  .guild-card .sub {
    font-size: 12px;
    color: var(--fg-dim);
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* ── Badges ────────────────────────────────────────────────────────── */

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--fg-muted);
    border: 1px solid var(--border);
    letter-spacing: 0.02em;
  }
  .badge-owner { background: var(--owner-bg); color: var(--owner); border-color: var(--owner-border); }
  .badge-admin { background: rgba(129, 140, 248, 0.12); color: var(--accent); border-color: var(--border-accent); }
  .badge-member { background: var(--ok-bg); color: var(--ok); border-color: var(--ok-border); }
  .badge-allow { background: var(--ok-bg); color: var(--ok); border-color: var(--ok-border); }
  .badge-deny { background: var(--danger-bg); color: var(--danger); border-color: var(--danger-border); }

  /* ── Stats tiles ───────────────────────────────────────────────────── */

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin-bottom: 24px;
  }
  .stat-tile {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 16px;
    transition: border-color 0.15s ease;
  }
  .stat-tile:hover { border-color: var(--border-strong); }
  .stat-tile .label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fg-dim);
    margin-bottom: 8px;
  }
  .stat-tile .value {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: var(--fg);
    font-variant-numeric: tabular-nums;
  }
  .stat-tile.accent .value {
    background: linear-gradient(135deg, #818cf8, #c084fc);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  /* ── Tables ────────────────────────────────────────────────────────── */

  table.data {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13px;
  }
  table.data thead th {
    text-align: left;
    padding: 10px 12px;
    color: var(--fg-dim);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid var(--border);
  }
  table.data tbody td {
    padding: 11px 12px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  table.data tbody tr:last-child td { border-bottom: 0; }
  table.data tbody tr { transition: background 0.1s ease; }
  table.data tbody tr:hover { background: var(--surface-2); }
  table.data .mono, .mono { font-family: var(--font-mono); font-size: 12px; }

  /* ── Buttons + form controls ───────────────────────────────────────── */

  button, .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: var(--accent-strong);
    color: white;
    border: 1px solid transparent;
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.12s ease, transform 0.05s ease, box-shadow 0.12s ease;
    text-decoration: none;
    line-height: 1.4;
  }
  button:hover, .btn:hover {
    background: var(--accent-press);
    text-decoration: none;
    box-shadow: 0 4px 12px -4px var(--accent-glow);
  }
  button:active, .btn:active { transform: translateY(1px); }
  button:focus-visible, .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  button.secondary, .btn.secondary {
    background: var(--surface-2);
    color: var(--fg);
    border-color: var(--border);
  }
  button.secondary:hover, .btn.secondary:hover {
    background: var(--surface-hover);
    border-color: var(--border-strong);
    box-shadow: none;
  }
  button.ghost, .btn.ghost {
    background: transparent;
    color: var(--fg-muted);
    border-color: transparent;
  }
  button.ghost:hover, .btn.ghost:hover {
    background: var(--surface-2);
    color: var(--fg);
    box-shadow: none;
  }
  button.danger, .btn.danger {
    background: var(--danger);
    color: white;
  }
  button.danger:hover, .btn.danger:hover { background: #dc2626; }

  .btn-large {
    padding: 11px 22px;
    font-size: 14px;
    border-radius: var(--radius-md);
  }

  input[type="text"], input[type="search"], input[type="number"], select {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 8px 11px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-family: inherit;
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
    min-width: 0;
  }
  input::placeholder { color: var(--fg-dim); }
  input:focus, select:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
  }

  /* Custom select look — native arrow replaced */
  select {
    appearance: none;
    -webkit-appearance: none;
    padding-right: 32px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238d95a8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
  }

  .switcher select {
    background-color: var(--surface-2);
    min-width: 220px;
    font-weight: 500;
  }

  /* ── Utility classes ──────────────────────────────────────────────── */

  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .row-tight { display: flex; gap: 6px; align-items: center; }
  .stack { display: flex; flex-direction: column; gap: 10px; }
  .stack-lg { display: flex; flex-direction: column; gap: 20px; }
  .between { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  .nowrap { white-space: nowrap; }

  form.inline { display: inline-flex; align-items: center; }

  /* ── Toggle pills ──────────────────────────────────────────────────── */

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .pill::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 8px currentColor;
  }
  .pill.on { background: var(--ok-bg); color: var(--ok); }
  .pill.off { background: var(--surface-3); color: var(--fg-dim); }
  .pill.off::before { box-shadow: none; }

  /* ── Empty states ──────────────────────────────────────────────────── */

  .empty {
    padding: 56px 24px;
    text-align: center;
    color: var(--fg-muted);
    background: var(--surface-1);
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-lg);
  }
  .empty-icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: var(--surface-2);
    color: var(--fg-dim);
    display: inline-grid;
    place-items: center;
    margin-bottom: 14px;
  }
  .empty h3 {
    font-size: 14px;
    color: var(--fg);
    text-transform: none;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }
  .empty p { color: var(--fg-muted); margin: 0; font-size: 13px; }

  /* ── Hero guild header ─────────────────────────────────────────────── */

  .guild-hero {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 24px;
    background: linear-gradient(135deg, var(--surface-1), var(--surface-2));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    margin-bottom: 24px;
    position: relative;
    overflow: hidden;
  }
  .guild-hero::after {
    content: '';
    position: absolute;
    top: -50%;
    right: -10%;
    width: 400px;
    height: 200%;
    background: radial-gradient(closest-side, rgba(99, 102, 241, 0.12), transparent);
    pointer-events: none;
  }
  .guild-hero .meta { position: relative; z-index: 1; min-width: 0; flex: 1; }
  .guild-hero h1 { margin: 0; }
  .guild-hero .sub {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--fg-muted);
    font-size: 13px;
  }

  /* ── Pre / code blocks ─────────────────────────────────────────────── */

  pre {
    font-family: var(--font-mono);
    font-size: 11.5px;
    background: var(--surface-2);
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    color: var(--fg-muted);
    max-width: 480px;
    max-height: 200px;
    overflow: auto;
  }

  /* ── Login page ────────────────────────────────────────────────────── */

  .login {
    max-width: 480px;
    margin: 80px auto 40px;
    text-align: center;
  }
  .login-mark {
    width: 64px;
    height: 64px;
    margin: 0 auto 28px;
    border-radius: 18px;
    background: linear-gradient(135deg, #6366f1, #c084fc);
    box-shadow: 0 16px 48px -8px var(--accent-glow);
    display: grid;
    place-items: center;
    color: white;
  }
  .login h1 {
    font-size: 32px;
    letter-spacing: -0.025em;
    margin-bottom: 12px;
  }
  .login p.lead {
    margin: 0 auto 28px;
  }
  .login .btn-large {
    box-shadow: 0 8px 24px -8px var(--accent-glow);
  }
`;
