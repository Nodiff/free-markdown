import { useEffect, useRef, useState } from 'react'
import type { RewindResult, Snapshot } from '@freemarkdown/core'
import type { Translator } from '@freemarkdown/core'
import { useHistoryStore } from '../store/historyStore'
import { CameraIcon, ClockIcon } from './icons'

interface Props {
  t: Translator
  locale: 'zh-CN' | 'en'
  onClose(): void
  onToast(message: string): void
}

type Pending = { kind: 'rewind' | 'delete'; sha: string } | null

function formatTime(at: number, locale: 'zh-CN' | 'en'): string {
  const date = new Date(at)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
    ...(sameYear ? {} : { year: 'numeric' as const }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

function isAutoTitle(message: string): boolean {
  return /^(快照|Snapshot) · /.test(message)
}

function statsLabel(snapshot: Snapshot): string {
  const parts = [`+${snapshot.insertions}`, `−${snapshot.deletions}`]
  return `${parts.join(' ')}`
}

export default function SnapshotDrawer({ t, locale, onClose, onToast }: Props) {
  const status = useHistoryStore((s) => s.status)
  const snapshots = useHistoryStore((s) => s.snapshots)
  const loading = useHistoryStore((s) => s.loading)
  const busy = useHistoryStore((s) => s.busy)
  const detail = useHistoryStore((s) => s.detail)
  const detailError = useHistoryStore((s) => s.detailError)
  const loadDetail = useHistoryStore((s) => s.loadDetail)
  const openSnapshotDiff = useHistoryStore((s) => s.openSnapshotDiff)
  const rewind = useHistoryStore((s) => s.rewind)
  const remove = useHistoryStore((s) => s.remove)

  const [expandedSha, setExpandedSha] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [acting, setActing] = useState(false)
  const confirmRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pending !== null) confirmRef.current?.focus()
  }, [pending])

  useEffect(() => {
    if (expandedSha !== null && detail === null && detailError === null) {
      void loadDetail(expandedSha)
    }
  }, [expandedSha, detail, detailError, loadDetail])

  const toggleRow = (sha: string) => {
    if (expandedSha === sha) {
      setExpandedSha(null)
      useHistoryStore.setState({ detail: null, detailError: null })
      return
    }
    useHistoryStore.setState({ detail: null, detailError: null })
    setExpandedSha(sha)
  }

  const confirm = async () => {
    if (pending === null || acting) return
    setActing(true)
    try {
      if (pending.kind === 'rewind') {
        const result: RewindResult = await rewind(pending.sha)
        setPending(null)
        onToast(
          t('history.rewound', { restored: result.restored, trashed: result.trashed }) +
            (result.superseded > 0 ? ` · ${t('history.superseded', { count: result.superseded })}` : '')
        )
        useHistoryStore.setState({ detail: null })
        setExpandedSha(null)
      } else {
        await remove(pending.sha)
        setPending(null)
        onToast(t('history.deleted'))
        setExpandedSha(null)
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    } finally {
      setActing(false)
    }
  }

  return (
    <>
      <aside className="history-drawer" aria-label={t('history.title')}>
        <header className="history-drawer__head">
          <span className="history-drawer__icon">
            <ClockIcon size={16} />
          </span>
          <span className="history-drawer__title">{t('history.title')}</span>
          <span className="history-drawer__count">{snapshots.length}</span>
          <button type="button" className="panel__close" onClick={onClose} title={t('history.close')}>
            ×
          </button>
        </header>
        <p className="history-drawer__subtitle">{t('history.subtitle')}</p>

        <div className="history-drawer__body">
          {status !== null && !status.available ? (
            <p className="history-drawer__empty">{t('history.unavailable')}</p>
          ) : status !== null && status.reason ? (
            <p className="history-drawer__empty">{t('history.initFailed')}</p>
          ) : loading && snapshots.length === 0 ? (
            <p className="history-drawer__empty">{t('history.loading')}</p>
          ) : snapshots.length === 0 ? (
            <div className="history-drawer__empty">
              <CameraIcon size={26} />
              <p>{t('history.empty')}</p>
              <p className="history-drawer__muted">{t('history.emptyHint')}</p>
            </div>
          ) : (
            snapshots.map((snapshot, index) => {
              const expanded = expandedSha === snapshot.sha
              return (
                <div key={snapshot.sha} className="history-row">
                  <button
                    type="button"
                    className={expanded ? 'history-row__main is-open' : 'history-row__main'}
                    onClick={() => toggleRow(snapshot.sha)}
                  >
                    <span className="history-row__dot" aria-hidden="true" />
                    <span className="history-row__body">
                      <span className={isAutoTitle(snapshot.message) ? 'history-row__title is-auto' : 'history-row__title'}>
                        {snapshot.message}
                      </span>
                      <span className="history-row__meta">
                        {formatTime(snapshot.createdAt, locale)}
                        <span className="history-row__sep">·</span>
                        {t('history.filesChanged', { count: snapshot.filesChanged })}
                        <span className="history-row__sep">·</span>
                        <span className="history-row__stats">{statsLabel(snapshot)}</span>
                      </span>
                    </span>
                    {index === 0 && <span className="history-row__badge">{t('history.latest') ?? ''}</span>}
                  </button>

                  {expanded && (
                    <div className="history-detail">
                      {detailError !== null ? (
                        <p className="history-detail__hint">{detailError}</p>
                      ) : detail === null || detail.snapshot.sha !== snapshot.sha ? (
                        <p className="history-detail__hint">{t('history.loading')}</p>
                      ) : detail.files.length === 0 ? (
                        <p className="history-detail__hint">{t('history.noDetail')}</p>
                      ) : (
                        <>
                          <p className="history-detail__label">{t('history.detail')}</p>
                          {detail.files.map((file) => (
                            <button
                              key={file.relPath}
                              type="button"
                              className="history-file"
                              title={`${t('history.openFile')} · ${file.relPath}`}
                              onClick={() => void openSnapshotDiff(snapshot.sha, file.relPath)}
                            >
                              <span className={`diff-badge is-${file.status.toLowerCase()}`}>{file.status}</span>
                              <span className="history-file__path">{file.relPath}</span>
                              <span className="history-file__stats">
                                {file.additions > 0 && <span className="is-add">+{file.additions}</span>}
                                {file.deletions > 0 && <span className="is-del">−{file.deletions}</span>}
                              </span>
                            </button>
                          ))}
                        </>
                      )}

                      <div className="history-detail__actions">
                        <button
                          type="button"
                          className="btn is-danger-quiet"
                          onClick={() => setPending({ kind: 'delete', sha: snapshot.sha })}
                          disabled={busy}
                        >
                          {t('history.delete')}
                        </button>
                        <button
                          type="button"
                          className="btn is-primary"
                          onClick={() => setPending({ kind: 'rewind', sha: snapshot.sha })}
                          disabled={busy}
                        >
                          {t('history.switch')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      </aside>

      {pending !== null && (
        <div className="panel__backdrop is-over-drawer" onMouseDown={() => setPending(null)}>
          <div
            className="confirm-card"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setPending(null)
              }
            }}
            ref={confirmRef}
            tabIndex={-1}
          >
            <h2 className="confirm-card__title">
              {pending.kind === 'rewind' ? t('history.switchTitle') : t('history.deleteTitle')}
            </h2>
            {pending.kind === 'rewind' ? (
              <p className="confirm-card__text">{t('history.switchWarn')}</p>
            ) : (
              <ul className="confirm-card__list">
                <li>{t('history.deleteWarn1')}</li>
                <li>{t('history.deleteWarn2')}</li>
                <li>{t('history.deleteWarn3')}</li>
              </ul>
            )}
            <div className="confirm-card__actions">
              <button type="button" className="btn" onClick={() => setPending(null)} disabled={acting}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={pending.kind === 'delete' ? 'btn is-danger' : 'btn is-primary'}
                onClick={() => void confirm()}
                disabled={acting}
              >
                {pending.kind === 'rewind' ? t('history.switch') : t('history.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
