/**
 * Type-level proof for the AsmaWidgetRegistry contract (plan REQ-008). Type-checked but NEVER emitted
 * or published — its own tsconfig, `noEmit`, and it lives outside `src`/`lib`. Run: `pnpm test:types`.
 *
 * It imports via the real package specifier `asma-mfw-esmloader` (tsconfig `paths` → `../src`) and
 * augments it with `declare module` — i.e. it exercises the EXACT consumer shape, proving the
 * module-scoped registry merges (no `declare global`). `@ts-expect-error` is self-checking: if an
 * expected error is ABSENT, tsc fails on the directive itself. A clean `tsc` here proves:
 *   1. a REGISTERED app narrows widget selector + props, rejecting wrong name / missing / wrong-typed props;
 *   2. an UNREGISTERED app stays LOOSE — today's permissive behavior;
 *   3. renaming/removing a widget turns every stale call site into a compile error for free;
 *   4. both selectors work — top-level `widget_name` (destination) and the `@deprecated` `props.component_path`;
 *   5. the `{ name, entry }` object form still type-checks (what `createDualLoader` forwards for qiankun);
 *   6. **computed types**: an app registered via `RegistryFor<typeof widgets>` (NO codegen) narrows identically.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-008
 */
import { EsmWidgetHost, type RegistryFor } from 'asma-mfw-esmloader'
import { defineReactWidget } from 'asma-mfw-esmloader/contract'

// (A) An app registers by HAND — the explicit shape.
declare module 'asma-mfw-esmloader' {
    interface AsmaWidgetRegistry {
        'proof-directory': {
            'user-list': { userId: string; showArchived?: boolean }
            'user-detail': { userId: string }
        }
        test: {
            one: { a: string }
            two: { fn: (b: string) => void }
        }
    }
}

// 1. Registered app + real widget + correct props (top-level widget_name — the destination API) → OK.
void (<EsmWidgetHost app="proof-directory" widget_name="user-list" props={{ userId: '42', showArchived: true }} />)

// Deprecated selector still works: props.component_path.
void (<EsmWidgetHost app="proof-directory" props={{ component_path: 'user-detail', userId: '42' }} />)

// 1b. Wrong widget_name.
void (
    <EsmWidgetHost
        app="proof-directory"
        // @ts-expect-error — 'nope' is not a widget of 'proof-directory'
        widget_name="nope"
        props={{ userId: '42' }}
    />
)

// 1c. Missing required prop.
void (
    <EsmWidgetHost
        app="proof-directory"
        widget_name="user-list"
        // @ts-expect-error — widget 'user-list' requires `userId`
        props={{}}
    />
)

// 1d. Wrong prop type.
void (
    <EsmWidgetHost
        app="proof-directory"
        widget_name="user-detail"
        // @ts-expect-error — `userId` must be a string
        props={{ userId: 42 }}
    />
)

// 3. Rename/removal safety: a stale name via the deprecated selector is still a compile error.
void (
    <EsmWidgetHost
        app="proof-directory"
        // @ts-expect-error — 'user-details' is not a registered widget (renamed/removed → loud error)
        props={{ component_path: 'user-details', userId: '42' }}
    />
)

// 4/5. Object form ({ name, entry }) still narrows — the shape createDualLoader forwards for qiankun parity.
void (
    <EsmWidgetHost
        app={{ name: 'proof-directory', entry: '/cdn/proof-directory/1.0.0/' }}
        widget_name="user-detail"
        props={{ userId: '42' }}
    />
)

// Function-typed widget props narrow too (registry app `test`, widget `two`).
void (<EsmWidgetHost app="test" widget_name="two" props={{ fn: () => {} }} />)

// 2. UNREGISTERED app → stays loose (today's behavior): any name, any props, no error.
void (<EsmWidgetHost app="calendar-not-registered" widget_name="anything" props={{ whatever: 123 }} />)

// ── 6. COMPUTED registry (no codegen): derive an app's entry from its `widgets` object. ──

// A widget entry exposes `Props` through its `mount` — exactly what `() => import('./entry')` resolves to.
const EventWidget = defineReactWidget<{ eventId: string; expanded?: boolean }>(() => null)

// The single source of truth an app maintains (thunks shared with the widget build).
const widgets = {
    'event-detail': () => Promise.resolve(EventWidget),
}

declare module 'asma-mfw-esmloader' {
    interface AsmaWidgetRegistry {
        'computed-app': RegistryFor<typeof widgets>
    }
}

// 6a. Computed props narrow exactly like a hand-declared entry.
void (<EsmWidgetHost app="computed-app" widget_name="event-detail" props={{ eventId: '1', expanded: true }} />)

// 6b. Wrong prop type on the computed entry is rejected.
void (
    <EsmWidgetHost
        app="computed-app"
        widget_name="event-detail"
        // @ts-expect-error — computed from EventWidget.Props: eventId must be a string
        props={{ eventId: 1 }}
    />
)

// 6c. Unknown widget on the computed app is rejected.
void (
    <EsmWidgetHost
        app="computed-app"
        // @ts-expect-error — 'ghost' is not in the computed `widgets` object
        widget_name="ghost"
        props={{ eventId: '1' }}
    />
)
