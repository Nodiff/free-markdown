/**
 * frontmatter 的最小读写器。
 *
 * 纪律（PLAN §5.11）：只动 `categories` 这一段，其余键原样保留、顺序不动。
 * 所以这里不做 YAML 反序列化再序列化，只做「定位这一段 → 用原文切片拼回」。
 * 环境无关：不 import node:*，主进程与渲染进程都能用。
 */

import { detectTextFormat, type Eol } from './text'

const BOM = '\uFEFF'

export interface FrontmatterSpan {
  /** 原文开头的 BOM（可能是空串） */
  bom: string
  /** 去掉 BOM 之后的正文；下文所有偏移都相对它 */
  body: string
  /** 起始分隔行之后的位置 */
  openEnd: number
  /** 结束分隔行的位置 */
  closeStart: number
  /** 结束分隔行之后的位置（含换行） */
  closeEnd: number
}

interface KeyBlock {
  /** 该键第一行的起点 */
  start: number
  /** 该键最后一行（含换行）的终点 */
  end: number
  /** 行内值（`categories: [a, b]` 里的 `[a, b]`），block 风格时为空串 */
  inline: string
  /** 值写成缩进列表（`- a`）而不是行内数组 */
  block: boolean
}

/** 判断这段文本是否以 frontmatter 开头；是则给出三分界线 */
export function locateFrontmatter(raw: string): FrontmatterSpan | null {
  const bom = raw.startsWith(BOM) ? BOM : ''
  const body = bom === '' ? raw : raw.slice(1)
  if (!/^---[ \t]*\r?\n/.test(body)) return null

  const openEnd = body.indexOf('\n') + 1
  let offset = openEnd
  while (offset < body.length) {
    const lineEnd = body.indexOf('\n', offset)
    const line = lineEnd === -1 ? body.slice(offset) : body.slice(offset, lineEnd)
    const next = lineEnd === -1 ? body.length : lineEnd + 1
    if (line.trimEnd() === '---') {
      return { bom, body, openEnd, closeStart: offset, closeEnd: next }
    }
    if (lineEnd === -1) break
    offset = next
  }
  return null
}

/** 在 frontmatter 区段里找到一个顶层键的完整范围（含其缩进列表子行） */
function findKey(region: string, key: string): KeyBlock | null {
  const lines = splitLines(region)
  const pattern = new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`, 'i')

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = pattern.exec(stripCr(line.text))
    if (match === null) continue

    const inline = match[1].trim()
    let end = line.end
    let block = false

    if (inline === '') {
      // 缩进列表：一直吞掉以空白开头、且非空的行
      let cursor = index + 1
      while (cursor < lines.length) {
        const next = lines[cursor]
        const text = stripCr(next.text)
        if (text.trim() === '') break
        if (!/^[ \t]/.test(text)) break
        block = true
        end = next.end
        cursor += 1
      }
    }

    return { start: line.start, end, inline, block }
  }
  return null
}

interface Line {
  text: string
  start: number
  end: number
}

function splitLines(text: string): Line[] {
  const lines: Line[] = []
  let start = 0
  while (start <= text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl === -1 ? text.length : nl + 1
    lines.push({ text: text.slice(start, end), start, end })
    if (nl === -1) break
    start = end
  }
  return lines
}

function stripCr(text: string): string {
  return text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text
}

/** 解析单值：去引号、处理 `\"` 与 `\\` */
function parseScalar(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    if ((first === '"' || first === "'") && trimmed.endsWith(first)) {
      const inner = trimmed.slice(1, -1)
      return first === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner.replace(/''/g, "'")
    }
  }
  return trimmed
}

/** 切开行内数组：逗号分隔，但引号里的逗号不算 */
function splitFlow(inner: string): string[] {
  const items: string[] = []
  let quote: string | null = null
  let buffer = ''
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]
    if (quote !== null) {
      if (char === '\\' && quote === '"' && index + 1 < inner.length) {
        buffer += char + inner[index + 1]
        index += 1
        continue
      }
      if (char === quote) quote = null
      buffer += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      buffer += char
      continue
    }
    if (char === ',') {
      items.push(buffer)
      buffer = ''
      continue
    }
    buffer += char
  }
  if (buffer.trim() !== '') items.push(buffer)
  return items.map(parseScalar)
}

function unquoteKeyValue(raw: string): string {
  return parseScalar(raw)
}

/** 读出 categories；没有该键返回空数组 */
export function readCategories(raw: string): string[] {
  const span = locateFrontmatter(raw)
  if (span === null) return []

  const region = span.body.slice(span.openEnd, span.closeStart)
  const block = findKey(region, 'categories')
  if (block === null) return []

  if (block.inline !== '') {
    const inline = block.inline
    if (inline.startsWith('[') && inline.endsWith(']')) {
      return splitFlow(inline.slice(1, -1)).filter((item) => item !== '')
    }
    const single = parseScalar(inline)
    return single === '' ? [] : [single]
  }

  // block 风格：逐行取 `- 值`
  const lines = splitLines(region.slice(block.start, block.end))
  const items: string[] = []
  for (const line of lines) {
    const match = /^[ \t]*-[ \t]*(.*)$/.exec(stripCr(line.text))
    if (match !== null) {
      const value = parseScalar(match[1])
      if (value !== '') items.push(value)
    }
  }
  return items
}

