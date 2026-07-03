/**
 * The per-app transport signal — read directly from the server-injected `window.__ASMA_PLATFORM__`
 * (asma-static-server, ASMA-7544). No registry enrichment, no global flag: the presence of an
 * `esm` marker on an app decides ESM vs qiankun, and it is decided by the artifact itself
 * (the static server sets it from `widgets.json` presence per app@version).
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-003, TASK-002
 */
import { fetchManifest, ManifestHttpError } from './widgetsManifest.js'

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

/**
 * The SAME localStorage schema the single-spa `import-map-overrides` widget writes (and that
 * `asma-qiankun-react-loader` already reads to override a qiankun app's entry): `import-map-override:<app>`
 * holds a bare base-URL string, `import-map-overrides-disabled` holds a JSON array of temporarily
 * disabled app names. We reuse it verbatim — ONE overrides widget drives both transports, no parallel key.
 */
export const IMPORT_MAP_OVERRIDE_PREFIX = 'import-map-override:'
export const IMPORT_MAP_OVERRIDES_DISABLED_KEY = 'import-map-overrides-disabled'

/**
 * A dev override base for an app, from the import-map-overrides widget — unless the app is in the
 * widget's disabled list. Survives reloads (a console-set `__ASMA_PLATFORM__` does not), so a
 * hard-cutover app stays testable where no platform is injected (e.g. local shell dev). The value is
 * a plain URL string (single-spa convention), NOT JSON. Undefined if unset/disabled/storage-blocked.
 */
function getImportMapOverrideBase(appName: string): string | undefined {
    if (typeof localStorage === 'undefined') return undefined
    try {
        const base = localStorage.getItem(IMPORT_MAP_OVERRIDE_PREFIX + appName)
        if (!base) return undefined
        const disabledRaw = localStorage.getItem(IMPORT_MAP_OVERRIDES_DISABLED_KEY)
        if (disabledRaw) {
            const disabled: unknown = JSON.parse(disabledRaw)
            if (Array.isArray(disabled) && disabled.includes(appName)) return undefined
        }
        return base
    } catch {
        return undefined // invalid JSON / storage blocked — behave as if no override
    }
}

/**
 * The platform entry for one app. An active import-map-override wins (dev): the overridden app is
 * OPTIMISTICALLY treated as native-ESM with `widgets.json` at the override base — so the ESM path is
 * testable in a shell with no injected platform. Otherwise the server-injected `__ASMA_PLATFORM__` entry.
 *
 * NOTE (transition semantic): the override key is TRANSPORT-AMBIGUOUS — `qiankun-overrides` applies
 * the SAME key to the qiankun app's entry, so the base alone can't say which architecture the dev
 * server speaks. The dual loader disambiguates via {@link resolveOverrideTransport} before mounting.
 * (Adding the app to the widget's disabled list does NOT route it to qiankun-with-override: the
 * qiankun side honors the disabled list too and falls back to the default entry.)
 */
export function getAppSignal(appName: string): PlatformApp | undefined {
    const overrideBase = getImportMapOverrideBase(appName)
    if (overrideBase) {
        return { version: 'dev-override', base: overrideBase, esm: true }
    }
    return getInjectedPlatform()?.apps?.[appName]
}

/**
 * Should this app be loaded via native-ESM? True only when the injected payload marks the
 * app@version `esm`. Absent payload / unmarked app ⇒ false ⇒ caller falls back to qiankun.
 */
export function isEsmApp(appName: string): boolean {
    return getAppSignal(appName)?.esm === true
}

/** Transport verdict for a dev-override base, decided by probing its `widgets.json`. */
export type OverrideTransport = 'esm' | 'qiankun'

const overrideTransportCache = new Map<string, OverrideTransport>()

/** Reset the probe-verdict cache (tests). */
export function clearOverrideTransportCache(): void {
    overrideTransportCache.clear()
}

/** The already-probed verdict for a base, if any — lets the dual loader dispatch synchronously on re-mounts. */
export function peekOverrideTransport(base: string): OverrideTransport | undefined {
    return overrideTransportCache.get(base)
}

/**
 * Decide the transport for a dev-override base by probing its `widgets.json` (RISK-005 mitigation).
 * Manifest served ⇒ `esm` (and the fetch is cached, so the ESM path's own resolve reuses it).
 * HTTP error ⇒ `qiankun` — an old-architecture dev server; the qiankun loader re-applies the same
 * override upstream (`qiankun-overrides` merges the key into the app's entry), so BOTH architectures
 * stay dev-overridable with the one widget. Network failure (server not running) ⇒ `esm`, so
 * EsmWidgetHost renders its actionable "start that dev server / clear the override" error.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md:160 — RISK-005
 */
export async function resolveOverrideTransport(base: string): Promise<OverrideTransport> {
    const cached = overrideTransportCache.get(base)
    if (cached) {
        return cached
    }
    let verdict: OverrideTransport
    try {
        await fetchManifest(base)
        verdict = 'esm'
    } catch (error) {
        verdict = error instanceof ManifestHttpError ? 'qiankun' : 'esm'
    }
    overrideTransportCache.set(base, verdict)
    return verdict
}
