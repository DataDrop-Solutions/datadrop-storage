// ============================================================
// DataDrop — Reconcile Worker (Cron: every hour)
// Corrects storage_usage.current_bytes drift vs. D1 files table
// CRITICAL: NEVER modifies accumulated_byte_seconds during recovery
// ============================================================

import { buildAccumulationBatch, decrementStorageBytes, newId, sendEmail } from '../shared/utils.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(reconcile(env));
    ctx.waitUntil(expireTrash(env));
    ctx.waitUntil(cleanupUnconfirmedShares(env));
    ctx.waitUntil(cleanupStalePendingUploads(env));
    ctx.waitUntil(cleanupSupersededMandates(env));
    ctx.waitUntil(reQueueStaleDeletions(env));
  },
  async fetch(request, env) {
    const auth = request.headers.get('X-Admin-Secret');
    if (auth !== env.ADMIN_SECRET) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url);
    if (url.pathname === '/cleanup-mandates') {
      await cleanupSupersededMandates(env);
      return new Response('Mandate cleanup complete');
    }
    await reconcile(env);
    await expireTrash(env);
    await cleanupUnconfirmedShares(env);
    await cleanupStalePendingUploads(env);
    await cleanupSupersededMandates(env);
    await reQueueStaleDeletions(env);
    return new Response('Reconcile complete');
  },
};

const RECONCILE_BATCH = 500;

