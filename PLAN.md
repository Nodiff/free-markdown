# Markdown 编辑器与管理应用 · 实施方案

> 版本 v1｜2026-11-20
> 产品名：**FreeMarkdown**（中文名：**飞码**）｜许可证 **MIT**｜界面语言：**中文（默认）+ English**，v1 即国际化
> 定位：自用的本地 Markdown 工作台。库目录是唯一真相，应用不拥有任何状态。

---

## 0. 一句话概括

Electron 桌面应用；左树映射硬盘目录；CodeMirror 6 编辑 + 增量渲染预览；时间机器用**独立 git 仓库**（双 ref 链）实现快照与回溯；导出 HTML/PDF/Word 走纯 JS 管线。

---

## 1. 范围

### v1 做什么（M0–M6）

| 模块 | 内容 |
|---|---|
| 库管理 | 单根目录、可切换、最近打开列表、状态存 `userData`，库内零痕迹 |
| 界面 | 无顶栏：左栏（库名/文件树/分类区/文档变更/底部设置）+ 内容区列头；左栏可折叠（§5.10） |
| 文件树 | 映射磁盘真实目录，懒加载，监听外部变更 |
| 分类 | 文档可归入多个分类，写在 md 的 frontmatter（§5.11）；侧栏分类区含最近使用/未分类/回收站 + 自定义分类 |
| 搜索 | 三栏模式：结果栏逐行命中 + 高亮 + 跳行（§5.3），子串匹配，不建索引 |
| 编辑 | CodeMirror 6，三态：纯编辑 / 左右分栏实时预览 / 只读查看 |
| 预览 | GFM（表格、任务列表、脚注、删除线）+ KaTeX 数学/化学 + mermaid（流程图/时序图/思维导图/gantt） |
| 保存 | 自动保存 800ms + `Cmd/Ctrl+S`，原子写盘，CRLF/BOM 原样保留 |
| 冲突 | 外部改动检测，脏数据时三选弹窗 |
| 回收站 | 两段式：删除进应用回收站（可还原）→ 彻底删除才进系统废纸篓（§5.12） |
| 时间机器 | 手动快照、列表、变更详情、切换、删除、未提交 diff；自动保护快照独立隐藏 |
| 文档变更 | 侧栏区块，列出相对最近快照的改动 + 行级 diff（M5 起，§5.13） |
| 打包 | mac-x64 / mac-arm64 / win-x64 三个独立脚本，各自平台原生构建 |

### v1 明确不做

- 预览中编辑（Obsidian Live Preview）—— 成本过高，已砍
- 化学键线式结构式（chemfig 类）
- `[[wiki 双链]]`、`> [!callout]`、`==高亮==`
- 重命名时自动改写引用（只做引用数量提示）
- 多根工作区、云同步、插件系统
- PDF 书签
- 导出（放 v2）

---

## 2. 技术栈与「无原生模块」纪律

### 硬性纪律

**依赖清单里不允许出现原生模块（native module）。**
这条决定了两件事：在 Intel Mac 上可直接交叉产出 arm64 包；三个平台的构建都不需要 electron-rebuild。

因此以下选型被排除：

| 常见方案 | 为什么不用 | 替代 |
|---|---|---|
| `@parcel/watcher` | 原生模块，架构绑定 | `chokidar`（纯 JS） |
| `better-sqlite3` | 原生模块 | 内存子串扫描（不建索引） |
| `pandoc` 二进制 | 三平台各一份 30MB，macOS 需签名 | `docx`（纯 JS） |
| headless chrome | 重量级 | Electron `webContents.printToPDF` |
| `isomorphic-git` | 纯 JS 但全量 sha1 扫描，几千文件每次 1–3s | 系统 `git` 命令（spawn） |
| `markdown-it` + `innerHTML` | 每次全量替换 → 图片闪烁、滚动丢失 | `unified` + hast → React 元素 |
| ProseMirror / TipTap | md 往返序列化丢格式 | CodeMirror 6（源码即真相） |
| Monaco | 体积大、md 支持是二等公民 | CodeMirror 6 |
| lunr / MiniSearch 全文索引 | 中文默认不分词，需自建 2-gram | 子串扫描（中文天然正确） |

### 依赖清单

**构建 / 运行时**

```
electron
electron-vite
electron-builder
react  react-dom
typescript
zustand                    # 轻量状态
```

**编辑器**

```
@codemirror/state  @codemirror/view  @codemirror/commands
@codemirror/language  @codemirror/lang-markdown  @codemirror/language-data
```

**渲染管线**

```
unified  remark-parse  remark-gfm  remark-frontmatter  remark-math  remark-rehype
rehype-katex  rehype-raw  hast-util-to-jsx-runtime  unist-util-visit
katex                      # 含 mhchem 扩展，支持 \ce{}
mermaid
dompurify                  # 清洗内联 HTML
```

**文件与工具**

```
chokidar                   # 文件监听
gray-matter                # frontmatter 解析
```

**导出（v2）**

```
docx                       # 纯 JS Word 生成
```

> 版本一律以 lockfile 为准，初始化时锁定，不手写死版本号。

### 运行时依赖：装到非开发机器上能不能用

| 能力 | 外部依赖 | 说明 |
|---|---|---|
| 安装与启动 | 无 | Electron 自带 Chromium + Node，目标机不需要装 Node / npm |
| 库管理、文件树、编辑、预览、搜索 | 无 | 全部在应用内部 |
| 导出 HTML / PDF / Word | 无 | 纯 JS 管线 + 内置 Chromium 打印 |
| 时间机器 | **需要 git** | 唯一的外部依赖 |

git 的三种处理方式：

1. **仅依赖系统 git**：检测不到就把时间机器置灰。0 体积，但开源用户会问“这功能为什么是灰的”。
2. **内置 git 二进制 + 优先用系统 git**（采用）：`gitPath = findSystemGit() ?? bundledGit()`。同一套 CLI 封装，只换可执行路径，代码零分叉。代价是安装包 +20~50MB（按平台，来自 dugite-native 的三平台预编译包）；Windows 需把整个 portable 目录放进 `extraResources`，macOS 需确认嵌套二进制的签名/公证随主包一起完成。
3. **纯 JS 写 git 对象**：Node 自带 zlib + crypto，可直接产出 loose object / tree / commit 并更新 refs，做到零体积零依赖、仓库仍能被 `git` 打开。但对象格式写错等于把用户仓库写坏，风险与收益不成比例，**不做**。

结论：非开发机器装完即可用；唯一可能缺的 git 由应用自带补齐。

### 界面层说明

渲染层用 **React + TypeScript**。CodeMirror 本身框架无关，若后续想换 Vue3，只影响组件层，不影响主进程与 IPC 契约。

---

## 3. 进程架构与目录结构

```
src/
├── main/                       # 主进程：一切文件与 git 操作
│   ├── index.ts                # 窗口创建、安全基线、生命周期
│   ├── ipc/
│   │   ├── vault.ts            # 库打开/切换/最近列表
│   │   ├── tree.ts             # 目录扫描与监听
│   │   ├── doc.ts              # 读取/写入/删除/重命名
│   │   ├── search.ts           # 索引与查询
│   │   ├── history.ts          # 时间机器
│   │   └── exporter.ts         # v2
│   └── services/
│       ├── vault.ts
│       ├── scanner.ts          # 懒加载目录扫描
│       ├── watcher.ts          # chokidar + 自写抑制
│       ├── fsio.ts             # 原子写、EOL 保留、废纸篓
│       ├── searcher.ts         # 内存全文扫描
│       ├── history/
│       │   ├── repo.ts         # git 命令封装（隔离环境）
│       │   ├── snapshot.ts     # 建快照 / 列表 / 详情
│       │   ├── rewind.ts       # 切换快照（保护快照 + 清理）
│       │   └── prune.ts        # 删除快照（commit-tree 重建）
│       └── export/             # v2：html / pdf / docx
├── preload/
│   └── index.ts                # contextBridge，按域暴露最小 API
├── renderer/
│   ├── app/
│   ├── features/
│   │   ├── explorer/           # 左树
│   │   ├── editor/             # CodeMirror 封装
│   │   ├── preview/            # 管线、mermaid 组件、滚动同步
│   │   ├── search/             # 结果面板 + Cmd+P
│   │   └── history/            # 时间机器面板
│   └── styles/markdown.css     # 预览与导出共用
└── shared/
    ├── types.ts                # 跨进程类型
    └── ipc.ts                  # 通道常量 + 参数/返回类型（契约单一来源）
```

### 安全基线（M0 必须落地）

```ts
webPreferences: {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  preload: <preload 路径>
}
```

渲染进程**永远拿不到 `fs`、`child_process`**。preload 只暴露 `window.api.{vault,docs,tree,search,history,export}` 白名单方法，参数在主进程校验（路径必须落在当前库根目录内，用 `path.resolve` + 前缀比对，防目录穿越）。

---

## 4. 数据模型

```ts
// 库
type Vault = {
  id: string        // sha1(realpath)，作为 history 仓库目录名
  root: string      // realpath 后的绝对路径
  name: string      // basename
  lastOpenedAt: number
}

// 配置文件：userData/config.json（单一文件，原子写）
type Config = {
  vaults: Vault[]
  currentVaultId: string | null
  ui: {
    expanded: Record<string /*vaultId*/, string[] /*相对路径*/>  // 树的展开状态
    activePath?: string
    viewMode: 'edit' | 'split' | 'read'
    splitRatio: number
  }
}

// 文件树节点
type TreeNode = {
  relPath: string        // 相对库根，永远用 posix 分隔符对外暴露
  name: string
  kind: 'md' | 'dir' | 'other'
  mtimeMs: number
  size: number
}

// 文档会话（渲染层）
type DocSession = {
  relPath: string
  content: string                    // 原始字符串，未做任何 EOL 归一
  eol: '\n' | '\r\n'
  hasBom: boolean
  stat: { mtimeMs: number; size: number; hash: string }
  dirty: boolean
  editorState?: unknown              // CodeMirror EditorState 缓存
}

// 快照
type Snapshot = {
  sha: string
  message: string
  createdAt: number        // 作者时间
  filesChanged: number
  insertions: number
  deletions: number
}
```

---

## 5. 关键机制设计

### 5.1 打开与切换库

1. `dialog.showOpenDialog({ properties: ['openDirectory'] })`
2. **`fs.realpath` 归一**。macOS 上 `/tmp` 与 `/private/tmp`、外接盘的软链会让同一目录得到两个不同路径，不归一会导致“同一个库被当成两个库”（最近列表重复、时间机器建两份）。
3. 切换顺序：`flush 当前文档` → `关闭 watcher` → `切库` → `重建索引` → `启动 watcher` → `恢复 UI 状态`。
4. 最近列表与树状态只写 `userData/config.json`，**库目录内不产生任何文件**。

### 5.2 文件树

- 首次只扫一层（顶层目录 + 文件），展开某目录时才扫它的直接子项（懒加载）。
- 排序：目录优先，`localeCompare(b, 'zh')`。
- 默认忽略：`.git`、`node_modules`、`.DS_Store`、`*.tmp`；可在设置里追加（默认忽略规则**只影响显示**，不影响时间机器）。
- 非 md 文件灰显，点击用 `shell.openPath` 交给系统默认程序。这样“树 = 硬盘目录”不打折。
- `chokidar` 参数：`{ ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 300 } }`，忽略自身临时文件。

### 5.3 搜索（2026-11-20 定稿：三栏 + 逐行命中）

**布局**：搜索是「模式」，不是常驻输入框。打开后为三栏 `侧栏 | 结果栏 | 编辑区`；搜索期间**强制单栏**（若原为分栏，临时降为单栏，关掉搜索恢复原视图与栏宽）。

- 结果栏宽 300–480px，可拖，双击把手复位 340px，宽度写 `config.json`。
- `Cmd/Ctrl+F` 打开搜索；`Esc` 或再点一次放大镜关闭；关闭后恢复搜索前的视图模式与所有栏宽。
- **收起侧栏 = 退出搜索模式**，但保留最后一次 query，下次 `Cmd/Ctrl+F` 直接恢复。
- 搜索中按 `Cmd/Ctrl+2`（分栏）无效，提示「搜索中暂不能分栏」。

**结果列表（参照 VS Code 的两层结构，但默认展开、扁平）**：

- **文件组头**：文件名 + 相对路径（灰色小字）+ 命中数徽标；点组头 = 打开该文件。
- 组头下紧跟至多 **6 条命中行**：`行号 + 单行原文 + 关键词高亮`；超长横向截断不换行。超过 6 条折叠为「还有 N 处」。
- 点命中行 = 打开文件并**跳到该行**（行号由主进程扫描时算好，渲染层不再计算）。
- **不按目录嵌套**（窄栏里深目录缩进不可读）。
- **排序**：文件名/标题命中 > 仅正文命中；同组内按 mtime 倒序。不提供排序下拉，只在结果栏列头右放一个「只看标题命中」开关。
- 高亮 = 字面子串匹配（英文大小写不敏感，中文原样），不做正则/分词。

**扫描与性能**：

