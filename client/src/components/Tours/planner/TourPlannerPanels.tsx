import { useRef, useState } from 'react'
import type { TourListItem } from '@trek/shared'
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronDown, Clock3, Mountain, Plus, Redo2, RotateCcw, Save, ShieldAlert, Trash2, Undo2 } from 'lucide-react'
import type { Day } from '../../../types'
import { useTranslation } from '../../../i18n'
import { useSettingsStore } from '../../../store/settingsStore'
import { formatDate } from '../../../utils/formatters'
import { formatDistance, formatElevation } from '../../../utils/units'
import ConfirmDialog from '../../shared/ConfirmDialog'
import CustomSelect from '../../shared/CustomSelect'
import { DialogButton } from '../../shared/DialogShell'
import EmptyState from '../../shared/EmptyState'
import { useToast } from '../../shared/Toast'
import { BarButton } from '../../Planner/planParts'
import TourListRow from '../TourListRow'
import ElevationProfile from '../../shared/ElevationProfile'
import { hikeSourceBadgeLabel, tourSource } from '../tourPresentation'
import type { RouteProfileFocus } from '../../../utils/routeGeometry'
import type { TourPlannerController, TourPlannerStatus } from './useTourPlanner'
import { useTourPermissions, type TourPermissionProps } from '../useTourPermissions'

const STATUS_KEY: Partial<Record<TourPlannerStatus, string>> = {
  dirty: 'tours.planner.status.dirty',
  routing: 'tours.planner.status.routing',
  'routing-failed': 'tours.planner.status.routingFailed',
  'enriching-elevation': 'tours.planner.status.elevation',
  'elevation-failed': 'tours.planner.status.elevationFailed',
  ready: 'tours.planner.status.ready',
  saving: 'tours.planner.status.saving',
  saved: 'tours.planner.saved',
}

function roleLabel(role: 'start' | 'via' | 'end', t: (key: string) => string) {
  return t(`tours.planner.${role}`)
}

function profileFocusLabel(focus: RouteProfileFocus, t: (key: string, params?: Record<string, string | number | null>) => string, unit: 'metric' | 'imperial'): string {
  return t('tours.planner.inspector.profileFocus', {
    distance: formatDistance(focus.distanceMeters / 1000, unit),
    elevation: focus.elevationMeters == null ? '—' : formatElevation(focus.elevationMeters, unit),
  })
}

