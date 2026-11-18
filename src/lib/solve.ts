import { all, create, type Fraction, type MathNode } from 'mathjs'
import { Decimal } from 'decimal.js'

const math = create(all, {})
// Parse equations with BigNumber literals so a typed decimal such as 0.123456789123 or 1e-20 keeps
// its exact digits; a JavaScript number would already have rounded it.
const parser = create(all, { number: 'BigNumber', precision: 64 })
/** Working precision for approximations. Every value shown is computed from exact data at this precision. */
const HP = Decimal.clone({ precision: 80 })
type Dec = Decimal

export type SolveResult = { ok: boolean; display: string; error?: string }

const MAX_DEGREE = 24
const MAX_INPUT = 180
const MAX_EXPONENT = 1024
const MAX_LITERAL_DIGITS = 600
const MAX_LITERAL_EXPONENT = 600
const MAX_EXACT_BITS = 8192
const MAX_SYM_TERMS = 64
const MAX_CONST_POWER = 4096
const UNSUPPORTED = 'solve supports polynomial equations in x, such as x^2-4=0 or 2x+3=7.'
const HIGH_DEGREE_CONSTANT =
  'solve handles pi and e only in equations of degree 1 or 2. For higher degrees, type a decimal such as 3.14159265 instead.'
const TOO_LARGE = 'The numbers in this equation are too large to solve exactly. Try smaller coefficients or powers.'
const UNRELIABLE = 'Could not find these roots reliably. Try rescaling the coefficients.'

class NotPolynomial extends Error {}
/** The equation is a polynomial, but its numbers are too large to work with exactly. */
class TooLarge extends Error {}
class NoConvergence extends Error {}
class ConstantDegree extends Error {}

// ---------- exact coefficients: Laurent polynomials in pi and e with rational coefficients ----------
//
// A coefficient is a map from a monomial key "i,j" (meaning pi^i * e^j, i and j may be negative) to a
// nonzero fraction. Zero is the empty map. Arithmetic is exact, so cancellation such as pi+1e-20-pi
// keeps 1e-20 and a coefficient is zero only when it is exactly zero.

type Sym = Map<string, Fraction>

const bitLength = (v: unknown) => BigInt(v as bigint).toString(2).length
function guardSize(f: Fraction): Fraction {
  if (bitLength(f.n) > MAX_EXACT_BITS || bitLength(f.d) > MAX_EXACT_BITS) throw new TooLarge('numbers too large')
  return f
}

const RATIONAL = '0,0'
const keyOf = (i: number, j: number) => `${i},${j}`
const parseKey = (key: string) => key.split(',').map(Number) as [number, number]

const symZero = (): Sym => new Map()
function symRational(f: Fraction): Sym {
  return f.equals(0) ? new Map() : new Map([[RATIONAL, guardSize(f)]])
}
function symAdd(a: Sym, b: Sym, sign = 1): Sym {
  const out: Sym = new Map(a)
  b.forEach((f, key) => {
    const sum = guardSize((out.get(key) ?? math.fraction(0))[sign > 0 ? 'add' : 'sub'](f))
    if (sum.equals(0)) out.delete(key)
    else out.set(key, sum)
  })
  if (out.size > MAX_SYM_TERMS) throw new TooLarge('expression too complex')
  return out
}
function symMul(a: Sym, b: Sym): Sym {
  let out = symZero()
  a.forEach((fa, ka) => {
    const [ia, ja] = parseKey(ka)
    b.forEach((fb, kb) => {
      const [ib, jb] = parseKey(kb)
      const i = ia + ib
      const j = ja + jb
      if (Math.abs(i) > MAX_CONST_POWER || Math.abs(j) > MAX_CONST_POWER) throw new TooLarge('power too large')
      out = symAdd(out, new Map([[keyOf(i, j), guardSize(fa.mul(fb))]]))
    })
  })
  return out
}
/** Division by a single term c*pi^i*e^j. Division by a sum that involves pi or e is refused. */
function symDiv(a: Sym, b: Sym): Sym {
  if (b.size === 0) throw new NotPolynomial('division by zero')
  if (b.size !== 1) throw new NotPolynomial('division by a sum with pi or e')
  const [[key, f]] = [...b]
  const [i, j] = parseKey(key)
  return symMul(a, new Map([[keyOf(-i, -j), guardSize(math.fraction(1).div(f))]]))
}
const symIsZero = (a: Sym) => a.size === 0
const symIsRational = (a: Sym) => a.size === 0 || (a.size === 1 && a.has(RATIONAL))
const symToFraction = (a: Sym): Fraction => a.get(RATIONAL) ?? math.fraction(0)

const fracToHP = (f: Fraction): Dec => new HP(`${Number(f.s) < 0 ? '-' : ''}${f.n}`).div(new HP(String(f.d)))

/**
 * The value of a coefficient as an 80-digit decimal with certified relative error below 1e-40.
 * Precision is raised until the rounding error bound is that small compared with the value. A value
 * that cannot be separated from zero within 1000 digits is refused rather than treated as zero.
 */
function symValue(a: Sym): Dec {
  if (symIsZero(a)) return new HP(0)
  if (symIsRational(a)) return fracToHP(symToFraction(a))
  for (const digits of [60, 200, 1000]) {
    const D = Decimal.clone({ precision: digits + 15 })
    const pi = D.acos(-1)
    const e = D.exp(1)
    let total = new D(0)
    let size = new D(0)
    let maxPower = 0
    a.forEach((f, key) => {
      const [i, j] = parseKey(key)
      maxPower = Math.max(maxPower, Math.abs(i) + Math.abs(j))
      const coefficient = new D(`${Number(f.s) < 0 ? '-' : ''}${f.n}`).div(new D(String(f.d)))
      const term = coefficient.times(pi.pow(i)).times(e.pow(j))
      total = total.plus(term)
      size = size.plus(term.abs())
    })
    // Each term has relative error at most (|i|+|j|+5) units of 10^-(digits+14); the sum adds one more per term.
    const bound = size.times(maxPower + a.size + 10).times(new D(10).pow(-(digits + 14)))
    if (total.abs().gt(bound.times('1e40'))) return new HP(total)
  }
  throw new NoConvergence('coefficient too close to zero to evaluate')
}

