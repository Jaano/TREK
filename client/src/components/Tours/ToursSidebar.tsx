import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FileDown, Mountain } from 'lucide-react'
import type { TourListItem } from '@trek/shared'
import type { Day } from '../../types'
import { toursApi } from '../../api/client'
import { useTripStore } from '../../store/tripStore'
import { useTranslation } from '../../i18n'
import { useToast } from '../shared/Toast'
import TourListRow from './TourListRow'
import { useTourPermissions, type TourPermissionProps } from './useTourPermissions'
import { NEUTRAL_TINT, fs } from '../shared/DialogShell'
import { Tooltip } from '../shared/Tooltip'

const MAX_FILE_BYTES = 10 * 1024 * 1024

interface ToursSidebarProps extends TourPermissionProps {
  tripId: number
  days: Day[]
  tours: TourListItem[]
  loading?: boolean
  selectedPlaceId?: number | null
  onAssignToDay: (placeId: number, dayId: number) => void | boolean | Promise<void | boolean>
  pushUndo?: (label: string, undo: () => void | Promise<void>) => void
  /** Imported place ids are excluded immediately; no ids means refresh derived Tour metadata. */
  onToursChanged?: (placeIds?: number[]) => void | Promise<void>
  /** Tour row was clicked — caller will render the detail modal. */
  onSelectTour?: (tour: TourListItem | null, opener?: HTMLElement) => void
}

function dayLabel(day: Day, index: number, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (day.title) return day.title
  return t('dayplan.dayN', { n: index + 1 })
}

/**
 * Tours mode of the right add-panel: a selection list of existing tours
 * with GPX import and day assignment.
 *
 * Reuses the existing day-assignment mechanism as-is: `onAssignToDay` is the
 * same `handleAssignToDay` PlacesSidebar calls, so a tour lands on a day
 * exactly like a place does, and its route line renders on the day map
 * without any Tours-specific rendering code.
 */
