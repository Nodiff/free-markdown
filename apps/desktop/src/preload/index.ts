import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  ThemePreference,
  DocMetaEntry,
  DocumentData,
  DocumentWriteResult,
  FileDiff,
  HistoryStatus,
  LibraryIndex,
  Locale,
  SearchBatch,
  RewindResult,
  SearchRequest,
  Snapshot,
  SnapshotDetail,
  SnapshotSaveResult,
  TreeNode,
  TrashEntry,
  Vault,
  WorkingChange
} from '@freemarkdown/core'
import {
  API_VERSION,
  IPC_CHANNELS,
  type DocApi,
  type FilesApi,
  type FmApi,
  type HistoryApi,
  type HistoryChangedPayload,
  type MetaApi,
  type SearchApi,
  type ThemeApi,
  type TreeApi,
  type TreeChangedPayload,
  type TrashApi,
  type UiApi,
  type UiState,
  type VaultApi,
  type VaultSnapshot
} from '../shared/ipc'

/**
 * 唯一的进程间桥。这里只做转发，不做业务：
 * 任何文件操作都在主进程完成，渲染进程永远拿不到 fs。
 */
const vault: VaultApi = {
  open: () => ipcRenderer.invoke(IPC_CHANNELS.vaultOpen) as Promise<Vault | null>,
  current: () => ipcRenderer.invoke(IPC_CHANNELS.vaultCurrent) as Promise<VaultSnapshot>,
  switchTo: (vaultId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.vaultSwitch, vaultId) as Promise<Vault | null>,
  onChanged: (listener: (vault: Vault | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, next: Vault | null): void => {
      listener(next)
    }
    ipcRenderer.on(IPC_CHANNELS.vaultChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.vaultChanged, handler)
    }
  }
}

const tree: TreeApi = {
  list: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.treeList, relPath) as Promise<TreeNode[]>,
  openExternal: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.treeOpenExternal, relPath) as Promise<void>,
  setExpanded: (paths: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.treeSetExpanded, paths) as Promise<void>,
  onChanged: (listener: (payload: TreeChangedPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TreeChangedPayload): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.treeChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.treeChanged, handler)
    }
  }
}

const files: FilesApi = {
  create: (input) => ipcRenderer.invoke(IPC_CHANNELS.filesCreate, input) as Promise<import('@freemarkdown/core').FileOpResult<import('@freemarkdown/core').FileCreateValue>>,
  rename: (input) => ipcRenderer.invoke(IPC_CHANNELS.filesRename, input) as Promise<import('@freemarkdown/core').FileOpResult<import('@freemarkdown/core').FileRenameValue>>,
  remove: (relPath) => ipcRenderer.invoke(IPC_CHANNELS.filesRemove, relPath) as Promise<import('@freemarkdown/core').FileOpResult<TrashEntry>>,
  reveal: (relPath) => ipcRenderer.invoke(IPC_CHANNELS.filesReveal, relPath) as Promise<void>
}

const theme: ThemeApi = {
  get: () => ipcRenderer.invoke(IPC_CHANNELS.themeGet) as Promise<ThemePreference>,
  set: (preference: ThemePreference) => ipcRenderer.invoke(IPC_CHANNELS.themeSet, preference) as Promise<void>
}

const ui: UiApi = {
  get: () => ipcRenderer.invoke(IPC_CHANNELS.uiGet) as Promise<UiState>,
  set: (patch: Partial<UiState>) =>
    ipcRenderer.invoke(IPC_CHANNELS.uiSet, patch) as Promise<void>
}

const meta: MetaApi = {
  snapshot: () => ipcRenderer.invoke(IPC_CHANNELS.metaSnapshot) as Promise<LibraryIndex>,
  setCategories: (relPath: string, categories: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.metaSetCategories, relPath, categories) as Promise<DocMetaEntry>,
  markOpened: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.metaMarkOpened, relPath) as Promise<void>,
  onChanged: (listener: (index: LibraryIndex) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, index: LibraryIndex): void => {
      listener(index)
    }
    ipcRenderer.on(IPC_CHANNELS.metaChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.metaChanged, handler)
    }
  }
}