- 不建倒排索引；打开搜索时全库流式扫描 `.md`，**边扫边出**、可中断（新 query 取消上一次扫描）。
- 单文件 > 2MB 只匹配文件名/标题；库内 md 总量 > 200MB 或 > 20000 文件时提示「结果可能不完整」。
- **标题推导**：`frontmatter.title` → 第一个 `# ` H1 → 文件名。
- `Cmd/Ctrl+P`：轻量弹窗，只对文件名做模糊匹配（子序列打分，自写 `scoreFuzzy`，见 §12 M4），上下键选择、回车跳转——与 `Cmd/Ctrl+F` 的三栏搜索分工不同。

### 5.4 编辑器与保存

- CodeMirror 6：`@codemirror/lang-markdown` + `language-data`（代码块内语法高亮）。
- 文档切换时保留每个文件的 `EditorState`（含 undo 历史），内存里最多缓存 20 个，超出按 LRU 淘汰。
- **原子写**：写 `.{name}.tmp` → `fh.sync()` → `fs.rename` 覆盖。Windows 上 rename 可能被杀毒软件短暂占用，失败时重试 3 次、间隔 150ms，仍失败则弹错误（绝不静默丢改动）。
- **EOL/BOM 保留**：读取时记录首个行尾是 `\r\n` 还是 `\n`，保存时按原样重建；BOM 同理。末尾换行状态不增不减。这条是 Windows 上 `git status` 不出假全量 diff 的关键。
- 自动保存：输入静止 800ms；`Cmd/Ctrl+S` 立即落盘；标题栏圆点表示未保存。
- **自写抑制**：保存前把 `{hash, mtimeMs}` 写入 `pendingWrites`；watcher 事件到达时若 hash 命中则丢弃，5s 后清理。不做这个，自动保存会让光标每 8 个字跳一次。
- **外部冲突**：命中 watcher 但 hash 不符时——有脏改动 → 弹窗「保留我的 / 加载磁盘版本 / 另存副本」；无脏改动 → 静默重载，并按行号比例恢复光标与滚动位置。
- 删除一律走**应用回收站**（见 §5.12），永不 `unlink`；重命名前扫库，提示「另有 N 个文件引用这个名字」。

### 5.5 预览管线与增量渲染

```
remark-parse
 → remark-frontmatter（剥离，标题另存）
 → remark-gfm
 → remark-math
 → remark-rehype（allowDangerousHtml: true）
 → rehype-raw（还原内联 HTML）
 → 自定义 sanitize 插件（DOMPurify：剥 script/iframe/on*/javascript:）
 → rehype-katex（mhchem 已由 katex 内置，\ce{} 可用）
 → hast
 → hast-util-to-jsx-runtime → React 元素树
```

- **mermaid 不走管线渲染**：`remark` 阶段把 `code[lang=mermaid]` 节点标记成占位，交给 React 的 `<MermaidBlock source={...} hash={...}>` 异步渲染。
  - mermaid 内部有全局状态，**必须串行队列**，并发渲染会互相污染。
  - 结果按 `hash(source)` 缓存（LRU 200），命中直接复用 SVG。
  - 渲染失败显示错误块（含 mermaid 报错文本），不阻塞整篇预览。
- **增量**：hast → React 时给元素稳定 key（由节点路径 + 类型生成），React 的 diff 天然只更新变化块，避免图片闪烁、mermaid 重算、滚动跳动。预览更新 300ms 防抖。
- **CSS 单一来源**：`styles/markdown.css` 同时供预览与导出使用，保证“看到的 = 导出的”。

### 5.6 三态视图

| 模式 | 布局 |
|---|---|
| 纯编辑 | 全宽 CodeMirror |
| 分栏 | 左编辑 / 右预览，可拖拽分割线（比例存 config） |
| 查看 | 全宽只读预览 |

三态共享同一份 `content`（单一真相），切换只换布局，不重载内容、不重置光标。切换入口在内容区列头右侧（图标 + `Cmd/Ctrl+1/2/3`，见 §5.10）；搜索态下列头保留，只把内容区强制成单栏。

### 5.7 滚动同步（按源码块锚点）

- 渲染时给每个顶层块打 `data-line={start}`，并记录 `[startLine, endLine]` 映射表。
- 编辑器滚动 → 取视口顶部第一个可见行 → 在映射表里二分找到所属块 → 预览中对应块 `scrollIntoView({ block: 'start' })`。
- 反向同理：预览滚动 → 找最近 `data-line` 的块 → 编辑器 `scrollTo` 到该行。
- 同步加 80ms 节流 + “正在被用户拖拽的一侧不反向驱动”的锁，避免左右互推抖动。
- 不用百分比同步：mermaid/图片块高度与源码行数不成比例，越滚越偏。

### 5.8 时间机器（git）

**仓库位置**：`userData/history/<vaultId>/`（内含 `.git`），工作区指向库根。

```
git --git-dir=<repo> --work-tree=<vaultRoot> ...
```

**git 可执行文件的获取顺序**：

1. 系统 `PATH` 里的 `git`（`which git` / `where git`）
2. 应用内置的 `extraResources/git/…`（dugite-native 平台包）
3. 两者都没有 → 时间机器整体置灰 + 提示，其余功能不受影响

**后端抽象**：`services/history` 对外只暴露一个 `HistoryBackend` 接口（`snapshot / list / detail / diffWorking / rewind / delete`），git CLI 是它的第一个实现。这样未来要换纯 JS 实现、或加远端同步，都不需要动 UI 和 IPC 层。

**初始化**（首库首次打开时）：

```
GIT_DIR=<repo> GIT_WORK_TREE=<root> git init
git config core.bare false
git config core.worktree <root>
git config core.autocrlf false      # 关键：否则 Windows 上行尾被改写
git config user.name "时间机器"
git config user.email "tm@local"
```

- 写 `<repo>/info/exclude`：`.DS_Store`、`node_modules/`、`*.tmp`、`.git/`。
- 库内**不出现 `.git`**（M5 验收项之一）。

**命令隔离环境变量**（每次 spawn 都带）：

```
GIT_CONFIG_NOSYSTEM=1
GIT_CONFIG_GLOBAL=/dev/null          # 或 Windows 上指向空文件
GIT_TERMINAL_PROMPT=0
-c core.hooksPath=/dev/null
-c core.autocrlf=false
```

理由：别人机器上的全局 `autocrlf`、签名配置、hook 会把快照内容或流程搞乱。

**两条 ref 链**（这是整个功能的结构基石）：

| ref | 内容 | 对用户 |
|---|---|---|
| `refs/heads/snapshots` | 只有手动点的快照，线性 | 时间机器列表唯一来源 |
| `refs/protect` | 自动保护快照，滚动保留最近 50 条 + 7 天 | 完全隐藏 |

建快照流程：

1. `git add -A -- .`（会尊重库内 `.gitignore`，这是想要的行为）
2. `git write-tree` 得到 tree
3. `git commit-tree <tree> -p <parent> -m <msg>` → `update-ref <目标 ref>`
   - 手动快照：parent = `refs/heads/snapshots` 当前值，msg 为用户输入或默认 `快照 · N 个文件`
   - 保护快照：parent = `refs/protect` 当前值，msg 为 `autosave`
   - 两条链共用同一个 tree，互不干扰，也不互相成为祖先
4. 保护快照超限时：`update-ref -d` 旧条目 + 定期 `gc`

**保存快照的备注弹窗**（用户 2026-11-20 明确要求）：

- 点「保存快照」（列头相机图标 / `Cmd+Shift+S` / 命令面板）→ 先弹小对话框：标题「保存快照」，一个输入框占位符「备注（可选）」，右下「取消 / 保存」
- **备注非必填**：留空或只有空白字符 → 自动生成 `快照 · 2026-11-20 15:42 · N 个文件`；用户填写则原样作为 commit message 首行
- 备注上限 200 字符（防止撑爆列表与 detail 面板），超出截断并提示；换行转空格
- 键盘：`Enter` 保存、`Esc` 取消；取消**不产生任何 commit**（绝不能点了取消却落一条快照）
- 弹窗读取当前库的最新状态（`git add -A` 之后才知道 N 个文件），所以「N 个文件」在保存那一刻填充，不在打开弹窗时算——避免用户停留在弹窗期间改了文件导致数字说谎
- 备注直接进 commit message（首行），**不额外存一份 metadata**：单一真相源，时间机器列表和文档变更区都从 `git log` 读
- 与上一条快照**无差异**时不创建：弹提示「自上次快照以来没有任何改动」（空快照对回溯没有价值，只会把列表塞满）—— 这条是我的默认判断，如果你更想允许「打时间点」，说一声就改成允许并标注「无改动」
- 折叠态也必须能弹（`Cmd+Shift+S` 在侧栏收起时依然可用，弹窗挂在窗口层，不依赖左栏）

**列表**：`git log refs/heads/snapshots --format=... --numstat` → 解析成 `Snapshot[]`（sha / 时间 / 消息 / 改动文件数 / +/- 行数）。
**详情**：`git diff-tree --no-commit-id --name-status -r <sha>` + `git diff <sha>^ <sha>` 取 hunk。

**未提交 diff**：`git diff refs/heads/snapshots --no-color` 取已跟踪文件的变更；再用 `git status --porcelain` 补未跟踪文件（显示为“新增”）。

**切换快照**：

1. 有未提交改动 → **先自动打一条保护快照**（保证可回滚；这条不能省）
2. 暂停 watcher
3. `git ls-tree -r <sha>` 得到目标文件集合
4. 当前存在但目标不存在的文件 → `shell.trashItem`（进废纸篓，不是删除）
5. `git checkout <sha> -- .` 恢复目标内容
6. 恢复 watcher，重建树与搜索索引
7. **`refs/heads/snapshots` 不动**（HEAD 仍指向最新）

切换后点「保存快照」= 在 `refs/heads/snapshots` 头部追加一条普通 commit（内容是当前状态）。**不改写任何历史**，天然满足“当新变更记录”的语义。

**删除快照**：

1. 二次确认弹窗，列明三点后果
2. 用 `git commit-tree` 重建：被删快照之后的每条快照**沿用原 tree，只换父指针**
3. 一次性 `update-ref refs/heads/snapshots <新头>`（原子）
4. `git reflog expire --expire-unreachable=now --all` + `git gc --prune=now`，让对象真正消失

弹窗文案必须写清：

> - 当前文件内容不会改变（删记录 ≠ 回滚内容）
> - 被删快照的改动将并入下一条快照的差异中
> - 该状态将无法单独回溯（清理后不可恢复）

**异常与降级**：

- 启动时 `git --version` 检测；不存在 → 时间机器整块置灰 + 明确提示安装 Git，其余功能不受影响
- 任何 git 命令非零退出 → 把 stderr 原文展示，绝不静默吞掉
- git 操作期间置 `historyBusy` 标记，watcher 事件排队而非丢弃

**注意**：库内若已有用户自己的 `.git`，我们的独立仓库不读它、不写它，两者互不影响（`.git` 目录本身不会被 add）。

### 5.9 导出（v2）

**HTML**

- 单文件模式（默认）：内联 `markdown.css` + 图片转 data URI（单图 > 5MB 给出警告）+ mermaid 预先渲染成 SVG 内嵌 + KaTeX 用 `renderToString` 输出 HTML，所需字体（woff2，约 1MB）内嵌，保证离线可看
- 目录模式：`index.html` + `assets/` 复制图片 + `style.css`
- **链接改写**：解析 link 节点 → 目标为 `.md` 且在导出集合内 → 换成对应后缀 + `path.posix.relative` 重算相对路径；不在集合内 → 保留原 href 并加 `data-link-broken="1"`、样式标灰
- **锚点**：标题转 slug（保留中文、去标点、空格转 `-`），同名 slug 追加序号

**PDF**（`printToPDF`）

- 隐藏 BrowserWindow 加载渲染结果 + 独立 print CSS（A4、2cm 边距、页码、隐藏交互控件、代码块长行强制折行、表格/图片 `break-inside: avoid`）
- 等待所有 mermaid 渲染完成信号后再打印
- 字体必须内嵌 woff2，否则别人机器上中文会缺字或换字形
- **v1 不做书签**

**Word**（`docx` 纯 JS）

- 标题 → 内置 Heading 1–6 样式（用户可在 Word 里一键生成目录）
- 段落 / 加粗 / 斜体 / 行内代码（等宽 + 浅底）/ 链接（HTML 之外，Word/PDF 中跨文档链接降级为纯文本）
- 列表 → 嵌套 numbering；任务列表 → `☐` / `☑`
- 表格 → Table（对齐映射 alignment）
- 图片 → ImageRun，宽度按可用宽度等比缩放
- 代码块 → 段落 + 底纹 + 等宽字体
- mermaid → PNG 内嵌（在隐藏窗口里 `deviceScaleFactor: 2` 截图，避免糊）
- **公式**：v2.0 先落成 PNG（同上截图方式）；v2.1 再生成 OMML，让 Word 里可编辑
- 中文字体：文档默认 `eastAsia` 设为 `PingFang SC` / `Microsoft YaHei`

**批量**

- 串行执行，复用同一个隐藏窗口（每文件开窗会吃内存）
- 进度条 + 可取消
- 产物目录镜像源结构；文件名非法字符（`/ : * ? " < > |`）替换为 `_`；Windows 长路径超限时提示

