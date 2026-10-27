import { Extension, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { AddMarkStep, DocAttrStep, RemoveMarkStep, type Step } from '@tiptap/pm/transform'

// Restrict editing (like Word's "Restrict Editing" without a password). Stored in the doc attribute
// `protection` and in DOCX as <w:documentProtection w:enforcement="1">. It prevents accidental
// changes; it is not security: anyone can stop protection.
//   readOnly – no changes at all
//   comments – only comments can be added, edited or deleted
//   tracked  – every edit is a tracked change; tracking cannot be turned off and changes cannot be accepted/rejected

export type ProtectionMode = 'readOnly' | 'comments' | 'tracked'
export const PROTECTION_LABELS: Record<ProtectionMode, string> = { readOnly: 'Read only', comments: 'Comments only', tracked: 'Tracked changes only' }

/** Meta marking a transaction that is allowed regardless of protection (turning it on/off, layout fix-ups). */
export const PROTECTION_OVERRIDE = 'sdProtectionOverride'
/** Meta set by accept/reject so tracked-changes protection can refuse it. */
export const RESOLVE_CHANGES = 'sdResolveChanges'

let notice: (mode: ProtectionMode) => void = () => {}
export const setProtectionNotice = (fn: (mode: ProtectionMode) => void) => (notice = fn)

export const protectionOf = (editor: Editor): ProtectionMode | null => (editor.state.doc.attrs.protection as ProtectionMode | null) ?? null

const commentStep = (s: Step) =>
  ((s instanceof AddMarkStep || s instanceof RemoveMarkStep) && s.mark.type.name === 'comment') || (s instanceof DocAttrStep && s.attr === 'comments')

export const Protection = Extension.create({
  name: 'protection',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: { editable: (state) => state.doc.attrs.protection !== 'readOnly' },
        filterTransaction(tr, state) {
          const mode = state.doc.attrs.protection as ProtectionMode | null
          if (!mode || !tr.docChanged || tr.getMeta(PROTECTION_OVERRIDE) || tr.getMeta('pagination')) return true
          const ok =
            mode === 'tracked'
              ? !tr.getMeta(RESOLVE_CHANGES) && !tr.steps.some((s) => s instanceof DocAttrStep && (s.attr === 'trackChanges' || s.attr === 'protection'))
              : mode === 'comments'
                ? tr.steps.every(commentStep)
                : false
          if (!ok) notice(mode)
          return ok
        }
      })
    ]
  }
})

export function setProtection(editor: Editor, mode: ProtectionMode | null) {
  const tr = editor.state.tr.setDocAttribute('protection', mode).setMeta(PROTECTION_OVERRIDE, true)
  if (mode === 'tracked') tr.setDocAttribute('trackChanges', true)
  editor.view.dispatch(tr)
}
