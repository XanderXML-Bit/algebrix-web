import { test, expect } from '@playwright/test'

test('hero and calculator happy path work without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /all-in-one web calculator/i })).toBeVisible()
  await page.getByLabel(/expression input/i).fill('sqrt(49)')
  await page.getByRole('button', { name: /^calculate$/i }).click()
  await expect(page.getByTestId('primary-result')).toContainText('7')
  expect(errors).toEqual([])
})

test('graphing flow and mobile history clear are usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('tab', { name: /graph/i }).click()
  await page.getByLabel(/graph expression/i).fill('x^2')
  await page.getByRole('button', { name: /plot graph/i }).click()
  await expect(page.getByTestId('trace-readout')).toContainText('trace')
  await page.getByRole('button', { name: /clear history/i }).click()
  await expect(page.getByText(/history cleared/i)).toBeVisible()
})

test('desktop hero keeps "all-in-one" on one line at 1440x900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const term = page.locator('#hero-title .nowrap')
  await expect(term).toHaveText('all-in-one')
  await expect(term).toHaveCSS('white-space', 'nowrap')
  const lines = await term.evaluate((el) => el.getClientRects().length)
  expect(lines).toBe(1)
})

for (const width of [320, 768, 1280]) {
  test(`header and footer links are 44px touch targets without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const boxes = await page.locator('nav.topbar a, footer a').evaluateAll((els) =>
      els.map((el) => { const r = el.getBoundingClientRect(); return { text: el.textContent, w: r.width, h: r.height } }))
    expect(boxes.length).toBe(8)
    for (const box of boxes) {
      expect(box.h, `${box.text} height`).toBeGreaterThanOrEqual(44)
      expect(box.w, `${box.text} width`).toBeGreaterThanOrEqual(24)
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    if (width === 320) {
      // Footer links must keep the 2-line wrap; extra link padding once pushed it to 3 lines.
      const rows = await page.locator('footer a').evaluateAll((els) =>
        new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size)
      expect(rows, 'footer link rows at 320px').toBe(2)
    }
  })
}

for (const width of [320, 1280]) {
  test(`first Tab shows the skip link and Enter moves focus past the nav at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).not.toBeInViewport()
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport({ ratio: 1 })
    const box = await skip.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
    expect(await page.evaluate(() => document.activeElement?.closest('main') !== null)).toBe(true)
    // The next Tab lands on the first hero action, not on the header nav.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Start calculating' })).toBeFocused()
  })
}