### 5.10 界面结构（2026-11-20 定稿）

**整条顶栏删除**，改为「左栏自带标题、内容区自带列头」的结构（参考豆包工作的形态）。

**窗口**：`titleBarStyle: 'hiddenInset'` + `trafficLightPosition {x:16,y:16}`（三颗并排占到 x≈68），四角 `roundedCorners` 兜住。

**视觉语言（2026-11-20 第二次修订，按用户要求）**：**全直角、无卡片、无栏缝**。整窗白底，栏与栏之间只有 1px `--border` 线；左栏底部状态栏 24px 一条，也用 1px 线分隔。面板/卡片 `border-radius: 0`；按钮保留 4px 微小圆角（否则按压态完全没有边界，方形按钮在 macOS 上观感偏硬——若也要全直角，改一个变量即可）。

**图标**：统一 20 视图、1.4 描边、圆头线帽的细线风格（对齐参考图）：放大镜、方框内一支笔（新建/编辑）、方块+左实心列（侧栏开关）、分栏、眼睛、齿轮。树里的小图标仍 13–14px。

**可拖拽分栏（用户明确要求「各栏可用鼠标拖拽调整大小」）**：

| 分隔条 | 范围 | 持久化 | 复位 |
|---|---|---|---|
| 左栏右缘（5px 命中区，`col-resize`） | 180–420px | `ui.sidebarWidth` | 双击回 252 |
| 分栏态中间（5px） | 0.25–0.75 | `ui.splitRatio` | 双击回 0.5 |
| 搜索态结果栏（M4 起） | 300–480px | 同上机制 | 双击回 340 |

实现要点：`pointerdown` 时 `setPointerCapture`（拖出窗口也不丢事件）；拖动过程只改 React state，**`pointerup` 才写盘**，避免一帧一次 IPC；上下限在 `main/services/config.ts` 与渲染层各夹一次，非法值走 `clampNumber` 兜底。

**红绿灯避让（这条是硬规则，踩过一次）**：
- 展开态：红绿灯落在左栏卡片顶部，卡片内先留 `36px` 拖拽区再放库名；整个左栏顶部、内容列头都 `drag`，其中的按钮显式 `no-drag`
- **折叠态：内容区从 x=0 开始，红绿灯仍画在窗口左上角，所以列头必须 `padding-left: 78px` 让位**——否则红绿灯会压住第一个图标胶囊和标题。实测折叠态侧栏开关左边界 x=78、搜索胶囊 x=112，红绿灯右缘 ≈68，留 10px 余量

**左栏（默认 252px，可折叠，宽度可拖）**，自上而下：

1. 顶部：**只有库名**（在拖拽区下方）——折叠按钮按用户要求移进内容列头，左栏不再放
2. **文件树**：映射硬盘真实目录，懒加载；**独立滚动，`flex: 1`**，分类区再长也挤不没它
3. **分类区**：默认收起；展开后**最高占左栏 40%**，超出自身滚动；与文件树之间有一条可拖分割线（比例存 config）。展开后依次是内置视图（最近使用 / 未分类 / 回收站）+ 自定义分类（动态聚合，不限数量，带计数）
4. **文档变更区**：M5 起出现（见 §5.13），之前不渲染
5. **底部固定：设置（齿轮）**——不随树滚动

**最小窗口**：`minWidth 1024 / minHeight 640`（搜索三栏 ≥ 1000px 才不压死编辑区）。

**折叠态**：左栏整体消失，内容列头先给红绿灯让位，再排「展开侧栏」胶囊 + 文档名；`Cmd/Ctrl+B` 切换；`Cmd/Ctrl+,` 始终可用；`Cmd/Ctrl+F` 自动展开左栏并恢复上次 query。

**内容区列头（46px）**：
- **左：四个图标胶囊**（32×30、hover 浅灰底），顺序固定为「侧栏开关（`⌘B`）→ 搜索（`⌘F`）→ 保存快照（相机，`⌘⇧S`）→ 时间机器（时钟）」；展开/折叠两态都在，不再随状态增减；相机/时钟在时间机器未就绪（无 git）时置灰，时钟打开抽屉后显示 active
- **中：当前文档名，绝对居中**（`left:50% + translateX(-50%)`，这样左右两组宽度不等也不会偏；`pointer-events:none` 不挡拖拽）
- **右：编辑 / 分栏 / 阅读** 三个图标胶囊（active 态 `--accent-soft` 底 + 蓝图标），`Cmd/Ctrl+1/2/3`
- 「新建」胶囊**用户明确暂不要**（落点是 M2 的未命名文档）；`ComposeIcon` 先留在 `icons.tsx` 不渲染，M2 接上即可
- 搜索态时列头保留（标题仍居中、三态按钮照旧），内容区换成三栏搜索布局（见 §5.3）

**设置面板**：复用现有命令面板组件，内部拆「设置 / 命令」两个视图。齿轮 → 设置视图，`Cmd/Ctrl+K` → 命令视图，`Cmd/Ctrl+,` → 设置视图。v1 设置项只有：语言（中文/English）、快捷键一览、关于；主题、忽略规则、回收站保留期后续再加（不预留空壳）。

**快捷键表（v1，集中定义 + 启动时冲突检测）**：

| 动作 | 快捷键 |
|---|---|
| 打开库 | `Cmd/Ctrl+O` |
| 设置 | `Cmd/Ctrl+,` |
| 命令面板 | `Cmd/Ctrl+K` |
| 搜索（三栏） | `Cmd/Ctrl+F` |
| 快速跳转文件 | `Cmd/Ctrl+P` |
| 折叠/展开左栏 | `Cmd/Ctrl+B` |
| 编辑 / 分栏 / 阅读 | `Cmd/Ctrl+1` / `2` / `3` |
| 保存 | `Cmd/Ctrl+S` |
| 新建文档 | `Cmd/Ctrl+N` |
| 删除（进应用回收站） | `Cmd/Ctrl+Backspace` |
| 保存快照 | `Cmd/Ctrl+Shift+S` |
| 导出当前 / 批量导出 | `Cmd/Ctrl+E` / `Cmd/Ctrl+Shift+E` |
| 切换语言 | `Cmd/Ctrl+Shift+L` |

约定：快捷键字符串与 action id 一起集中放在 `renderer/src/shortcuts.ts`，设置面板直接渲染这张表；同一组合被注册两次时启动即 `console.error`（不静默覆盖）。

### 5.11 分类（2026-11-20 定稿：frontmatter 为唯一真相）

**存哪**：写进 md 自己的 frontmatter 的 `categories` 键（YAML 数组）。理由：跟着文件走（改名/移动/换机/拷给别人都不丢）、会被 git 快照一起记录、VS Code 与 Obsidian 都读得懂。**不采用** userData 路径映射（改名即失效、换机即丢），**不采用** macOS Finder 标签 xattr（Windows 无等价物，且需原生模块）。

**写入纪律**：
- 只增删 `categories` 这一个键；其余键**原样保留、顺序不动**（解析定位这一段，其余按原文切片拼回，不做整体重排）。
- 文件原本没有 frontmatter 时，才新增一个最小块（仅 `categories`）。
- 非 md 文件 v1 不支持分类。
- 一个文档可属多个分类；编辑区顶部以 chip 行展示，默认显示前 3 个 + 「+N」，点击可增删。

**内置视图不写入正文**：`最近使用` / `未分类` / `回收站` 是视图，不占分类名；用户新建分类时做重名检测（中英文、大小写归一比较）。

**未分类**：`categories` 缺失或为空数组的 md。

**最近使用**：以 userData 里的「最近打开记录」（relPath + 打开时间）为准，不依赖 mtime（拷进来的文件 mtime 可能很旧）。

**元数据缓存（必需，不是索引）**：`userData/index/<vaultId>.json`，内容为 `relPath → { title, categories, mtimeMs, size }`。启动时增量校验，watcher 的 add/change/unlink 增量更新；分类计数、未分类列表、文档变更列表全部读它。**只缓存元数据，不缓存正文**，因此不违反「不建全文索引」。
- 首次打开一个大库会有一轮全量扫描（只读文件头部若干字节取 frontmatter），显示进度条，可后台进行。

**批量改分类**（重命名 / 删除分类）：先弹「受影响文件清单」→ 确认 → 逐个写入 → 任一失败则回滚已改文件，并报告失败清单。禁止静默批量改。

### 5.12 回收站（2026-11-20 定稿：两段式）

**第一段（应用回收站）**：删除文件/目录时 `move` 到 `userData/trash/<vaultId>/<原相对路径>`（保留目录结构），同时在 `userData/trash/<vaultId>/index.json` 记 `{ 原路径, 文件名, 删除时间 }`。**不 `unlink`，也不直接进系统废纸篓。**

- 左栏「回收站」列出条目：文件名 + 原路径 + 删除时间。
- **还原**：移回原路径；若原位置已有同名文件 → 改名 `name (1).md` 并提示；目录整棵树还原。
- **第二段（彻底删除）**：回收站里点「彻底删除」才 `shell.trashItem`，系统废纸篓是最后一道保险。
- 保留策略：30 天 / 200 项（先到先清），启动时清理，清掉的走 `shell.trashItem`。

**与时间机器的关系（关键，不需要特判代码）**：
- 回收站位于 `userData`，**不在 git work tree 里**。所以「文件进回收站」在 git 眼里就是 `deleted`。
- 若此时打快照，快照记录「该文件不存在」；之后从回收站还原，文件重新出现即为 `untracked/new`，**下一次快照自然记为「新增」**。历史里不会出现「删了又偷偷接上」的假象。
- **切换快照时**：若目标快照中存在某路径，而该路径的副本正在回收站里，则该条目自动灰显为「已被快照取代」（只保留「彻底删除」），数据不删，并在切换结果里列出「N 项回收站记录已被快照版本取代」。
- 回收站操作本身**不触发快照**；只有用户手动点「保存快照」才建。

### 5.13 文档变更（M5 起）

- 左栏此区块**在 M5 之前不渲染**，避免空壳。
- 列表 = 相对「最近一次手动快照」的 `git diff --name-status` + `--numstat`：每行 `M/A/D` 徽标 + 文件路径 + `+N/-M`。
- 点击条目 → **行级 diff 视图**（左旧右新，绿加红删），只读。
- **基线**：首次打开库时在内部保护链（`refs/protect`）自动打一条「基线」快照，用户列表不可见；无手动快照时，变更列表对比基线。
- 打完手动快照后列表清空；删除某条快照后按新的最近快照重算。
- 快照的**备注在列表里就是标题**：用户填了显示原文，留空的显示「快照 · 时间 · N 个文件」并置灰（一眼能区分「我标注过的」和「只是存了个点」）。

---


净工时估算约 **75–95 小时**（按每天 4–6 小时有效开发，约 3–4 周）。2026-11-20 定稿的界面重构、分类、回收站、文档变更四块带来约 15 小时增量。

### M0 · 骨架（0.5–1 天）

- `electron-vite` + React + TS 初始化，主/预加载/渲染三层跑通
- 安全基线落地（contextIsolation / sandbox / 白名单 preload）
- 单窗口、应用菜单、开发热更新
- pnpm workspace 分层（`apps/desktop` + `packages/core` + `packages/plugin-api`）+ 命令注册表骨架（见 §11.1）
- **验收**：`pnpm dev` 起来，IPC `ping` 往返成功，DevTools 里 `require`/`fs` 不可见；命令注册表能列出一个已注册命令

### M1 · 库与文件树（1–2 天）

- 选目录、realpath 归一、最近列表、切换库
- 懒加载树、排序、忽略规则、非 md 系统打开
- watcher 只更新树（先不接编辑冲突）
- **验收**：Finder 里新建/改名/删除文件与目录，树 1s 内同步；来回切库无残留状态；库目录内无新增文件

### M1.5 · 界面重构（1–2 天，2026-11-20 新增）

- 删除整条顶栏；`titleBarStyle: 'hiddenInset'` + 拖拽区 + 圆角兜底
- 左栏：库名+折叠箭头 / 文件树 / 分类区（默认收起，内置三项 + 自定义）/ 底部固定设置
- 内容区 40px 列头：折叠开关 + 文档名，右侧三段切换（图标 + `Cmd+1/2/3`）
- 设置面板（复用命令面板，拆「设置 / 命令」两视图）、`Cmd+,`、`Cmd+B`、`Cmd+F` 入口与折叠态兜底按钮
- `renderer/src/shortcuts.ts` 集中定义 + 启动冲突检测
- 分类 frontmatter 读写（§5.11）+ 元数据缓存 + 未分类/最近使用列表
- **验收**：左栏收起后仍能进设置与搜索；`Cmd+F` 打开三栏搜索并能自动展开左栏；给一个文档打分类后，文件头部出现 `categories`，其余 YAML 一字未变；重启后分类与展开状态都在

### M2 · 编辑器与保存（2–3 天）

- CodeMirror 6 接入、md 高亮、主题
- 三态布局 + 可拖分割线
- 原子写、EOL/BOM 保留、800ms 自动保存、`Cmd+S`
- 外部冲突三选弹窗
- **验收**：连续输入 5 分钟不丢字；改 1 行后 `git diff` 只显示 1 行（行尾未被改写）；外部改文件出现冲突提示且三个选项行为正确

