import type { Gutter, Pane } from '../types/layout'

// Derive the set of rectangular panes from a gutter arrangement.
//
// Algorithm:
//   1. Collect all unique x-coordinates: {0, 1} ∪ {vertical gutter positions}
//   2. Collect all unique y-coordinates: {0, 1} ∪ {horizontal gutter positions}
//   3. Build a grid of cells from those coordinates.
//   4. Union-Find: merge adjacent cells that are NOT separated by a gutter.
//      Two cells sharing a boundary at coordinate C are blocked if any gutter
//      at C has a cross-axis range that overlaps the cell's cross-axis extent.
//   5. Each connected component is a pane; its bounds = bounding box of its cells.

export function computePanes(gutters: Gutter[]): Pane[] {
  // Skip degenerate gutters (crossStart >= crossEnd) — they span nothing.
  const vGutters = gutters.filter(g => g.orientation === 'vertical'   && g.crossStart < g.crossEnd)
  const hGutters = gutters.filter(g => g.orientation === 'horizontal' && g.crossStart < g.crossEnd)

  const xs = sorted(new Set([0, 1, ...vGutters.map(g => g.position)]))
  const ys = sorted(new Set([0, 1, ...hGutters.map(g => g.position)]))

  const cols = xs.length - 1
  const rows = ys.length - 1
  const n = cols * rows

  // Union-Find (path compression, no union-by-rank needed at this scale)
  const parent = Array.from({ length: n }, (_, i) => i)

  function find(i: number): number {
    if (parent[i] !== i) parent[i] = find(parent[i])
    return parent[i]
  }

  function union(a: number, b: number) {
    parent[find(a)] = find(b)
  }

  function idx(col: number, row: number) {
    return row * cols + col
  }

  // Horizontal adjacency: cells [col][row] and [col+1][row] share a vertical boundary at xs[col+1].
  // Blocked if any vertical gutter sits at that x AND its cross range overlaps the cell's y span.
  for (let row = 0; row < rows; row++) {
    const y0 = ys[row]
    const y1 = ys[row + 1]
    for (let col = 0; col < cols - 1; col++) {
      const x = xs[col + 1]
      const blocked = vGutters.some(g => g.position === x && g.crossStart < y1 && g.crossEnd > y0)
      if (!blocked) union(idx(col, row), idx(col + 1, row))
    }
  }

  // Vertical adjacency: cells [col][row] and [col][row+1] share a horizontal boundary at ys[row+1].
  // Blocked if any horizontal gutter sits at that y AND its cross range overlaps the cell's x span.
  for (let col = 0; col < cols; col++) {
    const x0 = xs[col]
    const x1 = xs[col + 1]
    for (let row = 0; row < rows - 1; row++) {
      const y = ys[row + 1]
      const blocked = hGutters.some(g => g.position === y && g.crossStart < x1 && g.crossEnd > x0)
      if (!blocked) union(idx(col, row), idx(col, row + 1))
    }
  }

  // Accumulate bounding boxes per connected component.
  const bounds = new Map<number, Pane>()
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const root = find(idx(col, row))
      const cell: Pane = { left: xs[col], right: xs[col + 1], top: ys[row], bottom: ys[row + 1] }
      const b = bounds.get(root)
      if (!b) {
        bounds.set(root, { ...cell })
      } else {
        b.left   = Math.min(b.left,   cell.left)
        b.right  = Math.max(b.right,  cell.right)
        b.top    = Math.min(b.top,    cell.top)
        b.bottom = Math.max(b.bottom, cell.bottom)
      }
    }
  }

  return Array.from(bounds.values())
}

function sorted(set: Set<number>): number[] {
  return Array.from(set).sort((a, b) => a - b)
}
