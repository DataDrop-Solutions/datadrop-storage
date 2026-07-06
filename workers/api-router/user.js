// ============================================================
// DataDrop — User Handler
// GET  /user/me              → profile + wallet + usage
// PUT  /user/me              → update display name / username
// GET  /user/wallet          → wallet details
// POST /user/wallet/topup    → initiate Razorpay top-up
// POST /user/wallet/confirm  → confirm top-up payment
// POST /user/adfree/subscribe  → subscribe to ad-free video
// DELETE /user/adfree         → cancel ad-free
// POST /user/otp/send        → send OTP via MSG91 REST API
// POST /user/otp/verify      → verify OTP and mark phone verified
// ============================================================

import { corsResponse, handleOptions, validateSession, getStorageBytes, bytesToGb, calcStorageCost, checkApiRateLimit, loadBillingConfig, computeBillSoFar, computeProjectedBill } from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

    if (!(await checkApiRateLimit(env, session.userId))) {
      return corsResponse({ error: 'Too many requests' }, 429);
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace('/user', '');

    try {
      if (path === '/me' && request.method === 'GET')  return await getMe(env, session);
      if (path === '/me' && request.method === 'PUT')  return await updateMe(request, env, session);
      if (path === '/wallet' && request.method === 'GET')  return await getWallet(env, session);
      if (path === '/wallet/topup' && request.method === 'POST')    return await initiateTopup(request, env, session);
      if (path === '/wallet/confirm' && request.method === 'POST')  return await confirmTopup(request, env, session);
      if (path === '/adfree/subscribe' && request.method === 'POST') return await subscribeAdFree(env, session);
      if (path === '/adfree' && request.method === 'DELETE')         return await cancelAdFree(env, session);
      if (path === '/storage' && request.method === 'GET')           return await getStorageMeter(env, session);
      if (path === '/storage/breakdown' && request.method === 'GET') return await getStorageBreakdown(env, session);
      if (path === '/me/delete'    && request.method === 'POST') return await requestDeletion(env, session);
      if (path === '/otp/send'     && request.method === 'POST') return await sendOtp(request, env, session);
      if (path === '/otp/verify'   && request.method === 'POST') return await verifyOtp(request, env, session);
      return corsResponse({ error: 'Not found' }, 404);
    } catch (_) {
      return corsResponse({ error: 'Internal error' }, 500);
    }
  },
};

// ---------- Profile ----------
async function getMe(env, session) {
  const user = await env.DB.prepare(`
    SELECT id, email, display_name, username, username_changed_at, avatar_url,
           status, wallet_balance, wallet_limit, wallet_next_bill_date,
           trial_ends_at, trial_phone_verified, adfree_active, adfree_locked_price, adfree_since,
           public_key, created_at
    FROM users WHERE id = ?
  `).bind(session.userId).first();

  if (!user) return corsResponse({ error: 'User not found' }, 404);

  // Real-time usage from KV
  const storageBytes = await getStorageBytes(env, session.userId);
  const storageGb    = bytesToGb(storageBytes);
  const estimatedCost = await calcStorageCost(env, storageGb);

  return corsResponse({
    user: {
      ...user,
      // Never expose internal IDs or crypto material
      vault_pin_hash: undefined,
      vault_salt: undefined,
      vault_phrase_salt: undefined,
      vault_encrypted_key: undefined,
    },
    usage: {
      storageBytes,
      storageGb,
      estimatedMonthlyCost: estimatedCost,
    },
  });
}

