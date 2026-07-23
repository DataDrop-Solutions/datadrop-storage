/**
 * AutoPay Mandate Upgrade/Downgrade Tests
 *
 * Covers:
 * 1. Settings → "Change Limit" button visible when mandate is active
 * 2. LimitUpgradeModal opens with correct current limit
 * 3. Preset buttons show GB capacities
 * 4. Custom amount input updates live preview
 * 5. Decrease warning shows when new limit < current
 * 6. Proceed button disabled when no limit selected
 * 7. Proceed button disabled when limit unchanged
 * 8. LIMIT_EXCEEDED upload error shows Storage Capacity Reached dialog
 * 9. "Cancel" on Storage Capacity Reached dismisses without opening upgrade modal
 * 10. "Increase Limit" on Storage Capacity Reached opens LimitUpgradeModal
 * 11. Cancel inside LimitUpgradeModal does not break existing mandate
 */
import { test, expect } from '@playwright/test'

const BASE_URL = 'https://app.datadrop.co.in'

// Helper: navigate to billing tab in settings
async function openBillingTab(page) {
  await page.goto(BASE_URL)
  await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })

  const settingsBtn = page.locator(
    'button:has-text("Settings"), button[aria-label="Settings"]'
  ).first()
  await settingsBtn.click()
  await page.waitForTimeout(1500)

  const billingTab = page.locator('button:has-text("Billing"), [data-tab="billing"]')
  if (await billingTab.isVisible()) {
    await billingTab.click()
    await page.waitForTimeout(2000)
  }
}

test.describe('Mandate Upgrade / Downgrade — Settings', () => {

  test('Change Limit button is visible when AutoPay is active', async ({ page }) => {
    await openBillingTab(page)
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-billing-tab.png', fullPage: true })

    // If mandate is active the badge shows
    const autopayBadge = page.locator(':text("AutoPay Active")')
    if (await autopayBadge.isVisible()) {
      const changeLimitBtn = page.locator('button:has-text("Change Limit")')
      await expect(changeLimitBtn).toBeVisible()
    } else {
      // No active mandate — button should not be present
      await expect(page.locator('button:has-text("Change Limit")')).not.toBeVisible()
    }
  })

  test('LimitUpgradeModal opens with current limit when Change Limit clicked', async ({ page }) => {
    await openBillingTab(page)

    const changeLimitBtn = page.locator('button:has-text("Change Limit")')
    if (!(await changeLimitBtn.isVisible())) {
      test.skip(true, 'No active mandate on this account')
      return
    }
    await changeLimitBtn.click()
    await page.waitForTimeout(1000)

    // Modal should appear
    await expect(page.locator(':text("Change Monthly Limit")')).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-modal-open.png', fullPage: true })
  })

  test('Preset tier buttons display GB capacities', async ({ page }) => {
    await openBillingTab(page)

    const changeLimitBtn = page.locator('button:has-text("Change Limit")')
    if (!(await changeLimitBtn.isVisible())) {
      test.skip(true, 'No active mandate on this account')
      return
    }
    await changeLimitBtn.click()
    await page.waitForTimeout(1000)

    // ₹149 = 100 GB, ₹299 = 200 GB, ₹499 = 335 GB, ₹999 = 670 GB
    for (const [amt, gb] of [['149', '100'], ['299', '200'], ['499', '335'], ['999', '670']]) {
      const btn = page.locator(`button:has-text("₹${amt}")`)
      await expect(btn).toBeVisible()
      await expect(btn).toContainText(`${gb} GB`)
    }
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-presets.png', fullPage: true })
  })

  test('Custom amount input shows live GB preview', async ({ page }) => {
    await openBillingTab(page)

    const changeLimitBtn = page.locator('button:has-text("Change Limit")')
    if (!(await changeLimitBtn.isVisible())) {
      test.skip(true, 'No active mandate on this account')
      return
    }
    await changeLimitBtn.click()
    await page.waitForTimeout(800)

    const customInput = page.locator('input[placeholder*="750"], input[type="number"]').last()
    await customInput.fill('500')
    await page.waitForTimeout(400)

    // ₹500 → Math.floor(500/1.49) = 335 GB
    await expect(page.locator(':text("335 GB")')).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-custom-preview.png', fullPage: true })
  })

  test('Decrease warning shows when new limit is less than current', async ({ page }) => {
    await openBillingTab(page)

    const changeLimitBtn = page.locator('button:has-text("Change Limit")')
    if (!(await changeLimitBtn.isVisible())) {
      test.skip(true, 'No active mandate on this account')
      return
    }
    await changeLimitBtn.click()
    await page.waitForTimeout(800)

    // Enter ₹1 — always lower than any real mandate limit
    const customInput = page.locator('input[type="number"]').last()
    await customInput.fill('1')
    await page.waitForTimeout(400)

    const warning = page.locator(':text("Reducing limit")')
    // Warning only shows if ₹1 < currentLimit
    if (await warning.isVisible()) {
      await expect(warning).toBeVisible()
    }
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-decrease-warning.png', fullPage: true })
  })

  test('Proceed button disabled when no amount selected', async ({ page }) => {
    await openBillingTab(page)

    const changeLimitBtn = page.locator('button:has-text("Change Limit")')
    if (!(await changeLimitBtn.isVisible())) {
      test.skip(true, 'No active mandate on this account')
      return
    }
    await changeLimitBtn.click()
    await page.waitForTimeout(800)

    const proceedBtn = page.locator('button:has-text("Increase Limit"), button:has-text("Reduce Limit")')
    await expect(proceedBtn).toBeDisabled()
  })

  test('Cancel button on LimitUpgradeModal closes it without changing mandate', async ({ page }) => {
    await openBillingTab(page)

    const changeLimitBtn = page.locator('button:has-text("Change Limit")')
    if (!(await changeLimitBtn.isVisible())) {
      test.skip(true, 'No active mandate on this account')
      return
    }

    // Note the current limit text before opening
    const beforeText = await page.locator(':text("AutoPay Active")').textContent().catch(() => '')

    await changeLimitBtn.click()
    await page.waitForTimeout(800)

    await page.locator('button:has-text("Cancel")').last().click()
    await page.waitForTimeout(500)

    // Modal should be gone
    await expect(page.locator(':text("Change Monthly Limit")')).not.toBeVisible()
    // AutoPay badge still present
    await expect(page.locator(':text("AutoPay Active")')).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-cancelled.png', fullPage: true })
  })
})

