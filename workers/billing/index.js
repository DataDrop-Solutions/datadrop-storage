// ============================================================
// DataDrop — Billing Worker (Cron: 1st of month, 00:05 IST)
// Byte-second accumulation billing — charges wallet balance
// ============================================================

import {
  getConfigNum, sendEmail, bytesToGb, GB,
  buildAccumulationBatch, loadBillingConfig, accumulatedToGbMonths,
  calculateTieredBill, getCurrentBillingMonth,
} from '../shared/utils.js';

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBilling(env));
  },
  async fetch(request, env) {
    const auth = request.headers.get('X-Admin-Secret');
    if (auth !== env.ADMIN_SECRET) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url);
    if (url.pathname === '/preview') {
      await runBillPreview(env);
      return new Response('Preview run complete');
    }
    await runBilling(env);
    return new Response('Billing run complete');
  },
};

function getPreviousMonth() {
  const d = new Date();
  const prevMonthNum = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  const prevYear = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  return `${prevYear}-${String(prevMonthNum).padStart(2, '0')}`;
}

async function runBilling(env) {
  const lastMonth = getPreviousMonth();
  const config = await loadBillingConfig(env);

  const { results: users } = await env.DB.prepare(
    `SELECT id, email, display_name, wallet_balance, wallet_limit, adfree_active, adfree_locked_price
     FROM users WHERE status IN ('active') ORDER BY id`
  ).all();

  for (const user of users) {
    try {
      await billUser(env, user, lastMonth, config);
    } catch (_) {}
  }

  await runNonPaymentFlow(env);
}

async function billUser(env, user, lastMonth, config) {
  // Idempotency check
  const existing = await env.DB.prepare(
    'SELECT id FROM billing WHERE user_id = ? AND month = ?'
  ).bind(user.id, lastMonth).first();
  if (existing) return;

  // Run final accumulation for last month (capture any remaining seconds)
  await env.DB.batch(buildAccumulationBatch(user.id, env.DB, 0));

  // Read storage_usage
  const usageRow = await env.DB.prepare(
    'SELECT accumulated_byte_seconds, billing_month, current_bytes FROM storage_usage WHERE user_id = ?'
  ).bind(user.id).first();

  const accByteSeconds = usageRow?.accumulated_byte_seconds || 0;
  const gbMonths = accumulatedToGbMonths(accByteSeconds, lastMonth);
  const storageAmount = calculateTieredBill(gbMonths, config);

  const adfreeAmount = user.adfree_active ? (user.adfree_locked_price || 49) : 0;

  const teamsBillingEnabled = await getConfigNum(env, 'teams_billing_enabled');
  let teamsAmount = 0;
  if (teamsBillingEnabled === 1) {
    const { results: teamRows } = await env.DB.prepare(
      `SELECT tb.amount FROM team_billing tb
       JOIN teams t ON t.id = tb.team_id
       WHERE t.owner_id = ? AND tb.month = ?`
    ).bind(user.id, lastMonth).all();
    teamsAmount = teamRows.reduce((s, r) => s + r.amount, 0);
  }

  const rawAmount = storageAmount + adfreeAmount + teamsAmount;
  const minBill = config.min_bill_amount || 1;
  const totalAmount = gbMonths > 0 && rawAmount < minBill ? minBill : rawAmount;

  if (totalAmount === 0) return;

  if (user.wallet_balance < totalAmount) {
    await env.DB.prepare("UPDATE users SET status = 'read_only' WHERE id = ?").bind(user.id).run();
    await sendEmail(env, {
      to: user.email,
      subject: 'DataDrop: Insufficient wallet balance — account set to read-only',
      html: `<p>Hi ${user.display_name},</p>
             <p>Your DataDrop bill for ${lastMonth} is ₹${totalAmount.toFixed(2)}, but your wallet balance is ₹${user.wallet_balance.toFixed(2)}.</p>
             <p>Your account has been set to read-only. Please add funds at <a href="https://app.datadrop.co.in/settings">app.datadrop.co.in/settings</a> to restore access.</p>`,
    });
    return;
  }

  const billingId = crypto.randomUUID().replace(/-/g, '');
  const now = Date.now();
  const currentGb = (usageRow?.current_bytes || 0) / GB;

  await env.DB.batch([
    env.DB.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?').bind(totalAmount, user.id),
    env.DB.prepare(`
      INSERT INTO billing (id, user_id, month, billing_date, committed_amount, actual_usage_gb,
                           actual_usage_amount, adfree_amount, teams_amount, total_charged,
                           gb_months, accumulated_byte_seconds, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)
    `).bind(billingId, user.id, lastMonth, now, currentGb,
            storageAmount, adfreeAmount, teamsAmount, totalAmount,
            gbMonths, accByteSeconds, now, now),
    env.DB.prepare(
      'UPDATE storage_usage SET accumulated_byte_seconds = 0, last_updated_at = ?, billing_month = ? WHERE user_id = ?'
    ).bind(now, getCurrentBillingMonth(), user.id),
  ]);

  await sendReceipt(env, user, { gbMonths, currentGb, storageAmount, adfreeAmount, teamsAmount, totalAmount, month: lastMonth });
}

