import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron'
import { join } from 'node:path'
import type { Vault } from '@freemarkdown/core'
import { IPC_CHANNELS } from '../shared/ipc'
import { registerAppIpc } from './ipc/app'
import { broadcastTreeChanged, broadcastVaultChanged, registerVaultIpc } from './ipc/vault'
import { registerMetaIpc, subscribeMetaBroadcast } from './ipc/meta'
import { broadcastDocExternal, registerDocIpc } from './ipc/doc'
import { registerHistoryIpc, subscribeHistoryBroadcast } from './ipc/history'
import { registerSearchIpc } from './ipc/search'
import { registerFilesIpc } from './ipc/files'
import { registerTrashIpc } from './ipc/trash'
import { registerUiIpc } from './ipc/ui'
import { buildAppMenu } from './menu'
import { flushConfig, getConfig, loadConfig } from './services/config'
import { applyFileEvents, closeIndex, openIndexForVault, persist as persistIndex } from './services/metaIndex'
import { inspectExternalChanges, onExternalDocChange, resetDocumentState } from './services/documents'
import { cancelSearch } from './services/search'
import { cleanupTrash } from './services/trash'
import { ensureHistory, noteWorkingTreeChanged, resetHistory } from './services/history'
import { initLocale, onLocaleChange } from './state'
import { onVaultChange, restoreVault } from './services/vault'
import { startWatching, stopWatching } from './services/watcher'

// 先定名，保证 userData 目录固定为 ~/Library/Application Support/FreeMarkdown
app.setName('FreeMarkdown')

let mainWindow: BrowserWindow | null = null

/**
 * 只在打包后的应用里加 CSP。开发态 Vite 需要注入内联脚本与 ws 连接，
 * 强行加 CSP 会直接打断热更新。
 */
function installContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
        ]
      }
    })
  })
}

function watchVault(vault: Vault | null): void {
  if (vault === null) {
    stopWatching()
    closeIndex()
    return
  }
  startWatching(
    vault.root,
    (dirs) => broadcastTreeChanged(dirs),
    // 文件粒度的事件：先判外部改动（含自写抑制），再喂元数据索引；树仍然按目录刷新
    (events) => {
      void inspectExternalChanges(events)
      void applyFileEvents(events)
      // 文档变更区要跟着工作区动（500ms 合并，不打断输入）
      noteWorkingTreeChanged()
    }
  )
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'FreeMarkdown · 飞码',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#15171b' : '#f5f6f8',
    // 无自绘顶栏：macOS 用 hiddenInset 把红绿灯压在左栏顶部（左栏自己留 44px 拖拽区）；
    // Windows 保留系统标题栏，避免自绘窗口按钮带来的拖拽/最大化兼容问题
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 16 },
          roundedCorners: true
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      spellcheck: false,
      // 自动保存依赖定时器；窗口被遮挡时若被节流到 1 分钟一次，
      // 未落盘的内容会让外部改动冲突窗口开得过大，因此关掉后台节流。
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 任何新窗口请求一律拒绝；只有 http(s) 交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 阻止渲染进程把主窗口导航到外部页面
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? ''
    if (url !== current) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  initLocale()
  await loadConfig()
  // 先定外观再建窗：首帧颜色、红绿灯与 prefers-color-scheme 同向，避免闪白
  nativeTheme.themeSource = getConfig().ui.theme

  if (app.isPackaged) {
    installContentSecurityPolicy()
  }

  registerAppIpc()
  registerVaultIpc()
  registerUiIpc()
  registerMetaIpc()
  registerFilesIpc()
  registerTrashIpc()
  registerDocIpc()
  registerSearchIpc()
  registerHistoryIpc()
  subscribeMetaBroadcast()
  subscribeHistoryBroadcast()
  onExternalDocChange(broadcastDocExternal)
  Menu.setApplicationMenu(buildAppMenu())

  onLocaleChange((locale) => {
    Menu.setApplicationMenu(buildAppMenu())
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC_CHANNELS.localeChanged, locale)
    }
  })

  onVaultChange((vault) => {
    // 切库/关库时正在跑的全库扫描立即停下，别拿旧库的结果污染新库的界面
    cancelSearch()
    resetDocumentState()
    if (vault === null) resetHistory()
    else void ensureHistory(vault)
    watchVault(vault)
    broadcastVaultChanged(vault)
    if (vault !== null) {
      void openIndexForVault(vault)
      // 30 天 / 200 项清理放在开库时做，不打断用户操作
      void cleanupTrash({ id: vault.id, root: vault.root })
    }
  })

  const restored = await restoreVault()
  watchVault(restored)
  if (restored !== null) await openIndexForVault(restored)

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  cancelSearch()
  stopWatching()
  void flushConfig()
  void persistIndex()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
