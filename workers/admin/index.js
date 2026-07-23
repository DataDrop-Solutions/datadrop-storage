// ============================================================
// DataDrop — Admin Worker
// Served from: admin.datadrop.co.in
// Password protected — your eyes only
// ============================================================

import { corsResponse, handleOptions, calcStorageCost, sendEmail, safeCompare } from '../shared/utils.js';
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
      if (path.match(/^\/users\/[^/]+\/resume$/)  && request.method === 'POST') return await resumeUser(path, env);

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

      // Infrastructure & health
      if (path === '/infra'            && request.method === 'GET') return await getInfra(env);
      if (path === '/health'           && request.method === 'GET') return await getHealth(env);
      if (path === '/growth'           && request.method === 'GET') return await getGrowth(env);
      if (path === '/billing-failures' && request.method === 'GET') return await getBillingFailures(env);

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
  const validUser = username && env.ADMIN_USERNAME && safeCompare(username.trim(), env.ADMIN_USERNAME.trim());
  const validPass = password && env.ADMIN_PASSWORD && safeCompare(password.trim(), env.ADMIN_PASSWORD.trim());
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

  let query = `SELECT u.id, u.email, u.display_name, u.username, u.status, u.created_at,
    EXISTS(SELECT 1 FROM wallet_mandates wm WHERE wm.user_id = u.id AND wm.status = 'active' AND wm.is_active = 1) as has_mandate,
    (SELECT b.status FROM billing b WHERE b.user_id = u.id ORDER BY b.billing_date DESC LIMIT 1) as last_bill_status,
    (SELECT b.total_charged FROM billing b WHERE b.user_id = u.id ORDER BY b.billing_date DESC LIMIT 1) as last_bill_amount
    FROM users u`;
  const binds = [];

  const conditions = [];
  if (search) { conditions.push("(u.email LIKE ? OR u.display_name LIKE ? OR u.username LIKE ?)"); binds.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { conditions.push('u.status = ?'); binds.push(status); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');

  query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return adminJson({ users: results, page, limit });
}

async function getUser(path, env) {
  const userId = path.split('/')[2];
  const [user, fileStats, usageRow, mandate, lastBill] = await Promise.all([
    env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first(),
    env.DB.prepare(
      'SELECT COUNT(*) as count, SUM(size_gb) as total_gb FROM files WHERE user_id = ? AND deleted_at IS NULL'
    ).bind(userId).first(),
    env.DB.prepare(
      'SELECT current_bytes, accumulated_byte_seconds, last_updated_at, billing_month FROM storage_usage WHERE user_id = ?'
    ).bind(userId).first(),
    env.DB.prepare(
      "SELECT razorpay_mandate_id, protection_limit, created_at, activated_at FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1 ORDER BY created_at DESC LIMIT 1"
    ).bind(userId).first(),
    env.DB.prepare(
      'SELECT month, status, total_charged, retry_count, next_retry_at, last_failure_reason, paid_at FROM billing WHERE user_id = ? ORDER BY billing_date DESC LIMIT 1'
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

  return adminJson({ user, fileStats, storage_usage, mandate: mandate || null, lastBill: lastBill || null });
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

async function resumeUser(path, env) {
  const userId = path.split('/')[2];
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!user) return adminJson({ error: 'User not found' }, 404);
  if (user.status !== 'deleted') return adminJson({ error: 'Account is not in deleted state' }, 400);

  const daysSinceDeletion = user.deleted_at ? (Date.now() - user.deleted_at) / 86400000 : Infinity;
  if (daysSinceDeletion > 30) {
    return adminJson({ error: 'Retention window expired — permanent deletion already completed' }, 400);
  }

  const now = Date.now();
  const isTrialValid = user.trial_ends_at && user.trial_ends_at > now;
  const newStatus = isTrialValid ? 'trial' : 'active';

  await env.DB.prepare(
    'UPDATE users SET status = ?, deleted_at = NULL, updated_at = ? WHERE id = ?'
  ).bind(newStatus, now, userId).run();

  await sendEmail(env, {
    to: user.email,
    subject: 'DataDrop: Your account has been reinstated',
    html: `<p>Hi ${user.display_name || 'there'},</p>
           <p>Your DataDrop account has been reinstated by our support team. You can now log in at <a href="https://app.datadrop.co.in">app.datadrop.co.in</a>.</p>
           <p>All your files that had not yet been permanently deleted are still available.</p>`,
  });

  return adminJson({ success: true, newStatus });
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

  {
    const { b2CredsForBucket } = await import('../shared/utils.js');
    const creds = b2CredsForBucket(env, file.bucket);
    const auth  = await getB2Auth(creds.keyId, creds.appKey);
    const dlUrl = `${auth.downloadUrl}/file/${creds.bucketName}/${encodeURIComponent(file.storage_key)}`;
    const fileResp = await fetch(dlUrl, { headers: { Authorization: auth.authorizationToken } });
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
  if (!url?.startsWith('internal://')) return adminJson({ error: 'No evidence on file' }, 404);

  const isMain = url.startsWith('internal://b2-main/');
  const prefix = isMain ? 'internal://b2-main/' : 'internal://b2-cold/';
  const key    = url.slice(prefix.length);

  const { getB2Auth, b2CredsForBucket } = await import('../shared/utils.js');
  const creds = b2CredsForBucket(env, isMain ? 'b2_main' : 'b2_cold');
  const auth  = await getB2Auth(creds.keyId, creds.appKey);
  const downloadUrl = `${auth.downloadUrl}/file/${creds.bucketName}/${encodeURIComponent(key)}`;
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
        'UPDATE files SET deleted_at = ?, accessible = 0, b2_delete_queued = 1 WHERE id = ?'
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

  const { results: mandateRow } = await env.DB.prepare(
    "SELECT COUNT(*) as n FROM wallet_mandates WHERE status = 'active' AND is_active = 1"
  ).all();

  return adminJson({ monthly, activeMandates: mandateRow[0]?.n || 0 });
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
    "SELECT SUM(size_gb) as total_gb FROM files WHERE deleted_at IS NULL"
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
    "SELECT SUM(size_gb) as total_gb FROM files WHERE deleted_at IS NULL"
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
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const [totals, storage, reports, billingStats, newUsers7d, failedBillingCount, zombieCount, thisMonthRev] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 'trial'     THEN 1 ELSE 0 END) as trial_users,
        SUM(CASE WHEN status = 'active'    THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) as suspended_users,
        SUM(CASE WHEN status = 'deleted'   THEN 1 ELSE 0 END) as deleted_users,
        SUM(CASE WHEN status = 'read_only' THEN 1 ELSE 0 END) as read_only_users
      FROM users
    `).first(),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(size_gb), 0) as total_gb,
        COUNT(*) as total_files,
        COUNT(DISTINCT user_id) as users_with_files
      FROM files WHERE deleted_at IS NULL
    `).first(),
    env.DB.prepare("SELECT COUNT(*) as open_reports FROM reports WHERE status = 'open'").first(),
    env.DB.prepare(`
      SELECT COALESCE(SUM(current_bytes),0) as total_bytes,
             COALESCE(SUM(accumulated_byte_seconds),0) as total_accumulated
      FROM storage_usage
    `).first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE created_at > ?').bind(sevenDaysAgo).first(),
    env.DB.prepare(`SELECT COUNT(*) as count FROM users WHERE status IN ('read_only','suspended')
                    AND EXISTS (SELECT 1 FROM billing WHERE user_id=users.id AND status='failed')`).first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM files WHERE b2_delete_queued=1 AND deleted_at IS NOT NULL').first(),
    env.DB.prepare(`SELECT COALESCE(SUM(total_charged),0) as rev, COUNT(*) as n
                    FROM billing WHERE status='paid' AND month=?`).bind(thisMonth()).first(),
  ]);

  return adminJson({
    users: totals,
    storage,
    reports,
    billing: billingStats,
    newUsers7d: newUsers7d?.count || 0,
    failedBillingCount: failedBillingCount?.count || 0,
    zombieFiles: zombieCount?.count || 0,
    thisMonthRev: thisMonthRev?.rev || 0,
    thisMonthPaidUsers: thisMonthRev?.n || 0,
  });
}

// ---------- Infrastructure ----------
async function getInfra(env) {
  const GB = 1073741824;

  // CF GraphQL — Workers + KV + D1 for current month
  const cfQuery = `{
    viewer {
      accounts(filter:{accountTag:"${env.CF_ACCOUNT_A_ID}"}) {
        workersInvocationsAdaptive(limit:1,filter:{date_geq:"${thisMonthStart()}"}) {
          sum { requests subrequests cpuTime errors }
        }
        kvOperationsAdaptive(limit:1,filter:{date_geq:"${thisMonthStart()}"}) {
          sum { readRequests writeRequests deleteRequests }
        }
        d1AnalyticsAdaptiveGroups(limit:1,filter:{date_geq:"${thisMonthStart()}"}) {
          sum { readQueries writeQueries rowsRead rowsWritten }
        }
      }
    }
  }`;

  let cfAcc = {};
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: cfQuery }),
    });
    const j = await r.json();
    cfAcc = j?.data?.viewer?.accounts?.[0] || {};
  } catch (_) {}

  const wSum  = cfAcc.workersInvocationsAdaptive?.[0]?.sum || {};
  const kvSum = cfAcc.kvOperationsAdaptive?.[0]?.sum || {};
  const d1Sum = cfAcc.d1AnalyticsAdaptiveGroups?.[0]?.sum || {};

  // B2 storage from D1
  const [b2All, pendingDel, staleUploads] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) as n, COALESCE(SUM(size_bytes),0) as bytes FROM files WHERE deleted_at IS NULL").first(),
    env.DB.prepare('SELECT COUNT(*) as n FROM files WHERE b2_delete_queued=1 AND deleted_at IS NOT NULL').first(),
    env.DB.prepare('SELECT COUNT(*) as n FROM pending_uploads WHERE expires_at < ?').bind(Date.now() - 7200000).first(),
  ]);

  const totalGb = (b2All?.bytes||0) / GB;

  // Cost estimates (USD)
  const workerReqs    = wSum.requests    || 0;
  const workerCpuMs   = wSum.cpuTime     || 0;
  const workerErrors  = wSum.errors      || 0;
  const kvReads       = kvSum.readRequests  || 0;
  const kvWrites      = kvSum.writeRequests || 0;
  const d1Reads       = d1Sum.rowsRead   || 0;
  const d1Writes      = d1Sum.rowsWritten || 0;

  // Workers: $5/mo base (Paid plan), then $0.30/M req beyond 10M, $0.02/M GB-s beyond 30M GB-s
  const wExtraReqCost  = Math.max(0, workerReqs - 10_000_000) / 1_000_000 * 0.30;
  const wCpuGbs        = workerCpuMs / 1000;
  const wCpuCost       = Math.max(0, wCpuGbs - 30_000_000) / 1_000_000 * 0.02;
  const workerCostUsd  = 5 + wExtraReqCost + wCpuCost;

  // KV: free 100K reads/day (~3M/mo), free 1K writes/day (~30K/mo). Then $0.50/M reads, $5/M writes
  const kvReadCost  = Math.max(0, kvReads  - 3_000_000) / 1_000_000 * 0.50;
  const kvWriteCost = Math.max(0, kvWrites - 30_000) / 1_000_000 * 5;
  const kvCostUsd   = kvReadCost + kvWriteCost;

  // D1: free 5M rows read/day (~150M/mo), free 100K writes/day (~3M/mo). Then $0.001/M reads, $1/M writes
  const d1ReadCost  = Math.max(0, d1Reads  - 150_000_000) / 1_000_000 * 0.001;
  const d1WriteCost = Math.max(0, d1Writes - 3_000_000)   / 1_000_000 * 1;
  const d1CostUsd   = d1ReadCost + d1WriteCost;

  // B2: $0.006/GB/month storage, $0/GB egress (Bandwidth Alliance via Cloudflare)
  const b2CostUsd = totalGb * 0.006;

  const totalCostUsd = workerCostUsd + kvCostUsd + d1CostUsd + b2CostUsd;
  const USD_INR = 85;

  return adminJson({
    workers: { requests: workerReqs, cpuMs: workerCpuMs, errors: workerErrors,
               errorRate: workerReqs > 0 ? (workerErrors / workerReqs * 100).toFixed(2) : '0',
               costUsd: workerCostUsd },
    kv: { reads: kvReads, writes: kvWrites, costUsd: kvCostUsd },
    d1: { rowsRead: d1Reads, rowsWritten: d1Writes, costUsd: d1CostUsd },
    b2: { totalGb, totalFiles: b2All?.n||0, costUsd: b2CostUsd },
    queue: { pendingDeletions: pendingDel?.n||0, staleUploads: staleUploads?.n||0 },
    costs: {
      totalUsd: totalCostUsd, totalInr: totalCostUsd * USD_INR,
      breakdown: [
        { label: 'B2 Storage',  usd: b2CostUsd,      inr: b2CostUsd * USD_INR },
        { label: 'CF Workers',  usd: workerCostUsd,   inr: workerCostUsd * USD_INR },
        { label: 'CF KV',       usd: kvCostUsd,       inr: kvCostUsd * USD_INR },
        { label: 'CF D1',       usd: d1CostUsd,       inr: d1CostUsd * USD_INR },
      ],
    },
  });
}

