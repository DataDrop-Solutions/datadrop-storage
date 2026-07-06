// ============================================================
// DataDrop — Upload Worker
// Route: POST /upload/init                  → reserve upload slot
// Route: POST /upload/confirm               → confirm upload, queue D1 insert
// Route: POST /upload/dedup                 → SHA-256 dedup check
// Route: POST /upload/direct/:fileId        → single-part proxy (< 100 MB)
// Route: POST /upload/large/:fileId/start   → B2 large file init (≥ 100 MB)
// Route: POST /upload/large/:fileId/part/:n → upload one 10 MB part
// Route: POST /upload/large/:fileId/finish  → finalize large file
// Route: POST /upload/large/:fileId/abort   → cancel large file
// ============================================================

import {
  corsResponse, handleOptions, validateSession, getConfig, getConfigNum,
  getStorageBytes, incrementStorageBytes, calcStorageCost,
  getB2Auth, getB2UploadUrl, newId, r2Key, bytesToGb, gbToBytes, GB,
  sendEmail, checkApiRateLimit, buildAccumulationBatch,
} from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

    if (!(await checkApiRateLimit(env, session.userId))) {
      return corsResponse({ error: 'Too many requests' }, 429);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace('/upload', '');

    try {
      if (path === '/dedup' && request.method === 'POST') return await handleDedup(request, env, session);
      if (path === '/init'  && request.method === 'POST') return await handleInit(request, env, session);
      if (path === '/confirm' && request.method === 'POST') return await handleConfirm(request, env, session);
      // Single-part proxy (< 100 MB)
      const directMatch = path.match(/^\/direct\/([a-f0-9]+)$/);
      if (directMatch && request.method === 'POST') return await handleDirectProxy(directMatch[1], request, env, session);
      // Large file (B2 multipart) — for files ≥ 100 MB
      const largeStartMatch  = path.match(/^\/large\/([a-f0-9]+)\/start$/);
      const largePartMatch   = path.match(/^\/large\/([a-f0-9]+)\/part\/(\d+)$/);
      const largeFinishMatch = path.match(/^\/large\/([a-f0-9]+)\/finish$/);
      const largeAbortMatch  = path.match(/^\/large\/([a-f0-9]+)\/abort$/);
      if (largeStartMatch  && request.method === 'POST') return await handleLargeStart(largeStartMatch[1], env, session);
      if (largePartMatch   && request.method === 'POST') return await handleLargePart(largePartMatch[1], parseInt(largePartMatch[2]), request, env, session);
      if (largeFinishMatch && request.method === 'POST') return await handleLargeFinish(largeFinishMatch[1], request, env, session);
      if (largeAbortMatch  && request.method === 'POST') return await handleLargeAbort(largeAbortMatch[1], env, session);
      return corsResponse({ error: 'Not found' }, 404);
    } catch (_) {
      return corsResponse({ error: 'Internal error' }, 500);
    }
  }
};

// ---------- Dedup check ----------
async function handleDedup(request, env, session) {
  const { hash, folderId } = await request.json();
  if (!hash) return corsResponse({ error: 'hash required' }, 400);

  // Dedup is folder-scoped and workspace-scoped: only matches personal non-vault files
  const existing = await env.DB.prepare(
    `SELECT id, filename, size_bytes FROM files
     WHERE user_id = ? AND hash_sha256 = ? AND folder_id ${folderId ? '= ?' : 'IS NULL'}
     AND team_id IS NULL AND (is_vault = 0 OR is_vault IS NULL)
     AND deleted_at IS NULL AND version_of IS NULL LIMIT 1`
  ).bind(...(folderId ? [session.userId, hash, folderId] : [session.userId, hash])).first();

  if (existing) {
    return corsResponse({ duplicate: true, existingFileId: existing.id });
  }
  return corsResponse({ duplicate: false });
}

