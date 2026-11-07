import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  box: vi.fn(), close: vi.fn(), install: vi.fn(),
  updater: { autoDownload: true, checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() }
}))
vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '0.2.1' }, dialog: { showMessageBox: mocks.box }, shell: { openExternal: vi.fn() } }))
vi.mock('electron-updater', () => ({ autoUpdater: mocks.updater }))
vi.mock('@/main/store', () => ({}))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })
it.skipIf(process.platform === 'darwin')('restart waits for the unsaved-work close handshake before installing', async () => {
  const { checkForUpdates, installIfRequested } = await import('@/main/updater')
  mocks.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '0.2.2' } })
  mocks.updater.downloadUpdate.mockResolvedValue([])
  mocks.box.mockResolvedValue({ response: 0 })
  await checkForUpdates({ isDestroyed: () => false, close: mocks.close } as never, true)
  expect(mocks.close).toHaveBeenCalledOnce()
  expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  expect(installIfRequested()).toBe(true)
  expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(true, true)
})
it('choosing Later does not request a restart', async () => {
  const { checkForUpdates, installIfRequested } = await import('@/main/updater')
  mocks.updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '0.2.2' } })
  mocks.box.mockResolvedValue({ response: 1 })
  await checkForUpdates({ isDestroyed: () => false, close: mocks.close } as never, true)
  expect(mocks.close).not.toHaveBeenCalled()
  expect(installIfRequested()).toBe(false)
})
