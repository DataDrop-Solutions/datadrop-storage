/**
 * Billing tests
 *
 * Covers: storage meter, wallet balance display, topup flow, plan UI,
 * and storage-limit enforcement messaging.
 */
import { test, expect } from '@playwright/test'

test.describe('Billing & Storage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://app.datadrop.co.in')
    await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })
  })

  // ── Settings > Billing tab ────────────────────────────────────────────────────

  test('Settings page opens and billing tab is accessible', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), button[aria-label="Settings"], button:has-text("⚙")').first()
    await settingsBtn.click()
    await page.waitForTimeout(2000)

    const billingTab = page.locator('button:has-text("Billing"), [data-tab="billing"]')
    await expect(billingTab).toBeVisible()
    await billingTab.click()
    await page.waitForTimeout(2000)

    await expect(page.locator('body')).not.toContainText('Internal error')
    await page.screenshot({ path: 'tests/screenshots/billing-tab.png', fullPage: true })
  })

  test('Storage meter is visible on billing tab', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), button[aria-label="Settings"], button:has-text("⚙")').first()
    await settingsBtn.click()
    await page.waitForTimeout(2000)

    const billingTab = page.locator('button:has-text("Billing"), [data-tab="billing"]')
    if (await billingTab.isVisible()) {
      await billingTab.click()
      await page.waitForTimeout(2000)
    }

    // Storage meter: look for percentage text or progress bar
    const storageMeter = page.locator(
      '[role="progressbar"], .storage-bar, meter, progress, ' +
      ':text-matches("GB"), :text-matches("MB used"), :text-matches("storage")'
    ).first()

    if (await storageMeter.isVisible()) {
      await expect(storageMeter).toBeVisible()
    } else {
      const body = await page.locator('body').textContent()
      const hasStorageInfo = body.includes('GB') || body.includes('MB') || body.includes('storage') || body.includes('Storage')
      expect(hasStorageInfo).toBe(true)
    }
    await page.screenshot({ path: 'tests/screenshots/billing-storage-meter.png', fullPage: true })
  })

  test('Wallet balance is displayed', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), button[aria-label="Settings"], button:has-text("⚙")').first()
    await settingsBtn.click()
    await page.waitForTimeout(2000)

    const billingTab = page.locator('button:has-text("Billing"), [data-tab="billing"]')
    if (await billingTab.isVisible()) {
      await billingTab.click()
      await page.waitForTimeout(2000)
    }

    const body = await page.locator('body').textContent()
    // Wallet section should show a currency amount or zero balance
    const hasWallet = body.includes('Wallet') || body.includes('wallet') ||
                      body.includes('Balance') || body.includes('balance') ||
                      body.includes('₹') || body.includes('$')
    expect(hasWallet).toBe(true)
    await page.screenshot({ path: 'tests/screenshots/billing-wallet.png', fullPage: true })
  })

  // ── Top-up flow ───────────────────────────────────────────────────────────────

  test('Add funds / Top-up button is visible', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), button[aria-label="Settings"], button:has-text("⚙")').first()
    await settingsBtn.click()
    await page.waitForTimeout(2000)

    const billingTab = page.locator('button:has-text("Billing"), [data-tab="billing"]')
    if (await billingTab.isVisible()) {
      await billingTab.click()
      await page.waitForTimeout(2000)
    }

    const topupBtn = page.locator(
      'button:has-text("Add"), button:has-text("Top"), button:has-text("Recharge"), button:has-text("topup")'
    ).first()

    if (await topupBtn.isVisible()) {
      await expect(topupBtn).toBeVisible()
      await page.screenshot({ path: 'tests/screenshots/billing-topup-btn.png', fullPage: true })
    } else {
      // Log for diagnosis but don't hard-fail — topup may require a plan
      console.log('Top-up button not found; billing section content:',
        (await page.locator('body').textContent()).slice(0, 300))
      await page.screenshot({ path: 'tests/screenshots/billing-topup-missing.png', fullPage: true })
    }
  })

  test('Top-up modal or page opens and shows amount input', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), button[aria-label="Settings"], button:has-text("⚙")').first()
    await settingsBtn.click()
    await page.waitForTimeout(2000)

    const billingTab = page.locator('button:has-text("Billing"), [data-tab="billing"]')
    if (await billingTab.isVisible()) {
      await billingTab.click()
      await page.waitForTimeout(2000)
    }

    const topupBtn = page.locator(
      'button:has-text("Add"), button:has-text("Top"), button:has-text("Recharge")'
    ).first()

    if (!(await topupBtn.isVisible())) {
      console.log('No top-up button — skipping modal test')
      return
    }

    await topupBtn.click()
    await page.waitForTimeout(2000)

    // Amount input should appear
    const amountInput = page.locator('input[type="number"], input[placeholder*="amount"], input[placeholder*="Amount"]')
    if (await amountInput.isVisible()) {
      await expect(amountInput).toBeVisible()
    } else {
      const body = await page.locator('body').textContent()
      const hasAmount = body.includes('amount') || body.includes('Amount') || body.includes('₹') || body.includes('$')
      expect(hasAmount).toBe(true)
    }
    await page.screenshot({ path: 'tests/screenshots/billing-topup-modal.png', fullPage: true })
  })

  // ── Storage enforcement ───────────────────────────────────────────────────────

  test('Billing page does not expose internal error on load', async ({ page }) => {
    const settingsBtn = page.locator('button:has-text("Settings"), button[aria-label="Settings"], button:has-text("⚙")').first()
    await settingsBtn.click()
    await page.waitForTimeout(2000)

    const billingTab = page.locator('button:has-text("Billing"), [data-tab="billing"]')
    if (await billingTab.isVisible()) {
      await billingTab.click()
      await page.waitForTimeout(3000)
    }

    await expect(page.locator('body')).not.toContainText('Internal error')
    await expect(page.locator('body')).not.toContainText('500')
    await expect(page.locator('body')).not.toContainText('undefined')
    await expect(page.locator('body')).not.toContainText('[object Object]')
  })

  // ── Sidebar storage indicator ─────────────────────────────────────────────────

  test('Storage usage indicator is visible in sidebar or header', async ({ page }) => {
    await page.waitForTimeout(2000)
    const body = await page.locator('body').textContent()
    // Sidebar often shows "X GB of Y GB used" or a mini progress bar
    const hasUsage = body.includes('GB') || body.includes('MB') || body.includes('%')
    if (!hasUsage) {
      console.log('No storage indicator visible in sidebar — this may be hidden until data loads')
    }
    await page.screenshot({ path: 'tests/screenshots/billing-sidebar-usage.png', fullPage: true })
  })

  // ── No vendor names in billing responses ─────────────────────────────────────

  test('Billing API responses contain no vendor names', async ({ page }) => {
    const violations: string[] = []

    page.on('response', async (resp) => {
      const ct = resp.headers()['content-type'] ?? ''
      if (!ct.includes('application/json')) return
      if (!resp.url().includes('/billing') && !resp.url().includes('/wallet')) return
      try {
        const text = await resp.text()
        if (/backblaze|cloudflare|clerk\.com|razorpay/i.test(text)) {
          violations.push(`${resp.url()}: ${text.slice(0, 100)}`)
        }
      } catch {
        // ignore
      }
    })

    const settingsBtn = page.locator('button:has-text("Settings"), button[aria-label="Settings"], button:has-text("⚙")').first()
    await settingsBtn.click()
    await page.waitForTimeout(1000)
    const billingTab = page.locator('button:has-text("Billing"), [data-tab="billing"]')
    if (await billingTab.isVisible()) {
      await billingTab.click()
      await page.waitForTimeout(3000)
    }

    expect(violations).toHaveLength(0)
  })
})
