// ============================================================
// DataDrop — Clerk Webhook Handler
// POST /webhook/clerk
// Events: user.created, user.updated, user.deleted
//
// Auth flow:
//   Login  → Clerk (email / Google OAuth) — free tier
//   Phone  → MSG91 OTP widget, one-time at signup only
//             Stored in D1 users.phone (unique constraint)
//             Enforces one trial per real phone number
//             NOT used for login — only for trial gate
// ============================================================

import { sendEmail, newId, getConfigNum } from '../shared/utils.js';

export async function handleClerkWebhook(request, env) {
  const svixId        = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing svix headers', { status: 400 });
  }

  const body    = await request.text();
  const isValid = await verifySvix(body, svixId, svixTimestamp, svixSignature, env.CLERK_WEBHOOK_SECRET);
  if (!isValid) return new Response('Invalid signature', { status: 401 });

  const { type, data } = JSON.parse(body);

  try {
    if (type === 'user.created') await handleUserCreated(data, env);
    if (type === 'user.updated') await handleUserUpdated(data, env);
    if (type === 'user.deleted') await handleUserDeleted(data, env);
    return new Response('OK', { status: 200 });
  } catch (_) {
    return new Response('Internal error', { status: 500 });
  }
}

// ---------- Also handle MSG91 phone verification callback ----------
// POST /webhook/msg91-otp
// Called by MSG91 after user verifies phone OTP in widget
export async function handleMsg91Webhook(request, env) {
  // MSG91 sends a POST with JSON body after OTP verified
  const body = await request.json();

  // MSG91 widget callback format:
  // { requestId, mobile, type: 'success'|'fail', ... }
  if (body.type !== 'success' && body.status !== 'success') {
    return new Response('OK', { status: 200 }); // ignore failures
  }

  const phone   = normalisePhone(body.mobile || body.phone || '');
  const userId  = body.userId || body.user_id; // passed as custom param in widget init

  if (!phone || !userId) {
    return new Response('OK', { status: 200 });
  }

  // Check if this phone is already registered (one trial per number)
  const existing = await env.DB.prepare(
    'SELECT id, status FROM users WHERE phone = ?'
  ).bind(phone).first();

  if (existing && existing.id !== userId) {
    // Phone already used on a different account — mark this user as duplicate
    await env.DB.prepare(
      "UPDATE users SET status = 'suspended', suspension_reason = 'Duplicate phone number — one trial per device' WHERE id = ?"
    ).bind(userId).run();

    // Invalidate KV session
    await env.KV.delete(`phone_pending:${userId}`);

    return new Response('OK', { status: 200 });
  }

  // Store verified phone
  await env.DB.prepare(
    'UPDATE users SET phone = ?, trial_phone_verified = 1, updated_at = ? WHERE id = ?'
  ).bind(phone, Date.now(), userId).run();

  // Mark phone verification complete in KV so frontend can poll
  await env.KV.put(`phone_verified:${userId}`, '1', { expirationTtl: 300 });

  return new Response('OK', { status: 200 });
}

// ---------- Poll endpoint — frontend polls this after MSG91 widget completes ----------
// GET /webhook/phone-status?userId=xxx
export async function handlePhoneStatus(request, env) {
  const url    = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return Response.json({ verified: false });

  const verified = await env.KV.get(`phone_verified:${userId}`);
  if (verified) {
    await env.KV.delete(`phone_verified:${userId}`);
    return Response.json({ verified: true });
  }
  return Response.json({ verified: false });
}

// ---------- Clerk user.created ----------
async function handleUserCreated(data, env) {
  const email       = data.email_addresses?.[0]?.email_address;
  const clerkUserId = data.id;
  const firstName   = data.first_name || '';
  const lastName    = data.last_name  || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || email?.split('@')[0] || 'User';
  const avatarUrl   = data.image_url || null;

  if (!email || !clerkUserId) return;

  // Generate unique username from email prefix
  const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 20);
  const username     = await uniqueUsername(env, baseUsername);

  const trialDays   = await getConfigNum(env, 'trial_days') || 7;
  const trialEndsAt = Date.now() + trialDays * 86400000;
  const userId      = newId();

  await env.DB.prepare(`
    INSERT INTO users (
      id, clerk_user_id, email, display_name, username,
      status, trial_ends_at, wallet_balance, wallet_limit,
      trial_phone_verified, avatar_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'trial', ?, 0, 0, 0, ?, ?, ?)
    ON CONFLICT(clerk_user_id) DO NOTHING
  `).bind(
    userId, clerkUserId, email, displayName, username,
    trialEndsAt, avatarUrl, Date.now(), Date.now()
  ).run();

  // Init storage counter
  await env.KV.put(`storage:${userId}`, '0');

  // Welcome email
  await sendEmail(env, {
    to: email,
    subject: 'Welcome to DataDrop — verify your phone to start your free trial',
    html: welcomeEmail(displayName, trialDays),
  });

}

async function handleUserUpdated(data, env) {
  const email     = data.email_addresses?.[0]?.email_address;
  const avatarUrl = data.image_url || null;
  if (!email) return;
  await env.DB.prepare(
    'UPDATE users SET email = ?, avatar_url = ?, updated_at = ? WHERE clerk_user_id = ?'
  ).bind(email, avatarUrl, Date.now(), data.id).run();
}

async function handleUserDeleted(data, env) {
  await env.DB.prepare(
    "UPDATE users SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE clerk_user_id = ?"
  ).bind(Date.now(), Date.now(), data.id).run();
}

// ---------- Helpers ----------
async function uniqueUsername(env, base) {
  let candidate = base, suffix = 0;
  while (true) {
    const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(candidate).first();
    if (!existing) return candidate;
    candidate = `${base}${++suffix}`;
  }
}

function normalisePhone(raw) {
  // Ensure E.164 format with India default (+91)
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.startsWith('91') || digits.startsWith('+91')) return `+91${digits.replace(/^(\+?91)/, '')}`;
  return `+${digits}`;
}

async function verifySvix(body, svixId, svixTimestamp, svixSignature, secret) {
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const secretBytes   = Uint8Array.from(atob(secret.replace('whsec_', '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const computed = 'v1,' + btoa(String.fromCharCode(...new Uint8Array(sig)));
  return svixSignature.split(' ').some(s => s === computed);
}

function welcomeEmail(name, trialDays) {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;color:#111">
    <h1 style="font-size:24px;font-weight:700;margin-bottom:8px">Welcome to DataDrop</h1>
    <p style="color:#555;margin-bottom:24px">One last step — verify your phone number to activate your ${trialDays}-day free trial.</p>
    <a href="https://app.datadrop.co.in/verify-phone"
       style="display:inline-block;background:#000;color:#fff;padding:14px 28px;
              text-decoration:none;border-radius:6px;font-weight:600">
      Verify phone number →
    </a>
    <p style="margin-top:32px;color:#888;font-size:13px">
      This is a one-time step to keep DataDrop free of abuse. Your phone number is never shared or used for marketing.
    </p>
  </div>`;
}
