declare module 'nerdamer' {
  interface NerdamerExpression {
    text(format?: string): string
    evaluate(values?: Record<string, number | string>): NerdamerExpression
  }
  interface NerdamerStatic {
    (expression: string): NerdamerExpression
    solve(expression: string, variable: string): unknown
  }
  const nerdamer: NerdamerStatic
  export default nerdamer
}

declare module 'nerdamer/Algebra.js'
declare module 'nerdamer/Calculus.js'
declare module 'nerdamer/Solve.js'
