import type { PackingItem } from '../../../../types'
import { PACKING_PLACEHOLDER_NAME } from '../../../../components/Packing/packingListPanel.constants'
import { STATUS_COLOR } from './tabModel'

/**
 * Pure view-model helpers for the Listen tab (Packing + To-do), the real-data
 * counterpart to the demo's `PACK`/`TODOS` state (spec 03 §4). No React, no
 * side effects — grouping/filtering/sorting only, mirroring the desktop hooks
 * (`usePackingListPanel.ts`, `useTodoList.ts`) closely enough that switching a
 * filter here and there produces the same buckets.
 */

// ── Packing ──────────────────────────────────────────────────────────────

export type PackingView = 'common' | 'personal'
export type PackingStatusFilter = 'all' | 'open' | 'done'

/** Three-tier sharing split (#858): Common = group pool, Personal = mine + shared-to-me. */
export function packingViewItems(items: PackingItem[], view: PackingView): PackingItem[] {
  return items.filter(i => (view === 'common' ? !i.is_private : !!i.is_private))
}

/** Category display order = first-appearance order within the active view (stable colours). */
export function packingCategoryOrder(viewItems: PackingItem[], defaultCategory: string): string[] {
  const seen: string[] = []
  for (const item of viewItems) {
    const cat = item.category || defaultCategory
    if (!seen.includes(cat)) seen.push(cat)
  }
  return seen
}

export function packingStatusFiltered(items: PackingItem[], status: PackingStatusFilter): PackingItem[] {
  if (status === 'open') return items.filter(i => !i.checked)
  if (status === 'done') return items.filter(i => !!i.checked)
  return items
}

export interface PackingCategoryGroup {
  category: string
  items: PackingItem[]
}

/** Groups the view+status filtered items by category, in first-encounter order. */
export function groupPackingItems(
  viewItems: PackingItem[],
  status: PackingStatusFilter,
  defaultCategory: string,
): PackingCategoryGroup[] {
  const filtered = packingStatusFiltered(viewItems, status)
  const order: string[] = []
  const byCategory = new Map<string, PackingItem[]>()
  for (const item of filtered) {
    const cat = item.category || defaultCategory
    let bucket = byCategory.get(cat)
    if (!bucket) {
      bucket = []
      byCategory.set(cat, bucket)
      order.push(cat)
    }
    bucket.push(item)
  }
  return order.map(category => ({ category, items: byCategory.get(category) as PackingItem[] }))
}

export interface PackingProgress {
  checked: number
  total: number
  pct: number
}

export function packingProgress(items: PackingItem[]): PackingProgress {
  const checked = items.filter(i => i.checked).length
  const total = items.length
  return { checked, total, pct: total > 0 ? Math.round((checked / total) * 100) : 0 }
}

/** "232 g" under 1000g, "1.2 kg" at/above — matches the demo's `gFmt` (spec 03 §4.4). */
export function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(1)} kg` : `${Math.round(grams)} g`
}

/** Weight an item contributes to a bag/total: unit weight times quantity. */
export function packingItemWeight(item: Pick<PackingItem, 'weight_grams' | 'quantity'>): number {
  return (item.weight_grams || 0) * (item.quantity || 1)
}

/**
 * True when deleting `item` would empty its (custom) category — the row
 * should be reset to the `...` placeholder instead of removed so the
 * category keeps its position/colour (mirrors usePackingListPanel's
 * handleDeleteItem, #1289).
 */
export function isLastCustomItemInCategory(item: PackingItem, allItems: PackingItem[]): boolean {
  return (
    !!item.category &&
    item.name !== PACKING_PLACEHOLDER_NAME &&
    !allItems.some(i => i.id !== item.id && i.category === item.category)
  )
}

export function isPackingPlaceholder(item: Pick<PackingItem, 'name'>): boolean {
  return item.name === PACKING_PLACEHOLDER_NAME
}

// ── To-do ────────────────────────────────────────────────────────────────

/** P1/P2/P3 colours (spec 03 §4.7) reuse the shared status-dot tokens so priority and status stay one palette. */
export const PRIORITY_COLOR: Record<number, string> = {
  1: STATUS_COLOR.danger,
  2: STATUS_COLOR.pending,
  3: STATUS_COLOR.info,
}
export const PRIORITY_LABEL: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3' }
export const PRIORITY_LEVELS = [0, 1, 2, 3] as const
