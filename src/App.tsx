import { useLayout } from './hooks/useLayout'
import LayoutEngine from './components/layout/LayoutEngine'

export default function App() {
  const { gutters, split, resize, slideableIds } = useLayout()

  return (
    <div className="helm">
      <LayoutEngine gutters={gutters} slideableIds={slideableIds} onSplit={split} onResize={resize} />
    </div>
  )
}
