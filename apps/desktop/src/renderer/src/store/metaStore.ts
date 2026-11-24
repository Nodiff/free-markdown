import { create } from 'zustand'
import type { LibraryIndex, TrashEntry } from '@freemarkdown/core'
import { useVaultStore } from './vaultStore'

/** 左栏文件区当前展示的内容：整棵树，还是某个内置视图 / 分类 */
export type ViewSelection =
  | { kind: 'tree' }
  | { kind: 'recent' }
  | { kind: 'uncategorized' }
  | { kind: 'trash' }
  | { kind: 'category'; name: string }

interface MetaState {
  index: LibraryIndex
  trash: TrashEntry[]
  view: ViewSelection
  error: string | null

  setView(view: ViewSelection): void
  refresh(): Promise<void>
  loadTrash(): Promise<void>
  /** 直接覆盖某篇文档的分类 */
  setCategories(relPath: string, categories: string[]): Promise<void>
  /** 勾选 / 取消一个分类 */
  toggleCategory(relPath: string, name: string): Promise<void>
  /** 打开文档：记“最近使用” + 设为当前文档 */
  openDoc(relPath: string): void
  /** 回收站：还原（同名时自动改名） */
  restoreTrash(relPath: string): Promise<void>
  /** 回收站：彻底删除（交给系统废纸篓） */
  purgeTrash(relPath: string): Promise<void>
  setError(message: string | null): void
}

const emptyIndex: LibraryIndex = {
  vaultId: null,
  files: [],
  categories: [],
  uncategorized: 0,
  recent: [],
  trashCount: 0,
  scanning: false,
  updatedAt: 0
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export const useMetaStore = create<MetaState>((set, get) => ({
  index: emptyIndex,
  trash: [],
  view: { kind: 'tree' },
  error: null,

  setView: (view) => {
    set({ view })
    if (view.kind === 'trash') void get().loadTrash()
  },

  refresh: async () => {
    try {
      const index = await window.fm.meta.snapshot()
      set({ index })
      if (get().view.kind === 'trash') await get().loadTrash()
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  loadTrash: async () => {
    try {
      set({ trash: await window.fm.trash.list() })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  setCategories: async (relPath, categories) => {
    try {
      await window.fm.meta.setCategories(relPath, categories)
      set({ error: null })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  toggleCategory: async (relPath, name) => {
    const state = get()
    const entry = state.index.files.find((item) => item.relPath === relPath)
    if (entry === undefined) return
    const has = entry.categories.some((item) => item.toLowerCase() === name.toLowerCase())
    const next = has
      ? entry.categories.filter((item) => item.toLowerCase() !== name.toLowerCase())
      : [...entry.categories, name]
    // 乐观更新：点一下立即变色，写盘失败再靠 meta:changed 纠正
    set((current) => ({
      index: {
        ...current.index,
        files: current.index.files.map((item) =>
          item.relPath === relPath ? { ...item, categories: next } : item
        )
      }
    }))
    await get().setCategories(relPath, next)
  },

  openDoc: (relPath) => {
    useVaultStore.getState().setActive(relPath)
    void window.fm.meta.markOpened(relPath)
  },

  restoreTrash: async (relPath) => {
    try {
      await window.fm.trash.restore(relPath)
      await get().loadTrash()
      await get().refresh()
      set({ error: null })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  purgeTrash: async (relPath) => {
    try {
      await window.fm.trash.purge(relPath)
      await get().loadTrash()
      await get().refresh()
      set({ error: null })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  setError: (message) => {
    set({ error: message })
  }
}))

let initialized = false

/** 只初始化一次：订阅索引推送 + 拉首屏；切库时把视图退回文件树 */
export async function initMetaStore(): Promise<void> {
  if (initialized) return
  initialized = true

  window.fm.meta.onChanged((index) => {
    useMetaStore.setState({ index })
    if (useMetaStore.getState().view.kind === 'trash') void useMetaStore.getState().loadTrash()
  })

  window.fm.vault.onChanged(() => {
    useMetaStore.setState({ view: { kind: 'tree' } })
  })

  await useMetaStore.getState().refresh()
}