// ---------- Init upload ----------
async function handleInit(request, env, session) {
  const {
    filename, mimeType, sizeBytes, folderId, isVault = false,
    quality = 'original', takenAt, hash, isEncrypted = false, teamId = null,
  } = await request.json();

  if (!filename || !sizeBytes) return corsResponse({ error: 'filename and sizeBytes required' }, 400);

  // ---------- File size validation ----------
  const MAX_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB
  if (typeof sizeBytes !== 'number' || sizeBytes <= 0) {
    return corsResponse({ error: 'Invalid file size' }, 400);
  }
  if (sizeBytes > MAX_BYTES) {
    return corsResponse({ error: 'File exceeds maximum size of 50 GB' }, 400);
  }

  // ---------- Vault mime_type validation ----------
  if (isVault && (!mimeType || !mimeType.startsWith('encrypted:'))) {
    return corsResponse({ error: 'Vault uploads must have mimeType starting with encrypted:' }, 400);
  }

  // ---------- Team membership check (upload permission) ----------
  if (teamId) {
    const mem = await env.DB.prepare(
      "SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'"
    ).bind(teamId, session.userId).first();
    const team = await env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(teamId).first();
    const isOwner = team?.owner_id === session.userId;
    if (!isOwner && (!mem || mem.role === 'read')) {
      return corsResponse({ error: 'You do not have upload permission in this team' }, 403);
    }
  }

  // ---------- Wallet & limit check ----------
  const user = await env.DB.prepare(
    'SELECT wallet_balance, wallet_limit, status, trial_ends_at FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (!user) return corsResponse({ error: 'User not found' }, 404);

  if (user.status === 'suspended')  return corsResponse({ error: 'Account suspended' }, 403);
  if (user.status === 'deleted')    return corsResponse({ error: 'Account closed' }, 403);
  if (user.status === 'read_only')  return corsResponse({ error: 'Trial ended — set up billing to continue uploading', code: 'TRIAL_ENDED' }, 402);

  // Trial check
  const isTrial = user.status === 'trial';
  if (isTrial) {
    const trialGbLimit = await getConfigNum(env, 'trial_gb_limit');
    const currentBytes = await getStorageBytes(env, session.userId);
    if (currentBytes + sizeBytes > gbToBytes(trialGbLimit)) {
      return corsResponse({ error: 'Trial storage limit reached', code: 'TRIAL_LIMIT' }, 402);
    }
  } else {
    // Wallet balance check
    const sizeGb = bytesToGb(sizeBytes);
    const cost = await calcStorageCost(env, sizeGb);
    if (user.wallet_balance < cost) {
      return corsResponse({ error: 'Insufficient wallet balance', code: 'WALLET_LOW', costRequired: cost }, 402);
    }
  }

  // ---------- Reserve upload slot ----------
  // Upload goes through Worker proxy (/upload/direct/:id) which calls B2 itself.
  // No need to pre-generate a B2 upload URL here.
  const fileId     = newId();
  const storageKey = `${session.userId}/${fileId}/${filename}`;

  // Store pending file record — KV primary, D1 fallback
  const pendingKey = `pending_upload:${fileId}`;
  const pendingData = JSON.stringify({
    fileId, userId: session.userId, filename, mimeType, sizeBytes,
    folderId: folderId || null, isVault, isEncrypted, quality,
    takenAt: takenAt || null, hash: hash || null,
    storageKey, bucket: isVault ? 'b2_vault' : 'b2_cold',
    teamId: teamId || null,
  });
  try {
    await env.KV.put(pendingKey, pendingData, { expirationTtl: 3600 });
  } catch (_) {
    // KV limit hit — fall back to D1
    await env.DB.prepare(
      'INSERT OR REPLACE INTO pending_uploads (file_id, user_id, data, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(fileId, session.userId, pendingData, Date.now() + 3600000).run();
  }

  return corsResponse({ fileId, storageKey });
}

// ---------- Confirm upload ----------
async function handleConfirm(request, env, session) {
  const { fileId, thumbData } = await request.json();
  if (!fileId) return corsResponse({ error: 'fileId required' }, 400);

  const pendingKey = `pending_upload:${fileId}`;
  let pendingRaw = await env.KV.get(pendingKey);
  if (!pendingRaw) {
    const row = await env.DB.prepare(
      'SELECT data FROM pending_uploads WHERE file_id = ? AND user_id = ? AND expires_at > ?'
    ).bind(fileId, session.userId, Date.now()).first();
    pendingRaw = row?.data || null;
  }
  if (!pendingRaw) return corsResponse({ error: 'Upload not found or expired' }, 404);

  const pending = JSON.parse(pendingRaw);
  if (pending.userId !== session.userId) return corsResponse({ error: 'Forbidden' }, 403);

  const sizeGb = bytesToGb(pending.sizeBytes);
  const now = Date.now();

  // Accumulate byte-seconds and update storage_usage (non-fatal — reconcile corrects any misses)
  try {
    await env.DB.batch(buildAccumulationBatch(session.userId, env.DB, pending.sizeBytes));
  } catch (_) {}

  // Validate thumbnail size: max 20 KB base64 (~15 KB raw)
  const thumbDataClean = (typeof thumbData === 'string' && thumbData.length <= 28000) ? thumbData : null;

  // Insert file record into D1 via Queue (non-blocking)
  await env.QUEUE.send({
    type: 'INSERT_FILE',
    fileId: pending.fileId,
    userId: pending.userId,
    folderId: pending.folderId,
    teamId: pending.teamId || null,
    filename: pending.filename,
    mimeType: pending.mimeType || null,
    sizeBytes: pending.sizeBytes,
    sizeGb,
    bucket: pending.bucket,
    storageKey: pending.storageKey,
    isVault: pending.isVault ? 1 : 0,
    isEncrypted: pending.isEncrypted ? 1 : 0,
    quality: pending.quality,
    takenAt: pending.takenAt,
    hashSha256: pending.hash,
    thumbData: thumbDataClean,
    createdAt: now,
  });

  // Update KV storage counter immediately (real-time meter)
  await incrementStorageBytes(env, session.userId, pending.sizeBytes);

  // Clean up pending key (both KV and D1 fallback)
  await env.KV.delete(pendingKey).catch(() => {});
  await env.DB.prepare('DELETE FROM pending_uploads WHERE file_id = ?').bind(fileId).run();

  // Check wallet thresholds for notifications
  await checkWalletThresholds(env, session.userId);

  return corsResponse({ success: true, fileId, sizeGb });
}

// ---------- Direct proxy upload (browser → Worker → B2, bypasses B2 CORS) ----------
async function handleDirectProxy(fileId, request, env, session) {
  const pendingKey = `pending_upload:${fileId}`;
  let pendingRaw = await env.KV.get(pendingKey);
  if (!pendingRaw) {
    const row = await env.DB.prepare(
      'SELECT data FROM pending_uploads WHERE file_id = ? AND user_id = ? AND expires_at > ?'
    ).bind(fileId, session.userId, Date.now()).first();
    pendingRaw = row?.data || null;
  }
  if (!pendingRaw) return corsResponse({ error: 'Upload not found or expired' }, 404);

  const pending = JSON.parse(pendingRaw);
  if (pending.userId !== session.userId) return corsResponse({ error: 'Forbidden' }, 403);

  const isVault  = pending.isVault;
  const keyId    = isVault ? env.B2_VAULT_KEY_ID   : env.B2_COLD_KEY_ID;
  const appKey   = isVault ? env.B2_VAULT_APP_KEY   : env.B2_COLD_APP_KEY;
  const bucketId = isVault ? env.B2_VAULT_BUCKET_ID : env.B2_COLD_BUCKET_ID;

  const b2Auth = await getB2Auth(keyId, appKey);
  const { uploadUrl, authorizationToken } = await getB2UploadUrl(b2Auth, bucketId);

  // Stream the request body directly to B2 (no memory buffering)
  const b2Resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization':      authorizationToken,
      'X-Bz-File-Name':     encodeURIComponent(pending.storageKey),
      'Content-Type':       pending.mimeType || 'application/octet-stream',
      'Content-Length':     String(pending.sizeBytes),
      'X-Bz-Content-Sha1': 'do_not_verify',
    },
    body: request.body,
  });

  if (!b2Resp.ok) {
    return corsResponse({ error: 'Upload failed' }, 502);
  }

  return corsResponse({ success: true });
}

