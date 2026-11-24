/**
 * 跨进程共享的领域类型。
 * 这个包必须环境无关：不能 import node:*，也不能依赖 DOM。
 */

export type Locale = 'zh-CN' | 'en'

/** 编辑器三种视图状态。预览中编辑（Live Preview）不在范围内。 */
export type ViewMode = 'edit' | 'split' | 'read'

export type FileKind = 'md' | 'dir' | 'other'

export interface Vault {
  /** sha1(realpath)，同时作为 history 仓库的目录名 */
  id: string
  /** realpath 归一后的绝对路径 */
  root: string
  name: string
  lastOpenedAt: number
}

export interface TreeNode {
  /** 相对库根，永远用 posix 分隔符对外暴露 */
  relPath: string
  name: string
  kind: FileKind
  mtimeMs: number
  size: number
}

export type ThemePreference = 'system' | 'light' | 'dark'

export interface AppInfo {
  name: string
  version: string
  apiVersion: number
  locale: Locale
  platform: string
  /** 应用数据目录（配置、时间机器仓库都在这里） */
  userDataPath: string
}

/** 单个 md 的元数据（只缓存元数据，不缓存正文） */
export interface DocMetaEntry {
  relPath: string
  /** frontmatter title → 首个 H1 → 文件名（去扩展名） */
  title: string
  /** 来自 frontmatter 的 categories，渲染层只读 */
  categories: string[]
  mtimeMs: number
  size: number
}

/** 自定义分类的聚合结果 */
export interface CategoryCount {
  name: string
  count: number
}

/** 最近打开记录（相对路径 + 打开时间） */
export interface RecentDoc {
  relPath: string
  openedAt: number
}

/** 左栏分类区需要的全部数据，一次 IPC 拉全 */
export interface LibraryIndex {
  vaultId: string | null
  files: DocMetaEntry[]
  categories: CategoryCount[]
  /** 没有分类的 md 数量 */
  uncategorized: number
  recent: RecentDoc[]
  /** 应用回收站条目数（回收站本身在 M5 落地，这里只给计数） */
  trashCount: number
  /** 首次全量扫描进行中 */
  scanning: boolean
  updatedAt: number
}

export interface TrashEntry {
  /** 删除时的相对路径 */
  relPath: string
  name: string
  deletedAt: number
  /** 在回收站里的实际相对位置（同一路径二次删除时会带后缀） */
  storedPath?: string
  /** 是否是一个目录（整棵树一起还愿） */
  isDir?: boolean
  /** 切换快照时该路径已被目标快照里的版本取代：只保留「彻底删除」（PLAN §5.12） */
  supersededBy?: string
  supersededAt?: number
}

/** 一篇可编辑文档的完整快照（正文已经归一成 LF、BOM 已剥离） */
export interface DocumentData {
  relPath: string
  /** 归一化后的正文：一律 LF，便于 CodeMirror 处理 */
  content: string
  /** 磁盘原文（含 BOM 与原始行尾）的 sha1，用于判断外部改动 */
  hash: string
  mtimeMs: number
  size: number
  /** 保存时要还原的行尾 */
  eol: '\n' | '\r\n'
  /** 保存时要还原的 BOM */
  bom: boolean
}

/** 写盘结果：baseHash 与磁盘不一致时返回冲突，由用户决定怎么办 */
export type DocumentWriteResult =
  | { ok: true; doc: DocumentData }
  | { ok: false; reason: 'conflict'; doc: DocumentData }


export interface Snapshot {
  sha: string
  message: string
  /** 作者时间（毫秒） */
  createdAt: number
  filesChanged: number
  insertions: number
  deletions: number
}

export type SnapshotKind = 'manual' | 'protect'

/** 时间机器可用性（git 缺失时整块置灰，不影响其他功能） */
export interface HistoryStatus {
  available: boolean
  version: string | null
  /** 仓库已初始化、基线已就绪 */
  ready: boolean
  /** 正在执行 git 操作 / 切换快照 */
  busy: boolean
  /** 当前库没有 git 可用时的原因 */
  reason: 'no-vault' | 'no-git' | 'init-failed' | null
}

/** 一次快照里某个文件的改动 */
export interface SnapshotFileChange {
  relPath: string
  status: 'A' | 'M' | 'D' | 'R'
  additions: number
  deletions: number
}

export interface SnapshotDetail {
  snapshot: Snapshot
  files: SnapshotFileChange[]
}

/** 工作区相对最近一次手动快照（没有则基线）的改动 */
export interface WorkingChange extends SnapshotFileChange {}

/** 单文件 diff 内容：旧文本来自快照，新文本来自另一快照或磁盘 */
export interface FileDiff {
  relPath: string
  status: 'A' | 'M' | 'D' | 'R'
  /** 旧文本（新增文件为空串） */
  oldText: string
  /** 新文本（删除文件为空串） */
  newText: string
  /** 二进制文件不尝试渲染行级 diff */
  binary: boolean
  /** 任一侧超过 2MB 时截断 */
  truncated: boolean
}

export interface SnapshotSaveResult {
  ok: boolean
  reason: 'empty' | 'unavailable' | 'busy' | null
  snapshot?: Snapshot
}

export interface RewindResult {
  /** 从目标快照恢复到工作区的文件数 */
  restored: number
  /** 当前存在但目标不存在的文件（已移入应用回收站） */
  trashed: number
  /** 回收站里被目标版本取代的条目数 */
  superseded: number
}


/** 文件管理的可预期错误：IPC 不抛裸异常，界面按 code 出双语文案 */
export type FileOpErrorCode = 'exists' | 'invalid-name' | 'not-found' | 'permission' | 'unsupported'

export interface FileOpFailure {
  ok: false
  code: FileOpErrorCode
  message: string
}

export interface FileCreateValue {
  relPath: string
  kind: 'md' | 'dir'
}

export interface FileRenameValue {
  relPath: string
  oldRelPath: string
}

export type FileOpResult<T> = { ok: true; value: T } | FileOpFailure
