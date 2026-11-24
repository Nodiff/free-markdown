import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createI18n, type AppInfo, type Locale, type ViewMode } from '@freemarkdown/core'
import { listCommands, registerCommand, runCommand } from './commands'
import ConflictDialog from './components/ConflictDialog'
import ContentHeader from './components/ContentHeader'
import DiffView from './components/DiffView'
import EditorPane from './components/EditorPane'
import PaneEmpty from './components/PaneEmpty'
import QuickOpen from './components/QuickOpen'
import SearchPanel from './components/SearchPanel'
import Preview, { type PreviewApi } from './preview/Preview'
import { isEditorAtBottom, scrollEditorToBottom, scrollEditorToLine, topLineOfEditor } from './preview/scrollSync'
import type { EditorView } from '@codemirror/view'
import VerticalResizer from './components/VerticalResizer'
import SettingsPanel, { type PanelMode } from './components/SettingsPanel'
import Sidebar from './components/Sidebar'
import SnapshotDialog from './components/SnapshotDialog'
import SnapshotDrawer from './components/SnapshotDrawer'
import StatusBar from './components/StatusBar'
import { detectConflicts, matchShortcut } from './shortcuts'
import { flushAutosave, initDocStore, useDocStore } from './store/docStore'
import { initHistoryStore, useHistoryStore } from './store/historyStore'
import { initMetaStore } from './store/metaStore'
import { initSearchStore, useSearchStore } from './store/searchStore'
import { initThemeStore, useThemeStore } from './store/themeStore'
import { initVaultStore, openVault, switchVault, useVaultStore } from './store/vaultStore'

