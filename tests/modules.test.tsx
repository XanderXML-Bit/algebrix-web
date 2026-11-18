import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from '../src/App'

// Audit items N11-N12 and N16-N32: behaviour, not look.

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  scale: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
  set fillStyle(_value: string) {}, set strokeStyle(_value: string) {}, set lineWidth(_value: number) {},
})) as unknown as HTMLCanvasElement['getContext']

function calculate(expression: string): string {
  fireEvent.change(screen.getByLabelText(/expression input/i), { target: { value: expression } })
  fireEvent.click(screen.getByRole('button', { name: /^calculate$/i }))
  return screen.getByTestId('primary-result').textContent ?? ''
}

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('calculator behaviour', () => {
  it('N11: precision field clamps to 2-12', () => {
    render(<App />)
    const field = screen.getByLabelText('Precision') as HTMLInputElement
    fireEvent.change(field, { target: { value: '-1' } })
    fireEvent.blur(field)
    expect(field.value).toBe('2')
    expect(calculate('pi')).toBe('3.14')
    fireEvent.change(field, { target: { value: '50' } })
    fireEvent.blur(field)
    expect(field.value).toBe('12')
  })

  it('N12 and N28: Ans survives an error, and errors stay out of history', () => {
    render(<App />)
    expect(calculate('2+3')).toBe('5')
    expect(calculate('sqrt(')).toMatch(/unsupported/i)
    expect(calculate('Ans+1')).toBe('6')
    const saved = JSON.parse(localStorage.getItem('algebrix-history') ?? '[]') as { expression: string }[]
    expect(saved.map((item) => item.expression)).toEqual(['Ans+1', '2+3'])
  })

  it('N29: Clear history asks first and keeps history when declined', () => {
    render(<App />)
    calculate('2+2')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: /clear history/i }))
    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getAllByText('2+2').length).toBeGreaterThan(0)
    confirm.mockRestore()
  })

  it('N31: the expression input does not autocorrect or autocapitalize', () => {
    render(<App />)
    const input = screen.getByLabelText(/expression input/i)
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('autocapitalize', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
  })

  it('N32: the keypad is one tab stop with arrow-key movement', () => {
    render(<App />)
    const keys = screen.getByRole('group', { name: /common calculator controls/i }).querySelectorAll('button')
    expect([...keys].filter((key) => key.tabIndex === 0)).toHaveLength(1)
    keys[0].focus()
    fireEvent.keyDown(keys[0], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(keys[1])
    fireEvent.keyDown(keys[1], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(keys[6])
  })
})

describe('module tabs', () => {
  it('N30: tabs are a tablist with arrow-key movement and a labelled panel', () => {
    render(<App />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['calculator', 'graph', 'matrix', 'stats', 'finance'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'graph' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'graph' })).toBeInTheDocument()
  })

  it('N27: the selected tab and the expression survive a reload', () => {
    const { unmount } = render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'matrix' }))
    expect(window.location.search).toBe('?tab=matrix')
    fireEvent.change(screen.getByLabelText(/expression input/i), { target: { value: '12*12' } })
    unmount()
    render(<App />)
    expect(screen.getByRole('tab', { name: 'matrix' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(/expression input/i)).toHaveValue('12*12')
  })
})

describe('graph', () => {
  it('N16: an empty expression says so and stops plotting the old curve', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'graph' }))
    type(/graph expression/i, '')
    fireEvent.click(screen.getByRole('button', { name: /plot graph/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/enter an expression/i)
    expect(screen.getByTestId('trace-readout')).toHaveTextContent('trace: nothing plotted')
  })

  it('N17: an invalid expression explains the problem', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'graph' }))
    type(/graph expression/i, 'abc(')
    fireEvent.click(screen.getByRole('button', { name: /plot graph/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/could not read/i)
    type(/graph expression/i, 'abc')
    fireEvent.click(screen.getByRole('button', { name: /plot graph/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/unknown name: abc/i)
    type(/graph expression/i, 'y=2x')
    fireEvent.click(screen.getByRole('button', { name: /plot graph/i }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('trace-readout')).toHaveTextContent('y=2.000')
  })
})

describe('matrix', () => {
  it('N19: a singular matrix keeps its determinant and the unrelated RREF', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'matrix' }))
    type(/square matrix rows/i, '1, 2; 2, 4')
    expect(screen.getByTestId('matrix-det')).toHaveTextContent('Determinant: 0')
    expect(screen.getByTestId('matrix-inverse')).toHaveTextContent(/no inverse/i)
    expect(screen.getByTestId('matrix-rref')).toHaveTextContent('[1, 0, 1]')
  })

  it('N20: a non-square matrix gets a plain message, and a bad RREF input does not hide the square results', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'matrix' }))
    type(/square matrix rows/i, '1, 2, 3; 4, 5, 6')
    expect(screen.getByTestId('matrix-det')).toHaveTextContent('The determinant needs a square matrix; this one is 2×3.')
    expect(screen.getByTestId('matrix-det')).not.toHaveTextContent(/size: \[/)
    type(/square matrix rows/i, '2, 0; 0, 3')
    type(/rref matrix rows/i, '1, x')
    expect(screen.getByTestId('matrix-det')).toHaveTextContent('Determinant: 6')
    expect(screen.getByTestId('matrix-rref')).toHaveTextContent(/not a number/)
  })
})

describe('statistics', () => {
  it('N21: shows population σ and sample s, labelled', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'stats' }))
    type(/^data values$/i, '2, 4, 4, 4, 5, 5, 7, 9')
    expect(screen.getByTestId('stats-mean')).toHaveTextContent('Mean 5 · median 4.5 · population σ 2 · sample s 2.1380899353 · n=8')
  })

  it('N22 and N23: a regression error does not hide the summary; identical x is explained', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'stats' }))
    type(/regression x values/i, '1, 1, 1')
    expect(screen.getByTestId('stats-mean')).toHaveTextContent('Mean 3')
    expect(screen.getByTestId('regression-slope')).toHaveTextContent('Regression needs at least two different x values.')
  })

  it('N24: an empty item between commas is reported, not dropped', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'stats' }))
    type(/^data values$/i, '1,,2')
    expect(screen.getByTestId('stats-mean')).toHaveTextContent(/empty item/i)
    type(/^data values$/i, '1, 2,')
    expect(screen.getByTestId('stats-mean')).toHaveTextContent('n=2')
  })
})

describe('finance and units', () => {
  it('N25: currency is shown to the cent with the sign before the symbol', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'finance' }))
    expect(screen.getByTestId('future-value')).toHaveTextContent('Future value: $1,102.50')
    type(/present value/i, '-1000')
    expect(screen.getByTestId('future-value')).toHaveTextContent('Future value: -$1,102.50')
    type(/present value/i, '1000')
    type(/rate percent/i, '7.3')
    type(/periods/i, '15')
    expect(screen.getByTestId('future-value')).toHaveTextContent('Future value: $2,877.37')
    type(/periods/i, '-2')
    expect(screen.getByTestId('future-value')).toHaveTextContent('Periods must be 0 or more.')
  })

  it('N26: a blank unit value is not converted as 0, and temperatures read °F/°C', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: 'finance' }))
    type(/unit value/i, '')
    expect(screen.getByTestId('unit-result')).toHaveTextContent('Enter a value to convert.')
    type(/unit value/i, '212')
    fireEvent.change(screen.getByLabelText(/from unit/i), { target: { value: 'f' } })
    fireEvent.change(screen.getByLabelText(/to unit/i), { target: { value: 'c' } })
    expect(screen.getByTestId('unit-result')).toHaveTextContent('100 °C')
  })
})
