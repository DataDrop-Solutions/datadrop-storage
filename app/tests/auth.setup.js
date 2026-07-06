/**
 * Auth setup — signs in as the demo account, handles Clerk's new-device OTP via Mailinator.
 *
 * Demo: datadrop.demo.2026@mailinator.com / DataDropDemo@2026!
 */
import { test as setup } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const authFile    = 'tests/.auth/user.json'
const DEMO_EMAIL  = 'datadrop.demo.2026@mailinator.com'
const DEMO_PASS   = 'DataDropDemo@2026!'
const CLERK_SIGNIN = 'https://accounts.datadrop.co.in/sign-in?redirect_url=https%3A%2F%2Fapp.datadrop.co.in%2F'

setup('authenticate', async ({ page }) => {
  fs.mkdirSync(path.dirname(authFile), { recursive: true })
  fs.mkdirSync('tests/screenshots', { recursive: true })

  await page.goto(CLERK_SIGNIN, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  // Already authenticated?
  if (page.url().startsWith('https://app.datadrop.co.in')) {
    const hasUpload = await page.locator('button:has-text("Upload")').isVisible({ timeout: 5000 }).catch(() => false)
    if (hasUpload) {
      await page.context().storageState({ path: authFile })
      console.log('Already authenticated.')
      return
    }
  }

  // ── Email step ─────────────────────────────────────────────────
  await page.waitForSelector('#identifier-field, input[name="identifier"], input[type="email"]', { timeout: 20000 })
  await page.locator('#identifier-field, input[name="identifier"], input[type="email"]').first().fill(DEMO_EMAIL)
  await page.waitForTimeout(500)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)

  // ── Password step ───────────────────────────────────────────────
  await page.waitForSelector('#password-field, input[type="password"]', { timeout: 15000 })
  await page.locator('#password-field, input[type="password"]').first().fill(DEMO_PASS)
  await page.waitForTimeout(1500)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3000)

  // ── New-device OTP check (Clerk shows "Check your email" screen) ──
  const hasOtpScreen = await page.locator('text=Check your email').isVisible({ timeout: 8000 }).catch(() => false)

  if (hasOtpScreen) {
    console.log('Clerk new-device OTP required — fetching from Mailinator…')
    await page.screenshot({ path: 'tests/screenshots/otp-screen.png' })

    let otp = null
    const inboxName = DEMO_EMAIL.split('@')[0] // datadrop.demo.2026

    for (let attempt = 0; attempt < 8; attempt++) {
      await page.waitForTimeout(5000) // wait for email delivery

      try {
        // Mailinator public JSON API
        const apiUrl = `https://www.mailinator.com/api/v2/domains/mailinator.com/inboxes/${inboxName}/messages?sort=newest&limit=5`
        const apiResp = await page.evaluate(async (url) => {
          const r = await fetch(url)
          return r.ok ? r.json() : null
        }, apiUrl)

        if (apiResp?.msgs?.length) {
          for (const msg of apiResp.msgs) {
            // Subject sometimes contains the code
            const subjectMatch = msg.subject?.match(/\b(\d{6})\b/)
            if (subjectMatch) { otp = subjectMatch[1]; break }
          }
        }

        if (!otp) {
          // Fall back: open Mailinator inbox in a new tab and read email body
          const mailinatorPage = await page.context().newPage()
          await mailinatorPage.goto(
            `https://www.mailinator.com/v4/public/inboxes.jsp?to=${inboxName}`,
            { waitUntil: 'domcontentloaded', timeout: 15000 }
          )
          await mailinatorPage.waitForTimeout(3000)

          // Click the most recent email row
          const row = mailinatorPage.locator('table tbody tr').first()
          if (await row.isVisible({ timeout: 3000 }).catch(() => false)) {
            await row.click()
            await mailinatorPage.waitForTimeout(2000)
            const bodyText = await mailinatorPage.locator('body').textContent()
            const bodyMatch = bodyText.match(/\b(\d{6})\b/)
            if (bodyMatch) otp = bodyMatch[1]
          }
          await mailinatorPage.close()
        }

        console.log(`Attempt ${attempt + 1}: OTP = ${otp}`)
        if (otp) break
      } catch (e) {
        console.log(`Mailinator attempt ${attempt + 1} failed:`, e.message)
      }
    }

    if (!otp) {
      await page.screenshot({ path: 'tests/screenshots/otp-not-found.png' })
      throw new Error('Could not retrieve OTP from Mailinator. Check tests/screenshots/otp-not-found.png')
    }

    console.log('Entering OTP:', otp)

    // Clerk OTP inputs: try standard autocomplete selector first, then individual inputs
    const otpInput = page.locator('input[autocomplete="one-time-code"]').first()
    const hasOtpAutocomplete = await otpInput.isVisible({ timeout: 2000 }).catch(() => false)

    if (hasOtpAutocomplete) {
      await otpInput.fill(otp)
    } else {
      // Clerk shows 6 individual boxes — click first and type
      const boxes = page.locator('input[inputmode="numeric"], input[type="text"][maxlength="1"], [role="group"] input')
      const firstBox = boxes.first()
      if (await firstBox.isVisible({ timeout: 2000 }).catch(() => false)) {
        await firstBox.click()
        await page.keyboard.type(otp, { delay: 100 })
      } else {
        // Last resort: just type into whichever input has focus
        await page.keyboard.type(otp, { delay: 100 })
      }
    }

    await page.waitForTimeout(2000)

    // Click Continue if still visible
    const continueBtn = page.locator('button:has-text("Continue")')
    if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await continueBtn.click()
    }

    await page.waitForTimeout(2000)
  }

  // ── Wait for dashboard ──────────────────────────────────────────
  console.log('Waiting for dashboard…')
  await page.waitForURL('https://app.datadrop.co.in/**', { timeout: 45000 })
  await page.waitForSelector('button:has-text("Upload")', { timeout: 20000 })

  await page.context().storageState({ path: authFile })
  console.log('Auth saved to', authFile)
})
