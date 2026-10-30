/**
 * Telling the user WHY their override stopped applying (ASMA-7866, host half).
 *
 * When an override points at a published version that has gone, the loader clears it — at startup,
 * before anything renders (`clearDeadOverrides`), or mid-session, followed by a reload
 * (`EsmWidgetHost`). Without a word from the host that is a silently different app version, and the
 * tester keeps believing they are looking at their preview. The loader leaves a record behind; this
 * is the half that reads it and hands the host something to say.
 *
 * Deliberately split: `notifyOverrideSelfHeal` holds ALL the behaviour (take the record, name the
 * version now in effect, decide whether there is anything to say) and is unit-tested against fakes,
 * in this package's usual style. `useOverrideSelfHealNotice` is only the `useEffect` wrapper.
 */
import { useEffect } from 'react'

import { consumeOverrideSelfHeal, getAppSignal, type OverrideSelfHeal } from './platformSignal.js'
import { takeStartupClears } from './validateOverrides.js'

/**
 * When the override was cleared: at `startup`, before the first render, so the page simply loaded
 * without it; or mid-session, followed by a `reload`.
 */
export type OverrideSelfHealMoment = 'startup' | 'reload'

/**
 * The sentence a host shows. It names all three things the tester needs to reconcile what they are
 * looking at with what they asked for: which app, which override is gone, and which version replaced
 * it. The replacement version is resolved at read time — by now the override has been disabled, so
 * the app's signal is the one the environment actually serves. It says "reloaded" only when the page
 * did reload (ASMA-8735).
 */
export function describeOverrideSelfHeal(
    { appName, base }: OverrideSelfHeal,
    moment: OverrideSelfHealMoment = 'reload',
): string {
    const version = getAppSignal(appName)?.version
    const replacement =
        moment === 'startup'
            ? version
                ? `loaded version ${version} instead`
                : 'loaded without it'
            : version
              ? `reloaded on version ${version}`
              : 'reloaded without it'
    return `The version override for "${appName}" (${base}) no longer exists, so it was cleared and this page ${replacement}.`
}

/**
 * Show the pending self-heal notice, if there is one. Returns whether anything was shown, so a
 * caller (and the tests) can tell "nothing to report" from "reported".
 *
 * Safe to call more than once: the record is cleared as it is read, so a second call is a no-op —
 * which is what makes this correct under React's double-invoked effects.
 */
export function notifyOverrideSelfHeal(notify: (message: string, heal: OverrideSelfHeal) => void): boolean {
    let reported = false

    // Two sources, because a heal can happen at two moments. The startup check (DEC-F2) clears
    // before the first render and parks what it cleared in memory — possibly several apps at once.
    // The per-widget path clears mid-session and reloads, so its single record has to survive the
    // load in storage. Both end up as the same sentence.
    for (const cleared of takeStartupClears()) {
        notify(describeOverrideSelfHeal(cleared, 'startup'), cleared)
        reported = true
    }

    const heal = consumeOverrideSelfHeal()
    if (heal) {
        notify(describeOverrideSelfHeal(heal, 'reload'), heal)
        reported = true
    }
    return reported
}

/**
 * Host hook: surface a self-heal notice once, on mount. `notify` is the host's own toast (shell and
 * advoca pass `message.info` from `asma-ui-core`, layouts its notistack equivalent) — this package
 * has no opinion about, or dependency on, how a host renders it.
 *
 * Runs on mount only. The record is consumed on read, so re-running on a changed `notify` identity
 * could never produce a second notice anyway; an empty dependency list just says so honestly instead
 * of relying on that.
 */
export function useOverrideSelfHealNotice(notify: (message: string, heal: OverrideSelfHeal) => void): void {
    useEffect(() => {
        notifyOverrideSelfHeal(notify)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
}
