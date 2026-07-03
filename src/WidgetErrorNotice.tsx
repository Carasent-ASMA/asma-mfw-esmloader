/**
 * The error state for a failed widget mount — SIZE-AWARE so it never overflows a small host slot
 * (a sidebar cell, an icon-sized container). It measures the slot the host gave us:
 *   - narrow slot  → just a red alert icon; the full detail is a click/hover popover.
 *   - roomy slot   → the icon + a short "Widget failed" label (still click for the detail).
 *
 * The popover is PERSISTENT (opens on hover/click, stays until its × is clicked — you can read/copy a
 * long "override unreachable" message) and is rendered through a PORTAL to `document.body`, so an
 * `overflow:hidden` ancestor (which small slots usually have) can't clip it. It shows WHICH widget
 * failed (app + widget name) and the props that were passed, so a failure is diagnosable in place.
 *
 * Deliberately dependency-free (inline SVG, inline styles, no UI/icon lib) — this package stays the
 * lean transport that survives qiankun retirement; it must not drag a component library into every host.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

/** Below this content-box width the notice collapses to icon-only. */
const COMPACT_MAX_WIDTH = 260
const POPOVER_WIDTH = 340
const DANGER = '#b91c1c'
const MUTED = '#6b7280'
const INK = '#1f2937'

export interface WidgetErrorNoticeProps {
    message: string
    appName?: string
    widgetName?: string
    /** The props that were passed to the widget (rendered read-only for diagnosis). */
    widgetProps?: Record<string, unknown>
}

/** A short, safe, single-line rendering of a prop value (handles functions / circular / long values). */
function formatValue(value: unknown): string {
    if (typeof value === 'string') return value.length > 120 ? `${JSON.stringify(value.slice(0, 120))}…` : JSON.stringify(value)
    if (typeof value === 'function') return `ƒ ${value.name || 'anonymous'}()`
    if (typeof value === 'bigint') return `${value}n`
    if (typeof value === 'symbol') return value.toString()
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (typeof value === 'object') {
        try {
            const json = JSON.stringify(value)
            return json.length > 120 ? `${json.slice(0, 120)}…` : json
        } catch {
            return Array.isArray(value) ? `Array(${value.length})` : '{…}'
        }
    }
    return String(value)
}

function AlertIcon(): ReactElement {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flex: '0 0 auto', display: 'block' }}>
            <circle cx="8" cy="8" r="7" fill={DANGER} />
            <rect x="7.1" y="3.6" width="1.8" height="5" rx="0.9" fill="#fff" />
            <circle cx="8" cy="11.3" r="1" fill="#fff" />
        </svg>
    )
}

const labelStyle: CSSProperties = { color: MUTED, fontWeight: 600, whiteSpace: 'nowrap' }
const monoStyle: CSSProperties = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }

function MetaRow({ label, value }: { label: string; value: string }): ReactElement {
    return (
        <>
            <span style={labelStyle}>{label}</span>
            <span style={{ ...monoStyle, color: INK }}>{value}</span>
        </>
    )
}

export function WidgetErrorNotice({ message, appName, widgetName, widgetProps }: WidgetErrorNoticeProps): ReactElement {
    const anchorRef = useRef<HTMLSpanElement>(null)
    const [compact, setCompact] = useState(false)
    const [open, setOpen] = useState(false)
    const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number }>({
        left: 0,
        top: 0,
        maxHeight: 480,
    })

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

    // Anchor the portaled popover to the icon (fixed coords), flipping above/below to whichever side has
    // room, so it escapes clipping ancestors and never runs off the viewport.
    const openPopover = (): void => {
        const rect = anchorRef.current?.getBoundingClientRect()
        if (rect) {
            const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8))
            const spaceBelow = window.innerHeight - rect.bottom
            const spaceAbove = rect.top
            const below = spaceBelow >= 220 || spaceBelow >= spaceAbove
            setPos(
                below
                    ? { left, top: rect.bottom + 4, maxHeight: spaceBelow - 12 }
                    : { left, bottom: window.innerHeight - rect.top + 4, maxHeight: spaceAbove - 12 },
            )
        }
        setOpen(true)
    }

    const propEntries = widgetProps ? Object.entries(widgetProps) : []

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
                            left: pos.left,
                            ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
                            zIndex: 2147483647,
                            width: POPOVER_WIDTH,
                            maxWidth: 'calc(100vw - 16px)',
                            maxHeight: pos.maxHeight,
                            overflowY: 'auto',
                            background: '#fff',
                            color: INK,
                            border: '1px solid #e5e7eb',
                            borderRadius: 8,
                            boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
                            font: '12px/1.5 system-ui, -apple-system, sans-serif',
                        }}
                    >
                        {/* header */}
                        <div
                            style={{
                                position: 'sticky',
                                top: 0,
                                background: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '10px 12px',
                                borderBottom: '1px solid #f0f0f0',
                            }}
                        >
                            <AlertIcon />
                            <strong style={{ color: DANGER, flex: 1 }}>Widget failed</strong>
                            <button
                                type="button"
                                aria-label="Close"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    setOpen(false)
                                }}
                                style={{
                                    border: 'none',
                                    background: 'none',
                                    cursor: 'pointer',
                                    fontSize: 16,
                                    lineHeight: 1,
                                    color: MUTED,
                                    padding: 0,
                                }}
                            >
                                ×
                            </button>
                        </div>

                        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {/* which widget */}
                            {(appName || widgetName) && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', alignItems: 'baseline' }}>
                                    {appName ? <MetaRow label="App" value={appName} /> : null}
                                    {widgetName ? <MetaRow label="Widget" value={widgetName} /> : null}
                                </div>
                            )}

                            {/* the error */}
                            <div style={{ color: INK, wordBreak: 'break-word' }}>{message}</div>

                            {/* props passed */}
                            <div>
                                <div style={{ ...labelStyle, marginBottom: 4 }}>
                                    Props{propEntries.length ? '' : ' — none'}
                                </div>
                                {propEntries.length > 0 && (
                                    <div
                                        style={{
                                            background: '#f9fafb',
                                            border: '1px solid #f0f0f0',
                                            borderRadius: 6,
                                            padding: '6px 8px',
                                            display: 'grid',
                                            gridTemplateColumns: 'auto 1fr',
                                            gap: '2px 10px',
                                        }}
                                    >
                                        {propEntries.map(([key, value]) => (
                                            <MetaRow key={key} label={key} value={formatValue(value)} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </span>
    )
}
