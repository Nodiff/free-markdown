import type { Translator } from '@freemarkdown/core'
import { useMetaStore, type ViewSelection } from '../store/metaStore'
import { CaretIcon, CategoryIcon, ClockIcon, InboxIcon, TrashIcon } from './icons'

interface CategoryPanelProps {
  t: Translator
  /** 是否展开（默认收起，状态存在 config 里） */
  open: boolean
  /** 展开高度占左栏的比例，0.1–0.4 */
  ratio: number
  onToggle: () => void
}

function isSameView(current: ViewSelection, target: ViewSelection): boolean {
  if (current.kind !== target.kind) return false
  if (current.kind === 'category' && target.kind === 'category') return current.name === target.name
  return true
}

/**
 * 分类区：内置视图（最近使用 / 未分类 / 回收站）+ 自定义分类聚合，全部带计数。
 * 真实数据在文档 frontmatter 里，这里只是索引的投影（PLAN §5.11）。
 */
export default function CategoryPanel({ t, open, ratio, onToggle }: CategoryPanelProps) {
  const index = useMetaStore((state) => state.index)
  const view = useMetaStore((state) => state.view)
  const setView = useMetaStore((state) => state.setView)

  const builtins: { target: ViewSelection; label: string; count: number; Icon: typeof ClockIcon }[] = [
    { target: { kind: 'recent' }, label: t('shell.categories.recent'), count: index.recent.length, Icon: ClockIcon },
    {
      target: { kind: 'uncategorized' },
      label: t('shell.categories.uncategorized'),
      count: index.uncategorized,
      Icon: InboxIcon
    },
    { target: { kind: 'trash' }, label: t('shell.categories.trash'), count: index.trashCount, Icon: TrashIcon }
  ]

  return (
    // 高度按左栏高度的比例算：左栏是网格里的一行，高度确定，百分比才有意义
    <section
      className="categories"
      data-open={open ? 'yes' : 'no'}
      style={open ? { height: `${Math.round(ratio * 100)}%` } : undefined}
    >
      <button
        type="button"
        className="categories__head"
        onClick={onToggle}
        title={t('shell.categories')}
        aria-expanded={open}
      >
        <span className={open ? 'categories__caret is-open' : 'categories__caret'}>
          <CaretIcon />
        </span>
        <span className="categories__label">{t('shell.categories')}</span>
        {index.scanning && <span className="categories__hint">{t('shell.categories.scanning')}</span>}
        {!index.scanning && index.categories.length > 0 && (
          <span className="categories__hint">{index.categories.length}</span>
        )}
      </button>

      {open && (
        <div className="categories__body">
          {builtins.map(({ target, label, count, Icon }) => (
            <button
              key={target.kind}
              type="button"
              className={isSameView(view, target) ? 'categories__row is-active' : 'categories__row'}
              onClick={() => setView(isSameView(view, target) ? { kind: 'tree' } : target)}
              title={label}
            >
              <span className="categories__icon">
                <Icon />
              </span>
              <span className="categories__name">{label}</span>
              <span className="categories__count">{count}</span>
            </button>
          ))}

          {index.categories.map((category) => {
            const target: ViewSelection = { kind: 'category', name: category.name }
            return (
              <button
                key={category.name}
                type="button"
                className={isSameView(view, target) ? 'categories__row is-active' : 'categories__row'}
                onClick={() => setView(isSameView(view, target) ? { kind: 'tree' } : target)}
                title={category.name}
              >
                <span className="categories__icon">
                  <CategoryIcon size={14} />
                </span>
                <span className="categories__name">{category.name}</span>
                <span className="categories__count">{category.count}</span>
              </button>
            )
          })}

          {index.categories.length === 0 && !index.scanning && (
            <p className="categories__empty">
              {t('shell.categories.empty')}
              <span className="categories__empty-hint">{t('shell.categories.hint')}</span>
            </p>
          )}
        </div>
      )}
    </section>
  )
}
