import type {
  AppInfo,
  DocMetaEntry,
  DocumentData,
  DocumentWriteResult,
  FileCreateValue,
  FileDiff,
  FileOpResult,
  FileRenameValue,
  HistoryStatus,
  LibraryIndex,
  Locale,
  RewindResult,
  SearchBatch,
  SearchRequest,
  Snapshot,
  SnapshotDetail,
  SnapshotSaveResult,
  TreeNode,
  TrashEntry,
  Vault,
  ThemePreference,
  ViewMode,
  WorkingChange
} from '@freemarkdown/core'

/** 主进程与渲染进程之间的契约版本。任何破坏性变更都要 +1。 */
export const API_VERSION = 1

export const IPC_CHANNELS = {
  ping: 'app:ping',
  appInfo: 'app:info',
  setLocale: 'app:set-locale',
  themeGet: 'app:theme-get',
  themeSet: 'app:theme-set',
  localeChanged: 'app:locale-changed',
  vaultOpen: 'vault:open',
  vaultCurrent: 'vault:current',
  vaultSwitch: 'vault:switch',
  vaultChanged: 'vault:changed',
  treeList: 'tree:list',
  treeOpenExternal: 'tree:open-external',
  treeSetExpanded: 'tree:set-expanded',
  filesCreate: 'files:create',
  filesRename: 'files:rename',
  filesRemove: 'files:remove',
  filesReveal: 'files:reveal',
  treeChanged: 'tree:changed',
  uiGet: 'ui:get',
  uiSet: 'ui:set',
  metaSnapshot: 'meta:snapshot',
  metaSetCategories: 'meta:set-categories',
  metaMarkOpened: 'meta:mark-opened',
  metaChanged: 'meta:changed',
  trashList: 'trash:list',
  trashDelete: 'trash:delete',
  trashRestore: 'trash:restore',
  trashPurge: 'trash:purge',
  docRead: 'doc:read',
  docWrite: 'doc:write',
  docSaveCopy: 'doc:save-copy',
  docSetActive: 'doc:set-active',
  docExternal: 'doc:external',
  searchStart: 'search:start',
  searchCancel: 'search:cancel',
  searchBatch: 'search:batch',
  historyStatus: 'history:status',
  historyList: 'history:list',
  historySave: 'history:save',
  historyDetail: 'history:detail',
  historySnapshotDiff: 'history:snapshot-diff',
  historyChanges: 'history:changes',
  historyWorkingDiff: 'history:working-diff',
  historyRewind: 'history:rewind',
  historyDelete: 'history:delete',
  historyChanged: 'history:changed'
} as const

export interface VaultSnapshot {
  vault: Vault | null
  recent: Vault[]
  expanded: string[]
}

export interface TreeChangedPayload {
  vaultId: string
  /** 需要重新读取的目录（相对路径，根目录为空字符串） */
  dirs: string[]
}

export interface VaultApi {
  /** 弹目录选择框，选定后设为当前库；取消返回 null */
  open(): Promise<Vault | null>
  current(): Promise<VaultSnapshot>
  switchTo(vaultId: string): Promise<Vault | null>
  onChanged(listener: (vault: Vault | null) => void): () => void
}

export interface TreeApi {
  /** 只读一层，懒加载 */
  list(relPath: string): Promise<TreeNode[]>
  /** 交给系统默认程序打开（图片、PDF、代码文件等） */
  openExternal(relPath: string): Promise<void>
  setExpanded(paths: string[]): Promise<void>
  onChanged(listener: (payload: TreeChangedPayload) => void): () => void
}

/** 需要在重启后恢复的界面状态 */
export interface UiState {
  viewMode: ViewMode
  sidebarOpen: boolean
  /** 左栏宽度（px），可鼠标拖拽调整 */
  sidebarWidth: number
  /** 分栏时编辑器占比（0.25–0.75），可拖拽调整 */
  splitRatio: number
  /** 分类区是否展开（默认收起） */
  categoryOpen: boolean
  /** 分类区高度占左栏的比例（0.1–0.4，上限 40%） */
  categoryRatio: number
  /** 搜索态结果栏宽度（300–480，双击回 340） */
  searchWidth: number
}

