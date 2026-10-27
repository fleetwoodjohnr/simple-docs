import nspell from 'nspell'

// Dictionary lookups off the main thread. Messages: load, check, suggest.
type Msg =
  | { type: 'load'; aff: string; dic: string; custom: string[] }
  | { type: 'check'; id: number; words: string[] }
  | { type: 'suggest'; id: number; word: string }
  | { type: 'add'; word: string }

let spell: ReturnType<typeof nspell> | null = null

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data
  if (m.type === 'load') {
    spell = nspell({ aff: m.aff, dic: m.dic })
    for (const w of m.custom) spell.add(w)
    self.postMessage({ type: 'loaded' })
  } else if (m.type === 'add') spell?.add(m.word)
  else if (m.type === 'check') {
    const bad = spell ? m.words.filter((w) => !spell!.correct(w) && !spell!.correct(w.replace(/’/g, "'"))) : []
    self.postMessage({ type: 'checked', id: m.id, bad })
  } else if (m.type === 'suggest') {
    self.postMessage({ type: 'suggested', id: m.id, list: spell ? spell.suggest(m.word).slice(0, 6) : [] })
  }
}
