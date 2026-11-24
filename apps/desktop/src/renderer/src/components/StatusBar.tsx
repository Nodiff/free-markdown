import type { Locale, Translator } from '@freemarkdown/core'
import type { AppInfo } from '@freemarkdown/core'
import { useDocStore } from '../store/docStore'

interface StatusBarProps {
  t: Translator
  info: AppInfo | null
  pingEcho: string
  locale: Locale
  vaultName: string | null
}

function timeText(stamp: number): string {
  const date = new Date(stamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

export default function StatusBar({ t, info, pingEcho, locale, vaultName }: StatusBarProps) {
  const relPath = useDocStore((state) => state.relPath)
  const dirty = useDocStore((state) => state.dirty)
  const saving = useDocStore((state) => state.saving)
  const savedAt = useDocStore((state) => state.savedAt)
  const docError = useDocStore((state) => state.error)

  const saveText =
    docError !== null && relPath !== null
      ? t('doc.saveFailed', { message: docError })
      : relPath === null
        ? null
        : dirty
          ? t('doc.unsaved')
          : saving
            ? t('doc.saving')
            : savedAt === null
              ? null
              : t('doc.savedAt', { time: timeText(savedAt) })

  return (
    <footer className="statusbar">
      <div className="statusbar__left">
        <span className="dot" />
        <span>{t('status.ready')}</span>
        {vaultName !== null && (
          <span className="statusbar__item statusbar__item--vault">{t('status.vault', { name: vaultName })}</span>
        )}
        {saveText !== null && (
          <span className={docError !== null ? 'statusbar__item statusbar__item--error' : 'statusbar__item'}>{saveText}</span>
        )}
        {pingEcho !== '' && <span className="statusbar__item">{t('status.ipc', { message: pingEcho })}</span>}
      </div>
      <div className="statusbar__right">
        {info !== null && (
          <span className="statusbar__item">{t('status.api', { version: info.apiVersion })}</span>
        )}
        {info !== null && (
          <span className="statusbar__item">{t('status.platform', { platform: info.platform })}</span>
        )}
        <span className="statusbar__item">{t('status.locale', { locale })}</span>
      </div>
    </footer>
  )
}
