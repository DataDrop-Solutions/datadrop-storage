// ============================================================
// DataDrop — Files Handler
// GET    /files              → list files (paginated)
// GET    /files/:id          → file metadata
// PUT    /files/:id          → rename/move
// DELETE /files/:id          → soft delete (trash)
// POST   /files/:id/restore  → restore from trash
// GET    /files/:id/versions → version list
// POST   /files/folder       → create folder
// DELETE /files/folder/:id   → delete folder
// ============================================================

import { corsResponse, handleOptions, validateSession, newId, decrementStorageBytes, isValidId, checkApiRateLimit } from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

    if (!(await checkApiRateLimit(env, session.userId))) {
      return corsResponse({ error: 'Too many requests' }, 429);
    }

    const url   = new URL(request.url);
    const path  = url.pathname.replace('/files', '');
    const parts = path.split('/').filter(Boolean);

    try {
      // Folder operations
      if (parts[0] === 'folder') {
        if (request.method === 'POST' && !parts[1])                                              return await createFolder(request, env, session);
        if (parts[1] && parts[2] === 'vault' && request.method === 'POST')                       return await moveFolderToVault(parts[1], request, env, session);
        if (parts[1] && parts[2] === 'restore' && request.method === 'POST')                     return await restoreFolder(parts[1], env, session);
        if (parts[1] && parts[2] === 'permanent' && request.method === 'DELETE')                 return await permanentDeleteFolder(parts[1], env, session);
        if (parts[1] && !parts[2] && request.method === 'DELETE')                               return await deleteFolder(parts[1], env, session);
        if (parts[1] && request.method === 'PUT')                                                return await renameFolder(parts[1], request, env, session);
      }

      // File operations
      if (!parts.length && request.method === 'GET')                                   return await listFiles(url, env, session);
      // Empty trash — must be before the generic parts[0] && !parts[1] block
      if (parts[0] === 'trash' && !parts[1] && request.method === 'DELETE')           return await emptyTrash(env, session);
      if (parts[0] && !parts[1]) {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        if (request.method === 'GET')    return await getFileMeta(parts[0], env, session);
        if (request.method === 'PUT')    return await updateFile(parts[0], request, env, session);
        if (request.method === 'DELETE') return await trashFile(parts[0], env, session);
      }
      if (parts[0] && parts[1] === 'restore' && request.method === 'POST') {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        return await restoreFile(parts[0], env, session);
      }
      if (parts[0] && parts[1] === 'permanent' && request.method === 'DELETE') {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        return await permanentDeleteFile(parts[0], env, session);
      }
      if (parts[0] && parts[1] === 'versions' && request.method === 'GET') {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        return await getVersions(parts[0], env, session);
      }
      if (parts[0] && parts[1] === 'versions' && parts[2] && request.method === 'DELETE') {
        if (!isValidId(parts[0]) || !isValidId(parts[2])) return corsResponse({ error: 'Invalid ID' }, 400);
        return await deleteVersion(parts[0], parts[2], env, session);
      }

      return corsResponse({ error: 'Not found' }, 404);
    } catch (_) {
      return corsResponse({ error: 'Internal error' }, 500);
    }
  },
};

