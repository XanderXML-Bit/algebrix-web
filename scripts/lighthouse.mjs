import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
const browser = await chromium.launch({ args: ['--remote-debugging-port=9227'] })
try {
  process.exitCode = await new Promise(resolve => {
    const child = spawn('npx', ['--yes', 'lighthouse', 'http://127.0.0.1:4177', '--port=9227', '--only-categories=performance,accessibility', '--output=json', '--output-path=../lighthouse.json'], { stdio: 'inherit' })
    child.on('exit', code => resolve(code ?? 1))
  })
} finally { await browser.close() }
