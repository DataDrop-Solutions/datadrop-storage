// ============================================================
// DataDrop — Admin Worker
// Served from: admin.datadrop.co.in
// Password protected — your eyes only
// ============================================================

import { corsResponse, handleOptions, calcStorageCost, sendEmail } from '../shared/utils.js';
import { DASHBOARD_HTML } from './dashboard.js';

const ADMIN_CORS = {
  'Access-Control-Allow-Origin': 'https://admin.datadrop.co.in',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Session',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: ADMIN_CORS });
    }

    const url = new URL(request.url);

    // Serve admin dashboard SPA at root
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
      return new Response(DASHBOARD_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Allow login endpoint without session
    if (url.pathname === '/admin/login' && request.method === 'POST') {
      try {
        return await handleLogin(request, env);
      } catch (_) {
        return adminJson({ error: 'Internal error' }, 500);
      }
    }

    // Admin auth for all other routes
    // Accept X-Admin-Session header (API calls) OR ?token= query param (img tag requests)
    const adminSession = request.headers.get('X-Admin-Session') || url.searchParams.get('token');
    const valid = await validateAdminSession(adminSession, env);
    if (!valid) {
      return adminJson({ error: 'Unauthorized' }, 401);
    }

    const path = url.pathname.replace('/admin', '');

    try {
      // Config
      if (path === '/config' && request.method === 'GET')  return await getConfig(env);
      if (path === '/config' && request.method === 'PUT')  return await updateConfig(request, env);

      // Users
      if (path === '/users' && request.method === 'GET')           return await getUsers(url, env);
      if (path.match(/^\/users\/[^/]+$/) && request.method === 'GET')   return await getUser(path, env);
      if (path.match(/^\/users\/[^/]+\/suspend$/) && request.method === 'POST') return await suspendUser(path, request, env);
      if (path.match(/^\/users\/[^/]+\/restore$/) && request.method === 'POST') return await restoreUser(path, env);

      // Files (Standard storage only — Vault files never opened)
      if (path.match(/^\/files\/[^/]+$/) && request.method === 'GET') return await getFile(path, request, env);

      // Reports / moderation
      if (path === '/reports' && request.method === 'GET')                       return await getReports(url, env);
      if (path.match(/^\/reports\/[^/]+\/restore$/) && request.method === 'POST')  return await resolveReport(path, 'restore', env);
      if (path.match(/^\/reports\/[^/]+\/delete$/)  && request.method === 'POST')  return await resolveReport(path, 'delete', env);
      if (path.match(/^\/reports\/[^/]+\/suspend$/) && request.method === 'POST')  return await resolveReport(path, 'suspend', env);
      if (path.match(/^\/evidence\/[^/]+$/) && request.method === 'GET')          return await getEvidence(path, env, request);

      // Revenue & costs
      if (path === '/revenue' && request.method === 'GET') return await getRevenue(url, env);
      if (path === '/costs'   && request.method === 'GET') return await getCosts(env);
      if (path === '/pnl'     && request.method === 'GET') return await getPnL(env);

      // Dashboard overview
      if (path === '/overview' && request.method === 'GET') return await getOverview(env);

      return adminJson({ error: 'Not found' }, 404);
    } catch (_) {
      return adminJson({ error: 'Internal error' }, 500);
    }
  },
};

