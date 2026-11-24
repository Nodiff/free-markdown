import { app, shell } from 'electron'
import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { TrashEntry } from '@freemarkdown/core'
import { writeFileAtomic } from './docMeta'
import { resolveInside } from './paths'

/**
 * 应用回收站（PLAN §5.12）：删除先落到 userData，绝不 unlink；
 * 只有用户点「彻底删除」才交给系统废纸篓。
 * 文件真身在 userData 里，不在库目录，所以对时间机器而言「删除就是删除」。
 */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 200

export function trashRoot(vaultId: string): string {
  return join(app.getPath('userData'), 'trash', vaultId)
}

export function trashIndexFile(vaultId: string): string {
  return join(trashRoot(vaultId), 'index.json')
}

/** 回收站里的实际存放位置；同一路径删除多次时加时间后缀，避免互相覆盖 */
function storageRelPath(entry: TrashEntry): string {
  return entry.storedPath ?? entry.relPath
}

function isEntry(value: unknown): value is TrashEntry {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item['relPath'] === 'string' &&
    typeof item['name'] === 'string' &&
    typeof item['deletedAt'] === 'number'
  )
}

async function readIndex(vaultId: string): Promise<TrashEntry[]> {
  try {
    const raw = await readFile(trashIndexFile(vaultId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isEntry)
  } catch {
    // 索引还没建 / 被删掉，都当作空回收站
    return []
  }
}

export async function markTrashSuperseded(vaultId: string, paths: string[], sha: string): Promise<number> {
  if (paths.length === 0) return 0
  const entries = await readIndex(vaultId)
  const targets = new Set(paths)
  let changed = 0
  const next = entries.map((entry) => {
    if (entry.supersededBy !== undefined) return entry
    const covered = targets.has(entry.relPath) || paths.some((path) => path.startsWith(`${entry.relPath}/`))
    if (!covered) return entry
    changed += 1
    return { ...entry, supersededBy: sha, supersededAt: Date.now() }
  })
  if (changed > 0) await writeIndex(vaultId, next)
  return changed
}

async function writeIndex(vaultId: string, entries: TrashEntry[]): Promise<void> {
  await mkdir(trashRoot(vaultId), { recursive: true })
  await writeFileAtomic(trashIndexFile(vaultId), `${JSON.stringify(entries, null, 2)}\n`)
}

export async function listTrash(vaultId: string | null): Promise<TrashEntry[]> {
  if (vaultId === null) return []
  const entries = await readIndex(vaultId)
  return entries.sort((a, b) => b.deletedAt - a.deletedAt)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 删除 → 移入应用回收站（保留相对目录结构），并登记到索引 */
export async function moveToTrash(
  vault: { id: string; root: string },
  relPath: string
): Promise<TrashEntry> {
  const absolute = resolveInside(vault.root, relPath)
  const info = await stat(absolute)

  const entries = await readIndex(vault.id)
  const taken = new Set(entries.map(storageRelPath))
  let storedPath = relPath
  let attempt = 0
  while (taken.has(storedPath)) {
    attempt += 1
    storedPath = `${relPath}.dup-${attempt}`
  }

  const storedAbsolute = resolveInside(trashRoot(vault.id), storedPath)
  await mkdir(dirname(storedAbsolute), { recursive: true })
  await rename(absolute, storedAbsolute)

  const entry: TrashEntry = {
    relPath,
    name: basename(relPath),
    deletedAt: Date.now(),
    storedPath,
    isDir: info.isDirectory()
  }
  await writeIndex(vault.id, [entry, ...entries])
  return entry
}

/** 还原：原位置被占用时改名成 `name (1).md`，不覆盖任何已有文件 */
export async function restoreFromTrash(
  vault: { id: string; root: string },
  relPath: string
): Promise<{ relPath: string; renamed: boolean }> {
  const entries = await readIndex(vault.id)
  const entry = entries.find((item) => item.relPath === relPath)
  if (entry === undefined) throw new Error('回收站里没有这一项')

  const source = resolveInside(trashRoot(vault.id), storageRelPath(entry))
  const dot = relPath.lastIndexOf('.')
  const slash = relPath.lastIndexOf('/')
  const stemEnd = dot > slash ? dot : relPath.length
  const stem = relPath.slice(0, stemEnd)
  const ext = relPath.slice(stemEnd)

  let targetRel = relPath
  let attempt = 0
  while (await exists(resolveInside(vault.root, targetRel))) {
    attempt += 1
    targetRel = `${stem} (${attempt})${ext}`
  }

  const target = resolveInside(vault.root, targetRel)
  await mkdir(dirname(target), { recursive: true })
  await rename(source, target)

  await writeIndex(vault.id, entries.filter((item) => item !== entry))
  return { relPath: targetRel, renamed: targetRel !== relPath }
}

/** 彻底删除：交给系统废纸篓（最后一道保险），再从索引里摘掉 */
export async function purgeTrashEntry(
  vault: { id: string; root: string },
  relPath: string
): Promise<void> {
  const entries = await readIndex(vault.id)
  const entry = entries.find((item) => item.relPath === relPath)
  if (entry === undefined) return

  const source = resolveInside(trashRoot(vault.id), storageRelPath(entry))
  if (await exists(source)) {
    // shell.trashItem 在 macOS 上需要真实路径；失败也别把索引留着
    await shell.trashItem(source).catch(() => undefined)
  }
  await writeIndex(vault.id, entries.filter((item) => item !== entry))
  await pruneEmptyDirs(trashRoot(vault.id), dirname(source))
}

/** 清掉回收站里已经空掉的父目录，别让目录结构无限堆积 */
async function pruneEmptyDirs(stopAt: string, start: string): Promise<void> {
  let current = start
  while (current.startsWith(stopAt) && current !== stopAt) {
    try {
      const entries = await readdir(current)
      if (entries.length > 0) return
      await rm(current, { recursive: false })
    } catch {
      return
    }
    current = dirname(current)
  }
}

/** 启动时清理：30 天 / 200 项，先到先清 */
export async function cleanupTrash(vault: { id: string; root: string }): Promise<void> {
  const entries = await readIndex(vault.id)
  if (entries.length === 0) return

  const now = Date.now()
  const expired = entries.filter((entry) => now - entry.deletedAt > RETENTION_MS)
  const overflow = entries.slice(MAX_ENTRIES)

  for (const entry of [...expired, ...overflow]) {
    await purgeTrashEntry(vault, entry.relPath).catch(() => undefined)
  }
}
