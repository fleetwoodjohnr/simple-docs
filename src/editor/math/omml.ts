// LaTeX ⇄ Office Math (OMML) for the common constructs: fractions, scripts, radicals, n-ary
// operators, delimiters, matrices, accents, bars, functions, text and symbols. Anything outside
// that subset returns null so callers can fall back (keep the original XML / save linear text).

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  infty: '∞', pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', ast: '∗', star: '⋆', circ: '∘', bullet: '∙',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦', implies: '⟹', iff: '⟺',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨',
  partial: '∂', nabla: '∇', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', angle: '∠', perp: '⊥', parallel: '∥', mid: '∣', prime: '′', degree: '°',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…', lbrace: '{', rbrace: '}', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', vert: '|', Vert: '‖',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ', '{': '{', '}': '}', '%': '%', '$': '$', '#': '#', '&': '&', _: '_'
}
const NARY: Record<string, string> = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂', bigvee: '⋁', bigwedge: '⋀', bigoplus: '⨁', bigotimes: '⨂' }
const FUNCS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'deg', 'dim', 'ker', 'arg', 'Pr']
const ACCENTS: Record<string, string> = { hat: '̂', widehat: '̂', tilde: '̃', widetilde: '̃', vec: '⃗', dot: '̇', ddot: '̈', check: '̌', breve: '̆', acute: '́', grave: '̀' }
const MATRIX: Record<string, [string, string] | null> = { matrix: null, pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''] }

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ---------------- LaTeX → OMML ----------------

class Unsupported extends Error {}

function tokenize(src: string): string[] {
  const out: string[] = []
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i))
      if (!m) throw new Unsupported('dangling backslash')
      out.push(m[0])
      i += m[0].length
      // skip spaces after a control word
      if (/^[a-zA-Z]/.test(m[1])) while (src[i] === ' ') i++
    } else if (/\s/.test(c)) {
      // keep one space token: significant inside \text{…}, skipped everywhere else
      if (out[out.length - 1] !== ' ') out.push(' ')
      i++
    } else out.push(c), i++
  }
  return out
}

class LatexToOmml {
  i = 0
  constructor(private t: string[]) {}
  peek() {
    while (this.t[this.i] === ' ') this.i++
    return this.t[this.i]
  }
  next() {
    this.peek()
    return this.t[this.i++]
  }
  expect(tok: string) {
    if (this.next() !== tok) throw new Unsupported(`expected ${tok}`)
  }

  /** Sequence until one of the stop tokens (not consumed). */
  seq(stop: string[] = []): string {
    let out = ''
    let last = ''
    while (this.peek() !== undefined && !stop.includes(this.peek())) {
      const tok = this.peek()
      if (tok === '^' || tok === '_') {
        // scripts attach to the previous atom
        let sub = ''
        let sup = ''
        while (this.peek() === '^' || this.peek() === '_') {
          const k = this.next()
          const v = this.arg()
          k === '^' ? (sup = v) : (sub = v)
        }
        const base = last || '<m:r><m:t>​</m:t></m:r>'
        out = out.slice(0, out.length - last.length)
        last =
          sub && sup ? `<m:sSubSup><m:e>${base}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>` : sup ? `<m:sSup><m:e>${base}</m:e><m:sup>${sup}</m:sup></m:sSup>` : `<m:sSub><m:e>${base}</m:e><m:sub>${sub}</m:sub></m:sSub>`
        out += last
        continue
      }
      last = this.atom()
      out += last
    }
    return out
  }

  /** A braced group or a single atom (argument of \frac, ^, _ …). */
  arg(): string {
    if (this.peek() === '{') {
      this.next()
      const s = this.seq(['}'])
      this.expect('}')
      return s
    }
    return this.atom()
  }

  /** Raw text of a braced group (for \text, \begin names). */
  rawGroup(): string {
    this.expect('{')
    let depth = 1
    let s = ''
    while (this.i < this.t.length) {
      const tok = this.t[this.i++]
      if (tok === '{') depth++
      if (tok === '}' && --depth === 0) return s
      s += tok.startsWith('\\') && tok.length === 2 ? tok[1] : tok === '~' ? ' ' : tok
    }
    throw new Unsupported('unclosed group')
  }

  run(text: string, plain = false): string {
    return `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<m:t xml:space="preserve">${xml(text)}</m:t></m:r>`
  }

