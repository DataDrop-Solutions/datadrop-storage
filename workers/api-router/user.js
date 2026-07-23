// ============================================================
// DataDrop — User Handler
// GET  /user/me              → profile + wallet + usage
// PUT  /user/me              → update display name / username
// GET  /user/wallet          → wallet details
// POST /user/wallet/topup    → initiate Razorpay top-up
// POST /user/wallet/confirm  → confirm top-up payment
// POST /user/adfree/subscribe  → subscribe to ad-free video
// DELETE /user/adfree         → cancel ad-free
// POST /user/mandate/create          → create UPI autopay mandate (initial setup)
// POST /user/mandate/confirm         → confirm mandate after UPI approval
// GET  /user/mandate                 → get active mandate
// PUT  /user/mandate                 → update mandate limit (inline, no new Razorpay mandate)
// DELETE /user/mandate               → cancel mandate
// POST /user/mandate/upgrade         → create new mandate order while old one stays active
// POST /user/mandate/upgrade/confirm → atomically activate new, supersede old
// DELETE /user/mandate/upgrade/cancel→ cancel the pending upgrade mandate (on dismiss)
// POST /user/otp/send        → send OTP via MSG91 REST API
// POST /user/otp/verify      → verify OTP and mark phone verified
// ============================================================

import {
  corsResponse, handleOptions, validateSession, getStorageBytes, bytesToGb,
  calcStorageCost, getStorageCapacity, invalidateSession, loadBillingConfig,
  computeBillSoFar, computeProjectedBill, getConfigNum, newId, sendEmail, safeCompare,
} from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

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
      if (path === '/me/delete'         && request.method === 'POST') return await requestDeletion(env, session);
      if (path === '/mandate/create'          && request.method === 'POST')   return await createMandate(request, env, session);
      if (path === '/mandate/confirm'         && request.method === 'POST')   return await confirmMandate(request, env, session);
      if (path === '/mandate'                 && request.method === 'GET')    return await getMandate(env, session);
      if (path === '/mandate'                 && request.method === 'PUT')    return await updateMandate(request, env, session);
      if (path === '/mandate'                 && request.method === 'DELETE') return await cancelMandate(env, session);
      if (path === '/mandate/upgrade'         && request.method === 'POST')   return await createUpgradeMandate(request, env, session);
      if (path === '/mandate/upgrade/confirm' && request.method === 'POST')   return await confirmUpgradeMandate(request, env, session);
      if (path === '/mandate/upgrade/cancel'  && request.method === 'DELETE') return await cancelUpgradeMandate(env, session);
      if (path === '/otp/send'          && request.method === 'POST') return await sendOtp(request, env, session);
      if (path === '/otp/verify'        && request.method === 'POST') return await verifyOtp(request, env, session);
      // Billing v5
      if (path === '/billing/history'         && request.method === 'GET')  return await getBillingHistory(env, session);
      if (path === '/billing/pay-now'         && request.method === 'POST') return await initiatePayNow(request, env, session);
      if (path === '/billing/pay-now/confirm' && request.method === 'POST') return await confirmPayNow(request, env, session);
      if (path === '/billing/recovery-status' && request.method === 'GET')  return await getRecoveryStatus(env, session);
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

  // Invalidate session cache via reverse index
  await invalidateSession(env, session.userId);

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
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, setAsLimit } = await request.json();

  // Verify Razorpay signature — all three fields required, no optional bypass
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return corsResponse({ error: 'Payment verification failed — missing fields' }, 400);
  }
  const isValid = await verifyRazorpaySignature(
    razorpayOrderId, razorpayPaymentId, razorpaySignature, env.RAZORPAY_KEY_SECRET
  );
  if (!isValid) return corsResponse({ error: 'Payment verification failed' }, 400);

  // Fetch confirmed amount from Razorpay — never trust client-supplied amount (CRIT-1)
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const orderResp = await fetch(`https://api.razorpay.com/v1/orders/${razorpayOrderId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!orderResp.ok) return corsResponse({ error: 'Could not verify payment amount' }, 502);
  const order = await orderResp.json();
  if (order.status !== 'paid') return corsResponse({ error: 'Payment not yet confirmed by Razorpay' }, 400);
  const amountRs = order.amount / 100;

  // Idempotency: if webhook already credited this payment, skip credit (HIGH-4)
  const alreadyCredited = await env.KV.get(`webhook_pay:${razorpayPaymentId}`).catch(() => null);
  if (!alreadyCredited) {
    await env.KV.put(`webhook_pay:${razorpayPaymentId}`, 'topup_confirm', { expirationTtl: 7 * 86400 }).catch(() => {});

    const updates = ['wallet_balance = wallet_balance + ?', 'updated_at = ?'];
    const binds   = [amountRs, Date.now()];
    if (setAsLimit) { updates.push('wallet_limit = ?'); binds.push(amountRs); }
    binds.push(session.userId);
    await env.DB.prepare(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...binds).run();
  }

  return corsResponse({ success: true, creditedAmount: amountRs });
}

// ---------- Ad-free subscription ----------
async function subscribeAdFree(env, session) {
  const user = await env.DB.prepare(
    'SELECT adfree_active, wallet_balance FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (user?.adfree_active) return corsResponse({ error: 'Already subscribed to ad-free' }, 409);

  // Price locked at signup time from config
  const { getConfigNum } = await import('../shared/utils.js'); // lazy to avoid circular dep
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

  // A trial user with an active mandate is a paying customer — treat as active.
  // This covers users who set up AutoPay before their trial ended (status not yet updated in DB).
  let effectiveWalletLimit = user?.wallet_limit || 0;
  let isTrial = user?.status === 'trial';
  if (isTrial) {
    const activeMandate = await env.DB.prepare(
      "SELECT protection_limit FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1 LIMIT 1"
    ).bind(session.userId).first();
    if (activeMandate) {
      isTrial = false;
      effectiveWalletLimit = activeMandate.protection_limit || effectiveWalletLimit;
      // Backfill the status so future calls don't need the extra query
      env.DB.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'trial'")
        .bind(Date.now(), session.userId).run().catch(() => {});
    }
  }

  const TRIAL_GB = 5;
  const maxGb    = isTrial ? TRIAL_GB : null;

  const price = config.storage_price_per_gb_month;
  let capacity_gb = null, capacity_bytes = null;
  if (!isTrial && effectiveWalletLimit > 0) {
    try {
      ({ capacityGB: capacity_gb, capacityBytes: capacity_bytes } = getStorageCapacity(effectiveWalletLimit, price));
    } catch (_) {
      return corsResponse({ error: 'Storage pricing not configured', code: 'PRICING_ERROR' }, 503);
    }
  }

  const available_gb  = capacity_gb !== null ? Math.max(0, capacity_gb - storageGb) : null;
  const used_percent  = isTrial
    ? Math.min(100, (storageGb / TRIAL_GB) * 100)
    : (capacity_gb ? Math.min(100, (storageGb / capacity_gb) * 100) : 0);

  const bill_so_far = computeBillSoFar(usageRow, config);

  return corsResponse({
    storageBytes,
    storageGb,
    estimatedCost,
    walletBalance: user?.wallet_balance,
    walletLimit:   effectiveWalletLimit,
    usedPercent:   used_percent,
    used_percent,
    maxGb,
    capacity_gb,
    capacity_bytes,
    available_gb,
    status:      isTrial ? 'trial' : (user?.status || 'active'),
    trialEndsAt: isTrial ? user?.trial_ends_at : null,
    bill_so_far,
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

// ---------- UPI Autopay Mandates (spending protection) ----------
async function createMandate(request, env, session) {
  const { protectionLimit } = await request.json();
  if (!protectionLimit || Math.floor(protectionLimit) < 49)
    return corsResponse({ error: 'protectionLimit must be at least ₹49' }, 400);

  const existing = await env.DB.prepare(
    "SELECT id FROM wallet_mandates WHERE user_id = ? AND status IN ('created','active')"
  ).bind(session.userId).first();
  if (existing) return corsResponse({ error: 'An active mandate already exists. Update or cancel it first.' }, 409);

  const user = await env.DB.prepare('SELECT email, display_name, phone FROM users WHERE id = ?')
    .bind(session.userId).first();
  if (!user) return corsResponse({ error: 'User not found' }, 404);

  const auth    = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const contact = user.phone ? `+${user.phone}` : undefined;

  // 1. Reuse existing Razorpay customer if one was created from a previous mandate
  let customerId = null;
  const prevMandate = await env.DB.prepare(
    'SELECT razorpay_customer_id FROM wallet_mandates WHERE user_id = ? AND razorpay_customer_id != "" ORDER BY created_at DESC LIMIT 1'
  ).bind(session.userId).first();
  if (prevMandate?.razorpay_customer_id) {
    customerId = prevMandate.razorpay_customer_id;
  } else {
    const custResp = await fetch('https://api.razorpay.com/v1/customers', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:          user.display_name || user.email,
        email:         user.email,
        contact:       contact || '',
        fail_existing: 0,
      }),
    });
    if (!custResp.ok) {
      const err = await custResp.json().catch(() => ({}));
      return corsResponse({ error: err?.error?.description || 'Failed to create customer' }, 502);
    }
    const customer = await custResp.json();
    customerId = customer.id;
  }

  // 2. Create UPI recurring order — ₹1 auth charge, mandate for protectionLimit max
  const expireAt = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600; // 10 years
  const orderResp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount:      100,
      currency:    'INR',
      customer_id: customerId,
      method:      'upi',
      token: {
        max_amount:      Math.round(protectionLimit * 100),
        expire_at:       expireAt,
        frequency:       'monthly',
        recurring_type:  'before',
        recurring_value: 31,
      },
      receipt: `mnd_${session.userId.slice(0, 12)}_${Date.now().toString(36)}`,
      notes:   { userId: session.userId, type: 'mandate_setup' },
    }),
  });
  if (!orderResp.ok) {
    const err = await orderResp.json().catch(() => ({}));
    return corsResponse({ error: err?.error?.description || 'Failed to create order' }, 502);
  }
  const order = await orderResp.json();

  const mandateId = newId();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO wallet_mandates
        (id, user_id, razorpay_mandate_id, razorpay_customer_id, protection_limit, status, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 'created', 1, ?)
    `).bind(mandateId, session.userId, order.id, customerId, protectionLimit, now),
    env.DB.prepare('UPDATE users SET wallet_limit = ?, updated_at = ? WHERE id = ?')
      .bind(protectionLimit, now, session.userId),
  ]);

  return corsResponse({
    orderId:    order.id,
    customerId: customerId,
    amount:     100,
    currency:   'INR',
    key:        env.RAZORPAY_KEY_ID,
    prefill:    { name: user.display_name, email: user.email, contact: contact || '' },
  });
}

