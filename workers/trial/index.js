// ============================================================
// DataDrop — Trial Worker (Cron: daily at 07:00 IST)
// Manages trial lifecycle:
//   Day 6:  personalised email with usage & cost preview
//   Day 7:  trial ends (trial_ends_at reached)
//   Day 8:  uploads paused, first reminder
//   Day 10: second reminder
//   Day 13: third reminder
//   Day 15: permanent deletion if no payment
// ============================================================

import { calcStorageCost, sendEmail, getStorageBytes, bytesToGb } from '../shared/utils.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTrialCron(env));
  },
  async fetch(request, env) {
    const auth = request.headers.get('X-Admin-Secret');
    if (auth !== env.ADMIN_SECRET) return new Response('Forbidden', { status: 403 });
    await runTrialCron(env);
    return new Response('Trial cron complete');
  },
};

async function runTrialCron(env) {
  const now = Date.now();
  void('[Trial] Cron starting');

  // Fetch all trial users
  const { results: trialUsers } = await env.DB.prepare(
    `SELECT id, email, display_name, trial_ends_at, status
     FROM users
     WHERE status = 'trial' AND deleted_at IS NULL`
  ).all();

  for (const user of trialUsers) {
    try {
      await processTrialUser(env, user, now);
    } catch (_) {}
  }

  // Also process users who converted from trial (day 8-14 payment check is handled in billing flow)
  // Process users past trial in non-payment state
  const { results: lapsedUsers } = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.trial_ends_at, u.status
     FROM users u
     WHERE u.status = 'read_only'
     AND u.trial_ends_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM billing b WHERE b.user_id = u.id AND b.status = 'paid')`
  ).all();

  for (const user of lapsedUsers) {
    try {
      await processLapsedTrialUser(env, user, now);
    } catch (_) {}
  }

  void('[Trial] Cron complete');
}

async function processTrialUser(env, user, now) {
  const trialEndsAt = user.trial_ends_at;
  if (!trialEndsAt) return;

  const msPerDay = 86400000;
  const trialDaysPassed = (now - (trialEndsAt - 7 * msPerDay)) / msPerDay;

  // Day 6: personalised usage email (send once, 1 day before trial ends)
  if (trialDaysPassed >= 6 && trialDaysPassed < 7) {
    await maybeSendTrialEmail(env, user, 'trial_day6', async () => {
      const storageBytes = await getStorageBytes(env, user.id);
      const storageGb    = bytesToGb(storageBytes);
      const monthlyCost  = await calcStorageCost(env, storageGb);
      return usagePreviewEmail(user, storageGb, monthlyCost);
    });
  }

  // Day 7+: trial has expired — set to read_only
  if (now >= trialEndsAt && user.status === 'trial') {
    await env.DB.prepare(
      "UPDATE users SET status = 'read_only' WHERE id = ? AND status = 'trial'"
    ).bind(user.id).run();
    void(`[Trial] User ${user.id} trial expired, set to read_only`);
  }
}

async function processLapsedTrialUser(env, user, now) {
  const trialEndsAt = user.trial_ends_at;
  if (!trialEndsAt) return;

  const msPerDay = 86400000;
  const daysSinceTrialEnd = (now - trialEndsAt) / msPerDay;

  // Day 8 (1 day after trial end): first reminder
  if (daysSinceTrialEnd >= 1 && daysSinceTrialEnd < 2) {
    await maybeSendTrialEmail(env, user, 'lapsed_day8', () => ({
      subject: 'DataDrop trial ended — set up billing to keep your files',
      html: lapsedReminderHtml(user.display_name, 7),
    }));
  }

  // Day 10 (3 days after trial end): second reminder
  if (daysSinceTrialEnd >= 3 && daysSinceTrialEnd < 4) {
    await maybeSendTrialEmail(env, user, 'lapsed_day10', () => ({
      subject: 'DataDrop: Your files will be deleted in 5 days',
      html: lapsedReminderHtml(user.display_name, 5),
    }));
  }

  // Day 13 (6 days after trial end): final warning
  if (daysSinceTrialEnd >= 6 && daysSinceTrialEnd < 7) {
    await maybeSendTrialEmail(env, user, 'lapsed_day13', () => ({
      subject: '⚠️ DataDrop: 2 days until your files are permanently deleted',
      html: lapsedReminderHtml(user.display_name, 2),
    }));
  }

  // Day 15 (8 days after trial end): permanent deletion
  if (daysSinceTrialEnd >= 8) {
    await permanentlyDeleteTrialUser(env, user);
  }
}

async function permanentlyDeleteTrialUser(env, user) {
  // Check once more if they've paid in the meantime
  const paid = await env.DB.prepare(
    "SELECT id FROM billing WHERE user_id = ? AND status = 'paid' LIMIT 1"
  ).bind(user.id).first();

  if (paid) {
    void(`[Trial] User ${user.id} has paid — skipping deletion`);
    await env.DB.prepare(
      "UPDATE users SET status = 'active', trial_ends_at = NULL WHERE id = ?"
    ).bind(user.id).run();
    return;
  }

  void(`[Trial] Permanent deletion for lapsed trial user ${user.id}`);

  // Soft-delete all files
  await env.DB.prepare(
    "UPDATE files SET deleted_at = ?, trash_expires_at = ? WHERE user_id = ? AND deleted_at IS NULL"
  ).bind(Date.now(), Date.now(), user.id).run();

  // Close account
  await env.DB.prepare(
    "UPDATE users SET status = 'deleted', deleted_at = ? WHERE id = ?"
  ).bind(Date.now(), user.id).run();

  // Queue bucket cleanup (include clerkUserId for full account removal)
  await env.QUEUE.send({ type: 'DELETE_USER_DATA', userId: user.id, clerkUserId: user.clerk_user_id || null });

  // Final email
  await sendEmail(env, {
    to: user.email,
    subject: 'DataDrop: Your trial data has been deleted',
    html: `<p>Hi ${user.display_name},</p>
           <p>Your DataDrop trial ended and we were unable to process payment. All your data has been permanently deleted.</p>
           <p>You can start a new trial at <a href="https://datadrop.co.in">datadrop.co.in</a> if you'd like to try again.</p>`,
  });
}

