// ============================================================
// DataDrop — Upload Worker
// Route: POST /upload/dedup               → SHA-256 dedup check
// Route: POST /upload/init                → reserve upload slot
// Route: POST /upload/confirm             → confirm upload, insert to D1
// Route: POST /upload/direct/:fileId      → single-part proxy (< 100 MB)
// Route: POST /upload/large/:fileId/start  → B2 large file init (≥ 100 MB)
// Route: POST /upload/large/:fileId/part/:n→ upload one part
// Route: POST /upload/large/:fileId/finish → finalize large file
// Route: POST /upload/large/:fileId/abort  → cancel large file
// ============================================================

import {
  corsResponse, handleOptions, validateSession, getConfigNum, getStorageCapacity,
  incrementStorageBytes, calcStorageCost,
  getB2Auth, getB2UploadUrl, newId, bytesToGb, gbToBytes, GB,
  sendEmail, resolveUploadBucket, b2CredsForBucket, b2ObjectKey,
} from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

    const url  = new URL(request.url);
    const path = url.pathname.replace('/upload', '');

    try {
      if (path === '/dedup'   && request.method === 'POST') return await handleDedup(request, env, session);
      if (path === '/init'    && request.method === 'POST') return await handleInit(request, env, session);
      if (path === '/confirm' && request.method === 'POST') return await handleConfirm(request, env, session);

      const directMatch = path.match(/^\/direct\/([a-f0-9]+)$/);
      if (directMatch && request.method === 'POST') return await handleDirectProxy(directMatch[1], request, env, session);

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

  const existing = await env.DB.prepare(
    `SELECT id, filename, size_bytes FROM files
     WHERE user_id = ? AND hash_sha256 = ? AND folder_id ${folderId ? '= ?' : 'IS NULL'}
     AND team_id IS NULL AND (is_vault = 0 OR is_vault IS NULL)
     AND deleted_at IS NULL AND version_of IS NULL LIMIT 1`
  ).bind(...(folderId ? [session.userId, hash, folderId] : [session.userId, hash])).first();

  return corsResponse({ duplicate: !!existing, existingFileId: existing?.id || null });
}

