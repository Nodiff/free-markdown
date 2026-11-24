import { isAbsolute, relative, resolve } from 'node:path'
import { toPosix } from '@freemarkdown/core'

/**
 * 渲染进程传来的相对路径一律当不可信输入处理：
 * 归一化、拒绝 '.' / '..' / 绝对路径 / 空字节，最后再校验解析结果落在库根内。
 */
export function normalizeRelPath(input: unknown): string {
  if (typeof input !== 'string') throw new Error('路径必须是字符串')
  if (input.includes('\0')) throw new Error('路径非法')

  const cleaned = toPosix(input.trim()).replace(/^\.\/+/, '').replace(/^\/+/, '')
  if (cleaned === '' || cleaned === '.') return ''

  const segments = cleaned.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error('路径非法')
  }
  return cleaned
}

/** 把相对路径解析成绝对路径，并确保结果在 root 之内（防目录穿越） */
export function resolveInside(root: string, relPath: string): string {
  const target = resolve(root, normalizeRelPath(relPath))
  const rel = relative(root, target)
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error('路径越界')
  }
  return target
}

export function toRelPath(root: string, absolutePath: string): string {
  return toPosix(relative(root, absolutePath))
}
