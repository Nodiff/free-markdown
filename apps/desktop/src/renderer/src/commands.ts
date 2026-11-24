import type { MessageKey } from '@freemarkdown/core'

export type CommandGroup = 'app' | 'view' | 'vault' | 'file'

export interface Command {
  id: string
  titleKey: MessageKey
  group: CommandGroup
  /** 参数留给需要上下文的命令（比如“切换到某个库”） */
  run: (payload?: unknown) => void | Promise<void>
}

/**
 * 命令注册表：渲染层所有可执行动作的唯一入口。
 * 按钮、菜单、快捷键都只调 runCommand(id)，不要直接绑业务逻辑——
 * 这样命令面板、插件注册命令、快捷键重绑都不需要改 UI。
 */
const registry = new Map<string, Command>()

export function registerCommand(command: Command): () => void {
  registry.set(command.id, command)
  return () => {
    if (registry.get(command.id) === command) registry.delete(command.id)
  }
}

export function listCommands(): Command[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id)
}

export async function runCommand(id: string, payload?: unknown): Promise<boolean> {
  const command = registry.get(id)
  if (command === undefined) return false
  await command.run(payload)
  return true
}
