/**
 * <EsmWidgetHost/> — the native-ESM branch of the dual loader (the MfComponentLoader successor
 * for migrated apps). Same UX contract as MfComponentLoader — container-per-widget, placeholder /
 * LoaderComponent, update-in-place on prop change, abort-on-unmount, onMounted — but the widget
 * arrives via `import()` of an ES module that exports `mount()`, not qiankun.
 *
 * Kept deliberately: the container div stays a LEAF for the host's React (loading/error render as
 * SIBLINGS), else the widget's own root and the host fight over childNodes (removeChild NotFoundError).
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-004/005/007
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react'

import type { WidgetInstance } from './contract.js'
import { loadAndMountEsmWidget } from './loadEsmWidget.js'

/** Reference to a target micro-app — matches the shape MfComponentLoader receives from the registry. */
export interface WidgetAppRef {
    name: string
    /** The app's CDN base; when absent, resolved from `window.__ASMA_PLATFORM__`. */
    entry?: string
}

/** Props shared by both loaders — a superset-compatible mirror of `IMfComponentLoader` so a swap is a rename. */
export interface DualLoaderProps<T extends object = Record<string, never>> {
    app?: WidgetAppRef
    props: { component_path: string } & T
    placeholder?: string
    className?: string
    disableWrapperStyles?: boolean
    LoaderComponent?: () => ReactElement | null
    controller?: AbortController
    onMounted?: () => void
    style?: CSSProperties
}

export function EsmWidgetHost<T extends object>({
    app,
    props,
    placeholder,
    className,
    LoaderComponent,
    onMounted,
    style,
}: DualLoaderProps<T>): ReactElement {
    const containerRef = useRef<HTMLDivElement>(null)
    const instanceRef = useRef<WidgetInstance<typeof props> | null>(null)
    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string>()

    const appName = app?.name
    const componentPath = props.component_path

    useEffect(() => {
        let cancelled = false

        if (!appName) {
            setError('EsmWidgetHost: no app provided')
            setState('error')
            return
        }

        loadAndMountEsmWidget({
            appName,
            appEntry: app?.entry,
            componentPath,
            container: containerRef.current as HTMLElement,
            props,
        })
            .then((instance) => {
                if (cancelled || !containerRef.current) {
                    instance.unmount()
                    return
                }
                instanceRef.current = instance as WidgetInstance<typeof props>
                setState('ready')
                onMounted?.()
            })
            .catch((loadError: unknown) => {
                if (cancelled) return
                console.error(`EsmWidgetHost failed for ${appName}#${componentPath}`, loadError)
                setError(loadError instanceof Error ? loadError.message : String(loadError))
                setState('error')
            })

        return () => {
            cancelled = true
            instanceRef.current?.unmount()
            instanceRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appName, componentPath])

    // Update-in-place — the equivalent of today's loadedApp.update({ component_path, ...props }).
    useEffect(() => {
        if (state === 'ready') {
            instanceRef.current?.update(props)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props])

    return (
        <div className={className} style={style}>
            {state === 'loading' ? (LoaderComponent ? <LoaderComponent /> : (placeholder ?? null)) : null}
            {state === 'error' ? <span style={{ color: '#b91c1c' }}>widget failed: {error}</span> : null}
            <div ref={containerRef} />
        </div>
    )
}
