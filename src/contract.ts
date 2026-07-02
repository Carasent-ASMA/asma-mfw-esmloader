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
 */
export function defineReactWidget<P extends object>(Component: ComponentType<P>): WidgetModule<P> {
    return {
        mount(container, props) {
            const root = createRoot(container)
            const render = (p: P) => root.render(createElement(Component, p))
            render(props)
            return { update: render, unmount: () => root.unmount() }
        },
    }
}
