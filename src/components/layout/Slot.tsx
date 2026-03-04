type Props = {
  id: string | null
  onSplitH: () => void
  onSplitV: () => void
}

export default function Slot({ id, onSplitH, onSplitV }: Props) {
  return (
    <div className="slot">
      <div className="slot__toolbar">
        <button onClick={onSplitH}>Split H</button>
        <button onClick={onSplitV}>Split V</button>
      </div>
      <div className="slot__content">
        {id !== null
          ? <div className="stub-widget"><span className="stub-widget__label">{id.slice(0, 8)}</span></div>
          : null
        }
      </div>
    </div>
  )
}
