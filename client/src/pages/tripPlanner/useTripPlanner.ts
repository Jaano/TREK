import { useRoadtripSettings } from '../../hooks/useRoadtripSettings'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import { useTripStore } from '../../store/tripStore'
import { useCanDo } from '../../store/permissionsStore'
import { useSettingsStore } from '../../store/settingsStore'
import { getCached, fetchPhoto } from '../../services/photoService'
import { useToast } from '../../components/shared/Toast'
import { Map, Ticket, PackageCheck, Wallet, FolderOpen, Users, Train, Mountain, Route } from 'lucide-react'
import { resolvePluginIcon } from '../../components/shared/PluginIcon'
import { useTranslation, translateApiError } from '../../i18n'
import { addonsApi, accommodationsApi, authApi, tripsApi, assignmentsApi, healthApi, mapsApi, placesApi } from '../../api/client'
import { getDayOrder } from '../../utils/dayOrder'
import { TRANSPORT_TYPES, timedSlot } from '../../utils/dayMerge'
import { isOvernightCategory } from '../../components/Roadtrip/stopKinds'
import { parsedItemToDraft, isTransportItem, isUnplaceableItem, type BookingReviewDraft } from '../../components/Planner/parsedItemToDraft'
import type { BookingImportPreviewItem } from '@trek/shared'
import { accommodationRepo } from '../../repo/accommodationRepo'
import { offlineDb, getImportFiles, deleteImportFiles } from '../../db/offlineDb'
import { isEffectivelyOffline } from '../../sync/networkMode'
import { useBackgroundTasksStore } from '../../store/backgroundTasksStore'
import { receiptToPrefill } from '../../components/Budget/CostsPanel.helpers'
import type { ExpensePrefill } from '../../components/Budget/CostsPanel'
import { useAuthStore } from '../../store/authStore'
import { useResizablePanels } from '../../hooks/useResizablePanels'
import { useTripWebSocket } from '../../hooks/useTripWebSocket'
import { useRouteCalculation } from '../../hooks/useRouteCalculation'
import { roadtripInsertion } from '../../components/Roadtrip/dayWindow'
import { useTripRouteOverview } from '../../components/Map/useTripRouteOverview'
import { useDayClear } from './useDayClear'
import { stopArrival } from '../../components/Roadtrip/stopArrival'
import type { CorridorPoi } from '../../components/Roadtrip/useCorridorPois'
import { projectOntoRoute, sliceAtMeters, type LatLng } from '../../components/Roadtrip/corridor'
import {
  reanchorAfterInsert,
  reanchorAfterRemove,
  reanchorByStopOrder,
  isServiceStopType } from '../../components/Roadtrip/roadtripModel'
import type { ServiceStopMode } from '../../components/Roadtrip/manualStop'
import { inspectorStay } from '../../components/Roadtrip/stayReading'
import { normalizePlaceWebsite, type RoadtripStopType } from '@trek/shared'
import { usePlaceSelection } from '../../hooks/usePlaceSelection'
import { useTourPlaceIds } from '../../hooks/useTourPlaceIds'
import { useAddonStore } from '../../store/addonStore'
import { usePlannerHistory } from '../../hooks/usePlannerHistory'
import { useIsTouch } from '../../hooks/useIsTouch'
import { usePluginStore } from '../../store/pluginStore'
import type { Accommodation, Assignment, TripMember, Day, Place, Reservation } from '../../types'
import { OFM_POSITRON, DEFAULT_MAP_LAT, DEFAULT_MAP_LNG, DEFAULT_MAP_ZOOM } from '../../constants/mapDefaults'
import { useTileUrl } from '../../hooks/useTileUrl'
import { placesForDays, resolvePoolAssignmentId } from './tripPlannerModel'
import { isDeepLinkableTripTab, TRIP_TAB_LABEL_KEYS } from '../../constants/tripTabs'
import { isRoutableReservation } from '../../utils/reservationRoutes'
import { showReservationOnMap } from '../../components/Planner/bookings/showOnMap'
import {
  parseStoredConnections, resolveEffectiveConnections, resolveVisibleConnectionIds,
  toggleConnectionId, toggleAllConnections as flipAllConnectionsMode,
  type StoredConnections,
} from '../../utils/connectionsVisibility'
import { usePlaceLanguage } from '../../hooks/usePlaceLanguage'
import { useDayDelete } from './useDayDelete'
import { useDayAdd } from './useDayAdd'
import { usePlannerDialogs } from './usePlannerDialogs'
import { usePlannerMapView } from './usePlannerMapView'
import { useMapPlaces } from './useMapPlaces'
import { useRoadtripFeed } from './useRoadtripFeed'
import { useRoadtripStopEdits } from './useRoadtripStopEdits'
import { useRoadtripAlternatives } from './useRoadtripAlternatives'
import { useRoadtripDriveShaping } from './useRoadtripDriveShaping'
import { useIsPhone } from '../../mobile/useIsPhone'

/**
 * Trip planner page logic, the big one. Owns the trip store wiring, addon
 * gating, accommodations/members loading, the tab + resizable-panel + selection
 * state, every place/assignment/reservation/transport CRUD handler (with undo)
 * and the splash gate. TripPlannerPage stays a wiring container that lays out
 * the day/map/places panes and modals.
 * Behaviour is identical to the previous in-component logic.
 *
 * Self-contained parts live in the use* sub-hooks beside this file. Each one is
 * called where its code used to sit, so React still runs every effect in the
 * order it always did.
 */
