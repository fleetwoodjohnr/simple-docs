import type { SimpleDocsApi } from '../shared/ipc-types'

declare global {
  interface Window {
    simpleDocs: SimpleDocsApi
  }
}
export {}
