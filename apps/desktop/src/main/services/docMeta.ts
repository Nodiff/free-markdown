import { open, readFile, rename, stat } from 'node:fs/promises'
import { basenamePosix, extnamePosix, readDocMetadata, type DocMetaEntry } from '@freemarkdown/core'

/** 只读文件头部：frontmatter 与首个 H1 都在前几 KB 里，没必要把整篇读进内存 */
const HEAD_BYTES = 16 * 1024

export async function readFileHead(absolutePath: string, maxBytes = HEAD_BYTES): Promise<string> {
  const handle = await open(absolutePath, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const read = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, read.bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

/** 写 frontmatter 需要整篇原文（其余键要原样拼回去），这里才读全文 */
export function readFileText(absolutePath: string): Promise<string> {
  return readFile(absolutePath, 'utf8')
}

let tmpCounter = 0

const RENAME_RETRIES = 3
const RENAME_DELAY_MS = 150

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 原子写（PLAN §5.4）：同目录临时文件 → fsync → rename 覆盖。
 * Windows 上 rename 可能被杀毒软件短暂占用，失败重试 3 次，
 * 仍失败就抛错（宁可报错也不能静默丢改动）。
 */
export async function writeFileAtomic(absolutePath: string, text: string): Promise<void> {
  tmpCounter += 1
  const tmp = `${absolutePath}.fm-${process.pid}-${tmpCounter}.tmp`

  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await rename(tmp, absolutePath)
      return
    } catch (error) {
      lastError = error
      await delay(RENAME_DELAY_MS)
    }
  }

  // rename 一直失败时清掉临时文件，别把垃圾留在库目录里
  const { unlink } = await import('node:fs/promises')
  await unlink(tmp).catch(() => undefined)
  throw lastError ?? new Error('写入失败')
}

export function fallbackTitle(relPath: string): string {
  const name = basenamePosix(relPath)
  const ext = extnamePosix(name)
  return ext === '' ? name : name.slice(0, -ext.length)
}

/** 读一个 md 的元数据（标题 + 分类 + mtime/size） */
export async function readEntry(absolutePath: string, relPath: string): Promise<DocMetaEntry> {
  const info = await stat(absolutePath)
  const head = await readFileHead(absolutePath)
  const { title, categories } = readDocMetadata(head, fallbackTitle(relPath))
  return { relPath, title, categories, mtimeMs: info.mtimeMs, size: info.size }
}

export interface WriteCategoriesResult {
  changed: boolean
  raw: string
  entry: DocMetaEntry
}

/**
 * 只改 categories 段并落盘。
 * 内容完全一致时直接返回，不制造无意义的 mtime 变化（否则会凭空多出一条“变更”）。
 */
export async function applyCategories(
  absolutePath: string,
  relPath: string,
  nextRaw: string,
  previousRaw: string
): Promise<WriteCategoriesResult> {
  const changed = nextRaw !== previousRaw
  if (changed) await writeFileAtomic(absolutePath, nextRaw)

  const info = await stat(absolutePath)
  const { title, categories } = readDocMetadata(nextRaw, fallbackTitle(relPath))
  return {
    changed,
    raw: nextRaw,
    entry: { relPath, title, categories, mtimeMs: info.mtimeMs, size: info.size }
  }
}
