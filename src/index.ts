/**
 * asma-mfw-esmloader — the transport-agnostic widget loader that supersedes
 * asma-qiankun-react-loader. Loads widgets by `import()`ing an ES module exporting `mount()`;
 * `createDualLoader` dispatches per-app between this and the legacy qiankun loader with no flag.
 *
 * `./contract` is a separate entry (what an app's widget build imports — `defineReactWidget` +
 * types) so widget bundles don't pull the host/loader code. The widget-AUTHORING surface (including
 * the readiness lifecycle) is ALSO re-exported here from the base entry, so a widget can author from
 * the single externalized `asma-mfw-esmloader` specifier without a subpath (one shared runtime chunk).
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md
 */
export { createDualLoader } from './createDualLoader.js'

// Widget authoring surface (base entry — see note above). `defineReactWidget` is the raw primitive;
// `defineWidget` is the lifecycle-aware form that also carries the `onReady` readiness contract.
export { defineReactWidget } from './contract.js'
export {
    defineWidget,
    useMarkWidgetReady,
    type AsmaWidgetLifecycleProps,
    type DefineWidgetOptions,
} from './lifecycle.js'
export {
    EsmWidgetHost,
    type DualLoaderProps,
    type EsmWidgetHostProps,
    type WidgetAppRef,
    type WidgetAppSelector,
    type WidgetEntry,
} from './EsmWidgetHost.js'
export { loadAndMountEsmWidget } from './loadEsmWidget.js'
export {
    IMPORT_MAP_OVERRIDE_PREFIX,
    IMPORT_MAP_OVERRIDES_DISABLED_KEY,
    clearOverrideTransportCache,
    disableImportMapOverride,
    getAppSignal,
    getInjectedPlatform,
    isEsmApp,
    peekOverrideTransport,
    resolveOverrideTransport,
    type InjectedPlatform,
    type OverrideTransport,
    type PlatformApp,
} from './platformSignal.js'
export {
    ManifestFormatError,
    ManifestHttpError,
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
