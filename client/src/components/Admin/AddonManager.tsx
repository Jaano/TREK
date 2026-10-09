import { useId, type ComponentType } from 'react'
import { useTranslation } from '../../i18n'
import { useIsDark } from '../../hooks/useIsDark'
import { Puzzle, ListChecks, Wallet, FileText, CalendarDays, Globe, Briefcase, Image, Terminal, Link2, Compass, BookOpen, Sparkles, Luggage, Plane, Server, Cloud, Bookmark, Users, Loader2, RefreshCw } from 'lucide-react'
import CustomSelect from '../shared/CustomSelect'
import { asLlmVision, LLM_VISION_MODES, type LlmVision } from '@trek/shared'
import EmptyState from '../shared/EmptyState'
import DawarichIcon from '../shared/DawarichIcon'
import AirTrailIcon from '../shared/AirTrailIcon'
import { DOCUMENT_PROVIDER_ICONS } from '../shared/DocumentProviderIcons'
import AddonTile from './AddonTile'
import AddonSubRow from './AddonSubRow'
import { Tooltip } from '../shared/Tooltip'
import { fs } from '../shared/DialogShell'
import { EditorField, INPUT, Segmented } from '../shared/dialogParts'
import { SettingsCard, SettingsHint, StatusPill, SETTINGS_BUTTON_PRIMARY } from '../Settings/settingsKit'
import { type Addon, type CollabFeatures, COLLAB_SUB_FEATURES, getAddonLabel, MASKED, RECOMMENDED_MODELS } from './addons/addonModel'
import { useAddonManager } from './addons/useAddonManager'
import { useLlmParsingConfig } from './addons/useLlmParsingConfig'

// Keys are the `icon` column from the addons table (see server seeds.ts); anything
// unknown falls back to Puzzle. Users/Sparkles cover collab and llm_parsing, which
// used to land on the fallback.
const ICON_MAP = {
  ListChecks, Wallet, FileText, CalendarDays, Puzzle, Globe, Briefcase, Image, Terminal, Link2, Compass, BookOpen, Plane, Bookmark, Users, Sparkles,
  // Dawarich ships a brand mark rather than a lucide name, the same way the photo
  // providers below do. Keyed by the string in the addons table.
  Dawarich: DawarichIcon,
}

function ImmichIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flexShrink: 0 }}>
      <path d="M11.986.27c-2.409 0-5.207 1.09-5.207 3.894v.152c1.343.597 2.935 1.663 4.412 2.971 1.571 1.391 2.838 2.882 3.653 4.287 1.4-2.503 2.336-5.478 2.347-7.373V4.164c0-2.803-2.796-3.894-5.205-3.894m7.512 4.49c-.378-.008-.775.05-1.192.186l-.144.047c-.153 1.461-.676 3.304-1.463 5.113-.837 1.924-1.863 3.59-2.947 4.799 2.813.558 5.93.527 7.736-.047l.035-.01c2.667-.866 2.84-3.863 2.096-6.154-.628-1.933-2.081-3.89-4.121-3.934m-14.996.04c-2.04.043-3.493 1.997-4.121 3.93-.744 2.291-.571 5.288 2.096 6.155l.144.046c.982-1.092 2.488-2.276 4.188-3.277 1.809-1.065 3.619-1.808 5.207-2.148-1.949-2.105-4.489-3.914-6.287-4.51l-.036-.012c-.416-.135-.813-.193-1.191-.185m4.672 6.758c-2.604 1.202-5.109 3.06-6.233 4.586l-.021.029c-1.648 2.268-.027 4.795 1.922 6.211 1.949 1.416 4.852 2.177 6.5-.092.023-.031.054-.07.09-.121-.736-1.272-1.396-3.072-1.822-4.998-.454-2.05-.603-4-.436-5.615m1.072 3.338c.339 2.848 1.332 5.804 2.436 7.344l.021.029c1.648 2.268 4.551 1.508 6.5.092 1.949-1.416 3.57-3.943 1.922-6.211-.023-.031-.052-.073-.088-.123-1.437.307-3.352.38-5.316.19-2.089-.202-3.99-.663-5.475-1.321" fill="currentColor" />
    </svg>
  )
}

function SynologyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ flexShrink: 0 }}>
      <path d="M17.895 11.927a3.196 3.196 0 0 1 .394-1.53l-.008.017a2.677 2.677 0 0 1 1.075-1.108l.014-.007a3.181 3.181 0 0 1 1.523-.382h.05-.003q1.346 0 2.2.871.854.871.86 2.203c0 .895-.29 1.635-.867 2.226s-1.306.886-2.183.886c-.566 0-1.1-.137-1.571-.379l.019.009a2.535 2.535 0 0 1-1.115-1.067l-.007-.013q-.38-.708-.381-1.726zm1.593.083c0 .591.138 1.043.42 1.349a1.365 1.365 0 0 0 2.066.002l.001-.002c.275-.307.413-.764.413-1.357s-.138-1.033-.413-1.342a1.371 1.371 0 0 0-2.066-.001l-.001.002c-.281.306-.42.758-.42 1.345zm-1.602 2.941H16.33v-3.015c0-.635-.032-1.044-.101-1.234a.876.876 0 0 0-.328-.435l-.003-.002a.938.938 0 0 0-.521-.156h-.027.001-.012c-.27 0-.521.084-.727.228l.004-.003a1.115 1.115 0 0 0-.444.576l-.002.008c-.083.248-.121.696-.121 1.359v2.673H12.5V9.027h1.439v.867c.518-.656 1.167-.98 1.952-.98h.021c.335 0 .655.067.946.189l-.016-.006c.261.105.48.268.648.475l.002.003c.141.185.247.404.304.643l.002.012c.057.278.089.597.089.924l-.002.135v-.007zM6.413 9.028h1.654l1.412 4.204 1.376-4.204h1.611l-2.067 5.693-.38 1.038a4.158 4.158 0 0 1-.4.807l.01-.017a1.637 1.637 0 0 1-.422.443l-.005.003c-.17.113-.367.203-.578.26l-.014.003c-.232.064-.499.1-.774.1h-.025.001a4.13 4.13 0 0 1-.911-.105l.028.005-.129-1.229c.198.046.426.074.659.077h.002c.36 0 .628-.106.8-.318a2.27 2.27 0 0 0 .395-.807l.004-.016zM0 12.29l1.592-.149q.147.802.586 1.181.439.379 1.192.375c.528 0 .927-.113 1.197-.335.27-.222.4-.486.4-.782v-.024a.751.751 0 0 0-.167-.474l.001.001c-.113-.132-.309-.252-.59-.347-.193-.074-.631-.191-1.312-.365-.882-.216-1.496-.486-1.85-.804A2.147 2.147 0 0 1 .3 8.936v-.019V8.908c0-.431.132-.831.358-1.163l-.005.007a2.226 2.226 0 0 1 1.003-.826l.015-.005c.442-.184.973-.281 1.602-.281q1.529 0 2.304.676c.516.457.785 1.057.811 1.809l-1.649.055c-.073-.413-.219-.714-.452-.899-.233-.185-.579-.276-1.034-.276-.476 0-.85.098-1.118.298a.59.59 0 0 0-.261.49v.011-.001.002c0 .201.095.379.242.493l.001.001c.205.179.709.36 1.507.546.798.186 1.388.387 1.769.59.374.196.678.48.893.825l.006.01c.214.345.326.786.326 1.305 0 .489-.146.944-.396 1.325l.006-.009c-.264.408-.64.724-1.084.908l-.016.006c-.475.194-1.065.298-1.772.298-1.029 0-1.819-.241-2.373-.722-.554-.481-.879-1.177-.986-2.091z" fill="currentColor" />
    </svg>
  )
}