  atom(): string {
    const tok = this.next()
    if (tok === undefined) throw new Unsupported('unexpected end')
    if (tok === '{') {
      const s = this.seq(['}'])
      this.expect('}')
      return s
    }
    if (!tok.startsWith('\\')) {
      if (tok === '}' || tok === '&') throw new Unsupported(`unexpected ${tok}`)
      return this.run(tok === '~' ? ' ' : tok === "'" ? '′' : tok)
    }
    const name = tok.slice(1)
    if (name in SYMBOLS) return this.run(SYMBOLS[name])
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      const num = this.arg()
      const den = this.arg()
      return `<m:f><m:num>${num}</m:num><m:den>${den}</m:den></m:f>`
    }
    if (name === 'sqrt') {
      let deg = ''
      if (this.peek() === '[') {
        this.next()
        deg = this.seq([']'])
        this.expect(']')
      }
      const e = this.arg()
      return deg ? `<m:rad><m:deg>${deg}</m:deg><m:e>${e}</m:e></m:rad>` : `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${e}</m:e></m:rad>`
    }
    if (name in NARY) {
      let sub = ''
      let sup = ''
      if (this.peek() === '\\limits' || this.peek() === '\\nolimits') this.next()
      while (this.peek() === '_' || this.peek() === '^') {
        const k = this.next()
        k === '_' ? (sub = this.arg()) : (sup = this.arg())
      }
      const e = this.peek() !== undefined && !['}', '&', '\\\\', '\\right', '\\end'].includes(this.peek()) ? this.atomWithScripts() : ''
      const lim = name.includes('int') ? 'subSup' : 'undOvr'
      return `<m:nary><m:naryPr><m:chr m:val="${NARY[name]}"/><m:limLoc m:val="${lim}"/>${sub ? '' : '<m:subHide m:val="1"/>'}${sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup><m:e>${e}</m:e></m:nary>`
    }
    if (FUNCS.includes(name)) {
      if (name === 'lim' && this.peek() === '_') {
        this.next()
        const below = this.arg()
        return `<m:func><m:fName><m:limLow><m:e>${this.run('lim', true)}</m:e><m:lim>${below}</m:lim></m:limLow></m:fName><m:e></m:e></m:func>`
      }
      return this.run(name, true)
    }
    if (name in ACCENTS) return `<m:acc><m:accPr><m:chr m:val="${ACCENTS[name]}"/></m:accPr><m:e>${this.arg()}</m:e></m:acc>`
    if (name === 'bar' || name === 'overline') return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${this.arg()}</m:e></m:bar>`
    if (name === 'underline') return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${this.arg()}</m:e></m:bar>`
    if (name === 'text' || name === 'mathrm' || name === 'textrm' || name === 'operatorname') return `<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space="preserve">${xml(this.rawGroup())}</m:t></m:r>`
    if (name === 'mathbf' || name === 'boldsymbol') return this.styled('b')
    if (name === 'mathit') return this.styled('i')
    if (name === 'left') {
      const open = this.delim()
      const body = this.seq(['\\right'])
      this.expect('\\right')
      const close = this.delim()
      return `<m:d><m:dPr><m:begChr m:val="${xml(open)}"/><m:endChr m:val="${xml(close)}"/></m:dPr><m:e>${body}</m:e></m:d>`
    }
    if (name === 'begin') {
      const env = this.rawGroup()
      if (!(env in MATRIX)) throw new Unsupported(`environment ${env}`)
      const rows: string[][] = [[]]
      for (;;) {
        rows[rows.length - 1].push(this.seq(['&', '\\\\', '\\end']))
        const sep = this.next()
        if (sep === '&') continue
        if (sep === '\\\\') rows.push([])
        else if (sep === '\\end') {
          if (this.rawGroup() !== env) throw new Unsupported('mismatched \\end')
          break
        } else throw new Unsupported('unterminated environment')
      }
      if (rows.length > 1 && rows[rows.length - 1].every((c) => !c)) rows.pop()
      const cols = Math.max(...rows.map((r) => r.length))
      const m = `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="${env === 'cases' ? 'left' : 'center'}"/></m:mcPr></m:mc></m:mcs></m:mPr>${rows.map((r) => `<m:mr>${Array.from({ length: cols }, (_, k) => `<m:e>${r[k] ?? ''}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`
      const d = MATRIX[env]
      return d ? `<m:d><m:dPr><m:begChr m:val="${xml(d[0])}"/><m:endChr m:val="${xml(d[1])}"/></m:dPr><m:e>${m}</m:e></m:d>` : m
    }
    throw new Unsupported(`\\${name}`)
  }

  atomWithScripts(): string {
    const start = this.i
    this.atom()
    while (this.peek() === '^' || this.peek() === '_') {
      this.next()
      this.arg()
    }
    // re-parse the span as a sequence so scripts attach correctly
    const sub = new LatexToOmml(this.t.slice(start, this.i))
    return sub.seq()
  }

  styled(sty: 'b' | 'i'): string {
    const inner = this.arg()
    return inner.replace(/<m:r>(<m:rPr>.*?<\/m:rPr>)?/g, `<m:r><m:rPr><m:sty m:val="${sty}"/></m:rPr>`)
  }

  delim(): string {
    const tok = this.next()
    if (tok === '.') return ''
    if (tok?.startsWith('\\')) {
      const s = SYMBOLS[tok.slice(1)]
      if (s === undefined) throw new Unsupported(`delimiter ${tok}`)
      return s
    }
    return tok ?? ''
  }
}

/** OMML for a LaTeX formula, or null when it uses something outside the supported subset. */
export function latexToOmml(latex: string, display = false): string | null {
  try {
    const p = new LatexToOmml(tokenize(latex))
    const body = p.seq()
    if (p.peek() !== undefined) return null
    // Join adjacent plain runs ("E" "=" "m" → "E=m"), as Word writes them; styled runs stay separate.
    let merged = body
    for (let prev = ''; prev !== merged; ) {
      prev = merged
      merged = merged.replace(/(<m:r><m:t xml:space="preserve">[^<]*)<\/m:t><\/m:r><m:r><m:t xml:space="preserve">/g, '$1')
    }
    const math = `<m:oMath>${merged}</m:oMath>`
    return display ? `<m:oMathPara>${math}</m:oMathPara>` : math
  } catch (e) {
    if (e instanceof Unsupported) return null
    throw e
  }
}

// ---------------- OMML → LaTeX ----------------

const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOLS)
    .filter(([k, v]) => /^[a-zA-Z]+$/.test(k) && v && !['le', 'ge', 'ne', 'to', 'dots', 'implies', 'iff', 'land', 'lor', 'varnothing', 'degree'].includes(k))
    .map(([k, v]) => [v, `\\${k} `])
)
const REVERSE_NARY: Record<string, string> = Object.fromEntries(Object.entries(NARY).map(([k, v]) => [v, k]))
const REVERSE_ACC: Record<string, string> = Object.fromEntries(Object.entries(ACCENTS).filter(([k]) => !k.startsWith('wide')).map(([k, v]) => [v, k]))

