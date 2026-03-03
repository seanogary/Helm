import { useRef } from 'react'
import type { Gutter, Pane } from '../../types/layout'
import { computePanes } from '../../utils/computePanes'
import { GAP_PX } from '../../constants'
import Slot from './Slot'

type Props = {
  gutters: Gutter[]
  slideableIds: Set<string>
  onSplit: (pane: Pane, direction: 'horizontal' | 'vertical') => void
  onResize: (id: string, delta: number, containerPx: number) => void
}

export default function LayoutEngine({ gutters, slideableIds, onSplit, onResize }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const panes = computePanes(gutters)

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {panes.map(pane => (
        <div
          key={`${pane.left},${pane.top},${pane.right},${pane.bottom}`}
          style={{
            position: 'absolute',
            left:   `${pane.left   * 100}%`,
            top:    `${pane.top    * 100}%`,
            width:  `${(pane.right  - pane.left) * 100}%`,
            height: `${(pane.bottom - pane.top)  * 100}%`,
          }}
        >
          <Slot
            onSplitH={() => onSplit(pane, 'horizontal')}
            onSplitV={() => onSplit(pane, 'vertical')}
          />
        </div>
      ))}

      {gutters.map(gutter => (
        <GutterHandle
          key={gutter.id}
          gutter={gutter}
          slideable={slideableIds.has(gutter.id)}
          containerRef={containerRef}
          onResize={onResize}
        />
      ))}
    </div>
  )
}

// ─── Gutter handle ────────────────────────────────────────────────────────────

type GutterHandleProps = {
  gutter: Gutter
  slideable: boolean
  containerRef: React.RefObject<HTMLDivElement>
  onResize: (id: string, delta: number, containerPx: number) => void
}

function GutterHandle({ gutter, slideable, containerRef, onResize }: GutterHandleProps) {
  const isHoriz = gutter.orientation === 'horizontal'

  const onMouseDown = (e: React.MouseEvent) => {
    if (!slideable) return  // channel blocked — ignore drag
    e.preventDefault()
    let last = isHoriz ? e.clientY : e.clientX

    const onMouseMove = (e: MouseEvent) => {
      const current = isHoriz ? e.clientY : e.clientX
      const delta = current - last
      last = current
      const c = containerRef.current
      if (!c) return
      onResize(gutter.id, delta, isHoriz ? c.offsetHeight : c.offsetWidth)
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const activeCursor = isHoriz ? 'row-resize' : 'col-resize'
  const cursor = slideable ? activeCursor : 'not-allowed'

  const style: React.CSSProperties = isHoriz
    ? {
        position: 'absolute',
        left:      `${gutter.crossStart * 100}%`,
        top:       `${gutter.position   * 100}%`,
        width:     `${(gutter.crossEnd - gutter.crossStart) * 100}%`,
        height:    GAP_PX,
        transform: 'translateY(-50%)',
        cursor,
        zIndex:    10,
      }
    : {
        position: 'absolute',
        left:      `${gutter.position   * 100}%`,
        top:       `${gutter.crossStart * 100}%`,
        width:     GAP_PX,
        height:    `${(gutter.crossEnd - gutter.crossStart) * 100}%`,
        transform: 'translateX(-50%)',
        cursor,
        zIndex:    10,
      }

  return <div className="gutter-handle" style={style} onMouseDown={onMouseDown} />
}
