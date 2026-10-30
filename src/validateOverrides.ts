/**
 * Clearing a dead version override BEFORE the app renders (ASMA-7866, DEC-F2).
 *
 * The per-widget self-heal in `EsmWidgetHost` can only react: by the time a widget fails to
 * mount, something is already on screen, so recovering means `window.location.reload()` — an
 * unexplained reload that a tester has to interpret. Asking the same question at bootstrap
 * instead removes the reload entirely: nothing has rendered, so there is nothing to throw away.
 * The app simply starts on the version the environment serves, and the host says why.
 *
 * What this deliberately does NOT do:
 *   - touch a localhost override. A dev server that is not running is recoverable by starting
 *     it, and discarding that setting would be hostile.
 *   - treat unreachability as absence. Only a 404 or 403 clears an override — this origin is the
 *     object store, which answers 403 for any key it does not hold. A 5xx, a timeout or a
 *     network blip leaves the setting exactly where the tester put it.
 *   - judge a version by one document (ASMA-8735). A qiankun version publishes an entry document
 *     and no `widgets.json`; an ESM-only one (chat, consents) publishes `widgets.json` and no entry
 *     document. Each answers 403 for the file it lacks, so a version is gone only when BOTH are.
 *   - delay startup. Every probe races a deadline; when it expires the app renders regardless
 *     and the per-widget path remains as the backstop.
 *
 * @see _docs/asma-platform/plans/2026-08-14-22-30-plan-release-pipeline-integrity-remediation.md — Track F, DEC-F2
 */
import {
    clearOverride,
    isLocalOverrideBase,
    listActiveOverrides,
    resolveOverrideBase,
    type ActiveOverride,
} from './platformSignal.js'
import { provesVersionIsGone } from './widgetsManifest.js'

/**
 * How long the whole check may take. Short on purpose: this sits in front of first paint, and a
 * slow answer is worth less than a fast start — the per-widget heal still covers whatever this
 * misses.
 */
export const OVERRIDE_PROBE_TIMEOUT_MS = 2000

/**
 * What the startup check cleared, waiting for the host to say so.
 *
 * An in-memory handoff rather than the localStorage record, for two reasons: nothing here has to
 * survive a page load (the clearing and the message happen within one), and the record holds a
 * single entry, so several previews dying together would lose all but the last. Held here because
 * the clearing happens before the first render and the message can only be shown after it.
 */
let pendingStartupClears: ActiveOverride[] = []

/** Take what the startup check cleared. Empties on read — one message per app, per load. */
export function takeStartupClears(): ActiveOverride[] {
    const pending = pendingStartupClears
    pendingStartupClears = []
    return pending
}

/** Statuses that PROVE the version is gone, rather than merely out of reach. */
function provesBaseIsGone(status: number): boolean {
    return status === 404 || status === 403
}

/**
 * The two documents a published version is recognised by: its entry document (what qiankun
 * fetches) and its `widgets.json` (what the ESM path fetches). Both are asked of the version's own
 * folder — no query, a trailing slash — because `widgets.json` resolved against `…/pr166` is the
 * parent's manifest, which does not exist. Undefined when the base cannot be resolved, and what
 * cannot be asked about cannot be proven gone.
 */
function probeUrlsFor(base: string): [entry: string, manifest: string] | undefined {
    const folder = resolveOverrideBase(base)
    if (!folder) return undefined
    folder.search = ''
    folder.hash = ''
    if (!folder.pathname.endsWith('/')) folder.pathname += '/'
    return [folder.href, new URL('widgets.json', folder).href]
}

async function answersAbsent(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<boolean> {
    try {
        // `no-store`: a deleted qiankun-era entry document is cacheable for a day, and a cached 200
        // would keep a dead override alive that long.
        const response = await fetchImpl(url, { signal, cache: 'no-store' })
        return provesBaseIsGone(response.status)
    } catch {
        return false // aborted, offline, DNS, TLS, CORS — none of them mean "deleted"
    }
}

async function probeIsGone(base: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<boolean> {
    const urls = probeUrlsFor(base)
    if (!urls) return false
    const answers = await Promise.all(urls.map((url) => answersAbsent(url, fetchImpl, signal)))
    return answers.every(Boolean)
}

export interface ValidateOverridesOptions {
    fetchImpl?: typeof fetch
    timeoutMs?: number
}

/** Run `probe` against one shared deadline. Resolves to `undefined` when there is no `fetch` at all. */
async function underDeadline<T>(
    options: ValidateOverridesOptions,
    probe: (fetchImpl: typeof fetch, signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
    const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined)
    if (!fetchImpl) return undefined

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? OVERRIDE_PROBE_TIMEOUT_MS)
    try {
        return await probe(fetchImpl, controller.signal)
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * The mid-session heal's question (`EsmWidgetHost`): did this widget fail because the overridden
 * version is gone? The failure alone cannot say. A `widgets.json` 403 is also what a LIVE qiankun
 * version answers, so a proof-shaped failure is only the reason to ask; the answer is the same
 * two-document probe the startup check uses. Never true for a localhost base.
 */
export async function confirmOverrideIsGone(
    base: string,
    loadError: unknown,
    options: ValidateOverridesOptions = {},
): Promise<boolean> {
    if (isLocalOverrideBase(base) || !provesVersionIsGone(loadError)) return false
    return (await underDeadline(options, (fetchImpl, signal) => probeIsGone(base, fetchImpl, signal))) ?? false
}

/**
 * Clear every override whose published version is provably gone, and report what was cleared so
 * the caller can decide whether to say anything. Runs before the first render.
 *
 * Returns immediately when nothing is overridden, which is every non-developer load — the cost is
 * one `localStorage` scan, not a network round-trip.
 */
export async function clearDeadOverrides(options: ValidateOverridesOptions = {}): Promise<ActiveOverride[]> {
    const candidates = listActiveOverrides().filter((override) => !isLocalOverrideBase(override.base))
    if (candidates.length === 0) return []

    // In parallel: one dead preview must not delay the check on the others, and the deadline
    // covers all of them together rather than each in turn.
    const verdicts = await underDeadline(options, (fetchImpl, signal) =>
        Promise.all(candidates.map((override) => probeIsGone(override.base, fetchImpl, signal))),
    )
    if (!verdicts) return []

    const cleared = candidates.filter((_, index) => verdicts[index])
    for (const override of cleared) {
        clearOverride(override.appName, override.source)
    }
    // Handed to the host two ways, because it needs both: returned for a caller that wants to
    // act on it immediately, and parked for `notifyOverrideSelfHeal` to drain after the first
    // render — the message can only be shown once there is something to show it in.
    pendingStartupClears = [...pendingStartupClears, ...cleared]
    return cleared
}
