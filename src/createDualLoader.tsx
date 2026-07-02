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
 * Usage (in each host app, one file):
 *   import { MfComponentLoader } from 'asma-qiankun-react-loader/lib'
 *   import { createDualLoader } from 'asma-widget-loader'
 *   export const MfComponent = createDualLoader(MfComponentLoader)
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-001/002/003, TASK-004
 */
import { createElement, type ComponentType, type ReactElement } from 'react'

import { EsmWidgetHost, type DualLoaderProps } from './EsmWidgetHost.js'
import { isEsmApp } from './platformSignal.js'

export function createDualLoader(
    FallbackLoader: ComponentType<DualLoaderProps<Record<string, unknown>>>,
): (props: DualLoaderProps<Record<string, unknown>>) => ReactElement {
    return function MfComponent(props: DualLoaderProps<Record<string, unknown>>): ReactElement {
        if (props.app && isEsmApp(props.app.name)) {
            return <EsmWidgetHost {...props} />
        }
        return createElement(FallbackLoader, props)
    }
}
