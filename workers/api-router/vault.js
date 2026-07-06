// ============================================================
// DataDrop — Vault Handler
//
// V1 endpoints (legacy, PIN + shared vault key):
//   GET  /vault/status     → is vault set up? (works for both v1 and v2)
//   GET  /vault/salt       → get salts for PIN hashing (v1)
//   POST /vault/setup      → first-time vault setup v1
//   POST /vault/verify-pin → verify PIN, return encrypted vault key (v1)
//   POST /vault/recover    → reset PIN via recovery phrase (v1)
//
// V2 endpoints (ECDH P-256, per-file DEK):
//   POST /vault/v2/setup       → store vault_config + public key
//   GET  /vault/v2/config      → get encrypted private key material
//   POST /vault/v2/verify-pin  → verify PIN hash, return encrypted private key
//   POST /vault/v2/recover     → reset PIN via phrase
//   POST /vault/file-key       → store file_keys entry
//   GET  /vault/file-key/:fid  → get file_keys entry for this user
//   GET  /vault/public-key/:uid→ get another user's public key (team key distribution)
// ============================================================

import { corsResponse, handleOptions, validateSession, newId, checkApiRateLimit } from '../shared/utils.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return handleOptions();

    const session = await validateSession(request, env);
    if (!session) return corsResponse({ error: 'Unauthorized' }, 401);

    if (!(await checkApiRateLimit(env, session.userId))) {
      return corsResponse({ error: 'Too many requests' }, 429);
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace('/vault', '');

    try {
      // ── V1 (legacy) ──────────────────────────────────────────
      if (path === '/salt'       && request.method === 'GET')  return await vaultSaltEndpoint(env, session);
      if (path === '/status'     && request.method === 'GET')  return await vaultStatus(env, session);
      if (path === '/setup'      && request.method === 'POST') return await vaultSetup(request, env, session);
      if (path === '/verify-pin' && request.method === 'POST') return await verifyPin(request, env, session);
      if (path === '/recover'    && request.method === 'POST') return await recoverVault(request, env, session);

      // ── V2 (ECDH P-256) ──────────────────────────────────────
      if (path === '/v2/setup'      && request.method === 'POST') return await vaultSetupV2(request, env, session);
      if (path === '/v2/config'     && request.method === 'GET')  return await vaultConfigV2(env, session);
      if (path === '/v2/verify-pin' && request.method === 'POST') return await verifyPinV2(request, env, session);
      if (path === '/v2/recover'    && request.method === 'POST') return await recoverVaultV2(request, env, session);

      // ── File keys ────────────────────────────────────────────
      if (path === '/file-key' && request.method === 'POST') return await storeFileKey(request, env, session);
      const fileKeyMatch = path.match(/^\/file-key\/([a-f0-9]{32})$/);
      if (fileKeyMatch && request.method === 'GET') return await getFileKey(fileKeyMatch[1], env, session);

      // ── Vault reset (nuclear option — deletes all vault files + config) ─
      if (path === '/reset' && request.method === 'DELETE') return await resetVault(request, env, session);

      // ── Public key lookup (for team key distribution) ────────
      const pubKeyMatch = path.match(/^\/public-key\/([a-f0-9]{32})$/);
      if (pubKeyMatch && request.method === 'GET') return await getPublicKey(pubKeyMatch[1], env, session);

      return corsResponse({ error: 'Not found' }, 404);
    } catch (_) {
      return corsResponse({ error: 'Internal error' }, 500);
    }
  },
};

// ── Status ─────────────────────────────────────────────────────
async function vaultStatus(env, session) {
  const user = await env.DB.prepare(
    'SELECT vault_setup_at FROM users WHERE id = ?'
  ).bind(session.userId).first();

  const v2config = await env.DB.prepare(
    'SELECT user_id FROM vault_config WHERE user_id = ?'
  ).bind(session.userId).first();

  return corsResponse({
    configured: !!(user?.vault_setup_at || v2config),
    configuredAt: user?.vault_setup_at || null,
    isV2: !!v2config,
  });
}

