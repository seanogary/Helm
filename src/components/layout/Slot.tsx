type Props = {
  onSplitH: () => void
  onSplitV: () => void
}

export default function Slot({ onSplitH, onSplitV }: Props) {
  return (
    <div className="slot">
      <div className="slot__toolbar">
        <button onClick={onSplitH}>Split H</button>
        <button onClick={onSplitV}>Split V</button>
      </div>
      <div className="slot__content">
        <div className="stub-widget">
          <span className="stub-widget__label">empty</span>
        </div>
      </div>
    </div>
  )
}
