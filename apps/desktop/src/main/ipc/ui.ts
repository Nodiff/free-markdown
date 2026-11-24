import { ipcMain } from 'electron'
import type { ViewMode } from '@freemarkdown/core'
import { IPC_CHANNELS, type UiState } from '../../shared/ipc'
import {
  CATEGORY_MAX,
  CATEGORY_MIN,
  getConfig,
  SEARCH_MAX,
  SEARCH_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  updateConfig
} from '../services/config'

function isViewMode(value: unknown): value is ViewMode {
  return value === 'edit' || value === 'split' || value === 'read'
}

export function registerUiIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.uiGet,
    (): UiState => ({
      viewMode: getConfig().ui.viewMode,
      sidebarOpen: getConfig().ui.sidebarOpen,
      sidebarWidth: getConfig().ui.sidebarWidth,
      splitRatio: getConfig().ui.splitRatio,
      categoryOpen: getConfig().ui.categoryOpen,
      categoryRatio: getConfig().ui.categoryRatio,
      searchWidth: getConfig().ui.searchWidth
    })
  )

  ipcMain.handle(IPC_CHANNELS.uiSet, (_event, patch: unknown) => {
    if (typeof patch !== 'object' || patch === null) throw new Error('ui 状态必须是对象')
    const record = patch as Record<string, unknown>
    updateConfig((draft) => {
      if (isViewMode(record['viewMode'])) draft.ui.viewMode = record['viewMode']
      if (typeof record['sidebarOpen'] === 'boolean') draft.ui.sidebarOpen = record['sidebarOpen']
      if (typeof record['sidebarWidth'] === 'number' && Number.isFinite(record['sidebarWidth'])) {
        draft.ui.sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, record['sidebarWidth']))
      }
      if (typeof record['splitRatio'] === 'number' && Number.isFinite(record['splitRatio'])) {
        draft.ui.splitRatio = Math.min(0.75, Math.max(0.25, record['splitRatio']))
      }
      if (typeof record['categoryOpen'] === 'boolean') draft.ui.categoryOpen = record['categoryOpen']
      if (typeof record['categoryRatio'] === 'number' && Number.isFinite(record['categoryRatio'])) {
        draft.ui.categoryRatio = Math.min(CATEGORY_MAX, Math.max(CATEGORY_MIN, record['categoryRatio']))
      }
      if (typeof record['searchWidth'] === 'number' && Number.isFinite(record['searchWidth'])) {
        draft.ui.searchWidth = Math.min(SEARCH_MAX, Math.max(SEARCH_MIN, record['searchWidth']))
      }
    })
  })
}
