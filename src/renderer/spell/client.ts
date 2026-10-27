import type { SpellChecker } from '@/editor/spell'
import { get, updateSettings } from '../state/store'
import affUS from '../../../node_modules/dictionary-en/index.aff?raw'
import dicUS from '../../../node_modules/dictionary-en/index.dic?raw'
import affGB from '../../../node_modules/dictionary-en-gb/index.aff?raw'
import dicGB from '../../../node_modules/dictionary-en-gb/index.dic?raw'

// One shared checker for all documents: bundled English dictionaries (offline), plus any
// Hunspell dictionary the OS provides for other languages (read through the main process).

const verdicts = new Map<string, boolean>()
const ignored = new Set<string>()
let gen = 0
let lang = ''
let ready: Promise<void> | null = null
let worker: Worker | null = null
let seq = 0
const pending = new Map<number, (v: unknown) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const m = e.data as { type: string; id?: number; bad?: string[]; list?: string[] }
      if (m.id != null) {
        pending.get(m.id)?.(m.type === 'checked' ? m.bad : m.list)
        pending.delete(m.id)
      }
    }
  }
  return worker
}

function request<T>(msg: Record<string, unknown>): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve) => {
    pending.set(id, resolve as (v: unknown) => void)
    getWorker().postMessage({ ...msg, id })
  })
}

async function dictionaryFor(language: string): Promise<{ aff: string; dic: string } | null> {
  if (language === 'en-GB') return { aff: affGB, dic: dicGB }
  if (language.startsWith('en')) return { aff: affUS, dic: dicUS }
  return window.simpleDocs.spellDictionary(language)
}

function ensureLoaded(): Promise<void> {
  const language = get().settings.language
  if (ready && lang === language) return ready
  lang = language
  verdicts.clear()
  gen++
  ready = (async () => {
    const d = (await dictionaryFor(language)) ?? { aff: affUS, dic: dicUS }
    const w = getWorker()
    await new Promise<void>((resolve) => {
      const onLoaded = (e: MessageEvent) => {
        if (e.data?.type === 'loaded') {
          w.removeEventListener('message', onLoaded)
          resolve()
        }
      }
      w.addEventListener('message', onLoaded)
      w.postMessage({ type: 'load', aff: d.aff, dic: d.dic, custom: get().settings.customWords })
    })
  })()
  return ready
}

export const checker: SpellChecker = {
  enabled: () => get().settings.spellcheck,
  verdict: (w) => (ignored.has(w) ? true : verdicts.get(w)),
  generation: () => gen,
  async check(words) {
    await ensureLoaded()
    const bad = new Set(await request<string[]>({ type: 'check', words }))
    for (const w of words) verdicts.set(w, !bad.has(w))
  }
}

export async function suggestions(word: string): Promise<string[]> {
  await ensureLoaded()
  return request<string[]>({ type: 'suggest', word })
}

export function refreshSpelling() {
  window.dispatchEvent(new Event('sd:spell-refresh'))
}

export async function addToDictionary(word: string) {
  verdicts.set(word, true)
  getWorker().postMessage({ type: 'add', word })
  await updateSettings({ customWords: [...new Set([...get().settings.customWords, word])] })
  refreshSpelling()
}

export function ignoreWord(word: string) {
  ignored.add(word)
  refreshSpelling()
}

/** Re-check everything after the language changes. */
export function resetSpelling() {
  ready = null
  verdicts.clear()
  gen++
  refreshSpelling()
}
