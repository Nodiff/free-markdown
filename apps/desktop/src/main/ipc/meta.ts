import { BrowserWindow, ipcMain } from 'electron'
import type { DocMetaEntry, LibraryIndex } from '@freemarkdown/core'
import { IPC_CHANNELS } from '../../shared/ipc'
import {
  getIndexSnapshot,
  markDocOpened,
  onIndexChange,
  setDocCategories
} from '../services/metaIndex'
import { normalizeRelPath } from '../services/paths'

function requireRelPath(value: unknown): string {
  const relPath = normalizeRelPath(value)
  if (relPath === '') throw new Error('文档路径非法')
  return relPath
}

export function registerMetaIpc(): void {
  ipcMain.handle(IPC_CHANNELS.metaSnapshot, (): Promise<LibraryIndex> => getIndexSnapshot())

  ipcMain.handle(
    IPC_CHANNELS.metaSetCategories,
    async (_event, relPath: unknown, categories: unknown): Promise<DocMetaEntry> => {
      if (!Array.isArray(categories) || categories.some((item) => typeof item !== 'string')) {
        throw new Error('categories 必须是字符串数组')
      }
      return setDocCategories(requireRelPath(relPath), categories as string[])
    }
  )

  ipcMain.handle(IPC_CHANNELS.metaMarkOpened, (_event, relPath: unknown) => {
    markDocOpened(requireRelPath(relPath))
  })
}

/** 索引任何变化都推给所有窗口：分类计数、最近使用、未分类都要跟着动 */
export function broadcastMetaChanged(index: LibraryIndex): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.metaChanged, index)
  }
}

export function subscribeMetaBroadcast(): () => void {
  return onIndexChange(broadcastMetaChanged)
}
