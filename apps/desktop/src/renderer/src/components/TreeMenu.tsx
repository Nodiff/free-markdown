import { useEffect, useRef, type ReactElement } from 'react'
import type { Translator, TreeNode } from '@freemarkdown/core'

export type TreeMenuAction = 'new-doc' | 'new-dir' | 'rename' | 'trash' | 'category' | 'reveal' | 'copy-path'

interface TreeMenuProps {
  node: TreeNode | null
  x: number
  y: number
  t: Translator
  onAction: (action: TreeMenuAction) => void
  onClose: () => void
}

const WIDTH = 220
const ITEM_H = 30

/** 树上下文菜单：固定定位，贴边自动翻转；和分类弹层共用一次只开一个的约定 */
export default function TreeMenu({ node, x, y, t, onAction, onClose }: TreeMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  const isDir = node?.kind === 'dir'
  const isMd = node?.kind === 'md'
  const itemCount = 2 + (node === null ? 0 : 1 + 1 + (isMd ? 1 : 0) + 2) + 3
  const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - itemCount * ITEM_H - 24))

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.tree-menu__item')?.focus()
  }, [])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && event.target instanceof Node && ref.current.contains(event.target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  const item = (action: TreeMenuAction, label: string, shortcut?: string, danger = false): ReactElement => (
    <button
      type="button"
      className={danger ? 'tree-menu__item is-danger' : 'tree-menu__item'}
      onClick={() => onAction(action)}
    >
      <span>{label}</span>
      {shortcut !== undefined && <code>{shortcut}</code>}
    </button>
  )

  return (
    <div ref={ref} className="tree-menu" style={{ left, top }} role="menu">
      {item('new-doc', t('file.menu.newDoc'), '⌘N')}
      {item('new-dir', t('file.menu.newFolder'), '⌘⇧N')}
      {node !== null && (
        <>
          <div className="tree-menu__sep" />
          {item('rename', t('file.menu.rename'), 'F2')}
          {item('trash', t('file.menu.trash'), '⌘⌫', true)}
          {isMd && (
            <>
              <div className="tree-menu__sep" />
              {item('category', t('file.menu.category'))}
            </>
          )}
          {isDir && <span className="tree-menu__note">{node.relPath}</span>}
          <div className="tree-menu__sep" />
          {item('reveal', t('file.menu.reveal'))}
          {item('copy-path', t('file.menu.copyPath'))}
        </>
      )}
    </div>
  )
}
