import ChargingInfo from './ChargingInfo'
import { useRoadtripSettings } from '../../hooks/useRoadtripSettings'
import { useElementSize } from '../../hooks/useElementSize'
import React, { useMemo, useState } from 'react'
import {
  Zap, AlertTriangle,
  ParkingSquare, Spline, Ban,
} from 'lucide-react'
import type { RefuelSearch } from './useRefuelSearch'
import type { RefuelCandidate } from './refuelSuggestion'
import type { DryPoint } from './roadtripModel'
import { useTranslation } from '../../i18n/TranslationContext'
import { Tooltip } from '../shared/Tooltip'
import { useSettingsStore } from '../../store/settingsStore'
import { formatDistance } from '../../utils/units'
import { formatDate } from '../../utils/formatters'
import { formatDurationShort, isServiceStopType, serviceColor, type ScheduleEntry, type ScheduleWarning, refuelsRange } from './roadtripModel'
import { STOP_KIND_BY_KEY } from './stopKinds'
import { arrivingReroutable, bookendReading, destinationCount, legReroutable, movableWithin, resumeFoldsIntoBookend } from './roadtripRowModel'
import { bookendBooking } from './nightBookend'
import { spurWorthLabelling } from './accessSpur'
import StopKindPicker from './StopKindPicker'
import StopFillPicker from './StopFillPicker'
import { useVehicleRange } from './useVehicleRange'
import { MAX_TRIP_DAYS, type RoadtripStopType } from '@trek/shared'
import { isStoredStop, undatedRides } from '@trek/shared/roadtrip'
import type { QuietDay, RoadtripDay, RoadtripRoutes, RoadtripStop } from './useRoadtripRoutes'
import type { SpillMark } from './nightSpill'
import { ARRIVING_DRIVE, openOn, type LegAlternatives, type RailDrive } from './useRouteAlternatives'
import { dayColor } from './dayColors'
import type { RouteVia } from '../../types'
import { FS } from './typeScale'
import EmptyState from '../shared/EmptyState'
import AutomaticDayStop from './AutomaticDayStop'
import { missedRide } from './carrierRide'
import { dayBookings } from './stopBookings'
import type { Reservation } from '../../types'
import type { StayDraft } from './RoadtripStayModal'
import { missedLeaveOf, readStay, stayDraftOf } from './stayReading'
import { DAY_BADGE, DISC, RAIL_DASH, RAIL_GRID, STAT_LABEL } from './RoadtripSidebar.constants'
import { Arrival, DriveFindingBadge, FillBadge, LateBadge, NightCheckIn, OffRoadBadge, StayBadge } from './RoadtripSidebarBadges'
import { RefuelBand } from './RoadtripSidebarRefuelBand'
import { DriveBand, SpillBlock } from './RoadtripSidebarDriveBands'
import { BookendStop, BookingChips, RideBlock, TerminalStop, UndatedRides } from './RoadtripSidebarBookingRows'

interface RoadtripSidebarProps {
  onFocusPoint?: (lat: number, lng: number) => void
  /** Legs and totals for the whole trip, computed once in the planner hook. */
  routes: RoadtripRoutes
  selectedAssignmentId?: number | null
  /**
   * Selects a stop, which opens its place in the inspector. Without an assignment it is
   * the place alone: a booked night at a day's edge is the stay's place, no stop.
   */
  onSelectStop?: (placeId: number, assignmentId?: number) => void
  /**
   * Moves a stop within its day. Absent means the chain is read-only, which is also how
   * a viewer sees it — no handles, no drop targets.
   */
  onReorderStop?: (dayId: number, assignmentId: number, toIndex: number) => void
  /** Moves a stop onto a different day. Absent means moves stay inside their own day. */
  onMoveStopToDay?: (fromDayId: number, assignmentId: number, toDayId: number, toIndex: number) => void
  /** Asks for other ways of driving one drive on a card (#1797). */
  onAskAlternatives?: (dayId: number, drive: RailDrive) => void
  /**
   * The one-shot search for somewhere to fill up before the tank runs out.
   *
   * Absent leaves the range findings as they were, a warning and nothing else — which is
   * also what a viewer sees, since accepting one writes a stop.
   */
  refuel?: RefuelSearch
  onAskRefuel?: (dayId: number, dry: DryPoint & { lat: number; lng: number }) => void
  onAcceptRefuel?: (dayId: number, poi: RefuelCandidate, dry: DryPoint & { lat: number; lng: number }) => void
  /** Which drive's alternatives are on show, so the rail can mark it. */
  openAlternatives?: Pick<LegAlternatives, 'dayId' | 'drive'> | null
  /**
   * Opens the dialog for how long a stop takes. Absent leaves every stay read-only —
   * which is also what a viewer sees.
   */
  onEditStay?: (stop: StayDraft) => void
  /**
   * Turns a stop into a pause on the drive, or back into a destination.
   *
   * Absent leaves every disc read-only, which is also what a viewer sees.
   */
  onSetStopKind?: (placeId: number, kind: RoadtripStopType | null) => Promise<void> | void
  /**
   * How full one stop fills the tank, 1-100, or null to follow the traveller's own
   * setting. Absent leaves the badge readable but not editable.
   */
  onSetStopFill?: (placeId: number, percent: number | null) => Promise<void> | void
  /**
   * Opens the dialog that makes a day follow an imported track (#1797).
   *
   * Absent leaves the rail read-only on that count, which is also what a viewer sees.
   */
  onFollowTrack?: (dayId: number) => void
  /**
   * How many vias each day carries, so a day whose shape was chosen by hand says so.
   *
   * A count rather than the points: the rail draws none of them — they are the router's
   * business — but "this drive is not the one the router would have picked" is exactly
   * what somebody reading the day needs to know.
   */
  viaCounts?: Record<number, number>
  /** The name of the track each day follows, so the badge can say which road it is. */
  trackNames?: Record<number, string>
  /**
   * Days folded down to their header, by id.
   *
   * A long trip is a long rail, and reading the shape of one day means scrolling past the
   * four before it. Folding is also what takes that day OFF the map: a card with nothing
   * under its header would otherwise still be drawing its road.
   */
  collapsedDayIds?: Set<number>
  /** Absent leaves every card open and its header unclickable. */
  onToggleDay?: (dayId: number) => void
  /**
   * The trip's bookings, for the rail to hang under the stops they are for (#2428).
   * Absent draws the chain without them.
   */
  reservations?: Reservation[]
  /**
   * Opens a booking: the ride a terminal stands for, the hire car a desk belongs to,
   * the table or the tickets under a stop. Absent leaves them all as plain text.
   */
  onOpenBooking?: (reservationId: number) => void
  /**
   * Whether the reader may open a table's or a ticket's editor. A transport has a detail
   * view anybody may look at; the other chips have only their editor, and without the
   * right to it they stay plain rather than being a button that does nothing (#2012).
   */
  canEditBookings?: boolean
}

// Icon and name both come from the one stop-kind table now. This file used to keep its
// own copy of each, and its rest_area icon had drifted away from the popup's.


/**
 * Below this width the rail stops counting stops: the trip head drops its third figure and
 * the day headers their count, rather than squeezing every badge onto a line too short.
 */
const RAIL_NARROW_PX = 330

