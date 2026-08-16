/**
 * The per-app transport signal — read directly from the server-injected `window.__ASMA_PLATFORM__`
 * (asma-static-server, ASMA-7544). No registry enrichment, no global flag: the presence of an
 * `esm` marker on an app decides ESM vs qiankun, and it is decided by the artifact itself
 * (the static server sets it from `widgets.json` presence per app@version).
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-003, TASK-002
 */
import { fetchManifest, ManifestFormatError, ManifestHttpError } from './widgetsManifest.js'

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
 * Add `appName` to the import-map-overrides widget's disabled list (the `import-map-overrides-disabled`
 * localStorage JSON array), so its dev override is ignored on the next load — the "disable override"
 * escape hatch from a {@link WidgetErrorNotice} when the override points at a dev server that isn't
 * running. Idempotent (won't duplicate), and a best-effort no-op if storage is blocked.
 */
export function disableImportMapOverride(appName: string): void {
    if (typeof localStorage === 'undefined') return
    try {
        let disabled: string[] = []
        const raw = localStorage.getItem(IMPORT_MAP_OVERRIDES_DISABLED_KEY)
        if (raw) {
            try {
                const parsed: unknown = JSON.parse(raw)
                if (Array.isArray(parsed)) disabled = parsed.filter((name): name is string => typeof name === 'string')
            } catch {
                // corrupt list — reset it rather than leave the override stuck enabled
            }
        }
        if (!disabled.includes(appName)) disabled.push(appName)
        localStorage.setItem(IMPORT_MAP_OVERRIDES_DISABLED_KEY, JSON.stringify(disabled))
    } catch {
        // storage blocked — best-effort, nothing more to do
    }
}

/**
 * The SECOND override channel: `esm-overrides` (ASMA-7866). The server's own head injection reads this
 * key and rewrites `apps[<name>].base` IN PLACE before the import map is materialized — see
 * `asma-njs-auth/src/handlers/buildPlatformInjection.ts`. Nothing in the loader applies it, so an app
 * overridden this way looks exactly like an ordinary platform entry: real `version`, someone else's
 * `base`. That is precisely why it needs naming — a self-heal keyed on the `dev-override` marker would
 * skip it, and a self-heal keyed on nothing at all would start clearing bases the SERVER chose, which
 * is a dangling version pointer (ASMA-7864) that no client action can fix.
 *
 * Shape: `{"apps":{"asma-app-chat":"https://…/pr41/"}}`. Undefined if unset, malformed or blocked.
 */
export const ESM_OVERRIDES_KEY = 'esm-overrides'

function readEsmOverrides(): Record<string, string> {
    if (typeof localStorage === 'undefined') return {}
    try {
        const parsed: unknown = JSON.parse(localStorage.getItem(ESM_OVERRIDES_KEY) ?? '{}')
        const apps = (parsed as { apps?: unknown } | null)?.apps
        return apps && typeof apps === 'object' ? (apps as Record<string, string>) : {}
    } catch {
        return {}
    }
}

/** Where a base in front of an app came from — `undefined` means the server payload's own. */
export type OverrideSource = 'import-map' | 'esm-overrides'

/**
 * Which override, if any, put `base` in front of `appName`.
 *
 * The question a self-heal must answer before clearing anything: an override is the user's own
 * setting and can be withdrawn, whereas a base the server chose is not theirs to withdraw — clearing
 * it would achieve nothing and the reload would loop. Matched on the base itself rather than on the
 * `dev-override` marker, because only one of the two channels produces that marker.
 */
export function findOverrideSource(appName: string, base: string): OverrideSource | undefined {
    if (getImportMapOverrideBase(appName) === base) return 'import-map'
    if (readEsmOverrides()[appName] === base) return 'esm-overrides'
    return undefined
}

/** Withdraw whichever override put a base in front of `appName`. Best-effort; never throws. */
export function clearOverride(appName: string, source: OverrideSource): void {
    if (source === 'import-map') {
        disableImportMapOverride(appName)
        return
    }
    if (typeof localStorage === 'undefined') return
    try {
        const apps = readEsmOverrides()
        // Only this app's entry goes — the others are separate, still-valid decisions by the same user.
        const { [appName]: _removed, ...rest } = apps
        localStorage.setItem(ESM_OVERRIDES_KEY, JSON.stringify({ apps: rest }))
    } catch {
        // storage blocked — best-effort, nothing more to do
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
 * A VALID manifest served ⇒ `esm` (and the fetch is cached, so the ESM path's own resolve reuses it).
 * HTTP error, or 200 with a non-manifest body (Vite's SPA fallback answers unknown paths with
 * 200 + index.html) ⇒ `qiankun` — an old-architecture dev server; the qiankun loader re-applies the
 * same override upstream (`qiankun-overrides` merges the key into the app's entry), so BOTH
 * architectures stay dev-overridable with the one widget. Network failure (server not running) ⇒
 * `esm`, so EsmWidgetHost renders its actionable "start that dev server / clear the override" error.
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
        verdict = error instanceof ManifestHttpError || error instanceof ManifestFormatError ? 'qiankun' : 'esm'
    }
    overrideTransportCache.set(base, verdict)
    return verdict
}

/** localStorage key holding a one-shot record of an override this loader healed by itself. */
const OVERRIDE_SELF_HEAL_KEY = 'asma-override-self-heal'

/**
 * Is this override base a developer's own machine, rather than a published version?
 *
 * The distinction decides whether an unreachable override may be cleared automatically. A dev
 * server that is merely not running is a temporary, self-inflicted and RECOVERABLE state — the
 * developer starts it and carries on — so silently discarding their deliberate setting would be
 * hostile. A published version that has gone (a merged `pr<N>` preview, deleted by ASMA-7863) is
 * gone for good: nothing the user can do will bring it back, and leaving the override in place
 * only guarantees the same failure on every subsequent load.
 */
export function isLocalOverrideBase(base: string): boolean {
    try {
        const { hostname } = new URL(base, 'http://localhost')
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
    } catch {
        return false
    }
}

/** One override this loader disabled on the user's behalf, awaiting a toast from the host app. */
export interface OverrideSelfHeal {
    appName: string
    base: string
}

/**
 * Record that a dead override was cleared, so the host app can tell the user WHY the page just
 * reloaded and what it fell back to. Written before the reload; read once afterwards.
 */
export function recordOverrideSelfHeal(appName: string, base: string): void {
    if (typeof localStorage === 'undefined') return
    try {
        localStorage.setItem(OVERRIDE_SELF_HEAL_KEY, JSON.stringify({ appName, base }))
    } catch {
        // storage blocked — the heal still happened, only the explanation is lost
    }
}

/**
 * Take the pending self-heal record, if any. Clearing on read is deliberate: the message describes
 * one reload, and repeating it on every later navigation would be noise.
 */
export function consumeOverrideSelfHeal(): OverrideSelfHeal | undefined {
    if (typeof localStorage === 'undefined') return undefined
    try {
        const raw = localStorage.getItem(OVERRIDE_SELF_HEAL_KEY)
        if (!raw) return undefined
        localStorage.removeItem(OVERRIDE_SELF_HEAL_KEY)
        const parsed: unknown = JSON.parse(raw)
        if (
            parsed &&
            typeof parsed === 'object' &&
            typeof (parsed as OverrideSelfHeal).appName === 'string' &&
            typeof (parsed as OverrideSelfHeal).base === 'string'
        ) {
            return parsed as OverrideSelfHeal
        }
        return undefined
    } catch {
        return undefined
    }
}
