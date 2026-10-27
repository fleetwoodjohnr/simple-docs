import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import { AlertCircle, AlertTriangle, CheckCircle2, Lightbulb } from 'lucide-react'
import { checkAccessibility, type A11yIssue } from '@/editor/a11y'
import { useThrottled } from './hooks'
import { Empty } from './Panels'
import { Btn, cx, inputCls } from '../ui'

const ICON = {
  error: <AlertCircle className="size-3.5 text-danger" />,
  warning: <AlertTriangle className="size-3.5 text-warn" />,
  tip: <Lightbulb className="size-3.5 text-accent" />
}

function go(editor: Editor, pos: number) {
  if (pos < 0) return
  const node = editor.state.doc.nodeAt(pos)
  const chain = editor.chain().focus()
  ;(node && !node.isTextblock && (node.isAtom || node.type.name === 'image') ? chain.setNodeSelection(pos) : chain.setTextSelection(Math.min(pos + 1, editor.state.doc.content.size))).scrollIntoView().run()
}

/** Turn the first row of the table at pos into a header row. */
function makeHeaderRow(editor: Editor, pos: number) {
  const table = editor.state.doc.nodeAt(pos)
  const row = table?.firstChild
  if (!row) return
  const tr = editor.state.tr
  let p = pos + 2
  row.forEach((cell) => {
    tr.setNodeMarkup(p, editor.schema.nodes.tableHeader, cell.attrs)
    p += cell.nodeSize
  })
  editor.view.dispatch(tr)
}

function Fix({ editor, issue }: { editor: Editor; issue: A11yIssue }) {
  const [value, setValue] = useState('')
  if (issue.fix === 'header-row')
    return (
      <Btn size="sm" className="mt-2" onClick={() => makeHeaderRow(editor, issue.pos)}>
        Make first row a header
      </Btn>
    )
  const apply = () => {
    if (!value.trim()) return
    if (issue.fix === 'alt') editor.view.dispatch(editor.state.tr.setNodeAttribute(issue.pos, 'alt', value.trim()))
    else editor.view.dispatch(editor.state.tr.setDocAttribute('meta', { ...(editor.state.doc.attrs.meta ?? {}), title: value.trim() }))
  }
  return (
    <form className="mt-2 flex gap-1.5" onSubmit={(e) => (e.preventDefault(), apply())} onClick={(e) => e.stopPropagation()}>
      <input className={cx(inputCls, 'h-7 text-[12px]')} placeholder={issue.fix === 'alt' ? 'Describe the image' : 'Document title'} aria-label={issue.fix === 'alt' ? 'Alternative text' : 'Document title'} value={value} onChange={(e) => setValue(e.target.value)} />
      <Btn size="sm" type="submit" disabled={!value.trim()}>
        Apply
      </Btn>
    </form>
  )
}

export function AccessibilityPanel({ editor }: { editor: Editor }) {
  const issues = useThrottled(editor, (e) => checkAccessibility(e.state.doc), [] as A11yIssue[], 500)
  if (!issues.length)
    return (
      <Empty icon={<CheckCircle2 className="size-5" />} title="No accessibility issues found">
        Images have alt text, headings are in order and tables have headers.
      </Empty>
    )
  const counts = { error: 0, warning: 0, tip: 0 }
  issues.forEach((i) => counts[i.severity]++)
  return (
    <div className="p-3" data-testid="a11y-panel">
      <p className="mb-3 text-[12px] text-text-3">
        {counts.error} error{counts.error === 1 ? '' : 's'} · {counts.warning} warning{counts.warning === 1 ? '' : 's'} · {counts.tip} tip{counts.tip === 1 ? '' : 's'}
      </p>
      <ul className="space-y-2">
        {issues.map((issue) => (
          <li key={`${issue.rule}-${issue.pos}`} className="cursor-pointer rounded-lg border border-border bg-panel-2 p-2.5 hover:border-border-strong" onClick={() => go(editor, issue.pos)} data-rule={issue.rule}>
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              {ICON[issue.severity]}
              {issue.message}
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-text-3">{issue.help}</p>
            {issue.fix && <Fix editor={editor} issue={issue} />}
          </li>
        ))}
      </ul>
    </div>
  )
}
