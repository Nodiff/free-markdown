import { useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { EditorView } from '@codemirror/view'
import type { Translator } from '@freemarkdown/core'
import { useDocStore } from '../store/docStore'
import { useMetaStore } from '../store/metaStore'
import CategoryPicker from './CategoryPicker'
import Editor from './Editor'

interface EditorPaneProps {
  t: Translator
  relPath: string
  readOnly: boolean
  /** 交给 App 做滚动同步 */
  onEditorReady?: (view: EditorView | null) => void
}

interface PickerAnchor {
  x: number
  y: number
}

const MAX_CHIPS = 3

/**
 * 编辑区 = 顶部 chip 行（分类前 3 个 + 「还有 N 个」）+ CodeMirror。
 * chip 本身就是分类入口：点一下打开分类弹层（与树上右键等价）。
 */
export default function EditorPane({ t, relPath, readOnly, onEditorReady }: EditorPaneProps) {
  const content = useDocStore((state) => state.content)
  const reloadToken = useDocStore((state) => state.reloadToken)
  const loading = useDocStore((state) => state.loading)
  const error = useDocStore((state) => state.error)
  const updateContent = useDocStore((state) => state.updateContent)
  const index = useMetaStore((state) => state.index)
  const [picker, setPicker] = useState<PickerAnchor | null>(null)

  const categories = useMemo(
    () => index.files.find((file) => file.relPath === relPath)?.categories ?? [],
    [index.files, relPath]
  )

  const openPicker = (event: ReactMouseEvent<HTMLElement>): void => {
    event.preventDefault()
    setPicker({ x: event.clientX + 6, y: event.clientY + 10 })
  }

  const visible = categories.slice(0, MAX_CHIPS)
  const hidden = categories.length - visible.length

  return (
    <div className="doc">
      <div className="doc__bar">
        <div className="doc__chips">
          {visible.map((name) => (
            <button key={name} type="button" className="chip" onClick={openPicker} title={name}>
              {name}
            </button>
          ))}
          {hidden > 0 && (
            <button type="button" className="chip chip--more" onClick={openPicker} title={categories.join('、')}>
              {t('doc.chip.more', { count: hidden })}
            </button>
          )}
          <button type="button" className="chip chip--add" onClick={openPicker} title={t('doc.chip.add')}>
            ＋
          </button>
        </div>
      </div>

      {loading ? (
        <div className="doc__state">{t('shell.explorer.loading')}</div>
      ) : error !== null ? (
        <div className="doc__state doc__state--error">{t('doc.loadFailed', { message: error })}</div>
      ) : (
        <Editor
          key={relPath}
          relPath={relPath}
          content={content}
          reloadToken={reloadToken}
          readOnly={readOnly}
          placeholder={t('doc.placeholder')}
          onChange={updateContent}
          onViewReady={onEditorReady}
        />
      )}

      {picker !== null && (
        <CategoryPicker t={t} relPath={relPath} x={picker.x} y={picker.y} onClose={() => setPicker(null)} />
      )}
    </div>
  )
}
