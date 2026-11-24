/**
 * 搜索的纯函数层（PLAN §5.3）。
 *
 * 主进程负责读盘、切行、算行号；渲染层只做展示。
 * 这里不依赖 node，也不依赖 DOM，两边都能直接 import，测试也方便。
 */

/** 一行里的命中位置。start/length 都是相对展示文本（text）的偏移 */
export interface SearchHit {
  /** 1-based 行号，主进程算好，渲染层不再重算 */
  line: number
  text: string
  start: number
  length: number
  /** 这一行里出现了几次（同一个词重复出现时用来说明「×3」） */
  count: number
}

export interface SearchFileResult {
  relPath: string
  /** frontmatter title → 首个 H1 → 文件名 */
  title: string
  name: string
  mtimeMs: number
  hits: SearchHit[]
  /** 命中行数（不是出现次数）：同一行出现 10 次也只算 1 处，界面按行折叠 */
  total: number
  /** 文件名或标题命中：排序时优先 */
  titleHit: boolean
  /** 文件超过 2MB，只做了文件名/标题匹配（PLAN §5.3） */
  skippedBody: boolean
}

export interface SearchRequest {
  /** 每次查询自增；批次带同一个值，渲染层据此丢弃过期结果 */
  requestId: number
  text: string
  titleOnly: boolean
}

export interface SearchBatch {
  requestId: number
  results: SearchFileResult[]
  scanned: number
  total: number
  done: boolean
  /** 库过大（>200MB 或 >20000 个 md），结果可能不完整 */
  limited: boolean
  /** 这批发完扫描就被新请求取消了 */
  cancelled: boolean
}

/** 单行展示上限：超长的压缩包式长行只截命中附近 */
export const SEARCH_MAX_LINE_LENGTH = 400
/** 单文件最多保留多少条命中行；再多也只提示「还有 N 处」 */
export const SEARCH_MAX_HITS_PER_FILE = 300
/** 超过这个大小不再读正文（PLAN §5.3） */
export const SEARCH_MAX_BODY_BYTES = 2 * 1024 * 1024
export const SEARCH_MAX_TOTAL_BYTES = 200 * 1024 * 1024
export const SEARCH_MAX_FILES = 20000

function lower(value: string): string {
  // 中文 toLowerCase 不变；英文大小写不敏感即可
  return value.toLowerCase()
}

/**
 * 逐行找字面子串。英文大小写不敏感，中文原样，不做正则/分词。
 * 返回的 hits 按行号升序；total 是命中行数（可能大于 hits.length，因为 hits 有上限）。
 */
export function findTextHits(
  text: string,
  query: string,
  options: { maxHits?: number; maxLineLength?: number } = {}
): { hits: SearchHit[]; total: number } {
  const needle = query.trim()
  if (needle === '') return { hits: [], total: 0 }
  const maxHits = options.maxHits ?? SEARCH_MAX_HITS_PER_FILE
  const maxLineLength = options.maxLineLength ?? SEARCH_MAX_LINE_LENGTH
  const target = lower(needle)

  const lines = text.split(/\r\n|\r|\n/)
  const hits: SearchHit[] = []
  let total = 0

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? ''
    const source = lower(raw)
    let from = 0
    let first = -1
    let count = 0
    while (from <= source.length) {
      const at = source.indexOf(target, from)
      if (at === -1) break
      if (first === -1) first = at
      count += 1
      from = at + Math.max(1, target.length)
    }
    if (first === -1) continue

    total += 1
    if (hits.length >= maxHits) continue

    const { text: display, start } = clipLine(raw, first, maxLineLength)
    hits.push({ line: index + 1, text: display, start, length: needle.length, count })
  }

  return { hits, total }
}

/** 长行只截命中附近，前后各留一点上下文，避免一屏 6 行全是同一段 */
function clipLine(raw: string, matchAt: number, maxLength = SEARCH_MAX_LINE_LENGTH): {
  text: string
  start: number
} {
  // 行尾空白在列表里没有意义，先去掉（命中位置不受影响，因为只裁尾部）
  const trimmed = raw.replace(/\s+$/, '')
  if (trimmed.length <= maxLength) return { text: trimmed, start: matchAt }

  const before = Math.min(matchAt, 60)
  const startIndex = Math.max(0, matchAt - before)
  const endIndex = Math.min(trimmed.length, startIndex + maxLength)
  const prefix = startIndex > 0 ? '…' : ''
  const suffix = endIndex < trimmed.length ? '…' : ''
  const slice = trimmed.slice(startIndex, endIndex)
  return {
    text: `${prefix}${slice}${suffix}`,
    start: matchAt - startIndex + prefix.length
  }
}

