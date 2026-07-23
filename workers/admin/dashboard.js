// Admin dashboard HTML — served from the admin worker at GET /
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DataDrop Admin</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28' fill='none'%3E%3Crect width='28' height='28' rx='7' fill='%235B5EF4'/%3E%3Cpath d='M11 4h6v10h4l-7 8-7-8h4z' fill='white'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07070D;--bg2:#0F0F1A;--bg3:#11111E;--bg4:#161625;--bg5:#1A1A2E;
  --border:#1E1E32;--border2:#252540;
  --indigo:#5B5EF4;--cyan:#00D4FF;--green:#00C27C;--red:#E24B4A;--orange:#F59E0B;--purple:#a78bfa;
  --textP:#EEEEF8;--textS:#8888AA;--textT:#55556A;
  --mono:'JetBrains Mono',monospace;
}
body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--textP);min-height:100vh;-webkit-font-smoothing:antialiased}

/* Login */
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-card{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:40px;width:360px;box-shadow:0 24px 64px rgba(0,0,0,.5)}
.login-logo{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.login-sub{color:var(--textS);font-size:13px;margin-bottom:28px}
.login-card input{width:100%;padding:10px 14px;background:var(--bg4);border:1px solid var(--border);border-radius:10px;color:var(--textP);font-size:14px;margin-bottom:12px;outline:none;font-family:inherit}
.login-card input:focus{border-color:var(--indigo)}
.btn-login{width:100%;padding:11px;background:var(--indigo);color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;font-weight:600;font-family:inherit;transition:background .15s}
.btn-login:hover{background:#4A4DDE}
.login-err{color:var(--red);font-size:12px;margin-top:8px;min-height:18px}

/* Layout */
.layout{display:flex;min-height:100vh}
.sidebar{width:220px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;position:fixed;top:0;bottom:0;left:0;z-index:10}
.sidebar-logo{padding:18px 14px 18px;display:flex;align-items:center;gap:9px;border-bottom:1px solid var(--border)}
.wm{font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700;letter-spacing:-.02em}
.wm .d{color:var(--textP)}.wm .dp{color:var(--cyan)}
.admin-badge{font-size:10px;font-weight:600;background:rgba(91,94,244,.15);color:var(--indigo);border:1px solid rgba(91,94,244,.25);border-radius:99px;padding:2px 7px}
.sidebar-nav{flex:1;padding:6px;overflow-y:auto;display:flex;flex-direction:column;gap:1px}
.nav-section{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--textT);padding:8px 10px 4px}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;font-size:13px;cursor:pointer;transition:color .15s,background .15s;border-radius:7px;color:var(--textS);border:1px solid transparent;white-space:nowrap}
.nav-item:hover{background:rgba(26,26,46,.6);color:var(--textP)}
.nav-item.active{background:var(--bg5);color:var(--textP);border-color:var(--border);font-weight:600}
.nav-icon{width:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sidebar-footer{padding:10px 14px;border-top:1px solid var(--border)}
.logout-btn{width:100%;padding:8px;background:none;border:1px solid var(--border);color:var(--textS);border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit;transition:.15s}
.logout-btn:hover{border-color:var(--red);color:var(--red)}
.main{flex:1;margin-left:220px;padding:26px 28px;overflow:auto;max-width:100%;min-height:100vh}

/* Page titles */
.page-title{font-size:18px;font-weight:700;color:var(--textP);margin-bottom:4px;font-family:'Space Grotesk',sans-serif}
.page-sub{font-size:12px;color:var(--textT);margin-bottom:20px}

/* Stat grid & cards */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:20px}
.stat-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
.stat-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}
@media(max-width:900px){.stat-grid-4{grid-template-columns:repeat(2,1fr)}.stat-grid-3{grid-template-columns:repeat(2,1fr)}}
.stat-card{background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:16px}
.stat-card.accent-green{border-color:rgba(0,194,124,.2)}
.stat-card.accent-red{border-color:rgba(226,75,74,.2)}
.stat-card.accent-yellow{border-color:rgba(245,158,11,.2)}
.stat-label{font-size:10px;color:var(--textT);text-transform:uppercase;letter-spacing:.6px;margin-bottom:7px;font-weight:700}
.stat-value{font-size:22px;font-weight:700;color:var(--textP);font-family:var(--mono);line-height:1.1}
.stat-sub{font-size:11px;color:var(--textS);margin-top:4px}
.stat-sub.up{color:var(--green)}.stat-sub.down{color:var(--red)}.stat-sub.warn{color:var(--orange)}

/* Section containers */
.section{background:var(--bg3);border:1px solid var(--border);border-radius:12px;margin-bottom:16px;overflow:hidden}
.section-head{padding:13px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px}
.section-title{font-size:13px;font-weight:600;color:var(--textP)}
.section-sub{font-size:11px;color:var(--textT)}
.section-body{padding:16px}

/* Tables */
.table-wrap{background:var(--bg3);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px}
.table-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.table-title{font-size:13px;font-weight:600;color:var(--textP);flex:1;min-width:100px}
.search-input{padding:7px 11px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;background:var(--bg4);color:var(--textP);min-width:180px;font-family:inherit}
.search-input:focus{border-color:var(--indigo)}
.filter-select{padding:7px 9px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;background:var(--bg4);color:var(--textP);font-family:inherit}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:var(--bg4);padding:8px 14px;text-align:left;font-size:9px;color:var(--textT);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);white-space:nowrap;font-weight:700}
td{padding:10px 14px;border-bottom:1px solid var(--border);color:var(--textP);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(26,26,46,.4)}

/* Badges */
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:600}
.badge-green {background:rgba(0,194,124,.12);color:var(--green);border:1px solid rgba(0,194,124,.25)}
.badge-blue  {background:rgba(91,94,244,.12);color:var(--indigo);border:1px solid rgba(91,94,244,.25)}
.badge-yellow{background:rgba(245,158,11,.12);color:var(--orange);border:1px solid rgba(245,158,11,.25)}
.badge-red   {background:rgba(226,75,74,.12);color:var(--red);border:1px solid rgba(226,75,74,.25)}
.badge-gray  {background:rgba(136,136,170,.1);color:var(--textS);border:1px solid var(--border)}
.badge-purple{background:rgba(167,139,250,.1);color:var(--purple);border:1px solid rgba(167,139,250,.25)}

/* Buttons */
.btn{padding:6px 13px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:600;transition:.15s;display:inline-flex;align-items:center;gap:5px;font-family:inherit}
.btn-primary{background:var(--indigo);color:#fff}.btn-primary:hover{background:#4A4DDE}
.btn-danger{background:rgba(226,75,74,.12);color:var(--red);border:1px solid rgba(226,75,74,.25)}.btn-danger:hover{background:rgba(226,75,74,.2)}
.btn-success{background:rgba(0,194,124,.12);color:var(--green);border:1px solid rgba(0,194,124,.25)}.btn-success:hover{background:rgba(0,194,124,.2)}
.btn-ghost{background:var(--bg4);color:var(--textS);border:1px solid var(--border)}.btn-ghost:hover{color:var(--textP);border-color:var(--border2)}
.btn-sm{padding:4px 9px;font-size:11px;border-radius:6px}
.btn-group{display:flex;gap:6px;flex-wrap:wrap}

/* Pagination */
.pagination{display:flex;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--border)}
.page-btn{padding:4px 11px;border:1px solid var(--border);border-radius:7px;background:var(--bg4);color:var(--textS);cursor:pointer;font-size:12px;font-family:inherit;transition:.15s}
.page-btn:hover:not(:disabled){color:var(--textP);border-color:var(--border2)}
.page-btn:disabled{opacity:.35;cursor:not-allowed}
.page-info{font-size:12px;color:var(--textS);flex:1;text-align:center}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(7,7,13,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:580px;max-width:100%;max-height:88vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,.6)}
.modal-head{padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);z-index:1}
.modal-head h2{font-size:14px;font-weight:700;color:var(--textP)}
.modal-close{background:var(--bg4);border:1px solid var(--border);border-radius:7px;width:28px;height:28px;font-size:16px;cursor:pointer;color:var(--textS);display:flex;align-items:center;justify-content:center;font-family:inherit}
.modal-close:hover{color:var(--textP)}
.modal-body{padding:18px 20px}
.modal-footer{padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;background:var(--bg2)}

