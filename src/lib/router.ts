import { algebraCommand, definiteIntegral, derivative, limit, simplify, type CasResult } from './cas'
import { evaluateExpression, normalizeInput, type AngleMode, type CalculationResult } from './calculator'
import { clampPrecision } from './format'
import { solveEquation } from './solve'

export type RunOptions = {
  angleMode?: AngleMode
  precision?: number
  exactMode?: boolean
  ans?: string
}

const COMMANDS = 'solve|factor|derivative|diff'

/** Route one line of calculator input to the right helper. Accepts natural forms such as `solve x^2-4=0`. */
export function runExpression(expression: string, options: RunOptions = {}): CalculationResult | CasResult {
  const precision = clampPrecision(options.precision ?? 10)
  let trimmed = normalizeInput(expression.trim())
  // `solve x^2-4=0` and `factor x^2-4` → `solve(x^2-4=0)` and `factor(x^2-4)`
  const bare = trimmed.match(new RegExp(`^(${COMMANDS})\\s+(.+)$`, 'i'))
  if (bare) trimmed = `${bare[1]}(${bare[2]})`

  const deriv = trimmed.match(/^(?:derivative|diff)\((.*?)(?:,\s*([a-z]))?\)$/i)
  if (deriv) return derivative(deriv[1], deriv[2] ?? 'x')
  const integral = trimmed.match(/^integral\((.*),\s*(-?[\d.]+|-?pi),\s*(-?[\d.]+|-?pi)\)$/i)
  if (integral) {
    const bound = (text: string) => {
      const lowered = text.toLowerCase()
      if (lowered === 'pi') return Math.PI
      if (lowered === '-pi') return -Math.PI
      return Number(text)
    }
    return definiteIntegral(integral[1], 'x', bound(integral[2]), bound(integral[3]), precision)
  }
  const lim = trimmed.match(/^limit\((.*),\s*([a-z]),\s*(-?[\d.]+)\)$/i)
  if (lim) return limit(lim[1], lim[2], Number(lim[3]))
  if (/^(factor|solve)\(/i.test(trimmed)) return algebraCommand(trimmed, precision)

  // A bare equation: solve it when it is in x; point y = ... at the graph.
  if (/(^|[^=<>!])=($|[^=])/.test(trimmed)) {
    if (/^\s*y\s*=/.test(trimmed)) return { ok: false, display: 'To plot y = ..., open the Graph tab. To solve, write an equation in x, for example x^2-4=0.', error: 'graph-equation' }
    // x may follow a digit, as in 2x+3=7, but not a letter, as in exp(1)=y.
    if (/(^|[^a-z])x([^a-z]|$)/i.test(trimmed)) return solveEquation(trimmed, precision)
    return { ok: false, display: 'To solve an equation, include x, for example x^2-4=0.', error: 'no-variable' }
  }

  const result = evaluateExpression(trimmed, { angleMode: options.angleMode, precision, exactMode: options.exactMode, ans: options.ans })
  // An expression in x, such as x+x, cannot be evaluated to a number; simplify it instead.
  if (!result.ok && /Undefined symbol x\b/.test(result.error ?? '')) {
    const simplified = simplify(trimmed)
    if (simplified.ok) return simplified
  }
  return result
}