// ---------- Auth ----------
async function handleLogin(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const attemptKey = `admin_login_attempts:${ip}`;

  // Brute force protection: 5 failed attempts per IP → 15-minute lockout
  let attempts = 0;
  try { attempts = parseInt(await env.KV.get(attemptKey) || '0'); } catch (_) {}
  if (attempts >= 5) {
    return adminJson({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  const { username, password } = body;
  const validUser = username && env.ADMIN_USERNAME && username.trim() === env.ADMIN_USERNAME.trim();
  const validPass = password && env.ADMIN_PASSWORD && password.trim() === env.ADMIN_PASSWORD.trim();
  if (!validUser || !validPass) {
    try { await env.KV.put(attemptKey, String(attempts + 1), { expirationTtl: 900 }); } catch (_) {}
    return adminJson({ error: 'Invalid credentials' }, 401);
  }

  // Success — clear attempt counter
  try { await env.KV.delete(attemptKey); } catch (_) {}
  const token = crypto.randomUUID();
  await env.KV.put(`admin_session:${token}`, '1', { expirationTtl: 28800 }); // 8h
  return adminJson({ token });
}

async function validateAdminSession(token, env) {
  if (!token) return false;
  const val = await env.KV.get(`admin_session:${token}`);
  return val === '1';
}

// ---------- Config ----------
async function getConfig(env) {
  const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM config ORDER BY key').all();
  return adminJson({ config: results });
}

async function updateConfig(request, env) {
  const { key, value } = await request.json();
  if (!key || value === undefined) return adminJson({ error: 'key and value required' }, 400);

  await env.DB.prepare(
    'UPDATE config SET value = ?, updated_at = ? WHERE key = ?'
  ).bind(String(value), Date.now(), key).run();

  // Invalidate KV cache immediately
  await env.KV.delete(`config:${key}`);

  return adminJson({ success: true, key, value });
}

// ---------- Users ----------
async function getUsers(url, env) {
  const page    = parseInt(url.searchParams.get('page') || '1');
  const limit   = 50;
  const offset  = (page - 1) * limit;
  const search  = url.searchParams.get('q') || '';
  const status  = url.searchParams.get('status') || '';

  let query = 'SELECT id, email, display_name, username, status, wallet_balance, wallet_limit, created_at FROM users';
  const binds = [];

  const conditions = [];
  if (search) { conditions.push("(email LIKE ? OR display_name LIKE ? OR username LIKE ?)"); binds.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { conditions.push('status = ?'); binds.push(status); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return adminJson({ users: results, page, limit });
}

async function getUser(path, env) {
  const userId = path.split('/')[2];
  const [user, fileStats, usageRow] = await Promise.all([
    env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first(),
    env.DB.prepare(
      'SELECT COUNT(*) as count, SUM(size_gb) as total_gb FROM files WHERE user_id = ? AND deleted_at IS NULL'
    ).bind(userId).first(),
    env.DB.prepare(
      'SELECT current_bytes, accumulated_byte_seconds, last_updated_at, billing_month FROM storage_usage WHERE user_id = ?'
    ).bind(userId).first(),
  ]);
  if (!user) return adminJson({ error: 'User not found' }, 404);

  let storage_usage = null;
  if (usageRow) {
    const GB = 1073741824;
    const now = Date.now();
    const elapsed = Math.max(0, (now - usageRow.last_updated_at) / 1000);
    const currentAcc = usageRow.accumulated_byte_seconds + (usageRow.current_bytes * elapsed);
    const [yr, mo] = (usageRow.billing_month || '2026-01').split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const gbMonths = (currentAcc / GB) / 86400 / daysInMonth;
    storage_usage = {
      current_bytes: usageRow.current_bytes,
      current_gb: usageRow.current_bytes / GB,
      accumulated_byte_seconds: usageRow.accumulated_byte_seconds,
      gb_months_so_far: gbMonths,
      last_updated_at: usageRow.last_updated_at,
      billing_month: usageRow.billing_month,
    };
  }

  return adminJson({ user, fileStats, storage_usage });
}

async function suspendUser(path, request, env) {
  const userId = path.split('/')[2];
  const { reason } = await request.json();
  await env.DB.prepare(
    "UPDATE users SET status = 'suspended', suspension_reason = ? WHERE id = ?"
  ).bind(reason || 'Admin action', userId).run();
  return adminJson({ success: true });
}

async function restoreUser(path, env) {
  const userId = path.split('/')[2];
  await env.DB.prepare(
    "UPDATE users SET status = 'active', suspension_reason = NULL WHERE id = ?"
  ).bind(userId).run();
  return adminJson({ success: true });
}

// ---------- File viewer (Standard storage only) ----------
async function getFile(path, request, env) {
  const fileId = path.split('/')[2];
  const file   = await env.DB.prepare(
    'SELECT * FROM files WHERE id = ?'
  ).bind(fileId).first();

  if (!file) return adminJson({ error: 'File not found' }, 404);

  // NEVER serve vault files — return metadata only
  if (file.is_vault) {
    return adminJson({
      vaultFile: true,
      metadata: {
        id: file.id,
        filename: file.filename,
        size_bytes: file.size_bytes,
        created_at: file.created_at,
        user_id: file.user_id,
      },
    });
  }

  // Serve standard file bytes for moderation
  const { getB2Auth } = await import('../shared/utils.js');

  let fileResp;
  {
    const auth = await getB2Auth(env.B2_COLD_KEY_ID, env.B2_COLD_APP_KEY);
    const url  = `${auth.downloadUrl}/file/${env.B2_COLD_BUCKET}/${encodeURIComponent(file.storage_key)}`;
    fileResp   = await fetch(url, { headers: { Authorization: auth.authorizationToken } });
    if (!fileResp.ok) return adminJson({ error: 'Storage error' }, 503);
    return new Response(fileResp.body, {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${file.filename}"`,
        ...ADMIN_CORS,
      },
    });
  }
}

// ---------- Evidence viewer (serves screenshot from B2 via admin proxy) ----------
async function getEvidence(path, env, request) {
  const reportId = path.split('/')[2];
  const report = await env.DB.prepare('SELECT evidence_url FROM reports WHERE id = ?').bind(reportId).first();
  if (!report) return adminJson({ error: 'Report not found' }, 404);

  const url = report.evidence_url;
  if (!url?.startsWith('internal://b2-cold/')) return adminJson({ error: 'No evidence on file' }, 404);

  const key = url.slice('internal://b2-cold/'.length);
  const { getB2Auth } = await import('../shared/utils.js');
  const auth = await getB2Auth(env.B2_COLD_KEY_ID, env.B2_COLD_APP_KEY);
  const downloadUrl = `${auth.downloadUrl}/file/${env.B2_COLD_BUCKET}/${encodeURIComponent(key)}`;
  const resp = await fetch(downloadUrl, { headers: { Authorization: auth.authorizationToken } });
  if (!resp.ok) return adminJson({ error: 'Evidence fetch failed' }, 503);

  const mime = resp.headers.get('Content-Type') || 'image/png';
  return new Response(resp.body, { headers: { 'Content-Type': mime, ...ADMIN_CORS } });
}

// ---------- Reports / moderation ----------
async function getReports(url, env) {
  const status = url.searchParams.get('status') || 'open';
  const { results } = await env.DB.prepare(`
    SELECT r.*, f.filename, f.is_vault, f.user_id as file_owner_id,
           rep.display_name as reporter_name,
           upl.display_name as uploader_name
    FROM reports r
    LEFT JOIN files f ON f.id = r.file_id
    LEFT JOIN users rep ON rep.id = r.reporter_id
    LEFT JOIN users upl ON upl.id = r.uploader_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC
  `).bind(status).all();
  return adminJson({ reports: results });
}

async function resolveReport(path, action, env) {
  const reportId = path.split('/')[2];
  const report   = await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(reportId).first();
  if (!report) return adminJson({ error: 'Report not found' }, 404);

  const now       = Date.now();
  let newStatus, fileAction;

  if (action === 'restore') {
    newStatus  = 'resolved_restored';
    fileAction = () => env.DB.prepare(
      'UPDATE files SET accessible = 1 WHERE id = ?'
    ).bind(report.file_id).run();

  } else if (action === 'delete') {
    newStatus  = 'resolved_deleted';
    fileAction = async () => {
      const [file, owner] = await Promise.all([
        env.DB.prepare('SELECT filename FROM files WHERE id = ?').bind(report.file_id).first(),
        env.DB.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(report.uploader_id).first(),
      ]);
      await env.DB.prepare(
        'UPDATE files SET deleted_at = ?, accessible = 0 WHERE id = ?'
      ).bind(now, report.file_id).run();
      await env.QUEUE.send({
        type: 'DELETE_FILE_FROM_BUCKET',
        fileId: report.file_id,
        deleteFromD1: false, // keep D1 record for audit
      });
      if (owner?.email) {
        await sendEmail(env, {
          to: owner.email,
          subject: 'DataDrop: A file has been removed from your account',
          html: `<p>Hi ${owner.display_name || 'there'},</p>
                 <p>Following a review, the following file has been removed from your DataDrop account for violating our content policy:</p>
                 <p><strong>${file?.filename || 'A file'}</strong></p>
                 <p>If you believe this was a mistake, please contact us at <a href="mailto:support@datadrop.co.in">support@datadrop.co.in</a>.</p>`,
        });
      }
    };

  } else if (action === 'suspend') {
    newStatus  = 'resolved_suspended';
    fileAction = () => env.DB.prepare(
      "UPDATE users SET status = 'suspended', suspension_reason = 'Content violation' WHERE id = ?"
    ).bind(report.uploader_id).run();
  }

  await fileAction();
  await env.DB.prepare(
    'UPDATE reports SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?'
  ).bind(newStatus, now, now, reportId).run();

  return adminJson({ success: true, reportId, action });
}

// ---------- Revenue ----------
async function getRevenue(url, env) {
  const months = parseInt(url.searchParams.get('months') || '6');

  const { results: monthly } = await env.DB.prepare(`
    SELECT month,
           SUM(actual_usage_amount) as storage_rev,
           SUM(adfree_amount) as adfree_rev,
           SUM(teams_amount) as teams_rev,
           SUM(total_charged) as total_rev,
           COUNT(*) as paid_users
    FROM billing
    WHERE status = 'paid'
    GROUP BY month
    ORDER BY month DESC
    LIMIT ?
  `).bind(months).all();

  const { results: walletFloat } = await env.DB.prepare(
    'SELECT SUM(wallet_balance) as float FROM users WHERE status IN (\'active\', \'read_only\')'
  ).all();

  return adminJson({ monthly, walletFloat: walletFloat[0]?.float || 0 });
}

// ---------- Costs (pulled from CF GraphQL + B2 API) ----------
async function getCosts(env) {
  // Cloudflare GraphQL API for usage metrics
  const cfQuery = `{
    viewer {
      accounts(filter: { accountTag: "${env.CF_ACCOUNT_A_ID}" }) {
        workersInvocationsAdaptive(limit: 1, filter: { date_geq: "${thisMonthStart()}" }) {
          sum { requests }
        }
        r2StorageAdaptiveGroups(limit: 1, filter: { date_geq: "${thisMonthStart()}" }) {
          sum { objectCount storageBytes }
        }
      }
    }
  }`;

  let cfData = null;
  try {
    const resp = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: cfQuery }),
    });
    cfData = await resp.json();
  } catch {
    cfData = { error: 'CF API unavailable' };
  }

  // B2 costs from D1 storage metrics (approximation — B2 doesn't have a cost API)
  const b2Storage = await env.DB.prepare(
    "SELECT SUM(size_gb) as total_gb FROM files WHERE bucket IN ('b2_cold','b2_vault') AND deleted_at IS NULL"
  ).first();

  const b2StorageGb   = b2Storage?.total_gb || 0;
  const b2StorageCost = b2StorageGb * 0.006; // $0.006/GB/month ≈ ₹0.57/GB
  const b2EgressCost  = 0; // Zero via Bandwidth Alliance

  return adminJson({
    b2: { storageGb: b2StorageGb, storageCost: b2StorageCost, egressCost: b2EgressCost },
    cloudflare: cfData,
    estimates: {
      totalInfraRs: b2StorageCost * 100 + 0, // rough ₹ estimate; CF costs are minimal on free/paid plans
    },
  });
}