/**
 * What a stop will actually fill to: its own figure, else the traveller's default.
 *
 * Null means nothing worth saying — no per-stop figure and a default that fills right up,
 * which is what the budget did before any of this existed. An explicit 100 on the stop is
 * NOT null: on a trip whose default is 80 %, "this one goes right up" is a decision, and
 * hiding it would leave the traveller reading 80 on a stop that fills to 100.
 */
function effectiveFill(own: number | null | undefined, setting: number | undefined): number | null {
  if (own !== null && own !== undefined) return own
  return setting && setting > 0 && setting < 100 ? setting : null
}

/** The quiet half of a measurement — the unit, and anything after the decimal point. */
function Unit({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span className="font-medium text-content-muted" style={{ fontSize: FS.totalUnit }}>{children}</span>
}

/**
 * Sets the whole numbers of a measurement apart from everything else in it.
 *
 * "691.6 km" reads as six-hundred-and-ninety-one, roughly; "9 h 4 min" as nine and four.
 * Those are the digits worth the size, and the decimal tail belongs with the unit rather
 * than with them. Purely presentational and deliberately forgiving: a bare count comes
 * back as one big number, and a language that puts its unit first still splits correctly
 * because the split is driven by the digits, not by position.
 */
function splitValue(value: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /(\d+)([.,]\d+)?/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) parts.push(<Unit key={key++}>{value.slice(last, m.index)}</Unit>)
    parts.push(<React.Fragment key={key++}>{m[1]}</React.Fragment>)
    if (m[2]) parts.push(<Unit key={key++}>{m[2]}</Unit>)
    last = m.index + m[0].length
  }
  if (last < value.length) parts.push(<Unit key={key}>{value.slice(last)}</Unit>)
  return parts.length ? parts : value
}

/**
 * Distance, driving time and stops for the whole trip — the head the left column never
 * had, above the day cards and reading as one card with them.
 *
 * Three equal centred columns with hairlines between them, rather than three labelled
 * rows: the labels are the quiet part and the numbers are what the head exists for, so
 * the numbers get the size and the labels get the letter-spacing.
 *
 * Pulled narrow, the stops go first, with their hairline: they are the figure the rail
 * itself shows best, one row per stop, while distance and time are only summed up here.
 */
function TripSummary({ routes, narrow }: { routes: RoadtripRoutes; narrow: boolean }): React.ReactElement {
  const { t } = useTranslation()
  const distanceUnit = useSettingsStore(s => s.settings.distance_unit)
  const cells: [string, string][] = [
    // `totalStops` already leaves the service stops out, so the head and the day badges
    // below count the same thing without either of them recounting the other's stops.
    [t('roadtrip.summary.distance'), formatDistance(routes.totalDistance / 1000, distanceUnit)],
    [t('roadtrip.summary.driving'), formatDurationShort(routes.totalDuration)],
    ...(narrow ? [] : [[t('roadtrip.summary.stops'), String(routes.totalStops)] as [string, string]]),
  ]
  return (
    <header className="mx-3.5 rounded-2xl border border-edge-faint bg-surface-card px-3 pb-3 pt-3.5">
      <div className="flex items-center justify-between text-center">
        {cells.map(([label, value], i) => (
          <React.Fragment key={label}>
            {i > 0 ? <span className="h-[28px] w-px shrink-0 bg-edge-faint" aria-hidden /> : null}
            <div className="flex flex-1 flex-col items-center gap-1.5 px-1">
              <span className={STAT_LABEL} style={{ fontSize: FS.label }}>{label}</span>
              <span
                className="font-semibold leading-none tracking-[-0.03em] tabular-nums text-content"
                style={{ fontSize: FS.total }}
              >
                {splitValue(value)}
              </span>
            </div>
          </React.Fragment>
        ))}
      </div>
      {/* Legs land one request at a time, so until the last is in, every number above is
          a partial sum. A total that looks final and is not is worse than a slow one. */}
      {routes.loading ? (
        <p className="mt-2 break-words text-center text-content-faint" style={{ fontSize: FS.meta }}>
          {t('roadtrip.summary.partial')}
        </p>
      ) : null}
    </header>
  )
}

/**
 * A charger, a filling station or a rest stop — a stop that interrupts the drive.
 *
 * It sits inside the leg with the dashed line running through it, carries no number and
 * is left out of every count, because that is the difference between it and the places
 * the trip is actually for. Its own icon on one flat disc: three kinds of pause that all
 * mean "we are still driving", and the icon is what tells them apart.
 */
function ServiceStop({ stop, entry, late, driveFindings, selected, onSelect, onEditStay, onPickKind, onPickFill }: {
  stop: RoadtripStop
  entry: ScheduleEntry | undefined
  /** How late the drive reaches a time pinned on this pause, or the time it was set to
   *  be left at: the same findings a numbered stop shows. A fuel or charging halt can
   *  carry a pinned time like anything else. */
  late: ScheduleWarning[]
  /** Findings about the drive that ARRIVES here. A charging halt is a stop like any other
   *  as far as the tank is concerned, so it carries them the same way a numbered one does. */
  driveFindings?: ScheduleWarning[]
  /** Opens the kind picker on the disc. Absent leaves the rail read-only. */
  onPickKind?: (anchor: HTMLElement) => void
  /** Opens the panel that sets how full THIS stop fills, hung under the badge. */
  onPickFill?: (anchor: HTMLElement) => void
  selected: boolean
  onSelect?: () => void
  /** Opens the dialog for how long this pause takes. Absent means the rail is read-only. */
  onEditStay?: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  // Read here rather than threaded down: both stop shapes need the same two, and the
  // badge is the only thing in the rail that depends on them.
  const fillPercent = useRoadtripSettings(s => s.roadtrip_fill_percent)
  const { vehicleKind } = useVehicleRange()
  const kind = STOP_KIND_BY_KEY[stop.stopType ?? '']
  const Icon = kind?.Icon ?? ParkingSquare
  const label = t(kind?.labelKey ?? 'roadtrip.poi.rest')
  return (
    <div className="grid items-stretch" style={RAIL_GRID}>
      <span className="relative z-[1] flex flex-col items-center">
        <span className="flex-1" style={RAIL_DASH} aria-hidden />
        {onPickKind ? (
          // The same control the other way round: the disc says what this is, and it is
          // also where it stops being that.
          <Tooltip label={t('roadtrip.stop.changeKind')}>
            <span
              role="button"
              tabIndex={0}
              aria-label={t('roadtrip.stop.changeKind')}
              onClick={e => { e.stopPropagation(); onPickKind(e.currentTarget as HTMLElement) }}
              onKeyDown={e => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                e.stopPropagation()
                onPickKind(e.currentTarget as HTMLElement)
              }}
              className={`${DISC} cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2`}
              // theme-lint-disable — the road-signage palette in `roadtripModel`, shared
              // with the corridor list and the map pin so one kind of stop looks like
              // itself wherever it turns up.
              style={{ background: serviceColor(stop.stopType), color: '#fff' }} // theme-lint-disable — road-signage palette
            >
              <Icon size={12} strokeWidth={2.1} aria-hidden />
            </span>
          </Tooltip>
        ) : (
          <span
            className={DISC}
            // theme-lint-disable — same palette, read-only.
            style={{ background: serviceColor(stop.stopType), color: '#fff' }} // theme-lint-disable — road-signage palette
          >
            <Icon size={12} strokeWidth={2.1} aria-label={label} />
          </span>
        )}
        <span className="flex-1" style={RAIL_DASH} aria-hidden />
      </span>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        // The same inset as a numbered stop's content, so the two kinds of name start on
        // one vertical line instead of the service one sitting a few pixels nearer the rail.
        className={`flex min-w-0 items-start gap-2 rounded-lg px-1.5 pb-1 pt-0.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
          selected ? 'bg-surface-selected' : 'hover:bg-surface-hover'
        }`}
      >
        {/* Laid out exactly like a numbered stop: how long the pause takes is a stay like
            any other and sits under the name, and the right edge stays the arrival column
            all the way down the rail. Only the disc says this one is a pause. */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Truncated, not wrapped: a service stop is a waypoint, and its full name lives
              on the map pin — where a place's name is the row's whole reason to exist. */}
          <span
            className="flex min-w-0 items-center gap-2 font-semibold leading-6 tracking-[-0.012em] text-content-secondary"
            style={{ fontSize: FS.name }}
          >
            <span className="min-w-0 truncate">{stop.name}</span>{stop.stopType === 'charging' && <ChargingInfo placeId={stop.placeId} compact />}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <NightCheckIn stop={stop} />
            <StayBadge stay={readStay(stop, entry)} onEdit={onEditStay} />
            {refuelsRange(stop.stopType, vehicleKind) ? (
              <FillBadge
                percent={effectiveFill(stop.fillPercent, fillPercent)}
                own={stop.fillPercent !== null && stop.fillPercent !== undefined}
                onEdit={onPickFill}
              />
            ) : null}
            {spurWorthLabelling(stop.offRoadMeters) ? <OffRoadBadge meters={stop.offRoadMeters ?? 0} /> : null}
            {(driveFindings ?? []).map(w => <DriveFindingBadge key={w.code} warning={w} />)}
            {late.map(w => <LateBadge key={w.code} late={w} />)}
          </span>
        </span>
        {entry?.arrival ? <Arrival entry={entry} /> : null}
      </button>
    </div>
  )
}

