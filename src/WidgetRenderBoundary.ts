/**
 * The error boundary INSIDE a widget's own React root (ASMA-7853).
 *
 * Where it sits is the whole point. A widget mounts through `createRoot(container)` — its own React
 * root, created by `defineReactWidget` — so a throw during its render never reaches the host: React
 * reports it to the root that owns the tree, unmounts that tree and re-throws. A boundary placed in
 * the HOST (the shell, `createDualLoader`, `EsmWidgetHost`) would see nothing. This one is rendered
 * by the widget's own root, which is the only place that can catch it.
 *
 * That makes it the render-time counterpart to the load-time handling those hosts already do: a
 * widget that fails to arrive shows a notice, and now so does a widget that arrives and then throws.
 * Both use the same {@link WidgetErrorNotice}, so the two failures look alike to whoever hits them.
 *
 * Written with `createElement` rather than JSX so it can live beside `contract.ts`, the entry a
 * widget bundle imports.
 */
import { Component, createElement, type ErrorInfo, type ReactNode } from 'react'

import { WidgetErrorNotice } from './WidgetErrorNotice.js'

export interface WidgetRenderBoundaryProps {
    /** Optional so `createElement(WidgetRenderBoundary, props, child)` type-checks — React passes
     * positional children outside the props object. */
    children?: ReactNode
    /**
     * Incremented by `defineReactWidget` on every `mount`/`update` call. A new props set is a new
     * attempt, so a caught error clears and the widget is given another chance — without this a
     * widget that threw once on bad data would stay dead for the life of the page even after the
     * host sent it good data.
     */
    attempt: number
    /** The props the widget was rendered with — shown in the notice, for diagnosis in place. */
    widgetProps?: Record<string, unknown>
    /** The widget's identity, when the caller knows it. */
    appName?: string
    widgetName?: string
}

interface WidgetRenderBoundaryState {
    error: Error | null
    /** The attempt the current `error` belongs to; how a reset is detected without an effect. */
    attempt: number
}

export class WidgetRenderBoundary extends Component<WidgetRenderBoundaryProps, WidgetRenderBoundaryState> {
    state: WidgetRenderBoundaryState = { error: null, attempt: this.props.attempt }

    static getDerivedStateFromError(error: Error): Partial<WidgetRenderBoundaryState> {
        return { error }
    }

    static getDerivedStateFromProps(
        props: WidgetRenderBoundaryProps,
        state: WidgetRenderBoundaryState,
    ): Partial<WidgetRenderBoundaryState> | null {
        // Runs before EVERY render, including the re-render that follows a caught error — where the
        // attempt has not moved, so this returns null and leaves the freshly-set error alone.
        return props.attempt === state.attempt ? null : { error: null, attempt: props.attempt }
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // The notice carries the message; the console keeps the component stack, which is the part
        // that says WHICH leaf threw and is far too long to put on screen.
        console.error('ASMA widget crashed while rendering', error, info.componentStack)
    }

    render(): ReactNode {
        const { error } = this.state
        if (!error) return this.props.children

        return createElement(WidgetErrorNotice, {
            // Named as a CRASH, not a load failure: the widget's code arrived and ran. Whoever reads
            // this needs to look at the widget, not at the CDN, the manifest or an override.
            message: `The widget crashed while rendering: ${error.message}`,
            appName: this.props.appName,
            widgetName: this.props.widgetName,
            widgetProps: this.props.widgetProps,
        })
    }
}
