// ============================================================
// DataDrop — Shared Worker Utilities
// ============================================================

// ---------- CORS + Security Headers ----------
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://app.datadrop.co.in',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Token, X-Chunk-Sha1',
  'Access-Control-Max-Age': '86400',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'none'",
};

export function corsResponse(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra },
  });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ---------- Config ----------
export async function getConfig(env, key) {
  const cacheKey = `config:${key}`;
  try {
    const cached = await env.KV.get(cacheKey);
    if (cached !== null) return cached;
  } catch (_) {}

  const row = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
  const value = row?.value ?? null;
  if (value !== null) {
    try { await env.KV.put(cacheKey, value, { expirationTtl: 86400 }); } catch (_) {}
  }
  return value;
}

export async function getConfigNum(env, key) {
  return parseFloat(await getConfig(env, key));
}

// ---------- Storage capacity — single source of truth ----------
// The monthly spending limit determines how many bytes a user may keep.
// Every part of the system must call this function — never inline the formula.
// Throws if storagePrice is missing, zero, negative, or non-finite.
export function getStorageCapacity(monthlyLimit, storagePrice) {
  if (!storagePrice || storagePrice <= 0 || !isFinite(storagePrice)) {
    throw new Error('storage_price_per_gb_month not configured or invalid');
  }
  const capacityGB    = monthlyLimit / storagePrice;
  const capacityBytes = Math.floor(capacityGB * 1024 * 1024 * 1024);
  return { capacityGB, capacityBytes };
}

// Format a raw capacityGB for display — suppresses floating-point artifacts.
// Returns a number (integer or 1-decimal float), not a string, so callers can
// append units as needed.
export function formatCapacityGB(gb) {
  if (gb === null || gb === undefined || !isFinite(gb)) return null;
  const rounded = Math.round(gb);
  return Math.abs(gb - rounded) < 0.01 ? rounded : parseFloat(gb.toFixed(1));
}

// ---------- Flat pricing — single source of truth ----------
// storage_price_per_gb_month is the only pricing config key.
// Throws if price is not configured — never silently falls back.
export async function calcStorageCost(env, usageGb) {
  const price = await getConfigNum(env, 'storage_price_per_gb_month');
  if (!price || price <= 0 || !isFinite(price)) {
    throw new Error('storage_price_per_gb_month not configured');
  }
  return Math.round(usageGb * price * 100) / 100;
}

// ---------- Auth — validate Clerk session ----------
export async function validateSession(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const sessionToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : request.headers.get('X-Session-Token') || '';

  if (!sessionToken) return null;

  const cacheKey = `session:${sessionToken.slice(-32)}`;
  try {
    const cached = await env.KV.get(cacheKey, 'json');
    if (cached) return cached;
  } catch (_) {}

  try {
    const parts = sessionToken.split('.');
    if (parts.length !== 3) return null;

    const header  = JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));

    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    const jwksUrl  = `https://clerk.datadrop.co.in/.well-known/jwks.json`;
    const jwksResp = await fetch(jwksUrl);
    if (!jwksResp.ok) return null;
    const jwks = await jwksResp.json();

    const jwk = jwks.keys?.find(k => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );

    const signingInput = parts[0] + '.' + parts[1];
    const signature    = Uint8Array.from(
      atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')),
      c => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, signature,
      new TextEncoder().encode(signingInput)
    );
    if (!valid) return null;

    const clerkUserId = payload.sub;
    const user = await env.DB.prepare(
      'SELECT id, status FROM users WHERE clerk_user_id = ?'
    ).bind(clerkUserId).first();
    if (!user) return null;

    const sessionData = { userId: user.id, clerkUserId, status: user.status };
    // Cap cache TTL at 300 s — short enough that revoked sessions expire quickly.
    const ttl = Math.min(300, Math.max(60, payload.exp - Math.floor(Date.now()/1000)));
    try {
      await env.KV.put(cacheKey, JSON.stringify(sessionData), { expirationTtl: ttl });
      // Reverse index: store a comma-separated list of the last 20 session suffixes so
      // invalidateSession() can clear ALL cached sessions for a user (multi-device support).
      const tokenSuffix = sessionToken.slice(-32);
      const existing = await env.KV.get(`session_uid:${user.id}`).catch(() => null) || '';
      const suffixes = existing ? existing.split(',').filter(Boolean) : [];
      if (!suffixes.includes(tokenSuffix)) {
        suffixes.push(tokenSuffix);
        if (suffixes.length > 20) suffixes.shift();
      }
      await env.KV.put(`session_uid:${user.id}`, suffixes.join(','), { expirationTtl: 3600 });
    } catch (_) {}
    return sessionData;
  } catch (_) {
    return null;
  }
}

// Invalidate ALL cached sessions for a user (e.g. after password change, account deletion).
// Handles multi-device: deletes every session suffix recorded in the reverse index.
export async function invalidateSession(env, userId) {
  try {
    const existing = await env.KV.get(`session_uid:${userId}`);
    if (existing) {
      const suffixes = existing.split(',').filter(Boolean);
      await Promise.all(suffixes.map(s => env.KV.delete(`session:${s}`).catch(() => {})));
    }
    await env.KV.delete(`session_uid:${userId}`);
  } catch (_) {}
}