// ---------- Health ----------
async function getHealth(env) {
  const now = Date.now();
  const [zombie, stale, failedBill, trialExpiring, openRep, drifts, readOnlyNoFail] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as n FROM files WHERE b2_delete_queued=1 AND deleted_at IS NOT NULL').first(),
    env.DB.prepare('SELECT COUNT(*) as n FROM pending_uploads WHERE expires_at < ?').bind(now - 7200000).first(),
    env.DB.prepare(`SELECT COUNT(*) as n FROM users WHERE status IN ('read_only','suspended')
                    AND EXISTS(SELECT 1 FROM billing WHERE user_id=users.id AND status='failed')`).first(),
    env.DB.prepare('SELECT COUNT(*) as n FROM users WHERE status=\'trial\' AND trial_ends_at < ?').bind(now + 3*86400000).first(),
    env.DB.prepare("SELECT COUNT(*) as n FROM reports WHERE status='open'").first(),
    env.DB.prepare('SELECT COUNT(*) as n FROM admin_logs WHERE type=\'storage_drift\' AND created_at > ?').bind(now - 86400000).first().catch(()=>({n:0})),
    env.DB.prepare(`SELECT COUNT(*) as n FROM users WHERE status='read_only'
                    AND NOT EXISTS(SELECT 1 FROM billing WHERE user_id=users.id AND status='failed')`).first(),
  ]);
  return adminJson({
    zombieFiles: zombie?.n || 0,
    staleUploads: stale?.n || 0,
    failedBilling: failedBill?.n || 0,
    trialExpiringSoon: trialExpiring?.n || 0,
    openReports: openRep?.n || 0,
    storageDrifts24h: drifts?.n || 0,
    readOnlyNoFail: readOnlyNoFail?.n || 0,
  });
}

