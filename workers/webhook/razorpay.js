// ============================================================
// DataDrop — Razorpay Webhook Handler
// POST /webhook/razorpay
// Events: payment.captured, payment.failed, order.paid
// Verifies HMAC-SHA256 signature before processing
// ============================================================

import { sendEmail, safeCompare } from '../shared/utils.js';

export async function handleRazorpayWebhook(request, env) {
  const body      = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!signature) return new Response('Missing signature', { status: 400 });

  // Verify signature
  const isValid = await verifyRazorpayWebhook(body, signature, env.RAZORPAY_KEY_SECRET);
  if (!isValid) return new Response('Invalid signature', { status: 401 });

  const event = JSON.parse(body);
  const { event: eventType, payload } = event;

  try {
    if (eventType === 'payment.captured') await onPaymentCaptured(payload, env);
    if (eventType === 'payment.failed')   await onPaymentFailed(payload, env);
    return new Response('OK', { status: 200 });
  } catch (_) {
    return new Response('Error', { status: 500 });
  }
}

async function onPaymentCaptured(payload, env) {
  const payment = payload.payment?.entity;
  if (!payment) return;

  const orderId   = payment.order_id;
  const paymentId = payment.id;
  const amountRs  = payment.amount / 100;
  const notes     = payment.notes || {};

  // Idempotency: skip if already processed (billing pre-credit or prior webhook delivery) (HIGH-4)
  const alreadyProcessed = await env.KV.get(`webhook_pay:${paymentId}`).catch(() => null);
  if (alreadyProcessed) return;
  await env.KV.put(`webhook_pay:${paymentId}`, 'webhook', { expirationTtl: 7 * 86400 }).catch(() => {});

  // Mandate setup backup activation — if confirmMandate was called before capture
  if (notes.type === 'mandate_setup') {
    const userId = notes.userId;
    if (!userId) return;
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE wallet_mandates SET status = 'active', is_active = 1, activated_at = ? WHERE user_id = ? AND status = 'created' AND razorpay_mandate_id = ?"
      ).bind(now, userId, orderId),
      env.DB.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'trial'")
        .bind(now, userId),
    ]);
    return;
  }

  // Mandate upgrade — webhook fallback for when confirmUpgradeMandate wasn't called
  if (notes.type === 'mandate_upgrade') {
    const userId = notes.userId;
    if (!userId) return;

    const newMandate = await env.DB.prepare(
      "SELECT id, razorpay_customer_id, protection_limit FROM wallet_mandates WHERE user_id = ? AND razorpay_mandate_id = ? AND status = 'created' AND is_active = 0"
    ).bind(userId, orderId).first();
    // If already activated (confirmUpgradeMandate beat us), nothing to do
    if (!newMandate) return;

    const oldMandate = await env.DB.prepare(
      "SELECT id FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1"
    ).bind(userId).first();

    // Fetch newest UPI token for the customer
    const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    let tokenId = null;
    if (newMandate.razorpay_customer_id) {
      const tokensResp = await fetch(
        `https://api.razorpay.com/v1/customers/${newMandate.razorpay_customer_id}/tokens`,
        { headers: { Authorization: `Basic ${auth}` } }
      ).catch(() => null);
      if (tokensResp?.ok) {
        const tokensData = await tokensResp.json().catch(() => ({}));
        const upiTokens = (tokensData.items || []).filter(t => t.method === 'upi' && t.recurring === true);
        upiTokens.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        tokenId = upiTokens[0]?.id || null;
      }
    }

    const now = Date.now();

    // Optimistic lock on old mandate — same concurrency protection as confirmUpgradeMandate
    if (oldMandate) {
      const supersedeResult = await env.DB.prepare(
        "UPDATE wallet_mandates SET status = 'cancelled', is_active = 0, superseded_at = ? WHERE id = ? AND is_active = 1"
      ).bind(now, oldMandate.id).run();
      // If 0 changes, another process (confirmUpgradeMandate) already won — skip
      if (supersedeResult.meta.changes !== 1) return;
    }

    // Activate new mandate + update wallet
    // Old token stays alive — cleanup worker cancels it after the grace period
    await env.DB.batch([
      env.DB.prepare("UPDATE wallet_mandates SET status = 'active', is_active = 1, activated_at = ?, razorpay_token_id = ? WHERE id = ?")
        .bind(now, tokenId, newMandate.id),
      env.DB.prepare('UPDATE users SET wallet_balance = wallet_balance + 1, wallet_limit = ?, updated_at = ? WHERE id = ?')
        .bind(newMandate.protection_limit, now, userId),
    ]);
    return;
  }

  // Billing charge confirmed — credit wallet and restore read-only accounts
  if (notes.type === 'billing_charge') {
    const userId = notes.userId;
    if (!userId) return;
    await env.DB.prepare(
      "UPDATE users SET wallet_balance = wallet_balance + ?, updated_at = ? WHERE id = ?"
    ).bind(amountRs, Date.now(), userId).run();
    await env.DB.prepare(
      "UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'read_only'"
    ).bind(Date.now(), userId).run();
    return;
  }

  // Wallet top-up
  if (notes.type === 'wallet_topup') {
    const userId    = notes.userId;
    const setAsLimit = notes.setAsLimit === 'true';

    if (!userId) return;

    const updates = ['wallet_balance = wallet_balance + ?', 'updated_at = ?'];
    const binds   = [amountRs, Date.now()];
    if (setAsLimit) { updates.push('wallet_limit = ?'); binds.push(amountRs); }
    binds.push(userId);

    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();

    // Send receipt
    const user = await env.DB.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(userId).first();
    if (user) {
      await sendEmail(env, {
        to: user.email,
        subject: `DataDrop: ₹${amountRs.toFixed(2)} added to your wallet`,
        html: `<p>Hi ${user.display_name},</p>
               <p>₹${amountRs.toFixed(2)} has been added to your DataDrop wallet.</p>
               <p>Payment ID: ${paymentId}</p>`,
      });
    }
    return;
  }

  // Monthly billing payment
  if (notes.billingId) {
    await env.DB.prepare(`
      UPDATE billing SET status = 'paid', razorpay_payment_id = ?, billing_date = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).bind(paymentId, Date.now(), Date.now(), notes.billingId).run();

    // Restore account if it was read_only
    const billing = await env.DB.prepare('SELECT user_id FROM billing WHERE id = ?').bind(notes.billingId).first();
    if (billing) {
      await env.DB.prepare(
        "UPDATE users SET status = 'active', wallet_balance = wallet_limit, updated_at = ? WHERE id = ? AND status = 'read_only'"
      ).bind(Date.now(), billing.user_id).run();
    }
  }
}


async function onPaymentFailed(payload, env) {
  const payment = payload.payment?.entity;
  if (!payment) return;

  const notes = payment.notes || {};
  if (notes.billingId) {
    await env.DB.prepare(`
      UPDATE billing SET status = 'failed', failure_reason = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).bind(payment.error_description || 'Payment failed', Date.now(), notes.billingId).run();
  }
}

async function verifyRazorpayWebhook(body, signature, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return safeCompare(hex, signature);
}