async function reconcile(env) {
  // Cursor-based pagination: process at most RECONCILE_BATCH users per hourly invocation.
  // Cursor is the last processed user_id; stored in KV and cleared when a full pass completes (HIGH-15).
  const cursor = await env.KV.get('reconcile_cursor').catch(() => null) || '';

  const { results: usageRows } = await env.DB.prepare(
    `SELECT user_id, current_bytes FROM storage_usage WHERE user_id > ? ORDER BY user_id LIMIT ?`
  ).bind(cursor, RECONCILE_BATCH).all();

  for (const row of usageRows) {
    try {
      const { user_id: userId, current_bytes: storedBytes } = row;

      const actual = await env.DB.prepare(
        'SELECT COALESCE(SUM(size_bytes), 0) as total FROM files WHERE user_id = ? AND deleted_at IS NULL'
      ).bind(userId).first();
      const actualBytes = actual?.total || 0;

      const drift = Math.abs(actualBytes - storedBytes);
      if (drift <= 1024) continue;

      const now = Date.now();

      // Accumulate with old (drifted) current_bytes first, then correct.
      // CRITICAL: accumulated_byte_seconds is NOT reset here.
      await env.DB.batch([
        // INSERT OR IGNORE in case row disappeared
        env.DB.prepare(
          'INSERT OR IGNORE INTO storage_usage (user_id, current_bytes, accumulated_byte_seconds, last_updated_at, billing_month) VALUES (?, 0, 0, ?, ?)'
        ).bind(userId, now, currentBillingMonth()),
        // Accumulate elapsed byte-seconds using the current (drifted) value
        env.DB.prepare(
          'UPDATE storage_usage SET accumulated_byte_seconds = accumulated_byte_seconds + (current_bytes * (? - last_updated_at) / 1000.0), last_updated_at = ? WHERE user_id = ?'
        ).bind(now, now, userId),
        // Correct current_bytes to actual D1 value
        env.DB.prepare(
          'UPDATE storage_usage SET current_bytes = ? WHERE user_id = ?'
        ).bind(actualBytes, userId),
      ]);

      // Also sync KV for real-time meter
      try { await env.KV.put(`storage:${userId}`, String(actualBytes)); } catch (_) {}

      // Log drift to admin_logs
      const logId = newId();
      await env.DB.prepare(
        'INSERT INTO admin_logs (id, type, user_id, expected_bytes, actual_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(logId, 'storage_drift', userId, storedBytes, actualBytes, now).run();

      // Alert if drift > 1 MB
      if (drift > 1048576) {
        await sendEmail(env, {
          to: 'datadrop.contact@gmail.com',
          subject: `DataDrop: Storage drift detected (${(drift / 1048576).toFixed(2)} MB)`,
          html: `<p>Storage drift detected for user <code>${userId}</code></p>
                 <ul>
                   <li>storage_usage.current_bytes: ${storedBytes}</li>
                   <li>D1 SUM(files.size_bytes): ${actualBytes}</li>
                   <li>Drift: ${drift} bytes (${(drift / 1048576).toFixed(2)} MB)</li>
                 </ul>
                 <p>current_bytes corrected. accumulated_byte_seconds preserved.</p>`,
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // Advance or clear cursor
  if (usageRows.length >= RECONCILE_BATCH) {
    const lastId = usageRows[usageRows.length - 1].user_id;
    await env.KV.put('reconcile_cursor', lastId, { expirationTtl: 86400 }).catch(() => {});
  } else {
    await env.KV.delete('reconcile_cursor').catch(() => {});
  }
}

function currentBillingMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- Expire trash ----------
async function expireTrash(env) {
  const now = Date.now();

  const { results: expired } = await env.DB.prepare(
    `SELECT id, storage_key, bucket, size_bytes, user_id
     FROM files WHERE deleted_at IS NOT NULL AND trash_expires_at < ? LIMIT 200`
  ).bind(now).all();

  if (!expired.length) return;

  for (const file of expired) {
    try {
      const { results: versions } = await env.DB.prepare(
        'SELECT id, storage_key, bucket FROM files WHERE version_of = ?'
      ).bind(file.id).all();

      for (const v of versions) {
        await env.DB.prepare('UPDATE files SET accessible = 0, b2_delete_queued = 1 WHERE id = ?').bind(v.id).run();
        await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: v.id, storageKey: v.storage_key, bucket: v.bucket, deleteFromD1: true });
      }

      await env.DB.prepare('UPDATE files SET accessible = 0, b2_delete_queued = 1 WHERE id = ?').bind(file.id).run();
      await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: file.id, storageKey: file.storage_key, bucket: file.bucket, deleteFromD1: true });
    } catch (_) {}
  }
}

// ---------- 24-hour delete_on_confirm fallback ----------
async function cleanupUnconfirmedShares(env) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  const { results: shares } = await env.DB.prepare(
    `SELECT s.id, s.file_id, s.owner_id
     FROM shares s
     WHERE s.delete_on_confirm = 1
       AND s.confirmed_at IS NULL
       AND s.views_used > 0
       AND s.updated_at < ?
       AND s.status = 'active'
     LIMIT 50`
  ).bind(cutoff).all();

  if (!shares.length) return;

  for (const share of shares) {
    try {
      const now = Date.now();
      // 'auto_deleted' is not a valid status (CHECK constraint). Use 'completed' instead.
      await env.DB.prepare("UPDATE shares SET status = 'completed', confirmed_at = ? WHERE id = ?")
        .bind(now, share.id).run();

      const file = await env.DB.prepare(
        'SELECT id, size_bytes, storage_key, bucket, deleted_at FROM files WHERE id = ? AND user_id = ?'
      ).bind(share.file_id, share.owner_id).first();

      if (file) {
        // Purge crypto material immediately
        await env.DB.prepare('DELETE FROM file_keys WHERE file_id = ?').bind(file.id).run();
        // Decrement billing if file not already trashed
        if (!file.deleted_at && (file.size_bytes || 0) > 0) {
          await env.DB.batch(buildAccumulationBatch(share.owner_id, env.DB, -(file.size_bytes || 0)));
          await decrementStorageBytes(env, share.owner_id, file.size_bytes || 0);
        }
        // Soft-delete and queue via canonical pipeline
        await env.DB.prepare(
          'UPDATE files SET accessible = 0, b2_delete_queued = 1, deleted_at = COALESCE(deleted_at, ?) WHERE id = ?'
        ).bind(now, file.id).run();
        await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: file.id, storageKey: file.storage_key, bucket: file.bucket, deleteFromD1: true });
      }
    } catch (_) {}
  }
}