// ---------- parsing an equation into a polynomial in x ----------

type Poly = Sym[] // coefficients, lowest power first

function trim(p: Poly): Poly {
  const out = p.slice()
  while (out.length > 1 && symIsZero(out[out.length - 1])) out.pop()
  return out.length ? out : [symZero()]
}

function polyAdd(a: Poly, b: Poly, sign = 1): Poly {
  const out: Poly = []
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) out.push(symAdd(a[i] ?? symZero(), b[i] ?? symZero(), sign))
  return trim(out)
}

function polyMul(a: Poly, b: Poly): Poly {
  if (a.length + b.length - 2 > MAX_DEGREE) throw new NotPolynomial('degree too high')
  const out: Poly = Array.from({ length: a.length + b.length - 1 }, () => symZero())
  a.forEach((x, i) => b.forEach((y, j) => { out[i + j] = symAdd(out[i + j], symMul(x, y)) }))
  return trim(out)
}

function power(base: Poly, k: number): Poly {
  // Square-and-multiply keeps work logarithmic in k; polyMul and guardSize bound the size.
  let out: Poly = [symRational(math.fraction(1))]
  let square = base
  let rest = k
  while (rest > 0) {
    if (rest % 2 === 1) out = polyMul(out, square)
    rest = Math.floor(rest / 2)
    if (rest > 0) square = polyMul(square, square)
  }
  return out
}

type AnyNode = MathNode & { type: string; fn?: string; op?: string; args?: MathNode[]; name?: string; value?: unknown; content?: MathNode }
type BigLike = { isBigNumber: true; isFinite: () => boolean; toFixed: () => string; e: number; sd: () => number }

/** The exact fraction a typed decimal literal stands for, built from its digits. */
export function decimalToFraction(decimal: string): Fraction {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal)
  if (!match) throw new NotPolynomial('non-numeric constant')
  const [, sign, whole, frac = ''] = match
  const numerator = BigInt(`${sign}${whole}${frac}`)
  const denominator = 10n ** BigInt(frac.length)
  return math.fraction(numerator.toString()).div(math.fraction(denominator.toString()))
}

/** Exact value of a parsed literal. Size is checked from the exponent and digit count before any expansion. */
function literalFraction(value: unknown): Fraction {
  let big: BigLike
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new NotPolynomial('non-finite constant')
    big = math.bignumber(value) as unknown as BigLike
  } else if (value && (value as BigLike).isBigNumber) {
    big = value as BigLike
  } else {
    throw new NotPolynomial('non-numeric constant')
  }
  if (!big.isFinite()) throw new NotPolynomial('non-finite constant')
  if (Math.abs(big.e) > MAX_LITERAL_EXPONENT || big.sd() > MAX_LITERAL_DIGITS) throw new TooLarge('number too long')
  return guardSize(decimalToFraction(big.toFixed()))
}

function toPoly(node: MathNode): Poly {
  const n = node as AnyNode
  switch (n.type) {
    case 'ConstantNode':
      return [symRational(literalFraction(n.value))]
    case 'SymbolNode':
      if (n.name === 'x') return [symZero(), symRational(math.fraction(1))]
      if (n.name === 'pi') return [new Map([[keyOf(1, 0), math.fraction(1)]])]
      if (n.name === 'e') return [new Map([[keyOf(0, 1), math.fraction(1)]])]
      throw new NotPolynomial(`symbol ${n.name}`)
    case 'ParenthesisNode':
      return toPoly(n.content as MathNode)
    case 'OperatorNode': {
      const args = n.args ?? []
      if (n.fn === 'unaryMinus') return polyAdd([symZero()], toPoly(args[0]), -1)
      if (n.fn === 'unaryPlus') return toPoly(args[0])
      if (n.fn === 'add') return polyAdd(toPoly(args[0]), toPoly(args[1]))
      if (n.fn === 'subtract') return polyAdd(toPoly(args[0]), toPoly(args[1]), -1)
      if (n.fn === 'multiply') return polyMul(toPoly(args[0]), toPoly(args[1]))
      if (n.fn === 'divide') {
        const divisor = toPoly(args[1])
        if (divisor.length !== 1) throw new NotPolynomial('division by an expression in x')
        return trim(toPoly(args[0]).map((c) => symDiv(c, divisor[0])))
      }
      if (n.fn === 'pow') {
        // The exponent is checked exactly: 2.0000000000000000001 or 1e-400 is not a whole number.
        const exponent = toPoly(args[1])
        if (exponent.length !== 1 || !symIsRational(exponent[0])) throw new NotPolynomial('exponent is not a whole number')
        const k = symToFraction(exponent[0])
        if (BigInt(k.d) !== 1n || Number(k.s) < 0) throw new NotPolynomial('exponent is not a whole number')
        if (BigInt(k.n) > BigInt(MAX_EXPONENT)) throw new TooLarge('exponent too large')
        const whole = Number(k.n)
        const base = toPoly(args[0])
        if ((base.length - 1) * whole > MAX_DEGREE) throw new NotPolynomial('degree too high')
        return power(base, whole)
      }
      throw new NotPolynomial(`operator ${n.op}`)
    }
    default:
      throw new NotPolynomial(n.type)
  }
}

/**
 * If every coefficient is a rational multiple of one common factor (as in pi*(x-1)^2), return the
 * rational polynomial left after dividing that factor out. Otherwise return null.
 */
