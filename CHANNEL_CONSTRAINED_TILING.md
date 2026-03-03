# Channel-Constrained Tiling

A layout model for rectangular panel systems where resize freedom is governed by
geometric topology rather than split history.

---

## The Problem This Solves

Most tiling panel systems are built on a **binary tree**. Each split adds a node;
each node owns a ratio; handles are leaves of the tree. The tree encodes not just
the current layout, but the *order in which it was built* — a historical accident
baked in as a structural constraint.

Two visually identical 2×2 grids built in different order give different degrees of
freedom. In one, the columns are locked together; in the other, the rows are. The
user has no way to know which freedom they have, and no way to change it without
rebuilding from scratch.

A second approach — storing gutters as flat, independent objects — solves the
history problem but introduces a subtlety: if a single full-span gutter provides
rails for multiple shorter gutters, those shorter gutters can always slide, and
locking never occurs. The "channel" concept becomes impossible.

This document describes the correct model.

---

## Core Concepts

### Gutters as primary objects

Gutters — the dividing lines between panels — are stored directly. Panels are
never stored; they are *derived* by computing the connected regions of space not
separated by any gutter. (See: plane-sweep + union-find over the gutter set.)

A gutter is a line segment:

```
orientation  'horizontal' | 'vertical'
position     0–1 along the main axis (y for H, x for V)
crossStart   0–1, start of segment along the cross axis
crossEnd     0–1, end of segment along the cross axis
```

### The cross — four segments, not two

When two lines divide a rectangle into four panels, they form a cross. The cross
has **four arms**, each an independent gutter segment:

```
         N
         │
  W ─────┼───── E
         │
         S
```

N and S are vertical segments. W and E are horizontal segments. The four meet at a
shared intersection point but are stored as four separate objects with no explicit
reference to each other.

This is the key structural insight. There is no "the horizontal gutter" or "the
vertical gutter" — there are four segments that happen to be geometrically
adjacent.

### Channels and rails

A gutter segment can only move if it has **open channels** at both endpoints.

A channel is open at endpoint `e` when:
- `e` is a container boundary (0 or 1), **or**
- there are perpendicular gutter segments at position `e` covering both sides of
  the moving gutter's position — i.e., they form a continuous "rail" through which
  the segment can slide without breaking any panel boundary.

Concretely: N (vertical, at x=0.5) can slide left/right only if, at its bottom
endpoint, both W and E exist at the same y — forming a horizontal channel. If W
and E are at different y values, the channel is broken and N is locked.

```
  W and E aligned → channel open → N can slide:
  ┌────────┬────────┐
  │        │        │
  │        N        │
  │        │        │
  ├────W───┼───E────┤   ← W and E at same y
  │        │        │
  │        S        │
  │        │        │
  └────────┴────────┘

  W drifted → channel closed → N is locked:
  ┌────────┬────────┐
  │        │        │
  ├─────W──│        │   ← W moved up
  │        N        │
  │        │───E────┤   ← E still lower
  │        │        │
  │        S        │
  │        │        │
  └────────┴────────┘
```

The behavior is symmetric: W can slide up/down only when N and S are at the same
x. Restoring alignment re-opens the channel.

---

## Why Full-Span Gutters Break Locking

The failure mode is subtle. When you split a panel horizontally and then split
each half vertically at the same x position, naively you get:

```
H:    horizontal, y=0.5, x = 0 → 1   (full span)
V_top:    vertical, x=0.5, y = 0 → 0.5
V_bottom: vertical, x=0.5, y = 0.5 → 1
```

Three gutters. H is full-span — `crossStart=0, crossEnd=1`. Because both of H's
endpoints are container boundaries, H's rail check *always passes*. And because H
spans the full width, it always provides a valid rail for V_top and V_bottom at
y=0.5 — regardless of whether they're at the same x or not.

Result: V_top and V_bottom can always slide independently. Nothing ever locks. The
channel concept is vacuously satisfied.

