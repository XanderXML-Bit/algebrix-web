import { describe, expect, it } from 'vitest'
import { determinant, inverse, rref, statsSummary, linearRegression, convertUnit, financeFutureValue } from '../src/lib/toolkits'

describe('all-in-one calculator toolkits', () => {
  it('computes matrix determinant, inverse, and rref', () => {
    const matrix = [[1, 2], [3, 4]]
    expect(determinant(matrix)).toBe(-2)
    expect(inverse(matrix)).toEqual([[-2, 1], [1.5, -0.5]])
    expect(rref([[1, 2, 5], [3, 4, 11]])).toEqual([[1, 0, 1], [0, 1, 2]])
  })

  it('computes statistics and regression', () => {
    expect(statsSummary([1, 2, 3, 4, 5])).toMatchObject({ mean: 3, median: 3, min: 1, max: 5 })
    const regression = linearRegression([1, 2, 3], [2, 4, 6])
    expect(regression.slope).toBe(2)
    expect(regression.intercept).toBe(0)
    expect(regression.r2).toBe(1)
  })

  it('supports finance and unit utility examples', () => {
    expect(convertUnit(1, 'm', 'ft')).toBeCloseTo(3.28084, 5)
    expect(convertUnit(32, 'f', 'c')).toBe(0)
    expect(financeFutureValue({ pv: 1000, rate: 0.05, periods: 2 })).toBeCloseTo(1102.5, 2)
  })
})