// ---------- Dedup notification helper ----------
async function maybeSendTrialEmail(env, user, type, contentFn) {
  const key = `trial_notif:${user.id}:${type}`;
  const already = await env.KV.get(key);
  if (already) return;
  await env.KV.put(key, '1', { expirationTtl: 86400 * 30 });

  const content = await contentFn();
  await sendEmail(env, { to: user.email, ...content });
  void(`[Trial] Sent ${type} to ${user.id}`);
}

// ---------- Email templates ----------
function usagePreviewEmail(user, storageGb, monthlyCost) {
  const storageText = storageGb < 0.01
    ? 'less than 10 MB'
    : storageGb < 1
    ? `${(storageGb * 1000).toFixed(0)} MB`
    : `${storageGb.toFixed(2)} GB`;

  return {
    subject: 'Your DataDrop trial ends tomorrow',
    html: `
      <p>Hi ${user.display_name},</p>
      <p>Your DataDrop free trial ends tomorrow.</p>
      <h3>Your usage so far:</h3>
      <ul>
        <li>Storage used: <strong>${storageText}</strong></li>
        <li>Estimated monthly cost: <strong>₹${monthlyCost.toFixed(2)}</strong></li>
      </ul>
      <p>To keep your files and continue using DataDrop, set up your storage wallet at:
         <a href="https://app.datadrop.co.in/billing">app.datadrop.co.in/billing</a></p>
      <p>You only pay for what you store. Prices drop as you store more. Every feature is included.</p>
      <p>If you don't set up billing, your files will be deleted on day 15.</p>
    `,
  };
}

function lapsedReminderHtml(name, daysLeft) {
  return `
    <p>Hi ${name},</p>
    <p>Your DataDrop trial has ended. Your files are safe for now, but will be <strong>permanently deleted in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> if you don't set up billing.</p>
    <p><a href="https://app.datadrop.co.in/billing" style="background:#000;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Set up billing →</a></p>
    <p style="color:#888;font-size:12px">You only pay for what you store — no fixed plans, no bundles.</p>
  `;
}

// Named export for router
export { runTrialCron as trialScheduled };

export { runTrialCron };
