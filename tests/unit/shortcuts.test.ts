import { describe, expect, it } from 'vitest'
import { allCommands, isMac } from '../../src/renderer/app/commands'

describe('keyboard shortcuts', () => {
  it('has no duplicate default bindings', () => {
    const seen = new Map<string, string>()
    const dupes: string[] = []
    for (const c of allCommands()) {
      if (!c.shortcut) continue
      if (seen.has(c.shortcut)) dupes.push(`${c.shortcut}: ${seen.get(c.shortcut)} / ${c.id}`)
      seen.set(c.shortcut, c.id)
    }
    expect(dupes).toEqual([])
  })

  it('binds the familiar shortcuts from the brief', () => {
    const by = Object.fromEntries(allCommands().map((c) => [c.id, c.shortcut]))
    expect(by).toMatchObject({
      'file.new': 'Mod-n',
      'file.open': 'Mod-o',
      'file.save': 'Mod-s',
      'file.saveAs': 'Mod-Shift-s',
      'file.print': 'Mod-p',
      'edit.undo': 'Mod-z',
      'edit.redo': isMac ? 'Mod-Shift-z' : 'Mod-y', // ⌘⇧Z is the Mac convention
      'fmt.bold': 'Mod-b',
      'fmt.italic': 'Mod-i',
      'fmt.underline': 'Mod-u',
      'edit.find': 'Mod-f',
      'edit.replace': 'Mod-h',
      'insert.link': 'Mod-k',
      'insert.pageBreak': 'Mod-Enter'
    })
  })
})
