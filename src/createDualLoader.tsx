/**
 * `createDualLoader(FallbackLoader)` — the no-flag, per-app transport dispatch.
 *
 * Returns a component with the SAME props as `MfComponentLoader`. For each mount it reads the
 * server-injected signal (`window.__ASMA_PLATFORM__.apps[app.name].esm`): marked ⇒ render the
 * native-ESM `<EsmWidgetHost>`; unmarked / no payload ⇒ render the injected `FallbackLoader`
 * (today's `MfComponentLoader`) unchanged. Two apps can therefore use different transports on the
 * same page, and an app that hasn't shipped ESM widgets is byte-identically the old path.
 *
 * Dev overrides: an app under an `import-map-override:` key is dispatched by PROBING `widgets.json`
 * at the override base (see `resolveOverrideTransport` — RISK-005), because the same key also
 * overrides the qiankun entry — so overriding works for both old- and new-architecture dev servers.
 *
 * The legacy loader is INJECTED (not imported) so this package keeps ZERO qiankun dependency —
 * it is the package that survives when qiankun is retired.
 *
 * @deprecated Transition-only. The dual loader exists ONLY to run qiankun and native-ESM widgets
 * side by side while apps migrate — it is scaffolding, not the destination. The endgame is to call
 * {@link EsmWidgetHost} directly (qiankun retired, no fallback, no `window.__ASMA_PLATFORM__` probe).
 * Prefer `EsmWidgetHost` for any NEW code, and once an app's widgets are all ESM, replace its
 * `MfComponent` with `EsmWidgetHost` and delete the wrapper. `EsmWidgetHost` also carries the strong
 * per-widget typing (see {@link AsmaWidgetRegistry}); the dual loader stays loose for drop-in parity.
 *
 * Migration (from a dual-loader call site to the final form):
 * ```tsx
 * // transition (this loader) — dispatches per app, loose props:
 * <MfComponent app={app} props={{ component_path, ...props }} />
 *
 * // final — direct, strongly typed once the app augments AsmaWidgetRegistry:
 * import { EsmWidgetHost } from 'asma-mfw-esmloader'
 * <EsmWidgetHost app={{ name: 'directory', entry }} props={{ component_path: 'user-list', userId }} />
 * ```
 *
 * Transition usage (in each host app, one file):
 *   import { MfComponentLoader } from 'asma-qiankun-react-loader/lib'
 *   import { createDualLoader } from 'asma-mfw-esmloader'
 *   export const MfComponent = createDualLoader(MfComponentLoader)
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-001/002/003, TASK-004
 */
import { createElement, useEffect, useState, type ComponentType, type ReactElement } from 'react'

import { EsmWidgetHost, type DualLoaderProps } from './EsmWidgetHost.js'
import { getAppSignal, isEsmApp, peekOverrideTransport, resolveOverrideTransport } from './platformSignal.js'

export function createDualLoader(
    FallbackLoader: ComponentType<DualLoaderProps>,
): (props: DualLoaderProps) => ReactElement {
    return function MfComponent(props: DualLoaderProps): ReactElement {
        const appName = props.app?.name
        const signal = appName ? getAppSignal(appName) : undefined
        // A dev override is transport-ambiguous — the same localStorage key also drives the qiankun
        // entry override — so dispatch on the probed widgets.json verdict, not the optimistic `esm`
        // mark (RISK-005). The probe-verdict cache is the source of truth; state only triggers the
        // re-render once the (per-base, once-per-page) probe settles.
        const overrideBase = signal?.version === 'dev-override' ? signal.base : undefined
        const verdict = overrideBase ? peekOverrideTransport(overrideBase) : undefined
        const [, rerenderOnProbe] = useState(0)
        useEffect(() => {
            if (!overrideBase || verdict) return
            let cancelled = false
            void resolveOverrideTransport(overrideBase).then(() => {
                if (!cancelled) rerenderOnProbe((tick) => tick + 1)
            })
            return () => {
                cancelled = true
            }
        }, [overrideBase, verdict])

        if (props.app && overrideBase) {
            if (!verdict) {
                // Probing (one dev-only localhost round-trip) — render the caller's pending UX meanwhile.
                return createElement(
                    'div',
                    { className: props.className, style: props.style },
                    props.LoaderComponent ? createElement(props.LoaderComponent) : (props.placeholder ?? null),
                )
            }
            return verdict === 'esm' ? createElement(EsmWidgetHost, props) : createElement(FallbackLoader, props)
        }
        if (props.app && isEsmApp(props.app.name)) {
            return createElement(EsmWidgetHost, props)
        }
        return createElement(FallbackLoader, props)
    }
}