// ---------- Rate limiting ----------
// KV-based fixed-window rate limit — only used for sensitive ops (PIN attempts, etc.).
// NOT applied to every API request (would exhaust KV free tier).
// Stores "{count}:{windowStartMs}" to preserve window boundaries across increments.
export async function checkRateLimit(env, key, limit, windowSec) {
  try {
    const raw = await env.KV.get(key);
    const now = Date.now();

    if (!raw) {
      await env.KV.put(key, `1:${now}`, { expirationTtl: windowSec });
      return true;
    }

    const colonIdx = raw.lastIndexOf(':');
    const count   = parseInt(raw.slice(0, colonIdx));
    const created = parseInt(raw.slice(colonIdx + 1));

    // Window expired — reset
    if (now - created > windowSec * 1000) {
      await env.KV.put(key, `1:${now}`, { expirationTtl: windowSec });
      return true;
    }

    if (count >= limit) return false;

    // Increment, preserving original window start and remaining TTL
    const remainingTtl = Math.max(1, Math.ceil((created + windowSec * 1000 - now) / 1000));
    await env.KV.put(key, `${count + 1}:${created}`, { expirationTtl: remainingTtl });
    return true;
  } catch (_) {
    return true; // fail open if KV unavailable
  }
}

// No-op: per-request KV rate limiting removed — exhausted KV free tier (1K writes/day).
// Cloudflare's DDoS mitigation + Clerk auth provide sufficient protection.
export async function checkApiRateLimit(_env, _userId) {
  return true;
}

// ---------- B2 Auth ----------
export async function getB2Auth(keyId, appKey) {
  const credentials = Buffer.from(`${keyId}:${appKey}`).toString('base64');
  const resp = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!resp.ok) throw new Error(`B2 auth failed: ${resp.status}`);
  return await resp.json();
}

export async function getB2UploadUrl(auth, bucketId) {
  const resp = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId }),
  });
  if (!resp.ok) throw new Error(`B2 get_upload_url failed: ${resp.status}`);
  return await resp.json();
}

export function b2ProxyUrl(filename, bucket) {
  const bucketMap = {
    'datadrop-cold':  'https://f005.backblazeb2.com/file/datadrop-cold',
    'datadrop-vault': 'https://f005.backblazeb2.com/file/datadrop-vault',
    'datadrop-main':  'https://f005.backblazeb2.com/file/datadrop-main',
  };
  return `${bucketMap[bucket]}/${encodeURIComponent(filename)}`;
}

// ---------- B2 credentials for a given bucket type ----------
// bucketType: 'b2_cold' | 'b2_vault' | 'b2_main'
export function b2CredsForBucket(env, bucketType) {
  if (bucketType === 'b2_vault') {
    return { keyId: env.B2_VAULT_KEY_ID, appKey: env.B2_VAULT_APP_KEY, bucketId: env.B2_VAULT_BUCKET_ID, bucketName: env.B2_VAULT_BUCKET || 'datadrop-vault' };
  }
  // b2_main and b2_cold both use cold credentials — datadrop-cold IS the main bucket
  return { keyId: env.B2_COLD_KEY_ID, appKey: env.B2_COLD_APP_KEY, bucketId: env.B2_COLD_BUCKET_ID, bucketName: env.B2_COLD_BUCKET || 'datadrop-cold' };
}

// All new uploads go to b2_main (which uses cold credentials — same bucket, unified going forward)
export function resolveUploadBucket(env, isVault) {
  return 'b2_main';
}

// ---------- R2 key helpers (legacy, kept for compatibility) ----------
export function r2Key(userId, fileId, filename) {
  return `${userId}/${fileId}/${filename}`;
}

// New opaque object key format — never contains filename
export function b2ObjectKey(userId, fileId) {
  return `${userId}/${fileId}`;
}

// ---------- ID generation ----------
export function newId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Constant-time string comparison (prevents timing attacks) ----------
// Synchronous — always compares full max length to prevent length-based leakage.
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length !== bBytes.length ? 1 : 0;
  for (let i = 0; i < maxLen; i++) {
    diff |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return diff === 0;
}

