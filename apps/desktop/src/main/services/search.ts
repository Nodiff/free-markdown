import { BrowserWindow } from 'electron'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  basenamePosix,
  compareSearchResults,
  findTextHits,
  isMarkdownPath,
  matchesTitle,
  readDocMetadata,
  toPosix,
  type SearchBatch,
  type SearchFileResult,
  type SearchRequest
} from '@freemarkdown/core'
import { IPC_CHANNELS } from '../../shared/ipc'
import { fallbackTitle } from './docMeta'
import { getIndexEntries } from './metaIndex'
import { resolveInside } from './paths'
import { getCurrentVault } from './vault'

/** 与 scanner / metaIndex 保持同一套忽略规则 */
const IGNORED = new Set(['.git', 'node_modules', '.DS_Store'])
/** 同时读几个文件：SSD 上 8 个足够把 IO 打满，又不会把事件循环淹掉 */
const CONCURRENCY = 8
/** 批次节流：70ms 一批，保证「边扫边出」但不会每个文件都发一次 IPC */
const FLUSH_INTERVAL_MS = 70
const FLUSH_RESULT_COUNT = 40
/** 查询词长度上限，防止有人粘贴一篇文档进来 */
const MAX_QUERY_LENGTH = 200
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const MAX_FILES = 20000
/** 只用来推导标题：frontmatter 与首个 H1 都在前 16KB */
const TITLE_HEAD_BYTES = 16 * 1024

interface Candidate {
  relPath: string
  absPath: string
  name: string
  title: string
  mtimeMs: number
  size: number
}

/** 每次新查询自增：旧扫描在每个文件读完后检查这个值，发现变了就立刻停 */
let scanToken = 0

function sendBatch(batch: SearchBatch): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.searchBatch, batch)
  }
}

/** 切库、关库时把正在跑的扫描掐掉 */
export function cancelSearch(): void {
  scanToken += 1
}

async function walkMarkdown(
  root: string,
  relPath: string,
  visit: (absPath: string, rel: string, info: { mtimeMs: number; size: number }) => void
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
      await walkMarkdown(root, childRel, visit)
      continue
    }
    if (!entry.isFile() || !isMarkdownPath(entry.name)) continue

    const absPath = join(root, toPosix(childRel))
    try {
      const info = await stat(absPath)
      visit(absPath, toPosix(childRel), { mtimeMs: info.mtimeMs, size: info.size })
    } catch {
      // 遍历途中被删掉的文件直接跳过，不为它中断整次搜索
    }
  }
}

/** 标题优先用元数据索引里已经算好的，索引还没覆盖到的退回文件名 */
function collectCandidates(
  files: { absPath: string; relPath: string; mtimeMs: number; size: number }[],
  titles: Map<string, string>
): Candidate[] {
  return files.map((file) => ({
    relPath: file.relPath,
    absPath: file.absPath,
    name: basenamePosix(file.relPath),
    title: titles.get(file.relPath) ?? fallbackTitle(file.relPath),
    mtimeMs: file.mtimeMs,
    size: file.size
  }))
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

async function readCandidate(
  candidate: Candidate,
  query: string,
  titleOnly: boolean
): Promise<SearchFileResult | null> {
  // 文件名：去扩展名后再比一次，这样搜 "food" 不会因为 "food.md" 里的点而漏
  const nameHit =
    matchesTitle(candidate.name, candidate.title, query) ||
    matchesTitle(stripExt(candidate.name), candidate.title, query)

  if (titleOnly) {
    if (!nameHit) return null
    return {
      relPath: candidate.relPath,
      title: candidate.title,
      name: candidate.name,
      mtimeMs: candidate.mtimeMs,
      hits: [],
      total: 0,
      titleHit: true,
      skippedBody: true
    }
  }

  // 超大文件只做文件名/标题匹配（PLAN §5.3）
  if (candidate.size > MAX_BODY_BYTES) {
    if (!nameHit) return null
    return {
      relPath: candidate.relPath,
      title: candidate.title,
      name: candidate.name,
      mtimeMs: candidate.mtimeMs,
      hits: [],
      total: 0,
      titleHit: true,
      skippedBody: true
    }
  }

  let text: string
  try {
    text = await readFile(candidate.absPath, 'utf8')
  } catch {
    if (!nameHit) return null
    return {
      relPath: candidate.relPath,
      title: candidate.title,
      name: candidate.name,
      mtimeMs: candidate.mtimeMs,
      hits: [],
      total: 0,
      titleHit: true,
      skippedBody: true
    }
  }

  // 读到了正文就顺手重新推导标题，免得索引里的旧标题和磁盘不一致
  let title = candidate.title
  try {
    title = readDocMetadata(text.slice(0, TITLE_HEAD_BYTES), fallbackTitle(candidate.relPath)).title
  } catch {
    title = candidate.title
  }

  const { hits, total } = findTextHits(text, query)
  if (hits.length === 0 && !nameHit) return null

  return {
    relPath: candidate.relPath,
    title,
    name: candidate.name,
    mtimeMs: candidate.mtimeMs,
    hits,
    total,
    titleHit: nameHit,
    skippedBody: false
  }
}

/** 固定并发跑任务；任何一项抛出都不影响其余项 */
async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      await worker(items[index] as T)
    }
  })
  await Promise.all(runners)
}

