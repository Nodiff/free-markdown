import { watch, type FSWatcher } from 'chokidar'
import { relative, sep } from 'node:path'
import { dirnamePosix, toPosix } from '@freemarkdown/core'

const IGNORED_SEGMENTS = new Set(['.git', 'node_modules', '.DS_Store'])
const FLUSH_INTERVAL_MS = 150

export interface WatchedFileEvent {
  relPath: string
  kind: 'add' | 'change' | 'unlink'
}

let instance: FSWatcher | null = null
let currentRoot: string | null = null
let notify: ((dirs: string[]) => void) | null = null
let notifyFiles: ((events: WatchedFileEvent[]) => void) | null = null
let pendingDirs = new Set<string>()
/** 切快照期间暂停监听：git 批量写盘会制造成百上千事件，恢复后统一重建 */
let suspended: { root: string; onDirs: (dirs: string[]) => void; onFiles?: (events: WatchedFileEvent[]) => void } | null = null
/** 同一文件在一次批量里可能先 add 后 change，按最后一次归并 */
let pendingFiles = new Map<string, WatchedFileEvent['kind']>()
let flushTimer: NodeJS.Timeout | null = null

/**
 * 两个粒度一起报：
 * - 目录粒度给文件树（一次批量 fs 操作只产生一次 UI 刷新）
 * - 文件粒度给元数据索引（分类计数、最近使用、未分类只关心是哪篇变了）
 */
export function startWatching(
  root: string,
  onDirsChanged: (dirs: string[]) => void,
  onFilesChanged?: (events: WatchedFileEvent[]) => void
): void {
  stopWatching()

  currentRoot = root
  notify = onDirsChanged
  notifyFiles = onFilesChanged ?? null
  instance = watch(root, {
    ignoreInitial: true,
    followSymlinks: false,
    depth: 16,
    ignored: (candidate: string) => candidate.split(sep).some((segment) => IGNORED_SEGMENTS.has(segment))
  })

  instance.on('add', (path: string) => queueForPath(path, 'add'))
  instance.on('unlink', (path: string) => queueForPath(path, 'unlink'))
  instance.on('change', (path: string) => queueForPath(path, 'change'))
  instance.on('addDir', (path: string) => queueForPath(path, null))
  instance.on('unlinkDir', (path: string) => queueForPath(path, null))
  instance.on('error', (error) => {
    console.error('[watcher] 监听出错', error)
  })
}

/** 暂时停掉监听（切快照用），恢复时用同一套回调重启 */
export function pauseWatching(): void {
  if (suspended !== null) return
  if (currentRoot !== null && notify !== null) {
    suspended = { root: currentRoot, onDirs: notify, onFiles: notifyFiles ?? undefined }
  }
  stopWatching()
}

export function resumeWatching(): void {
  if (suspended === null) return
  const saved = suspended
  suspended = null
  startWatching(saved.root, saved.onDirs, saved.onFiles)
}

export function stopWatching(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  pendingDirs = new Set()
  pendingFiles = new Map()
  notify = null
  notifyFiles = null
  currentRoot = null

  if (instance !== null) {
    void instance.close()
    instance = null
  }
}

function queueForPath(changedPath: string, kind: WatchedFileEvent['kind'] | null): void {
  if (currentRoot === null) return

  const rel = toPosix(relative(currentRoot, changedPath))
  if (rel === '') return
  if (rel.split('/').some((segment) => IGNORED_SEGMENTS.has(segment))) return

  const parent = dirnamePosix(rel)
  pendingDirs.add(parent === '.' || parent === '/' ? '' : parent)

  if (kind !== null) {
    // 同一次批量里 add 之后再 change 没有意义，保留第一条足够
    if (!pendingFiles.has(rel)) pendingFiles.set(rel, kind)
  }

  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const dirs = [...pendingDirs]
    const files: WatchedFileEvent[] = [...pendingFiles.entries()].map(([relPath, eventKind]) => ({
      relPath,
      kind: eventKind
    }))
    pendingDirs = new Set()
    pendingFiles = new Map()
    if (dirs.length > 0) notify?.(dirs)
    if (files.length > 0) notifyFiles?.(files)
  }, FLUSH_INTERVAL_MS)
}
