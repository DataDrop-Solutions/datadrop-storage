// ============================================================
// DataDrop — Report Worker
// Route: POST /report           → submit report (with evidence)
// Route: POST /report/confirm   → recipient confirms file receipt
// Route: GET  /report/:shareId/status → check delivery status
// ============================================================

import { corsResponse, handleOptions, validateSession, newId, sendEmail, checkRateLimit, checkApiRateLimit } from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

    if (!(await checkApiRateLimit(env, session.userId))) {
      return corsResponse({ error: 'Too many requests' }, 429);
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace('/report', '');

    try {
      if (path === '' && request.method === 'POST')            return await submitReport(request, env, session);
      if (path === '/confirm' && request.method === 'POST')    return await confirmReceipt(request, env, session);
      if (path.startsWith('/status/') && request.method === 'GET') {
        return await getShareStatus(path.slice(8), env, session);
      }
      return corsResponse({ error: 'Not found' }, 404);
    } catch (_) {
      return corsResponse({ error: 'Internal error' }, 500);
    }
  },
};

// ---------- Submit content report ----------
async function submitReport(request, env, session) {
  // Rate limit: 20 reports per user per 24 hours
  const allowed = await checkRateLimit(env, `rate_report:${session.userId}`, 20, 86400);
  if (!allowed) return corsResponse({ error: 'Too many reports. Try again tomorrow.' }, 429);

  const { fileId, shareId, reason, evidenceBase64, evidenceType } = await request.json();

  if (!fileId)             return corsResponse({ error: 'fileId required' }, 400);
  if (!reason)             return corsResponse({ error: 'reason required' }, 400);
  if (!evidenceBase64)     return corsResponse({ error: 'evidence screenshot required' }, 400);

  // Verify the file exists and is accessible via this share
  const file = await env.DB.prepare(
    `SELECT f.id, f.user_id, f.filename, f.accessible, f.is_vault
     FROM files f WHERE f.id = ? AND f.deleted_at IS NULL`
  ).bind(fileId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);

  // 1. Upload evidence screenshot to B2 cold (non-vault bucket)
  const evidenceKey = `reports/${newId()}.${mimeToExt(evidenceType)}`;
  const evidenceUrl = await uploadEvidenceToB2(env, evidenceKey, evidenceBase64, evidenceType);

  // 2. Immediately hide file — set accessible = 0
  await env.DB.prepare(
    'UPDATE files SET accessible = 0, updated_at = ? WHERE id = ?'
  ).bind(Date.now(), fileId).run();

  // 3. Create report record
  const reportId   = newId();
  const uploaderId = file.user_id;

  const [reporter, uploader] = await Promise.all([
    env.DB.prepare('SELECT display_name, email FROM users WHERE id = ?').bind(session.userId).first(),
    env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(uploaderId).first(),
  ]);

  await env.DB.prepare(`
    INSERT INTO reports (id, file_id, share_id, reporter_id, uploader_id, reason, evidence_url, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).bind(
    reportId, fileId, shareId || null, session.userId,
    uploaderId, reason, evidenceUrl, Date.now(), Date.now(),
  ).run();

  // 4. Email admin immediately
  await sendEmail(env, {
    to: 'datadrop.contact@gmail.com',
    subject: `[DataDrop Report] New content report — ${reportId}`,
    html: `
      <h2>New Content Report</h2>
      <table style="border-collapse:collapse">
        <tr><td style="padding:6px;font-weight:bold">Report ID</td><td style="padding:6px">${reportId}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">File ID</td><td style="padding:6px">${fileId}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">File</td><td style="padding:6px">${file.filename}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">Share ID</td><td style="padding:6px">${shareId || 'N/A'}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">Reporter</td><td style="padding:6px">${reporter?.display_name} (${reporter?.email})</td></tr>
        <tr><td style="padding:6px;font-weight:bold">Uploader</td><td style="padding:6px">${uploader?.display_name}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">Reason</td><td style="padding:6px">${reason}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">Vault File</td><td style="padding:6px">${file.is_vault ? 'Yes (contents inaccessible)' : 'No'}</td></tr>
        <tr><td style="padding:6px;font-weight:bold">Status</td><td style="padding:6px">⚠️ File HIDDEN immediately</td></tr>
      </table>
      <p><strong>Evidence:</strong> <a href="${evidenceUrl}">View screenshot</a></p>
      <p><a href="https://admin.datadrop.co.in/reports/${reportId}">Review in admin dashboard →</a></p>
    `,
  });

  return corsResponse({ success: true, reportId, message: 'Report received. File has been hidden.' });
}

// ---------- Recipient confirms receipt (delete_on_confirm flow) ----------
async function confirmReceipt(request, env, session) {
  const { shareId } = await request.json();
  if (!shareId) return corsResponse({ error: 'shareId required' }, 400);

  const share = await env.DB.prepare(
    `SELECT s.*, f.user_id as owner_id
     FROM shares s JOIN files f ON f.id = s.file_id
     WHERE s.id = ? AND s.recipient_user_id = ? AND s.status = 'active'`
  ).bind(shareId, session.userId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);
  if (!share.delete_on_confirm) return corsResponse({ error: 'This share does not have confirm-to-delete enabled' }, 400);

  const now = Date.now();

  // Mark confirmed
  await env.DB.prepare(
    "UPDATE shares SET confirmed_at = ?, status = 'completed' WHERE id = ?"
  ).bind(now, shareId).run();

  // Queue file deletion (sender's file)
  await env.QUEUE.send({
    type: 'DELETE_FILE_FROM_BUCKET',
    fileId: share.file_id,
    userId: share.owner_id,
    deleteFromD1: true,
  });

  // Notify sender
  const [recipient, sender] = await Promise.all([
    env.DB.prepare('SELECT display_name FROM users WHERE id = ?').bind(session.userId).first(),
    env.DB.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(share.owner_id).first(),
  ]);

  if (sender) {
    await sendEmail(env, {
      to: sender.email,
      subject: 'DataDrop: File confirmed received and deleted',
      html: `<p>Hi ${sender.display_name},</p>
             <p>${recipient?.display_name || 'The recipient'} has confirmed receipt of your file.</p>
             <p>The file has been permanently deleted from DataDrop as requested.</p>`,
    });
  }

  return corsResponse({ success: true });
}

// ---------- Share delivery status ----------
async function getShareStatus(shareId, env, session) {
  const share = await env.DB.prepare(
    `SELECT s.status, s.confirmed_at, s.views_used, s.invite_claimed,
            r.display_name as recipient_name
     FROM shares s
     LEFT JOIN users r ON r.id = s.recipient_user_id
     WHERE s.id = ? AND s.owner_id = ?`
  ).bind(shareId, session.userId).first();

  if (!share) return corsResponse({ error: 'Share not found' }, 404);

  let deliveryStatus;
  if (share.confirmed_at) {
    deliveryStatus = 'confirmed_deleted';
  } else if (share.views_used > 0) {
    deliveryStatus = 'opened_awaiting_confirmation';
  } else if (share.invite_claimed) {
    deliveryStatus = 'delivered';
  } else {
    deliveryStatus = 'pending';
  }

  return corsResponse({
    shareId,
    status: share.status,
    deliveryStatus,
    viewsUsed: share.views_used,
    confirmedAt: share.confirmed_at,
    recipientName: share.recipient_name,
  });
}

// ---------- Helpers ----------
async function uploadEvidenceToB2(env, key, base64Data, mimeType) {
  const { getB2Auth, getB2UploadUrl } = await import('../shared/utils.js');
  const auth      = await getB2Auth(env.B2_COLD_KEY_ID, env.B2_COLD_APP_KEY);
  const uploadUrl = await getB2UploadUrl(auth, env.B2_COLD_BUCKET_ID);

  const binary = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

  const resp = await fetch(uploadUrl.uploadUrl, {
    method: 'POST',
    headers: {
      Authorization:     uploadUrl.authorizationToken,
      'X-Bz-File-Name':  encodeURIComponent(key),
      'Content-Type':    mimeType || 'image/png',
      'Content-Length':  String(binary.length),
      'X-Bz-Content-Sha1': 'do_not_verify',
    },
    body: binary,
  });

  if (!resp.ok) throw new Error(`Evidence upload failed: ${resp.status}`);
  const data = await resp.json();

  // Return internal URL (never exposed to client — for admin use only)
  return `internal://b2-cold/${key}`;
}

function mimeToExt(mime) {
  const map = {
    'image/png': 'png', 'image/jpeg': 'jpg',
    'image/webp': 'webp', 'image/gif': 'gif',
  };
  return map[mime] || 'png';
}