// ---------- Growth ----------
async function getGrowth(env) {
  const thirtyAgo = Date.now() - 30 * 86400000;

  const [dailySignups, monthlyRev, topUsers] = await Promise.all([
    env.DB.prepare(`
      SELECT DATE(created_at/1000,'unixepoch') as day, COUNT(*) as n
      FROM users WHERE created_at > ?
      GROUP BY day ORDER BY day ASC
    `).bind(thirtyAgo).all(),
    env.DB.prepare(`
      SELECT month, COALESCE(SUM(total_charged),0) as total, COUNT(*) as n
      FROM billing WHERE status='paid'
      GROUP BY month ORDER BY month DESC LIMIT 12
    `).all(),
    env.DB.prepare(`
      SELECT u.email, u.display_name, su.current_bytes
      FROM storage_usage su JOIN users u ON u.id=su.user_id
      WHERE su.current_bytes > 0
      ORDER BY su.current_bytes DESC LIMIT 15
    `).all(),
  ]);

  return adminJson({
    dailySignups: dailySignups.results || [],
    monthlyRev:   monthlyRev.results   || [],
    topUsers:     topUsers.results     || [],
  });
}

// ---------- Billing failures ----------
async function getBillingFailures(env) {
  const { results } = await env.DB.prepare(`
    SELECT u.id, u.email, u.display_name, u.status,
           b.total_charged, b.month,
           CAST((unixepoch()*1000 - b.created_at)/86400000 AS INTEGER) as days_overdue
    FROM users u
    JOIN billing b ON b.id=(SELECT id FROM billing WHERE user_id=u.id AND status='failed' ORDER BY created_at ASC LIMIT 1)
    WHERE u.status IN ('read_only','suspended')
    ORDER BY b.created_at ASC
    LIMIT 100
  `).all();
  return adminJson({ failures: results || [] });
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

function thisMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