async function confirmMandate(request, env, session) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = await request.json();

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature)
    return corsResponse({ error: 'Payment verification failed — missing fields' }, 400);

  const isValid = await verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, env.RAZORPAY_KEY_SECRET);
  if (!isValid) return corsResponse({ error: 'Payment verification failed' }, 400);

  const mandate = await env.DB.prepare(
    "SELECT id, razorpay_customer_id FROM wallet_mandates WHERE user_id = ? AND razorpay_mandate_id = ? AND status = 'created'"
  ).bind(session.userId, razorpayOrderId).first();
  if (!mandate) return corsResponse({ error: 'Mandate not found' }, 404);

  // Fetch UPI token created by mandate registration
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  let tokenId = null;
  if (mandate.razorpay_customer_id) {
    const tokensResp = await fetch(
      `https://api.razorpay.com/v1/customers/${mandate.razorpay_customer_id}/tokens`,
      { headers: { Authorization: `Basic ${auth}` } }
    ).catch(() => null);
    if (tokensResp?.ok) {
      const tokensData = await tokensResp.json().catch(() => ({}));
      const upiToken = tokensData.items?.find(t => t.method === 'upi' && t.recurring === true);
      tokenId = upiToken?.id || null;
    }
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE wallet_mandates SET status = 'active', is_active = 1, activated_at = ?, razorpay_token_id = ? WHERE id = ?")
      .bind(now, tokenId, mandate.id),
    env.DB.prepare('UPDATE users SET wallet_balance = wallet_balance + 1, updated_at = ? WHERE id = ?')
      .bind(now, session.userId),
    // Graduate trial users to active — mandate is now their billing method
    env.DB.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'trial'")
      .bind(now, session.userId),
  ]);

  return corsResponse({ success: true });
}

