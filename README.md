# asma-mfw-esmloader

The transport-agnostic widget loader that supersedes `asma-qiankun-react-loader`. It loads a widget by `import()`ing an ES module that exports `mount()`, and `createDualLoader` dispatches **per app** between this native-ESM path and the legacy qiankun loader **with no global flag**. Zero qiankun dependency — this is the package that survives when qiankun is retired.

See [`_docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md`](../../_docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md) and [`_docs/frontend/architecture/2026-07-02-15-40-architecture-widget-taxonomy-and-composition.md`](../../_docs/frontend/architecture/2026-07-02-15-40-architecture-widget-taxonomy-and-composition.md).

---

## Mental model — two faces, one dist

An app built with this loader ships **both faces in a single `dist/`** and answers to **two runtime modes**:

| Mode | How it's reached | What renders | Which build produced it |
| --- | --- | --- | --- |
| **Standalone** | Someone opens the app's own URL directly (`https://<cdn>/<app>/<version>/` or `http://localhost:3003/` in dev) | `index.html` → `src/main.tsx` → the **whole `<App/>`** (routes, home page) | `vite build` (the normal Vite app — `vite.config.ts`) |
| **Widget** | A host/shell renders `<EsmWidgetHost app="…" widget_name="/…" />`; the loader fetches `widgets.json` and `import()`s one entry | one **widget leaf** wrapped in the app's providers — not the whole app | `vite build --config vite.config.widgets.ts` (the additive ESM build) |

The two builds write into the **same `dist/`** (`emptyOutDir: false` on the second), so the deployed artifact serves the standalone `index.html` *and* `widgets/*.js` + `widgets.json` side by side. Nothing about standalone mode changes when you add widget mode — the widget build is purely **additive**.

The widget-mode load flow, end to end:

```text
<EsmWidgetHost app="asma-app-directory" widget_name="/customers" props={…} />
  → getAppSignal("asma-app-directory")           // reads window.__ASMA_PLATFORM__ (server-injected) or a dev override
  → fetch  <base>/widgets.json                    // { "/customers": { entry: "widgets/customers.js", css: [...] } }
  → ensureStylesheets(css)                         // insert the widget's CSS (a bare import() loads none)
  → import("<base>/widgets/customers.js")          // the ES module
  → module.mount(container, props)                 // returns { update, unmount }; each mount owns its own React root
```

There is **no window-global handoff, no LoaderQueue** — the browser module cache dedupes by URL and each mount is instance-per-module, so N concurrent mounts of any mix of widgets can't interfere.

---

## Full setup — a widget app end to end

Follow these steps to take a plain Vite + React app to one that runs **standalone** and serves **native-ESM widgets** to a shell. File paths assume a standard `src/` layout; adjust to yours.

### Step 0 — install

