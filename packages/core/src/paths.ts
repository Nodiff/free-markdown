/**
 * 只处理 posix 风格的相对路径（对外一律用 '/'，即使运行在 Windows 上）。
 * 这里不引入 node:path，因为渲染进程也要用。
 */

export function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

export function dirnamePosix(path: string): string {
  const normalized = toPosix(path)
  const index = normalized.lastIndexOf('/')
  if (index === -1) return '.'
  const head = normalized.slice(0, index)
  return head === '' ? '/' : head
}

export function basenamePosix(path: string): string {
  const normalized = toPosix(path)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

export function extnamePosix(path: string): string {
  const base = basenamePosix(path)
  const index = base.lastIndexOf('.')
  if (index <= 0) return ''
  return base.slice(index)
}

export function isMarkdownPath(path: string): boolean {
  const ext = extnamePosix(path).toLowerCase()
  return ext === '.md' || ext === '.markdown'
}

/** 计算 fromDir 到 target 的相对路径，结果以 './' 或 '../' 开头，可直接写进 href */
export function relativePosix(fromDir: string, target: string): string {
  const from = fromDir === '.' || fromDir === '' ? [] : toPosix(fromDir).split('/').filter(Boolean)
  const to = toPosix(target).split('/').filter(Boolean)

  let common = 0
  while (common < from.length && common < to.length && from[common] === to[common]) {
    common += 1
  }

  const up = from.length - common
  const parts = [...Array<string>(up).fill('..'), ...to.slice(common)]
  const rel = parts.join('/') || '.'
  return rel.startsWith('..') ? rel : `./${rel}`
}

const NON_FILE_SCHEMES = ['http://', 'https://', 'mailto:', 'tel:', 'data:']

/**
 * 把指向 .md 的链接改写成目标格式，保留锚点与查询串。
 * 外部链接与纯锚点原样返回，未导出目标的判断交给调用方。
 */
export function rewriteLinkTarget(href: string, toExt: string): string {
  if (href === '' || href.startsWith('#') || NON_FILE_SCHEMES.some((s) => href.startsWith(s))) {
    return href
  }

  const hashIndex = href.indexOf('#')
  const queryIndex = href.indexOf('?')
  const candidates = [hashIndex, queryIndex].filter((i) => i >= 0)
  const cut = candidates.length > 0 ? Math.min(...candidates) : href.length

  const pathPart = href.slice(0, cut)
  const suffix = href.slice(cut)

  if (!isMarkdownPath(pathPart)) return href
  const dotIndex = pathPart.lastIndexOf('.')
  return `${pathPart.slice(0, dotIndex)}${toExt}${suffix}`
}
