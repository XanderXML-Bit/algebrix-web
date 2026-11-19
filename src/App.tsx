import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { checkPlotExpression, sampleFunction, type AngleMode } from './lib/calculator'
import { clampPrecision, DEFAULT_PRECISION } from './lib/format'
import { runExpression } from './lib/router'
import { determinant, financeFutureValue, inverse, linearRegression, rref, statsSummary, convertUnit, type Matrix } from './lib/toolkits'

type HistoryItem = { expression: string; result: string; at: string }
type Panel = 'calculator' | 'graph' | 'matrix' | 'stats' | 'finance'

const panels: Panel[] = ['calculator', 'graph', 'matrix', 'stats', 'finance']
const keypadKeys = ['7','8','9','/','sqrt(','4','5','6','*','sin(','1','2','3','-','cos(','0','.','pi','+','tan(','(',')','^','5!','Ans']
const KEYPAD_COLUMNS = 5
const lengthUnits = ['m', 'km', 'cm', 'mm', 'ft', 'in', 'mi']
const massUnits = ['kg', 'g', 'lb', 'oz']
const temperatureUnits = ['f', 'c']
const unitLabels: Record<string, string> = { f: '°F', c: '°C' }
const unitLabel = (unit: string) => unitLabels[unit] ?? unit
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const examples = [
  { group: 'Scientific', label: 'sqrt(49)', expression: 'sqrt(49)' },
  { group: 'Scientific', label: '10 choose 3', expression: '10 choose 3' },
  { group: 'Algebra', label: 'factor quadratic', expression: 'factor(x^2+5x+6)' },
  { group: 'Algebra', label: 'solve linear', expression: 'solve(2x+3=7)' },
  { group: 'Calculus', label: 'derivative', expression: 'derivative(x^3,x)' },
  { group: 'Calculus', label: 'integral', expression: 'integral(sin(x),0,pi)' },
  { group: 'Calculus', label: 'limit', expression: 'limit(sin(x)/x,x,0)' },
]

function loadHistory(): HistoryItem[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem('algebrix-history') ?? '[]')
    if (!Array.isArray(items)) return []
    return items.filter((item): item is HistoryItem => item && typeof item.expression === 'string' && typeof item.result === 'string' && typeof item.at === 'string').slice(0, 24)
  } catch {
    return []
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem('algebrix-history', JSON.stringify(items.slice(0, 24)))
    return true
  } catch {
    return false
  }
}

function readPanelFromUrl(): Panel {
  try {
    const tab = new URLSearchParams(window.location.search).get('tab')
    return panels.includes(tab as Panel) ? (tab as Panel) : 'calculator'
  } catch {
    return 'calculator'
  }
}

function writePanelToUrl(panel: Panel) {
  try {
    const url = new URL(window.location.href)
    if (panel === 'calculator') url.searchParams.delete('tab')
    else url.searchParams.set('tab', panel)
    window.history.replaceState(window.history.state, '', url)
  } catch {
    // The URL cannot be updated (for example in a sandboxed frame); the tab still switches.
  }
}

function loadExpression(): string {
  try {
    return sessionStorage.getItem('algebrix-expression') ?? 'sqrt(49)'
  } catch {
    return 'sqrt(49)'
  }
}

/** A result that Ans can reuse: a plain number or fraction. */
function isReusableAnswer(display: string): boolean {
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(display) || /^-?\d+\/\d+$/.test(display)
}

function parseNumberList(input: string): number[] {
  const pieces = input.split(',')
  // One trailing comma is harmless (it is how a list looks mid-typing); empty items inside are not.
  if (pieces.length > 1 && pieces[pieces.length - 1].trim() === '') pieces.pop()
  const values: number[] = []
  for (const piece of pieces) {
    const tokens = piece.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0 && pieces.length > 1) throw new Error('There is an empty item between two commas. Remove the extra comma.')
    for (const token of tokens) {
      const value = Number(token)
      if (!Number.isFinite(value)) throw new Error(`"${token}" is not a number. Enter numeric values separated by commas or spaces.`)
      values.push(value)
    }
  }
  if (values.length === 0) throw new Error('Enter numeric values separated by commas or spaces.')
  return values
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function parseMatrixInput(input: string): Matrix {
  const rows = input.split(';').map((row) => row.trim()).filter(Boolean).map(parseNumberList)
  if (rows.length === 0) throw new Error('Enter matrix rows separated by semicolons.')
  const width = rows[0].length
  if (rows.some((row) => row.length !== width)) throw new Error('Every matrix row needs the same number of values.')
  return rows
}

