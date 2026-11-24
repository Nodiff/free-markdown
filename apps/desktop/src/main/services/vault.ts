import { dialog } from 'electron'
import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Vault } from '@freemarkdown/core'
import { getConfig, maxRecentVaults, saveConfig, updateConfig } from './config'

let currentVault: Vault | null = null
const listeners = new Set<(vault: Vault | null) => void>()

export function getCurrentVault(): Vault | null {
  return currentVault
}

export function onVaultChange(listener: (vault: Vault | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(vault: Vault | null): void {
  currentVault = vault
  for (const listener of listeners) listener(vault)
}

export function getExpandedPaths(): string[] {
  if (currentVault === null) return []
  return getConfig().ui.expanded[currentVault.id] ?? []
}

export function setExpandedPaths(paths: string[]): void {
  if (currentVault === null) return
  const vaultId = currentVault.id
  updateConfig((config) => {
    config.ui.expanded[vaultId] = paths
  })
}

/** 启动时恢复上次的库；目录已经不存在就从配置里摘掉当前标记，别留下坏状态 */
export async function restoreVault(): Promise<Vault | null> {
  const config = getConfig()
  if (config.currentVaultId === null) return null

  const vault = config.vaults.find((item) => item.id === config.currentVaultId)
  if (vault === undefined) {
    updateConfig((draft) => {
      draft.currentVaultId = null
    })
    return null
  }

  try {
    const info = await stat(vault.root)
    if (!info.isDirectory()) throw new Error('不是目录')
  } catch {
    updateConfig((draft) => {
      draft.currentVaultId = null
      draft.vaults = draft.vaults.filter((item) => item.id !== vault.id)
    })
    return null
  }

  emit(vault)
  return vault
}

async function activate(root: string): Promise<Vault> {
  // realpath 归一：macOS 上 /tmp 与 /private/tmp、外接盘软链会让同一目录得到两个路径，
  // 不归一的话同一个库会被当成两个（最近列表重复、时间机器建两份）。
  const real = await realpath(root)
  const info = await stat(real)
  if (!info.isDirectory()) throw new Error('只能把文件夹作为库')

  const id = createHash('sha1').update(real).digest('hex').slice(0, 16)
  const vault: Vault = { id, root: real, name: basename(real), lastOpenedAt: Date.now() }

  updateConfig((config) => {
    const existing = config.vaults.find((item) => item.id === id)
    if (existing !== undefined) {
      Object.assign(existing, vault)
    } else {
      config.vaults.unshift(vault)
    }
    config.vaults.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    config.vaults = config.vaults.slice(0, maxRecentVaults())
    config.currentVaultId = id
  })
  await saveConfig()

  emit(vault)
  return vault
}

export async function openVaultDialog(): Promise<Vault | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open Vault',
    buttonLabel: 'Open',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return activate(result.filePaths[0])
}

export async function switchVault(vaultId: string): Promise<Vault | null> {
  if (typeof vaultId !== 'string') throw new Error('vaultId 非法')
  const vault = getConfig().vaults.find((item) => item.id === vaultId)
  if (vault === undefined) return null
  return activate(vault.root)
}
