// A gutter is a dividing line segment stored as a primary object.
// Panes are NOT stored — they are derived from the gutter arrangement.
//
// orientation: which axis the gutter divides
//   'horizontal' → a horizontal line (divides space top/bottom), position = y, cross = x
//   'vertical'   → a vertical line   (divides space left/right),  position = x, cross = y
//
// position:   0–1 along the gutter's main axis
// crossStart: 0–1, where this gutter segment begins along the cross axis
// crossEnd:   0–1, where it ends

export type GutterOrientation = 'horizontal' | 'vertical'

export type Gutter = {
  id: string
  orientation: GutterOrientation
  position: number
  crossStart: number
  crossEnd: number
}

// A computed pane — the rectangular region enclosed by gutters + container boundary.
// Derived on every render from the gutter list; never stored.
export type Pane = {
  left: number
  top: number
  right: number
  bottom: number
}
