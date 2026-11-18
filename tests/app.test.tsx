import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'

HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  scale: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
  set fillStyle(_value: string) {}, set strokeStyle(_value: string) {}, set lineWidth(_value: number) {},
})) as unknown as HTMLCanvasElement['getContext']

describe('Algebrix app UI', () => {
  it('describes current capabilities and local history, not deployment plans', () => {
    const { container } = render(<App />)
    expect(screen.getByText('Calculate expressions, plot functions, and work with matrices and statistics.')).toBeInTheDocument()
    const lede = screen.getByText('Calculate expressions, plot functions, and work with matrices and statistics.')
    const disclosure = screen.getByText('Your last 24 calculations stay in this browser.')
    expect(lede.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.textContent).not.toMatch(/vercel.ready|ready for deployment|deploy to vercel/i)
  })
  it('loads hero, calculates a basic expression, and clears local history', async () => {
    const user = userEvent.setup()
    render(<App />)
    expect(screen.getByRole('heading', { name: /all-in-one web calculator/i })).toBeInTheDocument()
    const input = screen.getByLabelText(/expression input/i)
    await user.clear(input)
    await user.type(input, 'sqrt(49)')
    await user.click(screen.getByRole('button', { name: /^calculate$/i }))
    expect(screen.getByTestId('primary-result')).toHaveTextContent('7')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: /clear history/i }))
    expect(confirm).toHaveBeenCalledOnce()
    confirm.mockRestore()
    expect(screen.getByText(/history cleared/i)).toBeInTheDocument()
  })

  it('exposes graphing flow controls and trace readout', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: /^graph$/i }))
    await user.clear(screen.getByLabelText(/graph expression/i))
    await user.type(screen.getByLabelText(/graph expression/i), 'x^2')
    await user.click(screen.getByRole('button', { name: /plot graph/i }))
    expect(screen.getByTestId('trace-readout')).toHaveTextContent(/trace/i)
  })

  it('runs user-input module workflows for matrix, stats, finance, and units', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('tab', { name: /^matrix$/i }))
    await user.clear(screen.getByLabelText(/square matrix rows/i))
    await user.type(screen.getByLabelText(/square matrix rows/i), '2, 0; 0, 3')
    expect(screen.getByTestId('matrix-det')).toHaveTextContent('6')

    await user.click(screen.getByRole('tab', { name: /^stats$/i }))
    await user.clear(screen.getByLabelText(/^data values$/i))
    await user.type(screen.getByLabelText(/^data values$/i), '2, 4, 6, 8')
    await user.clear(screen.getByLabelText(/regression y values/i))
    await user.type(screen.getByLabelText(/regression y values/i), '3, 5, 7')
    expect(screen.getByTestId('stats-mean')).toHaveTextContent('Mean 5')
    expect(screen.getByTestId('regression-slope')).toHaveTextContent('Regression slope 2')

    await user.click(screen.getByRole('tab', { name: /^finance$/i }))
    await user.clear(screen.getByLabelText(/present value/i))
    await user.type(screen.getByLabelText(/present value/i), '2000')
    await user.clear(screen.getByLabelText(/rate percent/i))
    await user.type(screen.getByLabelText(/rate percent/i), '10')
    await user.clear(screen.getByLabelText(/periods/i))
    await user.type(screen.getByLabelText(/periods/i), '1')
    expect(screen.getByTestId('future-value')).toHaveTextContent('$2,200')

    await user.clear(screen.getByLabelText(/unit value/i))
    await user.type(screen.getByLabelText(/unit value/i), '2')
    await user.selectOptions(screen.getByLabelText(/from unit/i), 'm')
    await user.selectOptions(screen.getByLabelText(/to unit/i), 'cm')
    expect(screen.getByTestId('unit-result')).toHaveTextContent('200 cm')
  })
})
