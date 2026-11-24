import { ipcMain } from 'electron'
import type { SearchRequest } from '@freemarkdown/core'
import { IPC_CHANNELS } from '../../shared/ipc'
import { cancelSearch, startSearch } from '../services/search'

const MAX_QUERY_LENGTH = 200

function assertRequest(value: unknown): SearchRequest {
  if (typeof value !== 'object' || value === null) throw new Error('搜索请求必须是对象')
  const record = value as Record<string, unknown>
  const requestId = record['requestId']
  const text = record['text']
  if (typeof requestId !== 'number' || !Number.isFinite(requestId)) throw new Error('requestId 非法')
  if (typeof text !== 'string') throw new Error('搜索词必须是字符串')
  if (text.length > MAX_QUERY_LENGTH) throw new Error('搜索词过长')
  return { requestId, text, titleOnly: record['titleOnly'] === true }
}

export function registerSearchIpc(): void {
  // 只负责「开始扫」，结果全部走 search:batch 事件推送，所以这里不等扫描结束
  ipcMain.handle(IPC_CHANNELS.searchStart, (_event, request: unknown): void => {
    const parsed = assertRequest(request)
    void startSearch(parsed)
  })

  ipcMain.handle(IPC_CHANNELS.searchCancel, (): void => {
    cancelSearch()
  })
}