/**
 * A halt a routing plugin put on this leg, such as a charge on the way.
 *
 * Read-only, and that is the point rather than a shortcut. The halt belongs to the
 * provider, not to the traveller: it is not a place in the database, it has no number, no
 * editable stay and no arrival time. Writing it back would send it out as a waypoint on
 * the next run, and the plugin would then plan around its own charging stop.
 *
 * No clock on purpose. The stay is already inside the leg duration the plugin reported,
 * so the arrivals in the rail already account for it; printing a time here would mean
 * guessing how the plugin split the driving, and driving time is not linear in distance.
 */
function RouteViaStop({ via }: { via: RouteVia }): React.ReactElement {
  const { t } = useTranslation()
  return (
    <div className="grid items-stretch" style={RAIL_GRID}>
      <span className="relative z-[1] flex flex-col items-center">
        <span className="flex-1" style={RAIL_DASH} aria-hidden />
        {/* Hollow rather than filled: everything filled on this rail is something the
            traveller put there. */}
        <span
          className={`${DISC} border-2 border-dashed border-edge bg-surface text-content-faint`}
        >
          <Zap size={11} strokeWidth={2.1} aria-hidden />
        </span>
        <span className="flex-1" style={RAIL_DASH} aria-hidden />
      </span>
      <span className="flex min-w-0 items-start gap-2 px-1.5 pb-1 pt-0.5">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className="min-w-0 truncate leading-6 text-content-secondary"
            style={{ fontSize: FS.name }}
          >
            {via.label || t('roadtrip.via.plugin')}
          </span>
          {via.dwellSeconds != null ? (
            <span className="w-fit text-content-faint" style={{ fontSize: FS.label }}>
              {formatDurationShort(via.dwellSeconds)}
            </span>
          ) : null}
        </span>
      </span>
    </div>
  )
}

