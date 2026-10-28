import { afterEach } from 'vitest'
import { Editor, type EditorOptions } from '@tiptap/core'

const live: Editor[] = []
// A live editor's DOM-observer timer can fire after jsdom is torn down ("document is not defined"), so each test's editors are destroyed.
afterEach(() => live.splice(0).forEach((e) => e.destroy()))

export function testEditor(options: Partial<EditorOptions>): Editor {
  const e = new Editor(options)
  live.push(e)
  return e
}
