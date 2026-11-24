interface IconProps {
  size?: number
}

const BOX = 20

/**
 * 统一改用 20 视图 + 1.4 描边 + 圆头线帽，贴近参考图那套细线图标；
 * 树里的小图标仍按 13–14 传 size，工具条用 18–19。
 */
function svgProps(size: number): Record<string, unknown> {
  return { width: size, height: size, viewBox: `0 0 ${BOX} ${BOX}`, 'aria-hidden': true, className: 'icon' }
}

function stroke(width = 1.4): Record<string, unknown> {
  return { fill: 'none', stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' }
}

export function CaretIcon({ size = 12 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M7.6 6.2l4 3.8-4 3.8" {...stroke(1.5)} />
    </svg>
  )
}

export function ChevronIcon({ size = 12 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M6.4 7l4 3-4 3" {...stroke(1.5)} />
    </svg>
  )
}

export function ChevronLeftIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M11.6 5.4L7.4 10l4.2 4.6" {...stroke()} />
    </svg>
  )
}

export function ChevronRightIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M8.4 5.4L12.6 10l-4.2 4.6" {...stroke()} />
    </svg>
  )
}

export function FolderIcon({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3 6.2c0-.7.6-1.3 1.3-1.3h3.2l1.4 1.6h6.5c.7 0 1.3.6 1.3 1.3v6c0 .7-.6 1.3-1.3 1.3H4.3c-.7 0-1.3-.6-1.3-1.3V6.2z" {...stroke(1.2)} />
    </svg>
  )
}

export function MarkdownIcon({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4.6 3.4h7.4L15 6.5v10H4.6V3.4z" {...stroke(1.2)} />
      <path d="M11.6 3.6v3h3.2" {...stroke(1.2)} />
      <path d="M8.2 10.4v3.2M8.2 13.6l-1.4-1.4M8.2 13.6l1.4-1.4" {...stroke(1.1)} />
    </svg>
  )
}

export function FileIcon({ size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M5 3.4h7.2L14.6 6.7v10H5V3.4z" {...stroke(1.2)} />
      <path d="M12 3.6v3.2h3" {...stroke(1.2)} />
    </svg>
  )
}

/** 侧栏开关：矩形 + 左侧实心列（参考图里那个方块图标） */
export function PanelIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3.2" y="4.2" width="13.6" height="11.6" {...stroke()} />
      <path d="M7.8 4.6v11.2" {...stroke()} />
      <rect x="3.8" y="4.8" width="3.4" height="10.4" fill="currentColor" opacity="0.22" />
    </svg>
  )
}

/** 新建 / 编辑：方框里一支笔（参考图第二个图标） */
export function ComposeIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M13.4 4.6H4.8c-.6 0-1.1.5-1.1 1.1v9.5c0 .6.5 1.1 1.1 1.1h9.5c.6 0 1.1-.5 1.1-1.1v-8.6" {...stroke()} />
      <path d="M12.4 3.6l3.2 3.2-6 6-3.6.4.4-3.6 6-6z" {...stroke()} />
    </svg>
  )
}

export function SearchIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="9" cy="9" r="4.6" {...stroke()} />
      <path d="M12.6 12.6l3.6 3.6" {...stroke()} />
    </svg>
  )
}

export function SettingsIcon({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="10" cy="10" r="2.6" {...stroke(1.2)} />
      <path
        d="M10 3.4v1.6M10 15v1.6M3.4 10h1.6M15 10h1.6M5.3 5.3l1.1 1.1M13.6 13.6l1.1 1.1M14.7 5.3l-1.1 1.1M6.4 13.6l-1.1 1.1"
        {...stroke(1.2)}
      />
    </svg>
  )
}

export function PencilIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 16l.6-3.4 8.8-8.8 2.8 2.8-8.8 8.8L4 16z" {...stroke()} />
      <path d="M11.9 4.3l2.8 2.8" {...stroke()} />
    </svg>
  )
}

export function SplitIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <rect x="3.2" y="4.2" width="13.6" height="11.6" {...stroke()} />
      <path d="M10 4.6v11.2" {...stroke()} />
      <rect x="10.4" y="4.8" width="6.2" height="10.4" fill="currentColor" opacity="0.16" />
    </svg>
  )
}

export function EyeIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M2.6 10c1.9-3 4.4-4.6 7.4-4.6s5.5 1.6 7.4 4.6c-1.9 3-4.4 4.6-7.4 4.6s-5.5-1.6-7.4-4.6z" {...stroke()} />
      <circle cx="10" cy="10" r="1.9" {...stroke()} />
    </svg>
  )
}

export function CategoryIcon({ size = 16 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3.4 5.6h4.4l1.4 1.8h8v7.2c0 .7-.6 1.3-1.3 1.3H4.7c-.7 0-1.3-.6-1.3-1.3V5.6z" {...stroke(1.2)} />
      <path d="M7 11.6h6" {...stroke(1.2)} />
    </svg>
  )
}

/** 最近使用：时钟 */
export function ClockIcon({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <circle cx="10" cy="10" r="6.6" {...stroke(1.2)} />
      <path d="M10 6.6V10l2.4 1.6" {...stroke(1.2)} />
    </svg>
  )
}

/** 未分类：一个空的收件盘 */
export function InboxIcon({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3.6 6.4l2-2.6h8.8l2 2.6v7c0 .7-.6 1.3-1.3 1.3H4.9c-.7 0-1.3-.6-1.3-1.3V6.4z" {...stroke(1.2)} />
      <path d="M3.6 10.2h3.6l.9 1.7h3.8l.9-1.7h3.6" {...stroke(1.2)} />
    </svg>
  )
}

/** 回收站：带盖的桶 */
export function TrashIcon({ size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M4.6 6.2h10.8M8 6.2V4.6h4v1.6" {...stroke(1.2)} />
      <path d="M5.8 6.2l.8 9.2c.06.6.6 1 1.2 1h4.4c.6 0 1.1-.4 1.2-1l.8-9.2" {...stroke(1.2)} />
      <path d="M8.8 8.8v4.6M11.2 8.8v4.6" {...stroke(1.1)} />
    </svg>
  )
}

/** 保存快照：一台方方正正的相机 */
export function CameraIcon({ size = 18 }: IconProps) {
  return (
    <svg {...svgProps(size)}>
      <path d="M3.4 7.4c0-.7.6-1.2 1.2-1.2h1.7l1-1.6h5.4l1 1.6h1.7c.7 0 1.2.5 1.2 1.2v7c0 .7-.5 1.2-1.2 1.2H4.6c-.6 0-1.2-.5-1.2-1.2v-7z" {...stroke(1.2)} />
      <circle cx="10" cy="11" r="2.9" {...stroke(1.2)} />
    </svg>
  )
}
