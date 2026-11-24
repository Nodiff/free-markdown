import { useMemo } from 'react'
import { diffTexts } from '@freemarkdown/core'
import type { FileDiff } from '@freemarkdown/core'
import type { Translator } from '@freemarkdown/core'

interface Props {
  t: Translator
  diff: FileDiff
  onClose(): void
}

export default function DiffView({ t, diff, onClose }: Props) {
  const textDiff = useMemo(() => {
    if (diff.binary) return null
    return diffTexts(diff.oldText, diff.newText)
  }, [diff])

  const statusLabel = diff.status

  return (
    <div className="panel__backdrop is-over-drawer" onMouseDown={onClose}>
      <div
        className="diff-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('diff.title')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="diff-panel__head">
          <span className={`diff-badge is-${statusLabel.toLowerCase()}`}>{statusLabel}</span>
          <span className="diff-panel__path" title={diff.relPath}>
            {diff.relPath}
          </span>
          <span className="diff-panel__stats">
            {textDiff !== null && (
              <>
                <span className="is-add">+{textDiff.additions}</span>
                <span className="is-del">−{textDiff.deletions}</span>
              </>
            )}
          </span>
          <button type="button" className="panel__close" onClick={onClose} title={t('common.close')}>
            ×
          </button>
        </header>

        {diff.binary ? (
          <p className="diff-panel__empty">{t('diff.binary')}</p>
        ) : textDiff === null ? (
          <p className="diff-panel__empty">{t('diff.noChange')}</p>
        ) : (
          <>
            {(diff.truncated || textDiff.truncated) && (
              <p className="diff-panel__warn">{t('diff.truncated')}</p>
            )}
            <div className="diff-panel__columns">
              <span className="diff-panel__col">{t('diff.old')}</span>
              <span className="diff-panel__col">{t('diff.new')}</span>
            </div>
            <div className="diff-panel__body">
              {textDiff.rows.map((row, index) => (
                <div key={index} className={`diff-line is-${row.kind}`}>
                  <span className="diff-line__no">{row.leftNo ?? ''}</span>
                  <pre className="diff-line__text">{row.left ?? ''}</pre>
                  <span className="diff-line__no">{row.rightNo ?? ''}</span>
                  <pre className="diff-line__text">{row.right ?? ''}</pre>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
