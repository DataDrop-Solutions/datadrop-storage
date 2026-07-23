// ============================================================
// DataDrop — Billing Worker (Cron: 1st of month, 00:05 IST)
// Byte-second accumulation billing — charges wallet via AutoPay
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
    if (url.pathname === '/preview') { await runBillPreview(env); return new Response('Preview done'); }
    if (url.pathname === '/retry')   { await runDailyRetry(env); return new Response('Retry done'); }
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

export async function runBilling(env) {
  const lastMonth = getPreviousMonth();
  const config = await loadBillingConfig(env);

  const { results: users } = await env.DB.prepare(
    `SELECT id, email, display_name, phone, wallet_balance, wallet_limit, adfree_active, adfree_locked_price
     FROM users WHERE status IN ('active') ORDER BY id LIMIT 5000`
  ).all();

  for (const user of users) {
    try { await billUser(env, user, lastMonth, config); } catch (_) {}
  }

  await runNonPaymentFlow(env);
}

async function billUser(env, user, lastMonth, config) {
  // Idempotency: skip if already billed this month
  const existing = await env.DB.prepare(
    'SELECT id, status FROM billing WHERE user_id = ? AND month = ?'
  ).bind(user.id, lastMonth).first();
  if (existing) return;

  // Final accumulation flush
  await env.DB.batch(buildAccumulationBatch(user.id, env.DB, 0));

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
      `SELECT tb.amount FROM team_billing tb JOIN teams t ON t.id = tb.team_id
       WHERE t.owner_id = ? AND tb.month = ?`
    ).bind(user.id, lastMonth).all();
    teamsAmount = teamRows.reduce((s, r) => s + r.amount, 0);
  }

  const rawAmount = storageAmount + adfreeAmount + teamsAmount;
  const minBill = config.min_bill_amount || 1;
  const totalAmount = gbMonths > 0 && rawAmount < minBill ? minBill : rawAmount;
  if (totalAmount === 0) return;

  const billingId  = crypto.randomUUID().replace(/-/g, '');
  const idempKey   = `bill_${user.id.slice(0,12)}_${lastMonth}`;
  const now        = Date.now();
  const currentGb  = (usageRow?.current_bytes || 0) / GB;

  if (user.wallet_balance >= totalAmount) {
    // Direct wallet charge — success
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?').bind(totalAmount, user.id),
      env.DB.prepare(`
        INSERT INTO billing (id, user_id, month, billing_date, committed_amount, actual_usage_gb,
                             actual_usage_amount, adfree_amount, teams_amount, total_charged,
                             gb_months, accumulated_byte_seconds, status,
                             payment_method, paid_at, idempotency_key, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'paid', 'AUTOPAY', ?, ?, ?, ?)
      `).bind(billingId, user.id, lastMonth, now, currentGb,
              storageAmount, adfreeAmount, teamsAmount, totalAmount,
              gbMonths, accByteSeconds, now, idempKey, now, now),
      env.DB.prepare(
        'UPDATE storage_usage SET accumulated_byte_seconds = 0, last_updated_at = ?, billing_month = ? WHERE user_id = ?'
      ).bind(now, getCurrentBillingMonth(), user.id),
    ]);
    await sendReceipt(env, user, { gbMonths, currentGb, storageAmount, adfreeAmount, teamsAmount, totalAmount, month: lastMonth });
    return;
  }

  // Try AutoPay mandate top-up
  const topupResult = await tryMandateTopup(env, user, totalAmount);
  if (topupResult.success) {
    const refreshed = await env.DB.prepare('SELECT wallet_balance FROM users WHERE id = ?').bind(user.id).first();
    user.wallet_balance = refreshed?.wallet_balance || 0;
    if (user.wallet_balance >= totalAmount) {
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?').bind(totalAmount, user.id),
        env.DB.prepare(`
          INSERT INTO billing (id, user_id, month, billing_date, committed_amount, actual_usage_gb,
                               actual_usage_amount, adfree_amount, teams_amount, total_charged,
                               gb_months, accumulated_byte_seconds, status,
                               payment_method, paid_at, idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'paid', 'AUTOPAY', ?, ?, ?, ?)
        `).bind(billingId, user.id, lastMonth, now, currentGb,
                storageAmount, adfreeAmount, teamsAmount, totalAmount,
                gbMonths, accByteSeconds, now, idempKey, now, now),
        env.DB.prepare(
          'UPDATE storage_usage SET accumulated_byte_seconds = 0, last_updated_at = ?, billing_month = ? WHERE user_id = ?'
        ).bind(now, getCurrentBillingMonth(), user.id),
      ]);
      await sendReceipt(env, user, { gbMonths, currentGb, storageAmount, adfreeAmount, teamsAmount, totalAmount, month: lastMonth });
      return;
    }
  }

  // AutoPay failed — enter Payment Recovery Mode
  const failedBillingId = crypto.randomUUID().replace(/-/g, '');
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET status = 'read_only' WHERE id = ?").bind(user.id),
    env.DB.prepare(`
      INSERT INTO billing (id, user_id, month, billing_date, actual_usage_gb, actual_usage_amount,
        adfree_amount, teams_amount, total_charged, gb_months, accumulated_byte_seconds,
        status, first_failed_at, retry_count, next_retry_at, last_failure_reason, idempotency_key,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, 0, ?, ?, ?, ?, ?)
    `).bind(failedBillingId, user.id, lastMonth, now,
      currentGb, storageAmount, adfreeAmount, teamsAmount, totalAmount,
      gbMonths, accByteSeconds, now, now + 86400000,
      topupResult.reason || 'AutoPay failed', idempKey, now, now),
  ]);
  await logReminder(env, user.id, failedBillingId, 'autopay_fail', 0);
  await sendPaymentFailedEmail(env, user, totalAmount, lastMonth, 0);
}

