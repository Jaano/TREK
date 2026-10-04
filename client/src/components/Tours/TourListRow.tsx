import type { ReactNode } from 'react'
import type { TourListItem } from '@trek/shared'
import { AlertTriangle, ArrowDown, ArrowUp } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../store/settingsStore'
import { formatDistance, formatElevation } from '../../utils/units'
import { hikeSourceBadgeLabel } from './tourPresentation'

interface TourListRowProps {
  tour: TourListItem
  selected?: boolean
  disabled?: boolean
  onSelect: (tour: TourListItem, opener: HTMLElement) => void
  action?: ReactNode
  children?: ReactNode
}

/** Shared Tours list row used by both the ADD flow and the planner workspace. */
export default function TourListRow({ tour, selected = false, disabled = false, onSelect, action, children }: TourListRowProps) {
  const { t } = useTranslation()
  const distanceUnit = useSettingsStore(state => state.settings.distance_unit)

  return (
    <li
      role="option"
      tabIndex={disabled ? -1 : 0}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      className={`rounded-xl border border-edge p-3 ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`}
      style={{ background: selected ? 'var(--border-faint)' : 'transparent', transition: 'background 0.1s' }}
      onClick={event => { if (!disabled) onSelect(tour, event.currentTarget) }}
      onKeyDown={event => {
        if (disabled) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(tour, event.currentTarget)
        }
      }}
      onMouseEnter={event => { if (!selected) event.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={event => { if (!selected) event.currentTarget.style.background = 'transparent' }}
    >
      <div className="min-w-0">
        <span className="block min-w-0 line-clamp-2 break-words font-medium text-content" title={tour.name}>{tour.name}</span>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-content-secondary">
          <span className="shrink-0 rounded-md border border-edge bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-medium text-content-faint">
            {hikeSourceBadgeLabel(tour, t)}
          </span>
          <span
            title={t(`tours.planner.difficulty.t${tour.max_hiking_difficulty}`)}
            aria-label={t(`tours.planner.difficulty.t${tour.max_hiking_difficulty}`)}
            className="shrink-0 rounded-md border border-edge bg-surface-tertiary px-1.5 py-0.5 text-[10px] font-semibold text-content-secondary"
          >T{tour.max_hiking_difficulty}</span>
          {tour.caution && (
            <span title={t('tours.caution.tooltip')} aria-label={t('tours.caution.badge')} className="shrink-0 inline-flex items-center gap-0.5 rounded-md border border-amber-300/60 bg-amber-100/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2} /> {t('tours.caution.badge')}
            </span>
          )}
        </div>
        <div data-testid="tour-metrics" className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-secondary">
          <span className="whitespace-nowrap" aria-label={`${t('tours.detail.distance')}: ${formatDistance(tour.distance ?? 0, distanceUnit)}`}>
            {formatDistance(tour.distance ?? 0, distanceUnit)}
          </span>
          {tour.elevation_gain != null && (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap" aria-label={`${t('tours.detail.ascent')}: ${formatElevation(tour.elevation_gain, distanceUnit)}`}>
              <ArrowUp className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              {formatElevation(tour.elevation_gain, distanceUnit)}
            </span>
          )}
          {tour.elevation_loss != null && (
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap" aria-label={`${t('tours.detail.descent')}: ${formatElevation(tour.elevation_loss, distanceUnit)}`}>
              <ArrowDown className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              {formatElevation(tour.elevation_loss, distanceUnit)}
            </span>
          )}
        </div>
        {action && <div data-testid="tour-action-row" className="mt-2 w-full [&>button]:w-full [&>button]:justify-center">{action}</div>}
      </div>
      {children}
    </li>
  )
}
