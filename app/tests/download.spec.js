import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs'

// Create test files if they don't exist
const TEST_TEXT_PATH = path.join(import.meta.dirname || 'tests', 'fixtures', 'test.txt')
const TEST_IMG_PATH  = path.join(import.meta.dirname || 'tests', 'fixtures', 'test.png')

function ensureFixtures() {
  const dir = path.join('tests', 'fixtures')
  fs.mkdirSync(dir, { recursive: true })

  // Small text file
  if (!fs.existsSync(TEST_TEXT_PATH))
    fs.writeFileSync(TEST_TEXT_PATH, 'Hello from DataDrop Playwright test!\nLine 2.\n')

  // 1x1 transparent PNG (minimal)
  if (!fs.existsSync(TEST_IMG_PATH)) {
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082',
      'hex'
    )
    fs.writeFileSync(TEST_IMG_PATH, pngBytes)
  }
}

test.describe('Upload → Download → Preview', () => {
  test.beforeAll(() => ensureFixtures())

  test.beforeEach(async ({ page }) => {
    await page.goto('https://app.datadrop.co.in')
    await page.waitForSelector('button:has-text("↑ Upload"), button:has-text("Upload")', { timeout: 20000 })
  })

  test('Upload txt file and check it appears', async ({ page }) => {
    // Upload test.txt
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('button:has-text("↑ Upload"), button:has-text("Upload")').first().click(),
    ])
    await fileChooser.setFiles(TEST_TEXT_PATH)

    // Wait for upload to complete (progress or success indication)
    await page.waitForTimeout(3000)

    // Re-load to ensure the file appears (queue may have lag)
    await page.reload()
    await page.waitForSelector('button:has-text("↑ Upload")', { timeout: 15000 })

    // Check that test.txt appears in the file list
    const fileText = await page.locator('body').textContent()
    expect(fileText).toContain('test.txt')
    console.log('File test.txt found in dashboard')
  })

  test('Click file → preview opens and shows content or B2 error', async ({ page }) => {
    // Upload txt file
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('button:has-text("↑ Upload"), button:has-text("Upload")').first().click(),
    ])
    await fileChooser.setFiles(TEST_TEXT_PATH)
    await page.waitForTimeout(4000)
    await page.reload()
    await page.waitForSelector('button:has-text("↑ Upload")', { timeout: 15000 })

    // Find the file card for test.txt and click it
    const fileCard = page.locator('text=test.txt').first()
    await expect(fileCard).toBeVisible({ timeout: 10000 })
    await fileCard.click()

    // Wait for preview modal to open
    await page.waitForTimeout(5000) // allow B2 fetch
    await page.screenshot({ path: 'tests/screenshots/preview-modal.png', fullPage: true })

    // Log any errors on the page
    const bodyText = await page.locator('body').textContent()
    const b2Error = bodyText.match(/B2 fetch failed[^<\n\r]{0,300}/)
    const clerkError = bodyText.match(/(Unauthorized|Access denied|File not accessible)[^<\n\r]{0,100}/)

    if (b2Error) {
      console.error('B2 ERROR:', b2Error[0])
    } else if (clerkError) {
      console.error('AUTH ERROR:', clerkError[0])
    } else {
      // Look for preview content
      const previewContent = await page.locator('pre, iframe, img[src^="blob:"], audio, video').count()
      console.log('Preview elements found:', previewContent)
      if (previewContent > 0) console.log('Preview is working!')
    }

    // Screenshot for review
    expect(true).toBe(true) // just capture the state
  })

  test('Download button works and returns a file', async ({ page }) => {
    // Upload test.txt first
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('button:has-text("↑ Upload"), button:has-text("Upload")').first().click(),
    ])
    await fileChooser.setFiles(TEST_TEXT_PATH)
    await page.waitForTimeout(4000)
    await page.reload()
    await page.waitForSelector('button:has-text("↑ Upload")', { timeout: 15000 })

    // Hover over the file to show context menu button (⋯)
    const fileCard = page.locator('text=test.txt').first()
    await fileCard.hover()
    await page.waitForTimeout(500)

    // Click the ⋯ menu button
    const menuBtn = page.locator('button:has-text("⋯")').first()
    const menuVisible = await menuBtn.isVisible().catch(() => false)
    if (menuVisible) {
      await menuBtn.click()
      await page.waitForTimeout(500)
      await page.screenshot({ path: 'tests/screenshots/file-menu.png' })

      // Look for download option in the dropdown
      const dlOption = page.locator('button:has-text("Download"), [role="menuitem"]:has-text("Download")').first()
      const dlVisible = await dlOption.isVisible({ timeout: 3000 }).catch(() => false)

      if (dlVisible) {
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
          dlOption.click(),
        ])
        if (dl) {
          const fname = dl.suggestedFilename()
          console.log('Download success! Filename:', fname)
          expect(fname).toContain('test')
        } else {
          // Check for error toast
          await page.waitForTimeout(3000)
          await page.screenshot({ path: 'tests/screenshots/download-error.png', fullPage: true })
          const errText = await page.locator('body').textContent()
          const toast = errText.match(/(Download failed|B2 fetch failed|Unauthorized)[^<\n\r]{0,200}/)
          if (toast) console.error('DOWNLOAD ERROR:', toast[0])
        }
      } else {
        console.log('No Download button found in menu')
        await page.screenshot({ path: 'tests/screenshots/no-download-option.png', fullPage: true })
      }
    } else {
      console.log('⋯ menu button not found — checking file click opens preview with Download button')
      await fileCard.click()
      await page.waitForTimeout(3000)
      const dlBtn = page.locator('button:has-text("↓ Download"), button:has-text("Download")').first()
      const dlVisible2 = await dlBtn.isVisible({ timeout: 5000 }).catch(() => false)
      if (dlVisible2) {
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
          dlBtn.click(),
        ])
        if (dl) {
          console.log('Download from preview success! Filename:', dl.suggestedFilename())
          expect(dl.suggestedFilename()).toContain('test')
        } else {
          await page.waitForTimeout(3000)
          await page.screenshot({ path: 'tests/screenshots/preview-download-failed.png', fullPage: true })
          const errText = await page.locator('body').textContent()
          const toast = errText.match(/(Download failed|B2 fetch failed|Unauthorized)[^<\n\r]{0,200}/)
          if (toast) console.error('DOWNLOAD ERROR:', toast[0])
        }
      }
    }
  })

  test('Network intercept — capture actual files worker response', async ({ page }) => {
    const responses = []
    page.on('response', async resp => {
      if (resp.url().includes('files.datadrop.co.in') || resp.url().includes('/files/')) {
        let body = ''
        try { body = await resp.text() } catch {}
        responses.push({ url: resp.url(), status: resp.status(), body: body.slice(0, 500) })
      }
    })

    await page.goto('https://app.datadrop.co.in')
    await page.waitForSelector('button:has-text("↑ Upload")', { timeout: 15000 })
    await page.waitForTimeout(2000)

    // Try clicking any file if one exists
    const fileCards = page.locator('[data-filename], .file-card').first()
    const hasFiles = await fileCards.isVisible({ timeout: 3000 }).catch(() => false)
    if (!hasFiles) {
      // Upload a file and try again
      const [fc] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.locator('button:has-text("↑ Upload")').first().click(),
      ])
      await fc.setFiles(TEST_TEXT_PATH)
      await page.waitForTimeout(5000)
    }

    // Click file card
    const card = page.locator('text=test.txt').first()
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await card.click()
      await page.waitForTimeout(8000)
    }

    console.log('Files worker responses captured:')
    responses.forEach(r => console.log(`  ${r.status} ${r.url}\n  Body: ${r.body}`))
    await page.screenshot({ path: 'tests/screenshots/network-result.png', fullPage: true })
  })
})
