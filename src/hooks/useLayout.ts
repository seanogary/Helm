import { useState, useCallback } from 'react'
import type { Gutter, Pane } from '../types/layout'
import { computePanes } from '../utils/computePanes'
import { SNAP_PX } from '../constants'

const MIN_PANE = 0.05
const EPS = 1e-6

// ─── Normalization ─────────────────────────────────────────────────────────────
//
// When a new gutter G is added, any existing perpendicular gutter P that G
// "meets" at an interior point must be split there — and vice versa.
//
// Without this, a full-span H gutter (crossStart=0, crossEnd=1) always provides
// rails for every vertical gutter regardless of alignment, making locking
// impossible. After normalization every crossing becomes an explicit 4-way split
// and the rail checks work correctly.
//
// Split P at G.position when:
//   G.position is strictly interior to P  (P.crossStart < G.position < P.crossEnd)
//   AND P.position is within G's cross range (G.crossStart <= P.position <= G.crossEnd)
//
// Split G at P.position when:
//   P.position is strictly interior to G  (G.crossStart < P.position < G.crossEnd)
//   AND G.position is within P's cross range (P.crossStart <= G.position <= P.crossEnd)

function normalizeGutters(newGutter: Gutter, existing: Gutter[]): Gutter[] {
  const perps = existing.filter(g => g.orientation !== newGutter.orientation)

  let updated: Gutter[] = [...existing]
  const splitNewAt: number[] = []

  for (const p of perps) {
    const newPosInteriorToP =
      p.crossStart + EPS < newGutter.position && newGutter.position < p.crossEnd - EPS
    const pPosWithinNew =
      newGutter.crossStart - EPS <= p.position && p.position <= newGutter.crossEnd + EPS

    const pPosInteriorToNew =
      newGutter.crossStart + EPS < p.position && p.position < newGutter.crossEnd - EPS
    const newPosWithinP =
      p.crossStart - EPS <= newGutter.position && newGutter.position <= p.crossEnd + EPS

    if (newPosInteriorToP && pPosWithinNew) {
      // Split existing gutter p at newGutter.position
      updated = updated.filter(g => g.id !== p.id)
      updated.push({ ...p, id: crypto.randomUUID(), crossEnd: newGutter.position })
      updated.push({ ...p, id: crypto.randomUUID(), crossStart: newGutter.position })
    }

    if (pPosInteriorToNew && newPosWithinP) {
      splitNewAt.push(p.position)
    }
  }

  // Split newGutter at each collected position
  const cuts = [...new Set(splitNewAt)].sort((a, b) => a - b)
  const newSegments: Gutter[] = []
  let start = newGutter.crossStart
  for (const cut of cuts) {
    newSegments.push({ ...newGutter, id: crypto.randomUUID(), crossStart: start, crossEnd: cut })
    start = cut
  }
  newSegments.push({
    ...newGutter,
    id: cuts.length === 0 ? newGutter.id : crypto.randomUUID(),
    crossStart: start,
    crossEnd: newGutter.crossEnd,
  })

  return [...updated, ...newSegments]
}

// ─── Rail check ────────────────────────────────────────────────────────────────
//
// A gutter can move along its primary axis only if both cross-axis endpoints
// are on valid rails:
//   - Container boundary (0 or 1) is always a valid rail.
//   - An interior endpoint at `e` is valid if there are perpendicular gutters
//     at exactly `e` covering both sides of this gutter's position.
//
// Because normalizeGutters ensures full-span gutters are always split at
// crossings, this check now correctly detects misaligned channels.

