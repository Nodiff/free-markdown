export type Eol = '\n' | '\r\n'

export interface TextFormat {
  eol: Eol
  bom: boolean
}

const BOM = '\uFEFF'

/**
 * 检测文本的行尾风格与 BOM。
 * 保存时必须原样写回，否则 Windows 上的 git 会显示整文件被改动。
 */
export function detectTextFormat(raw: string): TextFormat {
  const bom = raw.startsWith(BOM)
  let eol: Eol = '\n'
  const lf = raw.indexOf('\n')
  if (lf > 0 && raw.charCodeAt(lf - 1) === 13) eol = '\r\n'
  return { eol, bom }
}

export function stripBom(raw: string): string {
  return raw.startsWith(BOM) ? raw.slice(1) : raw
}

/** 按检测到的格式重建文本：统一成 LF 后按目标行尾重写，并恢复 BOM */
export function applyTextFormat(text: string, format: TextFormat): string {
  const normalized = text.replace(/\r\n/g, '\n')
  const converted = format.eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized
  return format.bom ? BOM + converted : converted
}

/** 末尾是否带换行（用于判断是否需要在保存时补齐） */
export function endsWithNewline(text: string): boolean {
  return text.endsWith('\n') || text.endsWith('\r')
}
