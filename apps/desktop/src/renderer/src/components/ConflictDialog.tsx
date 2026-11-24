import type { Translator } from '@freemarkdown/core'
import { useDocStore, type ConflictChoice } from '../store/docStore'

interface ConflictDialogProps {
  t: Translator
}

const CHOICES: { choice: ConflictChoice; titleKey: 'doc.conflict.mine' | 'doc.conflict.disk' | 'doc.conflict.copy'; hintKey: 'doc.conflict.mineHint' | 'doc.conflict.diskHint' | 'doc.conflict.copyHint' }[] = [
  { choice: 'mine', titleKey: 'doc.conflict.mine', hintKey: 'doc.conflict.mineHint' },
  { choice: 'disk', titleKey: 'doc.conflict.disk', hintKey: 'doc.conflict.diskHint' },
  { choice: 'copy', titleKey: 'doc.conflict.copy', hintKey: 'doc.conflict.copyHint' }
]

/** 外部冲突三选（PLAN §5.4）：绝不静默覆盖任何一边 */
export default function ConflictDialog({ t }: ConflictDialogProps) {
  const conflict = useDocStore((state) => state.conflict)
  const resolveConflict = useDocStore((state) => state.resolveConflict)

  if (conflict === null) return null

  return (
    <div className="panel__backdrop">
      <div className="conflict" role="dialog" aria-modal>
        <h2 className="conflict__title">{t('doc.conflict.title')}</h2>
        <p className="conflict__body">{t('doc.conflict.body')}</p>
        <div className="conflict__choices">
          {CHOICES.map(({ choice, titleKey, hintKey }) => (
            <button
              key={choice}
              type="button"
              className="conflict__choice"
              onClick={() => void resolveConflict(choice)}
            >
              <span className="conflict__choice-title">{t(titleKey)}</span>
              <span className="conflict__choice-hint">{t(hintKey)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
