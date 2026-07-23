// ============================================================
// DataDrop — Migration Worker (Queue Consumer)
// Handles:
//   INSERT_FILE             — write confirmed upload to D1
//   DELETE_FILE_FROM_BUCKET — delete file bytes from B2
//   DELETE_USER_DATA        — full user data wipe
// ============================================================

import { getB2Auth, buildAccumulationBatch } from '../shared/utils.js';

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        await handleMessage(msg.body, env);
        msg.ack();
      } catch (_) {
        msg.retry();
      }
    }
  }
};

async function handleMessage(body, env) {
  switch (body.type) {
    case 'INSERT_FILE': return await insertFile(body, env);
    default: break;
  }
}

// ---------- Insert confirmed upload into D1 ----------
async function insertFile(body, env) {
  // Normalize bucket value: 'b2_main' → 'b2_cold' — they share credentials/bucket and
  // the D1 CHECK constraint only accepts ('r2_hot','b2_cold','b2_vault') (L-1).
  const bucketForD1 = (body.bucket === 'b2_main' || body.bucket === 'main') ? 'b2_cold' : (body.bucket || 'b2_cold');

  // INSERT OR IGNORE makes the consumer fully idempotent on queue retries (HIGH-8).
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO files (
      id, user_id, folder_id, team_id, filename, original_name, mime_type,
      size_bytes, size_gb, bucket, storage_key,
      is_vault, is_encrypted, quality, taken_at, hash_sha256,
      thumb_data, version_history, accessible, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
  `).bind(
    body.fileId,
    body.userId,
    body.folderId || null,
    body.teamId || null,
    body.filename,
    body.filename,
    body.mimeType || null,
    body.sizeBytes,
    body.sizeGb,
    bucketForD1,
    body.storageKey,
    body.isVault,
    body.isEncrypted,
    body.quality || 'original',
    body.takenAt || null,
    body.hashSha256 || null,
    body.thumbData || null,
    body.createdAt,
    body.createdAt,
  ).run();

  // Bill only when the row is newly inserted — skipped on retry (idempotent) (HIGH-9).
  if (result.meta?.changes > 0 && (body.sizeBytes || 0) > 0) {
    await env.DB.batch(buildAccumulationBatch(
      body.userId, env.DB, body.sizeBytes, body.billingUserId || null
    ));
  }
}


async function deleteFromB2(auth, bucket, storageKey) {
  // Loop until all B2 versions of this storage key are deleted.
  // B2 can hold multiple versions if the same key was uploaded more than once (e.g. retry).
  while (true) {
    const listResp = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_file_versions`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bucketId: auth.allowed?.bucketId,
        startFileName: storageKey,
        maxFileCount: 1,
      }),
    });

    if (!listResp.ok) throw new Error(`B2 list failed: ${listResp.status}`);
    const list = await listResp.json();
    const fileInfo = list.files?.[0];
    if (!fileInfo || fileInfo.fileName !== storageKey) return; // no more versions

    const delResp = await fetch(`${auth.apiUrl}/b2api/v2/b2_delete_file_version`, {
      method: 'POST',
      headers: {
        Authorization: auth.authorizationToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: fileInfo.fileName,
        fileId:   fileInfo.fileId,
      }),
    });

    if (!delResp.ok) throw new Error(`B2 delete failed: ${delResp.status}`);
    // Loop to delete next version if one exists
  }
}

// Named export for router queue handler
export const migrationQueue = async (batch, env) => {
  for (const msg of batch.messages) {
    try {
      if (msg.body.type === 'DELETE_FILE_FROM_BUCKET') {
        await deleteFileFromBucket(msg.body, env);
        msg.ack();
        continue;
      }
      if (msg.body.type === 'DELETE_USER_DATA') {
        await deleteUserData(msg.body, env);
        msg.ack();
        continue;
      }
      await handleMessage(msg.body, env);
      msg.ack();
    } catch (_) {
      msg.retry();
    }
  }
};

