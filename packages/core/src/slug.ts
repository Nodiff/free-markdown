const ASCII_PUNCTUATION = '!"#$%&\'()*+,./:;<=>?@[\\]^`{|}~-'

/**
 * 标题转锚点：保留中文，去掉标点与行内标记，空白转连字符，ASCII 统一小写。
 * 与 GitHub 的行为对齐，保证导出的 HTML 里锚点可预测。
 */
export function slugifyHeading(raw: string): string {
  const plain = raw.normalize('NFKC').replace(/[`*_~]/g, '')

  let buffer = ''
  for (const char of plain) {
    buffer += ASCII_PUNCTUATION.includes(char) ? ' ' : char
  }

  const slug = buffer
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return slug === '' ? 'section' : slug
}

/** 同名锚点追加序号：a → a-1 → a-2 */
export function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let index = 1
  while (used.has(`${base}-${index}`)) {
    index += 1
  }
  const candidate = `${base}-${index}`
  used.add(candidate)
  return candidate
}