// ---------- Wallet threshold notifications ----------
async function checkWalletThresholds(env, userId) {
  const user = await env.DB.prepare(
    'SELECT wallet_balance, wallet_limit, email FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user || user.wallet_limit <= 0) return;

  const usedPct = ((user.wallet_limit - user.wallet_balance) / user.wallet_limit) * 100;
  const thresholds = [
    { pct: 100, type: 'wallet_100', label: '100%' },
    { pct: 80,  type: 'wallet_80',  label: '80%'  },
  ];

  for (const t of thresholds) {
    if (usedPct >= t.pct) {
      // Check if already notified this month
      const month = new Date().toISOString().slice(0, 7);
      const notifKey = `notif:${userId}:${t.type}:${month}`;
      const already = await env.KV.get(notifKey);
      if (already) continue;

      try { await env.KV.put(notifKey, '1', { expirationTtl: 86400 * 35 }); } catch (_) {}
      await sendEmail(env, {
        to: user.email,
        subject: t.pct === 100
          ? '⚠️ DataDrop: Storage limit reached — uploads paused'
          : `DataDrop: You've used ${t.label} of your storage budget`,
        html: walletAlertHtml(t.pct, user.wallet_limit, user.wallet_balance),
      });
    }
  }
}

function walletAlertHtml(pct, limit, balance) {
  if (pct >= 100) {
    return `<p>Your DataDrop storage wallet is empty. Uploads are paused.</p>
            <p>To continue uploading, please top up your wallet at <a href="https://app.datadrop.co.in/billing">app.datadrop.co.in/billing</a>.</p>`;
  }
  return `<p>You've used 80% of your ₹${limit} DataDrop storage budget this month.</p>
          <p>Remaining balance: ₹${balance.toFixed(2)}</p>
          <p>Manage your wallet at <a href="https://app.datadrop.co.in/billing">app.datadrop.co.in/billing</a>.</p>`;
}

// ── Helpers ────────────────────────────────────────────────────
async function getPending(env, fileId, userId) {
  let raw = await env.KV.get(`pending_upload:${fileId}`);
  if (!raw) {
    const row = await env.DB.prepare(
      'SELECT data FROM pending_uploads WHERE file_id = ? AND user_id = ? AND expires_at > ?'
    ).bind(fileId, userId, Date.now()).first();
    raw = row?.data || null;
  }
  if (!raw) return null;
  const p = JSON.parse(raw);
  return p.userId === userId ? p : null;
}

function b2Creds(pending, env) {
  const v = pending.isVault;
  return {
    keyId:    v ? env.B2_VAULT_KEY_ID   : env.B2_COLD_KEY_ID,
    appKey:   v ? env.B2_VAULT_APP_KEY  : env.B2_COLD_APP_KEY,
    bucketId: v ? env.B2_VAULT_BUCKET_ID: env.B2_COLD_BUCKET_ID,
  };
}

// ── B2 Large File API ──────────────────────────────────────────

async function handleLargeStart(fileId, env, session) {
  const pending = await getPending(env, fileId, session.userId);
  if (!pending) return corsResponse({ error: 'Upload not found or expired' }, 404);

  const { keyId, appKey, bucketId } = b2Creds(pending, env);
  const b2 = await getB2Auth(keyId, appKey);

  const startResp = await fetch(`${b2.apiUrl}/b2api/v2/b2_start_large_file`, {
    method: 'POST',
    headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucketId,
      fileName: encodeURIComponent(pending.storageKey),
      contentType: pending.mimeType || 'application/octet-stream',
    }),
  });
  if (!startResp.ok) return corsResponse({ error: 'B2 large file start failed' }, 502);
  const { fileId: b2LargeFileId } = await startResp.json();

  const state = {
    b2LargeFileId, fileId,
    userId: session.userId,
    isVault: pending.isVault,
    partSha1s: [],
    apiUrl: b2.apiUrl,
    authToken: b2.authorizationToken,
  };
  await env.KV.put(`large_upload:${fileId}`, JSON.stringify(state), { expirationTtl: 86400 });

  return corsResponse({ b2LargeFileId });
}

