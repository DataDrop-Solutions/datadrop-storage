// ============================================================
// DataDrop — Shared Worker Utilities
// Used by all Workers via copy or import
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
// Config is cached in KV with 24-hour TTL; falls back to D1
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

// ---------- Tiered pricing ----------
export async function calcStorageCost(env, usageGb) {
  const tiers = [
    { max: 30,       key: 'price_tier_0_30' },
    { max: 100,      key: 'price_tier_31_100' },
    { max: 200,      key: 'price_tier_101_200' },
    { max: 500,      key: 'price_tier_201_500' },
    { max: Infinity, key: 'price_tier_501_2000' },
  ];

  let remaining = usageGb;
  let cost = 0;
  let prev = 0;

  for (const tier of tiers) {
    if (remaining <= 0) break;
    const tierSize = Math.min(remaining, tier.max - prev);
    const price = await getConfigNum(env, tier.key);
    cost += tierSize * price;
    remaining -= tierSize;
    prev = tier.max;
  }
  return Math.round(cost * 100) / 100;
}

// ---------- Auth — validate Clerk session ----------
export async function validateSession(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const sessionToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : request.headers.get('X-Session-Token') || '';

  if (!sessionToken) return null;

  // Check session cache in KV (cache by last 32 chars of token)
  const cacheKey = `session:${sessionToken.slice(-32)}`;
  try {
    const cached = await env.KV.get(cacheKey, 'json');
    if (cached) return cached;
  } catch (_) {}

  // Verify Clerk JWT via JWKS
  try {
    // Decode JWT header to get kid
    const parts = sessionToken.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(atob(parts[0].replace(/-/g,'+').replace(/_/g,'/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));

    // Check expiry
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    // Fetch JWKS from Clerk
    const jwksUrl = `https://clerk.datadrop.co.in/.well-known/jwks.json`;
    const jwksResp = await fetch(jwksUrl);
    if (!jwksResp.ok) return null;
    const jwks = await jwksResp.json();

    // Find matching key
    const jwk = jwks.keys?.find(k => k.kid === header.kid);
    if (!jwk) return null;

    // Import public key and verify
    const key = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );

    const signingInput = parts[0] + '.' + parts[1];
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g,'+').replace(/_/g,'/')),
      c => c.charCodeAt(0)
    );

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key,
      signature,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    // Get user from D1 using sub (Clerk user ID)
    // (validateSession intentionally has no console output — errors return null silently)
    const clerkUserId = payload.sub;
    const user = await env.DB.prepare(
      'SELECT id, status FROM users WHERE clerk_user_id = ?'
    ).bind(clerkUserId).first();

    if (!user) return null;

    const sessionData = { userId: user.id, clerkUserId, status: user.status };
    // Cache for remaining token lifetime or 1 hour max (non-fatal if KV limit exceeded)
    const ttl = Math.min(3600, Math.max(60, payload.exp - Math.floor(Date.now()/1000)));
    try {
      await env.KV.put(cacheKey, JSON.stringify(sessionData), { expirationTtl: ttl });
    } catch (_) {}
    return sessionData;
  } catch (_) {
    return null;
  }
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

// ---------- B2 Upload URL ----------
export async function getB2UploadUrl(auth, bucketId) {
  const resp = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: 'POST',
    headers: {
      Authorization: auth.authorizationToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bucketId }),
  });
  if (!resp.ok) throw new Error(`B2 get_upload_url failed: ${resp.status}`);
  return await resp.json();
}

// ---------- B2 Download via Cloudflare proxy (Bandwidth Alliance) ----------
// CRITICAL: Never call B2 direct API from client — always proxy through Cloudflare
// This qualifies for zero egress under Bandwidth Alliance
export function b2ProxyUrl(filename, bucket) {
  // B2 buckets are served through Cloudflare CDN proxy
  // files.datadrop.co.in Worker fetches from B2 through CF proxy
  const bucketMap = {
    'datadrop-cold':  'https://f005.backblazeb2.com/file/datadrop-cold',
    'datadrop-vault': 'https://f005.backblazeb2.com/file/datadrop-vault',
  };
  return `${bucketMap[bucket]}/${encodeURIComponent(filename)}`;
}

// ---------- R2 key helpers ----------
export function r2Key(userId, fileId, filename) {
  return `${userId}/${fileId}/${filename}`;
}

// ---------- ID generation ----------
export function newId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig) return false;
  if (Date.now() > parseInt(expiry)) return false;
  const expected = await signStreamToken(userId, fileId, expiry, secret);
  return expected === `${expiry}.${sig}`;
}

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- KV storage counter ----------
export async function getStorageBytes(env, userId) {
  try {
    const val = await env.KV.get(`storage:${userId}`);
    if (val !== null) return parseInt(val);
  } catch (_) {}
  // KV unavailable — compute from D1
  const row = await env.DB.prepare(
    'SELECT SUM(size_bytes) as total FROM files WHERE user_id = ? AND deleted_at IS NULL'
  ).bind(userId).first();
  return row?.total || 0;
}

export async function incrementStorageBytes(env, userId, bytes) {
  const current = await getStorageBytes(env, userId);
  try { await env.KV.put(`storage:${userId}`, String(current + bytes)); } catch (_) {}
  return current + bytes;
}

export async function decrementStorageBytes(env, userId, bytes) {
  const current = await getStorageBytes(env, userId);
  const next = Math.max(0, current - bytes);
  try { await env.KV.put(`storage:${userId}`, String(next)); } catch (_) {}
  return next;
}

