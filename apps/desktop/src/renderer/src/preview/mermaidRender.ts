/** mermaid 渲染队列 + LRU 缓存（PLAN §5.5：mermaid 有全局状态，必须串行） */

const MAX_CACHE = 200

interface CacheItem {
  svg: string
}

const cache = new Map<string, CacheItem>()
let initialized = false
let currentTheme: 'light' | 'dark' | null = null
let chain: Promise<unknown> = Promise.resolve()
let seq = 0

function touch(key: string, item: CacheItem): void {
  cache.delete(key)
  cache.set(key, item)
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

async function ensureMermaid(theme: 'light' | 'dark') {
  const mod = await import('mermaid')
  const mermaid = mod.default ?? mod
  if (!initialized || currentTheme !== theme) {
    const dark = theme === 'dark'
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      themeVariables: dark
        ? {
            background: '#1b1e23',
            primaryColor: '#202b44',
            primaryBorderColor: '#3b4a6b',
            primaryTextColor: '#e6e8ec',
            secondaryColor: '#22262c',
            tertiaryColor: '#181b20',
            lineColor: '#7d8692',
            fontSize: '13px'
          }
        : {
            background: '#ffffff',
            primaryColor: '#eef2ff',
            primaryBorderColor: '#c7d2fe',
            primaryTextColor: '#1f2329',
            lineColor: '#9aa3af',
            fontSize: '13px'
          },
      flowchart: { htmlLabels: false, curve: 'linear' },
      sequence: { mirrorActors: false },
      gantt: { useMaxWidth: false },
      mindmap: { useMaxWidth: false }
    })
    if (currentTheme !== theme) cache.clear()
    currentTheme = theme
    initialized = true
  }
  return mermaid
}

/**
 * 渲染一个 mermaid 代码块。同一份源码直接命中缓存；
 * 所有调用排在同一条链上，避免 mermaid 内部全局状态互相污染。
 */
export function renderMermaid(source: string, theme: 'light' | 'dark' = 'light'): Promise<string> {
  const key = `${theme}:${source.trim()}`
  const hit = cache.get(key)
  if (hit !== undefined) {
    touch(key, hit)
    return Promise.resolve(hit.svg)
  }

  const task = chain.then(async () => {
    const mermaid = await ensureMermaid(theme)
    seq += 1
    const { svg } = await mermaid.render(`fm-mermaid-${seq}`, source.trim())
    const item: CacheItem = { svg }
    touch(key, item)
    return svg
  })

  // 失败也不能卡住后面的任务
  chain = task.then(
    () => undefined,
    () => undefined
  )

  return task
}
