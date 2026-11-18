import { describe, expect, it } from 'vitest'
import { solveEquation, numericRoots } from '../src/lib/solve'
import { runExpression } from '../src/lib/router'
import { evaluateExpression } from '../src/lib/calculator'
import { clampPrecision, formatReal } from '../src/lib/format'

// Reference values come from SymPy (solve / Poly.nroots).
const EXACT_LOOKING_FRACTION = /\d{6,}\/\d{6,}/

describe('polynomial solver', () => {
  it.each([
    ['x^2-5x+6=0', 'x = 2, x = 3'],
    ['2x+3=7', 'x = 2'],
    ['0.5x=1', 'x = 2'],
    ['x^3-6x^2+11x-6=0', 'x = 1, x = 2, x = 3'],
    ['x^2-2x+1=0', 'x = 1'],
    ['x^3=0', 'x = 0'],
    ['x^2+4=0', 'x = 2i, x = -2i'],
    ['4x^2+1=0', 'x = i/2, x = -i/2'],
    ['x^2-8=0', 'x = 2*sqrt(2) ≈ 2.8284271247, x = -2*sqrt(2) ≈ -2.8284271247'],
    ['2x^2-3x-1=0', 'x = 3/4 + sqrt(17)/4 ≈ 1.7807764064, x = 3/4 - sqrt(17)/4 ≈ -0.2807764064'],
    ['x^2+x+1=0', 'x = -1/2 + sqrt(3)*i/2 ≈ -0.5 + 0.8660254038i, x = -1/2 - sqrt(3)*i/2 ≈ -0.5 - 0.8660254038i'],
    ['x^2=-2', 'x = sqrt(2)*i ≈ 1.4142135624i, x = -sqrt(2)*i ≈ -1.4142135624i'],
    ['(x-1)^2*(x+3)=0', 'x = -3, x = 1'],
    ['x^2/4-1=0', 'x = -2, x = 2'],
  ])('solves %s exactly', (equation, expected) => {
    expect(solveEquation(equation).display).toBe(expected)
  })

  it('marks numeric roots of cubics and higher with ≈ (SymPy nroots)', () => {
    expect(solveEquation('x^3-2=0').display).toBe('x ≈ 1.2599210499, x ≈ -0.6299605249 + 1.091123636i, x ≈ -0.6299605249 - 1.091123636i')
    const quintic = solveEquation('x^5-x-1=0').display
    expect(quintic.startsWith('x ≈ 1.1673039783')).toBe(true)
    expect(quintic).toContain('x ≈ 0.1812324445 + 1.0839541013i')
    expect(solveEquation('x^2=pi').display).toBe('x ≈ -1.7724538509, x ≈ 1.7724538509')
  })

  it('never shows an approximation as an exact fraction', () => {
    for (const equation of ['x^2=2', 'x^2=3', 'x^3-2=0', 'x^2=pi', 'x^2+1=0', 'x^4-5x^2+6=0', '3x^2-7x+1=0', 'x^2=0.1']) {
      const shown = solveEquation(equation).display
      expect(shown, equation).not.toMatch(EXACT_LOOKING_FRACTION)
      for (const part of shown.split(', ')) {
        // Every part is either a whole/fractional exact root, a surd with ≈, or an ≈ decimal.
        expect(part, equation).toMatch(/^x (= -?\d+(\/\d+)?$|= -?\d*i(\/\d+)?$|= .*sqrt\(\d+\).* ≈ |≈ )/)
      }
    }
  })

  it('reports identities, contradictions and non-polynomial equations honestly', () => {
    expect(solveEquation('x=x').display).toMatch(/every x/i)
    expect(solveEquation('1=2').display).toMatch(/no solution/i)
    expect(solveEquation('sin(x)=0')).toMatchObject({ ok: false })
    expect(solveEquation('1/x=2')).toMatchObject({ ok: false })
    expect(solveEquation('x^2=y')).toMatchObject({ ok: false })
    expect(solveEquation('x=1=2')).toMatchObject({ ok: false })
  })

  it('finds numeric roots that satisfy the polynomial', () => {
    const roots = numericRoots([-1, -1, 0, 0, 0, 1])
    for (const z of roots) {
      // |p(z)| for p = x^5 - x - 1
      let re = 1
      let im = 0
      for (let k = 0; k < 5; k += 1) [re, im] = [re * z.re - im * z.im, re * z.im + im * z.re]
      expect(Math.hypot(re - z.re - 1, im - z.im)).toBeLessThan(1e-9)
    }
  })
})

