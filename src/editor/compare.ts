import type { JSONContent } from '@tiptap/core'

// Document comparison: produces the revised document with the differences from the original
// as tracked changes (insertion / deletion marks), so the normal Accept / Reject tools apply.
// Blocks are aligned with an LCS; paired paragraphs are compared word by word; lists, tables
// and other containers are compared recursively. Formatting-only differences are not reported.

export interface RevisionInfo {
  author: string
  date: string
}

export interface CompareResult {
  doc: JSONContent
  insertions: number
  deletions: number
  /** Images and other objects that differ (shown in their revised state). */
  objects: number
}

type Op = ['eq', number, number] | ['del', number] | ['ins', number]

const MAX_CELLS = 8_000_000

/** Longest common subsequence alignment, with common prefix/suffix trimmed first. Null if too large. */
function align<T>(a: T[], b: T[]): Op[] | null {
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const n = a.length - pre - suf
  const m = b.length - pre - suf
  if (n * m > MAX_CELLS) return null
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i * w + j] = a[pre + i] === b[pre + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
  const ops: Op[] = []
  for (let k = 0; k < pre; k++) ops.push(['eq', k, k])
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[pre + i] === b[pre + j]) ops.push(['eq', pre + i++, pre + j++])
    else if (i < n && (j === m || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) ops.push(['del', pre + i++]) // deletions before insertions
    else ops.push(['ins', pre + j++])
  }
  for (let k = suf; k > 0; k--) ops.push(['eq', a.length - k, b.length - k])
  return ops
}

const clone = <T>(x: T): T => structuredClone(x)
const isTextblock = (n: JSONContent) => ['paragraph', 'heading', 'codeBlock'].includes(n.type ?? '')
const isContainer = (n: JSONContent) => !isTextblock(n) && Array.isArray(n.content) && n.content.length > 0 && n.type !== 'text'

/** Drop pending deletions and keep pending insertions, so inputs are compared as their "final" text. */
function finalView(n: JSONContent): JSONContent | null {
  if (n.type === 'text' || n.marks) {
    if (n.marks?.some((m) => m.type === 'deletion')) return null
    const marks = n.marks?.filter((m) => m.type !== 'insertion')
    n = { ...n, marks: marks?.length ? marks : undefined }
  }
  if (!n.content) return n
  return { ...n, content: n.content.map(finalView).filter((c): c is JSONContent => !!c) }
}

class Comparer {
  insertions = 0
  deletions = 0
  objects = 0
  constructor(private rev: RevisionInfo) {}

  private mark(kind: 'insertion' | 'deletion') {
    return { type: kind, attrs: { author: this.rev.author, date: this.rev.date } }
  }

  /** Mark every inline node of a block; block atoms cannot carry marks (dropped when deleted). */
  markBlock(n: JSONContent, kind: 'insertion' | 'deletion'): JSONContent | null {
    if (isTextblock(n)) {
      if (!n.content?.length) return kind === 'insertion' ? clone(n) : null // empty paragraphs: nothing to mark
      kind === 'insertion' ? this.insertions++ : this.deletions++
      return { ...clone(n), content: n.content.map((c) => ({ ...clone(c), marks: [...(c.marks ?? []), this.mark(kind)] })) }
    }
    if (!n.content?.length) {
      this.objects++
      return kind === 'insertion' ? clone(n) : null
    }
    const content = n.content.map((c) => this.markBlock(c, kind)).filter((c): c is JSONContent => !!c)
    return content.length ? { ...clone(n), content } : null
  }

  blocks(a: JSONContent[], b: JSONContent[], positional = false): JSONContent[] {
    const ka = a.map((x) => JSON.stringify(x))
    const kb = b.map((x) => JSON.stringify(x))
    const ops: Op[] | null = positional ? null : align(ka, kb)
    const out: JSONContent[] = []
    if (!ops) {
      // Positional pairing (table rows' cells, or alignments too large to compute).
      for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(...this.pair(a[i], b[i]))
      return out
    }
    let dels: JSONContent[] = []
    let inss: JSONContent[] = []
    const flush = () => {
      const n = Math.max(dels.length, inss.length)
      for (let i = 0; i < n; i++) out.push(...this.pair(dels[i], inss[i]))
      dels = []
      inss = []
    }
    for (const op of ops) {
      if (op[0] === 'eq') {
        flush()
        out.push(clone(b[op[2]]))
      } else if (op[0] === 'del') dels.push(a[op[1]])
      else inss.push(b[op[1]])
    }
    flush()
    return out
  }