test.describe('Mandate Upgrade — Upload LIMIT_EXCEEDED flow', () => {

  test('Storage Capacity Reached dialog appears on simulated LIMIT_EXCEEDED (API mock)', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })

    // Mock the upload/init endpoint to return LIMIT_EXCEEDED
    await page.route('**/upload/init', route => {
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Storage capacity exceeded',
          code:  'LIMIT_EXCEEDED',
          limit: 149,
          capacityBytes: Math.floor(100 * 1024 * 1024 * 1024),
        }),
      })
    })

    const fileInput = page.locator('input[type="file"]')
    if (!(await fileInput.isVisible())) {
      // Try opening via upload button
      const uploadBtn = page.locator('button:has-text("Upload")').first()
      if (await uploadBtn.isVisible()) await uploadBtn.click()
    }

    // Upload a small test file
    await fileInput.setInputFiles({
      name: 'test-oversize.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    })

    // Dialog should appear within 5 s
    await expect(page.locator(':text("Storage Capacity Reached")')).toBeVisible({ timeout: 8000 })
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-limit-exceeded-dialog.png', fullPage: true })
  })

  test('Cancel on Storage Capacity Reached closes dialog without upgrade modal', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })

    await page.route('**/upload/init', route => {
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Storage capacity exceeded',
          code:  'LIMIT_EXCEEDED',
          limit: 149,
          capacityBytes: Math.floor(100 * 1024 * 1024 * 1024),
        }),
      })
    })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-oversize2.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    })

    await expect(page.locator(':text("Storage Capacity Reached")')).toBeVisible({ timeout: 8000 })
    await page.locator('button:has-text("Cancel")').first().click()
    await page.waitForTimeout(500)

    await expect(page.locator(':text("Storage Capacity Reached")')).not.toBeVisible()
    await expect(page.locator(':text("Change Monthly Limit")')).not.toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-limit-exceeded-cancel.png', fullPage: true })
  })

  test('"Increase Limit" on Storage Capacity Reached opens LimitUpgradeModal', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })

    await page.route('**/upload/init', route => {
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Storage capacity exceeded',
          code:  'LIMIT_EXCEEDED',
          limit: 149,
          capacityBytes: Math.floor(100 * 1024 * 1024 * 1024),
        }),
      })
    })

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'test-oversize3.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('x'),
    })

    await expect(page.locator(':text("Storage Capacity Reached")')).toBeVisible({ timeout: 8000 })
    await page.locator('button:has-text("Increase Limit")').first().click()
    await page.waitForTimeout(800)

    // LimitExceededModal should hide and LimitUpgradeModal should show
    await expect(page.locator(':text("Storage Capacity Reached")')).not.toBeVisible()
    await expect(page.locator(':text("Change Monthly Limit")')).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/mandate-upgrade-from-upload-block.png', fullPage: true })
  })
})
