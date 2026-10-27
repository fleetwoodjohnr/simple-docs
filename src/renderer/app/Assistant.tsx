import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { bodyEditor, set, toast, updateSettings, useApp } from '../state/store'
import { Btn, Switch, cx, inputCls, Modal } from '../ui'

const close = () => set({ dialog: null })

const ACTIONS: [string, string][] = [
  ['improve', 'Improve writing'],
  ['proofread', 'Fix spelling & grammar'],
  ['shorter', 'Make shorter'],
  ['longer', 'Make longer'],
  ['formal', 'More formal'],
  ['casual', 'More casual'],
  ['summarize', 'Summarize'],
  ['bullets', 'Key points'],
  ['custom', 'Custom…']
]

/** Settings → AI assistant. */
export function AiSettings() {
  const enabled = useApp((s) => s.settings.aiEnabled)
  const [status, setStatus] = useState<{ hasStoredKey: boolean; envCredentials: boolean; weakStorage: boolean } | null>(null)
  const [key, setKey] = useState('')
  const refresh = () => void window.simpleDocs.aiStatus().then(setStatus)
  useEffect(refresh, [])
  return (
    <div className="space-y-4 py-3 text-[13px] leading-relaxed text-text-2">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
        <span className="font-medium text-text">Use the AI writing assistant</span>
        <Switch label="Use the AI writing assistant" checked={enabled} onChange={(aiEnabled) => void updateSettings({ aiEnabled })} />
      </div>
      <p>
        When on, <strong className="text-text">Tools → AI assistant</strong> can rewrite, proofread, shorten or summarize the text you select. It uses Anthropic’s Claude API (Claude Opus 5.5).{' '}
        <strong className="text-text">Nothing is sent automatically:</strong> each request shows you exactly what will be sent and goes out only when you click Send. Anthropic’s commercial terms and privacy policy apply to what you send. While the assistant is off, Simple Docs makes no network requests.
      </p>
      <div className="rounded-lg border border-border p-3">
        <div className="font-medium text-text">API key</div>
        <div className="mt-1 text-[12.5px]">
          {status?.hasStoredKey
            ? 'A key is stored, encrypted with your system’s secure storage.'
            : status?.envCredentials
              ? 'Using the key from the ANTHROPIC_API_KEY environment variable.'
              : 'No key yet. Create one at console.anthropic.com, then paste it here.'}
          {status?.weakStorage && ' No system keyring was found, so the stored key is only lightly protected.'}
        </div>
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            try {
              await window.simpleDocs.aiSetKey(key.trim())
              setKey('')
              refresh()
              toast('API key saved', 'success')
            } catch (err) {
              toast((err as Error).message, 'error')
            }
          }}
        >
          <input type="password" autoComplete="off" aria-label="Anthropic API key" placeholder="sk-ant-…" className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} />
          <Btn type="submit" disabled={!key.trim()}>
            Save key
          </Btn>
          {status?.hasStoredKey && (
            <Btn type="button" variant="ghost" onClick={() => void window.simpleDocs.aiSetKey(null).then(refresh)}>
              Remove
            </Btn>
          )}
        </form>
      </div>
    </div>
  )
}

/** Split model output into paragraphs (blank-line separated) for insertion. */
const paragraphs = (text: string) =>
  text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => ({ type: 'paragraph', content: p.trim() ? p.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]) : undefined }))