async function getMandate(env, session) {
  const mandate = await env.DB.prepare(
    "SELECT id, razorpay_mandate_id, protection_limit, status, upi_vpa, created_at, activated_at FROM wallet_mandates WHERE user_id = ? AND status IN ('created','active') AND is_active = 1 ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 1"
  ).bind(session.userId).first();

  return corsResponse({ mandate: mandate || null });
}

async function updateMandate(request, env, session) {
  const { protectionLimit } = await request.json();
  if (!protectionLimit || Math.floor(protectionLimit) < 49) {
    return corsResponse({ error: 'protectionLimit must be at least ₹49' }, 400);
  }

  // If reducing the limit, ensure new capacity can hold the user's current storage
  const existing = await env.DB.prepare(
    "SELECT protection_limit FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1 LIMIT 1"
  ).bind(session.userId).first();
  if (existing && protectionLimit < existing.protection_limit) {
    const price = await getConfigNum(env, 'storage_price_per_gb_month');
    let capacityGB, capacityBytes;
    try {
      ({ capacityGB, capacityBytes } = getStorageCapacity(protectionLimit, price));
    } catch (_) {
      return corsResponse({ error: 'Storage pricing not configured', code: 'PRICING_ERROR' }, 503);
    }
    const storedRow = await env.DB.prepare(
      'SELECT COALESCE(SUM(size_bytes), 0) as total FROM files WHERE user_id = ? AND deleted_at IS NULL'
    ).bind(session.userId).first();
    const currentBytes = storedRow?.total || 0;
    const currentGB    = currentBytes / (1024 * 1024 * 1024);
    if (currentBytes > capacityBytes) {
      return corsResponse({
        error: `Your account currently stores ${currentGB.toFixed(1)} GB. Reduce your stored data below ${capacityGB.toFixed(1)} GB before lowering your monthly limit.`,
        code: 'LIMIT_REDUCTION_NOT_ALLOWED',
        currentGB,
        currentBytes,
        requestedCapacityGB: capacityGB,
      }, 400);
    }
  }

  const mandate = await env.DB.prepare(
    "SELECT id FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1"
  ).bind(session.userId).first();

  if (!mandate) return corsResponse({ error: 'No active mandate found' }, 404);

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE wallet_mandates SET protection_limit = ? WHERE id = ?').bind(protectionLimit, mandate.id),
    env.DB.prepare('UPDATE users SET wallet_limit = ?, updated_at = ? WHERE id = ?').bind(protectionLimit, now, session.userId),
  ]);

  return corsResponse({ success: true, protectionLimit });
}