const PROVIDER_ICONS: Record<string, ComponentType<{ size?: number }>> = {
  immich: ImmichIcon,
  synologyphotos: SynologyIcon,
  // The document providers' own marks, single-colour so they read as glyphs in
  // a row of lucide icons and invert with the theme.
  ...DOCUMENT_PROVIDER_ICONS,
}

interface AddonIconProps {
  name: string
  size?: number
  /** A switched-off addon greys its icon out, brand marks included. */
  enabled?: boolean
}

function AddonIcon({ name, size = 20, enabled = true }: AddonIconProps) {
  // The brand marks are badges, not glyphs: they fill the framed slot instead of
  // sitting in the middle of it at glyph size, and they grey out when the addon
  // is off — the lucide glyphs get that from the slot's text colour, an <img>
  // has to be told.
  if (name === 'Dawarich') return <DawarichIcon fill muted={!enabled} />
  // 'Plane' is the icon string airtrail was seeded with, and INSERT OR IGNORE
  // means every existing install still carries it — so the brand is keyed on
  // that rather than on a new name no row would ever have.
  if (name === 'Plane') return <AirTrailIcon fill muted={!enabled} />
  const Icon = ICON_MAP[name] || Puzzle
  return <Icon size={size} />
}

/** What each type means, shown on the tile itself now that the sections are gone. The
 *  hint rides along as the tooltip, so "Global" still explains itself. */
const TYPE_META: Record<string, { icon: ComponentType<{ size?: number }>; labelKey: string; hintKey: string }> = {
  trip: { icon: Briefcase, labelKey: 'admin.addons.type.trip', hintKey: 'admin.addons.tripHint' },
  global: { icon: Globe, labelKey: 'admin.addons.type.global', hintKey: 'admin.addons.globalHint' },
  integration: { icon: Link2, labelKey: 'admin.addons.type.integration', hintKey: 'admin.addons.integrationHint' },
}

