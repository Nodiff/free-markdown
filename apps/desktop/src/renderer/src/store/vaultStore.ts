import { create } from 'zustand'
import type { TreeNode, Vault } from '@freemarkdown/core'

export interface PendingCreate {
  dir: string
  kind: 'md' | 'dir'
}

interface VaultState {
  vault: Vault | null
  recent: Vault[]
  /** 已展开的目录相对路径 */
  expanded: Set<string>
  /** 目录相对路径 → 直接子项；空字符串代表库根 */
  children: Record<string, TreeNode[]>
  activePath: string | null
  /** 左栏显式选中项，可与“当前打开文档”不同 */
  selectedPath: string | null
  selectedKind: 'dir' | 'md' | 'other' | null
  pendingCreate: PendingCreate | null
  renamingPath: string | null
  error: string | null

  applySnapshot(vault: Vault | null, expanded: string[]): Promise<void>
  toggleDir(relPath: string): Promise<void>
  setActive(relPath: string | null): void
  select(relPath: string | null, kind: 'dir' | 'md' | 'other' | null): void
  startCreate(kind: 'md' | 'dir', dir?: string): Promise<void>
  cancelCreate(): void
  startRename(relPath?: string | null): void
  cancelRename(): void
  expandDir(relPath: string): Promise<void>
  applyRename(oldRelPath: string, newRelPath: string, isDir: boolean): void
  applyDelete(relPath: string, isDir: boolean): void
  openExternal(relPath: string): Promise<void>
  reloadDirs(dirs: string[]): Promise<void>
  setError(message: string | null): void
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vault: null,
  recent: [],
  expanded: new Set<string>(),
  children: {},
  activePath: null,
  selectedPath: null,
  selectedKind: null,
  pendingCreate: null,
  renamingPath: null,
  error: null,

  applySnapshot: async (vault, expanded) => {
    if (vault === null) {
      set({
        vault: null,
        expanded: new Set<string>(),
        children: {},
        activePath: null,
        selectedPath: null,
        selectedKind: null,
        pendingCreate: null,
        renamingPath: null,
        error: null
      })
      return
    }

    const sameVault = get().vault?.id === vault.id
    if (sameVault) {
      // 同一个库重复快照：只更新元信息，别把树重建成空的（否则会打断用户正在看的位置）
      set({ vault })
      if (get().children[''] !== undefined) return
    }

    // 同一个库但树还没加载成功过：保留用户已有的展开状态，重新拉一遍
    const nextExpanded = sameVault ? get().expanded : new Set(expanded)
    set({ vault, expanded: nextExpanded, children: {}, activePath: null, error: null })

    try {
      const root = await window.fm.tree.list('')
      set((state) => ({ children: { ...state.children, '': root } }))
    } catch (error) {
      set({ error: messageOf(error) })
      return
    }

    // 恢复上次展开的目录（只恢复确实还存在且能读到的）
    for (const dir of [...nextExpanded]) {
      try {
        const entries = await window.fm.tree.list(dir)
        set((state) => ({ children: { ...state.children, [dir]: entries } }))
      } catch {
        set((state) => {
          const kept = new Set(state.expanded)
          kept.delete(dir)
          return { expanded: kept }
        })
      }
    }
  },

  toggleDir: async (relPath) => {
    const state = get()
    const expanded = new Set(state.expanded)

    if (expanded.has(relPath)) {
      expanded.delete(relPath)
      set({ expanded })
      void persistExpanded(expanded)
      return
    }

    if (state.children[relPath] === undefined) {
      try {
        const entries = await window.fm.tree.list(relPath)
        set((current) => ({ children: { ...current.children, [relPath]: entries } }))
      } catch (error) {
        set({ error: messageOf(error) })
        return
      }
    }

    expanded.add(relPath)
    set({ expanded })
    void persistExpanded(expanded)
  },

  setActive: (relPath) => {
    set({ activePath: relPath, selectedPath: relPath, selectedKind: relPath === null ? null : get().selectedKind })
  },

  select: (relPath, kind) => {
    set({ selectedPath: relPath, selectedKind: kind })
  },

  startCreate: async (kind, explicitDir) => {
    const state = get()
    let dir = explicitDir ?? ''
    if (explicitDir === undefined) {
      if (state.selectedPath !== null) {
        dir = state.selectedKind === 'dir' ? state.selectedPath : parentDir(state.selectedPath)
      } else if (state.activePath !== null) {
        dir = parentDir(state.activePath)
      }
    }

    if (dir !== '' && state.children[dir] === undefined) {
      try {
        const entries = await window.fm.tree.list(dir)
        set((current) => ({ children: { ...current.children, [dir]: entries } }))
      } catch (error) {
        set({ error: messageOf(error) })
        return
      }
    }

    if (dir !== '') {
      const expanded = new Set(get().expanded)
      expanded.add(dir)
      set({ expanded })
      void persistExpanded(expanded)
    }
    set({ pendingCreate: { dir, kind }, renamingPath: null })
  },

  cancelCreate: () => set({ pendingCreate: null }),

  startRename: (relPath) => {
    const target = relPath ?? get().selectedPath ?? get().activePath
    if (target === null) return
    set({ renamingPath: target, pendingCreate: null })
  },

  cancelRename: () => set({ renamingPath: null }),

