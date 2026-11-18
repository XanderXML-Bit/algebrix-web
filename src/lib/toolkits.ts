import { all, create } from 'mathjs'

const math = create(all, {})

export type Matrix = number[][]

function clean(value: number): number {
  const rounded = Number(value.toFixed(10))
  return Object.is(rounded, -0) ? 0 : rounded
}

function cleanMatrix(matrix: Matrix): Matrix {
  return matrix.map((row) => row.map(clean))
}

function requireSquare(matrix: Matrix, what: string) {
  const rows = matrix.length
  const cols = matrix[0]?.length ?? 0
  if (rows !== cols) throw new Error(`${what} needs a square matrix; this one is ${rows}×${cols}.`)
}

export function determinant(matrix: Matrix): number {
  requireSquare(matrix, 'The determinant')
  return clean(math.det(matrix) as number)
}

export function inverse(matrix: Matrix): Matrix {
  requireSquare(matrix, 'The inverse')
  // Singular, or singular to within floating-point error relative to the size of the rows.
  const rowScale = matrix.reduce((product, row) => product * Math.hypot(...row), 1)
  if (Math.abs(math.det(matrix) as number) <= 1e-12 * rowScale) throw new Error('No inverse: the determinant is 0, so the matrix is singular.')
  try {
    return cleanMatrix(math.inv(matrix) as Matrix)
  } catch {
    throw new Error('No inverse: the matrix is singular.')
  }
}

export function transpose(matrix: Matrix): Matrix {
  return cleanMatrix(math.transpose(matrix) as Matrix)
}

export function rref(input: Matrix): Matrix {
  const matrix = input.map((row) => row.slice())
  let lead = 0
  const rowCount = matrix.length
  const colCount = matrix[0]?.length ?? 0
  for (let r = 0; r < rowCount; r += 1) {
    if (lead >= colCount) return cleanMatrix(matrix)
    let i = r
    while (Math.abs(matrix[i][lead]) < 1e-12) {
      i += 1
      if (i === rowCount) {
        i = r
        lead += 1
        if (lead === colCount) return cleanMatrix(matrix)
      }
    }
    ;[matrix[i], matrix[r]] = [matrix[r], matrix[i]]
    const divisor = matrix[r][lead]
    matrix[r] = matrix[r].map((value) => value / divisor)
    for (let j = 0; j < rowCount; j += 1) {
      if (j !== r) {
        const factor = matrix[j][lead]
        matrix[j] = matrix[j].map((value, col) => value - factor * matrix[r][col])
      }
    }
    lead += 1
  }
  return cleanMatrix(matrix)
}

export function statsSummary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = clean(values.reduce((sum, value) => sum + value, 0) / values.length)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : clean((sorted[mid - 1] + sorted[mid]) / 2)
  const exactMean = values.reduce((sum, value) => sum + value, 0) / values.length
  const squares = values.reduce((sum, value) => sum + (value - exactMean) ** 2, 0)
  return {
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    /** Population standard deviation (divides by n). */
    standardDeviation: clean(Math.sqrt(squares / values.length)),
    /** Sample standard deviation (divides by n - 1); null when n < 2. */
    sampleStandardDeviation: values.length > 1 ? clean(Math.sqrt(squares / (values.length - 1))) : null,
    count: values.length,
  }
}

export function linearRegression(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 2) throw new Error('Regression requires equal x/y arrays with at least two points.')
  const n = x.length
  const meanX = x.reduce((sum, value) => sum + value, 0) / n
  const meanY = y.reduce((sum, value) => sum + value, 0) / n
  const numerator = x.reduce((sum, value, index) => sum + (value - meanX) * (y[index] - meanY), 0)
  const denominator = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0)
  if (denominator === 0) throw new Error('Regression needs at least two different x values.')
  const slope = numerator / denominator
  const intercept = meanY - slope * meanX
  const ssTot = y.reduce((sum, value) => sum + (value - meanY) ** 2, 0)
  const ssRes = y.reduce((sum, value, index) => sum + (value - (slope * x[index] + intercept)) ** 2, 0)
  // r² is undefined when every y value is the same (no variance to explain).
  const r2 = ssTot === 0 ? null : clean(1 - ssRes / ssTot)
  return { slope: clean(slope), intercept: clean(intercept), r: r2 === null ? null : clean(Math.sqrt(Math.max(0, r2))), r2 }
}

const lengthToMeters: Record<string, number> = { m: 1, km: 1000, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254, mi: 1609.344 }
const massToKg: Record<string, number> = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125 }

export function convertUnit(value: number, from: string, to: string): number {
  const a = from.toLowerCase()
  const b = to.toLowerCase()
  if (a === 'f' && b === 'c') return clean((value - 32) * 5 / 9)
  if (a === 'c' && b === 'f') return clean(value * 9 / 5 + 32)
  if (a in lengthToMeters && b in lengthToMeters) return clean((value * lengthToMeters[a]) / lengthToMeters[b])
  if (a in massToKg && b in massToKg) return clean((value * massToKg[a]) / massToKg[b])
  throw new Error(`Unsupported conversion: ${from} to ${to}`)
}

export function financeFutureValue({ pv, rate, periods, pmt = 0 }: { pv: number; rate: number; periods: number; pmt?: number }): number {
  const compound = pv * (1 + rate) ** periods
  const annuity = rate === 0 ? pmt * periods : pmt * (((1 + rate) ** periods - 1) / rate)
  return clean(compound + annuity)
}