function formatMatrix(matrix: Matrix): string {
  return matrix.map((row) => `[${row.join(', ')}]`).join('\n')
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 10 }) : 'unsupported'
}

function MiniGraph({ expression }: { expression: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [traceX, setTraceX] = useState(1)
  const traceY = expression ? sampleFunction(expression, traceX) : null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const width = canvas.width = canvas.clientWidth * devicePixelRatio
    const height = canvas.height = canvas.clientHeight * devicePixelRatio
    ctx.scale(devicePixelRatio, devicePixelRatio)
    const w = width / devicePixelRatio
    const h = height / devicePixelRatio
    ctx.clearRect(0, 0, w, h)
    const colors = getComputedStyle(document.documentElement)
    ctx.fillStyle = colors.getPropertyValue('--background').trim()
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = colors.getPropertyValue('--border').trim()
    ctx.lineWidth = 1
    for (let i = 0; i <= 12; i += 1) {
      const x = (i / 12) * w
      const y = (i / 12) * h
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
    ctx.strokeStyle = colors.getPropertyValue('--muted').trim()
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke()
    ctx.strokeStyle = colors.getPropertyValue('--teal').trim()
    ctx.lineWidth = 2.4
    ctx.beginPath()
    let started = false
    let previousY = 0
    for (let px = 0; expression && px < w; px += 1) {
      const x = (px / w) * 12 - 6
      const y = sampleFunction(expression, x)
      if (y === null || Math.abs(y) > 1e4) { started = false; continue }
      const py = h / 2 - (y / 12) * h
      // Break the line at a jump across the whole view (an asymptote such as tan at ±π/2), not draw a false vertical.
      if (started && Math.abs(py - previousY) > h && Math.sign(y) !== Math.sign(h / 2 - previousY)) started = false
      if (!started) { ctx.moveTo(px, py); started = true } else ctx.lineTo(px, py)
      previousY = py
    }
    ctx.stroke()
    if (traceY !== null) {
      const px = ((traceX + 6) / 12) * w
      const py = h / 2 - (traceY / 12) * h
      ctx.fillStyle = colors.getPropertyValue('--highlight').trim()
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill()
    }
  }, [expression, traceX, traceY])

  return <div className="graph-card">
    <canvas ref={canvasRef} aria-label="Responsive graph canvas" />
    <label className="trace-control">Trace x
      <input type="range" min="-6" max="6" step="0.1" value={traceX} onChange={(event) => setTraceX(Number(event.target.value))} />
    </label>
    <p data-testid="trace-readout">{expression ? `trace: x=${traceX.toFixed(1)}, y=${traceY === null ? 'undefined' : traceY.toFixed(3)}` : 'trace: nothing plotted'}</p>
  </div>
}

