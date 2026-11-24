import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'katex/contrib/mhchem'
import 'katex/dist/katex.min.css'
import '../styles/markdown.css'
import type { Translator } from '@freemarkdown/core'
import { buildPreviewBlocks, type PreviewBlock } from './pipeline'

/** 预览更新防抖（PLAN §5.5） */
const RENDER_DEBOUNCE_MS = 300
/** 滚动事件节流（PLAN §5.7） */
const SCROLL_THROTTLE_MS = 80

export interface PreviewApi {
  scrollToLine: (line: number) => void
  scrollToBottom: () => void
  lineAtTop: () => number
}

interface PreviewProps {
  content: string
  t: Translator
  apiRef?: { current: PreviewApi | null }
  /** 预览自身滚动时回调顶部行号与「是否已到底」，由父组件决定是否反向驱动编辑器 */
  onScrollLine?: (line: number, atBottom: boolean) => void
}

/**
 * 预览面板：GLF/GFM + KaTeX + mermaid，按顶层块增量渲染。
 * 每个块包一层 `[data-line]`，滚动同步只认这一层（PLAN §5.7）。
 */
export default function Preview({ content, t, apiRef, onScrollLine }: PreviewProps) {
  const [blocks, setBlocks] = useState<PreviewBlock[]>(() => buildPreviewBlocks(content, t))
  const [renderedFor, setRenderedFor] = useState(content)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const emittedLineRef = useRef(0)
  const scrollTimerRef = useRef(0)

  // 300ms 防抖：输入过程中不跟着每次按键重排整篇
  useEffect(() => {
    if (content === renderedFor) return
    const timer = window.setTimeout(() => {
      setBlocks(buildPreviewBlocks(content, t))
      setRenderedFor(content)
    }, RENDER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [content, renderedFor, t])

  // 语言切换时块里缓存的 mermaid 文案要重算；正文变化交给上面的防抖
  const contentRef = useRef(content)
  contentRef.current = content
  useEffect(() => {
    setBlocks(buildPreviewBlocks(contentRef.current, t))
    setRenderedFor(contentRef.current)
  }, [t])

  const lineOfTop = useCallback((): number => {
    const container = scrollRef.current
    if (container === null) return 0
    const top = container.scrollTop
    const nodes = container.querySelectorAll<HTMLElement>('.md-block')
    // 滚到最顶时没有块满足条件，用第一块的起始行兜底（否则行号会是 0）
    let line = nodes.length > 0 ? Number(nodes[0].dataset.line ?? 0) : 0
    for (const node of nodes) {
      if (node.offsetTop - 8 > top) break
      const start = Number(node.dataset.line ?? 0)
      const end = Number(node.dataset.endLine ?? start)
      const height = node.offsetHeight
      // 块很高时（图表、代码块）按块内比例折算行号，避免整段跳
      const ratio = height > 0 ? Math.min(1, Math.max(0, (top - node.offsetTop) / height)) : 0
      line = start + ratio * Math.max(0, end - start)
    }
    return line
  }, [])

  const scrollToLine = useCallback((line: number): void => {
    const container = scrollRef.current
    if (container === null) return
    const nodes = container.querySelectorAll<HTMLElement>('.md-block')
    let target: HTMLElement | null = null
    for (const node of nodes) {
      if (Number(node.dataset.line ?? 0) <= line) target = node
      else break
    }
    if (target === null) {
      container.scrollTop = 0
      return
    }
    const start = Number(target.dataset.line ?? 0)
    const end = Number(target.dataset.endLine ?? start)
    const span = Math.max(0, end - start)
    const ratio = span > 0 ? Math.min(1, Math.max(0, (line - start) / span)) : 0
    // 块内比例换算：编辑器停在长块中间时，预览也停在同一位比例处
    container.scrollTop = Math.max(0, target.offsetTop + ratio * target.offsetHeight - 8)
  }, [])

  const scrollToBottom = useCallback((): void => {
    const container = scrollRef.current
    if (container === null) return
    container.scrollTop = container.scrollHeight
    // 图表 SVG 的尺寸可能晚一帧才稳定，补一次到底
    requestAnimationFrame(() => {
      const again = scrollRef.current
      if (again !== null) again.scrollTop = again.scrollHeight
    })
  }, [])

  useEffect(() => {
    if (apiRef === undefined) return
    apiRef.current = { scrollToLine, scrollToBottom, lineAtTop: lineOfTop }
    return () => {
      apiRef.current = null
    }
  }, [apiRef, scrollToLine, scrollToBottom, lineOfTop])

  const handleScroll = useCallback((): void => {
    if (onScrollLine === undefined) return
    if (scrollTimerRef.current !== 0) return
    scrollTimerRef.current = window.setTimeout(() => {
      scrollTimerRef.current = 0
      const line = lineOfTop()
      const container = scrollRef.current
      const atBottom = container !== null && container.scrollTop + container.clientHeight >= container.scrollHeight - 12
      if (line === emittedLineRef.current && !atBottom) return
      emittedLineRef.current = line
      onScrollLine(line, atBottom)
    }, SCROLL_THROTTLE_MS)
  }, [lineOfTop, onScrollLine])

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== 0) window.clearTimeout(scrollTimerRef.current)
    }
  }, [])

  const body = useMemo(
    () =>
      blocks.map((block) => (
        <div className="md-block" data-line={block.line} data-end-line={block.endLine} key={block.key}>
          {block.element}
        </div>
      )),
    [blocks]
  )

  return (
    <div className="preview" ref={scrollRef} onScroll={handleScroll}>
      <article className="markdown-body">{body}</article>
    </div>
  )
}