// ---------- Non-payment escalation ----------
async function runNonPaymentFlow(env) {
  const retentionDays = await getConfigNum(env, 'retention_days_unpaid');

  const { results: unpaidUsers } = await env.DB.prepare(`
    SELECT u.id, u.email, u.display_name, u.status,
           b.id as billing_id, b.total_charged, b.month,
           CAST((unixepoch() * 1000 - b.created_at) / 86400000 AS INTEGER) as days_overdue
    FROM users u
    JOIN billing b ON b.user_id = u.id AND b.status = 'failed'
    WHERE u.status IN ('read_only', 'suspended')
    ORDER BY b.created_at ASC
  `).all();

  for (const user of unpaidUsers) {
    const d = user.days_overdue;
    if (d >= 30 && d < 31) await maybeSendReminder(env, user, 'reminder_30', '30 days overdue');
    if (d >= 60 && d < 61) await maybeSendReminder(env, user, 'reminder_60', '60 days overdue — data at risk');
    if (d >= 85 && d < 86) await maybeSendReminder(env, user, 'reminder_85', '5 days until permanent deletion');
    if (d >= 90) await permanentlyDeleteUser(env, user);
  }
}

async function maybeSendReminder(env, user, type, message) {
  const key = `nonpay_notif:${user.id}:${type}`;
  const already = await env.KV.get(key);
  if (already) return;
  await env.KV.put(key, '1', { expirationTtl: 86400 * 100 });
  await sendEmail(env, {
    to: user.email,
    subject: `DataDrop: Action required — ${message}`,
    html: `<p>Hi ${user.display_name},</p>
           <p>Your DataDrop account has an outstanding balance of ₹${user.total_charged.toFixed(2)}.</p>
           <p>${message}</p>
           <p>Add wallet balance at <a href="https://app.datadrop.co.in/settings">app.datadrop.co.in/settings</a> to restore access.</p>
           <p>After 90 days of non-payment, all your data will be permanently deleted and cannot be recovered.</p>`,
  });
}

async function permanentlyDeleteUser(env, user) {
  await env.DB.prepare(
    "UPDATE files SET deleted_at = ?, trash_expires_at = ? WHERE user_id = ? AND deleted_at IS NULL"
  ).bind(Date.now(), Date.now(), user.id).run();
  await env.DB.prepare(
    "UPDATE users SET status = 'deleted', deleted_at = ? WHERE id = ?"
  ).bind(Date.now(), user.id).run();
  await env.QUEUE.send({ type: 'DELETE_USER_DATA', userId: user.id });
  await sendEmail(env, {
    to: user.email,
    subject: 'DataDrop: Your account has been closed',
    html: `<p>Hi ${user.display_name},</p>
           <p>Due to 90 days of non-payment, your DataDrop account has been permanently closed and all data has been deleted.</p>`,
  });
}