// Review findings on the solver. Expected values from SymPy 1.14 with Rational literals.
describe('typed decimals and numeric safety', () => {
  it.each([
    ['x=0.123456789123', 'x = 123456789123/1000000000000 ≈ 0.1234567891'],
    ['x=1e-20', 'x = 1/100000000000000000000 ≈ 1e-20'],
    ['x^2=1e-30', 'x = 1/1000000000000000 ≈ 1e-15, x = -1/1000000000000000 ≈ -1e-15'],
    ['1e-20x^2-1=0', 'x = 10000000000, x = -10000000000'],
    ['x=123456789.123456789', 'x = 123456789123456789/1000000000 ≈ 123456789.123456789'],
    ['0.12345678901234567x-1=0', 'x = 100000000000000000/12345678901234567 ≈ 8.1000000729'],
    ['x=1.4142135623730951', 'x = 14142135623730951/10000000000000000 ≈ 1.4142135624'],
  ])('keeps the exact value of typed decimals in %s', (equation, expected) => {
    expect(solveEquation(equation).display).toBe(expected)
  })

  it('shows sqrt of a typed decimal with its true value', () => {
    // SymPy: sqrt(123456789123)/1000000 = 0.351364183039...
    expect(solveEquation('x^2=0.123456789123').display).toBe(
      'x = sqrt(123456789123)/1000000 ≈ 0.351364183, x = -sqrt(123456789123)/1000000 ≈ -0.351364183',
    )
  })

  it('refuses pi or e above degree 2, and never reports NaN for huge coefficients', () => {
    expect(solveEquation('pi*x^3+1e200=0')).toMatchObject({ ok: false, error: 'unsupported-degree' })
    for (const equation of ['x^3+1e300x+1=0', '1e-300x^3+x+1=0', 'x^3-1e308=0']) {
      const r = solveEquation(equation)
      expect(r.ok, equation).toBe(true)
      expect(r.display, equation).not.toMatch(/NaN|undefined|Infinity/)
    }
  })

  it('keeps huge and tiny exact roots readable and marked approximate (SymPy)', () => {
    expect(solveEquation('x*1e-400=1').display).toBe('x ≈ 1e+400')
    expect(solveEquation('2^1024*x=1').display).toBe('x ≈ 5.562684646e-309')
    expect(solveEquation('x^3-1e308=0').display.startsWith('x ≈ 4.641588834e+102')).toBe(true)
  })

  it('solves repeated roots exactly through the square-free part (SymPy roots)', () => {
    expect(solveEquation('(x^2-2)^2=0').display).toBe('x = sqrt(2) ≈ 1.4142135624, x = -sqrt(2) ≈ -1.4142135624')
    expect(solveEquation('(x-1)^2*(x^3-2)=0').display).toBe('x = 1, x ≈ 1.2599210499, x ≈ -0.6299605249 + 1.091123636i, x ≈ -0.6299605249 - 1.091123636i')
  })

  it('bounds constant powers instead of stalling', () => {
    const started = Date.now()
    expect(solveEquation('1^1000000000000*x=1')).toMatchObject({ ok: false })
    expect(solveEquation('2^100000*x=1')).toMatchObject({ ok: false })
    expect(solveEquation('1e500^1000*x=1')).toMatchObject({ ok: false })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(solveEquation('2^10*x=1').display).toBe('x = 1/1024 ≈ 0.0009765625')
    expect(solveEquation('x^2-4=0').display).toBe('x = -2, x = 2')
  })
})

