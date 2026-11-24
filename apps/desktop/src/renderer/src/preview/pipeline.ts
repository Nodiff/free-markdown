import type { ReactNode } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkFrontmatter from 'remark-frontmatter'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeKatex from 'rehype-katex'
import type { Root as MdastRoot, RootContent as MdastContent } from 'mdast'
import type { Element, Root as HastRoot } from 'hast'
import type { Translator } from '@freemarkdown/core'
import rehypeSanitizeWhitelist from './sanitize'
import { hastToReact } from './hastToReact'

/** 单个预览块：与源码的一段区间对应，滚动同步靠它定位（PLAN §5.7） */
export interface PreviewBlock {
  key: string
  line: number
  endLine: number
  element: ReactNode
}

/** 解析器：只负责 md → mdast，块级渲染走另一条处理器 */
const mdParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkFrontmatter, ['yaml'])

/** 块级处理器：mdast 子树 → hast（内联 HTML 先解析再白名单清洗，最后跑 KaTeX） */
const blockProcessor = unified()
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitizeWhitelist)
  .use(rehypeKatex)

/**
 * 单行写法 $$x$$ 会被 remark-math 当成行内公式，这里在解析前补成多行块级写法。
 * 只处理不在代码围栏里的整行，避免改坏代码块。
 */
function normalizeDisplayMath(content: string): string {
  let inFence = false
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (/^(`{3,}|~{3,})/.test(trimmed)) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const match = /^(\s*)\$\$(.+?)\$\$\s*$/.exec(line)
      if (match === null) return line
      const indent = match[1]
      const body = match[2].trim()
      if (body === '' || body.includes('$$')) return line
      return `${indent}$$\n${indent}${body}\n${indent}$$`
    })
    .join('\n')
}

/** frontmatter 节点：预览里不显示（标题由列头负责） */
const HIDDEN_NODE_TYPES = new Set(['yaml', 'toml', 'frontmatter'])

const MAX_BLOCK_CACHE = 400
const blockCache = new Map<string, ReactNode>()

/** 32 位 FNV-1a：只用来做缓存键，不需要抗碰撞 */
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(36)
}

function cacheGet(key: string): ReactNode | undefined {
  const hit = blockCache.get(key)
  if (hit === undefined) return undefined
  blockCache.delete(key)
  blockCache.set(key, hit)
  return hit
}

function cacheSet(key: string, node: ReactNode): ReactNode {
  blockCache.set(key, node)
  if (blockCache.size > MAX_BLOCK_CACHE) {
    const oldest = blockCache.keys().next().value
    if (oldest !== undefined) blockCache.delete(oldest)
  }
  return node
}

function renderBlock(node: MdastContent, source: string, t: Translator): ReactNode {
  const key = `${node.type}:${hash(source)}:${t('preview.mermaidFailed')}`
  const hit = cacheGet(key)
  if (hit !== undefined) return hit

  const tree = blockProcessor.runSync({ type: 'root', children: [node] } as unknown as MdastRoot) as HastRoot
  return cacheSet(key, hastToReact(tree.children, t))
}

/**
 * 把整篇 Markdown 拆成顶层块并渲染。
 * 只重算源码变了的块：未变的块直接复用上次的 React 元素，
 * React 在 key 相同时不会重建子树 —— 图片不闪、mermaid 不重算、滚动不跳。
 */
export function buildPreviewBlocks(rawContent: string, t: Translator): PreviewBlock[] {
  const content = normalizeDisplayMath(rawContent.replace(/\r\n/g, '\n'))
  const tree = mdParser.parse(content) as MdastRoot
  const blocks: PreviewBlock[] = []
  const seen = new Map<string, number>()
  // 脚注定义必须整体交给 remark-rehype（单条转换不会生成 footnotes 区）
  const footnoteNodes: MdastContent[] = []
  let lastLine = 1

  for (const node of tree.children) {
    if (HIDDEN_NODE_TYPES.has(node.type)) continue
    if (node.type === 'footnoteDefinition') {
      footnoteNodes.push(node)
      if (node.position?.end.line !== undefined) lastLine = Math.max(lastLine, node.position.end.line)
      continue
    }
    const position = node.position
    if (position?.start.line === undefined || position.end.line === undefined) continue
    const source = position.start.offset !== undefined && position.end.offset !== undefined
      ? content.slice(position.start.offset, position.end.offset)
      : ''
    const base = `${node.type}:${hash(source)}:${position.start.line}`
    const duplicate = (seen.get(base) ?? 0) + 1
    seen.set(base, duplicate)

    blocks.push({
      // 行号进 key：块内换行数变化时重新挂载，避免沿用旧高度
      key: duplicate === 1 ? base : `${base}#${duplicate}`,
      line: position.start.line,
      endLine: position.end.line,
      element: renderBlock(node, source, t)
    })
    lastLine = Math.max(lastLine, position.end.line)
  }

  if (footnoteNodes.length > 0) {
    // remark-rehype 只在「引用 + 定义同在一棵树」时才生成脚注区，
    // 这里是逐块转换，所以自己拼 section（编号与引用的出现顺序对齐）
    const order: string[] = []
    const collect = (node: MdastContent): void => {
      if (node.type === 'footnoteReference') order.push(node.identifier)
      const children = (node as MdastContent & { children?: MdastContent[] }).children
      if (Array.isArray(children)) for (const child of children) collect(child)
    }
    for (const node of tree.children) collect(node)

    const items: Element[] = footnoteNodes.map((node) => {
      const definition = node as MdastContent & { identifier: string; children: MdastContent[] }
      const position = order.indexOf(definition.identifier)
      const number = position >= 0 ? position + 1 : order.length + 1
      const body = blockProcessor.runSync({
        type: 'root',
        children: definition.children
      } as unknown as MdastRoot) as HastRoot
      return {
        type: 'element',
        tagName: 'li',
        properties: { id: `user-content-fn-${definition.identifier}`, value: number },
        children: body.children
      } as unknown as Element
    })

    const section: Element = {
      type: 'element',
      tagName: 'section',
      properties: { className: ['footnotes'], dataFootnotes: true },
      children: [
        {
          type: 'element',
          tagName: 'h2',
          properties: {},
          children: [{ type: 'text', value: t('preview.footnotes') }]
        },
        { type: 'element', tagName: 'ol', properties: {}, children: items }
      ]
    }

    blocks.push({
      // 放在末尾，行号取全文最大行，保证 line 单调递增（滚动同步二分依赖这一点）
      key: `footnotes:${hash(content)}`,
      line: lastLine,
      endLine: lastLine,
      element: hastToReact([section], t)
    })
  }

  return blocks
}