async function cancelMandate(env, session) {
  const mandate = await env.DB.prepare(
    "SELECT id, razorpay_customer_id, razorpay_token_id FROM wallet_mandates WHERE user_id = ? AND status IN ('created','active') AND is_active = 1"
  ).bind(session.userId).first();

  if (!mandate) return corsResponse({ success: true });

  // Delete the UPI mandate token (best-effort)
  if (mandate.razorpay_customer_id && mandate.razorpay_token_id) {
    const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    await fetch(
      `https://api.razorpay.com/v1/customers/${mandate.razorpay_customer_id}/tokens/${mandate.razorpay_token_id}`,
      { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } }
    ).catch(() => {});
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE wallet_mandates SET status = 'cancelled', is_active = 0, cancelled_at = ? WHERE id = ?")
      .bind(Date.now(), mandate.id),
    env.DB.prepare('UPDATE users SET wallet_limit = 0, updated_at = ? WHERE id = ?')
      .bind(Date.now(), session.userId),
  ]);

  return corsResponse({ success: true });
}

// ---------- Mandate upgrade (limit change while old mandate stays active) ----------
async function createUpgradeMandate(request, env, session) {
  const { protectionLimit } = await request.json();
  if (!protectionLimit || Math.floor(protectionLimit) < 49)
    return corsResponse({ error: 'protectionLimit must be at least ₹49' }, 400);

  const currentMandate = await env.DB.prepare(
    "SELECT id, razorpay_customer_id, protection_limit FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1"
  ).bind(session.userId).first();
  if (!currentMandate) return corsResponse({ error: 'No active mandate to upgrade' }, 404);

  // Reject limit decrease if current storage exceeds new capacity
  if (protectionLimit < currentMandate.protection_limit) {
    const price = await getConfigNum(env, 'storage_price_per_gb_month');
    let capacityGB, capacityBytes;
    try {
      ({ capacityGB, capacityBytes } = getStorageCapacity(protectionLimit, price));
    } catch (_) {
      return corsResponse({ error: 'Storage pricing not configured', code: 'PRICING_ERROR' }, 503);
    }
    const storedRow = await env.DB.prepare(
      'SELECT COALESCE(SUM(size_bytes), 0) as total FROM files WHERE user_id = ? AND deleted_at IS NULL'
    ).bind(session.userId).first();
    const currentBytes = storedRow?.total || 0;
    if (currentBytes > capacityBytes) {
      const currentGB = currentBytes / (1024 * 1024 * 1024);
      return corsResponse({
        error: `Your account currently stores ${currentGB.toFixed(1)} GB. Reduce your stored data below ${capacityGB.toFixed(1)} GB before lowering your monthly limit.`,
        code: 'LIMIT_REDUCTION_NOT_ALLOWED',
        currentGB, requestedCapacityGB: capacityGB,
      }, 400);
    }
  }

  // Clean up any previously abandoned upgrade mandate
  await env.DB.prepare(
    "UPDATE wallet_mandates SET status = 'cancelled', is_active = 0, cancelled_at = ? WHERE user_id = ? AND status = 'created' AND is_active = 0"
  ).bind(Date.now(), session.userId).run();

  const customerId = currentMandate.razorpay_customer_id;
  if (!customerId) return corsResponse({ error: 'No Razorpay customer on file — please contact support' }, 409);

  const user = await env.DB.prepare('SELECT email, display_name, phone FROM users WHERE id = ?')
    .bind(session.userId).first();
  const auth    = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const contact = user?.phone ? `+${user.phone}` : '';

  const expireAt = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
  const orderResp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount:      100,
      currency:    'INR',
      customer_id: customerId,
      method:      'upi',
      token: {
        max_amount:      Math.round(protectionLimit * 100),
        expire_at:       expireAt,
        frequency:       'monthly',
        recurring_type:  'before',
        recurring_value: 31,
      },
      receipt: `upg_${session.userId.slice(0, 12)}_${Date.now().toString(36)}`,
      notes:   { userId: session.userId, type: 'mandate_upgrade' },
    }),
  });
  if (!orderResp.ok) {
    const err = await orderResp.json().catch(() => ({}));
    return corsResponse({ error: err?.error?.description || 'Failed to create upgrade order' }, 502);
  }
  const order = await orderResp.json();

  await env.DB.prepare(`
    INSERT INTO wallet_mandates
      (id, user_id, razorpay_mandate_id, razorpay_customer_id, protection_limit, status, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 'created', 0, ?)
  `).bind(newId(), session.userId, order.id, customerId, protectionLimit, Date.now()).run();

  return corsResponse({
    orderId:    order.id,
    customerId: customerId,
    amount:     100,
    currency:   'INR',
    key:        env.RAZORPAY_KEY_ID,
    prefill:    { name: user?.display_name, email: user?.email, contact },
  });
}