function Stop({ stop, number, entry, late, driveFindings, selected, continues, starts, onSelect, onMove, canMove, onEditStay, onPickKind, onPickFill }: {
  stop: RoadtripStop
  /** Position within the day — the same count the map badges its markers with. */
  number: number
  entry: ScheduleEntry | undefined
  /** Arriving after a pinned time, or after the time this stop was set to be left at. */
  late: ScheduleWarning[]
  /** Findings about the drive LEAVING this stop, when the limits are set and it goes over. */
  driveFindings?: ScheduleWarning[]
  selected: boolean
  /** Whether the chain goes on below, so the marker keeps hold of the line. */
  continues: boolean
  /** First row of the day: no line above it, because the chain starts here. */
  starts?: boolean
  /** Opens the kind picker on the number. Absent leaves the rail read-only. */
  onPickKind?: (anchor: HTMLElement) => void
  /** Opens the panel that sets how full THIS stop fills, hung under the badge. */
  onPickFill?: (anchor: HTMLElement) => void
  onSelect?: () => void
  /** Moves this stop by one place. Absent means the chain is read-only. */
  onMove?: (delta: number) => void
  /** Whether there is anywhere to move in each direction, so the ends say so. */
  canMove?: { up: boolean; down: boolean }
  /** Opens the dialog for how long this stop takes. Absent means the rail is read-only. */
  onEditStay?: () => void
}): React.ReactElement {
  const { t } = useTranslation()
  // Read here rather than threaded down: both stop shapes need the same two, and the
  // badge is the only thing in the rail that depends on them.
  const fillPercent = useRoadtripSettings(s => s.roadtrip_fill_percent)
  const { vehicleKind } = useVehicleRange()
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      // Alt plus an arrow moves the stop. Dragging is the obvious gesture but it is only
      // a gesture: without this the chain could not be reordered from a keyboard at all,
      // and the row is already a button, so it is focusable anyway.
      onKeyDown={onMove ? e => {
        if (!e.altKey) return
        if (e.key === 'ArrowUp' && canMove?.up) { e.preventDefault(); onMove(-1) }
        if (e.key === 'ArrowDown' && canMove?.down) { e.preventDefault(); onMove(1) }
      } : undefined}
      className="group grid w-full rounded-lg text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      style={RAIL_GRID}
    >
      {/* The marker sits level with the middle of the row rather than at its top, the
          way the corridor list already places its own badges: a number pinned to the
          first line drifts away from the row as soon as a stop carries a stay and a walk
          under its name. The line grows above and below it, so the chain still runs
          unbroken from stop to stop. */}
      <span className="flex flex-col items-center">
        {starts ? null : <span className="w-[1.5px] flex-1 rounded-sm bg-edge" aria-hidden />}
        {onPickKind ? (
          // The number is the control, because the number is what changes: a service stop
          // has none. Clicking the 3 and picking the pump turns the 3 into an orange disc
          // and renumbers everything below it.
          <Tooltip label={t('roadtrip.stop.makeService')}>
            <span
              role="button"
              tabIndex={0}
              aria-label={t('roadtrip.stop.makeService')}
              onClick={e => { e.stopPropagation(); onPickKind(e.currentTarget as HTMLElement) }}
              onKeyDown={e => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                e.stopPropagation()
                onPickKind(e.currentTarget as HTMLElement)
              }}
              className={`${DISC} my-1 cursor-pointer bg-surface-tertiary font-geist font-semibold tabular-nums text-content-secondary transition-colors hover:bg-accent hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
              style={{ fontSize: FS.marker }}
            >
              {number}
            </span>
          </Tooltip>
        ) : (
          <span
            className={`${DISC} my-1 bg-surface-tertiary font-geist font-semibold tabular-nums text-content-secondary`}
            style={{ fontSize: FS.marker }}
          >
            {number}
          </span>
        )}
        {continues ? <span className="w-[1.5px] flex-1 rounded-sm bg-edge" aria-hidden /> : null}
      </span>

      {/* The fill stops at the rail: the number is part of the chain, not part of the row
          you picked, and tinting it made the marker look selected too. */}
      <span
        className={`flex min-w-0 items-start gap-2 rounded-lg px-1.5 pb-1 pt-0.5 transition-colors ${
          selected ? 'bg-surface-selected' : 'group-hover:bg-surface-hover'
        }`}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Wraps rather than truncates: the name is what the row is for, and thirty of
              them cut off mid-word is a list nobody reads. */}
          <span
            className="flex min-w-0 items-center gap-2 font-semibold leading-6 tracking-[-0.012em] text-content"
            style={{ fontSize: FS.name }}
          >
            <span className={stop.stopType === 'charging' ? 'min-w-0 truncate' : 'min-w-0 break-words'}>{stop.name}</span>{stop.stopType === 'charging' && <ChargingInfo placeId={stop.placeId} compact />}
          </span>
          {/* Two halves under one border: the word says what the number means, so the
              number needs no unit of explanation beside it. */}
          {/* One row, wrapping: the stay and the walk from the road are both answers to
              "what does this stop cost", and the second only appears when the gap is far
              enough to change the plan. The dashed line on the map already says there is
              one; the number is for luggage, a gate, a track a hire car should not be on. */}
          <span className="flex flex-wrap items-center gap-1">
            <NightCheckIn stop={stop} />
            <StayBadge stay={readStay(stop, entry)} onEdit={onEditStay} />
            {refuelsRange(stop.stopType, vehicleKind) ? (
              <FillBadge
                percent={effectiveFill(stop.fillPercent, fillPercent)}
                own={stop.fillPercent !== null && stop.fillPercent !== undefined}
                onEdit={onPickFill}
              />
            ) : null}
            {spurWorthLabelling(stop.offRoadMeters) ? <OffRoadBadge meters={stop.offRoadMeters ?? 0} /> : null}
            {(driveFindings ?? []).map(w => <DriveFindingBadge key={w.code} warning={w} />)}
            {late.map(w => <LateBadge key={w.code} late={w} />)}
          </span>
        </span>
        {entry?.arrival ? <Arrival entry={entry} /> : null}
      </span>
    </button>
  )
}

/**
 * One day, one card: its own numbers in its own head, its stops chained below.
 *
 * Stops count from one inside the day because that is what the map badges on its markers
 * (`dayOrderMap` numbers the selected day's assignments from 1). A rail counting across
 * the trip would put "17" beside a pin the map calls "3".
 *
 * A card is no longer one stored day. It is one DATE, and it draws whatever is reached on
 * it — which on the morning after a night drive means a stretch that is stored on
 * yesterday. Every stop keeps the day it is stored on in `block.source`, so a reorder, a
 * move, a stay edit or a refuel offer still names the day the server knows it by. See
 * `nightSpill.ts`.
 */
function DaySection({ day, selectedAssignmentId, onSelectStop, onOpenBooking, canEditBookings, reservations, dayOrder, onReorderStop, onMoveStopToDay, drag, onAskAlternatives, openAlternatives, onEditStay, onSetStopKind, onSetStopFill, onFollowTrack, viaCount, trackName, refuel, onAskRefuel, onAcceptRefuel, loading, collapsed, onToggle, onFocusPoint, narrow }: {
  onFocusPoint?: RoadtripSidebarProps['onFocusPoint']
  /** The rail is pulled too narrow for every badge; the stop count gives way. */
  narrow?: boolean
  day: RoadtripDay
  /** Folded down to the header, and off the map with it. */
  collapsed?: boolean
  onToggle?: () => void
  selectedAssignmentId?: number | null
  onSelectStop?: RoadtripSidebarProps['onSelectStop']
  onReorderStop?: (dayId: number, assignmentId: number, toIndex: number) => void
  onMoveStopToDay?: RoadtripSidebarProps['onMoveStopToDay']
  /** What is being dragged right now, shared across days so a stop can leave its own. */
  drag: DragState
  onAskAlternatives?: RoadtripSidebarProps['onAskAlternatives']
  openAlternatives?: RoadtripSidebarProps['openAlternatives']
  onOpenBooking?: RoadtripSidebarProps['onOpenBooking']
  canEditBookings?: boolean
  reservations?: Reservation[]
  /** A day's place in the trip by its id, so a booking spanning days is seen on the days between. */
  dayOrder?: (dayId: number) => number | null
  onEditStay?: RoadtripSidebarProps['onEditStay']
  onSetStopKind?: RoadtripSidebarProps['onSetStopKind']
  onSetStopFill?: RoadtripSidebarProps['onSetStopFill']
  onFollowTrack?: RoadtripSidebarProps['onFollowTrack']
  viaCount?: number
  trackName?: string
  refuel?: RefuelSearch
  onAskRefuel?: RoadtripSidebarProps['onAskRefuel']
  onAcceptRefuel?: RoadtripSidebarProps['onAcceptRefuel']
  /** True while any day is still routing; the range findings are not settled until then. */
  loading?: boolean
}): React.ReactElement {
  const { from, setFrom, dropAt, setDropAt } = drag
  // Which disc the picker hangs under, and for which stop. One at a time: two open
  // popovers over the same rail is two answers to one question.
  const [picking, setPicking] = useState<{ anchor: HTMLElement; stop: RoadtripStop } | null>(null)
  const bookings = useMemo(() => dayBookings(day, reservations ?? [], dayOrder), [day, reservations, dayOrder])
  const [filling, setFilling] = useState<{ anchor: HTMLElement; stop: RoadtripStop } | null>(null)
  const { t, language } = useTranslation()
  const distanceUnit = useSettingsStore(s => s.settings.distance_unit)
  const is12h = useSettingsStore(s => s.settings.time_format) === '12h'
  // A ride the drive gets to too late is said in the header too, where a folded day still shows it.
  const missed = missedRide(day, t, is12h)
  // The colour the map draws this day in, or none at all while the map is drawing one
  // blue line for the whole trip.
  const dayColorsOn = useRoadtripSettings(s => !!s.roadtrip_day_colors)
  const tint = dayColorsOn ? dayColor(day.dayNumber).line : null
  const last = day.stops.length - 1
  const findingsFor = (i: number) =>
    day.driveWarnings.filter(w => w.index === i && w.code !== 'range')
  // The running number a stop wears, with the service stops passed over — so a day with a
  // charger halfway through still counts one, two, three the way its map pins do.
  let counted = 0
  // A day of nothing but its hotels, the drive from one stay to the next. The hotels make it
  // a day, so it is no quiet row a stop can be dropped on, and it has no stored stop to drop
  // onto either: its hotel rows take the drop instead, as the day's first stop.
  const dropOnHotels: React.LiHTMLAttributes<HTMLLIElement> = onMoveStopToDay && from && !day.stops.some(isStoredStop)
    ? {
        onDragOver: e => {
          e.preventDefault()
          if (dropAt?.dayId !== day.dayId || dropAt.index !== -1) setDropAt({ dayId: day.dayId, index: -1 })
        },
        onDrop: e => {
          e.preventDefault()
          setFrom(null)
          setDropAt(null)
          if (from.dayId !== day.dayId) onMoveStopToDay(from.dayId, from.assignmentId, day.dayId, 0)
        },
        className: `rounded-lg ${dropAt?.dayId === day.dayId && dropAt.index === -1 ? 'ring-2 ring-inset ring-accent' : ''}`,
      }
    : {}

  /**
   * One row of the chain: the stop, the drive leaving it, whatever hangs off that drive.
   *
   * The day's own index `i` addresses everything that belongs to this DATE — the leg, the
   * schedule entry, the dry points. Everything that WRITES uses `stop.ownerDayId` and
   * `stop.ownerIndex` instead, because a stop driven onto this date through the night is
   * still stored on the day it set off from (`nightSpill.ts`).
   */
  const latenessAt = (i: number): ScheduleWarning[] =>
    day.schedule.warnings.filter(w => w.index === i && (w.code === 'late' || w.code === 'missedLeave'))
  /**
   * The band for the tank running out on the leg leaving `legIndex`, whichever row owns
   * that leg: a stop, a night, a terminal. Only once the day has finished routing: the
   * warnings are republished after every routing task and the early ones are wrong, so
   * an offer that appears and moves while the trip loads reads as a fault.
   *
   * Keyed by the card's day, not the stop's stored one. This is the key the open search
   * is filed under, and the hook is asked with the same number. A band inside a borrowed
   * stretch had them differ, so the results arrived, drew on the map, and the band they
   * belonged to never opened.
   */
  const refuelBandsFor = (legIndex: number): React.ReactElement[] | null =>
    refuel && !loading
      ? (day.dryPoints ?? []).filter(dry => dry.legIndex === legIndex).map(dry => (
          <RefuelBand
            key={`dry-${dry.legIndex}`}
            dry={dry}
            dayId={day.dayId}
            refuel={refuel}
            onAsk={() => onAskRefuel?.(day.dayId, dry)}
            onAccept={onAcceptRefuel ? poi => onAcceptRefuel(day.dayId, poi, dry) : undefined}
          />
        ))
      : null
  const renderStopContent = (stop: RoadtripStop, i: number): React.ReactElement | null => {
    // The morning marker at the hotel the day sets out from is drawn as that hotel's row.
    if (resumeFoldsIntoBookend(day, i)) return null
    if (stop.automaticNight) return (
      <li key={stop.assignmentId}>
        <AutomaticDayStop stop={stop} entry={day.schedule.entries[i]} onFocus={onFocusPoint} />
        {i < last && day.legs[i]?.distance !== 0 ? <DriveBand leg={day.legs[i]} /> : null}
        {refuelBandsFor(i)}
        {i < last ? (day.legVias[i] ?? []).map((via, vi) => (
          <RouteViaStop key={`via-${vi}-${via.lat},${via.lng}`} via={via} />
        )) : null}
      </li>
    )
    // Every finding at this index is read on its own. Taking the first match let an
    // overnight crossing swallow the "you arrive late" flag without a trace, and a stop
    // can be late for the time it is reached and the time it is left at both at once.
    const lateness = latenessAt(i)
    // A booked night at the day's edge: not draggable, not numbered, no stay and no chips,
    // and the drive into or out of it offers no other ways (`legReroutable`).
    if (stop.bookend) {
      const reading = bookendReading(day, i)!
      const booking = bookendBooking(reading, !!canEditBookings)
      let open: (() => void) | undefined
      if (booking !== null && onOpenBooking) open = () => onOpenBooking(booking)
      else if (onSelectStop) open = () => onSelectStop(stop.placeId)
      return (
        <li key={stop.assignmentId} {...dropOnHotels}>
          <BookendStop
            reading={reading}
            entry={day.schedule.entries[i]}
            late={lateness}
            driveFindings={findingsFor(i)}
            continues={i < last}
            // The first row drawn, also when the morning marker before it went into it.
            starts={i === 0 || (i === 1 && resumeFoldsIntoBookend(day, 0))}
            onOpen={open}
          />
          {i < last && (!day.stops[i + 1].automaticNight || day.legs[i]?.distance !== 0) ? <DriveBand leg={day.legs[i]} /> : null}
          {refuelBandsFor(i)}
          {i < last ? (day.legVias[i] ?? []).map((via, vi) => (
            <RouteViaStop key={`via-${vi}-${via.lat},${via.lng}`} via={via} />
          )) : null}
        </li>
      )
    }
    // A terminal or a hire car's desk: not draggable, not numbered, not a place. A ride
    // that lands on the day it left is one block from its departure to its arrival, and
    // the arrival index draws nothing of its own. A lone terminal (a ride landing
    // tomorrow, a desk) is a row. Behind either the road goes on as usual, without other
    // ways to drive it (`legReroutable`).
    if (stop.carrier) {
      const prev = day.stops[i - 1]
      const next = day.stops[i + 1]
      const sameRide = (other: RoadtripStop | undefined): boolean => other?.carrier?.reservationId === stop.carrier!.reservationId
      if (stop.carrier.role === 'arrival' && prev?.carrier?.role === 'departure' && sameRide(prev)) return null
      const ride = stop.carrier.role === 'departure' && next?.carrier?.role === 'arrival' && sameRide(next)
      const open = onOpenBooking ? () => onOpenBooking(stop.carrier!.reservationId) : undefined
      // The index the road leaves from: the arrival's when the block holds both ends.
      const tail = ride ? i + 1 : i
      const after = day.stops[tail + 1]
      return (
        <li key={stop.assignmentId}>
          {ride ? (
            <RideBlock
              departure={stop}
              arrival={next!}
              entries={[day.schedule.entries[i], day.schedule.entries[i + 1]]}
              late={lateness}
              seg={day.legs[i]}
              continues={tail < last}
              starts={i === 0}
              onOpen={open}
            />
          ) : (
            <TerminalStop
              stop={stop}
              entry={day.schedule.entries[i]}
              late={lateness}
              continues={i < last}
              starts={i === 0}
              onOpen={open}
            />
          )}
          {tail < last && (!after?.automaticNight || day.legs[tail]?.distance !== 0) ? (
            /* The row the road leaves from carries the booking whenever that road is a
               ride itself (a departure terminal seated mid-day), and the band needs it
               to say more than a bare icon. */
            <DriveBand leg={day.legs[tail]} carrier={day.stops[tail]?.carrier} />
          ) : null}
          {/* The tank starts afresh after a flight and full at a pick-up desk, and the
              first road out of either can be the one that empties it. */}
          {refuelBandsFor(tail)}
          {tail < last ? (day.legVias[tail] ?? []).map((via, vi) => (
            <RouteViaStop key={`via-${vi}-${via.lat},${via.lng}`} via={via} />
          )) : null}
        </li>
      )
    }
    const service = isServiceStopType(stop.stopType)
    if (!service) counted += 1
    const ownDay = stop.ownerDayId
    const ownIndex = stop.ownerIndex
    return (
      <li
        key={stop.assignmentId}
        draggable={!!onReorderStop}
        onDragStart={onReorderStop ? e => {
          setFrom({ dayId: ownDay, index: ownIndex, assignmentId: stop.assignmentId })
          e.dataTransfer.effectAllowed = 'move'
          // Firefox refuses to start a drag without payload, even an unused one.
          e.dataTransfer.setData('text/plain', String(stop.assignmentId))
        } : undefined}
        onDragEnd={() => { setFrom(null); setDropAt(null) }}
        onDragOver={onReorderStop && from ? e => {
          e.preventDefault()
          if (dropAt?.dayId !== ownDay || dropAt.index !== ownIndex) setDropAt({ dayId: ownDay, index: ownIndex })
        } : undefined}
        onDrop={onReorderStop && from ? e => {
          e.preventDefault()
          const src = from
          setFrom(null)
          setDropAt(null)
          if (src.dayId === ownDay) {
            if (src.index !== ownIndex) onReorderStop(ownDay, src.assignmentId, ownIndex)
          } else {
            onMoveStopToDay?.(src.dayId, src.assignmentId, ownDay, ownIndex)
          }
        } : undefined}
        className={`rounded-lg transition-opacity ${from?.dayId === ownDay && from.index === ownIndex ? 'opacity-40' : ''} ${
          dropAt?.dayId === ownDay && dropAt.index === ownIndex && from && !(from.dayId === ownDay && from.index === ownIndex)
            ? 'ring-2 ring-inset ring-accent'
            : ''
        }`}
      >
        {service ? (
          <ServiceStop
            stop={stop}
            entry={day.schedule.entries[i]}
            late={lateness}
            driveFindings={findingsFor(i)}
            selected={selectedAssignmentId === stop.assignmentId}
            onSelect={onSelectStop ? () => onSelectStop(stop.placeId, stop.assignmentId) : undefined}
            onEditStay={onEditStay ? () => onEditStay(stayDraftOf(stop, day.schedule.entries[i], missedLeaveOf(day, i))) : undefined}
            onPickKind={onSetStopKind ? anchor => setPicking({ anchor, stop }) : undefined}
            onPickFill={onSetStopFill ? anchor => setFilling({ anchor, stop }) : undefined}
          />
        ) : (
          <Stop
            stop={stop}
            number={counted}
            entry={day.schedule.entries[i]}
            late={lateness}
            driveFindings={findingsFor(i)}
            selected={selectedAssignmentId === stop.assignmentId}
            continues={i < last}
            starts={i === 0}
            onSelect={onSelectStop ? () => onSelectStop(stop.placeId, stop.assignmentId) : undefined}
            onMove={onReorderStop ? delta => onReorderStop(ownDay, stop.assignmentId, ownIndex + delta) : undefined}
            canMove={movableWithin(day, i)}
            onEditStay={onEditStay ? () => onEditStay(stayDraftOf(stop, day.schedule.entries[i], missedLeaveOf(day, i))) : undefined}
            onPickKind={onSetStopKind ? anchor => setPicking({ anchor, stop }) : undefined}
            onPickFill={onSetStopFill ? anchor => setFilling({ anchor, stop }) : undefined}
          />
        )}
        {bookings.atStop.has(i) ? (
          <BookingChips bookings={bookings.atStop.get(i)!} continues={i < last} canEdit={!!canEditBookings} onOpen={onOpenBooking} />
        ) : null}
        {i < last && (!day.stops[i + 1].automaticNight || day.legs[i]?.distance !== 0) ? (
          <DriveBand
            leg={day.legs[i]}
            onAskAlternatives={onAskAlternatives && legReroutable(day, i) ? () => onAskAlternatives(day.dayId, { kind: 'leg', index: i }) : undefined}
            alternativesOpen={openOn(openAlternatives, day.dayId, { kind: 'leg', index: i })}
          />
        ) : null}
        {refuelBandsFor(i)}
        {/* After the band, because a plugin halt happens on the drive it describes
            rather than before setting off. */}
        {i < last ? (day.legVias[i] ?? []).map((via, vi) => (
          <RouteViaStop key={`via-${vi}-${via.lat},${via.lng}`} via={via} />
        )) : null}
      </li>
    )
  }

  /**
   * The chain in runs: the stretches driven onto this date through the night, and the
   * day's own stops between and after them.
   *
   * Built rather than mapped straight through, because a spill is drawn inside a block of
   * its own and a block cannot be opened halfway down a `map`.
   */
  const renderStop = (stop: RoadtripStop, i: number): React.ReactElement => {
    const inbound = refuelBandsFor(-i - 1)
    return (
      <React.Fragment key={stop.assignmentId}>
        {inbound?.length ? <li key={`inbound-${i}`}>{inbound}</li> : null}
        {renderStopContent(stop, i)}
      </React.Fragment>
    )
  }
  const runs: { spill: SpillMark | null; from: number; to: number }[] = []
  {
    let at = 0
    for (const spill of day.spills ?? []) {
      if (spill.at > at) runs.push({ spill: null, from: at, to: spill.at })
      runs.push({ spill, from: spill.at, to: spill.at + spill.count })
      at = spill.at + spill.count
    }
    if (at < day.stops.length) runs.push({ spill: null, from: at, to: day.stops.length })
  }

  return (
    <section className="mx-3.5 shrink-0 overflow-hidden rounded-2xl border border-edge-faint bg-surface-card">
      {/* Centred, with the day's facts as badges beneath its name: at this width a row
          of label-and-value pairs breaks awkwardly, while three short badges wrap
          gracefully and stay readable in every language. */}
      {/* A tint of its own, not just a hairline: the header holds the day's summed facts
          and the list below holds its stops, and `--bg-hover` at 40% is 1% black in light
          mode — a separation nobody could see. `--bg-secondary` lifts off the card in
          both themes while staying a step under the badges sitting on it. */}
      <header
        // A button when there is something to fold, a plain header when there is not, so
        // a read-only rail never offers a control that does nothing. The whole header is
        // the target and the hover is the only sign of it: a chevron or a "fold" label
        // beside the day's own facts read as a fourth fact about the day rather than as a
        // control, and the header is what somebody is already looking at when they decide
        // to put a day away.
        {...(onToggle ? {
          role: 'button' as const,
          tabIndex: 0,
          'aria-expanded': !collapsed,
          onClick: onToggle,
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() }
          },
        } : {})}
        // The margin and the bottom rule belong to the header only while there is a list
        // under them. Folded, they left a white strip of card below the tinted header —
        // and once the day is tinted, that strip is the one thing on the card that is not.
        className={`border-edge-faint bg-surface-secondary px-3.5 pb-2.5 pt-3 ${collapsed ? '' : 'mb-1 border-b'} ${
          onToggle ? 'cursor-pointer transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent' : ''
        }`}
        // Washed with the colour this day is drawn in, and only while the map is drawing
        // days in colour: on the map the colour is what tells one day from the next, and
        // a rail that ignored it would leave the reader matching a green line to a card
        // that gives no sign of being the green one. A tenth of the hue is enough to
        // recognise and quiet enough that the day's own facts still read first.
        style={tint ? {
          backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${tint} 13%, var(--bg-secondary)), color-mix(in srgb, ${tint} 5%, var(--bg-secondary)))`,
          borderBottomColor: `color-mix(in srgb, ${tint} 30%, transparent)`,
        } : undefined}
      >
        <h3
          className="text-center font-semibold tracking-[-0.015em] text-content"
          style={{ fontSize: FS.dayTitle }}
        >
          {t('roadtrip.day', { number: day.dayNumber })}
        </h3>
        {/* Read by the hook since it was written, never drawn until now. */}
        {day.title ? (
          <p className="mt-0.5 break-words text-center text-content-secondary" style={{ fontSize: FS.meta }}>
            {day.title}
          </p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap justify-center gap-1">
          {day.date ? (
            <time dateTime={day.date} className={`${DAY_BADGE} border border-edge bg-surface-card`} style={{ fontSize: FS.label }}>
              {formatDate(day.date, language)}
            </time>
          ) : null}
          {/* A day that is only the night booked for it has no drive to sum up and no
              stop to count; the hotel row below says everything it has to say. */}
          {day.legs.length > 0 ? (
            <span className={`${DAY_BADGE} bg-surface-card`} style={{ fontSize: FS.label }}>
              {t('roadtrip.leg.driveText', {
                distance: formatDistance(day.distance / 1000, distanceUnit),
                time: formatDurationShort(day.duration),
              })}
            </span>
          ) : null}
          {day.dayWarning ? (
            <Tooltip label={t('roadtrip.limit.hint')}>
              <span className={`${DAY_BADGE} gap-1 bg-warning-soft text-warning`} style={{ fontSize: FS.label }}>
                <AlertTriangle size={10} className="shrink-0" aria-hidden />
                {t('roadtrip.limit.dayOver', {
                  time: formatDurationShort((day.dayWarning.minutes - day.dayWarning.limitMinutes) * 60),
                })}
              </span>
            </Tooltip>
          ) : null}
          {missed ? (
            <Tooltip label={missed.hint}>
              <span className={`${DAY_BADGE} gap-1 bg-warning-soft text-warning`} style={{ fontSize: FS.label }}>
                <AlertTriangle size={10} className="shrink-0" aria-hidden />
                {missed.label}
              </span>
            </Tooltip>
          ) : null}
          {/* Nor does a day whose drive runs from one hotel to the next with no stop of its
              own: "0 stops" beside the drive reads as the stops having gone missing. */}
          {day.legs.length > 0 && destinationCount(day) > 0 && !narrow ? (
            <span className={`${DAY_BADGE} bg-surface-card`} style={{ fontSize: FS.label }}>
              {t('roadtrip.day.stopCount', { count: destinationCount(day) })}
            </span>
          ) : null}
          {/* The other half of "where possible". The setting is a weighting, so a day
              with no untolled crossing comes back on the toll road — and the only thing
              worse than not avoiding it is not avoiding it silently, which reads as the
              switch being broken. Among the day's facts because that is what it is: a
              fact about this day's roads, not a warning about the plan. */}
          {day.avoidMissed?.length ? (
            <Tooltip label={t('roadtrip.avoid.missedHint')}>
              <span className={`${DAY_BADGE} gap-1 bg-surface-card text-content-secondary`} style={{ fontSize: FS.label }}>
                <Ban size={10} className="shrink-0" aria-hidden />
                {t('roadtrip.avoid.missed', {
                  classes: day.avoidMissed.map(cls => t(`roadtrip.avoid.${cls}`)).join(', '),
                })}
              </span>
            </Tooltip>
          ) : null}
          {/* Among the day's facts rather than beside its title, because "which road this
              day takes" is one of them. Tinted once the day carries vias: the rail draws
              none of them, so this badge is the only place a drive shaped by hand differs
              from one the router picked on its own. */}
          {onFollowTrack ? (
            <Tooltip label={trackName ? t('roadtrip.track.current', { name: trackName }) : t('roadtrip.track.hint')}>
              <button
                type="button"
                onClick={() => onFollowTrack(day.dayId)}
                className={`${DAY_BADGE} gap-1 transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  viaCount ? 'bg-accent-subtle text-content' : 'bg-surface-card hover:bg-surface-hover'
                }`}
                style={{ fontSize: FS.label }}
              >
                <Spline size={10} className="shrink-0" aria-hidden />
                {t('roadtrip.track.badge')}
              </button>
            </Tooltip>
          ) : null}
        </div>
      </header>
      {/* One list item per stop, with the drive that follows it inside — the chain is a
          list of places, not of alternating places and connectors. A service stop owns
          the drive leaving it in exactly the same way, which is what splits its leg into
          band, marker, band without the list needing a second shape. */}
      {/* Folded to the header, and with it off the map: what is not listed here is not
          drawn there either, which is the whole point of putting a day away. */}
      <ol className="px-3.5 pb-3 pt-3" hidden={collapsed}>
        {/* The drive in from yesterday, above the first stop, because that is where it
            happens. Without it a morning that starts at 08:11 after a stay that ended at
            08:00 looks like eleven minutes went missing. A day whose first stop crossed
            over instead gets that road under its own block, so this is left out there. */}
        {/* A day that opens on an arrival terminal is joined by the ride, and the
            terminal carries the booking the band names. A drive by road is offered other
            ways like any leg (`arrivingReroutable`); a choice is filed behind the stop it
            leaves, on the day before, where the map files a point dropped on it. */}
        {day.arrivingLeg ? (
          <DriveBand
            leg={day.arrivingLeg}
            carrier={day.stops[0]?.carrier}
            onAskAlternatives={onAskAlternatives && arrivingReroutable(day) ? () => onAskAlternatives(day.dayId, ARRIVING_DRIVE) : undefined}
            alternativesOpen={openOn(openAlternatives, day.dayId, ARRIVING_DRIVE)}
          />
        ) : null}
        {runs.map(run => (
          run.spill ? (
            <SpillBlock key={`spill-${run.from}`} spill={run.spill}>
              {day.stops.slice(run.from, run.to).map((stop, n) => renderStop(stop, run.from + n))}
            </SpillBlock>
          ) : (
            <React.Fragment key={`run-${run.from}`}>
              {day.stops.slice(run.from, run.to).map((stop, n) => renderStop(stop, run.from + n))}
            </React.Fragment>
          )
        ))}
        {/* Booked on this day, for no stop the day drives to: the rail has nowhere
            better to put them and leaving them out would make the mode look like it
            lost them. */}
        {bookings.loose.length ? (
          <li className="mt-1.5">
            <div className="grid" style={RAIL_GRID}>
              <span aria-hidden />
              <span className={`${STAT_LABEL} px-1.5`} style={{ fontSize: FS.micro }}>{t('roadtrip.bookings.loose')}</span>
            </div>
            <BookingChips bookings={bookings.loose} continues={false} canEdit={!!canEditBookings} onOpen={onOpenBooking} />
          </li>
        ) : null}
      </ol>
      {picking ? (
        <StopKindPicker
          anchor={picking.anchor}
          current={picking.stop.stopType}
          onClose={() => setPicking(null)}
          onPick={kind => {
            setPicking(null)
            void onSetStopKind?.(picking.stop.placeId, kind)
          }}
        />
      ) : null}
      {filling ? (
        <StopFillPicker
          anchor={filling.anchor}
          current={filling.stop.fillPercent ?? null}
          onClose={() => setFilling(null)}
          onPick={percent => {
            setFilling(null)
            void onSetStopFill?.(filling.stop.placeId, percent)
          }}
        />
      ) : null}
    </section>
  )
}

/** The stop in flight and the row it is hovering, shared by every day in the rail. */
interface DragState {
  from: { dayId: number; index: number; assignmentId: number } | null
  setFrom: (v: DragState['from']) => void
  dropAt: { dayId: number; index: number } | null
  setDropAt: (v: DragState['dropAt']) => void
}

/**
 * A day the rail draws no drive for, shown only so a stop can be moved onto it.
 *
 * Without it a one-stop day is invisible, and "this leg is too long, push the last stop
 * to tomorrow" has nowhere to land — which is the move a road trip needs most.
 */
function QuietDaySection({ day, onMoveStopToDay, drag }: {
  day: QuietDay
  onMoveStopToDay?: RoadtripSidebarProps['onMoveStopToDay']
  drag: DragState
}): React.ReactElement | null {
  const { t, language } = useTranslation()
  const { from, dropAt, setFrom, setDropAt } = drag
  // Only while something is in flight: an empty day is not worth a row of its own
  // otherwise, and the rail is about the drive.
  if (!from || !onMoveStopToDay) return null
  const over = dropAt?.dayId === day.dayId
  return (
    <section
      onDragOver={e => { e.preventDefault(); if (!over) setDropAt({ dayId: day.dayId, index: day.stops.length }) }}
      onDrop={e => {
        e.preventDefault()
        const src = from
        setFrom(null)
        setDropAt(null)
        if (src.dayId !== day.dayId) onMoveStopToDay(src.dayId, src.assignmentId, day.dayId, day.stops.length)
      }}
      className={`mx-3.5 shrink-0 rounded-2xl border border-dashed px-3.5 py-3 transition-colors ${
        over ? 'border-accent bg-accent-subtle' : 'border-edge-secondary'
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="font-semibold tracking-[-0.015em] text-content" style={{ fontSize: FS.dayTitle }}>
          {t('roadtrip.day', { number: day.dayNumber })}
        </h3>
        {day.date ? (
          <time dateTime={day.date} className={`${DAY_BADGE} ms-auto border border-edge`} style={{ fontSize: FS.label }}>
            {formatDate(day.date, language)}
          </time>
        ) : null}
      </div>
      <p className="mt-1.5 text-content-muted" style={{ fontSize: FS.meta }}>
        {day.stops.length === 1
          ? t('roadtrip.quietDay.one', { name: day.stops[0].name })
          : t('roadtrip.quietDay.empty')}
      </p>
    </section>
  )
}

/**
 * The road trip rail: the whole trip as one chain of stops with the driving distance
 * and time between them.
 *
 * Takes the day plan's place in the left column while road trip mode is on, because a
 * road trip is read across days — which day a stop sits on matters less than how far
 * apart the stops are (#1797, #435). Legs come from the same routing cache the map
 * uses, so switching modes costs no extra requests.
 *
 * Three levels, three surfaces: the trip is a card at the head, a day is a card, a stop
 * is a row inside it. The stop's name and its arrival carry the weight and everything
 * else is quiet support — no value is ever joined to another with a middot, and none of
 * them is a pill just for being a number.
 */
export default function RoadtripSidebar({
  routes, selectedAssignmentId, onSelectStop, onOpenBooking, canEditBookings, reservations, onReorderStop, onMoveStopToDay, onAskAlternatives, openAlternatives, onEditStay,
  onSetStopKind, onSetStopFill, onFollowTrack, viaCounts, trackNames, refuel, onAskRefuel, onAcceptRefuel,
  collapsedDayIds, onToggleDay, onFocusPoint,
}: RoadtripSidebarProps): React.ReactElement {
  const { t } = useTranslation()
  const rail = useElementSize<HTMLDivElement>()
  const narrow = rail.width > 0 && rail.width < RAIL_NARROW_PX
  // One drag state for the whole rail rather than one per day: a stop that cannot leave
  // its own day is exactly the move a road trip needs when a leg turns out too long.
  const [from, setFrom] = React.useState<DragState['from']>(null)
  const [dropAt, setDropAt] = React.useState<DragState['dropAt']>(null)
  const drag: DragState = { from, setFrom, dropAt, setDropAt }
  // Where each day stands in the trip, so a booking that spans several days is listed on
  // the days between its two ends as well, the way the day plan lists a three-day tour.
  // Quiet days count: a span can run straight over one.
  const dayOrder = useMemo(() => {
    const numbers = new Map([...routes.days, ...routes.quietDays].map(d => [d.dayId, d.dayNumber]))
    return (dayId: number): number | null => numbers.get(dayId) ?? null
  }, [routes.days, routes.quietDays])
  const undated = useMemo(() => undatedRides(reservations ?? []), [reservations])

  // Nothing to total up, so nothing pretends to: no "0 km" standing above "No route yet".
  if (routes.days.length === 0) {
    // Centred in the rail rather than sitting at its top: the state is about the
    // whole column being empty, and a mascot pinned under the header reads as a
    // header decoration.
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        {/* The mascot rather than a pin and two lines of instructions. The rail
            is empty because the trip has no days with places yet, which is a
            state, not a task list: the same look every other empty state in TREK
            has. */}
        <EmptyState
          scene="transport"
          mood="sad"
          title={t('roadtrip.empty.title')}
          size={96}
          surface="var(--bg-secondary)"
        />
      </div>
    )
  }

  return (
    // The totals hold still while the days move under them: they are the answer to "how
    // long is this trip", and an answer that scrolls away is one you have to go back for.
    <div ref={rail.ref} className="flex min-h-0 flex-1 flex-col gap-3 pt-1">
      <div className="shrink-0">
        <TripSummary routes={routes} narrow={narrow} />
        {routes.dayWindowIssue ? (
          <p role="status" className="mx-3.5 mt-2 rounded-xl bg-warning-soft p-3 text-caption text-content">
            {t(`roadtrip.window.${routes.dayWindowIssue}`, { days: MAX_TRIP_DAYS })}
          </p>
        ) : null}
        <UndatedRides rides={undated} onOpenBooking={onOpenBooking} />
      </div>
      <div className="roadtrip-rail-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-3.5">
        {routes.days.map(day => (
          <DaySection
            key={day.dayId}
            day={day}
            narrow={narrow}
            onFocusPoint={onFocusPoint}
            selectedAssignmentId={selectedAssignmentId}
            onSelectStop={onSelectStop}
            onReorderStop={onReorderStop}
            onMoveStopToDay={onMoveStopToDay}
            drag={drag}
            onAskAlternatives={onAskAlternatives}
            openAlternatives={openAlternatives}
            onOpenBooking={onOpenBooking}
            canEditBookings={canEditBookings}
            reservations={reservations}
            dayOrder={dayOrder}
            onEditStay={onEditStay}
            onSetStopKind={onSetStopKind}
            onSetStopFill={onSetStopFill}
            onFollowTrack={day.dayId < 0 ? undefined : onFollowTrack}
            viaCount={viaCounts?.[day.dayId] ?? 0}
            trackName={trackNames?.[day.dayId]}
            refuel={refuel}
            onAskRefuel={onAskRefuel}
            onAcceptRefuel={onAcceptRefuel}
            loading={routes.loading}
            collapsed={collapsedDayIds?.has(day.dayId)}
            onToggle={onToggleDay ? () => onToggleDay(day.dayId) : undefined}
          />
        ))}
        {routes.quietDays.map(day => (
          <QuietDaySection key={`quiet-${day.dayId}`} day={day} onMoveStopToDay={onMoveStopToDay} drag={drag} />
        ))}
      </div>
    </div>
  )
}
