# Helm — Dev Notes

## NOTE TO READERS (AI OR HUMAN): YOU MAY ONLY ADD ENTRIES. YOU MAY NOT REMOVE ENTRIES.

## Purpose

This document exists for continuity. Helm is built in sessions with Claude, and context can be lost between them. This file traces problems found, decisions made, and the reasoning behind them — so any future instance (human or AI) can pick up without re-investigating what was already understood.

For a broader overview of the project vision and architecture, see `GRID.md`.

---

## Current Phase: Grid Correctness

We are not building features. We are making the layout grid correct before anything else is added. The grid is the foundation — widgets, persistence, and extensibility all come after. A broken grid makes everything built on top of it unreliable.

---

## Issue: Slot Spacing Breaks on Repeated Splits

**Status:** Fixed (see below)

### What was observed

After several nested splits, slots began touching each other and becoming misaligned. The gap between slots degraded with depth.

### Root cause

The spacing approach was **emergent, not explicit**. The visual gap between slots came entirely from the `ResizeHandle` being a physical flex child — 8px wide or tall. No explicit "gutter" concept existed in the layout math.

The bug was in `LayoutEngine.tsx`. Pane sizes were computed as raw percentages of the full container:

```tsx
const firstSize = `${split.ratio * 100}%`   // e.g. 50%
const secondSize = `${(1 - split.ratio) * 100}%`  // e.g. 50%
```

These were applied as `flexBasis`. But the `ResizeHandle` also occupied 8px inside that same container. So every split level, the flex children summed to:

```
50% + 8px + 50% = 100% + 8px  →  8px overflow per split
```

Because `split__pane` had `flex-shrink: 0`, nothing yielded. The overflow accumulated with each nested split — slots drifted outward and eventually touched or overlapped.

The resize math had the same flaw: `containerSize` was measured as `container.offsetWidth` (the full container), but that included the 8px the handle already occupied. So ratio adjustments drifted slightly on every drag.

### Fix applied

**`src/components/layout/LayoutEngine.tsx`**

Switched panes from `flexBasis: percentage` to `flex: ratio 0 0` (flex-grow, no shrink, zero basis). The ResizeHandle's fixed 8px is now a non-participating flex item — flexbox naturally subtracts it before distributing space by ratio.

Before:
```tsx
<div className="split__pane" style={{ flexBasis: firstSize }}>
<div className="split__pane" style={{ flexBasis: secondSize }}>
```

After:
```tsx
<div className="split__pane" style={{ flex: `${split.ratio} 0 0` }}>
<div className="split__pane" style={{ flex: `${1 - split.ratio} 0 0` }}>
```

The resize delta math was also corrected. The available space for ratio computation is `containerSize - GAP_PX`, not the full container:

Before:
```tsx
const size = isHorizontal ? container.offsetWidth : container.offsetHeight
onResize(path, delta, size)
```

After:
```tsx
const size = (isHorizontal ? container.offsetWidth : container.offsetHeight) - GAP_PX
onResize(path, delta, size)
```

A named constant `GAP_PX = 8` was added at the top of the file and documented inline so the relationship between handle size and resize math is explicit rather than implicit.

### Why this works

With `flex: ratio 0 0`:
- Total flex-grow across both panes = `ratio + (1 - ratio) = 1`
- Available space = `container - 8px` (after handle)
- Pane 1 receives `ratio × (container - 8px)`
- Pane 2 receives `(1 - ratio) × (container - 8px)`
- No overflow at any nesting depth

The gap is now an **explicit, fixed, non-participatory** member of the flex layout. The ratio applies only to what remains.

---

---

## Issue: Aligned Handles From Separate Tree Branches Resize Independently

**Status:** Fixed (see below)

### What was observed

In layouts that visually resemble a grid (e.g., 2×2), handles from sibling branches appeared to form one continuous dividing line. Dragging one handle only moved its own branch's boundary — the other half of the line stayed put, breaking the visual alignment. To keep things aligned, the user had to manually find and drag each handle separately.

### Root cause

Each `ResizeHandle` belongs to exactly one `SplitNode`. In the binary tree, handles from different branches have no awareness of each other. If two branches each have a horizontal split at the same ratio, their handles are visually aligned but structurally independent — there's nothing to drag them together.

