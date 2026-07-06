// DataDrop API client
const BASE       = import.meta.env.VITE_API_URL   || 'https://api.datadrop.co.in';
const FILES_BASE = import.meta.env.VITE_FILES_URL  || 'https://files.datadrop.co.in';

let _getToken = null;
export function setTokenProvider(fn) { _getToken = fn; }

async function req(method, path, body, raw = false) {
  const token = _getToken ? await _getToken() : null;
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status, data: err });
  }
  return res.json();
}

export const api = {
  // User
  me:               ()      => req('GET',  '/user/me'),
  updateMe:         (data)  => req('PUT',  '/user/me', data),
  storageMeter:     ()      => req('GET',  '/user/storage'),

  // Wallet
  wallet:           ()      => req('GET',  '/user/wallet'),
  initiateTopup:    (data)  => req('POST', '/user/wallet/topup', data),
  confirmTopup:     (data)  => req('POST', '/user/wallet/confirm', data),

  // Ad-free
  subscribeAdFree:  ()      => req('POST', '/user/adfree/subscribe'),
  cancelAdFree:     ()      => req('DELETE','/user/adfree'),

  // Files
  listFiles:        (params)=> req('GET',  `/files?${new URLSearchParams(params)}`),
  getFile:          (id)    => req('GET',  `/files/${id}`),
  updateFile:       (id, d) => req('PUT',  `/files/${id}`, d),
  deleteFile:       (id)    => req('DELETE',`/files/${id}`),
  permanentDeleteFile: (id) => req('DELETE',`/files/${id}/permanent`),
  restoreFile:      (id)    => req('POST', `/files/${id}/restore`),
  getVersions:      (id)    => req('GET',  `/files/${id}/versions`),
  deleteVersion:    (id, vid) => req('DELETE', `/files/${id}/versions/${vid}`),

  // Upload
  checkDedup:       (data)  => req('POST', '/upload/dedup', data),
  initUpload:       (data)  => req('POST', '/upload/init', data),
  confirmUpload:    (data)  => req('POST', '/upload/confirm', data),

  // Folders
  createFolder:          (data)  => req('POST',   '/files/folder', data),
  deleteFolder:          (id)    => req('DELETE',  `/files/folder/${id}`),
  permanentDeleteFolder: (id)    => req('DELETE',  `/files/folder/${id}/permanent`),
  restoreFolder:         (id)    => req('POST',    `/files/folder/${id}/restore`),
  renameFolder:          (id, d) => req('PUT',     `/files/folder/${id}`, d),
  moveFolderToVault:     (id, d) => req('POST',    `/files/folder/${id}/vault`, d),

  // Trash
  emptyTrash:       ()      => req('DELETE','/files/trash'),

  // Shares
  createShare:      (data)  => req('POST', '/shares', data),
  listShares:       (p)     => req('GET',  `/shares?${new URLSearchParams(p||{})}`),
  listReceived:     ()      => req('GET',  '/shares/received'),
  getShare:         (id)    => req('GET',  `/shares/${id}`),
  updateShare:      (id, d) => req('PUT',  `/shares/${id}`, d),
  revokeShare:      (id)    => req('DELETE',`/shares/${id}`),
  claimInvite:      (token) => req('POST', `/shares/claim/${token}`),
  transferFile:     (data)  => req('POST', '/shares/transfer', data),
  acceptMove:       (id)    => req('POST', `/shares/${id}/accept-move`),
  confirmReceipt:   (id)    => req('POST', `/shares/${id}/confirm-receipt`),
  dismissShare:     (id)    => req('POST', `/shares/${id}/dismiss`),
  listSharedFolder: (shareId, folderId) => req('GET', `/shares/${shareId}/files${folderId ? `?folder=${folderId}` : ''}`),
  shareStatus:      (id)    => req('GET',  `/report/status/${id}`),
  submitReport:     (data)  => req('POST', '/report', data),
  submitReport:     (data)  => req('POST', '/report', data),

  // Stream token
  streamToken:      (id)    => req('POST', `/stream/${id}/token`),

  // Teams
  listTeams:        ()             => req('GET',  '/teams'),
  createTeam:       (data)         => req('POST', '/teams', data),
  getTeam:          (id)           => req('GET',  `/teams/${id}`),
  dissolveTeam:     (id)           => req('DELETE',`/teams/${id}`),
  inviteMember:     (id, data)     => req('POST', `/teams/${id}/invite`, data),
  changeMemberRole: (id, mid, d)   => req('PUT',  `/teams/${id}/members/${mid}`, d),
  removeMember:     (id, mid)      => req('DELETE',`/teams/${id}/members/${mid}`),
  leaveTeam:        (id)           => req('DELETE',`/teams/${id}/leave`),
  listInvites:      ()             => req('GET',  '/teams/invites'),
  acceptInvite:     (token)        => req('POST', `/teams/invites/${token}/accept`),

  // Team ECDH key distribution
  storeTeamKey:     (id, data)     => req('POST',  `/teams/${id}/keys`, data),
  getTeamKey:       (id, uid)      => req('GET',   `/teams/${id}/keys/${uid}`),
  listTeamKeys:     (id)           => req('GET',   `/teams/${id}/keys`),
  revokeTeamKey:    (id, uid)      => req('DELETE',`/teams/${id}/keys/${uid}`),

  // Team workspace
  listTeamFiles:         (id, params)        => req('GET',  `/teams/${id}/files${params ? '?' + new URLSearchParams(params) : ''}`),
  createTeamFolder:      (id, data)          => req('POST', `/teams/${id}/files/folder`, data),
  deleteTeamFolder:      (id, fid)           => req('DELETE',`/teams/${id}/files/folder/${fid}`),
  deleteTeamFile:        (id, fid)           => req('DELETE',`/teams/${id}/files/${fid}`),
  promoteTeamFileVersion:(id, fid, data)     => req('PUT',  `/teams/${id}/files/${fid}`, data),
  listTeamFileVersions:  (id, fid)           => req('GET',  `/teams/${id}/files/${fid}/versions`),

  // Storage breakdown
  storageBreakdown: () => req('GET', '/user/storage/breakdown'),

  // Vault v2 (ECDH)
  vaultStatus:     ()      => req('GET',  '/vault/status'),
  vaultSalt:       ()      => req('GET',  '/vault/salt'),
  vaultSetup:      (data)  => req('POST', '/vault/setup', data),
  verifyPin:       (data)  => req('POST', '/vault/verify-pin', data),
  recoverVault:    (data)  => req('POST', '/vault/recover', data),
  vaultSetupV2:    (data)  => req('POST', '/vault/v2/setup', data),
  vaultConfigV2:   ()      => req('GET',  '/vault/v2/config'),
  verifyPinV2:     (data)  => req('POST', '/vault/v2/verify-pin', data),
  recoverVaultV2:  (data)  => req('POST', '/vault/v2/recover', data),
  storeVaultFileKey: (data)=> req('POST', '/vault/file-key', data),
  getVaultFileKey:  (id)   => req('GET',  `/vault/file-key/${id}`),
  resetVault:       ()     => req('DELETE', '/vault/reset', { confirm: 'DELETE_VAULT' }),
  getPublicKey:     (uid)  => req('GET',  `/vault/public-key/${uid}`),

  // Account
  deleteAccount: () => req('POST', '/user/me/delete'),
};