/* Field rows */
.field-row{display:flex;margin-bottom:10px;font-size:12px;align-items:flex-start;padding-bottom:10px;border-bottom:1px solid var(--border)}
.field-row:last-of-type{border-bottom:none;margin-bottom:0;padding-bottom:0}
.field-label{width:140px;color:var(--textS);flex-shrink:0;padding-top:1px}
.field-value{color:var(--textP);word-break:break-all}

/* Config */
.config-input{padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;width:100%;outline:none;font-family:var(--mono);background:var(--bg4);color:var(--textP)}
.config-input:focus{border-color:var(--indigo)}

/* Alerts */
.alert{padding:10px 14px;border-radius:9px;font-size:12px;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.alert-red{background:rgba(226,75,74,.1);color:var(--red);border:1px solid rgba(226,75,74,.25)}
.alert-yellow{background:rgba(245,158,11,.1);color:var(--orange);border:1px solid rgba(245,158,11,.25)}
.alert-green{background:rgba(0,194,124,.1);color:var(--green);border:1px solid rgba(0,194,124,.25)}

/* Health indicator dots */
.health-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.health-ok{background:var(--green)}.health-warn{background:var(--orange)}.health-err{background:var(--red)}

/* Two-column grid */
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
@media(max-width:800px){.two-col{grid-template-columns:1fr}}

/* Progress bar */
.prog-bar{height:6px;border-radius:3px;background:var(--bg4);overflow:hidden;margin-top:5px}
.prog-fill{height:100%;border-radius:3px;transition:width .4s ease}

/* Cost row */
.cost-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border);font-size:12px}
.cost-row:last-child{border-bottom:none}
.cost-label{flex:1;color:var(--textS)}
.cost-usd{font-family:var(--mono);color:var(--textP);min-width:60px;text-align:right}
.cost-inr{font-family:var(--mono);color:var(--textT);min-width:60px;text-align:right;font-size:11px}

/* Misc */
.mono{font-family:var(--mono);font-size:12px}
.empty{text-align:center;padding:40px;color:var(--textT);font-size:13px}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--indigo);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle}
.loading-center{display:flex;justify-content:center;padding:56px}
@keyframes spin{to{transform:rotate(360deg)}}
.profit{color:var(--green);font-weight:600}.loss{color:var(--red);font-weight:600}
a.plain{color:inherit;text-decoration:none}a.plain:hover{color:var(--indigo)}
.vault-tag{font-size:9px;font-weight:600;background:rgba(91,94,244,.12);color:var(--indigo);border:1px solid rgba(91,94,244,.25);border-radius:99px;padding:1px 5px;margin-right:4px}
.divider{border:none;border-top:1px solid var(--border);margin:14px 0}
.tag{display:inline-block;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:var(--bg4);color:var(--textT);font-family:var(--mono)}
.inline-btn{background:none;border:none;color:var(--indigo);cursor:pointer;font-size:11px;font-family:inherit;padding:0;font-weight:600}
.inline-btn:hover{text-decoration:underline}
</style>
</head>
<body>
<div id="app"></div>
<div id="modal-root"></div>
<div id="toast-root" style="position:fixed;bottom:20px;right:20px;z-index:300;display:flex;flex-direction:column;gap:8px;align-items:flex-end"></div>