/** 读 frontmatter 里的 title（没有返回 null） */
export function readFrontmatterTitle(raw: string): string | null {
  const span = locateFrontmatter(raw)
  if (span === null) return null
  const region = span.body.slice(span.openEnd, span.closeStart)
  const block = findKey(region, 'title')
  if (block === null || block.inline === '') return null
  const title = parseScalar(block.inline)
  return title === '' ? null : title
}

/** 首个 ATX 标题（跳过 frontmatter） */
export function readFirstHeading(raw: string): string | null {
  const span = locateFrontmatter(raw)
  const start = span === null ? (raw.startsWith(BOM) ? 1 : 0) : span.closeEnd
  const text = span === null ? (raw.startsWith(BOM) ? raw.slice(1) : raw) : span.body.slice(start)
  const lines = splitLines(text)
  let inFence = false
  for (const line of lines) {
    const trimmed = stripCr(line.text).trim()
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = /^#\s+(.*)$/.exec(trimmed)
    if (match !== null) {
      const heading = match[1].replace(/[ \t]+#+$/, '').trim()
      if (heading !== '') return heading
    }
  }
  return null
}

/** 写进 YAML 用的标量：能裸写就裸写，否则双引号转义 */
function yamlScalar(value: string): string {
  const plain = /^[\p{L}\p{N}_][\p{L}\p{N}_\- ./]*$/u.test(value)
  const reserved = /^(true|false|null|yes|no|~)$/i.test(value)
  if (plain && !reserved) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function serializeInline(list: string[]): string {
  return `[${list.map(yamlScalar).join(', ')}]`
}

function serializeBlock(list: string[], eol: Eol): string {
  const items = list.map((item) => `  - ${yamlScalar(item)}`)
  return `categories:${eol}${items.join(eol)}${eol}`
}

/** 区段里还有没有真正的键（非空行、非注释） */
function hasAnyKey(region: string): boolean {
  return splitLines(region).some((line) => {
    const text = stripCr(line.text).trim()
    return text !== '' && !text.startsWith('#')
  })
}

/**
 * 只改 `categories` 这个键：
 * - 原本有该键 → 原位替换（保留 block / flow 风格）
 * - 原本没有 → 追加在 frontmatter 末尾
 * - 整个文档没有 frontmatter 且要写入 → 新增只含 categories 的最小块
 * - 传入空数组 → 删掉该键
 */
export function writeCategories(raw: string, categories: string[]): string {
  const list = categories
  const span = locateFrontmatter(raw)

  if (span === null) {
    if (list.length === 0) return raw
    const eol: Eol = detectTextFormat(raw).eol
    const bom = raw.startsWith(BOM) ? BOM : ''
    const rest = bom === '' ? raw : raw.slice(1)
    return `${bom}---${eol}categories: ${serializeInline(list)}${eol}---${eol}${rest}`
  }

  const { bom, body } = span
  const eol: Eol = detectTextFormat(body).eol
  const region = body.slice(span.openEnd, span.closeStart)
  const block = findKey(region, 'categories')

  let nextRegion: string
  if (block === null) {
    nextRegion = list.length === 0 ? region : `${region}categories: ${serializeInline(list)}${eol}`
  } else if (list.length === 0) {
    nextRegion = region.slice(0, block.start) + region.slice(block.end)
    // 删掉最后一个键后整块只剩空白 → 连两条分隔线一起去掉，不在文件里留 `---\n---`
    if (!hasAnyKey(nextRegion)) return `${bom}${body.slice(span.closeEnd)}`
  } else {
    const serialized = block.block ? serializeBlock(list, eol) : `categories: ${serializeInline(list)}${eol}`
    nextRegion = region.slice(0, block.start) + serialized + region.slice(block.end)
  }

  return `${bom}${body.slice(0, span.openEnd)}${nextRegion}${body.slice(span.closeStart)}`
}

/** 归一化分类名：去空白、去空值、大小写不敏感去重 */
export function normalizeCategories(input: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of input) {
    const name = item.trim()
    if (name === '') continue
    const key = name.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/** 读出一个 md 的展示元数据：标题（frontmatter → 首个 H1 → 兜底）与分类 */
export function readDocMetadata(raw: string, fallbackTitle: string): { title: string; categories: string[] } {
  const title = readFrontmatterTitle(raw) ?? readFirstHeading(raw) ?? unquoteKeyValue(fallbackTitle)
  return { title, categories: readCategories(raw) }
}
