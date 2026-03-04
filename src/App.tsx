import { useLayout } from './hooks/useLayout'
import LayoutEngine from './components/layout/LayoutEngine'

export default function App() {
  const { gutters, ids, split, movePane, resize, slideableIds } = useLayout()

  return (
    <div className="helm">
      <LayoutEngine gutters={gutters} ids={ids} slideableIds={slideableIds} onSplit={split} onMove={movePane} onResize={resize} />
    </div>
  )
}