describe('other audit items', () => {
  it('N9: precision applies to very large results and complex parts', () => {
    expect(evaluateExpression('100!').display).toBe('9.332621544e+157')
    expect(evaluateExpression('100!', { precision: 4 }).display).toBe('9.333e+157')
    expect(evaluateExpression('(-8)^(1/3)').display).toBe('1 + 1.7320508076i')
  })

  it('N10: n choose k with k > n is 0', () => {
    expect(evaluateExpression('5 choose 7').display).toBe('0')
    expect(evaluateExpression('5 permute 7').display).toBe('0')
  })

  it('N11: precision is clamped to 2-12', () => {
    expect(clampPrecision(-1)).toBe(2)
    expect(clampPrecision(50)).toBe(12)
    expect(clampPrecision('7')).toBe(7)
    expect(evaluateExpression('pi', { precision: -1 }).display).toBe('3.14')
    expect(formatReal(Math.PI, 50)).toBe('3.14159265359')
  })

  it('N14: derivative defaults to x', () => {
    expect(runExpression('derivative(x^2)').display).toBe('2*x')
    expect(runExpression('derivative(x^3,x)').display).toBe('3*x^2')
  })

  it('N15: a singular integrand is refused, not integrated', () => {
    expect(runExpression('integral(1/x,0,1)')).toMatchObject({ ok: false })
    expect(runExpression('integral(1/x,-1,1)')).toMatchObject({ ok: false })
    expect(runExpression('integral(sin(x),0,pi)').display).toBe('2')
    expect(runExpression('integral(x^2,0,3)').display).toBe('9')
  })

  it('keeps the log base and domain rules', () => {
    expect(evaluateExpression('log(8,2)').display).toBe('3')
    expect(evaluateExpression('log(5,100)').display).toBe('0.3494850022')
    expect(evaluateExpression('ln(-1)').display).toMatch(/positive/)
    expect(evaluateExpression('log(8,1)').display).toMatch(/base/)
    expect(evaluateExpression('tan(90)', { angleMode: 'deg' }).display).toMatch(/^tan is undefined/)
    expect(evaluateExpression('tan(45)', { angleMode: 'deg' }).display).toBe('1')
    expect(evaluateExpression('0/0').display).toBe('Division by zero is undefined.')
    expect(evaluateExpression('2/(1-1)', { exactMode: false }).display).toBe('Division by zero is undefined.')
  })

  it('N13: thousands separators are stripped only outside function calls', () => {
    expect(evaluateExpression('1,000,000/1,000').display).toBe('1000')
    expect(evaluateExpression('nCr(10,3)').display).toBe('120')
    expect(runExpression('x+x').display).toBe('2*x')
    expect(runExpression('y=2x')).toMatchObject({ ok: false })
  })
})

