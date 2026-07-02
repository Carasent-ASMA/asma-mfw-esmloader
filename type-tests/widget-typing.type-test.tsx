/**
 * Type-level proof for the AsmaWidgetRegistry contract (plan REQ-002). Type-checked but NEVER emitted
 * or published — its own tsconfig, `noEmit`, and it lives outside `src`/`lib`. Run: `pnpm test:types`.
 *
 * `@ts-expect-error` is self-checking: if an expected error is ABSENT, tsc fails on the directive itself.
 * So a clean `tsc` here proves ALL of:
 *   1. a REGISTERED app narrows component_path + props, and rejects wrong path / missing / wrong-typed props;
 *   2. an UNREGISTERED app stays LOOSE — exactly today's permissive behavior;
 *   3. renaming (or removing) a widget turns every stale call site into a compile error for free;
 *   4. `app` is the app NAME (destination API), and the { name, entry } object form still type-checks
 *      (what `createDualLoader` forwards for qiankun parity);
 *   5. the top-level `widget_name` selector narrows `props` the same way (the destination API) with a
 *      CLEAN payload (no component_path), rejecting wrong name / missing / wrong-typed props; unregistered stays loose.
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — REQ-002
 */
import { EsmWidgetHost } from '../src/EsmWidgetHost.js';

// A micro-app opts in — exactly what its generated widgets.d.ts would emit via declaration merging.
declare global {
    interface AsmaWidgetRegistry {
        'proof-directory': {
            'user-list': { userId: string; showArchived?: boolean }
            'user-detail': { userId: string }
        }
        test:{
            one: { a: string }
            two:{fn:(b: string)=>void}
        }
    }
}

// 1a. Registered app (by NAME) + real widget + correct props → OK, fully narrowed.
void (<EsmWidgetHost app="proof-directory" props={{ component_path: 'user-list', userId: '42', showArchived: true }} />)

// 1b. Wrong component_path for this app.
void (
    <EsmWidgetHost
        app="proof-directory"
        // @ts-expect-error — 'nope' is not a widget of 'proof-directory'
        props={{ component_path: 'nope', userId: '42' }}
    />
)

void (
    <EsmWidgetHost
        app="proof-directory"
        widget_name='user-detail'
        props={{ userId: '42' }}
    />
)

// 1c. Missing required prop.
void (
    <EsmWidgetHost
        app="proof-directory"
        // @ts-expect-error — widget 'user-list' requires `userId`
        props={{ component_path: 'user-list' }}
    />
)

// 1d. Wrong prop type.
void (
    <EsmWidgetHost
        app="proof-directory"
        // @ts-expect-error — `userId` must be a string
        props={{ component_path: 'user-list', userId: 42 }}
    />
)

// 3. Rename/removal safety: a stale name (typo of user-detail) is a compile error at the call site.
void (
    <EsmWidgetHost
        app="proof-directory"
        // @ts-expect-error — 'user-details' is not a registered widget (renamed/removed → loud error)
        props={{ component_path: 'user-details', userId: '42' }}
    />
)

// 2. UNREGISTERED app (by name) → stays loose (today's behavior): any path, any props, no error.
void (<EsmWidgetHost app="calendar-not-registered" props={{ component_path: 'anything-goes', whatever: 123 }} />)

// 4. Object form ({ name, entry }) still narrows too — the shape createDualLoader forwards for qiankun parity.
void (
    <EsmWidgetHost
        app={{ name: 'proof-directory', entry: '/cdn/proof-directory/1.0.0/' }}
        props={{ component_path: 'user-detail', userId: '42' }}
    />
)

// ── 5. The DESTINATION API: top-level `widget_name` selector + CLEAN props (no component_path). ──

// 5a. widget_name + clean props → OK, fully narrowed.
void (<EsmWidgetHost app="proof-directory" widget_name="user-list" props={{ userId: '42', showArchived: true }} />)

// 5b. Wrong widget_name.
void (
    <EsmWidgetHost
        app="proof-directory"
        // @ts-expect-error — 'nope' is not a widget of 'proof-directory'
        widget_name="nope"
        props={{ userId: '42' }}
    />
)

// 5c. Missing required prop (with widget_name).
void (
    <EsmWidgetHost
        app="proof-directory"
        widget_name="user-list"
        // @ts-expect-error — widget 'user-list' requires `userId`
        props={{}}
    />
)

// 5d. Wrong prop type (with widget_name).
void (
    <EsmWidgetHost
        app="proof-directory"
        widget_name="user-detail"
        // @ts-expect-error — `userId` must be a string
        props={{ userId: 42 }}
    />
)

// 5e. Function-typed widget props narrow too (registry app `test`, widget `two`).
void (<EsmWidgetHost app="test" widget_name="two" props={{ fn: () => {} }} />)

// 5f. `widget_name` on an UNREGISTERED app → loose: any name, any props, no error.
void (<EsmWidgetHost app="calendar-not-registered" widget_name="anything" props={{ whatever: 123 }} />)
