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
  --bg:      #07070D;
  --bg2:     #0F0F1A;
  --bg3:     #11111E;
  --bg4:     #161625;
  --border:  #1E1E32;
  --border2: #252540;
  --indigo:  #5B5EF4;
  --cyan:    #00D4FF;
  --green:   #00C27C;
  --red:     #E24B4A;
  --orange:  #F59E0B;
  --textP:   #EEEEF8;
  --textS:   #8888AA;
  --textT:   #55556A;
  --mono:    'JetBrains Mono',monospace;
}
body{font-family:'Inter',-apple-system,sans-serif;background:var(--bg);color:var(--textP);min-height:100vh;-webkit-font-smoothing:antialiased}

/* ── Login ──────────────────────────────────────────────── */
.login-wrap{display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg)}
.login-card{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:40px;width:360px;box-shadow:0 24px 64px rgba(0,0,0,.5)}
.login-logo{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.login-logo .wordmark{font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700;letter-spacing:-.02em}
.login-logo .wordmark .d{color:var(--textP)}.login-logo .wordmark .dp{color:var(--cyan)}
.login-sub{color:var(--textS);font-size:13px;margin-bottom:28px}
.login-card input{width:100%;padding:10px 14px;background:var(--bg4);border:1px solid var(--border);border-radius:10px;color:var(--textP);font-size:14px;margin-bottom:12px;outline:none;font-family:inherit}
.login-card input:focus{border-color:var(--indigo)}
.btn-login{width:100%;padding:11px;background:var(--indigo);color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;font-weight:600;font-family:inherit;transition:background .15s}
.btn-login:hover{background:#4A4DDE}
.login-err{color:var(--red);font-size:12px;margin-top:8px;min-height:18px}

/* ── Layout ─────────────────────────────────────────────── */
.layout{display:flex;min-height:100vh}
.sidebar{width:228px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;position:fixed;top:0;bottom:0;left:0;z-index:10}
.sidebar-logo{padding:20px 16px 22px;display:flex;align-items:center;gap:9px;border-bottom:1px solid var(--border)}
.sidebar-logo .wm{font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700;letter-spacing:-.02em}
.sidebar-logo .wm .d{color:var(--textP)}.sidebar-logo .wm .dp{color:var(--cyan)}
.sidebar-logo .admin-badge{font-size:10px;font-weight:600;background:rgba(91,94,244,.15);color:var(--indigo);border:1px solid rgba(91,94,244,.25);border-radius:99px;padding:2px 7px;margin-left:2px}
.sidebar-nav{flex:1;padding:8px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;font-size:13px;cursor:pointer;transition:color .15s,background .15s;border-radius:8px;color:var(--textS);border:1px solid transparent}
.nav-item:hover{background:rgba(26,26,46,.6);color:var(--textP)}
.nav-item.active{background:#1A1A2E;color:var(--textP);border-color:var(--border);font-weight:600}
.nav-icon{width:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sidebar-footer{padding:12px 16px;border-top:1px solid var(--border)}
.logout-btn{width:100%;padding:8px;background:none;border:1px solid var(--border);color:var(--textS);border-radius:8px;cursor:pointer;font-size:12px;font-family:inherit;transition:.15s}
.logout-btn:hover{border-color:var(--red);color:var(--red)}
.main{flex:1;margin-left:228px;padding:28px;overflow:auto;max-width:100%}

/* ── Page headings ───────────────────────────────────────── */
.page-title{font-size:20px;font-weight:700;color:var(--textP);margin-bottom:6px;font-family:'Space Grotesk',sans-serif}
.page-sub{font-size:13px;color:var(--textS);margin-bottom:22px}

/* ── Stat cards ──────────────────────────────────────────── */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:28px}
.stat-card{background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:18px}
.stat-label{font-size:10px;color:var(--textT);text-transform:uppercase;letter-spacing:.6px;margin-bottom:8px;font-weight:700}
.stat-value{font-size:24px;font-weight:700;color:var(--textP);font-family:var(--mono)}
.stat-sub{font-size:11px;color:var(--textS);margin-top:4px}

/* ── Tables ──────────────────────────────────────────────── */
.table-wrap{background:var(--bg3);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:20px}
.table-head{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.table-title{font-size:14px;font-weight:600;color:var(--textP);flex:1;min-width:100px}
.search-input{padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;background:var(--bg4);color:var(--textP);min-width:180px;font-family:inherit}
.search-input:focus{border-color:var(--indigo)}
.filter-select{padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:13px;outline:none;background:var(--bg4);color:var(--textP);font-family:inherit}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:var(--bg4);padding:9px 16px;text-align:left;font-size:10px;color:var(--textT);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);white-space:nowrap;font-weight:700}
td{padding:11px 16px;border-bottom:1px solid var(--border);color:var(--textP);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(26,26,46,.4)}

/* ── Badges ──────────────────────────────────────────────── */
.badge{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600}
.badge-green {background:rgba(0,194,124,.12);color:var(--green);border:1px solid rgba(0,194,124,.25)}
.badge-blue  {background:rgba(91,94,244,.12);color:var(--indigo);border:1px solid rgba(91,94,244,.25)}
.badge-yellow{background:rgba(245,158,11,.12);color:var(--orange);border:1px solid rgba(245,158,11,.25)}
.badge-red   {background:rgba(226,75,74,.12);color:var(--red);border:1px solid rgba(226,75,74,.25)}
.badge-gray  {background:rgba(136,136,170,.1);color:var(--textS);border:1px solid var(--border)}
.badge-purple{background:rgba(91,94,244,.12);color:#a78bfa;border:1px solid rgba(167,139,250,.25)}

/* ── Buttons ─────────────────────────────────────────────── */
.btn{padding:7px 14px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;transition:.15s;display:inline-flex;align-items:center;gap:5px;font-family:inherit}
.btn-primary{background:var(--indigo);color:#fff}
.btn-primary:hover{background:#4A4DDE}
.btn-danger{background:rgba(226,75,74,.12);color:var(--red);border:1px solid rgba(226,75,74,.25)}
.btn-danger:hover{background:rgba(226,75,74,.2)}
.btn-success{background:rgba(0,194,124,.12);color:var(--green);border:1px solid rgba(0,194,124,.25)}
.btn-success:hover{background:rgba(0,194,124,.2)}
.btn-ghost{background:var(--bg4);color:var(--textS);border:1px solid var(--border)}
.btn-ghost:hover{color:var(--textP);border-color:var(--border2)}
.btn-sm{padding:4px 10px;font-size:11px;border-radius:6px}
.btn-group{display:flex;gap:6px;flex-wrap:wrap}

/* ── Pagination ──────────────────────────────────────────── */
.pagination{display:flex;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid var(--border)}
.page-btn{padding:5px 12px;border:1px solid var(--border);border-radius:7px;background:var(--bg4);color:var(--textS);cursor:pointer;font-size:12px;font-family:inherit;transition:.15s}
.page-btn:hover:not(:disabled){color:var(--textP);border-color:var(--border2)}
.page-btn:disabled{opacity:.35;cursor:not-allowed}
.page-info{font-size:12px;color:var(--textS);flex:1;text-align:center}

/* ── Modal ───────────────────────────────────────────────── */
.modal-overlay{position:fixed;inset:0;background:rgba(7,7,13,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px}
.modal{background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:580px;max-width:100%;max-height:88vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,.6)}
.modal-head{padding:18px 22px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:var(--bg2);z-index:1}
.modal-head h2{font-size:15px;font-weight:700;color:var(--textP)}
.modal-close{background:var(--bg4);border:1px solid var(--border);border-radius:7px;width:30px;height:30px;font-size:18px;cursor:pointer;color:var(--textS);display:flex;align-items:center;justify-content:center;line-height:1;font-family:inherit}
.modal-close:hover{color:var(--textP)}
.modal-body{padding:20px 22px}
.modal-footer{padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;background:var(--bg2)}

/* ── Field rows ──────────────────────────────────────────── */
.field-row{display:flex;margin-bottom:11px;font-size:13px;align-items:flex-start;padding-bottom:11px;border-bottom:1px solid var(--border)}
.field-row:last-of-type{border-bottom:none;margin-bottom:0;padding-bottom:0}
.field-label{width:150px;color:var(--textS);flex-shrink:0;padding-top:1px}
.field-value{color:var(--textP);word-break:break-all}

/* ── Config inputs ───────────────────────────────────────── */
.config-input{padding:7px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px;width:100%;outline:none;font-family:var(--mono);background:var(--bg4);color:var(--textP)}
.config-input:focus{border-color:var(--indigo)}

/* ── Alert ───────────────────────────────────────────────── */
.alert{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:18px}
.alert-red{background:rgba(226,75,74,.1);color:var(--red);border:1px solid rgba(226,75,74,.25)}
.alert-green{background:rgba(0,194,124,.1);color:var(--green);border:1px solid rgba(0,194,124,.25)}

/* ── Misc ────────────────────────────────────────────────── */
.mono{font-family:var(--mono);font-size:12px}
.empty{text-align:center;padding:48px;color:var(--textT);font-size:14px}
.spinner{display:inline-block;width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--indigo);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle}
.loading-center{display:flex;justify-content:center;padding:64px}
@keyframes spin{to{transform:rotate(360deg)}}
.vault-tag{font-size:10px;font-weight:600;background:rgba(91,94,244,.12);color:var(--indigo);border:1px solid rgba(91,94,244,.25);border-radius:99px;padding:1px 6px;margin-right:4px}
.profit{color:var(--green);font-weight:600}
.loss{color:var(--red);font-weight:600}
a.plain{color:inherit;text-decoration:none}
a.plain:hover{color:var(--indigo)}
</style>
</head>
<body>
<div id="app"></div>
<div id="modal-root"></div>
<div id="toast-root" style="position:fixed;bottom:24px;right:24px;z-index:300;display:flex;flex-direction:column;gap:8px;align-items:flex-end"></div>

<script>
// ── SVG icons ──────────────────────────────────────────────
const SVG = {
  overview: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" stroke-width="1.3"/></svg>',
  users:    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="6" cy="5" r="2.5" stroke="currentColor" stroke-width="1.3"/><circle cx="11" cy="5" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M1 14c0-3.3 2.2-5 5-5m9 0c0-3.3-2.2-5-5-5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  reports:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M3 2h10v9l-5 3-5-3V2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 5.5v3M8 10h.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  revenue:  '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M5 5h4.5a2 2 0 0 1 0 4H5m0-4V5m0 4v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  config:   '<svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.64 3.64l1.06 1.06M11.3 11.3l1.06 1.06M3.64 12.36l1.06-1.06M11.3 4.7l1.06-1.06" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  lock:     '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><rect x="2" y="6" width="10" height="7" rx="1.3" stroke="currentColor" stroke-width="1.3"/><path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
  drop:     '<svg width="26" height="26" viewBox="0 0 28 28" fill="none"><rect width="28" height="28" rx="7" fill="#5B5EF4"/><path d="M11 4h6v10h4l-7 8-7-8h4z" fill="white"/></svg>',
};

// ── State ──────────────────────────────────────────────────
let session = localStorage.getItem('dd_admin_session') || null;
let tab = 'overview';
let userPage = 1, userQ = '', userSt = '';
let repStatus = 'open';
let configRows = [];

// ── API ────────────────────────────────────────────────────
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (session) headers['X-Admin-Session'] = session;
  const r = await fetch('/admin' + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) { signOut(); return null; }
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'Request failed (' + r.status + ')');
  }
  return r.json();
}

// ── Boot ───────────────────────────────────────────────────
function boot() {
  if (!session) { renderLogin(); return; }
  renderLayout();
  goTab(tab);
}

// ── Login ──────────────────────────────────────────────────
function renderLogin() {
  document.getElementById('app').innerHTML = \`
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo">
          \${SVG.drop}
          <div class="wordmark"><span class="d">Data</span><span class="dp">Drop</span> <span class="admin-badge" style="font-size:10px;vertical-align:middle">Admin</span></div>
        </div>
        <div class="login-sub">Restricted access — authorised personnel only</div>
        <form id="lf">
          <input type="text" id="lid" placeholder="Admin username" autocomplete="username" autofocus />
          <input type="password" id="lpw" placeholder="Admin password" autocomplete="current-password" />
          <button type="submit" class="btn-login" id="lbtn">Sign in</button>
        </form>
        <div class="login-err" id="lerr"></div>
      </div>
    </div>\`;
  document.getElementById('lf').onsubmit = async (e) => {
    e.preventDefault();
    const lerr = document.getElementById('lerr');
    const lbtn = document.getElementById('lbtn');
    lerr.textContent = '';
    lbtn.textContent = 'Signing in…';
    lbtn.disabled = true;
    try {
      const r = await fetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('lid').value.trim(),
          password: document.getElementById('lpw').value,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { lerr.textContent = data.error || 'Invalid credentials'; lbtn.textContent = 'Sign in'; lbtn.disabled = false; return; }
      session = data.token;
      localStorage.setItem('dd_admin_session', session);
      renderLayout();
      goTab('overview');
    } catch (err) {
      lerr.textContent = err.message;
      lbtn.textContent = 'Sign in';
      lbtn.disabled = false;
    }
  };
}

function signOut() {
  session = null;
  localStorage.removeItem('dd_admin_session');
  document.getElementById('app').innerHTML = '';
  renderLogin();
}

// ── Layout ─────────────────────────────────────────────────
const TABS = [
  { id: 'overview', icon: 'overview', label: 'Overview' },
  { id: 'users',    icon: 'users',    label: 'Users' },
  { id: 'reports',  icon: 'reports',  label: 'Reports' },
  { id: 'revenue',  icon: 'revenue',  label: 'Revenue' },
  { id: 'config',   icon: 'config',   label: 'Config' },
];

function renderLayout() {
  document.getElementById('app').innerHTML = \`
    <div class="layout">
      <div class="sidebar">
        <div class="sidebar-logo">
          \${SVG.drop}
          <div class="wm"><span class="d">Data</span><span class="dp">Drop</span></div>
          <span class="admin-badge">Admin</span>
        </div>
        <div class="sidebar-nav" id="sidebar-nav"></div>
        <div class="sidebar-footer">
          <button class="logout-btn" onclick="signOut()">Sign out</button>
        </div>
      </div>
      <div class="main" id="main"></div>
    </div>\`;
  renderSidebar();
}

function renderSidebar() {
  document.getElementById('sidebar-nav').innerHTML = TABS.map(t => \`
    <div class="nav-item \${tab === t.id ? 'active' : ''}" onclick="goTab('\${t.id}')">
      <span class="nav-icon">\${SVG[t.icon]}</span>\${t.label}
    </div>\`).join('');
}

function setMain(html) {
  const el = document.getElementById('main');
  if (el) el.innerHTML = html;
}

function goTab(t) {
  tab = t;
  renderSidebar();
  const fns = { overview: loadOverview, users: loadUsers, reports: loadReports, revenue: loadRevenue, config: loadConfig };
  setMain('<div class="loading-center"><div class="spinner"></div></div>');
  fns[t]();
}

// ── Overview ───────────────────────────────────────────────
async function loadOverview() {
  const [d, rev] = await Promise.all([api('GET', '/overview'), api('GET', '/revenue?months=1')]);
  if (!d) return;
  const u = d.users || {}, s = d.storage || {}, rr = d.reports || {};
  const monthly = (rev && rev.monthly) || [];
  const thisMonth = monthly[0] || {};
  const wf = (rev && rev.walletFloat) || 0;

  // Per-user averages
  const activeTotal = (u.active_users || 0) + (u.trial_users || 0);
  const avgStorageGb = activeTotal > 0 && s.total_gb ? (parseFloat(s.total_gb) / activeTotal) : 0;
  const avgRevPerUser = activeTotal > 0 && thisMonth.total_rev ? (thisMonth.total_rev / activeTotal) : 0;
  const trialConvRate = u.total_users > 0 ? ((u.active_users || 0) / u.total_users * 100) : 0;

  // Infra cost estimate: B2 ~$0.006/GB/month, Workers ~$0.15/M req
  const storageGb = parseFloat(s.total_gb) || 0;
  const infraCostEst = storageGb * 0.006 * 83; // USD→INR ≈83
  const grossProfit = (thisMonth.total_rev || 0) - infraCostEst;

  const kpis = [
    ['Total Users',        fmt(u.total_users),           u.total_users > 0 ? \`+\${fmt(Math.max(0,u.total_users - (u.total_users||0)))} this month\` : ''],
    ['Active (Billing)',   fmt(u.active_users),           'wallet billing'],
    ['In Trial',           fmt(u.trial_users),            '7-day free trial'],
    ['Trial → Paid Rate',  trialConvRate.toFixed(1) + '%','conversion'],
    ['Suspended',          fmt(u.suspended_users),        'access revoked'],
  ];

  const storageCards = [
    ['Total Storage',      gb(s.total_gb),                fmt(s.total_files) + ' files'],
    ['Cold Storage',       gb(s.b2_cold_gb),              'standard tier'],
    ['Vault (ZK)',         gb(s.b2_vault_gb),             'zero-knowledge'],
    ['Avg per User',       avgStorageGb < 0.001 ? '<1 MB' : avgStorageGb.toFixed(2) + ' GB', 'across active users'],
  ];

  const bizCards = [
    ['This Month Rev',     '₹' + (thisMonth.total_rev||0).toFixed(2),    'storage + ad-free'],
    ['Wallet Float',       '₹' + wf.toFixed(2),                          'pre-paid, unbilled'],
    ['Infra Cost (est)',   '₹' + infraCostEst.toFixed(2),                'B2 storage cost'],
    ['Gross Profit (est)', '₹' + grossProfit.toFixed(2),                 grossProfit >= 0 ? 'positive margin' : 'negative — scale needed'],
    ['Avg Rev / User',     '₹' + avgRevPerUser.toFixed(2),               'per active user/month'],
    ['Open Reports',       fmt(rr.open_reports),                          'pending moderation'],
  ];

  function section(title, cards) {
    return \`
      <div style="margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--textT);margin-bottom:10px">\${title}</div>
        <div class="stat-grid">\${cards.map(([label, val, sub]) => \`
          <div class="stat-card">
            <div class="stat-label">\${label}</div>
            <div class="stat-value">\${val}</div>
            \${sub ? \`<div class="stat-sub">\${sub}</div>\` : ''}
          </div>\`).join('')}
        </div>
      </div>\`;
  }

  // Business strategy panel
  const activePct = u.total_users > 0 ? ((u.active_users||0)/u.total_users*100).toFixed(0) : 0;
  const trialPct  = u.total_users > 0 ? ((u.trial_users||0)/u.total_users*100).toFixed(0) : 0;
  const insight = [];
  if (trialConvRate < 15) insight.push('Trial-to-paid conversion <15% — consider reducing friction, adding onboarding emails, or shortening trial to 5 days to create urgency.');
  if (avgStorageGb > 2) insight.push('Avg storage >2 GB/user — healthy engagement. Consider tiered pricing nudges at 5 GB threshold.');
  if (infraCostEst > (thisMonth.total_rev || 0)) insight.push('Infra cost exceeds revenue this period — may be early stage or underpriced. Target ₹3–5/GB/month for positive margin.');
  if ((u.suspended_users||0) > (u.active_users||0) * 0.05) insight.push('Suspension rate >5% — investigate abuse patterns in reports.');
  if (wf > (thisMonth.total_rev || 0) * 2) insight.push('Wallet float 2× monthly revenue — cash-efficient. Ensure billing cron is running correctly.');
  if (!insight.length) insight.push('All metrics within normal range. Focus on growing trial signups and improving conversion.');

  setMain(\`
    <div class="page-title">Overview</div>
    <div class="page-sub">Business intelligence dashboard · refreshes on tab change</div>
    \${rr.open_reports > 0
      ? \`<div class="alert alert-red">\${rr.open_reports} open report(s) require moderation. <a href="#" class="plain" style="font-weight:600" onclick="goTab('reports');return false">Review now →</a></div>\`
      : ''}

    \${section('Users', kpis)}
    \${section('Storage', storageCards)}
    \${section('Revenue &amp; Business', bizCards)}

    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--textT);margin-bottom:14px">Strategy &amp; Insights</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        \${insight.map(i => \`
          <div style="display:flex;gap:10px;align-items:flex-start;font-size:13px;color:var(--textS);line-height:1.6;padding:10px 12px;background:var(--bg4);border-radius:8px;border:1px solid var(--border)">
            <span style="color:var(--indigo);flex-shrink:0;font-weight:700">→</span>
            <span>\${i}</span>
          </div>\`).join('')}
      </div>
    </div>

    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:12px;padding:20px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--textT);margin-bottom:14px">Unit Economics (Current)</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);border-radius:8px;overflow:hidden">
        \${[
          ['Revenue / GB stored', storageGb > 0 ? '₹' + ((thisMonth.total_rev||0)/storageGb).toFixed(2) : '—', '/GB stored/month'],
          ['Cost / GB stored',   '₹' + (storageGb > 0 ? (infraCostEst/storageGb).toFixed(3) : '0'), 'B2 infra only'],
          ['User Acquisition',   'Organic', 'no paid ads yet'],
        ].map(([k,v,s]) => \`
          <div style="background:var(--bg4);padding:14px 16px">
            <div style="font-size:10px;color:var(--textT);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">\${k}</div>
            <div style="font-family:var(--mono);font-size:18px;font-weight:700;color:var(--textP)">\${v}</div>
            <div style="font-size:11px;color:var(--textS);margin-top:3px">\${s}</div>
          </div>\`).join('')}
      </div>
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
        <td>\${esc(u.display_name || '-')}</td>
        <td>\${esc(u.username || '-')}</td>
        <td>\${badge(u.status)}</td>
        <td class="mono">₹\${(u.wallet_balance || 0).toFixed(2)}</td>
        <td style="color:var(--textS)">\${fmtDate(u.created_at)}</td>
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
          \${['trial','active','read_only','suspended','deleted'].map(s => \`<option value="\${s}" \${userSt===s?'selected':''}>\${s.replace(/_/g,' ')}</option>\`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="applyUF()">Search</button>
      </div>
      <table>
        <thead><tr><th>Email</th><th>Display Name</th><th>Username</th><th>Status</th><th>Wallet</th><th>Joined</th><th></th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
      <div class="pagination">
        <button class="page-btn" \${userPage<=1?'disabled':''} onclick="userPage--;loadUsers()">← Prev</button>
        <span class="page-info">Page \${userPage}</span>
        <button class="page-btn" \${users.length<50?'disabled':''} onclick="userPage++;loadUsers()">Next →</button>
      </div>
    </div>\`);
}

function applyUF() {
  userQ = document.getElementById('uq').value.trim();
  userSt = document.getElementById('ust').value;
  userPage = 1;
  loadUsers();
}

async function showUser(userId) {
  const d = await api('GET', '/users/' + userId);
  if (!d) return;
  const u = d.user, s = d.fileStats;
  const susp = u.status === 'suspended';

  modal(\`
    <div class="modal-head"><h2>User Detail</h2><button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="modal-body">
      \${row('Email', esc(u.email))}
      \${row('Display Name', esc(u.display_name || '-'))}
      \${row('Username', esc(u.username || '-'))}
      \${row('Status', badge(u.status))}
      \${row('Wallet Balance', '<span class="mono">₹' + (u.wallet_balance||0).toFixed(2) + '</span>')}
      \${row('Wallet Limit', '<span class="mono">₹' + (u.wallet_limit||0).toFixed(2) + '</span>')}
      \${row('Trial Ends', u.trial_ends_at ? fmtDate(u.trial_ends_at) : '-')}
      \${row('Ad-Free', u.adfree_until ? 'Active until ' + fmtDate(u.adfree_until) : 'No')}
      \${row('Joined', fmtDate(u.created_at))}
      \${row('Files', fmt(s && s.count))}
      \${row('Storage', gb(s && s.total_gb))}
      \${u.suspension_reason ? row('Suspension Reason', '<span style="color:var(--red)">' + esc(u.suspension_reason) + '</span>') : ''}
      \${!susp ? '<div style="margin-top:16px"><input id="sreason" class="search-input" placeholder="Reason for suspension (optional)" style="width:100%;font-family:inherit" /></div>' : ''}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
      \${susp
        ? \`<button class="btn btn-success" onclick="doRestore('\${u.id}')">Restore Account</button>\`
        : \`<button class="btn btn-danger" onclick="doSuspend('\${u.id}')">Suspend User</button>\`}
    </div>\`);
}

async function doSuspend(id) {
  const reason = (document.getElementById('sreason') || {}).value || 'Admin action';
  try { await api('POST', '/users/' + id + '/suspend', { reason }); closeModal(); toast('User suspended'); loadUsers(); }
  catch(e) { toast(e.message, true); }
}
async function doRestore(id) {
  try { await api('POST', '/users/' + id + '/restore', {}); closeModal(); toast('Account restored'); loadUsers(); }
  catch(e) { toast(e.message, true); }
}

// ── Reports ────────────────────────────────────────────────
async function loadReports() {
  const d = await api('GET', '/reports?status=' + repStatus);
  if (!d) return;
  const reps = d.reports || [];

  const statuses = ['open','resolved_restored','resolved_deleted','resolved_suspended'];
  const btns = statuses.map(s => \`<button class="btn \${repStatus===s?'btn-primary':'btn-ghost'} btn-sm" onclick="repStatus='\${s}';loadReports()">\${s.replace(/_/g,' ')}</button>\`).join('');

  const rows = reps.length === 0
    ? '<tr><td colspan="8" class="empty">No reports</td></tr>'
    : reps.map(r => \`<tr>
        <td>\${r.is_vault ? '<span class="vault-tag">Vault</span>' : ''}\${esc(r.filename || 'Unknown')}</td>
        <td style="color:var(--textS)">\${esc(r.reporter_name || '-')}</td>
        <td style="color:var(--textS)">\${esc(r.uploader_name || '-')}</td>
        <td style="color:var(--textS);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${esc(r.reason || '-')}</td>
        <td>
          \${r.evidence_url
            ? \`<img src="/admin/evidence/\${r.id}?token=\${encodeURIComponent(session)}" alt="Evidence"
                style="width:72px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer;background:var(--bg4)"
                onclick="window.open('/admin/evidence/\${r.id}?token='+encodeURIComponent(session),'_blank')"
                onerror="this.style.display='none'">\`
            : '<span style="color:var(--textT);font-size:11px">None</span>'}
        </td>
        <td style="color:var(--textT)">\${fmtDate(r.created_at)}</td>
        <td>\${badge(r.status)}</td>
        <td>
          \${r.status === 'open' ? \`
            <div class="btn-group">
              <button class="btn btn-success btn-sm" onclick="resolve('\${r.id}','restore')">Restore</button>
              <button class="btn btn-danger btn-sm" onclick="resolve('\${r.id}','delete')">Delete</button>
              <button class="btn btn-ghost btn-sm" onclick="resolve('\${r.id}','suspend')">Suspend</button>
            </div>\` : '-'}
        </td>
      </tr>\`).join('');

  setMain(\`
    <div class="page-title">Reports</div>
    <div class="btn-group" style="margin-bottom:20px">\${btns}</div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>File</th><th>Reporter</th><th>Uploader</th><th>Reason</th><th>Evidence</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
    </div>\`);
}

async function resolve(id, action) {
  const labels = { restore: 'Restore file access', delete: 'Permanently delete file', suspend: 'Suspend uploader account' };
  if (!confirm(labels[action] + '\\n\\nAre you sure?')) return;
  try {
    await api('POST', '/reports/' + id + '/' + action, {});
    toast('Report resolved: ' + action);
    loadReports();
  } catch(e) { toast(e.message, true); }
}

// ── Revenue ────────────────────────────────────────────────
async function loadRevenue() {
  const [rev, pnlData] = await Promise.all([api('GET', '/revenue?months=6'), api('GET', '/pnl')]);
  if (!rev || !pnlData) return;

  const monthly = rev.monthly || [];
  const pnl = pnlData.pnl || [];
  const wf = rev.walletFloat || 0;

  const revRows = monthly.length === 0
    ? '<tr><td colspan="5" class="empty">No billing data yet</td></tr>'
    : monthly.map(m => \`<tr>
        <td class="mono" style="color:var(--textS)">\${m.month}</td>
        <td class="mono">₹\${(m.storage_rev||0).toFixed(2)}</td>
        <td class="mono">₹\${(m.adfree_rev||0).toFixed(2)}</td>
        <td class="mono" style="font-weight:700">₹\${(m.total_rev||0).toFixed(2)}</td>
        <td style="color:var(--textS)">\${fmt(m.paid_users)}</td>
      </tr>\`).join('');

  const pRows = pnl.length === 0
    ? '<tr><td colspan="5" class="empty">No data</td></tr>'
    : pnl.map(m => \`<tr>
        <td class="mono" style="color:var(--textS)">\${m.month}</td>
        <td class="mono">₹\${(m.revenue||0).toFixed(2)}</td>
        <td class="mono" style="color:var(--textS)">₹\${(m.cost||0).toFixed(2)}</td>
        <td class="mono \${(m.gross||0)>=0?'profit':'loss'}">₹\${(m.gross||0).toFixed(2)}</td>
        <td class="mono" style="color:var(--textS)">\${m.margin}%</td>
      </tr>\`).join('');

  setMain(\`
    <div class="page-title">Revenue &amp; P&amp;L</div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Wallet Float</div>
        <div class="stat-value">₹\${wf.toFixed(2)}</div>
        <div class="stat-sub">pre-paid, unbilled</div>
      </div>
    </div>
    <div class="table-wrap">
      <div class="table-head"><span class="table-title">Monthly Revenue (last 6 months)</span></div>
      <table><thead><tr><th>Month</th><th>Storage</th><th>Ad-Free</th><th>Total</th><th>Paid Users</th></tr></thead>
      <tbody>\${revRows}</tbody></table>
    </div>
    <div class="table-wrap">
      <div class="table-head"><span class="table-title">P&amp;L Summary</span></div>
      <table><thead><tr><th>Month</th><th>Revenue</th><th>Infra Cost</th><th>Gross Profit</th><th>Margin</th></tr></thead>
      <tbody>\${pRows}</tbody></table>
    </div>\`);
}

// ── Config ─────────────────────────────────────────────────
async function loadConfig() {
  const d = await api('GET', '/config');
  if (!d) return;
  configRows = d.config || [];

  const rows = configRows.length === 0
    ? '<tr><td colspan="4" class="empty">No config keys</td></tr>'
    : configRows.map((c, i) => \`<tr>
        <td class="mono" style="font-weight:600;white-space:nowrap;color:var(--indigo)">\${esc(c.key)}</td>
        <td><input class="config-input" data-i="\${i}" value="\${esc(c.value)}" onkeydown="if(event.key==='Enter')saveConf(\${i})" /></td>
        <td style="color:var(--textT);white-space:nowrap">\${fmtDate(c.updated_at)}</td>
        <td><button class="btn btn-primary btn-sm" onclick="saveConf(\${i})">Save</button></td>
      </tr>\`).join('');

  setMain(\`
    <div class="page-title">Configuration</div>
    <div class="page-sub">System config stored in D1. Changes take effect immediately.</div>
    <div class="table-wrap">
      <table><thead><tr><th>Key</th><th>Value</th><th>Updated</th><th></th></tr></thead>
      <tbody>\${rows}</tbody></table>
    </div>\`);
}

async function saveConf(i) {
  const inp = document.querySelector('[data-i="' + i + '"]');
  if (!inp) return;
  try {
    await api('PUT', '/config', { key: configRows[i].key, value: inp.value });
    toast(configRows[i].key + ' saved');
    loadConfig();
  } catch(e) { toast(e.message, true); }
}

// ── Modal ──────────────────────────────────────────────────
function modal(html) {
  document.getElementById('modal-root').innerHTML =
    '<div class="modal-overlay" onclick="if(event.target.classList.contains(\\'modal-overlay\\'))closeModal()"><div class="modal">' + html + '</div></div>';
}
function closeModal() { document.getElementById('modal-root').innerHTML = ''; }

// ── Toast ──────────────────────────────────────────────────
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    padding: '10px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
    background: err ? 'rgba(226,75,74,.12)' : 'rgba(0,194,124,.12)',
    color: err ? '#E24B4A' : '#00C27C',
    border: err ? '1px solid rgba(226,75,74,.25)' : '1px solid rgba(0,194,124,.25)',
    boxShadow: '0 8px 28px rgba(0,0,0,.4)', maxWidth: '340px',
    fontFamily: 'Inter,sans-serif',
    animation: 'slideUp .2s ease',
  });
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Helpers ────────────────────────────────────────────────
function fmt(n) { return n != null ? Number(n).toLocaleString('en-IN') : '0'; }
function gb(n) {
  if (!n || parseFloat(n) === 0) return '0 GB';
  const g = parseFloat(n);
  return g < 0.001 ? '<1 MB' : g < 1 ? (g * 1000).toFixed(0) + ' MB' : g.toFixed(2) + ' GB';
}
function fmtDate(ts) {
  if (!ts) return '-';
  const d = new Date(typeof ts === 'number' ? ts : parseInt(ts) || ts);
  return isNaN(d) ? String(ts) : d.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function row(label, value) {
  return '<div class="field-row"><span class="field-label">' + label + '</span><span class="field-value">' + value + '</span></div>';
}
function badge(s) {
  const m = { active:'badge-green', trial:'badge-blue', read_only:'badge-yellow', suspended:'badge-red', deleted:'badge-gray',
               open:'badge-yellow', resolved_restored:'badge-green', resolved_deleted:'badge-red', resolved_suspended:'badge-red' };
  return '<span class="badge ' + (m[s] || 'badge-gray') + '">' + (s || '-').replace(/_/g,' ') + '</span>';
}

boot();
</script>
</body>
</html>`;