/**
 * 流式全库搜索（PLAN §5.3）：不建索引，边扫边推批次。
 * 新查询进来时 token 变化，旧扫描自然退出。
 */
export async function startSearch(request: SearchRequest): Promise<void> {
  const token = (scanToken += 1)
  const query = request.text.trim().slice(0, MAX_QUERY_LENGTH)
  const requestId = request.requestId

  const vault = getCurrentVault()
  if (vault === null || query === '') {
    sendBatch({ requestId, results: [], scanned: 0, total: 0, done: true, limited: false, cancelled: false })
    return
  }

  const titles = new Map(getIndexEntries().map((entry) => [entry.relPath, entry.title]))

  const files: { absPath: string; relPath: string; mtimeMs: number; size: number }[] = []
  await walkMarkdown(vault.root, '', (absPath, relPath, info) => {
    files.push({ absPath, relPath, ...info })
  })
  if (token !== scanToken) return

  // 新的排在前面：先出结果的那几批看起来就像「最近改过的先命中」
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)

  const bytes = files.reduce((sum, file) => sum + file.size, 0)
  const limited = files.length > MAX_FILES || bytes > MAX_TOTAL_BYTES
  const candidates = collectCandidates(files, titles)

  // 先发一批「总数」，界面立刻能从 0/N 开始显示进度
  sendBatch({
    requestId,
    results: [],
    scanned: 0,
    total: candidates.length,
    done: false,
    limited,
    cancelled: false
  })

  let scanned = 0
  let pending: SearchFileResult[] = []
  let lastFlush = Date.now()

  const flush = (done: boolean): void => {
    if (pending.length === 0 && !done) return
    const batch: SearchBatch = {
      requestId,
      results: pending,
      scanned,
      total: candidates.length,
      done,
      limited,
      cancelled: false
    }
    pending = []
    lastFlush = Date.now()
    sendBatch(batch)
  }

  await runPool(candidates, CONCURRENCY, async (candidate) => {
    if (token !== scanToken) return
    let result: SearchFileResult | null = null
    try {
      result = await readCandidate(candidate, query, request.titleOnly)
    } catch {
      result = null
    }
    if (token !== scanToken) return

    scanned += 1
    if (result !== null) pending.push(result)

    if (pending.length >= FLUSH_RESULT_COUNT || Date.now() - lastFlush >= FLUSH_INTERVAL_MS) {
      pending.sort(compareSearchResults)
      flush(false)
    }
  })

  if (token !== scanToken) return
  pending.sort(compareSearchResults)
  flush(true)
}