// File upload with progress
// meta.thumbData = base64 data URL thumbnail (sent in confirm body → stored in D1 by queue consumer)
export async function uploadFile(file, meta, onProgress) {
  const hash = meta.skipDedup ? null : await sha256(file);
  if (!meta.skipDedup) {
    const dedup = await api.checkDedup({ hash, folderId: meta.folderId });
    if (dedup.duplicate) return { fileId: dedup.existingFileId, duplicate: true };
  }

  const init = await api.initUpload({
    filename: file.name,
    mimeType: meta.mimeType || file.type,
    sizeBytes: file.size,
    folderId: meta.folderId || null,
    isVault: meta.isVault || false,
    quality: meta.quality || 'original',
    teamId: meta.teamId || null,
    hash,
  });

  if (file.size >= LARGE_FILE_THRESHOLD) {
    await uploadLargeFile(init.fileId, file, onProgress);
  } else {
    await uploadThroughProxy(init.fileId, file, onProgress);
  }

  await api.confirmUpload({
    fileId: init.fileId,
    thumbData: meta.thumbData || null,
  });

  return { fileId: init.fileId, duplicate: false };
}

const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024;  // 100 MB
const CHUNK_SIZE           =  10 * 1024 * 1024;  //  10 MB (B2 min is 5 MB per part)