// ---------- Init upload ----------
async function handleInit(request, env, session) {
  const {
    filename, mimeType, sizeBytes, folderId, isVault = false,
    quality = 'original', takenAt, hash, isEncrypted = false, teamId = null,
  } = await request.json();

  if (!filename || !sizeBytes) return corsResponse({ error: 'filename and sizeBytes required' }, 400);

  const MAX_BYTES = 50 * 1024 * 1024 * 1024;
  if (typeof sizeBytes !== 'number' || sizeBytes <= 0 || sizeBytes > MAX_BYTES) {
    const msg = (typeof sizeBytes === 'number' && sizeBytes <= 0)
      ? 'File is empty (0 bytes) — cannot upload'
      : 'Invalid file size (max 50 GB)';
    return corsResponse({ error: msg }, 400);
  }
  if (isVault && (!mimeType || !mimeType.startsWith('encrypted:'))) {
    return corsResponse({ error: 'Vault uploads must have mimeType starting with encrypted:' }, 400);
  }

  // Team upload permission check
  if (teamId) {
    const team = await env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(teamId).first();
    if (!team) return corsResponse({ error: 'Team not found' }, 404);
    if (team.owner_id !== session.userId) {
      const mem = await env.DB.prepare(
        "SELECT role FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'"
      ).bind(teamId, session.userId).first();
      if (!mem || mem.role === 'read') return corsResponse({ error: 'Upload permission required' }, 403);
    }
  }

  const user = await env.DB.prepare(
    'SELECT wallet_balance, wallet_limit, status, trial_ends_at FROM users WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return corsResponse({ error: 'User not found' }, 404);

  if (user.status === 'suspended')  return corsResponse({ error: 'Account suspended' }, 403);
  if (user.status === 'deleted')    return corsResponse({ error: 'Account closed' }, 403);
  if (user.status === 'read_only')  return corsResponse({ error: 'Uploads paused — account is in payment recovery mode. Please resolve your outstanding invoice.', code: 'PAYMENT_RECOVERY' }, 402);

  const isTrial = user.status === 'trial';
  if (isTrial) {
    const trialGbLimit = await getConfigNum(env, 'trial_gb_limit') || 5;
    // Read actual D1 sum — KV counter can lag, allowing trial bypass (M-2)
    const trialRow = await env.DB.prepare(
      'SELECT COALESCE(SUM(size_bytes), 0) as total FROM files WHERE user_id = ? AND deleted_at IS NULL'
    ).bind(session.userId).first();
    const currentBytes = trialRow?.total || 0;
    if (currentBytes + sizeBytes > gbToBytes(trialGbLimit)) {
      return corsResponse({ error: `Trial storage limit (${trialGbLimit} GB) reached`, code: 'TRIAL_LIMIT' }, 402);
    }
  } else if (!teamId) {
    // Spending protection limit check for paid personal uploads
    const mandate = await env.DB.prepare(
      "SELECT protection_limit FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1 LIMIT 1"
    ).bind(session.userId).first();
    const protectionLimit = mandate?.protection_limit || user.wallet_limit || 0;

    if (protectionLimit > 0) {
      const price = await getConfigNum(env, 'storage_price_per_gb_month');
      let capacityBytes;
      try {
        ({ capacityBytes } = getStorageCapacity(protectionLimit, price));
      } catch (_) {
        return corsResponse({ error: 'Storage pricing not configured. Uploads temporarily unavailable.', code: 'PRICING_ERROR' }, 503);
      }
      // Use D1 file sum for accuracy — same approach as trial check
      const storedRow = await env.DB.prepare(
        'SELECT COALESCE(SUM(size_bytes), 0) as total FROM files WHERE user_id = ? AND deleted_at IS NULL'
      ).bind(session.userId).first();
      const currentBytes = storedRow?.total || 0;
      if (currentBytes + sizeBytes > capacityBytes) {
        return corsResponse({
          error: 'You have reached your approved storage capacity. Increase your monthly limit or delete files to continue uploading.',
          code: 'LIMIT_EXCEEDED',
          currentBytes,
          capacityBytes,
          limit: protectionLimit,
        }, 402);
      }
    }
  }

  const fileId    = newId();
  const bucket    = resolveUploadBucket(env, isVault);
  // New opaque key format: no filename in B2
  const storageKey = b2ObjectKey(session.userId, fileId);

  const pendingData = JSON.stringify({
    fileId, userId: session.userId, filename, mimeType, sizeBytes,
    folderId: folderId || null, isVault, isEncrypted, quality,
    takenAt: takenAt || null, hash: hash || null,
    storageKey, bucket, teamId: teamId || null,
  });

  try {
    await env.KV.put(`pending_upload:${fileId}`, pendingData, { expirationTtl: 3600 });
  } catch (_) {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO pending_uploads (file_id, user_id, data, expires_at) VALUES (?, ?, ?, ?)'
    ).bind(fileId, session.userId, pendingData, Date.now() + 3600000).run();
  }

  return corsResponse({ fileId, storageKey });
}

// ---------- Confirm upload ----------
// confirmedBytes MUST be provided from B2's response — never trust client-declared size.
async function handleConfirm(request, env, session) {
  const { fileId, thumbData, confirmedBytes } = await request.json();
  if (!fileId) return corsResponse({ error: 'fileId required' }, 400);

  const pending = await getPending(env, fileId, session.userId);
  if (!pending) return corsResponse({ error: 'Upload not found or expired' }, 404);

  // Use B2-confirmed size for billing. Fall back to declared size only if confirm is missing
  // (legacy clients that don't send confirmedBytes yet).
  const authoratativeBytes = (typeof confirmedBytes === 'number' && confirmedBytes > 0)
    ? confirmedBytes
    : pending.sizeBytes;

  const sizeGb = bytesToGb(authoratativeBytes);
  const now    = Date.now();

  // Resolve billing user: workspace files bill the team owner
  let billingUserId = null;
  if (pending.teamId) {
    const team = await env.DB.prepare('SELECT owner_id FROM teams WHERE id = ?').bind(pending.teamId).first();
    billingUserId = team?.owner_id || null;
  }

  // Vault files: only store the encrypted thumbnail (enc_thumb: prefix); reject plain thumbnails.
  // Non-vault files: store any thumbnail up to 28 KB.
  const isEncThumb = typeof thumbData === 'string' && thumbData.startsWith('enc_thumb:')
  const thumbDataClean = typeof thumbData === 'string' && thumbData.length <= 28000
    ? (pending.isVault ? (isEncThumb ? thumbData : null) : thumbData)
    : null;

  // Insert file via queue. Billing (buildAccumulationBatch) happens inside the queue consumer
  // after a successful INSERT OR IGNORE — ensures billing is atomic with file insertion and
  // idempotent on queue retries (HIGH-9 / HIGH-B4).
  await env.QUEUE.send({
    type:          'INSERT_FILE',
    fileId:        pending.fileId,
    userId:        pending.userId,
    folderId:      pending.folderId,
    teamId:        pending.teamId || null,
    filename:      pending.filename,
    mimeType:      pending.mimeType || null,
    sizeBytes:     authoratativeBytes,
    sizeGb,
    bucket:        pending.bucket,
    storageKey:    pending.storageKey,
    isVault:       pending.isVault ? 1 : 0,
    isEncrypted:   pending.isEncrypted ? 1 : 0,
    quality:       pending.quality,
    takenAt:       pending.takenAt,
    hashSha256:    pending.hash,
    thumbData:     thumbDataClean,
    billingUserId: billingUserId || null,
    createdAt:     now,
  });

  // KV counter update for immediate display only — billing source of truth is D1.
  await incrementStorageBytes(env, billingUserId || session.userId, authoratativeBytes);

  await env.KV.delete(`pending_upload:${fileId}`).catch(() => {});
  await env.DB.prepare('DELETE FROM pending_uploads WHERE file_id = ?').bind(fileId).run();

  await checkWalletThresholds(env, session.userId);

  return corsResponse({ success: true, fileId, sizeGb });
}