function rationalPart(p: Poly): Fraction[] | null {
  const lead = p[p.length - 1]
  const [[leadKey, leadValue]] = [...lead]
  const out: Fraction[] = []
  for (const c of p) {
    if (symIsZero(c)) {
      out.push(math.fraction(0))
      continue
    }
    if (c.size !== lead.size || !c.has(leadKey)) return null
    const q = (c.get(leadKey) as Fraction).div(leadValue)
    for (const [key, f] of lead) {
      const other = c.get(key)
      if (!other || !other.equals(f.mul(q))) return null
    }
    out.push(guardSize(q))
  }
  return out
}

// ---------- integer polynomial helpers ----------

const absBig = (v: bigint) => (v < 0n ? -v : v)
const signBig = (v: bigint) => (v > 0n ? 1 : v < 0n ? -1 : 0)
function gcdBig(a: bigint, b: bigint): bigint {
  let x = absBig(a)
  let y = absBig(b)
  if (x === 1n || y === 1n) return 1n
  // Each step costs at most the size of the larger operand, which only shrinks.
  const stepCost = x > 1n << 64n || y > 1n << 64n ? Math.max(costBits(x), costBits(y)) : 1
  while (y) {
    charge(stepCost)
    ;[x, y] = [y, x % y]
  }
  return x
}
const bigBits = (v: bigint) => (v === 0n ? 0 : absBig(v).toString(2).length)
/** Bit length rounded up to a multiple of 4; cheaper than bigBits and good enough for a cost estimate. */
const costBits = (v: bigint) => (v === 0n ? 1 : absBig(v).toString(16).length * 4)

// ---------- work limits for exact polynomial arithmetic ----------
// Exact gcd and Sturm work grows with degree times coefficient size, and can take minutes on a short
// input. Two limits keep every answer, or refusal, quick: an admission check on the scaled integer
// coefficients before any exact work, and a work budget charged inside the BigInt loops themselves.

/** Largest coefficient bit length times degree accepted for exact solving. */
export const MAX_SIZE_DEGREE = 40_000
/** Work units (BigInt operations weighted by operand bit length) allowed per equation. */
export const WORK_LIMIT = 1_000_000_000
let workLeft = WORK_LIMIT
/** Cost of multiplying an a-bit by a b-bit integer: linear for small operands, growing with a*b for large ones. */
const mulCost = (a: number, b: number) => a + b + (a * b) / 2048
function charge(units: number) {
  workLeft -= units
  if (workLeft < 0) throw new TooLarge('exact work limit reached')
}

function toIntegerCoefficients(p: Fraction[]): bigint[] {
  let lcm = 1n
  for (const c of p) {
    const d = BigInt(c.d)
    lcm = (lcm / gcdBig(lcm, d)) * d
  }
  const ints = p.map((c) => (BigInt(c.s) * BigInt(c.n) * lcm) / BigInt(c.d))
  const g = ints.reduce((acc, v) => gcdBig(acc, v), 0n) || 1n
  return ints.map((v) => v / g)
}

function trimBig(p: bigint[]): bigint[] {
  const out = p.slice()
  while (out.length > 1 && out[out.length - 1] === 0n) out.pop()
  return out.length ? out : [0n]
}

function primitive(p: bigint[]): bigint[] {
  let g = 0n
  for (const v of p) {
    g = gcdBig(g, v)
    if (g === 1n) return p
  }
  if (g <= 1n) return p
  charge(p.reduce((sum, v) => sum + costBits(v), 0))
  return p.map((v) => v / g)
}

const DIVISOR_LIMIT = 10n ** 12n
function divisors(value: bigint): bigint[] | null {
  const v = absBig(value)
  if (v === 0n || v > DIVISOR_LIMIT) return null
  const small: bigint[] = []
  const large: bigint[] = []
  for (let d = 1n; d * d <= v; d += 1n) {
    if (v % d === 0n) {
      small.push(d)
      if (d * d !== v) large.push(v / d)
    }
  }
  return [...small, ...large.reverse()]
}

/** p(num/den) * den^n, exact (den > 0, so the sign matches p(num/den)). Zero means num/den is a root. */
const coefficientBits = new WeakMap<bigint[], number>()
function evalScaled(c: bigint[], num: bigint, den: bigint): bigint {
  // Horner form of sum c_k num^k den^(n-k).
  const n = c.length - 1
  // Charge before the work: n steps whose running total grows to about the coefficient size plus n point sizes.
  let cBits = coefficientBits.get(c)
  if (cBits === undefined) {
    cBits = c.reduce((m, v) => Math.max(m, costBits(v)), 0)
    coefficientBits.set(c, cBits)
  }
  const pointBits = Math.max(costBits(num), costBits(den))
  charge(n * mulCost(cBits + n * pointBits, pointBits))
  let total = c[n]
  let denPower = 1n
  for (let k = n - 1; k >= 0; k -= 1) {
    denPower *= den
    total = total * num + c[k] * denPower
  }
  return total
}

/** Divide by (den*x - num), assuming num/den is a root. Returns integer coefficients. */
function deflate(c: bigint[], num: bigint, den: bigint): bigint[] {
  const frac = c.map((v) => math.fraction(v.toString()))
  const root = math.fraction(num.toString()).div(math.fraction(den.toString()))
  const n = frac.length - 1
  const out: Fraction[] = new Array(n)
  let carry = frac[n]
  for (let k = n - 1; k >= 0; k -= 1) {
    out[k] = carry
    carry = frac[k].add(carry.mul(root))
  }
  return toIntegerCoefficients(out)
}

function fracTrim(p: Fraction[]): Fraction[] {
  const out = p.slice()
  while (out.length > 1 && out[out.length - 1].equals(0)) out.pop()
  return out.length ? out : [math.fraction(0)]
}
const MAX_GCD_BITS = 200000