async function updateMe(request, env, session) {
  const { displayName, username } = await request.json();

  const user = await env.DB.prepare(
    'SELECT display_name, username, username_changed_at FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (!user) return corsResponse({ error: 'User not found' }, 404);

  const updates = ['updated_at = ?'];
  const binds   = [Date.now()];

  if (displayName !== undefined) {
    if (!displayName.trim()) return corsResponse({ error: 'Display name cannot be empty' }, 400);
    updates.push('display_name = ?');
    binds.push(displayName.trim());
  }

  if (username !== undefined) {
    // Enforce 90-day change limit
    if (user.username_changed_at) {
      const daysSinceChange = (Date.now() - user.username_changed_at) / 86400000;
      if (daysSinceChange < 90) {
        return corsResponse({
          error: 'Username can only be changed once every 90 days',
          nextChangeAt: user.username_changed_at + 90 * 86400000,
        }, 429);
      }
    }

    const handle = username.startsWith('@') ? username.slice(1) : username;
    if (!/^[a-z0-9_]{3,30}$/.test(handle)) {
      return corsResponse({ error: 'Username must be 3-30 characters: letters, numbers, underscores only' }, 400);
    }

    // Check uniqueness
    const existing = await env.DB.prepare(
      'SELECT id FROM users WHERE username = ? AND id != ?'
    ).bind(handle, session.userId).first();
    if (existing) return corsResponse({ error: 'Username already taken' }, 409);

    updates.push('username = ?', 'username_changed_at = ?');
    binds.push(handle, Date.now());
  }

  binds.push(session.userId);
  await env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...binds).run();

  // Invalidate session cache
  await env.KV.delete(`session:${session.userId}`);

  return corsResponse({ success: true });
}

// ---------- Wallet ----------
async function getWallet(env, session) {
  const user = await env.DB.prepare(
    'SELECT wallet_balance, wallet_limit, wallet_next_bill_date, status FROM users WHERE id = ?'
  ).bind(session.userId).first();

  const storageBytes = await getStorageBytes(env, session.userId);
  const storageGb    = bytesToGb(storageBytes);
  const estimatedCost = await calcStorageCost(env, storageGb);

  // Billing history
  const { results: history } = await env.DB.prepare(
    'SELECT month, actual_usage_gb, total_charged, status FROM billing WHERE user_id = ? ORDER BY month DESC LIMIT 6'
  ).bind(session.userId).all();

  return corsResponse({
    balance:   user.wallet_balance,
    limit:     user.wallet_limit,
    nextBill:  user.wallet_next_bill_date,
    estimatedCost,
    storageGb,
    history,
  });
}

// ---------- Top-up ----------
async function initiateTopup(request, env, session) {
  const { amount, setAsLimit = false } = await request.json();

  if (!amount || amount < 1) return corsResponse({ error: 'Minimum top-up is ₹1' }, 400);
  if (amount > 100000) return corsResponse({ error: 'Maximum single top-up is ₹1,00,000' }, 400);

  const amountPaise = Math.round(amount * 100);
  const auth        = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  const user = await env.DB.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(session.userId).first();

  const resp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount:   amountPaise,
      currency: 'INR',
      receipt:  `tp_${session.userId.slice(0, 16)}_${Date.now().toString(36)}`,
      notes:    { userId: session.userId, type: 'wallet_topup', setAsLimit: String(setAsLimit) },
    }),
  });

  if (!resp.ok) return corsResponse({ error: 'Payment initiation failed' }, 502);

  const order = await resp.json();

  return corsResponse({
    orderId:    order.id,
    amount:     order.amount,
    currency:   order.currency,
    key:        env.RAZORPAY_KEY_ID,
    prefill: {
      name:  user?.display_name,
      email: user?.email,
    },
  });
}

async function confirmTopup(request, env, session) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, amount, setAsLimit } = await request.json();

  // Verify Razorpay signature
  const isValid = await verifyRazorpaySignature(
    razorpayOrderId, razorpayPaymentId, razorpaySignature, env.RAZORPAY_KEY_SECRET
  );

  if (!isValid) return corsResponse({ error: 'Payment verification failed' }, 400);

  const amountRs = amount / 100;

  // Credit wallet
  const updates  = ['wallet_balance = wallet_balance + ?', 'updated_at = ?'];
  const binds    = [amountRs, Date.now()];

  if (setAsLimit) {
    updates.push('wallet_limit = ?');
    binds.push(amountRs);
  }

  binds.push(session.userId);
  await env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...binds).run();

  return corsResponse({ success: true, creditedAmount: amountRs });
}

