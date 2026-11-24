import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import {
  applyTextFormat,
  detectTextFormat,
  isMarkdownPath,
  stripBom,
  type DocumentData,
  type DocumentWriteResult
} from '@freemarkdown/core'
import { writeFileAtomic } from './docMeta'
import { resolveInside } from './paths'
import { getCurrentVault } from './vault'

/** 自写抑制窗口：watcher 事件常常比 rename 晚几十毫秒到达，5s 足够宽裕 */
const SUPPRESS_WINDOW_MS = 5000
const MAX_COPY_TRIES = 50

/** relPath → 刚由本应用写入的内容 hash */
const recentWrites = new Map<string, { hash: string; at: number }>()
let activeRelPath: string | null = null

type ExternalListener = (payload: { relPath: string }) => void
const externalListeners = new Set<ExternalListener>()

function sha1(raw: string): string {
  return createHash('sha1').update(raw).digest('hex')
}

function requireVault(): { root: string; id: string } {
  const vault = getCurrentVault()
  if (vault === null) throw new Error('还没有打开库')
  return { root: vault.root, id: vault.id }
}

/**
 * 正文里带不带 CR 都要按「磁盘原文」判断行尾：
 * 只有整篇都用 LF 才写 LF，否则一律按 CRLF 保存。
 */
function normalizeContent(raw: string): { content: string; eol: '\n' | '\r\n'; bom: boolean } {
  const format = detectTextFormat(raw)
  return { content: stripBom(raw).replace(/\r\n/g, '\n'), eol: format.eol, bom: format.bom }
}

/** 读一篇文档：正文归一成 LF，hash 算的是磁盘原文（含 BOM 与原始行尾） */
export async function readDocument(relPath: string): Promise<DocumentData> {
  const { root } = requireVault()
  if (!isMarkdownPath(relPath)) throw new Error('只有 md 文档可以编辑')

  const absolute = resolveInside(root, relPath)
  const raw = await readFile(absolute, 'utf8')
  const info = await stat(absolute)
  const { content, eol, bom } = normalizeContent(raw)

  return { relPath, content, hash: sha1(raw), mtimeMs: info.mtimeMs, size: info.size, eol, bom }
}

/**
 * 写盘。`baseHash` 是本应用最后一次看到的磁盘版本：
 * 与当前磁盘不一致 → 不写，返回冲突，交给用户决定（绝不静默覆盖外部改动）。
 */
export async function writeDocument(
  relPath: string,
  content: string,
  baseHash?: string
): Promise<DocumentWriteResult> {
  const { root } = requireVault()
  if (!isMarkdownPath(relPath)) throw new Error('只有 md 文档可以编辑')

  const absolute = resolveInside(root, relPath)
  const disk = await readDocument(relPath)

  if (baseHash !== undefined && baseHash !== '' && disk.hash !== baseHash) {
    return { ok: false, reason: 'conflict', doc: disk }
  }

  const text = applyTextFormat(content, { eol: disk.eol, bom: disk.bom })
  await writeFileAtomic(absolute, text)

  const info = await stat(absolute)
  recentWrites.set(relPath, { hash: sha1(text), at: Date.now() })

  return {
    ok: true,
    doc: {
      relPath,
      content: normalizeContent(text).content,
      hash: sha1(text),
      mtimeMs: info.mtimeMs,
      size: info.size,
      eol: disk.eol,
      bom: disk.bom
    }
  }
}

function copyName(relPath: string, stamp: string, attempt: number): string {
  const name = basename(relPath)
  const dot = name.lastIndexOf('.')
  const stem = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? '' : name.slice(dot)
  const suffix = attempt === 0 ? '' : ` ${attempt + 1}`
  return `${stem} (冲突副本 ${stamp}${suffix})${ext}`
}

/** 「另存副本」：把当前编辑内容写成同目录的新文件，原文件保持磁盘上的外部版本 */
export async function saveConflictCopy(relPath: string, content: string): Promise<{ relPath: string }> {
  const { root } = requireVault()
  const source = await readDocument(relPath)
  const stamp = new Date()
    .toLocaleString('sv-SE', { hour12: false })
    .replace(/[:T]/g, '-')
    .slice(0, 19)

  for (let attempt = 0; attempt < MAX_COPY_TRIES; attempt += 1) {
    const name = copyName(relPath, stamp, attempt)
    const dir = dirname(relPath)
    const relCopy = dir === '.' ? name : `${dir}/${name}`
    const absolute = resolveInside(root, relCopy)
    try {
      await stat(absolute)
      continue
    } catch {
      // 目标不存在，可以写
    }

    const text = applyTextFormat(content, { eol: source.eol, bom: source.bom })
    await writeFileAtomic(absolute, text)
    recentWrites.set(relCopy, { hash: sha1(text), at: Date.now() })
    return { relPath: relCopy }
  }

  throw new Error('同名副本过多，无法另存')
}

/** 渲染进程打开/切换文档时告诉主进程，只有当前文档的外部改动才值得弹冲突 */
export function setActiveDocument(relPath: string | null): void {
  activeRelPath = relPath
}

export function onExternalDocChange(listener: ExternalListener): () => void {
  externalListeners.add(listener)
  return () => {
    externalListeners.delete(listener)
  }
}

/** 是不是刚由我们自己写的那一次改动（是就吞掉，避免自动保存把光标弹跳） */
async function isSelfWrite(root: string, relPath: string): Promise<boolean> {
  const record = recentWrites.get(relPath)
  if (record === undefined) return false
  if (Date.now() - record.at > SUPPRESS_WINDOW_MS) {
    recentWrites.delete(relPath)
    return false
  }
  try {
    const raw = await readFile(resolveInside(root, relPath), 'utf8')
    if (sha1(raw) === record.hash) {
      recentWrites.delete(relPath)
      return true
    }
  } catch {
    // 读不到就当作不是我们写的
  }
  recentWrites.delete(relPath)
  return false
}

/**
 * watcher 的文件事件先过一遍这里：
 * 命中自写抑制的直接丢弃，落在当前文档上的真正外部改动才广播给渲染进程。
 */
export async function inspectExternalChanges(events: { relPath: string; kind: string }[]): Promise<void> {
  const vault = getCurrentVault()
  if (vault === null) return

  for (const event of events) {
    if (event.kind !== 'change') continue
    if (activeRelPath === null || event.relPath !== activeRelPath) continue
    if (!isMarkdownPath(event.relPath)) continue
    if (await isSelfWrite(vault.root, event.relPath)) continue

    for (const listener of externalListeners) listener({ relPath: event.relPath })
    // 一个文件一次外部改动只报一次
    return
  }
}

/** 切库时把当前文档与抑制表清空 */
export function resetDocumentState(): void {
  activeRelPath = null
  recentWrites.clear()
}
