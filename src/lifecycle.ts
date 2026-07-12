/**
 * Widget readiness lifecycle — the OPTIONAL host↔widget "I have finished loading" contract that rides
 * on top of the mount contract (./contract).
 *
 * A readiness-aware host — e.g. the app-shell's `WidgetSlot`, which covers a widget with a skeleton
 * until it is ready — passes an `onReady` callback in the widget's mount props. The widget calls it
 * ONCE when its first meaningful content is painted (data loaded and rendered, or an intentional empty
 * state). The host then reveals it precisely, instead of guessing from the DOM. A widget that never
 * calls `onReady` still works — the host falls back to its own heuristic — so adoption is per-widget,
 * and this is a no-op when the widget is mounted outside a readiness-aware host.
 *
 * Authoring: define the widget entry with {@link defineWidget} (the lifecycle-aware replacement for
 * `defineReactWidget`), then in the leaf that owns the loading state call
 * `useMarkWidgetReady(!isLoading)`. A widget with no async data behind its first paint passes
 * `{ readyOnMount: true }` instead.
 *
 * @see _docs/frontend/architecture/2026-07-02-15-40-architecture-widget-taxonomy-and-composition.md —
 *      "Widget readiness lifecycle (onReady)"
 */
import {
    createContext,
    createElement,
    useContext,
    useEffect,
    useMemo,
    useRef,
    type ComponentType,
    type ReactElement,
} from 'react'

import { defineReactWidget, type WidgetModule } from './contract.js'

export interface AsmaWidgetLifecycleProps {
    /**
     * Host readiness callback: called ONCE, when the widget's first meaningful content is painted (data
     * loaded and rendered, or an intentional empty state). Optional — absent outside a readiness-aware
     * host. Crosses the micro-frontend boundary as a live function reference (same JS realm under both
     * the qiankun and ESM transports), so nothing is serialized.
     */
    onReady?: () => void
}

const WidgetLifecycleContext = createContext<AsmaWidgetLifecycleProps>({})

/**
 * Latching readiness marker for the leaf that owns the widget's loading state — call with `true` once
 * the first meaningful render is on screen (e.g. `useMarkWidgetReady(!isLoading)`). Fires the host's
 * `onReady` exactly once; later flips back to `false` (refetches) are ignored. No-op outside a
 * readiness-aware host (or a widget not defined via {@link defineWidget}).
 */
export function useMarkWidgetReady(ready: boolean): void {
    const { onReady } = useContext(WidgetLifecycleContext)
    const fired = useRef(false)

    useEffect(() => {
        if (!ready || fired.current) return
        fired.current = true
        onReady?.()
    }, [ready, onReady])
}

/** Fires readiness right after the first paint — for a widget with no async data behind its UI. */
function ReadyOnMount(): null {
    useMarkWidgetReady(true)
    return null
}

export interface DefineWidgetOptions {
    /**
     * The widget's first paint IS its meaningful content (no async data before it) — mark ready right
     * after mount. Omit for data-driven widgets and call `useMarkWidgetReady(!isLoading)` in the leaf
     * that owns the loading state instead.
     */
    readyOnMount?: boolean
}

/**
 * Lifecycle-aware widget definition: the same mount contract as `defineReactWidget`, plus the widget
 * readiness lifecycle. It adds {@link AsmaWidgetLifecycleProps} to the widget's mount props (so the
 * typed registry advertises `onReady` to hosts) and provides it via context, so any leaf in the tree
 * can call {@link useMarkWidgetReady} without prop drilling.
 *
 * Prefer this over `defineReactWidget` for any widget hosted in a readiness-aware surface.
 */
export function defineWidget<P extends object>(
    Component: ComponentType<P>,
    options?: DefineWidgetOptions,
): WidgetModule<P & AsmaWidgetLifecycleProps> {
    function LifecycleWidget(props: P & AsmaWidgetLifecycleProps): ReactElement {
        const { onReady, ...rest } = props
        const value = useMemo(() => ({ onReady }), [onReady])

        return createElement(
            WidgetLifecycleContext.Provider,
            { value },
            options?.readyOnMount ? createElement(ReadyOnMount) : null,
            createElement(Component, rest as unknown as P),
        )
    }

    return defineReactWidget(LifecycleWidget)
}
