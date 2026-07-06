// ============================================================
// DataDrop — Razorpay Webhook Handler
// POST /webhook/razorpay
// Events: payment.captured, payment.failed, order.paid
// Verifies HMAC-SHA256 signature before processing
// ============================================================

import { sendEmail } from '../shared/utils.js';

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
  return hex === signature;
}