### M3 · 预览（2–3 天）

- 完整管线 + sanitize + KaTeX（含 `\ce{}`）
- MermaidBlock（串行队列 + 缓存 + 错误块）
- 按块增量渲染 + 300ms 防抖
- 双向滚动同步
- **验收**：500 行、含 5 张 mermaid 与 20 个公式的文档，输入手感无卡顿；左右滚动同步偏差不超过 1 块；插一个 `<script>` 的内联 HTML 在预览里不执行

### M4 · 搜索（1–2 天）

- 三栏搜索（侧栏 | 结果栏 | 编辑区，搜索态强制单栏，结果栏宽度可拖并持久化）
- 流式扫描 + 可中断；文件组头 + 至多 6 条命中行（行号 + 单行原文 + 高亮 + 「还有 N 处」）
- 文件名/标题命中优先、组内 mtime 倒序；「只看标题命中」开关；点命中行跳行
- `Cmd+P` 模糊跳转
- **验收**：1000 文件库输入后首屏结果 < 300ms 且可继续填充；中文关键词（如「导出」「批量」）命中正确；同一文件命中 10 处时只显示 6 行 + 「还有 4 处」；`Cmd+2` 在搜索中被拒绝并给提示

### M5 · 时间机器（3–4 天）

- git 封装与命令隔离；首次打开库自动在保护链打「基线」快照
- 手动快照 / 列表 / 变更详情 / 未提交 diff
- 保存快照的备注弹窗：备注**非必填**，留空自动生成「快照 · 时间 · N 个文件」，`Esc` 取消不落 commit
- 切换（先打保护快照 + 目标中不存在的文件移入**应用回收站** + 暂停 watcher + 冲突回收站条目灰显为「已被快照取代」）
- 删除（commit-tree 重建 + 二次确认）
- **文档变更区**（§5.13）：`M/A/D` + `+N/-M` + 行级 diff 视图
- **验收**：删中间快照后后续 parent 正确、差异按预期合并、当前内容不变；切换后树与文件内容与目标完全一致；「删文件→打快照→回收站还原→再打快照」在历史里表现为「删除 + 新增」两条独立变更；100 次快照后 `git fsck` 无错误；库内始终无 `.git`；**备注留空能存（自动文案）、`Esc` 取消后快照列表条数不变**

### M6 · 打磨与打包（2 天）

- 错误边界、加载态与空态、设置页补项（主题、忽略规则、回收站保留期）
- 三平台构建脚本、图标、版本
- **验收**：本机 `pnpm dist:mac-x64` 出 dmg，安装后可完成「开库 → 编辑 → 保存 → 打快照 → 切快照 → 删快照」全流程

### M7 · 导出（v2，4–6 天）

- HTML 单文件 / 目录、链接改写、锚点
- PDF（print CSS + 字体内嵌）
- Word（docx 映射 + 图片 + mermaid + 公式 PNG）
- 整库批量 + 进度 + 取消
- **验收**：抽出 20 篇互相链接的文档批量导出三种格式，图片/mermaid/公式全部可见；HTML 内跨文档链接可跳转；未导出目标的链接被标记而非消失

---

## 7. 风险清单

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| mermaid 高频重渲染卡顿 | 中 | 高 | 串行 + 缓存 + 块级 diff；仍卡则改为“光标离开该块才渲染” |
| Electron 在本机 macOS 26 上的兼容性（打包、printToPDF） | 中 | 高 | M0 就做一次打包冒烟，不等到 M6 |
| 时间机器在 Windows 上因 Git 缺失/路径异常失败 | 中 | 中 | 启动检测 + 明确降级提示，不影响其他功能 |
| `.git` 膨胀（附件与图片累积） | 高 | 中 | 首次快照统计库体积，> 500MB 提示配置排除目录；设置项可加 ignore |
| Windows 大小写不敏感导致树重复/重命名冲突 | 中 | 中 | 树以 realpath 归一，Windows 下用小写做去重比对 |
| Word 公式 PNG 在高 DPI 下糊 | 中 | 低 | 截图 `deviceScaleFactor: 2`；v2.1 上 OMML |
| printToPDF 分页断裂（表格/代码块被切） | 高 | 中 | print CSS 的 `break-inside: avoid` + 逐类型单独验证 |
| 大库搜索吃内存 | 低 | 中 | 200MB / 20000 文件阈值降级为流式扫描 |

---

## 8. 验证方法

- **单元测试**（vitest，纯函数）：slug 生成、EOL 检测、路径相对化改写、git 输出解析、diff hunk 解析
- **手动验收清单**：每个里程碑的验收项写成 checklist，逐条打勾
- **冒烟**：每个里程碑结束跑一次 `pnpm build` + 打包，避免“最后才发现打不出包”
- **真实库试用**：M3 完成后就用自己真实的笔记库跑一周，M4/M5 边用边加

---

## 9. 构建与分发

| 脚本 | 平台 | 说明 |
|---|---|---|
| `pnpm dist:mac-x64` | macOS Intel | 在本机原生构建，可直接实测 |
| `pnpm dist:mac-arm64` | macOS Apple Silicon | 纯 JS 依赖下可在本机交叉产出，但**必须在 M 机器实测** |
| `pnpm dist:win-x64` | Windows x64 | 在 Windows 机器上跑，NSIS 安装包 |

- 不做跨平台交叉打 Windows 包（不需要 Wine，也不需要 CI 矩阵）
- **国内网络必须带镜像变量**（Electron 运行时与 electron-builder 的二进制都从 GitHub 拉，直连经常失败）：

  ```bash
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  pnpm dist:mac-x64
  ```
- 自用 → 全部不签名：mac `identity: null`（首次右键打开），Windows 忽略 SmartScreen
- 若要分发给他人：需 Apple 开发者账号公证（¥688/年）+ Windows 代码签名证书，属于另一阶段工作

---

## 10. 建议的落地顺序

1. **M0–M3 一周内跑通**，先让自己能真的用它写东西（这时已经有“管理 + 编辑 + 预览 + 保存”）
2. **M4–M5 边用边加**，先用真实库暴露 M1–M3 的问题
3. **M6 每次里程碑结束都做一次打包冒烟**，不要攒到最后
4. **M7 等 v1 稳定后再开**，它不参与任何写入，随时可插

---

## 11. 开源与可扩展性

### 11.1 M0 就要做的四个便宜投资

| 投资 | 怎么做 | 不做的话以后要付什么 |
|---|---|---|
| workspace 分层 | `pnpm-workspace.yaml`：`apps/desktop`、`packages/core`、`packages/plugin-api`（只放类型） | 外部插件只能 import 整个 app，API 没法作为独立包发布 |
| 命令注册表 | 所有操作注册成 command（id / 标题 / 执行 / 快捷键），按钮和菜单只调命令 | 命令面板、插件注册功能、快捷键重绑都要逐个按钮改 |
| 管线可插拔 | 预览的 remark/rehype 链、导出钩子、编辑器扩展都由注册表组装，不写死在函数里 | 加一个新语法（如 v2 的双链）要动主干代码 |
| 契约单一来源 | IPC 通道 / 参数 / 返回值全在 `shared/`，带 `apiVersion` | 主/渲染不同步的问题周期性复发 |

**四个投资在 M0 已全部落地**（见 §12）。

### 11.2 插件运行时（v3，不是 v1）

- **位置**：`utilityProcess`（Node 侧）或 Web Worker（渲染侧）。**不在渲染进程内直接跑第三方代码**
- **能力**：通过消息桥暴露受控 API（读文档 / 写文档 / 注册命令 / 注册预览插件 / 注册导出钩子），**不给 `fs`、不给 `child_process`**
- **权限**：manifest 声明所需能力，安装时明示
- **为什么不在 v1**：插件 API 一旦发布就难改。先用内部注册表形态自用三个月，把接口跑熟再对外定 `apiVersion`，比现在拍脑袋定 API 要便宜得多

### 11.3 开源工程配套

- `LICENSE`（MIT 或 Apache-2.0）
- `CONTRIBUTING.md`：三条命令跑起来、代码结构地图、提交前检查清单
- `ARCHITECTURE.md`：把本文档第 3、5 节摘出来独立成文
- CI（GitHub Actions）：`lint + typecheck + test` 在 PR 上必跑；release workflow 用三平台 runner 出产物。这与“各自平台原生构建”不冲突——CI 只是把点按钮这件事自动化，不是交叉编译
- 打分矩阵：`good first issue` 标签挑“纯函数类”任务（slug 生成、路径改写、diff 解析），这类任务对新人最友好

### 11.4 开源后最可能被提的需求（提前划边界）

| 需求 | 现在的答案 |
|---|---|
| `[[双链]]` | 会连带需要“链接解析器”，验证过再排期 |
| 主题 / CSS 片段 | `markdown.css` 单一来源，天然支持，加个主题目录即可 |
| 网盘同步 | 库是纯文件，天然被 iCloud / 坚果云同步；应用内自建同步是另一件事，不做 |
| 移动端 | 不做。文件监听与 git 在移动端是另一套体系 |
| Vim 键位 | CodeMirror 有现成的 `@replit/codemirror-vim`（纯 JS），成本低，可放 v2 |
| 插件市场 | v3 之后的事，先有稳定的 API 再谈市场 |

---

## 12. 实现进度

### M0 · 骨架（已完成，2026-11-20）

已落地：

- pnpm workspace 三层：`apps/desktop`（Electron 三层）、`packages/core`（**环境无关**的共享类型与纯函数）、`packages/plugin-api`（插件类型，暂无运行时）
- 安全基线：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`、preload 白名单、打包后注入 CSP、拦截 `will-navigate` 与 `window.open`
- IPC 契约集中在 `src/shared/ipc.ts`，带 `API_VERSION = 1`，M0 只有三个通道：`app:ping`、`app:info`、`app:set-locale`
- 命令注册表 `renderer/src/commands.ts` + `⌘K` 命令面板；视图切换与语言切换都走 `runCommand(id)`，按钮里没有业务逻辑
- i18n：中文（默认）/ English，跟随系统语言，原生菜单与顶栏都能切
- 三态视图布局（纯编辑 / 分栏 / 阅读）+ 左树占位 + 状态栏自检信息
- 打包脚本三条与 `electron-builder.yml`（mac 不签名、Windows NSIS）

验收证据（**在打包后的 `.app` 里实测**，不只看 dev 模式）：

```json
{"bridge":"object","apiVersion":1,"brand":"飞码","segments":3,
 "status":"就绪IPC pong:hello","apiText":"API v1平台 darwin语言 zh-CN"}
```

即：React 已渲染、preload 桥在 sandbox + contextIsolation 下可用、IPC 往返成功。
包结构：`FreeMarkdown.app` / `com.freemarkdown.app` / `0.1.0` / `app.asar`。
`pnpm typecheck`（三个包）、`pnpm build`、`pnpm dist:dir`、`pnpm dev` 全部通过。

M0 期间踩到并已解决的三个环境坑（对后面有参考价值）：

1. **Electron 的 postinstall 没跑** → `dist/` 为空，`electron --version` 会挂住而不是报错。手动补跑 `node install.js` 解决，并在 `pnpm-workspace.yaml` 里用 `onlyBuiltDependencies` + `allowBuilds` 双写覆盖 pnpm 10 与 11 两套语义。
2. **TypeScript 7 移除了 `baseUrl`** → `paths` 必须写相对路径，否则 `TS5090`/`TS5102`。
3. **pnpm 11 会自己在 `pnpm-workspace.yaml` 里插入 `allowBuilds` 占位** → 手写同名 key 会变成重复键，需合并到同一处。

### M1 · 库与文件树（已完成，2026-11-20）

已落地：

- 主进程服务层：`services/paths.ts`（`normalizeRelPath` 拒绝 `..`/绝对路径/空字节，`resolveInside` 前缀校验防穿越）、`scanner.ts`（只读一层、忽略 `.git`/`node_modules`/`.DS_Store`、不跟随软链、目录优先 + `localeCompare(zh, numeric)`）、`watcher.ts`（chokidar，事件归约到父目录 + 150ms 批量 flush）、`config.ts`（`userData/config.json`，容错归一化 + 400ms 防抖 + 原子写）、`vault.ts`（realpath 归一 → `sha1(realpath).slice(0,16)` 作 id，最近列表裁到 12 条，启动时校验目录仍在）
- IPC 新增 8 个通道（`vault:open/current/switch/changed`、`tree:list/open-external/set-expanded/changed`），契约仍集中在 `shared/ipc.ts`
- 渲染层：`store/vaultStore.ts`（zustand：懒加载 children 缓存、展开状态持久化到配置、树事件按目录增量刷新）、`ExplorerPanel` 递归树（目录点击展开、md 点击选中、非 md 交系统打开）、无库空态 + 最近列表、`⌘O` 打开库、状态栏显示当前库
- **应用状态只写 userData，库目录内零痕迹**（实测库根目录前后无新增文件）

验收证据（**打包后的 `.app` 内实测**，`--remote-debugging-port=9333` + CDP 读真实 DOM）：

```json
{"before":["assets","notes","a.md","b.md","new.md","projects","README.md"],
 "after":["docs","index.md"],"tagline":"fm-vault-b"}
