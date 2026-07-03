/**
 * asma-mfw-esmloader — the transport-agnostic widget loader that supersedes
 * asma-qiankun-react-loader. Loads widgets by `import()`ing an ES module exporting `mount()`;
 * `createDualLoader` dispatches per-app between this and the legacy qiankun loader with no flag.
 *
 * `./contract` is a separate entry (what an app's widget build imports — `defineReactWidget` +
 * types) so widget bundles don't pull the host/loader code.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md
 */
export { createDualLoader } from './createDualLoader.js'
export {
    EsmWidgetHost,
    type DualLoaderProps,
    type EsmWidgetHostProps,
    type WidgetAppRef,
    type WidgetAppSelector,
    type WidgetEntry,
} from './EsmWidgetHost.js'
export { loadAndMountEsmWidget } from './loadEsmWidget.js'
export { IMPORT_MAP_OVERRIDE_PREFIX, IMPORT_MAP_OVERRIDES_DISABLED_KEY, getAppSignal, getInjectedPlatform, isEsmApp, type InjectedPlatform, type PlatformApp } from './platformSignal.js'
export {
    clearManifestCache,
    fetchManifest,
    resolveEntry,
    resolveWidget,
    type ResolvedWidget,
    type WidgetManifest,
    type WidgetManifestEntry,
} from './widgetsManifest.js'
export { ensureStylesheets, type CssDoc } from './cssInsertion.js'

export type { WidgetInstance, WidgetModule, WidgetProps } from './contract.js'

// The typed-widget registry (module-scoped — apps augment via `declare module 'asma-mfw-esmloader'`).
// `AsmaWidgetRegistry` is declared here at the package root so the augmentation merges; the computed-type
// helpers (`RegistryFor`/`WidgetPropsOf`) let an app derive its entry from its `widgets` object.
export type {
    AsmaWidgetRegistry,
    RegisteredAppName,
    RegistryFor,
    WidgetPathFor,
    WidgetPropsFor,
    WidgetPropsOf,
} from './registry.js'
