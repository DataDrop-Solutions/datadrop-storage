// ============================================================
// DataDrop — Shares Handler
// POST /shares              → create share
// GET  /shares              → list my shares (sent)
// GET  /shares/received     → list shares received
// GET  /shares/:id          → get share detail
// PUT  /shares/:id          → update permissions/expiry
// DELETE /shares/:id        → revoke share
// POST /shares/claim/:token → claim invite link
// POST /shares/transfer     → ownership transfer
// ============================================================

import { corsResponse, handleOptions, validateSession, newId, sendEmail, checkRateLimit, isValidId, checkApiRateLimit, calcStorageCost, decrementStorageBytes, incrementStorageBytes, buildAccumulationBatch } from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

    if (!(await checkApiRateLimit(env, session.userId))) {
      return corsResponse({ error: 'Too many requests' }, 429);
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace('/shares', '');
    const parts = path.split('/').filter(Boolean);

    try {
      // POST /shares
      if (!parts.length && request.method === 'POST') return await createShare(request, env, session);
      // GET /shares
      if (!parts.length && request.method === 'GET')  return await listShares(url, env, session, 'sent');
      // GET /shares/received
      if (parts[0] === 'received' && request.method === 'GET') return await listShares(url, env, session, 'received');
      // POST /shares/claim/:token
      if (parts[0] === 'claim' && parts[1] && request.method === 'POST') return await claimInvite(parts[1], env, session, request);
      // POST /shares/transfer
      if (parts[0] === 'transfer' && request.method === 'POST') return await transferOwnership(request, env, session);
      // POST /shares/:id/accept-move  — recipient moves file into their own account
      if (parts[0] && parts[1] === 'accept-move' && request.method === 'POST') {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        return await acceptMove(parts[0], env, session);
      }
      // POST /shares/:id/confirm-receipt  — recipient confirms receipt (triggers delete-on-confirm)
      if (parts[0] && parts[1] === 'confirm-receipt' && request.method === 'POST') {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        return await confirmReceipt(parts[0], env, session);
      }
      // POST /shares/:id/dismiss  — recipient dismisses/removes a share from their view
      if (parts[0] && parts[1] === 'dismiss' && request.method === 'POST') {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        return await dismissShare(parts[0], env, session);
      }
      // GET /shares/:id/files  — list files inside a shared folder
      if (parts[0] && parts[1] === 'files' && request.method === 'GET') {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        return await getSharedFolderFiles(parts[0], url, env, session);
      }
      // GET/PUT/DELETE /shares/:id
      if (parts[0] && !parts[1]) {
        if (!isValidId(parts[0])) return corsResponse({ error: 'Invalid ID' }, 400);
        if (request.method === 'GET')    return await getShare(parts[0], env, session);
        if (request.method === 'PUT')    return await updateShare(parts[0], request, env, session);
        if (request.method === 'DELETE') return await revokeShare(parts[0], env, session);
      }
      return corsResponse({ error: 'Not found' }, 404);
    } catch (_) {
      return corsResponse({ error: 'Internal error' }, 500);
    }
  },
};