/** Exact quotient a / b of integer polynomials when b divides a (b primitive, so the quotient is integral). */
function exactQuotient(a: bigint[], b: bigint[]): bigint[] {
  const r = trimBig(a).slice()
  const degB = b.length - 1
  const lead = b[degB]
  const q: bigint[] = new Array(Math.max(1, r.length - degB)).fill(0n)
  for (let shift = r.length - 1 - degB; shift >= 0; shift -= 1) {
    const top = r[shift + degB]
    if (top % lead !== 0n) throw new NoConvergence('inexact polynomial division')
    const factor = top / lead
    q[shift] = factor
    b.forEach((coef, i) => { r[i + shift] -= factor * coef })
  }
  if (r.some((v) => v !== 0n)) throw new NoConvergence('inexact polynomial division')
  return trimBig(q)
}

/** gcd of two integer polynomials by primitive pseudo-remainders, which keeps coefficients small. */
function polyGcd(a: bigint[], b: bigint[]): bigint[] {
  let x = primitive(trimBig(a))
  let y = primitive(trimBig(b))
  while (!(y.length === 1 && y[0] === 0n)) {
    charge(y.length)
    if (y.some((v) => bigBits(v) > MAX_GCD_BITS)) throw new TooLarge('coefficients grew too large')
    ;[x, y] = [y, signedRemainder(x, y)]
  }
  return x
}

/** p / gcd(p, p'): the same roots, each once, so repeated roots stay exact. Integer coefficients. */
function squareFreePart(p: bigint[]): bigint[] {
  if (p.length < 3) return p
  const g = polyGcd(p, p.slice(1).map((c, i) => c * BigInt(i + 1)))
  if (g.length === 1) return p
  return primitive(exactQuotient(p, g[g.length - 1] < 0n ? g.map((v) => -v) : g))
}

// ---------- roots and how they are shown ----------

/**
 * A root. `text` is its exact form when it has one. `value` (and `imag` for a complex root) is an
 * approximation computed from exact data, used for the ≈ part and for ordering.
 */
type Root = { text?: string; value: Dec; imag?: Dec; showApprox: boolean }

function fracText(f: Fraction): string {
  const sign = Number(f.s) < 0 ? '-' : ''
  return BigInt(f.d) === 1n ? `${sign}${f.n}` : `${sign}${f.n}/${f.d}`
}

const MAX_EXACT_TEXT = 48

/** Decimal text of a nonzero or zero value: fixed decimals for ordinary sizes, scientific otherwise. */
function decText(value: Dec, precision: number): string {
  if (value.isZero()) return '0'
  const abs = value.abs()
  const scientific = () => {
    const [mantissa, exponent] = value.toExponential(Math.max(1, precision - 1)).split('e')
    const trimmed = mantissa.includes('.') ? mantissa.replace(/0+$/, '').replace(/\.$/, '') : mantissa
    return `${trimmed}e${exponent}`
  }
  if (abs.gte('1e21') || abs.lt('1e-4')) return scientific()
  const fixed = value.toFixed(precision).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  // A nonzero value is never rounded to 0.
  return fixed === '0' || fixed === '-0' ? scientific() : fixed
}

function approxText(root: Root, precision: number): string {
  const real = root.value.isZero() ? '' : decText(root.value, precision)
  if (!root.imag || root.imag.isZero()) return real || '0'
  const imagAbs = decText(root.imag.abs(), precision)
  const imag = imagAbs === '1' ? 'i' : `${imagAbs}i`
  if (!real) return root.imag.isNegative() ? `-${imag}` : imag
  return `${real} ${root.imag.isNegative() ? '-' : '+'} ${imag}`
}

function describeRoot(root: Root, precision: number): string {
  const approx = approxText(root, precision)
  // A value with no short exact form is shown only as a marked approximation, never as a bare fraction.
  if (root.text === undefined || root.text.length > MAX_EXACT_TEXT) return `x ≈ ${approx}`
  return root.showApprox ? `x = ${root.text} ≈ ${approx}` : `x = ${root.text}`
}

function rationalRoot(f: Fraction): Root {
  return { text: fracText(f), value: fracToHP(f), showApprox: BigInt(f.d) > 1000n }
}

function squareFree(value: bigint): { k: bigint; m: bigint } {
  // value > 0. Returns value = k^2 * m with small square factors pulled out.
  let m = value
  let k = 1n
  for (let p = 2n; p * p <= m && p < 1000000n; p += 1n) {
    while (m % (p * p) === 0n) {
      m /= p * p
      k *= p
    }
  }
  return { k, m }
}

function isqrt(v: bigint): bigint {
  if (v < 2n) return v
  let x = BigInt(`0x${'f'.repeat(Math.ceil(v.toString(16).length / 2) + 1)}`)
  for (;;) {
    const y = (x + v / x) / 2n
    if (y >= x) return x
    x = y
  }
}

/** Text for s*sqrt(m) or s*sqrt(m)*i with s a positive fraction and m a square-free positive integer. */
function surdText(s: Fraction, m: bigint, imaginary: boolean): string {
  const num = BigInt(s.n)
  const den = BigInt(s.d)
  let head: string
  if (m === 1n) {
    if (!imaginary) return fracText(s)
    head = num === 1n ? 'i' : `${num}i`
  } else {
    head = [num === 1n ? '' : String(num), `sqrt(${m})`, imaginary ? 'i' : ''].filter(Boolean).join('*')
  }
  return den === 1n ? head : `${head}/${den}`
}

/**
 * Real roots of a*x^2 + b*x + c (c nonzero) from the stable formula: q = -(b + sign(b)*sqrt(disc))/2,
 * roots q/a and c/q. No subtraction of nearly equal values, so a tiny root keeps its digits.
 * Returns [larger-formula root (-b+sqrt)/(2a), (-b-sqrt)/(2a)].
 */
function stableQuadratic(a: Dec, b: Dec, c: Dec, sqrtDisc: Dec): [Dec, Dec] {
  if (!b.isNegative()) {
    const q = b.plus(sqrtDisc).div(2).neg()
    return [c.div(q), q.div(a)]
  }
  const q = sqrtDisc.minus(b).div(2)
  return [q.div(a), c.div(q)]
}

