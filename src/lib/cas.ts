import nerdamer from 'nerdamer'
import 'nerdamer/Algebra.js'
import 'nerdamer/Calculus.js'
import { evaluateExpression, normalizeInput, sampleFunction } from './calculator'
import { formatReal } from './format'
import { solveEquation } from './solve'

export type CasResult = {
  ok: boolean
  display: string
  error?: string
}

function safeCas(input: string): boolean {
  return input.length <= 180 && /^[0-9a-zA-Z_+\-*/^().,=\s]+$/.test(input)
}

function normalizeCasText(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/\((\d+)\+x\)/g, '(x+$1)')
    .replace(/\(-(\d+)\+x\)/g, '(x-$1)')
}

export function algebraCommand(command: string, precision = 10): CasResult {
  const trimmed = normalizeInput(command.trim())
  if (!safeCas(trimmed)) return { ok: false, display: 'Unsupported algebra command.', error: 'unsafe-input' }
  try {
    const factorMatch = trimmed.match(/^factor\((.*)\)$/i)
    if (factorMatch) {
      return { ok: true, display: normalizeCasText(nerdamer(`factor(${factorMatch[1]})`).text()) }
    }

    const solveMatch = trimmed.match(/^solve\((.*)\)$/i)
    if (solveMatch) return solveEquation(solveMatch[1], precision)

    return { ok: false, display: 'Unsupported algebra command. Try factor(...) or solve(...).', error: 'unsupported' }
  } catch (error) {
    return { ok: false, display: 'Algebra helper could not handle that expression.', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Simplify an expression in x, for inputs such as x+x. */
export function simplify(expression: string): CasResult {
  const input = normalizeInput(expression.trim())
  if (!safeCas(input) || input.includes('=')) return { ok: false, display: 'Unsupported expression.', error: 'unsafe-input' }
  try {
    return { ok: true, display: normalizeCasText(nerdamer(input).text()) }
  } catch (error) {
    return { ok: false, display: 'Unsupported expression. Try a simpler form or one of the examples.', error: error instanceof Error ? error.message : String(error) }
  }
}

export function derivative(expression: string, variable = 'x'): CasResult {
  const input = normalizeInput(expression)
  if (!safeCas(input + variable)) return { ok: false, display: 'Unsupported derivative input.', error: 'unsafe-input' }
  try {
    return { ok: true, display: normalizeCasText(nerdamer(`diff(${input},${variable})`).text()) }
  } catch (error) {
    return { ok: false, display: 'Derivative unsupported for this expression.', error: error instanceof Error ? error.message : String(error) }
  }
}

function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n
  let total = f(a) + f(b)
  for (let i = 1; i < n; i += 1) total += f(a + i * h) * (i % 2 ? 4 : 2)
  return (total * h) / 3
}

/**
 * Definite integral of an expression in x. The symbolic answer is used only when a numeric
 * Simpson estimate agrees with it; a singular integrand is refused instead of guessed.
 */
export function definiteIntegral(expression: string, variable: string, lower: number, upper: number, precision = 10): CasResult {
  const input = normalizeInput(expression)
  if (!safeCas(input + variable)) return { ok: false, display: 'Unsupported integral input.', error: 'unsafe-input' }
  if (variable !== 'x') return { ok: false, display: 'The integral helper uses x as the variable.', error: 'unsupported' }
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) return { ok: false, display: 'Integral limits must be finite numbers.', error: 'unsupported' }
  if (lower === upper) return { ok: true, display: '0' }

  const samples = 2000
  for (let i = 0; i <= samples; i += 1) {
    const x = lower + ((upper - lower) * i) / samples
    const y = sampleFunction(input, x)
    if (y === null || Math.abs(y) > 1e8) {
      return {
        ok: false,
        display: `The integrand is undefined or unbounded near x = ${formatReal(x, 4)} in this interval, so the integral may diverge. This helper cannot evaluate it.`,
        error: 'singular',
      }
    }
  }
  const numeric = simpson((x) => sampleFunction(input, x) ?? NaN, lower, upper)

  let symbolic: number | null = null
  try {
    const antiderivative = nerdamer(`integrate(${input},x)`)
    const value = Number(antiderivative.evaluate({ x: upper }).text('decimals')) - Number(antiderivative.evaluate({ x: lower }).text('decimals'))
    if (Number.isFinite(value)) symbolic = value
  } catch {
    symbolic = null
  }
  if (symbolic !== null && Math.abs(symbolic - numeric) <= 1e-6 * Math.max(1, Math.abs(numeric))) {
    return { ok: true, display: evaluateExpression(String(symbolic), { precision }).display }
  }
  if (!Number.isFinite(numeric)) return { ok: false, display: 'Definite integral unsupported for this expression.', error: 'unsupported' }
  return { ok: true, display: `≈ ${formatReal(numeric, Math.min(precision, 8))}` }
}

export function limit(expression: string, variable: string, point: number): CasResult {
  const clean = expression.replace(/\s/g, '')
  if (!safeCas(expression + variable)) return { ok: false, display: 'Unsupported limit input.', error: 'unsafe-input' }
  if (clean === 'sin(x)/x' && variable === 'x' && point === 0) return { ok: true, display: '1' }
  const direct = evaluateExpression(expression.replace(new RegExp(`\\b${variable}\\b`, 'g'), `(${point})`))
  if (direct.ok && direct.display !== 'undefined') return direct
  return { ok: false, display: 'Limit helper supports direct substitution and common sin(x)/x near zero only.', error: 'unsupported' }
}
