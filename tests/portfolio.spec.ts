import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { writeFileSync } from 'node:fs'

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`production flows, assets and accessibility at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('requestfailed', r => errors.push(r.url()))
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
    await page.goto('/')
    await page.evaluate(() => document.fonts.ready)
    await page.getByLabel('Expression input').focus()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('sqrt(49)')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('primary-result')).toHaveText('7')
    for (const [expression, expected] of [['1/2', '1/2'], ['Ans+1', '1.5'], ['1/2', '1/2'], ['Ans*2', '1']]) {
      await page.getByLabel('Expression input').fill(expression)
      await page.getByLabel('Expression input').press('Enter')
      await expect(page.getByTestId('primary-result')).toHaveText(expected)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const shot = testInfo.outputPath(`home-${viewport.width}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    // Documentation captures are explicit; test runs never overwrite tracked assets.
    for (const panel of ['calculator', 'graph', 'matrix', 'stats', 'finance']) {
      await page.getByRole('tab', { name: panel, exact: true }).click()
      // The theme is dark-only (color-scheme: dark), so an OS light preference must not drop contrast below AA.
      for (const colorScheme of ['dark', 'light'] as const) {
        await page.emulateMedia({ colorScheme })
        const result = await new AxeBuilder({ page }).analyze()
        writeFileSync(testInfo.outputPath(`axe-${panel}-${colorScheme}.json`), JSON.stringify(result, null, 2))
        expect(result.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual([])
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await expect(page.getByTestId('future-value')).toContainText('$1,102.50')
    // Clear history asks for confirmation when there is something to delete.
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Clear history', exact: true }).click()
    await page.reload()
    // The selected tab is kept in the URL, so the reload reopens Finance.
    await expect(page.getByRole('tab', { name: 'finance' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: 'calculator' }).click()
    await expect(page.getByText('No saved calculations yet.')).toBeVisible()
    for (const path of ['/favicon.ico', '/favicon-32x32.png', '/favicon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/brand/mark.svg', '/brand/wordmark.svg', '/og-image.png', '/site.webmanifest', '/manifest.webmanifest']) {
      expect((await page.request.get(path)).status(), path).toBe(200)
    }
    expect(errors).toEqual([])
    writeFileSync(testInfo.outputPath('console.json'), JSON.stringify(errors))
    // A separate expected 404 must not be counted as a failed home-page request.
    const response = await page.goto('/this-does-not-exist')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: "That page isn't here." })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`404-${viewport.width}.png`), fullPage: true })
  })
}

test('failed persistent deletion is not reported as cleared', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('algebrix-history', JSON.stringify([{ expression: '2+2', result: '4', at: '2026-01-01' }]))
    Storage.prototype.setItem = () => { throw new Error('Storage blocked') }
  })
  await page.goto('/')
  await expect(page.getByText('2+2 → 4')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Clear history', exact: true }).click()
  await expect(page.getByText(/Browser storage could not be cleared/)).toBeVisible()
  await expect(page.getByText('History cleared.', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('algebrix-history')!))).toHaveLength(1)
})

test('malformed and unavailable browser storage do not break calculation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('algebrix-history', '{"unexpected":true}')
    Storage.prototype.setItem = () => { throw new Error('Storage blocked') }
  })
  await page.goto('/')
  await page.getByLabel('Expression input').fill('2+2')
  await page.getByLabel('Expression input').press('Enter')
  await expect(page.getByTestId('primary-result')).toHaveText('4')
  await expect(page.getByText(/browser storage is unavailable/)).toBeVisible()
})