export default function AddonManager({ bagTrackingEnabled, onToggleBagTracking, collabFeatures, onToggleCollabFeature }: { bagTrackingEnabled?: boolean; onToggleBagTracking?: () => void; collabFeatures?: CollabFeatures; onToggleCollabFeature?: (key: string) => void }) {
  const { t } = useTranslation()
  const dark = useIsDark()
  const {
    addons, loading, handleToggle, tripAddons, globalAddons, integrationAddons, providerOptions, documentProviderOptions,
  } = useAddonManager()

  if (loading) {
    return (
      <SettingsCard icon={Puzzle} title={t('admin.addons.title')}>
        <div className="grid place-items-center py-14">
          <Loader2 size={22} className="animate-spin text-content-faint" />
        </div>
      </SettingsCard>
    )
  }

  /** Bag tracking, the collab features and the photo providers all hang off their
   *  parent as shelf rows, and each shelf only shows while its parent is on —
   *  a provider toggled under a disabled Journey would hit the server's 409. */
  const shelfFor = (addon: Addon) => {
    if (addon.id === 'packing' && addon.enabled && onToggleBagTracking) {
      return (
        <AddonSubRow
          icon={<Luggage size={14} />}
          title={t('admin.bagTracking.title')}
          description={t('admin.bagTracking.subtitle')}
          enabled={!!bagTrackingEnabled}
          onToggle={onToggleBagTracking}
        />
      )
    }
    if (addon.id === 'collab' && addon.enabled && collabFeatures && onToggleCollabFeature) {
      return COLLAB_SUB_FEATURES.map(feat => {
        const Icon = feat.icon
        return (
          <AddonSubRow
            key={feat.key}
            icon={<Icon size={14} />}
            title={t(feat.titleKey)}
            description={t(feat.subtitleKey)}
            enabled={collabFeatures[feat.key]}
            onToggle={() => onToggleCollabFeature(feat.key)}
          />
        )
      })
    }
    // Document providers are the Documents tile's shelf, the way photo providers
    // are Journey's. Unlike those they carry no credential form here: a document
    // connection belongs to a trip, not to a user, so it is entered in the trip's
    // file manager. The admin decides only whether a provider may be offered.
    if (addon.id === 'documents' && addon.enabled && documentProviderOptions.length > 0) {
      return documentProviderOptions.map(provider => {
        const ProviderIcon = PROVIDER_ICONS[provider.key]
        return (
          <AddonSubRow
            key={provider.key}
            icon={ProviderIcon ? <ProviderIcon size={14} /> : undefined}
            title={provider.label}
            description={provider.description}
            enabled={provider.enabled}
            onToggle={provider.toggle}
          />
        )
      })
    }
    if (addon.id === 'journey' && addon.enabled && providerOptions.length > 0) {
      return providerOptions.map(provider => {
        const ProviderIcon = PROVIDER_ICONS[provider.key]
        return (
          <AddonSubRow
            key={provider.key}
            icon={ProviderIcon ? <ProviderIcon size={14} /> : undefined}
            title={provider.label}
            description={provider.description}
            enabled={provider.enabled}
            onToggle={provider.toggle}
          />
        )
      })
    }
    // The AI-parsing settings hang off their tile like every other sub-feature,
    // just as a form instead of toggle rows.
    if (addon.id === 'llm_parsing' && addon.enabled) {
      return <LlmParsingConfig addon={addon} />
    }
    return null
  }

  const tile = (addon: Addon) => {
    const label = getAddonLabel(t, addon)
    return (
      <AddonTile
        key={addon.id}
        icon={<AddonIcon name={addon.icon} size={18} enabled={addon.enabled} />}
        name={label.name}
        description={label.description}
        enabled={addon.enabled}
        onToggle={() => handleToggle(addon)}
      >
        {shelfFor(addon)}
      </AddonTile>
    )
  }

  /* One column per type, side by side, instead of three stacked sections. Stacked, each
     section opened its own set of columns and the tall tiles (Collab, Journey) set a
     section's height while its neighbours ran out early. Side by side the column's
     head carries the type, so the tiles need no badge of their own. */
  const groups = [
    { key: 'trip', addons: tripAddons },
    { key: 'global', addons: globalAddons },
    { key: 'integration', addons: integrationAddons },
  ].filter(g => g.addons.length > 0)
  const enabledCount = addons.filter(a => a.type !== 'photo_provider' && a.type !== 'document_provider' && a.enabled).length
  const totalCount = tripAddons.length + globalAddons.length + integrationAddons.length

  const subtitle = (
    <span className="inline-flex flex-wrap items-center gap-1">
      {t('admin.addons.subtitleBefore')}
      <img src={dark ? '/text-light.svg' : '/text-dark.svg'} alt="TREK" style={{ height: 10, verticalAlign: 'middle', opacity: 0.7 }} />
      {t('admin.addons.subtitleAfter')}
    </span>
  )

  return (
    <SettingsCard
      icon={Puzzle}
      title={t('admin.addons.title')}
      hint={subtitle}
      badge={totalCount > 0 ? (
        <Tooltip label={t('admin.addons.group.count', { enabled: enabledCount, total: totalCount })}>
          <span className="inline-flex">
            <StatusPill tone={enabledCount > 0 ? 'success' : 'neutral'}>{enabledCount}/{totalCount}</StatusPill>
          </span>
        </Tooltip>
      ) : undefined}
    >
      {addons.length === 0 ? (
        <EmptyState scene="idle" title={t('admin.addons.noAddons')} surface="var(--bg-secondary)" />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map(g => {
            const meta = TYPE_META[g.key]
            return (
              <section key={g.key} className="min-w-0 overflow-hidden rounded-[14px] border border-edge-faint bg-surface-card">
                <GroupHead icon={meta.icon} label={t(meta.labelKey)} hint={t(meta.hintKey)} addons={g.addons} t={t} />
                <div className="divide-y divide-edge-faint">{g.addons.map(tile)}</div>
              </section>
            )
          })}
        </div>
      )}
    </SettingsCard>
  )
}