// Second-round review findings (D1-D4, N-1 and R2-F1 to R2-F5).
// Expected values: SymPy 1.14 with Rational literals; mpmath polyroots at 60 digits for higher degrees.
describe('round-2 review: exact coefficients, certified roots', () => {
  const never = /NaN|undefined|Infinity/

  it('refuses exponent literals too long to expand, quickly (R2-F1)', () => {
    const started = Date.now()
    expect(solveEquation('1e1000000000*x=1')).toMatchObject({ ok: false })
    expect(solveEquation('1e-1000000000*x=1')).toMatchObject({ ok: false })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(solveEquation('1e600*x=1').display).toBe('x ≈ 1e-600')
  })

  it.each([
    ['x^2=1e400+1', 'x ≈ 1e+200, x ≈ -1e+200'],
    ['x^2+1e400+1=0', 'x ≈ 1e+200i, x ≈ -1e+200i'],
    ['3*x^2=1e400+7', 'x ≈ 5.773502692e+199, x ≈ -5.773502692e+199'],
    ['x^2=1e309+3', 'x ≈ 3.16227766e+154, x ≈ -3.16227766e+154'],
  ])('shows huge surd roots as finite approximations: %s (D1, R2-F2)', (equation, expected) => {
    expect(solveEquation(equation)).toEqual({ ok: true, display: expected })
  })

  it.each([
    ['pi*1e-400*x=1e-400', 'x ≈ 0.3183098862'],
    ['pi*x=1e-400', 'x ≈ 3.183098862e-401'],
    ['pi*x=3.141592653589793*x+1', 'x ≈ 4193528956200935.449402107'],
    ['(pi+1e-20)*x^2-pi*x^2-1=0', 'x = 10000000000, x = -10000000000'],
    ['pi+1e-400=pi', 'No solution: the equation is never true.'],
    ['pi*x+1e-400=pi*x', 'No solution: the equation is never true.'],
    ['pi*x=pi*x', 'Every x is a solution: both sides are always equal.'],
  ])('keeps tiny and cancelling pi coefficients exact: %s (D2, R2-F3)', (equation, expected) => {
    expect(solveEquation(equation).display).toBe(expected)
  })

  it.each(['x^1.00000000000000001=2', 'x^2.0000000000000001=4', 'x^2.0000000000000000001=4', 'x^1e-400=2', 'x^pi=2'])(
    'refuses an exponent that is not exactly whole: %s (D3, R2-F4)',
    (equation) => {
      expect(solveEquation(equation)).toMatchObject({ ok: false, error: 'not-polynomial' })
    },
  )

  it.each([
    ['pi*(x-1)^2=0', 'x = 1'],
    ['pi*x^2-2*pi*x+pi=0', 'x = 1'],
    ['e*(x-3)^2=0', 'x = 3'],
    ['pi*(x-1)^3=0', 'x = 1'],
    ['pi*(x^2-2)^2=0', 'x = sqrt(2) ≈ 1.4142135624, x = -sqrt(2) ≈ -1.4142135624'],
    ['x^2-2*pi*x+pi^2=0', 'x ≈ 3.1415926536'],
    ['pi*x^2+1=0', 'x ≈ 0.5641895835i, x ≈ -0.5641895835i'],
  ])('solves repeated roots with a pi or e factor exactly: %s (D4)', (equation, expected) => {
    expect(solveEquation(equation).display).toBe(expected)
  })

  it.each([
    ['x^2+1e30*x+1=0', 'x ≈ -1e-30, x ≈ -1e+30'],
    ['x^3+1e30*x+1=0', 'x ≈ -1e-30, x ≈ 5e-31 + 1000000000000000i, x ≈ 5e-31 - 1000000000000000i'],
    // The real parts 5e-301 and 0.5 sit far below the 80-digit accuracy of a root of size 1e150, so they
    // are shown as 0 (relative error under 1e-150) rather than as unverified digits.
    ['x^3+1e300x+1=0', 'x ≈ -1e-300, x ≈ 1e+150i, x ≈ -1e+150i'],
    ['1e-300x^3+x+1=0', 'x ≈ -1, x ≈ 1e+150i, x ≈ -1e+150i'],
    ['x^3-3x+1=0', 'x ≈ -1.8793852416, x ≈ 0.3472963553, x ≈ 1.5320888862'],
  ])('keeps small roots next to huge ones: %s (R2-F5)', (equation, expected) => {
    expect(solveEquation(equation).display).toBe(expected)
  })

  it('handles large degree-24 inputs and repeated complex factors', () => {
    const big = solveEquation('x^24+1e300x+1=0')
    expect(big.ok).toBe(true)
    expect(big.display.split(', ')).toHaveLength(24)
    // Real roots: -(1e300)^(1/23) = -1.1052951411e13 and about -1e-300, listed in ascending order.
    expect(big.display.startsWith('x ≈ -11052951411260.2159124352, x ≈ -1e-300, ')).toBe(true)
    expect(solveEquation('(x^2+1)^5*(x^3-x-1)^4=0').display).toBe(
      'x ≈ 1.3247179572, x ≈ -0.6623589786 + 0.5622795121i, x ≈ -0.6623589786 - 0.5622795121i, x ≈ i, x ≈ -i',
    )
    expect(solveEquation('pi^4096*x=1')).toMatchObject({ ok: false, error: 'too-large' })
    // Roots spread from 1e100 down to a cluster near 1e-9 are beyond the starting method: refused, not guessed.
    expect(solveEquation('x^23+x^22*1e100+1e-100=0')).toMatchObject({ ok: false, error: 'no-convergence' })
  })

  it('refuses pi or e above degree 2 instead of guessing', () => {
    expect(solveEquation('pi*x^3+1e30*x+1=0')).toMatchObject({ ok: false, error: 'unsupported-degree' })
  })

  it('never reports a failed computation as a result', () => {
    for (const equation of ['x^2=1e400+1', 'x^2+x=1e400', '1e-400*x^2=1e400+1', 'x^5-1e-300=0', 'x^20-x-1=0', 'x^24-1=0']) {
      const r = solveEquation(equation)
      expect(r.ok, equation).toBe(true)
      expect(r.display, equation).not.toMatch(never)
    }
    // Every root is listed, even when two look alike after rounding.
    expect(solveEquation('x^24-1=0').display.split(', ')).toHaveLength(24)
    expect(solveEquation('x^20-x-1=0').display.split(', ')).toHaveLength(20)
  })

  it('recognises bare equations with an implicit coefficient on x (N-1)', () => {
    expect(runExpression('2x+3=7').display).toBe('x = 2')
    expect(runExpression('3x=6').display).toBe('x = 2')
    expect(runExpression('2x^2=8').display).toBe('x = -2, x = 2')
  })
})


