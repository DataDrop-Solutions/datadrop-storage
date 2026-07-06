// ============================================================
// DataDrop — Migration Worker (Queue Consumer)
// Handles:
//   INSERT_FILE             — write confirmed upload to D1
//   DELETE_FILE_FROM_BUCKET — delete file bytes from B2
//   DELETE_USER_DATA        — full user data wipe
// ============================================================

import { getB2Auth } from '../shared/utils.js';

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
  await env.DB.prepare(`
    INSERT INTO files (
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
    body.bucket,
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
}


async function deleteFromB2(auth, bucket, storageKey) {
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
  if (!fileInfo || fileInfo.fileName !== storageKey) return;

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

  const isVault = b === 'b2_vault' || b === 'vault';
  const keyId   = isVault ? env.B2_VAULT_KEY_ID  : env.B2_COLD_KEY_ID;
  const appKey  = isVault ? env.B2_VAULT_APP_KEY : env.B2_COLD_APP_KEY;
  const bucket_ = isVault ? env.B2_VAULT_BUCKET  : env.B2_COLD_BUCKET;
  const auth = await getB2Auth(keyId, appKey);
  await deleteFromB2(auth, bucket_, key);

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
