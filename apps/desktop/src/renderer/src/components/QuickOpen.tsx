import { useMemo, useState } from 'react'
import { rankQuickOpen, type QuickOpenHit, type Translator } from '@freemarkdown/core'
import { useMetaStore } from '../store/metaStore'
import { MarkdownIcon } from './icons'

interface QuickOpenProps {
  t: Translator
  onClose: () => void
}

const MAX_ROWS = 8

/** 按命中下标把文件名切成「普通 / 高亮」片段，`⌘P` 才有 VS Code 那种字面反馈 */
function marked(text: string, positions: number[]): { text: string; hit: boolean }[] {
  if (positions.length === 0) return [{ text, hit: false }]
  const parts: { text: string; hit: boolean }[] = []
  let cursor = 0
  for (const at of positions) {
    if (at > cursor) parts.push({ text: text.slice(cursor, at), hit: false })
    if (at >= cursor) parts.push({ text: text[at] ?? '', hit: true })
    cursor = at + 1
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false })
  return parts
}

/**
 * ⌘P 快速打开（PLAN §5.3）：只对文件名/路径做模糊匹配，不读正文。
 * 候选来自元数据索引，索引还没建好时至少也能按文件名跳。
 */
export default function QuickOpen({ t, onClose }: QuickOpenProps) {
  const files = useMetaStore((state) => state.index.files)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const hits = useMemo(
    () =>
      rankQuickOpen(
        files.map((file) => ({ relPath: file.relPath, title: file.title, name: file.relPath.split('/').pop() ?? file.relPath, mtimeMs: file.mtimeMs })),
        query,
        MAX_ROWS
      ),
    [files, query]
  )

  const open = (hit: QuickOpenHit | undefined): void => {
    if (hit === undefined) return
    useMetaStore.getState().openDoc(hit.relPath)
    onClose()
  }

  const move = (delta: number): void => {
    if (hits.length === 0) return
    setActive((index) => (index + delta + hits.length) % hits.length)
  }

  return (
    <div className="quickopen" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="quickopen__card" onMouseDown={(event) => event.stopPropagation()}>
        <input
          className="quickopen__input"
          autoFocus
          value={query}
          spellCheck={false}
          placeholder={t('quickOpen.placeholder')}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              open(hits[active])
            }
          }}
        />

        <ul className="quickopen__list">
          {hits.length === 0 ? (
            <li className="quickopen__empty">{t('quickOpen.empty')}</li>
          ) : (
            hits.map((hit, index) => (
              <li key={hit.relPath}>
                <button
                  type="button"
                  className={index === active ? 'quickopen__row is-active' : 'quickopen__row'}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => open(hit)}
                  title={hit.relPath}
                >
                  <span className="tree__icon">
                    <MarkdownIcon />
                  </span>
                  <span className="quickopen__name">
                    {marked(hit.name, hit.positions).map((part, partIndex) => (
                      <span key={partIndex} className={part.hit ? 'quickopen__mark' : undefined}>
                        {part.text}
                      </span>
                    ))}
                  </span>
                  <span className="quickopen__path">
                    {hit.viaPath
                      ? marked(hit.relPath, hit.positions).map((part, partIndex) => (
                          <span key={partIndex} className={part.hit ? 'quickopen__mark' : undefined}>
                            {part.text}
                          </span>
                        ))
                      : hit.relPath}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="quickopen__foot">
          <span>{t('quickOpen.hintMove')}</span>
          <span>{t('quickOpen.hintOpen')}</span>
          <span>{t('quickOpen.hintClose')}</span>
        </div>
      </div>
    </div>
  )
}
