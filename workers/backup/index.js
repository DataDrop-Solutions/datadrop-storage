// ============================================================
// DataDrop — Backup Worker (Cron: daily 02:00 IST)
// Exports D1 to datadrop-backup R2 bucket (Account A)
// Keeps 90 rolling backups, deletes older ones
// ============================================================

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBackup(env));
  },
  async fetch(request, env) {
    const auth = request.headers.get('X-Admin-Secret');
    if (auth !== env.ADMIN_SECRET) return new Response('Forbidden', { status: 403 });
    await runBackup(env);
    return new Response('Backup complete');
  },
};

async function runBackup(env) {
  const now      = new Date();
  const ts       = now.toISOString().replace(/[:.]/g, '-');
  const key      = `d1-backup/${ts}.jsonl`;
  const maxCount = 90;

  const tables = [
    'users', 'folders', 'files', 'shares', 'billing',
    'teams', 'team_members', 'team_billing', 'access_logs',
    'reports', 'config', 'notifications',
  ];

  const lines = [];
  for (const table of tables) {
    let cursor = null;
    let page = 0;
    while (true) {
      const query = cursor
        ? `SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT 1000`
        : `SELECT * FROM ${table} ORDER BY id LIMIT 1000`;

      const { results } = cursor
        ? await env.DB.prepare(query).bind(cursor).all()
        : await env.DB.prepare(query).all();

      for (const row of results) {
        lines.push(JSON.stringify({ _table: table, ...row }));
      }

      if (results.length < 1000) break;
      cursor = results[results.length - 1].id;
      page++;
      if (page > 100) break;
    }
  }

  const body = lines.join('\n');

  await env.R2_BACKUP.put(key, body, {
    httpMetadata: { contentType: 'application/jsonl' },
    customMetadata: {
      backup_date: now.toISOString(),
      row_count: String(lines.length),
    },
  });

  const listed = await env.R2_BACKUP.list({ prefix: 'd1-backup/' });
  const sorted = listed.objects.sort((a, b) => a.key.localeCompare(b.key));

  if (sorted.length > maxCount) {
    const toDelete = sorted.slice(0, sorted.length - maxCount);
    for (const obj of toDelete) {
      await env.R2_BACKUP.delete(obj.key);
    }
  }

  await cleanupTrash(env);
}

// ---------- Trash cleanup ----------
async function cleanupTrash(env) {
  const now = Date.now();

  const { results: expiredFiles } = await env.DB.prepare(
    `SELECT id, user_id, storage_key, bucket, size_bytes
     FROM files
     WHERE deleted_at IS NOT NULL
     AND trash_expires_at IS NOT NULL
     AND trash_expires_at < ?
     LIMIT 500`
  ).bind(now).all();

  if (expiredFiles.length === 0) return;

  for (const file of expiredFiles) {
    try {
      // Soft-delete and queue via canonical pipeline (queue first, consumer does B2 then D1)
      await env.DB.prepare('UPDATE files SET accessible = 0, b2_delete_queued = 1 WHERE id = ?').bind(file.id).run();
      await env.QUEUE.send({
        type: 'DELETE_FILE_FROM_BUCKET',
        fileId: file.id,
        storageKey: file.storage_key,
        bucket: file.bucket,
        deleteFromD1: true,
      });
    } catch (_) {}
  }
}

export { runBackup as backupScheduled };
export { runBackup };