function quadraticRoots(coefficients: bigint[]): Root[] {
  // With a > 0 the text r + s*sqrt(m) below is the root (-b + sqrt(disc)) / (2a).
  const [c0, b, a] = coefficients[2] < 0n ? coefficients.map((v) => -v) : coefficients
  const disc = b * b - 4n * a * c0
  const twoA = 2n * a
  const r = math.fraction((-b).toString()).div(math.fraction(twoA.toString()))
  if (disc === 0n) return [rationalRoot(r)]
  const absDisc = absBig(disc)
  const root = isqrt(absDisc)
  const s0 = math.fraction(root.toString()).div(math.fraction(absBig(twoA).toString()))
  if (root * root === absDisc && disc > 0n) return [rationalRoot(r.add(s0)), rationalRoot(r.sub(s0))]
  const { k, m } = root * root === absDisc ? { k: root, m: 1n } : squareFree(absDisc)
  const s = math.fraction(k.toString()).div(math.fraction(absBig(twoA).toString()))
  const imaginary = disc < 0n
  const term = surdText(s, m, imaginary)
  const zeroR = r.equals(0)
  const rText = fracText(r)
  const plus = zeroR ? term : `${rText} + ${term}`
  const minus = zeroR ? `-${term}` : `${rText} - ${term}`
  const showApprox = m !== 1n || BigInt(r.d) > 1000n || BigInt(s.d) > 1000n
  const sqrtDisc = new HP(absDisc.toString()).sqrt()
  if (imaginary) {
    const imag = sqrtDisc.div(new HP(absBig(twoA).toString()))
    const value = fracToHP(r)
    return [
      { text: plus, value, imag, showApprox },
      { text: minus, value, imag: imag.neg(), showApprox },
    ]
  }
  const [plusValue, minusValue] = stableQuadratic(new HP(a.toString()), new HP(b.toString()), new HP(c0.toString()), sqrtDisc)
  return [
    { text: plus, value: plusValue, showApprox },
    { text: minus, value: minusValue, showApprox },
  ]
}

// ---------- real roots of an integer polynomial: Sturm sequence and exact bisection ----------

/** Remainder of |lc(b)|^k * a divided by b, made primitive. The positive multiplier keeps signs for Sturm. */
function signedRemainder(a: bigint[], b: bigint[]): bigint[] {
  let r = trimBig(a)
  const lead = b[b.length - 1]
  const degB = b.length - 1
  while (r.length - 1 >= degB && !(r.length === 1 && r[0] === 0n)) {
    const lr = r[r.length - 1]
    const shift = r.length - 1 - degB
    const scale = lead < 0n ? -lead : lead
    const factor = lead < 0n ? -lr : lr
    const scaleBits = costBits(scale)
    const factorBits = costBits(factor)
    charge(r.reduce((sum, v) => sum + mulCost(costBits(v), scaleBits), 0) + b.reduce((sum, v) => sum + mulCost(costBits(v), factorBits), 0))
    const next = r.map((v) => v * scale)
    b.forEach((coef, i) => { next[i + shift] -= factor * coef })
    next.pop()
    r = primitive(trimBig(next))
  }
  return r
}

function sturmSequence(p: bigint[]): bigint[][] {
  const seq = [p, primitive(trimBig(p.slice(1).map((c, i) => c * BigInt(i + 1))))]
  while (seq[seq.length - 1].length > 1) {
    const rem = signedRemainder(seq[seq.length - 2], seq[seq.length - 1])
    if (rem.length === 1 && rem[0] === 0n) break
    seq.push(primitive(rem.map((v) => -v)))
  }
  return seq
}

/** A dyadic rational n / 2^s. */
type Dy = { n: bigint; s: number }
const dyDen = (d: Dy) => 1n << BigInt(d.s)
function dyCommon(a: Dy, b: Dy): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s)
  return [a.n << BigInt(s - a.s), b.n << BigInt(s - b.s), s]
}
const dyMid = (a: Dy, b: Dy): Dy => { const [x, y, s] = dyCommon(a, b); return { n: x + y, s: s + 1 } }
/** floor(log2 |d|) for nonzero d. */
const dyLog = (d: Dy) => bigBits(d.n) - 1 - d.s
const dyToHP = (d: Dy): Dec => new HP(d.n.toString()).div(new HP(2).pow(d.s))

function variations(seq: bigint[][], at: Dy): number {
  let count = 0
  let last = 0
  for (const q of seq) {
    const sign = signBig(evalScaled(q, at.n, dyDen(at)))
    if (sign !== 0) {
      if (last !== 0 && sign !== last) count += 1
      last = sign
    }
  }
  return count
}

/**
 * Split point strictly inside (lo, hi): a power of two when the ends differ in size by 4x or more and
 * have one sign (so a tiny root next to a huge one is reached in few steps), otherwise the midpoint.
 */
function splitPoint(lo: Dy, hi: Dy): Dy {
  const sameSign = signBig(lo.n) === signBig(hi.n) && lo.n !== 0n
  if (sameSign) {
    const a = Math.min(dyLog(lo), dyLog(hi))
    const b = Math.max(dyLog(lo), dyLog(hi))
    if (b - a >= 2) {
      const m = Math.floor((a + b) / 2)
      const sign = signBig(lo.n)
      return m >= 0 ? { n: BigInt(sign) << BigInt(m), s: 0 } : { n: BigInt(sign), s: -m }
    }
  }
  return dyMid(lo, hi)
}

const REFINE_BITS = 150
const MAX_STEPS = 20000

