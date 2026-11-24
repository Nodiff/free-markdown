import { create } from 'zustand'
import type {
  FileDiff,
  HistoryStatus,
  RewindResult,
  Snapshot,
  SnapshotDetail,
  SnapshotSaveResult,
  WorkingChange
} from '@freemarkdown/core'
import { useDocStore } from './docStore'
import { useMetaStore } from './metaStore'
import { useVaultStore } from './vaultStore'

interface HistoryState {
  status: HistoryStatus | null
  snapshots: Snapshot[]
  changes: WorkingChange[]
  loading: boolean
  busy: boolean
  drawerOpen: boolean
  saveOpen: boolean
  /** 抽屉里展开的那条快照及其文件清单 */
  detail: SnapshotDetail | null
  detailError: string | null
  /** 正在查看的行级差异 */
  diff: FileDiff | null
  diffError: string | null
  error: string | null

  refreshAll(): Promise<void>
  refreshChanges(): Promise<void>
  setDrawerOpen(open: boolean): void
  setSaveOpen(open: boolean): void
  saveSnapshot(remark: string): Promise<SnapshotSaveResult>
  loadDetail(sha: string): Promise<void>
  openSnapshotDiff(sha: string, relPath: string): Promise<void>
  openWorkingDiff(relPath: string): Promise<void>
  closeDiff(): void
  rewind(sha: string): Promise<RewindResult>
  remove(sha: string): Promise<void>
  setError(message: string | null): void
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

let initialized = false

export async function initHistoryStore(): Promise<void> {
  if (initialized) return
  initialized = true

  await useHistoryStore.getState().refreshAll()

  window.fm.history.onChanged((payload) => {
    if (payload.reason === 'rewind') {
      void useDocStore.getState().reloadFromDisk()
      void useMetaStore.getState().refresh()
    }
    void useHistoryStore.getState().refreshAll()
  })

  // 切库：上一库的快照 / 变更都不能留着
  useVaultStore.subscribe((state, previous) => {
    if (state.vault?.id === previous.vault?.id) return
    useHistoryStore.setState({
      snapshots: [],
      changes: [],
      detail: null,
      diff: null,
      saveOpen: false,
      drawerOpen: false
    })
    void useHistoryStore.getState().refreshAll()
  })
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  status: null,
  snapshots: [],
  changes: [],
  loading: false,
  busy: false,
  drawerOpen: false,
  saveOpen: false,
  detail: null,
  detailError: null,
  diff: null,
  diffError: null,
  error: null,

  refreshAll: async () => {
    if (useVaultStore.getState().vault === null) {
      set({ status: null, snapshots: [], changes: [] })
      return
    }
    set({ loading: true })
    try {
      const status = await window.fm.history.status()
      set({ status, busy: status.busy })
      if (!status.ready) {
        set({ snapshots: [], changes: [] })
        return
      }
      const [snapshots, changes] = await Promise.all([
        window.fm.history.list(),
        window.fm.history.changes()
      ])
      set({ snapshots, changes })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ loading: false })
    }
  },

  refreshChanges: async () => {
    if (get().status?.ready !== true) return
    try {
      set({ changes: await window.fm.history.changes() })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  setDrawerOpen: (open) => set({ drawerOpen: open, detail: open ? get().detail : null }),
  setSaveOpen: (open) => set({ saveOpen: open }),

  saveSnapshot: async (remark) => {
    set({ busy: true })
    try {
      const result = await window.fm.history.save(remark)
      if (result.ok) await get().refreshAll()
      return result
    } catch (error) {
      set({ error: messageOf(error) })
      return { ok: false, reason: 'unavailable' }
    } finally {
      set({ busy: false })
    }
  },

  loadDetail: async (sha) => {
    if (get().detail?.snapshot.sha === sha) {
      set({ detail: null })
      return
    }
    set({ detailError: null })
    try {
      const detail = await window.fm.history.detail(sha)
      set({ detail })
    } catch (error) {
      set({ detail: null, detailError: messageOf(error) })
    }
  },

  openSnapshotDiff: async (sha, relPath) => {
    set({ diffError: null })
    try {
      set({ diff: await window.fm.history.snapshotDiff(sha, relPath) })
    } catch (error) {
      set({ diffError: messageOf(error) })
    }
  },

  openWorkingDiff: async (relPath) => {
    set({ diffError: null })
    try {
      set({ diff: await window.fm.history.workingDiff(relPath) })
    } catch (error) {
      set({ diffError: messageOf(error) })
    }
  },

  closeDiff: () => set({ diff: null, diffError: null }),

  rewind: async (sha) => {
    // 先落盘，别让切快照把还没保存的文字当成外部改动
    const doc = useDocStore.getState()
    if (doc.dirty) await doc.save()
    set({ busy: true })
    try {
      const result = await window.fm.history.rewind(sha)
      await useDocStore.getState().reloadFromDisk()
      await get().refreshAll()
      return result
    } finally {
      set({ busy: false })
    }
  },

  remove: async (sha) => {
    set({ busy: true })
    try {
      await window.fm.history.remove(sha)
      if (get().detail?.snapshot.sha === sha) set({ detail: null })
      await get().refreshAll()
    } finally {
      set({ busy: false })
    }
  },

  setError: (message) => set({ error: message })
}))
