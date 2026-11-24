import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { FileOpErrorCode, Translator, TreeNode } from '@freemarkdown/core'
import { runCommand } from '../commands'
import { useDocStore } from '../store/docStore'
import { useMetaStore } from '../store/metaStore'
import { useVaultStore } from '../store/vaultStore'
import CategoryPicker from './CategoryPicker'
import FilteredList from './FilteredList'
import TreeMenu, { type TreeMenuAction } from './TreeMenu'
import { CaretIcon, FileIcon, FolderIcon, MarkdownIcon } from './icons'

interface ExplorerPanelProps {
  t: Translator
}

interface PickerState {
  relPath: string
  x: number
  y: number
}

interface MenuState {
  node: TreeNode | null
  x: number
  y: number
}

interface Notice {
  message: string
  actionLabel?: string
  action?: () => void | Promise<void>
}

type ContextMenuEvent = ReactMouseEvent<HTMLElement>

function parentDir(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash < 0 ? '' : relPath.slice(0, slash)
}

function baseName(relPath: string): string {
  const slash = relPath.lastIndexOf('/')
  return slash < 0 ? relPath : relPath.slice(slash + 1)
}

function splitName(name: string, kind: TreeNode['kind']): [string, string] {
  if (kind !== 'md') return [name, '']
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return [name, '']
  return [name.slice(0, dot), name.slice(dot)]
}

function errorText(code: FileOpErrorCode, message: string, t: Translator): string {
  if (code === 'exists') return t('file.nameExists')
  if (code === 'invalid-name') return t('file.nameInvalid')
  if (code === 'permission') return t('file.namePermission')
  if (code === 'not-found') return t('file.pathNotFound')
  return message
}

function uniqueName(base: string, children: TreeNode[] | undefined, ext: string): string {
  const taken = new Set((children ?? []).map((node) => node.name.toLowerCase()))
  let candidate = base
  let index = 1
  while (taken.has(`${candidate}${ext}`.toLowerCase())) {
    index += 1
    candidate = `${base} ${index}`
  }
  return candidate
}

/**
 * 文件区：默认渲染真实目录树；选中内置视图或分类时切换成扁平列表。
 * 右键 md → 分类弹层；树行/空白 → 新建、重命名、删除、Finder、复制路径。
 */
