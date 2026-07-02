# asma-widget-loader

The transport-agnostic widget loader that supersedes `asma-qiankun-react-loader`. It loads a widget by `import()`ing an ES module that exports `mount()`, and `createDualLoader` dispatches **per app** between this native-ESM path and the legacy qiankun loader **with no global flag**. Zero qiankun dependency — this is the package that survives when qiankun is retired.

See [`_docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md`](../../_docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md) and [`_docs/frontend/architecture/2026-07-02-15-40-architecture-widget-taxonomy-and-composition.md`](../../_docs/frontend/architecture/2026-07-02-15-40-architecture-widget-taxonomy-and-composition.md).

## Usage in a host app (one file, mechanical swap)

```tsx
// src/components/mf-components/MfComponent.ts
import { MfComponentLoader } from 'asma-qiankun-react-loader/lib'
import { createDualLoader } from 'asma-widget-loader'

// Same props as MfComponentLoader. Reads window.__ASMA_PLATFORM__.apps[app.name].esm:
//   marked  → native-ESM <EsmWidgetHost>
//   unmarked/no payload → the injected MfComponentLoader (today's qiankun path), unchanged
export const MfComponent = createDualLoader(MfComponentLoader)
```

Then in each `Mf*` wrapper, swap `MfComponentLoader` → `MfComponent` (a rename — props are identical). No other host code changes; the qiankun loader is untouched.

## Usage in a widget (the app's widget build)

```tsx
import { defineReactWidget } from 'asma-widget-loader/contract'
import { MyWidget } from './MyWidget'
export const { mount } = defineReactWidget(MyWidget)
```

The app's `vite.config.widgets.ts` emits one such entry per `component_path` plus a `widgets.json` mapping `component_path → { entry, css[] }`.

## Entry points

- `asma-widget-loader` — `createDualLoader`, `EsmWidgetHost`, `loadAndMountEsmWidget`, the platform-signal + manifest + css helpers (host side).
- `asma-widget-loader/contract` — `defineReactWidget` + the `WidgetModule`/`WidgetInstance` types (widget side; keeps widget bundles from pulling host code).

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
