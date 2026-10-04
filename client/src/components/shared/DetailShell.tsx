import type { CSSProperties, ReactNode } from 'react'
import { X } from 'lucide-react'

interface DetailShellProps {
  header: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
  closeLabel: string
  leftWidth?: number
  rightWidth?: number
  headerStyle?: CSSProperties
  contentStyle?: CSSProperties
  closeButtonClassName?: string
  testId?: string
}

/** Shared map-detail surface: panel-aware positioning, chrome and scrolling. */
export default function DetailShell({
  header,
  children,
  footer,
  onClose,
  closeLabel,
  leftWidth = 0,
  rightWidth = 0,
  headerStyle,
  contentStyle,
  closeButtonClassName = '',
  testId,
}: DetailShellProps) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: `calc(${leftWidth}px + (100% - ${leftWidth}px - ${rightWidth}px) / 2)`,
        transform: 'translateX(-50%)',
        width: `min(800px, calc(100% - ${leftWidth}px - ${rightWidth}px - 32px))`,
        zIndex: 50,
        fontFamily: 'var(--font-system)',
      }}
    >
      <div
        className="bg-surface-elevated text-content"
        style={{
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          borderRadius: 20,
          boxShadow: '0 8px 40px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="border-b border-edge-faint" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 16px 14px', flexShrink: 0, ...headerStyle }}>
          {header}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className={`bg-surface-hover ${closeButtonClassName}`}
            style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, alignSelf: 'flex-start', transition: 'background 0.15s' }}
            onMouseEnter={event => { event.currentTarget.style.background = 'var(--bg-tertiary)' }}
            onMouseLeave={event => { event.currentTarget.style.background = 'var(--bg-hover)' }}
          >
            <X size={14} strokeWidth={2} color="var(--text-secondary)" />
          </button>
        </div>
        <div
          data-testid={testId}
          style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10, ...contentStyle }}
        >
          {children}
        </div>
        {footer && (
          <div className="border-t border-edge-faint" style={{ padding: '10px 16px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