// ---------- Ad-free subscription ----------
async function subscribeAdFree(env, session) {
  const user = await env.DB.prepare(
    'SELECT adfree_active, wallet_balance FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (user?.adfree_active) return corsResponse({ error: 'Already subscribed to ad-free' }, 409);

  // Price locked at signup time from config
  const { getConfigNum } = await import('../shared/utils.js');
  const price = await getConfigNum(env, 'price_adfree_monthly');

  if (user.wallet_balance < price) {
    return corsResponse({ error: 'Insufficient wallet balance', required: price }, 402);
  }

  const now = Date.now();
  await env.DB.prepare(`
    UPDATE users
    SET adfree_active = 1, adfree_locked_price = ?, adfree_since = ?, wallet_balance = wallet_balance - ?, updated_at = ?
    WHERE id = ?
  `).bind(price, now, price, now, session.userId).run();

  return corsResponse({ success: true, lockedPrice: price });
}

async function cancelAdFree(env, session) {
  await env.DB.prepare(
    'UPDATE users SET adfree_active = 0, updated_at = ? WHERE id = ?'
  ).bind(Date.now(), session.userId).run();
  return corsResponse({ success: true });
}

// ---------- Live storage meter ----------
async function getStorageMeter(env, session) {
  // Always recompute from D1 truth to fix any KV drift, then update KV
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(size_bytes), 0) as total FROM files WHERE user_id = ? AND deleted_at IS NULL'
  ).bind(session.userId).first();
  const storageBytes = row?.total || 0;
  try { await env.KV.put(`storage:${session.userId}`, String(storageBytes)); } catch (_) {}
  const storageGb     = bytesToGb(storageBytes);
  const estimatedCost = await calcStorageCost(env, storageGb);

  const [user, usageRow, config] = await Promise.all([
    env.DB.prepare('SELECT wallet_balance, wallet_limit, status, trial_ends_at FROM users WHERE id = ?').bind(session.userId).first(),
    env.DB.prepare('SELECT accumulated_byte_seconds, billing_month, current_bytes, last_updated_at FROM storage_usage WHERE user_id = ?').bind(session.userId).first(),
    loadBillingConfig(env),
  ]);

  const isTrial  = user?.status === 'trial';
  const TRIAL_GB = 5;
  const maxGb    = isTrial ? TRIAL_GB : null;

  const usedPercent = isTrial
    ? Math.min(100, (storageGb / TRIAL_GB) * 100)
    : (user?.wallet_limit > 0 ? Math.min(100, (estimatedCost / user.wallet_limit) * 100) : 0);

  const bill_so_far    = computeBillSoFar(usageRow, config);
  const projected_bill = computeProjectedBill(usageRow, config);

  return corsResponse({
    storageBytes,
    storageGb,
    estimatedCost,
    walletBalance: user?.wallet_balance,
    walletLimit:   user?.wallet_limit,
    usedPercent,
    maxGb,
    status:        user?.status,
    trialEndsAt:   user?.trial_ends_at,
    bill_so_far,
    projected_bill,
  });
}

// ---------- Storage breakdown ----------
async function getStorageBreakdown(env, session) {
  const uid = session.userId;

  // Personal storage (files NOT in any team)
  const personalRow = await env.DB.prepare(
    'SELECT COALESCE(SUM(size_bytes),0) as bytes FROM files WHERE user_id = ? AND team_id IS NULL AND deleted_at IS NULL'
  ).bind(uid).first();
  const personalBytes = personalRow?.bytes || 0;
  const personalGb    = bytesToGb(personalBytes);
  const personalCost  = await calcStorageCost(env, personalGb);

  // Teams the user belongs to (as owner or active member)
  const { results: ownedTeams } = await env.DB.prepare(
    "SELECT id, name FROM teams WHERE owner_id = ?"
  ).bind(uid).all();

  const { results: joinedTeams } = await env.DB.prepare(
    "SELECT t.id, t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id = ? AND tm.status = 'active' AND t.owner_id != ?"
  ).bind(uid, uid).all();

  const allTeams = [...ownedTeams, ...joinedTeams];
  const teamBreakdown = [];

  for (const team of allTeams) {
    // For each team, count bytes from files uploaded by THIS user within that team
    const teamRow = await env.DB.prepare(
      'SELECT COALESCE(SUM(size_bytes),0) as bytes, COUNT(*) as file_count FROM files WHERE user_id = ? AND team_id = ? AND deleted_at IS NULL'
    ).bind(uid, team.id).first();
    const teamBytes = teamRow?.bytes || 0;
    const teamGb    = bytesToGb(teamBytes);
    const teamCost  = await calcStorageCost(env, teamGb);

    teamBreakdown.push({
      teamId:    team.id,
      teamName:  team.name,
      fileCount: teamRow?.file_count || 0,
      storageBytes: teamBytes,
      storageGb:    teamGb,
      estimatedCost: teamCost,
    });
  }

  const totalBytes = personalBytes + teamBreakdown.reduce((sum, t) => sum + t.storageBytes, 0);
  const totalGb    = bytesToGb(totalBytes);
  const totalCost  = await calcStorageCost(env, totalGb);

  return corsResponse({
    personal: { storageBytes: personalBytes, storageGb: personalGb, estimatedCost: personalCost },
    teams: teamBreakdown,
    total: { storageBytes: totalBytes, storageGb: totalGb, estimatedCost: totalCost },
  });
}

