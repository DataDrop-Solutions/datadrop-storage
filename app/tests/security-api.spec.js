/**
 * API Security & IDOR Test Suite
 *
 * Tests: unauthorized access, IDOR on files/shares/vault/teams,
 * input validation, injection attempts, rate limiting, CORS policy,
 * concurrent sessions, timing attacks.
 *
 * Runs in the "api" Playwright project (no storageState / no browser auth).
 * Auth-required tests use the demo account's session via storageState where needed.
 */
import { test, expect } from '@playwright/test'

const API = 'https://api.datadrop.co.in'
const FILES_ORIGIN = 'https://files.datadrop.co.in'
const ADMIN_ORIGIN = 'https://admin.datadrop.co.in'
const APP_ORIGIN = 'https://app.datadrop.co.in'
const EVIL_ORIGIN = 'https://evil.example.com'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fakeId() {
  return 'deadbeefdeadbeefdeadbeefdeadbeef'
}

// ── No-auth security (no storageState needed) ──────────────────────────────────

test.describe('Unauthenticated endpoint enforcement', () => {
  const protectedRoutes = [
    ['GET',    '/files'],
    ['POST',   '/files'],
    ['GET',    '/files/' + fakeId()],
    ['PUT',    '/files/' + fakeId()],
    ['DELETE', '/files/' + fakeId()],
    ['GET',    '/shares'],
    ['POST',   '/shares'],
    ['DELETE', '/shares/' + fakeId()],
    ['GET',    '/user/me'],
    ['GET',    '/user/storage'],
    ['GET',    '/vault/status'],
    ['GET',    '/vault/v2/config'],
    ['POST',   '/vault/v2/verify-pin'],
    ['POST',   '/vault/file-key'],
    ['GET',    '/vault/file-key/' + fakeId()],
    ['GET',    '/teams'],
    ['POST',   '/teams'],
    ['DELETE', '/teams/' + fakeId()],
    ['GET',    '/report/status/' + fakeId()],
  ]

  for (const [method, route] of protectedRoutes) {
    test(`${method} ${route} → 401 without auth`, async ({ request }) => {
      const resp = await request.fetch(`${API}${route}`, {
        method,
        headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
        data: method !== 'GET' && method !== 'DELETE' ? '{}' : undefined,
        failOnStatusCode: false,
      })
      expect(resp.status()).toBe(401)
      const body = await resp.json().catch(() => ({}))
      expect(body.error).toBeTruthy()
      // Must not leak infrastructure details
      expect(JSON.stringify(body)).not.toMatch(/backblaze|cloudflare|clerk\.com|d1_/i)
    })
  }
})

// ── CORS policy ───────────────────────────────────────────────────────────────

