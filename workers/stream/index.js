// ============================================================
// DataDrop — Stream Worker
// Route: GET /stream/:fileId?token=<hmac>
// Route: POST /stream/:fileId/token   → generate stream token
// Served from: stream.datadrop.co.in
// ============================================================

import {
  corsResponse, handleOptions, validateSession,
  signStreamToken, verifyStreamToken, getB2Auth,
} from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const url   = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] !== 'stream') return corsResponse({ error: 'Not found' }, 404);

    const fileId = parts[1];
    if (!fileId)  return corsResponse({ error: 'fileId required' }, 400);

    // POST /stream/:fileId/token → issue a stream token (requires session)
    if (request.method === 'POST' && parts[2] === 'token') {
      return await issueToken(request, env, fileId);
    }

    // GET /stream/:fileId?token=... → stream the file
    if (request.method === 'GET') {
      return await streamFile(request, env, fileId, url);
    }

    return corsResponse({ error: 'Method not allowed' }, 405);
  }
};

// ---------- Issue HMAC token ----------
async function issueToken(request, env, fileId) {
  const session = await validateSession(request, env);
  if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

  // Verify user has access to this file
  const file = await env.DB.prepare(
    `SELECT f.id, f.user_id, f.mime_type, f.bucket, f.storage_key,
            f.is_vault, f.accessible,
            s.id as share_id, s.can_view, s.expires_at
     FROM files f
     LEFT JOIN shares s ON s.file_id = f.id AND s.recipient_user_id = ? AND s.status = 'active'
     WHERE f.id = ? AND f.deleted_at IS NULL AND f.accessible = 1`
  ).bind(session.userId, fileId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);

  // Vault files are served through the download worker with client-side decryption — never via stream
  if (file.is_vault) return corsResponse({ error: 'Access denied' }, 403);

  const isOwner = file.user_id === session.userId;
  if (!isOwner && !file.share_id) return corsResponse({ error: 'Access denied' }, 403);
  if (!isOwner && !file.can_view) return corsResponse({ error: 'Access denied' }, 403);
  if (!isOwner && file.expires_at && Date.now() > file.expires_at) {
    return corsResponse({ error: 'Share expired' }, 403);
  }

  // Issue 60-second HMAC token
  const ttlSec = 60; // 60-second expiry per spec
  const expiry  = Date.now() + ttlSec * 1000;
  const token   = await signStreamToken(session.userId, fileId, expiry, env.STREAM_SECRET);

  // Check if user is owner watching own file (no ads)
  // or free user watching shared file (VAST ads apply)
  const userRow = await env.DB.prepare(
    'SELECT adfree_active FROM users WHERE id = ?'
  ).bind(session.userId).first();

  // No ads for: owners, adfree subscribers, team members (unconditionally)
  const teamMember = await env.DB.prepare(
    'SELECT 1 FROM team_members WHERE user_id = ? LIMIT 1'
  ).bind(session.userId).first();
  const showAds = !isOwner && !(userRow?.adfree_active) && !teamMember;

  return corsResponse({
    token,
    userId: session.userId,
    expiresAt: expiry,
    showAds,
    vastTag: showAds ? env.VAST_TAG_URL : null,
  });
}

// ---------- Stream file ----------
async function streamFile(request, env, fileId, url) {
  const token  = url.searchParams.get('token');
  const userId = url.searchParams.get('uid');

  if (!token || !userId) return corsResponse({ error: 'token and uid required' }, 401);

  // Verify HMAC token
  const valid = await verifyStreamToken(userId, fileId, token, env.STREAM_SECRET);
  if (!valid) {
    return new Response('Token expired or invalid', { status: 401 });
  }

  // Fetch file record (minimal, no join needed — token already verified access)
  const file = await env.DB.prepare(
    'SELECT id, bucket, storage_key, mime_type, size_bytes, accessible FROM files WHERE id = ? AND accessible = 1'
  ).bind(fileId).first();

  if (!file) return new Response('Not found', { status: 404 });

  // All files are in B2 — serve via B2 S3 proxy (Bandwidth Alliance — zero egress)
  const rangeHeader = request.headers.get('Range');
  const contentType = file.mime_type || 'video/mp4';

  // Increment access count async (analytics only)
  env.ctx?.waitUntil(
    env.DB.prepare('UPDATE files SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
      .bind(Date.now(), fileId).run()
  );

  const b2Bucket = file.bucket === 'b2_vault' ? env.B2_VAULT_BUCKET : env.B2_COLD_BUCKET;
  const result = await fetchB2Range(env, file, b2Bucket, rangeHeader);
  const { body, status, headers: extraHeaders } = result;

  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',       // Never cache — tokens are session-bound
      'Access-Control-Allow-Origin': 'https://app.datadrop.co.in',
      ...extraHeaders,
    },
  });
}

async function fetchB2Range(env, file, bucket, rangeHeader) {
  const keyId  = file.bucket === 'b2_vault' ? env.B2_VAULT_KEY_ID  : env.B2_COLD_KEY_ID;
  const appKey = file.bucket === 'b2_vault' ? env.B2_VAULT_APP_KEY : env.B2_COLD_APP_KEY;
  const auth = await getB2Auth(keyId, appKey);

  const downloadUrl = `${auth.downloadUrl}/file/${bucket}/${encodeURIComponent(file.storage_key)}`;
  const headers = { Authorization: auth.authorizationToken };
  if (rangeHeader) headers['Range'] = rangeHeader;

  const resp = await fetch(downloadUrl, { headers });
  if (!resp.ok && resp.status !== 206) return { body: null, status: resp.status, headers: {} };

  const outHeaders = {};
  const cl = resp.headers.get('Content-Length');
  const cr = resp.headers.get('Content-Range');
  if (cl) outHeaders['Content-Length'] = cl;
  if (cr) outHeaders['Content-Range']  = cr;

  return { body: resp.body, status: resp.status, headers: outHeaders };
}


function parseRange(rangeHeader, total) {
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  const start = match[1] ? parseInt(match[1]) : 0;
  const end   = match[2] ? parseInt(match[2]) : total - 1;
  if (start > end || start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}