async function confirmUpgradeMandate(request, env, session) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = await request.json();
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature)
    return corsResponse({ error: 'Payment verification failed — missing fields' }, 400);

  const isValid = await verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, env.RAZORPAY_KEY_SECRET);
  if (!isValid) return corsResponse({ error: 'Payment verification failed' }, 400);

  const newMandate = await env.DB.prepare(
    "SELECT id, razorpay_customer_id, protection_limit FROM wallet_mandates WHERE user_id = ? AND razorpay_mandate_id = ? AND status = 'created' AND is_active = 0"
  ).bind(session.userId, razorpayOrderId).first();

  // Idempotency: already confirmed (e.g. double-submit or webhook beat us here)
  if (!newMandate) {
    const alreadyActive = await env.DB.prepare(
      "SELECT protection_limit FROM wallet_mandates WHERE user_id = ? AND razorpay_mandate_id = ? AND status = 'active'"
    ).bind(session.userId, razorpayOrderId).first();
    if (alreadyActive) return corsResponse({ success: true, newLimit: alreadyActive.protection_limit });
    return corsResponse({ error: 'Upgrade mandate not found' }, 404);
  }

  const oldMandate = await env.DB.prepare(
    "SELECT id, razorpay_customer_id, razorpay_token_id FROM wallet_mandates WHERE user_id = ? AND status = 'active' AND is_active = 1"
  ).bind(session.userId).first();

  // Fetch new UPI token — take the most recently created recurring token
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

  // ── Step 1: Optimistic concurrency lock on old mandate ─────────────────────
  // Supersede old mandate first. If another confirm already won the race,
  // changes will be 0 — abort before we create a duplicate active mandate.
  if (oldMandate) {
    const supersedeResult = await env.DB.prepare(
      "UPDATE wallet_mandates SET status = 'cancelled', is_active = 0, superseded_at = ? WHERE id = ? AND is_active = 1"
    ).bind(now, oldMandate.id).run();

    if (supersedeResult.meta.changes !== 1) {
      return corsResponse({
        error: 'Another mandate update has already completed. Please refresh the page.',
        code:  'MANDATE_ALREADY_UPDATED',
      }, 409);
    }
  }

  // ── Step 2: Activate new mandate + update wallet (atomic batch) ────────────
  // Old token stays alive — cleanup worker cancels it after the grace period.
  await env.DB.batch([
    env.DB.prepare("UPDATE wallet_mandates SET status = 'active', is_active = 1, activated_at = ?, razorpay_token_id = ? WHERE id = ?")
      .bind(now, tokenId, newMandate.id),
    env.DB.prepare('UPDATE users SET wallet_balance = wallet_balance + 1, wallet_limit = ?, updated_at = ? WHERE id = ?')
      .bind(newMandate.protection_limit, now, session.userId),
  ]);

  return corsResponse({ success: true, newLimit: newMandate.protection_limit });
}