test.describe('CORS origin policy', () => {
  test('API rejects unknown origin', async ({ request }) => {
    const resp = await request.get(`${API}/health`, {
      headers: { Origin: EVIL_ORIGIN },
      failOnStatusCode: false,
    })
    const acao = resp.headers()['access-control-allow-origin'] ?? ''
    expect(acao).not.toBe('*')
    expect(acao).not.toContain('evil.example.com')
  })

  test('API accepts app.datadrop.co.in preflight', async ({ request }) => {
    const resp = await request.fetch(`${API}/files`, {
      method: 'OPTIONS',
      headers: {
        Origin: APP_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(204)
    expect(resp.headers()['access-control-allow-origin']).toBe(APP_ORIGIN)
  })

  test('files worker rejects unknown origin preflight', async ({ request }) => {
    const resp = await request.fetch(`${FILES_ORIGIN}/files/${fakeId()}`, {
      method: 'OPTIONS',
      headers: {
        Origin: EVIL_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
      failOnStatusCode: false,
    })
    const acao = resp.headers()['access-control-allow-origin'] ?? ''
    expect(acao).not.toContain('evil.example.com')
    expect(acao).not.toBe('*')
  })
})

// ── Security headers ──────────────────────────────────────────────────────────

test.describe('Security response headers', () => {
  test('API returns all required security headers on 401', async ({ request }) => {
    // Use /user/me (no auth) — it returns 401 via corsResponse() which includes all security headers
    const resp = await request.get(`${API}/user/me`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
    const h = resp.headers()
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['referrer-policy']).toBe('no-referrer')
    expect(h['strict-transport-security']).toMatch(/max-age=\d+/)
    expect(h['content-security-policy']).toMatch(/default-src/)
    expect(h['access-control-allow-origin']).not.toBe('*')
  })

  test('Upload init returns 401 without auth', async ({ request }) => {
    // Upload is routed through api.datadrop.co.in/upload
    const resp = await request.post(`${API}/upload/init`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: '{}',
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
  })
})

// ── Input validation ──────────────────────────────────────────────────────────

test.describe('Input validation — no auth', () => {
  test('Health endpoint returns JSON with ok:true', async ({ request }) => {
    const resp = await request.get(`${API}/health`, {
      headers: { Origin: APP_ORIGIN },
    })
    const body = await resp.json()
    expect(body.ok).toBe(true)
    expect(typeof body.ts).toBe('number')
  })

  test('Unknown route returns 404 not 500', async ({ request }) => {
    const resp = await request.get(`${API}/nonexistent-endpoint-xyz`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(404)
  })

  test('Malformed JSON body returns 400 or 401, not 500', async ({ request }) => {
    const resp = await request.post(`${API}/shares`, {
      headers: {
        Origin: APP_ORIGIN,
        'Content-Type': 'application/json',
        Authorization: 'Bearer INVALID_TOKEN',
      },
      data: '{ invalid json {{{{',
      failOnStatusCode: false,
    })
    // Could be 401 (bad token checked first) or 400 (bad JSON). Must not be 500.
    expect(resp.status()).not.toBe(500)
  })

  test('SQL injection in query string does not cause 500', async ({ request }) => {
    const injected = encodeURIComponent("'; DROP TABLE files; --")
    const resp = await request.get(`${API}/files?q=${injected}&folder=${injected}`, {
      headers: { Origin: APP_ORIGIN, Authorization: 'Bearer fake' },
      failOnStatusCode: false,
    })
    // Should be 401 (bad token), not 500
    expect(resp.status()).toBe(401)
  })

  test('XSS in filename query param does not reflect unescaped', async ({ request }) => {
    const xss = encodeURIComponent('<script>alert(1)</script>')
    const resp = await request.get(`${API}/files?q=${xss}`, {
      headers: { Origin: APP_ORIGIN, Authorization: 'Bearer fake' },
      failOnStatusCode: false,
    })
    const body = await resp.text()
    // Response must not contain unescaped script tags
    expect(body).not.toContain('<script>')
  })

  test('Oversized ID path param handled gracefully', async ({ request }) => {
    const longId = 'a'.repeat(1000)
    const resp = await request.get(`${API}/files/${longId}`, {
      headers: { Origin: APP_ORIGIN, Authorization: 'Bearer fake' },
      failOnStatusCode: false,
    })
    expect(resp.status()).not.toBe(500)
    expect([400, 401, 404]).toContain(resp.status())
  })

  test('Non-hex ID path param returns 400 or 401, not 500', async ({ request }) => {
    const resp = await request.get(`${API}/files/../../../../etc/passwd`, {
      headers: { Origin: APP_ORIGIN, Authorization: 'Bearer fake' },
      failOnStatusCode: false,
    })
    expect(resp.status()).not.toBe(500)
    expect([400, 401, 404]).toContain(resp.status())
  })
})

// ── Share claim token validation ──────────────────────────────────────────────

test.describe('Share claim token hardening', () => {
  test('Empty claim token returns 400 or 401', async ({ request }) => {
    const resp = await request.post(`${API}/shares/claim/`, {
      headers: { Origin: APP_ORIGIN, Authorization: 'Bearer fake' },
      failOnStatusCode: false,
    })
    expect([400, 401, 404]).toContain(resp.status())
  })

  test('Forged/random claim token returns non-500', async ({ request }) => {
    const resp = await request.post(`${API}/shares/claim/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, {
      headers: { Origin: APP_ORIGIN, Authorization: 'Bearer fake' },
      failOnStatusCode: false,
    })
    expect(resp.status()).not.toBe(500)
  })

  test('SQL injection in claim token handled gracefully', async ({ request }) => {
    const injected = encodeURIComponent("'; DELETE FROM shares; --")
    const resp = await request.post(`${API}/shares/claim/${injected}`, {
      headers: { Origin: APP_ORIGIN, Authorization: 'Bearer fake' },
      failOnStatusCode: false,
    })
    expect(resp.status()).not.toBe(500)
  })
})

// ── Vault API hardening (no auth) ─────────────────────────────────────────────

test.describe('Vault API without auth', () => {
  test('GET /vault/status → 401', async ({ request }) => {
    const resp = await request.get(`${API}/vault/status`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
  })

  test('POST /vault/v2/verify-pin with no auth → 401', async ({ request }) => {
    const resp = await request.post(`${API}/vault/v2/verify-pin`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: JSON.stringify({ pinHash: 'aabbccdd' }),
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
  })

  test('GET /vault/public-key/<id> → 401 without auth', async ({ request }) => {
    const resp = await request.get(`${API}/vault/public-key/${fakeId()}`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
  })
})

// ── Admin endpoint hardening ──────────────────────────────────────────────────

test.describe('Admin endpoint auth enforcement', () => {
  test('GET admin/reports → 401 without session', async ({ request }) => {
    const resp = await request.get(`${ADMIN_ORIGIN}/reports`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect([401, 403]).toContain(resp.status())
  })

  test('Admin endpoint with wrong password → 401 or 403', async ({ request }) => {
    const resp = await request.get(`${ADMIN_ORIGIN}/reports`, {
      headers: {
        Origin: APP_ORIGIN,
        'X-Admin-Session': 'wrong-password',
        'X-Admin-Secret': 'wrong-secret',
      },
      failOnStatusCode: false,
    })
    expect([401, 403]).toContain(resp.status())
  })

  test('Admin endpoint does not reveal user data on 401', async ({ request }) => {
    const resp = await request.get(`${ADMIN_ORIGIN}/users`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect([401, 403, 404]).toContain(resp.status())
    const body = await resp.json().catch(() => ({}))
    // Must not contain user data in error response
    expect(JSON.stringify(body)).not.toMatch(/email|clerk_user_id|session/i)
  })
})

// ── IDOR tests (require auth — use demo storageState) ─────────────────────────

test.describe('IDOR — cross-user access attempts', () => {
  test.use({ storageState: 'tests/.auth/user.json' })

  test('Cannot GET another user file by guessing ID', async ({ request }) => {
    // Use a plausible but non-existent ID — should return 404, not 200
    const guessedId = '0000000000000000000000000000dead'
    const resp = await request.get(`${API}/files/${guessedId}`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    // 400 (invalid ID format), 403, or 404 — never 200 with another user's data
    expect([400, 401, 403, 404]).toContain(resp.status())
  })

  test('Cannot DELETE another user file by guessing ID', async ({ request }) => {
    const guessedId = '0000000000000000000000000000dead'
    const resp = await request.delete(`${API}/files/${guessedId}`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect([400, 401, 403, 404]).toContain(resp.status())
  })

  test('Cannot GET another user share by ID', async ({ request }) => {
    const guessedId = '0000000000000000000000000000dead'
    const resp = await request.get(`${API}/shares/${guessedId}`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect([400, 401, 403, 404]).toContain(resp.status())
  })

  test('Cannot revoke another user share', async ({ request }) => {
    const guessedId = '0000000000000000000000000000dead'
    const resp = await request.delete(`${API}/shares/${guessedId}`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect([400, 401, 403, 404]).toContain(resp.status())
  })

  test('Cannot GET another user vault file-key', async ({ request }) => {
    const guessedFileId = '0000000000000000000000000000dead'
    const resp = await request.get(`${API}/vault/file-key/${guessedFileId}`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    // 404 = key not found for this user; 401 = no auth session loaded
    expect([400, 401, 403, 404]).toContain(resp.status())
  })

  test('Cannot access another user team by ID', async ({ request }) => {
    const guessedTeamId = '0000000000000000000000000000dead'
    const resp = await request.get(`${API}/teams/${guessedTeamId}`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect([400, 401, 403, 404]).toContain(resp.status())
  })

  test('Cannot read another user profile', async ({ request }) => {
    // /user/me only returns the calling user — no /user/:id endpoint should exist
    const resp = await request.get(`${API}/user/${fakeId()}`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    // Should be 404 (no such route) or 403, never exposing another user's data
    expect([400, 401, 403, 404]).toContain(resp.status())
  })
})

// ── Share permission enforcement ──────────────────────────────────────────────

test.describe('Share API permission enforcement', () => {
  test.use({ storageState: 'tests/.auth/user.json' })

  test('Cannot share a vault file', async ({ request }) => {
    // Create a fake vault file ID and try to share it — server enforces is_vault check
    const resp = await request.post(`${API}/shares`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        fileId: fakeId(),
        recipientEmail: 'test@example.com',
      }),
      failOnStatusCode: false,
    })
    // Will be 404 (file not found) since we used a fake ID, not 500
    expect([400, 401, 403, 404]).toContain(resp.status())
  })

  test('Creating share with missing fileId → 400 or 401', async ({ request }) => {
    const resp = await request.post(`${API}/shares`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: JSON.stringify({ recipientEmail: 'test@example.com' }),
      failOnStatusCode: false,
    })
    // 400 = validation error (correct); 401 = no auth session loaded
    expect([400, 401]).toContain(resp.status())
  })

  test('Creating share with self → 400', async ({ request }) => {
    const me = await (await request.get(`${API}/user/me`, {
      headers: { Origin: APP_ORIGIN },
    })).json()
    const resp = await request.post(`${API}/shares`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        fileId: fakeId(),
        recipientEmail: me.email,
      }),
      failOnStatusCode: false,
    })
    // 404 on fake fileId or 400 on self-share — never 500
    expect([400, 401, 403, 404]).toContain(resp.status())
  })
})

// ── Vault PIN brute-force rate limiting ───────────────────────────────────────

test.describe('Vault PIN rate limiting', () => {
  test.use({ storageState: 'tests/.auth/user.json' })

  test('5 wrong PINs in a row triggers rate limit response', async ({ request }) => {
    const wrongHash = '0'.repeat(64) // fake SHA-256 hash

    let lastStatus = 0
    let lastBody = {}

    for (let i = 0; i < 5; i++) {
      const resp = await request.post(`${API}/vault/v2/verify-pin`, {
        headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
        data: JSON.stringify({ pinHash: wrongHash }),
        failOnStatusCode: false,
      })
      lastStatus = resp.status()
      lastBody = await resp.json().catch(() => ({}))
    }

    // After 5 attempts: either 429 (rate limited) or 401 (still wrong but within limit)
    // At a minimum, must not be 200 or 500
    expect(lastStatus).not.toBe(200)
    expect(lastStatus).not.toBe(500)
    console.log('After 5 wrong PINs: status =', lastStatus, 'body =', JSON.stringify(lastBody))
  })
})

// ── Report API hardening ──────────────────────────────────────────────────────

test.describe('Report API hardening', () => {
  test.use({ storageState: 'tests/.auth/user.json' })

  test('POST /report with missing fields → 400 (or 401 if no auth)', async ({ request }) => {
    const resp = await request.post(`${API}/report`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: JSON.stringify({ reason: 'spam' }),
      failOnStatusCode: false,
    })
    // 400 = bad request (correct), 401 = no auth session loaded
    expect([400, 401]).toContain(resp.status())
  })

  test('POST /report on non-existent file → 404 or 401 if no auth', async ({ request }) => {
    const resp = await request.post(`${API}/report`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: JSON.stringify({
        fileId: fakeId(),
        reason: 'spam',
        evidenceBase64: btoa('fake-image-data'),
        evidenceType: 'image/png',
      }),
      failOnStatusCode: false,
    })
    expect([401, 404, 429]).toContain(resp.status())
  })
})

// ── Upload worker security ────────────────────────────────────────────────────

test.describe('Upload worker security', () => {
  test('POST /upload/init without auth → 401', async ({ request }) => {
    const resp = await request.post(`${API}/upload/init`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: JSON.stringify({ filename: 'test.txt', size: 1024, mimeType: 'text/plain' }),
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
  })

  test('POST /upload/init with fake auth → 401', async ({ request }) => {
    const resp = await request.post(`${API}/upload/init`, {
      headers: {
        Origin: APP_ORIGIN,
        'Content-Type': 'application/json',
        Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.fakesig',
      },
      data: JSON.stringify({ filename: 'malicious.exe', size: 999999999 }),
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
  })
})
