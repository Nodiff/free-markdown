import { ipcMain } from 'electron'
import type { TrashEntry } from '@freemarkdown/core'
import { IPC_CHANNELS } from '../../shared/ipc'
import { refreshTrashAndEmit } from '../services/metaIndex'
import { normalizeRelPath } from '../services/paths'
import { listTrash, moveToTrash, purgeTrashEntry, restoreFromTrash } from '../services/trash'
import { getCurrentVault } from '../services/vault'

function requireVault(): { id: string; root: string } {
  const vault = getCurrentVault()
  if (vault === null) throw new Error('还没有打开库')
  return { id: vault.id, root: vault.root }
}

function requireRelPath(value: unknown): string {
  const relPath = normalizeRelPath(value)
  if (relPath === '') throw new Error('文档路径非法')
  return relPath
}

export function registerTrashIpc(): void {
  ipcMain.handle(IPC_CHANNELS.trashList, (): Promise<TrashEntry[]> => listTrash(getCurrentVault()?.id ?? null))

  ipcMain.handle(IPC_CHANNELS.trashDelete, async (_event, relPath: unknown): Promise<TrashEntry> => {
    const entry = await moveToTrash(requireVault(), requireRelPath(relPath))
    // 删除动作不触发快照（PLAN §5.12），但分类区的回收站计数要立刻更新
    await refreshTrashAndEmit()
    return entry
  })

  ipcMain.handle(IPC_CHANNELS.trashRestore, async (_event, relPath: unknown) => {
    const result = await restoreFromTrash(requireVault(), requireRelPath(relPath))
    await refreshTrashAndEmit()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.trashPurge, async (_event, relPath: unknown) => {
    await purgeTrashEntry(requireVault(), requireRelPath(relPath))
    await refreshTrashAndEmit()
  })
}
