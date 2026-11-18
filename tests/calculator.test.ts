import { describe, expect, it } from 'vitest'
import { evaluateExpression } from '../src/lib/calculator'

describe('evaluateExpression', () => {
  it('handles scientific expression samples with angle mode and exact-friendly arithmetic', () => {
    expect(evaluateExpression('2+3').display).toBe('5')
    expect(evaluateExpression('sqrt(49)').display).toBe('7')
    expect(evaluateExpression('sin(pi/6)', { angleMode: 'rad' }).display).toBe('0.5')
    expect(evaluateExpression('(1/2)+(1/3)').display).toBe('5/6')
    expect(evaluateExpression('5!').display).toBe('120')
    expect(evaluateExpression('10 choose 3').display).toBe('120')
  })

  it('reuses numeric and fractional history safely through Ans', () => {
    expect(evaluateExpression('Ans+1', { ans: '1/2' }).display).toBe('1.5')
    expect(evaluateExpression('Ans*2', { ans: '-1/2' }).display).toBe('-1')
    expect(evaluateExpression('Ans+1', { ans: '0.5' }).display).toBe('1.5')
    expect(evaluateExpression('2+2', { ans: 'Unsupported expression.' }).display).toBe('4')
    for (const ans of ['x+1', '1/0', 'Infinity', '2;3', 'Unsupported expression.']) {
      expect(evaluateExpression('Ans+1', { ans }).ok, ans).toBe(false)
    }
  })

  it('honors degree mode and precision settings', () => {
    expect(evaluateExpression('sin(30)', { angleMode: 'deg', precision: 4 }).display).toBe('0.5')
    expect(evaluateExpression('2/3', { precision: 3, exactMode: false }).display).toBe('0.667')
  })

  it('returns safe unsupported/error states instead of executing arbitrary JavaScript', () => {
    expect(evaluateExpression('alert(1)').ok).toBe(false)
    expect(evaluateExpression('Function("return window")()').ok).toBe(false)
  })
})