/** Certified real roots (each in an interval narrower than 2^-150 of its size), ascending. */
function realRoots(c: bigint[]): Root[] {
  const n = c.length - 1
  const seq = sturmSequence(c)
  const maxHigh = c.slice(0, n).reduce((m, v) => (absBig(v) > m ? absBig(v) : m), 0n)
  const maxLow = c.slice(1).reduce((m, v) => (absBig(v) > m ? absBig(v) : m), 0n)
  // All roots satisfy 2^-low < |x| < 2^high (Cauchy bounds of p and of its reversal; c[0] is nonzero).
  const high = Math.max(1, bigBits(maxHigh) - bigBits(c[n]) + 2)
  const low = Math.max(1, bigBits(maxLow) - bigBits(c[0]) + 2)
  const outer: Dy = { n: 1n << BigInt(high), s: 0 }
  const inner: Dy = { n: 1n, s: low }
  const neg = (d: Dy): Dy => ({ n: -d.n, s: d.s })
  const work: Array<[Dy, Dy]> = [[neg(outer), neg(inner)], [inner, outer]]
  const isolated: Array<[Dy, Dy]> = []
  let steps = 0
  const vCache = new Map<string, number>()
  const v = (d: Dy) => {
    const key = `${d.n}/${d.s}`
    let out = vCache.get(key)
    if (out === undefined) {
      out = variations(seq, d)
      vCache.set(key, out)
    }
    return out
  }
  while (work.length) {
    if ((steps += 1) > MAX_STEPS) throw new NoConvergence('root isolation did not finish')
    const [lo, hi] = work.pop() as [Dy, Dy]
    const count = v(lo) - v(hi)
    if (count === 0) continue
    if (count === 1) {
      isolated.push([lo, hi])
      continue
    }
    const mid = splitPoint(lo, hi)
    work.push([lo, mid], [mid, hi])
  }
  const roots: Root[] = []
  for (let [lo, hi] of isolated) {
    // Bisection on the sign of p; Sturm counts only when an end point is itself a root.
    for (;;) {
      if ((steps += 1) > MAX_STEPS) throw new NoConvergence('root refinement did not finish')
      const pHi = signBig(evalScaled(c, hi.n, dyDen(hi)))
      if (pHi === 0) {
        lo = hi
        break
      }
      const [x, y, s] = dyCommon(lo, hi)
      const width = y - x
      const sizeBits = Math.min(dyLog(lo), dyLog(hi)) + s
      if (bigBits(width) + REFINE_BITS <= sizeBits) break
      const mid = splitPoint(lo, hi)
      const pLo = signBig(evalScaled(c, lo.n, dyDen(lo)))
      const pMid = signBig(evalScaled(c, mid.n, dyDen(mid)))
      if (pMid === 0) {
        lo = mid
        hi = mid
        break
      }
      const rootBelowMid = pLo !== 0 ? pLo !== pMid : v(lo) - v(mid) === 1
      if (rootBelowMid) hi = mid
      else lo = mid
    }
    if (lo.n === hi.n && lo.s === hi.s) {
      const f = math.fraction(lo.n.toString()).div(math.fraction(dyDen(lo).toString()))
      roots.push(rationalRoot(f))
    } else {
      roots.push({ value: dyToHP(dyMid(lo, hi)), showApprox: true })
    }
  }
  return roots.sort((a, b) => a.value.comparedTo(b.value))
}

// ---------- complex roots: Durand-Kerner start, then 80-digit Newton and checks ----------

type C = { re: number; im: number }
const cAdd = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im })
const cSub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im })
const cMul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re })
const cDiv = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}
function cEval(p: number[], z: C): C {
  let acc: C = { re: 0, im: 0 }
  for (let k = p.length - 1; k >= 0; k -= 1) acc = cAdd(cMul(acc, z), { re: p[k], im: 0 })
  return acc
}

/**
 * Starting values for the roots of a polynomial (coefficients lowest power first, as natural logs
 * with signs so values beyond the float range survive). The variable is rescaled so the monic
 * coefficients are of order one. These are only starting points; nothing here is shown unchecked.
 */
function startingRoots(coefficients: Array<{ sign: number; log: number }>): Array<{ y: C; logScale: number }> {
  const n = coefficients.length - 1
  const lead = coefficients[n]
  const monic = coefficients.map((c) => ({ sign: c.sign * lead.sign, log: c.log - lead.log }))
  let logScale = -Infinity
  for (let k = 0; k < n; k += 1) {
    if (monic[k].sign !== 0) logScale = Math.max(logScale, monic[k].log / (n - k))
  }
  if (!Number.isFinite(logScale)) logScale = 0
  const p = monic.map((c, k) => (c.sign === 0 ? 0 : c.sign * Math.exp(c.log - (n - k) * logScale)))
  return durandKerner(p).map((y) => ({ y, logScale }))
}

function durandKerner(p: number[]): C[] {
  const n = p.length - 1
  const radius = 1 + Math.max(...p.slice(0, n).map(Math.abs))
  let z: C[] = Array.from({ length: n }, (_, k) => {
    const angle = (2 * Math.PI * k) / n + 0.4
    return { re: radius * Math.cos(angle), im: radius * Math.sin(angle) }
  })
  for (let iter = 0; iter < 2000; iter += 1) {
    let change = 0
    z = z.map((zi, i) => {
      let denom: C = { re: 1, im: 0 }
      z.forEach((zj, j) => { if (j !== i) denom = cMul(denom, cSub(zi, zj)) })
      const step = cDiv(cEval(p, zi), denom)
      change = Math.max(change, Math.hypot(step.re, step.im))
      return cSub(zi, step)
    })
    if (!(change >= 1e-15)) break
  }
  return z
}

/** Double-precision roots of a polynomial with ordinary coefficients (lowest power first). */
export function numericRoots(coefficients: number[]): C[] {
  if (!coefficients.every(Number.isFinite)) throw new NoConvergence('coefficient out of range')
  return startingRoots(coefficients.map((c) => ({ sign: Math.sign(c), log: c === 0 ? -Infinity : Math.log(Math.abs(c)) })))
    .map(({ y, logScale }) => ({ re: y.re * Math.exp(logScale), im: y.im * Math.exp(logScale) }))
}