This is inherent to the binary tree model. The tree doesn't have a concept of "the same boundary." Each handle controls only its local split.

### Fix applied

**Handle registry + alignment grouping.**

A `HandleRegistryProvider` (context) holds a stable `Map<handleId, HandleEntry>` that every mounted `ResizeHandle` registers into on mount and removes from on unmount. Each entry stores:
- `direction` — so we only compare same-axis handles
- `getRect()` — reads the handle's current `DOMRect` from its ref (live, not stale)
- `onResize(delta)` — calls through a ref so the callback is always current

On `mousedown`, the grabbed handle calls `findGroup()`:
1. Reads its own bounding rect
2. Computes its center along the perpendicular axis (center X for horizontal splits, center Y for vertical splits)
3. Scans all registry entries with the same direction
4. Includes any whose center is within `ALIGN_THRESHOLD = GAP_PX = 8px`

All handles in the group receive the same `delta` on every `mousemove`.

**New files:**
- `src/constants.ts` — `GAP_PX = 8`, shared between `LayoutEngine` (sizing math) and `ResizeHandle` (alignment threshold)
- `src/contexts/HandleRegistry.tsx` — `HandleRegistryProvider` + `useHandleRegistry`

**Modified files:**
- `src/components/layout/ResizeHandle.tsx` — registers in registry, groups on drag
- `src/components/layout/LayoutEngine.tsx` — passes `handleId` (tree path as string) to each handle, imports `GAP_PX` from constants
- `src/App.tsx` — wraps with `HandleRegistryProvider`

### Why DOM measurement instead of tree analysis

The alternative was to compute aligned handles from tree structure alone (comparing ratios). This has a subtle problem: two handles at the same ratio are only at the same pixel position if their containing panes are the same size. That's not always true in deeply nested or asymmetric trees. DOM bounding rects are always correct regardless of nesting depth.

### Design constraint: alignment is not enforced, only grouped at drag time

The registry does not prevent handles from drifting out of alignment after dragging. If the user drags a grouped set, all ratios update identically — they stay aligned. If the user previously drifted them apart (by dragging only one), they will no longer be grouped (their centers no longer match within the threshold), and each acts independently again. This is correct behavior.

---

## Correction: Grouping Reverted — Handles Are Fully Independent

**Status:** Reverted

### What happened

The grouping implementation above was wrong. The goal was always fully independent handles — each handle controls only its own SplitNode, nothing else. Grouping was the opposite of what was wanted: it removed the ability to create disjointed grids (e.g., resizing just the top two slots in a 2×2 without affecting the bottom two).

Any resize that preserves contiguity — meaning no gaps are created and no slots are broken — is valid. Resizing one handle independently always preserves contiguity, even if it produces a visually asymmetric layout.

### What was removed

- `src/contexts/HandleRegistry.tsx` — deleted entirely
- `handleId` prop removed from `ResizeHandle`
- `HandleRegistryProvider` wrapper removed from `App.tsx`

`src/constants.ts` was kept — `GAP_PX` is still used in `LayoutEngine` for sizing math.

### Current state

Each `ResizeHandle` is self-contained. It receives a single `onResize` callback, fires it on drag, done. No cross-handle communication.

### What comes next (not now)

Snapping: when a handle is dragged near another handle's position (within a threshold), it snaps to align with it. This will be implemented by tracking adjacent gutter positions and comparing against the dragged handle's current pixel position. The registry concept from the reverted implementation may be revisited for this purpose.

---

---

## Finding: Split Order Encodes Unnecessary Information — Freedom Is History-Dependent

### The observation

Two visually identical layouts can have different tree shapes depending on the order in which splits were made. Different tree shapes give different resize freedoms. The user has no way to know which freedoms they have without understanding the internal tree structure — and no way to change them without tearing down and rebuilding the layout.

**Concrete 2×2 example:**

Build a 2×2 grid by splitting horizontally first (left | right), then splitting each column vertically:
```
root H
├── left V:  A (top-left) / B (bottom-left)
└── right V: C (top-right) / D (bottom-right)
```
→ You can freely vary A's height vs B's height, and C's height vs D's height independently.
→ You CANNOT vary the column widths independently per row — the root handle always moves both columns together.