```

- 打开库后树立即渲染，`notes` 展开（配置里持久化的展开状态被正确恢复）
- Finder 外部新建 `notes/new.md` 与根目录 `projects`：约 0.5s 内出现；外部删除 `notes/todo.txt`：约 0.5s 内消失
- 点击 md 文件：行高亮 + 编辑区显示选中路径
- `switchTo(otherVaultId)`：树整体换成另一个库的 `docs`/`index.md`，无旧库残留行，品牌位与状态栏库名同步
- 折叠/展开写回 `config.json` 的 `ui.expanded[vaultId]`

M1 期间修掉的一个真 bug：早期 `reloadDirs` 在 `tree:list` 失败时把目录从「已展开」里摘掉，而 chokidar 事件常在文件落盘前毫秒级抢跑，导致展开的目录偶发整体折叠。改为「读失败保留旧快照 + 200ms 重试一次 + 只告警不破坏状态」。

图标（同批完成）：

- `build/icon-plate.png`：1024×1024，蓝色渐变形圆角方块底板 + 白鹅头（纯 Node 脚本合成，无外部依赖），派生 `build/icon.icns`（10 个尺寸）与 `build/icon.png`(512) 供 Windows 用
- `electron-builder.yml` 显式 `mac.icon: build/icon.icns`、`win.icon: build/icon.png`；实测 `Contents/Resources/icon.icns` 与源文件 MD5 一致
- 顶栏品牌位用同一张鹅头（透明 PNG + 蓝色圆形底盘），与 Dock 图标风格一致 —— **注意：此位将在 M1.5 随顶栏一并删除，鹅头只保留在 Dock 图标与设置面板的「关于」里**

### M1.5 · 界面重构（第一刀已完成，2026-11-20）

本轮（2026-11-20）通过逐条拷问定下的 9 个决策，已全部写入 §5.10–§5.13，开发按 PLAN 顺序推进：

| # | 决策 | 落点 |
|---|---|---|
| 1 | 整条顶栏删除，改为「左栏自带标题 + 内容区列头」 | §5.10 |
| 2 | 左栏：库名/折叠箭头 → 文件树 → 分类区（默认收起）→ 文档变更区 → 底部固定设置 | §5.10 |
| 3 | 左栏折叠后仍有入口：内容区左上角「展开侧栏」按钮、`Cmd+,`、`Cmd+F` 自动展开 | §5.10 |
| 4 | 编辑/分栏/阅读放内容区列头最右，图标化 + `Cmd+1/2/3` | §5.10 |
| 5 | 搜索 = 模式：三栏（侧栏\|结果\|编辑区），搜索态强制单栏，栏宽可拖并持久化，`Esc` 恢复原视图 | §5.3 |
| 6 | 结果 = 文件组头 + 至多 6 条命中行（行号+高亮+「还有 N 处」），扁平不嵌套，标题命中优先 | §5.3 |
| 7 | 分类写进 md 的 `categories` frontmatter；内置视图不占分类名；元数据缓存支撑计数与未分类 | §5.11 |
| 8 | 删除两段式：应用回收站（可还原）→ 彻底删除才进系统废纸篓；「删文件→打快照→还原→再打快照」在 git 里表现为「删除 + 新增」 | §5.12 |
| 9 | 文档变更区等 M5 一起上；首次打开库自动打「基线」快照做对比基准 | §5.13 |

**第一刀（布局骨架）已落地并验收**：

- 整条顶栏删除（`TopBar.tsx`、`CommandPalette.tsx` 已删），`titleBarStyle: 'hiddenInset'` + 侧栏 38px 拖拽区 + 内容列头拖拽，按钮 `-webkit-app-region: no-drag`
- 布局改为三区网格：`.shell` = 列 `248px | 1fr`、行 `1fr | 26px`；左栏占第一行，**状态栏横跨整窗底部**，侧栏不再伸到状态栏下方
- 左栏：库名 + 折叠按钮 → 文件树（`flex:1` 独立滚动）→ 「切换库…」贴树区底部 → **底部固定设置按钮**
- 内容区列头：折叠态时左侧出现「展开侧栏」按钮 + 文档名 + 右侧三态图标切换（`⌘1/2/3`，配置持久化）
- 设置面板：单容器双视图（设置 / 命令），设置含语言、快捷键一览（**直接从 `shortcuts.ts` 的 `titleKey` 渲染，不依赖命令注册表**）、关于（版本 + `API v{n}` + MIT）
- 快捷键：`shortcuts.ts` 为单一来源，`App` 只做 `matchShortcut` → `runCommand`；启动时 `detectConflicts()` 只告警不崩
- 新增 `ui:get` / `ui:set` 两个 IPC 通道（`UiState{viewMode,sidebarOpen}`），侧栏开合与视图模式都进 `config.json`，重启回到上次的样子

验收证据（**打包后的 `.app` 内 CDP 实测**，库 `fm-vault-m15`，展开态 `notes`）：

```json
{"topbar":false,"sidebar":"open","tree":["docs","notes","food.md","frontend.md","projects","README.md","todo.txt"],
 "foot":"设置","head":"选择左侧文件开始编辑","viewbtns":["viewbtn","viewbtn is-active","viewbtn"],
 "status":"就绪库 fm-vault-m15IPC pong:helloAPI v1平台 darwin语言 zh-CN"}
```

- `⌘B`：侧栏消失、列头出现「展开侧栏（⌘B）」按钮；再按回来
- `⌘,`：设置面板打开，快捷键表 10 行齐全（`⌘O/⌘, ⌘K ⌘F ⌘P ⌘B ⌘1 ⌘2 ⌘3 ⌘⇧L`）；`⌘K` 切到命令视图；`Esc` 关闭
- 三个图标按钮点按 → `data-view` 依次 `edit`/`read`/`split`；点 md 行 → 行高亮 + 列头显示文件名
- 改 `read` + 折叠后重启：`{"view":"read","sidebar":"closed"}` 全部恢复，且折叠态仍有展开按钮

**本轮修掉的三个真 bug**：

1. `.shell` 只定义了列、没定义行 → 内容列按内容撑高，面板与状态栏溢出到窗口外；改为显式 `grid-template-rows` + `minmax(0,1fr)`
2. 状态栏在窄窗口下换行、被 26px 行高裁掉 → 加 `white-space: nowrap` + `overflow: hidden`
3. **侧栏收起时红绿灯压在列头文档名与展开按钮上**（用户实机截图暴露）：`hiddenInset` 的红绿灯归系统绘制、不随 DOM 走，折叠态列头必须自己留 78px 左内边距

### M1.5b · 分类区与元数据缓存（已完成并验收，2026-11-20）

按 §5.11 落地「分类写 frontmatter + 元数据缓存 + 内置视图」，四层改动：

**core（单一真相）**

- `packages/core/src/frontmatter.ts`：不做 YAML 反序列化再序列化，只做「定位 `categories` 段 → 用原文切片拼回」。flow `[a, b]` 与 block `- a` 两种风格原位保留；无该键则按原风格追加；无 frontmatter 时插入只含 `categories` 的最小块；传空数组删键；**删掉最后一个键后整块只剩空白 → 连两条分隔线一起去掉**（不留 `---\n---`）；CRLF 原样保留；特殊字符分类名双引号转义
- 同时导出 `readCategories` / `readFrontmatterTitle` / `readFirstHeading`（跳过 ``` 与 ~~~ 围栏）/ `readDocMetadata`（title → 首个 H1 → 文件名）/ `normalizeCategories`

**主进程**

- `main/services/docMeta.ts`：只读文件头 16KB（`readFileHead`）判断 title/categories，写的时候才读全文；`applyCategories` 内容无变化不写盘（避免凭空多一条变更）；原子写
- `main/services/metaIndex.ts`：落盘 `<userData>/index/<vaultId>.json`（`{version,vaultId,updatedAt,files,recent}`），开库先用磁盘缓存铺一层、再后台 `scanAll` 只重读 mtime/size 变化的文件；`applyFileEvents` 走 watcher 增量；`setDocCategories` 走全局串行 `writeChain`；`markDocOpened` 记最近使用（上限 20）；`emit` 120ms 合并、`persist` 800ms 防抖 + 原子写
- `main/services/trash.ts`：只读 `<userData>/trash/<vaultId>/index.json` 给计数与列表（删除/还原本体在 M2、彻底删除与清理在 M5）
- `main/services/watcher.ts`：目录事件照旧喂树，新增文件级 `change` 事件与 `WatchedFileEvent{relPath, kind:'add'|'change'|'unlink'}`
- `main/services/config.ts`：`UiState` 增 `categoryOpen` / `categoryRatio`（`CATEGORY_MIN=0.1`、`CATEGORY_MAX=0.4`，默认收起 / 0.28），主进程与渲染层各夹一次

**契约与桥**

- `shared/ipc.ts` 增 5 个通道：`meta:snapshot`、`meta:set-categories`、`meta:mark-opened`、`meta:changed`、`trash:list`；`FmApi` 增 `meta` / `trash`；`API_VERSION` 仍为 1（首个外部插件尚未落地，通道属于内部对齐）
- `preload/index.ts` 白名单实现 `meta` / `trash`

**渲染层**

- `store/metaStore.ts`：`ViewSelection = tree | recent | uncategorized | trash | category`，分类勾选乐观更新，`openDoc` = 设 active + `markOpened`，切库回 `tree`
- `components/CategoryPanel.tsx`（默认收起，展开后按 `categoryRatio` 定高、`max-height:40%` 自带滚动，行 = 图标 + 名称 + 计数）
- `components/CategoryPicker.tsx`（右键 md 弹出：勾选即写、输入框回车建新分类、`Esc` / 点外关闭）
- `components/FilteredList.tsx`（扁平列表，标题 + 相对路径，返回按钮回文件树；回收站为只读列表）
- `ExplorerPanel.tsx` 按 `view` 切 tree / 过滤列表；`Sidebar.tsx` 插入分类区 + `axis="y"` 分隔条；`VerticalResizer` 支持横竖两轴；`App.tsx` 贯穿 `categoryOpen` / `categoryRatio` 持久化与 `categories.toggle` 命令

**验收证据（打包后的 `.app` 内 CDP 实测，库 `fm-vault-m15` / `0e81f7f6af5c4baa`）**

```json
{"scanning":false,"files":[["docs/index.md","索引",[]],["notes/food.md","食谱",["笔记"]],
 ["notes/frontend.md","前端",[]],["notes/yaml-case.md","YAML 保真测试",[]],["README.md","需求",[]]],
 "cats":[{"name":"笔记","count":1}],"uncategorized":4,"trash":0,
 "rows":[["最近使用","5"],["未分类","4"],["回收站","0"],["笔记","1"]]}
```

- **frontmatter 保真**：给 `notes/yaml-case.md`（`title/author/tags/date` 四键）写分类后 `diff` 只有两行差异，其余键与顺序 byte 级不变；无 frontmatter 的 `notes/food.md` 插入 `---\ncategories: [笔记]\n---\n`；清空后只删该键、**整块消失**（`# 前端\n\n笔记\n` 原样回来）
- **过滤视图**：点分类行 → `{"title":"笔记","count":"1 篇","items":[["食谱","notes/food.md"]]}`；点条目 → 列头 `food.md`、最近使用计数 +1
- **watcher 增量**：外部 `printf` 造 `notes/external.md`（带 `categories: [外部]`）1.2s 内分类区多出「外部 1」；`rm` 后 1.2s 内消失
- **分类区拖拽**：分隔条 -120px → `categoryRatio≈0.25` 且落盘；再 -450px → 钳到 0.40（40% 上限）
- **右键弹层**：`{"open":true,"title":"分类 · 前端","rows":[["笔记","1"]]}`；输入「未整理」回车 → 文件写进 `categories: [未整理]`，再点一次勾掉 → 文件复原

**本轮修掉的真 bug**

1. 分类区高度塌成 15px：`.categories__body` 用百分比高度，而父 `.categories` 是 `flex:none` + auto 高 → 把比例放到 `.categories` 自身（`.sidebar` 是网格行、高度确定），body 改 `flex:1 + min-height:0`
2. `VerticalResizer` 误用 `React.PointerEvent` 但没 import React → 改 `type PointerEvent as ReactPointerEvent`
3. `ExplorerPanel` 的 `onContextMenu` 参数用了 DOM `MouseEvent`（TS2740）→ 改 React 的 `ContextMenuEvent`
4. 合成 `PointerEvent` 调 `setPointerCapture` 必失败（pointerId 无效）→ 拖拽验收一律走 CDP `Input.dispatchMouseEvent`
5. 脚本里 `el.click()` 不派发 `mousedown`，分类弹层的「点外关闭」与勾选验收都失真 → 新增 `/tmp/fm-click.mjs` 走真实 Input 事件
6. 清空分类后留下空 `---\n---` 块 → `writeCategories` 在「删完最后一个键」时连分隔线一起去掉

**M1.5b 未覆盖（按 PLAN 属于后续里程碑）**

