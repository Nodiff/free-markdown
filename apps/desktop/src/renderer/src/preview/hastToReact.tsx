import { Fragment, createElement, type ReactNode } from 'react'
import type { Element, RootContent, Text } from 'hast'
import type { Translator } from '@freemarkdown/core'
import MermaidBlock from './MermaidBlock'

/** 空元素：React 不允许它们带 children（否则报 #137） */
const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'area', 'base', 'col', 'embed', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/** hast → React。自写而不引 hast-util-to-jsx-runtime：需要在这里截下 mermaid 代码块 */
function textOf(node: RootContent): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map((child) => textOf(child as RootContent)).join('')
  return ''
}

/** KaTeX 依赖内联 style 做上下标/分式的定位；用户 HTML 的 style 已在 sanitize 阶段删掉，
 *  所以这里只放行布局类属性，且值里不允许出现 url()/expression 这类东西 */
const STYLE_PROPS = new Set([
  'top',
  'left',
  'right',
  'bottom',
  'height',
  'width',
  'minWidth',
  'maxWidth',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'verticalAlign',
  'position',
  'fontSize',
  'lineHeight',
  'borderBottomWidth',
  'borderBottomStyle',
  'borderBottomColor',
  'transform',
  'visibility',
  // KaTeX 用 color:transparent 隐藏 \phantom 占位符
  'color',
  'whiteSpace',
  'overflow'
])

function toCamel(prop: string): string {
  if (prop.startsWith('--')) return prop
  return prop.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase())
}

function parseStyle(style: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const decl of style.split(';')) {
    const index = decl.indexOf(':')
    if (index < 0) continue
    const rawKey = decl.slice(0, index).trim().toLowerCase()
    const rawValue = decl.slice(index + 1).trim()
    if (rawKey === '' || rawValue === '') continue
    const key = toCamel(rawKey)
    if (!STYLE_PROPS.has(key)) continue
    if (/url\(|expression|javascript:/i.test(rawValue)) continue
    out[key] = rawValue
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function propsOf(element: Element): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(element.properties ?? {})) {
    if (key === 'className') {
      props.className = Array.isArray(value) ? value.join(' ') : String(value)
      continue
    }
    if (key === 'style') {
      const parsed = typeof value === 'string' ? parseStyle(value) : undefined
      if (parsed !== undefined) props.style = parsed
      continue
    }
    props[key] = value
  }
  return props
}

function isMermaid(pre: Element): boolean {
  const first = pre.children[0]
  if (first === undefined || first.type !== 'element' || first.tagName !== 'code') return false
  const className = first.properties?.className
  const joined = Array.isArray(className) ? className.join(' ') : String(className ?? '')
  return /language-mermaid/.test(joined)
}

function renderNode(node: RootContent, key: string, t: Translator): ReactNode {
  if (node.type === 'text') return node.value
  if (node.type === 'comment' || node.type === 'raw') return null
  if (node.type !== 'element') return null

  const element = node

  if (element.tagName === 'pre' && isMermaid(element)) {
    const code = element.children[0] as Element
    return <MermaidBlock key={key} source={textOf(code as RootContent)} errorLabel={t('preview.mermaidFailed')} />
  }

  if (element.tagName === 'input' && element.properties?.type === 'checkbox') {
    return (
      <input
        key={key}
        type="checkbox"
        className="md-task"
        checked={element.properties.checked === true}
        disabled
        readOnly
      />
    )
  }

  if (VOID_TAGS.has(element.tagName)) {
    return createElement(element.tagName, { key, ...propsOf(element) })
  }

  const children = element.children.map((child, index) => renderNode(child as RootContent, `${key}.${index}`, t))
  if (children.length === 0) return createElement(element.tagName, { key, ...propsOf(element) })

  return createElement(
    element.tagName,
    { key, ...propsOf(element) },
    children.length === 1 ? children[0] : createElement(Fragment, null, ...children)
  )
}

/** 把一棵 hast 子树渲染成 React 节点 */
export function hastToReact(tree: RootContent[], t: Translator): ReactNode {
  return createElement(
    Fragment,
    null,
    ...tree.map((node, index) => renderNode(node, `n${index}`, t))
  )
}

export type { Text }
