/**
 * The widget contract — the whole replacement for today's window-global qiankun handoff.
 *
 * Today (asma-qiankun-plugin-vite + LoaderQueue) a widget's lifecycle travels through window
 * globals keyed by APP NAME (`window[appName]`, `moduleQiankunAppLifeCycles[appName]`,
 * `__GLOBAL_CONCURRENT_QIANKUN__[appName]`) — one mutable slot per app, which is why two
 * concurrent mounts of the SAME app clobber each other and `LoaderQueue` must serialize them.
 *
 * Here the lifecycle is an ES MODULE EXPORT: module-scoped, instance-per-mount, no shared slot
 * — N concurrent mounts of any mix of widgets cannot interfere, and the queue disappears.
 *
 * @see _docs/frontend/architecture/2026-07-02-15-40-architecture-widget-taxonomy-and-composition.md — §5.1
 */
import { createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

import { WidgetRenderBoundary } from './WidgetRenderBoundary.js'

export type WidgetProps = Record<string, unknown>

export interface WidgetInstance<P = WidgetProps> {
    update: (props: P) => void
    unmount: () => void
}

export interface WidgetModule<P = WidgetProps> {
    mount: (container: HTMLElement, props: P) => WidgetInstance<P>
}

/**
 * Wrap a React component as a widget module. A widget entry file's default/`mount` export is
 * `defineReactWidget(MyWidget)` — the app's widget build (vite.config.widgets.ts) generates these.
 *
 * The widget is rendered under a {@link WidgetRenderBoundary}, so a throw during its render shows a
 * notice in its slot instead of taking the root down silently (ASMA-7853). This is the ONLY place
 * that boundary can live: the root created here owns the widget's tree, so no boundary in the host
 * — under either transport — can see what the widget throws.
 */
export function defineReactWidget<P extends object>(Component: ComponentType<P>): WidgetModule<P> {
    return {
        mount(container, props) {
            const root = createRoot(container)
            // Each render is a new attempt, which is what lets the boundary clear a previous error
            // when the host sends fresh props rather than leaving the widget dead for the page.
            let attempt = 0
            const render = (p: P) =>
                root.render(
                    createElement(
                        WidgetRenderBoundary,
                        { attempt: attempt++, widgetProps: p as Record<string, unknown> },
                        createElement(Component, p),
                    ),
                )
            render(props)
            return { update: render, unmount: () => root.unmount() }
        },
    }
}
