import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isMarkdownPath, type TreeNode } from '@freemarkdown/core'
import { resolveInside } from './paths'

/** 永不显示：版本库内部目录、依赖目录、macOS 的目录元数据 */
const ALWAYS_IGNORED = new Set(['.git', 'node_modules', '.DS_Store'])

export async function listDirectory(root: string, relPath: string): Promise<TreeNode[]> {
  const absolute = resolveInside(root, relPath)
  const entries = await readdir(absolute, { withFileTypes: true })

  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (ALWAYS_IGNORED.has(entry.name)) continue

    const childRel = relPath === '' ? entry.name : `${relPath}/${entry.name}`

    if (entry.isDirectory()) {
      nodes.push({ relPath: childRel, name: entry.name, kind: 'dir', mtimeMs: 0, size: 0 })
      continue
    }

    // 软链不跟随：既避免循环，也让“树 = 硬盘目录”的语义保持直观
    if (!entry.isFile()) continue

    let mtimeMs = 0
    let size = 0
    try {
      const info = await stat(join(absolute, entry.name))
      mtimeMs = info.mtimeMs
      size = info.size
    } catch {
      // 瞬时文件、权限不足都按“存在但未知”处理，不让一个坏文件拖垮整层
    }

    nodes.push({
      relPath: childRel,
      name: entry.name,
      kind: isMarkdownPath(entry.name) ? 'md' : 'other',
      mtimeMs,
      size
    })
  }

  nodes.sort(compareNodes)
  return nodes
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind === 'dir' && b.kind !== 'dir') return -1
  if (a.kind !== 'dir' && b.kind === 'dir') return 1
  return a.name.localeCompare(b.name, 'zh', { numeric: true, sensitivity: 'base' })
}