// ---------- List files ----------
async function listFiles(url, env, session) {
  const folderId = url.searchParams.get('folder') || null;
  const trash    = url.searchParams.get('trash') === '1';
  const vault    = url.searchParams.get('vault') === '1';
  const cursor   = url.searchParams.get('cursor');
  const q        = url.searchParams.get('q') || '';
  const limit    = 100;

  let query, binds;

  if (trash) {
    // Trash view: soft-deleted files not yet permanently deleted.
    // Exclude files whose folder is also soft-deleted — they appear via the folder entry.
    query = `SELECT id, filename, mime_type, size_bytes, size_gb, bucket, deleted_at, trash_expires_at,
                    access_count, created_at, NULL AS item_type, thumb_data
             FROM files
             WHERE user_id = ? AND deleted_at IS NOT NULL
             AND (folder_id IS NULL OR folder_id NOT IN (
               SELECT id FROM folders WHERE user_id = ? AND deleted_at IS NOT NULL
             ))
             ${q ? 'AND filename LIKE ?' : ''}
             ORDER BY deleted_at DESC LIMIT ?`;
    const base = [session.userId, session.userId];
    if (q) base.push(`%${q}%`);
    binds = [...base, limit];
  } else {
    const vaultClause = vault
      ? 'AND is_vault = 1'
      : 'AND (is_vault = 0 OR is_vault IS NULL)';
    const qClause = q ? 'AND f.filename LIKE ?' : '';
    query = `SELECT f.id, f.filename, f.mime_type, f.size_bytes, f.size_gb, f.bucket, f.is_vault,
                    f.access_count, f.last_accessed, f.created_at, f.folder_id, f.version_number, f.thumb_data,
                    (SELECT COUNT(*) FROM files v WHERE v.version_of = f.id AND v.deleted_at IS NULL) AS archived_count
             FROM files f
             WHERE f.user_id = ? AND f.folder_id ${folderId ? '= ?' : 'IS NULL'}
             AND f.deleted_at IS NULL AND f.version_of IS NULL AND f.team_id IS NULL
             ${vaultClause} ${qClause}
             ORDER BY f.created_at DESC LIMIT ?`;
    const base = folderId ? [session.userId, folderId] : [session.userId];
    if (q) base.push(`%${q}%`);
    binds = [...base, limit];
  }

  const { results } = await env.DB.prepare(query).bind(...binds).all();

  // Get folders at this level, filtered by vault vs general storage
  let folders = [];
  if (!trash) {
    const vaultFolderClause = vault ? 'AND (is_vault = 1)' : 'AND (is_vault = 0 OR is_vault IS NULL)';
    const folderQuery = await env.DB.prepare(
      `SELECT id, name, is_vault, created_at FROM folders
       WHERE user_id = ? AND parent_id ${folderId ? '= ?' : 'IS NULL'} AND team_id IS NULL
       AND deleted_at IS NULL
       ${vaultFolderClause}
       ORDER BY created_at DESC`
    ).bind(...(folderId ? [session.userId, folderId] : [session.userId])).all();
    folders = folderQuery.results;
  }

  // For trash view, also include top-level trashed folders (folders whose parent is not also trashed)
  let allFiles = results;
  if (trash) {
    const { results: trashedFolders } = await env.DB.prepare(
      `SELECT id, name AS filename, NULL AS mime_type, 0 AS size_bytes, 0 AS size_gb,
              NULL AS bucket, deleted_at, trash_expires_at, 0 AS access_count, created_at,
              'folder' AS item_type, NULL AS thumb_data
       FROM folders
       WHERE user_id = ? AND deleted_at IS NOT NULL AND team_id IS NULL
       AND (parent_id IS NULL OR parent_id NOT IN (
         SELECT id FROM folders WHERE user_id = ? AND deleted_at IS NOT NULL
       ))
       ORDER BY deleted_at DESC`
    ).bind(session.userId, session.userId).all();
    allFiles = [...results, ...trashedFolders].sort((a, b) => b.deleted_at - a.deleted_at);
  }

  const nextCursor = results.length === limit ? results[results.length - 1].id : null;

  return corsResponse({ files: allFiles, folders, nextCursor });
}

// ---------- Get file metadata ----------
async function getFileMeta(fileId, env, session) {
  const file = await env.DB.prepare(
    `SELECT f.*, fol.name as folder_name
     FROM files f LEFT JOIN folders fol ON fol.id = f.folder_id
     WHERE f.id = ? AND f.user_id = ? AND f.deleted_at IS NULL`
  ).bind(fileId, session.userId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);

  // Live storage meter from KV
  const { getStorageBytes, bytesToGb } = await import('../shared/utils.js');
  const totalBytes = await getStorageBytes(env, session.userId);

  return corsResponse({ file, totalStorageGb: bytesToGb(totalBytes) });
}