/** The head band of one type's column: icon tile, the type, its count and what it means. */
function GroupHead({ icon: Icon, label, hint, addons, t }: {
  icon: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>
  label: string
  hint: string
  addons: Addon[]
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  const enabled = addons.filter(a => a.enabled).length
  return (
    <div className="flex items-start gap-2.5 border-b border-edge-faint bg-surface-tertiary px-3.5 py-2.5">
      <span className="mt-px grid h-7 w-7 flex-none place-items-center rounded-[9px] bg-surface-card text-content-secondary shadow-sm">
        <Icon size={13} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="m-0 min-w-0 flex-1 truncate font-bold text-content" style={fs(13, 'body')}>{label}</h3>
          <Tooltip label={t('admin.addons.group.count', { enabled, total: addons.length })}>
            <span className="inline-flex">
              <StatusPill>{enabled}/{addons.length}</StatusPill>
            </span>
          </Tooltip>
        </div>
        {/* Says what the type means: the only place that still explains it. */}
        <p className="m-0 mt-0.5 leading-snug text-content-faint" style={fs(11)}>{hint}</p>
      </div>
    </div>
  )
}

const EYEBROW = 'font-geist font-bold uppercase tracking-[.08em] text-content-faint'
const SMALL_BUTTON = 'inline-flex flex-none items-center rounded-[9px] px-2.5 py-1 font-medium transition-colors disabled:cursor-default disabled:opacity-60'

/**
 * Instance-wide AI-parsing config. When set, applies to the whole instance and
 * overrides per-user config (see server llmConfig.ts). The API key is masked on
 * read; an unchanged mask is treated as a no-op by the server. For the local
 * provider, it also lists installed Ollama models and can pull NuExtract models.
 */
function LlmParsingConfig({ addon }: { addon: Addon }) {
  const { t } = useTranslation()
  const {
    provider, setProvider, model, setModel, baseUrl, setBaseUrl, apiKey, setApiKey, vision, setVision, saving,
    installed, modelsErr, loadingModels, pulling, pullPct, pullStatus, isInstalled, loadModels, pull, save,
  } = useLlmParsingConfig(addon)
  const fieldId = useId()

  const providerOptions = [
    { value: 'local', label: 'Local · OpenAI-compatible', icon: <Server size={14} />, badge: 'Ollama' },
    { value: 'openai', label: 'OpenAI', icon: <Cloud size={14} /> },
    { value: 'anthropic', label: 'Anthropic', icon: <Sparkles size={14} /> },
  ]
  const visionOptions = LLM_VISION_MODES.map(value => ({ value, label: t(`admin.addons.llm.vision.${value}`) }))

  /* Lives in the tile's shelf like the collab toggles, so it is one column of
     eyebrow fields: the band this used to be had a whole page width. */
  return (
    <li className={`flex flex-col gap-3 p-3 ${saving ? 'opacity-60' : ''}`}>
      <SettingsHint>
        Instance-wide — applies to all users. Leave blank to let each user configure their own provider.
      </SettingsHint>

      <EditorField label="Provider">
        <CustomSelect value={provider} onChange={v => setProvider(String(v))} options={providerOptions} />
      </EditorField>
      {provider !== 'anthropic' && (
        <EditorField label="Base URL" htmlFor={`${fieldId}-url`}>
          <input id={`${fieldId}-url`} type="url" autoComplete="off" className={INPUT} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} onBlur={loadModels} placeholder={provider === 'local' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1'} />
        </EditorField>
      )}
      <EditorField
        label="API key"
        htmlFor={`${fieldId}-key`}
        hint={provider === 'anthropic' ? 'Anthropic reads PDFs (including scans) natively. Local/OpenAI models receive extracted text — scanned PDFs need Anthropic.' : undefined}
      >
        <input id={`${fieldId}-key`} type="password" className={INPUT} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={apiKey === MASKED ? MASKED : provider === 'local' ? '(often not required)' : 'sk-…'} />
      </EditorField>
      <EditorField label="Model" htmlFor={`${fieldId}-model`}>
        <input id={`${fieldId}-model`} autoComplete="off" className={`${INPUT} font-geist`} value={model} onChange={e => setModel(e.target.value)} placeholder={provider === 'anthropic' ? 'claude-opus-4-8' : provider === 'openai' ? 'gpt-4o' : 'select or pull below'} />
      </EditorField>

      <EditorField label={t('settings.aiParsing.multimodal')} hint={t(provider === 'local' ? 'admin.addons.llm.vision.hintLocal' : 'admin.addons.llm.vision.hintCloud')}>
        <Segmented<LlmVision>
          label={t('settings.aiParsing.multimodal')}
          value={vision}
          onChange={v => setVision(asLlmVision(v))}
          options={visionOptions}
          fill
        />
      </EditorField>

      {/* Local model management (Ollama) */}
      {provider === 'local' && (
        <div className="flex flex-col gap-2.5 rounded-[12px] border border-edge-faint bg-surface-card p-3">
          <div className="flex items-center gap-2">
            <span className={`${EYEBROW} min-w-0 flex-1 truncate`} style={fs(9.5)}>Installed on the server</span>
            <button type="button" onClick={loadModels} disabled={loadingModels}
              className="inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 font-medium text-content-muted hover:bg-surface-secondary hover:text-content disabled:cursor-default disabled:opacity-60"
              style={fs(11.5, 'body')}>
              <RefreshCw size={11} strokeWidth={2.2} className={loadingModels ? 'animate-spin' : undefined} />
              {loadingModels ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {modelsErr && <p className="m-0 break-words text-danger" style={fs(11.5)}>{modelsErr}</p>}
          {!modelsErr && installed.length === 0 && !loadingModels && (
            <SettingsHint>No models installed yet — pull one below.</SettingsHint>
          )}
          {installed.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {installed.map(name => (
                <button type="button"
                  key={name}
                  title={name}
                  onClick={() => setModel(name)}
                  aria-pressed={model === name}
                  className={`max-w-full truncate rounded-full px-2.5 py-[3px] font-geist font-medium transition-colors ${model === name ? 'bg-accent text-accent-text' : 'border border-edge bg-surface-card text-content-muted hover:text-content'}`}
                  style={fs(11.5)}
                >
                  {name}
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-edge-faint pt-2.5">
            <span className={EYEBROW} style={fs(9.5)}>Pull a recommended model</span>
            {RECOMMENDED_MODELS.map(m => {
              const installedHere = isInstalled(m.id)
              const isPulling = pulling === m.id
              const active = model === m.id
              return (
                <div key={m.id} className="min-w-0" title={m.note}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium text-content" style={fs(12.5, 'body')}>{m.label}</span>
                    {m.recommended && <StatusPill tone="success">Recommended</StatusPill>}
                    {installedHere ? (
                      <button type="button" onClick={() => setModel(m.id)} disabled={active} className={`${SMALL_BUTTON} ${active ? 'bg-surface-tertiary text-content-muted' : 'bg-surface-card text-content shadow-sm ring-1 ring-edge-faint hover:bg-surface-secondary'}`} style={fs(12, 'body')}>
                        {active ? 'Selected' : 'Use'}
                      </button>
                    ) : (
                      <button type="button" onClick={() => pull(m.id)} disabled={!!pulling} className={`${SMALL_BUTTON} bg-accent text-accent-text hover:opacity-90`} style={fs(12, 'body')}>
                        {isPulling ? 'Pulling…' : 'Pull'}
                      </button>
                    )}
                  </div>
                  {isPulling && (
                    <div className="mt-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary">
                        <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${pullPct}%` }} />
                      </div>
                      <div className="mt-1 truncate font-geist tabular-nums text-content-faint" style={fs(11)}>{pullStatus}{pullPct ? ` · ${pullPct}%` : ''}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving} className={SETTINGS_BUTTON_PRIMARY} style={fs(13, 'body')}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </li>
  )
}
