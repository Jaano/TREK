import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clock, File, FileImage, FileText, MapPin, Mountain, Navigation, Pencil, Plus, Minus, Ruler, Trash2, Upload } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import type { TourListItem } from '@trek/shared'
import type { Assignment, AssignmentsMap, Day, Place, TripFile } from '../../types'
import { useTranslation, translateApiError } from '../../i18n'
import { useToast } from '../shared/Toast'
import { useSettingsStore } from '../../store/settingsStore'
import { formatDistance, formatElevation } from '../../utils/units'
import { resolveTrackColor, inheritedTrackColor } from '../Map/trackColors'
import TrackColorPicker from '../shared/TrackColorPicker'
import DetailShell from '../shared/DetailShell'
import ElevationProfile from '../shared/ElevationProfile'
import { NavigationMenu } from '../shared/NavigationMenu'
import { markdownLinkComponents } from '../shared/markdownLink'
import { analyzeRouteGeometry } from '../../utils/routeGeometry'
import { filesForPlace } from '../../utils/placeFiles'
import { openFile } from '../../utils/fileDownload'
import { getNavigationTargets, openNavigationTarget } from '../Planner/placeNavigation'
import { hikeSourceBadgeLabel, tourSource } from './tourPresentation'
import { useTourPermissions, type TourPermissionProps } from './useTourPermissions'

interface TourDetailDialogProps extends TourPermissionProps {
  tour: TourListItem
  place: Place
  days?: Day[]
  selectedDayId?: number | null
  selectedAssignmentId?: number | null
  assignments?: AssignmentsMap
  files?: TripFile[]
  onClose: () => void
  onUpdatePlace?: (placeId: number, data: Partial<Place>) => Promise<void> | void
  onFileUpload?: (formData: FormData) => Promise<unknown>
  onAssignToDay?: (placeId: number, dayId?: number) => void
  onRemoveAssignment?: (dayId: number, assignmentId: number) => void
  onDelete?: () => void
  leftWidth?: number
  rightWidth?: number
  desktopNonModal?: boolean
  readOnly?: boolean
  /** Desktop-only opener; the map detail stays non-modal and returns focus when closed. */
  desktopFocusReturnTarget?: HTMLElement | null
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function assignmentForSelectedDay(
  assignments: AssignmentsMap,
  selectedDayId: number | null,
  selectedAssignmentId: number | null,
  placeId: number,
): Assignment | null {
  if (selectedDayId == null) return null
  const dayAssignments = assignments[String(selectedDayId)] || []
  return (selectedAssignmentId ? dayAssignments.find(assignment => assignment.id === selectedAssignmentId) : null)
    ?? dayAssignments.find(assignment => assignment.place?.id === placeId)
    ?? null
}

export default function TourDetailDialog({
  tour,
  place,
  selectedDayId = null,
  selectedAssignmentId = null,
  assignments = {},
  files = [],
  onClose,
  onUpdatePlace,
  onFileUpload,
  onAssignToDay,
  onRemoveAssignment,
  onDelete,
  leftWidth = 0,
  rightWidth = 0,
  desktopNonModal = false,
  readOnly = false,
  desktopFocusReturnTarget = null,
  canEdit: editPermission,
  canAssign: assignPermission,
}: TourDetailDialogProps) {
  const { canEdit: hasEditPermission, canAssign } = useTourPermissions({ tripId: place.trip_id, canEdit: editPermission, canAssign: assignPermission })
  const canEdit = hasEditPermission && !readOnly
  const { t } = useTranslation()
  const toast = useToast()
  const distanceUnit = useSettingsStore(state => state.settings.distance_unit)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(place.name)
  const [savingName, setSavingName] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const navigationButtonRef = useRef<HTMLButtonElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const focusReturnRef = useRef(desktopFocusReturnTarget)
  focusReturnRef.current = desktopFocusReturnTarget

  useEffect(() => {
    if (!desktopNonModal) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const opener = focusReturnRef.current
      if (opener?.isConnected) opener.focus()
    }
  }, [desktopNonModal])

  const analysis = useMemo(() => analyzeRouteGeometry(place.route_geometry), [place.route_geometry])
  const trackColor = resolveTrackColor(place)
  const inheritedColor = inheritedTrackColor(place)
  const assignment = assignmentForSelectedDay(assignments, selectedDayId, selectedAssignmentId, place.id)
  const placeFiles = filesForPlace(files, place.id, [], assignment ? [assignment.id] : [])
  const navigationTargets = getNavigationTargets(place)
  const source = tourSource(tour)

  const saveName = async () => {
    if (!canEdit) return
    const name = nameDraft.trim()
    if (!name || name === place.name || !onUpdatePlace) { setEditingName(false); return }
    setSavingName(true)
    try {
      await onUpdatePlace(place.id, { name })
      setEditingName(false)
    } catch (error: unknown) {
      toast.error(translateApiError(t, error, 'common.error'))
    } finally {
      setSavingName(false)
    }
  }

