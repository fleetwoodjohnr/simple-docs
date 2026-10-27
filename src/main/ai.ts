import Anthropic from '@anthropic-ai/sdk'
import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './store'

// Optional writing assistant (off by default). The only network access the app makes: a request
// to the Claude API, sent from here when the user has turned the assistant on in Settings and
// clicked "Send" after seeing exactly what will be sent. Nothing is logged or cached.

const MODEL = 'claude-opus-5-5'
const MAX_INPUT = 200_000 // characters per request

const SYSTEM = `You are the writing assistant built into a word processor. The user selected text in their document and asked you to transform it.
Reply with only the resulting text, ready to replace the selection: no preamble, no explanations, no quotation marks around it, no Markdown formatting.
Keep the language of the original text. Keep the author's meaning, facts, names and numbers unless the instruction asks otherwise.
Separate paragraphs with a blank line.`

export const AI_ACTIONS: Record<string, string> = {
  improve: 'Improve the clarity, flow and word choice of this text.',
  proofread: 'Correct spelling, grammar and punctuation. Change nothing else.',
  shorter: 'Make this text noticeably shorter while keeping every key point.',
  longer: 'Expand this text with more detail and explanation, in the same voice.',
  formal: 'Rewrite this text in a more formal, professional tone.',
  casual: 'Rewrite this text in a friendlier, more conversational tone.',
  summarize: 'Summarize this text in a few sentences.',
  bullets: 'Turn this text into a concise list of key points, one per line, each starting with "• ".'
}

const keyFile = () => path.join(app.getPath('userData'), 'ai-key.bin')

/** Store (or remove, with null) the API key, encrypted with the OS keychain via safeStorage. */
export async function setApiKey(key: string | null): Promise<void> {
  if (!key) return fs.rm(keyFile(), { force: true })
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This system has no secure storage for the key. Set the ANTHROPIC_API_KEY environment variable instead.')
  await atomicWrite(keyFile(), safeStorage.encryptString(key.trim()))
}

async function storedKey(): Promise<string | null> {
  try {
    return safeStorage.decryptString(await fs.readFile(keyFile()))
  } catch {
    return null
  }
}

export async function aiStatus(): Promise<{ hasStoredKey: boolean; envCredentials: boolean; weakStorage: boolean }> {
  return {
    hasStoredKey: !!(await storedKey()),
    envCredentials: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    weakStorage: process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text'
  }
}

const running = new Map<string, AbortController>()

export function cancelAi(id: string) {
  running.get(id)?.abort()
}

/** Run one assistant request, streaming text to `onText`. Resolves with the full text. */
export async function runAi(id: string, action: string, instruction: string, text: string, onText: (delta: string) => void): Promise<string> {
  const task = action === 'custom' ? instruction.trim() : AI_ACTIONS[action]
  if (!task) throw new Error('Unknown action')
  if (!text.trim()) throw new Error('Nothing to send')
  if (text.length > MAX_INPUT) throw new Error('The selection is too long for one request; select less text')
  const key = await storedKey()
  // Without a stored key the SDK uses ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
  const client = key ? new Anthropic({ apiKey: key }) : new Anthropic()
  const controller = new AbortController()
  running.set(id, controller)
  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        output_config: { effort: 'medium' },
        // On a policy decline, the API re-runs the request on Anthropic's recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: `${task}\n\n<text>\n${text}\n</text>` }]
      },
      { signal: controller.signal }
    )
    stream.on('text', (delta) => onText(delta))
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new Error('Claude declined this request.')
    const out = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    if (message.stop_reason === 'max_tokens') return `${out}\n\n[The answer was cut off because it reached the length limit.]`
    return out
  } catch (e) {
    throw new Error(describe(e))
  } finally {
    running.delete(id)
  }
}

function describe(e: unknown): string {
  if (e instanceof Anthropic.APIUserAbortError) return 'Cancelled'
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was not accepted. Check it in Settings → AI assistant.'
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use this model.'
  if (e instanceof Anthropic.RateLimitError) return 'Rate limit reached. Wait a moment and try again.'
  if (e instanceof Anthropic.BadRequestError) return `The request was rejected: ${e.message}`
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check your internet connection.'
  if (e instanceof Anthropic.APIError) return `Claude API error${e.status ? ` ${e.status}` : ''}: ${e.message}`
  if (e instanceof Error && /credentials|api key|apiKey/i.test(e.message)) return 'No API key. Add one in Settings → AI assistant.'
  return e instanceof Error ? e.message : String(e)
}
