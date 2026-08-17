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
 *   - delay startup. Every probe races a deadline; when it expires the app renders regardless
 *     and the per-widget path remains as the backstop.
 *
 * @see _docs/asma-platform/plans/2026-08-14-22-30-plan-release-pipeline-integrity-remediation.md — Track F, DEC-F2
 */
import { clearOverride, isLocalOverrideBase, listActiveOverrides, type ActiveOverride } from './platformSignal.js'

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

/** The entry document of an override base — what both loaders are about to fetch. */
function entryUrlFor(base: string): string {
    return base.endsWith('/') ? base : `${base}/`
}

async function probeIsGone(base: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<boolean> {
    try {
        const response = await fetchImpl(entryUrlFor(base), { signal })
        return provesBaseIsGone(response.status)
    } catch {
        return false // aborted, offline, DNS, TLS — none of them mean "deleted"
    }
}

export interface ValidateOverridesOptions {
    fetchImpl?: typeof fetch
    timeoutMs?: number
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

    const fetchImpl = options.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined)
    if (!fetchImpl) return []

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? OVERRIDE_PROBE_TIMEOUT_MS)

    try {
        // In parallel: one dead preview must not delay the check on the others, and the deadline
        // covers all of them together rather than each in turn.
        const verdicts = await Promise.all(
            candidates.map((override) => probeIsGone(override.base, fetchImpl, controller.signal)),
        )

        const cleared = candidates.filter((_, index) => verdicts[index])
        for (const override of cleared) {
            clearOverride(override.appName, override.source)
        }
        // Handed to the host two ways, because it needs both: returned for a caller that wants to
        // act on it immediately, and parked for `notifyOverrideSelfHeal` to drain after the first
        // render — the message can only be shown once there is something to show it in.
        pendingStartupClears = [...pendingStartupClears, ...cleared]
        return cleared
    } finally {
        clearTimeout(timeout)
    }
}
