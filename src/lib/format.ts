import { format } from 'mathjs'

export const MIN_PRECISION = 2
export const MAX_PRECISION = 12
export const DEFAULT_PRECISION = 10

/** Clamp a precision setting to the range the Precision field offers (2 to 12 decimals). */
export function clampPrecision(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_PRECISION
  return Math.min(MAX_PRECISION, Math.max(MIN_PRECISION, Math.round(n)))
}

/**
 * Format a real number with `precision` decimal places, trimming trailing zeros.
 * Magnitudes of 1e21 or more switch to scientific notation with `precision` significant digits,
 * so huge results such as 100! honour the Precision setting instead of printing 16 digits.
 */
export function formatReal(value: number, precision = DEFAULT_PRECISION): string {
  if (!Number.isFinite(value)) return 'undefined'
  const digits = clampPrecision(precision)
  if (Math.abs(value) >= 1e21) {
    const [mantissa, exponent] = value.toExponential(digits - 1).split('e')
    const trimmed = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa
    return `${trimmed}e${exponent}`
  }
  const rounded = Number(format(value, { notation: 'fixed', precision: digits }))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

/** Format a complex number as `a + bi`, dropping a zero real or imaginary part after rounding. */
export function formatComplex(re: number, im: number, precision = DEFAULT_PRECISION): string {
  const real = formatReal(re, precision)
  const imagAbs = formatReal(Math.abs(im), precision)
  if (imagAbs === '0') return real
  const imag = imagAbs === '1' ? 'i' : `${imagAbs}i`
  if (real === '0') return im < 0 ? `-${imag}` : imag
  return `${real} ${im < 0 ? '-' : '+'} ${imag}`
}
