import path from 'node:path'
import { createWorker, OEM, type Worker } from 'tesseract.js'

export interface OcrWord {
  text: string
  confidence: number
  /** Pixel box in the recognized image: left, top, right, bottom. */
  bbox: [number, number, number, number]
}

// Bundled English LSTM model (Apache-2.0). Everything runs locally: no CDN, no cache files.
// In a packaged app these modules are asar-unpacked (worker threads cannot start from inside an asar).
const unpacked = (p: string) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const langPath = () => unpacked(path.dirname(require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz')))
const workerPath = () => unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js'))

let worker: Promise<Worker> | null = null

/** Recognize words in an encoded image (PNG/JPEG). */
export async function recognize(image: Uint8Array): Promise<OcrWord[]> {
  worker ??= createWorker('eng', OEM.LSTM_ONLY, { langPath: langPath(), workerPath: workerPath(), cacheMethod: 'none', gzip: true })
  const w = await worker
  const { data } = await w.recognize(Buffer.from(image), {}, { blocks: true })
  return (data.blocks ?? [])
    .flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
    .filter((wd) => wd.text.trim() && wd.confidence > 30)
    .map((wd) => ({ text: wd.text, confidence: wd.confidence, bbox: [wd.bbox.x0, wd.bbox.y0, wd.bbox.x1, wd.bbox.y1] }))
}

export async function stopOcr() {
  const w = worker
  worker = null
  if (w) await (await w).terminate()
}
