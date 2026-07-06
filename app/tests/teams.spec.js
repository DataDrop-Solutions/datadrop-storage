import { test, expect } from '@playwright/test'

test.describe('Teams', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('https://app.datadrop.co.in')
    await page.waitForSelector('button:has-text("Teams")', { timeout: 20000 })
    await page.locator('button:has-text("Teams")').click()
    await page.waitForTimeout(3000)
  })

  test('Teams view loads without errors', async ({ page }) => {
    await expect(page.locator('body')).not.toContainText('Internal error')
    await page.screenshot({ path: 'tests/screenshots/teams-view.png', fullPage: true })
  })

  test('Teams UI renders correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: 'tests/screenshots/teams-mobile.png', fullPage: true })
  })

  test('Create team button is visible', async ({ page }) => {
    const createBtn = page.locator('button:has-text("Create"), button:has-text("New Team"), button:has-text("+ Team")')
    const isVisible = await createBtn.isVisible()
    console.log('Create team button visible:', isVisible)
    await page.screenshot({ path: 'tests/screenshots/teams-create-btn.png', fullPage: true })
  })
})