// ---------- Direct proxy upload ----------
async function handleDirectProxy(fileId, request, env, session) {
  const pending = await getPending(env, fileId, session.userId);
  if (!pending) return corsResponse({ error: 'Upload not found or expired' }, 404);

  const creds   = b2CredsForBucket(env, pending.bucket);
  const b2Auth  = await getB2Auth(creds.keyId, creds.appKey);
  const { uploadUrl, authorizationToken } = await getB2UploadUrl(b2Auth, creds.bucketId);

  const b2Resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization':     authorizationToken,
      'X-Bz-File-Name':    encodeURIComponent(pending.storageKey),
      'Content-Type':      pending.mimeType || 'application/octet-stream',
      'Content-Length':    String(pending.sizeBytes),
      'X-Bz-Content-Sha1': 'do_not_verify',
    },
    body: request.body,
  });

  if (!b2Resp.ok) return corsResponse({ error: 'Upload to B2 failed' }, 502);

  // Extract B2's confirmed content length for billing accuracy
  const b2Result = await b2Resp.json().catch(() => ({}));
  const confirmedBytes = b2Result.contentLength || pending.sizeBytes;

  return corsResponse({ success: true, confirmedBytes });
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

  const month = new Date().toISOString().slice(0, 7);
  for (const t of thresholds) {
    if (usedPct >= t.pct) {
      const notifKey = `notif:${userId}:${t.type}:${month}`;
      try {
        const already = await env.KV.get(notifKey);
        if (already) continue;
        await env.KV.put(notifKey, '1', { expirationTtl: 86400 * 35 });
      } catch (_) { continue; }
      await sendEmail(env, {
        to: user.email,
        subject: t.pct >= 100
          ? 'DataDrop: Storage budget reached — uploads paused'
          : `DataDrop: You have used ${t.label} of your storage budget`,
        html: walletAlertHtml(t.pct, user.wallet_limit, user.wallet_balance),
      });
    }
  }
}

function walletAlertHtml(pct, limit, balance) {
  if (pct >= 100) {
    return `<p>Your DataDrop storage wallet is empty. Uploads are paused.</p>
            <p>Top up at <a href="https://app.datadrop.co.in/billing">app.datadrop.co.in/billing</a>.</p>`;
  }
  return `<p>You've used 80% of your ₹${limit} DataDrop budget.</p>
          <p>Remaining: ₹${balance.toFixed(2)}</p>
          <p>Manage at <a href="https://app.datadrop.co.in/billing">app.datadrop.co.in/billing</a>.</p>`;
}

// ---------- Helpers ----------
async function getPending(env, fileId, userId) {
  let raw = null;
  try { raw = await env.KV.get(`pending_upload:${fileId}`); } catch (_) {}
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

// ---------- B2 Large File API ----------
async function handleLargeStart(fileId, env, session) {
  const pending = await getPending(env, fileId, session.userId);
  if (!pending) return corsResponse({ error: 'Upload not found or expired' }, 404);

  const creds = b2CredsForBucket(env, pending.bucket);
  const b2    = await getB2Auth(creds.keyId, creds.appKey);

  const startResp = await fetch(`${b2.apiUrl}/b2api/v2/b2_start_large_file`, {
    method: 'POST',
    headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucketId:    creds.bucketId,
      fileName:    encodeURIComponent(pending.storageKey),
      contentType: pending.mimeType || 'application/octet-stream',
    }),
  });
  if (!startResp.ok) return corsResponse({ error: 'B2 large file start failed' }, 502);
  const { fileId: b2LargeFileId } = await startResp.json();

  const state = {
    b2LargeFileId, fileId,
    userId:    session.userId,
    bucket:    pending.bucket,
    sizeBytes: pending.sizeBytes,
    partSha1s: [],
    apiUrl:    b2.apiUrl,
  };
  try { await env.KV.put(`large_upload:${fileId}`, JSON.stringify(state), { expirationTtl: 86400 }); } catch (_) {}

  return corsResponse({ b2LargeFileId });
}

