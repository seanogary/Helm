type Props = {
  id: string
  componentId: string | null
}

export default function StubWidget({ id, componentId }: Props) {
  return (
    <div className="stub-widget">
      <span className="stub-widget__label">
        {componentId ?? id.slice(0, 6)}
      </span>
    </div>
  )
}