// ---------- Helpers ----------
async function verifyRazorpaySignature(orderId, paymentId, signature, keySecret) {
  const body = `${orderId}|${paymentId}`;
  const key  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(keySecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hex === signature;
}

// ---------- Account deletion ----------
async function requestDeletion(env, session) {
  const user = await env.DB.prepare(
    'SELECT email, display_name, wallet_balance FROM users WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return corsResponse({ error: 'User not found' }, 404);

  // Schedule deletion: mark as pending_deletion, actual deletion runs in 7 days
  // (gives user time to cancel, aligns with refund window)
  const deletionAt = Date.now() + 7 * 86400000;

  await env.DB.prepare(
    "UPDATE users SET status = 'pending_deletion', deletion_scheduled_at = ?, updated_at = ? WHERE id = ?"
  ).bind(deletionAt, Date.now(), session.userId).run();

  // Queue data deletion after 7 days via a KV flag (trial worker checks this)
  await env.KV.put(`pending_deletion:${session.userId}`, '1', {
    expirationTtl: 7 * 86400 + 3600, // 7 days + buffer
  });

  await sendEmail(env, {
    to: user.email,
    subject: 'DataDrop: Account deletion scheduled',
    html: `<p>Hi ${user.display_name},</p>
           <p>Your DataDrop account is scheduled for deletion in 7 days.</p>
           <p>All your files and data will be permanently deleted on ${new Date(deletionAt).toLocaleDateString('en-IN')}.</p>
           ${user.wallet_balance > 50
             ? `<p>Your wallet balance of ₹${user.wallet_balance.toFixed(2)} will be refunded within 7 business days.</p>`
             : ''}
           <p>To cancel this deletion, contact us at datadrop.contact@gmail.com within 7 days.</p>`,
  });

  return corsResponse({ success: true, deletionScheduledAt: deletionAt });
}

// ---------- OTP: send (Firebase handles sending on client — this is a no-op) ----------
async function sendOtp(request, env, session) {
  const user = await env.DB.prepare(
    'SELECT trial_phone_verified FROM users WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return corsResponse({ error: 'User not found' }, 404);
  if (user.trial_phone_verified) return corsResponse({ error: 'Phone already verified' }, 409);
  return corsResponse({ success: true });
}

// ---------- OTP: verify Firebase ID token ----------
async function verifyOtp(request, env, session) {
  const { idToken } = await request.json();
  if (!idToken) return corsResponse({ error: 'Missing idToken' }, 400);

  // Verify the Firebase ID token via the Identity Toolkit REST API
  const fbResp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  const fbData = await fbResp.json();
  if (!fbResp.ok || !fbData.users?.[0]?.phoneNumber) {
    return corsResponse({ error: 'Invalid or expired verification. Please try again.' }, 400);
  }

  // Firebase returns "+91XXXXXXXXXX" — strip the "+" for storage
  const mobile = fbData.users[0].phoneNumber.replace('+', '');

  // One trial per phone number
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE phone = ? AND id != ?'
  ).bind(mobile, session.userId).first();
  if (existing) {
    await env.DB.prepare(
      "UPDATE users SET status = 'suspended', suspension_reason = 'Duplicate phone number — one trial per device' WHERE id = ?"
    ).bind(session.userId).run();
    return corsResponse({ error: 'This phone number is already registered with another account.' }, 409);
  }

  await env.DB.prepare(
    'UPDATE users SET phone = ?, trial_phone_verified = 1, updated_at = ? WHERE id = ?'
  ).bind(mobile, Date.now(), session.userId).run();
  return corsResponse({ success: true });
}