async function handleLargePart(fileId, partNum, request, env, session) {
  if (partNum < 1 || partNum > 10000) return corsResponse({ error: 'Invalid part number' }, 400);

  const stateRaw = await env.KV.get(`large_upload:${fileId}`).catch(() => null);
  if (!stateRaw) return corsResponse({ error: 'Large upload not started' }, 404);
  const state = JSON.parse(stateRaw);
  if (state.userId !== session.userId) return corsResponse({ error: 'Forbidden' }, 403);

  const creds = b2CredsForBucket(env, state.bucket);
  const b2    = await getB2Auth(creds.keyId, creds.appKey);

  const partUrlResp = await fetch(`${b2.apiUrl}/b2api/v2/b2_get_upload_part_url`, {
    method: 'POST',
    headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: state.b2LargeFileId }),
  });
  if (!partUrlResp.ok) return corsResponse({ error: 'Failed to get part URL' }, 502);
  const { uploadUrl, authorizationToken } = await partUrlResp.json();

  const chunkSha1     = request.headers.get('X-Chunk-Sha1') || 'do_not_verify';
  const contentLength = request.headers.get('Content-Length') || '';

  const b2Resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization:        authorizationToken,
      'X-Bz-Part-Number':   String(partNum),
      'Content-Length':     contentLength,
      'X-Bz-Content-Sha1':  chunkSha1,
    },
    body: request.body,
    duplex: 'half',
  });
  if (!b2Resp.ok) {
    const e = await b2Resp.json().catch(() => ({}));
    return corsResponse({ error: e.message || 'Part upload failed' }, 502);
  }
  const partResult = await b2Resp.json();
  const partSha1   = partResult.contentSha1 || chunkSha1;

  state.partSha1s[partNum - 1] = partSha1;
  try { await env.KV.put(`large_upload:${fileId}`, JSON.stringify(state), { expirationTtl: 86400 }); } catch (_) {}

  return corsResponse({ partSha1, partNum });
}

async function handleLargeFinish(fileId, request, env, session) {
  const stateRaw = await env.KV.get(`large_upload:${fileId}`).catch(() => null);
  if (!stateRaw) return corsResponse({ error: 'Large upload not found' }, 404);
  const state = JSON.parse(stateRaw);
  if (state.userId !== session.userId) return corsResponse({ error: 'Forbidden' }, 403);

  const { sha1Array } = await request.json().catch(() => ({}));
  const partSha1Array = sha1Array || state.partSha1s.filter(Boolean);
  if (!partSha1Array.length) return corsResponse({ error: 'No parts uploaded' }, 400);

  const creds = b2CredsForBucket(env, state.bucket);
  const b2    = await getB2Auth(creds.keyId, creds.appKey);

  const finishResp = await fetch(`${b2.apiUrl}/b2api/v2/b2_finish_large_file`, {
    method: 'POST',
    headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: state.b2LargeFileId, partSha1Array }),
  });
  if (!finishResp.ok) {
    const e = await finishResp.json().catch(() => ({}));
    return corsResponse({ error: e.message || 'Finish failed' }, 502);
  }

  const finishResult   = await finishResp.json();
  // Fall back to declared size — never to 0 (would zero-out billing) (M-12)
  const confirmedBytes = finishResult.contentLength || state.sizeBytes || 0;

  try { await env.KV.delete(`large_upload:${fileId}`); } catch (_) {}
  return corsResponse({ success: true, confirmedBytes });
}

async function handleLargeAbort(fileId, env, session) {
  const stateRaw = await env.KV.get(`large_upload:${fileId}`).catch(() => null);
  if (!stateRaw) return corsResponse({ success: true });
  const state = JSON.parse(stateRaw);
  if (state.userId !== session.userId) return corsResponse({ error: 'Forbidden' }, 403);

  const creds = b2CredsForBucket(env, state.bucket);
  const b2    = await getB2Auth(creds.keyId, creds.appKey);

  await fetch(`${b2.apiUrl}/b2api/v2/b2_cancel_large_file`, {
    method: 'POST',
    headers: { Authorization: b2.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: state.b2LargeFileId }),
  }).catch(() => {});

  try { await env.KV.delete(`large_upload:${fileId}`); } catch (_) {}
  return corsResponse({ success: true });
}