class OmmlToLatex {
  kids(e: Element): Element[] {
    return Array.from(e.childNodes).filter((n): n is Element => n.nodeType === 1)
  }
  part(e: Element | undefined, name: string): Element | undefined {
    return e ? this.kids(e).find((k) => k.localName === name && k.namespaceURI === M_NS) : undefined
  }
  val(e: Element | undefined, prop: string, name: string): string | null {
    const p = this.part(this.part(e, prop), name)
    return p ? p.getAttributeNS(M_NS, 'val') ?? p.getAttribute('m:val') : null
  }
  /** Content of a container (e, num, den, sub, sup, deg, lim, fName…). */
  inner(e: Element | undefined): string {
    if (!e) return ''
    return this.kids(e).map((k) => this.node(k)).join('')
  }
  group(e: Element | undefined): string {
    const s = this.inner(e).trim()
    return s.length === 1 || /^\\[a-zA-Z]+ ?$/.test(s) ? s.trim() : `{${s}}`
  }

  node(e: Element): string {
    if (e.namespaceURI !== M_NS) {
      // w:r inside math, bookmarks, proofErr… : text only
      if (e.localName === 'r' || e.localName === 'proofErr' || e.localName === 'bookmarkStart' || e.localName === 'bookmarkEnd' || e.localName === 'rPr') return e.localName === 'r' ? this.text(e.textContent ?? '', false) : ''
      throw new Unsupported(e.localName)
    }
    switch (e.localName) {
      case 'oMath':
        return this.inner(e)
      case 'r': {
        const t = this.kids(e).filter((k) => k.localName === 't').map((k) => k.textContent ?? '').join('')
        const rPr = this.part(e, 'rPr')
        const normal = !!this.part(rPr, 'nor')
        const sty = this.val(e, 'rPr', 'sty')
        return this.text(t, normal, sty)
      }
      case 'f': {
        const type = this.val(e, 'fPr', 'type')
        const num = this.inner(this.part(e, 'num'))
        const den = this.inner(this.part(e, 'den'))
        return type === 'lin' ? `${num}/${den}` : `\\frac{${num}}{${den}}`
      }
      case 'sSup':
        return `${this.group(this.part(e, 'e'))}^${this.group(this.part(e, 'sup'))}`
      case 'sSub':
        return `${this.group(this.part(e, 'e'))}_${this.group(this.part(e, 'sub'))}`
      case 'sSubSup':
        return `${this.group(this.part(e, 'e'))}_${this.group(this.part(e, 'sub'))}^${this.group(this.part(e, 'sup'))}`
      case 'sPre':
        return `{}_${this.group(this.part(e, 'sub'))}^${this.group(this.part(e, 'sup'))}${this.group(this.part(e, 'e'))}`
      case 'rad': {
        const hide = this.val(e, 'radPr', 'degHide')
        const deg = this.inner(this.part(e, 'deg'))
        return hide === '1' || hide === 'on' || hide === 'true' || !deg ? `\\sqrt{${this.inner(this.part(e, 'e'))}}` : `\\sqrt[${deg}]{${this.inner(this.part(e, 'e'))}}`
      }
      case 'nary': {
        const chr = this.val(e, 'naryPr', 'chr') ?? '∫'
        const op = REVERSE_NARY[chr]
        if (!op) throw new Unsupported(`n-ary ${chr}`)
        const sub = this.inner(this.part(e, 'sub'))
        const sup = this.inner(this.part(e, 'sup'))
        return `\\${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''} ${this.inner(this.part(e, 'e'))}`
      }
      case 'd': {
        const beg = this.val(e, 'dPr', 'begChr') ?? '('
        const end = this.val(e, 'dPr', 'endChr') ?? ')'
        const sep = this.val(e, 'dPr', 'sepChr') ?? '|'
        const items = this.kids(e).filter((k) => k.localName === 'e').map((k) => this.inner(k))
        const d = (c: string) => (c === '' ? '.' : c === '{' ? '\\{' : c === '}' ? '\\}' : REVERSE[c]?.trim() ?? c)
        return `\\left${d(beg)} ${items.join(` ${sep === '|' ? '|' : sep} `)} \\right${d(end)}`
      }
      case 'm': {
        const rows = this.kids(e)
          .filter((k) => k.localName === 'mr')
          .map((r) => this.kids(r).filter((k) => k.localName === 'e').map((k) => this.inner(k)).join(' & '))
        return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`
      }
      case 'eqArr': {
        const rows = this.kids(e).filter((k) => k.localName === 'e').map((k) => this.inner(k))
        return `\\begin{matrix} ${rows.join(' \\\\ ')} \\end{matrix}`
      }
      case 'acc': {
        const chr = this.val(e, 'accPr', 'chr') ?? '̂'
        const name = REVERSE_ACC[chr] ?? (chr === '̅' || chr === '¯' ? 'bar' : null)
        if (!name) throw new Unsupported(`accent ${chr}`)
        return `\\${name}{${this.inner(this.part(e, 'e'))}}`
      }
      case 'bar':
        return `\\${this.val(e, 'barPr', 'pos') === 'top' ? 'overline' : 'underline'}{${this.inner(this.part(e, 'e'))}}`
      case 'func':
        return `${this.inner(this.part(e, 'fName'))} ${this.inner(this.part(e, 'e'))}`
      case 'limLow':
        return `${this.group(this.part(e, 'e'))}_{${this.inner(this.part(e, 'lim'))}}`
      case 'limUpp':
        return `${this.group(this.part(e, 'e'))}^{${this.inner(this.part(e, 'lim'))}}`
      case 'box':
      case 'borderBox':
      case 'phant':
        return this.inner(this.part(e, 'e'))
      case 'groupChr':
        return this.inner(this.part(e, 'e'))
      case 'argPr':
      case 'ctrlPr':
      case 'oMathParaPr':
        return ''
      default:
        throw new Unsupported(e.localName)
    }
  }

  text(t: string, normal: boolean, sty?: string | null): string {
    if (normal) return `\\text{${t.replace(/[\\{}]/g, (c) => `\\${c}`)}}`
    if (sty === 'p' && FUNCS.includes(t)) return `\\${t} `
    if (sty === 'p' && /^[a-zA-Z]{2,}$/.test(t)) return `\\mathrm{${t}}`
    let out = ''
    for (const ch of t) out += REVERSE[ch] ?? (ch === '{' || ch === '}' || ch === '%' || ch === '#' || ch === '&' || ch === '_' || ch === '$' ? `\\${ch}` : ch === ' ' ? '\\,' : ch === '​' ? '' : ch)
    return out
  }
}

/** LaTeX for an <m:oMath> or <m:oMathPara> element, or null if it uses unsupported constructs. */
export function ommlToLatex(el: Element): { latex: string; display: boolean } | null {
  try {
    const c = new OmmlToLatex()
    if (el.localName === 'oMathPara') {
      const parts = c.kids(el).filter((k) => k.localName === 'oMath').map((k) => c.inner(k))
      return { latex: tidy(parts.join(' \\\\ ')), display: true }
    }
    return { latex: tidy(c.inner(el)), display: false }
  } catch (e) {
    if (e instanceof Unsupported) return null
    throw e
  }
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/ ([}^_)\]])/g, '$1').trim()
