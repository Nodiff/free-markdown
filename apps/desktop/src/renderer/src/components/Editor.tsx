import { useEffect, useRef } from 'react'
import { Compartment, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  rectangularSelection
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { readCachedState, writeCachedState } from '../editorStateCache'
import { useThemeStore } from '../store/themeStore'

interface EditorProps {
  relPath: string
  content: string
  /** 外部重载时 +1：此时才需要用 content 覆盖编辑器正文 */
  reloadToken: number
  readOnly: boolean
  placeholder: string
  onChange: (text: string) => void
  /** 实例就绪/销毁时回调，供滚动同步拿到底层 view */
  onViewReady?: (view: EditorView | null) => void
}

/** 与应用同色系的浅色主题，避免 CodeMirror 默认样式和数据面板打架 */
const fmTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '14px', color: '#1f2329', backgroundColor: '#ffffff' },
    '.cm-scroller': {
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Mono", "PingFang SC", "Microsoft YaHei", sans-serif',
      lineHeight: '1.75',
      overflow: 'auto'
    },
    '.cm-content': { padding: '18px 0 80px', caretColor: '#2f6fed' },
    '.cm-line': { padding: '0 24px 0 8px' },
    '.cm-gutters': {
      backgroundColor: '#ffffff',
      border: 'none',
      color: '#b9c0ca',
      paddingLeft: '10px',
      paddingRight: '2px'
    },
    '.cm-activeLine': { backgroundColor: '#f7f8fa' },
    '.cm-activeLineGutter': { backgroundColor: '#f7f8fa' },
    '.cm-cursor': { borderLeftColor: '#2f6fed', borderLeftWidth: '2px' },
    '.cm-selectionBackground': { backgroundColor: '#d7e3ff' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: '#cddcff' },
    '.cm-panels': { backgroundColor: '#ffffff' },
    '.cm-placeholder': { color: '#b9c0ca' }
  },
  { dark: false }
)

/** 深色主题只换颜色，不换排版；切换用 Compartment，避免重建 EditorView 丢撤销历史 */
const fmDarkTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '14px', color: '#e6e8ec', backgroundColor: '#1b1e23' },
    '.cm-scroller': {
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Mono", "PingFang SC", "Microsoft YaHei", sans-serif',
      lineHeight: '1.75',
      overflow: 'auto'
    },
    '.cm-content': { padding: '18px 0 80px', caretColor: '#6f9dff' },
    '.cm-line': { padding: '0 24px 0 8px' },
    '.cm-gutters': {
      backgroundColor: '#1b1e23',
      border: 'none',
      color: '#5d6673',
      paddingLeft: '10px',
      paddingRight: '2px'
    },
    '.cm-activeLine': { backgroundColor: '#22262c' },
    '.cm-activeLineGutter': { backgroundColor: '#22262c' },
    '.cm-cursor': { borderLeftColor: '#6f9dff', borderLeftWidth: '2px' },
    '.cm-selectionBackground': { backgroundColor: '#2a4166' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: '#315080' },
    '.cm-panels': { backgroundColor: '#1b1e23' },
    '.cm-placeholder': { color: '#5d6673' }
  },
  { dark: true }
)

const fmHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: '600', lineHeight: '1.5' },
  { tag: tags.heading2, fontSize: '1.28em', fontWeight: '600' },
  { tag: tags.heading3, fontSize: '1.14em', fontWeight: '600' },
  { tag: tags.heading4, fontWeight: '600' },
  { tag: tags.heading, fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#2f6fed' },
  { tag: tags.url, color: '#8a929c' },
  { tag: tags.monospace, fontFamily: '"SF Mono", Menlo, Consolas, monospace', color: '#3d4654' },
  { tag: tags.quote, color: '#5c6470', fontStyle: 'italic' },
  { tag: tags.list, color: '#2f6fed' },
  { tag: tags.processingInstruction, color: '#9aa3af' },
  { tag: tags.comment, color: '#9aa3af' }
])

const fmDarkHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.5em', fontWeight: '600', lineHeight: '1.5' },
  { tag: tags.heading2, fontSize: '1.28em', fontWeight: '600' },
  { tag: tags.heading3, fontSize: '1.14em', fontWeight: '600' },
  { tag: tags.heading4, fontWeight: '600' },
  { tag: tags.heading, fontWeight: '600' },
  { tag: tags.strong, fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: '#8ab4f8' },
  { tag: tags.url, color: '#9aa3af' },
  { tag: tags.monospace, fontFamily: '"SF Mono", Menlo, Consolas, monospace', color: '#c7d0da' },
  { tag: tags.quote, color: '#a7aeb9', fontStyle: 'italic' },
  { tag: tags.list, color: '#8ab4f8' },
  { tag: tags.processingInstruction, color: '#7d8692' },
  { tag: tags.comment, color: '#7d8692' }
])

function themeExtensions(dark: boolean): Extension[] {
  return dark ? [fmDarkTheme, syntaxHighlighting(fmDarkHighlight)] : [fmTheme, syntaxHighlighting(fmHighlight)]
}

const themeCompartment = new Compartment()
const readOnlyCompartment = new Compartment()

/**
 * CodeMirror 6 宿主。每个文档一个实例（由父组件用 key 切换），
 * 卸载时把 EditorState 存进 LRU，切回来连 undo 历史与滚动位置都在。
 */
export default function Editor({
  relPath,
  content,
  reloadToken,
  readOnly,
  placeholder,
  onChange,
  onViewReady
}: EditorProps) {
  const theme = useThemeStore((state) => state.resolved)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onViewReadyRef = useRef(onViewReady)
  const lastReloadRef = useRef(reloadToken)

  onChangeRef.current = onChange
  onViewReadyRef.current = onViewReady

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return

    const cached = readCachedState(relPath)
    // 缓存里的正文和磁盘/状态不一致（例如外部重载过）时，缓存失效，按最新正文重建
    const useCache = cached !== null && cached.state.doc.toString() === content

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      themeCompartment.of(themeExtensions(theme === 'dark')),
      cmPlaceholder(placeholder),
      readOnlyCompartment.of(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
      })
    ]

    const state = useCache
      ? cached.state
      : EditorState.create({ doc: content, extensions })

    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    onViewReadyRef.current?.(view)

    if (useCache && cached !== null) {
      const scrollTop = cached.scrollTop
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = scrollTop
      })
    }

    return () => {
      writeCachedState(relPath, view)
      onViewReadyRef.current?.(null)
      view.destroy()
      viewRef.current = null
    }
    // relPath / content 只作为「首次建实例」的输入，后续变更走下面的 effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath])

  // 只读模式切换（三态视图之间来回切）
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    view.dispatch({
      effects: readOnlyCompartment.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []
      )
    })
  }, [readOnly])

  // 深浅色切换：只重配置主题与高亮，保留撤销历史、选区和滚动位置
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    view.dispatch({ effects: themeCompartment.reconfigure(themeExtensions(theme === 'dark')) })
  }, [theme])

  // 外部内容变化：整体替换正文，但按行号比例尽量把光标放回原处
  useEffect(() => {
    const view = viewRef.current
    if (view === null) return
    if (lastReloadRef.current === reloadToken) return
    lastReloadRef.current = reloadToken

    const doc = view.state.doc
    if (doc.toString() === content) return

    const head = view.state.selection.main.head
    const ratio = doc.lines > 1 ? (doc.lineAt(head).number - 1) / (doc.lines - 1) : 0

    view.dispatch({ changes: { from: 0, to: doc.length, insert: content } })

    const next = view.state.doc
    const line = Math.max(1, Math.min(next.lines, Math.round(ratio * (next.lines - 1)) + 1))
    view.dispatch({ selection: { anchor: next.line(line).from } })
  }, [reloadToken, content])

  return <div className="editor" ref={hostRef} />
}
