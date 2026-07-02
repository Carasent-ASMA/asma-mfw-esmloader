/**
 * Type-level proof for the AsmaWidgetRegistry contract (plan REQ-002). Type-checked but NEVER emitted
 * or published — its own tsconfig, `noEmit`, and it lives outside `src`/`lib`. Run: `pnpm test:types`.
 *
 * `@ts-expect-error` is self-checking: if an expected error is ABSENT, tsc fails on the directive itself.
 * So a clean `tsc` here proves ALL of:
 *   1. a REGISTERED app narrows component_path + props, and rejects wrong path / missing / wrong-typed props;
 *   2. an UNREGISTERED app stays LOOSE — exactly today's permissive behavior;
 *   3. renaming (or removing) a widget turns every stale call site into a compile error for free.
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
    }
}

const entry = '/cdn/proof-directory/1.0.0/'

// 1a. Registered app + real widget + correct props → OK, fully narrowed.
void (
    <EsmWidgetHost
        app={{ name: 'proof-directory', entry }}
        props={{ component_path: 'user-list', userId: '42', showArchived: true }}
    />
)

// 1b. Wrong component_path for this app.
void (
    <EsmWidgetHost
        app={{ name: 'proof-directory', entry }}
        // @ts-expect-error — 'nope' is not a widget of 'proof-directory'
        props={{ component_path: 'nope', userId: '42' }}
    />
)

// 1c. Missing required prop.
void (
    <EsmWidgetHost
        app={{ name: 'proof-directory', entry }}
        // @ts-expect-error — widget 'user-list' requires `userId`
        props={{ component_path: 'user-list' }}
    />
)

// 1d. Wrong prop type.
void (
    <EsmWidgetHost
        app={{ name: 'proof-directory', entry }}
        // @ts-expect-error — `userId` must be a string
        props={{ component_path: 'user-list', userId: 42 }}
    />
)

// 3. Rename/removal safety: a stale name (typo of user-detail) is a compile error at the call site.
void (
    <EsmWidgetHost
        app={{ name: 'proof-directory', entry }}
        // @ts-expect-error — 'user-details' is not a registered widget (renamed/removed → loud error)
        props={{ component_path: 'user-details', userId: '42' }}
    />
)

// 2. UNREGISTERED app → stays loose (today's behavior): any path, any props, no error.
void (
    <EsmWidgetHost
        app={{ name: 'calendar-not-registered', entry }}
        props={{ component_path: 'anything-goes', whatever: 123, nested: { a: 1 } }}
    />
)
