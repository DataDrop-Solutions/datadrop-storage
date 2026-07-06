// ============================================================
// DataDrop — Reconcile Worker (Cron: every hour)
// Corrects storage_usage.current_bytes drift vs. D1 files table
// CRITICAL: NEVER modifies accumulated_byte_seconds during recovery
// ============================================================

import { buildAccumulationBatch, newId, sendEmail } from '../shared/utils.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(reconcile(env));
    ctx.waitUntil(expireTrash(env));
    ctx.waitUntil(cleanupUnconfirmedShares(env));
  },
  async fetch(request, env) {
    const auth = request.headers.get('X-Admin-Secret');
    if (auth !== env.ADMIN_SECRET) return new Response('Forbidden', { status: 403 });
    await reconcile(env);
    await expireTrash(env);
    await cleanupUnconfirmedShares(env);
    return new Response('Reconcile complete');
  },
};

async function reconcile(env) {
  const { results: usageRows } = await env.DB.prepare(
    'SELECT user_id, current_bytes FROM storage_usage'
  ).all();

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
        await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(v.id).run();
        await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: v.id, storageKey: v.storage_key, bucket: v.bucket, deleteFromD1: false });
      }

      await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(file.id).run();
      await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: file.id, storageKey: file.storage_key, bucket: file.bucket, deleteFromD1: false });
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
      await env.DB.prepare("UPDATE shares SET status = 'auto_deleted', confirmed_at = ? WHERE id = ?")
        .bind(Date.now(), share.id).run();
      await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: share.file_id, deleteFromD1: true });
    } catch (_) {}
  }
}

export { reconcile };
