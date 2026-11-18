import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from '../src/App'

// Regression tests for the 2026-11 audit items N1-N8 and N13.
// Expected values were checked independently with SymPy 1.x.

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  scale: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
  set fillStyle(_value: string) {}, set strokeStyle(_value: string) {}, set lineWidth(_value: number) {},
})) as unknown as HTMLCanvasElement['getContext']

function calculate(expression: string): string {
  const input = screen.getByLabelText(/expression input/i)
  fireEvent.change(input, { target: { value: expression } })
  fireEvent.click(screen.getByRole('button', { name: /^calculate$/i }))
  return screen.getByTestId('primary-result').textContent ?? ''
}

const JUNK_FRACTION = /\d{6,}\/\d{6,}/

describe('audit defects: calculator answers', () => {
  it('item 1 (N4): log(x, b) honours the base', () => {
    render(<App />)
    expect(calculate('log(8,2)')).toBe('3')
    expect(calculate('log(100)')).toBe('2')
    expect(calculate('log(81,3)')).toBe('4')
  })

  it('item 2 (N1): solve(x^2+1=0) returns i and -i exactly', () => {
    render(<App />)
    const shown = calculate('solve(x^2+1=0)')
    expect(shown).toBe('x = i, x = -i')
    expect(shown).not.toMatch(JUNK_FRACTION)
  })

  it('item 3 (N2): irrational roots are shown as sqrt or marked approximate, never as a fraction', () => {
    render(<App />)
    const shown = calculate('solve(x^2=2)')
    expect(shown).toBe('x = sqrt(2) ≈ 1.4142135624, x = -sqrt(2) ≈ -1.4142135624')
    expect(shown).not.toMatch(JUNK_FRACTION)
  })

  it('item 4 (N3): solve(sin(x)=0) does not invent rational roots', () => {
    render(<App />)
    const shown = calculate('solve(sin(x)=0)')
    expect(shown).not.toMatch(JUNK_FRACTION)
    expect(shown).toMatch(/polynomial/i)
  })

  it.each([
    ['solve x^2-4=0', 'x = -2, x = 2'],
    ['x^2-4=0', 'x = -2, x = 2'],
    ['factor x^2-4', '(x-2)*(x+2)'],
    ['2**3', '8'],
    ['1,000+1', '1001'],
    ['3 × 4', '12'],
    ['6 ÷ 2', '3'],
  ])('item 5 (N13): natural input form %s is accepted', (input, expected) => {
    render(<App />)
    expect(calculate(input)).toBe(expected)
  })

  it.each([
    ['sqrt(-1)', /^i$/],
    ['sqrt(-4)', /^2i$/],
    ['i^2', /^-1$/],
    ['asin(2)', /-1 to 1/],
    ['1/0', /^Division by zero is undefined\.$/],
    ['171!', /too large/i],
    ['1e400', /too large/i],
    ['tan(pi/2)', /^tan is undefined/],
  ])('item 6 (N5-N8): %s gives an honest result', (input, expected) => {
    render(<App />)
    expect(calculate(input)).toMatch(expected)
  })
})
