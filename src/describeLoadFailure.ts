/**
 * The one wording for "this widget did not load", shared by both transports (ASMA-7853).
 *
 * `EsmWidgetHost` has had a load-failure notice since the ESM path shipped; `createDualLoader` now
 * shows one for a failed qiankun mount too. Two hosts phrasing the same failure differently is how a
 * user learns that the message depends on which transport an app happens to be on — which is exactly
 * the implementation detail the dual loader exists to hide. Pure and host-free so it can be tested
 * without React, and so neither host can drift from the other.
 */

/**
 * Turn a load failure into the sentence a user sees.
 *
 * `overrideBase` is set only when the app is being served from a dev override the user can withdraw.
 * That case gets the long form, because the raw error there is almost always `Failed to fetch` —
 * true, useless, and pointing at the CDN rather than at the dev server that is not running.
 */
export function describeWidgetLoadFailure(args: {
    appName: string | undefined
    error: unknown
    overrideBase?: string
}): string {
    const { appName, error, overrideBase } = args
    const rawMessage = error instanceof Error ? error.message : String(error)

    if (!overrideBase || !appName) return rawMessage

    return (
        `"${appName}" is served from a dev override at ${overrideBase}, which is unreachable ` +
        `(${rawMessage}). Start that dev server, or click "disable override" below to temporarily ` +
        `disable this app in the import-map-overrides widget and reload automatically.`
    )
}