export default function ExplorerPanel({ t }: ExplorerPanelProps) {
  const vault = useVaultStore((state) => state.vault)
  const recent = useVaultStore((state) => state.recent)
  const error = useVaultStore((state) => state.error)
  const view = useMetaStore((state) => state.view)
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [confirmDir, setConfirmDir] = useState<TreeNode | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotice = useCallback((next: Notice, ms = 2200): void => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
    setNotice(next)
    noticeTimer.current = setTimeout(() => {
      noticeTimer.current = null
      setNotice(null)
    }, ms)
  }, [])

  useEffect(() => () => {
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
  }, [])

  useEffect(() => {
    if (confirmDir === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setConfirmDir(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [confirmDir])

  const reload = useCallback(async (dir: string): Promise<void> => {
    await useVaultStore.getState().reloadDirs([dir])
    void useMetaStore.getState().refresh()
  }, [])

  const doDelete = useCallback(async (target: { relPath: string; name: string; kind: TreeNode['kind'] }): Promise<void> => {
    const isDir = target.kind === 'dir'
    const doc = useDocStore.getState()
    const affectsDoc = doc.relPath === target.relPath || (isDir && doc.relPath?.startsWith(`${target.relPath}/`))

    if (affectsDoc && doc.dirty) {
      await doc.save()
      if (useDocStore.getState().dirty) {
        showNotice({ message: t('file.deleteSaveFailed') })
        return
      }
    }

    const result = await window.fm.files.remove(target.relPath)
    if (!result.ok) {
      showNotice({ message: t('file.trashFailed', { message: errorText(result.code, result.message, t) }) })
      return
    }

    if (affectsDoc) useDocStore.getState().clearIfUnder(target.relPath, isDir)
    useVaultStore.getState().applyDelete(target.relPath, isDir)
    await reload(parentDir(target.relPath))

    const undo = async (): Promise<void> => {
      try {
        const restored = await window.fm.trash.restore(target.relPath)
        await reload(parentDir(target.relPath))
        if (isDir) await useVaultStore.getState().expandDir(restored.relPath)
        showNotice({ message: restored.renamed ? `${target.name} → ${restored.relPath}` : t('file.restored', { name: target.name }) }, 2200)
      } catch (cause) {
        showNotice({ message: t('file.trashFailed', { message: String(cause) }) })
      }
    }

    showNotice(
      {
        message: t('file.trashed', { name: target.name }),
        actionLabel: t('file.trashUndo'),
        action: undo
      },
      8000
    )
    if (affectsDoc && isDir) showNotice({ message: t('file.deletedCurrent'), actionLabel: t('file.trashUndo'), action: undo }, 8000)
  }, [reload, showNotice, t])

  const requestDelete = useCallback((target: TreeNode): void => {
    if (target.kind === 'dir') {
      setConfirmDir(target)
      return
    }
    void doDelete(target)
  }, [doDelete])

  const handleMenuAction = useCallback((action: TreeMenuAction): void => {
    if (menu === null) return
    const node = menu.node
    const { x, y } = menu
    setMenu(null)

    if (action === 'new-doc' || action === 'new-dir') {
      const dir = node === null ? '' : node.kind === 'dir' ? node.relPath : parentDir(node.relPath)
      if (node !== null) useVaultStore.getState().select(node.relPath, node.kind)
      void useVaultStore.getState().startCreate(action === 'new-doc' ? 'md' : 'dir', dir)
      return
    }
    if (node === null) return

    if (action === 'rename') {
      useVaultStore.getState().select(node.relPath, node.kind)
      useVaultStore.getState().startRename(node.relPath)
      return
    }
    if (action === 'trash') {
      useVaultStore.getState().select(node.relPath, node.kind)
      requestDelete(node)
      return
    }
    if (action === 'category') {
      setPicker({ relPath: node.relPath, x, y })
      return
    }
    if (action === 'reveal') {
      void window.fm.files.reveal(node.relPath).catch(() => undefined)
      return
    }
    if (action === 'copy-path') {
      void navigator.clipboard.writeText(node.relPath).then(() => showNotice({ message: t('file.copyDone') }))
    }
  }, [menu, requestDelete, showNotice, t])

  // 列头/命令与左栏之间只通过这条事件通信，避免把文件操作逻辑塞进 App
  useEffect(() => {
    const onCommand = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail
      if (detail === 'new-doc' || detail === 'new-dir') {
        void useVaultStore.getState().startCreate(detail === 'new-doc' ? 'md' : 'dir')
      } else if (detail === 'rename') {
        useVaultStore.getState().startRename()
      } else if (detail === 'delete') {
        const state = useVaultStore.getState()
        const path = state.selectedPath ?? state.activePath
        const kind = state.selectedKind ?? (state.activePath !== null ? 'md' : null)
        if (path !== null && kind !== null) requestDelete({ relPath: path, name: baseName(path), kind, mtimeMs: 0, size: 0 })
      }
    }
    const onAddMenu = (event: Event): void => {
      const detail = (event as CustomEvent<{ x: number; y: number }>).detail
      setMenu({ node: null, x: detail.x, y: detail.y })
      setPicker(null)
    }
    window.addEventListener('fm:file-command', onCommand)
    window.addEventListener('fm:add-menu', onAddMenu)
    return () => {
      window.removeEventListener('fm:file-command', onCommand)
      window.removeEventListener('fm:add-menu', onAddMenu)
    }
  }, [requestDelete])

  if (vault === null) {
    return (
      <div className="explorer__empty">
        <p className="explorer__empty-title">{t('shell.explorer.empty')}</p>
        <p className="explorer__empty-hint">{t('shell.explorer.hint')}</p>
        <button type="button" className="primary" onClick={() => void runCommand('vault.open')}>
          {t('shell.explorer.open')}
        </button>
        {recent.length > 0 && (
          <div className="recent">
            <p className="recent__title">{t('shell.explorer.recent')}</p>
            <ul className="recent__list">
              {recent.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="recent__item"
                    title={item.root}
                    onClick={() => void runCommand('vault.switch', item.id)}
                  >
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error !== null && <p className="explorer__error">{t('shell.explorer.failed', { message: error })}</p>}
      </div>
    )
  }

  return (
    <div className="tree-host">
      {view.kind === 'tree' ? (
        <div
          className="tree"
          onContextMenu={(event) => {
            if ((event.target as HTMLElement).closest('.tree__row, .tree__inline, .tree-menu')) return
            event.preventDefault()
            setMenu({ node: null, x: event.clientX, y: event.clientY })
            setPicker(null)
          }}
        >
          <TreeLevel dirPath="" depth={0} t={t} onOpenMenu={(node, x, y) => setMenu({ node, x, y })} />
          {error !== null && <p className="explorer__error">{t('shell.explorer.failed', { message: error })}</p>}
          <div className="tree__foot">
            <button type="button" className="recent__item" onClick={() => void runCommand('vault.open')}>
              {t('shell.explorer.switch')}…
            </button>
          </div>
        </div>
      ) : (
        <FilteredList t={t} view={view} />
      )}

      {picker !== null && (
        <CategoryPicker t={t} relPath={picker.relPath} x={picker.x} y={picker.y} onClose={() => setPicker(null)} />
      )}

      {menu !== null && (
        <TreeMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          t={t}
          onAction={handleMenuAction}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmDir !== null && (
        <div className="confirm-backdrop" onClick={() => setConfirmDir(null)}>
          <div className="confirm-card" onClick={(event) => event.stopPropagation()}>
            <h2 className="confirm-card__title">{t('file.trashFolderTitle', { name: confirmDir.name })}</h2>
            <p className="confirm-card__body">{t('file.trashFolderBody')}</p>
            <div className="confirm-card__actions">
              <button type="button" className="btn" autoFocus onClick={() => setConfirmDir(null)}>
                {t('file.trashFolderCancel')}
              </button>
              <button
                type="button"
                className="btn is-danger"
                onClick={() => {
                  const target = confirmDir
                  setConfirmDir(null)
                  void doDelete(target)
                }}
              >
                {t('file.trashFolderAction')}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice !== null && (
        <div className="toast toast--action">
          <span>{notice.message}</span>
          {notice.actionLabel !== undefined && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
                setNotice(null)
                void notice.action?.()
              }}
            >
              {notice.actionLabel}
            </button>
          )}
        </div>
      )}

    </div>
  )
}

interface TreeLevelProps {
  dirPath: string
  depth: number
  t: Translator
  onOpenMenu: (node: TreeNode, x: number, y: number) => void
}

function TreeLevel({ dirPath, depth, t, onOpenMenu }: TreeLevelProps) {
  const children = useVaultStore((state) => state.children[dirPath])
  const pendingCreate = useVaultStore((state) => state.pendingCreate)

  const creatingHere = pendingCreate?.dir === dirPath

  if (children === undefined) {
    return (
      <p className="tree__hint" style={{ paddingLeft: `${12 + depth * 14}px` }}>
        {t('shell.explorer.loading')}
      </p>
    )
  }

  if (children.length === 0 && !creatingHere) {
    return (
      <>
        <p className="tree__hint" style={{ paddingLeft: `${12 + depth * 14}px` }}>
          {t('shell.explorer.emptyDir')}
        </p>
        <p className="tree__hint tree__hint--soft" style={{ paddingLeft: `${12 + depth * 14}px` }}>
          {t('file.emptyHint')}
        </p>
      </>
    )
  }

  return (
    <>
      {creatingHere && <InlineCreateRow dirPath={dirPath} depth={depth} t={t} siblings={children} />}
      {children.map((node) => (
        <TreeRow key={node.relPath} node={node} depth={depth} t={t} onOpenMenu={onOpenMenu} />
      ))}
    </>
  )
}

interface TreeRowProps {
  node: TreeNode
  depth: number
  t: Translator
  onOpenMenu: (node: TreeNode, x: number, y: number) => void
}

function TreeRow({ node, depth, t, onOpenMenu }: TreeRowProps) {
  const expanded = useVaultStore((state) => state.expanded.has(node.relPath))
  const active = useVaultStore((state) => state.activePath === node.relPath)
  const selected = useVaultStore((state) => state.selectedPath === node.relPath)
  const renaming = useVaultStore((state) => state.renamingPath === node.relPath)
  const isDir = node.kind === 'dir'

  const onActivate = (): void => {
    useVaultStore.getState().select(node.relPath, node.kind)
    if (isDir) {
      void useVaultStore.getState().toggleDir(node.relPath)
      return
    }
    if (node.kind === 'md') {
      useMetaStore.getState().openDoc(node.relPath)
      return
    }
    void useVaultStore.getState().openExternal(node.relPath)
  }

  if (renaming) {
    const [stem, ext] = splitName(node.name, node.kind)
    return (
      <InlineRenameRow node={node} depth={depth} stem={stem} ext={ext} t={t} />
    )
  }

  return (
    <>
      <button
        type="button"
        className={[
          'tree__row',
          active ? 'is-active' : '',
          selected && !active ? 'is-selected' : '',
          node.kind === 'other' ? 'is-dim' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={onActivate}
        onContextMenu={(event: ContextMenuEvent) => {
          event.preventDefault()
          event.stopPropagation()
          useVaultStore.getState().select(node.relPath, node.kind)
          onOpenMenu(node, event.clientX, event.clientY)
        }}
        title={node.relPath}
      >
        <span className={isDir && expanded ? 'tree__caret is-open' : 'tree__caret'}>
          {isDir ? <CaretIcon /> : null}
        </span>
        <span className="tree__icon">{isDir ? <FolderIcon /> : node.kind === 'md' ? <MarkdownIcon /> : <FileIcon />}</span>
        <span className="tree__name">{node.name}</span>
        {node.kind === 'other' && <span className="tree__suffix">{t('shell.explorer.openExternal')}</span>}
        <span
          className="tree__more"
          role="button"
          tabIndex={-1}
          title={t('file.more')}
          onClick={(event) => {
            event.stopPropagation()
            useVaultStore.getState().select(node.relPath, node.kind)
            onOpenMenu(node, event.clientX + 4, event.clientY + 4)
          }}
        >
          ⋯
        </span>
      </button>
      {isDir && expanded && <TreeLevel dirPath={node.relPath} depth={depth + 1} t={t} onOpenMenu={onOpenMenu} />}
    </>
  )
}

interface InlineCreateRowProps {
  dirPath: string
  depth: number
  t: Translator
  siblings: TreeNode[] | undefined
}

function InlineCreateRow({ dirPath, depth, t, siblings }: InlineCreateRowProps) {
  const pending = useVaultStore((state) => state.pendingCreate)
  const kind = pending?.kind ?? 'md'
  const isDir = kind === 'dir'
  const ext = isDir ? '' : '.md'
  const initial = uniqueName(isDir ? t('file.untitledFolder') : t('file.untitledDoc'), siblings, ext)

  return (
    <div className="tree__inline" style={{ paddingLeft: `${8 + depth * 14}px` }}>
      <span className="tree__caret" />
      <span className="tree__icon">{isDir ? <FolderIcon /> : <MarkdownIcon />}</span>
      <InlineNameInput
        initial={initial}
        ext={ext}
        placeholder={isDir ? t('file.untitledFolder') : t('file.untitledDoc')}
        onSubmit={async (value) => {
          const result = await window.fm.files.create({ dir: dirPath, name: `${value}${ext}`, kind })
          if (!result.ok) return errorText(result.code, result.message, t)
          useVaultStore.getState().cancelCreate()
          await useVaultStore.getState().reloadDirs([dirPath])
          useVaultStore.getState().select(result.value.relPath, result.value.kind)
          if (result.value.kind === 'dir') {
            await useVaultStore.getState().expandDir(result.value.relPath)
          } else {
            await useMetaStore.getState().openDoc(result.value.relPath)
          }
          void useMetaStore.getState().refresh()
          return null
        }}
        onCancel={() => useVaultStore.getState().cancelCreate()}
        t={t}
      />
    </div>
  )
}

interface InlineRenameRowProps {
  node: TreeNode
  depth: number
  stem: string
  ext: string
  t: Translator
}

function InlineRenameRow({ node, depth, stem, ext, t }: InlineRenameRowProps) {
  const isDir = node.kind === 'dir'
  return (
    <div className="tree__inline" style={{ paddingLeft: `${8 + depth * 14}px` }}>
      <span className={isDir && useVaultStore.getState().expanded.has(node.relPath) ? 'tree__caret is-open' : 'tree__caret'}>
        {isDir ? <CaretIcon /> : null}
      </span>
      <span className="tree__icon">{isDir ? <FolderIcon /> : node.kind === 'md' ? <MarkdownIcon /> : <FileIcon />}</span>
      <InlineNameInput
        initial={stem}
        ext={ext}
        placeholder={node.name}
        onSubmit={async (value) => {
          const doc = useDocStore.getState()
          const activeInside = doc.relPath === node.relPath || (isDir && doc.relPath?.startsWith(`${node.relPath}/`))
          if (activeInside && doc.dirty) {
            await doc.save()
            if (useDocStore.getState().dirty) return t('file.renameSaveFailed')
          }

          const result = await window.fm.files.rename({ relPath: node.relPath, name: `${value}${ext}` })
          if (!result.ok) return errorText(result.code, result.message, t)

          const expandedOld = useVaultStore.getState().expanded.has(node.relPath)
          useVaultStore.getState().applyRename(node.relPath, result.value.relPath, isDir)

          if (doc.relPath === node.relPath) {
            useDocStore.getState().retargetPath(result.value.relPath)
          } else if (isDir && doc.relPath?.startsWith(`${node.relPath}/`)) {
            useDocStore.getState().retargetPath(result.value.relPath + doc.relPath.slice(node.relPath.length))
          }

          await useVaultStore.getState().reloadDirs([parentDir(node.relPath)])
          if (isDir && expandedOld) await useVaultStore.getState().expandDir(result.value.relPath)
          void useMetaStore.getState().refresh()
          return null
        }}
        onCancel={() => useVaultStore.getState().cancelRename()}
        t={t}
      />
    </div>
  )
}

interface InlineNameInputProps {
  initial: string
  ext: string
  placeholder: string
  onSubmit: (value: string) => Promise<string | null>
  onCancel: () => void
  t: Translator
}

function InlineNameInput({ initial, ext, placeholder, onSubmit, onCancel, t }: InlineNameInputProps) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (input === null) return
    input.focus()
    input.setSelectionRange(0, input.value.length)
  }, [])

  const commit = async (): Promise<void> => {
    if (busy || cancelled.current) return
    const trimmed = value.trim()
    if (trimmed === '') {
      setError(t('file.nameEmpty'))
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    const message = await onSubmit(trimmed)
    setBusy(false)
    if (message !== null) {
      setError(message)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }

  return (
    <div className="tree__inline-field">
      <input
        ref={inputRef}
        className={error !== null ? 'tree__input is-error' : 'tree__input'}
        value={value}
        placeholder={placeholder}
        disabled={busy}
        onChange={(event) => {
          setValue(event.target.value)
          setError(null)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') {
            event.preventDefault()
            void commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancelled.current = true
            onCancel()
          }
        }}
        onBlur={() => void commit()}
      />
      {ext !== '' && <span className="tree__ext">{ext}</span>}
      {error !== null && <span className="tree__inline-error">{error}</span>}
    </div>
  )
}