// ---------- Mandate top-up ----------
async function tryMandateTopup(env, user, requiredAmount) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return { success: false, reason: 'AutoPay not configured' };

  const mandate = await env.DB.prepare(
    "SELECT razorpay_customer_id, razorpay_token_id, protection_limit FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1 ORDER BY created_at DESC LIMIT 1"
  ).bind(user.id).first();
  if (!mandate?.razorpay_token_id) return { success: false, reason: 'No active AutoPay mandate' };

  const chargeAmount = Math.ceil(requiredAmount - user.wallet_balance);
  if (chargeAmount <= 0) return { success: true };
  if (chargeAmount > (mandate.protection_limit || 0)) return { success: false, reason: 'Amount exceeds mandate limit' };

  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  const orderResp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(chargeAmount * 100), currency: 'INR', payment_capture: 1,
      receipt: `bill_${user.id.slice(0,12)}_${Date.now().toString(36)}`,
      notes: { userId: user.id, type: 'billing_charge' },
    }),
  }).catch(() => null);
  if (!orderResp?.ok) return { success: false, reason: 'Order creation failed' };

  const order = await orderResp.json().catch(() => ({}));
  if (!order.id) return { success: false, reason: 'Order ID missing' };

  const payResp = await fetch('https://api.razorpay.com/v1/payments/create/recurring', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: user.email, contact: user.phone ? `+${user.phone}` : '',
      amount: Math.round(chargeAmount * 100), currency: 'INR',
      order_id: order.id, customer_id: mandate.razorpay_customer_id,
      token: mandate.razorpay_token_id, recurring: '1',
      description: 'DataDrop monthly bill',
      notes: { userId: user.id, type: 'billing_charge' },
    }),
  }).catch(() => null);
  if (!payResp?.ok) {
    const errBody = await payResp?.json().catch(() => ({}));
    return { success: false, reason: errBody?.error?.description || 'Recurring charge failed' };
  }
  const payment = await payResp.json().catch(() => ({}));
  if (!payment.razorpay_payment_id) return { success: false, reason: 'Payment ID missing' };

  await env.DB.prepare('UPDATE users SET wallet_balance = wallet_balance + ?, updated_at = ? WHERE id = ?')
    .bind(chargeAmount, Date.now(), user.id).run();
  // Prevent webhook double-credit for this payment (HIGH-3)
  await env.KV.put(`webhook_pay:${payment.razorpay_payment_id}`, 'billing_precredit', { expirationTtl: 7 * 86400 }).catch(() => {});
  return { success: true };
}