`react` / `react-dom` are peer deps (the loader mounts with your app's React). `typescript` is an optional peer used only by the build helper (`widgetBuild`/`widgetDev` parse `widgets.config.ts` with the TS compiler) — every app build already has it.

```bash
pnpm add asma-mfw-esmloader
# peers you already have: react, react-dom, typescript, vite, @vitejs/plugin-react
```

### Step 1 — declare the widgets (single source of truth)

One `src/widgets.config.ts` per app. Its `name → () => import('./entry')` thunks drive **the build, the dev server, and the types** — there is no second list anywhere.

```ts
// src/widgets.config.ts
// Keys are the `component_path` / `widget_name` the shell looks up (leading slash).
// Adding a widget = one line here; the build entry, the widgets.json key, and the
// registry type all follow automatically.
export const widgets = {
    '/customers': () => import('./widgets/CustomersWidget'),
    '/users-overview': () => import('./widgets/UsersOverviewWidget'),
    '/my-recipients-widget': () => import('./widgets/MyRecipientsWidget'),
}
```

### Step 2 — write each widget entry

An entry file exports `mount`. Wrap **only the widget's leaf** in the app's providers (not the whole `<App/>`) — that keeps each widget bundle to its own chunk instead of the entire application. Props are declared **once**, in the leaf component's own signature; `defineReactWidget` infers them.

```tsx
// src/widgets/CustomersWidget.tsx
import { defineReactWidget } from 'asma-mfw-esmloader/contract'
import type { ComponentProps } from 'react'

import { Customers } from '../modules/Customers'
import { AppProviders } from '../AppProviders'

// Reference the leaf's props (don't restate them) so there's still one source of truth:
export const { mount } = defineReactWidget((props: ComponentProps<typeof Customers>) => (
    <AppProviders>
        <Customers {...props} />
    </AppProviders>
))
```

If a widget takes no providers, it's even shorter — `export const { mount } = defineReactWidget(Customers)`.

Keep the app-wide providers in their **own file** (`src/AppProviders.tsx`), separate from `App.tsx` (which owns routes). Widget entries import `AppProviders` but **never** `App.tsx`, so a widget bundle doesn't pull in the router and every page.

### Step 3 — (optional) register the widgets for strong typing

Three lines, computed from `widgets` (no codegen). After this, a host that type-depends on your app gets autocompleted, prop-checked `<EsmWidgetHost>` calls. Skip it and everything still works, just loosely typed. See [Strong widget typing](#strong-widget-typing--the-full-cycle) for the full cycle.

```ts
// src/widgets.contract.ts
import type { RegistryFor } from 'asma-mfw-esmloader'

import type { widgets } from './widgets.config'

declare module 'asma-mfw-esmloader' {
    interface AsmaWidgetRegistry {
        'asma-app-directory': RegistryFor<typeof widgets>
    }
}
```

### Step 4 — the standalone face (`index.html`, `main.tsx`, `App.tsx`)

This is a **plain Vite app** — it's what someone sees when they open the app's URL directly. Nothing here is loader-specific; if you already have a standalone app, it's unchanged.

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>asma-app-directory</title>
    </head>
    <body>
        <div id="root"></div>
        <script type="module" src="/src/main.tsx"></script>
    </body>
</html>
```

```tsx
// src/main.tsx — the standalone entry (qiankun-retired form).
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(<App />)
```

```tsx
// src/App.tsx — the full standalone application (routes / home).
import { AppProviders } from './AppProviders'
import { AppRoutes } from './routes/AppRoutes'

export const App = () => (
    <AppProviders>
        <AppRoutes />
    </AppProviders>
)
```

> **Coexistence with qiankun (transition apps only).** If the legacy qiankun shell must still mount this app while you migrate, keep the template `main.tsx` (roots map + `renderWithQiankun` from `asma-qiankun-plugin-vite`, with `if (!qiankunWindow.__POWERED_BY_QIANKUN__) render({})` for the standalone fallback) and an `App` that switches on `props.component_path`. That path is untouched by the widget build; see [Coexistence & migration](#coexistence--migration).

### Step 5 — the app build with dev widgets (`vite.config.ts`)

Your **normal** Vite config, plus `widgetDev()`. `widgetDev()` is **serve-only**: it makes `pnpm dev` also answer `widgets.json` (pointing at source modules with HMR), so a shell can load your widgets live from your dev server. It has **no effect on `vite build`** and doesn't touch standalone mode.

```ts
// vite.config.ts
import react from '@vitejs/plugin-react'
import { widgetDev } from 'asma-mfw-esmloader/vite'
import { defineConfig } from 'vite'

export default defineConfig({
    // `base` is where the deployed artifact lives — e.g. `/cdn/asma-app-directory/1.2.3/`.
    // Standalone assets AND the widget entries both resolve against it. Read from env in CI.
    base: process.env.BASE_PATH ?? '/',
    plugins: [
        react(),
        widgetDev(), // serve-only: `pnpm dev` also serves widgets.json + source widgets with HMR
    ],
    server: {
        cors: true, // a cross-origin shell must be able to fetch your widgets.json + entries
        port: 3003,
    },
    resolve: {
        // Compile workspace/helper packages against THIS app's React, not a hoisted copy.
        dedupe: ['react', 'react-dom'],
    },
})
```

### Step 6 — the additive widget build (`vite.config.widgets.ts`)

A second config that mirrors the app's plugins **minus qiankun**, feeds the widget entries as Rollup input, and emits `widgets.json`. It writes into the **same `dist/`** as the app build (`emptyOutDir: false`), so the artifact carries both faces.

```ts
// vite.config.widgets.ts
import react from '@vitejs/plugin-react'
import { widgetBuild, widgetCodeSplitting } from 'asma-mfw-esmloader/vite'
import { defineConfig } from 'vite'

// Reads src/widgets.config.ts (the same single source of truth) → Rollup `input` + a
// plugin that emits dist/widgets.json (component_path → { entry, css[] }).
const { input, plugin } = widgetBuild()

export default defineConfig({
    base: process.env.BASE_PATH ?? '/',
    build: {
        emptyOutDir: false, // keep the app build's dist/ — write BOTH faces into one dist
        target: 'es2022',
        rollupOptions: {
            input,
            output: {
                format: 'es',
                entryFileNames: 'widgets/[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                // Reusable vendor chunks (react kernel / per-package / small-package tail) so a
                // page loading N widgets of this app fetches each library once. Optional.
                // NOTE: `output.codeSplitting` is a rolldown-vite feature; on classic Rollup use
                // `output.manualChunks` instead. `widgetCodeSplitting()` returns the rolldown shape.
                codeSplitting: widgetCodeSplitting(),
            },
            preserveEntrySignatures: 'exports-only',
        },
    },
    plugins: [react(), plugin],
    resolve: { dedupe: ['react', 'react-dom'] },
    // For the built-artifact dev loop (Step 8): serve dist/ cross-origin so a shell override can reach it.
    preview: { cors: true },
})
```

`widgetBuild()` and `widgetDev()` accept `{ config?, exportName? }` if your widgets file isn't the default `src/widgets.config.ts` / isn't exported as `widgets`.

### Step 7 — wire the scripts (`package.json`)

The key line is `build`: run the app build, then the widget build into the same dist. Split them so each is runnable on its own.

```jsonc
{
    "scripts": {
        "dev": "vite",
        "build": "tsc && vite build && vite build --config vite.config.widgets.ts",
        "build:app": "vite build",
        "build:widgets": "vite build --config vite.config.widgets.ts",
        "preview": "vite preview",
        "check": "tsc --noEmit"
    }
}
```

After `pnpm build`, `dist/` contains:

```text
dist/
├── index.html            ← standalone face (opened directly)
├── assets/…              ← the standalone app bundle
├── widgets/customers.js  ← widget-mode entries (import()ed by the loader)
├── widgets/users-overview.js
├── chunks/…              ← shared vendor chunks
└── widgets.json          ← component_path → { entry, css[] }
```

### Step 8 — deploy & platform signal

Deploy the whole `dist/` to the app's CDN base (`<service>/<version>/`). Two things make the shell take the ESM path:

1. **`widgets.json` must land at the app's base** (`<base>/widgets.json`). The static server (asma-static-server) `HEAD`s it and, when present, marks that app@version `esm: true` in the server-injected `window.__ASMA_PLATFORM__` payload.
2. **The shell reads that signal** (`getAppSignal` / `isEsmApp`) and routes the app to `<EsmWidgetHost>`. An app whose artifact has no `widgets.json` stays on the qiankun path — the flip is per app@version, decided by the artifact itself, with no global flag.

To exercise this **without a real platform**, use the import-map-override dev workflow below — it treats an overridden app as `esm: true` at your dev/preview base.

---

## Using it in a host / shell

### Final form — `<EsmWidgetHost>` (typed, no qiankun)

The destination API. Pass the app **name** (the loader resolves its base from `window.__ASMA_PLATFORM__`), the `widget_name`, and `props`. With the app registered (Step 3) all three are compile-checked.

```tsx
import { EsmWidgetHost } from 'asma-mfw-esmloader'

<EsmWidgetHost app="asma-app-directory" widget_name="/customers" props={{ amount_of_rows: 5 }} />
```

It keeps the `MfComponentLoader` UX contract: container-per-widget, `placeholder` / `LoaderComponent`, update-in-place on prop change, abort-on-unmount, `onMounted`.

### Transition form — `createDualLoader` (drop-in, per-app dispatch)

While apps migrate, wrap the legacy loader once per host app. The result has the **same props as `MfComponentLoader`**, so swapping it in is a rename. Per mount it reads the platform signal: marked `esm` → `<EsmWidgetHost>`; otherwise → the injected qiankun loader, unchanged.

```tsx
// src/components/mf-components/MfComponent.ts
import { MfComponentLoader } from 'asma-qiankun-react-loader/lib'
import { createDualLoader } from 'asma-mfw-esmloader'

export const MfComponent = createDualLoader(MfComponentLoader)
```

Then in each `Mf*` wrapper, swap `MfComponentLoader` → `MfComponent`. No other host code changes; the qiankun loader is untouched and carries zero qiankun dependency in this package. `createDualLoader` is **transition-only scaffolding** (`@deprecated`) — once an app's widgets are all ESM, replace its `MfComponent` with `EsmWidgetHost` and delete the wrapper.

---

## Dev workflow — source + HMR, zero builds

With `widgetDev()` in your `vite.config.ts` (Step 5), `pnpm dev` serves `widgets.json` pointing at dev wrapper modules that install the react-refresh preamble + Vite client before loading the widget **source**. To compose your live dev widget inside a shell, use the **`import-map-overrides` widget you already have** (single-spa schema) — no separate mechanism. Point the app at your dev server and reload:

```js
// exactly what the overrides widget writes; survives reloads:
localStorage.setItem('import-map-override:asma-app-directory', 'http://localhost:3003/')
// back to normal (or toggle it off in the widget / add to import-map-overrides-disabled):
localStorage.removeItem('import-map-override:asma-app-directory')
```

An app with an active override is treated as `esm: true` with `widgets.json` at that base — the loader takes the ESM path from your dev server: source modules, live HMR inside the composed page. (`http://localhost` is exempt from mixed-content blocking, so this works in a deployed dev shell too.) Meanwhile `http://localhost:3003/` still serves the **standalone** app — both modes from one dev server.

To exercise the **built** artifact instead: `vite build --config vite.config.widgets.ts --watch` + `vite preview` (with `preview: { cors: true }`) and point the override at the preview port.

**Transition semantic:** in a dual-loader shell, an active override routes that app to the ESM path. To dev a NOT-yet-migrated app on the qiankun path via the same widget, add it to the widget's disabled list (`import-map-overrides-disabled`) — the qiankun entry override still applies.

> A full runnable reference of every mode above (shell + three apps + kernel + static server) lives in the [`ignore-esm-architecture`](../../ignore-esm-architecture/README.md) demonstrator (`pnpm start`, `pnpm check:browser`).

---

## Coexistence & migration

An app@version serves **all** its widgets one way (the all-or-nothing rule): `widgets.json` present → ESM; absent → qiankun. During migration the same project can carry both faces and the shell dispatches per app:

- **Standalone** always works, both forms: the qiankun-retired `main.tsx` (Step 4) or the template `main.tsx` with `renderWithQiankun` + the `__POWERED_BY_QIANKUN__` standalone fallback.
- **Legacy shell** can still `loadMicroApp` a not-yet-migrated app (its `App` switches on `component_path`).
- **ESM shell** loads a migrated app's widgets via `widgets.json`.

Migrating a call site is a two-line move once the app augments the registry:

```tsx
// transition (dual loader) — dispatches per app, loose props:
<MfComponent app={app} props={{ component_path, ...props }} />

// final — direct, strongly typed:
<EsmWidgetHost app="asma-app-directory" widget_name="/customers" props={{ amount_of_rows: 5 }} />
```

---

## Strong widget typing — the full cycle

Opt-in **per app**, **no codegen**. Once an app registers its widgets (Step 3), a **direct** `<EsmWidgetHost>` call gets autocomplete on the app name, on the widget selector (narrowed to that app's widgets), and `props` typed to the selected widget — wrong/missing/mistyped props rejected at compile time. An app that hasn't registered — and every call routed through `createDualLoader` — stays exactly as loose as today. **The widget component's `Props` is the single source of truth: types are *computed* from it, never copied or generated, so they can't drift.**

### The contract — module-scoped, not global

`AsmaWidgetRegistry` is an **open** interface (`app → widget → Props`) exported by the package; each app augments it with **`declare module 'asma-mfw-esmloader'`** — the standard registry pattern (react-query `Register`, Redux, Vue), so there is zero global-namespace pollution. Empty by default ⇒ `keyof` is `never` ⇒ everything stays loose.

`RegistryFor<typeof widgets>` (Step 3) derives `{ widgetName: Props }` by extracting each thunk's `Props` (`() => import('./entry')` → the entry's `mount(container, props)`). **Adding a widget = one line in `widgets.config.ts`** — the build entry, the `widgets.json` key, and the type all follow automatically.

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

---

## Gotchas (learned in the demonstrator, so you don't have to)

- **`resolve.dedupe: ['react', 'react-dom']`** in every app build — workspace/helper packages must compile against the app's own React, not a hoisted one.
- **Foreign-root container** — the host must never render React-managed children inside the div a widget mounts into; two renderers fighting over the same childNodes throws `removeChild NotFoundError`. `EsmWidgetHost` already keeps its container a leaf (loading/error render as siblings) — preserve that if you write your own host.
- **CSS must travel in `widgets.json`** — a bare `import()` loads no stylesheets (qiankun's html-entry used to). `widgetBuild()` collects each entry's CSS across its whole static import graph into `css[]`, and the loader inserts it (dedup'd) before mount. Don't hand-roll entries that skip this.
- **A widget that still bundles CJS React** needs `define: { 'process.env.NODE_ENV': '"production"' }` in its build, or it crashes in the browser (lib mode keeps `process.env`).

---

## Entry points

- `asma-mfw-esmloader` — `createDualLoader`, `EsmWidgetHost`, `loadAndMountEsmWidget`, the `AsmaWidgetRegistry` contract + `RegistryFor`/`WidgetPropsOf` helpers, and the platform-signal / manifest / css helpers (host side).
- `asma-mfw-esmloader/contract` — `defineReactWidget` + the `WidgetModule`/`WidgetInstance` types (widget side; keeps widget bundles from pulling host code).
- `asma-mfw-esmloader/vite` — `widgetBuild()`, `widgetDev()`, `widgetCodeSplitting()` for the app's Vite configs (build-time only; needs `typescript` present, which app builds have).

---

## Develop (this package)

```bash
pnpm install         # then: pnpm approve-builds (esbuild, for tsx)
pnpm check           # tsc --noEmit
pnpm test            # unit tests (node --test)
pnpm build           # tsc → lib/  (published: "files": ["lib"])
```

Pure logic (platform signal, manifest resolution + cache, css dedup, `widgets.config` parsing) is unit-tested here; the full mount/update/unmount lifecycle is browser-verified via the `ignore-esm-architecture` demonstrator and the Phase-3 pilot.

## Publish (same flow as asma-core-helpers)

Own git repo / submodule; build (`pnpm build`) and publish to npm; hosts depend on the published version. `react`/`react-dom` are **peer** dependencies.
