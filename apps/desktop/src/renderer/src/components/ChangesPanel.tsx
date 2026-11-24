import type { Translator } from '@freemarkdown/core'
import { useHistoryStore } from '../store/historyStore'
import { ClockIcon } from './icons'

interface Props {
  t: Translator
}

/** 左栏「文档变更」：相对最近手动快照（无则基线）的 M/A/D 清单，点一行看行级 diff */
export default function ChangesPanel({ t }: Props) {
  const status = useHistoryStore((s) => s.status)
  const changes = useHistoryStore((s) => s.changes)
  const openWorkingDiff = useHistoryStore((s) => s.openWorkingDiff)

  if (status === null) return null

  if (!status.available) {
    return (
      <section className="changes">
        <header className="changes__head">
          <span className="changes__icon">
            <ClockIcon size={13} />
          </span>
          <span className="changes__title">{t('changes.title')}</span>
        </header>
        <p className="changes__empty">{t('history.unavailable')}</p>
      </section>
    )
  }

  return (
    <section className="changes">
      <header className="changes__head">
        <span className="changes__icon">
          <ClockIcon size={13} />
        </span>
        <span className="changes__title">{t('changes.title')}</span>
        {changes.length > 0 && (
          <span className="changes__count">{t('changes.summary', { count: changes.length })}</span>
        )}
      </header>

      {changes.length === 0 ? (
        <p className="changes__empty">{t('changes.empty')}</p>
      ) : (
        <>
          <div className="changes__list">
            {changes.map((change) => (
              <button
                key={`${change.status}:${change.relPath}`}
                type="button"
                className="changes__row"
                title={`${t('changes.hint')} · ${change.relPath}`}
                onClick={() => void openWorkingDiff(change.relPath)}
              >
                <span className={`diff-badge is-${change.status.toLowerCase()}`}>{change.status}</span>
                <span className="changes__path">{change.relPath}</span>
                <span className="changes__stats">
                  {change.additions > 0 && <span className="is-add">+{change.additions}</span>}
                  {change.deletions > 0 && <span className="is-del">−{change.deletions}</span>}
                </span>
              </button>
            ))}
          </div>
          <p className="changes__hint">{t('changes.hint')}</p>
        </>
      )}
    </section>
  )
}
