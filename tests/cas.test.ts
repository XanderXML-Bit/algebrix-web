import { describe, expect, it } from 'vitest'
import { algebraCommand, derivative, definiteIntegral, limit } from '../src/lib/cas'

describe('CAS-lite helpers', () => {
  it('supports the acceptance algebra examples', () => {
    expect(algebraCommand('factor(x^2+5x+6)').display).toContain('(x+2)')
    expect(algebraCommand('solve(x^2-5x+6=0)').display).toContain('2')
    expect(algebraCommand('solve(x^2-5x+6=0)').display).toContain('3')
    expect(algebraCommand('solve(2x+3=7)').display).toContain('2')
  })

  it('supports calculus acceptance examples with honest fallbacks', () => {
    expect(derivative('x^3', 'x').display).toContain('3*x^2')
    expect(definiteIntegral('sin(x)', 'x', 0, Math.PI).display).toBe('2')
    expect(limit('sin(x)/x', 'x', 0).display).toBe('1')
  })
})
