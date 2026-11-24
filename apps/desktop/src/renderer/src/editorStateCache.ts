import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/**
 * 每个文档保留自己的 EditorState（含 undo 历史）。
 * 内存里最多 20 份，超出按 LRU 淘汰（PLAN §5.4）。
 */
const MAX_CACHED = 20

interface CacheEntry {
  state: EditorState
  scrollTop: number
}

const cache = new Map<string, CacheEntry>()

export function readCachedState(relPath: string): CacheEntry | null {
  const entry = cache.get(relPath)
  if (entry === undefined) return null
  // 命中的挪到队尾，保持 LRU 顺序
  cache.delete(relPath)
  cache.set(relPath, entry)
  return entry
}

export function writeCachedState(relPath: string, view: EditorView): void {
  cache.delete(relPath)
  cache.set(relPath, { state: view.state, scrollTop: view.scrollDOM.scrollTop })
  while (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

export function dropCachedState(relPath: string): void {
  cache.delete(relPath)
}

export function clearCachedStates(): void {
  cache.clear()
}