async function cancelUpgradeMandate(env, session) {
  // Only cancels the pending upgrade mandate (is_active=0), never touches the active one
  const mandate = await env.DB.prepare(
    "SELECT id FROM wallet_mandates WHERE user_id = ? AND status = 'created' AND is_active = 0 ORDER BY created_at DESC LIMIT 1"
  ).bind(session.userId).first();
  if (!mandate) return corsResponse({ success: true });

  await env.DB.prepare(
    "UPDATE wallet_mandates SET status = 'cancelled', is_active = 0, cancelled_at = ? WHERE id = ?"
  ).bind(Date.now(), mandate.id).run();

  return corsResponse({ success: true });
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
  return safeCompare(hex, signature);
}


// ---------- Account deletion ----------
async function requestDeletion(env, session) {
  const user = await env.DB.prepare(
    'SELECT email, display_name, wallet_balance FROM users WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return corsResponse({ error: 'User not found' }, 404);

  // Schedule deletion: 30-day grace window per business rule (support can intervene)
  const deletionAt = Date.now() + 30 * 86400000;

  await env.DB.prepare(
    "UPDATE users SET status = 'pending_deletion', deletion_scheduled_at = ?, updated_at = ? WHERE id = ?"
  ).bind(deletionAt, Date.now(), session.userId).run();

  // Queue data deletion after 30 days via a KV flag (trial worker checks this)
  await env.KV.put(`pending_deletion:${session.userId}`, '1', {
    expirationTtl: 30 * 86400 + 3600, // 30 days + buffer
  });

  await sendEmail(env, {
    to: user.email,
    subject: 'DataDrop: Account deletion scheduled',
    html: `<p>Hi ${user.display_name},</p>
           <p>Your DataDrop account is scheduled for deletion in 30 days.</p>
           <p>All your files and data will be permanently deleted on ${new Date(deletionAt).toLocaleDateString('en-IN')}.</p>
           ${user.wallet_balance > 50
             ? `<p>If you have any outstanding credit, contact us at billing@datadrop.co.in within 30 days of deletion.</p>`
             : ''}
           <p>To cancel this deletion, contact us at datadrop.contact@gmail.com within 30 days.</p>`,
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

// ============================================================
// Billing v5 — Payment Recovery
// ============================================================

// GET /user/billing/history
async function getBillingHistory(env, session) {
  const { results } = await env.DB.prepare(`
    SELECT b.id, b.month, b.billing_date, b.actual_usage_gb, b.actual_usage_amount,
           b.adfree_amount, b.teams_amount, b.total_charged, b.gb_months,
           b.status, b.payment_method, b.paid_at, b.first_failed_at,
           b.retry_count, b.next_retry_at, b.last_failure_reason,
           b.razorpay_order_id, b.razorpay_payment_id, b.failure_reason,
           b.created_at, b.updated_at
    FROM billing b
    WHERE b.user_id = ?
    ORDER BY b.month DESC
    LIMIT 24
  `).bind(session.userId).all();

  // For failed invoices, compute days remaining
  const now = Date.now();
  const enriched = results.map(inv => ({
    ...inv,
    days_overdue: inv.first_failed_at ? Math.floor((now - inv.first_failed_at) / 86400000) : null,
    days_remaining: inv.first_failed_at ? Math.max(0, 35 - Math.floor((now - inv.first_failed_at) / 86400000)) : null,
  }));

  return corsResponse({ invoices: enriched });
}

// GET /user/billing/recovery-status
async function getRecoveryStatus(env, session) {
  const user = await env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(session.userId).first();
  if (user?.status !== 'read_only') return corsResponse({ inRecovery: false });

  const failedInvoice = await env.DB.prepare(
    "SELECT id, total_charged, month, first_failed_at, retry_count, next_retry_at FROM billing WHERE user_id = ? AND status = 'failed' ORDER BY created_at ASC LIMIT 1"
  ).bind(session.userId).first();

  if (!failedInvoice) return corsResponse({ inRecovery: true, daysRemaining: 35 });

  const now = Date.now();
  const daysOverdue  = failedInvoice.first_failed_at ? Math.floor((now - failedInvoice.first_failed_at) / 86400000) : 0;
  const daysRemaining = Math.max(0, 35 - daysOverdue);

  return corsResponse({
    inRecovery: true,
    daysRemaining,
    daysOverdue,
    amountDue: failedInvoice.total_charged,
    month: failedInvoice.month,
    billingId: failedInvoice.id,
    retryCount: failedInvoice.retry_count,
    nextRetryAt: failedInvoice.next_retry_at,
  });
}

// POST /user/billing/pay-now
// Creates a Razorpay Order for the outstanding invoice
async function initiatePayNow(request, env, session) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    return corsResponse({ error: 'Payment not configured' }, 503);
  }

  // Find the outstanding invoice
  const invoice = await env.DB.prepare(
    "SELECT id, total_charged, month, status, payment_method, paid_at, razorpay_order_id FROM billing WHERE user_id = ? AND status = 'failed' ORDER BY created_at ASC LIMIT 1"
  ).bind(session.userId).first();

  if (!invoice) return corsResponse({ error: 'No outstanding invoice found' }, 404);

  // Idempotency: if already paid, reject
  if (invoice.status === 'paid') {
    return corsResponse({ error: 'Invoice already paid', invoice }, 409);
  }

  // Reuse existing order if already created and not expired
  if (invoice.razorpay_order_id) {
    const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
    const existing = await fetch(`https://api.razorpay.com/v1/orders/${invoice.razorpay_order_id}`,
      { headers: { Authorization: `Basic ${auth}` } }).then(r => r.json()).catch(() => null);
    if (existing?.status === 'created') {
      return corsResponse({ orderId: existing.id, amount: invoice.total_charged, currency: 'INR', invoiceId: invoice.id });
    }
  }

  const user = await env.DB.prepare('SELECT email, display_name, phone FROM users WHERE id = ?').bind(session.userId).first();
  const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

  const orderResp = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(invoice.total_charged * 100),
      currency: 'INR',
      receipt: `paynow_${session.userId.slice(0,10)}_${Date.now().toString(36)}`,
      notes: { userId: session.userId, invoiceId: invoice.id, type: 'pay_now' },
    }),
  });
  if (!orderResp.ok) return corsResponse({ error: 'Could not create payment order' }, 503);
  const order = await orderResp.json();

  // Store order ID on the invoice
  await env.DB.prepare('UPDATE billing SET razorpay_order_id = ?, updated_at = ? WHERE id = ?')
    .bind(order.id, Date.now(), invoice.id).run();

  return corsResponse({
    orderId: order.id,
    amount: invoice.total_charged,
    currency: 'INR',
    invoiceId: invoice.id,
    keyId: env.RAZORPAY_KEY_ID,
    prefill: { email: user?.email || '', contact: user?.phone ? `+${user.phone}` : '' },
  });
}