// ---------- Daily retry (runs every 24h for all failed invoices within 35 days) ----------
export async function runDailyRetry(env) {
  const now = Date.now();

  // Find failed invoices due for retry
  const { results: failedInvoices } = await env.DB.prepare(`
    SELECT b.id as billing_id, b.total_charged, b.month, b.retry_count,
           b.first_failed_at, b.idempotency_key,
           u.id, u.email, u.display_name, u.phone, u.wallet_balance, u.wallet_limit,
           u.adfree_active, u.adfree_locked_price,
           CAST((? - b.first_failed_at) / 86400000 AS INTEGER) as days_overdue
    FROM billing b
    JOIN users u ON u.id = b.user_id
    WHERE b.status = 'failed'
      AND b.next_retry_at IS NOT NULL
      AND b.next_retry_at <= ?
      AND u.status = 'read_only'
      AND CAST((? - b.first_failed_at) / 86400000 AS INTEGER) < 35
    LIMIT 200
  `).bind(now, now, now).all();

  for (const inv of failedInvoices) {
    try {
      const user = {
        id: inv.id, email: inv.email, display_name: inv.display_name,
        phone: inv.phone, wallet_balance: inv.wallet_balance || 0,
        wallet_limit: inv.wallet_limit, adfree_active: inv.adfree_active,
        adfree_locked_price: inv.adfree_locked_price,
      };

      // Check wallet first
      let paid = false;
      let paymentMethod = 'AUTOPAY';
      if (user.wallet_balance >= inv.total_charged) {
        paid = true;
      } else {
        const topupResult = await tryMandateTopup(env, user, inv.total_charged);
        if (topupResult.success) {
          const refreshed = await env.DB.prepare('SELECT wallet_balance FROM users WHERE id = ?').bind(user.id).first();
          paid = (refreshed?.wallet_balance || 0) >= inv.total_charged;
          if (paid) user.wallet_balance = refreshed.wallet_balance;
        } else {
          // Retry failed — update retry metadata
          const newRetryCount = (inv.retry_count || 0) + 1;
          await env.DB.prepare(
            'UPDATE billing SET retry_count = ?, next_retry_at = ?, last_failure_reason = ?, updated_at = ? WHERE id = ?'
          ).bind(newRetryCount, now + 86400000, topupResult.reason || 'AutoPay declined', now, inv.billing_id).run();
          continue;
        }
      }

      if (paid) {
        const payNow = now;
        await env.DB.batch([
          env.DB.prepare('UPDATE users SET status = \'active\', updated_at = ? WHERE id = ?').bind(payNow, user.id),
          env.DB.prepare('UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?').bind(inv.total_charged, user.id),
          env.DB.prepare(
            'UPDATE billing SET status = \'paid\', payment_method = ?, paid_at = ?, next_retry_at = NULL, updated_at = ? WHERE id = ?'
          ).bind(paymentMethod, payNow, payNow, inv.billing_id),
          env.DB.prepare(
            'UPDATE storage_usage SET accumulated_byte_seconds = 0, last_updated_at = ?, billing_month = ? WHERE user_id = ?'
          ).bind(payNow, getCurrentBillingMonth(), user.id),
        ]);
        await sendAccountRestoredEmail(env, user, inv.total_charged, inv.month);
      }
    } catch (_) {}
  }

  // Also run the non-payment escalation for reminders + 35-day deletion
  await runNonPaymentFlow(env);
}

