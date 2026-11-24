import type { Translator } from '@freemarkdown/core'
import CategoryPanel from './CategoryPanel'
import ChangesPanel from './ChangesPanel'
import ExplorerPanel from './ExplorerPanel'
import VerticalResizer from './VerticalResizer'
import { SettingsIcon } from './icons'

interface SidebarProps {
  t: Translator
  vaultName: string | null
  categoryOpen: boolean
  categoryRatio: number
  onOpenSettings: () => void
  onToggleCategory: () => void
  /** 分类区高度增量（正数 = 变高） */
  onCategoryDelta: (delta: number) => void
  onCategoryCommit: () => void
  onCategoryReset: () => void
}

/**
 * 左栏：红绿灯拖拽区 → 库名 → 文件树（flex:1 独立滚动）→ 分类区（默认收起，最高 40%）
 * → 底部固定设置。折叠按钮统一放在内容列头（放大镜左边），这里不再重复。
 * 文档变更区（§5.13）插在分类区与底部之间：树 → 分类 → 文档变更 → 设置。
 */
export default function Sidebar({
  t,
  vaultName,
  categoryOpen,
  categoryRatio,
  onOpenSettings,
  onToggleCategory,
  onCategoryDelta,
  onCategoryCommit,
  onCategoryReset
}: SidebarProps) {
  return (
    <aside className="sidebar">
      {/* hiddenInset 下红绿灯压在左栏顶部，这块留白同时是可拖动区域 */}
      <div className="sidebar__drag" />

      <div className="sidebar__head">
        <span className="sidebar__title" title={vaultName ?? undefined}>
          {vaultName ?? t('shell.explorer')}
        </span>
        {vaultName !== null && (
          <button
            type="button"
            className="sidebar__add"
            title={t('file.plusTitle')}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              window.dispatchEvent(
                new CustomEvent('fm:add-menu', {
                  detail: { x: rect.right - 220, y: rect.bottom + 4 }
                })
              )
            }}
          >
            ＋
          </button>
        )}
      </div>

      <ExplorerPanel t={t} />

      {categoryOpen && (
        <VerticalResizer
          axis="y"
          label={t('shell.categories')}
          onDelta={onCategoryDelta}
          onCommit={onCategoryCommit}
          onReset={onCategoryReset}
        />
      )}

      <CategoryPanel t={t} open={categoryOpen} ratio={categoryRatio} onToggle={onToggleCategory} />

      <ChangesPanel t={t} />

      <div className="sidebar__foot">
        <button type="button" className="sidebar__action" onClick={onOpenSettings}>
          <SettingsIcon />
          <span>{t('shell.settings')}</span>
        </button>
      </div>
    </aside>
  )
}
