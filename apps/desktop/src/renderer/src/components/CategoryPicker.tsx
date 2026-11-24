import { useEffect, useMemo, useRef, useState } from 'react'
import type { Translator } from '@freemarkdown/core'
import { useMetaStore } from '../store/metaStore'

interface CategoryPickerProps {
  t: Translator
  relPath: string
  x: number
  y: number
  onClose: () => void
}

const PANEL_W = 236
const PANEL_H = 260

/** 勾选标记：自己画，避免用字符对不齐 */
function CheckIcon({ on }: { on: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 20 20" aria-hidden className="icon">
      <rect x="3" y="3" width="14" height="14" rx="2" fill={on ? 'var(--accent)' : 'none'} stroke={on ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={1.2} />
      {on && <path d="M6.6 10.2l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  )
}

/**
 * 给单篇文档分配分类的弹层（PLAN §5.11）。
 * 已分类的文档在编辑区顶部还会有一行 chip（M2 接入），这里是树上的入口。
 */
export default function CategoryPicker({ t, relPath, x, y, onClose }: CategoryPickerProps) {
  const index = useMetaStore((state) => state.index)
  const toggleCategory = useMetaStore((state) => state.toggleCategory)
  const error = useMetaStore((state) => state.error)
  const [draft, setDraft] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)

  const entry = useMemo(
    () => index.files.find((file) => file.relPath === relPath),
    [index.files, relPath]
  )
  const assigned = entry?.categories ?? []

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const onPointer = (event: MouseEvent): void => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onPointer)
    }
  }, [onClose])

  const left = Math.max(8, Math.min(x, window.innerWidth - PANEL_W - 12))
  const top = Math.max(8, Math.min(y, window.innerHeight - PANEL_H - 12))

  const submitDraft = (): void => {
    const name = draft.trim()
    if (name === '' || entry === undefined) return
    const has = assigned.some((item) => item.toLowerCase() === name.toLowerCase())
    if (!has) void toggleCategory(relPath, name)
    setDraft('')
  }

  return (
    <div className="picker" ref={boxRef} style={{ left: `${left}px`, top: `${top}px`, width: `${PANEL_W}px` }}>
      <div className="picker__head">
        <span className="picker__title" title={relPath}>
          {t('shell.categories.selector', { name: entry?.title ?? relPath })}
        </span>
      </div>

      <div className="picker__list">
        {index.categories.length === 0 && <p className="picker__empty">{t('shell.categories.empty')}</p>}
        {index.categories.map((category) => {
          const on = assigned.some((item) => item.toLowerCase() === category.name.toLowerCase())
          return (
            <button
              key={category.name}
              type="button"
              className="picker__row"
              onClick={() => void toggleCategory(relPath, category.name)}
            >
              <CheckIcon on={on} />
              <span className="picker__name" title={category.name}>
                {category.name}
              </span>
              <span className="picker__count">{category.count}</span>
            </button>
          )
        })}
      </div>

      <div className="picker__foot">
        <input
          className="picker__input"
          value={draft}
          placeholder={t('shell.categories.addPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submitDraft()
            }
          }}
          autoFocus
        />
        <button type="button" className="picker__done" onClick={onClose}>
          {t('shell.categories.done')}
        </button>
      </div>

      {error !== null && <p className="picker__error">{t('shell.categories.failed', { message: error })}</p>}
    </div>
  )
}