export default function App() {
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const themePreference = useThemeStore((state) => state.preference)
  const resolvedTheme = useThemeStore((state) => state.resolved)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('split')
  const [pingEcho, setPingEcho] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(252)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categoryRatio, setCategoryRatio] = useState(0.28)
  const [searchWidth, setSearchWidth] = useState(340)
  const [panel, setPanel] = useState<PanelMode | null>(null)
  const [quickOpen, setQuickOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [registryTick, setRegistryTick] = useState(0)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const previewApiRef = useRef<PreviewApi | null>(null)
  /** 滚动同步锁：避免一侧被程序驱动后又反向推另一侧（PLAN §5.7） */
  const scrollLockRef = useRef<{ source: 'editor' | 'preview'; until: number }>({ source: 'editor', until: 0 })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const vaultName = useVaultStore((state) => state.vault?.name ?? null)
  const activePath = useVaultStore((state) => state.activePath)
  const docDirty = useDocStore((state) => state.dirty)
  const docContent = useDocStore((state) => state.content)
  const docRelPath = useDocStore((state) => state.relPath)
  const docLoading = useDocStore((state) => state.loading)
  const searchOpen = useSearchStore((state) => state.open)
  const searchJump = useSearchStore((state) => state.jump)
  const historyStatus = useHistoryStore((state) => state.status)
  const historyBusy = useHistoryStore((state) => state.busy)
  const historyDrawerOpen = useHistoryStore((state) => state.drawerOpen)
  const historySaveOpen = useHistoryStore((state) => state.saveOpen)
  const historyDiff = useHistoryStore((state) => state.diff)
  const historyDiffError = useHistoryStore((state) => state.diffError)
  const historyError = useHistoryStore((state) => state.error)
  const historyReady = historyStatus?.ready === true

  const t = useMemo(() => createI18n(locale), [locale])

  /** 底部短提示：搜索中拒绝分栏这类「说了就够、不需要弹窗」的反馈 */
  const showToast = useCallback((message: string): void => {
    if (toastTimerRef.current !== null) clearTimeout(toastTimerRef.current)
    setToast(message)
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, 2200)
  }, [])

  // 首屏：取应用信息 + 一次 IPC 往返，作为“桥是通的”的自检
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const appInfo = await window.fm.appInfo()
      if (cancelled) return
      setInfo(appInfo)
      setLocale(appInfo.locale)
      const echo = await window.fm.ping('hello')
      if (!cancelled) setPingEcho(echo)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 原生菜单切语言时，主进程会广播回来
  useEffect(() => window.fm.onLocaleChange(setLocale), [])

  // 库状态只初始化一次：恢复上次的库 + 订阅主进程的树变更事件
  useEffect(() => {
    void initThemeStore()
    void initVaultStore()
    void initHistoryStore()
    void initMetaStore()
    void initDocStore()
    void initSearchStore()
  }, [])

  // 窗口失焦时把最后 800ms 内的输入落盘
  useEffect(() => {
    window.addEventListener('blur', flushAutosave)
    return () => window.removeEventListener('blur', flushAutosave)
  }, [])

  // 视图模式与侧栏开合同步到配置：重启后回到上次的样子
  const uiLoaded = useRef(false)
  useEffect(() => {
    let cancelled = false
    void window.fm.ui.get().then((state) => {
      if (cancelled) return
      setViewMode(state.viewMode)
      setSidebarOpen(state.sidebarOpen)
      setSidebarWidth(state.sidebarWidth)
      setSplitRatio(state.splitRatio)
      setCategoryOpen(state.categoryOpen)
      setCategoryRatio(state.categoryRatio)
      setSearchWidth(state.searchWidth)
      uiLoaded.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 只在读回配置之后才写盘，避免启动瞬间用默认值覆盖用户上次的选择
  useEffect(() => {
    if (!uiLoaded.current) return
    void window.fm.ui.set({ viewMode })
  }, [viewMode])
  useEffect(() => {
    if (!uiLoaded.current) return
    void window.fm.ui.set({ sidebarOpen })
  }, [sidebarOpen])
  useEffect(() => {
    if (!uiLoaded.current) return
    void window.fm.ui.set({ sidebarWidth })
  }, [sidebarWidth])
  useEffect(() => {
    if (!uiLoaded.current) return
    void window.fm.ui.set({ splitRatio })
  }, [splitRatio])
  useEffect(() => {
    if (!uiLoaded.current) return
    void window.fm.ui.set({ categoryOpen })
  }, [categoryOpen])
  useEffect(() => {
    if (!uiLoaded.current) return
    void window.fm.ui.set({ categoryRatio })
  }, [categoryRatio])
  useEffect(() => {
    if (!uiLoaded.current) return
    void window.fm.ui.set({ searchWidth })
  }, [searchWidth])

  // 所有 UI 动作都注册成命令，按钮/快捷键/命令面板统一走 runCommand(id)
  useEffect(() => {
    const disposers = [
      registerCommand({
        id: 'view.mode.edit',
        group: 'view',
        titleKey: 'command.view.edit',
        run: () => setViewMode('edit')
      }),
      registerCommand({
        id: 'view.mode.split',
        group: 'view',
        titleKey: 'command.view.split',
        run: () => {
          // 搜索态强制单栏（PLAN §5.3）：⌘2 直接拒绝并给一句提示，不偷偷切
          if (useSearchStore.getState().open) {
            showToast(t('search.splitBlocked'))
            return
          }
          setViewMode('split')
        }
      }),
      registerCommand({
        id: 'view.mode.read',
        group: 'view',
        titleKey: 'command.view.read',
        run: () => setViewMode('read')
      }),
      registerCommand({
        id: 'app.toggleLocale',
        group: 'app',
        titleKey: 'command.app.toggleLocale',
        run: async () => {
          await window.fm.setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')
        }
      }),
      registerCommand({
        id: 'vault.open',
        group: 'vault',
        titleKey: 'command.vault.open',
        run: () => openVault()
      }),
      registerCommand({
        id: 'vault.switch',
        group: 'vault',
        titleKey: 'shell.explorer.switch',
        run: (payload) => {
          if (typeof payload !== 'string') return
          return switchVault(payload)
        }
      }),
      registerCommand({
        id: 'sidebar.toggle',
        group: 'view',
        titleKey: 'command.sidebar.toggle',
        run: () => {
          // 收起侧栏 = 退出搜索（PLAN §5.3）；展开时搜索状态由 search.open 负责
          if (sidebarOpen && useSearchStore.getState().open) useSearchStore.getState().closeSearch()
          setSidebarOpen((open) => !open)
        }
      }),
      registerCommand({
        id: 'settings.open',
        group: 'app',
        titleKey: 'command.settings.open',
        run: () => setPanel('settings')
      }),
      registerCommand({
        id: 'commands.open',
        group: 'app',
        titleKey: 'command.commands.open',
        run: () => setPanel('commands')
      }),
      registerCommand({
        id: 'doc.save',
        group: 'file',
        titleKey: 'command.doc.save',
        run: () => useDocStore.getState().save()
      }),
      registerCommand({
        id: 'history.save',
        group: 'file',
        titleKey: 'command.history.save',
        run: () => {
          if (useHistoryStore.getState().status?.ready !== true) {
            showToast(t('history.unavailable'))
            return
          }
          useHistoryStore.getState().setSaveOpen(true)
        }
      }),
      registerCommand({
        id: 'history.open',
        group: 'file',
        titleKey: 'command.history.open',
        run: () => {
          const history = useHistoryStore.getState()
          if (history.status?.ready !== true) {
            showToast(t('history.unavailable'))
            return
          }
          history.setDrawerOpen(!history.drawerOpen)
          if (!history.drawerOpen) void history.refreshAll()
        }
      }),
      registerCommand({
        id: 'theme.system',
        group: 'view',
        titleKey: 'command.theme.system',
        run: () => {
          void useThemeStore.getState().setPreference('system')
        }
      }),
      registerCommand({
        id: 'theme.light',
        group: 'view',
        titleKey: 'command.theme.light',
        run: () => {
          void useThemeStore.getState().setPreference('light')
        }
      }),
      registerCommand({
        id: 'theme.dark',
        group: 'view',
        titleKey: 'command.theme.dark',
        run: () => {
          void useThemeStore.getState().setPreference('dark')
        }
      }),
      registerCommand({
        id: 'file.new',
        group: 'file',
        titleKey: 'command.file.new',
        run: () => {
          window.dispatchEvent(new CustomEvent('fm:file-command', { detail: 'new-doc' }))
        }
      }),
      registerCommand({
        id: 'file.newFolder',
        group: 'file',
        titleKey: 'command.file.newFolder',
        run: () => {
          window.dispatchEvent(new CustomEvent('fm:file-command', { detail: 'new-dir' }))
        }
      }),
      registerCommand({
        id: 'file.rename',
        group: 'file',
        titleKey: 'command.file.rename',
        run: () => {
          window.dispatchEvent(new CustomEvent('fm:file-command', { detail: 'rename' }))
        }
      }),
      registerCommand({
        id: 'doc.delete',
        group: 'file',
        titleKey: 'command.doc.delete',
        run: () => {
          window.dispatchEvent(new CustomEvent('fm:file-command', { detail: 'delete' }))
        }
      }),
      registerCommand({
        id: 'categories.toggle',
        group: 'view',
        titleKey: 'shell.categories',
        run: () => setCategoryOpen((open) => !open)
      }),
      registerCommand({
        id: 'search.open',
        group: 'view',
        titleKey: 'command.search.open',
        run: () => {
          const search = useSearchStore.getState()
          if (search.open) {
            search.closeSearch()
            return
          }
          setPanel(null)
          setQuickOpen(false)
          setSidebarOpen(true)
          search.openSearch()
        }
      }),
      registerCommand({
        id: 'file.quick-open',
        group: 'file',
        titleKey: 'command.file.quickOpen',
        run: () => {
          setPanel(null)
          setQuickOpen(true)
        }
      })
    ]
    setRegistryTick((tick) => tick + 1)
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, [locale, sidebarOpen, showToast, t])

  // 快捷键统一从 shortcuts.ts 匹配，避免和设置面板里展示的键位对不上
  useEffect(() => {
    for (const conflict of detectConflicts()) console.warn('[shortcuts] conflict', conflict)

    const onKeyDown = (event: KeyboardEvent): void => {
      const command = matchShortcut(event)
      if (command !== null) {
        event.preventDefault()
        void runCommand(command)
        return
      }
      if (event.key === 'Escape') {
        // 弹层自己的输入框/确认卡先处理 Esc（它们 preventDefault + stopPropagation），这里兜底不再多关一层
        if (event.defaultPrevented) return
        // 一次 Esc 只关一层：差异 → 保存快照 → 快照抽屉 → 快速打开 → 设置/命令面板 → 搜索
        if (useHistoryStore.getState().diff !== null) {
          useHistoryStore.getState().closeDiff()
          return
        }
        if (useHistoryStore.getState().saveOpen) {
          useHistoryStore.getState().setSaveOpen(false)
          return
        }
        if (useHistoryStore.getState().drawerOpen) {
          useHistoryStore.getState().setDrawerOpen(false)
          return
        }
        if (quickOpen) {
          setQuickOpen(false)
          return
        }
        if (panel !== null) {
          setPanel(null)
          return
        }
        if (useSearchStore.getState().open) useSearchStore.getState().closeSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [quickOpen, panel])

  useEffect(() => {
    if (historyDiffError !== null) {
      showToast(historyDiffError)
      useHistoryStore.setState({ diffError: null })
    }
  }, [historyDiffError, showToast])

  useEffect(() => {
    if (historyError !== null) {
      showToast(historyError)
      useHistoryStore.getState().setError(null)
    }
  }, [historyError, showToast])

  // 收起侧栏 = 退出搜索（PLAN §5.3），但保留最后一次 query
  useEffect(() => {
    if (!sidebarOpen && useSearchStore.getState().open) useSearchStore.getState().closeSearch()
  }, [sidebarOpen])

  // 命中行跳转：等新文档加载完成、编辑器就绪后再滚，否则会滚到旧文档上
  useEffect(() => {
    if (searchJump === null || editorView === null) return
    if (docRelPath !== searchJump.relPath || docLoading) return
    const line = searchJump.line
    // 要等一帧：Editor 刚挂载时 DOM 还没量出可滚高度
    requestAnimationFrame(() => {
      scrollEditorToLine(editorView, line)
      useSearchStore.getState().clearJump()
    })
  }, [searchJump, editorView, docRelPath, docLoading])

  // 编辑器 → 预览的滚动同步（只在分栏态生效；搜索态强制单栏，不参与同步）
  useEffect(() => {
    if (searchOpen || viewMode !== 'split' || editorView === null) return
    let raf = 0
    const dom = editorView.scrollDOM
    const onScroll = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        // 到底优先对齐：编辑器顶到最底时，预览也跟到底（不受反向锁影响，方向一致不会来回抖）
        if (isEditorAtBottom(editorView)) {
          previewApiRef.current?.scrollToBottom()
          return
        }
        const lock = scrollLockRef.current
        if (lock.source === 'preview' && lock.until > Date.now()) return
        const line = topLineOfEditor(editorView)
        scrollLockRef.current = { source: 'editor', until: Date.now() + 400 }
        // 到底时不再按行号推（预览比编辑器长得多，行号会把预览推到别处）
        if (isEditorAtBottom(editorView)) previewApiRef.current?.scrollToBottom()
        else previewApiRef.current?.scrollToLine(line)
      })
    }
    dom.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      dom.removeEventListener('scroll', onScroll)
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [searchOpen, viewMode, editorView])

  const commands = useMemo(() => listCommands(), [registryTick, locale])

  const docName = activePath === null ? null : (activePath.split('/').pop() ?? activePath)

  const editorPane =
    activePath === null ? (
      <PaneEmpty title={t('shell.editor.empty')} tag={t('shell.placeholderTag')} />
    ) : (
      <EditorPane t={t} relPath={activePath} readOnly={false} onEditorReady={setEditorView} />
    )

  const handlePreviewScroll = useCallback(
    (line: number, atBottom: boolean): void => {
      const view = editorView
      if (view === null) return
      const lock = scrollLockRef.current
      if (lock.source === 'editor' && lock.until > Date.now()) return
      scrollLockRef.current = { source: 'preview', until: Date.now() + 400 }
      if (atBottom) {
        scrollEditorToBottom(view)
        previewApiRef.current?.scrollToBottom()
        return
      }
      scrollEditorToLine(view, line)
      // 目标行已经顶不动了（编辑器被夹在底部）就两边一起到底，否则会各停一处。
      // 要等一帧：dispatch 之后滚动位置还没落到 DOM
      requestAnimationFrame(() => {
        if (isEditorAtBottom(view)) previewApiRef.current?.scrollToBottom()
      })
    },
    [editorView]
  )

  const previewPane =
    activePath === null ? (
      <PaneEmpty title={t('shell.preview.empty')} tag={t('shell.placeholderTag')} />
    ) : (
      <Preview t={t} content={docContent} apiRef={previewApiRef} onScrollLine={handlePreviewScroll} />
    )

  const SIDEBAR_MIN = 180
  const SIDEBAR_MAX = 420
  const clampWidth = (value: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value))
  const clampRatio = (value: number): number => Math.min(0.75, Math.max(0.25, value))
  const CATEGORY_MIN = 0.1
  const CATEGORY_MAX = 0.4
  const clampCategoryRatio = (value: number): number => Math.min(CATEGORY_MAX, Math.max(CATEGORY_MIN, value))
  const SEARCH_MIN = 300
  const SEARCH_MAX = 480
  const clampSearchWidth = (value: number): number => Math.min(SEARCH_MAX, Math.max(SEARCH_MIN, value))
  const sidebarHeight = (): number => document.querySelector('.sidebar')?.getBoundingClientRect().height ?? 0
  const commitUi = (patch: Parameters<typeof window.fm.ui.set>[0]): void => void window.fm.ui.set(patch)

  return (
    <div
      className="shell"
      data-sidebar={sidebarOpen ? 'open' : 'closed'}
      style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }}
    >
      {sidebarOpen && (
        <Sidebar
          t={t}
          vaultName={vaultName}
          categoryOpen={categoryOpen}
          categoryRatio={categoryRatio}
          onOpenSettings={() => void runCommand('settings.open')}
          onToggleCategory={() => void runCommand('categories.toggle')}
          onCategoryDelta={(delta) => {
            const height = sidebarHeight()
            if (height <= 0) return
            // 分隔条往上拖 = 分类区变高，所以这里取负号
            setCategoryRatio((ratio) => clampCategoryRatio(ratio - delta / height))
          }}
          onCategoryCommit={() => commitUi({ categoryRatio })}
          onCategoryReset={() => {
            setCategoryRatio(0.28)
            commitUi({ categoryRatio: 0.28 })
          }}
        />
      )}

      {sidebarOpen && (
        <VerticalResizer
          label={t('shell.sidebar.collapse')}
          onDelta={(delta) => setSidebarWidth((width) => clampWidth(width + delta))}
          onCommit={() => commitUi({ sidebarWidth })}
          onReset={() => {
            setSidebarWidth(252)
            commitUi({ sidebarWidth: 252 })
          }}
        />
      )}

      <div className={searchOpen ? 'content content--search' : 'content'}>
        {/* 搜索态也保留列头：标题是「当前打开的是哪篇」的唯一提示，不能让位（用户 2026-11-23 反馈） */}
        <ContentHeader
          t={t}
          collapsed={!sidebarOpen}
          docName={docName}
          dirty={docDirty}
          viewMode={viewMode}
          searching={searchOpen}
          historyReady={historyReady}
          historyBusy={historyBusy}
          historyOpen={historyDrawerOpen}
          onToggleSidebar={() => void runCommand('sidebar.toggle')}
          onSearch={() => void runCommand('search.open')}
          onSaveSnapshot={() => void runCommand('history.save')}
          onOpenHistory={() => void runCommand('history.open')}
          onViewModeChange={(mode) => void runCommand(`view.mode.${mode}`)}
        />

        {searchOpen ? (
          <main
            className="search-layout"
            style={{ gridTemplateColumns: `${searchWidth}px var(--divider) minmax(0, 1fr)` }}
          >
            <section className="pane pane--results">
              <SearchPanel t={t} />
            </section>
            <VerticalResizer
              label={t('command.search.open')}
              onDelta={(delta) => setSearchWidth((width) => clampSearchWidth(width + delta))}
              onCommit={() => commitUi({ searchWidth })}
              onReset={() => {
                setSearchWidth(340)
                commitUi({ searchWidth: 340 })
              }}
            />
            {/*
              搜索期强制单栏：原来是分栏就临时只留编辑器，原来是只读就只留预览。
              不改 viewMode 本身，关掉搜索自然回到原来的三态与栏宽。
            */}
            {viewMode === 'read' ? (
              <section className="pane pane--preview">{previewPane}</section>
            ) : (
              <section className="pane pane--doc">{editorPane}</section>
            )}
          </main>
        ) : (
          <main
            className="panes"
            data-view={viewMode}
            style={
              viewMode === 'split' ? { gridTemplateColumns: `minmax(0, ${splitRatio}fr) 5px minmax(0, ${1 - splitRatio}fr)` } : undefined
            }
          >
            {viewMode !== 'read' && <section className="pane pane--doc">{editorPane}</section>}
            {viewMode === 'split' && (
              <VerticalResizer
                label={t('view.split')}
                onDelta={(delta) => {
                  const base = document.querySelector('.panes')?.getBoundingClientRect().width ?? 0
                  if (base <= 0) return
                  setSplitRatio((ratio) => clampRatio(ratio + delta / base))
                }}
                onCommit={() => commitUi({ splitRatio })}
                onReset={() => {
                  setSplitRatio(0.5)
                  commitUi({ splitRatio: 0.5 })
                }}
              />
            )}
            {viewMode !== 'edit' && <section className="pane pane--preview">{previewPane}</section>}
          </main>
        )}
      </div>

      <StatusBar t={t} info={info} pingEcho={pingEcho} locale={locale} vaultName={vaultName} />

      <ConflictDialog t={t} />

      {quickOpen && <QuickOpen t={t} onClose={() => setQuickOpen(false)} />}

      {historyDrawerOpen && (
        <SnapshotDrawer
          t={t}
          locale={locale === 'zh-CN' ? 'zh-CN' : 'en'}
          onClose={() => useHistoryStore.getState().setDrawerOpen(false)}
          onToast={showToast}
        />
      )}

      {historyDiff !== null && (
        <DiffView t={t} diff={historyDiff} onClose={() => useHistoryStore.getState().closeDiff()} />
      )}

      {historySaveOpen && (
        <SnapshotDialog
          t={t}
          onClose={() => useHistoryStore.getState().setSaveOpen(false)}
          onResult={(result) => {
            if (result.ok) showToast(t('history.saved'))
            else if (result.reason === 'empty') showToast(t('history.noChanges'))
            else if (result.reason === 'busy') showToast(t('history.busy'))
            else showToast(t('history.unavailable'))
          }}
        />
      )}

      {toast !== null && <div className="toast">{toast}</div>}

      {panel !== null && (
        <SettingsPanel
          t={t}
          mode={panel}
          info={info}
          locale={locale}
          theme={themePreference}
          resolvedTheme={resolvedTheme}
          commands={commands}
          onRun={(id) => {
            setPanel(null)
            void runCommand(id)
          }}
          onLocaleChange={(next) => void window.fm.setLocale(next)}
          onThemeChange={(next) => void useThemeStore.getState().setPreference(next)}
          onModeChange={setPanel}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  )
}
