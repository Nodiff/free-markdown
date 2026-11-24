import { create } from 'zustand'
import type { DocumentData } from '@freemarkdown/core'
import { useMetaStore } from './metaStore'
import { useVaultStore } from './vaultStore'

/** 输入静止多久落盘（PLAN §5.4） */
const AUTOSAVE_MS = 800

export interface DocConflict {
  disk: DocumentData
}

export type ConflictChoice = 'mine' | 'disk' | 'copy'

interface DocState {
  relPath: string | null
  content: string
  /** 最后一次成功落盘的内容，dirty = content !== savedContent */
  savedContent: string
  hash: string | null
  mtimeMs: number
  eol: '\n' | '\r\n'
  bom: boolean
  dirty: boolean
  saving: boolean
  loading: boolean
  savedAt: number | null
  /** 外部内容被替换时 +1，编辑器据此保留光标位置后重设正文 */
  reloadToken: number
  conflict: DocConflict | null
  error: string | null

  open(relPath: string | null): Promise<void>
  updateContent(text: string): void
  save(options?: { force?: boolean }): Promise<void>
  handleExternal(relPath: string): Promise<void>
  /** 切快照后工作区被整体替换：强制按磁盘重读当前文档（文件没了就关掉） */
  reloadFromDisk(): Promise<void>
  resolveConflict(choice: ConflictChoice): Promise<void>
  deleteDoc(): Promise<void>
  /** 文件被重命名后，只改路径，不重读正文（editor 状态与撤销历史保持） */
  retargetPath(relPath: string): void
  /** 所在目录被删除后，干净地回到空编辑器 */
  clearIfUnder(relPath: string, isDir: boolean): void
  setError(message: string | null): void
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function clearAutosave(): void {
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
}

const initialState = {
  relPath: null as string | null,
  content: '',
  savedContent: '',
  hash: null as string | null,
  mtimeMs: 0,
  eol: '\n' as '\n' | '\r\n',
  bom: false,
  dirty: false,
  saving: false,
  loading: false,
  savedAt: null as number | null,
  reloadToken: 0,
  conflict: null as DocConflict | null,
  error: null as string | null
}

export const useDocStore = create<DocState>((set, get) => ({
  ...initialState,

  open: async (relPath) => {
    const current = get()
    if (current.relPath === relPath && relPath !== null) return

    // 切走之前先把未保存的内容落盘，绝不因为切文档丢字
    if (current.relPath !== null && current.dirty) await current.save()
    clearAutosave()

    if (relPath === null) {
      set({ ...initialState })
      void window.fm.doc.setActive(null)
      return
    }

    set({ ...initialState, relPath, loading: true })
    try {
      const doc = await window.fm.doc.read(relPath)
      set({
        relPath: doc.relPath,
        content: doc.content,
        savedContent: doc.content,
        hash: doc.hash,
        mtimeMs: doc.mtimeMs,
        eol: doc.eol,
        bom: doc.bom,
        dirty: false,
        loading: false,
        savedAt: Date.now(),
        reloadToken: get().reloadToken + 1
      })
      await window.fm.doc.setActive(doc.relPath)
    } catch (error) {
      set({ loading: false, error: messageOf(error) })
    }
  },

  updateContent: (text) => {
    const state = get()
    if (state.relPath === null) return
    set({ content: text, dirty: text !== state.savedContent })
    clearAutosave()
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null
      void get().save()
    }, AUTOSAVE_MS)
  },

  save: async (options) => {
    const state = get()
    if (state.relPath === null || state.saving) return
    if (!state.dirty && options?.force !== true) return

    clearAutosave()
    const snapshot = state.content
    set({ saving: true })

    try {
      // force = 用户已选择「保留我的」，不再用 baseHash 拦
      const result = await window.fm.doc.write(
        state.relPath,
        snapshot,
        options?.force === true ? undefined : (state.hash ?? undefined)
      )

      if (!result.ok) {
        set({ saving: false, conflict: { disk: result.doc } })
        return
      }

      const latest = get()
      set({
        saving: false,
        hash: result.doc.hash,
        mtimeMs: result.doc.mtimeMs,
        eol: result.doc.eol,
        bom: result.doc.bom,
        savedContent: snapshot,
        dirty: latest.content !== snapshot,
        savedAt: Date.now(),
        conflict: null,
        error: null
      })
    } catch (error) {
      set({ saving: false, error: messageOf(error) })
    }
  },

  handleExternal: async (relPath) => {
    const state = get()
    if (state.relPath !== relPath) return

    try {
      const disk = await window.fm.doc.read(relPath)
      if (state.hash !== null && disk.hash === state.hash) return

      if (state.dirty) {
        set({ conflict: { disk } })
        return
      }

      // 没有脏改动就静默重载，正文与 hash 一起更新
      set({
        content: disk.content,
        savedContent: disk.content,
        hash: disk.hash,
        mtimeMs: disk.mtimeMs,
        eol: disk.eol,
        bom: disk.bom,
        dirty: false,
        savedAt: Date.now(),
        reloadToken: state.reloadToken + 1
      })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  reloadFromDisk: async () => {
    const state = get()
    if (state.relPath === null) return
    clearAutosave()
    try {
      const disk = await window.fm.doc.read(state.relPath)
      set({
        content: disk.content,
        savedContent: disk.content,
        hash: disk.hash,
        mtimeMs: disk.mtimeMs,
        eol: disk.eol,
        bom: disk.bom,
        dirty: false,
        loading: false,
        savedAt: Date.now(),
        reloadToken: state.reloadToken + 1
      })
      await window.fm.doc.setActive(disk.relPath)
    } catch {
      // 目标快照里没有这篇文档：干净地回到空态，别把旧正文留在编辑器里
      set({ ...initialState })
      void window.fm.doc.setActive(null)
      useVaultStore.getState().setActive(null)
    }
  },

  resolveConflict: async (choice) => {
    const state = get()
    const conflict = state.conflict
    if (conflict === null || state.relPath === null) return

    if (choice === 'disk') {
      set({
        content: conflict.disk.content,
        savedContent: conflict.disk.content,
        hash: conflict.disk.hash,
        mtimeMs: conflict.disk.mtimeMs,
        eol: conflict.disk.eol,
        bom: conflict.disk.bom,
        dirty: false,
        conflict: null,
        savedAt: Date.now(),
        reloadToken: state.reloadToken + 1
      })
      return
    }

    if (choice === 'copy') {
      try {
        await window.fm.doc.saveCopy(state.relPath, state.content)
        // 副本已落盘，编辑器回到磁盘上的外部版本
        await get().resolveConflict('disk')
        await useMetaStore.getState().refresh()
      } catch (error) {
        set({ error: messageOf(error) })
      }
      return
    }

    set({ conflict: null })
    await get().save({ force: true })
  },

  retargetPath: (relPath) => {
    const state = get()
    if (state.relPath === null || state.relPath === relPath) return
    set({ relPath })
    useVaultStore.getState().setActive(relPath)
    void window.fm.doc.setActive(relPath)
  },

  clearIfUnder: (relPath, isDir) => {
    const state = get()
    if (state.relPath === null) return
    const hit = state.relPath === relPath || (isDir && state.relPath.startsWith(`${relPath}/`))
    if (!hit) return
    clearAutosave()
    set({ ...initialState })
    useVaultStore.getState().setActive(null)
    void window.fm.doc.setActive(null)
  },

  deleteDoc: async () => {
    const state = get()
    if (state.relPath === null) return
    clearAutosave()
    try {
      await window.fm.trash.remove(state.relPath)
      set({ ...initialState })
      void window.fm.doc.setActive(null)
      useVaultStore.getState().setActive(null)
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  setError: (message) => {
    set({ error: message })
  }
}))

let initialized = false

export async function initDocStore(): Promise<void> {
  if (initialized) return
  initialized = true

  // 当前文档由 vaultStore.activePath 驱动：树、分类列表、最近使用都走同一条路径
  useVaultStore.subscribe((state, previous) => {
    if (state.activePath !== previous.activePath) {
      void useDocStore.getState().open(state.activePath)
    }
  })

  window.fm.doc.onExternal(({ relPath }) => {
    void useDocStore.getState().handleExternal(relPath)
  })

  await useDocStore.getState().open(useVaultStore.getState().activePath)
}

/** 失焦即落盘：切窗口、点系统菜单都不至于丢最后 800ms 的输入 */
export function flushAutosave(): void {
  const state = useDocStore.getState()
  if (state.dirty) void state.save()
}
