import { useState, useCallback } from 'react'
import type { Gutter, Pane } from '../types/layout'
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

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useLayout() {
  const [gutters, setGutters] = useState<Gutter[]>([])

  // Add a gutter bisecting `pane` along `direction`, then normalize all crossings.
  const split = useCallback((pane: Pane, direction: 'horizontal' | 'vertical') => {
    setGutters(prev => {
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

      return normalizeGutters(newGutter, prev)
    })
  }, [])

  // Move gutter `id` by `delta` pixels. Blocked if the rail check fails.
  const resize = useCallback((id: string, delta: number, containerPx: number) => {
    if (containerPx === 0) return
    setGutters(prev => {
      const gutter = prev.find(g => g.id === id)
      if (!gutter) return prev
      if (!canSlideGutter(gutter, prev)) return prev

      const raw = gutter.position + delta / containerPx

      let lo = 0
      let hi = 1
      for (const g of prev) {
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
      for (const g of prev) {
        if (g.id === id || g.orientation !== gutter.orientation) continue
        const d = Math.abs(g.position - clamped)
        if (d < snapDist) { snapDist = d; snapTarget = g.position }
      }
      const snapped = snapDist <= snapThreshold ? snapTarget : clamped

      const oldPos = gutter.position
      const newPos = Math.min(hi - MIN_PANE, Math.max(lo + MIN_PANE, snapped))

      const next = prev.map(g => {
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
      return next.filter((g): g is Gutter => g !== null)
    })
  }, [])

  const slideableIds = new Set(
    gutters.filter(g => canSlideGutter(g, gutters)).map(g => g.id)
  )

  return { gutters, split, resize, slideableIds }
}
