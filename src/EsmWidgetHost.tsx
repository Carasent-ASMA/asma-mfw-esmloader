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

/**
 * A micro-app entry — a structural re-declaration of qiankun's `Entry`
 * (`asma-qiankun`'s `type Entry = string | { scripts?; styles?; html? }`). Re-declared, NOT imported,
 * so this package keeps ZERO qiankun dependency while staying assignment-compatible with the
 * `RegistrableApp`/`IMfComponentLoader` types the host passes in.
 */
export type WidgetEntry = string | { scripts?: string[]; styles?: string[]; html?: string }

/**
 * The typed-widget registry — the compile-time contract that gives a DIRECT `<EsmWidgetHost>` caller
 * autocomplete on `app` (the app name), on `component_path` (narrowed to that app's widgets), and on the
 * widget's `props`. It is an OPEN interface each micro-app augments via declaration merging, e.g. from its
 * generated `widgets.d.ts`:
 *
 *     declare global {
 *         interface AsmaWidgetRegistry {
 *             directory: { 'user-list': import('...').Props; 'user-detail': import('...').Props }
 *         }
 *     }
 *
 * Empty by default ⇒ `keyof` is `never` ⇒ every app is "unregistered" ⇒ `EsmWidgetHost` degrades to
 * exactly today's permissive shape (any `component_path`, any props). Registration is opt-in PER APP:
 * an app that hasn't augmented — or a caller passing a non-literal `app.name` (e.g. a `RegistrableApp`
 * from the registry, which the 89 host wrappers do) — keeps the loose contract, so nothing existing breaks.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-002
 */
declare global {
    interface AsmaWidgetRegistry {}
}

/** Apps that have opted into typed widgets (empty registry ⇒ `never` ⇒ all apps stay loose). */
type RegisteredAppName = keyof AsmaWidgetRegistry & string

/** `component_path` options for app `A`: its registered widgets, or any string if `A` isn't registered. */
type WidgetPathFor<A extends string> = A extends RegisteredAppName ? keyof AsmaWidgetRegistry[A] & string : string

/** Extra props for app `A` + path `P`: the widget's declared props, else the loose (any-object) contract. */
type WidgetPropsFor<A extends string, P extends string> = A extends RegisteredAppName
    ? P extends keyof AsmaWidgetRegistry[A]
        ? AsmaWidgetRegistry[A][P]
        : WidgetProps
    : WidgetProps

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
 * narrows `component_path` + `props` to that app's widgets. An unregistered name stays loose.
 */
export interface EsmWidgetHostProps<A extends string = RegisteredAppName, P extends WidgetPathFor<A> = WidgetPathFor<A>> {
    app?: WidgetAppSelector<A>
    props: { component_path: P } & WidgetPropsFor<A, P>
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
    props,
    placeholder,
    className,
    LoaderComponent,
    onMounted,
    style,
}: EsmWidgetHostProps<A, P>): ReactElement {
    const containerRef = useRef<HTMLDivElement>(null)
    // The strong A/P narrowing is a CALL-SITE contract; the transport layer is prop-agnostic, so
    // internally we carry the widget bag opaquely — mount()/update() just forward it.
    const runtimeProps = props as { component_path: string } & WidgetProps
    const instanceRef = useRef<WidgetInstance<typeof runtimeProps> | null>(null)
    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string>()

    // `app` is either the bare name (direct ESM use) or the { name, entry } object (dual-loader forward).
    const appName = typeof app === 'string' ? app : app?.name
    const componentPath = runtimeProps.component_path

    useEffect(() => {
        let cancelled = false

        if (!appName) {
            setError('EsmWidgetHost: no app provided')
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
            props: runtimeProps,
        })
            .then((instance) => {
                if (cancelled || !containerRef.current) {
                    instance.unmount()
                    return
                }
                instanceRef.current = instance as WidgetInstance<typeof runtimeProps>
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
            instanceRef.current?.update(runtimeProps)
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