// ---------- Update file (rename / move / toggle version history) ----------
async function updateFile(fileId, request, env, session) {
  const { filename, folderId, versionHistory, restoreVersionId, isVault, promoteFrom, thumbData } = await request.json();

  const file = await env.DB.prepare(
    'SELECT id, user_id FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ).bind(fileId, session.userId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);

  // --- Version promotion: new upload becomes current, old content archived as version ---
  if (promoteFrom) {
    const newFile = await env.DB.prepare(
      `SELECT storage_key, size_bytes, size_gb, bucket, mime_type, hash_sha256, thumb_data
       FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).bind(promoteFrom, session.userId).first();
    if (!newFile) return corsResponse({ error: 'Source file not found' }, 404);

    const oldData = await env.DB.prepare(
      `SELECT storage_key, size_bytes, size_gb, bucket, mime_type, hash_sha256, version_number, filename, thumb_data
       FROM files WHERE id = ?`
    ).bind(fileId).first();

    const now = Date.now();
    const oldVersionNum = oldData.version_number || 1;

    // Archive old content into the new-file record (mark it as an old version)
    await env.DB.prepare(`
      UPDATE files SET
        storage_key = ?, size_bytes = ?, size_gb = ?, bucket = ?,
        mime_type = ?, hash_sha256 = ?, filename = ?, thumb_data = ?,
        version_of = ?, version_number = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      oldData.storage_key, oldData.size_bytes, oldData.size_gb, oldData.bucket,
      oldData.mime_type, oldData.hash_sha256, oldData.filename, oldData.thumb_data || null,
      fileId, oldVersionNum, now,
      promoteFrom
    ).run();

    // Promote new content onto the canonical file record (including thumbnail if present)
    await env.DB.prepare(`
      UPDATE files SET
        storage_key = ?, size_bytes = ?, size_gb = ?, bucket = ?,
        mime_type = COALESCE(?, mime_type), hash_sha256 = ?,
        thumb_data = COALESCE(?, thumb_data),
        version_number = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      newFile.storage_key, newFile.size_bytes, newFile.size_gb, newFile.bucket,
      newFile.mime_type, newFile.hash_sha256,
      newFile.thumb_data || null,
      oldVersionNum + 1, now,
      fileId
    ).run();

    return corsResponse({ success: true, versioned: true });
  }

  const updates = ['updated_at = ?'];
  const binds   = [Date.now()];

  if (filename !== undefined) {
    if (!filename.trim()) return corsResponse({ error: 'filename cannot be empty' }, 400);
    updates.push('filename = ?');
    binds.push(filename.trim());
  }
  // Version restore
  if (restoreVersionId !== undefined && restoreVersionId !== null) {
    const version = await env.DB.prepare(
      'SELECT id, size_bytes, size_gb, bucket, storage_key, mime_type, hash_sha256, version_number, thumb_data FROM files WHERE id = ? AND user_id = ?'
    ).bind(restoreVersionId, session.userId).first();
    if (!version) return corsResponse({ error: 'Version not found' }, 404);

    const currentFile = await env.DB.prepare(
      'SELECT size_bytes, size_gb, bucket, storage_key, mime_type, hash_sha256, version_number, thumb_data FROM files WHERE id = ?'
    ).bind(fileId).first();

    const now = Date.now();
    // Swap storage data, thumb_data AND version_number so badge and thumbnail reflect restored version
    await env.DB.prepare(`
      UPDATE files SET size_bytes=?, size_gb=?, bucket=?, storage_key=?, mime_type=?, hash_sha256=?, thumb_data=?, version_number=?, updated_at=?
      WHERE id=?
    `).bind(
      currentFile.size_bytes, currentFile.size_gb, currentFile.bucket, currentFile.storage_key,
      currentFile.mime_type, currentFile.hash_sha256, currentFile.thumb_data || null, currentFile.version_number, now, restoreVersionId
    ).run();
    await env.DB.prepare(`
      UPDATE files SET size_bytes=?, size_gb=?, bucket=?, storage_key=?, mime_type=?, hash_sha256=?, thumb_data=?, version_number=?, updated_at=?
      WHERE id=?
    `).bind(
      version.size_bytes, version.size_gb, version.bucket, version.storage_key,
      version.mime_type, version.hash_sha256, version.thumb_data || null, version.version_number, now, fileId
    ).run();
    return corsResponse({ success: true, restored: true });
  }

  if (folderId !== undefined) {
    // Verify folder belongs to this user
    if (folderId !== null) {
      const folder = await env.DB.prepare(
        'SELECT id FROM folders WHERE id = ? AND user_id = ?'
      ).bind(folderId, session.userId).first();
      if (!folder) return corsResponse({ error: 'Folder not found' }, 404);
    }
    updates.push('folder_id = ?');
    binds.push(folderId);
  }
  if (versionHistory !== undefined) {
    updates.push('version_history = ?');
    binds.push(versionHistory ? 1 : 0);
  }
  if (isVault !== undefined) {
    updates.push('is_vault = ?');
    binds.push(isVault ? 1 : 0);
  }
  if (thumbData !== undefined) {
    updates.push('thumb_data = ?');
    binds.push(thumbData);
  }

  binds.push(fileId);
  await env.DB.prepare(
    `UPDATE files SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...binds).run();

  return corsResponse({ success: true });
}

// ---------- Trash file ----------
async function trashFile(fileId, env, session) {
  const file = await env.DB.prepare(
    'SELECT id, user_id, size_bytes FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ).bind(fileId, session.userId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);

  const now = Date.now();
  const trashExpiry = now + 30 * 24 * 60 * 60 * 1000; // 30 days

  const { decrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');
  await env.DB.batch([
    ...buildAccumulationBatch(session.userId, env.DB, -file.size_bytes),
    env.DB.prepare('UPDATE files SET deleted_at = ?, trash_expires_at = ?, updated_at = ? WHERE id = ?').bind(now, trashExpiry, now, fileId),
  ]);
  await decrementStorageBytes(env, session.userId, file.size_bytes);

  return corsResponse({ success: true, deletedAt: now, permanentlyDeletedAt: trashExpiry });
}

// ---------- Restore from trash ----------
async function restoreFile(fileId, env, session) {
  const file = await env.DB.prepare(
    'SELECT id, user_id, size_bytes, deleted_at FROM files WHERE id = ? AND user_id = ?'
  ).bind(fileId, session.userId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);
  if (!file.deleted_at) return corsResponse({ error: 'File is not in trash' }, 400);

  const { incrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');
  await env.DB.batch([
    ...buildAccumulationBatch(session.userId, env.DB, file.size_bytes),
    env.DB.prepare('UPDATE files SET deleted_at = NULL, trash_expires_at = NULL, updated_at = ? WHERE id = ?').bind(Date.now(), fileId),
  ]);
  await incrementStorageBytes(env, session.userId, file.size_bytes);

  return corsResponse({ success: true });
}

// ---------- Permanent delete (bypasses trash) ----------
async function permanentDeleteFile(fileId, env, session) {
  const file = await env.DB.prepare(
    'SELECT id, user_id, size_bytes, storage_key, bucket, deleted_at FROM files WHERE id = ? AND user_id = ?'
  ).bind(fileId, session.userId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);

  // Fetch all version records for this file
  const { results: versions } = await env.DB.prepare(
    'SELECT id, size_bytes, storage_key, bucket FROM files WHERE version_of = ? AND user_id = ?'
  ).bind(fileId, session.userId).all();

  const totalVersionBytes = versions.reduce((s, v) => s + (v.size_bytes || 0), 0);

  // Delete versions from D1, then canonical
  for (const v of versions) {
    await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(v.id).run();
  }
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();

  // Queue B2/R2 bucket deletion for canonical and all versions
  await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId, storageKey: file.storage_key, bucket: file.bucket, deleteFromD1: false });
  for (const v of versions) {
    await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: v.id, storageKey: v.storage_key, bucket: v.bucket, deleteFromD1: false });
  }

  const { decrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');
  // Accumulate total bytes delta: canonical only if not already trashed; always version bytes
  const totalDelta = (file.deleted_at ? 0 : -file.size_bytes) - totalVersionBytes;
  if (totalDelta !== 0) {
    await env.DB.batch(buildAccumulationBatch(session.userId, env.DB, totalDelta));
  }
  if (!file.deleted_at) await decrementStorageBytes(env, session.userId, file.size_bytes);
  if (totalVersionBytes > 0) await decrementStorageBytes(env, session.userId, totalVersionBytes);

  return corsResponse({ success: true });
}

// ---------- Delete a specific version ----------
async function deleteVersion(fileId, versionId, env, session) {
  const file = await env.DB.prepare(
    'SELECT id, size_bytes, storage_key, bucket FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ).bind(fileId, session.userId).first();
  if (!file) return corsResponse({ error: 'File not found' }, 404);

  if (versionId === fileId) {
    // Deleting the CURRENT version — promote the highest archived version to become canonical
    const { results } = await env.DB.prepare(
      'SELECT id, size_bytes, size_gb, bucket, storage_key, mime_type, hash_sha256, version_number FROM files WHERE version_of = ? AND user_id = ? ORDER BY version_number DESC LIMIT 1'
    ).bind(fileId, session.userId).all();

    if (results.length === 0) {
      return corsResponse({ error: 'Cannot delete the only version — trash the file instead' }, 400);
    }

    const promote = results[0];
    const now = Date.now();
    // Save old canonical storage key before overwriting
    const oldStorageKey = file.storage_key;
    const oldBucket     = file.bucket;

    // Update canonical with promoted version's storage data and version_number
    await env.DB.prepare(`
      UPDATE files SET size_bytes=?, size_gb=?, bucket=?, storage_key=?, mime_type=?, hash_sha256=?, version_number=?, updated_at=?
      WHERE id=?
    `).bind(promote.size_bytes, promote.size_gb, promote.bucket, promote.storage_key,
      promote.mime_type, promote.hash_sha256, promote.version_number, now, fileId).run();

    // Hard-delete the promoted version record (its data is now in canonical)
    await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(promote.id).run();

    const { decrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');
    await env.DB.batch(buildAccumulationBatch(session.userId, env.DB, -file.size_bytes));
    await decrementStorageBytes(env, session.userId, file.size_bytes);

    // Queue deletion of the old canonical bytes from bucket
    await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId, storageKey: oldStorageKey, bucket: oldBucket, deleteFromD1: false });

    return corsResponse({ success: true, promoted: promote.id });
  }

  // Deleting a non-current version record
  const version = await env.DB.prepare(
    'SELECT id, size_bytes, storage_key, bucket FROM files WHERE id = ? AND version_of = ? AND user_id = ?'
  ).bind(versionId, fileId, session.userId).first();
  if (!version) return corsResponse({ error: 'Version not found' }, 404);

  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(versionId).run();

  const { decrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');
  await env.DB.batch(buildAccumulationBatch(session.userId, env.DB, -version.size_bytes));
  await decrementStorageBytes(env, session.userId, version.size_bytes);

  // Queue bucket deletion for this version
  await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: version.id, storageKey: version.storage_key, bucket: version.bucket, deleteFromD1: false });

  return corsResponse({ success: true });
}

// ---------- Version history ----------
async function getVersions(fileId, env, session) {
  const file = await env.DB.prepare(
    'SELECT id FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ).bind(fileId, session.userId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);

  const { results } = await env.DB.prepare(
    `SELECT id, filename, mime_type, size_bytes, version_number, bucket, created_at, thumb_data
     FROM files
     WHERE (id = ? OR version_of = ?) AND user_id = ?
     ORDER BY version_number DESC`
  ).bind(fileId, fileId, session.userId).all();

  return corsResponse({ versions: results });
}

// ---------- Create folder ----------
async function createFolder(request, env, session) {
  const { name, parentId, deviceName, year, month, isVault = false } = await request.json();
  if (!name?.trim()) return corsResponse({ error: 'name required' }, 400);

  const isVaultInt = isVault ? 1 : 0;

  // Verify parent belongs to user
  if (parentId) {
    const parent = await env.DB.prepare(
      'SELECT id FROM folders WHERE id = ? AND user_id = ?'
    ).bind(parentId, session.userId).first();
    if (!parent) return corsResponse({ error: 'Parent folder not found' }, 404);
  }

  // Folder names must be unique within the same parent and same vault context
  const duplicate = await env.DB.prepare(
    `SELECT id FROM folders WHERE user_id = ? AND name = ? AND parent_id ${parentId ? '= ?' : 'IS NULL'} AND (is_vault = ? OR (is_vault IS NULL AND ? = 0))`
  ).bind(...(parentId ? [session.userId, name.trim(), parentId, isVaultInt, isVaultInt] : [session.userId, name.trim(), isVaultInt, isVaultInt])).first();
  if (duplicate) return corsResponse({ error: 'A folder with this name already exists' }, 409);

  const folderId = newId();
  await env.DB.prepare(`
    INSERT INTO folders (id, user_id, parent_id, name, device_name, year, month, is_vault, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(folderId, session.userId, parentId || null, name.trim(),
          deviceName || null, year || null, month || null, isVaultInt,
          Date.now(), Date.now()).run();

  return corsResponse({ folderId });
}

// ---------- Rename / reparent folder ----------
async function renameFolder(folderId, request, env, session) {
  const { name, parentId } = await request.json();
  if (!name?.trim() && parentId === undefined) return corsResponse({ error: 'name or parentId required' }, 400);

  const folder = await env.DB.prepare(
    'SELECT id, is_vault FROM folders WHERE id = ? AND user_id = ?'
  ).bind(folderId, session.userId).first();
  if (!folder) return corsResponse({ error: 'Folder not found' }, 404);

  const setClauses = []
  const params = []

  if (name?.trim()) {
    setClauses.push('name = ?')
    params.push(name.trim())
  }

  if (parentId !== undefined) {
    if (parentId) {
      if (parentId === folderId) return corsResponse({ error: 'Cannot move a folder into itself' }, 400);
      const parent = await env.DB.prepare(
        'SELECT id, is_vault FROM folders WHERE id = ? AND user_id = ?'
      ).bind(parentId, session.userId).first();
      if (!parent) return corsResponse({ error: 'Parent folder not found' }, 404);
      if ((parent.is_vault ? 1 : 0) !== (folder.is_vault ? 1 : 0)) {
        return corsResponse({ error: 'Cannot move between vault and non-vault' }, 400);
      }
      // Prevent moving into a descendant (circular reference)
      let cur = parentId;
      while (cur) {
        const anc = await env.DB.prepare('SELECT parent_id FROM folders WHERE id = ?').bind(cur).first();
        if (!anc) break;
        if (anc.parent_id === folderId) return corsResponse({ error: 'Cannot move a folder into its own subfolder' }, 400);
        cur = anc.parent_id;
      }
    }
    setClauses.push('parent_id = ?')
    params.push(parentId || null)
  }

  setClauses.push('updated_at = ?')
  params.push(Date.now(), folderId)

  await env.DB.prepare(`UPDATE folders SET ${setClauses.join(', ')} WHERE id = ?`).bind(...params).run();

  return corsResponse({ success: true });
}

// ---------- Delete folder ----------
// Collect all folder IDs in a subtree (BFS, only non-deleted folders)
async function collectFolderTree(rootId, userId, env) {
  const ids = [rootId];
  const queue = [rootId];
  while (queue.length) {
    const parentId = queue.shift();
    const { results } = await env.DB.prepare(
      'SELECT id FROM folders WHERE parent_id = ? AND user_id = ? AND deleted_at IS NULL'
    ).bind(parentId, userId).all();
    for (const r of results) { ids.push(r.id); queue.push(r.id); }
  }
  return ids;
}

// Collect all folder IDs in a subtree (BFS, including soft-deleted)
async function collectFolderTreeAll(rootId, userId, env) {
  const ids = [rootId];
  const queue = [rootId];
  while (queue.length) {
    const parentId = queue.shift();
    const { results } = await env.DB.prepare(
      'SELECT id FROM folders WHERE parent_id = ? AND user_id = ?'
    ).bind(parentId, userId).all();
    for (const r of results) { ids.push(r.id); queue.push(r.id); }
  }
  return ids;
}

async function deleteFolder(folderId, env, session) {
  const folder = await env.DB.prepare(
    'SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL'
  ).bind(folderId, session.userId).first();
  if (!folder) return corsResponse({ error: 'Folder not found' }, 404);

  const now = Date.now();
  const trashExpiry = now + 30 * 24 * 60 * 60 * 1000;

  // Collect entire subtree
  const allFolderIds = await collectFolderTree(folderId, session.userId, env);

  // Collect all files in those folders
  let allFiles = [];
  for (let i = 0; i < allFolderIds.length; i += 50) {
    const chunk = allFolderIds.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, size_bytes FROM files WHERE folder_id IN (${ph}) AND deleted_at IS NULL`
    ).bind(...chunk).all();
    allFiles = [...allFiles, ...results];
  }

  const totalBytes = allFiles.reduce((s, f) => s + (f.size_bytes || 0), 0);
  const { decrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');

  const batch = [];
  if (totalBytes > 0) batch.push(...buildAccumulationBatch(session.userId, env.DB, -totalBytes));

  // Soft-delete all files
  const fileIds = allFiles.map(f => f.id);
  for (let i = 0; i < fileIds.length; i += 50) {
    const chunk = fileIds.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    batch.push(env.DB.prepare(`UPDATE files SET deleted_at = ?, trash_expires_at = ?, updated_at = ? WHERE id IN (${ph})`).bind(now, trashExpiry, now, ...chunk));
  }

  // Soft-delete all folders
  for (let i = 0; i < allFolderIds.length; i += 50) {
    const chunk = allFolderIds.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    batch.push(env.DB.prepare(`UPDATE folders SET deleted_at = ?, trash_expires_at = ?, updated_at = ? WHERE id IN (${ph})`).bind(now, trashExpiry, now, ...chunk));
  }

  if (batch.length) await env.DB.batch(batch);
  if (totalBytes > 0) await decrementStorageBytes(env, session.userId, totalBytes);

  return corsResponse({ success: true, foldersInTrash: allFolderIds.length, filesMovedToTrash: fileIds.length });
}

async function restoreFolder(folderId, env, session) {
  const folder = await env.DB.prepare(
    'SELECT id, deleted_at FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL'
  ).bind(folderId, session.userId).first();
  if (!folder) return corsResponse({ error: 'Folder not found in trash' }, 404);

  const trashTime = folder.deleted_at;
  const now = Date.now();

  // Collect all folders in tree that share the same deleted_at (trashed together)
  const allFolderIds = [folderId];
  const queue = [folderId];
  while (queue.length) {
    const parentId = queue.shift();
    const { results } = await env.DB.prepare(
      'SELECT id FROM folders WHERE parent_id = ? AND user_id = ? AND deleted_at = ?'
    ).bind(parentId, session.userId, trashTime).all();
    for (const r of results) { allFolderIds.push(r.id); queue.push(r.id); }
  }

  // Collect files to restore (those with matching deleted_at)
  let fileIds = [];
  let totalBytes = 0;
  for (let i = 0; i < allFolderIds.length; i += 50) {
    const chunk = allFolderIds.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, size_bytes FROM files WHERE folder_id IN (${ph}) AND deleted_at = ? AND user_id = ?`
    ).bind(...chunk, trashTime, session.userId).all();
    for (const f of results) { fileIds.push(f.id); totalBytes += f.size_bytes || 0; }
  }

  const { incrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');
  const batch = [];
  if (totalBytes > 0) batch.push(...buildAccumulationBatch(session.userId, env.DB, totalBytes));

  // Restore files
  for (let i = 0; i < fileIds.length; i += 50) {
    const chunk = fileIds.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    batch.push(env.DB.prepare(`UPDATE files SET deleted_at = NULL, trash_expires_at = NULL, updated_at = ? WHERE id IN (${ph})`).bind(now, ...chunk));
  }

  // Restore folders
  for (let i = 0; i < allFolderIds.length; i += 50) {
    const chunk = allFolderIds.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    batch.push(env.DB.prepare(`UPDATE folders SET deleted_at = NULL, trash_expires_at = NULL, updated_at = ? WHERE id IN (${ph})`).bind(now, ...chunk));
  }

  if (batch.length) await env.DB.batch(batch);
  if (totalBytes > 0) await incrementStorageBytes(env, session.userId, totalBytes);

  return corsResponse({ success: true, foldersRestored: allFolderIds.length, filesRestored: fileIds.length });
}

async function permanentDeleteFolder(folderId, env, session) {
  const folder = await env.DB.prepare(
    'SELECT id FROM folders WHERE id = ? AND user_id = ?'
  ).bind(folderId, session.userId).first();
  if (!folder) return corsResponse({ success: true }); // already gone

  const allFolderIds = await collectFolderTreeAll(folderId, session.userId, env);

  // Collect all files (trashed or not) in these folders
  let allFiles = [];
  for (let i = 0; i < allFolderIds.length; i += 50) {
    const chunk = allFolderIds.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, storage_key, bucket FROM files WHERE folder_id IN (${ph}) AND user_id = ?`
    ).bind(...chunk, session.userId).all();
    allFiles = [...allFiles, ...results];
  }

  // Queue bucket deletions for all files
  for (const f of allFiles) {
    if (f.storage_key && f.bucket) {
      await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: f.id, storageKey: f.storage_key, bucket: f.bucket, deleteFromD1: false });
    }
  }

  // Delete files from D1
  const fileIds = allFiles.map(f => f.id);
  for (let i = 0; i < fileIds.length; i += 50) {
    const chunk = fileIds.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM files WHERE id IN (${ph})`).bind(...chunk).run();
  }

  // Delete folder rows (bottom-up: delete in reverse BFS order)
  for (let i = allFolderIds.length - 1; i >= 0; i -= 50) {
    const chunk = allFolderIds.slice(Math.max(0, i - 49), i + 1);
    const ph = chunk.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM folders WHERE id IN (${ph})`).bind(...chunk).run();
  }

  return corsResponse({ success: true });
}

