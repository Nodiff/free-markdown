import type { DocMetaEntry, Translator } from '@freemarkdown/core'
import { useMetaStore, type ViewSelection } from '../store/metaStore'
import { useVaultStore } from '../store/vaultStore'
import { ChevronLeftIcon, FolderIcon, MarkdownIcon } from './icons'

interface FilteredListProps {
  t: Translator
  view: Exclude<ViewSelection, { kind: 'tree' }>
}

function viewTitle(view: Exclude<ViewSelection, { kind: 'tree' }>, t: Translator): string {
  switch (view.kind) {
    case 'recent':
      return t('shell.categories.recent')
    case 'uncategorized':
      return t('shell.categories.uncategorized')
    case 'trash':
      return t('shell.categories.trash')
    case 'category':
      return view.name
  }
}

function selectFiles(view: Exclude<ViewSelection, { kind: 'tree' }>, files: DocMetaEntry[]): DocMetaEntry[] {
  if (view.kind === 'uncategorized') {
    return files.filter((file) => file.categories.length === 0)
  }
  if (view.kind === 'category') {
    const key = view.name.toLowerCase()
    return files.filter((file) => file.categories.some((name) => name.toLowerCase() === key))
  }
  return []
}

/** 分类 / 最近使用 / 未分类的扁平列表：不嵌套目录，按 mtime 倒序 */
export default function FilteredList({ t, view }: FilteredListProps) {
  const index = useMetaStore((state) => state.index)
  const trash = useMetaStore((state) => state.trash)
  const setView = useMetaStore((state) => state.setView)
  const openDoc = useMetaStore((state) => state.openDoc)
  const restoreTrash = useMetaStore((state) => state.restoreTrash)
  const purgeTrash = useMetaStore((state) => state.purgeTrash)
  const activePath = useVaultStore((state) => state.activePath)

  let files: DocMetaEntry[] = []
  if (view.kind === 'recent') {
    const byPath = new Map(index.files.map((file) => [file.relPath, file]))
    files = index.recent
      .map((item) => byPath.get(item.relPath))
      .filter((file): file is DocMetaEntry => file !== undefined)
  } else {
    files = selectFiles(view, index.files)
    files = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs)
  }
  const count = view.kind === 'trash' ? trash.length : files.length

  return (
    <div className="tree filtered">
      <div className="filtered__head">
        <button type="button" className="filtered__back" onClick={() => setView({ kind: 'tree' })} title={t('shell.categories.backToTree')}>
          <ChevronLeftIcon size={16} />
        </button>
        <span className="filtered__title" title={viewTitle(view, t)}>
          {viewTitle(view, t)}
        </span>
        <span className="filtered__count">{t('shell.categories.count', { count })}</span>
      </div>

      {view.kind === 'trash' ? (
        trash.length === 0 ? (
          <p className="tree__hint" style={{ paddingLeft: '12px' }}>
            {t('shell.categories.trashEmpty')}
          </p>
        ) : (
          trash.map((item) => (
            <div key={`${item.relPath}:${item.deletedAt}`} className="filtered__row is-readonly trash-row" title={item.relPath}>
              <span className="tree__icon">{item.isDir ? <FolderIcon /> : <MarkdownIcon />}</span>
              <span className="filtered__body">
                <span className="filtered__name">{item.name}</span>
                <span className={item.supersededBy ? 'filtered__path is-superseded' : 'filtered__path'}>
                  {item.supersededBy ? t('trash.superseded') : t('trash.deletedAt', {
                    time: new Date(item.deletedAt).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false
                    })
                  })}
                </span>
              </span>
              <span className="trash-row__actions">
                <button
                  type="button"
                  className="trash-row__btn"
                  onClick={() => void restoreTrash(item.relPath)}
                  disabled={item.supersededBy !== undefined}
                  title={item.supersededBy ? t('trash.supersededHint') : t('trash.restore')}
                >
                  {t('trash.restore')}
                </button>
                <button
                  type="button"
                  className="trash-row__btn is-danger"
                  onClick={() => void purgeTrash(item.relPath)}
                  title={t('trash.purgeHint')}
                >
                  {t('trash.purge')}
                </button>
              </span>
            </div>
          ))
        )
      ) : files.length === 0 ? (
        <p className="tree__hint" style={{ paddingLeft: '12px' }}>
          {t('shell.explorer.emptyDir')}
        </p>
      ) : (
        files.map((file) => (
          <button
            key={file.relPath}
            type="button"
            className={file.relPath === activePath ? 'filtered__row is-active' : 'filtered__row'}
            onClick={() => openDoc(file.relPath)}
            title={file.relPath}
          >
            <span className="tree__icon">
              <MarkdownIcon />
            </span>
            <span className="filtered__body">
              <span className="filtered__name">{file.title}</span>
              <span className="filtered__path">{file.relPath}</span>
            </span>
          </button>
        ))
      )}
    </div>
  )
}
