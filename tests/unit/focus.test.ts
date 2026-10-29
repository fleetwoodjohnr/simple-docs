// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createExtensions } from '@/editor/extensions'
import { testEditor } from './editor'

// jsdom has no layout; ProseMirror measures a Range to scroll a focused selection into view.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

it('focus() moves DOM focus before the next key event, not a frame later', async () => {
  const e = testEditor({ element: document.body.appendChild(document.createElement('div')), extensions: createExtensions(), content: '<p>Hi</p>' })
  const button = document.body.appendChild(document.createElement('button'))
  button.focus()
  e.chain().focus('end').toggleBold().run()
  await Promise.resolve()
  expect(document.activeElement).toBe(e.view.dom)
  expect(e.isActive('bold')).toBe(true)
  // Nothing is left to pull focus back a frame later from whatever took it meanwhile (e.g. a footnote editor).
  button.focus()
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r)))
  expect(document.activeElement).toBe(button)
})
