import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc'
import { normalizeRelPath } from '../services/paths'
import { readDocument, saveConflictCopy, setActiveDocument, writeDocument } from '../services/documents'

function requireRelPath(value: unknown): string {
  const relPath = normalizeRelPath(value)
  if (relPath === '') throw new Error('文档路径非法')
  return relPath
}

function requireContent(value: unknown): string {
  if (typeof value !== 'string') throw new Error('正文必须是字符串')
  return value
}

export function registerDocIpc(): void {
  ipcMain.handle(IPC_CHANNELS.docRead, (_event, relPath: unknown) => readDocument(requireRelPath(relPath)))

  ipcMain.handle(
    IPC_CHANNELS.docWrite,
    (_event, relPath: unknown, content: unknown, baseHash: unknown) =>
      writeDocument(
        requireRelPath(relPath),
        requireContent(content),
        typeof baseHash === 'string' ? baseHash : undefined
      )
  )

  ipcMain.handle(IPC_CHANNELS.docSaveCopy, (_event, relPath: unknown, content: unknown) =>
    saveConflictCopy(requireRelPath(relPath), requireContent(content))
  )

  ipcMain.handle(IPC_CHANNELS.docSetActive, (_event, relPath: unknown) => {
    setActiveDocument(relPath === null ? null : requireRelPath(relPath))
  })
}

/** 当前文档被外部改动时推给所有窗口（渲染层再决定是静默重载还是弹冲突） */
export function broadcastDocExternal(payload: { relPath: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.docExternal, payload)
  }
}
