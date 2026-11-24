import { mkdir, open, rename, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { FileCreateValue, FileOpFailure, FileOpResult, FileRenameValue, TrashEntry } from '@freemarkdown/core'
import { resolveInside } from './paths'
import { moveToTrash } from './trash'

type VaultRef = { id: string; root: string }

const RESERVED = new Set(['.git', 'node_modules', '.ds_store'])

function failure(code: FileOpFailure['code'], message: string): FileOpFailure {
  return { ok: false, code, message }
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim()
  if (name === '' || name.length > 120) return null
  if (name.includes('/') || name.includes('\\') || name.includes('\0') || name.includes(':')) return null
  if (name === '.' || name === '..') return null
  if (RESERVED.has(name.toLowerCase())) return null
  return name
}

function errorCode(error: unknown): FileOpFailure['code'] {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'permission'
  if (code === 'ENOENT') return 'not-found'
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return 'exists'
  return 'unsupported'
}

function errorMessage(error: unknown, code: FileOpFailure['code']): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (code === 'permission') return '没有写入权限'
  if (code === 'not-found') return '路径不存在'
  if (code === 'exists') return '同级已有同名项'
  return raw
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function ensureDirectory(path: string): Promise<void> {
  const info = await stat(path)
  if (!info.isDirectory()) throw Object.assign(new Error('目标不是文件夹'), { code: 'ENOTDIR' })
}

/** 新建空文档或文件夹；名字只允许单层，不允许带路径 */
export async function createEntry(
  vault: VaultRef,
  dir: string,
  rawName: unknown,
  kind: 'md' | 'dir'
): Promise<FileOpResult<FileCreateValue>> {
  const name = normalizeName(rawName)
  if (name === null) return failure('invalid-name', '名字不能为空，也不能包含 / \\ :')

  const finalName = kind === 'md' && !/\.md$/i.test(name) ? `${name}.md` : name
  const targetRel = dir === '' ? finalName : `${dir}/${finalName}`
  const parentAbs = resolveInside(vault.root, dir)
  const targetAbs = resolveInside(vault.root, targetRel)

  try {
    await ensureDirectory(parentAbs)
    if (await exists(targetAbs)) return failure('exists', '同级已有同名项')

    if (kind === 'dir') {
      await mkdir(targetAbs)
    } else {
      // wx：原子占位，避免两次并发新建互相覆盖
      const handle = await open(targetAbs, 'wx')
      await handle.close()
    }
    return { ok: true, value: { relPath: targetRel, kind } }
  } catch (error) {
    const code = errorCode(error)
    return failure(code, errorMessage(error, code))
  }
}

/** 同级重命名；md 文件不会在这里擅自改扩展名，名字由渲染层完整给出 */
export async function renameEntry(
  vault: VaultRef,
  relPath: string,
  rawName: unknown
): Promise<FileOpResult<FileRenameValue>> {
  const name = normalizeName(rawName)
  if (name === null) return failure('invalid-name', '名字不能为空，也不能包含 / \\ :')

  const sourceAbs = resolveInside(vault.root, relPath)
  const parent = dirname(relPath) === '.' ? '' : dirname(relPath)
  const targetRel = parent === '' ? name : `${parent}/${name}`
  const targetAbs = resolveInside(vault.root, targetRel)

  try {
    await stat(sourceAbs)
    const caseOnly = targetRel.toLowerCase() === relPath.toLowerCase()
    if (!caseOnly && targetRel !== relPath && (await exists(targetAbs))) {
      return failure('exists', '同级已有同名项')
    }
    if (targetRel === relPath) return { ok: true, value: { relPath, oldRelPath: relPath } }

    // 大小写改名：APFS 默认大小写不敏感，exists 会把同一个文件当成冲突，直接 rename 又可能 no-op
    if (caseOnly) {
      const tmpRel = `${targetRel}.fm-case-${Date.now()}`
      const tmpAbs = resolveInside(vault.root, tmpRel)
      await rename(sourceAbs, tmpAbs)
      await rename(tmpAbs, targetAbs)
    } else {
      await rename(sourceAbs, targetAbs)
    }
    return { ok: true, value: { relPath: targetRel, oldRelPath: relPath } }
  } catch (error) {
    const code = errorCode(error)
    return failure(code, errorMessage(error, code))
  }
}

/** 删除：统一走应用回收站，目录也整棵保留 */
export async function removeEntry(vault: VaultRef, relPath: string): Promise<FileOpResult<TrashEntry>> {
  try {
    const entry = await moveToTrash(vault, relPath)
    return { ok: true, value: entry }
  } catch (error) {
    const code = errorCode(error)
    return failure(code, errorMessage(error, code))
  }
}

export function parentOf(relPath: string): string {
  const parent = dirname(relPath)
  return parent === '.' ? '' : parent
}

export function baseName(relPath: string): string {
  return basename(relPath)
}

export function absoluteFor(vault: VaultRef, relPath: string): string {
  return resolveInside(vault.root, relPath)
}

export function joinRel(parent: string, name: string): string {
  return parent === '' ? name : join(parent, name).replaceAll('\\', '/')
}
