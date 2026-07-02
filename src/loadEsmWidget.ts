/**
 * Load a widget's ES module and mount it — the transport half of the ESM path.
 *
 * Resolves `component_path → { entryUrl, css[] }` from the app's widgets.json, inserts the css
 * (dedup'd), `import()`s the entry, and calls its exported `mount()`. No qiankun, no window
 * lifecycle, no LoaderQueue — the browser module cache dedupes by URL and each mount owns its
 * own root, so concurrent same-app mounts are safe by construction.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-004/006/007, TASK-002
 */
import type { WidgetInstance, WidgetModule, WidgetProps } from './contract.js'
import { ensureStylesheets } from './cssInsertion.js'
import { getAppSignal } from './platformSignal.js'
import { resolveWidget } from './widgetsManifest.js'

/** Resolve the app's CDN base: an explicit entry (from the caller's `app`) wins, else the platform signal. */
function resolveBase(appName: string, appEntry?: string): { base: string; manifestUrl?: string } {
    if (appEntry) {
        return { base: appEntry, manifestUrl: getAppSignal(appName)?.widgetsManifest }
    }
    const signal = getAppSignal(appName)
    if (!signal) {
        throw new Error(`No platform entry for app '${appName}' — cannot resolve its ESM base`)
    }
    return { base: signal.base, manifestUrl: signal.widgetsManifest }
}

/**
 * Load + mount an ESM widget. Inserts css before mount; returns the widget instance.
 * Throws (rejects) if the app/widget can't be resolved or the module fails to import — the
 * caller (EsmWidgetHost) turns that into the same not-found UX as the legacy fallback.
 */
export async function loadAndMountEsmWidget<P extends WidgetProps>(args: {
    appName: string
    appEntry?: string
    componentPath: string
    container: HTMLElement
    props: P
}): Promise<WidgetInstance<P>> {
    const { appName, appEntry, componentPath, container, props } = args

    const { base, manifestUrl } = resolveBase(appName, appEntry)
    const { entryUrl, css } = await resolveWidget(base, componentPath, manifestUrl)

    ensureStylesheets(css)

    const module_ = (await import(/* @vite-ignore */ entryUrl)) as WidgetModule<P>
    if (typeof module_.mount !== 'function') {
        throw new Error(`Widget entry ${entryUrl} does not export mount()`)
    }
    return module_.mount(container, props)
}
