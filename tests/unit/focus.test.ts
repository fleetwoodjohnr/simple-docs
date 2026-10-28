// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { createExtensions } from '@/editor/extensions'
import { testEditor } from './editor'

it('focus() moves DOM focus before the next key event, not a frame later', async () => {
  const e = testEditor({ element: document.body.appendChild(document.createElement('div')), extensions: createExtensions(), content: '<p>Hi</p>' })
  const button = document.body.appendChild(document.createElement('button'))
  button.focus()
  e.chain().focus('end').toggleBold().run()
  await Promise.resolve()
  expect(document.activeElement).toBe(e.view.dom)
  expect(e.isActive('bold')).toBe(true)
})