- 编辑区顶部 chip 行（前 3 个分类 + `+N`）依赖编辑器列头，落 M2
- 批量改分类（预览清单 → 确认 → 可回滚）未实现，随 M2 的多选一起做
- 首次打开大库只有 `scanning` 文案，无进度条
- 回收站本体（删除/还原/彻底删除/30 天 200 项清理）在 M2 / M5

### M2 编辑器与保存（2026-11-20 完成）

**core**
- `types.ts` 新增 `DocumentData{relPath,content,hash,mtimeMs,size,eol,bom}` 与 `DocumentWriteResult = {ok:true,doc} | {ok:false,reason:'conflict',doc}`；`TrashEntry` 增可选 `storedPath` / `isDir`
- `i18n.ts` 增约 25 条 `doc.*` / `trash.*` 与 `command.doc.save/delete` 中英各一份

**主进程**
- `services/documents.ts`：`readDocument` 把正文归一成 LF，**hash 算磁盘原文（含 BOM 与原始行尾）**；`writeDocument(relPath, content, baseHash?)` 先读盘比对 baseHash，不符就返回 `{ok:false,reason:'conflict'}` 且**绝不写**，相符才 `applyTextFormat` 还原 EOL/BOM → `writeFileAtomic`（tmp → fsync → rename，失败重试 3×150ms）→ 记自写 hash；`saveConflictCopy` 生成 `名字 (冲突副本 YYYY-MM-DD HH-MM-SS[ n]).md`（最多 50 次避让）；`inspectExternalChanges` 只看当前文档的 change 事件，先过 `isSelfWrite`（5s 窗口 + 磁盘 hash 比对）再广播
- `services/trash.ts` 重写：`moveToTrash` 保留相对结构到 `userData/trash/<vaultId>/<relPath>`（同名二次删除加 `.dup-N`）、索引原子写；`restoreFromTrash` 原位置被占则 `name (1).md` 循环避让；`purgeTrashEntry` 走 `shell.trashItem` 再摘索引并清空目录；`cleanupTrash` 30 天 / 200 项
- `ipc/doc.ts`（`doc:read/write/save-copy/set-active` + 外部改动广播）与 `ipc/trash.ts`（`trash:list/delete/restore/purge`）独立成文件；`main/index.ts` 接 watcher 的 `inspectExternalChanges` + `applyFileEvents` 双回调，切库时 `resetDocumentState()` 并 `cleanupTrash()`

**渲染层**
- `store/docStore.ts`：切文档前强制落盘；`updateContent` 800ms 防抖；`save` 带 baseHash（force 跳过）；冲突态三分支（保留我的 / 加载磁盘版本 / 另存副本）；`handleExternal` 无脏则静默重载并 `reloadToken+1`，有脏则弹冲突；`deleteDoc` 走应用回收站
- `editorStateCache.ts`：每文档缓存 `EditorState` + `scrollTop`，LRU 20 → **切文档回来 undo 历史还在**
- `components/Editor.tsx`：CodeMirror 6（行号 / 活动行 / 历史 / 选区绘制 / 换行 / markdown + 语言包 / 自定义高亮与浅色主题 / `readOnly` compartment / placeholder），`reloadToken` 变化时按行号比例保光标重设正文
- `EditorPane`：chip 行（分类前 3 + 「还有 N 个」+「＋」）、loading/error 态；`ConflictDialog` 复用 `.panel__backdrop` 三选卡；`StatusBar` 显示「未保存 / 正在保存 / 已保存 hh:mm:ss / 保存失败」
- 快捷命令：`⌘S`（doc.save）、`⌘⌫`（doc.delete）；`commands.ts` 新增 `file` 分组

**打包实测（打包后的 `.app` 内 CDP，非 dev）**

| 验收项 | 证据 |
| --- | --- |
| 自动保存 | 编辑器真输入 → 状态栏 `未保存` → 800ms 后 `已保存 17:36:32`，磁盘 `notes/food.md` 同步变更 |
| `⌘S` 立即落盘 | 输入后 50ms 内按 `⌘S`，文件立刻含新文本 |
| diff 最小 | 原文 1 行改动 → `diff` 输出 `1c1` 一行 + 「no newline at end of file」，无整篇重写 |
| CRLF/BOM 保留 | `notes/crlf.md`（UTF-8 BOM + CRLF）追加文本后：`bom True`、`crlf 7`、`bare_lf 0` |
| 外部冲突三选 | 本地脏 + 外部追加 → 弹「这个文件在应用之外被修改了」三选卡；选「加载磁盘版本」→ 正文换成磁盘版、dirty 清零；选「保留我的」→ 磁盘变成我的版本（外部那次丢弃，用户显式选择）；选「另存副本」→ 生成 `food (冲突副本 2026-11-20 17-45-35).md` 且原文件保持外部版本 |
| 回收站删除 | `⌘⌫` → 文件移入 `userData/trash/<vaultId>/notes/food.md`、索引记 `{relPath,storedPath,isDir,deletedAt}`、左栏计数 `回收站1`、编辑器清空 |
| 回收站还原 | 点「还原」→ 文件回原路径、内容 byte 级一致（`diff` SAME）、计数归 0 |
| 彻底删除 | 点「彻底删除」→ 索引摘除、库内文件消失、`shell.trashItem` 交系统废纸篓 |
| 连续输入不丢字 | 一次性插入 200 行（约 6KB）→ 1.6s 后 dirty=false，磁盘 203 行、`missing 0` |
| 切文档不丢字 | 输入后立刻切到别的文档 → 旧文档已落盘；切回来 undo 历史仍在（`⌘Z` 生效） |

**本轮修掉的真 bug**

1. **后台节流导致自动保存延迟**：窗口被遮挡时 Electron 把定时器节流到分钟级，800ms 防抖实际几分钟才落盘（外部冲突窗口被放大）→ `webPreferences.backgroundThrottling: false`
2. 判定「编辑器不渲染」是误判：真因是 `viewMode` 持久化成 `read`（只读态本就不挂编辑器），`window.fm.ui.set()` 直接写配置**不会驱动 React 重渲染**，必须走真实快捷键/点击
3. 冲突卡三选按钮宽度不齐 → `.conflict__choice` 补 `width:100% + align-items:flex-start`
4. 回收站行的时间戳在 252px 左栏被截断成 `2026...` → 改 `t('trash.deletedAt')` 只显示「删除于 11/20 17:58」

**M2 未覆盖（按 PLAN 属于后续里程碑）**

- 批量改分类（预览清单 → 确认 → 可回滚）未实现
- 目录级删除（整棵树进回收站）只有文件级 `⌘⌫`
- 预览本体、搜索三栏、时间机器、导出分别落 M3 / M4 / M5 / M7


### M3 预览（2026-11-23 完成）

**实现**（全部在 `apps/desktop/src/renderer/src/preview/`，渲染层纯 JS，依赖里仍无原生模块）

| 文件 | 职责 |
| --- | --- |
| `pipeline.ts` | `remark-parse + gfm + math + frontmatter` → 按顶层 mdast 节点切块；每块单独跑 `remarkRehype(allowDangerousHtml) → rehype-raw → 白名单清洗 → rehype-katex`；FNV-1a 哈希做 400 条块缓存；块 key = `type:hash:startLine` + 重复序号；脚注定义单独收集、末尾拼 `<section class="footnotes">` |
| `sanitize.ts` | 自写 rehype 白名单（不用 DOMPurify，说明见下）：`ALLOWED_TAGS` / `DROP_TAGS`（script、style、iframe、svg… 连内容丢）/ `KEEP_ATTRS`（**驼峰名比对**，`data-*` 全放行）/ `on*` 与用户 `style` 一律删 / `href`、`src` 过 `safeUrl`（拒 `javascript:`、`vbscript:`，`data:` 只留 `data:image/`）/ `input` 非 checkbox 清空属性 |
| `hastToReact.tsx` | hast → React；`<pre><code class="language-mermaid">` 转 `<MermaidBlock>`；`VOID_TAGS` 保证空元素不带 children；`style` 解析成 React style 对象并按布局白名单放行（KaTeX 靠它定位上下标/分式，`color: transparent` 用来隐藏 `\phantom` 占位符） |
| `mermaidRender.ts` | 全局串行链 + LRU 200（key = `source.trim()`）+ 懒 `import('mermaid')` + `securityLevel:'strict'` |
| `MermaidBlock.tsx` | 异步渲染、失败显示「图表渲染失败」+ 源码、未完成时显示前 4 行占位 |
| `Preview.tsx` | 300ms 渲染防抖、首帧同步渲染、`data-line`/`data-end-line` 包块、`scrollToLine/scrollToBottom/lineAtTop` API、块内比例换算、80ms 滚动节流 |
| `scrollSync.ts` | `scrollEditorToLine` / `topLineOfEditor` / `isEditorAtBottom` / `scrollEditorToBottom` |

**验收（打包后的 `.app` + CDP，测试稿 `notes/preview-test.md`）**

| 验收项 | 证据 |
| --- | --- |
| 图表 | 30 个块里 4 个 mermaid（流程图/时序图/类图/状态图，含中文标签）全部出 `<svg>`，无错误块 |
| 公式 | KaTeX 10 个：3 行内 + 7 块级；`E=mc²`、积分 `1/3`、`\sum`、`pmatrix`、`\lim`、`e^{iπ}+1=0` 均正常；mhchem 三处 `\ce{}` 渲染成 `2 H₂ + O₂ ⟶ 2 H₂O`、`CO₂ + Ca(OH)₂ ⟶ CaCO₃↓ + H₂O` |
| 内联 HTML | `<div class="note">` 保留（class 未被剥），`<script>window.__pwned=1</script>` 未执行（`window.__pwned === undefined`） |
| XSS | `<img src="javascript:alert(1)">` 的 `src` 被剥（`img[src*=javascript]` 计数 0）、`onerror`/`onclick` 清零 |
| GFM | 表格 1 个、任务框 3 个（复选框只读、圆点已去掉）、脚注引用 + 末尾「脚注」区（编号与引用顺序对齐） |
| 三态 | `⌘2` 分栏（编辑器 + 预览）、`⌘3` 只读（只剩 `pane--preview`，正文 780px 阅读宽度居中） |
| 滚动同步 | 双向各 7 个位置实测：编辑器→预览 偏差 0 个块（顶部兜底 1 个块）；预览→编辑器 全部落在同一块内；到文档末尾时两边一起贴底（不再各停一处） |
| 500 行手感 | 541 行（含 5 mermaid + 20 公式）打开到预览出齐 1077ms；逐字输入 35 字（12ms/字）`longtask` 计数 0，预览 300ms 防抖后仍是 45 块 / 20 公式 / 5 SVG |
| mermaid 缓存 | 编辑别的段落后，首个 `<svg>` 的 DOM 节点引用保持不变（`sameSvg === true`）→ 块未重算、图表没重绘没闪 |

**本轮修掉的真 bug（都是「看着像渲染坏了，其实是数据没给对」）**

1. **React #137 白屏**：`createElement('img', {children})` → 加 `VOID_TAGS`，空元素不传 children
2. **sanitize 误删 `className`**：hast 的属性键是驼峰（`className`/`dataFootnoteRef`），白名单却按 HTML 小写名（`class`/`data-footnote-ref`）比对 → KaTeX 失去 `math math-inline`、`code` 失去 `language-mermaid`，于是公式 0 个、图表 0 个、内联 `.note` 查不到
3. **KaTeX 内联 style 被丢**：`hastToReact` 里 `if (key === 'style') continue` → 上下标、分式全塌到基线；改为按键白名单解析成 React style。`\phantom` 的 `X` 之所以漏出来，是因为 KaTeX 用 `color: transparent` 隐藏它，而白名单没有 `color`
4. **三份 katex 副本**：`rehype-katex` 用 0.16.47、我们直接依赖 0.19.1、mermaid 用 0.18.11 → `import 'katex/contrib/mhchem'` 注册到了另一个实例上，`\ce{}` 原样输出。`pnpm-workspace.yaml` 加 `overrides: katex 0.16.47` 收敛成单实例
5. **脚注区不渲染**：逐块转换时 remark-rehype 拿不到「引用 + 定义同一棵树」的上下文，`section.footnotes` 根本不生成 → 自己按引用出现顺序拼 section（`li` 的 id 与引用的 `#user-content-fn-*` 对齐）
6. **单行 `$$x$$` 被当行内公式**：remark-math 对单行 `$$…$$` 按 inline 处理，7 个块级公式全左对齐、字号偏小 → 解析前做「围栏感知」的归一化，把整行 `$$…$$` 补成三行块级写法（代码块内不动）
7. **滚动同步抖**：程序化滚动会回灌触发对向的同步，形成来回拉扯 → 400ms 方向锁 + 「编辑器到底/目标行顶不动」时两边一起贴底（后者的判定要等一帧，`dispatch` 之后 DOM 还没落位）

**偏离说明**

- 预览消毒用 hast 树逐节点白名单，没用 DOMPurify：hast 阶段能精确控制「丢内容还是留文本」，且不必把 HTML 再序列化一遍；DOMPurify 留给 M7 导出 HTML 兜底
- mermaid 用 `securityLevel: 'strict'`，图表里的 HTML label 会被 mermaid 自己净化，不额外接管

**M3 未覆盖（属后续里程碑）**