// ---------- P&L ----------
async function getPnL(env) {
  const { results: months } = await env.DB.prepare(`
    SELECT month, SUM(total_charged) as revenue
    FROM billing WHERE status = 'paid'
    GROUP BY month ORDER BY month DESC LIMIT 6
  `).all();

  const b2Storage = await env.DB.prepare(
    "SELECT SUM(size_gb) as total_gb FROM files WHERE bucket IN ('b2_cold','b2_vault') AND deleted_at IS NULL"
  ).first();

  const b2CostRs = (b2Storage?.total_gb || 0) * 0.006 * 100;

  const pnl = months.map(m => ({
    month:   m.month,
    revenue: m.revenue,
    cost:    b2CostRs, // simplified; full cost calc needs CF GraphQL
    gross:   m.revenue - b2CostRs,
    margin:  m.revenue > 0 ? ((m.revenue - b2CostRs) / m.revenue * 100).toFixed(1) : 0,
  }));

  return adminJson({ pnl });
}

// ---------- Overview ----------
async function getOverview(env) {
  const [totals, storage, reports, billingStats] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 'trial' THEN 1 ELSE 0 END) as trial_users,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended_users,
        SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) as deleted_users
      FROM users
    `).first(),
    env.DB.prepare(`
      SELECT
        SUM(size_gb) as total_gb,
        SUM(CASE WHEN bucket IN ('b2_cold','cold') THEN size_gb ELSE 0 END) as b2_cold_gb,
        SUM(CASE WHEN bucket IN ('b2_vault','vault') THEN size_gb ELSE 0 END) as b2_vault_gb,
        COUNT(*) as total_files
      FROM files WHERE deleted_at IS NULL
    `).first(),
    env.DB.prepare("SELECT COUNT(*) as open_reports FROM reports WHERE status = 'open'").first(),
    env.DB.prepare(`
      SELECT COALESCE(SUM(current_bytes), 0) as total_bytes,
             COALESCE(SUM(accumulated_byte_seconds), 0) as total_accumulated
      FROM storage_usage
    `).first(),
  ]);

  return adminJson({ users: totals, storage, reports, billing: billingStats });
}

// ---------- Helpers ----------
function adminJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...ADMIN_CORS },
  });
}

function thisMonthStart() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