type DC = { re: Dec; im: Dec }
const dAdd = (a: DC, b: DC): DC => ({ re: a.re.plus(b.re), im: a.im.plus(b.im) })
const dSub = (a: DC, b: DC): DC => ({ re: a.re.minus(b.re), im: a.im.minus(b.im) })
const dMul = (a: DC, b: DC): DC => ({ re: a.re.times(b.re).minus(a.im.times(b.im)), im: a.re.times(b.im).plus(a.im.times(b.re)) })
const dDiv = (a: DC, b: DC): DC => {
  const d = b.re.times(b.re).plus(b.im.times(b.im))
  return { re: a.re.times(b.re).plus(a.im.times(b.im)).div(d), im: a.im.times(b.re).minus(a.re.times(b.im)).div(d) }
}
const dAbs = (a: DC): Dec => a.re.times(a.re).plus(a.im.times(a.im)).sqrt()
function dEval(p: Dec[], z: DC): DC {
  let acc: DC = { re: new HP(0), im: new HP(0) }
  for (let k = p.length - 1; k >= 0; k -= 1) acc = dAdd(dMul(acc, z), { re: p[k], im: new HP(0) })
  return acc
}

/**
 * The non-real roots of a square-free integer polynomial with `pairs` conjugate pairs. Each root is
 * polished with 80-digit Newton steps on the exact polynomial and accepted only if it satisfies the
 * polynomial to 1e-40 of the size of its terms, is clearly non-real, and is distinct from the others.
 */
function complexRoots(c: bigint[], pairs: number): Root[] {
  if (pairs === 0) return []
  // Candidates in the upper half plane, most clearly non-real first. A candidate that polishes to a
  // real root or to a root already found is skipped, and the next one is tried.
  const starts = startingRoots(c.map((v) => ({ sign: signBig(v), log: v === 0n ? -Infinity : bigLog(v) })))
    .filter(({ y }) => Number.isFinite(y.re) && Number.isFinite(y.im) && y.im > 0)
    .sort((a, b) => b.y.im / Math.hypot(b.y.re, b.y.im) - a.y.im / Math.hypot(a.y.re, a.y.im))
  const p = c.map((v) => new HP(v.toString()))
  const dp = p.slice(1).map((v, i) => v.times(i + 1))
  const found: DC[] = []
  // Newton steps are 80-digit work; a total budget keeps a refusal as quick as an answer.
  let budget = 400
  for (const { y, logScale } of starts) {
    if (found.length === pairs || budget <= 0) break
    const scale = new HP(logScale).exp()
    let z: DC = { re: new HP(y.re).times(scale), im: new HP(y.im).times(scale) }
    for (let k = 0; k < 60 && budget > 0; k += 1, budget -= 1) {
      const step = dDiv(dEval(p, z), dEval(dp, z))
      z = dSub(z, step)
      if (!z.re.isFinite() || !z.im.isFinite()) break
      if (dAbs(step).lte(dAbs(z).times('1e-60'))) break
    }
    if (!z.re.isFinite() || !z.im.isFinite()) continue
    const size = dAbs(z)
    const terms = p.reduce((acc, coef, k) => acc.plus(coef.abs().times(size.pow(k))), new HP(0))
    const slope = dAbs(dEval(dp, z))
    if (slope.isZero()) continue
    // Error radius: some root lies within n*|p(z)|/|p'(z)| of z. |p(z)| is enlarged by the rounding
    // bound of an 80-digit Horner evaluation, so the radius covers arithmetic error too.
    const degree = p.length - 1
    const residual = dAbs(dEval(p, z)).plus(terms.times(2 * degree).times('1e-79'))
    const radius = residual.times(degree).div(slope)
    // A part is shown only when it is at least 1e12 times the radius (every printed digit verified);
    // a part inside the radius cannot be told from 0 and is shown as 0; anything between is refused.
    const verified = (part: Dec) => part.abs().gte(radius.times('1e12'))
    const separated = (w: DC) =>
      dAbs(dSub(w, z)).gt(size.times('1e-30')) && dAbs(dSub(w, { re: z.re, im: z.im.neg() })).gt(size.times('1e-30'))
    if (!radius.lte(size.times('1e-30')) || !verified(z.im) || !found.every(separated)) continue
    if (z.re.abs().gt(radius) && !verified(z.re)) continue
    const re = z.re.abs().lte(radius) ? new HP(0) : z.re
    found.push({ re, im: z.im.abs() })
  }
  if (found.length !== pairs) throw new NoConvergence('complex roots not found')
  return found
    .sort((a, b) => a.re.comparedTo(b.re) || b.im.comparedTo(a.im))
    .flatMap((z) => [
      { value: z.re, imag: z.im, showApprox: true },
      { value: z.re, imag: z.im.neg(), showApprox: true },
    ])
}

/** Natural log of |v| for a bigint of any size. */
function bigLog(v: bigint): number {
  const digits = absBig(v).toString()
  return Math.log(Number(`0.${digits.slice(0, 17)}`)) + digits.length * Math.LN10
}

