import type { Translator, ViewMode } from '@freemarkdown/core'
import { CameraIcon, ClockIcon, EyeIcon, PanelIcon, PencilIcon, SearchIcon, SplitIcon } from './icons'

interface ContentHeaderProps {
  t: Translator
  collapsed: boolean
  docName: string | null
  /** 有未保存改动时在标题后点一个圆点（PLAN §5.4） */
  dirty: boolean
  viewMode: ViewMode
  /** 搜索态：放大镜显示为激活，提示「当前正在搜索」（标题仍留在原位） */
  searching?: boolean
  /** 时间机器已就绪才允许保存快照 / 打开抽屉 */
  historyReady?: boolean
  historyBusy?: boolean
  historyOpen?: boolean
  onToggleSidebar: () => void
  onSearch: () => void
  onSaveSnapshot: () => void
  onOpenHistory: () => void
  onViewModeChange: (mode: ViewMode) => void
}

const MODES: { mode: ViewMode; titleKey: 'view.edit' | 'view.split' | 'view.read'; Icon: typeof PencilIcon }[] = [
  { mode: 'edit', titleKey: 'view.edit', Icon: PencilIcon },
  { mode: 'split', titleKey: 'view.split', Icon: SplitIcon },
  { mode: 'read', titleKey: 'view.read', Icon: EyeIcon }
]

/**
 * 内容列头：左起固定「侧栏开关 → 搜索 → 保存快照 → 时间机器」→ 标题绝对居中 → 右侧三态切换。
 * 侧栏开关始终在放大镜左边，左栏头部不再重复放它（用户 2026-11-20 定）。
 * 标题用绝对定位居中，这样左右两侧宽度不一样也不会偏。
 */
export default function ContentHeader({
  t,
  collapsed,
  docName,
  dirty,
  viewMode,
  searching = false,
  historyReady = false,
  historyBusy = false,
  historyOpen = false,
  onToggleSidebar,
  onSearch,
  onSaveSnapshot,
  onOpenHistory,
  onViewModeChange
}: ContentHeaderProps) {
  return (
    <header className="content__head">
      <div className="content__tools">
        <button
          type="button"
          className="toolbtn"
          onClick={onToggleSidebar}
          title={collapsed ? t('shell.sidebar.expand') : t('shell.sidebar.collapse')}
        >
          <PanelIcon />
        </button>
        <button
          type="button"
          className={searching ? 'toolbtn is-active' : 'toolbtn'}
          onClick={onSearch}
          title={`${t('command.search.open')}（⌘F）`}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className="toolbtn"
          onClick={onSaveSnapshot}
          disabled={!historyReady || historyBusy}
          title={historyReady ? t('history.cameraTitle') : t('history.unavailable')}
        >
          <CameraIcon />
        </button>
        <button
          type="button"
          className={historyOpen ? 'toolbtn is-active' : 'toolbtn'}
          onClick={onOpenHistory}
          disabled={!historyReady}
          title={historyReady ? `${t('history.clockTitle')}` : t('history.unavailable')}
        >
          <ClockIcon size={18} />
        </button>
      </div>

      <div className="content__title" title={docName ?? undefined}>
        {docName ?? t('shell.editor.empty')}
        {dirty && <span className="unsaved-dot" title={t('doc.unsaved')} />}
      </div>

      <div className="content__actions">
        {MODES.map(({ mode, titleKey, Icon }) => (
          <button
            key={mode}
            type="button"
            className={viewMode === mode ? 'toolbtn is-active' : 'toolbtn'}
            onClick={() => onViewModeChange(mode)}
            title={`${t(titleKey)}（⌘${MODES.findIndex((item) => item.mode === mode) + 1}）`}
          >
            <Icon />
          </button>
        ))}
      </div>
    </header>
  )
}
