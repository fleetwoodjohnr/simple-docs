import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// Spell checking as decorations. The checker itself (dictionary lookups, in a worker)
// is injected, so this plugin stays schema- and platform-agnostic.

export interface SpellChecker {
  enabled(): boolean
  /** Known verdicts: true = correct, false = misspelled, undefined = not checked yet. */
  verdict(word: string): boolean | undefined
  /** Check words; resolves when verdicts are available. */
  check(words: string[]): Promise<void>
  /** Bumped when dictionaries/custom words change, to force a re-scan. */
  generation(): number
}

export const spellKey = new PluginKey<{ deco: DecorationSet; gen: number }>('spell')
const WORD = /[\p{L}][\p{L}\p{M}'’-]*[\p{L}\p{M}]|\p{L}/gu

function skipNode(n: PMNode): boolean {
  return n.marks.some((m) => m.type.name === 'code' || m.type.name === 'link' || m.type.name === 'deletion')
}

function eachWord(doc: PMNode, fn: (word: string, from: number, to: number) => void) {
  doc.descendants((n, pos) => {
    if (n.type.name === 'codeBlock' || n.type.name === 'preservedBlock') return false
    if (!n.isText || skipNode(n)) return true
    const text = n.text!
    WORD.lastIndex = 0
    for (let m = WORD.exec(text); m; m = WORD.exec(text)) {
      const w = m[0].replace(/['’-]+$/, '')
      if (w.length < 2 || /^[\p{Lu}]+$/u.test(w)) continue // single letters, ACRONYMS
      fn(w, pos + m.index, pos + m.index + w.length)
    }
    return false
  })
}

function build(doc: PMNode, checker: SpellChecker): DecorationSet {
  if (!checker.enabled()) return DecorationSet.empty
  const decos: Decoration[] = []
  eachWord(doc, (w, from, to) => {
    if (checker.verdict(w) === false) decos.push(Decoration.inline(from, to, { class: 'sd-misspelled', 'data-word': w }))
  })
  return DecorationSet.create(doc, decos)
}

/** Misspelled word decoration at a document position, if any. */
export function misspelledAt(view: EditorView, pos: number): { word: string; from: number; to: number } | null {
  const set = spellKey.getState(view.state)?.deco
  const hit = set?.find(pos, pos)[0]
  return hit ? { word: hit.spec?.word ?? view.state.doc.textBetween(hit.from, hit.to), from: hit.from, to: hit.to } : null
}

export const Spellcheck = Extension.create<{ checker: SpellChecker | null }>({
  name: 'spellcheck',
  addOptions() {
    return { checker: null }
  },
  addProseMirrorPlugins() {
    const checker = this.options.checker
    if (!checker) return []
    return [
      new Plugin({
        key: spellKey,
        state: {
          init: (_c, s) => ({ deco: build(s.doc, checker), gen: checker.generation() }),
          apply(tr, prev, _o, s) {
            if (tr.getMeta(spellKey)) return { deco: build(s.doc, checker), gen: checker.generation() }
            return tr.docChanged ? { ...prev, deco: prev.deco.map(tr.mapping, tr.doc) } : prev
          }
        },
        props: { decorations: (s) => spellKey.getState(s)?.deco },
        view(view) {
          let timer = 0
          let alive = true
          const run = async () => {
            timer = 0
            if (!checker.enabled()) {
              if (spellKey.getState(view.state)?.deco !== DecorationSet.empty) view.dispatch(view.state.tr.setMeta(spellKey, true).setMeta('addToHistory', false).setMeta('pagination', true))
              return
            }
            const unknown = new Set<string>()
            eachWord(view.state.doc, (w) => checker.verdict(w) === undefined && unknown.add(w))
            if (unknown.size) await checker.check([...unknown])
            if (alive && !view.isDestroyed) view.dispatch(view.state.tr.setMeta(spellKey, true).setMeta('addToHistory', false).setMeta('pagination', true))
          }
          const schedule = (ms = 400) => {
            window.clearTimeout(timer)
            timer = window.setTimeout(() => void run(), ms)
          }
          const onRefresh = () => schedule(0)
          window.addEventListener('sd:spell-refresh', onRefresh)
          schedule(50)
          return {
            update(v, prev) {
              if (v.state.doc !== prev.doc) schedule()
            },
            destroy() {
              alive = false
              window.clearTimeout(timer)
              window.removeEventListener('sd:spell-refresh', onRefresh)
            }
          }
        }
      })
    ]
  }
})
