/**
 * The error state for a failed widget mount — SIZE-AWARE so it never overflows a small host slot
 * (a sidebar cell, an icon-sized container). It measures the slot the host gave us:
 *   - narrow slot  → just a red alert icon; the full message is a click/hover popover.
 *   - roomy slot   → the icon + a short "Widget failed" label (still click for the full message).
 *
 * The popover is PERSISTENT (opens on hover/click, stays until its × is clicked — you can read/copy a
 * long "override unreachable" message) and is rendered through a PORTAL to `document.body`, so an
 * `overflow:hidden` ancestor (which small slots usually have) can't clip it.
 *
 * Deliberately dependency-free (inline SVG, inline styles, no UI/icon lib) — this package stays the
 * lean transport that survives qiankun retirement; it must not drag a component library into every host.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

/** Below this content-box width the notice collapses to icon-only. */
const COMPACT_MAX_WIDTH = 260
const DANGER = '#b91c1c'

function AlertIcon(): ReactElement {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: '0 0 auto', display: 'block' }}>
            <circle cx="8" cy="8" r="7" fill={DANGER} />
            <rect x="7.1" y="3.6" width="1.8" height="5" rx="0.9" fill="#fff" />
            <circle cx="8" cy="11.3" r="1" fill="#fff" />
        </svg>
    )
}

export function WidgetErrorNotice({ message }: { message: string }): ReactElement {
    const anchorRef = useRef<HTMLSpanElement>(null)
    const [compact, setCompact] = useState(false)
    const [open, setOpen] = useState(false)
    const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

    // Size-awareness: watch the slot the host gave us (our parent), collapse to icon-only when narrow.
    useEffect(() => {
        const parent = anchorRef.current?.parentElement
        if (!parent || typeof ResizeObserver === 'undefined') return
        const measure = (): void => setCompact(parent.clientWidth > 0 && parent.clientWidth < COMPACT_MAX_WIDTH)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(parent)
        return () => observer.disconnect()
    }, [])

    // Anchor the portaled popover to the icon (fixed coords) so it escapes any clipping ancestor.
    const openPopover = (): void => {
        const rect = anchorRef.current?.getBoundingClientRect()
        if (rect) {
            const width = 320
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
            setPos({ top: rect.bottom + 4, left })
        }
        setOpen(true)
    }

    return (
        <span
            ref={anchorRef}
            role="button"
            tabIndex={0}
            aria-label={`Widget failed: ${message}`}
            onMouseEnter={openPopover}
            onClick={openPopover}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    openPopover()
                }
            }}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: '100%',
                color: DANGER,
                font: '12px/1.4 system-ui, -apple-system, sans-serif',
                cursor: 'pointer',
            }}
        >
            <AlertIcon />
            {!compact && (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Widget failed</span>
            )}
            {open &&
                typeof document !== 'undefined' &&
                createPortal(
                    <div
                        role="dialog"
                        aria-label="Widget error details"
                        onClick={(event) => event.stopPropagation()}
                        style={{
                            position: 'fixed',
                            top: pos.top,
                            left: pos.left,
                            zIndex: 2147483647,
                            width: 320,
                            maxWidth: 'calc(100vw - 16px)',
                            background: '#fff',
                            color: '#1f2937',
                            border: '1px solid #e5e7eb',
                            borderRadius: 6,
                            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                            padding: '10px 32px 10px 12px',
                            font: '12px/1.5 system-ui, -apple-system, sans-serif',
                            wordBreak: 'break-word',
                        }}
                    >
                        <button
                            type="button"
                            aria-label="Close"
                            onClick={(event) => {
                                event.stopPropagation()
                                setOpen(false)
                            }}
                            style={{
                                position: 'absolute',
                                top: 4,
                                right: 6,
                                border: 'none',
                                background: 'none',
                                cursor: 'pointer',
                                fontSize: 16,
                                lineHeight: 1,
                                color: '#6b7280',
                            }}
                        >
                            ×
                        </button>
                        <strong style={{ display: 'block', color: DANGER, marginBottom: 4 }}>Widget failed</strong>
                        {message}
                    </div>,
                    document.body,
                )}
        </span>
    )
}