// ---------- Email ----------
async function sendReceipt(env, user, { gbMonths, currentGb, storageAmount, adfreeAmount, teamsAmount, totalAmount, month }) {
  await sendEmail(env, {
    to: user.email,
    subject: `DataDrop receipt — ${month}`,
    html: `
      <h2>DataDrop — Monthly Receipt</h2>
      <p>Hi ${user.display_name},</p>
      <table style="border-collapse:collapse;width:100%;max-width:500px">
        <tr><td style="padding:8px;border-bottom:1px solid #eee">Storage (${gbMonths.toFixed(4)} GB-months)</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${storageAmount.toFixed(2)}</td></tr>
        ${adfreeAmount ? `<tr><td style="padding:8px;border-bottom:1px solid #eee">Ad-free video</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${adfreeAmount.toFixed(2)}</td></tr>` : ''}
        ${teamsAmount ? `<tr><td style="padding:8px;border-bottom:1px solid #eee">Teams</td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${teamsAmount.toFixed(2)}</td></tr>` : ''}
        <tr><td style="padding:8px;font-weight:bold">Total charged from wallet</td>
            <td style="padding:8px;font-weight:bold;text-align:right">₹${totalAmount.toFixed(2)}</td></tr>
      </table>
      <p style="color:#888;font-size:12px">DataDrop — datadrop.co.in</p>
    `,
  });
}

// ---------- Bill preview (read-only, no D1 writes) ----------
export async function runBillPreview(env) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (tomorrow.getUTCDate() !== 1) return; // only run on last day of month

  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const config = await loadBillingConfig(env);

  const { results: users } = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.wallet_balance, u.adfree_active, u.adfree_locked_price
     FROM users u WHERE u.status = 'active' ORDER BY u.id`
  ).all();

  for (const user of users) {
    try {
      const key = `preview_sent:${user.id}:${month}`;
      const already = await env.KV.get(key);
      if (already) continue;

      // Read-only: do NOT write to D1
      const usageRow = await env.DB.prepare(
        'SELECT accumulated_byte_seconds, billing_month, current_bytes, last_updated_at FROM storage_usage WHERE user_id = ?'
      ).bind(user.id).first();

      // Project to end of month (pure calculation, no writes)
      const nowMs = Date.now();
      const elapsed = usageRow ? Math.max(0, (nowMs - usageRow.last_updated_at) / 1000) : 0;
      const currentAcc = usageRow ? usageRow.accumulated_byte_seconds + (usageRow.current_bytes * elapsed) : 0;
      const [yr, mo] = month.split('-').map(Number);
      const endOfMonth = new Date(yr, mo, 1).getTime();
      const secondsRemaining = Math.max(0, (endOfMonth - nowMs) / 1000);
      const projectedAcc = currentAcc + ((usageRow?.current_bytes || 0) * secondsRemaining);
      const gbMonths = accumulatedToGbMonths(projectedAcc, month);
      const storageAmount = calculateTieredBill(gbMonths, config);
      const adfree = user.adfree_active ? (user.adfree_locked_price || 49) : 0;
      const total = Math.max(storageAmount + adfree, gbMonths > 0 ? (config.min_bill_amount || 1) : 0);

      await env.KV.put(key, '1', { expirationTtl: 86400 * 5 });

      await sendEmail(env, {
        to: user.email,
        subject: `DataDrop: Your ${month} bill — ₹${total.toFixed(2)}`,
        html: `
          <p>Hi ${user.display_name},</p>
          <p>Your DataDrop month ends today. Here's your projected bill (charged tomorrow from wallet).</p>
          <table style="border-collapse:collapse;width:100%;max-width:400px">
            <tr><td style="padding:8px;border-bottom:1px solid #eee">Storage (${gbMonths.toFixed(4)} GB-months)</td>
                <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${storageAmount.toFixed(2)}</td></tr>
            ${adfree ? `<tr><td style="padding:8px;border-bottom:1px solid #eee">Ad-free video</td>
                <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${adfree.toFixed(2)}</td></tr>` : ''}
            <tr><td style="padding:8px;font-weight:700">Total</td>
                <td style="padding:8px;font-weight:700;text-align:right">₹${total.toFixed(2)}</td></tr>
          </table>
          <p>Wallet balance: ₹${user.wallet_balance.toFixed(2)}</p>
        `,
      });
    } catch (_) {}
  }
}

export { runBilling };
export { runBilling as billingScheduled };
