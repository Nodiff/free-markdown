import { create } from 'zustand'
import { compareSearchResults, type SearchBatch, type SearchFileResult } from '@freemarkdown/core'

/** 输入后等多久开始扫：120ms 足够合并连续按键，又不会让人感觉「卡了一下才出结果」 */
const DEBOUNCE_MS = 120

interface SearchState {
  open: boolean
  query: string
  titleOnly: boolean
  /** 本地查询序号：主进程批次带同一个值，旧批次直接丢 */
  requestId: number
  results: SearchFileResult[]
  scanned: number
  total: number
  done: boolean
  limited: boolean
  error: string | null
  /** 打开命中行后要跳到的位置；App 在编辑器就绪后消费 */
  jump: { relPath: string; line: number } | null

  openSearch(): void
  closeSearch(): void
  /** 只改输入框文字，真正开扫走 120ms 防抖 */
  setQuery(text: string): void
  runQuery(): void
  setTitleOnly(value: boolean): void
  jumpTo(relPath: string, line: number): void
  clearJump(): void
}

let sequence = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function clearDebounce(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export const useSearchStore = create<SearchState>((set, get) => ({
  open: false,
  query: '',
  titleOnly: false,
  requestId: 0,
  results: [],
  scanned: 0,
  total: 0,
  done: true,
  limited: false,
  error: null,
  jump: null,

  openSearch: () => {
    set({ open: true })
    // 上次的查询词还在：直接重新扫一遍，而不是让用户再敲一次
    if (get().query.trim() !== '') get().runQuery()
  },

  closeSearch: () => {
    clearDebounce()
    sequence += 1
    set({ open: false, requestId: sequence, results: [], scanned: 0, total: 0, done: true, limited: false })
    void window.fm.search.cancel()
  },

  setQuery: (text) => {
    set({ query: text })
    clearDebounce()
    if (text.trim() === '') {
      sequence += 1
      set({ requestId: sequence, results: [], scanned: 0, total: 0, done: true, limited: false, error: null })
      void window.fm.search.cancel()
      return
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      get().runQuery()
    }, DEBOUNCE_MS)
  },

  runQuery: () => {
    const text = get().query.trim()
    if (text === '') return
    clearDebounce()
    sequence += 1
    const requestId = sequence
    set({ requestId, results: [], scanned: 0, total: 0, done: false, limited: false, error: null })

    void window.fm.search
      .start({ requestId, text, titleOnly: get().titleOnly })
      .catch((error: unknown) => {
        if (get().requestId !== requestId) return
        set({ error: messageOf(error), done: true })
      })
  },

  setTitleOnly: (value) => {
    set({ titleOnly: value })
    if (get().query.trim() !== '') get().runQuery()
  },

  jumpTo: (relPath, line) => {
    set({ jump: { relPath, line } })
  },

  clearJump: () => set({ jump: null })
}))

let initialized = false

/** 只初始化一次：订阅批次事件 + 切库时清空旧结果 */
export async function initSearchStore(): Promise<void> {
  if (initialized) return
  initialized = true

  window.fm.search.onBatch((batch: SearchBatch) => {
    const state = useSearchStore.getState()
    if (batch.requestId !== state.requestId) return

    if (batch.results.length === 0) {
      useSearchStore.setState({
        scanned: batch.scanned,
        total: batch.total,
        done: batch.done,
        limited: batch.limited
      })
      return
    }

    // 批次是追加的：合并后按「标题命中优先 → mtime 倒序」重排，保证新结果插到该在的位置
    const merged = [...state.results, ...batch.results].sort(compareSearchResults)
    useSearchStore.setState({
      results: merged,
      scanned: batch.scanned,
      total: batch.total,
      done: batch.done,
      limited: batch.limited
    })
  })

  window.fm.vault.onChanged(() => {
    const state = useSearchStore.getState()
    if (!state.open) return
    // 换库后旧结果一条都不该留，查询词保留并重扫
    state.runQuery()
  })
}
