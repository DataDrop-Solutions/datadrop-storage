import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

test.describe('Upload & Versioning', () => {
  let tmpFile

  test.beforeAll(() => {
    // Create a tiny temp file for upload testing
    tmpFile = path.join(os.tmpdir(), `datadrop-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, `DataDrop test file created at ${new Date().toISOString()}\n`)
  })

  test.afterAll(() => {
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('https://app.datadrop.co.in')
    await page.waitForSelector('button:has-text("Upload")', { timeout: 20000 })
  })

  test('Upload button is visible and clickable', async ({ page }) => {
    const uploadBtn = page.locator('button:has-text("Upload"), button:has-text("↑ Upload")')
    await expect(uploadBtn).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/upload-btn.png' })
  })

  test('File upload via file input', async ({ page }) => {
    // Find the hidden file input
    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles(tmpFile)

    // Wait for upload progress or completion
    await page.waitForTimeout(5000)

    // Check for success toast or progress bar
    const bodyText = await page.locator('body').textContent()
    console.log('After upload body snippet:', bodyText.slice(0, 300))
    await page.screenshot({ path: 'tests/screenshots/upload-result.png', fullPage: true })
  })

  test('Dashboard is responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(1000)

    // Hamburger menu should appear on mobile
    const hamburger = page.locator('button:has-text("☰")')
    await expect(hamburger).toBeVisible()

    await hamburger.click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'tests/screenshots/mobile-sidebar-open.png', fullPage: true })
  })

  test('Settings page is responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })

    const settingsBtn = page.locator('button:has-text("Settings"), button:has-text("⚙️")')
    await settingsBtn.click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: 'tests/screenshots/settings-mobile.png', fullPage: true })

    // Billing tab
    const billingBtn = page.locator('button:has-text("Billing")')
    if (await billingBtn.isVisible()) {
      await billingBtn.click()
      await page.waitForTimeout(1500)
      await page.screenshot({ path: 'tests/screenshots/billing-mobile.png', fullPage: true })
    }
  })
})
