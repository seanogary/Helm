import { useRef, useState } from 'react'
import type { Gutter, Pane } from '../../types/layout'
import type { Zone } from '../../hooks/useLayout'
import { computePanes } from '../../utils/computePanes'
import { GAP_PX } from '../../constants'
import Slot from './Slot'

type Props = {
  gutters: Gutter[]
  ids: (string | null)[]
  slideableIds: Set<string>
  onSplit: (pane: Pane, direction: 'horizontal' | 'vertical') => void
  onMove: (sourceId: string, targetPane: Pane, zone: Zone) => void
  onResize: (id: string, delta: number, containerPx: number) => void
}

type DropState = { paneIndex: number; zone: Zone } | null

function getZone(x: number, y: number): Zone {
  if (x >= 0.3 && x <= 0.7 && y >= 0.3 && y <= 0.7) return 'center'
  if (y < 0.3) return 'n'
  if (y > 0.7) return 's'
  if (x < 0.3) return 'w'
  return 'e'
}

export default function LayoutEngine({ gutters, ids, slideableIds, onSplit, onMove, onResize }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dropState, setDropState] = useState<DropState>(null)

  const panes = [...computePanes(gutters)].sort((a, b) => a.top !== b.top ? a.top - b.top : a.left - b.left)

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {panes.map((pane, i) => {
        const id = ids[i]
        const isDragSource = dragSourceId !== null && dragSourceId === id
        const isDropTarget = dropState !== null && dropState.paneIndex === i && dragSourceId !== id

        return (
          <div
            key={id ?? `empty-${i}`}
            draggable={id !== null}
            onDragStart={id !== null ? () => setDragSourceId(id) : undefined}
            onDragEnd={() => { setDragSourceId(null); setDropState(null) }}
            onDragOver={dragSourceId !== null && dragSourceId !== id ? (e) => {
              e.preventDefault()
              const rect = e.currentTarget.getBoundingClientRect()
              const x = (e.clientX - rect.left) / rect.width
              const y = (e.clientY - rect.top) / rect.height
              setDropState({ paneIndex: i, zone: getZone(x, y) })
            } : undefined}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropState(null)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragSourceId !== null && dropState !== null && dropState.paneIndex === i) {
                onMove(dragSourceId, pane, dropState.zone)
              }
              setDragSourceId(null)
              setDropState(null)
            }}
            style={{
              position: 'absolute',
              left:    `${pane.left   * 100}%`,
              top:     `${pane.top    * 100}%`,
              width:   `${(pane.right  - pane.left) * 100}%`,
              height:  `${(pane.bottom - pane.top)  * 100}%`,
              opacity: isDragSource ? 0.4 : 1,
            }}
          >
            <Slot
              id={id}
              onSplitH={() => onSplit(pane, 'horizontal')}
              onSplitV={() => onSplit(pane, 'vertical')}
            />
            {isDropTarget && <DropOverlay zone={dropState.zone} />}
          </div>
        )
      })}

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

// ─── Drop overlay ──────────────────────────────────────────────────────────────

const ZONE_STYLES: Record<Zone, React.CSSProperties> = {
  n:      { top: 0,    left: 0,    right: 0,    height: '30%' },
  s:      { bottom: 0, left: 0,    right: 0,    height: '30%' },
  w:      { top: '30%', left: 0,   width: '30%', bottom: '30%' },
  e:      { top: '30%', right: 0,  width: '30%', bottom: '30%' },
  center: { top: '30%', left: '30%', right: '30%', bottom: '30%' },
}

const ZONES: Zone[] = ['n', 's', 'e', 'w', 'center']

function DropOverlay({ zone: activeZone }: { zone: Zone }) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      {ZONES.map(zone => (
        <div
          key={zone}
          style={{
            position: 'absolute',
            ...ZONE_STYLES[zone],
            background: zone === activeZone ? 'rgba(99,130,255,0.45)' : 'rgba(99,130,255,0.12)',
            border: '1px solid rgba(99,130,255,0.5)',
            boxSizing: 'border-box',
          }}
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
    if (!slideable) return
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
