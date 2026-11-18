import { readFileSync, writeFileSync } from 'node:fs'

// Share the actual compiled theme/font CSS instead of duplicating design tokens.
const index = readFileSync('dist/index.html', 'utf8')
const styles = [...index.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(([tag]) => tag).join('\n')
writeFileSync('dist/404.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#080e19"><link rel="icon" href="/favicon.svg">${styles}<title>Page not found — Algebrix</title></head>
<body><main class="hero-shell"><img src="/brand/wordmark.svg" alt="Algebrix" width="240" height="58"><p class="eyebrow">404</p><h1>That page isn't here.</h1><p>Return to the calculator to start a calculation.</p><a class="button primary" href="/">Open calculator</a></main>
<footer>© ${new Date().getFullYear()} <a href="https://zendren.net">Zendren</a> · Built by <a href="https://xandermlopez.com" rel="author">Xander M. Lopez</a> · <a href="/#privacy">Calculator privacy</a> · <a href="https://zendren.net/privacy">Privacy</a> · <a href="https://zendren.net/terms">Terms</a></footer></body></html>`)