async function deleteFileFromBucket(body, env) {
  const { fileId, storageKey, bucket, deleteFromD1 } = body;

  if (!fileId && !storageKey) return;

  let key = storageKey, b = bucket;
  if (!key) {
    const file = await env.DB.prepare('SELECT storage_key, bucket FROM files WHERE id = ?').bind(fileId).first();
    if (!file) return;
    key = file.storage_key;
    b   = file.bucket;
  }

  // Resolve B2 credentials by bucket type
  // Priority: b2_main (new single bucket) > b2_vault > b2_cold (legacy)
  let keyId, appKey, bucketName;
  if (b === 'b2_main' || b === 'main') {
    keyId      = env.B2_MAIN_KEY_ID;
    appKey     = env.B2_MAIN_APP_KEY;
    bucketName = env.B2_MAIN_BUCKET || 'datadrop-main';
  } else if (b === 'b2_vault' || b === 'vault') {
    keyId      = env.B2_VAULT_KEY_ID;
    appKey     = env.B2_VAULT_APP_KEY;
    bucketName = env.B2_VAULT_BUCKET;
  } else {
    // b2_cold or legacy default
    keyId      = env.B2_COLD_KEY_ID;
    appKey     = env.B2_COLD_APP_KEY;
    bucketName = env.B2_COLD_BUCKET;
  }

  if (!keyId || !appKey) return; // credentials not configured for this bucket type

  const auth = await getB2Auth(keyId, appKey);
  await deleteFromB2(auth, bucketName, key);

  if (deleteFromD1 && fileId) {
    await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();
  }
}

async function deleteUserData(body, env) {
  const { userId } = body;

  const { results: files } = await env.DB.prepare(
    'SELECT id, storage_key, bucket FROM files WHERE user_id = ?'
  ).bind(userId).all();

  for (const file of files) {
    try {
      await deleteFileFromBucket({ fileId: file.id, storageKey: file.storage_key, bucket: file.bucket }, env);
    } catch (_) {}
  }

  await env.DB.prepare('DELETE FROM files WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM folders WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM shares WHERE owner_id = ? OR recipient_user_id = ?').bind(userId, userId).run();

  // Purge all cryptographic key material belonging to this user
  await env.DB.prepare('DELETE FROM file_keys WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM team_keys WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM workspace_root_keys WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM workspace_folder_keys WHERE user_id = ?').bind(userId).run();
  await env.DB.prepare('DELETE FROM vault_config WHERE user_id = ?').bind(userId).run();
  // Clear legacy V1 vault columns
  await env.DB.prepare(`
    UPDATE users SET
      vault_pin_hash = NULL, vault_salt = NULL, vault_encrypted_key = NULL,
      vault_phrase_salt = NULL, vault_phrase_hash = NULL, vault_phrase_enc_key = NULL,
      vault_setup_at = NULL, updated_at = ?
    WHERE id = ?
  `).bind(Date.now(), userId).run();

  // Remove team memberships and expire pending invitations
  await env.DB.prepare("DELETE FROM team_members WHERE user_id = ?").bind(userId).run();
  await env.DB.prepare("UPDATE team_invites SET status = 'expired' WHERE invited_user_id = ? AND status = 'pending'").bind(userId).run();
  await env.DB.prepare('DELETE FROM storage_usage WHERE user_id = ?').bind(userId).run();

  // Clear all cached sessions for this user
  try {
    const sessionSuffixes = await env.KV.get(`session_uid:${userId}`);
    if (sessionSuffixes) {
      await Promise.allSettled(sessionSuffixes.split(',').filter(Boolean).map(s => env.KV.delete(`session:${s}`)));
    }
  } catch (_) {}
  await env.KV.delete(`session_uid:${userId}`).catch(() => {});
  await env.KV.delete(`pin_attempts:recover:${userId}`).catch(() => {});

  await env.KV.delete(`storage:${userId}`);
  await env.KV.delete(`pin_attempts:${userId}`);
  await Promise.allSettled(
    ['trial_day6','lapsed_day8','lapsed_day10','lapsed_day13']
      .map(type => env.KV.delete(`trial_notif:${userId}:${type}`))
  );

  if (env.CLERK_SECRET_KEY && body.clerkUserId) {
    try {
      await fetch(`https://api.clerk.com/v1/users/${body.clerkUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
      });
    } catch (_) {}
  }
}