  expandDir: async (relPath) => {
    if (relPath === '') return
    if (get().children[relPath] === undefined) {
      try {
        const entries = await window.fm.tree.list(relPath)
        set((current) => ({ children: { ...current.children, [relPath]: entries } }))
      } catch (error) {
        set({ error: messageOf(error) })
        return
      }
    }
    const expanded = new Set(get().expanded)
    expanded.add(relPath)
    set({ expanded })
    void persistExpanded(expanded)
  },

  applyRename: (oldRelPath, newRelPath, isDir) => {
    const state = get()
    const prefix = oldRelPath + '/'
    const nextExpanded = new Set<string>()
    for (const path of state.expanded) {
      if (!isDir) nextExpanded.add(path)
      else if (path === oldRelPath) nextExpanded.add(newRelPath)
      else if (path.startsWith(prefix)) nextExpanded.add(newRelPath + path.slice(oldRelPath.length))
      else nextExpanded.add(path)
    }
    const nextChildren = { ...state.children }
    if (isDir) {
      for (const key of Object.keys(nextChildren)) {
        if (key === oldRelPath || key.startsWith(prefix)) delete nextChildren[key]
      }
    }
    const selectedPath = state.selectedPath === oldRelPath
      ? newRelPath
      : state.selectedPath?.startsWith(prefix)
        ? newRelPath + state.selectedPath.slice(oldRelPath.length)
        : state.selectedPath
    set({ expanded: nextExpanded, children: nextChildren, selectedPath, renamingPath: null })
    void persistExpanded(nextExpanded)
  },

  applyDelete: (relPath, isDir) => {
    const state = get()
    const prefix = relPath + '/'
    const nextExpanded = new Set<string>()
    for (const path of state.expanded) {
      if (path === relPath || (isDir && path.startsWith(prefix))) continue
      nextExpanded.add(path)
    }
    const nextChildren = { ...state.children }
    for (const key of Object.keys(nextChildren)) {
      if (key === relPath || (isDir && key.startsWith(prefix))) delete nextChildren[key]
    }
    const selectedPath = state.selectedPath === relPath || (isDir && state.selectedPath?.startsWith(prefix))
      ? null
      : state.selectedPath
    const selectedKind = selectedPath === null ? null : state.selectedKind
    set({ expanded: nextExpanded, children: nextChildren, selectedPath, selectedKind })
    void persistExpanded(nextExpanded)
  },

  openExternal: async (relPath) => {
    try {
      await window.fm.tree.openExternal(relPath)
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  reloadDirs: async (dirs) => {
    const state = get()
    if (state.vault === null) return

    for (const dir of dirs) {
      // 只刷新已经加载过的目录；没展开过的等用户展开时再读
      if (dir !== '' && state.children[dir] === undefined) continue
      const entries = await readDirWithRetry(dir)
      if (entries === null) {
        // 读失败（多半是目录刚被删掉）：保留旧快照总比把整棵树清空好，等下一次事件再纠正
        continue
      }
      set((current) => ({ children: { ...current.children, [dir]: entries } }))
    }
  },

  setError: (message) => {
    set({ error: message })
  }
}))

function parentDir(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash < 0 ? '' : relPath.slice(0, slash)
}

function persistExpanded(expanded: Set<string>): Promise<void> {
  return window.fm.tree.setExpanded([...expanded])
}

/**
 * 目录读取加一次重试：文件监听事件与目录写入常在毫秒级上抢跑，
 * 单次失败多半是瞬时的，读失败就整块折叠掉是最差的用户体验。
 */
async function readDirWithRetry(dir: string): Promise<TreeNode[] | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await window.fm.tree.list(dir)
    } catch (error) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        continue
      }
      console.warn('[vault] 目录读取失败', dir, error)
    }
  }
  return null
}

let initialized = false

/**
 * 只初始化一次：订阅主进程事件 + 恢复上次的库。
 * StrictMode 下 effect 会执行两次，这里用模块级标记兜住。
 */
export async function initVaultStore(): Promise<void> {
  if (initialized) return
  initialized = true

  window.fm.vault.onChanged((vault) => {
    void (async () => {
      const snapshot = await window.fm.vault.current()
      useVaultStore.setState({ recent: snapshot.recent })
      await useVaultStore.getState().applySnapshot(vault, snapshot.expanded)
    })()
  })

  window.fm.tree.onChanged(({ dirs }) => {
    void useVaultStore.getState().reloadDirs(dirs)
  })

  const snapshot = await window.fm.vault.current()
  useVaultStore.setState({ recent: snapshot.recent })
  await useVaultStore.getState().applySnapshot(snapshot.vault, snapshot.expanded)
}

export async function openVault(): Promise<void> {
  try {
    const vault = await window.fm.vault.open()
    if (vault === null) return
    const snapshot = await window.fm.vault.current()
    useVaultStore.setState({ recent: snapshot.recent })
    await useVaultStore.getState().applySnapshot(vault, snapshot.expanded)
  } catch (error) {
    useVaultStore.getState().setError(messageOf(error))
  }
}

export async function switchVault(vaultId: string): Promise<void> {
  try {
    const vault = await window.fm.vault.switchTo(vaultId)
    if (vault === null) return
    const snapshot = await window.fm.vault.current()
    useVaultStore.setState({ recent: snapshot.recent })
    await useVaultStore.getState().applySnapshot(vault, snapshot.expanded)
  } catch (error) {
    useVaultStore.getState().setError(messageOf(error))
  }
}
