import { app, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { createI18n } from '@freemarkdown/core'
import { API_VERSION } from '../shared/ipc'
import { getLocale, setLocale } from './state'
import { openVaultDialog } from './services/vault'

function showAbout(): void {
  const t = createI18n(getLocale())
  const name = t('app.name')
  dialog.showMessageBox({
    type: 'info',
    title: t('app.about.title', { name }),
    message: name,
    detail: t('app.about.detail', { version: app.getVersion(), apiVersion: API_VERSION }),
    buttons: [t('app.about.close')],
    noLink: true
  })
}

export function buildAppMenu(): Menu {
  const t = createI18n(getLocale())
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: t('menu.app'),
      submenu: [
        { label: t('menu.app.about'), click: showAbout },
        { type: 'separator' },
        { role: 'hide', label: t('menu.app.hide') },
        { role: 'hideOthers', label: t('menu.app.hideOthers') },
        { type: 'separator' },
        { role: 'quit', label: t('menu.app.quit') }
      ]
    })
  } else {
    template.push({
      label: t('menu.app'),
      submenu: [
        { label: t('menu.app.about'), click: showAbout },
        { type: 'separator' },
        { role: 'quit', label: t('menu.app.quit') }
      ]
    })
  }

  template.push(
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.file.openVault'), click: () => void openVaultDialog() },
        { type: 'separator' },
        { role: 'close', label: t('menu.window.close') }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        { role: 'reload', label: t('menu.view.reload') },
        { role: 'toggleDevTools', label: t('menu.view.devtools') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('menu.view.resetZoom') },
        { role: 'zoomIn', label: t('menu.view.zoomIn') },
        { role: 'zoomOut', label: t('menu.view.zoomOut') },
        { type: 'separator' },
        {
          label: t('menu.view.language'),
          submenu: [
            {
              label: '中文',
              type: 'checkbox',
              checked: getLocale() === 'zh-CN',
              click: () => setLocale('zh-CN')
            },
            {
              label: 'English',
              type: 'checkbox',
              checked: getLocale() === 'en',
              click: () => setLocale('en')
            }
          ]
        }
      ]
    },
    { role: 'windowMenu', label: t('menu.window') },
    {
      role: 'help',
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.help.website'),
          click: () => {
            void shell.openExternal('https://github.com/')
          }
        }
      ]
    }
  )

  return Menu.buildFromTemplate(template)
}