async function handleLargePart(fileId, partNum, request, env, session) {
  if (partNum < 1 || partNum > 10000) return corsResponse({ error: 'Invalid part number' }, 400);

  const stateRaw = await env.KV.get(`large_upload:${fileId}`);
  if (!stateRaw) return corsResponse({ error: 'Large upload not started' }, 404);
  const state = JSON.parse(stateRaw);
  if (state.userId !== session.userId) return corsResponse({ error: 'Forbidden' }, 403);

  const { keyId, appKey } = b2Creds({ isVault: state.isVault }, env);
  const b2 = await getB2Auth(keyId, appKey);

  // Get a fresh part upload URL
  const partUrlResp = await fetch(`${b2.apiUrl}/b2api/v2/b2_get_upload_part_url`, {
    method: 'POST',
    headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: state.b2LargeFileId }),
  });
  if (!partUrlResp.ok) return corsResponse({ error: 'Failed to get part URL' }, 502);
  const { uploadUrl, authorizationToken } = await partUrlResp.json();

  // SHA1 computed client-side and sent as header; B2 verifies it
  const chunkSha1 = request.headers.get('X-Chunk-Sha1') || 'do_not_verify';
  const contentLength = request.headers.get('Content-Length') || '';

  const b2Resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization:         authorizationToken,
      'X-Bz-Part-Number':   String(partNum),
      'Content-Length':      contentLength,
      'X-Bz-Content-Sha1':  chunkSha1,
    },
    body: request.body,
    duplex: 'half',
  });
  if (!b2Resp.ok) {
    const errBody = await b2Resp.json().catch(() => ({}));
    return corsResponse({ error: errBody.message || 'Part upload failed' }, 502);
  }
  const partResult = await b2Resp.json();
  const partSha1 = partResult.contentSha1 || chunkSha1;

  // Update state with this part's SHA1
  state.partSha1s[partNum - 1] = partSha1;
  await env.KV.put(`large_upload:${fileId}`, JSON.stringify(state), { expirationTtl: 86400 });

  return corsResponse({ partSha1, partNum });
}

