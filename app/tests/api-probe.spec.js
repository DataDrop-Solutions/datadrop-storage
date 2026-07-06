/**
 * API Probe Tests — no auth required
 * Tests the actual worker endpoints to verify correct behavior.
 */
import { test, expect } from '@playwright/test'

const FILES_BASE = 'https://files.datadrop.co.in'
const API_BASE   = 'https://api.datadrop.co.in'

test.describe('Worker API Probe (no auth)', () => {
  test('files.datadrop.co.in is reachable and returns 401 without auth', async ({ request }) => {
    const resp = await request.get(`${FILES_BASE}/files/nonexistent-id`, {
      headers: { Origin: 'https://app.datadrop.co.in' },
      failOnStatusCode: false,
    })
    console.log('Status:', resp.status())
    const body = await resp.text()
    console.log('Body:', body)
    expect(resp.status()).toBe(401)
    expect(body).toContain('Unauthorized')
  })

  test('api.datadrop.co.in health endpoint responds', async ({ request }) => {
    const resp = await request.get(`${API_BASE}/health`, { failOnStatusCode: false })
    console.log('API health status:', resp.status())
    const body = await resp.json().catch(() => ({}))
    console.log('API health body:', body)
    expect(resp.status()).toBe(200)
    expect(body.ok).toBe(true)
  })

  test('files worker returns proper JSON error (not 500) for invalid file', async ({ request }) => {
    const resp = await request.get(`${FILES_BASE}/files/00000000000000000000000000000000`, {
      headers: { Origin: 'https://app.datadrop.co.in' },
      failOnStatusCode: false,
    })
    const body = await resp.text()
    console.log('Status:', resp.status(), '| Body:', body)
    // Should be 401 (no session), not 500 (crash)
    expect(resp.status()).not.toBe(500)
    // Body should be valid JSON
    expect(() => JSON.parse(body)).not.toThrow()
    const parsed = JSON.parse(body)
    expect(parsed).toHaveProperty('error')
  })

  test('CORS headers present on files worker', async ({ request }) => {
    const resp = await request.fetch(`${FILES_BASE}/files/test`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.datadrop.co.in',
        'Access-Control-Request-Method': 'GET',
      },
      failOnStatusCode: false,
    })
    console.log('OPTIONS status:', resp.status())
    const acao = resp.headers()['access-control-allow-origin']
    console.log('ACAO header:', acao)
    expect(resp.status()).toBe(204)
  })
})
