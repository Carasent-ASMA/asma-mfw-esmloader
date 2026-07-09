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

import type { WidgetInstance, WidgetProps } from './contract.js'
import { loadAndMountEsmWidget } from './loadEsmWidget.js'
import { disableImportMapOverride, getAppSignal } from './platformSignal.js'
import type { RegisteredAppName, WidgetPathFor, WidgetPropsFor } from './registry.js'
import { WidgetErrorNotice } from './WidgetErrorNotice.js'

/**
 * A micro-app entry — a structural re-declaration of qiankun's `Entry`
 * (`asma-qiankun`'s `type Entry = string | { scripts?; styles?; html? }`). Re-declared, NOT imported,
 * so this package keeps ZERO qiankun dependency while staying assignment-compatible with the
 * `RegistrableApp`/`IMfComponentLoader` types the host passes in.
 */
export type WidgetEntry = string | { scripts?: string[]; styles?: string[]; html?: string }

/**
 * Reference to a target micro-app — structurally identical to the `app` field of `IMfComponentLoader`
 * (`{ name: string; entry: Entry }`). Kept as the loose (non-generic) alias for existing importers; the
 * generic narrowing lives in `DualLoaderProps<A, P>` below.
 */
export interface WidgetAppRef {
    name: string
    entry: WidgetEntry
}

/**
 * Props for the TRANSITION dual loader (`createDualLoader`) and the qiankun fallback — a structural
 * mirror of `IMfComponentLoader` so a swap is a rename. `app` is the `{ name, entry }` object qiankun
 * needs (entry = the fetch URL). Generic over the app name `A` and widget path `P`: a registered app +
 * one of its widgets narrows `props`; otherwise it stays loose (today's shape). For DIRECT ESM mounts
 * prefer {@link EsmWidgetHostProps}, whose `app` is just the (autocompleted) name.
 */
export interface DualLoaderProps<A extends string = string, P extends WidgetPathFor<A> = WidgetPathFor<A>> {
    app?: { name: A; entry: WidgetEntry }
    props: { component_path: P } & WidgetPropsFor<A, P>
    placeholder?: string
    className?: string
    disableWrapperStyles?: boolean
    LoaderComponent?: () => ReactElement
    controller?: AbortController
    onMounted?: () => void
    style?: CSSProperties
}

/**
 * How a DIRECT `<EsmWidgetHost>` caller names the target app: just the app NAME — autocompleted to the
 * registered apps (the ESM path resolves the app's base from `window.__ASMA_PLATFORM__` by name, so no
 * `entry` is needed) — OR the `{ name, entry }` object that `createDualLoader` forwards for qiankun
 * parity (there `entry` is the fetch URL; on the ESM path it is only an optional base-URL override).
 */
export type WidgetAppSelector<A extends string> = A | { name: A; entry?: WidgetEntry }

/**
 * Props for a DIRECT `<EsmWidgetHost>` mount — the destination API (vs the transition-only
 * {@link DualLoaderProps} that mirrors qiankun). `app` is the app NAME, and the generic defaults to the
 * registered apps so an editor autocompletes the concrete names (`'proof-directory'`, …); passing one
 * narrows `widget_name` + `props` to that app's widgets. An unregistered name stays loose.
 *
 * `widget_name` is the top-level, strongly-typed selector that DECIDES the `props` type — prefer it.
 * `props.component_path` is the legacy selector: still accepted so the transition wrappers keep working,
 * but is deprecated (see the tag on that member) and will be removed once all call sites pass `widget_name`.
 */
export interface EsmWidgetHostProps<A extends string = RegisteredAppName, P extends WidgetPathFor<A> = WidgetPathFor<A>> {
    app?: WidgetAppSelector<A>
    /** The widget to mount — narrowed to the app's registered widgets; decides the `props` type. */
    widget_name?: P
    props: WidgetPropsFor<A, P> & {
        /** @deprecated Legacy selector — pass the top-level `widget_name` prop instead. Removed once callers migrate. */
        component_path?: P
    }
    placeholder?: string
    className?: string
    disableWrapperStyles?: boolean
    LoaderComponent?: () => ReactElement
    controller?: AbortController
    onMounted?: () => void
    style?: CSSProperties
}