// ---------- Clean up stale pending_uploads (uploads started but never confirmed) ----------
async function cleanupStalePendingUploads(env) {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 hours
  try {
    // Queue B2 deletion for any stale entry that has a storage_key (bytes may be in B2) (M-10)
    const { results: stale } = await env.DB.prepare(
      'SELECT file_id, data FROM pending_uploads WHERE expires_at < ? LIMIT 100'
    ).bind(cutoff).all();

    for (const row of stale) {
      try {
        const data = JSON.parse(row.data || '{}');
        if (data.storageKey && data.bucket) {
          await env.QUEUE.send({
            type: 'DELETE_FILE_FROM_BUCKET',
            fileId: row.file_id,
            storageKey: data.storageKey,
            bucket: data.bucket,
            deleteFromD1: false,
          });
        }
      } catch (_) {}
    }

    await env.DB.prepare(
      'DELETE FROM pending_uploads WHERE expires_at < ?'
    ).bind(cutoff).run();
  } catch (_) {}
}

// ---------- Cancel superseded mandate Razorpay tokens after grace period ----------
// Runs every hour. Idempotent: a mandate is only processed while cancelled_at IS NULL.
// Grace period (default 48 h) gives time for Razorpay issues / rollbacks to self-heal
// before we permanently delete the token. Billing is already safe — billing worker
// filters is_active=1, so superseded mandates are never charged.
async function cleanupSupersededMandates(env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return;

  // Default grace period: 48 hours. Configurable via KV/D1 config key.
  let graceHours = 48;
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM config WHERE key = 'mandate_supersede_grace_hours'"
    ).first();
    if (row?.value) graceHours = parseFloat(row.value) || 48;
  } catch (_) {}

  const cutoff = Date.now() - graceHours * 3600 * 1000;

  const { results: superseded } = await env.DB.prepare(
    `SELECT id, razorpay_customer_id, razorpay_token_id
     FROM wallet_mandates
     WHERE status = 'cancelled'
       AND superseded_at IS NOT NULL
       AND cancelled_at  IS NULL
       AND superseded_at < ?
     LIMIT 50`
  ).bind(cutoff).all().catch(() => ({ results: [] }));

  if (!superseded.length) return;

  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  for (const mandate of superseded) {
    try {
      let tokenCancelOk = false;

      if (!mandate.razorpay_customer_id || !mandate.razorpay_token_id) {
        // No token to cancel (edge-case: mandate was never activated with a token)
        tokenCancelOk = true;
      } else {
        const resp = await fetch(
          `https://api.razorpay.com/v1/customers/${mandate.razorpay_customer_id}/tokens/${mandate.razorpay_token_id}`,
          { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } }
        ).catch(() => null);

        // 200 = just deleted; 404 = token already gone (idempotent success)
        tokenCancelOk = resp && (resp.status === 200 || resp.status === 404);
      }

      if (tokenCancelOk) {
        // Mark as fully cancelled. WHERE cancelled_at IS NULL prevents double-write.
        await env.DB.prepare(
          "UPDATE wallet_mandates SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL"
        ).bind(Date.now(), mandate.id).run();
      }
      // Non-200/404 responses: leave cancelled_at NULL so next hourly run retries
    } catch (_) {}
  }
}

// ---------- Re-queue files stuck with b2_delete_queued=1 (lost queue messages) ----------
// Safety net for HIGH-16 / L-4: if the worker crashed after setting the flag but before
// env.QUEUE.send(), or after max retries exhausted into DLQ, the file stays in D1 + B2 forever.
// Any file with b2_delete_queued=1 for more than 10 minutes is considered stale and re-queued.
async function reQueueStaleDeletions(env) {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
  try {
    const { results: stale } = await env.DB.prepare(
      `SELECT id, storage_key, bucket FROM files
       WHERE b2_delete_queued = 1 AND deleted_at < ? LIMIT 200`
    ).bind(cutoff).all();

    for (const file of stale) {
      try {
        if (!file.storage_key || !file.bucket) continue;
        await env.QUEUE.send({
          type: 'DELETE_FILE_FROM_BUCKET',
          fileId: file.id,
          storageKey: file.storage_key,
          bucket: file.bucket,
          deleteFromD1: true,
        });
      } catch (_) {}
    }
  } catch (_) {}
}

export { reconcile, expireTrash, cleanupUnconfirmedShares, cleanupStalePendingUploads, cleanupSupersededMandates, reQueueStaleDeletions };
