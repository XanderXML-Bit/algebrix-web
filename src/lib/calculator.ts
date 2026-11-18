import { all, create, type MathNode } from 'mathjs'
import { clampPrecision, formatComplex, formatReal } from './format'

const math = create(all, {})
const exactMath = create(all, { number: 'Fraction' })

export type AngleMode = 'rad' | 'deg'

export type CalculatorOptions = {
  angleMode?: AngleMode
  precision?: number
  exactMode?: boolean
  ans?: number | string
}

export type CalculationResult = {
  ok: boolean
  display: string
  value?: unknown
  error?: string
}

/** An error whose message is written for the person using the calculator. */
export class CalcError extends Error {}

const UNSAFE_TOKENS = /(function|=>|window|document|globalThis|process|constructor|prototype|import|require|eval|alert|localStorage|sessionStorage)/i
const MAX_INPUT = 240
export const DIVISION_BY_ZERO = 'Division by zero is undefined.'
const TOO_LARGE = 'The result is too large to show (beyond about ±1.8e308).'
const NOT_DEFINED = 'The result is undefined for this input.'

/**
 * Drop thousands separators such as 1,000,000, but only outside function calls,
 * where a comma separates arguments (log(5,100) keeps its comma).
 */
function stripThousandsSeparators(input: string): string {
  const callStack: boolean[] = []
  let out = ''
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (ch === '(') callStack.push(/[a-zA-Z_]/.test(input[i - 1] ?? ''))
    if (ch === ')') callStack.pop()
    if (ch === ',' && !callStack.some(Boolean) && /\d/.test(input[i - 1] ?? '') && /^\d{3}(?!\d)/.test(input.slice(i + 1))) continue
    out += ch
  }
  return out
}

/** Map common typed and pasted forms onto the syntax the engine reads. */
export function normalizeInput(input: string): string {
  const typographic = input
    .replace(/[×·∙]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/π/g, 'pi')
    .replace(/√(\d+(?:\.\d+)?)/g, 'sqrt($1)')
    .replace(/√/g, 'sqrt')
    .replace(/\*\*/g, '^')
  return stripThousandsSeparators(typographic)
    .replace(/(\d+(?:\.\d+)?)\s+choose\s+(\d+(?:\.\d+)?)/gi, 'nCr($1,$2)')
    .replace(/(\d+(?:\.\d+)?)\s+permute\s+(\d+(?:\.\d+)?)/gi, 'nPr($1,$2)')
    .replace(/Ans\b/g, 'ans')
}

function hasOnlyAllowedCharacters(input: string): boolean {
  return /^[0-9a-zA-Z_+\-*/^().,\s!=%]+$/.test(input)
}

function parseAnswer(answer: string): number {
  const scalar = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
  const fraction = answer.match(/^(-?\d+)\/(\d+)$/)
  const value = fraction ? Number(fraction[1]) / Number(fraction[2]) : scalar.test(answer) ? Number(answer) : NaN
  if (!Number.isFinite(value)) throw new CalcError('Ans has no numeric result to reuse yet.')
  return value
}

type Fn1 = (x: number) => number

function isWholeNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function buildScope(options: CalculatorOptions) {
  const precision = clampPrecision(options.precision ?? 10)
  const deg = options.angleMode === 'deg'
  const toRad = (x: number) => (deg ? (x * Math.PI) / 180 : x)
  const fromRad = (x: number) => (deg ? (x * 180) / Math.PI : x)
  // Real inputs use the fast real path; complex inputs fall back to mathjs (radians only).
  const realOrComplex = (name: 'sin' | 'cos' | 'tan' | 'exp' | 'abs', fn: Fn1, angle: boolean) => (x: unknown) => {
    if (typeof x === 'number') return fn(angle ? toRad(x) : x)
    if (angle && deg) throw new CalcError('Complex inputs to trig functions need Radians mode.')
    return (math[name] as (v: unknown) => unknown)(x)
  }
  const inverseTrig = (name: 'asin' | 'acos', fn: Fn1) => (x: unknown) => {
    if (typeof x !== 'number') throw new CalcError(`${name} accepts real inputs only.`)
    if (x < -1 || x > 1) throw new CalcError('asin and acos need an input from -1 to 1.')
    return fromRad(fn(x))
  }
  const naturalLog = (x: unknown): number => {
    if (typeof x !== 'number') throw new CalcError('ln and log accept real inputs only.')
    if (x === 0) throw new CalcError('ln(0) and log(0) are undefined.')
    if (x < 0) throw new CalcError('ln and log need a positive input.')
    return Math.log(x)
  }
  return {
    pi: Math.PI,
    e: Math.E,
    // Only parse the scalar representation emitted by this calculator. Never evaluate history text.
    ans: typeof options.ans === 'string' ? parseAnswer(options.ans) : options.ans ?? 0,
    sin: realOrComplex('sin', Math.sin, true),
    cos: realOrComplex('cos', Math.cos, true),
    tan: (x: unknown) => {
      if (typeof x === 'number') {
        // tan has poles at odd multiples of π/2 (90°); floating point would print ~1.6e16 there.
        const k = deg ? x / 90 : x / (Math.PI / 2)
        const nearest = Math.round(k)
        if (Math.abs(k - nearest) < 1e-10 * Math.max(1, Math.abs(k)) && Math.abs(nearest % 2) === 1) {
          throw new CalcError('tan is undefined at odd multiples of π/2 (90°).')
        }
      }
      return realOrComplex('tan', Math.tan, true)(x)
    },
    asin: inverseTrig('asin', Math.asin),
    acos: inverseTrig('acos', Math.acos),
    atan: (x: unknown) => {
      if (typeof x !== 'number') throw new CalcError('atan accepts real inputs only.')
      return fromRad(Math.atan(x))
    },
    sqrt: (x: unknown) => {
      if (typeof x === 'number') return x < 0 ? math.complex(0, Math.sqrt(-x)) : Math.sqrt(x)
      return math.sqrt(x as never)
    },
    abs: realOrComplex('abs', Math.abs, false),
    exp: realOrComplex('exp', Math.exp, false),
    ln: naturalLog,
    log: (x: unknown, base?: unknown) => {
      if (base === undefined) {
        naturalLog(x)
        return Math.log10(x as number)
      }
      if (typeof base !== 'number' || base <= 0 || base === 1) throw new CalcError('The log base must be positive and not 1.')
      const numerator = naturalLog(x)
      if (base === 2) return Math.log2(x as number)
      if (base === 10) return Math.log10(x as number)
      return numerator / Math.log(base)
    },
    nCr: (n: number, r: number) => (isWholeNonNegative(n) && isWholeNonNegative(r) && r > n ? 0 : math.combinations(n, r)),
    nPr: (n: number, r: number) => (isWholeNonNegative(n) && isWholeNonNegative(r) && r > n ? 0 : math.permutations(n, r)),
    roundDisplay: (n: number) => formatReal(n, precision),
  }
}

function formatResult(value: unknown, options: CalculatorOptions): string {
  const precision = clampPrecision(options.precision ?? 10)
  if (options.exactMode !== false && math.isFraction(value)) {
    const f = value as unknown as { n: number | bigint; d: number | bigint; s: number | bigint }
    const numerator = Number(f.s) < 0 ? `-${String(f.n)}` : String(f.n)
    return String(f.d) === '1' ? numerator : `${numerator}/${String(f.d)}`
  }
  if (math.isFraction(value)) return formatReal((value as unknown as { valueOf(): number }).valueOf(), precision)
  if (typeof value === 'number') return formatReal(value, precision)
  if (math.isComplex(value)) {
    const z = value as unknown as { re: number; im: number }
    return formatComplex(z.re, z.im, precision)
  }
  if (typeof value === 'string') return value
  return String(value)
}

function isNonFinite(value: unknown): 'nan' | 'infinite' | null {
  const check = (n: number) => (Number.isNaN(n) ? 'nan' : Number.isFinite(n) ? null : 'infinite')
  if (typeof value === 'number') return check(value)
  if (math.isComplex(value)) {
    const z = value as unknown as { re: number; im: number }
    return check(z.re) ?? check(z.im)
  }
  return null
}

function isZero(value: unknown): boolean {
  if (value === 0) return true
  if (math.isComplex(value)) {
    const z = value as unknown as { re: number; im: number }
    return z.re === 0 && z.im === 0
  }
  return false
}

/** True when some a/b in the expression has a denominator equal to zero. */
function hasZeroDivision(input: string, scope: Record<string, unknown>): boolean {
  let found = false
  try {
    math.parse(input).traverse((node: MathNode) => {
      const op = node as MathNode & { fn?: string; args?: MathNode[] }
      if (found || op.type !== 'OperatorNode' || op.fn !== 'divide' || !op.args) return
      try {
        if (isZero(op.args[1].compile().evaluate({ ...scope }))) found = true
      } catch {
        // The denominator could not be evaluated on its own; ignore it.
      }
    })
  } catch {
    return false
  }
  return found
}

