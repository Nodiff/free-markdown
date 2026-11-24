import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { isLocale, type AppInfo, type ThemePreference } from '@freemarkdown/core'
import { API_VERSION, IPC_CHANNELS } from '../../shared/ipc'
import { getLocale, setLocale } from '../state'
import { getConfig, saveConfig, updateConfig } from '../services/config'

/**
 * M0 只注册三个通道：ping（验证 IPC 往返）、appInfo、setLocale。
 * 参数一律在主进程校验，不接受渲染进程传来的路径或任意对象。
 */
export function registerAppIpc(): void {
  ipcMain.handle(IPC_CHANNELS.ping, (_event, message: unknown) => {
    if (typeof message !== 'string') throw new Error('ping 参数必须是字符串')
    if (message.length > 500) throw new Error('ping 参数过长')
    return `pong:${message}`
  })

  ipcMain.handle(IPC_CHANNELS.appInfo, (): AppInfo => {
    return {
      name: 'FreeMarkdown',
      version: app.getVersion(),
      apiVersion: API_VERSION,
      locale: getLocale(),
      platform: process.platform,
      userDataPath: app.getPath('userData')
    }
  })

  ipcMain.handle(IPC_CHANNELS.setLocale, (_event, locale: unknown) => {
    if (!isLocale(locale)) throw new Error('locale 非法')
    setLocale(locale)
  })

  ipcMain.handle(IPC_CHANNELS.themeGet, (): ThemePreference => getConfig().ui.theme)

  ipcMain.handle(IPC_CHANNELS.themeSet, async (_event, preference: unknown) => {
    if (preference !== 'system' && preference !== 'light' && preference !== 'dark') {
      throw new Error('主题取值非法')
    }
    updateConfig((draft) => {
      draft.ui.theme = preference
    })
    nativeTheme.themeSource = preference
    const background = nativeTheme.shouldUseDarkColors ? '#15171b' : '#f5f6f8'
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(background)
    await saveConfig()
  })

}