export default function ToursSidebar({ tripId, days, tours, loading = false, selectedPlaceId = null, onAssignToDay, onToursChanged, onSelectTour, canEdit: editPermission, canAssign: assignPermission }: ToursSidebarProps): React.ReactElement {
  const { t } = useTranslation()
  const { canEdit, canAssign } = useTourPermissions({ tripId, canEdit: editPermission, canAssign: assignPermission })
  const toast = useToast()
  const loadTrip = useTripStore(s => s.loadTrip)
  const [filter, setFilter] = useState<'all' | 'unplanned' | 'planned'>('all')
  const [importing, setImporting] = useState(false)
  const [pickerOpenFor, setPickerOpenFor] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const [filterOpen, setFilterOpen] = useState(false)

  const handleImportClick = () => { if (canEdit) fileInputRef.current?.click() }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!canEdit || !file) return
    const ext = file.name.toLowerCase().split('.').pop()
    if (ext !== 'gpx') { toast.error(t('places.importFileUnsupported')); return }
    if (file.size > MAX_FILE_BYTES) { toast.error(t('places.importFileTooLarge', { maxMb: 10 })); return }

    setImporting(true)
    try {
      const result = await toursApi.importGpx(tripId, file)
      if (result.tours.length > 0) {
        // The server publishes place:created with sender echo suppression.
        // Reload the importing client's trip so new places and route geometry
        // enter the shared store used by the day map.
        await onToursChanged?.(result.tours.map(tour => tour.place_id))
        await loadTrip(tripId)
        toast.success(t(result.tours.length === 1 ? 'tours.import.successOne' : 'tours.import.success', { count: result.tours.length }))
        if (result.caution) toast.info(t('tours.import.caution'))
      } else {
        toast.warning(t('places.importAllSkipped'))
      }
    } catch (err: any) {
      const message = err?.response?.data?.error
      toast.error(message === 'No track or route found in GPX file' ? t('tours.import.noTrack') : t('tours.import.error'))
    } finally {
      setImporting(false)
    }
  }

  const handleAssign = async (tour: TourListItem, day: Day, index: number) => {
    if (!canAssign) return
    const assigned = await onAssignToDay(tour.place_id, day.id)
    if (assigned === false) return
    setPickerOpenFor(null)
    toast.success(t('tours.addedToDay', { n: index + 1 }))
  }

  const counts = {
    all: tours.length,
    unplanned: tours.filter(tr => !tr.planned).length,
    planned: tours.filter(tr => tr.planned).length,
  }
  const filtered = tours.filter(tr => {
    if (filter === 'unplanned') return !tr.planned
    if (filter === 'planned') return tr.planned
    return true
  })

  useEffect(() => {
    if (!filterOpen) return
    const onDown = (event: MouseEvent) => {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setFilterOpen(false)
      filterButtonRef.current?.focus()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [filterOpen])

  const filterLabel = filter === 'all' ? t('places.all') : filter === 'unplanned' ? t('places.unplanned') : t('places.planned')
  const filterCount = counts[filter]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--font-system)' }}>
      <div className="flex flex-none flex-col gap-2 border-b border-edge-faint px-3 py-2.5" style={{ background: NEUTRAL_TINT }}>
        {/* GPX import stays — the tour-appropriate import path. List Import
            (place/route-of-driving oriented) is deliberately absent here. */}
        <div>
          <Tooltip label={t('places.importFile')}>
            <button type="button" onClick={handleImportClick} disabled={!canEdit || importing}
              className="flex h-8 w-full min-w-0 items-center justify-center gap-1.5 overflow-hidden rounded-[10px] bg-accent px-3 font-semibold text-accent-text shadow-sm transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
              style={fs(12.5, 'body')}>
              <FileDown size={14} strokeWidth={2.2} className="flex-none" />
              <span className="truncate">{t('places.importFile')}</span>
            </button>
          </Tooltip>
          <input ref={fileInputRef} type="file" accept=".gpx" onChange={handleFileChange} style={{ display: 'none' }} />
        </div>
        <div ref={filterRef} className="relative min-w-0">
          <button ref={filterButtonRef} type="button" onClick={() => setFilterOpen(value => !value)}
            aria-expanded={filterOpen} aria-haspopup="listbox" aria-label={t('places.filterShow')}
            className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded-[10px] bg-surface-card px-2.5 font-semibold text-content-secondary shadow-sm transition-colors hover:text-content"
            style={fs(12, 'body')}>
            <span className="min-w-0 truncate text-left">{filterLabel}</span>
            <span className="font-geist tabular-nums text-content-faint" style={fs(10.5)}>{filterCount}</span>
            <ChevronDown size={13} strokeWidth={2.2} className={`ml-auto flex-none text-content-faint transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
          </button>
          {filterOpen && (
            <div role="group" aria-label={t('places.filterShow')} className="trek-popover-enter absolute left-0 top-full z-50 mt-1.5 flex w-full min-w-[180px] flex-col gap-px rounded-[12px] border border-edge-secondary bg-surface-card p-1.5 shadow-popover">
              {(['all', 'unplanned', 'planned'] as const).map(id => {
                const label = id === 'all' ? t('places.all') : id === 'unplanned' ? t('places.unplanned') : t('places.planned')
                const active = filter === id
                return <button key={id} type="button" onClick={() => { setFilter(id); setFilterOpen(false) }} aria-pressed={active}
                  className={`flex w-full items-center gap-2 rounded-[9px] px-2 py-1.5 text-left transition-colors ${active ? 'bg-surface-tertiary' : 'hover:bg-surface-hover'}`}
                  style={fs(12.5, 'body')}>
                  <span className="min-w-0 flex-1 truncate text-content">{label}</span>
                  <span className="font-geist tabular-nums text-content-faint" style={fs(11)}>{counts[id]}</span>
                  <span className="grid w-3.5 flex-none place-items-center">{active && <Check size={13} strokeWidth={2.4} className="text-content-muted" />}</span>
                </button>
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px 16px' }}>
        {!loading && filtered.length === 0 ? (
          <div className="rounded-xl border border-edge bg-surface-secondary p-6 text-center">
            <Mountain className="mx-auto mb-2 h-6 w-6 text-content-faint" strokeWidth={1.6} />
            <p className="font-medium text-content">{t('tours.empty.title')}</p>
            <p className="mt-1 text-sm text-content-secondary">{t('tours.empty.body')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((tour) => {
              const isSelected = tour.place_id === selectedPlaceId
              return (
              <TourListRow
                key={tour.place_id}
                tour={tour}
                selected={isSelected}
                onSelect={(selectedTour, opener) => onSelectTour?.(selectedTour, opener)}
                action={(
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); if (canAssign) setPickerOpenFor(v => v === tour.place_id ? null : tour.place_id) }}
                    disabled={!canAssign || days.length === 0}
                    className="inline-flex min-h-9 w-full items-center justify-center gap-1 rounded-lg border border-edge px-3 py-1.5 text-sm font-medium text-content disabled:opacity-50"
                  >
                    {t('tours.addToDay')}
                    <ChevronDown className="h-3 w-3" strokeWidth={2} style={{ transform: pickerOpenFor === tour.place_id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>
                )}
              >
                {canAssign && pickerOpenFor === tour.place_id && (
                  <div className="mt-2 border-t border-edge-faint pt-2 flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                    {days.map((day, i) => (
                      <button
                        type="button"
                        key={day.id}
                        onClick={() => { void handleAssign(tour, day, i) }}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-content hover:bg-surface-tertiary"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-tertiary text-[11px] font-semibold">{i + 1}</span>
                        {dayLabel(day, i, t)}
                      </button>
                    ))}
                  </div>
                )}
              </TourListRow>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