function canSlideGutter(gutter: Gutter, gutters: Gutter[]): boolean {
  const perpOrientation = gutter.orientation === 'horizontal' ? 'vertical' : 'horizontal'

  for (const endpoint of [gutter.crossStart, gutter.crossEnd]) {
    if (endpoint <= EPS || endpoint >= 1 - EPS) continue  // boundary → always valid

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

// ─── Canonical pane ordering ───────────────────────────────────────────────────
//
// Panes are sorted top-to-bottom, then left-to-right. This order is a
// topological invariant — resizing gutters changes pane sizes but never
// changes which pane is above or left of another. So sorted index is a
// stable identity key across resizes.

function canonicalSort(panes: Pane[]): Pane[] {
  return [...panes].sort((a, b) => a.top !== b.top ? a.top - b.top : a.left - b.left)
}

// ─── Pure split ────────────────────────────────────────────────────────────────
//
// Computes the next State after bisecting `pane` along `direction`.
// The new slot is always inserted as null (no identity); the caller assigns IDs.
//
// `inherit` controls which half keeps the original pane's identity:
//   'first'  → original ID stays at index i (top/left half), null at i+1
//   'second' → null at index i (top/left half), original ID stays at i+1

function applySplit(
  pane: Pane,
  direction: 'horizontal' | 'vertical',
  inherit: 'first' | 'second',
  state: State,
): State {
  const newGutter: Gutter = direction === 'horizontal'
    ? {
        id: crypto.randomUUID(),
        orientation: 'horizontal',
        position:   (pane.top + pane.bottom) / 2,
        crossStart: pane.left,
        crossEnd:   pane.right,
      }
    : {
        id: crypto.randomUUID(),
        orientation: 'vertical',
        position:   (pane.left + pane.right) / 2,
        crossStart: pane.top,
        crossEnd:   pane.bottom,
      }

  const newGutters = normalizeGutters(newGutter, state.gutters)

  const sorted = canonicalSort(computePanes(state.gutters))
  const i = sorted.findIndex(p =>
    Math.abs(p.left   - pane.left)   < EPS &&
    Math.abs(p.top    - pane.top)    < EPS &&
    Math.abs(p.right  - pane.right)  < EPS &&
    Math.abs(p.bottom - pane.bottom) < EPS
  )

  const newIds = [...state.ids]
  if (inherit === 'first') {
    newIds.splice(i + 1, 0, null)
  } else {
    newIds.splice(i, 0, null)
  }

  return { gutters: newGutters, ids: newIds }
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export type Zone = 'center' | 'n' | 's' | 'e' | 'w'

type State = { gutters: Gutter[], ids: (string | null)[] }

export function useLayout() {
  const [{ gutters, ids }, setState] = useState<State>({
    gutters: [],
    ids: [crypto.randomUUID()],
  })

  // Bisect `pane` along `direction`, giving the new half a fresh ID.
  const split = useCallback((pane: Pane, direction: 'horizontal' | 'vertical') => {
    setState(prev => {
      const newGutter: Gutter = direction === 'horizontal'
        ? {
            id: crypto.randomUUID(),
            orientation: 'horizontal',
            position:   (pane.top + pane.bottom) / 2,
            crossStart: pane.left,
            crossEnd:   pane.right,
          }
        : {
            id: crypto.randomUUID(),
            orientation: 'vertical',
            position:   (pane.left + pane.right) / 2,
            crossStart: pane.top,
            crossEnd:   pane.bottom,
          }

      const newGutters = normalizeGutters(newGutter, prev.gutters)
      const sorted = canonicalSort(computePanes(prev.gutters))
      const i = sorted.findIndex(p =>
        Math.abs(p.left   - pane.left)   < EPS &&
        Math.abs(p.top    - pane.top)    < EPS &&
        Math.abs(p.right  - pane.right)  < EPS &&
        Math.abs(p.bottom - pane.bottom) < EPS
      )

      const newIds = [...prev.ids]
      newIds.splice(i + 1, 0, crypto.randomUUID())
      return { gutters: newGutters, ids: newIds }
    })
  }, [])

  // Drag a pane to another pane:
  //   center → swap IDs
  //   n/s/e/w → split target in that direction, place sourceId in the new half, null the source
  const movePane = useCallback((sourceId: string, targetPane: Pane, zone: Zone) => {
    setState(prev => {
      const sourceIndex = prev.ids.indexOf(sourceId)
      if (sourceIndex === -1) return prev

      if (zone === 'center') {
        const sorted = canonicalSort(computePanes(prev.gutters))
        const targetIndex = sorted.findIndex(p =>
          Math.abs(p.left   - targetPane.left)   < EPS &&
          Math.abs(p.top    - targetPane.top)    < EPS &&
          Math.abs(p.right  - targetPane.right)  < EPS &&
          Math.abs(p.bottom - targetPane.bottom) < EPS
        )
        if (targetIndex === -1) return prev

        const newIds = [...prev.ids]
        const targetId = newIds[targetIndex]
        newIds[targetIndex] = sourceId
        newIds[sourceIndex] = targetId
        return { ...prev, ids: newIds }
      }

      const direction: 'horizontal' | 'vertical' =
        (zone === 'n' || zone === 's') ? 'horizontal' : 'vertical'

      // 'first'  → original at targetIndex,     null at targetIndex+1  (S/E: dragged goes to +1)
      // 'second' → null at targetIndex,          original at targetIndex+1  (N/W: dragged goes to i)
      const inherit: 'first' | 'second' = (zone === 's' || zone === 'e') ? 'first' : 'second'

      const sorted = canonicalSort(computePanes(prev.gutters))
      const targetIndex = sorted.findIndex(p =>
        Math.abs(p.left   - targetPane.left)   < EPS &&
        Math.abs(p.top    - targetPane.top)    < EPS &&
        Math.abs(p.right  - targetPane.right)  < EPS &&
        Math.abs(p.bottom - targetPane.bottom) < EPS
      )
      if (targetIndex === -1) return prev

      const after = applySplit(targetPane, direction, inherit, prev)

      // The new null slot lands at targetIndex (N/W) or targetIndex+1 (S/E)
      const insertionPoint = inherit === 'second' ? targetIndex : targetIndex + 1

      // If the insertion happened at or before the source, source shifted by 1
      const adjustedSourceIndex = sourceIndex >= insertionPoint ? sourceIndex + 1 : sourceIndex

      const newIds = [...after.ids]
      newIds[insertionPoint] = sourceId
      newIds[adjustedSourceIndex] = null

      return { ...after, ids: newIds }
    })
  }, [])

  // Move gutter `id` by `delta` pixels. Blocked if the rail check fails.
  const resize = useCallback((id: string, delta: number, containerPx: number) => {
    if (containerPx === 0) return
    setState(prev => {
      const gutter = prev.gutters.find(g => g.id === id)
      if (!gutter) return prev
      if (!canSlideGutter(gutter, prev.gutters)) return prev

      const raw = gutter.position + delta / containerPx

      let lo = 0
      let hi = 1
      for (const g of prev.gutters) {
        if (g.id === id || g.orientation !== gutter.orientation) continue
        if (g.crossStart < gutter.crossEnd && g.crossEnd > gutter.crossStart) {
          if (g.position < gutter.position) lo = Math.max(lo, g.position)
          else hi = Math.min(hi, g.position)
        }
      }

      const clamped = Math.min(hi - MIN_PANE, Math.max(lo + MIN_PANE, raw))

      const snapThreshold = SNAP_PX / containerPx
      let snapDist = Infinity
      let snapTarget = clamped
      for (const g of prev.gutters) {
        if (g.id === id || g.orientation !== gutter.orientation) continue
        const d = Math.abs(g.position - clamped)
        if (d < snapDist) { snapDist = d; snapTarget = g.position }
      }
      const snapped = snapDist <= snapThreshold ? snapTarget : clamped

      const oldPos = gutter.position
      const newPos = Math.min(hi - MIN_PANE, Math.max(lo + MIN_PANE, snapped))

      const next = prev.gutters.map(g => {
        if (g.id === id) return { ...g, position: newPos } as Gutter | null
        if (g.orientation !== gutter.orientation) {
          if (g.position < gutter.crossStart || g.position > gutter.crossEnd) return g
          const cs = g.crossStart === oldPos ? newPos : g.crossStart
          const ce = g.crossEnd   === oldPos ? newPos : g.crossEnd
          if (cs !== g.crossStart || ce !== g.crossEnd) {
            if (cs >= ce) return null
            return { ...g, crossStart: cs, crossEnd: ce }
          }
        }
        return g
      })

      return { ...prev, gutters: next.filter((g): g is Gutter => g !== null) }
    })
  }, [])

  const slideableIds = new Set(
    gutters.filter(g => canSlideGutter(g, gutters)).map(g => g.id)
  )

  return { gutters, ids, split, movePane, resize, slideableIds }
}
