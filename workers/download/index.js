// ============================================================
// DataDrop — Download Worker
// Route: GET /files/:fileId          → download file
// Route: GET /files/:fileId/preview  → inline preview
// All files served from B2 through Cloudflare proxy (Bandwidth Alliance — zero egress)
// Served from: files.datadrop.co.in
// ============================================================

import {
  corsResponse, handleOptions, validateSession, getB2Auth,
} from '../shared/utils.js';

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return handleOptions();

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['files', fileId, ?'preview']

    if (parts[0] !== 'files' || !parts[1]) {
      return corsResponse({ error: 'Not found' }, 404);
    }

    const fileId = parts[1];
    const mode   = parts[2] || 'download'; // 'download' | 'preview'

    // Validate session
    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

    try {
      return await serveFile(request, env, ctx, session, fileId, mode);
    } catch (err) {
      return corsResponse({ error: err?.message || 'Internal error' }, 500);
    }
  }
};

async function serveFile(request, env, ctx, session, fileId, mode) {
  // Fetch file record
  const file = await env.DB.prepare(
    `SELECT f.*, s.can_view, s.can_download, s.delete_on_confirm, s.max_views, s.views_used,
            s.expires_at, s.id as share_id
     FROM files f
     LEFT JOIN shares s ON s.file_id = f.id AND s.recipient_user_id = ? AND s.status = 'active'
     WHERE f.id = ? AND f.deleted_at IS NULL AND f.accessible = 1`
  ).bind(session.userId, fileId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);

  // Access control
  const isOwner = file.user_id === session.userId;

  // Team file: check active membership
  let isTeamMember = false;
  if (!isOwner && file.team_id) {
    const mem = await env.DB.prepare(
      "SELECT id FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'"
    ).bind(file.team_id, session.userId).first();
    if (mem) isTeamMember = true;
  }

  if (!isOwner && !isTeamMember) {
    if (!file.share_id) return corsResponse({ error: 'Access denied' }, 403);
    if (file.expires_at && Date.now() > file.expires_at) {
      await env.DB.prepare("UPDATE shares SET status = 'expired' WHERE id = ?").bind(file.share_id).run();
      return corsResponse({ error: 'Share expired' }, 403);
    }
    if (!file.can_view && !file.can_download) return corsResponse({ error: 'Access denied' }, 403);
    if (mode === 'download' && !file.can_download) return corsResponse({ error: 'Download not permitted' }, 403);
    if (file.max_views && file.views_used >= file.max_views) return corsResponse({ error: 'View limit reached' }, 403);
  }

  // Fetch file bytes from B2 — all files are in B2 (cold or vault)
  // Files with bucket='r2_hot' (legacy) are treated as cold after D1 migration
  let fileBytes;
  try {
    fileBytes = await fetchFromB2(env, file, request.headers.get('Range'));
  } catch (e) {
    return corsResponse({ error: e.message }, 503);
  }

  // Update access count (analytics only — no auto-tiering)
  // Update share view count and last_accessed for delete_on_confirm tracking
  ctx?.waitUntil((async () => {
    await env.DB.prepare(
      'UPDATE files SET access_count = access_count + 1, last_accessed = ? WHERE id = ?'
    ).bind(Date.now(), file.id).run();

    if (file.share_id) {
      await env.DB.prepare(
        'UPDATE shares SET views_used = views_used + 1, updated_at = ? WHERE id = ?'
      ).bind(Date.now(), file.share_id).run();
    }
  })());

  // Content-Disposition header
  const disposition = mode === 'preview'
    ? `inline; filename="${file.filename}"`
    : `attachment; filename="${file.filename}"`;

  const { body, status, headers: rangeHeaders } = fileBytes;

  return new Response(body, {
    status,
    headers: {
      'Content-Type': file.mime_type || 'application/octet-stream',
      'Content-Disposition': disposition,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': 'https://app.datadrop.co.in',
      ...rangeHeaders,
    },
  });
}

// ---------- B2 fetch through Cloudflare proxy (Bandwidth Alliance — zero egress) ----------
async function fetchFromB2(env, file, rangeHeader) {
  let keyId, appKey, bucket, bucketId;
  if (file.bucket === 'b2_main' || file.bucket === 'main') {
    keyId    = env.B2_MAIN_KEY_ID;
    appKey   = env.B2_MAIN_APP_KEY;
    bucket   = env.B2_MAIN_BUCKET || 'datadrop-main';
    bucketId = env.B2_MAIN_BUCKET_ID;
  } else if (file.bucket === 'b2_vault' || file.bucket === 'vault') {
    keyId    = env.B2_VAULT_KEY_ID;
    appKey   = env.B2_VAULT_APP_KEY;
    bucket   = env.B2_VAULT_BUCKET;
    bucketId = env.B2_VAULT_BUCKET_ID;
  } else {
    keyId    = env.B2_COLD_KEY_ID;
    appKey   = env.B2_COLD_APP_KEY;
    bucket   = env.B2_COLD_BUCKET;
    bucketId = env.B2_COLD_BUCKET_ID;
  }

  if (!keyId || !appKey) throw new Error('B2 credentials not configured for this storage type');

  const b2Auth = await getB2Auth(keyId, appKey);
  // Encode each path segment so '/' separators are preserved in the URL
  const encodedKey  = file.storage_key.split('/').map(encodeURIComponent).join('/');
  const baseUrl     = `${b2Auth.downloadUrl}/file/${bucket}/${encodedKey}`;

  // ── Attempt 1: Authorization header (requires readFiles on the B2 key) ──
  const hdrs1 = { Authorization: b2Auth.authorizationToken };
  if (rangeHeader) hdrs1['Range'] = rangeHeader;
  let resp = await fetch(baseUrl, { headers: hdrs1 });

  // ── Attempt 2: b2_get_download_authorization signed URL (requires shareFiles) ──
  if (resp.status === 401 && bucketId) {
    const authResp = await fetch(`${b2Auth.apiUrl}/b2api/v2/b2_get_download_authorization`, {
      method: 'POST',
      headers: { Authorization: b2Auth.authorizationToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bucketId,
        fileNamePrefix: file.storage_key.split('/').slice(0, 2).join('/') + '/',
        validDurationInSeconds: 3600,
      }),
    });
    if (authResp.ok) {
      const { authorizationToken: dlToken } = await authResp.json();
      const signedUrl = `${baseUrl}?Authorization=${encodeURIComponent(dlToken)}`;
      const hdrs2 = {};
      if (rangeHeader) hdrs2['Range'] = rangeHeader;
      resp = await fetch(signedUrl, { headers: hdrs2 });
    } else {
      // Neither readFiles nor shareFiles available — provide actionable error
      throw new Error(
        'B2 key missing readFiles/shareFiles permission. In Backblaze console → App Keys → ' +
        'edit your key → add "Read Files" capability, then re-deploy.'
      );
    }
  }

  if (!resp.ok && resp.status !== 206) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`B2 fetch failed ${resp.status}: ${errBody.slice(0, 200)}`);
  }

  const headers = {};
  const cl = resp.headers.get('Content-Length');
  const cr = resp.headers.get('Content-Range');
  if (cl) headers['Content-Length'] = cl;
  if (cr) headers['Content-Range']  = cr;
  return { body: resp.body, status: resp.status, headers };
}
