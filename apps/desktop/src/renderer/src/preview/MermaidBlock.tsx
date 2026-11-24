import { useEffect, useMemo, useState } from 'react'
import { renderMermaid } from './mermaidRender'
import { useThemeStore } from '../store/themeStore'

interface MermaidBlockProps {
  source: string
  /** 渲染失败时的提示前缀（走 i18n） */
  errorLabel: string
}

/**
 * 单个 mermaid 图表块：异步渲染、失败就地显示错误、不阻塞整篇。
 * 图表未渲染完成时占位同样是代码块，不会让整篇高度来回跳。
 */
export default function MermaidBlock({ source, errorLabel }: MermaidBlockProps) {
  const theme = useThemeStore((state) => state.resolved)
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    // 主题变化时先清掉旧图，避免浅色 SVG 在深色背景上停留一帧
    setSvg(null)

    void renderMermaid(source, theme)
      .then((result) => {
        if (!cancelled) setSvg(result)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      cancelled = true
    }
  }, [source, theme])

  const placeholder = useMemo(() => source.split('\n').slice(0, 4).join('\n'), [source])

  if (error !== null) {
    return (
      <div className="mermaid-block mermaid-block--error">
        <div className="mermaid-block__label">{errorLabel}</div>
        <pre className="mermaid-block__error">{error}</pre>
        <pre className="mermaid-block__source">{source}</pre>
      </div>
    )
  }

  if (svg === null) {
    return (
      <div className="mermaid-block mermaid-block--loading">
        <pre className="mermaid-block__source">{placeholder}</pre>
      </div>
    )
  }

  return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
}
