/**
 * Resolve a widget's ES entry (and its CSS) from the app's `widgets.json`.
 *
 * The manifest maps `component_path` → either a bare entry path (string) or `{ entry, css[] }`.
 * qiankun's html-entry used to pull a widget's stylesheets from `<link>` tags; a bare `import()`
 * loads NO css, so the ESM path must carry the css list explicitly and insert it (REQ-007).
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-006/007, TASK-002
 */

/** A manifest entry: either just the entry file, or entry + its stylesheets. */
export type WidgetManifestEntry = string | { entry: string; css?: string[] }

export interface WidgetManifest {
    widgets: Record<string, WidgetManifestEntry>
}

/** A resolved widget: absolute entry URL + absolute css URLs, ready to import + insert. */
export interface ResolvedWidget {
    entryUrl: string
    css: string[]
}

/**
 * The widgets.json request reached a server but got a non-2xx answer. Distinguishes "this base
 * serves no manifest" (e.g. an old-architecture qiankun dev server behind a dev override) from a
 * network failure (server not running) — the dual loader's override probe dispatches on it.
 */
export class ManifestHttpError extends Error {
    constructor(
        url: string,
        readonly status: number,
    ) {
        super(`widgets.json not found at ${url} (HTTP ${status})`)
    }
}

const manifestCache = new Map<string, Promise<WidgetManifest>>()

/** Reset the manifest cache (tests / dev-override reloads). */
export function clearManifestCache(): void {
    manifestCache.clear()
}

function origin(): string | undefined {
    return typeof location !== 'undefined' ? location.origin : undefined
}

/** Absolute URL of the app's widgets.json. `manifestUrl` (from the platform signal) wins; else `<base>widgets.json`. */
function manifestUrlFor(base: string, manifestUrl?: string): string {
    if (manifestUrl) {
        return new URL(manifestUrl, origin()).href
    }
    return new URL('widgets.json', new URL(base, origin())).href
}

/** Fetch + cache the app's manifest, keyed by its resolved URL (per app@version — base carries the version). */
export function fetchManifest(base: string, manifestUrl?: string): Promise<WidgetManifest> {
    const url = manifestUrlFor(base, manifestUrl)
    let cached = manifestCache.get(url)
    if (!cached) {
        cached = fetch(url).then((res) => {
            if (!res.ok) {
                throw new ManifestHttpError(url, res.status)
            }
            return res.json() as Promise<WidgetManifest>
        })
        manifestCache.set(url, cached)
        // Don't leave a rejected promise stuck in the cache (e.g. a dev override whose server was down):
        // once the server is up, a reload / re-navigate retries instead of replaying the old failure.
        cached.catch(() => {
            if (manifestCache.get(url) === cached) manifestCache.delete(url)
        })
    }
    return cached
}

/** Normalize a manifest entry and resolve entry + css to absolute URLs against the app base. */
export function resolveEntry(base: string, entry: WidgetManifestEntry): ResolvedWidget {
    const absBase = new URL(base, origin())
    const { entryPath, css } = typeof entry === 'string' ? { entryPath: entry, css: [] as string[] } : { entryPath: entry.entry, css: entry.css ?? [] }
    return {
        entryUrl: new URL(entryPath, absBase).href,
        css: css.map((href) => new URL(href, absBase).href),
    }
}

/** Resolve `component_path` → `{ entryUrl, css[] }` from the app's manifest. Throws if the path is absent. */
export async function resolveWidget(base: string, componentPath: string, manifestUrl?: string): Promise<ResolvedWidget> {
    const manifest = await fetchManifest(base, manifestUrl)
    const entry = manifest.widgets[componentPath]
    if (!entry) {
        throw new Error(`widgets.json has no widget '${componentPath}'. Available: ${Object.keys(manifest.widgets).join(', ')}`)
    }
    return resolveEntry(base, entry)
}