Build the same 2×2 by splitting vertically first (top | bottom), then splitting each row horizontally:
```
root V
├── top H:    A (top-left) / C (top-right)
└── bottom H: B (bottom-left) / D (bottom-right)
```
→ You can freely vary A's width vs C's width, and B's width vs D's width independently.
→ You CANNOT vary the row heights independently per column.

Same four slots. Same visual result at equal ratios. Completely different resize freedoms. The tree encodes historical split order as a structural constraint — information that has no bearing on the current visual state.

### Is there a tree that avoids this tradeoff?

**No — the tradeoff is geometric, not a limitation of the binary tree model.**

For four axis-aligned rectangles to tile a larger rectangle with no gaps:
- If the top and bottom rows have *different* vertical split positions, their heights must be equal (otherwise a gap appears where the corners don't meet)
- If the left and right columns have *different* horizontal split positions, their widths must be equal (same reason)

These two conditions are mutually exclusive. You cannot simultaneously have misaligned vertical splits AND misaligned horizontal splits in a valid rectangular tiling. The geometry forbids it.

This means the configuration space of all valid 2×2 rectangular tilings is exactly:
- **H-root space** (3 DOF): column width fixed, row heights within each column free independently
- **V-root space** (3 DOF): row height fixed, column widths within each row free independently

These two spaces overlap only at the "perfect aligned grid" (where all splits are equal). Neither covers the other. Together they cover everything. **The binary tree is the correct and complete model** — it's just that a single tree can only access one region of the space at a time.

### The actual problem

The tree permanently encodes which dimension is "fixed" based on whichever split the user happened to make first. This is unnecessary information — at the moment of the first split, the user had no way to know which freedom they'd want later. The tree is storing a historical accident as a structural constraint.

### Possible rectifications

1. **Tree restructuring**: Given the current visual layout, allow the tree to be restructured (e.g. swap H-root ↔ V-root) without changing the visual result. At the "perfect grid" point, this is lossless. At slightly asymmetric states, the transform would need to approximate or normalize to the nearest representable state in the new tree shape. This is the cleanest fix — it preserves the binary tree model and gives the user a way to access whichever region of the configuration space they need.

2. **Snapping as the practical bridge**: Since the two configuration spaces overlap at the aligned-grid point, snapping handles to alignment gives a natural "reset point" from which the user can restructure the tree without visual disruption.

3. **N-ary tree / explicit row-column model**: Replace the binary tree with a model that natively represents rows and columns (e.g., a "row node" containing N column children, or vice versa). This allows N columns per row each with independent widths, and N rows per column each with independent heights — but within the constraints that geometry permits. More expressive for grid-like layouts, but more complex to implement and reason about.

4. **Accept and document**: Treat the binary tree's region-of-configuration-space as the intended design. Teach users that split order determines freedom, and let snapping handle the common "re-align everything" case. Simpler, but users will eventually hit walls.

**Current direction**: implement snapping first (so re-alignment is easy), then evaluate whether tree restructuring is needed based on real usage friction.

---

---

## Design Direction: Binary Tree → CrossNode Normalization

### The plan in brief

Keep the current binary tree as the **input model** — it's natural, already built, and matches how users think ("split this, then split that"). Add a **CrossNode** as a second node type. After a user aligns two handles via snapping, the matching binary subtree is normalized into a CrossNode, erasing the ownership artifact and giving symmetric freedom in both axes.

### The three node types

```
LayoutNode = LeafNode | SplitNode | CrossNode
```

---

### SplitNode (current, binary)

Divides space along one axis. Encodes direction. Carries the ownership problem.

```
SplitNode (direction: H, ratio: x)
├── first  (left pane)
└── second (right pane)
```

Visual — H-split at ratio x, then each side split again:

```
┌─────────────┬──────────────┐
│             │              │
│      A      │      C       │  ← y1 (left V-split, independent)
│             │              │
├─────────────┼──────────────┤  (y1 can ≠ y2)
│             │              │
│      B      │      D       │  ← y2 (right V-split, independent)
│             │              │
└─────────────┴──────────────┘
      x              1-x
```

Tree shape:
```
SplitNode H (ratio: x)
├── SplitNode V (ratio: y1)
│   ├── A
│   └── B
└── SplitNode V (ratio: y2)
    ├── C
    └── D
```

**Freedom**: y1 and y2 are independent (drag left row handle without affecting right).
**Constraint**: x is shared — both columns move together. Direction is owned by the root.

Flip the root to V and the ownership flips: x1 and x2 become independent, y becomes shared.

---

### CrossNode (new, normalized)

Divides space along **both** axes simultaneously. Two independent ratios. Four children. No direction field — neither axis owns the other.

```
CrossNode (hRatio: y, vRatio: x)
├── topLeft
├── topRight
├── bottomLeft
└── bottomRight
```

Visual:

```
┌─────────────┬──────────────┐
│             │              │
│      A      │      C       │
│             │              │
├─────────────┼─────────────┤  ← hRatio (drag freely, doesn't affect vRatio)
│             │              │
│      B      │      D       │
│             │              │
└─────────────┴──────────────┘
      vRatio       1-vRatio
         ↑
  drag freely, doesn't affect hRatio
```

Tree shape:
```
CrossNode (hRatio: y, vRatio: x)
├── A (topLeft)
├── C (topRight)
├── B (bottomLeft)
└── D (bottomRight)
```

**Freedom**: x and y are both independently draggable. Neither owns the other. Split order is erased.
**Constraint**: the vertical divider is at the same x for both rows; the horizontal divider is at the same y for both columns. (This is geometrically necessary — see prior note on rectangular tilings.)

---

### The normalization transform

A binary subtree is normalizable into a CrossNode when the two child splits are aligned:

```
SplitNode H (ratio: x)          →      CrossNode (vRatio: x, hRatio: y)
├── SplitNode V (ratio: y)             ├── A (topLeft)
│   ├── A                              ├── C (topRight)
│   └── B                              ├── B (bottomLeft)
└── SplitNode V (ratio: y)   ← y must equal y above
    ├── C                              └── D (bottomRight)
    └── D
```

**Condition**: both child ratios must be equal. If y1 ≠ y2, the subtree cannot be normalized without changing the layout.

**Snapping is the gateway**: when a handle is dragged near another handle's position and snaps to it, y1 = y2 becomes true, and normalization becomes lossless. Normalization can be triggered automatically on snap.

**Denormalization**: when the user drags a CrossNode child handle away from alignment, it decomposes back into two independent SplitNodes. The CrossNode dissolves and the binary tree returns. The representation follows the intent.

---

### Constraining the number of splits

Allowing unlimited splits produces unusably small panels and an unmanageable tree. The limit should be **size-based, not depth-based**, for two reasons:

1. A depth limit is arbitrary — why 4 and not 5? — and prevents valid layouts on large screens.
2. A size limit is principled — it maps directly to "is this panel still usable?"

**The key question: relative to what?**

- **Relative to parent**: compounds badly. A panel at 10% of its parent that is itself at 10% of its parent is 1% of the root. The floor degrades with depth.
- **Relative to root (viewport)**: stable. "No panel shall occupy less than X% of the total available space." This is consistent regardless of nesting depth and maps to real screen real estate.

The minimum ratio relative to root is computed by multiplying all ancestor ratios along the path from root to the panel. If that product falls below a threshold (e.g. 10%), splitting is blocked.

Note: the existing ratio clamp [0.1, 0.9] only prevents a panel from being less than 10% of its **direct parent** — it does not prevent compound nesting from pushing a panel well below 10% of the root. A root-relative floor is a separate, additional constraint.

**Open question**: what is the right threshold? Likely tied to the minimum size at which a widget is still meaningful — probably somewhere between 5% and 15% of the viewport. This should be a named constant and possibly user-configurable.

---

## Explicit Design Decisions

- **No gap CSS property on `.split`.** The gap is the ResizeHandle itself — a real DOM node that can be grabbed. Using CSS `gap` would separate rendering from interaction.
- **`GAP_PX` lives in `LayoutEngine.tsx`, not CSS.** The JS resize math must match the visual gap. Keeping them co-located in one file prevents them from drifting apart if one is changed without the other.
- **`flex-shrink: 0` on panes is intentional.** Panes must not collapse. The ratio is the source of truth for sizing, not flex's default negotiation.

---

---

## Error: CrossNode Has Fewer DOF Than Binary Tree

**Status:** Reverted

### What happened

CrossNode was implemented as a "normalized" form of a 2×2 split: topRatio and leftRatio each independent. But both rows shared the same leftRatio (and both columns shared the same topRatio) — a single value per axis. This is 2 DOF total.

The binary tree's H-root case gives 3 DOF: the root ratio (x) plus two independent vertical ratios (y1, y2). The CrossNode strictly reduced freedom compared to the original. Everything in the 2×2 grid snapped to a single shared x and single shared y — exactly the lockup the user observed.

**Lesson:** The binary tree with fully independent handles is already the maximum-freedom model for rectangular tilings. The CrossNode was a regression.

---

---

## Architecture Change: Gutter Model

**Status:** Implemented

### The problem with the binary tree

The binary tree encodes split *order* as a structural constraint. Two visually identical 2×2 layouts built in different order have different resize freedoms — a historical accident baked into the tree shape. The user has no way to escape it without rebuilding from scratch.

### The gutter model

Gutters are stored as primary objects; panes are derived. A gutter is:

```ts
type Gutter = {
  id: string
  orientation: 'horizontal' | 'vertical'
  position: number    // 0–1 along the main axis
  crossStart: number  // 0–1, start of this segment on the cross axis
  crossEnd: number    // 0–1, end of this segment on the cross axis
}
```

Panes are computed via a plane-sweep + union-find over the gutter set. This naturally represents all valid rectangular tilings with no tree hierarchy and no split-order encoding.

### Pane computation (`src/utils/computePanes.ts`)

1. Collect unique x-coordinates (vertical gutter positions + 0 + 1) and y-coordinates (horizontal gutter positions + 0 + 1).
2. Build a grid of cells.
3. Union-Find: merge adjacent cells not separated by a gutter. A boundary at coordinate C is blocked if any gutter at C has a cross range overlapping the cell's cross extent.
4. Each connected component's bounding box is a pane.

### Gutter drag clamping (`src/hooks/useLayout.ts`)

When dragging gutter G:
- Find all parallel gutters whose cross range overlaps G's cross range.
- Clamp G's new position between the nearest such gutters on each side (plus MIN_PANE margin).
- Container boundary (0 and 1) is the fallback when no parallel neighbor exists.

### Visual gap

`.slot` uses `position: absolute; inset: calc(var(--gap) / 2)` within its pane container. Two adjacent panes each contribute half-gap inset → full gap between visible slots. No flex sizing math needed.

### Rendering

LayoutEngine renders:
- One absolutely-positioned div per pane (coordinates derived from computePanes).
- One GutterHandle per gutter (centered on the gutter line, z-index above panes).

No recursive tree traversal. No SplitNode/CrossNode rendering.

### Files changed

- `src/types/layout.ts` — replaced entirely with Gutter and Pane types
- `src/utils/computePanes.ts` — new file
- `src/hooks/useLayout.ts` — replaced with gutter state (split, resize)
- `src/components/layout/LayoutEngine.tsx` — replaced with absolute-position renderer
- `src/components/layout/Slot.tsx` — simplified (no LeafNode, no drag-drop for now)
- `src/components/layout/ResizeHandle.tsx` — deleted (superseded by GutterHandle in LayoutEngine)
- `src/App.tsx` — wired to new hook
- `src/index.css` — removed .split/.cross/.resize-handle; added .gutter-handle

### Panel identity

Deferred. Panes are anonymous computed regions. IDs will be imposed on regions later via an ordering scheme.

---

## Status: Paused — Architecture Under Reconsideration

**As of 2026-03-02**

The gutter model is implemented and functional, but the resize behavior still doesn't satisfy the target constraints: **arbitrary paneling with intuitive and natural resizability**. The conclusion is that no locally coherent adjustments to the current model will get there — the constraint is architectural, not implementational.

The user is stepping back to determine the correct approach before continuing. When they return, they will bring a new direction. Do not add features or attempt fixes in the interim.