export function useTripPlanner() {
  const { id } = useParams<{ id: string }>()
  // The route param is a string; convert once here so every downstream component
  // prop and store call gets a real number. An absent/invalid id becomes NaN,
  // which stays falsy in the `if (tripId)` guards below.
  const tripId = id ? Number(id) : Number.NaN
  const navigate = useNavigate()
  const toast = useToast()
  const { t, language, locale } = useTranslation()
  const placeLang = usePlaceLanguage()
  const { settings } = useSettingsStore()
  const roadtripSettings = useRoadtripSettings(s => s, tripId)
  // trip-page plugins mount as tabs inside this trip planner (tripId-scoped).
  const allPlugins = usePluginStore(s => s.plugins)
  const pluginsLoaded = usePluginStore(s => s.loaded)
  const placesPhotosEnabled = useAuthStore(s => s.placesPhotosEnabled)
  const trip = useTripStore(s => s.trip)
  const days = useTripStore(s => s.days)
  const allPlaces = useTripStore(s => s.places)
  const storedAssignments = useTripStore(s => s.assignments)
  const packingItems = useTripStore(s => s.packingItems)
  const todoItems = useTripStore(s => s.todoItems)
  const categories = useTripStore(s => s.categories)
  const reservations = useTripStore(s => s.reservations)
  const budgetItems = useTripStore(s => s.budgetItems)
  const files = useTripStore(s => s.files)
  const selectedDayId = useTripStore(s => s.selectedDayId)
  const isLoading = useTripStore(s => s.isLoading)
  // Actions — stable references, don't cause re-renders
  const tripActions = useRef(useTripStore.getState()).current
  const can = useCanDo()
  const canUploadFiles = can('file_upload', trip)
  const { pushUndo, undo, forgetDay, forgetPlace, canUndo, lastActionLabel } = usePlannerHistory()

  // A step that could not be taken back says so instead of claiming it was.
  const handleUndo = useCallback(async () => {
    const label = lastActionLabel
    const undone = await undo()
    if (undone === false) toast.error(t('undo.failed', { action: label ?? '' }))
    else if (undone) toast.info(t('undo.done', { action: label ?? '' }))
  }, [undo, lastActionLabel, toast])

  const [enabledAddons, setEnabledAddons] = useState<Record<string, boolean>>({ packing: true, budget: true, documents: true, collab: false, roadtrip: false, tours: false, dawarich: false })
  // The values above are an optimistic guess until the addon feed answers. The
  // tab guard below waits for this before evicting anything, so a tab we were
  // asked to open ('collab' in particular, guessed off) survives the gap.
  const [addonsLoaded, setAddonsLoaded] = useState<boolean>(false)
  // Road trip mode swaps the plan view's left rail (and later its map layer) for the
  // drive-first reading of the same trip. Per trip and per session, like the tab choice:
  // someone planning a road trip stays in it across reloads without it leaking into
  // their next, non-driving trip.
  const [storedRoadtripMode, setRoadtripMode] = useState<boolean>(() => sessionStorage.getItem(`trip-roadtrip-${tripId}`) === '1')
  // Declared here rather than with the other layout state further down, because
  // road-trip mode is decided on it and the assignment and place lists below are
  // decided on that. One subscriber for the whole hook.
  const isMobile = useIsPhone()
  // The phone shell has no road-trip surface at all: no rail, no drive lines, and
  // no switch to turn the mode back off. Narrowing a desktop window past the
  // phone breakpoint used to carry the flag across anyway, which took the trip
  // overview pill away with nothing in its place and listed every booked night
  // twice. The flag is kept, so widening the window again returns to the drive.
  const roadtripMode = storedRoadtripMode && !isMobile
  // Two reasons a stop can be road-trip-only, and they are not the same reason.
  //
  // The switch is the traveller's: it hides the petrol stations and rest areas
  // they added along the drive from a day list they want to read as a plan.
  //
  // A stop a lodging booking put there is hidden whatever the switch says,
  // because the day already shows that booking as its own overnight block and
  // the row would be the same hotel a second time. Road trip mode wants it: the
  // drive has to end somewhere, and that somewhere is where you sleep.
  const assignments = useMemo(() => {
    if (roadtripMode) return storedAssignments
    const hideServiceStops = roadtripSettings.roadtrip_service_stops_in_days === false
    const hidden = (visit: Assignment) => visit.accommodation_id != null
      || (hideServiceStops && isServiceStopType(visit.place?.stop_type))
    // Same object back when nothing is hidden, so a trip without bookings does not
    // rebuild every day list on each render of this hook.
    if (!Object.values(storedAssignments).some(visits => visits.some(hidden))) return storedAssignments
    return Object.fromEntries(
      Object.entries(storedAssignments).map(([dayId, visits]) => [dayId, visits.filter(v => !hidden(v))]),
    )
  }, [roadtripMode, roadtripSettings.roadtrip_service_stops_in_days, storedAssignments])
  const toggleRoadtripMode = useCallback(() => {
    setRoadtripMode(prev => {
      const next = !prev
      sessionStorage.setItem(`trip-roadtrip-${tripId}`, next ? '1' : '0')
      return next
    })
  }, [tripId])
  const [collabFeatures, setCollabFeatures] = useState<{ chat: boolean; notes: boolean; links: boolean; polls: boolean; whatsnext: boolean }>({ chat: true, notes: true, links: true, polls: true, whatsnext: true })
  const [tripAccommodations, setTripAccommodations] = useState<Accommodation[]>([])
  const places = useMemo(
    () => (roadtripMode
      ? allPlaces
      : placesForDays(allPlaces, roadtripSettings.roadtrip_service_stops_in_days === false, { accommodations: tripAccommodations, reservations })),
    [roadtripMode, roadtripSettings.roadtrip_service_stops_in_days, allPlaces, tripAccommodations, reservations],
  )
  const [allowedFileTypes, setAllowedFileTypes] = useState<string | null>(null)
  const [tripMembers, setTripMembers] = useState<TripMember[]>([])

  // Re-fetch the trip roster so consumers (Costs participants, Collab, …) pick up a
  // just-added guest or member without a full page reload.
  const refreshMembers = useCallback(() => {
    if (!tripId || isEffectivelyOffline()) return
    tripsApi.getMembers(tripId).then(d => {
      const all = [d.owner, ...(d.members || [])].filter(Boolean)
      setTripMembers(all)
    }).catch(() => {})
  }, [tripId])

  const loadAccommodations = useCallback(() => {
    if (tripId) {
      accommodationRepo.list(tripId).then(d => setTripAccommodations(d.accommodations || [])).catch(() => {})
      tripActions.loadReservations(tripId)
    }
  }, [tripId])

  useEffect(() => {
    addonsApi.enabled().then(data => {
      const map: Record<string, boolean> = {}
      data.addons.forEach(a => { map[a.id] = true })
        setEnabledAddons({ packing: !!map.packing, budget: !!map.budget, documents: !!map.documents, collab: !!map.collab, roadtrip: !!map.roadtrip, tours: !!map.tours, dawarich: !!map.dawarich })
      if (data.collabFeatures) setCollabFeatures(data.collabFeatures)
    }).catch(() => {}).finally(() => setAddonsLoaded(true))
    authApi.getAppConfig().then(config => {
      if (config.allowed_file_types) setAllowedFileTypes(config.allowed_file_types)
    }).catch(() => {})
  }, [])


  const tripPagePlugins = allPlugins.filter(p => p.type === 'trip-page')
  const tripPluginIds = tripPagePlugins.map(p => p.id).join(',')

  // A trip-page plugin may replace core tabs while it's active (its manifest names
  // them; 'plan' is never replaceable) and may pick where its own tab sits.
  const replacedTabs = new Set(tripPagePlugins.flatMap(p => p.tripPage?.replaces ?? []))
  const TRIP_TABS = [
    { id: 'plan', label: t(TRIP_TAB_LABEL_KEYS.plan), icon: Map },
    ...(enabledAddons.tours && !isMobile ? [{ id: 'tour-planner', label: t(TRIP_TAB_LABEL_KEYS['tour-planner']), icon: Mountain, desktopOnly: true }] : []),
    { id: 'transports', label: t(TRIP_TAB_LABEL_KEYS.transports), icon: Train },
    { id: 'buchungen', label: t(TRIP_TAB_LABEL_KEYS.buchungen), shortLabel: t('trip.tabs.reservationsShort'), icon: Ticket },
    // Phone only: the desktop reaches the drive through the mode switch beside the
    // day plan, and a second entry point there would be a tab nobody needs.
    ...(enabledAddons.roadtrip && isMobile ? [{ id: 'roadtrip', label: t(TRIP_TAB_LABEL_KEYS.roadtrip), icon: Route }] : []),
    ...(enabledAddons.packing ? [{ id: 'listen', label: t(TRIP_TAB_LABEL_KEYS.listen), shortLabel: t('trip.tabs.listsShort'), icon: PackageCheck }] : []),
    ...(enabledAddons.budget ? [{ id: 'finanzplan', label: t(TRIP_TAB_LABEL_KEYS.finanzplan), icon: Wallet }] : []),
    ...(enabledAddons.documents ? [{ id: 'dateien', label: t(TRIP_TAB_LABEL_KEYS.dateien), icon: FolderOpen }] : []),
    ...(enabledAddons.collab ? [{ id: 'collab', label: t(TRIP_TAB_LABEL_KEYS.collab), icon: Users }] : []),
  ].filter(tab => tab.id === 'plan' || !replacedTabs.has(tab.id))
  // Positioned plugin tabs splice in ascending order so two positions stay stable;
  // the rest append, exactly as before this capability existed.
  const positioned = tripPagePlugins.filter(p => p.tripPage?.position != null).sort((a, b) => (a.tripPage!.position! - b.tripPage!.position!))
  for (const p of positioned) TRIP_TABS.splice(Math.min(p.tripPage!.position!, TRIP_TABS.length), 0, { id: `plugin:${p.id}`, label: p.name, icon: resolvePluginIcon(p.icon) })
  for (const p of tripPagePlugins.filter(p => p.tripPage?.position == null)) TRIP_TABS.push({ id: `plugin:${p.id}`, label: p.name, icon: resolvePluginIcon(p.icon) })

  const [searchParams, setSearchParams] = useSearchParams()

  // ?tab=<id> opens the trip straight on that tab (the startup destination
  // setting, a browser shortcut, a wrapper app). It beats the session's last
  // tab because it is an explicit request for this one, and it is read in the
  // initializer rather than an effect so the planner never paints the plan view
  // first and swaps a frame later.
  const [activeTab, setActiveTab] = useState<string>(() => {
    const requested = searchParams.get('tab')
    if (requested && isDeepLinkableTripTab(requested)) return requested
    return sessionStorage.getItem(`trip-tab-${tripId}`) || 'plan'
  })

  useEffect(() => {
    // Don't evict a saved plugin tab before the plugin feed has loaded.
    if (activeTab.startsWith('plugin:') && !pluginsLoaded) return
    // Same for the addon-owned tabs: until the feed answers, enabledAddons is a
    // guess, and evicting on a guess would drop a legitimately requested tab.
    if (!addonsLoaded) return
    const validTabIds = TRIP_TABS.map(t => t.id)
    if (!validTabIds.includes(activeTab)) {
      setActiveTab('plan')
      sessionStorage.setItem(`trip-tab-${tripId}`, 'plan')
    }
  }, [activeTab, enabledAddons, addonsLoaded, tripPluginIds, pluginsLoaded, isMobile])

  const handleTabChange = (rawTabId: string): void => {
    // A core tab a plugin replaced is gone from the bar, but a programmatic jump
    // (e.g. onNavigateToFiles) could still target it and render a dead panel with
    // no active pill — fall back to the plan view like the invalid-tab guard does.
    const tabId = replacedTabs.has(rawTabId) ? 'plan' : rawTabId
    setActiveTab(tabId)
    sessionStorage.setItem(`trip-tab-${tripId}`, tabId)
    if (tabId === 'finanzplan') tripActions.loadBudgetItems?.(tripId)
    if (tabId === 'dateien' && (!files || files.length === 0)) tripActions.loadFiles?.(tripId)
  }

  // handleTabChange is where a tab's lazy load and its session memory happen, and
  // the tab we *start* on never goes through it — neither a ?tab= deep link nor a
  // tab restored from a previous visit. Catch both up once per trip, or opening
  // straight into Files shows an empty list.
  const startTabSettled = useRef<number | null>(null)
  useEffect(() => {
    if (!tripId || startTabSettled.current === tripId) return
    startTabSettled.current = tripId
    sessionStorage.setItem(`trip-tab-${tripId}`, activeTab)
    if (activeTab === 'finanzplan') tripActions.loadBudgetItems?.(tripId)
    if (activeTab === 'dateien' && (!files || files.length === 0)) tripActions.loadFiles?.(tripId)
  }, [tripId])
  const {
    leftWidth, rightWidth, leftCollapsed, rightCollapsed, setLeftCollapsed, setRightCollapsed,
    leftHidden, rightHidden, toggleLeft, toggleRight, narrow: narrowPanels,
    startResizeLeft, startResizeRight, nudgeLeft, nudgeRight, resizeMin, resizeMax,
  } = useResizablePanels()
  const { selectedPlaceId, selectedAssignmentId, setSelectedPlaceId, selectAssignment } = usePlaceSelection()
  const toursEnabled = useAddonStore(state => state.isEnabled('tours'))
  const [toursMode, setToursMode] = useState(false)
  const previousToursModeRef = useRef(false)
  const { tours, toursLoading, tourDataReady, tourPlaceIds, reloadTourPlaceIds, invalidateTourPlaceIds, upsertTour } = useTourPlaceIds(tripId, toursEnabled)

  useEffect(() => {
    if (!toursEnabled) {
      setToursMode(false)
      previousToursModeRef.current = false
      return
    }
    const enteredToursMode = toursMode && !previousToursModeRef.current
    previousToursModeRef.current = toursMode
    if (enteredToursMode) setSelectedPlaceId(null)
  }, [toursEnabled, toursMode, setSelectedPlaceId])
  const [dayDetail, setShowDayDetail] = useState<Day | null>(null)
  // A day deleted while its panel is open, here or by a fellow traveller, takes
  // the panel along instead of leaving it on a day that is gone.
  const showDayDetail = dayDetail && days.some(d => d.id === dayDetail.id) ? dayDetail : null
  const [dayDetailCollapsed, setDayDetailCollapsed] = useState(false)
  // The day's "+" can ask for a new stay: the details panel opens on that day and
  // takes the request once, then hands it back so a later opening stays plain.
  const [stayPickerDayId, setStayPickerDayId] = useState<number | null>(null)
  const plannerDialogs = usePlannerDialogs({ tripId, tripActions, searchParams, setSearchParams })
  // The dialog state this hook reads further down as well as returning it.
  const {
    setShowPlaceForm, editingPlace, setEditingPlace, setPrefillCoords, editingAssignmentId, setEditingAssignmentId,
    placeFormDayId, setPlaceFormDayId, placeFormPosition, setPlaceFormPosition,
    serviceStopForm, setServiceStopForm, serviceStopKind, setServiceStopKind,
    stopDraft, setStopDraft, stayRelease, setStayRelease, setBookingImportAvailable,
    setShowReservationModal, editingReservation, setEditingReservation,
    setShowTransportModal, editingTransport, setEditingTransport, setTransportModalDayId,
    bookingDetailOpen, setBookingDetailOpen, openTransportEditor, changeTransitRoute,
  } = plannerDialogs
  // The dialog state that only passes through to the shells.
  const {
    showPlaceForm, prefillCoords, reservationModalDayId, setReservationModalDayId,
    showTripForm, setShowTripForm, showMembersModal, setShowMembersModal, showReservationModal,
    showBookingImport, setShowBookingImport, bookingImportKind, setBookingImportKind, bookingImportAvailable,
    airTrailAvailable, showAirTrailImport, setShowAirTrailImport, bookingForAssignmentId, setBookingForAssignmentId,
    showTransportModal, transportModalDayId, transportModalAutomated, setTransportModalAutomated,
    transitPrefill, setTransitPrefill, transitJourney, setTransitJourney,
  } = plannerDialogs
  // Review-before-save import: each parsed item pre-fills the normal edit modal so
  // the user checks/fixes it, then saves. A ref drives the queue (no stale closures).
  const [reservationPrefill, setReservationPrefill] = useState<BookingReviewDraft | null>(null)
  const [transportPrefill, setTransportPrefill] = useState<BookingReviewDraft | null>(null)
  const [importReviewActive, setImportReviewActive] = useState(false)
  // The expense a scanned receipt pre-fills, opened by the page's expense editor.
  const [receiptExpense, setReceiptExpense] = useState<ExpensePrefill | null>(null)
  const importQueueRef = useRef<BookingImportPreviewItem[]>([])
  // The files this import was parsed from, so each reviewed booking can attach its source doc.
  const importSourceFilesRef = useRef<File[]>([])
  // The tab the items under review came from. A ref, not the bookingImportKind
  // state: the parse outlives navigation and reload, and the review is triggered
  // by the global widget, so by then the state has remounted back to its default.
  // The value comes off the persisted job (#2076).
  const importKindRef = useRef<'transports' | 'bookings'>('bookings')
  const {
    mapLocked, toggleMapLocked, mapLockedRef, isMobileRef, fitKey, setFitKey,
    overviewShown, toggleOverview, dawarichTrailShown, toggleDawarichTrail, dawarichTrail,
    routeShown, setRouteShown, autoShowRoute, transitRoutesShown, routeProfile, setRouteProfile,
  } = usePlannerMapView({ tripId, trip, places, selectedDayId, isMobile })
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<'left' | 'right' | null>(null)
  const mobilePlanScrollTopRef = useRef<number>(0)
  const mobilePlacesScrollTopRef = useRef<number>(0)
  const [deletePlaceId, setDeletePlaceId] = useState<number | null>(null)
  const [deletePlaceIds, setDeletePlaceIds] = useState<number[] | null>(null)
  const isTourPlace = useCallback((placeId: number) => tourPlaceIds.has(placeId)
    || places.some(place => place.id === placeId && place.tour_place_id === placeId), [places, tourPlaceIds])
  const deletePlaceIsTour = deletePlaceId != null && isTourPlace(deletePlaceId)
  const deletePlacesIncludeTours = !!deletePlaceIds?.some(isTourPlace)
  /**
   * The sentence the delete question adds when a night is booked at one of the places.
   *
   * The server takes a booked night down with its place, and with the night the
   * booking made for it and the expense written against that booking. The question
   * itself only names the place, and those are the rows the traveller least expects
   * to lose, so the dialog says so before the yes. The expense list is loaded with
   * the costs tab, not here, so the sentence speaks of any expense rather than
   * counting them. A booking named after its hotel, which is how most are named,
   * is not quoted a second time. Null when nothing beyond the place is at stake.
   */
  const bookedNightsNote = useCallback((placeIds: number[]): string | null => {
    const stays = tripAccommodations.filter(stay => stay.place_id != null && placeIds.includes(stay.place_id))
    if (stays.length === 0) return null
    const names = [...new Set(stays.map(stay => allPlaces.find(p => p.id === stay.place_id)?.name ?? stay.place_name ?? ''))]
      .filter(Boolean)
    const bookings = stays
      .map(stay => reservations.find(r => r.accommodation_id != null && Number(r.accommodation_id) === stay.id)?.title
        ?? stay.reservation_title ?? null)
      .filter((title): title is string => !!title)
    const name = names.join(', ')
    if (bookings.length === 0) return t('trip.confirm.deletePlaceNight', { name })
    return bookings.every(title => names.includes(title))
      ? t('trip.confirm.deletePlaceBookedSame', { name })
      : t('trip.confirm.deletePlaceBooked', { name, booking: bookings.join(', ') })
  }, [tripAccommodations, allPlaces, reservations, t])
  const deletePlaceNote = useMemo(
    () => (deletePlaceId ? bookedNightsNote([deletePlaceId]) : null),
    [deletePlaceId, bookedNightsNote],
  )
  const deletePlacesNote = useMemo(
    () => (deletePlaceIds?.length ? bookedNightsNote(deletePlaceIds) : null),
    [deletePlaceIds, bookedNightsNote],
  )

  useEffect(() => {
    // The server runs the import when EITHER kitinerary or the LLM parser is
    // there (booking-import.service.ts), so gating the entry point on kitinerary
    // alone hid a working feature on LLM-only instances (#2007).
    healthApi.features().then(f => setBookingImportAvailable(f.bookingImport || f.aiParsing)).catch(() => {})
  }, [setBookingImportAvailable])

  const connectionsStorageKey = tripId ? `trek:visible-connections:${tripId}` : null
  // Per-trip route-visibility preference — null means "never touched", which
  // falls back to the account-wide map_always_show_routes default (see
  // connectionsVisibility.ts). That fallback is purely computed, never
  // written, so flipping the account setting later doesn't silently override
  // a trip you've already made an explicit choice on.
  const [storedConnections, setStoredConnections] = useState<StoredConnections | null>(() => {
    if (typeof window === 'undefined' || !connectionsStorageKey) return null
    return parseStoredConnections(window.localStorage.getItem(connectionsStorageKey))
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !connectionsStorageKey || !storedConnections) return
    window.localStorage.setItem(connectionsStorageKey, JSON.stringify(storedConnections))
  }, [connectionsStorageKey, storedConnections])
  const alwaysShowRoutesDefault = settings.map_always_show_routes === true
  const routableReservationIds = useMemo(
    () => reservations.filter(isRoutableReservation).map(r => r.id),
    [reservations]
  )
  const effectiveConnections = useMemo(
    () => resolveEffectiveConnections(storedConnections, alwaysShowRoutesDefault),
    [storedConnections, alwaysShowRoutesDefault]
  )
  const visibleConnections = useMemo(
    () => resolveVisibleConnectionIds(effectiveConnections, routableReservationIds),
    [effectiveConnections, routableReservationIds]
  )
  const allConnectionsShown = effectiveConnections.mode === 'all-except'
  const toggleConnection = useCallback((id: number) => {
    setStoredConnections(prev => toggleConnectionId(prev, alwaysShowRoutesDefault, id))
  }, [alwaysShowRoutesDefault])
  const toggleAllConnections = useCallback(() => {
    setStoredConnections(prev => flipAllConnectionsMode(prev, alwaysShowRoutesDefault))
  }, [alwaysShowRoutesDefault])
  const [mapTransportDetail, setMapTransportDetail] = useState<Reservation | null>(null)

  // Layout is width-driven (isMobile); the drag bridge is pointer-driven (isTouch).
  // Conflating them is what left a tablet's places list undraggable-but-unscrollable (#1432).
  const isTouch = useIsTouch()

  // Start photo fetches during splash screen so images are ready when map mounts
  useEffect(() => {
    if (isLoading || !places || places.length === 0 || !placesPhotosEnabled) return
    for (const p of places) {
      if (p.image_url) continue
      const cacheKey = p.google_place_id || p.osm_id || `${p.lat},${p.lng}`
      if (!cacheKey || getCached(cacheKey)) continue
      const photoId = p.google_place_id || p.osm_id
      if (photoId || (p.lat && p.lng)) {
        fetchPhoto(cacheKey, photoId || `coords:${p.lat}:${p.lng}`, p.lat, p.lng, p.name)
      }
    }
  }, [isLoading, places])

  // Load the trip. loadTrip hydrates every trip-scoped slice (days, places,
  // packing, todo, budget, reservations, files) so offline hydration is uniform
  // and there's no cross-trip bleed; members/accommodations load alongside.
  useEffect(() => {
    if (tripId) {
      tripActions.loadTrip(tripId).catch(() => { toast.error(t('trip.toast.loadError')); navigate('/dashboard') })
      loadAccommodations()
      if (isEffectivelyOffline()) {
        offlineDb.tripMembers.where('tripId').equals(Number(tripId)).toArray()
          .then(rows => setTripMembers(rows))
          .catch(() => {})
      } else {
        refreshMembers()
      }
    }
  }, [tripId])

  // Accommodations live in this hook's local state, so store-level refreshes
  // (remote trip date change, reconnect hydration) nudge us via this event (#1288).
  useEffect(() => {
    const onRefresh = () => loadAccommodations()
    window.addEventListener('accommodations:refresh', onRefresh)
    return () => window.removeEventListener('accommodations:refresh', onRefresh)
  }, [loadAccommodations])

  useTripWebSocket(tripId, invalidateTourPlaceIds)

  const { expandedDayIds, setExpandedDayIds, mapPlaces, dayOrderMap, dayPlaces } = useMapPlaces({
    places, assignments, selectedDayId, days, tripAccommodations, reservations, toursEnabled,
  })

  const { route, routeWalking, routeSegments, routeVias, routeInfo, setRoute, setRouteInfo, updateRouteForDay } = useRouteCalculation({ assignments } as any, selectedDayId, routeShown, routeProfile, tripAccommodations)
  // Road trip mode already draws the whole trip its own way, so the overview stands
  // down there rather than drawing a second set of lines over it.
  const overviewActive = overviewShown && !roadtripMode
  const tripOverview = useTripRouteOverview(tripId, days, assignments, reservations, tripAccommodations, routeProfile, overviewActive, places)

  // Called here so the road trip's effects keep their place, right after the overview's.
  const {
    roadtripActive, roadtripFeedActive, roadtripRoutes, roadtripVias, roadtripCorridor, refuel, followTrack,
    roadtripPreferencesState, dailyTimesActive, dayBoundaries, resetDayBoundaries, dayBoundaryControls, saveRoadtripLimit,
    roadtripStopsOf, viaLiesBefore, viasAfterInsert, roadtripConnections, roadtripViaCounts,
    collapsedRoadtripDays, toggleRoadtripDay, roadtripMapLines, roadtripMapPlaces, roadtripLineColors, dawarichHiddenDates,
  } = useRoadtripFeed({
    tripId, trip, can, toast, t, enabledAddons, roadtripMode, roadtripSettings, isMobile, activeTab,
    days, reservations, storedAssignments, assignments, tripAccommodations, places,
    mapPlaces, expandedDayIds, routeProfile, visibleConnections,
  })

  const handleSelectDay = useCallback((dayId: number | null, skipFit?: boolean) => {
    tripActions.setSelectedDay(dayId)
    // The lock is a desktop control; the phone always follows the day.
    if (!skipFit && !(mapLockedRef.current && !isMobileRef.current)) setFitKey(k => k + 1)
    setMobileSidebarOpen(null)
    updateRouteForDay(dayId)
  }, [updateRouteForDay, isMobileRef, mapLockedRef, setFitKey])

  const handlePlaceClick = useCallback((placeId: number | null, assignmentId?: number | null) => {
    if (assignmentId) {
      selectAssignment(assignmentId, placeId)
    } else {
      setSelectedPlaceId(placeId)
    }
    if (placeId) { setShowDayDetail(null); setLeftCollapsed(false); setRightCollapsed(false) }
  }, [selectAssignment, setSelectedPlaceId])

  const handleMarkerClick = useCallback((placeId?: number) => {
    if (placeId === undefined) {
      setSelectedPlaceId(null)
      return
    }
    // Find every assignment for this place (same place can sit on several
    // days / be planned twice in one day). Cycle through them on repeated
    // marker clicks so the sidebar highlight jumps to the next occurrence
    // instead of leaving the user confused.
    const allAssignments = Object.values(useTripStore.getState().assignments || {}).flat()
    const matching = allAssignments.filter(a => a?.place?.id === placeId)

    if (matching.length === 0) {
      setSelectedPlaceId(selectedPlaceId === placeId ? null : placeId)
    } else if (matching.length === 1) {
      const only = matching[0]
      if (selectedAssignmentId === only.id) {
        setSelectedPlaceId(null)
      } else {
        selectAssignment(only.id, placeId)
      }
    } else {
      const currentIdx = matching.findIndex(a => a.id === selectedAssignmentId)
      const nextIdx = currentIdx === -1 ? 0 : currentIdx + 1
      if (nextIdx >= matching.length) {
        // cycled past the last occurrence — clear selection so the next
        // click starts fresh at occurrence 0.
        setSelectedPlaceId(null)
      } else {
        selectAssignment(matching[nextIdx].id, placeId)
      }
    }
    setLeftCollapsed(false); setRightCollapsed(false)
  }, [selectAssignment, selectedAssignmentId, selectedPlaceId, setSelectedPlaceId])

  const handleMapClick = useCallback(() => {
    setSelectedPlaceId(null)
  }, [])

  const handleMapContextMenu = useCallback(async (e, dayId?: number | null) => {
    if (!can('place_edit', trip)) return
    e.originalEvent?.preventDefault()
    const { lat, lng } = e.latlng
    setPrefillCoords({ lat, lng })
    setEditingPlace(null)
    setEditingAssignmentId(null)
    setPlaceFormDayId(dayId ?? null)
    setServiceStopForm(false)
    setShowPlaceForm(true)
    try {
      const { mapsApi } = await import('../../api/client')
      const data = await mapsApi.reverse(lat, lng, placeLang)
      if (data.name || data.address) {
        setPrefillCoords(prev => prev ? { ...prev, name: data.name || '', address: data.address || '' } : prev)
      }
    } catch { /* best effort */ }
  }, [placeLang, setEditingAssignmentId, setEditingPlace, setPlaceFormDayId, setPrefillCoords, setServiceStopForm, setShowPlaceForm])

  // Open the Add-Place form pre-filled from an OSM "explore" POI marker — all the
  // data already comes from the POI, so no reverse-geocode is needed.
  const openAddPlaceFromPoi = useCallback((
    poi: { lat: number; lng: number; name: string; address: string | null; website: string | null; phone: string | null; osm_id: string; category?: string | null; poi_type?: string | null },
    dayId?: number | null,
    /** Index within that day. Omitted, the place is appended, which is what every caller did before. */
    position?: number | null,
    /**
     * What the corridor popup had worked out before the traveller asked for the full
     * form. Without it, leaving the popup by "more details" quietly turned a fuel stop
     * into a numbered destination that counts in every total.
     */
    stop?: { stopType: RoadtripStopType | null; dwellMinutes: number } | null,
  ) => {
    if (!can('place_edit', trip)) return
    setPrefillCoords({
      lat: poi.lat,
      lng: poi.lng,
      name: poi.name,
      address: poi.address || '',
      // Checked again on the way into the form: a plugin POI's website is the plugin's
      // text, and only an address a browser opens as a page belongs in the field.
      website: normalizePlaceWebsite(poi.website) ?? undefined,
      phone: poi.phone || undefined,
      // A plugin POI's `plugin:<pluginId>:<id>` rides along as it is. The server never
      // takes that prefix for a Google place id, so the details column makes no Google call.
      osm_id: poi.osm_id,
      // What the map search filed it under, so the form can preselect a category (#2282).
      category: poi.poi_type || poi.category || undefined,
      stop_type: stop?.stopType ?? null,
      duration_minutes: stop?.dwellMinutes,
    })
    setEditingPlace(null)
    setEditingAssignmentId(null)
    setPlaceFormDayId(dayId ?? null)
    setPlaceFormPosition(position ?? null)
    setServiceStopForm(false)
    setShowPlaceForm(true)
  }, [trip, setEditingAssignmentId, setEditingPlace, setPlaceFormDayId, setPlaceFormPosition, setPrefillCoords, setServiceStopForm, setShowPlaceForm])

  /**
   * Adding a POI straight off the map, with the day it belongs to.
   *
   * In road trip mode that is the day being searched: without it the place lands in the
   * unplanned pool, and neither column shows that pool while road trip mode is on, so a
   * just-added stop disappears without a trace. Outside road trip mode nothing changes —
   * `undefined` keeps the old "let the user pick" behaviour.
   *
   * Memoised because both map renderers rebuild every POI marker whenever this callback's
   * identity changes.
   */
  const roadtripDayId = roadtripCorridor.day?.dayId ?? null
  const { insertIndexFor: roadtripInsertIndexFor } = roadtripCorridor
  const roadtripDayNumber = roadtripCorridor.day?.dayNumber ?? 0
  /**
   * The check-out days a night started on `dayId` can end on.
   *
   * Ordered by the trip's own day order rather than by array position, the same rule the
   * day detail panel follows: a day list can be sorted by anything, and a hotel booked
   * out on "the next day" has to mean the next day of the trip.
   */
  const overnightOptions = useCallback((dayId: number) => {
    const ordered = [...days].sort((a, b) => getDayOrder(a, days) - getDayOrder(b, days))
    const from = ordered.findIndex(d => d.id === dayId)
    const rest = from < 0 ? ordered : ordered.slice(from)
    return {
      days: rest.map(d => ({ id: d.id, number: d.day_number ?? 0, date: d.date ?? null })),
      // The day after, or this one when it is the last: a night on the final day of a
      // trip has nowhere else to end.
      defaultEndDayId: rest[1]?.id ?? rest[0]?.id ?? dayId,
    }
  }, [days])

  const handlePoiClick = useCallback((poi: Parameters<typeof openAddPlaceFromPoi>[0]) => {
    if (!can('place_edit', trip)) return
    // A corridor hit knows how far along the drive it sits, so it can go straight into
    // the chain in driving order instead of being dragged there afterwards.
    //
    // Gated on the FEED, not on road trip mode: the phone never turns that mode on (it
    // is a data switch the mobile sheets cannot survive, see `roadtripFeedActive`), so
    // reading it here sent every hit found on the stage map into the full place form
    // instead, losing the stop kind, the stay, and the position worked out just above.
    const hit = roadtripFeedActive && 'alongKm' in poi ? (poi as unknown as CorridorPoi) : null
    if (hit && roadtripDayId != null) {
      const displayed = roadtripRoutes.days.find(d => d.dayId === roadtripDayId)
      const insert = displayed && roadtripInsertion(displayed, roadtripInsertIndexFor(hit))
      if (!insert) return
      setStopDraft({
        poi: hit,
        arrivalTime: displayed ? stopArrival(displayed, roadtripInsertIndexFor(hit), hit.alongKm) : null,
        ...insert,
        dayNumber: roadtripDayNumber,
        // Only for a hit somebody could sleep at, and it is what gives the popup its
        // second mode. The check-out options are the days from this one on in travel
        // order; the default is the next one, which is what a night usually means.
        ...(isOvernightCategory(hit.category) ? { overnight: overnightOptions(insert.dayId) } : {}),
      })
      return
    }
    const selected = roadtripRoutes.days.find(d => d.dayId === roadtripDayId)
    const target = selected && roadtripInsertion(selected, selected.stops.length)
    openAddPlaceFromPoi(poi, roadtripFeedActive ? target?.dayId ?? roadtripDayId : undefined)
  }, [openAddPlaceFromPoi, roadtripFeedActive, roadtripDayId, roadtripDayNumber, roadtripInsertIndexFor, roadtripRoutes.days, overnightOptions, can, trip, setStopDraft])

  const {
    stayDraft, setStayDraft, editRoadtripStay, setRoadtripStay, roadtripEndsDayAt, setRoadtripEndDay,
    saveStopDraft, saveStopDraftAsNight, confirmStayRelease, reorderRoadtripStop, moveRoadtripStopToDay,
    setRoadtripStopKind, setRoadtripStopFill,
  } = useRoadtripStopEdits({
    tripId, trip, can, tripActions, toast, t, stopDraft, setStopDraft, stayRelease, setStayRelease,
    assignments, tripAccommodations, reservations, loadAccommodations, updateRouteForDay,
    roadtripVias, roadtripStopsOf, viaLiesBefore, dayBoundaries, dailyTimesActive,
  })

  // Called here so the picker's effects keep their place after the road trip's own.
  const {
    highlightedAlternative, setHighlightedAlternative, routeAlternatives, alternativeOverlays, alternativeFocusPoints,
    mapFocusPoints, roadtripMapVias, focusRoadtripPoint, askRouteAlternatives, chooseRouteAlternative,
  } = useRoadtripAlternatives({
    t, toast, isMobile, activeTab, roadtripActive, roadtripFeedActive, roadtripRoutes, roadtripVias, refuel,
    collapsedRoadtripDays,
  })

  const {
    manualStopTargetFor, addRoadtripVia, moveRoadtripVia, removeRoadtripVia, askRefuel, acceptRefuel, dropPoiOnRoute,
  } = useRoadtripDriveShaping({
    trip, can, toast, t, roadtripSettings, setStopDraft, roadtripRoutes, roadtripVias, roadtripCorridor, refuel,
  })

  /**
   * Adding a stop the corridor search never found.
   *
   * The search reads OpenStreetMap, and a good share of the chargers actually standing
   * at a motorway junction are not in it. The way round it was to leave road trip mode,
   * add the place under Days, drag it onto the right day, come back and mark it a
   * charging stop.
   *
   * So this opens the form the rest of TREK adds places with, on nothing at all: no
   * place, no coordinates, no day. The traveller finds the charger in the form's own
   * typed-ahead search, which is the whole reason to use it, and where the stop belongs
   * is worked out at the save, from what the save carries.
   */
  const openManualRoadtripStop = useCallback((kind: RoadtripStopType | null = null) => {
    if (!can('place_edit', trip)) return
    setEditingPlace(null)
    setEditingAssignmentId(null)
    setPrefillCoords(null)
    // Deliberately nowhere. A corridor hit knows its day and its position before the
    // form opens; this one cannot, because nothing has been chosen yet.
    setPlaceFormDayId(null)
    setPlaceFormPosition(null)
    // Set in the same batch as the flag below, so the kind is already there when the
    // form's opening effect reads the mode out of its closure.
    setServiceStopKind(kind)
    setServiceStopForm(true)
    setShowPlaceForm(true)
  }, [can, trip, setEditingAssignmentId, setEditingPlace, setPlaceFormDayId, setPlaceFormPosition, setPrefillCoords, setServiceStopForm, setServiceStopKind, setShowPlaceForm])

  /**
   * What the place form needs to ask for a service stop, or null for every other use.
   *
   * The legs are flat across the whole drive rather than per card, because the charger
   * the search missed is as likely to be on tomorrow's stretch as on today's. The names
   * travel as plain strings so the form does its own labelling and this stays free of
   * translated text.
   */
  const serviceStopMode = useMemo<ServiceStopMode | null>(() => {
    if (!serviceStopForm) return null
    const panelDay = roadtripCorridor.day
    return {
      defaultKind: serviceStopKind,
      // A day that has not routed has no order to place anything in.
      days: roadtripRoutes.days
        .filter(day => day.geometry.length > 1)
        .map(day => {
          const spine: LatLng[] = day.geometry.map(([la, ln]) => ({ lat: la, lng: ln }))
          const stopsAlong = day.stops.map(stop => projectOntoRoute({ lat: stop.lat, lng: stop.lng }, spine)?.alongKm ?? 0)
          return {
            dayId: day.dayId,
            dayNumber: day.dayNumber,
            stops: day.stops.map(stop => stop.name),
            // Each leg's own road, cut out of the day's line where the two stops it runs
            // between fall on it. The form measures the place against each of these, so
            // the leg it offers first is visibly the nearest one rather than a guess the
            // reader has to take on trust.
            legLines: day.stops.slice(0, -1).map((_, i) =>
              sliceAtMeters(spine, (stopsAlong[i] ?? 0) * 1000, (stopsAlong[i + 1] ?? 0) * 1000)),
          }
        }),
      // The end of the day the panel is looking at, which is what the dialog this
      // replaced did. Offered whatever else has routed, not only when nothing has: with
      // its neighbours drawn and its own line still coming, a day left out of this list
      // is a day a stop meant for it cannot be put on at all.
      appendDay: panelDay
        ? { dayId: panelDay.dayId, dayNumber: panelDay.dayNumber, position: panelDay.stops.length }
        : null,
      targetFor: manualStopTargetFor,
    }
  }, [serviceStopForm, serviceStopKind, roadtripRoutes.days, roadtripCorridor.day, manualStopTargetFor])

  /** Hands the draft over to the full form, keeping the day and the position it worked out. */
  const stopDraftToForm = useCallback((stop?: { stopType: RoadtripStopType | null; dwellMinutes: number }) => {
    if (!stopDraft) return
    const { poi, dayId, position } = stopDraft
    setStopDraft(null)
    if (stopDraft.editing) {
      const place = places.find(place => place.id === stopDraft.editing?.placeId)
      if (place) {
        setEditingPlace(place)
        setEditingAssignmentId(resolvePoolAssignmentId(assignments, place.id))
        setShowPlaceForm(true)
      }
      return
    }
    // Carries the kind and the dwell the popup had already worked out. Leaving them
    // behind is what turned a fuel stop into a numbered destination on the way to the
    // full form, silently and in every total.
    openAddPlaceFromPoi(poi, dayId, position, stop ?? null)
  }, [stopDraft, openAddPlaceFromPoi, places, assignments, setEditingAssignmentId, setEditingPlace, setShowPlaceForm, setStopDraft])

  /**
   * A place on this trip that came from the same OSM object.
   *
   * The full place form warns about duplicates; without the same check here the popup
   * would be the quickest way to add one petrol station twice.
   */
  const stopDraftDuplicate = useMemo(() => {
    if (stopDraft?.editing || !stopDraft?.poi.osm_id) return null
    return places.find(p => p.osm_id === stopDraft.poi.osm_id)?.name ?? null
  }, [stopDraft, places])

  const handleSavePlace = useCallback(async (data) => {
    const pendingFiles = data._pendingFiles
    delete data._pendingFiles
    // Where a service stop added by hand belongs on the drive. The form worked it out
    // from the coordinates being saved, because until a place was chosen in it there
    // were none to project.
    const serviceStop = data._serviceStop
    delete data._serviceStop
    if (editingPlace) {
      // Always strip time fields from place update — time is per-assignment only.
      // Same for the day-specific note (#2163): it belongs to the assignment,
      // never to the pool place.
      const { place_time, end_time, assignment_notes, ...placeData } = data
      await tripActions.updatePlace(tripId, editingPlace.id, placeData)
      // If editing from assignment context, save time per-assignment
      if (editingAssignmentId) {
        await assignmentsApi.updateTime(tripId, editingAssignmentId, { place_time: place_time || null, end_time: end_time || null })
        // The form only includes assignment_notes when the user changed it, so
        // an untouched note never produces a PUT (#2163). '' clears like null.
        if (assignment_notes !== undefined) {
          await assignmentsApi.updateNotes(tripId, editingAssignmentId, { notes: assignment_notes || null })
        }
        await tripActions.refreshDays(tripId)
      }
      // Upload pending files with place_id
      if (pendingFiles?.length > 0) {
        for (const file of pendingFiles) {
          const fd = new FormData()
          fd.append('file', file)
          fd.append('place_id', String(editingPlace.id))
          try { await tripActions.addFile(tripId, fd) } catch (err) { toast.error(translateApiError(t, err, 'files.uploadError')) }
        }
      }
      toast.success(t('trip.toast.placeUpdated'))
      return { id: editingPlace.id }
    } else {
      const place = await tripActions.addPlace(tripId, data)
      // A card of the rail can draw stops that are STORED on the day before it
      // (`nightSpill.ts`), so a leg named by the card and the position in it is
      // translated once here, the same way every other path into this write is.
      const card = serviceStop && roadtripRoutes.days.find(day => day.dayId === serviceStop.dayId)
      const insert = serviceStop
        ? (card && roadtripInsertion(card, serviceStop.position)) || { dayId: serviceStop.dayId, position: serviceStop.position }
        : null
      const dayId = insert ? insert.dayId : placeFormDayId
      const position = insert ? insert.position : placeFormPosition
      // Added from inside a day? Then it belongs to that day. Without this the
      // place drops into the unplanned pool and, on mobile, into a different
      // screen entirely — which reads as "it wasn't saved" (#1998).
      if (place?.id && dayId != null) {
        // Worked out BEFORE the stop lands, against the day as it stands and the road as
        // it is currently driven: once the list has shifted there is no record of which
        // leg each via was drawn for. A via is stored as (day, after_order_index) and
        // that index is a POSITION in the day's stop list, so a stop dropped into the
        // middle of a routed day pushes every via at or behind it onto the wrong leg and
        // the drawn road runs forward, doubles back and runs out again. Keyed on the
        // position rather than on the service-stop form: a corridor hit handed to the
        // full form carries its position too, and was the one way into the middle of a
        // day that left the vias where they were.
        const plan = position != null && typeof data.lat === 'number' && typeof data.lng === 'number'
          ? reanchorAfterInsert(
            roadtripVias.byDay[dayId] ?? [],
            position,
            viaLiesBefore(dayId, { lat: data.lat, lng: data.lng }),
          )
          : null
        try {
          // With a position the stop lands where it will be driven past, not at the end
          // of the day. The slice has taken one all along; nothing ever passed it.
          await tripActions.assignPlaceToDay(tripId, dayId, place.id, position)
          // Awaited before the day re-routes: the routing effect reads the anchors against
          // the new stop list, so a correction landing after it would draw the wrong road
          // first and the right one a moment later.
          if (plan) await roadtripVias.reanchor(dayId, plan)
          updateRouteForDay(dayId)
        } catch (err: unknown) {
          // The place itself exists; only the day link failed.
          toast.error(err instanceof Error ? err.message : t('common.unknownError'))
        }
      }
      if (pendingFiles?.length > 0 && place?.id) {
        for (const file of pendingFiles) {
          const fd = new FormData()
          fd.append('file', file)
          fd.append('place_id', String(place.id))
          try { await tripActions.addFile(tripId, fd) } catch (err) { toast.error(translateApiError(t, err, 'files.uploadError')) }
        }
      }
      toast.success(t('trip.toast.placeAdded'))
      if (place?.id) {
        const capturedId = place.id
        pushUndo(t('undo.addPlace'), async () => {
          await tripActions.deletePlace(tripId, capturedId)
        })
      }
      // Handed back so the form can link an expense to a place that did not
      // exist a moment ago (#1298), the same way the booking modals work.
      return place?.id ? { id: place.id } : undefined
    }
  }, [editingPlace, editingAssignmentId, placeFormDayId, placeFormPosition, roadtripRoutes.days, tripId, toast, pushUndo, updateRouteForDay, roadtripVias, viaLiesBefore])

  // Open the place editor from any entry point (Places pool, inspector, map).
  // Times live per day-assignment, so when no day is in context resolve the
  // place's lone assignment to hydrate & persist its times; with 0 or 2+
  // assignments the time is ambiguous and the modal hides the fields (#1247).
  const openPlaceEditor = useCallback((place: Place, preferredAssignmentId: number | null = null) => {
    if (isMobile && isTourPlace(place.id)) {
      handlePlaceClick(place.id, preferredAssignmentId)
      return
    }
    if (!can('place_edit', trip)) return
    if (roadtripActive && (isServiceStopType(place.stop_type) || tripAccommodations.some(stay => stay.place_id === place.id)) && typeof place.lat === 'number' && typeof place.lng === 'number') {
      const visitId = preferredAssignmentId ?? resolvePoolAssignmentId(assignments, place.id)
      const entry = Object.entries(assignments).find(([, visits]) => visits.some(visit => visit.id === visitId))
      if (entry) {
        const dayId = Number(entry[0])
        const visit = entry[1].find(visit => visit.id === visitId)!
        const stay = tripAccommodations.find(stay => stay.place_id === place.id && stay.start_day_id === dayId)
        const category = place.stop_type ?? (stay ? 'hotel' : '')
        const routedDay = roadtripRoutes.days.find(day => day.stops.some(stop => stop.assignmentId === visitId))
        const arrivalTime = routedDay?.schedule.entries[routedDay.stops.findIndex(stop => stop.assignmentId === visitId)]?.arrival ?? null
        setStopDraft({
          poi: { osm_id: place.osm_id ?? '', name: place.name, lat: place.lat, lng: place.lng, category, poi_type: category, address: place.address ?? null, website: place.website ?? null, phone: place.phone ?? null, opening_hours: null, cuisine: null, source: 'trek', offRouteKm: 0, alongKm: 0 },
          arrivalTime, dayId, dayNumber: days.find(day => day.id === dayId)?.day_number ?? 0, position: visit.order_index ?? 0,
          editing: { placeId: place.id, stopType: place.stop_type ?? (stay ? 'hotel' : null), dwellMinutes: place.duration_minutes ?? 30, accommodationId: stay?.id, checkIn: stay?.check_in ?? '', checkOut: stay?.check_out ?? '' },
          ...(isOvernightCategory(category) ? { overnight: { ...overnightOptions(dayId), ...(stay ? { defaultEndDayId: stay.end_day_id } : {}) } } : {}),
        })
        return
      }
    }
    setEditingPlace(place)
    setEditingAssignmentId(preferredAssignmentId ?? resolvePoolAssignmentId(assignments, place.id))
    setPlaceFormDayId(null)
    setServiceStopForm(false)
    setShowPlaceForm(true)
  }, [isMobile, isTourPlace, handlePlaceClick, can, trip, assignments, roadtripActive, tripAccommodations, days, overnightOptions, roadtripRoutes.days, setEditingAssignmentId, setEditingPlace, setPlaceFormDayId, setServiceStopForm, setShowPlaceForm, setStopDraft])

  const handleDeletePlace = useCallback(
    (placeId) => {
      if (!can('place_edit', trip)) return
      if (toursEnabled && isTourPlace(placeId)) return
      setDeletePlaceId(placeId)
    },
    [can, trip, toursEnabled, isTourPlace]
  )

  const handleDeleteTour = useCallback(
    (placeId: number) => {
      if (!can('place_edit', trip) || !toursEnabled || !isTourPlace(placeId)) return
      setDeletePlaceId(placeId)
    },
    [can, trip, toursEnabled, isTourPlace]
  )

  const confirmDeletePlace = useCallback(async () => {
    if (!deletePlaceId) return null
    const state = useTripStore.getState()
    const capturedPlace = state.places.find(p => p.id === deletePlaceId)
    const capturedAssignments = Object.entries(state.assignments).flatMap(([dayId, as]) =>
      as.filter(a => a.place?.id === deletePlaceId).map(a => ({ dayId: Number(dayId), orderIndex: a.order_index }))
    )
    try {
      const deletion = await tripActions.deletePlace(tripId, deletePlaceId)
      const deletedTour = Array.isArray(deletion?.tourPlaceIds)
        ? deletion.tourPlaceIds.includes(deletePlaceId)
        : isTourPlace(deletePlaceId)
      if (deletedTour) invalidateTourPlaceIds({ removedPlaceIds: [deletePlaceId] })
      else void reloadTourPlaceIds()
      if (selectedPlaceId === deletePlaceId) setSelectedPlaceId(null)
      updateRouteForDay(selectedDayId)
      toast.success(t('trip.toast.placeDeleted'))
      if (deletedTour) forgetPlace(deletePlaceId)
      else if (capturedPlace) {
        pushUndo(t('undo.deletePlace'), async () => {
          const newPlace = await tripActions.addPlace(tripId, {
            name: capturedPlace.name,
            description: capturedPlace.description,
            lat: capturedPlace.lat,
            lng: capturedPlace.lng,
            address: capturedPlace.address,
            category_id: capturedPlace.category_id,
            price: capturedPlace.price,
            // An undone track has to come back as a track, not a bare point.
            route_geometry: capturedPlace.route_geometry,
            route_color: capturedPlace.route_color,
          })
          const live = new Set(useTripStore.getState().days.map(d => d.id))
          for (const { dayId, orderIndex } of capturedAssignments) {
            if (live.has(dayId)) await tripActions.assignPlaceToDay(tripId, dayId, newPlace.id, orderIndex)
          }
        })
      }
      return deletedTour ? deletePlaceId : null
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      return null
    }
  }, [deletePlaceId, tripId, toast, selectedPlaceId, selectedDayId, updateRouteForDay, pushUndo, forgetPlace, invalidateTourPlaceIds, reloadTourPlaceIds, isTourPlace])

  const confirmDeletePlaces = useCallback(async (ids?: number[]) => {
    const targetIds = ids ?? deletePlaceIds
    if (!targetIds?.length) return
    const state = useTripStore.getState()
    const capturedPlaces = state.places.filter(p => targetIds.includes(p.id))
    const capturedAssignments = Object.entries(state.assignments).flatMap(([dayId, as]) =>
      as.filter(a => a.place?.id != null && targetIds.includes(a.place.id)).map(a => ({ dayId: Number(dayId), placeId: a.place!.id, orderIndex: a.order_index }))
    )
    try {
      const deletion = await tripActions.deletePlacesMany(tripId, targetIds)
      const deletedTourIds = Array.isArray(deletion?.tourPlaceIds)
        ? deletion.tourPlaceIds.filter(id => targetIds.includes(id))
        : targetIds.filter(isTourPlace)
      void reloadTourPlaceIds()
      if (selectedPlaceId != null && targetIds.includes(selectedPlaceId)) setSelectedPlaceId(null)
      if (!ids) setDeletePlaceIds(null)
      updateRouteForDay(selectedDayId)
      toast.success(t('trip.toast.placesDeleted', { count: capturedPlaces.length }))
      if (deletedTourIds.length > 0) deletedTourIds.forEach(forgetPlace)
      else if (capturedPlaces.length > 0) {
        pushUndo(t('undo.deletePlaces'), async () => {
          const live = new Set(useTripStore.getState().days.map(d => d.id))
          for (const place of capturedPlaces) {
            const newPlace = await tripActions.addPlace(tripId, {
              name: place.name, description: place.description,
              lat: place.lat, lng: place.lng, address: place.address,
              category_id: place.category_id, price: place.price,
              route_geometry: place.route_geometry, route_color: place.route_color,
            })
            for (const a of capturedAssignments.filter(x => x.placeId === place.id && live.has(x.dayId))) {
              await tripActions.assignPlaceToDay(tripId, a.dayId, newPlace.id, a.orderIndex)
            }
          }
        })
      }
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.unknownError')) }
  }, [deletePlaceIds, tripId, toast, selectedPlaceId, selectedDayId, updateRouteForDay, pushUndo, forgetPlace, reloadTourPlaceIds, isTourPlace])

  const confirmChangeCategory = useCallback(async (ids: number[], categoryId: number | null) => {
    if (!ids.length) return
    const state = useTripStore.getState()
    // Capture each place's prior category so undo can restore them per group.
    const captured = state.places.filter(p => ids.includes(p.id)).map(p => ({ id: p.id, prev: p.category_id ?? null }))
    try {
      await tripActions.updatePlacesMany(tripId, ids, { category_id: categoryId })
      toast.success(t('places.categoryChanged', { count: ids.length }))
      if (captured.length > 0) {
        pushUndo(t('undo.changeCategory'), async () => {
          // Group the captured ids by their prior category so each set is restored
          // in one call ('null' key = previously uncategorized). Map is shadowed by
          // the lucide icon import in this file, so use a plain object.
          const byPrev: Record<string, number[]> = {}
          for (const { id, prev } of captured) {
            const key = prev === null ? 'null' : String(prev)
            ;(byPrev[key] ??= []).push(id)
          }
          for (const [key, group] of Object.entries(byPrev)) {
            await tripActions.updatePlacesMany(tripId, group, { category_id: key === 'null' ? null : Number(key) })
          }
        })
      }
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.unknownError')) }
  }, [tripId, toast, pushUndo])

  const handleAssignToDay = useCallback(async (placeId: number, dayId?: number, position?: number) => {
    const target = dayId || selectedDayId
    if (!target) { toast.error(t('trip.toast.selectDay')); return false }
    if (isTourPlace(placeId) && (storedAssignments[String(target)] ?? []).some(assignment => assignment.place_id === placeId)) return false
    const place = places.find(p => p.id === placeId)
    // A place with a start of its own is drawn by it, so it is stored there too, the
    // way a stop moved over from another day is. Without one it goes where it was put.
    const slot = timedSlot(storedAssignments[String(target)] ?? [], tripAccommodations, place?.place_time, position) ?? position
    const plan = viasAfterInsert(target, slot, place)
    let assignment: Awaited<ReturnType<typeof tripActions.assignPlaceToDay>>
    try {
      assignment = await tripActions.assignPlaceToDay(tripId, target, placeId, slot)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('common.unknownError'))
      return false
    }
    if (isTourPlace(placeId)) await reloadTourPlaceIds()
    toast.success(t('trip.toast.assignedToDay'))
    if (assignment?.id) {
      const capturedAssignmentId = assignment.id
      const capturedTarget = target
      pushUndo(t('undo.assignPlace'), async () => {
        await tripActions.removeAssignment(tripId, capturedTarget, capturedAssignmentId)
        if (isTourPlace(placeId)) await reloadTourPlaceIds()
      }, [capturedTarget], [placeId])
    }
    if (plan) {
      try { await roadtripVias.reanchor(target, plan) }
      catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.unknownError')) }
    }
    updateRouteForDay(target)
    return true
  }, [selectedDayId, tripId, toast, updateRouteForDay, pushUndo, t, places, isTourPlace, reloadTourPlaceIds, storedAssignments, tripAccommodations, roadtripVias, viasAfterInsert])

  /**
   * Moves a stop from the day list onto another day, at a row of that day or at its
   * end without one.
   *
   * It can land in the middle of a day whose road has been drawn, on the row it was
   * dropped on or among the stops its start falls between. The vias of that day count
   * stops, so every one behind the new stop would shape the leg before the one it was
   * drawn on. They are moved the way a place added to the day moves them. Rejects when
   * a write fails, so the list can say so and leave its undo out.
   */
  const handleMoveToDay = useCallback(async (assignmentId: number, fromDayId: number, toDayId: number, position?: number) => {
    const place = (storedAssignments[String(fromDayId)] ?? []).find(a => a.id === assignmentId)?.place
    const plan = viasAfterInsert(toDayId, position, place)
    await tripActions.moveAssignment(tripId, assignmentId, fromDayId, toDayId, position)
    if (plan) await roadtripVias.reanchor(toDayId, plan)
  }, [tripId, tripActions, storedAssignments, roadtripVias, viasAfterInsert])

  const handleRemoveAssignment = useCallback(async (dayId: number, assignmentId: number) => {
    const state = useTripStore.getState()
    const capturedAssignment = (state.assignments[String(dayId)] || []).find(a => a.id === assignmentId)
    const capturedPlaceId = capturedAssignment?.place?.id
    const removedTour = capturedPlaceId != null && isTourPlace(capturedPlaceId)
    const capturedOrderIndex = capturedAssignment?.order_index ?? 0
    // Worked out before the delete, while the day still has the stop the vias
    // were measured against. `after_order_index` is a POSITION, so taking a stop
    // away moves the ground under every via that follows it: the anchors keep
    // their old numbers and the drive silently reverts to the road the traveller
    // steered it off, or bends a leg they never chose. This control is reachable
    // from the place inspector in both modes, and it was the one mutating path
    // that never corrected them.
    const stopsBefore = roadtripStopsOf(dayId)
    const removedAt = stopsBefore.findIndex(a => a.id === assignmentId)
    const plan = removedAt === -1
      ? null
      : reanchorAfterRemove(roadtripVias.byDay[dayId] ?? [], removedAt, stopsBefore.length)
    try {
      await tripActions.removeAssignment(tripId, dayId, assignmentId)
      if (removedTour) await reloadTourPlaceIds()
      if (plan) await roadtripVias.reanchor(dayId, plan)
      updateRouteForDay(dayId)
      if (capturedPlaceId != null) {
        const capturedDayId = dayId
        const capturedPos = capturedOrderIndex
        pushUndo(t('undo.removeAssignment'), async () => {
          await tripActions.assignPlaceToDay(tripId, capturedDayId, capturedPlaceId, capturedPos)
          if (removedTour) await reloadTourPlaceIds()
        }, [capturedDayId], [capturedPlaceId])
      }
    }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.unknownError')) }
  }, [tripId, toast, updateRouteForDay, pushUndo, t, roadtripVias, roadtripStopsOf, reloadTourPlaceIds, isTourPlace])

  const handleReorder = useCallback((dayId: number, orderedIds: number[]) => {
    const assignmentsBefore = useTripStore.getState().assignments[String(dayId)] || []
    const prevIds = assignmentsBefore
      .slice().sort((a, b) => a.order_index - b.order_index).map(a => a.id)
    const placeIdsBefore = [...new Set(assignmentsBefore.map(a => a.place?.id).filter((id): id is number => id != null))]
    // The rail counts anchors over routable stops only, so the plan is built in
    // that space. A drag here hands a whole new ordering rather than one move,
    // and any permutation is possible — so the anchors follow the stop they were
    // pinned behind instead of being shifted arithmetically. Without this the
    // day's detours stayed on their old numbers and the drive quietly took a
    // different road, persisted and visible to every collaborator.
    const visible = new Set(orderedIds)
    let nextVisible = 0
    const completeOrder = prevIds.map(id => visible.has(id) ? orderedIds[nextVisible++] : id)
    const stopIdsBefore = roadtripStopsOf(dayId).map(a => a.id)
    const stopIdsAfter = completeOrder.filter(id => stopIdsBefore.includes(id))
    const plan = reanchorByStopOrder(roadtripVias.byDay[dayId] ?? [], stopIdsBefore, stopIdsAfter)
    try {
      tripActions.reorderAssignments(tripId, dayId, completeOrder)
        .then(async () => {
          if (plan.vias.length || plan.remove.length) await roadtripVias.reanchor(dayId, plan)
          const capturedDayId = dayId
          const capturedPrevIds = prevIds
          pushUndo(t('undo.reorder'), async () => {
            await tripActions.reorderAssignments(tripId, capturedDayId, capturedPrevIds)
          }, [capturedDayId], placeIdsBefore)
        })
        .catch(err => toast.error(err instanceof Error ? err.message : t('trip.toast.reorderError')))
      updateRouteForDay(dayId)
    }
    catch { toast.error(t('trip.toast.reorderError')) }
  }, [tripId, toast, pushUndo, updateRouteForDay, t, roadtripVias, roadtripStopsOf])

  const handleUpdateDayTitle = useCallback(async (dayId, title) => {
    try { await tripActions.updateDayTitle(tripId, dayId, title) }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.unknownError')) }
  }, [tripId, toast])

  const handleReorderDays = useCallback((orderedIds: number[]) => {
    const prevIds = (useTripStore.getState().days || [])
      .slice().sort((a, b) => (a.day_number ?? 0) - (b.day_number ?? 0)).map(d => d.id)
    tripActions.reorderDays(tripId, orderedIds)
      .then(() => {
        pushUndo(t('dayplan.reorderUndo'), async () => {
          // A day deleted since then drops out of the old order. When the list no
          // longer matches the days there are (one was added), the old order is
          // not one the server could take, so the undo steps aside.
          const live = new Set(useTripStore.getState().days.map(d => d.id))
          const restorable = prevIds.filter(id => live.has(id))
          if (restorable.length !== live.size) return
          await tripActions.reorderDays(tripId, restorable)
        })
      })
      .catch(err => toast.error(err instanceof Error ? err.message : t('dayplan.reorderError')))
  }, [tripId, toast, pushUndo])

  const { handleAddDay, dayAdd } = useDayAdd({
    tripId, trip, days, canEditDays: can('day_edit', trip), t, locale, toast,
  })

  // A deleted day can take a stay along, and the selected day's route may have
  // lost its day or its stops. Its panel closes, and undo steps that would act
  // on it are dropped rather than left to fail.
  const afterDayDeleted = useCallback((dayId: number) => {
    setShowDayDetail(open => (open?.id === dayId ? null : open))
    forgetDay(dayId)
    loadAccommodations()
    updateRouteForDay(useTripStore.getState().selectedDayId)
    void reloadTourPlaceIds()
  }, [loadAccommodations, updateRouteForDay, forgetDay, reloadTourPlaceIds])
  const dayDelete = useDayDelete({
    tripId, trip, days, places: allPlaces, reservations, accommodations: tripAccommodations,
    canEditDays: can('day_edit', trip), t, locale, toast, onDeleted: afterDayDeleted,
  })

  const dayClear = useDayClear({
    tripId, days, canEditDays: can('day_edit', trip), t, locale, toast, roadtripVias, updateRouteForDay, pushUndo,
    onToursChanged: reloadTourPlaceIds,
  })

  const handleSaveReservation = async (data: Record<string, string | number | null> & { title: string }) => {
    try {
      // Imported hotel with a reviewed address but no existing place picked: match
      // an existing place by name, else geocode the address and create one, then link it.
      const acc = (data as Record<string, any>).create_accommodation
      if (data.type === 'hotel' && acc && acc.venue && !acc.place_id) {
        acc.place_id = (await resolveImportedPlace(acc.venue)) ?? undefined
        delete acc.venue
      }
      // A hotel's address lives on the linked place. Write an edited address
      // through to it, otherwise the typed value was silently dropped and the
      // old one reappeared on the next open (#1496).
      if (data.type === 'hotel' && acc && typeof acc.address === 'string') {
        const address = acc.address.trim()
        const linkedPlace = acc.place_id ? places.find(p => p.id === Number(acc.place_id)) : undefined
        if (address && linkedPlace && (linkedPlace.address || '') !== address) {
          try { await tripActions.updatePlace(tripId, linkedPlace.id, { address }) }
          catch { /* keep saving the booking; the address still lands in location */ }
        }
        delete acc.address
      }
      if (editingReservation) {
        // Don't force a day here. The old code pinned it to the (often empty)
        // selected day, which dropped the booking out of the Plan; preserving the
        // old day_id instead left it stale when the date changed. Omitting it lets
        // the server derive the day from the booking's date, or keep the current
        // one when there is no date.
        const r = await tripActions.updateReservation(tripId, editingReservation.id, data)
        toast.success(t('trip.toast.reservationUpdated'))
        setShowReservationModal(false)
        setEditingReservation(null)
        if (data.type === 'hotel') {
          accommodationsApi.list(tripId).then(d => setTripAccommodations(d.accommodations || [])).catch(() => {})
        }
        return r
      } else {
        const r = await tripActions.addReservation(tripId, { ...data, day_id: selectedDayId || null })
        toast.success(t('trip.toast.reservationAdded'))
        setShowReservationModal(false)
        // An imported booking auto-creates a linked cost server-side; the saving client gets
        // no budget:created echo, so refresh the budget items here to surface it without a reload.
        if ((data as Record<string, unknown>).create_budget_entry) await tripActions.loadBudgetItems?.(tripId)
        // Refresh accommodations if hotel was created
        if (data.type === 'hotel') {
          accommodationsApi.list(tripId).then(d => setTripAccommodations(d.accommodations || [])).catch(() => {})
        }
        return r
      }
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.unknownError')) }
  }

  const handleSaveTransport = async (data: Record<string, any> & { title: string }) => {
    try {
      if (editingTransport) {
        const r = await tripActions.updateReservation(tripId, editingTransport.id, data)
        toast.success(t('trip.toast.reservationUpdated'))
        setShowTransportModal(false)
        setEditingTransport(null)
        setTransportModalDayId(null)
        return r
      } else {
        const r = await tripActions.addReservation(tripId, data)
        toast.success(t('trip.toast.reservationAdded'))
        setShowTransportModal(false)
        setEditingTransport(null)
        setTransportModalDayId(null)
        // Surface the auto-created linked cost without a reload (no budget:created echo to us).
        if (data.create_budget_entry) await tripActions.loadBudgetItems?.(tripId)
        return r
      }
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.unknownError')) }
  }

  const handleDeleteReservation = async (id) => {
    try {
      await tripActions.deleteReservation(tripId, id)
      toast.success(t('trip.toast.deleted'))
      // Refresh accommodations in case a hotel booking was deleted
      accommodationsApi.list(tripId).then(d => setTripAccommodations(d.accommodations || [])).catch(() => {})
    }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : t('common.unknownError')) }
  }

  // ── The plan's booking detail ───────────────────────────────────────────────
  // A click on a booking in the plan shows it first; the editor is one Edit away.
  const bookingDetail = bookingDetailOpen == null ? null : reservations.find(r => r.id === bookingDetailOpen.id) ?? null
  const openBookingDetail = (r: Reservation) => setBookingDetailOpen({ id: r.id, fromDayList: false })
  const openBookingFromDayList = (r: Reservation) => setBookingDetailOpen({ id: r.id, fromDayList: true })
  const closeBookingDetail = () => setBookingDetailOpen(null)
  // Edit opens the editor the click used to open straight away, under the same right:
  // day_edit for the transport editor, reservation_edit for the booking editor, and
  // from a row of the day list day_edit on top, as that row asked for it. Without
  // the right the detail has no Edit.
  const editReservation = (r: Reservation) => { setEditingReservation(r); setShowReservationModal(true) }
  const editorFor = (r: Reservation | null, fromDayList: boolean) => {
    if (!r) return undefined
    if (TRANSPORT_TYPES.has(r.type)) return can('day_edit', trip) ? openTransportEditor : undefined
    if (fromDayList && !can('day_edit', trip)) return undefined
    return can('reservation_edit', trip) ? editReservation : undefined
  }
  const bookingDetailEditor = editorFor(bookingDetail, !!bookingDetailOpen?.fromDayList)
  // A transit journey is searched again under the right its journey view asked for,
  // on the plan and on the Transports tab alike.
  const bookingDetailChangeRoute = can('day_edit', trip) ? changeTransitRoute : undefined
  // "On map", from the plan and from both booking tabs: the route switches on and its
  // day opens, or the place is selected.
  const showBookingOnMap = (r: Reservation) => showReservationOnMap(r, {
    visibleConnections, toggleConnection, selectDay: id => handleSelectDay(id), selectPlace: setSelectedPlaceId, openPlan: () => handleTabChange('plan'),
  })
  const isBookingOnMap = (r: Reservation) => visibleConnections.includes(r.id)

  // ── Review-before-save booking import ───────────────────────────────────────
  // Match an existing trip place by name, else geocode the reviewed address and
  // create one. Returns the place id (or null if even creation failed).
  const resolveImportedPlace = async (venue: { name?: string; address?: string | null }): Promise<number | null> => {
    const name = (venue.name || '').trim()
    const n = name.toLowerCase()
    if (n) {
      const existing = places.find(p => p.name?.trim().toLowerCase() === n)
        ?? places.find(p => p.name && (p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())))
      // Only a server-side id may be linked. A negative id is an offline temp id
      // (mutationQueue.nextTempId): the reservation write is online-only, the queue
      // rewrites temp ids in a URL but never inside another entity's body, and
      // day_accommodations.place_id carries a foreign key — so a temp id here is a
      // rolled-back insert and a 500 instead of a saved booking.
      if (existing && existing.id > 0) return existing.id
    }
    // Offline the booking itself cannot be written (reservations are online-only),
    // so minting a place here would only leave an orphan behind on the next flush
    // — and its temp id could never be linked anyway. Link nothing, and skip the
    // geocode round-trip too; the retry online matches this venue by name.
    if (isEffectivelyOffline()) return null
    let lat: number | null = null
    let lng: number | null = null
    let address: string | null = venue.address ?? null
    try {
      const query = venue.address ? `${name} ${venue.address}`.trim() : name
      if (query) {
        const res = await mapsApi.search(query)
        const hit = res?.places?.[0] as { lat?: number; lng?: number; address?: string } | undefined
        if (hit && hit.lat != null && hit.lng != null) {
          lat = hit.lat; lng = hit.lng
          if (!address && hit.address) address = hit.address
        }
      }
    } catch { /* geocode failure is non-fatal — create the place without coords */ }
    try {
      // Through the store, not placesApi directly: the API answers { place },
      // and reading .id off that wrapper linked nothing — every save of the
      // hotel then minted another orphan place, because the store never
      // learned about the previous one and the name match above could not
      // find it. addPlace unwraps the response and puts the place into
      // `places`, so the next save reuses it.
      const place = await tripActions.addPlace(tripId, { name: name || address || 'Accommodation', lat, lng, address })
      return place && place.id > 0 ? place.id : null
    } catch { return null }
  }

  // Open the right edit modal for a parsed item, pre-filled, in create mode.
  //
  // A type neither form can express belongs to whichever tab the user started from.
  // Handing an unreadable transport document to the booking form is what left them
  // with six chips, none of them a transport, and 'other' as the only honest pick
  // (#2076). A type either form DOES know always wins over the tab — one PDF
  // routinely holds a flight and a hotel.
  const openImportItem = (item: BookingImportPreviewItem) => {
    const draft = parsedItemToDraft(item)
    // Attach the file this item was parsed from so it lands in the booking's Files on save.
    const srcName = item.source?.fileName
    const srcFile = srcName ? importSourceFilesRef.current.find(f => f.name === srcName) : undefined
    if (srcFile) draft._sourceFiles = [srcFile]
    if (isTransportItem(item) || (isUnplaceableItem(item) && importKindRef.current === 'transports')) {
      setShowReservationModal(false); setEditingReservation(null); setReservationPrefill(null)
      setEditingTransport(null); setTransportModalDayId(null)
      setTransportPrefill(draft); setShowTransportModal(true)
    } else {
      setShowTransportModal(false); setEditingTransport(null); setTransportPrefill(null); setTransportModalDayId(null)
      setEditingReservation(null)
      setReservationPrefill(draft); setShowReservationModal(true)
    }
  }

  const startImportReview = (
    items: BookingImportPreviewItem[],
    sourceFiles: File[] = [],
    kind: 'transports' | 'bookings' = 'bookings',
  ) => {
    if (!items.length) return
    importSourceFilesRef.current = sourceFiles
    importKindRef.current = kind
    importQueueRef.current = items.slice(1)
    setImportReviewActive(true)
    openImportItem(items[0])
  }

  // Bridge: when a finished background import is sent here for review (the user hit
  // "review" in the background widget, on this or any page), open the per-item flow.
  // Lives in the hook so the page stays a pure wiring container.
  const bgTasks = useBackgroundTasksStore((s) => s.tasks)
  const dismissBgTask = useBackgroundTasksStore((s) => s.dismiss)
  const loadedTripId = trip?.id
  useEffect(() => {
    const task = bgTasks.find(
      (tk) => tk.tripId === String(tripId) && tk.status === 'done' && tk.reviewRequested && !tk.consumed,
    )
    if (task && task.kind === 'costs') {
      // A scanned receipt is reviewed in the expense editor, pre-filled with what
      // was read and with the photo waiting to be attached when it is saved. The
      // photo goes up through the trip's file upload, so it is only put there for
      // someone who may upload files: for anyone else it made the whole save fail,
      // expense included, over an attachment they never picked. Whether they may
      // is only known once this trip is loaded, so the review waits for it.
      if (loadedTripId !== tripId) return
      const receipt = task.receipt
      const jobId = task.id
      const inMemory = task.sourceFiles
      dismissBgTask(jobId)
      if (!receipt) return
      void (async () => {
        const files = inMemory && inMemory.length ? inMemory : await getImportFiles(jobId)
        void deleteImportFiles(jobId)
        setReceiptExpense(receiptToPrefill(receipt, canUploadFiles ? files : []))
      })()
    } else if (task && task.items && task.items.length > 0) {
      // Hand the items (and the source files, to attach to each booking) to the review flow
      // and clear the widget entry — once the user hit "review", the background card is done.
      const items = task.items
      const jobId = task.id
      const inMemory = task.sourceFiles
      const kind = task.kind === 'transports' ? 'transports' : 'bookings'
      dismissBgTask(jobId)
      // Prefer the in-memory files (immediate path); after a reload they live in IndexedDB.
      void (async () => {
        const files = inMemory && inMemory.length ? inMemory : await getImportFiles(jobId)
        void deleteImportFiles(jobId)
        startImportReview(items, files, kind)
      })()
    }
  }, [bgTasks, tripId, startImportReview, dismissBgTask, canUploadFiles, loadedTripId])

  // Called when a reviewed item's modal closes (saved or skipped): open the next,
  // or finish the review session and refresh accommodations.
  const advanceImportReview = () => {
    const queue = importQueueRef.current
    if (queue.length > 0) {
      importQueueRef.current = queue.slice(1)
      openImportItem(queue[0])
      return
    }
    importQueueRef.current = []
    setImportReviewActive(false)
    setShowReservationModal(false); setEditingReservation(null); setReservationPrefill(null)
    setShowTransportModal(false); setEditingTransport(null); setTransportPrefill(null); setTransportModalDayId(null)
    accommodationsApi.list(tripId).then(d => setTripAccommodations(d.accommodations || [])).catch(() => {})
    // Imported bookings auto-create their linked costs server-side, but the saving client
    // suppresses its own budget:created echo (X-Socket-Id) — so reload the budget items here
    // to surface those expenses without a manual page refresh.
    tripActions.loadBudgetItems?.(tripId)
  }

  const selectedPlace = selectedPlaceId ? places.find(p => p.id === selectedPlaceId) : null
  const selectedTour = toursEnabled && selectedPlaceId
    ? tours.find(tour => tour.place_id === selectedPlaceId) ?? null
    : null
  // The stops the inspector speaks for. A booked night at a day's edge stands on the
  // hotel's place without being a stop of the day, so it is left out: counted, the hotel's
  // own stop lost its stay and its day end to a second match.
  const selectedRoadtripStops = roadtripRoutes.days.flatMap(day => day.stops).filter(stop =>
    !stop.automaticNight && !stop.bookend && (selectedAssignmentId ? stop.assignmentId === selectedAssignmentId : stop.placeId === selectedPlaceId),
  )
  const endDayStop = selectedRoadtripStops.length === 1 ? selectedRoadtripStops[0] : undefined
  const roadtripEndDay = roadtripActive && dailyTimesActive && can('day_edit', trip) && endDayStop && endDayStop.assignmentId > 0
    ? { active: roadtripEndsDayAt(endDayStop), onToggle: () => setRoadtripEndDay(endDayStop) }
    : undefined
  const roadtripStay = roadtripActive && selectedPlace
    ? inspectorStay(roadtripRoutes.days, endDayStop, selectedPlace, can('place_edit', trip) ? editRoadtripStay : undefined)
    : undefined

  const mapTileUrl = useTileUrl(OFM_POSITRON)

  const fontStyle = { fontFamily: "var(--font-system)" }

  // Splash screen — show for initial load + a brief moment for photos to start loading
  const [splashDone, setSplashDone] = useState(false)
  useEffect(() => {
    if (!isLoading && trip) {
      const timer = setTimeout(() => setSplashDone(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [isLoading, trip])

  return {
    tripId, navigate, toast, t, language, locale, settings, placesPhotosEnabled,
    trip, days, places, assignments, storedAssignments, packingItems, todoItems, categories, reservations, budgetItems, files,
    selectedDayId, isLoading, tripActions, can, canUploadFiles,
    pushUndo, undo, canUndo, lastActionLabel, handleUndo,
    enabledAddons, collabFeatures, tripAccommodations, setTripAccommodations,
    roadtripMode, toggleRoadtripMode, roadtripActive, roadtripFeedActive, roadtripRoutes, roadtripLineColors, roadtripMapLines, roadtripMapPlaces, collapsedRoadtripDays, toggleRoadtripDay, roadtripCorridor,
    overviewShown, toggleOverview, overviewActive, tripOverview,
    dawarichTrailShown, toggleDawarichTrail, dawarichTrail, dawarichHiddenDates, dawarichEnabled: !!enabledAddons.dawarich,
    followTrack, roadtripViaCounts,
    allowedFileTypes, tripMembers, setTripMembers, refreshMembers, loadAccommodations,
    TRANSPORT_TYPES, TRIP_TABS, activeTab, setActiveTab, handleTabChange,
    leftWidth, rightWidth, leftCollapsed, rightCollapsed, setLeftCollapsed, setRightCollapsed,
    leftHidden, rightHidden, toggleLeft, toggleRight, narrowPanels,
    startResizeLeft, startResizeRight, nudgeLeft, nudgeRight, resizeMin, resizeMax,
    selectedPlaceId, selectedAssignmentId, setSelectedPlaceId, selectAssignment,
    toursEnabled, toursMode, setToursMode, tours, toursLoading, tourDataReady, tourPlaceIds,
    reloadTourPlaceIds, invalidateTourPlaceIds, upsertTour, selectedTour,
    showDayDetail, setShowDayDetail, dayDetailCollapsed, setDayDetailCollapsed,
    stayPickerDayId, setStayPickerDayId,
    showPlaceForm, setShowPlaceForm, editingPlace, setEditingPlace,
    prefillCoords, setPrefillCoords, editingAssignmentId, setEditingAssignmentId,
    placeFormDayId, setPlaceFormDayId, reservationModalDayId, setReservationModalDayId,
    stopDraft, setStopDraft, saveStopDraft, saveStopDraftAsNight, stopDraftToForm, stopDraftDuplicate, reorderRoadtripStop,
    stayRelease, setStayRelease, confirmStayRelease,
    setRoadtripStopKind,
    setRoadtripStopFill,
    roadtripEndsDayAt,
    roadtripSettingsLoading: !roadtripPreferencesState.ready && !roadtripPreferencesState.failed,
    saveRoadtripLimit: roadtripPreferencesState.ready && can('day_edit', trip) ? saveRoadtripLimit : undefined,
    roadtripVias, addRoadtripVia, moveRoadtripVia, removeRoadtripVia, dayBoundaryControls, resetDayBoundaries,
    manualStopTargetFor, openManualRoadtripStop, serviceStopMode, setServiceStopForm,
    refuel, askRefuel, acceptRefuel,
    routeAlternatives, askRouteAlternatives, chooseRouteAlternative, alternativeOverlays, alternativeFocusPoints, mapFocusPoints, roadtripMapVias, focusRoadtripPoint,
    stayDraft, setStayDraft, editRoadtripStay, setRoadtripStay, roadtripEndDay, roadtripStay,
    // Addressed by stop rather than by selection: the phone's stage sheet knows which
    // stop it is showing, and going through the place selection there would open the
    // permanently mounted place inspector underneath it.
    setRoadtripEndDay, dailyTimesActive,
    highlightedAlternative, setHighlightedAlternative,
    moveRoadtripStopToDay,
    dropPoiOnRoute,
    showTripForm, setShowTripForm, showMembersModal, setShowMembersModal,
    showReservationModal, setShowReservationModal, editingReservation, setEditingReservation,
    showBookingImport, setShowBookingImport, bookingImportKind, setBookingImportKind, bookingImportAvailable,
    airTrailAvailable, showAirTrailImport, setShowAirTrailImport,
    bookingForAssignmentId, setBookingForAssignmentId,
    showTransportModal, setShowTransportModal, editingTransport, setEditingTransport,
    transportModalDayId, setTransportModalDayId,
    transportModalAutomated, setTransportModalAutomated, transitPrefill, setTransitPrefill, transitJourney, setTransitJourney,
    openTransportEditor, changeTransitRoute,
    bookingDetail, openBookingDetail, openBookingFromDayList, closeBookingDetail, bookingDetailEditor, bookingDetailChangeRoute, showBookingOnMap, isBookingOnMap,
    reservationPrefill, transportPrefill, importReviewActive, startImportReview, advanceImportReview,
    receiptExpense, clearReceiptExpense: () => setReceiptExpense(null),
    mapLocked, toggleMapLocked,
    routeShown, setRouteShown, autoShowRoute, transitRoutesShown, routeProfile, setRouteProfile, routeVias, fitKey, setFitKey,
    mobileSidebarOpen, setMobileSidebarOpen, mobilePlanScrollTopRef, mobilePlacesScrollTopRef,
    deletePlaceId, setDeletePlaceId, deletePlaceIds, setDeletePlaceIds, deletePlaceNote, deletePlacesNote,
    isTourPlace, deletePlaceIsTour, deletePlacesIncludeTours,
    visibleConnections, roadtripConnections, toggleConnection, allConnectionsShown, toggleAllConnections, mapTransportDetail, setMapTransportDetail,
    isMobile, isTouch,
    expandedDayIds, setExpandedDayIds, mapPlaces,
    route, routeWalking, routeSegments, routeInfo, setRoute, setRouteInfo, updateRouteForDay,
    handleSelectDay, handlePlaceClick, handleMarkerClick, handleMapClick, handleMapContextMenu, openAddPlaceFromPoi, handlePoiClick,
    handleSavePlace, openPlaceEditor, handleDeletePlace, confirmDeletePlace, confirmDeletePlaces, confirmChangeCategory,
    handleDeleteTour,
    handleAssignToDay, handleMoveToDay, handleRemoveAssignment, handleReorder, handleReorderDays, handleAddDay, dayAdd, handleUpdateDayTitle,
    ...dayDelete,
    ...dayClear,
    handleSaveReservation, handleSaveTransport, handleDeleteReservation,
    selectedPlace, dayOrderMap, dayPlaces,
    mapTileUrl, fontStyle, splashDone,
  }
}
