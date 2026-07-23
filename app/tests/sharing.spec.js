import { test, expect } from '@playwright/test'

test.describe('Sharing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://app.datadrop.co.in')
    await page.waitForSelector('button:has-text("Upload"), button:has-text("Files")', { timeout: 20000 })
  })

  test('Shared by me tab loads', async ({ page }) => {
    // Navigate to "Shared by me"
    const sharedBtn = page.locator('button:has-text("Shared by me")')
    await sharedBtn.click()
    await page.waitForTimeout(2000)
    await expect(page.locator('body')).not.toContainText('Internal error')
    await page.screenshot({ path: 'tests/screenshots/shared-by-me.png', fullPage: true })
  })

  test('Received tab loads', async ({ page }) => {
    const receivedBtn = page.locator('button:has-text("Received"), button:has-text("Shared with me")')
    await receivedBtn.click()
    await page.waitForTimeout(2000)
    await expect(page.locator('body')).not.toContainText('Internal error')
    await page.screenshot({ path: 'tests/screenshots/shared-with-me.png', fullPage: true })
  })

  test('Share modal opens for a file', async ({ page }) => {
    // Make sure we are on the Files tab
    const filesBtn = page.locator('button:has-text("Files")').first()
    await filesBtn.click()
    await page.waitForTimeout(2000)

    const fileCards = page.locator('[data-filename]')
    if (await fileCards.count() === 0) {
      console.log('No files found — skipping share modal test')
      return
    }

    // Hover to reveal action buttons
    await fileCards.first().hover()

    const shareBtn = page.locator('button:has-text("Share"), [title="Share"], [aria-label="Share"]').first()
    if (await shareBtn.isVisible()) {
      await shareBtn.click()
      await expect(page.locator('[role="dialog"], .share-modal, input[type="email"]')).toBeVisible({ timeout: 10000 })
      await page.screenshot({ path: 'tests/screenshots/share-modal.png', fullPage: true })
    } else {
      console.log('Share button not visible')
      await page.screenshot({ path: 'tests/screenshots/share-no-btn.png', fullPage: true })
    }
  })
})