export function AssistantDialog() {
  const enabled = useApp((s) => s.settings.aiEnabled)
  const editor = bodyEditor()
  // The selection is captured once, when the dialog opens: that is what will be sent.
  const [range] = useState(() => {
    const sel = editor?.state.selection
    return sel && !sel.empty ? { from: sel.from, to: sel.to, text: editor!.state.doc.textBetween(sel.from, sel.to, '\n\n', ' ') } : null
  })
  const [action, setAction] = useState('improve')
  const [instruction, setInstruction] = useState('')
  const [phase, setPhase] = useState<'review' | 'running' | 'done'>('review')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reqId = useRef('')

  useEffect(
    () =>
      window.simpleDocs.onAiText((id, delta) => {
        if (id === reqId.current) setOutput((o) => o + delta)
      }),
    []
  )
  useEffect(() => () => void (reqId.current && window.simpleDocs.aiCancel(reqId.current)), [])

  if (!editor) return null
  if (!enabled)
    return (
      <Modal open onOpenChange={(o) => !o && close()} title="AI assistant" width={460} footer={<><Btn onClick={close}>Close</Btn><Btn variant="primary" onClick={() => set({ dialog: { kind: 'settings', section: 'ai' } })}>Open AI settings</Btn></>}>
        <p className="text-[13px] leading-relaxed text-text-2">The AI writing assistant is off. Turn it on in Settings to rewrite, proofread or summarize selected text with Claude. Text is only ever sent after you review it and click Send.</p>
      </Modal>
    )

  const send = async () => {
    if (!range) return
    reqId.current = `ai${Date.now().toString(36)}`
    setOutput('')
    setError(null)
    setPhase('running')
    try {
      const full = await window.simpleDocs.aiRun(reqId.current, action, instruction, range.text)
      // Stream events are not ordered with the reply: ignore any that arrive after it.
      reqId.current = ''
      setOutput(full)
      setPhase('done')
    } catch (e) {
      reqId.current = ''
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setPhase('review')
    }
  }
  const apply = (where: 'replace' | 'after') => {
    if (!range) return
    const content = paragraphs(output)
    const single = content.length === 1
    const chain = editor.chain().focus()
    if (where === 'replace') chain.insertContentAt({ from: range.from, to: range.to }, single ? content[0].content ?? [] : content).run()
    else chain.insertContentAt(editor.state.doc.resolve(range.to).after(1), content).run()
    close()
  }
  const preview = range ? (range.text.length > 1500 ? `${range.text.slice(0, 1500)}… (${(range.text.length - 1500).toLocaleString()} more characters)` : range.text) : ''

  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" /> AI assistant
        </span>
      }
      width={640}
      footer={
        phase === 'done' ? (
          <>
            <Btn className="mr-auto" onClick={() => setPhase('review')}>
              Try again
            </Btn>
            <Btn onClick={() => void navigator.clipboard.writeText(output).then(() => toast('Copied', 'success'))}>Copy</Btn>
            <Btn onClick={() => apply('after')}>Insert below</Btn>
            <Btn variant="primary" onClick={() => apply('replace')} data-testid="ai-replace">
              Replace selection
            </Btn>
          </>
        ) : phase === 'running' ? (
          <Btn onClick={() => void window.simpleDocs.aiCancel(reqId.current)}>Stop</Btn>
        ) : (
          <>
            <Btn onClick={close}>Cancel</Btn>
            <Btn variant="primary" disabled={!range || (action === 'custom' && !instruction.trim())} onClick={send} data-testid="ai-send">
              Send to Claude
            </Btn>
          </>
        )
      }
    >
      {!range ? (
        <p className="text-[13px] text-text-2">Select the text you want help with first, then open the assistant again.</p>
      ) : phase === 'review' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What should Claude do?">
            {ACTIONS.map(([id, label]) => (
              <button key={id} role="radio" aria-checked={action === id} onClick={() => setAction(id)} className={cx('h-7 rounded-full border px-3 text-[12.5px]', action === id ? 'border-accent bg-accent-soft text-accent' : 'border-border text-text-2 hover:border-border-strong')}>
                {label}
              </button>
            ))}
          </div>
          {action === 'custom' && <textarea autoFocus aria-label="Instruction" maxLength={2000} placeholder="e.g. Rewrite for a 12-year-old reader" className={cx(inputCls, 'h-16 resize-none py-1.5')} value={instruction} onChange={(e) => setInstruction(e.target.value)} />}
          <div>
            <div className="mb-1 text-[12px] font-medium text-text-2">
              This will be sent to Anthropic’s Claude API ({range.text.length.toLocaleString()} characters):
            </div>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-panel-2 p-3 text-[12.5px]" data-testid="ai-outgoing">
              {preview}
            </div>
          </div>
          {error && <p className="text-[12.5px] text-danger">{error}</p>}
        </div>
      ) : (
        <div className="min-h-[120px] whitespace-pre-wrap rounded-lg border border-border bg-panel-2 p-3 text-[13px] leading-relaxed" aria-live="polite" data-testid="ai-output">
          {output || (
            <span className="flex items-center gap-2 text-text-3">
              <Loader2 className="size-4 animate-spin" /> Waiting for Claude…
            </span>
          )}
        </div>
      )}
    </Modal>
  )
}
