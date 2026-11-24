import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

interface VerticalResizerProps {
  /** x = 竖线（左右拖），y = 横线（上下拖） */
  axis?: 'x' | 'y'
  /** 拖动过程中的增量回调（px），只改本地状态，不落盘 */
  onDelta: (delta: number) => void
  /** 松手时落盘 */
  onCommit: () => void
  /** 双击回到默认宽度 */
  onReset: () => void
  label: string
}

/**
 * 分隔条：5px 命中区，`pointer capture` 保证拖出窗口也不丢事件。
 * 只在 pointerup 时回调 commit，避免一帧一次 IPC。
 * axis='y' 用于分类区与文件树之间的横线。
 */
export default function VerticalResizer({ axis = 'x', onDelta, onCommit, onReset, label }: VerticalResizerProps) {
  const lastPos = useRef<number | null>(null)
  const posOf = (event: ReactPointerEvent): number => (axis === 'y' ? event.clientY : event.clientX)

  return (
    <div
      className={axis === 'y' ? 'resizer resizer--row' : 'resizer'}
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={label}
      onPointerDown={(event) => {
        lastPos.current = posOf(event)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (lastPos.current === null) return
        const delta = posOf(event) - lastPos.current
        lastPos.current = posOf(event)
        onDelta(delta)
      }}
      onPointerUp={(event) => {
        if (lastPos.current === null) return
        lastPos.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
        onCommit()
      }}
      onPointerCancel={() => {
        lastPos.current = null
        onCommit()
      }}
      onDoubleClick={onReset}
    />
  )
}
