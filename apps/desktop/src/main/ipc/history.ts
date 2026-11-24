import { BrowserWindow, ipcMain } from 'electron'
import type {
  FileDiff,
  HistoryStatus,
  RewindResult,
  Snapshot,
  SnapshotDetail,
  SnapshotSaveResult,
  WorkingChange
} from '@freemarkdown/core'
import { IPC_CHANNELS, type HistoryChangedPayload } from '../../shared/ipc'
import { refreshTrashAndEmit, rescanIndex } from '../services/metaIndex'
import {
  deleteSnapshot,
  ensureHistory,
  getSnapshotDetail,
  getSnapshotFileDiff,
  getWorkingFileDiff,
  listSnapshots,
  listWorkingChanges,
  onHistoryChanged,
  rewindToSnapshot,
  saveSnapshot
} from '../services/history'
import { getCurrentVault } from '../services/vault'
import { broadcastTreeChanged } from './vault'

let unsubscribe: (() => void) | null = null

export function registerHistoryIpc(): void {
  ipcMain.handle(IPC_CHANNELS.historyStatus, async (): Promise<HistoryStatus> => {
    return ensureHistory(getCurrentVault())
  })

  ipcMain.handle(IPC_CHANNELS.historyList, async (): Promise<Snapshot[]> => {
    await ensureHistory(getCurrentVault())
    return listSnapshots()
  })

  ipcMain.handle(IPC_CHANNELS.historySave, async (_event, remark: unknown): Promise<SnapshotSaveResult> => {
    await ensureHistory(getCurrentVault())
    return saveSnapshot(remark)
  })

  ipcMain.handle(IPC_CHANNELS.historyDetail, async (_event, sha: unknown): Promise<SnapshotDetail> => {
    return getSnapshotDetail(String(sha ?? ''))
  })

  ipcMain.handle(
    IPC_CHANNELS.historySnapshotDiff,
    async (_event, sha: unknown, relPath: unknown): Promise<FileDiff> => {
      return getSnapshotFileDiff(String(sha ?? ''), relPath)
    }
  )

  ipcMain.handle(IPC_CHANNELS.historyChanges, async (): Promise<WorkingChange[]> => {
    await ensureHistory(getCurrentVault())
    return listWorkingChanges()
  })

  ipcMain.handle(IPC_CHANNELS.historyWorkingDiff, async (_event, relPath: unknown): Promise<FileDiff> => {
    return getWorkingFileDiff(relPath)
  })

  ipcMain.handle(IPC_CHANNELS.historyRewind, async (_event, sha: unknown): Promise<RewindResult> => {
    const result = await rewindToSnapshot(String(sha ?? ''))
    // 切快照等于整棵工作区被替换：树、元数据、回收站灰显都要跟着重来
    broadcastTreeChanged([''])
    await rescanIndex()
    await refreshTrashAndEmit()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.historyDelete, async (_event, sha: unknown): Promise<void> => {
    await deleteSnapshot(String(sha ?? ''))
  })
}

/** 把主进程内部的快照事件广播给渲染层；只订阅一次 */
export function subscribeHistoryBroadcast(): void {
  if (unsubscribe !== null) return
  unsubscribe = onHistoryChanged((reason) => {
    const payload: HistoryChangedPayload = {
      reason: reason === 'ready' || reason === 'snapshot' || reason === 'rewind' || reason === 'delete' ? reason : 'files'
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.historyChanged, payload)
    }
  })
}