describe('round-3 review: bounded exact work (R3-F1)', () => {
  // Generous headroom over the measured Node times (refusals about 0.2 s), so slow CI machines still pass.
  const quick = (equation: string) => {
    const start = performance.now()
    const result = solveEquation(equation)
    return { result, ms: performance.now() - start }
  }

  it('refuses the degree-24 repro quickly instead of freezing', () => {
    const { result, ms } = quick('x^24+1e600*x^17+1e-600*x^9+x+1=0')
    expect(result).toMatchObject({ ok: false, error: 'too-large' })
    expect(ms).toBeLessThan(2000)
  })

  it('refuses coefficient growth from one large positive exponent quickly', () => {
    const { result, ms } = quick('x^24+1e600*x^17+x+1=0')
    expect(result).toMatchObject({ ok: false, error: 'too-large' })
    expect(ms).toBeLessThan(2000)
  })

  it('refuses a product of degree-8 factors with spread coefficients quickly', () => {
    const { result, ms } = quick('(x^8+1e300*x+1)*(x^8+x+1e-300)*(x^8+x+2)=0')
    expect(result).toMatchObject({ ok: false, error: 'too-large' })
    expect(ms).toBeLessThan(2000)
  })

  it('stops inside the gcd work when the admission check lets an input through', () => {
    // Degree 24 times about 1661 coefficient bits is just under the admission limit; the work budget refuses it.
    // The last one passes the gcd work and is stopped during root isolation (Sturm sign evaluations).
    for (const equation of ['x^24+1e250*x^17+1e-250*x^9+x+1=0', '(x^8+1e200*x+1)*(x^8+x+1e-200)*(x^8+x+2)=0', '(x^8+1e150*x+1)*(x^8+x+1e-150)=0']) {
      const { result, ms } = quick(equation)
      expect(result, equation).toMatchObject({ ok: false, error: 'too-large' })
      expect(ms, equation).toBeLessThan(2000)
    }
  })

  it('still solves large degree-24 inputs that fit the limits', () => {
    const { result, ms } = quick('x^24+1e30*x^17+1e-30*x^9+x+1=0')
    expect(result.ok).toBe(true)
    expect(result.display.split(', ')).toHaveLength(24)
    expect(result.display).not.toMatch(/NaN|undefined|Infinity/)
    expect(ms).toBeLessThan(2000)
  })
})