// ── V1 Setup ───────────────────────────────────────────────────
async function vaultSetup(request, env, session) {
  const {
    pinHash, salt, encryptedVaultKey,
    phraseHash, phraseSalt, phraseEncryptedKey,
  } = await request.json();

  if (!pinHash || !salt || !encryptedVaultKey || !phraseHash || !phraseSalt || !phraseEncryptedKey) {
    return corsResponse({ error: 'All vault fields required' }, 400);
  }

  const user = await env.DB.prepare('SELECT vault_setup_at FROM users WHERE id = ?').bind(session.userId).first();
  if (user?.vault_setup_at) {
    return corsResponse({ error: 'Vault already configured. Use recovery phrase to reset PIN.' }, 409);
  }

  await env.DB.prepare(`
    UPDATE users SET
      vault_pin_hash       = ?,
      vault_salt           = ?,
      vault_encrypted_key  = ?,
      vault_phrase_salt    = ?,
      vault_phrase_hash    = ?,
      vault_phrase_enc_key = ?,
      vault_setup_at       = ?,
      updated_at           = ?
    WHERE id = ?
  `).bind(
    pinHash, salt, encryptedVaultKey,
    phraseSalt, phraseHash, phraseEncryptedKey,
    Date.now(), Date.now(),
    session.userId
  ).run();

  return corsResponse({ success: true });
}