// ---------- HMAC token (stream) ----------
export async function signStreamToken(userId, fileId, expiry, secret) {
  const msg = `${userId}:${fileId}:${expiry}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return `${expiry}.${bufToHex(sig)}`;
}

export async function verifyStreamToken(userId, fileId, token, secret) {
  const dotIdx = token.indexOf('.');
  if (dotIdx < 1) return false;
  const expiry = token.slice(0, dotIdx);
  if (Date.now() > parseInt(expiry)) return false;
  const expected = await signStreamToken(userId, fileId, expiry, secret);
  return safeCompare(expected, token);
}

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- KV storage counter (display-only cache) ----------
// D1 storage_usage.current_bytes is the billing source of truth.
// KV counter is for real-time UI display only — reconcile cron corrects drift hourly.
export async function getStorageBytes(env, userId) {
  try {
    const val = await env.KV.get(`storage:${userId}`);
    if (val !== null) return parseInt(val);
  } catch (_) {}
  const row = await env.DB.prepare(
    'SELECT COALESCE(current_bytes, 0) as total FROM storage_usage WHERE user_id = ?'
  ).bind(userId).first();
  return row?.total || 0;
}

export async function incrementStorageBytes(env, userId, bytes) {
  try {
    const current = parseInt(await env.KV.get(`storage:${userId}`) || '0');
    await env.KV.put(`storage:${userId}`, String(current + bytes));
  } catch (_) {}
}

export async function decrementStorageBytes(env, userId, bytes) {
  try {
    const current = parseInt(await env.KV.get(`storage:${userId}`) || '0');
    await env.KV.put(`storage:${userId}`, String(Math.max(0, current - bytes)));
  } catch (_) {}
}

// ---------- Queue helpers ----------
export async function enqueue(env, _queue, body) {
  await env.QUEUE.send({ ...body, _t: Date.now() });
}

// ---------- Email via Resend ----------
export async function sendEmail(env, { to, subject, html }) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'DataDrop <noreply@datadrop.co.in>', to: [to], subject, html }),
  });
}

// ---------- Bytes ↔ GB ----------
export const GB = 1024 * 1024 * 1024;
export const bytesToGb = (b) => b / GB;
export const gbToBytes = (g) => Math.round(g * GB);

// ---------- ID validation ----------
export function isValidId(id) {
  return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);
}

// ============================================================
// Byte-second storage accounting
// ============================================================

export function getCurrentBillingMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Returns array of 2 D1 prepared statements for db.batch().
// Accumulates byte-seconds elapsed since last update, then applies bytesDelta.
// billingUserId: who gets billed (defaults to userId). Workspace files bill the team owner.
export function buildAccumulationBatch(userId, db, bytesDelta, billingUserId = null) {
  const billTo = billingUserId || userId;
  const now    = Date.now();
  const month  = getCurrentBillingMonth();
  return [
    db.prepare(
      'INSERT OR IGNORE INTO storage_usage (user_id, current_bytes, accumulated_byte_seconds, last_updated_at, billing_month) VALUES (?, 0, 0, ?, ?)'
    ).bind(billTo, now, month),
    db.prepare(
      'UPDATE storage_usage SET accumulated_byte_seconds = accumulated_byte_seconds + (current_bytes * (? - last_updated_at) / 1000.0), last_updated_at = ?, current_bytes = MAX(0, current_bytes + ?) WHERE user_id = ?'
    ).bind(now, now, bytesDelta, billTo),
  ];
}

export async function loadBillingConfig(env) {
  const config = {};
  await Promise.all(['storage_price_per_gb_month', 'min_bill_amount'].map(
    async k => { config[k] = await getConfigNum(env, k); }
  ));
  return config;
}

export function calculateFlatBill(gbMonths, config) {
  const price = config.storage_price_per_gb_month;
  if (!price || price <= 0 || !isFinite(price)) {
    throw new Error('storage_price_per_gb_month not configured or invalid');
  }
  return gbMonths * price;
}

// Kept for import compatibility — delegates to calculateFlatBill.
export const calculateTieredBill = calculateFlatBill;

export function accumulatedToGbMonths(accByteSeconds, billingMonth) {
  const [year, month] = (billingMonth || getCurrentBillingMonth()).split('-').map(Number);
  const daysInMonth   = new Date(year, month, 0).getDate();
  const gbSeconds     = accByteSeconds / (1024 * 1024 * 1024);
  return gbSeconds / 86400 / daysInMonth;
}

export function computeBillSoFar(row, config) {
  if (!row) return config.min_bill_amount || 1;
  const now        = Date.now();
  const elapsed    = Math.max(0, (now - row.last_updated_at) / 1000);
  const currentAcc = row.accumulated_byte_seconds + (row.current_bytes * elapsed);
  const gbMonths   = accumulatedToGbMonths(currentAcc, row.billing_month);
  return Math.max(calculateFlatBill(gbMonths, config), config.min_bill_amount || 1);
}

export function computeProjectedBill(row, config) {
  if (!row) return config.min_bill_amount || 1;
  const now           = Date.now();
  const billingMonth  = row.billing_month || getCurrentBillingMonth();
  const [year, month] = billingMonth.split('-').map(Number);
  const endOfMonth    = new Date(year, month, 1).getTime();
  const elapsed       = Math.max(0, (now - row.last_updated_at) / 1000);
  const currentAcc    = row.accumulated_byte_seconds + (row.current_bytes * elapsed);
  const secRemaining  = Math.max(0, (endOfMonth - now) / 1000);
  const projectedAcc  = currentAcc + (row.current_bytes * secRemaining);
  const gbMonths      = accumulatedToGbMonths(projectedAcc, billingMonth);
  return Math.max(calculateFlatBill(gbMonths, config), config.min_bill_amount || 1);
}