// ---------- Non-payment escalation (reminders + deletion) ----------
async function runNonPaymentFlow(env) {
  const now = Date.now();

  const { results: unpaidUsers } = await env.DB.prepare(`
    SELECT u.id, u.email, u.display_name, u.status,
           b.id as billing_id, b.total_charged, b.month, b.first_failed_at,
           CAST((unixepoch() * 1000 - b.first_failed_at) / 86400000 AS INTEGER) as days_overdue
    FROM users u
    JOIN billing b ON b.id = (
      SELECT id FROM billing WHERE user_id = u.id AND status = 'failed'
      ORDER BY created_at ASC LIMIT 1
    )
    WHERE u.status IN ('read_only', 'suspended')
  `).all();

  for (const user of unpaidUsers) {
    const d = user.days_overdue;
    if (d >= 35) { await permanentlyDeleteUser(env, user); continue; }
    // Reminders — send once per milestone
    if (d >= 1  && d < 2)  await maybeSendReminder(env, user, 'day_1',  1);
    if (d >= 7  && d < 8)  await maybeSendReminder(env, user, 'day_7',  7);
    if (d >= 14 && d < 15) await maybeSendReminder(env, user, 'day_14', 14);
    if (d >= 21 && d < 22) await maybeSendReminder(env, user, 'day_21', 21);
    if (d >= 30 && d < 31) await maybeSendReminder(env, user, 'day_30', 30);
    if (d >= 34 && d < 35) await maybeSendReminder(env, user, 'day_34', 34);
  }
}

async function maybeSendReminder(env, user, type, day) {
  // Check KV to avoid duplicate sends within the same day window
  const key = `nonpay_notif:${user.id}:${type}`;
  const already = await env.KV.get(key).catch(() => null);
  if (already) return;
  await env.KV.put(key, '1', { expirationTtl: 86400 * 100 }).catch(() => {});

  await logReminder(env, user.id, user.billing_id, type, day);

  const amount     = (user.total_charged || 0).toFixed(2);
  const payUrl     = 'https://app.datadrop.co.in/settings?tab=billing';
  const daysLeft   = 35 - day;

  let subject, html;

  if (day === 1) {
    subject = 'DataDrop: Your automatic payment could not be completed';
    html = `
      <div style="font-family:sans-serif;max-width:500px;color:#111">
        <h2 style="color:#111">Payment Required — ₹${amount}</h2>
        <p>Hi ${user.display_name},</p>
        <p>Your DataDrop AutoPay for <strong>${user.month}</strong> could not be completed. Your account is now in <strong>Payment Recovery Mode</strong>.</p>
        <ul>
          <li>✅ You can still browse, download, preview, and delete your files.</li>
          <li>❌ Uploading new files and creating folders is paused.</li>
        </ul>
        <p>We will retry automatically every 24 hours. Or you can pay manually:</p>
        <a href="${payUrl}" style="display:inline-block;background:#DC2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px">Pay ₹${amount} Now</a>
        <p style="margin-top:16px;color:#888;font-size:12px">You have <strong>${daysLeft} days</strong> before your data is permanently deleted. Please resolve this as soon as possible.</p>
      </div>`;
  } else if (day === 7) {
    subject = 'DataDrop: Payment still outstanding — 28 days remaining';
    html = `
      <div style="font-family:sans-serif;max-width:500px;color:#111">
        <h2 style="color:#111">Outstanding: ₹${amount} · 7 days overdue</h2>
        <p>Hi ${user.display_name},</p>
        <p>Your DataDrop payment of <strong>₹${amount}</strong> is still outstanding. You have <strong>${daysLeft} days</strong> to pay before your data is permanently deleted.</p>
        <p>Your files are safe. We are retrying AutoPay every 24 hours.</p>
        <a href="${payUrl}" style="display:inline-block;background:#DC2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px">Resolve payment →</a>
      </div>`;
  } else if (day === 14) {
    subject = 'DataDrop: 3 weeks to recover your account — ₹' + amount + ' due';
    html = `
      <div style="font-family:sans-serif;max-width:500px;color:#111">
        <h2 style="color:#111">Outstanding: ₹${amount} · 14 days overdue</h2>
        <p>Hi ${user.display_name},</p>
        <p>Your DataDrop payment is 14 days overdue. You have <strong>${daysLeft} days</strong> left before all your data is permanently and irrecoverably deleted.</p>
        <a href="${payUrl}" style="display:inline-block;background:#DC2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px">Pay ₹${amount} Now</a>
        <p style="color:#888;font-size:12px">Alternatively, set up a new AutoPay mandate so we can retry automatically.</p>
      </div>`;
  } else if (day === 21) {
    subject = 'DataDrop: 14 days remaining before data deletion';
    html = `
      <div style="font-family:sans-serif;max-width:500px;color:#111">
        <h2 style="color:#DC2626">⚠ 14 Days Until Permanent Deletion</h2>
        <p>Hi ${user.display_name},</p>
        <p>Your DataDrop payment of <strong>₹${amount}</strong> has been outstanding for 21 days. <strong>Your files will be permanently deleted in 14 days</strong> if not resolved.</p>
        <a href="${payUrl}" style="display:inline-block;background:#DC2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px">Resolve now to keep your files →</a>
        <p style="color:#888;font-size:12px">Files deleted after non-payment cannot be recovered under any circumstances.</p>
      </div>`;
  } else if (day === 30) {
    subject = 'DataDrop: FINAL WARNING — 5 days until permanent deletion';
    html = `
      <div style="font-family:sans-serif;max-width:500px;color:#111">
        <h2 style="color:#DC2626">🚨 5 Days Until Permanent Deletion</h2>
        <p>Hi ${user.display_name},</p>
        <p>This is your final warning. Your DataDrop payment of <strong>₹${amount}</strong> has been outstanding for 30 days. <strong style="color:#DC2626">All your files will be permanently and irrecoverably deleted in 5 days.</strong></p>
        <a href="${payUrl}" style="display:inline-block;background:#DC2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px">Pay Immediately →</a>
      </div>`;
  } else if (day === 34) {
    subject = 'DataDrop: Your data will be deleted TOMORROW — pay now or set up AutoPay';
    html = `
      <div style="font-family:sans-serif;max-width:500px;color:#111">
        <h2 style="color:#DC2626">⛔ Last Chance — Data Deleted Tomorrow</h2>
        <p>Hi ${user.display_name},</p>
        <p><strong style="color:#DC2626">Your DataDrop data will be permanently deleted tomorrow</strong> unless you pay ₹${amount} by end of day.</p>
        <p>You can pay instantly via UPI, card, or net banking — or set up a new AutoPay mandate:</p>
        <a href="${payUrl}" style="display:inline-block;background:#DC2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px">Scan & Pay ₹${amount} Now →</a>
        <p style="color:#888;font-size:12px">After deletion, your data cannot be recovered. This is your last opportunity.</p>
      </div>`;
  }

  if (subject && html) {
    await sendEmail(env, { to: user.email, subject, html }).catch(() => {});
  }
}

