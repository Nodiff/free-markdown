/**
 * 插件 API 的类型定义。
 *
 * v1（当前）只有类型，没有运行时：这份文件的作用是把「插件将来能做什么」写清楚，
 * 让内核照着这个边界建注册表，而不是先写一版 API 再改。
 *
 * 运行时计划放在 v3：插件跑在 utilityProcess / Worker 里，通过消息桥拿到下面这些能力，
 * 永远不直接接触 fs 与 child_process。
 */
import type { Locale } from '@freemarkdown/core'

export type PluginPermission =
  | 'vault:read'
  | 'vault:write'
  | 'commands'
  | 'preview'
  | 'export'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  author?: string
  /** 插件声明自己适配的 API 版本 */
  apiVersion: number
  permissions: PluginPermission[]
  /** 插件入口文件（相对插件目录） */
  main: string
}

export interface PluginCommand {
  id: string
  title: string
}

export interface PluginDocumentRef {
  relPath: string
  title: string
}

/** 运行时可用的受控能力。注意：没有 fs，没有 child_process，没有任意网络请求。 */
export interface PluginContext {
  manifest: PluginManifest
  locale: Locale
  /** 注册命令，返回取消注册的函数 */
  registerCommand(command: PluginCommand, handler: () => void | Promise<void>): () => void
  /** 读取当前库里的文档（受 vault:read 权限约束） */
  readDocument(relPath: string): Promise<string>
  /** 写入文档（受 vault:write 权限约束） */
  writeDocument(relPath: string, content: string): Promise<void>
  /** 列出当前库的文档 */
  listDocuments(): Promise<PluginDocumentRef[]>
}
