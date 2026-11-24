import { ipcMain, shell } from 'electron'
import type { Vault } from '@freemarkdown/core'
import { IPC_CHANNELS } from '../../shared/ipc'
import { refreshTrashAndEmit, rescanIndex } from '../services/metaIndex'
import { normalizeRelPath } from '../services/paths'
import { absoluteFor, createEntry, parentOf, removeEntry, renameEntry } from '../services/fileOps'
import { getCurrentVault } from '../services/vault'
import { broadcastTreeChanged } from './vault'

function requireVault(): Vault {
  const vault = getCurrentVault()
  if (vault === null) throw new Error('还没有打开库')
  return vault
}

function requireRelPath(value: unknown): string {
  const relPath = normalizeRelPath(value)
  if (relPath === '') throw new Error('路径非法')
  return relPath
}

function refreshAfterChange(dirs: string[]): void {
  broadcastTreeChanged(dirs)
  void rescanIndex()
}

export function registerFilesIpc(): void {
  ipcMain.handle(IPC_CHANNELS.filesCreate, async (_event, input: unknown) => {
    if (typeof input !== 'object' || input === null) throw new Error('参数非法')
    const record = input as Record<string, unknown>
    const dir = normalizeRelPath(record['dir'])
    const kind = record['kind'] === 'dir' ? 'dir' : record['kind'] === 'md' ? 'md' : null
    if (kind === null) throw new Error('文件类型非法')

    const result = await createEntry(requireVault(), dir, record['name'], kind)
    if (result.ok) refreshAfterChange([dir])
    return result
  })

  ipcMain.handle(IPC_CHANNELS.filesRename, async (_event, input: unknown) => {
    if (typeof input !== 'object' || input === null) throw new Error('参数非法')
    const record = input as Record<string, unknown>
    const relPath = requireRelPath(record['relPath'])
    const result = await renameEntry(requireVault(), relPath, record['name'])
    if (result.ok) refreshAfterChange([parentOf(relPath)])
    return result
  })

  ipcMain.handle(IPC_CHANNELS.filesRemove, async (_event, relPath: unknown) => {
    const path = requireRelPath(relPath)
    const result = await removeEntry(requireVault(), path)
    if (result.ok) {
      refreshAfterChange([parentOf(path)])
      await refreshTrashAndEmit()
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.filesReveal, (_event, relPath: unknown) => {
    const path = requireRelPath(relPath)
    shell.showItemInFolder(absoluteFor(requireVault(), path))
  })
}