- 预览里点 `.md` 链接不做站内跳转（外链由主进程拒新窗口）
- 预览不做「点击块定位到源码行」的双向反查（当前只有滚动同步）
- 导出 HTML/PDF/Word 的样式复用 `styles/markdown.css`，实际导出在 M7

### M4 搜索（2026-11-23 完成）

**实现**（纯 JS，依赖里仍无原生模块、无全文索引）

| 文件 | 职责 |
| --- | --- |
| `packages/core/src/search.ts` | 纯函数层：`findTextHits`（逐行 `indexOf`，英文大小写不敏感、中文原样，长行按 60 字前缀裁 `…`，单文件上限 300 行）、`matchesTitle`、`compareSearchResults`（文件名/标题命中优先 → 组内 mtime 倒序）、`scoreFuzzy`（子序列 + 连续/词边界/首字母/开头加分 − 跨距惩罚）、`rankQuickOpen`（name 命中优先，path 命中带 `viaPath`） |
| `apps/desktop/src/main/services/search.ts` | 全库 `walkMarkdown`（与 scanner 同一套忽略规则）→ 按 mtime 倒序候选 → 并发 8 读文件 → 70ms 或 40 条一批 `search:batch` 推给渲染层；先发 `{scanned:0,total}` 进度批，结尾 `done:true`；模块级 `scanToken` 让新请求把旧扫描逐文件退出（真正可中断） |
| `apps/desktop/src/main/ipc/search.ts` | `search:start` 校验 requestId / text（≤200 字）/ titleOnly，`void startSearch()` 立即返回；`search:cancel` |
| `renderer/src/store/searchStore.ts` | 120ms 输入防抖、`sequence` 请求号、过期批次丢弃、合并后重排、`closeSearch` 清结果并 `cancel`、切库重扫、跳行状态 |
| `renderer/src/components/SearchPanel.tsx` | 输入框（自动聚焦全选）+ spinner + Esc 关闭；状态行「N 个文件 · M 处命中」/「正在扫描 x/y」/「没有找到匹配」；列头右「只看标题命中」；组头 = 文件名 + 相对路径 + 命中数；每组至多 6 行（行号 + 单行原文 + `<mark>` + 行内次数），超出「还有 N 处」可展开（上限 100）；最多渲染 200 个文件组；`limited` 黄色警告 |
| `renderer/src/components/QuickOpen.tsx` | 620px 弹窗 + 遮罩，候选取自 `metaIndex` 的文件清单，`rankQuickOpen` 排序，↑↓ / Enter / Esc，命中字符加粗 |

接线：`App.tsx` 搜索态用 `.search-layout`（`searchWidth` | 5px 分隔 | 内容区），搜索结果栏可拖 300–480、双击 340 并落盘；搜索中强制单栏、关闭后恢复原视图与栏宽；`⌘F` 是开关，`Esc` 分层（QuickOpen → 搜索），收起侧栏自动退出搜索但保留 query；命中跳行等 `docRelPath` 与 `jump` 对齐且编辑器就绪后 `rAF` 滚到行；`⌘P` 走 `file.quick-open` 命令。

**验收（打包后的 `.app` + CDP，1003 个 md 的测试库；性能数据用 995 个 `bulk/` 生成稿，验收后已清理）**

| 验收项 | 证据 |
| --- | --- |
| 打开手感 | `⌘F` 打开后输入框已聚焦全选，结果栏 340px；1000+ 文件首屏 **214ms**（< 300ms 目标） |
| 命中统计 | `导出` → `101 个文件 · 110 处命中`；`量子猫` → `3 个文件 · 6 处命中`（中文原样匹配） |
| 折叠 | `ten-hits.md` 命中 10 处 → 显示 6 行 + 「还有 4 处」+ 组头徽标 `10`；展开后全部可见 |
| 分栏拒绝 | 搜索中 `⌘2` → toast「搜索中暂不能分栏」，布局仍是三栏 |
| 跳行 | 搜「第 6-36 行」点第 300 行 → 编辑器 `scrollTop 8602`，首屏落在第 300 行附近 |
| 关闭恢复 | `Esc`/再点放大镜 → `data-view=split`、两栏各 `0.5fr`、列头回来 |
| 记住 query | 关闭后再 `⌘F` → 输入框仍是上次的关键词并立即出结果 |
| 只看标题 | 勾选后只剩标题含关键词的文件，状态行改口径为「1 个文件（标题命中）」 |
| ⌘P | 输入 `fron` → 唯一行 `frontend.md`（路径 `notes/frontend.md`），Enter 打开、Esc 无副作用 |
| 侧栏联动 | `⌘B` 收起侧栏 → 搜索自动关闭，展开按钮常驻列头 |
| 控制台 | 重载后 Runtime 异常 / console 错误均为 0 |

**本轮修掉的问题**

- 「只看标题命中」时状态行仍写「0 处命中」，读起来像失败 → 单独口径「N 个文件（标题命中）」（`search.summaryTitles`）
- 搜索态原先把整条内容列头让掉了，连带「当前打开的是哪篇」的标题一起消失（用户 2026-11-23 反馈）→ 搜索时保留列头：标题照旧绝对居中、三态按钮照旧（`⌘2` 仍被拒），放大镜胶囊显示为激活态表示正在搜索；结果栏输入行落在列头下方
- 设置 / 冲突弹窗的遮罩没有 z-index，被 `.resizer`（`z-index: 5`）的栏间分隔线压在弹窗上面（用户 2026-11-23 反馈）→ `.panel__backdrop` 提到 `z-index: 50`，遮罩与弹窗整体盖住所有栏线；冲突弹窗复用同一遮罩，一并修好

**偏离说明**

- `⌘P` 原计划用 `fuse.js`，实际自写 `scoreFuzzy`：只是文件名子序列匹配，自写纯函数可单测、少一个依赖，也避免为它单独调权重

**M4 未覆盖 / 待确认**

- 结果不随 watcher 实时刷新（库内新增文件需重开搜索）
- 结果栏没有排序下拉（固定「文件名/标题命中优先 → mtime 倒序」）
- 搜索命中不在预览里高亮联动（跳行只定位不染色）
- 搜索中 `⌘1`/`⌘3` 仍可切换（只拦了 `⌘2`），是否符合预期待定
- 每文件 6 行折叠、展开上限 100、最多 200 个文件组是本轮自加的防线，等验收

### M5 时间机器 + 文档变更（2026-11-23 完成）

**实现**

| 文件 | 职责 |
| --- | --- |
| `apps/desktop/src/main/services/history.ts` | 独立仓库 `userData/history/<vaultId>/`（`--git-dir` + `--work-tree`，库目录零 `.git`）；所有 git 命令走隔离 env（`GIT_CONFIG_NOSYSTEM=1`、`GIT_CONFIG_GLOBAL=/dev/null`、`-c core.hooksPath=/dev/null`、`-c core.autocrlf=false`、`LC_ALL=C`）；双 ref：`refs/heads/snapshots`（仅手动）+ `refs/protect`（基线/切快照前的保护快照）；`ensureHistory` / `saveSnapshot` / `listSnapshots` / `getSnapshotDetail` / 快照与工作区文件 diff / `rewindToSnapshot` / `deleteSnapshot` / `trimProtect` / `noteWorkingTreeChanged` |
| `apps/desktop/src/main/ipc/history.ts` | `history:status/list/save/detail/snapshot-diff/changes/working-diff/rewind/delete/changed`；切快照后广播整棵树、`rescanIndex()`、刷新回收站灰显；`subscribeHistoryBroadcast()` 只订阅一次 |
| `packages/core/src/diff.ts` | 纯函数行级 diff：先削公共前后缀、中间 LCS（DP 上限 2,000,000 格，超限退化为整段删 + 整段增），最多渲染 12,000 行；空文本 0 行、末尾换行不单独算行 |
| `packages/core/src/types.ts` / `i18n.ts` | `HistoryStatus` / `SnapshotDetail` / `WorkingChange` / `FileDiff` / `SnapshotSaveResult` / `RewindResult`；history/changes/diff/trash/command 中英各 50 键 |
| `renderer/src/store/historyStore.ts` | 启动 `refreshAll()`；订阅 `history:changed`（`rewind` 时强制重读当前文档 + 刷新元数据）；订阅库切换清空；保存/详情/两种 diff/切快照/删除全部经 store |
| `renderer/src/components/SnapshotDialog.tsx` | 保存快照弹窗：自动聚焦、placeholder「备注（可选）」、留空自动生成提示、「Enter 保存 · Esc 取消」；`Esc` 不产生 commit |
| `renderer/src/components/SnapshotDrawer.tsx` | 右侧 360px 抽屉：行 = 标题/时间/文件数/`+N −M`，自动文案置灰；点击行展开文件清单（A/M/D），点文件开 diff；底部「删除快照 / 切换到此快照」；两种二次确认（删除三点说明） |
| `renderer/src/components/DiffView.tsx` | 左右双栏只读 diff：行号 + 旧/新文本，删除行左侧红底、新增行右侧绿底；二进制/截断提示；`Esc`/遮罩/× 关闭 |
| `renderer/src/components/ChangesPanel.tsx` | 左栏「文档变更」插在分类区与设置之间，相对最近手动快照（无则基线）的 `M/A/D` + 路径 + `+N −M`；点一行开工作区 diff |
| 接线 | `ContentHeader` 加相机/时钟胶囊；`App.tsx` 注册 `history.save` / `history.open` 命令并调用 `initHistoryStore()`；`shortcuts.ts` 加 `mod+shift+s`；`styles.css` 新增时间机器、diff、确认卡、禁用态样式；`FilteredList` 对 `supersededBy` 的回收站条目禁用「还原」并显示「已被快照取代」 |

**验收（打包后的 `.app` + CDP，测试库 `/private/tmp/fm-vault-m15`）**

| 验收项 | 证据 |
| --- | --- |
| 类型 / 构建 | `pnpm -r typecheck` 全绿；`pnpm build` + `electron-builder --dir --mac --x64` 成功，打包后启动正常 |
| 列头入口 | 列头左组 4 个胶囊（侧栏/搜索/相机/时钟）；无库或 git 未就绪时相机/时钟置灰；打开抽屉后时钟 active |
| 保存快照（有备注） | 相机 / `⌘⇧S` 打开弹窗，输入「M5 UI 验收快照」保存；列表从 1 条变 2 条，详情 1 文件 `+2 −0`；`changes` 清空 |
| 保存快照（留空） | 不填备注保存 → 标题「快照 · 2026-11-23 16:57 · 1 个文件」，与行内「1 个文件」一致（自动 N 改为本次改动文件数） |
| Esc 取消 | 弹窗内 `Esc` 关闭且列表条数不变（不产生 commit）；若抽屉同时打开，只关弹窗、抽屉保留 |
| 抽屉 | 宽 360px、只列 2 条手动快照；自动文案置灰；行内时间 / 文件数 / `+4 −0` / 「最新」徽标正确 |
| 详情 | 点行展开「本次改动」文件清单；点文件打开双栏 diff（`history-test.md` 旧 6 行 / 新 10 行，右侧 4 行绿底） |
| 工作区 diff | 追加两行后左栏「文档变更」立即出现 `M history-test.md +2`；点开双栏 diff，新增行右侧绿底；新增文件不再多出幽灵空行 |
| 切快照（二次确认） | 确认卡写明「先打保护快照 / 目标没有的文件进回收站 / 历史不改写」；确认后编辑器自动重读：插入的「（编辑器输入测试）」消失、标题仍为 `history-test.md`、`dirty=false`、变更清空 |
| 删除快照（二次确认） | 三点说明齐全；删掉中间一条后 3 条 → 2 条、当前正文不变、详情折叠、列表刷新 |
| 回收站 superseded | `notes/food.md` 行显示「已被快照取代」，「还原」按钮 disabled，「彻底删除」仍可用 |
| 中英双语 | `⌘⇧L` 切 English 后，「Document changes」「Time machine」「No changes since the latest snapshot」等全部有文案，无裸 key |
| 100 次快照压测 | 隔离库连续 100 次「改一行 → 保存」全部成功；`git rev-list --count refs/heads/snapshots` = 100；`git fsck --no-progress` 退出码 0，仅 `HEAD points to an unborn branch` 提示，无对象损坏；压测仓库与库副本验收后删除 |

**本轮修掉的真 bug**

1. **一个 `Esc` 关两层**：保存弹窗/删除确认的 keydown 与 `App` 全局 Esc 同时执行，导致「确认卡 + 抽屉」一起消失 → 弹层内 `preventDefault + stopPropagation`，确认卡显式 `focus()`，`App` 在 `event.defaultPrevented` 时直接返回
2. **自动快照 N 说谎**：原先用 `countTree`（整库 9 个文件），行内却是本次改动 1 个文件 → 改为 `countChanged(compare, tree)`，标题与列表统一口径
3. **切换快照详情不刷新**：点第二条时旧详情还在，effect 因 `detail !== null` 不触发 → 切换行时先清空 `detail/detailError` 再加载
4. **新增文件的幽灵空行**：`''.split('
')` 得到 1 行、末尾 `
` 再留 1 行空行，导致新增文件 diff 左侧出现一个无意义行号 → `toLines()` 让空文本 0 行、末尾换行不单独算行
5. **回收站「还原」会和快照打架**：被快照取代的条目仍可点还原 → `FilteredList` 按 `supersededBy` disabled，并显示「已被快照取代」

