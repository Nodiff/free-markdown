import { app } from 'electron'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  isMarkdownPath,
  normalizeCategories,
  toPosix,
  writeCategories,
  type CategoryCount,
  type DocMetaEntry,
  type LibraryIndex,
  type RecentDoc,
  type Vault
} from '@freemarkdown/core'
import { applyCategories, readEntry, readFileText } from './docMeta'
import { resolveInside } from './paths'
import { listTrash } from './trash'

/** 与 scanner 保持同一套忽略规则 */
const IGNORED = new Set(['.git', 'node_modules', '.DS_Store'])
const MAX_RECENT_DOCS = 20
const MAX_CATEGORIES_PER_DOC = 20
const MAX_CATEGORY_NAME = 40
const EMIT_INTERVAL_MS = 120
const PERSIST_DELAY_MS = 800

interface StoredIndex {
  version: 1
  vaultId: string
  updatedAt: number
  files: Record<string, DocMetaEntry>
  recent: RecentDoc[]
}

interface IndexState {
  vault: Vault
  files: Map<string, DocMetaEntry>
  recent: RecentDoc[]
  scanning: boolean
  trashCount: number
  updatedAt: number
}

let state: IndexState | null = null
const listeners = new Set<(index: LibraryIndex) => void>()
let emitTimer: NodeJS.Timeout | null = null
let persistTimer: NodeJS.Timeout | null = null
let persistInFlight: Promise<void> | null = null
/** 所有写入串行化：同一篇文档连点两下分类，不能互相覆盖 */
let writeChain: Promise<unknown> = Promise.resolve()
let scanToken = 0

export function indexFile(vaultId: string): string {
  return join(app.getPath('userData'), 'index', `${vaultId}.json`)
}

export function onIndexChange(listener: (index: LibraryIndex) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function buildSnapshot(): LibraryIndex {
  if (state === null) {
    return {
      vaultId: null,
      files: [],
      categories: [],
      uncategorized: 0,
      recent: [],
      trashCount: 0,
      scanning: false,
      updatedAt: 0
    }
  }

  const files: DocMetaEntry[] = []
  const counts = new Map<string, number>()
  let uncategorized = 0

  for (const entry of state.files.values()) {
    files.push(entry)
    if (entry.categories.length === 0) uncategorized += 1
    for (const name of entry.categories) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  files.sort((a, b) => a.relPath.localeCompare(b.relPath, 'zh', { numeric: true, sensitivity: 'base' }))

  const categories: CategoryCount[] = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh', { sensitivity: 'base' }))

  return {
    vaultId: state.vault.id,
    files,
    categories,
    uncategorized,
    recent: state.recent.filter((item) => state?.files.has(item.relPath) === true),
    trashCount: state.trashCount,
    scanning: state.scanning,
    updatedAt: state.updatedAt
  }
}

function emitNow(): void {
  if (emitTimer !== null) {
    clearTimeout(emitTimer)
    emitTimer = null
  }
  if (state !== null) state.updatedAt = Date.now()
  const snapshot = buildSnapshot()
  for (const listener of listeners) listener(snapshot)
}

function scheduleEmit(): void {
  if (emitTimer !== null) return
  emitTimer = setTimeout(() => {
    emitTimer = null
    emitNow()
  }, EMIT_INTERVAL_MS)
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void persist()
  }, PERSIST_DELAY_MS)
}

export async function persist(): Promise<void> {
  if (state === null) return
  if (persistInFlight !== null) {
    await persistInFlight
    return
  }
  const snapshotState = state
  persistInFlight = (async () => {
    const file = indexFile(snapshotState.vault.id)
    await mkdir(dirname(file), { recursive: true })
    const payload: StoredIndex = {
      version: 1,
      vaultId: snapshotState.vault.id,
      updatedAt: Date.now(),
      files: Object.fromEntries(snapshotState.files),
      recent: snapshotState.recent
    }
    const tmp = `${file}.tmp`
    await writeFile(tmp, `${JSON.stringify(payload)}\n`, 'utf8')
    await rename(tmp, file)
  })().finally(() => {
    persistInFlight = null
  })
  await persistInFlight
}

