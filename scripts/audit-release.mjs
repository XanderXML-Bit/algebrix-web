// Anonymous audit; reports the existing production separately from a release candidate.
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
const base = process.argv[2]
const out = process.argv[3]
if (!base || !out) throw new Error('Usage: node scripts/audit-release.mjs URL OUTPUT_DIR')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const errors = []
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', e => errors.push(e.message))
    page.on('requestfailed', r => errors.push(r.url()))
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
    const response = await page.goto(base, { waitUntil: 'networkidle' })
    const background = await context.newPage()
    await background.goto('about:blank')
    await page.getByLabel('Expression input').fill('10 choose 3')
    await page.getByLabel('Expression input').press('Enter')
    await page.waitForTimeout(100)
    const result = await page.getByTestId('primary-result').textContent()
    const states = []
    for (const panel of ['calculator', 'graph', 'matrix', 'stats', 'finance']) {
      await page.getByRole('tab', { name: panel, exact: true }).click()
      await page.evaluate(() => document.fonts.ready)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
      await page.screenshot({ path: `${out}/${panel}-${width}.png`, fullPage: true })
      states.push({ panel, overflow })
    }
    results.push({ base, width, status: response.status(), result, errors, states })
    await context.close()
  }
} finally { await browser.close() }
writeFileSync(`${out}/audit.json`, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
if (results.some(r => r.status !== 200 || r.result !== '120' || r.errors.length || r.states.some(s => s.overflow))) process.exitCode = 1