export function EsmWidgetHost<A extends string = RegisteredAppName, P extends WidgetPathFor<A> = WidgetPathFor<A>>({
    app,
    widget_name,
    props,
    placeholder,
    className,
    disableWrapperStyles,
    LoaderComponent,
    onMounted,
    style,
}: EsmWidgetHostProps<A, P>): ReactElement {
    const containerRef = useRef<HTMLDivElement>(null)
    // The strong A/P narrowing is a CALL-SITE contract; the transport layer is prop-agnostic, so
    // internally we carry the widget bag opaquely. Strip the legacy `component_path` selector out of the
    // payload — the widget's own entry injects its path, and the selector now travels as `widget_name`.
    const { component_path: legacyPath, ...mountProps } = props as WidgetProps & { component_path?: string }
    const instanceRef = useRef<WidgetInstance<typeof mountProps> | null>(null)
    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string>()
    // Set to the app name only when the failure was a dev override; drives the "disable override" button.
    const [failedOverrideApp, setFailedOverrideApp] = useState<string>()

    // `app` is either the bare name (direct ESM use) or the { name, entry } object (dual-loader forward).
    const appName = typeof app === 'string' ? app : app?.name
    // `widget_name` is the preferred selector; `component_path` inside props is the deprecated fallback.
    const componentPath = widget_name ?? legacyPath

    useEffect(() => {
        let cancelled = false

        if (!appName) {
            setError('EsmWidgetHost: no app provided')
            setState('error')
            return
        }
        if (!componentPath) {
            setError('EsmWidgetHost: no widget_name (or props.component_path) provided')
            setState('error')
            return
        }

        loadAndMountEsmWidget({
            appName,
            // A bare-string `app` carries no base URL (the ESM path resolves it from window.__ASMA_PLATFORM__);
            // only the object form's string `entry` is a usable base override (the qiankun html-entry object
            // form is irrelevant to the ESM path).
            appEntry: typeof app === 'string' ? undefined : typeof app?.entry === 'string' ? app.entry : undefined,
            componentPath,
            container: containerRef.current as HTMLElement,
            props: mountProps,
        })
            .then((instance) => {
                if (cancelled || !containerRef.current) {
                    instance.unmount()
                    return
                }
                instanceRef.current = instance as WidgetInstance<typeof mountProps>
                setState('ready')
                onMounted?.()
            })
            .catch((loadError: unknown) => {
                if (cancelled) return
                console.error(`EsmWidgetHost failed for ${appName}#${componentPath}`, loadError)
                // A `dev-override` signal means the base came from the import-map-overrides widget, not
                // the platform. The usual failure then is "override points at a dev server that isn't
                // running" — say so, and how to fix it, instead of a bare "Failed to fetch".
                const signal = getAppSignal(appName)
                const rawMessage = loadError instanceof Error ? loadError.message : String(loadError)
                const isDevOverride = signal?.version === 'dev-override'
                setFailedOverrideApp(isDevOverride ? appName : undefined)
                setError(
                    isDevOverride
                        ? `"${appName}" is served from a dev override at ${signal.base}, which is unreachable ` +
                          `(${rawMessage}). Start that dev server, or click "disable override" below to temporarily ` +
                          `disable this app in the import-map-overrides widget and reload automatically.`
                        : rawMessage,
                )
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
            instanceRef.current?.update(mountProps)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props])

    // Parity with MfComponentLoader's default `__asma_microapp_wrapper__` class (width/height 100%,
    // opt-out via `disableWrapperStyles`); the container leaf mirrors the wrapper box because under
    // qiankun the widget mounted directly into that single 100%-sized div.
    const wrapperStyle: CSSProperties | undefined = disableWrapperStyles
        ? style
        : { width: '100%', height: '100%', ...style }

    return (
        <div className={className} style={wrapperStyle}>
            {state === 'loading' ? (LoaderComponent ? <LoaderComponent /> : (placeholder ?? null)) : null}
            {state === 'error' ? (
                <WidgetErrorNotice
                    message={error ?? 'unknown error'}
                    appName={appName}
                    widgetName={componentPath}
                    widgetProps={mountProps}
                    onDisableOverride={
                        failedOverrideApp
                            ? () => {
                                  disableImportMapOverride(failedOverrideApp)
                                  window.location.reload()
                              }
                            : undefined
                    }
                />
            ) : null}
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </div>
    )
}
