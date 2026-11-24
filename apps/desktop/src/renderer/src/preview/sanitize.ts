import type { Element, Root, RootContent } from 'hast'

/**
 * hast 上的白名单清洗（PLAN §5.5）。
 * 放在 rehype-raw 之后、rehype-katex 之前：这样内联 HTML 已经被解析成元素，
 * 能按标签/属性逐个放行；KaTeX 的产物不受影响。
 *
 * 不引 DOMPurify 的原因：它面向 HTML 字符串/DOM，而这里已经在 hast 树上，
 * 逐节点判断更直接、也没有「序列化 → 再解析」的往返。DOMPurify 留给 M7 导出 HTML。
 */

/** 允许出现的标签（GFM + 脚注 + 任务列表够用） */
const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'span',
  'div',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'caption',
  'strong',
  'em',
  'del',
  's',
  'u',
  'sub',
  'sup',
  'a',
  'img',
  'figure',
  'figcaption',
  'input',
  'dl',
  'dt',
  'dd',
  'section',
  'details',
  'summary'
])

/** 这些标签连内容一起删掉 */
const DROP_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'object',
  'embed',
  'form',
  'base',
  'link',
  'meta',
  'svg',
  'math',
  'template',
  'noscript'
])

// hast 的属性名是驼峰（className / colSpan …），这里统一按小写比对
const KEEP_ATTRS = new Set([
  'href',
  'src',
  'alt',
  'title',
  'id',
  'classname',
  'align',
  'colspan',
  'rowspan',
  'start',
  'type',
  'checked',
  'disabled',
  'open',
  'datafootnoteref',
  'datafootnotebackref',
  'ariahidden',
  'arialabel',
  'role'
])

function safeUrl(value: string, kind: 'href' | 'src'): string | null {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return null
  if (lower.startsWith('data:')) {
    return kind === 'src' && /^data:image\//i.test(trimmed) ? trimmed : null
  }
  // 相对路径、锚点、绝对路径都放行；协议只留常见的几种
  if (/^(https?:|mailto:|\/|\.\/|\.\.\/|#)/i.test(trimmed) || !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed
  }
  return null
}

function sanitizeElement(node: Element): void {
  const attributes = node.properties ?? {}
  for (const [key, value] of Object.entries(attributes)) {
    const lower = key.toLowerCase()
    // data-* 一律放行（mermaid/katex 之外的组件也会用）
    if (!KEEP_ATTRS.has(lower) && !lower.startsWith('data')) {
      delete attributes[key]
      continue
    }
    if (lower === 'href' || lower === 'src') {
      const raw = typeof value === 'string' ? value : null
      const safe = raw === null ? null : safeUrl(raw, lower === 'href' ? 'href' : 'src')
      if (safe === null) delete attributes[key]
      else attributes[key] = safe
    }
    if (lower === 'src' && node.tagName === 'img') {
      attributes.loading = 'lazy'
      attributes.decoding = 'async'
    }
  }
  if (node.tagName === 'input') {
    const type = attributes.type
    if (typeof type !== 'string' || type !== 'checkbox') {
      node.properties = {}
      return
    }
    attributes.disabled = true
  }
}

function walk(children: RootContent[]): RootContent[] {
  const output: RootContent[] = []

  for (const child of children) {
    if (child.type === 'comment') continue
    if (child.type === 'raw') continue

    if (child.type === 'element') {
      if (DROP_TAGS.has(child.tagName)) continue
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // 未知标签不整块丢弃，保留其文本内容
        output.push(...walk(child.children as RootContent[]))
        continue
      }
      sanitizeElement(child)
      child.children = walk(child.children as RootContent[]) as Element['children']
    }

    output.push(child)
  }

  return output
}

/** rehype 插件：白名单清洗 */
export default function rehypeSanitizeWhitelist() {
  return (tree: Root): void => {
    tree.children = walk(tree.children)
  }
}
