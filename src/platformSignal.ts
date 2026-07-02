/**
 * The per-app transport signal — read directly from the server-injected `window.__ASMA_PLATFORM__`
 * (asma-static-server, ASMA-7544). No registry enrichment, no global flag: the presence of an
 * `esm` marker on an app decides ESM vs qiankun, and it is decided by the artifact itself
 * (the static server sets it from `widgets.json` presence per app@version).
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-003, TASK-002
 */

/** One app entry in the injected platform payload. */
export interface PlatformApp {
    version: string
    /** CDN base for the app, e.g. `/cdn/asma-app-calendar/1.2.3/`. */
    base: string
    /** True when this app@version ships native-ESM widgets (server-derived from widgets.json presence). */
    esm?: boolean
    /** Absolute/rooted URL of the app's widgets.json, when known. */
    widgetsManifest?: string
}

/** The server-injected first-hit payload. */
export interface InjectedPlatform {
    default_app_versions?: Record<string, string>
    apps?: Record<string, PlatformApp>
}

/** Read `window.__ASMA_PLATFORM__`, qiankun-aware (`rawWindow`), undefined outside a browser. */
export function getInjectedPlatform(): InjectedPlatform | undefined {
    if (typeof window === 'undefined') {
        return undefined
    }
    const realWindow = (window as unknown as { rawWindow?: Window }).rawWindow ?? window
    return (realWindow as unknown as { __ASMA_PLATFORM__?: InjectedPlatform }).__ASMA_PLATFORM__
}

/** The platform entry for one app, or undefined if the app is absent / no platform injected. */
export function getAppSignal(appName: string): PlatformApp | undefined {
    return getInjectedPlatform()?.apps?.[appName]
}

/**
 * Should this app be loaded via native-ESM? True only when the injected payload marks the
 * app@version `esm`. Absent payload / unmarked app ⇒ false ⇒ caller falls back to qiankun.
 */
export function isEsmApp(appName: string): boolean {
    return getAppSignal(appName)?.esm === true
}
