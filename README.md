# asma-mfw-esmloader

The transport-agnostic widget loader that supersedes `asma-qiankun-react-loader`. It loads a widget by `import()`ing an ES module that exports `mount()`, and `createDualLoader` dispatches **per app** between this native-ESM path and the legacy qiankun loader **with no global flag**. Zero qiankun dependency — this is the package that survives when qiankun is retired.

See [`_docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md`](../../_docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md) and [`_docs/frontend/architecture/2026-07-02-15-40-architecture-widget-taxonomy-and-composition.md`](../../_docs/frontend/architecture/2026-07-02-15-40-architecture-widget-taxonomy-and-composition.md).

## Usage in a host app (one file, mechanical swap)

```tsx
// src/components/mf-components/MfComponent.ts
import { MfComponentLoader } from 'asma-qiankun-react-loader/lib'
import { createDualLoader } from 'asma-mfw-esmloader'

// Same props as MfComponentLoader. Reads window.__ASMA_PLATFORM__.apps[app.name].esm:
//   marked  → native-ESM <EsmWidgetHost>
//   unmarked/no payload → the injected MfComponentLoader (today's qiankun path), unchanged
export const MfComponent = createDualLoader(MfComponentLoader)
```

Then in each `Mf*` wrapper, swap `MfComponentLoader` → `MfComponent` (a rename — props are identical). No other host code changes; the qiankun loader is untouched.

## Usage in a widget (the app's widget build)

One `widgets.config.ts` per app is the **single source of truth** for both the build and the types — `name → () => import('./entry')` thunks:

```ts
// src/widgets.config.ts
export const widgets = {
    '/my-recipients-widget': () => import('./widgets/MyRecipientsWidget'),
}
```

The entry exports `mount`. **Props are declared once — in the component's own signature.** `defineReactWidget` *infers* them from the component you pass (no `<Props>` type argument, no separate `type Props`):

```tsx
// src/widgets/MyRecipientsWidget.tsx
import { defineReactWidget } from 'asma-mfw-esmloader/contract'
// MyRecipients: (props: { amount_of_rows?: number }) => JSX — props typed here, once.
export const { mount } = defineReactWidget(MyRecipients)
```

If the widget wraps its leaf in app providers, *reference* the leaf's props (don't restate them) with `ComponentProps` — still one source of truth:

```tsx
import type { ComponentProps } from 'react'
export const { mount } = defineReactWidget((props: ComponentProps<typeof MyRecipients>) => (
    <AppProviders><MyRecipients {...props} /></AppProviders>
))
```

The build turns that one object into per-widget ES entries + `widgets.json`:

```ts
// vite.config.widgets.ts
import { widgetBuild } from 'asma-mfw-esmloader/vite'
const { input, plugin } = widgetBuild()
export default defineConfig({ plugins: [/* app plugins minus qiankun */, plugin], build: { emptyOutDir: false, rollupOptions: { input } } })
```

`widgetBuild()` parses `widgets.config.ts` (TypeScript AST — reads the `import()` specifiers), so the same thunk object drives the build and the types with **no second list**. It emits `widgets.json` mapping `component_path → { entry, css[] }` alongside the normal build (both faces in one dist).

## Strong widget typing — the full cycle

Opt-in **per app**, **no codegen**. Once an app registers its widgets, a **direct** `<EsmWidgetHost>` call gets autocomplete on the app name, on the widget selector (narrowed to that app's widgets), and `props` typed to the selected widget — wrong/missing/mistyped props rejected at compile time. An app that hasn't registered — and every call routed through `createDualLoader` (the transition wrappers) — stays exactly as loose as today. **The widget component's `Props` is the single source of truth: types are *computed* from it, never copied or generated, so they can't drift.**

### The contract — module-scoped, not global

`AsmaWidgetRegistry` is an **open** interface (`app → widget → Props`) exported by the package; each app augments it with **`declare module 'asma-mfw-esmloader'`** — the standard registry pattern (react-query `Register`, Redux, Vue), so there is zero global-namespace pollution. Empty by default ⇒ `keyof` is `never` ⇒ everything stays loose.

### Register an app — 3 lines, computed from `widgets` (no generated file)

```ts
// src/widgets.contract.ts
import type { RegistryFor } from 'asma-mfw-esmloader'
import type { widgets } from './widgets.config'
declare module 'asma-mfw-esmloader' {
    interface AsmaWidgetRegistry { 'asma-app-directory': RegistryFor<typeof widgets> }
}
```

`RegistryFor<typeof widgets>` derives `{ widgetName: Props }` by extracting each thunk's `Props` (`() => import('./entry')` → the entry's `mount(container, props)`). **Adding a widget = one line in `widgets.config.ts`** — the build entry, the `widgets.json` key, and the type all follow automatically.

### Use it, fully typed

```tsx
<EsmWidgetHost app="asma-app-directory" widget_name="/my-recipients-widget" props={{ amount_of_rows: 5 }} />
```

- **`widget_name`** (top-level, preferred) — the selector; it decides the `props` type.
- **`props.component_path`** (`@deprecated`) — the legacy selector, still accepted so the transition wrappers keep working; `createDualLoader`/qiankun stay on it.

### How the host sees an app's types

The augmentation merges only within one TS **program**, so a host adds a **type-only (workspace) dependency** on the apps it renders — or an aggregate `asma-widget-types` package that re-exports each app's `widgets.contract`. (A monorepo alone does **not** auto-merge across per-package tsconfigs.)

### What you get for free (rename / removal safety)

- Rename/delete a widget **file**, or drop its `Props` export → the `widgets.config` `import()` and the computed type break → **loud error at the app's `tsc`**.
- Rename a widget **name** → the key vanishes from the registry → **every stale `<EsmWidgetHost widget_name="old">` is a compile error** at the exact call site.
- Types are computed by reference, never copied/generated, so the registry cannot silently drift from the component.

## Entry points

- `asma-mfw-esmloader` — `createDualLoader`, `EsmWidgetHost`, `loadAndMountEsmWidget`, the `AsmaWidgetRegistry` contract + `RegistryFor`/`WidgetPropsOf` helpers, and the platform-signal / manifest / css helpers (host side).
- `asma-mfw-esmloader/contract` — `defineReactWidget` + the `WidgetModule`/`WidgetInstance` types (widget side; keeps widget bundles from pulling host code).
- `asma-mfw-esmloader/vite` — `widgetBuild()` for the app's `vite.config.widgets.ts` (build-time only; needs `typescript` present, which app builds have).

## Develop

```bash
pnpm install         # then: pnpm approve-builds (esbuild, for tsx)
pnpm check           # tsc --noEmit
pnpm test            # unit tests (node --test)
pnpm build           # tsc → lib/  (published: "files": ["lib"])
```

Pure logic (platform signal, manifest resolution + cache, css dedup) is unit-tested here; the full mount/update/unmount lifecycle is browser-verified via the `ignore-esm-architecture` demonstrator and the Phase-3 pilot.

## Publish (same flow as asma-core-helpers)

Own git repo / submodule; build (`pnpm build`) and publish to npm; hosts depend on the published version. `react`/`react-dom` are **peer** dependencies.