  /** Compare two blocks occupying the same slot (either may be missing). */
  pair(a: JSONContent | undefined, b: JSONContent | undefined): JSONContent[] {
    const out: JSONContent[] = []
    const push = (x: JSONContent | null) => x && out.push(x)
    if (a && b && JSON.stringify(a) === JSON.stringify(b)) return [clone(b)]
    if (a && b && isTextblock(a) && isTextblock(b)) return [{ ...clone(b), content: this.inline(a.content ?? [], b.content ?? []) }]
    if (a && b && a.type === b.type && isContainer(a) && isContainer(b)) {
      // Rows must keep their cell count: only pair rows of equal width, cell by cell.
      if (a.type === 'tableRow' && a.content!.length !== b.content!.length) {
        push(this.markBlock(a, 'deletion'))
        push(this.markBlock(b, 'insertion'))
        return out
      }
      return [{ ...clone(b), content: this.blocks(a.content!, b.content!, a.type === 'tableRow') }]
    }
    if (a) push(this.markBlock(a, 'deletion'))
    if (b) push(this.markBlock(b, 'insertion'))
    return out
  }

  /** Word-level comparison of two paragraphs' inline content. */
  inline(a: JSONContent[], b: JSONContent[]): JSONContent[] {
    const ta = tokenize(a)
    const tb = tokenize(b)
    const ops = align(
      ta.map((t) => t.key),
      tb.map((t) => t.key)
    ) ?? [...ta.map((_, i) => ['del', i] as Op), ...tb.map((_, j) => ['ins', j] as Op)]
    const out: JSONContent[] = []
    let last: 'eq' | 'del' | 'ins' | null = null
    for (const op of ops) {
      if (op[0] !== last && op[0] !== 'eq') op[0] === 'ins' ? this.insertions++ : this.deletions++
      last = op[0]
      if (op[0] === 'eq') out.push(...tb[op[2]].parts.map(clone))
      else {
        const kind = op[0] === 'del' ? 'deletion' : 'insertion'
        const parts = op[0] === 'del' ? ta[op[1]].parts : tb[op[1]].parts
        out.push(...parts.map((p) => ({ ...clone(p), marks: [...(p.marks ?? []), this.mark(kind)] })))
      }
    }
    return mergeText(out)
  }
}

interface Token {
  key: string
  parts: JSONContent[]
}

/** Split inline content into word / space / punctuation tokens; tokens may span differently formatted text nodes. */
function tokenize(inline: JSONContent[]): Token[] {
  const chars: { ch: string; node: JSONContent }[] = []
  for (const n of inline) {
    if (n.type === 'text') for (const ch of n.text ?? '') chars.push({ ch, node: n })
    else chars.push({ ch: '￼', node: n })
  }
  const text = chars.map((c) => c.ch).join('')
  const out: Token[] = []
  for (const m of text.matchAll(/[\p{L}\p{N}_'’]+|\s+|￼|[^\p{L}\p{N}_'’\s]/gu)) {
    const slice = chars.slice(m.index, m.index! + m[0].length)
    if (m[0] === '￼') {
      const node = slice[0].node
      out.push({ key: `￼${node.type}${JSON.stringify(node.attrs ?? {})}`, parts: [node] })
      continue
    }
    const parts: JSONContent[] = []
    for (let k = 0; k < slice.length; k++) {
      const c = slice[k]
      if (k > 0 && c.node === slice[k - 1].node) parts[parts.length - 1].text += c.ch
      else parts.push({ type: 'text', text: c.ch, ...(c.node.marks ? { marks: c.node.marks } : {}) })
    }
    out.push({ key: m[0], parts })
  }
  return out
}

/** Join adjacent text nodes with identical marks. */
function mergeText(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = []
  for (const n of nodes) {
    const prev = out[out.length - 1]
    if (prev?.type === 'text' && n.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) prev.text += n.text!
    else out.push(n)
  }
  return out
}

export function compareDocuments(original: JSONContent, revised: JSONContent, rev: RevisionInfo): CompareResult {
  const a = finalView(original)!
  const b = finalView(revised)!
  const c = new Comparer(rev)
  const content = c.blocks(a.content ?? [], b.content ?? [])
  return {
    doc: { ...b, attrs: { ...b.attrs, trackChanges: false }, content: content.length ? content : [{ type: 'paragraph' }] },
    insertions: c.insertions,
    deletions: c.deletions,
    objects: c.objects
  }
}