function exactRoots(p: Fraction[]): Root[] {
  const scaled = toIntegerCoefficients(fracTrim(p))
  // Admission check before any exact work: refuse at once when degree times coefficient size is too big.
  const largest = scaled.reduce((m, v) => Math.max(m, bigBits(v)), 0)
  if (largest * (scaled.length - 1) > MAX_SIZE_DEGREE) throw new TooLarge('coefficients too large for this degree')
  let c = squareFreePart(scaled)
  const rational: Fraction[] = []
  while (c.length > 1 && c[0] === 0n) {
    rational.push(math.fraction(0))
    c = c.slice(1)
  }
  let progress = true
  while (c.length > 2 && progress) {
    progress = false
    const ps = divisors(c[0])
    const qs = divisors(c[c.length - 1])
    if (!ps || !qs || ps.length * qs.length > 20000) break
    search: for (const q of qs) {
      for (const pAbs of ps) {
        if (gcdBig(pAbs, q) !== 1n) continue
        for (const num of [pAbs, -pAbs]) {
          if (evalScaled(c, num, q) === 0n) {
            rational.push(math.fraction(num.toString()).div(math.fraction(q.toString())))
            c = deflate(c, num, q)
            progress = true
            break search
          }
        }
      }
    }
  }
  if (c.length === 2) {
    rational.push(math.fraction((-c[0]).toString()).div(math.fraction(c[1].toString())))
    c = c.slice(1)
  }
  const roots: Root[] = []
  const seen = new Set<string>()
  rational.sort((a, b) => a.compare(b)).forEach((f) => {
    const text = fracText(f)
    if (!seen.has(text)) roots.push(rationalRoot(f))
    seen.add(text)
  })
  if (c.length === 3) {
    roots.push(...quadraticRoots(c))
  } else if (c.length > 3) {
    const real = realRoots(c)
    const nonReal = c.length - 1 - real.length
    if (nonReal % 2 !== 0) throw new NoConvergence('root count mismatch')
    roots.push(...real, ...complexRoots(c, nonReal / 2))
  }
  return roots
}

// ---------- equations with pi or e in the coefficients ----------

/** Roots of a polynomial of degree 1 or 2 whose coefficients involve pi or e. */
function constantCoefficientRoots(p: Poly): Root[] {
  let poly = p
  const roots: Root[] = []
  if (symIsZero(poly[0])) {
    roots.push(rationalRoot(math.fraction(0)))
    while (poly.length > 1 && symIsZero(poly[0])) poly = poly.slice(1)
  }
  const degree = poly.length - 1
  if (degree === 0) return roots
  if (degree > 2) throw new ConstantDegree('degree too high for pi or e')
  if (degree === 1) {
    roots.push({ value: symValue(poly[0]).neg().div(symValue(poly[1])), showApprox: true })
    return sortRoots(roots)
  }
  const [c, b, a] = poly
  const disc = symAdd(symMul(b, b), symMul(symRational(math.fraction(4)), symMul(a, c)), -1)
  const aValue = symValue(a)
  const bValue = symValue(b)
  const cValue = symValue(c)
  if (symIsZero(disc)) {
    roots.push({ value: bValue.neg().div(aValue.times(2)), showApprox: true })
    return sortRoots(roots)
  }
  const discValue = symValue(disc)
  const sqrtDisc = discValue.abs().sqrt()
  if (discValue.isPositive()) {
    const [plus, minus] = stableQuadratic(aValue, bValue, cValue, sqrtDisc)
    roots.push({ value: plus, showApprox: true }, { value: minus, showApprox: true })
  } else {
    const re = bValue.neg().div(aValue.times(2))
    const im = sqrtDisc.div(aValue.times(2).abs())
    roots.push({ value: re, imag: im, showApprox: true }, { value: re, imag: im.neg(), showApprox: true })
  }
  return sortRoots(roots)
}

function sortRoots(roots: Root[]): Root[] {
  const isReal = (r: Root) => !r.imag || r.imag.isZero()
  return roots.sort(
    (a, b) =>
      Number(!isReal(a)) - Number(!isReal(b)) ||
      a.value.comparedTo(b.value) ||
      (b.imag ?? new HP(0)).comparedTo(a.imag ?? new HP(0)),
  )
}

/**
 * Solve a polynomial equation in x. Coefficients are kept exact (rationals, with pi and e as symbols),
 * so a coefficient is zero only when it is exactly zero. Rational roots and quadratic surds are shown
 * exactly; every other root is computed from the exact coefficients, checked, and marked with ≈.
 * When a root cannot be computed reliably the answer is a refusal, never a guess.
 */
export function solveEquation(equation: string, precision = 10): SolveResult {
  workLeft = WORK_LIMIT
  const text = equation.trim()
  if (!text || text.length > MAX_INPUT) return { ok: false, display: UNSUPPORTED, error: 'unsupported' }
  const sides = text.split('=')
  const [lhs, rhs] = sides.length === 1 ? [sides[0], '0'] : sides
  if (sides.length > 2 || !lhs.trim() || !rhs.trim()) {
    return { ok: false, display: 'Write one equation with a single =, for example x^2-4=0.', error: 'bad-equation' }
  }
  let node: MathNode
  try {
    node = parser.parse(`(${lhs})-(${rhs})`)
  } catch {
    return { ok: false, display: 'Could not read that equation. Check the brackets and operators.', error: 'parse' }
  }

  let roots: Root[] = []
  try {
    const poly = toPoly(node)
    if (poly.length === 1) {
      // Equal sides only when the difference is exactly zero; a nonzero difference is confirmed numerically.
      if (symIsZero(poly[0])) return { ok: true, display: 'Every x is a solution: both sides are always equal.' }
      symValue(poly[0])
      return { ok: true, display: 'No solution: the equation is never true.' }
    }
    const rational = poly.every(symIsRational) ? poly.map(symToFraction) : rationalPart(poly)
    roots = rational ? exactRoots(rational) : constantCoefficientRoots(poly)
  } catch (error) {
    if (error instanceof NoConvergence) return { ok: false, display: UNRELIABLE, error: 'no-convergence' }
    if (error instanceof TooLarge) return { ok: false, display: TOO_LARGE, error: 'too-large' }
    if (error instanceof ConstantDegree) return { ok: false, display: HIGH_DEGREE_CONSTANT, error: 'unsupported-degree' }
    return { ok: false, display: UNSUPPORTED, error: 'not-polynomial' }
  }
  const lines = roots.map((root) => describeRoot(root, precision))
  if (lines.some((line) => /NaN|undefined|Infinity/.test(line))) {
    return { ok: false, display: UNRELIABLE, error: 'no-convergence' }
  }
  return { ok: true, display: lines.join(', ') }
}
