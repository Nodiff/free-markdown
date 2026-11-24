import { BrowserWindow, ipcMain, shell } from 'electron'
import type { TreeNode, Vault } from '@freemarkdown/core'
import { IPC_CHANNELS, type TreeChangedPayload, type VaultSnapshot } from '../../shared/ipc'
import { getConfig } from '../services/config'
import { resolveInside } from '../services/paths'
import { listDirectory } from '../services/scanner'
import {
  getCurrentVault,
  getExpandedPaths,
  openVaultDialog,
  setExpandedPaths,
  switchVault
} from '../services/vault'

function requireVault(): Vault {
  const vault = getCurrentVault()
  if (vault === null) throw new Error('还没有打开库')
  return vault
}

function assertRelPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('路径必须是字符串')
  return value
}

export function registerVaultIpc(): void {
  ipcMain.handle(IPC_CHANNELS.vaultOpen, async () => openVaultDialog())

  ipcMain.handle(
    IPC_CHANNELS.vaultCurrent,
    (): VaultSnapshot => ({
      vault: getCurrentVault(),
      recent: getConfig().vaults,
      expanded: getExpandedPaths()
    })
  )

  ipcMain.handle(IPC_CHANNELS.vaultSwitch, async (_event, vaultId: unknown) => {
    if (typeof vaultId !== 'string') throw new Error('vaultId 非法')
    return switchVault(vaultId)
  })

  ipcMain.handle(IPC_CHANNELS.treeList, async (_event, relPath: unknown): Promise<TreeNode[]> => {
    const vault = requireVault()
    return listDirectory(vault.root, assertRelPath(relPath))
  })

  ipcMain.handle(IPC_CHANNELS.treeOpenExternal, async (_event, relPath: unknown) => {
    const vault = requireVault()
    const absolute = resolveInside(vault.root, assertRelPath(relPath))
    const error = await shell.openPath(absolute)
    if (error !== '') throw new Error(error)
  })

  ipcMain.handle(IPC_CHANNELS.treeSetExpanded, (_event, paths: unknown) => {
    if (!Array.isArray(paths) || paths.some((item) => typeof item !== 'string')) {
      throw new Error('展开状态非法')
    }
    setExpandedPaths(paths as string[])
  })
}

export function broadcastVaultChanged(vault: Vault | null): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.vaultChanged, vault)
  }
}

export function broadcastTreeChanged(dirs: string[]): void {
  const vault = getCurrentVault()
  if (vault === null) return
  const payload: TreeChangedPayload = { vaultId: vault.id, dirs }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.treeChanged, payload)
  }
}
