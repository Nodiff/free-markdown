import { useEffect, useRef, useState } from 'react'
import type { SnapshotSaveResult } from '@freemarkdown/core'
import type { Translator } from '@freemarkdown/core'
import { useHistoryStore } from '../store/historyStore'
import { CameraIcon } from './icons'

interface Props {
  t: Translator
  onClose(): void
  onResult(result: SnapshotSaveResult): void
}

export default function SnapshotDialog({ t, onClose, onResult }: Props) {
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = useHistoryStore((s) => s.busy)
  const saveSnapshot = useHistoryStore((s) => s.saveSnapshot)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async () => {
    if (submitting || busy) return
    setSubmitting(true)
    try {
      const result = await saveSnapshot(remark.trim())
      onResult(result)
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="panel__backdrop" onMouseDown={onClose}>
      <div
        className="snapshot-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('history.saveTitle')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="snapshot-dialog__head">
          <span className="snapshot-dialog__icon">
            <CameraIcon size={18} />
          </span>
          <span className="snapshot-dialog__title">{t('history.saveTitle')}</span>
        </header>

        <input
          ref={inputRef}
          className="snapshot-dialog__input"
          value={remark}
          maxLength={200}
          placeholder={t('history.remarkPlaceholder')}
          onChange={(event) => setRemark(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          }}
        />

        <p className="snapshot-dialog__hint">{t('history.remarkHint')}</p>

        <footer className="snapshot-dialog__foot">
          <span className="snapshot-dialog__keys">{t('history.saveHint')}</span>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn is-primary"
            onClick={() => void submit()}
            disabled={submitting || busy}
          >
            {t('history.save')}
          </button>
        </footer>
      </div>
    </div>
  )
}