  const uploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    if (!canEdit || !onFileUpload || selectedFiles.length === 0) return
    setUploading(true)
    try {
      for (const file of selectedFiles) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('place_id', String(place.id))
        await onFileUpload(formData)
      }
      setFilesExpanded(true)
    } catch (error: unknown) {
      toast.error(translateApiError(t, error, 'files.uploadError'))
    } finally {
      setUploading(false)
    }
  }

  const header = canEdit && editingName ? (
    <div style={{ display: 'flex', gap: 6, flex: 1, minWidth: 0 }}>
      <input
        autoFocus
        value={nameDraft}
        onChange={event => setNameDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') void saveName()
          if (event.key === 'Escape') { setNameDraft(place.name); setEditingName(false) }
        }}
        className="border border-edge bg-surface-secondary text-content"
        style={{ flex: 1, minWidth: 0, borderRadius: 8, padding: '6px 10px', fontSize: 'calc(16px * var(--fs-scale-subtitle, 1))', fontWeight: 600 }}
      />
      <button type="button" onClick={() => void saveName()} disabled={savingName} className="text-accent" style={{ padding: 6 }} aria-label={t('common.save')}>
        <Check size={18} strokeWidth={2} />
      </button>
    </div>
  ) : (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 className="text-content" style={{ minWidth: 0, fontSize: 'calc(18px * var(--fs-scale-title, 1))', fontWeight: 700, margin: 0 }}>{place.name}</h2>
        {canEdit && onUpdatePlace && (
          <button type="button" onClick={() => { setNameDraft(place.name); setEditingName(true) }} className="text-content-faint shrink-0" style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer' }} aria-label={t('common.edit')}>
            <Pencil size={14} strokeWidth={2} />
          </button>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-content-muted">
        <span className="rounded-md border border-edge bg-surface-tertiary px-1.5 py-0.5">{t(`tourTypes.${tour.tour_type}`)}</span>
        {tour.difficulty && <span>{t('tours.detail.difficulty')}: {tour.difficulty}</span>}
        {tour.duration != null && <span className="inline-flex items-center gap-1"><Clock size={11} />{t('tours.durationMinutes', { count: tour.duration })}</span>}
        {tour.caution && <span className="inline-flex items-center gap-1 text-warning"><AlertTriangle size={11} />{t('tours.caution.badge')}</span>}
        <span className="rounded-md border border-edge bg-surface-tertiary px-1.5 py-0.5">{hikeSourceBadgeLabel(tour, t)}</span>
      </div>
    </div>
  )

  const footer = <>
    {canAssign && selectedDayId != null && (assignment ? onRemoveAssignment && (
      <TourActionButton onClick={() => { if (canAssign) onRemoveAssignment(selectedDayId, assignment.id) }} icon={<Minus size={13} />} label={t('inspector.removeFromDay')} />
    ) : (
      onAssignToDay && <TourActionButton onClick={() => { if (canAssign) onAssignToDay(place.id) }} icon={<Plus size={13} />} label={t('inspector.addToDay')} primary />
    ))}
    {navigationTargets.length > 0 && (
      <>
        <TourActionButton
          buttonRef={navigationButtonRef}
          onClick={() => {
            if (navigationTargets.length === 1) openNavigationTarget(navigationTargets[0])
            else setNavigationOpen(open => !open)
          }}
          icon={<Navigation size={13} />}
          label={navigationTargets.length === 1 ? navigationTargets[0].label : t('inspector.navigation')}
        />
        {navigationOpen && <NavigationMenu targets={navigationTargets} anchor={navigationButtonRef.current} onClose={() => setNavigationOpen(false)} />}
      </>
    )}
    <div style={{ flex: 1 }} />
    {canEdit && onDelete && <TourActionButton onClick={() => { if (canEdit) onDelete() }} icon={<Trash2 size={13} />} label={t('common.delete')} danger />}
  </>

  return (
    <DetailShell header={header} footer={footer} onClose={onClose} closeLabel={t('common.close')} leftWidth={leftWidth} rightWidth={rightWidth}
      closeButtonClassName="focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2">
      {source === 'gpx' && (
        <div className="rounded-lg border border-edge bg-surface-hover px-3 py-2 text-xs text-content-secondary">
          {t('tours.detail.gpxReadOnly')}
          {/* TODO(tours-roadmap): add the planned left-rail “Convert to TREK Tour” action here. */}
        </div>
      )}
      <div className="bg-surface-hover" style={{ borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="text-content-secondary" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', fontWeight: 600 }}>{t('inspector.trackStats')}</div>
        {analysis && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <TourMetric label={t('tours.detail.distance')} value={formatDistance(analysis.distanceKm, distanceUnit)} icon={<Ruler size={13} />} />
              {analysis.minEle != null && <TourMetric label={t('tours.detail.minAltitude')} value={formatElevation(analysis.minEle, distanceUnit)} icon={<Mountain size={13} />} />}
              {analysis.maxEle != null && <TourMetric label={t('tours.detail.maxAltitude')} value={formatElevation(analysis.maxEle, distanceUnit)} icon={<Mountain size={13} />} />}
              {analysis.gain != null && <TourMetric label={t('tours.detail.ascent')} value={formatElevation(analysis.gain, distanceUnit)} icon={<ArrowUp size={13} />} />}
              {analysis.loss != null && <TourMetric label={t('tours.detail.descent')} value={formatElevation(analysis.loss, distanceUnit)} icon={<ArrowDown size={13} />} />}
            </div>
            <ElevationProfile samples={analysis.distanceIndexedProfileSamples} color={trackColor} gradientId={`tour-elevation-${place.id}`} />
          </>
        )}
      </div>

      <div className="bg-surface-hover" style={{ borderRadius: 10, padding: '10px 12px' }}>
        <p className="text-content-faint" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', fontWeight: 600, margin: '0 0 6px' }}>{t('tours.detail.trackColor')}</p>
        {canEdit && onUpdatePlace ? <TrackColorPicker value={place.route_color ?? null} inheritedColor={inheritedColor} onChange={color => { if (canEdit) void onUpdatePlace(place.id, { route_color: color }) }} /> : <span aria-label={t('tours.detail.trackColor')} style={{ display: 'block', width: 20, height: 20, borderRadius: 4, background: trackColor }} />}
      </div>

      {(place.description || place.notes || assignment?.notes) && (
        <div className="bg-surface-hover" style={{ borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {place.description && <div className="collab-note-md text-content-muted" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', lineHeight: 1.5 }}><Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownLinkComponents}>{place.description}</Markdown></div>}
          {place.notes && <div className="collab-note-md text-content-muted" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', lineHeight: 1.5 }}><Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownLinkComponents}>{place.notes}</Markdown></div>}
          {assignment?.notes && <div><div className="text-content-faint" style={{ fontSize: 'calc(9px * var(--fs-scale-caption, 1))', fontWeight: 600, textTransform: 'uppercase' }}>{t('places.assignmentNotes')}</div><div className="collab-note-md text-content-muted" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))' }}><Markdown remarkPlugins={[remarkGfm, remarkBreaks]} components={markdownLinkComponents}>{assignment.notes}</Markdown></div></div>}
        </div>
      )}

      {(placeFiles.length > 0 || (canEdit && onFileUpload)) && (
        <div className="bg-surface-hover" style={{ borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 6 }}>
            <button type="button" onClick={() => setFilesExpanded(expanded => !expanded)} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textAlign: 'left' }}>
              <FileText size={13} color="var(--text-faint)" />
              <span className="text-content-secondary" style={{ fontSize: 'calc(12px * var(--fs-scale-body, 1))', fontWeight: 500 }}>{placeFiles.length ? t('inspector.filesCount', { count: placeFiles.length }) : t('inspector.files')}</span>
            </button>
            {canEdit && onFileUpload && <label className="text-content-muted bg-surface-tertiary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 'calc(11px * var(--fs-scale-caption, 1))', padding: '2px 6px', borderRadius: 6 }}><input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={uploadFiles} />{uploading ? '…' : <><Upload size={11} /> {t('common.upload')}</>}</label>}
          </div>
          {filesExpanded && placeFiles.length > 0 && <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>{placeFiles.map(file => <button type="button" key={file.id} onClick={() => void openFile(file.url)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: 'none', border: 'none', width: '100%', textAlign: 'left' }}>{(file.mime_type || '').startsWith('image/') ? <FileImage size={12} /> : <File size={12} />}<span className="text-content-secondary" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.original_name}</span><span className="text-content-faint">{formatFileSize(file.file_size)}</span></button>)}</div>}
        </div>
      )}

      {navigationTargets.length > 0 && <div className="text-content-faint" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'calc(11px * var(--fs-scale-caption, 1))' }}><MapPin size={12} />{t('tours.detail.navigationHint')}</div>}
    </DetailShell>
  )
}

function TourMetric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div><div className="text-content-faint" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'calc(10px * var(--fs-scale-caption, 1))' }}>{icon}{label}</div><div className="text-content" style={{ marginTop: 2, fontSize: 'calc(13px * var(--fs-scale-body, 1))', fontWeight: 600 }}>{value}</div></div>
}

function TourActionButton({ buttonRef, onClick, icon, label, primary = false, danger = false }: { buttonRef?: React.Ref<HTMLButtonElement>; onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean; danger?: boolean }) {
  const className = primary ? 'bg-accent text-accent-text' : danger ? 'text-danger hover:bg-danger-subtle' : 'text-content-secondary hover:bg-surface-hover'
  return <button ref={buttonRef} type="button" onClick={onClick} className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'calc(12px * var(--fs-scale-body, 1))', fontWeight: 500, background: primary ? undefined : 'transparent' }}>{icon}<span className="hidden sm:inline">{label}</span></button>
}
