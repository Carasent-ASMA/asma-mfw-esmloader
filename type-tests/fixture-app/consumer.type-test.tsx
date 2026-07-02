/**
 * End-to-end codegen proof: UserListWidget's `Props` → generated `widgets.generated.d.ts` (in this
 * tsconfig's include, so `'fixture-app'` is registered) → `<EsmWidgetHost>` narrows to it. This is the
 * WHOLE loop the app-side generator produces, with the widget component as the single source of truth.
 *
 * Exercises BOTH selectors: the preferred top-level `widget_name` and the deprecated `props.component_path`.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-002
 */
import { EsmWidgetHost } from '../../src/EsmWidgetHost.js'

// Preferred: top-level `widget_name` selects the widget and decides the props type.
void (<EsmWidgetHost app="fixture-app" widget_name="user-list" props={{ userId: '42', showArchived: true }} />)

// `widget_name` drives the props type — a wrong prop type is rejected (narrowing tracks the real Props).
void (
    <EsmWidgetHost
        app="fixture-app"
        widget_name="user-list"
        // @ts-expect-error — UserListWidget.Props requires userId: string, not number
        props={{ userId: 7 }}
    />
)

// Wrong widget_name for this app.
void (
    <EsmWidgetHost
        app="fixture-app"
        // @ts-expect-error — 'nope' is not a widget of fixture-app
        widget_name="nope"
        props={{ userId: '42' }}
    />
)

// Deprecated but still supported: the legacy `props.component_path` selector (transition back-compat).
void (<EsmWidgetHost app="fixture-app" props={{ component_path: 'user-list', userId: '42' }} />)