// ---------- Create share ----------
async function createShare(request, env, session) {
  // Rate limit: 50 shares per user per hour
  const allowed = await checkRateLimit(env, `rate_share:${session.userId}`, 50, 3600);
  if (!allowed) return corsResponse({ error: 'Too many shares. Try again later.' }, 429);

  const {
    fileId, folderId,
    recipientEmail, recipientUsername,
    generateInviteLink = false,
    canView = true, canDownload = false, canSave = false,
    expiresAt, maxViews,
    watermark = false,
    deleteAfterDays,
    deleteOnConfirm = false,
  } = await request.json();

  if (!fileId && !folderId) return corsResponse({ error: 'fileId or folderId required' }, 400);

  // Verify ownership
  if (fileId) {
    const file = await env.DB.prepare(
      'SELECT id, user_id, is_vault FROM files WHERE id = ? AND deleted_at IS NULL'
    ).bind(fileId).first();
    if (!file) return corsResponse({ error: 'File not found' }, 404);
    if (file.user_id !== session.userId) return corsResponse({ error: 'Not your file' }, 403);
    // Vault files cannot be shared — enforced at API level
    if (file.is_vault) return corsResponse({ error: 'Vault files cannot be shared' }, 403);
  }

  const shareId = newId();
  let recipientUserId = null;
  let inviteToken     = null;

  // Method 1: by email — do not reveal whether email is registered
  if (recipientEmail) {
    const user = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(recipientEmail).first();
    if (!user) {
      // Silently succeed — prevents email enumeration
      return corsResponse({ shareId: null, invited: true });
    }
    if (user.id === session.userId) return corsResponse({ error: 'Cannot share with yourself' }, 400);
    recipientUserId = user.id;
  }

  // Method 2: by @username — do not reveal whether username is registered
  if (recipientUsername) {
    const handle = recipientUsername.startsWith('@') ? recipientUsername.slice(1) : recipientUsername;
    const user   = await env.DB.prepare(
      'SELECT id FROM users WHERE username = ?'
    ).bind(handle).first();
    if (!user) {
      // Silently succeed — prevents username enumeration
      return corsResponse({ shareId: null, invited: true });
    }
    if (user.id === session.userId) return corsResponse({ error: 'Cannot share with yourself' }, 400);
    recipientUserId = user.id;
  }

  // Method 3: invite link
  if (generateInviteLink) {
    inviteToken = newId() + newId(); // 64-char token
  }

  if (!recipientUserId && !inviteToken) {
    return corsResponse({ error: 'Provide recipientEmail, recipientUsername, or set generateInviteLink=true' }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO shares (
      id, file_id, folder_id, owner_id,
      recipient_email, recipient_user_id, invite_link_token,
      can_view, can_download, can_save,
      expires_at, max_views, watermark,
      delete_after_days, delete_on_confirm, status,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).bind(
    shareId,
    fileId    || null,
    folderId  || null,
    session.userId,
    recipientEmail  || null,
    recipientUserId || null,
    inviteToken     || null,
    canView ? 1 : 0,
    canDownload ? 1 : 0,
    canSave ? 1 : 0,
    expiresAt  || null,
    maxViews   || null,
    watermark ? 1 : 0,
    deleteAfterDays  || null,
    deleteOnConfirm ? 1 : 0,
    Date.now(), Date.now(),
  ).run();

  // Notify recipient if direct share
  if (recipientUserId) {
    const [sender, recipient] = await Promise.all([
      env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(session.userId).first(),
      env.DB.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(recipientUserId).first(),
    ]);
    if (recipient) {
      await sendEmail(env, {
        to: recipient.email,
        subject: `${sender?.display_name || 'Someone'} shared a file with you on DataDrop`,
        html: `<p>Hi ${recipient.display_name},</p>
               <p><strong>${sender?.display_name}</strong> has shared a file with you on DataDrop.</p>
               <p><a href="https://app.datadrop.co.in/shared/${shareId}">View shared file →</a></p>`,
      });
    }
  }

  const inviteUrl = inviteToken
    ? `https://app.datadrop.co.in/invite/${inviteToken}`
    : null;

  return corsResponse({ shareId, inviteUrl });
}

// ---------- Claim invite link ----------
async function claimInvite(token, env, session, request) {
  // Rate limit: 20 claim attempts per IP per hour
  const ip = (request && request.headers.get('CF-Connecting-IP')) || 'unknown';
  const claimAllowed = await checkRateLimit(env, `rate_claim:${ip}`, 20, 3600);
  if (!claimAllowed) return corsResponse({ error: 'Too many attempts. Try again later.' }, 429);

  const share = await env.DB.prepare(
    `SELECT * FROM shares WHERE invite_link_token = ? AND status = 'active'`
  ).bind(token).first();

  if (!share) return corsResponse({ error: 'Invite link not found or expired' }, 404);
  if (share.invite_claimed) return corsResponse({ error: 'This invite has already been claimed' }, 409);
  if (share.owner_id === session.userId) return corsResponse({ error: 'Cannot claim your own share' }, 400);
  if (share.expires_at && Date.now() > share.expires_at) {
    await env.DB.prepare("UPDATE shares SET status = 'expired' WHERE id = ?").bind(share.id).run();
    return corsResponse({ error: 'Invite link has expired' }, 410);
  }

  // Lock the invite to this user
  await env.DB.prepare(`
    UPDATE shares
    SET recipient_user_id = ?, invite_claimed = 1, updated_at = ?
    WHERE id = ? AND invite_claimed = 0
  `).bind(session.userId, Date.now(), share.id).run();

  return corsResponse({ shareId: share.id, fileId: share.file_id, folderId: share.folder_id });
}

// ---------- List shares ----------
async function listShares(url, env, session, direction) {
  const cursor = url.searchParams.get('cursor');
  const limit  = 50;

  const query = direction === 'sent'
    ? `SELECT s.*, f.filename, f.mime_type, f.size_bytes,
              u.display_name as recipient_display_name,
              u.email as recipient_user_email,
              u.username as recipient_username
       FROM shares s
       LEFT JOIN files f ON f.id = s.file_id
       LEFT JOIN users u ON u.id = s.recipient_user_id
       WHERE s.owner_id = ? AND s.status = 'active'
       ${cursor ? 'AND s.id > ?' : ''}
       ORDER BY s.created_at DESC LIMIT ?`
    : `SELECT s.id as share_id, f.id as id, s.file_id, s.owner_id,
              s.can_view, s.can_download, s.can_save, s.delete_on_confirm,
              s.expires_at, s.status, s.invite_link_token, s.created_at,
              f.filename, f.mime_type, f.size_bytes,
              u.display_name as owner_name,
              u.email as owner_email,
              u.username as owner_username,
              'file' as item_type
       FROM shares s
       LEFT JOIN files f ON f.id = s.file_id AND f.deleted_at IS NULL
       LEFT JOIN users u ON u.id = s.owner_id
       WHERE s.recipient_user_id = ? AND s.status = 'active' AND f.id IS NOT NULL AND s.file_id IS NOT NULL
       ${cursor ? 'AND s.id > ?' : ''}
       ORDER BY u.username ASC, s.created_at DESC LIMIT ?`;

  const binds = cursor
    ? [session.userId, cursor, limit]
    : [session.userId, limit];

  const { results } = await env.DB.prepare(query).bind(...binds).all();

  // Also fetch folder shares for received view
  let folderShares = [];
  if (direction === 'received' && !cursor) {
    const { results: fShares } = await env.DB.prepare(`
      SELECT s.id as share_id, s.folder_id, s.owner_id,
             s.can_view, s.can_download, s.can_save,
             s.expires_at, s.status, s.created_at,
             fol.name as folder_name,
             u.display_name as owner_name,
             u.email as owner_email,
             u.username as owner_username,
             'folder' as item_type
      FROM shares s
      JOIN folders fol ON fol.id = s.folder_id
      LEFT JOIN users u ON u.id = s.owner_id
      WHERE s.recipient_user_id = ? AND s.status = 'active' AND s.folder_id IS NOT NULL
      ORDER BY s.created_at DESC LIMIT ?
    `).bind(session.userId, limit).all();
    folderShares = fShares;
  }

  const nextCursor = results.length === limit ? results[results.length - 1].share_id : null;
  const allShares  = direction === 'received' ? [...folderShares, ...results] : results;

  return corsResponse({ shares: allShares, nextCursor });
}

// ---------- Get share ----------
async function getShare(shareId, env, session) {
  const share = await env.DB.prepare(
    `SELECT s.*, f.filename, f.mime_type, f.size_bytes
     FROM shares s LEFT JOIN files f ON f.id = s.file_id
     WHERE s.id = ? AND (s.owner_id = ? OR s.recipient_user_id = ?)`
  ).bind(shareId, session.userId, session.userId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);
  return corsResponse({ share });
}

// ---------- Update share ----------
async function updateShare(shareId, request, env, session) {
  const { canView, canDownload, canSave, expiresAt, maxViews, watermark } = await request.json();

  const share = await env.DB.prepare(
    'SELECT id, owner_id FROM shares WHERE id = ?'
  ).bind(shareId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);
  if (share.owner_id !== session.userId) return corsResponse({ error: 'Not your share' }, 403);

  const updates = [];
  const binds   = [];

  if (canView     !== undefined) { updates.push('can_view = ?');     binds.push(canView ? 1 : 0); }
  if (canDownload !== undefined) { updates.push('can_download = ?'); binds.push(canDownload ? 1 : 0); }
  if (canSave     !== undefined) { updates.push('can_save = ?');     binds.push(canSave ? 1 : 0); }
  if (expiresAt   !== undefined) { updates.push('expires_at = ?');   binds.push(expiresAt); }
  if (maxViews    !== undefined) { updates.push('max_views = ?');    binds.push(maxViews); }
  if (watermark   !== undefined) { updates.push('watermark = ?');    binds.push(watermark ? 1 : 0); }

  if (!updates.length) return corsResponse({ error: 'Nothing to update' }, 400);

  updates.push('updated_at = ?');
  binds.push(Date.now(), shareId);

  await env.DB.prepare(
    `UPDATE shares SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...binds).run();

  return corsResponse({ success: true });
}

// ---------- Revoke share ----------
async function revokeShare(shareId, env, session) {
  const share = await env.DB.prepare(
    'SELECT id, owner_id FROM shares WHERE id = ?'
  ).bind(shareId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);
  if (share.owner_id !== session.userId) return corsResponse({ error: 'Not your share' }, 403);

  await env.DB.prepare(
    "UPDATE shares SET status = 'revoked', updated_at = ? WHERE id = ?"
  ).bind(Date.now(), shareId).run();

  return corsResponse({ success: true });
}

// ---------- Shared folder files ----------
async function getSharedFolderFiles(shareId, url, env, session) {
  const share = await env.DB.prepare(
    `SELECT s.folder_id, s.owner_id, s.can_view, s.expires_at, fol.name as folder_name
     FROM shares s
     JOIN folders fol ON fol.id = s.folder_id
     WHERE s.id = ? AND s.recipient_user_id = ? AND s.status = 'active' AND s.folder_id IS NOT NULL`
  ).bind(shareId, session.userId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);
  if (share.expires_at && Date.now() > share.expires_at) {
    return corsResponse({ error: 'Share expired' }, 403);
  }

  // subFolderId: browse inside a subfolder of the shared folder
  const subFolderId = url.searchParams.get('folder') || share.folder_id;

  const [filesRes, foldersRes] = await Promise.all([
    env.DB.prepare(
      `SELECT id, filename, mime_type, size_bytes, created_at, folder_id, version_number
       FROM files
       WHERE folder_id = ? AND user_id = ? AND deleted_at IS NULL AND version_of IS NULL AND is_vault = 0 AND accessible = 1
       ORDER BY filename LIMIT 200`
    ).bind(subFolderId, share.owner_id).all(),
    env.DB.prepare(
      `SELECT id, name, created_at FROM folders
       WHERE parent_id = ? AND user_id = ?
       ORDER BY name LIMIT 100`
    ).bind(subFolderId, share.owner_id).all(),
  ]);

  return corsResponse({
    files: filesRes.results,
    folders: foldersRes.results,
    folderName: share.folder_name,
    shareId,
    rootFolderId: share.folder_id,
    canView: share.can_view,
    canDownload: share.can_view, // view permission means can preview; download permission is separate
  });
}

// ---------- Accept move (recipient-initiated transfer) ----------
async function acceptMove(shareId, env, session) {
  const share = await env.DB.prepare(
    `SELECT * FROM shares WHERE id = ? AND status = 'active'`
  ).bind(shareId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);
  if (!share.can_save) return corsResponse({ error: 'This share does not allow moving to your storage' }, 403);
  if (share.recipient_user_id !== session.userId) return corsResponse({ error: 'Not your share' }, 403);
  if (share.expires_at && Date.now() > share.expires_at) {
    await env.DB.prepare("UPDATE shares SET status = 'expired' WHERE id = ?").bind(shareId).run();
    return corsResponse({ error: 'Share has expired' }, 410);
  }

  const file = await env.DB.prepare(
    'SELECT * FROM files WHERE id = ? AND deleted_at IS NULL AND is_vault = 0'
  ).bind(share.file_id).first();
  if (!file) return corsResponse({ error: 'File not found or already moved' }, 404);
  if (file.user_id === session.userId) return corsResponse({ error: 'File already in your storage' }, 400);

  // Check recipient wallet can cover storage cost
  const recipient = await env.DB.prepare(
    'SELECT wallet_balance, wallet_limit FROM users WHERE id = ?'
  ).bind(session.userId).first();
  const monthlyFileCost = await calcStorageCost(env, file.size_gb || 0);
  if ((recipient.wallet_balance || 0) < monthlyFileCost) {
    return corsResponse({
      error: 'Insufficient wallet balance to accept this file',
      required: monthlyFileCost,
      available: recipient.wallet_balance,
    }, 402);
  }

  const now = Date.now();

  // Transfer ownership: update user_id on the file record
  await env.DB.prepare(
    'UPDATE files SET user_id = ?, updated_at = ? WHERE id = ?'
  ).bind(session.userId, now, file.id).run();

  await decrementStorageBytes(env, share.owner_id, file.size_bytes || 0);
  await incrementStorageBytes(env, session.userId, file.size_bytes || 0);

  // Mark share as completed (transferred)
  await env.DB.prepare(
    "UPDATE shares SET status = 'completed', updated_at = ? WHERE id = ?"
  ).bind(now, shareId).run();

  return corsResponse({ success: true, fileId: file.id });
}

// ---------- Confirm receipt ----------
async function confirmReceipt(shareId, env, session) {
  const share = await env.DB.prepare(
    `SELECT * FROM shares WHERE id = ? AND status = 'active'`
  ).bind(shareId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);
  if (share.recipient_user_id !== session.userId) return corsResponse({ error: 'Not your share' }, 403);
  if (share.expires_at && Date.now() > share.expires_at) {
    await env.DB.prepare("UPDATE shares SET status = 'expired' WHERE id = ?").bind(shareId).run();
    return corsResponse({ error: 'Share has expired' }, 410);
  }

  const now = Date.now();

  // If delete_on_confirm, soft-delete the file from owner's account
  if (share.delete_on_confirm) {
    const file = await env.DB.prepare(
      'SELECT id, user_id, size_bytes FROM files WHERE id = ? AND deleted_at IS NULL'
    ).bind(share.file_id).first();

    if (file && file.user_id === share.owner_id) {
      await env.DB.prepare(
        'UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ?'
      ).bind(now, now, file.id).run();

      await decrementStorageBytes(env, share.owner_id, file.size_bytes || 0);
    }
  }

  // Mark share as completed (receipt confirmed)
  await env.DB.prepare(
    "UPDATE shares SET status = 'completed', updated_at = ? WHERE id = ?"
  ).bind(now, shareId).run();

  return corsResponse({ success: true, deleted: !!share.delete_on_confirm });
}

// ---------- Dismiss share (recipient removes it from their view) ----------
async function dismissShare(shareId, env, session) {
  const share = await env.DB.prepare(
    `SELECT id, recipient_user_id, status FROM shares WHERE id = ? AND status = 'active'`
  ).bind(shareId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);
  if (share.recipient_user_id !== session.userId) return corsResponse({ error: 'Not your share' }, 403);

  await env.DB.prepare(
    "UPDATE shares SET status = 'completed', updated_at = ? WHERE id = ?"
  ).bind(Date.now(), shareId).run();

  return corsResponse({ success: true });
}

// ---------- Ownership transfer ----------
async function transferOwnership(request, env, session) {
  const { fileId, recipientEmail, recipientUsername, retainAccess = false } = await request.json();

  if (!fileId) return corsResponse({ error: 'fileId required' }, 400);

  // Get file
  const file = await env.DB.prepare(
    'SELECT * FROM files WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND is_vault = 0'
  ).bind(fileId, session.userId).first();

  if (!file) return corsResponse({ error: 'File not found or cannot be transferred' }, 404);

  // Find recipient
  let recipient;
  if (recipientEmail) {
    recipient = await env.DB.prepare(
      'SELECT id, email, display_name, wallet_balance, wallet_limit FROM users WHERE email = ?'
    ).bind(recipientEmail).first();
  } else if (recipientUsername) {
    const handle = recipientUsername.startsWith('@') ? recipientUsername.slice(1) : recipientUsername;
    recipient    = await env.DB.prepare(
      'SELECT id, email, display_name, wallet_balance, wallet_limit FROM users WHERE username = ?'
    ).bind(handle).first();
  }

  if (!recipient) return corsResponse({ error: 'Recipient not found on DataDrop' }, 404);
  if (recipient.id === session.userId) return corsResponse({ error: 'Cannot transfer to yourself' }, 400);

  // Check recipient wallet can cover the file cost
  const monthlyFileCost = await calcStorageCost(env, file.size_gb);
  if (recipient.wallet_balance < monthlyFileCost) {
    return corsResponse({
      error: 'Recipient has insufficient wallet balance to accept this file',
      required: monthlyFileCost,
      available: recipient.wallet_balance,
    }, 402);
  }

  const now = Date.now();

  // Accumulate byte-seconds for both sender and recipient, then transfer
  await env.DB.batch([
    ...buildAccumulationBatch(session.userId, env.DB, -file.size_bytes),
    ...buildAccumulationBatch(recipient.id, env.DB, file.size_bytes),
    env.DB.prepare('UPDATE files SET user_id = ?, updated_at = ? WHERE id = ?').bind(recipient.id, now, fileId),
  ]);
  await decrementStorageBytes(env, session.userId, file.size_bytes);
  await incrementStorageBytes(env, recipient.id, file.size_bytes);

  // If sender retains access, create a view-only share
  if (retainAccess) {
    const retainShareId = newId();
    await env.DB.prepare(`
      INSERT INTO shares (id, file_id, owner_id, recipient_user_id, can_view, can_download, can_save,
                          ownership_transfer, transfer_completed, original_owner_retains_access,
                          status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 0, 0, 1, 1, 1, 'active', ?, ?)
    `).bind(retainShareId, fileId, recipient.id, session.userId, now, now).run();
  }

  // Notify recipient
  const sender = await env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(session.userId).first();
  await sendEmail(env, {
    to: recipient.email,
    subject: `${sender?.display_name} transferred a file to you on DataDrop`,
    html: `<p>Hi ${recipient.display_name},</p>
           <p><strong>${sender?.display_name}</strong> has transferred ownership of <strong>${file.filename}</strong> to you on DataDrop.</p>
           <p>The file is now in your storage and will be billed to your wallet.</p>
           <p><a href="https://app.datadrop.co.in/files/${fileId}">View file →</a></p>`,
  });

  return corsResponse({ success: true, fileId, newOwner: recipient.id });
}
