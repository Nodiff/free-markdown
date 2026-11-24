/**
 * 快捷键的单一来源。
 * 表里每一行同时是「设置面板要展示的内容」和「键盘事件的匹配规则」，
 * 因此不会出现「文档里写 ⌘F、代码里其实是 ⌘⇧F」这种漂移。
 */
import type { MessageKey } from '@freemarkdown/core'

export interface ShortcutDef {
  /** 对应命令注册表里的 id */
  command: string
  /** 平台无关的键位描述：mod = Cmd/Ctrl */
  keys: string
  /** 展示用标题；命令尚未落地时也能正确显示（不暴露内部 id） */
  titleKey: MessageKey
}

export const SHORTCUTS: ShortcutDef[] = [
  { command: 'vault.open', keys: 'mod+o', titleKey: 'command.vault.open' },
  { command: 'file.new', keys: 'mod+n', titleKey: 'command.file.new' },
  { command: 'file.newFolder', keys: 'mod+shift+n', titleKey: 'command.file.newFolder' },
  { command: 'file.rename', keys: 'f2', titleKey: 'command.file.rename' },
  { command: 'settings.open', keys: 'mod+,', titleKey: 'command.settings.open' },
  { command: 'commands.open', keys: 'mod+k', titleKey: 'command.commands.open' },
  { command: 'search.open', keys: 'mod+f', titleKey: 'command.search.open' },
  { command: 'file.quick-open', keys: 'mod+p', titleKey: 'command.file.quickOpen' },
  { command: 'sidebar.toggle', keys: 'mod+b', titleKey: 'command.sidebar.toggle' },
  { command: 'view.mode.edit', keys: 'mod+1', titleKey: 'command.view.edit' },
  { command: 'view.mode.split', keys: 'mod+2', titleKey: 'command.view.split' },
  { command: 'view.mode.read', keys: 'mod+3', titleKey: 'command.view.read' },
  { command: 'doc.save', keys: 'mod+s', titleKey: 'command.doc.save' },
  { command: 'history.save', keys: 'mod+shift+s', titleKey: 'command.history.save' },
  { command: 'doc.delete', keys: 'mod+backspace', titleKey: 'command.doc.delete' },
  { command: 'app.toggleLocale', keys: 'mod+shift+l', titleKey: 'command.app.toggleLocale' }
]

/** 把键盘事件归一成 `mod+s` 这类描述；不匹配任何修饰键组合时返回 null */
export function eventToKeys(event: KeyboardEvent): string | null {
  const mod = event.metaKey || event.ctrlKey
  if (!mod) return null

  const key = normalizeKey(event.key)
  if (key === null) return null

  const parts = ['mod']
  if (event.shiftKey) parts.push('shift')
  if (event.altKey) parts.push('alt')
  parts.push(key)
  return parts.join('+')
}

function normalizeKey(raw: string): string | null {
  if (raw.length === 1) return raw.toLowerCase()
  const named: Record<string, string> = {
    Enter: 'enter',
    Escape: 'escape',
    Backspace: 'backspace',
    ArrowUp: 'up',
    ArrowDown: 'down'
  }
  return named[raw] ?? null
}

/** 返回匹配到的命令 id */
export function matchShortcut(event: KeyboardEvent): string | null {
  // F2 没有 mod 修饰键，单独接一下；其余组合仍走统一表
  if (event.key === 'F2' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    return SHORTCUTS.find((item) => item.keys === 'f2')?.command ?? null
  }
  const keys = eventToKeys(event)
  if (keys === null) return null
  const hit = SHORTCUTS.find((item) => item.keys === keys)
  return hit?.command ?? null
}

/** 启动自检：同一个组合被注册两次时返回冲突描述，绝不静默覆盖 */
export function detectConflicts(): string[] {
  const seen = new Map<string, string>()
  const conflicts: string[] = []
  for (const item of SHORTCUTS) {
    const prev = seen.get(item.keys)
    if (prev !== undefined) conflicts.push(`${item.keys}: ${prev} / ${item.command}`)
    else seen.set(item.keys, item.command)
  }
  return conflicts
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  enter: '↩',
  backspace: '⌫',
  f2: 'F2',
  up: '↑',
  down: '↓'
}

const WIN_SYMBOLS: Record<string, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  enter: 'Enter',
  backspace: 'Backspace',
  f2: 'F2',
  up: '↑',
  down: '↓'
}

/** 把 `mod+shift+l` 渲染成 `⌘⇧L` 或 `Ctrl+Shift+L` */
export function shortcutLabel(keys: string, platform: string): string {
  const symbols = platform === 'darwin' ? MAC_SYMBOLS : WIN_SYMBOLS
  const parts = keys.split('+').map((part) => symbols[part] ?? part.toUpperCase())
  return parts.join(platform === 'darwin' ? '' : '+')
}
