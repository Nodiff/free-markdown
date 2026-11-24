import { useEffect, useRef, useState } from 'react'
import type { SearchFileResult, Translator } from '@freemarkdown/core'
import { useMetaStore } from '../store/metaStore'
import { useSearchStore } from '../store/searchStore'
import { MarkdownIcon, SearchIcon } from './icons'

interface SearchPanelProps {
  t: Translator
}

/** 一次最多渲染多少个文件组：命中几百个文件时全画出来会把列表拖慢 */
const MAX_VISIBLE_FILES = 200
/** 折叠态每个文件显示几条命中行（PLAN §5.3） */
const COLLAPSED_HITS = 6
/** 展开后最多补显示多少条，防止某个文件命中几百行时把整栏撑爆 */
const MAX_EXPANDED_HITS = 100

function hitCount(results: SearchFileResult[]): number {
  return results.reduce((sum, file) => sum + file.total, 0)
}

function highlight(hit: SearchFileResult['hits'][number]): { before: string; match: string; after: string } {
  const end = hit.start + hit.length
  return { before: hit.text.slice(0, hit.start), match: hit.text.slice(hit.start, end), after: hit.text.slice(end) }
}

/**
 * 三栏搜索的结果栏（PLAN §5.3）：顶部输入框 → 进度/只看标题命中 → 扁平文件组。
 * 组头点开文件，命中行点开文件并跳行；超过 6 条折叠成「还有 N 处」，点一下展开。
 */
export default function SearchPanel({ t }: SearchPanelProps) {
  const query = useSearchStore((state) => state.query)
  const results = useSearchStore((state) => state.results)
  const scanned = useSearchStore((state) => state.scanned)
  const total = useSearchStore((state) => state.total)
  const done = useSearchStore((state) => state.done)
  const limited = useSearchStore((state) => state.limited)
  const titleOnly = useSearchStore((state) => state.titleOnly)
  const error = useSearchStore((state) => state.error)
  const setQuery = useSearchStore((state) => state.setQuery)
  const runQuery = useSearchStore((state) => state.runQuery)
  const setTitleOnly = useSearchStore((state) => state.setTitleOnly)
  const closeSearch = useSearchStore((state) => state.closeSearch)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 每次进入搜索态都把焦点交给输入框，并把上次的词全选，方便直接改写
  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.select()
  }, [])

  const openFile = (relPath: string, line?: number): void => {
    useMetaStore.getState().openDoc(relPath)
    if (line !== undefined) useSearchStore.getState().jumpTo(relPath, line)
  }

  const toggleGroup = (relPath: string): void => {
    setExpanded((current) => ({ ...current, [relPath]: !current[relPath] }))
  }

  const visibleFiles = results.slice(0, MAX_VISIBLE_FILES)
  const hiddenFiles = results.length - visibleFiles.length

  let status: string
  if (query.trim() === '') status = t('search.idle')
  else if (!done) status = t('search.scanning', { scanned, total })
  else if (results.length === 0) status = error ?? t('search.noResult')
  else if (titleOnly) status = error ?? t('search.summaryTitles', { files: results.length })
  else status = error ?? t('search.summary', { files: results.length, hits: hitCount(results) })

  return (
    <div className="search">
      <div className="search__head">
        <span className="search__icon">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          className="search__input"
          value={query}
          spellCheck={false}
          placeholder={t('shell.search.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              runQuery()
            }
          }}
        />
        {!done && <span className="search__spinner" />}
        {query !== '' && (
          <button
            type="button"
            className="search__clear"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            title={t('search.clear')}
          >
            ✕
          </button>
        )}
        <button type="button" className="search__close" onClick={closeSearch} title={t('search.close')}>
          Esc
        </button>
      </div>

      <div className="search__bar">
        <span className={done ? 'search__status' : 'search__status is-busy'}>{status}</span>
        <label className="search__toggle" title={t('search.titleOnlyHint')}>
          <input
            type="checkbox"
            checked={titleOnly}
            onChange={(event) => setTitleOnly(event.target.checked)}
          />
          <span>{t('search.titleOnly')}</span>
        </label>
      </div>

      {limited && <p className="search__warn">{t('search.limited')}</p>}

      <div className="search__results">
        {query.trim() === '' ? (
          <p className="search__hint">{t('search.idleHint')}</p>
        ) : visibleFiles.length === 0 ? (
          !done && <p className="search__hint">{t('search.scanningHint')}</p>
        ) : (
          visibleFiles.map((file) => {
            const all = expanded[file.relPath] === true
            const shown = all ? file.hits.slice(0, MAX_EXPANDED_HITS) : file.hits.slice(0, COLLAPSED_HITS)
            const rest = file.hits.length - shown.length
            return (
              <div className="search__group" key={file.relPath}>
                <button
                  type="button"
                  className="search__file"
                  onClick={() => openFile(file.relPath)}
                  title={file.relPath}
                >
                  <span className="search__fileicon">
                    <MarkdownIcon />
                  </span>
                  <span className="search__name">{file.title}</span>
                  <span className="search__path">{file.relPath}</span>
                  {file.total > 0 && <span className="search__badge">{file.total}</span>}
                </button>

                {shown.map((hit) => {
                  const parts = highlight(hit)
                  return (
                    <button
                      type="button"
                      className="search__hit"
                      key={`${file.relPath}:${hit.line}`}
                      onClick={() => openFile(file.relPath, hit.line)}
                      title={t('search.jumpTo', { line: hit.line })}
                    >
                      <span className="search__line">{hit.line}</span>
                      <span className="search__text">
                        {parts.before}
                        <mark className="search__mark">{parts.match}</mark>
                        {parts.after}
                        {hit.count > 1 && <span className="search__times">×{hit.count}</span>}
                      </span>
                    </button>
                  )
                })}

                {file.hits.length === 0 && file.titleHit && (
                  <div className="search__hit is-passive">
                    <span className="search__text">{t('search.titleHit')}</span>
                  </div>
                )}

                {rest > 0 && (
                  <button type="button" className="search__more" onClick={() => toggleGroup(file.relPath)}>
                    {all ? t('search.collapseHits') : t('search.moreHits', { count: rest })}
                  </button>
                )}
              </div>
            )
          })
        )}

        {hiddenFiles > 0 && (
          <p className="search__hint">{t('search.moreFiles', { count: hiddenFiles })}</p>
        )}
      </div>
    </div>
  )
}
