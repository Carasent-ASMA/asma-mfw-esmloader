/**
 * asma-widget-loader — the transport-agnostic widget loader that supersedes
 * asma-qiankun-react-loader. Loads widgets by `import()`ing an ES module exporting `mount()`;
 * `createDualLoader` dispatches per-app between this and the legacy qiankun loader with no flag.
 *
 * `./contract` is a separate entry (what an app's widget build imports — `defineReactWidget` +
 * types) so widget bundles don't pull the host/loader code.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md
 */
export { createDualLoader } from './createDualLoader.js'
export { EsmWidgetHost, type DualLoaderProps, type WidgetAppRef } from './EsmWidgetHost.js'
export { loadAndMountEsmWidget } from './loadEsmWidget.js'
export { getAppSignal, getInjectedPlatform, isEsmApp, type InjectedPlatform, type PlatformApp } from './platformSignal.js'
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