/** 文件名 / 标题是否包含关键词（用于 titleHit 与「只看标题命中」） */
export function matchesTitle(name: string, title: string, query: string): boolean {
  const needle = lower(query.trim())
  if (needle === '') return false
  if (lower(name).includes(needle)) return true
  if (lower(title).includes(needle)) return true
  return false
}

/** 结果排序：标题/文件名命中优先，其次 mtime 倒序，最后按路径稳定排序 */
export function compareSearchResults(a: SearchFileResult, b: SearchFileResult): number {
  if (a.titleHit !== b.titleHit) return a.titleHit ? -1 : 1
  if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
  return a.relPath.localeCompare(b.relPath, 'zh', { numeric: true, sensitivity: 'base' })
}

/* ------------------------------------------------------------------ */
/* ⌘P 快速打开：只对「文件名 + 路径」做模糊匹配（不读内容）           */
/* ------------------------------------------------------------------ */

export interface FuzzyScore {
  score: number
  /** 命中字符在 target 里的下标，供界面加粗 */
  positions: number[]
}

/**
 * 子序列模糊匹配：
 * - 必须按顺序命中所有字符（不连续也算），否则返回 null
 * - 连续命中、词边界（/ - _ 空格 之后）、首字母大写、开头命中都加分
 * - 命中位置越靠前、跨距越小越好，避免 `abc` 匹配到 `a…b…c` 这种散落远处
 */
export function scoreFuzzy(query: string, target: string): FuzzyScore | null {
  const needle = lower(query.trim())
  if (needle === '') return { score: 0, positions: [] }
  const haystack = lower(target)

  let cursor = 0
  let score = 0
  let previous = -2
  const positions: number[] = []

  for (const char of needle) {
    const at = haystack.indexOf(char, cursor)
    if (at === -1) return null

    positions.push(at)
    // 基础分：越靠前越好
    score += 12 - Math.min(10, at)
    if (previous === at - 1) score += 14
    if (at === 0 || isBoundary(target, at)) score += 10
    if (target[at] !== undefined && /[A-Z]/.test(target[at] as string)) score += 4
    // 跨距惩罚：命中离上一次太远说明是散落匹配
    if (previous >= 0) score -= Math.min(8, at - previous - 1)
    previous = at
    cursor = at + 1
  }

  return { score, positions }
}

function isBoundary(text: string, index: number): boolean {
  const prev = text[index - 1]
  if (prev === undefined) return true
  return prev === '/' || prev === '-' || prev === '_' || prev === ' ' || prev === '.' || prev === '\\'
}

export interface QuickOpenHit {
  relPath: string
  title: string
  name: string
  score: number
  /** 命中字符在哪个字符串里：false = name，true = relPath（界面据此决定给谁加粗） */
  viaPath: boolean
  positions: number[]
}

/** 对候选文件做模糊匹配并排序；query 为空时按最近修改倒序给前 N 条 */
export function rankQuickOpen(
  items: { relPath: string; title: string; name: string; mtimeMs: number }[],
  query: string,
  limit = 30
): QuickOpenHit[] {
  const needle = query.trim()
  if (needle === '') {
    return [...items]
      .sort((a, b) => b.mtimeMs - a.mtimeMs || a.relPath.localeCompare(b.relPath))
      .slice(0, limit)
      .map((item) => ({ ...item, score: 0, viaPath: false, positions: [] }))
  }

  const hits: QuickOpenHit[] = []
  for (const item of items) {
    // 文件名优先，文件名没命中再看完整路径（这样 `notes/foo` 也能搜到）
    const byName = scoreFuzzy(needle, item.name)
    const byPath = byName === null ? scoreFuzzy(needle, item.relPath) : null
    if (byName === null && byPath === null) continue
    const best = (byName ?? byPath) as FuzzyScore
    const bonus = byName !== null ? 20 : 0
    hits.push({
      relPath: item.relPath,
      title: item.title,
      name: item.name,
      score: best.score + bonus,
      viaPath: byName === null,
      positions: best.positions
    })
  }

  hits.sort((a, b) => b.score - a.score || a.relPath.localeCompare(b.relPath))
  return hits.slice(0, limit)
}
