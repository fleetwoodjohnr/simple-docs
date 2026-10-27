import { useEffect, useRef, useState } from 'react'
import katex from 'katex'
import { renderMath, setEquation } from '@/editor/math/equation'
import { latexToOmml } from '@/editor/math/omml'
import { bodyEditor, set } from '../state/store'
import { Btn, Modal, Segmented, cx, inputCls } from '../ui'

const close = () => set({ dialog: null })

const PALETTE: [string, string][] = [
  ['\\frac{a}{b}', '\\frac{}{}'],
  ['x^{2}', '^{}'],
  ['x_{i}', '_{}'],
  ['\\sqrt{x}', '\\sqrt{}'],
  ['\\sqrt[n]{x}', '\\sqrt[]{}'],
  ['\\sum_{i=1}^{n}', '\\sum_{i=1}^{n} '],
  ['\\int_{a}^{b}', '\\int_{a}^{b} '],
  ['\\lim_{x \\to 0}', '\\lim_{x \\to 0} '],
  ['\\left( x \\right)', '\\left(  \\right)'],
  ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '\\begin{pmatrix}  &  \\\\  &  \\end{pmatrix}'],
  ['\\hat{x}', '\\hat{}'],
  ['\\overline{x}', '\\overline{}'],
  ...['\\alpha', '\\beta', '\\pi', '\\theta', '\\lambda', '\\sigma', '\\Delta', '\\infty', '\\pm', '\\times', '\\cdot', '\\leq', '\\geq', '\\neq', '\\approx', '\\to', '\\in', '\\partial'].map((s): [string, string] => [s, `${s} `])
]

export function EquationDialog({ pos }: { pos?: number }) {
  const editor = bodyEditor()
  const existing = pos != null ? editor?.state.doc.nodeAt(pos) : null
  const [latex, setLatex] = useState<string>(existing?.attrs.latex ?? '')
  const [display, setDisplay] = useState<boolean>(existing ? !!existing.attrs.display : true)
  const preview = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (preview.current) renderMath(latex, display, preview.current)
  }, [latex, display])
  if (!editor) return null
  const wordOk = !latex.trim() || latexToOmml(latex) !== null
  const insertSnippet = (s: string) => {
    const el = area.current!
    const { selectionStart: a, selectionEnd: b } = el
    const next = latex.slice(0, a) + s + latex.slice(b)
    setLatex(next)
    // put the caret inside the first empty group
    const hole = s.indexOf('{}')
    const caret = a + (hole >= 0 ? hole + 1 : s.length)
    requestAnimationFrame(() => (el.focus(), el.setSelectionRange(caret, caret)))
  }
  const save = () => {
    if (!latex.trim()) return
    close()
    setEquation(editor, latex.trim(), display, pos)
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={existing ? 'Edit equation' : 'Insert equation'}
      width={620}
      footer={
        <>
          <Segmented label="Layout" value={display ? 'display' : 'inline'} onChange={(v) => setDisplay(v === 'display')} options={[{ value: 'display', label: 'On its own line' }, { value: 'inline', label: 'In the text' }]} />
          <span className="flex-1" />
          <Btn onClick={close}>Cancel</Btn>
          <Btn variant="primary" disabled={!latex.trim()} onClick={save} data-testid="equation-save">
            {existing ? 'Update' : 'Insert'}
          </Btn>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1" role="toolbar" aria-label="Templates and symbols">
        {PALETTE.map(([show, snippet]) => (
          <button
            key={show}
            type="button"
            title={snippet.trim()}
            aria-label={snippet.trim()}
            onClick={() => insertSnippet(snippet)}
            className="flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-1.5 text-[12px] hover:border-border-strong hover:bg-hover [&_.katex]:text-[13px]"
            dangerouslySetInnerHTML={{ __html: katex.renderToString(show, { throwOnError: false, output: 'html' }) }}
          />
        ))}
      </div>
      <textarea
        ref={area}
        autoFocus
        value={latex}
        onChange={(e) => setLatex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), save())
        }}
        spellCheck={false}
        aria-label="LaTeX"
        placeholder="e.g. x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}"
        className={cx(inputCls, 'h-20 resize-none py-2 font-mono text-[13px]')}
      />
      <div ref={preview} className="mt-3 flex min-h-[72px] items-center justify-center overflow-x-auto rounded-lg border border-border bg-white p-3 text-black" data-testid="equation-preview" aria-live="polite" />
      <p className="mt-2 text-[11.5px] text-text-3">
        LaTeX math syntax. Ctrl+Enter inserts. {wordOk ? 'Saved to DOCX as an editable Word equation.' : <span className="text-warn">Part of this formula has no Word equivalent; DOCX files get it as linear text.</span>}
      </p>
    </Modal>
  )
}