// ── V1 Verify PIN ──────────────────────────────────────────────
async function verifyPin(request, env, session) {
  const { pinHash } = await request.json();
  if (!pinHash) return corsResponse({ error: 'pinHash required' }, 400);

  const user = await env.DB.prepare(
    'SELECT vault_pin_hash, vault_encrypted_key, vault_salt FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (!user?.vault_pin_hash) return corsResponse({ error: 'Vault not configured' }, 404);
  if (user.vault_pin_hash !== pinHash) {
    const attempts = await incrementPinAttempts(env, session.userId);
    if (attempts >= 5) {
      return corsResponse({ error: 'Too many incorrect attempts. Try again in 30 minutes.', locked: true }, 429);
    }
    return corsResponse({ error: 'Incorrect PIN', attemptsRemaining: 5 - attempts }, 401);
  }

  await env.KV.delete(`pin_attempts:${session.userId}`).catch(() => {});

  return corsResponse({
    encryptedVaultKey: user.vault_encrypted_key,
    salt: user.vault_salt,
  });
}

// ── V1 Recover ────────────────────────────────────────────────
async function recoverVault(request, env, session) {
  const { phraseHash, newPinHash, newSalt, newEncryptedVaultKey } = await request.json();
  if (!phraseHash || !newPinHash || !newSalt || !newEncryptedVaultKey) {
    return corsResponse({ error: 'All fields required' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT vault_phrase_hash, vault_phrase_enc_key, vault_phrase_salt FROM users WHERE id = ?'
  ).bind(session.userId).first();

  if (!user?.vault_phrase_hash) return corsResponse({ error: 'Vault not configured' }, 404);
  if (user.vault_phrase_hash !== phraseHash) {
    return corsResponse({ error: 'Incorrect recovery phrase' }, 401);
  }

  await env.DB.prepare(`
    UPDATE users SET
      vault_pin_hash      = ?,
      vault_salt          = ?,
      vault_encrypted_key = ?,
      updated_at          = ?
    WHERE id = ?
  `).bind(newPinHash, newSalt, newEncryptedVaultKey, Date.now(), session.userId).run();

  return corsResponse({ success: true, phraseEncKey: user.vault_phrase_enc_key });
}

// ── V1 Salt endpoint ──────────────────────────────────────────
async function vaultSaltEndpoint(env, session) {
  const user = await env.DB.prepare(
    'SELECT vault_salt, vault_phrase_salt FROM users WHERE id = ?'
  ).bind(session.userId).first();
  if (!user?.vault_salt) return corsResponse({ error: 'Vault not configured' }, 404);
  return corsResponse({ salt: user.vault_salt, phraseSalt: user.vault_phrase_salt });
}

// ── V2 Setup ──────────────────────────────────────────────────
async function vaultSetupV2(request, env, session) {
  const {
    encryptedPrivateKey, privateKeyIv, privateKeySalt,
    pinHash, pinSalt,
    phraseHash, phraseSalt,
    recoveryPhraseEncrypted, recoveryPhraseSalt, recoveryPhraseIv,
    publicKey,
  } = await request.json();

  if (!encryptedPrivateKey || !privateKeyIv || !privateKeySalt || !pinHash || !pinSalt || !publicKey) {
    return corsResponse({ error: 'encryptedPrivateKey, privateKeyIv, privateKeySalt, pinHash, pinSalt, publicKey required' }, 400);
  }

  const existing = await env.DB.prepare('SELECT user_id FROM vault_config WHERE user_id = ?').bind(session.userId).first();
  if (existing) return corsResponse({ error: 'Vault v2 already configured' }, 409);

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO vault_config (user_id, encrypted_private_key, private_key_iv, private_key_salt,
        pin_hash, pin_salt, phrase_hash, phrase_salt,
        recovery_phrase_encrypted, recovery_phrase_salt, recovery_phrase_iv, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      session.userId, encryptedPrivateKey, privateKeyIv, privateKeySalt,
      pinHash, pinSalt,
      phraseHash || null, phraseSalt || null,
      recoveryPhraseEncrypted || null, recoveryPhraseSalt || null, recoveryPhraseIv || null,
      now
    ),
    env.DB.prepare('UPDATE users SET public_key = ?, vault_setup_at = ?, updated_at = ? WHERE id = ?')
      .bind(publicKey, now, now, session.userId),
  ]);

  return corsResponse({ success: true });
}

// ── V2 Config ─────────────────────────────────────────────────
async function vaultConfigV2(env, session) {
  const config = await env.DB.prepare('SELECT * FROM vault_config WHERE user_id = ?').bind(session.userId).first();
  if (!config) return corsResponse({ error: 'Vault v2 not configured' }, 404);
  return corsResponse({
    encryptedPrivateKey:     config.encrypted_private_key,
    privateKeyIv:            config.private_key_iv,
    privateKeySalt:          config.private_key_salt,
    pinHash:                 config.pin_hash,
    pinSalt:                 config.pin_salt,
    phraseHash:              config.phrase_hash,
    recoveryPhraseEncrypted: config.recovery_phrase_encrypted,
    recoveryPhraseSalt:      config.recovery_phrase_salt,
    recoveryPhraseIv:        config.recovery_phrase_iv,
  });
}

// ── V2 Verify PIN ─────────────────────────────────────────────
async function verifyPinV2(request, env, session) {
  const { pinHash } = await request.json();
  if (!pinHash) return corsResponse({ error: 'pinHash required' }, 400);

  const config = await env.DB.prepare('SELECT * FROM vault_config WHERE user_id = ?').bind(session.userId).first();
  if (!config) return corsResponse({ error: 'Vault v2 not configured' }, 404);

  if (config.pin_hash !== pinHash) {
    const attempts = await incrementPinAttempts(env, session.userId);
    if (attempts >= 5) return corsResponse({ error: 'Too many attempts. Try again in 30 minutes.', locked: true }, 429);
    return corsResponse({ error: 'Incorrect PIN', attemptsRemaining: 5 - attempts }, 401);
  }

  await env.KV.delete(`pin_attempts:${session.userId}`).catch(() => {});

  return corsResponse({
    encryptedPrivateKey: config.encrypted_private_key,
    privateKeyIv:        config.private_key_iv,
    privateKeySalt:      config.private_key_salt,
  });
}

// ── V2 Recover ────────────────────────────────────────────────
async function recoverVaultV2(request, env, session) {
  const {
    phraseHash,
    newPinHash, newPinSalt,
    newEncryptedPrivateKey, newPrivateKeyIv, newPrivateKeySalt,
  } = await request.json();

  if (!phraseHash || !newPinHash || !newPinSalt || !newEncryptedPrivateKey) {
    return corsResponse({ error: 'All fields required' }, 400);
  }

  const config = await env.DB.prepare('SELECT * FROM vault_config WHERE user_id = ?').bind(session.userId).first();
  if (!config) return corsResponse({ error: 'Vault v2 not configured' }, 404);

  if (!config.recovery_phrase_encrypted) return corsResponse({ error: 'No recovery phrase configured' }, 400);

  if (config.phrase_hash && phraseHash !== config.phrase_hash) {
    return corsResponse({ error: 'Incorrect recovery phrase' }, 401);
  }

  await env.DB.prepare(`
    UPDATE vault_config SET
      pin_hash = ?, pin_salt = ?,
      encrypted_private_key = ?, private_key_iv = ?, private_key_salt = ?
    WHERE user_id = ?
  `).bind(
    newPinHash, newPinSalt,
    newEncryptedPrivateKey, newPrivateKeyIv || config.private_key_iv, newPrivateKeySalt || config.private_key_salt,
    session.userId
  ).run();

  return corsResponse({
    success: true,
    recoveryPhraseEncrypted: config.recovery_phrase_encrypted,
    recoveryPhraseSalt:      config.recovery_phrase_salt,
    recoveryPhraseIv:        config.recovery_phrase_iv,
  });
}

// ── Store file key ────────────────────────────────────────────
async function storeFileKey(request, env, session) {
  const { fileId, encryptedDek, dekNonce, ephemeralPublicKey } = await request.json();
  if (!fileId || !encryptedDek || !dekNonce || !ephemeralPublicKey) {
    return corsResponse({ error: 'fileId, encryptedDek, dekNonce, ephemeralPublicKey required' }, 400);
  }

  // Verify file belongs to user
  const file = await env.DB.prepare(
    'SELECT id FROM files WHERE id = ? AND user_id = ?'
  ).bind(fileId, session.userId).first();
  if (!file) return corsResponse({ error: 'File not found' }, 404);

  // Upsert — same file can only have one DEK per user
  const existing = await env.DB.prepare(
    'SELECT id FROM file_keys WHERE file_id = ? AND user_id = ?'
  ).bind(fileId, session.userId).first();

  if (existing) {
    await env.DB.prepare(`
      UPDATE file_keys SET encrypted_dek = ?, dek_nonce = ?, ephemeral_public_key = ?
      WHERE file_id = ? AND user_id = ?
    `).bind(encryptedDek, dekNonce, ephemeralPublicKey, fileId, session.userId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO file_keys (id, file_id, user_id, encrypted_dek, dek_nonce, ephemeral_public_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(newId(), fileId, session.userId, encryptedDek, dekNonce, ephemeralPublicKey, Date.now()).run();
  }

  return corsResponse({ success: true });
}

// ── Get file key ──────────────────────────────────────────────
async function getFileKey(fileId, env, session) {
  // Access control: only file owner or authorized team member
  const file = await env.DB.prepare(
    `SELECT f.user_id, f.team_id FROM files f
     LEFT JOIN team_members tm ON tm.team_id = f.team_id AND tm.user_id = ? AND tm.status = 'active'
     WHERE f.id = ? AND f.deleted_at IS NULL`
  ).bind(session.userId, fileId).first();

  if (!file) return corsResponse({ error: 'File not found' }, 404);
  if (file.user_id !== session.userId && !file.team_id) {
    return corsResponse({ error: 'Access denied' }, 403);
  }

  const key = await env.DB.prepare(
    'SELECT encrypted_dek, dek_nonce, ephemeral_public_key FROM file_keys WHERE file_id = ? AND user_id = ?'
  ).bind(fileId, session.userId).first();

  if (!key) return corsResponse({ error: 'File key not found' }, 404);

  return corsResponse({
    encryptedDek:       key.encrypted_dek,
    dekNonce:           key.dek_nonce,
    ephemeralPublicKey: key.ephemeral_public_key,
  });
}

// ── Reset vault — permanently delete all vault files + config ──────────────
async function resetVault(request, env, session) {
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== 'DELETE_VAULT') {
    return corsResponse({ error: 'Confirmation required' }, 400);
  }

  // Collect all vault files (active + already trashed)
  const { results: active }  = await env.DB.prepare(
    'SELECT id, size_bytes, storage_key, bucket, version_of FROM files WHERE user_id = ? AND is_vault = 1 AND deleted_at IS NULL'
  ).bind(session.userId).all();

  const { results: trashed } = await env.DB.prepare(
    'SELECT id, size_bytes, storage_key, bucket, version_of FROM files WHERE user_id = ? AND is_vault = 1 AND deleted_at IS NOT NULL'
  ).bind(session.userId).all();

  const allFiles  = [...active, ...trashed];
  const canonical = active.filter(f => !f.version_of);
  const totalBytes = canonical.reduce((s, f) => s + (f.size_bytes || 0), 0);

  if (allFiles.length > 0) {
    const allIds = allFiles.map(f => f.id);

    // Delete file_keys
    for (let i = 0; i < allIds.length; i += 50) {
      const batch = allIds.slice(i, i + 50);
      await env.DB.prepare(`DELETE FROM file_keys WHERE file_id IN (${batch.map(()=>'?').join(',')})`).bind(...batch).run();
    }

    // Delete from D1
    for (let i = 0; i < allIds.length; i += 50) {
      const batch = allIds.slice(i, i + 50);
      await env.DB.prepare(`DELETE FROM files WHERE id IN (${batch.map(()=>'?').join(',')})`).bind(...batch).run();
    }

    // Queue B2 deletion for each file
    for (const f of allFiles) {
      await env.QUEUE.send({ type: 'DELETE_FILE_FROM_BUCKET', fileId: f.id, storageKey: f.storage_key, bucket: f.bucket, deleteFromD1: false });
    }

    // Adjust storage counter
    if (totalBytes > 0) {
      const { decrementStorageBytes, buildAccumulationBatch } = await import('../shared/utils.js');
      await env.DB.batch(buildAccumulationBatch(session.userId, env.DB, -totalBytes));
      await decrementStorageBytes(env, session.userId, totalBytes);
    }
  }

  // Delete vault folders
  await env.DB.prepare('DELETE FROM folders WHERE user_id = ? AND is_vault = 1').bind(session.userId).run();

  // Delete any remaining file_keys for this user
  await env.DB.prepare('DELETE FROM file_keys WHERE user_id = ?').bind(session.userId).run();

  // Delete v2 vault config
  await env.DB.prepare('DELETE FROM vault_config WHERE user_id = ?').bind(session.userId).run();

  // Reset v1 vault columns
  await env.DB.prepare(`
    UPDATE users SET
      vault_pin_hash = NULL, vault_salt = NULL, vault_encrypted_key = NULL,
      vault_phrase_salt = NULL, vault_phrase_hash = NULL, vault_phrase_enc_key = NULL,
      vault_setup_at = NULL, updated_at = ?
    WHERE id = ?
  `).bind(Date.now(), session.userId).run();

  return corsResponse({ success: true, filesDeleted: allFiles.length });
}

// ── Get public key of another user ───────────────────────────
async function getPublicKey(targetUserId, env, session) {
  // Only used for team key distribution — caller must be in same team as target
  const user = await env.DB.prepare(
    'SELECT public_key FROM users WHERE id = ?'
  ).bind(targetUserId).first();

  if (!user?.public_key) return corsResponse({ error: 'User has no public key' }, 404);
  return corsResponse({ publicKey: user.public_key });
}

// ── PIN attempt rate limiting ─────────────────────────────────
async function incrementPinAttempts(env, userId) {
  const key     = `pin_attempts:${userId}`;
  const current = parseInt(await env.KV.get(key) || '0');
  const next    = current + 1;
  await env.KV.put(key, String(next), { expirationTtl: 1800 });
  return next;
}