// B2 multipart upload (files ≥ 100 MB): 10 MB chunks, client-side SHA-1 per part
async function uploadLargeFile(fileId, file, onProgress) {
  const token = _getToken ? await _getToken() : null;
  const auth  = token ? { Authorization: `Bearer ${token}` } : {};

  const startResp = await fetch(`${BASE}/upload/large/${fileId}/start`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId }),
  });
  if (!startResp.ok) throw new Error('Failed to start large file upload');

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const sha1Array   = [];

  for (let i = 0; i < totalChunks; i++) {
    const start    = i * CHUNK_SIZE;
    const end      = Math.min(start + CHUNK_SIZE, file.size);
    const chunkBuf = await file.slice(start, end).arrayBuffer();

    // SHA-1 computed client-side; B2 verifies it server-side
    const sha1Raw = await crypto.subtle.digest('SHA-1', chunkBuf);
    const sha1Hex = Array.from(new Uint8Array(sha1Raw))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    const partResp = await fetch(`${BASE}/upload/large/${fileId}/part/${i + 1}`, {
      method: 'POST',
      headers: {
        ...auth,
        'Content-Type':   'application/octet-stream',
        'Content-Length': String(chunkBuf.byteLength),
        'X-Chunk-Sha1':   sha1Hex,
      },
      body: chunkBuf,
    });

    if (!partResp.ok) {
      fetch(`${BASE}/upload/large/${fileId}/abort`, { method: 'POST', headers: auth }).catch(() => {});
      throw new Error(`Part ${i + 1} upload failed`);
    }

    const { partSha1 } = await partResp.json();
    sha1Array.push(partSha1 || sha1Hex);
    if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  const finishResp = await fetch(`${BASE}/upload/large/${fileId}/finish`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha1Array }),
  });
  if (!finishResp.ok) throw new Error('Failed to finalize large file upload');
}

async function uploadThroughProxy(fileId, file, onProgress) {
  const token = _getToken ? await _getToken() : null;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/upload/direct/${fileId}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.onload  = () => xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });
}

// ── Legacy vault crypto (v1 — single shared vault key) ────────
export async function encryptForVault(vaultKeyB64, arrayBuffer) {
  const rawKey = Uint8Array.from(atob(vaultKeyB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, arrayBuffer);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result.buffer;
}

export async function decryptFromVault(vaultKeyB64, encryptedBuffer) {
  const rawKey = Uint8Array.from(atob(vaultKeyB64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const bytes = new Uint8Array(encryptedBuffer);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
}

// ── V2 vault ECDH crypto ──────────────────────────────────────

// Generate ECDH P-256 keypair → returns { publicKeySpki, privateKeyPkcs8 } as base64 strings
export async function generateECDHKeypair() {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']
  );
  const [pubRaw, privRaw] = await Promise.all([
    crypto.subtle.exportKey('spki', keypair.publicKey),
    crypto.subtle.exportKey('pkcs8', keypair.privateKey),
  ]);
  return {
    publicKeySpki:   b64(pubRaw),
    privateKeyPkcs8: b64(privRaw),
  };
}

// Encrypt private key PKCS8 with PIN-derived PBKDF2 key
// Returns { encryptedPrivateKey, iv, salt } as base64 strings
export async function encryptPrivateKeyWithPin(privateKeyPkcs8B64, pin, saltB64) {
  const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 310000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const pkcs8Bytes = Uint8Array.from(atob(privateKeyPkcs8B64), c => c.charCodeAt(0));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, pkcs8Bytes);
  return {
    encryptedPrivateKey: b64(ciphertext),
    iv: b64(iv.buffer),
  };
}

// Decrypt private key using PIN → returns base64 PKCS8
export async function decryptPrivateKeyWithPin(encryptedPrivateKeyB64, ivB64, saltB64, pin) {
  const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 310000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );
  const cipherBytes = Uint8Array.from(atob(encryptedPrivateKeyB64), c => c.charCodeAt(0));
  const ivBytes     = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, wrappingKey, cipherBytes);
  return b64(pkcs8);
}

// Derive PIN hash for server verification: PBKDF2(pin, salt) → SHA-256 of raw key → base64
export async function derivePinHash(pin, saltB64) {
  const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 310000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, true, ['encrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return b64(digest);
}

// Wrap a DEK (Uint8Array) with recipient's ECDH P-256 public key (SPKI base64)
// Returns { encryptedDek, dekNonce, ephemeralPublicKey } as base64 strings
export async function wrapDEKWithPublicKey(dekBytes, recipientPublicKeySpkiB64) {
  const spkiBytes = Uint8Array.from(atob(recipientPublicKeySpkiB64), c => c.charCodeAt(0));
  const recipientPublicKey = await crypto.subtle.importKey(
    'spki', spkiBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  const ephemeralKeypair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
  );

  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: recipientPublicKey },
    ephemeralKeypair.privateKey,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encryptedDek = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, sharedKey, dekBytes);
  const ephemeralSpki = await crypto.subtle.exportKey('spki', ephemeralKeypair.publicKey);

  return {
    encryptedDek:       b64(encryptedDek),
    dekNonce:           b64(nonce.buffer),
    ephemeralPublicKey: b64(ephemeralSpki),
  };
}

