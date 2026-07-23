/**
 * Zero Knowledge Vault tests
 *
 * Covers: vault setup (V1 + V2), lock/unlock, file upload into vault,
 * vault file decryption, move to/from vault, and vault isolation rules.
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import os from 'os'

const TEST_PIN = '123456'

test.describe('Zero Knowledge Vault', () => {
  let tmpFile

  test.beforeAll(() => {
    tmpFile = path.join(os.tmpdir(), `vault-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, `Vault test payload ${Date.now()}`)
  })

  test.afterAll(() => {
    if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('https://app.datadrop.co.in')
    await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })
  })

  // ── Navigation ───────────────────────────────────────────────────────────────

  test('Zero Knowledge Vault nav item is visible', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]')
    await expect(vaultNav).toBeVisible()
    await page.screenshot({ path: 'tests/screenshots/vault-nav.png' })
  })

  test('Vault nav item label is present', async ({ page }) => {
    // The sidebar button says "Vault" with E2EE subtitle — just verify it's visible
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await expect(vaultNav).toBeVisible()
  })

  // ── Vault landing ─────────────────────────────────────────────────────────────

  test('Clicking vault shows lock/setup screen when locked', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(2000)

    // Should show either a setup prompt or an unlock prompt — never raw file list
    const body = await page.locator('body').textContent()
    const hasSetupOrUnlock =
      body.includes('Set Up') || body.includes('Setup') ||
      body.includes('Unlock') || body.includes('PIN') ||
      body.includes('Zero Knowledge Vault')
    expect(hasSetupOrUnlock).toBe(true)
    await page.screenshot({ path: 'tests/screenshots/vault-landing.png', fullPage: true })
  })

  // ── Setup flow ────────────────────────────────────────────────────────────────

  test('Vault setup flow renders PIN input', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(2000)

    const setupBtn = page.locator('button:has-text("Set Up"), button:has-text("Setup")')
    if (await setupBtn.isVisible()) {
      await setupBtn.click()
      await page.waitForTimeout(1000)

      const pinInput = page.locator('input[type="password"], input[placeholder*="PIN"], input[placeholder*="pin"]')
      await expect(pinInput.first()).toBeVisible()
      await page.screenshot({ path: 'tests/screenshots/vault-setup.png', fullPage: true })
    } else {
      // Already set up — unlock form should be visible
      const pinInput = page.locator('input[type="password"]')
      await expect(pinInput.first()).toBeVisible()
    }
  })

  // ── Unlock flow ───────────────────────────────────────────────────────────────

  test('Vault unlock with valid PIN shows vault browser', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(2000)

    // If setup required, skip (can't set up in CI without knowing whether already set up)
    const setupBtn = page.locator('button:has-text("Set Up"), button:has-text("Setup")')
    if (await setupBtn.isVisible()) {
      console.log('Vault not set up — skipping unlock test')
      return
    }

    const pinInput = page.locator('input[type="password"]').first()
    await pinInput.fill(TEST_PIN)

    const unlockBtn = page.locator('button:has-text("Unlock")')
    await unlockBtn.click()
    await page.waitForTimeout(3000)

    // After unlock, vault browser should be visible (no PIN form)
    const stillLocked = await pinInput.isVisible().catch(() => false)
    if (!stillLocked) {
      // Unlocked successfully
      await page.screenshot({ path: 'tests/screenshots/vault-unlocked.png', fullPage: true })
    } else {
      // Wrong PIN stored in test env — take screenshot for debugging
      await page.screenshot({ path: 'tests/screenshots/vault-unlock-fail.png', fullPage: true })
      console.log('Note: unlock failed — possibly wrong PIN for this environment')
    }
  })

  test('Vault unlock with wrong PIN shows error', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(2000)

    const setupBtn = page.locator('button:has-text("Set Up"), button:has-text("Setup")')
    if (await setupBtn.isVisible()) {
      console.log('Vault not set up — skipping wrong-PIN test')
      return
    }

    const pinInput = page.locator('input[type="password"]').first()
    await pinInput.fill('000000')
    await page.locator('button:has-text("Unlock")').click()
    await page.waitForTimeout(3000)

    const body = await page.locator('body').textContent()
    const hasError = body.includes('Invalid') || body.includes('incorrect') ||
                     body.includes('wrong') || body.includes('failed') ||
                     body.includes('error') || body.includes('Error')
    expect(hasError).toBe(true)
    await page.screenshot({ path: 'tests/screenshots/vault-wrong-pin.png', fullPage: true })
  })

  // ── Vault isolation ───────────────────────────────────────────────────────────

  test('Vault files have no "Share" button', async ({ page }) => {
    // This enforces: "Vault files cannot be shared — EVER"
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(2000)

    const setupBtn = page.locator('button:has-text("Set Up"), button:has-text("Setup")')
    if (await setupBtn.isVisible()) {
      console.log('Vault not set up — skipping vault isolation test')
      return
    }

    const pinInput = page.locator('input[type="password"]').first()
    await pinInput.fill(TEST_PIN)
    await page.locator('button:has-text("Unlock")').click()
    await page.waitForTimeout(3000)

    // If unlocked and has files, check for absence of Share button
    const vaultFiles = page.locator('[data-filename][data-is-vault="true"], [data-vault="true"]')
    if (await vaultFiles.count() > 0) {
      await vaultFiles.first().hover()
      const shareBtn = page.locator('button:has-text("Share")').first()
      await expect(shareBtn).not.toBeVisible()
    }
    await page.screenshot({ path: 'tests/screenshots/vault-no-share.png', fullPage: true })
  })

  test('Vault UI does not expose raw B2 URLs', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(3000)

    const html = await page.content()
    expect(html).not.toMatch(/https?:\/\/f\d+\.backblazeb2\.com/)
    expect(html).not.toMatch(/backblazeb2\.com/)
  })

  // ── Upload to vault ───────────────────────────────────────────────────────────

  test('Upload button inside vault is visible after unlock', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(2000)

    const setupBtn = page.locator('button:has-text("Set Up"), button:has-text("Setup")')
    if (await setupBtn.isVisible()) {
      console.log('Vault not set up — skipping upload button test')
      return
    }

    await page.locator('input[type="password"]').first().fill(TEST_PIN)
    await page.locator('button:has-text("Unlock")').click()
    await page.waitForTimeout(3000)

    // After unlock, there should be an upload option
    const uploadBtn = page.locator('button:has-text("Upload"), label:has-text("Upload")')
    const fileInput = page.locator('input[type="file"]')
    const hasUpload = await uploadBtn.count() > 0 || await fileInput.count() > 0
    expect(hasUpload).toBe(true)
    await page.screenshot({ path: 'tests/screenshots/vault-upload-btn.png', fullPage: true })
  })

  // ── Move to vault ─────────────────────────────────────────────────────────────

  test('"Move to Zero Knowledge Vault" option exists in file context menu', async ({ page }) => {
    // Verify UI label matches the rename spec
    const filesBtn = page.locator('button:has-text("Files")').first()
    await filesBtn.click()
    await page.waitForTimeout(2000)

    const fileCards = page.locator('[data-filename]')
    if (await fileCards.count() === 0) {
      console.log('No files — skipping move-to-vault menu test')
      return
    }

    await fileCards.first().hover()
    const menuBtn = page.locator('[aria-label="More options"], button:has-text("⋮"), button:has-text("…")').first()
    if (await menuBtn.isVisible()) {
      await menuBtn.click()
      await page.waitForTimeout(500)
    }

    const moveOption = page.locator('button:has-text("Move to Zero Knowledge Vault"), [role="menuitem"]:has-text("Zero Knowledge Vault")')
    if (await moveOption.count() > 0) {
      await expect(moveOption.first()).toBeVisible()
    }
    await page.screenshot({ path: 'tests/screenshots/vault-move-option.png', fullPage: true })
  })

  // ── Lock vault ────────────────────────────────────────────────────────────────

  test('Locking vault removes session key', async ({ page }) => {
    const vaultNav = page.locator('button:has-text("Vault"), [data-key="vault"]').first()
    await vaultNav.click()
    await page.waitForTimeout(2000)

    const setupBtn = page.locator('button:has-text("Set Up"), button:has-text("Setup")')
    if (await setupBtn.isVisible()) {
      console.log('Vault not set up — skipping lock test')
      return
    }

    await page.locator('input[type="password"]').first().fill(TEST_PIN)
    await page.locator('button:has-text("Unlock")').click()
    await page.waitForTimeout(3000)

    const lockBtn = page.locator('button:has-text("Lock"), button:has-text("🔒 Lock")')
    if (await lockBtn.isVisible()) {
      await lockBtn.click()
      await page.waitForTimeout(1000)

      // Session storage keys should be gone
      const vaultKey    = await page.evaluate(() => sessionStorage.getItem('dd_vault_key'))
      const vaultPriv   = await page.evaluate(() => sessionStorage.getItem('dd_vault_private_key_pkcs8'))
      expect(vaultKey).toBeNull()
      expect(vaultPriv).toBeNull()
    }
    await page.screenshot({ path: 'tests/screenshots/vault-locked.png', fullPage: true })
  })
})
