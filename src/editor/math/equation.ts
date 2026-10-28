import { Node, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import katex from 'katex'

// Equations: an inline atom holding LaTeX, rendered with KaTeX (HTML + MathML for screen readers).
// `display` equations are centered on their own line. Imported Word equations keep their original
// OMML (`omml`) and the LaTeX it converted to (`ommlLatex`); unedited, they are written back verbatim.

export function renderMath(latex: string, display: boolean, into: HTMLElement) {
  try {
    katex.render(latex || '\\square', into, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' })
  } catch {
    into.textContent = latex
  }
}

export const Equation = Node.create({
  name: 'equation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      latex: { default: '', parseHTML: (el) => el.getAttribute('data-latex') ?? '' },
      display: { default: false, parseHTML: (el) => el.getAttribute('data-display') === 'true' },
      omml: { default: null, rendered: false },
      ommlLatex: { default: null, rendered: false }
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-latex]' }]
  },
  renderHTML({ node }) {
    const span = document.createElement('span')
    span.className = `sd-equation${node.attrs.display ? ' display' : ''}`
    span.setAttribute('data-latex', node.attrs.latex)
    span.setAttribute('data-display', String(!!node.attrs.display))
    span.contentEditable = 'false'
    renderMath(node.attrs.latex, !!node.attrs.display, span)
    return span
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Double-click an equation to edit it.
          handleDoubleClickOn: (_view, _pos, node, nodePos) => {
            // nodePos, not the click position: past the node's midpoint that is the position after it
            if (node.type.name !== 'equation') return false
            window.dispatchEvent(new CustomEvent('sd:edit-equation', { detail: nodePos }))
            return true
          }
        }
      })
    ]
  }
})

/** Insert a new equation, or update the one at `pos`. */
export function setEquation(editor: Editor, latex: string, display: boolean, pos?: number) {
  if (pos != null && editor.state.doc.nodeAt(pos)?.type.name === 'equation') {
    const old = editor.state.doc.nodeAt(pos)!
    editor.chain().focus().command(({ tr }) => (tr.setNodeMarkup(pos, undefined, { ...old.attrs, latex, display }), true)).setNodeSelection(pos).run()
    return
  }
  editor.chain().focus().insertContent({ type: 'equation', attrs: { latex, display } }).run()
}