The same problem appears in the reverse build order: V full-span, H_left and
H_right are always free.

---

## The Fix: Normalization at Split Time

When a new gutter G is added:

1. **Find every existing perpendicular gutter P that G terminates against or
   crosses.**
   - "Terminates against": G.crossStart or G.crossEnd lies at P.position, and
     G.position is interior to P's cross range.
   - "Crosses through": G.position is interior to P's cross range AND P.position
     is interior to G's cross range.

2. **Split each such P into two segments** at G.position (one from P.crossStart to
   G.position, one from G.position to P.crossEnd).

3. **Split G itself** at each P.position that lies strictly interior to G's cross
   range.

Applied to the naive H + V_top + V_bottom case: when V_top is added (x=0.5,
y=0→0.5, terminating at H at y=0.5), H is split at x=0.5 into H_left (x=0→0.5)
and H_right (x=0.5→1). Now:

```
H_left:   horizontal, y=0.5, x = 0 → 0.5
H_right:  horizontal, y=0.5, x = 0.5 → 1
V_top:    vertical,   x=0.5, y = 0 → 0.5
V_bottom: vertical,   x=0.5, y = 0.5 → 1
```

Four segments. The true cross. H_left's interior endpoint (x=0.5) now requires
V_top and V_bottom to be aligned at x=0.5 for its rail check to pass. The same
for H_right. Move H_left off-alignment, and V_top and V_bottom lose their rails
and lock. The geometry works.

---

## The Rail Check

```
canSlideGutter(gutter, all_gutters):
  for each endpoint e in [gutter.crossStart, gutter.crossEnd]:
    if e is a boundary (≈0 or ≈1): continue   // always valid

    perps = gutters with perpendicular orientation at position ≈ e

    coversBefore = any p in perps where:
      p.crossStart < gutter.position  AND
      p.crossEnd   ≥ gutter.position  (reaches this side)

    coversAfter = any p in perps where:
      p.crossStart ≤ gutter.position  AND
      p.crossEnd   > gutter.position  (reaches the other side)

    if not (coversBefore AND coversAfter): return false

  return true
```

A gutter that fails this check returns without moving when dragged. Its handle
shows `cursor: not-allowed`.

---

## Degrees of Freedom

In a 2×2 grid (4 segments), starting from full alignment:

- All four segments are free (each endpoint is on a valid rail). **4 DOF.**

After one segment drifts off-alignment (e.g. W moves up):
- W can still move up/down freely (its rails at x=0 and x=0.5 are unaffected).
- E can still move up/down freely.
- N is locked (W is no longer at the same y as E, so N's bottom rail is broken).
- S is locked (same reason).
- **2 DOF** (W and E independently).

After realigning W back to E's y:
- All four segments unlock. **4 DOF** again.

This is the maximum freedom available in a rectangular tiling. Any further
splitting creates new segments with their own rail constraints, propagating
naturally through the same mechanism.

---

## Resize and T-Junction Maintenance

When a gutter moves, any perpendicular gutter whose `crossStart` or `crossEnd`
was anchored to the old position must be updated to the new position. This
preserves T-junctions without coupling positions: the moved gutter "drags" the
endpoints of segments that were touching it, keeping the tiling valid.

Example: when W (y=0.5) moves up to y=0.4, V_top's `crossEnd` (which was 0.5 =
W.position) updates to 0.4, and V_bottom's `crossStart` updates to 0.4. The
junction between V_top and V_bottom follows W.

---

## Summary

| Concern | Solution |
|---|---|
| Split-order encoding freedom | Flat gutter list (no tree) |
| Full-span gutters bypass locking | Normalize at split time — split every crossed perpendicular gutter |
| Movement constraints | Rail check at both endpoints before allowing drag |
| T-junction integrity | Drag perpendicular endpoints anchored to old position |
| Visual feedback | `not-allowed` cursor on locked handles |

