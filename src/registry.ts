/**
 * The typed-widget registry — the compile-time contract for a DIRECT `<EsmWidgetHost>` mount.
 *
 * **Module-scoped, NOT global.** Each app augments it via `declare module 'asma-mfw-esmloader'`
 * (the industry-standard registry pattern — react-query `Register`, Redux `DefaultRootState`, Vue
 * `ComponentCustomProperties`), so there is zero global-namespace pollution. Empty by default ⇒
 * `keyof` is `never` ⇒ every app is unregistered ⇒ `EsmWidgetHost` degrades to today's loose shape
 * (any widget, any props), and the `createDualLoader` wrappers stay loose. Registration is opt-in PER APP.
 *
 * Populate it by COMPUTING from your app's `widgets` object — no codegen, no generated file:
 *
 *     // widgets.config.ts — the ONE list (build + types)
 *     export const widgets = { 'user-list': () => import('./widgets/UserListWidget'), … }
 *
 *     // widgets.contract.ts — 3 lines, once (not per widget)
 *     import type { RegistryFor } from 'asma-mfw-esmloader'
 *     import type { widgets } from './widgets.config'
 *     declare module 'asma-mfw-esmloader' {
 *         interface AsmaWidgetRegistry { 'asma-app-directory': RegistryFor<typeof widgets> }
 *     }
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-008
 */
import type { WidgetProps } from './contract.js'

export interface AsmaWidgetRegistry {}

/** Apps that have opted into typed widgets (empty registry ⇒ `never` ⇒ all apps stay loose). */
export type RegisteredAppName = keyof AsmaWidgetRegistry & string

/** Widget-selector options for app `A`: its registered widgets, or any string if `A` isn't registered. */
export type WidgetPathFor<A extends string> = A extends RegisteredAppName ? keyof AsmaWidgetRegistry[A] & string : string

/** Props for app `A` + widget `P`: the widget's declared props, else the loose (any-object) contract. */
export type WidgetPropsFor<A extends string, P extends string> = A extends RegisteredAppName
    ? P extends keyof AsmaWidgetRegistry[A]
        ? AsmaWidgetRegistry[A][P]
        : WidgetProps
    : WidgetProps

/**
 * The props of the widget that a loader thunk (`() => import('./entry')`) resolves to — extracted from
 * the entry module's `mount(container, props)`. This is what lets the registry be COMPUTED from the
 * `widgets` object instead of generated: the widget component stays the single source of truth.
 */
export type WidgetPropsOf<L> = L extends () => Promise<infer M>
    ? M extends { mount: (container: HTMLElement, props: infer P) => unknown }
        ? P
        : never
    : never

/**
 * Compute an app's registry entry from its `widgets` object (`name → () => import('./entry')`) — the
 * single source of truth shared with the widget build. Use inside a `declare module` augmentation:
 * `interface AsmaWidgetRegistry { 'asma-app-directory': RegistryFor<typeof widgets> }`.
 */
export type RegistryFor<W> = { [K in keyof W]: WidgetPropsOf<W[K]> }