async function logReminder(env, userId, billingId, type, day) {
  try {
    await env.DB.prepare(
      'INSERT INTO billing_reminders (id, user_id, billing_id, type, reminder_day, sent_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID().replace(/-/g,'').slice(0,16),
      userId, billingId || null, type, day, Date.now()
    ).run();
  } catch (_) {}
}

async function permanentlyDeleteUser(env, user) {
  const now = Date.now();

  // Cancel active mandate on Razorpay
  try {
    if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
      const mandate = await env.DB.prepare(
        "SELECT id, razorpay_customer_id, razorpay_token_id FROM wallet_mandates WHERE user_id = ? AND is_active = 1 LIMIT 1"
      ).bind(user.id).first();
      if (mandate?.razorpay_token_id && mandate?.razorpay_customer_id) {
        const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
        await fetch(`https://api.razorpay.com/v1/customers/${mandate.razorpay_customer_id}/tokens/${mandate.razorpay_token_id}`,
          { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } }).catch(() => {});
        await env.DB.prepare(
          "UPDATE wallet_mandates SET is_active = 0, status = 'cancelled', cancelled_at = ? WHERE id = ?"
        ).bind(now, mandate.id).run();
      }
    }
  } catch (_) {}

  // Mark invoice as unrecoverable
  await env.DB.prepare(
    "UPDATE billing SET last_failure_reason = 'UNRECOVERABLE - deleted after 35 days', next_retry_at = NULL, updated_at = ? WHERE user_id = ? AND status = 'failed'"
  ).bind(now, user.id).run();

  await env.DB.prepare("UPDATE files SET deleted_at = ?, trash_expires_at = ? WHERE user_id = ? AND deleted_at IS NULL").bind(now, now, user.id).run();
  await env.DB.prepare("UPDATE folders SET deleted_at = ? WHERE user_id = ? AND deleted_at IS NULL").bind(now, user.id).run();
  await env.DB.prepare("UPDATE users SET status = 'deleted', deleted_at = ? WHERE id = ?").bind(now, user.id).run();
  await env.QUEUE.send({ type: 'DELETE_USER_DATA', userId: user.id });

  await logReminder(env, user.id, null, 'deleted', 35);
  await sendEmail(env, {
    to: user.email,
    subject: 'DataDrop: Your account has been closed',
    html: `<p>Hi ${user.display_name},</p>
           <p>Due to 35 days of non-payment, your DataDrop account has been permanently closed and all data has been deleted.</p>
           <p>If you believe this is an error, contact us at support@datadrop.co.in.</p>`,
  });
}