function friendlyError(error: unknown): string {
  if (error instanceof CalcError) return error.message
  const message = error instanceof Error ? error.message : String(error)
  if (/division by zero/i.test(message)) return DIVISION_BY_ZERO
  const symbol = message.match(/Undefined (?:symbol|function) (\w+)/)
  if (symbol) return `Unknown name: ${symbol[1]}. Check the spelling, or try one of the examples.`
  return 'Unsupported expression. Try a simpler form or one of the examples.'
}

export function evaluateExpression(rawInput: string, options: CalculatorOptions = {}): CalculationResult {
  const input = normalizeInput(rawInput.trim())
  if (!input) return { ok: false, display: 'Enter an expression.', error: 'empty' }
  if (input.length > MAX_INPUT) return { ok: false, display: 'Expression is too long for the browser calculator.', error: 'too-long' }
  if (UNSAFE_TOKENS.test(input) || !hasOnlyAllowedCharacters(input)) {
    return { ok: false, display: 'Unsupported or unsafe expression.', error: 'unsafe-input' }
  }

  try {
    const exactCandidate = options.exactMode !== false && /^[0-9+\-*/()\s]+$/.test(input) && input.includes('/')
    const scope = buildScope({ ...options, ans: /\bans\b/.test(input) ? options.ans : undefined })
    const value = exactCandidate ? exactMath.evaluate(input) : math.evaluate(input, { ...scope })
    const nonFinite = isNonFinite(value)
    if (nonFinite) {
      if (hasZeroDivision(input, scope)) return { ok: false, display: DIVISION_BY_ZERO, error: 'division-by-zero' }
      return nonFinite === 'nan'
        ? { ok: false, display: NOT_DEFINED, error: 'undefined' }
        : { ok: false, display: TOO_LARGE, error: 'overflow' }
    }
    return { ok: true, display: formatResult(value, options), value }
  } catch (error) {
    return { ok: false, display: friendlyError(error), error: error instanceof Error ? error.message : String(error) }
  }
}

export function sampleFunction(expression: string, x: number, options: CalculatorOptions = {}): number | null {
  const input = normalizeInput(expression.replace(/^\s*y\s*=\s*/, '').trim())
  if (!input || UNSAFE_TOKENS.test(input) || input.length > MAX_INPUT) return null
  try {
    const compiled = math.compile(input)
    const value = compiled.evaluate({ ...buildScope(options), x })
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

export type PlotCheck = { ok: true } | { ok: false; message: string }

/** Decide whether an expression can be plotted, and say why not when it cannot. */
export function checkPlotExpression(expression: string, options: CalculatorOptions = {}): PlotCheck {
  const input = normalizeInput(expression.replace(/^\s*y\s*=\s*/, '').trim())
  if (!input) return { ok: false, message: 'Enter an expression in x to plot, for example x^2.' }
  if (input.includes('=')) return { ok: false, message: 'Enter y = an expression in x, for example y=2x.' }
  if (UNSAFE_TOKENS.test(input) || !hasOnlyAllowedCharacters(input) || input.length > MAX_INPUT) {
    return { ok: false, message: 'Unsupported or unsafe expression.' }
  }
  let compiled: { evaluate: (scope?: Record<string, unknown>) => unknown }
  try {
    compiled = math.compile(input)
  } catch {
    return { ok: false, message: 'Could not read that expression. Check the brackets and operators.' }
  }
  const scope = buildScope(options)
  let lastError: unknown = null
  for (let i = 0; i <= 240; i += 1) {
    const x = -6 + (12 * i) / 240
    try {
      const value = compiled.evaluate({ ...scope, x })
      if (typeof value === 'number' && Number.isFinite(value)) return { ok: true }
    } catch (error) {
      lastError = error
    }
  }
  const symbol = lastError instanceof Error ? lastError.message.match(/Undefined (?:symbol|function) (\w+)/) : null
  if (symbol) return { ok: false, message: `Unknown name: ${symbol[1]}. Use x as the variable.` }
  return { ok: false, message: 'Nothing to plot: the expression has no real values for x from −6 to 6.' }
}
