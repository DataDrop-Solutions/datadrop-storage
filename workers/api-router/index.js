// ============================================================
// DataDrop — API Router
// ============================================================

import uploadHandler    from '../upload/index.js';
import downloadHandler  from '../download/index.js';
import streamHandler    from '../stream/index.js';
import reportHandler    from '../report/index.js';
import adminHandler     from '../admin/index.js';
import sharesHandler    from './shares.js';
import filesHandler     from './files.js';
import userHandler      from './user.js';
import vaultHandler     from './vault.js';
import { handleTeams }        from './teams.js';
import { handleClerkWebhook } from '../webhook/clerk.js';
import { handleRazorpayWebhook } from '../webhook/razorpay.js';
import { runBilling, runBillPreview } from '../billing/index.js';
import { runBackup }    from '../backup/index.js';
import { runTrialCron } from '../trial/index.js';
import { migrationQueue } from '../migration/index.js';
import { reconcile }    from '../reconcile/index.js';

const ALLOWED_ORIGINS = new Set([
  'https://app.datadrop.co.in',
  'https://files.datadrop.co.in',
]);

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://app.datadrop.co.in',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Token, X-Admin-Session, X-Chunk-Sha1',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': "default-src 'none'",
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const url      = new URL(request.url);
    const hostname = url.hostname;
    const path     = url.pathname;

    // Subdomain routing
    if (hostname === 'admin.datadrop.co.in')  return adminHandler.fetch(request, env, ctx);
    if (hostname === 'stream.datadrop.co.in') return streamHandler.fetch(request, env, ctx);
    if (hostname === 'files.datadrop.co.in')  return downloadHandler.fetch(request, env, ctx);

    // Health
    if (path === '/health') return Response.json({ ok: true, ts: Date.now(), v: '1.0.0' });

    // Webhooks (no auth — verified internally)
    if (path === '/webhook/clerk')         return handleClerkWebhook(request, env);
    if (path === '/webhook/razorpay')      return handleRazorpayWebhook(request, env);

    // Contact form (public — no auth)
    if (path === '/contact' && request.method === 'POST') {
      try {
        const { name, email, subject, message } = await request.json();
        if (!name || !email || !message) return Response.json({ error: 'Missing required fields' }, { status: 400, headers: corsHeaders(origin) });
        const { sendEmail } = await import('../shared/utils.js');
        await sendEmail(env, {
          to: 'support@datadrop.co.in',
          subject: `[Contact] ${subject || 'No subject'} — ${name}`,
          html: `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p><p><strong>Subject:</strong> ${subject || '—'}</p><hr><p style="white-space:pre-wrap">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`,
        });
        return Response.json({ ok: true }, { headers: corsHeaders(origin) });
      } catch {
        return Response.json({ error: 'Failed to send message' }, { status: 500, headers: corsHeaders(origin) });
      }
    }

    // App API
    if (path.startsWith('/upload'))  return uploadHandler.fetch(request, env, ctx);
    if (path.startsWith('/files'))   return filesHandler.fetch(request, env, ctx);
    if (path.startsWith('/shares'))  return sharesHandler.fetch(request, env, ctx);
    if (path.startsWith('/user'))    return userHandler.fetch(request, env, ctx);
    if (path.startsWith('/vault'))   return vaultHandler.fetch(request, env, ctx);
    if (path.startsWith('/report'))  return reportHandler.fetch(request, env, ctx);
    if (path.startsWith('/teams'))   { const { validateSession } = await import('../shared/utils.js'); const s = await validateSession(request, env); if (!s) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders(origin) }); return handleTeams(request, env, s); }
    if (path.startsWith('/stream'))  return streamHandler.fetch(request, env, ctx);

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders(origin) });
  },

  async scheduled(event, env, ctx) {
    const cron = event.cron;
    if (cron === '0 18 1 * *')  ctx.waitUntil(runBilling(env));
    if (cron === '0 18 28-31 * *') ctx.waitUntil(runBillPreview(env));
    if (cron === '0 20 * * *') ctx.waitUntil(runBackup(env));
    if (cron === '0 2 * * *')  ctx.waitUntil(runTrialCron(env));
    if (cron === '0 * * * *')  ctx.waitUntil(reconcile(env));
  },

  async queue(batch, env, ctx) {
    return migrationQueue(batch, env, ctx);
  },
};