// ---------- Queue helpers ----------
export async function enqueue(env, queue, body) {
  await env.QUEUE.send({ ...body, _t: Date.now() });
}

// ---------- Email via Resend ----------
export async function sendEmail(env, { to, subject, html }) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'DataDrop <noreply@datadrop.co.in>',
      to: [to],
      subject,
      html,
    }),
  });
}

// ---------- Bytes ↔ GB ----------
export const GB = 1024 * 1024 * 1024;
export const bytesToGb = (b) => b / GB;
export const gbToBytes = (g) => Math.round(g * GB);

// ---------- ID validation (32-char hex, as generated by newId()) ----------
export function isValidId(id) {
  return typeof id === 'string' && /^[0-9a-f]{32}$/.test(id);
}

// ---------- KV-based rate limiting ----------
// Returns false if rate limit exceeded, true if request is allowed.
export async function checkRateLimit(env, key, limit, windowSec) {
  try {
    const current = parseInt(await env.KV.get(key) || '0');
    if (current >= limit) return false;
    await env.KV.put(key, String(current + 1), { expirationTtl: windowSec });
    return true;
  } catch (_) {
    return true; // fail open if KV unavailable
  }
}

// General API rate limit: 1000 requests per user per minute
export async function checkApiRateLimit(env, userId) {
  return checkRateLimit(env, `rate_api:${userId}`, 1000, 60);
}

// ============================================================
// Byte-second storage accounting
// ============================================================

export function getCurrentBillingMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Returns array of 2 D1 prepared statements to include in a db.batch() call.
// Atomically: accumulates byte-seconds elapsed since last_updated_at, then adjusts
// current_bytes by bytesDelta. Must run BEFORE any storage change in the same batch.
// bytesDelta: positive = bytes added, negative = bytes removed, 0 = accumulate only.
export function buildAccumulationBatch(userId, db, bytesDelta) {
  const now = Date.now();
  const month = getCurrentBillingMonth();
  return [
    db.prepare(
      'INSERT OR IGNORE INTO storage_usage (user_id, current_bytes, accumulated_byte_seconds, last_updated_at, billing_month) VALUES (?, 0, 0, ?, ?)'
    ).bind(userId, now, month),
    db.prepare(
      'UPDATE storage_usage SET accumulated_byte_seconds = accumulated_byte_seconds + (current_bytes * (? - last_updated_at) / 1000.0), last_updated_at = ?, current_bytes = MAX(0, current_bytes + ?) WHERE user_id = ?'
    ).bind(now, now, bytesDelta, userId),
  ];
}

// Load all billing price config values from D1/KV into a plain object.
export async function loadBillingConfig(env) {
  const keys = ['price_tier_0_30', 'price_tier_31_100', 'price_tier_101_200',
                 'price_tier_201_500', 'price_tier_501_2000',
                 'min_bill_amount'];
  const config = {};
  await Promise.all(keys.map(async k => { config[k] = await getConfigNum(env, k); }));
  return config;
}

// Pure tiered pricing calculation — no D1 access.
export function calculateTieredBill(gbMonths, config) {
  let bill = 0;
  const t1 = Math.min(gbMonths, 30);
  bill += t1 * (config.price_tier_0_30 || 1.89);
  if (gbMonths > 30)   { bill += Math.min(gbMonths - 30, 70)    * (config.price_tier_31_100  || 1.49); }
  if (gbMonths > 100)  { bill += Math.min(gbMonths - 100, 100)  * (config.price_tier_101_200 || 1.29); }
  if (gbMonths > 200)  { bill += Math.min(gbMonths - 200, 300)  * (config.price_tier_201_500 || 1.09); }
  if (gbMonths > 500)  { bill += (gbMonths - 500) * (config.price_tier_501_2000 || 0.99); }
  return bill;
}

// Convert accumulated byte-seconds to GB-months for a given billing month.
export function accumulatedToGbMonths(accByteSeconds, billingMonth) {
  const [year, month] = (billingMonth || getCurrentBillingMonth()).split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const gbSeconds = accByteSeconds / (1024 * 1024 * 1024);
  return gbSeconds / 86400 / daysInMonth;
}

// Read-only: compute bill so far this month (includes elapsed since last update). Never writes to D1.
export function computeBillSoFar(row, config) {
  if (!row) return config.min_bill_amount || 1;
  const now = Date.now();
  const elapsed = Math.max(0, (now - row.last_updated_at) / 1000);
  const currentAcc = row.accumulated_byte_seconds + (row.current_bytes * elapsed);
  const gbMonths = accumulatedToGbMonths(currentAcc, row.billing_month);
  return Math.max(calculateTieredBill(gbMonths, config), config.min_bill_amount || 1);
}

// Read-only: project bill to end of month assuming current storage unchanged. Never writes to D1.
export function computeProjectedBill(row, config) {
  if (!row) return config.min_bill_amount || 1;
  const now = Date.now();
  const billingMonth = row.billing_month || getCurrentBillingMonth();
  const [year, month] = billingMonth.split('-').map(Number);
  const endOfMonth = new Date(year, month, 1).getTime();
  const elapsed = Math.max(0, (now - row.last_updated_at) / 1000);
  const currentAcc = row.accumulated_byte_seconds + (row.current_bytes * elapsed);
  const secondsRemaining = Math.max(0, (endOfMonth - now) / 1000);
  const projectedAcc = currentAcc + (row.current_bytes * secondsRemaining);
  const gbMonths = accumulatedToGbMonths(projectedAcc, billingMonth);
  return Math.max(calculateTieredBill(gbMonths, config), config.min_bill_amount || 1);
}