<script>
// ── Icons ───────────────────────────────────────────────────
const I = {
  drop:     '<svg width="26" height="26" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="7" fill="#5B5EF4"/><path d="M11 4h6v10h4l-7 8-7-8h4z" fill="white"/></svg>',
  overview: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/></svg>',
  infra:    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="4" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="9" width="14" height="3" rx="1" stroke="currentColor" stroke-width="1.3"/><circle cx="3.5" cy="5.5" r="0.7" fill="currentColor"/><circle cx="3.5" cy="10.5" r="0.7" fill="currentColor"/></svg>',
  storage:  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><ellipse cx="8" cy="4" rx="6" ry="2.2" stroke="currentColor" stroke-width="1.3"/><path d="M2 4v4c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V4" stroke="currentColor" stroke-width="1.3"/><path d="M2 8v4c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V8" stroke="currentColor" stroke-width="1.3"/></svg>',
  revenue:  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><polyline points="1,12 5,7 8,9 12,3 15,5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  users:    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.3" stroke="currentColor" stroke-width="1.3"/><path d="M1 14c0-3 2-4.7 5-4.7m9 4.7c0-3-2-4.7-5-4.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="11" cy="5" r="2.3" stroke="currentColor" stroke-width="1.3"/></svg>',
  reports:  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 2h10v9l-5 3-5-3V2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 5v3M8 9.5h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  config:   '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.64 3.64l1.06 1.06M11.3 11.3l1.06 1.06M3.64 12.36l1.06-1.06M11.3 4.7l1.06-1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  health:   '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8h1.2l1-2 1.5 4 1-2H11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// ── State ──────────────────────────────────────────────────
let session = localStorage.getItem('dd_admin_session') || null;
let tab = 'overview';
let userPage = 1, userQ = '', userSt = '';
let repStatus = 'open';

// ── API ────────────────────────────────────────────────────
async function api(method, path, body) {
  const h = { 'Content-Type': 'application/json' };
  if (session) h['X-Admin-Session'] = session;
  const r = await fetch('/admin' + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (r.status === 401) { signOut(); return null; }
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Request failed (' + r.status + ')'); }
  return r.json();
}

// ── Boot ───────────────────────────────────────────────────
function boot() {
  if (!session) { renderLogin(); return; }
  renderLayout(); goTab(tab);
}

// ── Login ──────────────────────────────────────────────────
function renderLogin() {
  document.getElementById('app').innerHTML = \`
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">\${I.drop}<div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700;letter-spacing:-.02em"><span style="color:var(--textP)">Data</span><span style="color:var(--cyan)">Drop</span></div><span class="admin-badge">Admin</span></div>
        <div class="login-sub">Restricted access — authorised personnel only</div>
        <form id="lf">
          <input type="text" id="lid" placeholder="Admin username" autocomplete="username" autofocus />
          <input type="password" id="lpw" placeholder="Admin password" autocomplete="current-password" />
          <button type="submit" class="btn-login" id="lbtn">Sign in</button>
        </form>
        <div class="login-err" id="lerr"></div>
      </div>
    </div>\`;
  document.getElementById('lf').onsubmit = async e => {
    e.preventDefault();
    const lerr = document.getElementById('lerr'), lbtn = document.getElementById('lbtn');
    lerr.textContent = ''; lbtn.textContent = 'Signing in…'; lbtn.disabled = true;
    try {
      const r = await fetch('/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('lid').value.trim(), password: document.getElementById('lpw').value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { lerr.textContent = d.error || 'Invalid credentials'; lbtn.textContent = 'Sign in'; lbtn.disabled = false; return; }
      session = d.token; localStorage.setItem('dd_admin_session', session); renderLayout(); goTab('overview');
    } catch(err) { lerr.textContent = err.message; lbtn.textContent = 'Sign in'; lbtn.disabled = false; }
  };
}

function signOut() {
  session = null; localStorage.removeItem('dd_admin_session');
  document.getElementById('app').innerHTML = ''; renderLogin();
}

// ── Layout ─────────────────────────────────────────────────
const TABS = [
  { section: 'Dashboard' },
  { id: 'overview', icon: 'overview', label: 'Overview' },
  { id: 'health',   icon: 'health',   label: 'Health' },
  { section: 'Infrastructure' },
  { id: 'infra',   icon: 'infra',   label: 'Infrastructure' },
  { id: 'storage', icon: 'storage', label: 'Storage' },
  { section: 'Business' },
  { id: 'revenue', icon: 'revenue', label: 'Revenue' },
  { id: 'users',   icon: 'users',   label: 'Users' },
  { id: 'reports', icon: 'reports', label: 'Reports' },
  { section: 'System' },
  { id: 'config',  icon: 'config',  label: 'Config' },
];

function renderLayout() {
  document.getElementById('app').innerHTML = \`
    <div class="layout">
      <div class="sidebar">
        <div class="sidebar-logo">\${I.drop}<div class="wm"><span class="d">Data</span><span class="dp">Drop</span></div><span class="admin-badge">Admin</span></div>
        <div class="sidebar-nav" id="snav"></div>
        <div class="sidebar-footer"><button class="logout-btn" onclick="signOut()">Sign out</button></div>
      </div>
      <div class="main" id="main"></div>
    </div>\`;
  renderSidebar();
}

function renderSidebar() {
  document.getElementById('snav').innerHTML = TABS.map(t => {
    if (t.section) return \`<div class="nav-section">\${t.section}</div>\`;
    return \`<div class="nav-item \${tab===t.id?'active':''}" onclick="goTab('\${t.id}')"><span class="nav-icon">\${I[t.icon]}</span>\${t.label}</div>\`;
  }).join('');
}

function setMain(html) { const el = document.getElementById('main'); if (el) el.innerHTML = html; }

function goTab(t) {
  tab = t; renderSidebar();
  const fns = { overview:loadOverview, health:loadHealth, infra:loadInfra, storage:loadStorage, revenue:loadRevenue, users:loadUsers, reports:loadReports, config:loadConfig };
  setMain('<div class="loading-center"><div class="spinner"></div></div>');
  fns[t]();
}

// ── Charts (pure SVG, no deps) ─────────────────────────────
function svgBars(data, { color='var(--indigo)', height=56, labelKey='label', valueKey='value' } = {}) {
  if (!data?.length) return \`<div style="height:\${height}px;display:flex;align-items:center;justify-content:center;color:var(--textT);font-size:11px">No data</div>\`;
  const max = Math.max(...data.map(d => Number(d[valueKey]) || 0));
  if (!max) return \`<div style="height:\${height}px;display:flex;align-items:center;justify-content:center;color:var(--textT);font-size:11px">All zero</div>\`;
  const n = data.length, bw = Math.floor(90 / n);
  const bars = data.map((d, i) => {
    const v = Number(d[valueKey]) || 0, h = Math.max(2, Math.round(v / max * height));
    const x = 5 + i * (bw + 2);
    return \`<rect x="\${x}" y="\${height - h}" width="\${bw}" height="\${h}" rx="2" fill="\${color}" opacity="0.8">
      <title>\${d[labelKey]}: \${v}</title></rect>\`;
  }).join('');
  return \`<svg viewBox="0 0 100 \${height}" preserveAspectRatio="none" width="100%" height="\${height}" style="display:block">\${bars}</svg>\`;
}

function sparkline(values, color = 'var(--indigo)') {
  if (!values?.length || values.length < 2) return '';
  const max = Math.max(...values), min = Math.min(...values), range = max - min || 1, h = 28;
  const step = 100 / (values.length - 1);
  const pts = values.map((v, i) => \`\${(i * step).toFixed(1)},\${(h - (v - min) / range * h).toFixed(1)}\`).join(' ');
  return \`<svg viewBox="0 0 100 \${h}" preserveAspectRatio="none" width="80" height="\${h}" style="display:block">
    <polyline points="\${pts}" fill="none" stroke="\${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>\`;
}

function propBar(parts) {
  return \`<div style="display:flex;height:7px;border-radius:4px;overflow:hidden;gap:1px">\${parts.map(p => \`<div style="flex:\${p.pct};background:\${p.color};min-width:2px" title="\${p.label}"></div>\`).join('')}</div>\`;
}

function healthDot(ok, warn) {
  const c = ok ? 'health-ok' : warn ? 'health-warn' : 'health-err';
  return \`<span class="health-dot \${c}"></span>\`;
}

// ── Overview ───────────────────────────────────────────────
async function loadOverview() {
  const [ov, gr] = await Promise.all([api('GET', '/overview'), api('GET', '/growth')]);
  if (!ov) return;
  const u = ov.users || {}, s = ov.storage || {}, r = ov.reports || {};
  const monthly = gr?.monthlyRev || [];
  const GB = 1073741824;

  const totalGb = parseFloat(s.total_gb) || 0;
  const infraEst = totalGb * 0.006 * 85; // B2 cost INR (rough)
  const mrr = ov.thisMonthRev || 0;
  const grossMargin = mrr > 0 ? ((mrr - infraEst) / mrr * 100).toFixed(1) : '0';
  const paidUsers = (u.active_users || 0);
  const trialConv = u.total_users > 0 ? ((paidUsers / u.total_users) * 100).toFixed(1) : '0';

  const revVals = [...monthly].reverse().map(m => m.total || 0);
  const signupVals = (gr?.dailySignups || []).map(d => d.n || 0);

  const alerts = [];
  if ((r.open_reports || 0) > 0) alerts.push(\`<div class="alert alert-red"><span>⚠</span> \${r.open_reports} open report(s) need moderation. <button class="inline-btn" onclick="goTab('reports')">Review →</button></div>\`);
  if ((ov.zombieFiles || 0) > 0) alerts.push(\`<div class="alert alert-yellow"><span>⚠</span> \${ov.zombieFiles} zombie file(s) with b2_delete_queued stuck. <button class="inline-btn" onclick="goTab('health')">View →</button></div>\`);
  if ((ov.failedBillingCount || 0) > 0) alerts.push(\`<div class="alert alert-yellow"><span>⚠</span> \${ov.failedBillingCount} user(s) with failed billing (read-only). <button class="inline-btn" onclick="goTab('revenue')">View →</button></div>\`);

  setMain(\`
    <div class="page-title">Overview</div>
    <div class="page-sub">Business intelligence · refreshes on tab change · \${fmtDate(Date.now())}</div>
    \${alerts.join('')}

    <div class="stat-grid-4">
      \${kpiCard('MRR', '₹' + fmt2(mrr), signupVals.length ? '' : '', 'This month revenue', mrr > 0 ? 'accent-green' : '')}
      \${kpiCard('Active Users', fmt(paidUsers), '+' + fmt(ov.newUsers7d || 0) + ' last 7d', 'Monthly subscribers', 'accent-green')}
      \${kpiCard('Total Storage', gb(totalGb), fmt(s.total_files) + ' files', 'B2 object storage')}
      \${kpiCard('Gross Margin', grossMargin + '%', 'Revenue vs B2 cost', mrr > 0 ? (parseFloat(grossMargin) > 50 ? 'Healthy' : 'Low') : 'No revenue yet', parseFloat(grossMargin) > 30 ? 'accent-green' : 'accent-red')}
    </div>

    <div class="two-col">
      <div class="section">
        <div class="section-head"><span class="section-title">Revenue Trend</span><span class="section-sub">Last \${monthly.length} months</span></div>
        <div class="section-body">
          <div style="margin-bottom:8px">\${svgBars([...monthly].reverse(), { color: 'var(--green)', height: 64, labelKey: 'month', valueKey: 'total' })}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">\${[...monthly].slice(0,4).map(m => \`<span class="tag">\${m.month} ₹\${fmt2(m.total)}</span>\`).join('')}</div>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><span class="section-title">New Signups (30d)</span><span class="section-sub">\${(gr?.dailySignups||[]).reduce((s,d)=>s+(d.n||0),0)} total</span></div>
        <div class="section-body">
          <div style="margin-bottom:8px">\${svgBars(gr?.dailySignups || [], { color: 'var(--indigo)', height: 64, labelKey: 'day', valueKey: 'n' })}</div>
          <div style="font-size:11px;color:var(--textS)">\${ov.newUsers7d || 0} new this week · \${fmt(u.trial_users||0)} in trial</div>
        </div>
      </div>
    </div>

    <div class="stat-grid">
      \${statCard('In Trial',      fmt(u.trial_users||0),   '15-day free', 'badge-blue')}
      \${statCard('Read-only',     fmt(u.read_only_users||0), 'billing paused', 'badge-yellow')}
      \${statCard('Suspended',     fmt(u.suspended_users||0), 'access revoked', 'badge-red')}
      \${statCard('B2 Storage',    gb(totalGb), 'all files unified', '')}
      \${statCard('Overdue Accts', fmt(ov.failedBillingCount||0), 'payment recovery', (ov.failedBillingCount||0)>0?'badge-red':'')}
      \${statCard('Total Files',   fmt(s.total_files||0), fmt(s.users_with_files||0) + ' users', '')}
      \${statCard('Open Reports',  fmt(r.open_reports||0), 'need moderation', (r.open_reports||0)>0?'badge-red':'')}
    </div>

    <div class="section">
      <div class="section-head"><span class="section-title">Storage Breakdown</span></div>
      <div class="section-body">
        \${propBar([
          { pct: totalGb, color: 'var(--indigo)', label: 'B2: ' + gb(totalGb) },
        ])}
        <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--textS)">
          <span style="display:flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:2px;background:var(--indigo);display:inline-block"></span>B2 Storage \${gb(totalGb)}</span>
          <span style="color:var(--textT)">Estimated infra cost: ₹\${infraEst.toFixed(2)}/mo</span>
        </div>
      </div>
    </div>
  \`);
}

function kpiCard(label, value, sub, hint, accent='') {
  return \`<div class="stat-card \${accent}"><div class="stat-label">\${label}</div><div class="stat-value">\${value}</div>\${sub?'<div class="stat-sub">' + sub + '</div>':''}\${hint?'<div class="stat-sub" style="color:var(--textT)">' + hint + '</div>':''}</div>\`;
}
function statCard(label, value, sub, badge='') {
  return \`<div class="stat-card"><div class="stat-label">\${label}</div><div style="font-size:19px;font-weight:700;font-family:var(--mono);color:var(--textP)">\${value}</div>\${sub?'<div class="stat-sub">' + sub + '</div>':''}</div>\`;
}

// ── Health ─────────────────────────────────────────────────
async function loadHealth() {
  const h = await api('GET', '/health');
  if (!h) return;

  const checks = [
    { label: 'Zombie B2 files',       val: h.zombieFiles,        ok: h.zombieFiles === 0,        warn: h.zombieFiles < 10,  detail: 'Files with b2_delete_queued=1 stuck in D1+B2. Re-queued hourly by reconcile cron.' },
    { label: 'Stale pending uploads', val: h.staleUploads,       ok: h.staleUploads === 0,       warn: h.staleUploads < 5,  detail: 'Uploads started >2h ago without confirmation. Cleaned hourly.' },
    { label: 'Failed billing users',  val: h.failedBilling,      ok: h.failedBilling === 0,      warn: h.failedBilling < 3, detail: 'Users in read_only with a failed billing record. Deletion triggers at 35 days.' },
    { label: 'Trial expiring <3d',    val: h.trialExpiringSoon,  ok: true,                       warn: true,                detail: 'Trial users whose 15-day trial ends in under 3 days.' },
    { label: 'Open reports',          val: h.openReports,        ok: h.openReports === 0,        warn: h.openReports < 3,   detail: 'Unreviewed content moderation reports.' },
    { label: 'Storage drifts (24h)',  val: h.storageDrifts24h,   ok: h.storageDrifts24h === 0,   warn: h.storageDrifts24h < 3, detail: 'D1 vs KV storage_usage drift events in last 24h. Auto-corrected by reconcile.' },
    { label: 'Read-only (no bill)',   val: h.readOnlyNoFail || 0, ok: (h.readOnlyNoFail||0) === 0, warn: true,               detail: 'Users in read_only without a failed billing record — unexpected state.' },
  ];

  const rows = checks.map(c => \`
    <tr>
      <td>\${healthDot(c.ok, c.warn)} &nbsp;\${esc(c.label)}</td>
      <td class="mono" style="color:\${c.ok?'var(--green)':c.warn?'var(--orange)':'var(--red)'}">\${c.val}</td>
      <td style="color:var(--textT);font-size:11px">\${esc(c.detail)}</td>
    </tr>\`).join('');

  const allOk = checks.every(c => c.ok);
  const hasErr = checks.some(c => !c.ok && !c.warn);

  setMain(\`
    <div class="page-title">System Health</div>
    <div class="page-sub">Live checks across deletion pipeline, billing, and moderation</div>

    <div class="alert \${allOk?'alert-green':hasErr?'alert-red':'alert-yellow'}">
      \${allOk ? '✓ All systems healthy' : hasErr ? '✗ One or more systems require attention' : '⚠ Minor issues detected'}
    </div>

    <div class="table-wrap">
      <div class="table-head"><span class="table-title">Health Checks</span>
        <button class="btn btn-ghost btn-sm" onclick="loadHealth()">Refresh</button>
      </div>
      <table>
        <thead><tr><th>Check</th><th>Count</th><th>Description</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-head"><span class="section-title">Deletion Pipeline</span></div>
      <div class="section-body" style="font-size:12px;color:var(--textS);line-height:1.8">
        <div>1. <strong style="color:var(--textP)">Immediate delete</strong> → <span class="tag">b2_delete_queued=1</span> set + queue message sent → Consumer deletes B2 + hard-deletes D1 row</div>
        <div>2. <strong style="color:var(--textP)">Soft delete (trash)</strong> → <span class="tag">deleted_at</span> + <span class="tag">trash_expires_at=+30d</span> → <span class="tag">expireTrash cron (hourly)</span> queues deletion after expiry</div>
        <div>3. <strong style="color:var(--textP)">Safety net</strong> → <span class="tag">reQueueStaleDeletions (hourly)</span> re-queues files stuck with <span class="tag">b2_delete_queued=1</span> for &gt;10min (lost queue messages)</div>
        <div>4. <strong style="color:var(--textP)">B2 multi-version</strong> → Consumer loops until all B2 versions of each storage key are deleted</div>
      </div>
    </div>
  \`);
}

// ── Infrastructure ─────────────────────────────────────────
async function loadInfra() {
  const d = await api('GET', '/infra');
  if (!d) return;
  const { workers: w, kv, d1, b2, queue, costs } = d;

  const milFmt = n => n >= 1e6 ? (n/1e6).toFixed(2)+'M' : n >= 1e3 ? (n/1e3).toFixed(1)+'K' : String(n||0);
  const usd = n => '$' + ((n||0).toFixed(3));

  const healthRows = [
    { label: 'Worker Requests',  val: milFmt(w.requests),  sub: 'Error rate: ' + w.errorRate + '%',    ok: w.errorRate < 1,     color: w.errorRate < 1 ? 'var(--green)' : 'var(--orange)' },
    { label: 'Worker CPU Time',  val: milFmt(w.cpuMs) + ' ms', sub: '$5/mo base plan',               ok: true, color: 'var(--textP)' },
    { label: 'KV Reads',         val: milFmt(kv.reads),    sub: 'Writes: ' + milFmt(kv.writes),      ok: kv.costUsd < 0.10,   color: kv.costUsd < 0.10 ? 'var(--green)' : 'var(--orange)' },
    { label: 'D1 Rows Read',     val: milFmt(d1.rowsRead), sub: 'Written: ' + milFmt(d1.rowsWritten),ok: d1.costUsd < 0.10,   color: d1.costUsd < 0.10 ? 'var(--green)' : 'var(--orange)' },
    { label: 'B2 Storage',       val: gb(b2.totalGb),      sub: fmt(b2.totalFiles) + ' live files', ok: true, color: 'var(--textP)' },
    { label: 'Queue Pending Del',val: String(queue.pendingDeletions), sub: 'Stale uploads: ' + queue.staleUploads, ok: queue.pendingDeletions === 0, color: queue.pendingDeletions === 0 ? 'var(--green)' : 'var(--orange)' },
  ];

  const maxCost = Math.max(...costs.breakdown.map(c => c.usd), 0.001);

  setMain(\`
    <div class="page-title">Infrastructure</div>
    <div class="page-sub">Cloudflare Workers · KV · D1 · B2 · Queue — current month usage</div>

    <div class="stat-grid-4">
      \${kpiCard('Worker Requests',  milFmt(w.requests),   w.errorRate + '% error rate', 'This month')}
      \${kpiCard('Worker CPU',       milFmt(w.cpuMs) + ' ms', 'Approx CPU time', 'This month')}
      \${kpiCard('KV Ops',           milFmt(kv.reads + kv.writes), milFmt(kv.reads) + ' reads / ' + milFmt(kv.writes) + ' writes', 'This month')}
      \${kpiCard('D1 Rows',          milFmt(d1.rowsRead + d1.rowsWritten), milFmt(d1.rowsRead) + ' read / ' + milFmt(d1.rowsWritten) + ' written', 'This month')}
    </div>

    <div class="two-col">
      <div class="section">
        <div class="section-head"><span class="section-title">Component Status</span></div>
        <div class="section-body">
          \${healthRows.map(r => \`
            <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
              \${healthDot(r.ok, true)}
              <div style="flex:1">
                <div style="font-size:12px;color:var(--textS)">\${r.label}</div>
                <div style="font-size:11px;color:var(--textT)">\${r.sub}</div>
              </div>
              <div style="font-family:var(--mono);font-size:14px;font-weight:700;color:\${r.color}">\${r.val}</div>
            </div>\`).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-head"><span class="section-title">Estimated Monthly Cost</span><span class="section-sub">~\${usd(costs.totalUsd)} ≈ ₹\${costs.totalInr.toFixed(2)}</span></div>
        <div class="section-body">
          \${costs.breakdown.map(c => \`
            <div class="cost-row">
              <span class="cost-label">\${c.label}</span>
              <div style="flex:2;margin:0 10px">
                <div class="prog-bar"><div class="prog-fill" style="width:\${Math.max(2, c.usd/maxCost*100).toFixed(0)}%;background:var(--indigo)"></div></div>
              </div>
              <span class="cost-usd">\${usd(c.usd)}</span>
              <span class="cost-inr">₹\${c.inr.toFixed(2)}</span>
            </div>\`).join('')}
          <hr class="divider">
          <div class="cost-row" style="font-weight:700">
            <span class="cost-label" style="color:var(--textP)">Total (est.)</span>
            <div style="flex:2"></div>
            <span class="cost-usd" style="color:var(--textP)">\${usd(costs.totalUsd)}</span>
            <span class="cost-inr" style="color:var(--textS)">₹\${costs.totalInr.toFixed(2)}</span>
          </div>
          <div style="margin-top:10px;font-size:10px;color:var(--textT)">B2 egress: $0 (Bandwidth Alliance). CF Workers Paid plan: $5/mo base. Queues free tier: 1M msgs/mo. Resend email costs not included.</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><span class="section-title">B2 Object Storage</span></div>
      <div class="section-body">
        <div class="stat-grid-3">
          \${kpiCard('Total Stored', gb(b2.totalGb), fmt(b2.totalFiles) + ' live files', 'in B2')}
          \${kpiCard('Avg File Size', b2.totalFiles > 0 ? gb(b2.totalGb / b2.totalFiles) : '0 B', 'per file', '')}
          \${kpiCard('Est. Cost', '$' + (b2.totalGb * 0.006).toFixed(3) + '/mo', '≈ ₹' + (b2.totalGb * 0.006 * 85).toFixed(2), '$0.006/GB')}
        </div>
        \${propBar([
          { pct: b2.totalGb, color: 'var(--indigo)', label: 'B2 ' + gb(b2.totalGb) },
        ])}
        <div style="margin-top:8px;font-size:11px;color:var(--textT)">Rate: $0.006/GB/month · Egress: $0 via Bandwidth Alliance · Estimated: $\${(b2.totalGb * 0.006).toFixed(3)}/mo</div>
      </div>
    </div>
  \`);
}

// ── Storage ────────────────────────────────────────────────
async function loadStorage() {
  const [gr, h] = await Promise.all([api('GET', '/growth'), api('GET', '/health')]);
  if (!gr) return;

  const top = gr.topUsers || [];
  const maxBytes = top.length ? Math.max(...top.map(u => u.current_bytes || 0)) : 1;

  const topRows = top.length === 0
    ? '<tr><td colspan="3" class="empty">No storage data</td></tr>'
    : top.map((u, i) => \`<tr>
        <td style="color:var(--textT);width:24px">\${i + 1}</td>
        <td>\${esc(u.email)}<div style="font-size:11px;color:var(--textT)">\${esc(u.display_name||'')}</div></td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;max-width:100px"><div class="prog-bar"><div class="prog-fill" style="width:\${Math.max(2,(u.current_bytes||0)/maxBytes*100).toFixed(0)}%;background:var(--indigo)"></div></div></div>
            <span class="mono" style="min-width:60px;text-align:right">\${gbBytes(u.current_bytes||0)}</span>
          </div>
        </td>
      </tr>\`).join('');

  setMain(\`
    <div class="page-title">Storage</div>
    <div class="page-sub">B2 usage, top consumers, deletion pipeline health</div>

    <div class="stat-grid-4">
      \${kpiCard('Zombie Files', String(h?.zombieFiles||0), 'b2_delete_queued=1 stuck', h?.zombieFiles > 0 ? 'Re-queued hourly' : 'Pipeline healthy', h?.zombieFiles > 0 ? 'accent-yellow' : 'accent-green')}
      \${kpiCard('Stale Uploads', String(h?.staleUploads||0), 'Not confirmed >2h', 'Cleaned hourly', h?.staleUploads > 0 ? 'accent-yellow' : 'accent-green')}
      \${kpiCard('Failed Billing', String(h?.failedBilling||0), 'Files at risk', '35d until deletion', h?.failedBilling > 0 ? 'accent-red' : 'accent-green')}
      \${kpiCard('Storage Drifts', String(h?.storageDrifts24h||0), 'Last 24h', 'Auto-corrected', h?.storageDrifts24h > 0 ? 'accent-yellow' : 'accent-green')}
    </div>

    <div class="table-wrap">
      <div class="table-head"><span class="table-title">Top Users by Storage</span><span style="font-size:11px;color:var(--textT)">Live from storage_usage table</span></div>
      <table>
        <thead><tr><th>#</th><th>User</th><th>Storage Used</th></tr></thead>
        <tbody>\${topRows}</tbody>
      </table>
    </div>

    <div class="section">
      <div class="section-head"><span class="section-title">Deletion Pipeline Health</span></div>
      <div class="section-body" style="font-size:12px;color:var(--textS);display:flex;flex-direction:column;gap:10px">
        \${[
          { label: 'Queue consumer', detail: 'migrationQueue handles DELETE_FILE_FROM_BUCKET — deletes all B2 versions then hard-deletes D1 row', ok: true },
          { label: 'expireTrash cron', detail: 'Runs hourly — processes LIMIT 200 expired trash files per run, queues B2 deletion', ok: true },
          { label: 'reQueueStaleDeletions', detail: 'Runs hourly — finds b2_delete_queued=1 files older than 10min, re-queues lost messages', ok: (h?.zombieFiles||0) === 0 },
          { label: 'cleanupStalePendingUploads', detail: 'Runs hourly — purges unconfirmed uploads >2h old from pending_uploads table', ok: (h?.staleUploads||0) === 0 },
        ].map(c => \`<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 12px;background:var(--bg4);border-radius:8px;border:1px solid var(--border)">
          \${healthDot(c.ok, true)}
          <div><div style="color:var(--textP);font-weight:600;font-family:var(--mono);font-size:11px;margin-bottom:2px">\${c.label}</div><div style="color:var(--textT);font-size:11px">\${c.detail}</div></div>
        </div>\`).join('')}
      </div>
    </div>
  \`);
}

// ── Revenue ────────────────────────────────────────────────
async function loadRevenue() {
  const [rev, pnl, fails] = await Promise.all([api('GET', '/revenue?months=12'), api('GET', '/pnl'), api('GET', '/billing-failures')]);
  if (!rev) return;
  const monthly = rev.monthly || [], activeMandates = rev.activeMandates || 0;
  const pnlRows = pnl?.pnl || [], failures = fails?.failures || [];

  const revBars = svgBars([...monthly].reverse(), { color: 'var(--green)', height: 72, labelKey: 'month', valueKey: 'total_rev' });

  const mRows = monthly.length === 0
    ? '<tr><td colspan="5" class="empty">No billing data yet</td></tr>'
    : monthly.map(m => \`<tr>
        <td class="mono" style="color:var(--textS)">\${m.month}</td>
        <td class="mono">₹\${fmt2(m.storage_rev||0)}</td>
        <td class="mono">₹\${fmt2(m.adfree_rev||0)}</td>
        <td class="mono" style="font-weight:700">₹\${fmt2(m.total_rev||0)}</td>
        <td style="color:var(--textS)">\${fmt(m.paid_users)}</td>
      </tr>\`).join('');

  const pRows = pnlRows.length === 0
    ? '<tr><td colspan="5" class="empty">No data</td></tr>'
    : pnlRows.map(m => \`<tr>
        <td class="mono" style="color:var(--textS)">\${m.month}</td>
        <td class="mono">₹\${fmt2(m.revenue||0)}</td>
        <td class="mono" style="color:var(--textS)">₹\${fmt2(m.cost||0)}</td>
        <td class="mono \${(m.gross||0)>=0?'profit':'loss'}">₹\${fmt2(m.gross||0)}</td>
        <td class="mono" style="color:var(--textS)">\${m.margin}%</td>
      </tr>\`).join('');

  const fRows = failures.length === 0
    ? '<tr><td colspan="5" class="empty">No outstanding failures</td></tr>'
    : failures.map(f => \`<tr>
        <td>\${esc(f.email)}</td>
        <td class="mono" style="color:var(--red)">₹\${fmt2(f.total_charged||0)}</td>
        <td style="color:var(--textS)">\${esc(f.month||'-')}</td>
        <td style="color:\${f.days_overdue>=30?'var(--red)':f.days_overdue>=21?'var(--orange)':'var(--textS)'}">\${f.days_overdue}d</td>
        <td>\${badge(f.status)}</td>
      </tr>\`).join('');

  setMain(\`
    <div class="page-title">Revenue &amp; P&amp;L</div>
    <div class="page-sub">Billing history, P&amp;L, and outstanding failures</div>

    <div class="stat-grid-3">
      \${kpiCard('Active AutoPay', fmt(activeMandates), 'AutoPay mandates', 'UPI recurring')}
      \${kpiCard('This Month', '₹' + fmt2(monthly[0]?.total_rev||0), fmt(monthly[0]?.paid_users||0) + ' paid users', monthly[0]?.month||'—')}
      \${kpiCard('Outstanding', failures.length + ' users', 'Failed billing', failures.length > 0 ? 'action required' : 'all clear', failures.length > 0 ? 'accent-red' : 'accent-green')}
    </div>

    <div class="section">
      <div class="section-head"><span class="section-title">Revenue Trend</span><span class="section-sub">Last \${monthly.length} months</span></div>
      <div class="section-body">
        \${revBars}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">\${monthly.slice(0,6).map(m=>\`<span class="tag">\${m.month} ₹\${fmt2(m.total_rev||0)}</span>\`).join('')}</div>
      </div>
    </div>

    <div class="table-wrap">
      <div class="table-head"><span class="table-title">Monthly Revenue Breakdown</span></div>
      <table><thead><tr><th>Month</th><th>Storage</th><th>Ad-Free</th><th>Total</th><th>Paid Users</th></tr></thead>
      <tbody>\${mRows}</tbody></table>
    </div>

    <div class="table-wrap">
      <div class="table-head"><span class="table-title">P&amp;L Summary</span></div>
      <table><thead><tr><th>Month</th><th>Revenue</th><th>Infra Cost</th><th>Gross Profit</th><th>Margin</th></tr></thead>
      <tbody>\${pRows}</tbody></table>
    </div>

    <div class="table-wrap">
      <div class="table-head"><span class="table-title">Outstanding Billing Failures</span><span style="font-size:11px;color:var(--textT)">Files deleted at 35 days</span></div>
      <table><thead><tr><th>Email</th><th>Owed</th><th>Month</th><th>Days Overdue</th><th>Status</th></tr></thead>
      <tbody>\${fRows}</tbody></table>
    </div>
  \`);
}

// ── Users ──────────────────────────────────────────────────
async function loadUsers() {
  const d = await api('GET', '/users?page=' + userPage + '&q=' + encodeURIComponent(userQ) + '&status=' + userSt);
  if (!d) return;
  const users = d.users || [];
  const rows = users.length === 0
    ? '<tr><td colspan="7" class="empty">No users found</td></tr>'
    : users.map(u => \`<tr>
        <td>\${esc(u.email)}</td>
        <td>\${esc(u.display_name||'-')}</td>
        <td class="mono" style="font-size:11px;color:var(--textS)">\${esc(u.username||'-')}</td>
        <td>\${badge(u.status)}</td>
        <td>\${u.has_mandate ? '<span class="tag" style="background:rgba(34,197,94,.1);color:var(--green);border-color:rgba(34,197,94,.25)">AutoPay ✓</span>' : '<span class="tag" style="color:var(--textT)">No mandate</span>'}\${u.last_bill_status ? ' <span class="tag" style="' + (u.last_bill_status==='paid'?'color:var(--green)':u.last_bill_status==='failed'?'color:var(--red)':'color:var(--textS)') + '">' + u.last_bill_status + (u.last_bill_amount?' ₹'+fmt2(u.last_bill_amount):'') + '</span>' : ''}</td>
        <td style="color:var(--textS);font-size:11px">\${fmtDate(u.created_at)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="showUser('\${u.id}')">View</button></td>
      </tr>\`).join('');

  setMain(\`
    <div class="page-title">Users</div>
    <div class="table-wrap">
      <div class="table-head">
        <span class="table-title">All Users</span>
        <input class="search-input" id="uq" placeholder="Search email, name…" value="\${esc(userQ)}" onkeydown="if(event.key==='Enter')applyUF()" />
        <select class="filter-select" id="ust" onchange="applyUF()">
          <option value="">All statuses</option>
          \${['trial','active','read_only','suspended','deleted'].map(s=>\`<option value="\${s}" \${userSt===s?'selected':''}>\${s.replace(/_/g,' ')}</option>\`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="applyUF()">Search</button>
      </div>
      <table>
        <thead><tr><th>Email</th><th>Name</th><th>Username</th><th>Status</th><th>Billing</th><th>Joined</th><th></th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
      <div class="pagination">
        <button class="page-btn" \${userPage<=1?'disabled':''} onclick="userPage--;loadUsers()">← Prev</button>
        <span class="page-info">Page \${userPage}</span>
        <button class="page-btn" \${users.length<50?'disabled':''} onclick="userPage++;loadUsers()">Next →</button>
      </div>
    </div>\`);
}

function applyUF() { userQ=document.getElementById('uq').value.trim(); userSt=document.getElementById('ust').value; userPage=1; loadUsers(); }

async function showUser(userId) {
  const d = await api('GET', '/users/' + userId);
  if (!d) return;
  const u = d.user, s = d.fileStats, su = d.storage_usage, mnd = d.mandate, lb = d.lastBill;
  const susp = u.status==='suspended', isDel = u.status==='deleted';
  const daysSinceDel = u.deleted_at ? (Date.now()-u.deleted_at)/86400000 : Infinity;
  const canResume = isDel && daysSinceDel <= 30;
  modal(\`
    <div class="modal-head"><h2>User Detail</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      \${row('Email', esc(u.email))}
      \${row('Display Name', esc(u.display_name||'-'))}
      \${row('Username', esc(u.username||'-'))}
      \${row('Status', badge(u.status))}
      \${row('AutoPay', mnd ? '<span style="color:var(--green)">Active — limit ₹'+fmt2(mnd.protection_limit||0)+' · since '+fmtDate(mnd.activated_at||mnd.created_at)+'</span>' : '<span style="color:var(--textT)">No active mandate</span>')}
      \${lb ? row('Last Invoice', '<span class="mono">'+esc(lb.month)+' · ₹'+fmt2(lb.total_charged||0)+'</span> <span style="color:'+(lb.status==='paid'?'var(--green)':lb.status==='failed'?'var(--red)':'var(--textS)')+'">'+esc(lb.status)+'</span>'+(lb.status==='failed'&&lb.retry_count?'<span style="color:var(--textT);font-size:11px"> · '+lb.retry_count+' retries</span>':'')) : row('Last Invoice', '<span style="color:var(--textT)">None</span>')}
      \${u.trial_ends_at ? row('Trial Ends', fmtDate(u.trial_ends_at)) : ''}
      \${row('Joined', fmtDate(u.created_at))}
      \${row('Files', fmt(s&&s.count))}
      \${row('Storage', gb(s&&s.total_gb))}
      \${su ? row('Current Storage', gbBytes(su.current_bytes) + ' live') : ''}
      \${u.suspension_reason ? row('Suspension Reason','<span style="color:var(--red)">'+esc(u.suspension_reason)+'</span>') : ''}
      \${isDel ? row('Deleted At', fmtDate(u.deleted_at)+(canResume?' <span style="color:var(--orange);font-size:11px">→ '+Math.ceil(30-daysSinceDel)+'d left to resume</span>':' <span style="color:var(--red);font-size:11px">window expired</span>')) : ''}
      \${!susp&&!isDel ? '<div style="margin-top:14px"><input id="sreason" class="search-input" placeholder="Reason for suspension (optional)" style="width:100%;font-family:inherit" /></div>' : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      \${isDel
        ? (canResume ? \`<button class="btn btn-success" onclick="doResume('\${u.id}')">Resume Account</button>\` : \`<span style="font-size:12px;color:var(--textS)">Retention window expired</span>\`)
        : susp
          ? \`<button class="btn btn-success" onclick="doRestore('\${u.id}')">Restore Account</button>\`
          : \`<button class="btn btn-danger" onclick="doSuspend('\${u.id}')">Suspend</button>\`}
    </div>\`);
}

async function doSuspend(id) { const r=(document.getElementById('sreason')||{}).value||'Admin action'; try{await api('POST','/users/'+id+'/suspend',{reason:r});closeModal();toast('User suspended');loadUsers();}catch(e){toast(e.message,true);} }
async function doRestore(id) { try{await api('POST','/users/'+id+'/restore',{});closeModal();toast('Account restored');loadUsers();}catch(e){toast(e.message,true);} }
async function doResume(id)  { if(!confirm('Resume this deleted account?'))return; try{await api('POST','/users/'+id+'/resume',{});closeModal();toast('Account resumed');loadUsers();}catch(e){toast(e.message,true);} }

// ── Reports ────────────────────────────────────────────────
async function loadReports() {
  const d = await api('GET', '/reports?status=' + repStatus);
  if (!d) return;
  const reps = d.reports || [];
  const btns = ['open','resolved_restored','resolved_deleted','resolved_suspended'].map(s=>
    \`<button class="btn \${repStatus===s?'btn-primary':'btn-ghost'} btn-sm" onclick="repStatus='\${s}';loadReports()">\${s.replace(/_/g,' ')}</button>\`).join('');
  const rows = reps.length===0
    ? '<tr><td colspan="8" class="empty">No reports</td></tr>'
    : reps.map(r=>\`<tr>
        <td>\${r.is_vault?'<span class="vault-tag">Vault</span>':''}\${esc(r.filename||'Unknown')}</td>
        <td style="color:var(--textS)">\${esc(r.reporter_name||'-')}</td>
        <td style="color:var(--textS)">\${esc(r.uploader_name||'-')}</td>
        <td style="color:var(--textS);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${esc(r.reason||'-')}</td>
        <td>\${r.evidence_url?'<a href="/admin/evidence/'+r.id+'?token='+encodeURIComponent(session)+'" target="_blank" rel="noopener"><img src="/admin/evidence/'+r.id+'?token='+encodeURIComponent(session)+'" style="width:64px;height:40px;object-fit:cover;border-radius:5px;border:1px solid var(--border);background:var(--bg4)" alt="ev"></a>':'<span style="color:var(--textT);font-size:10px">None</span>'}</td>
        <td style="color:var(--textT);font-size:11px">\${fmtDate(r.created_at)}</td>
        <td>\${badge(r.status)}</td>
        <td>\${r.status==='open'?\`<div class="btn-group"><button class="btn btn-success btn-sm" onclick="resolve('\${r.id}','restore')">Restore</button><button class="btn btn-danger btn-sm" onclick="resolve('\${r.id}','delete')">Delete</button><button class="btn btn-ghost btn-sm" onclick="resolve('\${r.id}','suspend')">Suspend</button></div>\`:'-'}</td>
      </tr>\`).join('');
  setMain(\`
    <div class="page-title">Reports</div>
    <div class="btn-group" style="margin-bottom:16px">\${btns}</div>
    <div class="table-wrap">
      <table><thead><tr><th>File</th><th>Reporter</th><th>Uploader</th><th>Reason</th><th>Evidence</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>\${rows}</tbody></table>
    </div>\`);
}

async function resolve(id, action) {
  const labels={restore:'Restore file access',delete:'Permanently delete file',suspend:'Suspend uploader'};
  if(!confirm(labels[action]+'\\n\\nAre you sure?'))return;
  try{await api('POST','/reports/'+id+'/'+action,{});toast('Resolved: '+action);loadReports();}catch(e){toast(e.message,true);}
}

// ── Config ─────────────────────────────────────────────────
async function loadConfig() {
  const d = await api('GET', '/config');
  if (!d) return;
  const rows = d.config || [];
  const PRICING = new Set(['storage_price_per_gb_month','min_bill_amount','teams_billing_enabled','retention_days_unpaid']);

  const pricingRows = rows.filter(c => PRICING.has(c.key));
  const otherRows   = rows.filter(c => !PRICING.has(c.key));

  const renderRows = (rr) => rr.map(c => \`<tr>
    <td class="mono" style="color:var(--indigo);font-size:11px">\${esc(c.key)}</td>
    <td><input class="config-input" data-key="\${esc(c.key)}" value="\${esc(c.value)}" onkeydown="if(event.key==='Enter')saveConf('\${esc(c.key)}')" /></td>
    <td style="color:var(--textT);font-size:10px;white-space:nowrap">\${fmtDate(c.updated_at)}</td>
    <td><button class="btn btn-primary btn-sm" onclick="saveConf('\${esc(c.key)}')">Save</button></td>
  </tr>\`).join('');

  setMain(\`
    <div class="page-title">Configuration</div>
    <div class="page-sub">Stored in D1 · changes apply immediately · no restart required</div>

    <div class="table-wrap">
      <div class="table-head"><span class="table-title">Billing & Pricing</span></div>
      <table><thead><tr><th>Key</th><th>Value</th><th>Updated</th><th></th></tr></thead>
      <tbody>\${renderRows(pricingRows)||'<tr><td colspan="4" class="empty">No pricing keys</td></tr>'}</tbody></table>
    </div>

    <div class="table-wrap">
      <div class="table-head"><span class="table-title">All Other Config</span></div>
      <table><thead><tr><th>Key</th><th>Value</th><th>Updated</th><th></th></tr></thead>
      <tbody>\${renderRows(otherRows)||'<tr><td colspan="4" class="empty">No config keys</td></tr>'}</tbody></table>
    </div>\`);
}

async function saveConf(key) {
  const inp = document.querySelector('[data-key="'+key+'"]');
  if (!inp) return;
  try { await api('PUT', '/config', { key, value: inp.value }); toast(key + ' saved'); loadConfig(); }
  catch(e) { toast(e.message, true); }
}

// ── Modal ──────────────────────────────────────────────────
function modal(html) {
  document.getElementById('modal-root').innerHTML = '<div class="modal-overlay" onclick="if(event.target.classList.contains(\\'modal-overlay\\'))closeModal()"><div class="modal">'+html+'</div></div>';
}
function closeModal() { document.getElementById('modal-root').innerHTML=''; }

// ── Toast ──────────────────────────────────────────────────
function toast(msg, err=false) {
  const el=document.createElement('div');
  el.textContent=msg;
  Object.assign(el.style,{padding:'9px 14px',borderRadius:'9px',fontSize:'12px',fontWeight:'600',
    background:err?'rgba(226,75,74,.12)':'rgba(0,194,124,.12)',
    color:err?'#E24B4A':'#00C27C',
    border:err?'1px solid rgba(226,75,74,.25)':'1px solid rgba(0,194,124,.25)',
    boxShadow:'0 8px 24px rgba(0,0,0,.4)',maxWidth:'300px',fontFamily:'Inter,sans-serif',
  });
  document.getElementById('toast-root').appendChild(el);
  setTimeout(()=>el.remove(), 3000);
}

// ── Helpers ────────────────────────────────────────────────
function fmt(n) { return n!=null ? Number(n).toLocaleString('en-IN') : '0'; }
function fmt2(n) { return Number(n||0).toFixed(2); }
function gb(n)   { if(!n||parseFloat(n)===0)return'0 B'; const g=parseFloat(n); return g<0.001?'<1 MB':g<1?(g*1000).toFixed(0)+' MB':g.toFixed(2)+' GB'; }
function gbBytes(b) { if(!b)return'0 B'; const g=b/1073741824; return g<0.001?Math.round(b/1024)+' KB':g<1?(g*1024).toFixed(0)+' MB':g.toFixed(2)+' GB'; }
function fmtDate(ts) {
  if(!ts)return'-';
  const d=new Date(typeof ts==='number'?ts:parseInt(ts)||ts);
  return isNaN(d)?String(ts):d.toLocaleDateString('en-IN',{year:'numeric',month:'short',day:'numeric'});
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function row(label, value) { return '<div class="field-row"><span class="field-label">'+label+'</span><span class="field-value">'+value+'</span></div>'; }
function badge(s) {
  const m={active:'badge-green',trial:'badge-blue',read_only:'badge-yellow',suspended:'badge-red',deleted:'badge-gray',
           open:'badge-yellow',resolved_restored:'badge-green',resolved_deleted:'badge-red',resolved_suspended:'badge-red'};
  return '<span class="badge '+(m[s]||'badge-gray')+'">'+(s||'-').replace(/_/g,' ')+'</span>';
}

boot();
</script>
</body>
</html>`;