The model supports arbitrary rectangular tilings, gracefully handles asymmetric
layouts, and encodes no historical information. The only information stored is
geometry.

---

## Implementation

All code lives in two files: `src/hooks/useLayout.ts` (state and mutation logic)
and `src/utils/computePanes.ts` (pane derivation). The React layer in
`LayoutEngine.tsx` is a thin renderer with no layout logic of its own.

### Data types

```ts
type Gutter = {
  id: string
  orientation: 'horizontal' | 'vertical'
  position: number    // 0–1 on the main axis
  crossStart: number  // 0–1, segment start on the cross axis
  crossEnd: number    // 0–1, segment end on the cross axis
}

type Pane = {
  left: number
  top: number
  right: number
  bottom: number
}
```

`Pane` is never stored — it is recomputed on every render from the gutter list.
The application state is just `Gutter[]`.

---

### Deriving panes: plane-sweep + union-find

Given an arbitrary set of gutters, `computePanes` finds all rectangular regions
not separated by any gutter. The algorithm:

1. Collect all unique x-coordinates: `{0, 1} ∪ {position of every vertical gutter}`.
   Collect all unique y-coordinates: `{0, 1} ∪ {position of every horizontal gutter}`.

2. These coordinates divide the container into a grid of **cells** — the smallest
   possible rectangles that no single gutter crosses.

3. **Union-Find** over all cells: two adjacent cells are merged if no gutter
   separates them at their shared boundary.
   - Cells sharing a vertical boundary at x are blocked if any vertical gutter
     sits at that x and its cross range overlaps the cells' y span.
   - Cells sharing a horizontal boundary at y are blocked likewise.

4. Each connected component is a pane. Its bounds are the bounding box of its
   member cells.

```ts
// Horizontal adjacency: blocked by vertical gutter at xs[col+1] overlapping this row's y span
const blocked = vGutters.some(
  g => g.position === x && g.crossStart < y1 && g.crossEnd > y0
)
if (!blocked) union(idx(col, row), idx(col + 1, row))
```

Union-Find uses path compression. At the scale of a panel layout (tens of cells at
most) rank is unnecessary.

The result is correct for any valid rectangular tiling, including asymmetric
T-junction layouts with arbitrarily many gutters.

---

### Normalization: `normalizeGutters(newGutter, existing)`

Called inside `split()` immediately after constructing the new gutter object,
before the state update is committed.

The function walks every existing perpendicular gutter `p` and applies two rules:

**Rule 1 — split `p` at `newGutter.position`:**

```ts
const newPosInteriorToP =
  p.crossStart + EPS < newGutter.position && newGutter.position < p.crossEnd - EPS

const pPosWithinNew =
  newGutter.crossStart - EPS <= p.position && p.position <= newGutter.crossEnd + EPS

if (newPosInteriorToP && pPosWithinNew) {
  // Replace p with two half-segments
  updated = updated.filter(g => g.id !== p.id)
  updated.push({ ...p, id: crypto.randomUUID(), crossEnd: newGutter.position })
  updated.push({ ...p, id: crypto.randomUUID(), crossStart: newGutter.position })
}
```

This is the critical case. When V_top (x=0.5, y=0→0.5) is added to a layout
containing H (y=0.5, x=0→1):
- `newPosInteriorToP`: is 0.5 strictly inside H's cross range (0→1)? Yes.
- `pPosWithinNew`: is H's position (y=0.5) within V_top's cross range (0→0.5)?
  Yes — the `<=` allows the endpoint case (V_top terminates *at* H).

H is split into H_left (x=0→0.5) and H_right (x=0.5→1).

**Rule 2 — split `newGutter` at `p.position`:**

```ts
const pPosInteriorToNew =
  newGutter.crossStart + EPS < p.position && p.position < newGutter.crossEnd - EPS

const newPosWithinP =
  p.crossStart - EPS <= newGutter.position && newGutter.position <= p.crossEnd + EPS

if (pPosInteriorToNew && newPosWithinP) {
  splitNewAt.push(p.position)
}
```

