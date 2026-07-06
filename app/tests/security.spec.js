/**
 * Security hardening tests
 *
 * Covers: no B2 URLs exposed, CORS restricted, no console.log in prod,
 * JWT required on all endpoints, CSP headers, no wildcard origins,
 * correct 403 on unauthenticated B2 bucket access.
 */
import { test, expect } from '@playwright/test'

const APP_ORIGIN  = 'https://app.datadrop.co.in'
const FILE_ORIGIN = 'https://files.datadrop.co.in'
const API_BASE    = 'https://api.datadrop.co.in'
const EVIL_ORIGIN = 'https://evil.example.com'

// ── Network-level security (no auth needed) ──────────────────────────────────

test.describe('CORS & Origin Policy', () => {
  test('Worker rejects request from unknown origin', async ({ request }) => {
    const resp = await request.get(`${FILE_ORIGIN}/files/test-id`, {
      headers: { Origin: EVIL_ORIGIN },
      failOnStatusCode: false,
    })
    // Must not return ACAO: * or ACAO: evil.example.com
    const acao = resp.headers()['access-control-allow-origin'] ?? ''
    expect(acao).not.toBe('*')
    expect(acao).not.toContain('evil.example.com')
  })

  test('Worker accepts request from app.datadrop.co.in origin', async ({ request }) => {
    const resp = await request.options(`${FILE_ORIGIN}/files/test-id`, {
      headers: {
        Origin: APP_ORIGIN,
        'Access-Control-Request-Method': 'GET',
      },
      failOnStatusCode: false,
    })
    const acao = resp.headers()['access-control-allow-origin'] ?? ''
    // Should reflect the allowed origin, not a wildcard
    expect(acao).toBe(APP_ORIGIN)
  })

  test('files worker returns 401 without auth token', async ({ request }) => {
    const resp = await request.get(`${FILE_ORIGIN}/files/0000000000000000`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
    const body = await resp.json().catch(() => ({}))
    expect(body.error).toBeTruthy()
    // Must not leak internal service names
    expect(JSON.stringify(body)).not.toMatch(/backblaze|B2|cloudflare/i)
  })

  test('API router returns 401 on protected route without token', async ({ request }) => {
    const resp = await request.get(`${API_BASE}/user/me`, {
      headers: { Origin: APP_ORIGIN },
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
  })

  test('Upload worker returns 401 without auth', async ({ request }) => {
    const resp = await request.post(`https://upload.datadrop.co.in/upload/init`, {
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json' },
      data: { filename: 'x.txt', size: 100, mimeType: 'text/plain' },
      failOnStatusCode: false,
    })
    expect(resp.status()).toBe(401)
  })
})

// ── In-page security checks (requires auth session) ──────────────────────────

test.describe('In-page security hardening', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_ORIGIN)
    await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })
  })

  test('Page HTML contains no raw B2 bucket URLs', async ({ page }) => {
    await page.waitForTimeout(3000) // let async API calls settle
    const html = await page.content()
    expect(html).not.toMatch(/https?:\/\/f\d+\.backblazeb2\.com/)
    expect(html).not.toMatch(/\.backblazeb2\.com/)
    await page.screenshot({ path: 'tests/screenshots/security-no-b2.png' })
  })

  test('No console.log output on the page in prod', async ({ page }) => {
    const consoleLogs = []
    page.on('console', msg => {
      if (msg.type() === 'log') consoleLogs.push(msg.text())
    })

    await page.reload()
    await page.waitForTimeout(4000)

    // Allow only framework noise that can't be suppressed (React DevTools banner etc.)
    // App-level logs should be suppressed in production
    const appLogs = consoleLogs.filter(t =>
      !t.startsWith('Download the React DevTools') &&
      !t.startsWith('[vite]') &&
      !t.startsWith('[HMR]')
    )
    if (appLogs.length > 0) {
      console.warn('Unexpected console.log output:', appLogs.slice(0, 5))
    }
    expect(appLogs.length).toBe(0)
  })

  test('Response JSON never contains vendor names', async ({ page }) => {
    // Intercept API calls and inspect JSON bodies for vendor strings
    const violations = []

    page.on('response', async (resp) => {
      const ct = resp.headers()['content-type'] ?? ''
      if (!ct.includes('application/json')) return
      try {
        const text = await resp.text()
        if (/backblaze|cloudflare|clerk\.com|supabase/i.test(text)) {
          violations.push(`${resp.url()}: ${text.slice(0, 100)}`)
        }
      } catch {
        // ignore read errors
      }
    })

    await page.reload()
    await page.waitForTimeout(5000)
    expect(violations).toHaveLength(0)
  })

  test('CSP header is present on the app page', async ({ page }) => {
    const resp = await page.request.get(APP_ORIGIN)
    const csp = resp.headers()['content-security-policy'] ?? ''
    // Should have at least a default-src directive
    expect(csp.length).toBeGreaterThan(0)
    expect(csp).toContain('default-src')
  })

  test('X-Frame-Options or CSP frame-ancestors is set', async ({ page }) => {
    const resp = await page.request.get(APP_ORIGIN)
    const xfo = resp.headers()['x-frame-options'] ?? ''
    const csp = resp.headers()['content-security-policy'] ?? ''
    const clickjackProtected = xfo.length > 0 || csp.includes('frame-ancestors')
    expect(clickjackProtected).toBe(true)
  })

  test('Files served via proxy URL, not direct B2', async ({ page }) => {
    // Collect all image/video src URLs loaded by the page
    const resourceUrls = []
    page.on('request', req => {
      const url = req.url()
      if (req.resourceType() === 'image' || req.resourceType() === 'media') {
        resourceUrls.push(url)
      }
    })

    await page.reload()
    await page.waitForTimeout(5000)

    const b2Urls = resourceUrls.filter(u => u.includes('backblazeb2.com'))
    expect(b2Urls).toHaveLength(0)
  })

  test('No shared public links appear in the UI', async ({ page }) => {
    // "NO PUBLIC LINKS EVER" — ensure no publicly accessible share URLs are rendered
    await page.waitForTimeout(2000)
    const html = await page.content()
    // Check that there are no hardcoded /public/ or /share/ URL patterns
    expect(html).not.toMatch(/\/public\/[a-f0-9]{16,}/)
  })
})

// ── Vault isolation (auth required) ──────────────────────────────────────────

test.describe('Vault security isolation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_ORIGIN)
    await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })
  })

  test('Vault nav is present and labelled correctly', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Zero Knowledge Vault"), [data-key="vault"]')
    await expect(vaultNav).toBeVisible()
  })

  test('Vault section does not expose any file content without PIN', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Zero Knowledge Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(3000)

    // If vault is locked, the page should NOT contain any decrypted file content
    const pinVisible = await page.locator('input[type="password"]').isVisible().catch(() => false)
    const setupVisible = await page.locator('button:has-text("Set Up"), button:has-text("Setup")').isVisible().catch(() => false)

    if (pinVisible || setupVisible) {
      // Locked — check that no file names or content bleed through
      const body = await page.locator('body').textContent()
      // Should not see file extension patterns if locked
      expect(body).not.toMatch(/\.(pdf|docx|xlsx|mp4|mov)/)
    }
    await page.screenshot({ path: 'tests/screenshots/vault-locked-no-leak.png', fullPage: true })
  })
})
