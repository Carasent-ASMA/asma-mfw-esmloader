/**
 * Insert a widget's stylesheets into the document, once per href across the whole page.
 *
 * The ESM path replaces qiankun's html-entry `<link>` parsing (REQ-007). Widgets from the same
 * app@version share css files; inserting them once (keyed by absolute href) avoids duplicate
 * `<link>`s when several widgets of one app mount. `doc` is injectable for testing.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-007
 */

const DATA_ATTR = 'data-asma-widget-css'

/** Minimal DOM surface this needs — lets tests pass a fake document. */
export interface CssDoc {
    querySelector(selectors: string): unknown
    createElement(tag: 'link'): {
        rel: string
        href: string
        setAttribute(name: string, value: string): void
    }
    head: { appendChild(node: unknown): void }
}

export function ensureStylesheets(hrefs: readonly string[], doc?: CssDoc): void {
    const target = doc ?? (typeof document !== 'undefined' ? (document as unknown as CssDoc) : undefined)
    if (!target) {
        return
    }
    for (const href of hrefs) {
        // Escape quotes/backslashes so the attribute selector can't be broken by a hostile href.
        const safe = href.replace(/["\\]/g, '\\$&')
        if (target.querySelector(`link[${DATA_ATTR}="${safe}"]`)) {
            continue
        }
        const link = target.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.setAttribute(DATA_ATTR, href)
        target.head.appendChild(link)
    }
}