// POST /user/billing/pay-now/confirm
// Verifies Razorpay payment and marks invoice as paid
async function confirmPayNow(request, env, session) {
  const { invoiceId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = await request.json();
  // All four fields required — signature is never optional (CRIT-2)
  if (!invoiceId || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
    return corsResponse({ error: 'Missing payment details' }, 400);
  }

  const invoice = await env.DB.prepare(
    'SELECT id, user_id, total_charged, month, status, idempotency_key, razorpay_order_id FROM billing WHERE id = ? AND user_id = ?'
  ).bind(invoiceId, session.userId).first();

  if (!invoice) return corsResponse({ error: 'Invoice not found' }, 404);

  // Idempotency: reject duplicate confirmations
  if (invoice.status === 'paid') {
    return corsResponse({ error: 'Invoice already paid', alreadyPaid: true }, 409);
  }

  // Verify signature — unconditional, uses safeCompare (CRIT-2)
  const isValidPayNow = await verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature, env.RAZORPAY_KEY_SECRET);
  if (!isValidPayNow) return corsResponse({ error: 'Payment verification failed' }, 400);

  // Determine payment method from Razorpay
  let paymentMethod = 'UPI';
  if (env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) {
    try {
      const auth = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
      const pm = await fetch(`https://api.razorpay.com/v1/payments/${razorpayPaymentId}`,
        { headers: { Authorization: `Basic ${auth}` } }).then(r => r.json()).catch(() => ({}));
      if (pm.method === 'card') paymentMethod = 'CARD';
      else if (pm.method === 'netbanking') paymentMethod = 'NETBANKING';
      else if (pm.method === 'upi') paymentMethod = 'UPI';
      else if (pm.method === 'wallet') paymentMethod = 'WALLET';
    } catch (_) {}
  }

  const now = Date.now();

  // Mark invoice as paid and restore account
  await env.DB.batch([
    env.DB.prepare(`
      UPDATE billing SET status = 'paid', payment_method = ?, paid_at = ?,
        razorpay_payment_id = ?, next_retry_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'failed'
    `).bind(paymentMethod, now, razorpayPaymentId, now, invoiceId),
    env.DB.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ? AND status = 'read_only'")
      .bind(now, session.userId),
    env.DB.prepare(
      'UPDATE storage_usage SET accumulated_byte_seconds = 0, last_updated_at = ?, billing_month = ? WHERE user_id = ?'
    ).bind(now, getCurrentBillingMonthStr(), session.userId),
  ]);

  // Send confirmation email
  const user = await env.DB.prepare('SELECT email, display_name FROM users WHERE id = ?').bind(session.userId).first();
  if (user) {
    const { sendEmail } = await import('../shared/utils.js');
    await sendEmail(env, {
      to: user.email,
      subject: 'DataDrop: Payment received — account fully restored',
      html: `<p>Hi ${user.display_name},</p>
             <p>Your payment of <strong>₹${invoice.total_charged.toFixed(2)}</strong> for <strong>${invoice.month}</strong> has been received. Your account is fully restored.</p>`,
    }).catch(() => {});
  }

  return corsResponse({ success: true, message: 'Payment confirmed. Account restored.' });
}

function getCurrentBillingMonthStr() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