export interface FilesApi {
  create(input: { dir: string; name: string; kind: 'md' | 'dir' }): Promise<FileOpResult<FileCreateValue>>
  rename(input: { relPath: string; name: string }): Promise<FileOpResult<FileRenameValue>>
  remove(relPath: string): Promise<FileOpResult<TrashEntry>>
  reveal(relPath: string): Promise<void>
}

export interface ThemeApi {
  get(): Promise<ThemePreference>
  set(preference: ThemePreference): Promise<void>
}

export interface UiApi {
  get(): Promise<UiState>
  set(patch: Partial<UiState>): Promise<void>
}

export interface MetaApi {
  /** 分类区所需的全部数据：文件元数据、分类聚合、最近使用、回收站计数 */
  snapshot(): Promise<LibraryIndex>
  /** 只改 frontmatter 的 categories 段，返回更新后的条目 */
  setCategories(relPath: string, categories: string[]): Promise<DocMetaEntry>
  /** 记录“最近使用”，不依赖 mtime */
  markOpened(relPath: string): Promise<void>
  onChanged(listener: (index: LibraryIndex) => void): () => void
}

export interface TrashApi {
  list(): Promise<TrashEntry[]>
  /** 删除（移入应用回收站，不 unlink） */
  remove(relPath: string): Promise<TrashEntry>
  /** 还原；原位置被占用时会自动改名 */
  restore(relPath: string): Promise<{ relPath: string; renamed: boolean }>
  /** 彻底删除：交给系统废纸篓 */
  purge(relPath: string): Promise<void>
}

export interface DocApi {
  /** 读整篇：正文已归一成 LF，hash 是磁盘原文的指纹 */
  read(relPath: string): Promise<DocumentData>
  /** baseHash 与磁盘不一致时返回冲突，不覆盖 */
  write(relPath: string, content: string, baseHash?: string): Promise<DocumentWriteResult>
  /** 另存副本（冲突时用），返回新文件相对路径 */
  saveCopy(relPath: string, content: string): Promise<{ relPath: string }>
  /** 告诉主进程当前打开的文档，只有它的外部改动才广播冲突 */
  setActive(relPath: string | null): Promise<void>
  onExternal(listener: (payload: { relPath: string }) => void): () => void
}

export interface SearchApi {
  /** 开始一次搜索；结果通过 onBatch 流式回来，同 requestId 的旧批次会被渲染层丢弃 */
  start(request: SearchRequest): Promise<void>
  /** 关闭搜索 / 切库时中断当前扫描 */
  cancel(): Promise<void>
  onBatch(listener: (batch: SearchBatch) => void): () => void
}

export interface HistoryChangedPayload {
  reason: 'ready' | 'snapshot' | 'rewind' | 'delete' | 'files'
}

export interface HistoryApi {
  /** git 是否可用、仓库是否已初始化（git 缺失时整块置灰） */
  status(): Promise<HistoryStatus>
  /** 手动快照，最新在前 */
  list(): Promise<Snapshot[]>
  /** 备注可空：留空由主进程生成「快照 · 时间 · N 个文件」 */
  save(remark: string): Promise<SnapshotSaveResult>
  detail(sha: string): Promise<SnapshotDetail>
  snapshotDiff(sha: string, relPath: string): Promise<FileDiff>
  /** 工作区相对最近手动快照（没有则基线）的改动 */
  changes(): Promise<WorkingChange[]>
  workingDiff(relPath: string): Promise<FileDiff>
  /** 切到该快照：先保护当前、目标中不存在的文件进回收站、回收站同路径条目灰显 */
  rewind(sha: string): Promise<RewindResult>
  remove(sha: string): Promise<void>
  onChanged(listener: (payload: HistoryChangedPayload) => void): () => void
}

/** preload 暴露给渲染进程的全部能力。渲染进程拿不到 fs，也拿不到 child_process。 */
export interface FmApi {
  readonly apiVersion: number
  ping(message: string): Promise<string>
  appInfo(): Promise<AppInfo>
  setLocale(locale: Locale): Promise<void>
  theme: ThemeApi
  onLocaleChange(listener: (locale: Locale) => void): () => void
  vault: VaultApi
  tree: TreeApi
  files: FilesApi
  ui: UiApi
  meta: MetaApi
  trash: TrashApi
  doc: DocApi
  search: SearchApi
  history: HistoryApi
}
