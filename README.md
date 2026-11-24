# FreeMarkdown（飞码）

本地 Markdown 编辑与管理应用。库目录是唯一真相，应用不拥有任何状态。

- 技术栈：Electron + React + TypeScript（electron-vite）
- 许可证：MIT
- 界面语言：中文（默认）/ English

## 运行

```bash
pnpm install
pnpm dev
```

## 构建与打包

```bash
pnpm build            # 编译主/预加载/渲染三层到 apps/desktop/out
pnpm dist:dir         # 打包成未压缩的应用目录（最快，用于冒烟）
pnpm dist:mac-x64     # macOS Intel
pnpm dist:mac-arm64   # macOS Apple Silicon
pnpm dist:win-x64     # Windows x64（在 Windows 机器上执行）
```

三个平台的包各自在对应平台原生构建，不做交叉编译。

## 工程约定

- **依赖不允许出现原生模块**（node-gyp 编译产物）。这条决定了「在同一台机器上可交叉产出另一架构的包」以及「打包链路简单」。
- **所有文件与 git 操作只在主进程**。渲染进程通过 preload 暴露的 `window.fm` 白名单 API 访问，永远拿不到 `fs`。
- **`packages/core` 必须环境无关**（不能 import `node:*`，也不能依赖 DOM）。它同时被主进程和渲染进程使用。
- **操作一律注册成命令**（见渲染层 `commands.ts`），不要直接在按钮里写业务逻辑。

## 目录

```
apps/desktop/        Electron 应用（main / preload / renderer）
packages/core/       跨进程共享的类型与纯函数（i18n、文本格式、路径、slug）
packages/plugin-api/ 未来插件 API 的类型包（当前只有类型）
```

## 国内网络