export default function App() {
  const [expression, setExpression] = useState(loadExpression)
  const [result, setResult] = useState('Ready')
  const [angleMode, setAngleMode] = useState<AngleMode>('rad')
  const [precisionText, setPrecisionText] = useState(String(DEFAULT_PRECISION))
  const precision = precisionText.trim() === '' ? DEFAULT_PRECISION : clampPrecision(precisionText)
  const [exactMode, setExactMode] = useState(true)
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory)
  const [ans, setAns] = useState<string | undefined>(() => loadHistory().find((item) => isReusableAnswer(item.result))?.result)
  const [panel, setPanel] = useState<Panel>(readPanelFromUrl)
  const [keyFocus, setKeyFocus] = useState(0)
  const [graphError, setGraphError] = useState('')
  const [graphExpression, setGraphExpression] = useState('x^2')
  const [plotted, setPlotted] = useState('x^2')
  const [matrixText, setMatrixText] = useState('1, 2; 3, 4')
  const [rrefText, setRrefText] = useState('1, 2, 5; 3, 4, 11')
  const [statsText, setStatsText] = useState('1, 2, 3, 4, 5')
  const [regressionXText, setRegressionXText] = useState('1, 2, 3')
  const [regressionYText, setRegressionYText] = useState('2, 4, 6')
  const [financePv, setFinancePv] = useState('1000')
  const [financeRate, setFinanceRate] = useState('5')
  const [financePeriods, setFinancePeriods] = useState('2')
  const [financePmt, setFinancePmt] = useState('0')
  const [unitValue, setUnitValue] = useState('1')
  const [unitFrom, setUnitFrom] = useState('m')
  const [unitTo, setUnitTo] = useState('ft')
  const [notice, setNotice] = useState('')

  const matrixOutput = useMemo(() => {
    const out = { squareError: '', det: '', inverse: '', inverseError: '', rref: '', rrefError: '' }
    try {
      const matrix = parseMatrixInput(matrixText)
      out.det = formatNumber(determinant(matrix))
      try {
        out.inverse = formatMatrix(inverse(matrix))
      } catch (error) {
        out.inverseError = errorText(error, 'The inverse is unsupported for this matrix.')
      }
    } catch (error) {
      out.squareError = errorText(error, 'Matrix input is unsupported.')
    }
    try {
      out.rref = formatMatrix(rref(parseMatrixInput(rrefText)))
    } catch (error) {
      out.rrefError = errorText(error, 'Matrix input is unsupported.')
    }
    return out
  }, [matrixText, rrefText])

  const summaryOutput = useMemo(() => {
    try {
      return { summary: statsSummary(parseNumberList(statsText)), error: '' }
    } catch (error) {
      return { summary: null, error: errorText(error, 'Stats input is unsupported.') }
    }
  }, [statsText])

  const regressionOutput = useMemo(() => {
    try {
      return { regression: linearRegression(parseNumberList(regressionXText), parseNumberList(regressionYText)), error: '' }
    } catch (error) {
      return { regression: null, error: errorText(error, 'Regression input is unsupported.') }
    }
  }, [regressionXText, regressionYText])

  const financeOutput = useMemo(() => {
    const fields: [string, string][] = [[financePv, 'a present value'], [financeRate, 'a rate'], [financePeriods, 'the number of periods']]
    const missing = fields.find(([text]) => text.trim() === '')
    if (missing) return { ok: false, value: null, error: `Enter ${missing[1]}.` }
    const pv = Number(financePv)
    const rate = Number(financeRate) / 100
    const periods = Number(financePeriods)
    const pmt = financePmt.trim() === '' ? 0 : Number(financePmt)
    if ([pv, rate, periods, pmt].some((value) => !Number.isFinite(value))) return { ok: false, value: null, error: 'Finance values must be numeric.' }
    if (periods < 0) return { ok: false, value: null, error: 'Periods must be 0 or more.' }
    if (rate <= -1) return { ok: false, value: null, error: 'The rate must be greater than -100%.' }
    const value = financeFutureValue({ pv, rate, periods, pmt })
    if (!Number.isFinite(value)) return { ok: false, value: null, error: 'The result is too large to show.' }
    return { ok: true, value, pmt, error: '' }
  }, [financePv, financeRate, financePeriods, financePmt])

  const unitOutput = useMemo(() => {
    if (unitValue.trim() === '') return { ok: false, value: null, error: 'Enter a value to convert.' }
    const value = Number(unitValue)
    if (!Number.isFinite(value)) return { ok: false, value: null, error: 'Unit value must be numeric.' }
    try {
      return { ok: true, value: convertUnit(value, unitFrom, unitTo), error: '' }
    } catch (error) {
      return { ok: false, value: null, error: errorText(error, 'Unsupported conversion.').replace(/\b(f|c)\b/g, (unit) => unitLabel(unit)) }
    }
  }, [unitValue, unitFrom, unitTo])

  useEffect(() => {
    try {
      sessionStorage.setItem('algebrix-expression', expression)
    } catch {
      // Session storage is unavailable; the input simply resets on reload.
    }
  }, [expression])

  function selectPanel(next: Panel, focus = false) {
    setPanel(next)
    writePanelToUrl(next)
    if (focus) requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus())
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = panels.indexOf(panel)
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: panels.length - 1 }
    if (!(event.key in moves)) return
    event.preventDefault()
    selectPanel(panels[(moves[event.key] + panels.length) % panels.length], true)
  }

  function onKeypadKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: KEYPAD_COLUMNS, ArrowUp: -KEYPAD_COLUMNS }
    let next: number
    if (event.key in moves) next = keyFocus + moves[event.key]
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = keypadKeys.length - 1
    else return
    event.preventDefault()
    next = Math.min(keypadKeys.length - 1, Math.max(0, next))
    setKeyFocus(next)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
  }

  function plotGraph() {
    const check = checkPlotExpression(graphExpression)
    if (!check.ok) {
      setGraphError(check.message)
      setPlotted('')
      return
    }
    setGraphError('')
    setPlotted(graphExpression)
  }

  function calculate(nextExpression = expression) {
    const computed = runExpression(nextExpression, { angleMode, precision, exactMode, ans })
    setResult(computed.display)
    // Errors are shown but not saved, so they never fill history or replace Ans.
    if (!computed.ok) {
      setNotice('Check the expression or try a supported example.')
      return
    }
    if (isReusableAnswer(computed.display)) setAns(computed.display)
    const next = [{ expression: nextExpression, result: computed.display, at: new Date().toISOString() }, ...history].slice(0, 24)
    setHistory(next)
    const saved = saveHistory(next)
    setNotice(saved ? 'Result saved to local history.' : 'History is available for this visit only; browser storage is unavailable.')
  }

  function clearHistory() {
    if (history.length > 0 && !window.confirm('Delete all saved calculations on this device?')) return
    setHistory([])
    const cleared = saveHistory([])
    setNotice(cleared ? 'History cleared.' : 'History hidden for this visit. Browser storage could not be cleared; use your browser’s site-data settings to delete saved calculations.')
  }

  return <>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <main>
    <section className="hero-shell" aria-labelledby="hero-title">
      <div className="aurora" aria-hidden="true" />
      <nav className="topbar" aria-label="Primary">
        <img className="brand-mark" src="/brand/mark.svg" alt="" width="38" height="38" />
        <span className="brand-word">Algebrix</span>
        <a href="#calculator">Calculator</a>
        <a href="#modules">Modules</a>
        <a href="#boundaries">Scope</a>
      </nav>
      <div className="hero-grid" id="main-content" tabIndex={-1}>
        <div className="hero-copy">
          <p className="eyebrow">Scientific math · no login</p>
          <h1 id="hero-title">Algebrix is an <span className="nowrap">all-in-one</span> web calculator.</h1>
          <p className="lede">Calculate expressions, plot functions, and work with matrices and statistics.</p>
          <p className="local-disclosure">Your last 24 calculations stay in this browser.</p>
          <div className="hero-actions">
            <a className="button primary" href="#calculator">Start calculating</a>
            <button className="button ghost" onClick={() => { setExpression('10 choose 3'); calculate('10 choose 3') }}>Try 10 choose 3</button>
          </div>
        </div>
        <section id="calculator" className="calculator-card" aria-label="Algebrix calculator">
          <div className="display-panel">
            <label htmlFor="expression">Expression input</label>
            <input id="expression" aria-label="Expression input" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={expression} onChange={(event) => setExpression(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') calculate() }} />
            <div className="result" role="status" data-testid="primary-result">{result}</div>
          </div>
          <div className="key-grid" role="group" aria-label="Common calculator controls" onKeyDown={onKeypadKeyDown}>
            {keypadKeys.map((key, index) => <button key={key} tabIndex={index === keyFocus ? 0 : -1} onFocus={() => setKeyFocus(index)} onClick={() => setExpression((value) => value + key)}>{key}</button>)}
          </div>
          <div className="calc-actions">
            <button className="button primary" onClick={() => calculate()}>Calculate</button>
            <button className="button ghost" onClick={() => setExpression('')}>Clear input</button>
            <button className="button ghost" onClick={clearHistory}>Clear history</button>
          </div>
        </section>
      </div>
    </section>

    <section className="settings-strip" aria-label="Mode drawer">
      <label>Angle mode <select value={angleMode} onChange={(event) => setAngleMode(event.target.value as AngleMode)}><option value="rad">Radians</option><option value="deg">Degrees</option></select></label>
      <label>Precision <input aria-label="Precision" type="number" min="2" max="12" step="1" value={precisionText} onChange={(event) => setPrecisionText(event.target.value)} onBlur={() => setPrecisionText(String(precision))} /></label>
      <label className="toggle"><input aria-label="Prefer exact fractions" type="checkbox" checked={exactMode} onChange={(event) => setExactMode(event.target.checked)} /> Prefer exact fractions</label>
      <span className="notice" aria-live="polite">{notice}</span>
    </section>

    <section className="examples" aria-label="Calculator examples">
      {examples.map((item) => <button key={item.expression} onClick={() => { setExpression(item.expression); calculate(item.expression) }}><span>{item.group}</span>{item.label}</button>)}
    </section>

    <section id="modules" className="module-shell">
      <div className="module-tabs" role="tablist" aria-label="All-in-one calculator modules" onKeyDown={onTabKeyDown}>
        {panels.map((item) => <button key={item} id={`tab-${item}`} role="tab" aria-selected={panel === item} aria-controls={panel === item ? `panel-${item}` : undefined} tabIndex={panel === item ? 0 : -1} onClick={() => selectPanel(item)}>{item}</button>)}
      </div>
      {panel === 'graph' && <article className="module-card" id="panel-graph" role="tabpanel" aria-labelledby="tab-graph">
        <h2>Graphing</h2>
        <label>Graph expression <input aria-label="Graph expression" value={graphExpression} onChange={(event) => setGraphExpression(event.target.value)} /></label>
        <button className="button primary" onClick={plotGraph}>Plot graph</button>
        {graphError && <p role="alert">{graphError}</p>}
        <MiniGraph expression={plotted} />
      </article>}
      {panel === 'matrix' && <article className="module-card" id="panel-matrix" role="tabpanel" aria-labelledby="tab-matrix">
        <h2>Matrix lab</h2>
        <div className="module-form">
          <label>Square matrix rows
            <input aria-label="Square matrix rows" value={matrixText} onChange={(event) => setMatrixText(event.target.value)} placeholder="1, 2; 3, 4" />
          </label>
          <label>RREF matrix rows
            <input aria-label="RREF matrix rows" value={rrefText} onChange={(event) => setRrefText(event.target.value)} placeholder="1, 2, 5; 3, 4, 11" />
          </label>
        </div>
        <div className="module-results">
          {matrixOutput.squareError ? <p role="alert" data-testid="matrix-det">{matrixOutput.squareError}</p> : <>
            <p data-testid="matrix-det">Determinant: {matrixOutput.det}</p>
            <p>Inverse</p>{matrixOutput.inverseError ? <p role="alert" data-testid="matrix-inverse">{matrixOutput.inverseError}</p> : <pre data-testid="matrix-inverse">{matrixOutput.inverse}</pre>}
          </>}
          <p>RREF</p>{matrixOutput.rrefError ? <p role="alert" data-testid="matrix-rref">{matrixOutput.rrefError}</p> : <pre data-testid="matrix-rref">{matrixOutput.rref}</pre>}
        </div>
      </article>}
      {panel === 'stats' && <article className="module-card" id="panel-stats" role="tabpanel" aria-labelledby="tab-stats">
        <h2>Statistics + regression</h2>
        <div className="module-form three-up">
          <label>Data values
            <input aria-label="Data values" value={statsText} onChange={(event) => setStatsText(event.target.value)} />
          </label>
          <label>Regression x values
            <input aria-label="Regression x values" value={regressionXText} onChange={(event) => setRegressionXText(event.target.value)} />
          </label>
          <label>Regression y values
            <input aria-label="Regression y values" value={regressionYText} onChange={(event) => setRegressionYText(event.target.value)} />
          </label>
        </div>
        <div className="module-results">
          {summaryOutput.summary ? <p data-testid="stats-mean">Mean {formatNumber(summaryOutput.summary.mean)} · median {formatNumber(summaryOutput.summary.median)} · population σ {formatNumber(summaryOutput.summary.standardDeviation)} · sample s {summaryOutput.summary.sampleStandardDeviation === null ? 'needs n ≥ 2' : formatNumber(summaryOutput.summary.sampleStandardDeviation)} · n={summaryOutput.summary.count}</p> : <p role="alert" data-testid="stats-mean">{summaryOutput.error}</p>}
          {regressionOutput.regression ? <p data-testid="regression-slope">Regression slope {formatNumber(regressionOutput.regression.slope)} · intercept {formatNumber(regressionOutput.regression.intercept)} · r² {regressionOutput.regression.r2 === null ? 'undefined (all y values are equal)' : formatNumber(regressionOutput.regression.r2)}</p> : <p role="alert" data-testid="regression-slope">{regressionOutput.error}</p>}
        </div>
      </article>}
      {panel === 'finance' && <article className="module-card" id="panel-finance" role="tabpanel" aria-labelledby="tab-finance">
        <h2>Finance + units</h2>
        <div className="module-form four-up">
          <label>Present value
            <input aria-label="Present value" type="number" value={financePv} onChange={(event) => setFinancePv(event.target.value)} />
          </label>
          <label>Rate %
            <input aria-label="Rate percent" type="number" value={financeRate} onChange={(event) => setFinanceRate(event.target.value)} />
          </label>
          <label>Periods
            <input aria-label="Periods" type="number" value={financePeriods} onChange={(event) => setFinancePeriods(event.target.value)} />
          </label>
          <label>Payment
            <input aria-label="Payment" type="number" value={financePmt} onChange={(event) => setFinancePmt(event.target.value)} />
          </label>
        </div>
        <p data-testid="future-value">Future value: {financeOutput.ok && financeOutput.value !== null ? `${currency.format(financeOutput.value)}${financeOutput.pmt ? ' (payments at the end of each period)' : ''}` : financeOutput.error}</p>
        <div className="module-form three-up">
          <label>Unit value
            <input aria-label="Unit value" type="number" value={unitValue} onChange={(event) => setUnitValue(event.target.value)} />
          </label>
          <label>From unit
            <select aria-label="From unit" value={unitFrom} onChange={(event) => setUnitFrom(event.target.value)}>{[...lengthUnits, ...massUnits, ...temperatureUnits].map((unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select>
          </label>
          <label>To unit
            <select aria-label="To unit" value={unitTo} onChange={(event) => setUnitTo(event.target.value)}>{[...lengthUnits, ...massUnits, ...temperatureUnits].map((unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}</select>
          </label>
        </div>
        <p data-testid="unit-result">Unit result: {unitOutput.ok && unitOutput.value !== null ? `${formatNumber(unitOutput.value)} ${unitLabel(unitTo)}` : unitOutput.error}</p>
      </article>}
      {panel === 'calculator' && <article className="module-card" id="panel-calculator" role="tabpanel" aria-labelledby="tab-calculator"><h2>Local history</h2>{history.length === 0 ? <p>No saved calculations yet.</p> : <ol>{history.map((item) => <li key={item.at}><code>{item.expression}</code> → <strong>{item.result}</strong></li>)}</ol>}</article>}
    </section>

    <section id="boundaries" className="boundary-grid">
      <article><h2>Know the scope</h2><p>Algebra and calculus helpers support the examples above, not every symbolic expression. Graphs show x and y from −6 to 6. Check important results independently.</p></article>
      <article><h2>One Algebrix, two tools</h2><p>This browser calculator complements the Algebrix TI-84 Plus CE engine. It runs independently and does not claim hardware, emulator, or complete feature parity.</p></article>
    </section>
    <section id="privacy" className="privacy module-shell" aria-labelledby="privacy-title">
      <h2 id="privacy-title">Privacy</h2>
      <p>Expressions and results are saved in localStorage on this device (up to 24 calculations); they are not sent to a calculator server. Use Clear history to delete them, or clear this site's browser data. No accounts, tracking cookies, or app analytics are used. Fonts are served with the site.</p>
      <p>Vercel hosts the site and processes request metadata, such as IP address and browser information, to deliver and secure it. See <a href="https://vercel.com/legal/privacy-policy">Vercel's privacy policy</a>. Zendren LLC operates this site. For privacy requests, email <a href="mailto:hello@zendren.net">hello@zendren.net</a>. Hosting-record requests follow Vercel's retention policy.</p>
    </section>
    <footer>© {new Date().getFullYear()} <a href="https://zendren.net">Zendren</a> · <a href="#privacy">Calculator privacy</a> · <a href="https://zendren.net/privacy">Privacy</a> · <a href="https://zendren.net/terms">Terms</a></footer>
  </main>
  </>
}