function isStoredEntry(value: unknown): value is DocMetaEntry {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item['relPath'] === 'string' &&
    typeof item['title'] === 'string' &&
    Array.isArray(item['categories']) &&
    item['categories'].every((entry) => typeof entry === 'string') &&
    typeof item['mtimeMs'] === 'number' &&
    typeof item['size'] === 'number'
  )
}

async function readStored(vaultId: string): Promise<{ files: DocMetaEntry[]; recent: RecentDoc[] }> {
  try {
    const raw = await readFile(indexFile(vaultId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return { files: [], recent: [] }
    const record = parsed as Record<string, unknown>

    const rawFiles = record['files']
    const files =
      typeof rawFiles === 'object' && rawFiles !== null
        ? Object.values(rawFiles as Record<string, unknown>).filter(isStoredEntry)
        : []

    const rawRecent = record['recent']
    const recent = Array.isArray(rawRecent)
      ? rawRecent
          .filter((item): item is RecentDoc => {
            if (typeof item !== 'object' || item === null) return false
            const entry = item as Record<string, unknown>
            return typeof entry['relPath'] === 'string' && typeof entry['openedAt'] === 'number'
          })
          .slice(0, MAX_RECENT_DOCS)
      : []

    return { files, recent }
  } catch {
    return { files: [], recent: [] }
  }
}

async function refreshTrashCount(): Promise<void> {
  if (state === null) return
  const entries = await listTrash(state.vault.id)
  if (state === null) return
  if (state.trashCount !== entries.length) {
    state.trashCount = entries.length
    scheduleEmit()
  }
}

export async function getIndexSnapshot(): Promise<LibraryIndex> {
  await refreshTrashCount()
  return buildSnapshot()
}

/** 给搜索和 ⌘P 用的只读投影：标题、mtime 都在这里，省得再读一遍头部 */
export function getIndexEntries(): DocMetaEntry[] {
  return state === null ? [] : [...state.files.values()]
}

/** 回收站增删后立刻刷新计数并推给界面 */
export async function refreshTrashAndEmit(): Promise<void> {
  await refreshTrashCount()
  emitNow()
}

/** 切库/开库：先用磁盘缓存铺一层（界面立刻有东西），再后台全量校验 */
export async function openIndexForVault(vault: Vault): Promise<void> {
  scanToken += 1
  const stored = await readStored(vault.id)
  state = {
    vault,
    files: new Map(stored.files.map((entry) => [entry.relPath, entry])),
    recent: stored.recent,
    scanning: true,
    trashCount: 0,
    updatedAt: Date.now()
  }
  emitNow()
  await refreshTrashCount()
  emitNow()

  const token = scanToken
  void scanAll(vault, token)
}

/** 切快照后工作区被整体替换：让元数据索引重新走一遍全量校验 */
export async function rescanIndex(): Promise<void> {
  if (state === null) return
  const vault = state.vault
  const token = (scanToken += 1)
  state.scanning = true
  emitNow()
  await scanAll(vault, token)
}

export function closeIndex(): void {
  scanToken += 1
  if (state !== null) void persist()
  state = null
  emitNow()
}

async function walk(
  root: string,
  relPath: string,
  visit: (absolutePath: string, rel: string) => Promise<void>
): Promise<void> {
  let entries
  try {
    entries = await readdir(relPath === '' ? root : resolveInside(root, relPath), { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue
    const childRel = relPath === '' ? entry.name : `${relPath}/${entry.name}`

    if (entry.isDirectory()) {
      await walk(root, childRel, visit)
      continue
    }
    if (!entry.isFile()) continue
    if (!isMarkdownPath(entry.name)) continue
    await visit(join(root, toPosix(childRel)), toPosix(childRel))
  }
}

/**
 * 全量校验：只对 mtime/size 变化的文件重读头部。
 * 大库第一次会跑一阵，期间 `scanning` 为 true，界面显示“正在读取元数据”。
 */
async function scanAll(vault: Vault, token: number): Promise<void> {
  const previous = state?.files ?? new Map<string, DocMetaEntry>()
  const next = new Map<string, DocMetaEntry>()
  let lastEmit = Date.now()

  await walk(vault.root, '', async (absolutePath, relPath) => {
    if (token !== scanToken || state === null) return
    const cached = previous.get(relPath)
    try {
      const fresh = await readEntry(absolutePath, relPath)
      // mtime/size 都没变就直接复用缓存，省掉一次读
      next.set(
        relPath,
        cached !== undefined && cached.mtimeMs === fresh.mtimeMs && cached.size === fresh.size ? cached : fresh
      )
    } catch {
      if (cached !== undefined) next.set(relPath, cached)
    }

    if (Date.now() - lastEmit > 250) {
      lastEmit = Date.now()
      if (state !== null && token === scanToken) {
        state.files = next
        scheduleEmit()
      }
    }
  })

  if (token !== scanToken || state === null) return
  state.files = next
  state.scanning = false
  state.recent = state.recent.filter((item) => next.has(item.relPath))
  emitNow()
  schedulePersist()
}

export interface FileChangeEvent {
  relPath: string
  kind: 'add' | 'change' | 'unlink'
}

/** watcher 的增量：只重算受影响的那几个文件 */
export async function applyFileEvents(events: FileChangeEvent[]): Promise<void> {
  if (state === null || events.length === 0) return
  const vault = state.vault
  let touched = false

  for (const event of events) {
    if (event.kind === 'unlink') {
      if (state.files.delete(event.relPath)) touched = true
      const before = state.recent.length
      state.recent = state.recent.filter((item) => item.relPath !== event.relPath)
      if (state.recent.length !== before) touched = true
      continue
    }

    if (!isMarkdownPath(event.relPath)) continue
    try {
      const entry = await readEntry(resolveInside(vault.root, event.relPath), event.relPath)
      state.files.set(event.relPath, entry)
      touched = true
    } catch {
      // 事件常常比落盘早几毫秒：读不到就留给下一条事件，别把已有元数据抹掉
    }
  }

  if (!touched) return
  scheduleEmit()
  schedulePersist()
}

function assertCategories(categories: string[]): string[] {
  const normalized = normalizeCategories(categories)
  if (normalized.length > MAX_CATEGORIES_PER_DOC) throw new Error('分类过多')
  for (const name of normalized) {
    if (name.length > MAX_CATEGORY_NAME) throw new Error('分类名过长')
  }
  return normalized
}

/**
 * 改分类：读全文 → 只替换 categories 段 → 原子写 → 更新缓存。
 * 分类真身永远在文档 frontmatter 里，索引只是投影。
 */
export function setDocCategories(relPath: string, categories: string[]): Promise<DocMetaEntry> {
  const job = writeChain.then(async (): Promise<DocMetaEntry> => {
    if (state === null) throw new Error('还没有打开库')
    if (!isMarkdownPath(relPath)) throw new Error('只有 md 文档可以打分类')

    const list = assertCategories(categories)
    const absolute = resolveInside(state.vault.root, relPath)
    const raw = await readFileText(absolute)
    const nextRaw = writeCategories(raw, list)

    // 内容没变化就别写盘，否则白白改一次 mtime
    const tempEntry: DocMetaEntry =
      state.files.get(relPath) ?? {
        relPath,
        title: relPath,
        categories: [],
        mtimeMs: 0,
        size: 0
      }

    if (nextRaw !== raw) {
      const result = await applyCategories(absolute, relPath, nextRaw, raw)
      state.files.set(relPath, result.entry)
      scheduleEmit()
      schedulePersist()
      return result.entry
    }

    return tempEntry
  })

  // 让链条不因为某次失败而断掉
  writeChain = job.catch(() => undefined)
  return job
}

/** 记录“最近使用”：时间取打开那一刻，不看 mtime */
export function markDocOpened(relPath: string): void {
  if (state === null) return
  if (!state.files.has(relPath)) return
  const now = Date.now()
  state.recent = [{ relPath, openedAt: now }, ...state.recent.filter((item) => item.relPath !== relPath)].slice(
    0,
    MAX_RECENT_DOCS
  )
  scheduleEmit()
  schedulePersist()
}
