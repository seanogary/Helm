// Shared layout constants.
// GAP_PX must stay in sync with the CSS variable --gap in index.css.
// It is used for pane inset sizing (Slot) and gutter handle dimensions (LayoutEngine).
export const GAP_PX = 8

// How close (in pixels) a gutter must get to another parallel gutter before snapping to it.
// Snap only aligns — it does not couple. Gutters remain independently movable after snapping.
export const SNAP_PX = 8