// ---------- Email helpers ----------
async function sendPaymentFailedEmail(env, user, amount, month, daysOverdue) {
  const payUrl = 'https://app.datadrop.co.in/settings?tab=billing';
  await sendEmail(env, {
    to: user.email,
    subject: 'DataDrop: Automatic payment could not be completed',
    html: `
      <div style="font-family:sans-serif;max-width:500px;color:#111">
        <h2 style="color:#111">Payment Required — ₹${amount.toFixed(2)}</h2>
        <p>Hi ${user.display_name},</p>
        <p>Your DataDrop bill for <strong>${month}</strong> is ₹${amount.toFixed(2)}, but your AutoPay could not be processed.</p>
        <p>Your account is now in Payment Recovery Mode:</p>
        <ul>
          <li>✅ You can still browse, download, and preview all your files</li>
          <li>✅ You can delete files to free space</li>
          <li>❌ Uploading new files is paused until payment is resolved</li>
        </ul>
        <p>We will retry AutoPay every 24 hours. Or pay now instantly:</p>
        <a href="${payUrl}" style="display:inline-block;background:#DC2626;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;margin-top:8px">Pay ₹${amount.toFixed(2)} Now</a>
        <p style="color:#888;font-size:12px">You have 35 days to resolve this before permanent deletion.</p>
      </div>`,
  });
}

async function sendAccountRestoredEmail(env, user, amount, month) {
  await sendEmail(env, {
    to: user.email,
    subject: 'DataDrop: Payment received — account fully restored',
    html: `
      <div style="font-family:sans-serif;max-width:500px;color:#111">
        <h2 style="color:#1d6f42">✅ Payment Received</h2>
        <p>Hi ${user.display_name},</p>
        <p>Your DataDrop payment of <strong>₹${amount.toFixed(2)}</strong> for <strong>${month}</strong> has been received. Your account has been fully restored.</p>
        <p>All features including file uploads are now available again.</p>
        <p style="color:#888;font-size:12px">Thank you for using DataDrop.</p>
      </div>`,
  });
}

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
        <tr><td style="padding:8px;font-weight:bold">Total charged via AutoPay</td>
            <td style="padding:8px;font-weight:bold;text-align:right">₹${totalAmount.toFixed(2)}</td></tr>
      </table>
      <p style="color:#888;font-size:12px">DataDrop — datadrop.co.in</p>
    `,
  });
}

// ---------- Bill preview (read-only) ----------
export async function runBillPreview(env) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (tomorrow.getUTCDate() !== 1) return;

  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const config = await loadBillingConfig(env);

  const { results: users } = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.wallet_balance, u.adfree_active, u.adfree_locked_price
     FROM users u WHERE u.status = 'active' ORDER BY u.id LIMIT 5000`
  ).all();

  for (const user of users) {
    try {
      const key = `preview_sent:${user.id}:${month}`;
      const already = await env.KV.get(key);
      if (already) continue;

      const usageRow = await env.DB.prepare(
        'SELECT accumulated_byte_seconds, billing_month, current_bytes, last_updated_at FROM storage_usage WHERE user_id = ?'
      ).bind(user.id).first();

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
          <p>Your DataDrop month ends today. Estimated bill — collected via UPI AutoPay tomorrow.</p>
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

export { runBilling as billingScheduled };
