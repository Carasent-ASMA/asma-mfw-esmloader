/**
 * `createDualLoader(FallbackLoader)` — the no-flag, per-app transport dispatch.
 *
 * Returns a component with the SAME props as `MfComponentLoader`. For each mount it reads the
 * server-injected signal (`window.__ASMA_PLATFORM__.apps[app.name].esm`): marked ⇒ render the
 * native-ESM `<EsmWidgetHost>`; unmarked / no payload ⇒ render the injected `FallbackLoader`
 * (today's `MfComponentLoader`) unchanged. Two apps can therefore use different transports on the
 * same page, and an app that hasn't shipped ESM widgets is byte-identically the old path.
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
import { createElement, type ComponentType, type ReactElement } from 'react'

import { EsmWidgetHost, type DualLoaderProps } from './EsmWidgetHost.js'
import { isEsmApp } from './platformSignal.js'

export function createDualLoader(
    FallbackLoader: ComponentType<DualLoaderProps>,
): (props: DualLoaderProps) => ReactElement {
    return function MfComponent(props: DualLoaderProps): ReactElement {
        if (props.app && isEsmApp(props.app.name)) {
            return createElement(EsmWidgetHost, props)
        }
        return createElement(FallbackLoader, props)
    }
}