**偏离说明**

- 切快照也加了二次确认（PLAN 原先只强制删除要确认）：切快照会改工作区并可能把文件移入回收站，误点代价高于多一次点击
- 文档变更区不随 watcher 每 500ms 自动重算 git diff，而是由 `history:changed(files)` 事件驱动 `refreshAll()`；避免输入时反复跑 git
- 自动快照仍不显示在列表中；切快照前保护快照只进 `refs/protect`，滚动保留 50 条 / 7 天

**M5 未覆盖 / 待确认**

- 保护链 50 条 / 7 天裁剪逻辑已实现，但没有单独制造 50+ 次切快照去验证裁剪结果
- 二进制文件、>2MB 截断的 diff 只有类型与提示，未在 UI 里用真实大文件点开验证
- 删除「当前正打开文档所属的快照」没有额外提示（内容本来不变，只是列表少一条）
- 抽屉开合状态没有写进 config，重启后总是关闭
- 100 快照压测只在隔离库验证 `fsck`，没测抽屉一次渲染 100 行的滚动性能

下一步开发顺序（严格按 §6）：**M6 剩余打磨（忽略规则、回收站保留期、空态规范）→ M7 导出**。主题三态与左栏文件管理已在 M6.5 提前补齐。

### M6 打磨与打包（进行中，2026-11-23）

**已完成**

| 项 | 结果 |
| --- | --- |
| 渲染层错误边界 | 新增 `renderer/src/components/ErrorBoundary.tsx` 并包住 `<App/>`：组件树抛错不再白屏，显示双语错误页、具体报错、可展开堆栈、「重新加载」「复制错误信息」；文档已落盘不受影响 |
| DMG 产物 | `apps/desktop/dist/FreeMarkdown-0.1.0.dmg`，149MB，内含 `FreeMarkdown.app` + `Applications` 快捷方式；unsigned（`identity explicitly set to null`）。2026-11-24 随 M6.5 重新打包，最新包已通过挂载卷启动冒烟 |
| 安装冒烟 | DMG 已挂载并通过校验；直接从挂载卷启动 `FreeMarkdown.app`（CDP 9334）可正常加载 m15 库、2 条快照与左栏「文档变更」，说明包内资源、userData、git 路径在只读卷下均正常 |

**M6 未完成**

- 设置页补项：忽略规则、回收站保留期可配置（当前保留期仍是代码内 30 天 / 200 项）；主题（跟随系统/浅/深）已在 M6.5 补齐
- 加载态与空态逐页审一遍（首次开库、空库、空搜索、空快照已有基础态，未做统一规范）
- 版本号仍为 `0.1.0`；未做签名/公证（按既定范围排除），别的机器首次打开需右键「打开」绕过 Gatekeeper
- 三平台脚本按「只构建当前系统、不交叉编译」的硬纪律，不新增交叉构建矩阵

### M6.5 主题三态与左栏文件管理（已完成，2026-11-24）

设计依据：`docs/文件管理与主题切换设计.md`。文件管理完全围绕左栏真实目录树，不另做独立文档管理中心；所有入口都落到真实文件系统，主进程仍是唯一写盘方。

**范围与已确认交互**

| 能力 | 最终行为 |
| --- | --- |
| 主题三态 | 设置页「外观」= 跟随系统 / 浅色 / 深色，默认跟随系统；切换即时生效并写入 `userData/config.json` |
| 新建 | 库名右侧常驻 `＋` →「新建文档 `⌘N`」/「新建文件夹 `⌘⇧N`」；树行与空白处右键也可新建。树内行内输入，Enter 提交、Esc 取消、失焦提交 |
| 重命名 | 树内就地输入，`F2` 或右键进入；只选主名，`.md` 后缀固定；Enter 提交、Esc 还原；校验失败留在输入态并重新聚焦 |
| 单文件删除 | 立即移入应用回收站，toast 提供 8 秒「撤销」；超时后仍可从回收站还原 |
| 文件夹删除 | 固定二次确认；整目录移入应用回收站，可整目录还原 |
| 右键菜单 | 新建文档/文件夹、重命名、移到回收站、设置分类（仅 md）、在 Finder 显示、复制相对路径；贴边翻转、外点/Esc 关闭 |

**主题链路**

- `packages/core/src/types.ts` 新增 `ThemePreference = 'system' | 'light' | 'dark'`；`AppConfig.ui.theme` 默认 `system`，旧配置经 `normalize` 自动补迁移。
- 新增 `app:theme-get` / `app:theme-set`，preload 暴露 `window.fm.theme.get()/set(preference)`；`API_VERSION` 仍为 `1`。
- 主进程在 `loadConfig()` 之后、建窗之前设置 `nativeTheme.themeSource`；窗口 `backgroundColor` 按 `nativeTheme.shouldUseDarkColors` 选 `#15171b` / `#f5f6f8`，切换时同步更新所有窗口。
- 渲染层 `store/themeStore.ts` 维护偏好与解析结果：`system` 用 `matchMedia('(prefers-color-scheme: dark)')` 跟随系统并监听变化；切换乐观更新，写入失败回滚；最终只写 `documentElement.dataset.theme`。
- `SettingsPanel` 增加「外观」三态与系统模式提示；`App` 注册 `theme.system` / `theme.light` / `theme.dark` 命令并初始化主题。
- CodeMirror 用 `themeCompartment` + 浅/深两套 `HighlightStyle`，切换只 `reconfigure`，不重建 `EditorView`，编辑器状态与撤销历史不丢。
- Mermaid 改为按当前主题初始化，主题变化清缓存；缓存 key 带主题，`MermaidBlock` 依赖 `[source, theme]`。
- `styles.css` 与 `styles/markdown.css` 做语义 token 化；文件末尾用 `@media (prefers-color-scheme: dark)` 覆盖深色 token、toast、滚动条与阴影。

**文件管理后端**

- `packages/core/src/types.ts` 新增 `FileOpErrorCode`（`exists | invalid-name | not-found | permission | unsupported`）、`FileOpFailure`、`FileCreateValue`、`FileRenameValue`、`FileOpResult<T>`。
- 新增 `files:create` / `files:rename` / `files:remove` / `files:reveal`，preload 暴露 `window.fm.files.create/rename/remove/reveal`。
- `main/services/fileOps.ts`：名字 `trim`、长度上限 120、禁 `/ \ : NUL`、禁 `.` `..`、禁 `.git` / `node_modules` / `.DS_Store`；文档自动补 `.md`；`createEntry` 用 `open(..., 'wx')` 原子占位，避免并发覆盖；`renameEntry` 同级改名，仅大小写变化走「临时名 → 目标名」两步；`removeEntry` 复用 `moveToTrash`，文件夹整棵进回收站。
- `main/ipc/files.ts`：全部入参校验；成功后广播父目录并 `void rescanIndex()`；删除后 `refreshTrashAndEmit()`；`files:reveal` 用 `shell.showItemInFolder`。
- 实测发现大小写改名 bug：大小写不敏感 APFS 上 `exists(targetAbs)` 把同一文件判成冲突，先返回 `exists`。已改为先算 `caseOnly`，仅非大小写改名才查重；`renamed-doc.md → RENAMED-DOC.md → renamed-doc.md` 双向通过。
- 该 bug 顺带暴露运行纪律：改主进程后必须真正重启 Electron；旧进程占着 9333 时 CDP 仍连旧 main，会误判修复无效。停进程用 `pkill -f "Electron ./apps/desktop"`，必要时 `lsof -ti tcp:9333 | xargs kill -TERM`。

**树交互与状态同步**

- `vaultStore` 新增 `selectedPath` / `selectedKind`、`pendingCreate`、`renamingPath`，以及 `select`、`startCreate(kind, dir?)`、`cancelCreate`、`startRename`、`cancelRename`、`expandDir`、`applyRename`、`applyDelete`。
- `startCreate` 无显式目录时按选中项推断：选目录建在该目录，选文件建在其父目录；无选中则用当前文档父目录。
- `applyRename` 同步展开状态前缀、清目录缓存、更新选中路径；`applyDelete` 按路径前缀清展开状态、缓存与选中。
- `docStore` 新增 `retargetPath`（只改路径，不重读正文，保留编辑器与撤销历史）与 `clearIfUnder`（当前文档在删除目录下时干净回到空态）。
- `ExplorerPanel` 重写为真实树交互：行选中态、行 hover `⋯`、右键菜单、空白右键、`＋` 菜单、行内新建/重命名、重名红色错误、失焦提交、Esc 取消、删除 toast 撤销、文件夹确认卡。
- 新增 `TreeMenu.tsx`：固定定位、贴边翻转、外点/Esc 关闭、打开后聚焦第一项。
- `Sidebar` 库名右侧增加常驻 `＋`，通过 `fm:add-menu` 自定义事件把坐标交给 `ExplorerPanel`；`ExplorerPanel` 通过 `fm:file-command` 接收 App 命令。
- `App` 新增 `file.new` (`⌘N`)、`file.newFolder` (`⌘⇧N`)、`file.rename` (`F2`)；`doc.delete` (`⌘⌫`) 改为向树发删除事件，不再直调 `docStore.deleteDoc()`。
- `FilteredList` 回收站按 `item.isDir` 显示文件夹图标。

**实测通过**

- `＋` → 菜单 → 树顶行内输入预填「未命名」、仅主名选中、`.md` 固定；Enter 创建并自动打开新文档，Esc 取消不落盘。
- 重名提交 `renamed-doc` → 红框 +「同级已有同名项」，保持输入态并重新聚焦。
- 文件夹右键新建文档 → 建在该目录下并打开；空白处右键同样可用。
- 行内重命名当前文档 → 标题与树同步，正文与编辑器状态保留。
- 重命名有打开子文档的文件夹 → 树、展开状态、当前文档路径全部跟随；继续输入并等待自动保存，内容写入新路径文件，证明 `retargetPath` 生效。
- 文件夹删除 → 二次确认 → 整目录进回收站、当前子文档关闭、toast 提供撤销。
- 单文件删除 → 立即进回收站、toast 8 秒撤销；点击撤销真实恢复文件。
- 失焦提交：新建输入后点其他区域自动创建并打开。
- `⌘N` / `⌘⇧N` / `F2` / `⌘⌫` 均实测有效；`F2` 由 `matchShortcut` 单独接住无 mod 的 F2。
- 深色设置页三态与持久化：点「浅色」→ `pref=light`、`dataset=light`；点「深色」→ `pref=dark`、`dataset=dark`；恢复「跟随系统」后 `pref=system`、系统浅色时 `dataset=light`。
- 深色 Mermaid 与深色 diff 均正常：4 个 Mermaid SVG 可读，diff 新增行绿底、路径与行号可读。

**本轮修掉的 bug**

- `renderMermaid` 把缓存 key `${theme}:${source}` 误当源码传给 `mermaid.render`，深色下报 `No diagram type detected ... text: light:graph TD...`；已改为 `mermaid.render(id, source.trim())`。
- 大小写改名被 `exists` 误判冲突；已先判 `caseOnly`。
- 撤销成功提示误用「已移到回收站」；新增 `file.restored` 文案。
- 全局颜色替换留下的两处坏 token `var(--on-accent)7e6` / `var(--on-accent)af0` 改为 `var(--warning-bg)`；三处未定义 `var(--line)` 改为 `var(--border)`。
- 回收站里的目录显示 Markdown 图标；改用 `FolderIcon`。

**未覆盖 / 后续**

- 树没有虚拟滚动；1000+ 文件全部展开的首屏与滚动成本未单独压测。
- 新建/重命名只支持同级，不做拖拽移动或跨目录移动。
- 忽略规则、回收站保留期设置仍属 M6 剩余项，本轮未做。
- 最新 `apps/desktop/out` 已重建；`apps/desktop/dist/FreeMarkdown-0.1.0.dmg` 已于 2026-11-24 重新打包（149MB，unsigned），挂载卷内应用已在 9334 端口冒烟：`theme.get()` 返回 `system`，`files.create/rename/remove/reveal` 四个 API 均为函数。签名/公证仍按既定范围排除。

验收截图已落到 `docs/`：`screenshot-m6-light.png`、`screenshot-m6-settings-dark.png`、`screenshot-m6-dark-mermaid.png`、`screenshot-m6-create-inline.png`、`screenshot-m6-folder-confirm.png`（另有 `screenshot-m6-menu.png` 记录树右键菜单）。


---

## 附录：几处「看起来省事但会后悔」的地方

- 用 `innerHTML` 刷预览 → 图片闪、滚动跳、mermaid 反复算
- 用 `unlink` 删文件 → 一次误点，稿子真没了
- 用百分比做滚动同步 → 有图有图表的文档必然错位
- 把自动保护快照写进主链 → 时间机器列表被 autosave 淹没，且删除时重建成本变高
- 用用户库里的 `.git` → 三个月后 `git bisect` 找不到有用的提交
- 每次快照 `git status` 走一遍却没有 index 缓存纪律 → 大库上每点一次等三秒
