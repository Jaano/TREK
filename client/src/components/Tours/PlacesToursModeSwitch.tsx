import React from 'react'
import { MapPin, Mountain } from 'lucide-react'
import { useTranslation } from '../../i18n/TranslationContext'
import { NEUTRAL_TINT } from '../shared/DialogShell'

interface PlacesToursModeSwitchProps {
  active: boolean
  onChange: (tours: boolean) => void
}

/**
 * Switches the right add-panel between the ordinary Places sidebar and the
 * Tours selection list. Top level of the panel, mirroring RoadtripModeSwitch
 * (Days <-> Roadtrip), using the same placement and addon gating convention.
 * Only rendered while the tours addon is on.
 */
export default function PlacesToursModeSwitch({ active, onChange }: PlacesToursModeSwitchProps): React.ReactElement {
  const { t } = useTranslation()
  const options: [boolean, string, typeof MapPin][] = [
    [false, t('tours.mode.places'), MapPin],
    [true, t('tours.mode.tours'), Mountain],
  ]
  return (
    <div className="flex-none px-3 pb-1 pt-3" style={{ background: NEUTRAL_TINT }}>
      <div role="tablist" aria-label={t('tours.mode.label')} className="flex gap-1 rounded-xl border border-edge-faint bg-surface-tertiary p-1">
        {options.map(([value, label, Icon]) => {
          const selected = active === value
          return (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(value)}
              style={{ fontSize: 'calc(11.5px * var(--fs-scale-body, 1))' }}
              className={`flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 transition-colors ${
                selected
                  ? 'bg-surface-card font-semibold text-content shadow-card'
                  : 'font-medium text-content-muted hover:bg-surface-hover hover:text-content'
              }`}
            >
              <Icon size={13} strokeWidth={1.8} aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