async function handleLargeFinish(fileId, request, env, session) {
  const stateRaw = await env.KV.get(`large_upload:${fileId}`);
  if (!stateRaw) return corsResponse({ error: 'Large upload not found' }, 404);
  const state = JSON.parse(stateRaw);
  if (state.userId !== session.userId) return corsResponse({ error: 'Forbidden' }, 403);

  const { sha1Array } = await request.json().catch(() => ({}));
  const partSha1Array = sha1Array || state.partSha1s.filter(Boolean);
  if (!partSha1Array.length) return corsResponse({ error: 'No parts uploaded' }, 400);

  const { keyId, appKey } = b2Creds({ isVault: state.isVault }, env);
  const b2 = await getB2Auth(keyId, appKey);

  const finishResp = await fetch(`${b2.apiUrl}/b2api/v2/b2_finish_large_file`, {
    method: 'POST',
    headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: state.b2LargeFileId, partSha1Array }),
  });
  if (!finishResp.ok) {
    const e = await finishResp.json().catch(() => ({}));
    return corsResponse({ error: e.message || 'Finish failed' }, 502);
  }

  await env.KV.delete(`large_upload:${fileId}`).catch(() => {});
  return corsResponse({ success: true });
}

async function handleLargeAbort(fileId, env, session) {
  const stateRaw = await env.KV.get(`large_upload:${fileId}`);
  if (!stateRaw) return corsResponse({ success: true });
  const state = JSON.parse(stateRaw);
  if (state.userId !== session.userId) return corsResponse({ error: 'Forbidden' }, 403);

  const { keyId, appKey } = b2Creds({ isVault: state.isVault }, env);
  const b2 = await getB2Auth(keyId, appKey);

  await fetch(`${b2.apiUrl}/b2api/v2/b2_cancel_large_file`, {
    method: 'POST',
    headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: state.b2LargeFileId }),
  }).catch(() => {});

  await env.KV.delete(`large_upload:${fileId}`).catch(() => {});
  return corsResponse({ success: true });
}