Electron 运行时与 electron-builder 的二进制默认从 GitHub 下载，直连经常失败，构建前请带镜像变量：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
pnpm dist:mac-x64
```

若 `node_modules/electron/dist` 是空的（`electron --version` 会挂住而不报错），手动补跑一次：

```bash
node node_modules/.pnpm/electron@*/node_modules/electron/install.js
```

## 状态

- **M0 完成**：workspace 三层、安全基线、IPC 往返、命令注册表 + ⌘K 面板、中英双语、三态视图骨架、三平台打包脚本
- **M1 完成**：打开/切换库、最近列表、按需加载文件树（目录优先、忽略 `.git`/`node_modules`）、chokidar 外部改动 0.5s 内同步、展开状态持久化、非 md 文件交系统程序打开；应用状态只写 `userData`，库目录零痕迹
- **大鹅图标**：`apps/desktop/build/icon-plate.png`（1024）→ `icon.icns` / `icon.png`，已接入 electron-builder，打包后 `Contents/Resources/icon.icns` 与源文件一致
- **M1.5 设计定稿（2026-11-20）**：整条顶栏删除，改为「左栏（库名/文件树/分类区/文档变更/底部设置）+ 内容区列头」；搜索改为三栏模式（结果栏逐行命中 + 高亮 + 跳行）；分类写进 md 的 `categories` frontmatter；删除两段式（应用回收站 → 彻底删除才进系统废纸篓）；文档变更区随 M5 一起上。细节见 PLAN.md §5.3、§5.10–§5.13
- **M1.5 第一刀完成（2026-11-20）**：顶栏整条删除，左栏（库名/折叠 → 文件树 → 切换库 → 底部固定设置）+ 内容列头（左侧图标胶囊、**标题居中**、右上三态切换）；全直角无栏缝、细线图标；**左栏与分栏都可用鼠标拖拽调宽**（180–420px / 0.25–0.75，双击复位，写进 config）；设置面板双视图；快捷键单一来源；`ui:get` / `ui:set` 持久化侧栏开合、视图模式、栏宽、分栏比例
- **M1.5b 完成（2026-11-20）**：左栏分类区默认收起，内置「最近使用 / 未分类 / 回收站」+ 自定义分类聚合（行 = 图标 + 名称 + 实时计数，高度可拖、上限 40%）；分类写进 md 的 `categories` frontmatter 且**只动这一段**（flow / block 风格原位保留，其余键 byte 级不变；无 frontmatter 时插入最小块，清空后整块消失）；元数据缓存落盘 `userData/index/<vaultId>.json`，只读文件头 16KB、watcher 增量、最近使用上限 20；右键 md 弹分类弹层（勾选即写、回车建新分类）；点分类行切扁平过滤列表（标题 + 相对路径）；新增 `meta:*` 与 `trash:list` 通道
- **M5 补充约定**：保存快照会弹窗让用户填备注，**备注非必填**——留空自动生成「快照 · 时间 · N 个文件」，`Esc` 取消不产生任何 commit
- **M2 完成（2026-11-20）**：CodeMirror 6 编辑器（markdown 高亮、行号、活动行、undo 历史按文档缓存、切回来还能撤销）；800ms 防抖自动保存 + `⌘S` 立即落盘，原子写（tmp → fsync → rename）；**EOL / BOM 原样保留**（CRLF 文件写回仍是 CRLF+无裸 LF）；hash 比对做外部冲突三选（保留我的 / 加载磁盘版本 / 另存副本），自写事件 5s 窗口抑制不误报；删除两段式落地：`⌘⌫` → 应用回收站（`userData/trash/<vaultId>/` 保留相对结构、索引原子写）→ 「还原」回原路径（重名自动 ` (1)`）→ 「彻底删除」交系统废纸篓；30 天 / 200 项清理；编辑区 chip 行显示分类（前 3 + 「还有 N 个」+「＋」），状态栏显示未保存 / 正在保存 / 已保存时间 / 保存失败；状态栏「已保存 17:36:32」即落盘成功的凭据。另修一个真 bug：窗口被遮挡时 Electron 后台节流会把 800ms 防抖拖到分钟级，已关 `backgroundThrottling`。

- **M3 完成（2026-11-23）**：预览管线 = `remark(gfm/math/frontmatter)` 解析 → 按顶层块切分 → `remark-rehype + rehype-raw + 自写白名单清洗 + rehype-katex`；KaTeX 行内与块级公式（含 mhchem `\ce{}` 化学式）、mermaid 四类图（串行渲染 + LRU 缓存，编辑别处不重绘）、GFM 表格/任务框/脚注、内联 HTML 保留而 `<script>` 不执行、`javascript:` 图片被剥；三态 `⌘1 编辑 / ⌘2 分栏 / ⌘3 只读`，分栏态编辑器与预览双向滚动同步（按块 + 块内比例，到末尾两边一起贴底）；300ms 渲染防抖，541 行含 5 图 20 公式的文档打开 1.1s、逐字输入无长任务。

- **M4 完成（2026-11-23）**：`⌘F` 三栏搜索（侧栏 | 结果栏 | 编辑区），输入 120ms 防抖、主进程全库流式扫描 `.md`（并发 8、70ms / 40 条一批推送、新请求可中断旧扫描），边扫边出；状态行「N 个文件 · M 处命中」/「正在扫描 x/y」；命中行 = 行号 + 原行（长行截断开头的 `…`）+ 高亮 + 行内次数；每组先给 6 行、超出「还有 N 处」可展开；组头文件名 + 相对路径 + 命中数，点组头或命中行直接打开并**跳到该行**；列头右「只看标题命中」；搜索中强制单栏（`⌘2` 提示不可分栏）但**列头与居中标题保留**、放大镜显示为激活态，`Esc` / 再点放大镜 / 收起侧栏退出，`⌘F` 重开保留关键词；`⌘P` 轻量快速打开只对文件名模糊匹配（自写子序列打分），↑↓ / Enter / Esc。1000+ 文件首屏 214ms。
- **M5 完成（2026-11-23）**：独立 git 时间机器（`userData/history/<vaultId>/`，库目录仍零 `.git`；双 ref：手动快照链 + 内部保护链，删除快照按原树/消息/时间重建而不改写用户可见历史）；列头加「相机 / 时钟」两个胶囊，`⌘⇧S` 保存快照，备注可留空（自动「快照 · 时间 · N 个文件」，N = 本次改动文件数）；右侧 360px 抽屉只列手动快照，点行展开 A/M/D 文件清单，点文件打开左右双栏只读 diff（绿加红删）；切快照 / 删快照都二次确认，切之前自动打保护快照，目标里没有的文件进应用回收站并标记 `supersededBy`；切完强制重读当前文档（不存在就干净回到空态）；左栏「文档变更」相对最近手动快照实时显示 `M/A/D` 与 `+N −M`；回收站里被快照取代的条目禁用「还原」。隔离库连续 100 次「改一行 → 保存」后 `git fsck` 无损坏（仅 unborn master 提示）；打包后实测保存 / 留空 / Esc 取消 / 切换 / 删除 / diff / 中英双语全通过。

- **M6 进行中（2026-11-23）**：已产出 `apps/desktop/dist/FreeMarkdown-0.1.0.dmg`（149MB，unsigned），挂载后直接启动可正常打开库、时间机器与文档变更；新增渲染层 `ErrorBoundary`，任何组件抛错都落到双语错误页（重新加载 / 复制错误信息），不再白屏。剩余：忽略规则、回收站保留期设置、空态规范、版本号。
- **M6.5 完成（2026-11-24）**：设置页新增「外观」三态（跟随系统 / 浅色 / 深色），默认跟随系统、切换即时生效并持久化到 `userData/config.json`；`nativeTheme` + `matchMedia` 双链路，窗口背景同步，CodeMirror 只换高亮主题不重建编辑器，Mermaid 按主题缓存，CSS 全量语义 token 化并补深色覆盖。左栏真实目录树补齐文档管理：库名右侧常驻 `＋`（新建文档 `⌘N` / 新建文件夹 `⌘⇧N`），树行与空白处右键，新建/重命名走树内行内输入（Enter 提交、Esc 取消、失焦提交、重名红框留在输入态），单文件删除立即进应用回收站并给 8 秒「撤销」，文件夹删除二次确认且整目录可还原；文件名校验、`open(...,'wx')` 原子占位、大小写改名两步法、目录前缀状态同步、打开文档路径跟随重命名全部落地。设计见 `docs/文件管理与主题切换设计.md`。DMG 已重新打包（149MB，unsigned），挂载卷内应用冒烟确认主题与文件 API 均在包内。


界面截图（M5 及以前在打包后的 `.app` 里抓；M6.5 为最新 `out` 用 Electron 直载，均非 dev 模式）：

- `docs/screenshot-m6-light.png`：M6.5 浅色主界面（真实文件树 + 库名右侧常驻 `＋`）
- `docs/screenshot-m6-settings-dark.png`：M6.5 深色设置页「外观」三态与快捷键
- `docs/screenshot-m6-dark-mermaid.png`：M6.5 深色主题下的 Mermaid 与预览
- `docs/screenshot-m6-create-inline.png`：树顶行内新建「未命名」，只选主名、`.md` 固定
- `docs/screenshot-m6-folder-confirm.png`：文件夹删除二次确认（整目录可还原）
- `docs/screenshot-m6-menu.png`：树行右键菜单（新建/重命名/回收站/分类/Finder/复制）
- `docs/screenshot-m5-open.png`：M5 主界面（列头四个胶囊，左栏「文档变更」插在分类区与设置之间）
- `docs/screenshot-m5-history.png`：时间机器抽屉（手动快照列表，自动文案置灰）
- `docs/screenshot-m5-history-detail.png`：展开快照详情（本次改动文件 + 行数）
- `docs/screenshot-m5-diff.png`：左右双栏只读 diff（右侧新增行绿底）
- `docs/screenshot-m5-save.png`：保存快照弹窗（备注可留空，Enter / Esc）
- `docs/screenshot-m5-changes.png`：左栏「文档变更」（相对最近快照的 M + 行数）
- `docs/screenshot-m5-working-diff.png`：工作区 diff（追加两行）
- `docs/screenshot-m5-delete-confirm.png`：删除快照二次确认（三点后果）
- `docs/screenshot-m5-trash-superseded.png`：回收站「已被快照取代」（还原禁用）
- `docs/screenshot-m4-search.png`：M4 三栏搜索（`预览` → 2 个文件 / 433 处，压力稿 6 行 +「还有 294 处」，右侧单栏源码）
- `docs/screenshot-m4-quickopen.png`：M4 `⌘P` 快速打开（输入 `fron`，命中 `notes/frontend.md`）
- `docs/screenshot-m15-open.png`：当前主界面（左栏 + 分类区展开 + 列头 + 分栏）
- `docs/screenshot-m15-category.png`：右键 md 打开分类弹层
- `docs/screenshot-m15-collapsed.png`：侧栏折叠，左上角常驻展开按钮
- `docs/screenshot-m15-settings.png`：设置面板（语言 / 快捷键一览 / 关于）
- `docs/screenshot-m3-split.png`：M3 分栏态（左边源码带行号，右边表格/公式实时渲染）
- `docs/screenshot-m3-preview.png`：M3 只读态（`⌘3`，全宽阅读版式）
- `docs/screenshot-m3-math.png`：公式与化学式（`\ce{2H2 + O2 -> 2H2O}` → `2 H₂ + O₂ ⟶ 2 H₂O`）
- `docs/screenshot-m2-editor.png`：M2 编辑器（分栏态 + 分类 chip + 已保存时间）
- `docs/screenshot-m2-conflict.png`：外部改动冲突三选卡
- `docs/screenshot-m2-trash.png`：应用回收站（还原 / 彻底删除 + 删除时间）
- `docs/screenshot-m1.png`：M1 版旧布局（带顶栏），仅作对照

