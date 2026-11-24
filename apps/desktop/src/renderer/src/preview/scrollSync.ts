import { EditorView } from '@codemirror/view'
import type { EditorView as EditorViewType } from '@codemirror/view'

/** 把编辑器滚到指定行（预览 → 编辑器方向，PLAN §5.7） */
export function scrollEditorToLine(view: EditorViewType, line: number): void {
  const doc = view.state.doc
  const target = Math.min(Math.max(Math.round(line), 1), doc.lines)
  view.dispatch({
    effects: EditorView.scrollIntoView(doc.line(target).from, { y: 'start' })
  })
}

/** 编辑器视口顶部对应的行号（编辑器 → 预览方向） */
export function topLineOfEditor(view: EditorViewType): number {
  const rect = view.scrollDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: rect.left + 12, y: rect.top + 6 })
  if (pos === null) return 1
  return view.state.doc.lineAt(pos).number
}

/** 编辑器是否已经滚到底（到底时行号换算会被夹住，需要特殊处理） */
export function isEditorAtBottom(view: EditorViewType): boolean {
  const dom = view.scrollDOM
  return dom.scrollTop + dom.clientHeight >= dom.scrollHeight - 24
}

/** 把编辑器滚到最底（预览滚到底时对齐） */
export function scrollEditorToBottom(view: EditorViewType): void {
  view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight
}