// Unwrap a DEK using private key (PKCS8 base64) → returns Uint8Array DEK
export async function unwrapDEKWithPrivateKey(encryptedDekB64, dekNonceB64, ephemeralPublicKeyB64, privateKeyPkcs8B64) {
  const pkcs8Bytes  = Uint8Array.from(atob(privateKeyPkcs8B64), c => c.charCodeAt(0));
  const privateKey  = await crypto.subtle.importKey(
    'pkcs8', pkcs8Bytes, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']
  );

  const spkiBytes = Uint8Array.from(atob(ephemeralPublicKeyB64), c => c.charCodeAt(0));
  const ephemeralPublicKey = await crypto.subtle.importKey(
    'spki', spkiBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: ephemeralPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 }, false, ['decrypt']
  );

  const encDekBytes = Uint8Array.from(atob(encryptedDekB64), c => c.charCodeAt(0));
  const nonceBytes  = Uint8Array.from(atob(dekNonceB64), c => c.charCodeAt(0));
  const dek = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonceBytes }, sharedKey, encDekBytes);
  return new Uint8Array(dek);
}

// Encrypt arbitrary bytes with a DEK (Uint8Array) → returns ArrayBuffer (IV prefix + ciphertext)
export async function encryptWithDEK(dekBytes, plainBuffer) {
  const key = await crypto.subtle.importKey('raw', dekBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBuffer);
  const result = new Uint8Array(12 + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), 12);
  return result.buffer;
}

// Decrypt bytes with a DEK (Uint8Array) — expects IV prefix + ciphertext
export async function decryptWithDEK(dekBytes, encryptedBuffer) {
  const key = await crypto.subtle.importKey('raw', dekBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const bytes = new Uint8Array(encryptedBuffer);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
}

// ── File fetch helpers ────────────────────────────────────────

export async function fetchFileWithAuth(fileId, vaultKey = null) {
  const token = _getToken ? await _getToken() : null;
  const resp = await fetch(`${FILES_BASE}/files/${fileId}/preview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Failed (${resp.status})`);
  }
  if (vaultKey) {
    const enc = await resp.arrayBuffer();
    const dec = await decryptFromVault(vaultKey, enc);
    return new Response(dec, { headers: { 'Content-Type': 'application/octet-stream' } });
  }
  return resp;
}

export async function downloadFile(fileId, filename, vaultKey = null, dekBytes = null) {
  const token = _getToken ? await _getToken() : null;
  const resp = await fetch(`${FILES_BASE}/files/${fileId}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Download failed (${resp.status})`);
  }

  let blob;
  if (dekBytes) {
    const enc = await resp.arrayBuffer();
    const dec = await decryptWithDEK(dekBytes, enc);
    blob = new Blob([dec]);
  } else if (vaultKey) {
    const enc = await resp.arrayBuffer();
    const dec = await decryptFromVault(vaultKey, enc);
    blob = new Blob([dec]);
  } else {
    blob = await resp.blob();
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Download multiple files as a client-side zip (uses JSZip).
// Pass dekBytes to decrypt E2EE workspace files before zipping.
export async function downloadZip(files, dekBytes = null) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const token = _getToken ? await _getToken() : null;

  for (const file of files) {
    try {
      const resp = await fetch(`${FILES_BASE}/files/${file.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (resp.ok) {
        let data;
        if (dekBytes) {
          const enc = await resp.arrayBuffer();
          data = await decryptWithDEK(dekBytes, enc);
        } else {
          data = await resp.blob();
        }
        zip.file(file.filename || file.id, data);
      }
    } catch (_) {}
  }

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'datadrop-download.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function sha256(file) {
  const buf    = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Team E2E key derivation (legacy passphrase model) ─────────
export async function deriveTeamKey(passphrase, saltBase64) {
  const saltBytes = Uint8Array.from(atob(saltBase64), c => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase),
    'PBKDF2', false, ['deriveKey']
  );
  const teamKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, ['encrypt', 'decrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', teamKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

export function generateTeamSalt() {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...salt));
}

// Helper: ArrayBuffer → base64
function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

// Legacy vault API object (kept for compatibility)
export const vaultApi = {
  status:     ()      => api.vaultStatus(),
  salt:       ()      => api.vaultSalt(),
  setup:      (data)  => api.vaultSetup(data),
  verifyPin:  (data)  => api.verifyPin(data),
  recover:    (data)  => api.recoverVault(data),
}
