import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppInfo, Locale, ThemePreference, Translator, ViewMode } from '@freemarkdown/core'
import type { ResolvedTheme } from '../store/themeStore'
import type { Command } from '../commands'
import { SHORTCUTS, shortcutLabel } from '../shortcuts'

export type PanelMode = 'settings' | 'commands'

interface SettingsPanelProps {
  t: Translator
  mode: PanelMode
  info: AppInfo | null
  locale: Locale
  theme: ThemePreference
  resolvedTheme: ResolvedTheme
  commands: Command[]
  onRun: (id: string) => void
  onLocaleChange: (locale: Locale) => void
  onThemeChange: (theme: ThemePreference) => void
  onModeChange: (mode: PanelMode) => void
  onClose: () => void
}

/**
 * 设置面板：复用同一个容器承载「设置」和「命令」两个视图。
 * 齿轮 / ⌘, 进设置视图，⌘K 进命令视图，切换 tab 即可。
 */
export default function SettingsPanel({
  t,
  mode,
  info,
  locale,
  theme,
  resolvedTheme,
  commands,
  onRun,
  onLocaleChange,
  onThemeChange,
  onModeChange,
  onClose
}: SettingsPanelProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setQuery('')
  }, [mode])

  useEffect(() => {
    if (mode === 'commands') inputRef.current?.focus()
  }, [mode])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (keyword === '') return commands
    return commands.filter((command) => `${command.id} ${t(command.titleKey)}`.toLowerCase().includes(keyword))
  }, [commands, query, t])

  const platform = info?.platform ?? 'darwin'

  return (
    <div className="panel__backdrop" onClick={onClose}>
      <div className="panel" onClick={(event) => event.stopPropagation()}>
        <div className="panel__tabs">
          <button
            type="button"
            className={mode === 'settings' ? 'panel__tab is-active' : 'panel__tab'}
            onClick={() => onModeChange('settings')}
          >
            {t('settings.tab.settings')}
          </button>
          <button
            type="button"
            className={mode === 'commands' ? 'panel__tab is-active' : 'panel__tab'}
            onClick={() => onModeChange('commands')}
          >
            {t('settings.tab.commands')}
          </button>
          <button type="button" className="panel__close" onClick={onClose} title={t('common.close')}>
            ×
          </button>
        </div>

        {mode === 'settings' ? (
          <div className="panel__body">
            <section className="panel__section">
              <h3 className="panel__heading">{t('settings.appearance')}</h3>
              <div className="panel__choices">
                {([
                  ['system', t('theme.follow')],
                  ['light', t('theme.light')],
                  ['dark', t('theme.dark')]
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={theme === value ? 'choice is-active' : 'choice'}
                    onClick={() => onThemeChange(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {theme === 'system' && (
                <p className="panel__hint">
                  {t('theme.currentSystem', {
                    mode: resolvedTheme === 'dark' ? t('theme.dark') : t('theme.light')
                  })}
                </p>
              )}
            </section>

            <section className="panel__section">
              <h3 className="panel__heading">{t('settings.language')}</h3>
              <div className="panel__choices">
                <button
                  type="button"
                  className={locale === 'zh-CN' ? 'choice is-active' : 'choice'}
                  onClick={() => onLocaleChange('zh-CN')}
                >
                  中文
                </button>
                <button
                  type="button"
                  className={locale === 'en' ? 'choice is-active' : 'choice'}
                  onClick={() => onLocaleChange('en')}
                >
                  English
                </button>
              </div>
            </section>

            <section className="panel__section">
              <h3 className="panel__heading">{t('settings.shortcuts')}</h3>
              <ul className="shortcut-list">
                {SHORTCUTS.map((item) => (
                  <li key={item.command} className="shortcut-item">
                    <span>{t(item.titleKey)}</span>
                    <code>{shortcutLabel(item.keys, platform)}</code>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel__section">
              <h3 className="panel__heading">{t('settings.about')}</h3>
              <p className="panel__about">
                {t('settings.about.text', {
                  version: info?.version ?? '—',
                  apiVersion: info?.apiVersion ?? 0
                })}
              </p>
            </section>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              className="panel__input"
              value={query}
              placeholder={t('commands.palette')}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onClose()
                if (event.key === 'Enter' && filtered.length > 0) onRun(filtered[0]!.id)
              }}
            />
            {filtered.length === 0 ? (
              <p className="panel__empty">{t('commands.empty')}</p>
            ) : (
              <ul className="panel__list">
                {filtered.map((command) => {
                  const shortcut = SHORTCUTS.find((item) => item.command === command.id)
                  return (
                    <li key={command.id}>
                      <button type="button" className="panel__item" onClick={() => onRun(command.id)}>
                        <span>{t(command.titleKey)}</span>
                        {shortcut !== undefined && <code>{shortcutLabel(shortcut.keys, platform)}</code>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** 视图模式 → 命令 id，列头与快捷键共用同一张映射 */
export function viewModeCommand(mode: ViewMode): string {
  return `view.mode.${mode}`
}