const trash: TrashApi = {
  list: () => ipcRenderer.invoke(IPC_CHANNELS.trashList) as Promise<TrashEntry[]>,
  remove: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.trashDelete, relPath) as Promise<TrashEntry>,
  restore: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.trashRestore, relPath) as Promise<{ relPath: string; renamed: boolean }>,
  purge: (relPath: string) => ipcRenderer.invoke(IPC_CHANNELS.trashPurge, relPath) as Promise<void>
}

const doc: DocApi = {
  read: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.docRead, relPath) as Promise<DocumentData>,
  write: (relPath: string, content: string, baseHash?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.docWrite, relPath, content, baseHash) as Promise<DocumentWriteResult>,
  saveCopy: (relPath: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.docSaveCopy, relPath, content) as Promise<{ relPath: string }>,
  setActive: (relPath: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.docSetActive, relPath) as Promise<void>,
  onExternal: (listener: (payload: { relPath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { relPath: string }): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.docExternal, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.docExternal, handler)
    }
  }
}

const search: SearchApi = {
  start: (request: SearchRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.searchStart, request) as Promise<void>,
  cancel: () => ipcRenderer.invoke(IPC_CHANNELS.searchCancel) as Promise<void>,
  onBatch: (listener: (batch: SearchBatch) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, batch: SearchBatch): void => {
      listener(batch)
    }
    ipcRenderer.on(IPC_CHANNELS.searchBatch, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.searchBatch, handler)
    }
  }
}

const history: HistoryApi = {
  status: () => ipcRenderer.invoke(IPC_CHANNELS.historyStatus) as Promise<HistoryStatus>,
  list: () => ipcRenderer.invoke(IPC_CHANNELS.historyList) as Promise<Snapshot[]>,
  save: (remark: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.historySave, remark) as Promise<SnapshotSaveResult>,
  detail: (sha: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.historyDetail, sha) as Promise<SnapshotDetail>,
  snapshotDiff: (sha: string, relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.historySnapshotDiff, sha, relPath) as Promise<FileDiff>,
  changes: () => ipcRenderer.invoke(IPC_CHANNELS.historyChanges) as Promise<WorkingChange[]>,
  workingDiff: (relPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.historyWorkingDiff, relPath) as Promise<FileDiff>,
  rewind: (sha: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.historyRewind, sha) as Promise<RewindResult>,
  remove: (sha: string) => ipcRenderer.invoke(IPC_CHANNELS.historyDelete, sha) as Promise<void>,
  onChanged: (listener: (payload: HistoryChangedPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: HistoryChangedPayload): void => {
      listener(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.historyChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.historyChanged, handler)
    }
  }
}

const api: FmApi = {
  apiVersion: API_VERSION,
  ping: (message: string) => ipcRenderer.invoke(IPC_CHANNELS.ping, message) as Promise<string>,
  appInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appInfo) as Promise<AppInfo>,
  theme,
  setLocale: (locale: Locale) => ipcRenderer.invoke(IPC_CHANNELS.setLocale, locale) as Promise<void>,
  onLocaleChange: (listener: (locale: Locale) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, locale: Locale): void => {
      listener(locale)
    }
    ipcRenderer.on(IPC_CHANNELS.localeChanged, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.localeChanged, handler)
    }
  },
  vault,
  tree,
  files,
  ui,
  meta,
  trash,
  doc,
  search,
  history
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('fm', api)
  } catch (error) {
    console.error('[preload] 暴露 API 失败', error)
  }
} else {
  // 只在关闭 contextIsolation 的调试场景下兜底，正常构建不会走到这里
  ;(globalThis as unknown as Record<string, unknown>)['fm'] = api
}
