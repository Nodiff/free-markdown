interface PaneEmptyProps {
  title: string
  tag: string
}

export default function PaneEmpty({ title, tag }: PaneEmptyProps) {
  return (
    <div className="pane__empty">
      <span className="tag">{tag}</span>
      <p>{title}</p>
    </div>
  )
}
