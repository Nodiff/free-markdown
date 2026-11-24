/**
 * 行级 diff（纯函数，主进程只负责取旧/新文本，渲染层负责排版）。
 * 先削掉公共前后缀，只对中间变化的区域做 LCS —— 大文件改几行时也不会炸内存。
 */

export type DiffKind = 'same' | 'add' | 'del'

export interface DiffRow {
  kind: DiffKind
  /** 旧文件里的 1 基行号；新增行没有 */
  leftNo?: number
  /** 新文件里的 1 基行号；删除行没有 */
  rightNo?: number
  left?: string
  right?: string
}

export interface TextDiff {
  rows: DiffRow[]
  additions: number
  deletions: number
  /** 变化区域太大、退化成「整段删 + 整段增」时置 true */
  truncated: boolean
}

/** 中间变化区域允许做 DP 的最大格子数（约 2MB 内存） */
const MAX_DP_CELLS = 2_000_000
/** 单边最多保留的渲染行，超出截断（避免一篇 5 万行文件把界面拖死） */
const MAX_ROWS = 12_000

/** 空文本算 0 行；末尾换行不单独算一行（否则每个新增文件都会多一行空白对齐） */
function toLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function pushSame(rows: DiffRow[], leftLines: string[], rightLines: string[], count: number, leftStart: number, rightStart: number): void {
  for (let i = 0; i < count; i += 1) {
    const leftNo = leftStart + i
    const rightNo = rightStart + i
    rows.push({ kind: 'same', leftNo, rightNo, left: leftLines[leftNo - 1], right: rightLines[rightNo - 1] })
  }
}

/** 标准 LCS 回溯：返回中间区域的逐行结果 */
function diffMiddle(left: string[], right: string[], leftOffset: number, rightOffset: number): { rows: DiffRow[]; truncated: boolean } {
  const n = left.length
  const m = right.length
  if (n === 0 && m === 0) return { rows: [], truncated: false }
  if (n === 0) {
    return {
      rows: right.map((line, i) => ({ kind: 'add' as const, rightNo: rightOffset + i + 1, right: line })),
      truncated: false
    }
  }
  if (m === 0) {
    return {
      rows: left.map((line, i) => ({ kind: 'del' as const, leftNo: leftOffset + i + 1, left: line })),
      truncated: false
    }
  }

  if (n * m > MAX_DP_CELLS) {
    // 变化区域过大：直接整段删 + 整段增，保证界面还能开
    const rows: DiffRow[] = []
    for (let i = 0; i < n; i += 1) rows.push({ kind: 'del', leftNo: leftOffset + i + 1, left: left[i] })
    for (let i = 0; i < m; i += 1) rows.push({ kind: 'add', rightNo: rightOffset + i + 1, right: right[i] })
    return { rows, truncated: true }
  }

  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      rows.push({ kind: 'same', leftNo: leftOffset + i + 1, rightNo: rightOffset + j + 1, left: left[i], right: right[j] })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      rows.push({ kind: 'del', leftNo: leftOffset + i + 1, left: left[i] })
      i += 1
    } else {
      rows.push({ kind: 'add', rightNo: rightOffset + j + 1, right: right[j] })
      j += 1
    }
  }
  while (i < n) {
    rows.push({ kind: 'del', leftNo: leftOffset + i + 1, left: left[i] })
    i += 1
  }
  while (j < m) {
    rows.push({ kind: 'add', rightNo: rightOffset + j + 1, right: right[j] })
    j += 1
  }
  return { rows, truncated: false }
}

export function diffTexts(oldText: string, newText: string): TextDiff {
  const left = toLines(oldText)
  const right = toLines(newText)

  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1

  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]
  ) {
    suffix += 1
  }

  const rows: DiffRow[] = []
  pushSame(rows, left, right, prefix, 1, 1)

  const middle = diffMiddle(
    left.slice(prefix, left.length - suffix),
    right.slice(prefix, right.length - suffix),
    prefix,
    prefix
  )
  rows.push(...middle.rows)

  if (suffix > 0) {
    pushSame(rows, left, right, suffix, left.length - suffix + 1, right.length - suffix + 1)
  }

  let additions = 0
  let deletions = 0
  for (const row of rows) {
    if (row.kind === 'add') additions += 1
    else if (row.kind === 'del') deletions += 1
  }

  return {
    rows: rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows,
    additions,
    deletions,
    truncated: middle.truncated || rows.length > MAX_ROWS
  }
}