This handles the case where the new gutter spans *through* an existing one (e.g.
adding a full-height vertical gutter to a layout that already has a horizontal
gutter crossing its path). The new gutter is cut into multiple segments at each
such crossing.

After collecting all cut points, the new gutter is emitted as an ordered list of
segments:

```ts
const cuts = [...new Set(splitNewAt)].sort((a, b) => a - b)
let start = newGutter.crossStart
for (const cut of cuts) {
  newSegments.push({ ...newGutter, id: crypto.randomUUID(), crossStart: start, crossEnd: cut })
  start = cut
}
newSegments.push({ ...newGutter, id: ..., crossStart: start, crossEnd: newGutter.crossEnd })
```

**Why `<=` on the endpoint check but `<` on the interior check**

`pPosWithinNew` uses `<=` to catch the case where a new gutter terminates exactly
at an existing perpendicular gutter's position. Without this, V_top (crossEnd=0.5)
terminating at H (position=0.5) would fail the check (0.5 ≤ 0.5 would be false
with strict `<`), and H would never be split. The asymmetry between the two rules
is intentional.

---

### Rail check: `canSlideGutter(gutter, gutters)`

```ts
function canSlideGutter(gutter: Gutter, gutters: Gutter[]): boolean {
  const perpOrientation = gutter.orientation === 'horizontal' ? 'vertical' : 'horizontal'

  for (const endpoint of [gutter.crossStart, gutter.crossEnd]) {
    if (endpoint <= EPS || endpoint >= 1 - EPS) continue  // boundary → valid

    const perpsAtEndpoint = gutters.filter(g =>
      g.orientation === perpOrientation && Math.abs(g.position - endpoint) < EPS
    )

    const coversBefore = perpsAtEndpoint.some(g =>
      g.crossStart < gutter.position && g.crossEnd >= gutter.position - EPS
    )
    const coversAfter = perpsAtEndpoint.some(g =>
      g.crossStart <= gutter.position + EPS && g.crossEnd > gutter.position
    )

    if (!coversBefore || !coversAfter) return false
  }
  return true
}
```

"CoversBefore" and "coversAfter" allow a single perpendicular segment to satisfy
both conditions simultaneously — this correctly handles the case where one segment
spans across the moving gutter's position on both sides (e.g. V_bottom spanning
y=0.4→1 covers both sides of H_right.position=0.5).

This is called twice per gutter per render: once in `slideableIds` (for cursor
styling) and once at the top of `resize()` (as a guard before applying any delta).

---

### T-junction maintenance in `resize()`

When gutter G moves from `oldPos` to `newPos`, every perpendicular gutter whose
`crossStart` or `crossEnd` equals `oldPos` — and whose own position falls within
G's cross range — is updated to `newPos`.

```ts
const next = prev.map(g => {
  if (g.id === id) return { ...g, position: newPos }
  if (g.orientation !== gutter.orientation) {
    if (g.position < gutter.crossStart || g.position > gutter.crossEnd) return g
    const cs = g.crossStart === oldPos ? newPos : g.crossStart
    const ce = g.crossEnd   === oldPos ? newPos : g.crossEnd
    if (cs !== g.crossStart || ce !== g.crossEnd) {
      if (cs >= ce) return null   // segment collapsed — remove
      return { ...g, crossStart: cs, crossEnd: ce }
    }
  }
  return g
})
```

The `g.position < crossStart || g.position > crossEnd` guard is the "reaches"
check: it ensures only gutters that are geometrically connected to G (their
position is within G's span) have their endpoints updated. Without it, two
parallel gutters at the same position would both try to drag endpoints that belong
to only one of them.

The `cs >= ce` collapse check removes any segment whose endpoints cross — this
can happen at layout extremes and is the correct behavior (the panel has been
resized to zero width).