export function TourPlannerRail({ planner, canEdit: editPermission, canAssign: assignPermission }: { planner: TourPlannerController } & TourPermissionProps) {
  const { canEdit } = useTourPermissions({ canEdit: editPermission ?? planner.canEdit, canAssign: assignPermission ?? planner.canAssign })
  const { t } = useTranslation()
  const distanceUnit = useSettingsStore(state => state.settings.distance_unit)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [pendingDifficulty, setPendingDifficulty] = useState<1 | 2 | 3 | 4 | 5 | 6 | null>(null)
  const alpineAcknowledged = useRef(false)
  const isSaving = planner.isSaving
  const statusKey = isSaving ? STATUS_KEY.saving : STATUS_KEY[planner.status]
  const canRetry = planner.status === 'routing-failed' || planner.status === 'elevation-failed'
  const requestClose = () => {
    if (isSaving) return
    if (planner.hasUnsavedChanges) setConfirmDiscard(true)
    else planner.returnToNeutral()
  }

  if (planner.mode.type === 'neutral') {
    return (
      <section className="flex h-full min-h-0 flex-col bg-transparent" aria-label={t('tours.planner.title')}>
        <EmptyState
          scene="idle"
          title={t('tours.planner.neutralTitle')}
          size={48}
          compact
          className="min-h-0 flex-1 gap-2 px-4 py-4"
          action={(
            <div className="max-w-full">
              <p className="text-xs leading-5 text-content-secondary">{t('tours.planner.neutralBody')}</p>
              <div className="mt-3 [&>button]:w-full [&>button]:justify-center">
                <DialogButton variant="primary" icon={<Plus size={14} />} disabled={!canEdit} onClick={() => { if (canEdit) planner.startNewTour() }}>
                  {t('tours.planner.newTour')}
                </DialogButton>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-content-tertiary">{t('tours.planner.neutralHint')}</p>
            </div>
          )}
        />
      </section>
    )
  }

  if (planner.mode.type === 'view-gpx') {
    const { tour } = planner.readOnlyGpxTour
    const analysis = planner.readOnlyGpxAnalysis
    return (
      <>
        <section className="flex h-full min-h-0 flex-col bg-transparent" aria-label={tour.name}>
          <div className="flex items-start gap-2 border-b border-edge px-4 py-3">
            <BarButton label={t('tours.planner.backToTours')} onClick={() => planner.returnToNeutral()} className="mt-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <ArrowLeft size={16} />
            </BarButton>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-content">{t('tours.planner.gpxTitle')}</h2>
              <p className="mt-0.5 truncate text-xs text-content">{tour.name}</p>
              <p className="mt-0.5 text-[11px] text-content-secondary">{hikeSourceBadgeLabel(tour, t)}</p>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <p className="text-xs leading-5 text-content-secondary">{t('tours.detail.gpxReadOnly')}</p>
            {analysis ? (
              <section className="mt-5" aria-label={t('tours.planner.inspector.title')}>
                <h3 className="text-xs font-semibold text-content-secondary">{t('tours.planner.inspector.title')}</h3>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4">
                  <TourPlannerMetric label={t('tours.detail.distance')} value={formatDistance(analysis.distanceKm, distanceUnit)} />
                  {tour.duration != null && <TourPlannerMetric label={t('tours.planner.inspector.duration')} value={t('tours.durationMinutes', { count: Math.max(1, Math.round(tour.duration)) })} />}
                  {analysis.minEle != null && <TourPlannerMetric label={t('tours.detail.minAltitude')} value={formatElevation(analysis.minEle, distanceUnit)} />}
                  {analysis.maxEle != null && <TourPlannerMetric label={t('tours.detail.maxAltitude')} value={formatElevation(analysis.maxEle, distanceUnit)} />}
                  {analysis.gain != null && <TourPlannerMetric label={t('tours.detail.ascent')} value={formatElevation(analysis.gain, distanceUnit)} />}
                  {analysis.loss != null && <TourPlannerMetric label={t('tours.detail.descent')} value={formatElevation(analysis.loss, distanceUnit)} />}
                </dl>
                {analysis.distanceIndexedProfileSamples.length >= 2 ? (
                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-content-secondary">{t('tours.planner.inspector.elevation')}</h3>
                      <ElevationProfileToggle
                        id="tour-planner-gpx-elevation-profile"
                        expanded={planner.elevationProfileExpanded}
                        onToggle={planner.toggleElevationProfile}
                        t={t}
                      />
                    </div>
                    <div id="tour-planner-gpx-elevation-profile" hidden={!planner.elevationProfileExpanded}>
                      {planner.elevationProfileExpanded && <ElevationProfile
                        samples={analysis.distanceIndexedProfileSamples}
                        color="var(--text-secondary)"
                        gradientId={`planner-gpx-elevation-${tour.place_id}`}
                        ariaLabel={t('tours.planner.inspector.elevation')}
                        focus={planner.routeProfileFocus}
                        onFocusChange={planner.setRouteProfileFocus}
                        formatFocus={focus => profileFocusLabel(focus, t, distanceUnit)}
                      />}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-content-secondary">{t('tours.planner.inspector.elevationPlaceholder')}</p>
                )}
              </section>
            ) : (
              <p className="mt-5 text-xs text-content-secondary">{t('tours.planner.gpxNoGeometry')}</p>
            )}
          </div>
        </section>
        <NewTourConfirmDialog planner={planner} canEdit={canEdit} />
      </>
    )
  }

  const isSavedEdit = planner.mode.type === 'edit-saved'

  return (
    <>
      <section className="flex h-full min-h-0 flex-col bg-transparent" aria-label={t('tours.planner.title')}>
        <div className="border-b border-edge px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <BarButton label={t('tours.planner.backToTours')} onClick={() => requestClose()} disabled={isSaving} className="shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                <ArrowLeft size={16} />
              </BarButton>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-content">{t(isSavedEdit ? 'tours.planner.editTitle' : 'tours.planner.newTitle')}</h2>
                <p className="mt-0.5 text-xs text-content-secondary">{t('tours.planner.mapHint')}</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <BarButton label={t('tours.planner.undo')} onClick={() => { if (canEdit && !isSaving) planner.undo() }} disabled={!canEdit || isSaving || !planner.canUndo}>
                <Undo2 size={16} />
              </BarButton>
              <BarButton label={t('tours.planner.redo')} onClick={() => { if (canEdit && !isSaving) planner.redo() }} disabled={!canEdit || isSaving || !planner.canRedo}>
                <Redo2 size={16} />
              </BarButton>
            </div>
          </div>
          {planner.draftRestored && planner.hasUnsavedChanges && <p className="mt-2 rounded-md bg-surface-hover px-2 py-1 text-[11px] text-content-secondary" role="status">{t('tours.planner.restored')}</p>}
          <label className="mt-3 block text-xs font-medium text-content-secondary" htmlFor="tour-planner-name">
            {t('tours.planner.name')}
          </label>
          <input
            id="tour-planner-name"
            disabled={!canEdit || isSaving}
            value={planner.name}
            onChange={event => { if (canEdit && !isSaving) planner.setName(event.target.value) }}
            maxLength={255}
            placeholder={t('tours.planner.namePlaceholder')}
            className="mt-1 w-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-content outline-none focus:border-accent"
          />
          <label className="mt-3 block text-xs font-medium text-content-secondary" htmlFor="tour-planner-difficulty">
            {t('tours.planner.maxDifficulty')}
          </label>
          <CustomSelect
            id="tour-planner-difficulty"
            disabled={!canEdit || isSaving}
            ariaLabel={t('tours.planner.maxDifficulty')}
            value={planner.maxHikingDifficulty}
            onChange={nextValue => {
              if (!canEdit || isSaving) return
              const value = Number(nextValue) as 1 | 2 | 3 | 4 | 5 | 6
              if (value >= 4 && !alpineAcknowledged.current) setPendingDifficulty(value)
              else planner.setMaxHikingDifficulty(value)
            }}
            options={[1, 2, 3, 4, 5, 6].map(value => ({ value, label: t(`tours.planner.difficulty.t${value}`) }))}
            size="sm"
            style={{ marginTop: 4 }}
          />
          {planner.maxHikingDifficulty === 3 && <p className="mt-2 rounded-lg border border-warning bg-warning-soft px-3 py-2 text-xs leading-4 text-warning" role="status">{t('tours.planner.difficulty.t3Warning')}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-content-secondary">{t('tours.planner.waypoints')}</h3>
          {planner.waypoints.length === 0 ? (
            <div data-testid="tour-planner-empty-state" className="mt-3 rounded-lg border border-dashed border-edge bg-surface-hover px-3 py-4 text-center">
              <EmptyState scene="idle" title={t('tours.planner.startingPoint')} size={30} layout="row" compact className="gap-2 px-1 py-1" />
              <p className="mt-1 text-[11px] leading-4 text-content-secondary">{t('tours.planner.firstUseDetails')}</p>
            </div>
          ) : (
            <ol className="mt-2 space-y-1.5">
              {planner.waypoints.map((point, index) => {
                const selected = planner.selectedWaypointId === point.id
                return (
                  <li key={point.id}>
                    <button
                      type="button"
                      onClick={() => planner.setSelectedWaypointId(point.id)}
                      className={`flex w-full items-center gap-2 rounded-xl border px-2 py-2 text-left ${selected ? 'border-accent bg-accent-subtle' : 'border-edge bg-transparent hover:bg-surface-hover'}`}
                      aria-current={selected ? 'true' : undefined}
                    >
                      <span
                        aria-label={t('tours.planner.waypointLabel', { n: index + 1 })}
                        data-waypoint-number={index + 1}
                        className="shrink-0 rounded-full bg-surface-tertiary font-geist text-xs font-semibold tabular-nums text-content-secondary"
                        style={{ width: 28, minWidth: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-content">{roleLabel(point.role, t)}</span>
                        <span className="block truncate font-mono text-[10px] text-content-tertiary">{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</span>
                      </span>
                      {canEdit && <span className="flex items-center">
                        <span role="button" tabIndex={isSaving || index === 0 ? -1 : 0} aria-label={t('tours.planner.moveUp')} aria-disabled={isSaving || index === 0} onClick={event => { event.stopPropagation(); if (!isSaving) planner.moveWaypoint(point.id, -1) }} onKeyDown={event => { if (!isSaving && event.key === 'Enter' && index > 0) planner.moveWaypoint(point.id, -1) }} className={`rounded p-1 ${isSaving || index === 0 ? 'pointer-events-none opacity-25' : 'hover:bg-surface-card'}`}><ArrowUp size={13} /></span>
                        <span role="button" tabIndex={isSaving || index === planner.waypoints.length - 1 ? -1 : 0} aria-label={t('tours.planner.moveDown')} aria-disabled={isSaving || index === planner.waypoints.length - 1} onClick={event => { event.stopPropagation(); if (!isSaving) planner.moveWaypoint(point.id, 1) }} onKeyDown={event => { if (!isSaving && event.key === 'Enter' && index < planner.waypoints.length - 1) planner.moveWaypoint(point.id, 1) }} className={`rounded p-1 ${isSaving || index === planner.waypoints.length - 1 ? 'pointer-events-none opacity-25' : 'hover:bg-surface-card'}`}><ArrowDown size={13} /></span>
                        <span role="button" tabIndex={isSaving ? -1 : 0} aria-label={t('tours.planner.remove')} aria-disabled={isSaving} onClick={event => { event.stopPropagation(); if (!isSaving) planner.removeWaypoint(point.id) }} onKeyDown={event => { if (!isSaving && event.key === 'Enter') planner.removeWaypoint(point.id) }} className={`rounded p-1 text-red-500 hover:bg-red-50 ${isSaving ? 'pointer-events-none opacity-25' : ''}`}><Trash2 size={13} /></span>
                      </span>}
                    </button>
                  </li>
                )
              })}
            </ol>
          )}

          {(statusKey || planner.error) && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${planner.error ? 'border border-warning bg-warning-soft text-warning' : 'bg-surface-hover text-content-secondary'}`} role="status">
              {planner.error === 'save' ? t('tours.planner.status.saveFailed') : statusKey ? t(statusKey) : null}
              {canRetry && <button type="button" onClick={planner.retry} className="ml-2 font-semibold underline">{t('tours.planner.retry')}</button>}
            </div>
          )}
        </div>

        <div className="border-t border-edge p-3">
          <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-4 text-content-secondary">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{t('tours.planner.safetyNote')} {t('tours.planner.safetyNoteDetails')}</span>
          </p>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <DialogButton icon={<RotateCcw size={14} />} onClick={requestClose} disabled={isSaving || (!planner.hasUnsavedChanges && !isSavedEdit)}>
              {t(isSavedEdit ? 'tours.planner.discardChanges' : 'tours.planner.discard')}
            </DialogButton>
            <DialogButton variant="primary" icon={<Save size={14} />} onClick={() => { if (canEdit && !isSaving) void planner.save() }} disabled={!canEdit || isSaving || !planner.canSave}>
              {t(isSavedEdit ? 'tours.planner.saveChanges' : 'tours.planner.save')}
            </DialogButton>
          </div>
        </div>

        <ConfirmDialog
          isOpen={confirmDiscard && !isSaving}
          onClose={() => setConfirmDiscard(false)}
          onConfirm={planner.returnToNeutral}
          title={t('tours.planner.discardTitle')}
          message={t('tours.planner.discardBody')}
          confirmLabel={t('tours.planner.discardUnsaved')}
        />
        <NewTourConfirmDialog planner={planner} canEdit={canEdit} />
        <ConfirmDialog
          isOpen={pendingDifficulty !== null && !isSaving}
          onClose={() => setPendingDifficulty(null)}
          onConfirm={() => {
            if (canEdit && !isSaving && pendingDifficulty !== null) {
              alpineAcknowledged.current = true
              planner.setMaxHikingDifficulty(pendingDifficulty)
            }
            setPendingDifficulty(null)
          }}
          title={t('tours.planner.difficulty.alpineTitle')}
          message={t('tours.planner.difficulty.alpineBody')}
          confirmLabel={t('tours.planner.difficulty.enable')}
        />
      </section>
    </>
  )
}

function TourPlannerMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[11px] text-content-secondary">{label}</dt><dd className="mt-1 text-sm font-semibold text-content">{value}</dd></div>
}

function ElevationProfileToggle({ id, expanded, onToggle, t }: { id: string; expanded: boolean; onToggle: () => void; t: (key: string) => string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={id}
      aria-label={t(expanded ? 'tours.planner.collapseElevation' : 'tours.planner.expandElevation')}
      className="rounded p-1 text-content-secondary hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <ChevronDown size={15} className={expanded ? '' : '-rotate-90'} />
    </button>
  )
}

function NewTourConfirmDialog({ planner, canEdit }: { planner: TourPlannerController; canEdit: boolean }) {
  const { t } = useTranslation()
  return (
    <ConfirmDialog
      isOpen={canEdit && planner.newTourConfirmationOpen}
      onClose={planner.cancelNewTour}
      onConfirm={() => { if (canEdit) planner.startNewTour(true) }}
      title={t('tours.planner.newTourConfirmTitle')}
      message={t('tours.planner.newTourConfirmBody')}
      confirmLabel={t('tours.planner.newTourConfirm')}
    />
  )
}

interface TourPlannerToursRailProps extends TourPermissionProps {
  planner: TourPlannerController
  tours: TourListItem[]
  days: Day[]
  loading: boolean
  onAssignToDay: (placeId: number, dayId: number) => void | boolean | Promise<void | boolean>
  onViewGpxTour: (tour: TourListItem) => void
}

function plannerDayLabel(day: Day, index: number, locale: string, t: (key: string, params?: Record<string, unknown>) => string): string {
  const dayNumber = t('dayplan.dayN', { n: index + 1 })
  const date = formatDate(day.date, locale)
  return [dayNumber, date, day.title].filter(Boolean).join(' · ')
}

export function TourPlannerToursRail({ planner, tours, days, loading, onAssignToDay, onViewGpxTour, canEdit: editPermission, canAssign: assignPermission }: TourPlannerToursRailProps) {
  const { canEdit, canAssign } = useTourPermissions({ canEdit: editPermission ?? planner.canEdit, canAssign: assignPermission ?? planner.canAssign })
  const { t, locale } = useTranslation()
  const toast = useToast()
  const distanceUnit = useSettingsStore(state => state.settings.distance_unit)
  const [pendingTour, setPendingTour] = useState<TourListItem | null>(null)
  const [dayPickerOpen, setDayPickerOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const isSaving = planner.isSaving
  const hasRoute = (planner.mode.type === 'new-draft' || planner.mode.type === 'edit-saved') && planner.route !== null
  const routeAnalysis = planner.routeAnalysis

  const openTour = async (tour: TourListItem) => {
    const opened = await planner.openTour(tour)
    if (!opened) toast.error(t('tours.planner.openFailed'))
  }

  const selectTour = (tour: TourListItem) => {
    if (tourSource(tour) === 'gpx') onViewGpxTour(tour)
    else void openTour(tour)
  }

  const requestOpenTour = (tour: TourListItem) => {
    if (isSaving) return
    if (planner.hasUnsavedChanges) {
      setPendingTour(tour)
      return
    }
    selectTour(tour)
  }

  const assignSavedTour = async (dayId: number) => {
    const savedTour = planner.saveOutcome
    if (!canAssign || !savedTour) return
    setAssigning(true)
    try {
      const assigned = await onAssignToDay(savedTour.place_id, dayId)
      if (assigned === false) return
      setDayPickerOpen(false)
    } finally {
      setAssigning(false)
    }
  }

  return (
    <aside className="flex h-full min-h-0 flex-col bg-transparent" aria-label={t('tours.planner.tripTours')}>
      <div className="shrink-0 border-b border-edge px-4 py-3">
        <h2 className="text-sm font-semibold text-content">{t('tours.planner.tripTours')}</h2>
        <p className="mt-0.5 text-xs text-content-secondary">{t('tours.subtitle')}</p>
        {hasRoute && (
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-edge bg-surface p-3">
              <dt className="text-[11px] text-content-secondary">{t('tours.planner.inspector.distance')}</dt>
              <dd className="mt-1 text-sm font-semibold text-content">{routeAnalysis ? formatDistance(routeAnalysis.distanceKm, distanceUnit) : '—'}</dd>
            </div>
            <div className="rounded-xl border border-edge bg-surface p-3">
              <dt className="flex items-center gap-1 text-[11px] text-content-secondary"><Clock3 size={12} />{t('tours.planner.inspector.duration')}</dt>
              <dd className="mt-1 text-sm font-semibold text-content">{t('tours.durationMinutes', { count: Math.max(1, Math.round((planner.durationSeconds ?? 0) / 60)) })}</dd>
            </div>
          </dl>
        )}
        {hasRoute && routeAnalysis && (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              {routeAnalysis.minEle != null && <TourPlannerMetric label={t('tours.detail.minAltitude')} value={formatElevation(routeAnalysis.minEle, distanceUnit)} />}
              {routeAnalysis.maxEle != null && <TourPlannerMetric label={t('tours.detail.maxAltitude')} value={formatElevation(routeAnalysis.maxEle, distanceUnit)} />}
              {routeAnalysis.gain != null && <TourPlannerMetric label={t('tours.detail.ascent')} value={formatElevation(routeAnalysis.gain, distanceUnit)} />}
              {routeAnalysis.loss != null && <TourPlannerMetric label={t('tours.detail.descent')} value={formatElevation(routeAnalysis.loss, distanceUnit)} />}
            </dl>
            {routeAnalysis.distanceIndexedProfileSamples.length >= 2 && (
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-content-secondary">{t('tours.planner.inspector.elevation')}</h3>
                  <ElevationProfileToggle
                    id="tour-planner-editable-elevation-profile"
                    expanded={planner.elevationProfileExpanded}
                    onToggle={planner.toggleElevationProfile}
                    t={t}
                  />
                </div>
                <div id="tour-planner-editable-elevation-profile" hidden={!planner.elevationProfileExpanded}>
                  {planner.elevationProfileExpanded && <ElevationProfile
                    samples={routeAnalysis.distanceIndexedProfileSamples}
                    color="var(--text-secondary)"
                    gradientId={`planner-editable-elevation-${planner.editingPlaceId ?? 'draft'}`}
                    ariaLabel={t('tours.planner.inspector.elevation')}
                    focus={planner.routeProfileFocus}
                    onFocusChange={planner.setRouteProfileFocus}
                    formatFocus={focus => profileFocusLabel(focus, t, distanceUnit)}
                  />}
                </div>
              </div>
            ) || <p className="mt-2 text-xs text-content-secondary">{t('tours.planner.inspector.elevationPlaceholder')}</p>}
          </>
        )}
      </div>

      {planner.saveOutcome && (
        <div className="m-3 mb-0 rounded-xl border border-edge bg-surface p-3" role="status">
          <div className="flex items-center gap-2 text-sm font-semibold text-content">
            <CheckCircle2 className="h-4 w-4 text-success" />
            {t('tours.planner.saved')}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <DialogButton onClick={() => { if (canEdit && !isSaving) planner.startNewTour() }} disabled={!canEdit || isSaving}>
              {t('tours.planner.planAnother')}
            </DialogButton>
            <DialogButton variant="primary" icon={<ChevronDown size={13} />} onClick={() => { if (canAssign) setDayPickerOpen(open => !open) }} aria-expanded={dayPickerOpen} disabled={!canAssign || days.length === 0}>
              {t('tours.planner.assignToDay')}
            </DialogButton>
          </div>
          {canAssign && dayPickerOpen && (
            <label className="mt-2 block text-xs font-medium text-content-secondary" htmlFor="tour-planner-assign-day">
              {t('tours.addToDay.pickDay')}
              <select
                id="tour-planner-assign-day"
                defaultValue=""
                disabled={assigning}
                onChange={event => { if (event.target.value) void assignSavedTour(Number(event.target.value)) }}
                className="mt-1 w-full rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-content"
              >
                <option value="" disabled>{t('tours.addToDay.pickDay')}</option>
                {days.map((day, index) => <option key={day.id} value={day.id}>{plannerDayLabel(day, index, locale, t)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && tours.length === 0 ? (
          <p className="py-6 text-center text-xs text-content-secondary">{t('common.loading')}</p>
        ) : tours.length === 0 ? (
          <div className="rounded-xl border border-edge bg-surface-secondary p-6 text-center">
            <Mountain className="mx-auto mb-2 h-6 w-6 text-content-faint" strokeWidth={1.6} />
            <p className="font-medium text-content">{t('tours.empty.title')}</p>
            <p className="mt-1 text-sm text-content-secondary">{t('tours.empty.body')}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {tours.map(tour => (
              <TourListRow
                key={tour.place_id}
                tour={tour}
                disabled={isSaving}
                selected={(planner.mode.type === 'edit-saved' || planner.mode.type === 'view-gpx') && planner.mode.placeId === tour.place_id}
                onSelect={requestOpenTour}
                action={canAssign && days.length > 0 ? (
                  <select
                    aria-label={`${t('tours.addToDay')}: ${tour.name}`}
                    value=""
                    onChange={event => {
                      const dayId = Number(event.target.value)
                      if (canAssign && dayId) void onAssignToDay(tour.place_id, dayId)
                    }}
                    className="w-full rounded-lg border border-edge bg-surface px-2 py-1.5 text-xs text-content"
                  >
                    <option value="" disabled>{t('tours.addToDay.pickDay')}</option>
                    {days.map((day, index) => <option key={day.id} value={day.id}>{plannerDayLabel(day, index, locale, t)}</option>)}
                  </select>
                ) : undefined}
              />
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingTour !== null}
        onClose={() => setPendingTour(null)}
        onConfirm={() => {
          const tour = pendingTour
          setPendingTour(null)
          if (tour) selectTour(tour)
        }}
        title={t('tours.planner.discardTitle')}
        message={t('tours.planner.discardBody')}
        confirmLabel={t('tours.planner.discardChanges')}
      />
    </aside>
  )
}