// ---------- Move all files in a folder to/from vault ----------
async function moveFolderToVault(folderId, request, env, session) {
  const { isVault } = await request.json();
  const folder = await env.DB.prepare(
    'SELECT id FROM folders WHERE id = ? AND user_id = ?'
  ).bind(folderId, session.userId).first();
  if (!folder) return corsResponse({ error: 'Folder not found' }, 404);

  await env.DB.prepare(
    'UPDATE files SET is_vault = ?, updated_at = ? WHERE folder_id = ? AND user_id = ? AND deleted_at IS NULL'
  ).bind(isVault ? 1 : 0, Date.now(), folderId, session.userId).run();

  return corsResponse({ success: true });
}

// ---------- Empty trash ----------
async function emptyTrash(env, session) {
  // Fetch all trashed canonical files (not version records)
  const { results: trashed } = await env.DB.prepare(
    'SELECT id, size_bytes, storage_key, bucket FROM files WHERE user_id = ? AND deleted_at IS NOT NULL AND version_of IS NULL'
  ).bind(session.userId).all();

  if (trashed.length === 0) return corsResponse({ success: true, deleted: 0 });

  const trashedIds = trashed.map(f => f.id);
  let totalVersionBytes = 0;
  const allVersions = [];

  // Collect all version records belonging to these trashed files
  for (const f of trashed) {
    const { results: versions } = await env.DB.prepare(
      'SELECT id, size_bytes, storage_key, bucket FROM files WHERE version_of = ?'
    ).bind(f.id).all();
    for (const v of versions) {
      allVersions.push(v);
      totalVersionBytes += v.size_bytes || 0;
    }
  }

  // Delete version records from D1
  for (const v of allVersions) {
    await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(v.id).run();
  }

  // Delete canonical trash records in batches of 50
  for (let i = 0; i < trashedIds.length; i += 50) {
    const batch = trashedIds.slice(i, i + 50);
    const placeholders = batch.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM files WHERE id IN (${placeholders})`).bind(...batch).run();
  }

  // Queue bucket deletion for all canonical files
  for (const f of trashed) {
    await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: f.id, storageKey: f.storage_key, bucket: f.bucket, deleteFromD1: false });
  }

  // Queue bucket deletion for all version files
  for (const v of allVersions) {
    await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: v.id, storageKey: v.storage_key, bucket: v.bucket, deleteFromD1: false });
  }

  // Decrement version bytes (canonical bytes were already decremented when files were trashed)
  if (totalVersionBytes > 0) {
    const { decrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');
    await env.DB.batch(buildAccumulationBatch(session.userId, env.DB, -totalVersionBytes));
    await decrementStorageBytes(env, session.userId, totalVersionBytes);
  }

  // Delete all soft-deleted folders for this user
  const { results: trashedFolders } = await env.DB.prepare(
    'SELECT id FROM folders WHERE user_id = ? AND deleted_at IS NOT NULL'
  ).bind(session.userId).all();
  for (let i = 0; i < trashedFolders.length; i += 50) {
    const chunk = trashedFolders.slice(i, i + 50);
    const ph = chunk.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM folders WHERE id IN (${ph})`).bind(...chunk.map(r => r.id)).run();
  }

  return corsResponse({ success: true, deleted: trashed.length });
}
