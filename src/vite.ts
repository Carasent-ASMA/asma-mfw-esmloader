/**
 * `./vite` — the widget BUILD side (build-time only; not imported by runtime code).
 *
 * `widgetBuild()` turns an app's `widgets.config.ts` (the single source of truth — `name → () => import('./entry')`
 * thunks, also consumed by the computed types via `RegistryFor<typeof widgets>`) into the Rollup `input` map
 * and a plugin that emits `widgets.json` (`name → { entry, css[] }`). It reads the entry specifiers by
 * PARSING `widgets.config.ts` with the TypeScript compiler (source, not transpiled output — robust), so the
 * one thunk object drives both the build and the types with no second list and no codegen.
 *
 * Usage — `vite.config.widgets.ts`:
 *     import { defineConfig } from 'vite'
 *     import { widgetBuild } from 'asma-mfw-esmloader/vite'
 *     const { input, plugin } = widgetBuild()
 *     export default defineConfig({
 *         plugins: [plugin],
 *         build: { emptyOutDir: false, rollupOptions: { input, output: { entryFileNames: 'widgets/[name].js' } } },
 *     })
 *
 * @see _docs/frontend/plans/2026-07-02-15-40-plan-shell-dual-loader-esm-and-qiankun.md — TASK-008
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import ts from 'typescript'

/** A widget's `component_path`/`widget_name` → its entry module specifier (relative to widgets.config). */
export type WidgetEntrySpecifiers = Record<string, string>

function propKey(name: ts.PropertyName): string | undefined {
    if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
    if (ts.isIdentifier(name)) return name.text
    return undefined
}

/** Find the first `import('<spec>')` specifier anywhere inside a node (the thunk body `() => import('./x')`). */
function importSpecifier(node: ts.Node): string | undefined {
    let found: string | undefined
    const walk = (n: ts.Node): void => {
        if (found) return
        if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const arg = n.arguments[0]
            if (arg && ts.isStringLiteral(arg)) {
                found = arg.text
                return
            }
        }
        ts.forEachChild(n, walk)
    }
    walk(node)
    return found
}

/**
 * Parse `export const <exportName> = { 'name': () => import('./entry'), … }` from `widgets.config.ts`
 * source into `{ name: './entry' }`. Pure + unit-testable (no fs). Throws on an empty/absent export.
 */
export function readWidgetEntries(source: string, exportName = 'widgets'): WidgetEntrySpecifiers {
    const sourceFile = ts.createSourceFile('widgets.config.ts', source, ts.ScriptTarget.Latest, true)
    const entries: WidgetEntrySpecifiers = {}

    const visit = (node: ts.Node): void => {
        if (
            ts.isVariableStatement(node) &&
            node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
            for (const decl of node.declarationList.declarations) {
                if (
                    ts.isIdentifier(decl.name) &&
                    decl.name.text === exportName &&
                    decl.initializer &&
                    ts.isObjectLiteralExpression(decl.initializer)
                ) {
                    for (const prop of decl.initializer.properties) {
                        if (ts.isPropertyAssignment(prop)) {
                            const key = propKey(prop.name)
                            const spec = importSpecifier(prop.initializer)
                            if (key && spec) entries[key] = spec
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)

    if (Object.keys(entries).length === 0) {
        throw new Error(`readWidgetEntries: no \`export const ${exportName} = { … () => import('…') }\` found`)
    }
    return entries
}

const RESOLVE_EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts']

/** Resolve an entry specifier to an on-disk file (Rollup input wants a real path). */
function resolveEntryFile(base: string): string {
    for (const ext of RESOLVE_EXTS) {
        if (existsSync(base + ext)) return base + ext
    }
    return base // let Vite's resolver try
}

/**
 * The widget NAME (a `component_path` like `/my-recipients-widget`) is the widgets.json key the loader
 * looks up — but a Rollup input name can't carry a leading/embedded `/`. Sanitize for the chunk name;
 * the original name is preserved as the manifest key.
 */
export function sanitizeEntryName(widgetName: string): string {
    return widgetName.replace(/^\/+/, '').replace(/\//g, '__') || 'index'
}

/** A Rollup output chunk (minimal structural view — avoids a hard `vite`/`rollup` type dependency). */
export interface OutputChunk {
    type: string
    isEntry?: boolean
    name?: string
    fileName: string
    /** fileNames of statically imported sibling chunks — the edges of the chunk graph. */
    imports?: string[]
    viteMetadata?: { importedCss?: Set<string> }
}

/**
 * All CSS a widget entry needs = the union of `importedCss` across the entry's whole STATIC import
 * graph, not just the entry chunk itself — with `codeSplitting` (per-package vendor chunks) a vendor's
 * CSS is attached to the vendor chunk. Post-order DFS so dependency CSS precedes the entry's own
 * (base styles first, widget overrides last in the cascade).
 */
export function collectEntryCss(entry: OutputChunk, bundle: Record<string, OutputChunk>): string[] {
    const css = new Set<string>()
    const seen = new Set<string>()
    const walk = (chunk: OutputChunk): void => {
        if (seen.has(chunk.fileName)) return
        seen.add(chunk.fileName)
        for (const imported of chunk.imports ?? []) {
            const next = bundle[imported]
            if (next) walk(next)
        }
        for (const file of chunk.viteMetadata?.importedCss ?? []) css.add(file)
    }
    walk(entry)
    return [...css]
}

const PKG_NAME_RE = /node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?((?:@[^\\/]+[\\/])?[^\\/]+)/

/** Extract the npm package name from a module id (pnpm `.pnpm/…/node_modules/<pkg>` paths included). */
export function packageNameOf(id: string): string | undefined {
    const match = PKG_NAME_RE.exec(id)
    return match?.[1]?.replace(/\\/g, '/')
}

/** One `codeSplitting` group (structural subset of rolldown's `CodeSplittingGroup` — no rolldown type dep). */
export interface WidgetChunkGroup {
    name: string | ((id: string) => string | null)
    test?: RegExp
    priority?: number
    minSize?: number
}

export interface WidgetCodeSplittingOptions {
    /** Packages whose accumulated size is below this stay merged in the `vendor` chunk. Default 20 KiB. */
    minPackageSize?: number
}

const DEV_SCHEME = 'virtual:asma-widget-dev/'

interface ResolvedConfigLike {
    root: string
    base: string
}

interface DevResponseLike {
    setHeader: (name: string, value: string) => void
    end: (body: string) => void
}

interface DevServerLike {
    middlewares: {
        use: (fn: (req: { url?: string }, res: DevResponseLike, next: () => void) => void) => void
    }
}

/**
 * The dev wrapper module served for one widget: installs the react-refresh preamble + Vite client
 * BEFORE the widget module executes (mirrors asma-qiankun-plugin-vite's dev entry), then re-exports
 * `mount` from the real SOURCE module — full HMR, zero builds. Pure + unit-testable.
 *
 * `injectIntoGlobalHook` must run UNCONDITIONALLY (guarded only per dev-server origin): the standard
 * `__vite_plugin_react_preamble_installed__` flag only says SOME runtime injected — when the HOST page
 * is itself a Vite+react app (the real shell) that flag is already true, but a widget's components
 * re-render through THIS server's refresh runtime, so skipping the injection silently kills HMR for
 * every widget (updates arrive, nothing re-renders). Same unconditional injection as the qiankun
 * plugin's dev entry; the per-origin guard keeps N widgets of one app from double-wrapping the hook.
 */
export function devWrapperSource(base: string, targetUrl: string): string {
    return [
        `import ${JSON.stringify(`${base}@vite/client`)}`,
        `import RefreshRuntime from ${JSON.stringify(`${base}@react-refresh`)}`,
        `const originFlag = '__asma_widget_dev_refresh__' + new URL(import.meta.url).origin`,
        `if (!window[originFlag]) {`,
        `    RefreshRuntime.injectIntoGlobalHook(window)`,
        `    window[originFlag] = true`,
        `}`,
        `window.$RefreshReg$ = window.$RefreshReg$ || (() => {})`,
        `window.$RefreshSig$ = window.$RefreshSig$ || (() => (type) => type)`,
        `window.__vite_plugin_react_preamble_installed__ = true`,
        `const widgetModule = await import(${JSON.stringify(targetUrl)})`,
        `export const mount = widgetModule.mount`,
    ].join('\n')
}

/**
 * DEV: register in the app's NORMAL `vite.config.ts` (serve-only; the qiankun dev flow is untouched).
 * Makes `pnpm dev` also answer `widgets.json`, whose entries point at dev wrapper modules
 * (`/@id/virtual:asma-widget-dev/<name>`) that load the widget's SOURCE with HMR — so a shell
 * (local or deployed) overriding `window.__ASMA_PLATFORM__.apps[<app>]` to
 * `{ base: 'http://localhost:<port>/', esm: true }` composes the live dev widget. Same
 * `widgets.config.ts` single source of truth as `widgetBuild()`. Demonstrator-verified pattern
 * (`ignore-esm-architecture` `widgetEntriesDev`, browser-checked incl. HMR).
 */
export function widgetDev(options: WidgetBuildOptions = {}): {
    name: string
    apply: 'serve'
    configResolved: (config: ResolvedConfigLike) => void
    configureServer: (server: DevServerLike) => void
    resolveId: (id: string) => string | null
    load: (id: string) => string | null
} {
    const configRel = options.config ?? 'src/widgets.config.ts'
    let root = process.cwd()
    let base = '/'
    let specifiers: WidgetEntrySpecifiers = {}
    let nameToKey: Record<string, string> = {}

    /** widget name → root-relative source URL of its entry (what the dev wrapper imports). */
    const entryUrlFor = (widgetName: string): string => {
        const configAbs = path.resolve(root, configRel)
        const abs = resolveEntryFile(path.resolve(path.dirname(configAbs), specifiers[widgetName] ?? ''))
        return base + path.relative(root, abs).split(path.sep).join('/')
    }

    return {
        name: 'asma-widget-dev',
        apply: 'serve',
        configResolved(config: ResolvedConfigLike): void {
            root = config.root
            base = config.base
            specifiers = readWidgetEntries(readFileSync(path.resolve(root, configRel), 'utf8'), options.exportName)
            nameToKey = Object.fromEntries(Object.keys(specifiers).map((name) => [sanitizeEntryName(name), name]))
        },
        configureServer(server: DevServerLike): void {
            server.middlewares.use((req, res, next) => {
                const url = (req.url ?? '').split('?')[0]
                if (url !== `${base}widgets.json` && url !== '/widgets.json') return next()
                res.setHeader('content-type', 'application/json')
                res.setHeader('access-control-allow-origin', '*')
                // Base-absolute /@id/ URLs so the loader's `new URL(entry, overrideBase)` hits this server.
                const widgets = Object.fromEntries(
                    Object.keys(specifiers).map((name) => [name, `${base}@id/${DEV_SCHEME}${sanitizeEntryName(name)}`]),
                )
                res.end(`${JSON.stringify({ widgets }, null, 2)}\n`)
            })
        },
        // Keep dev ids \0-free so their /@id/ URLs stay plain and importable (demonstrator note).
        resolveId(id: string): string | null {
            return id.startsWith(DEV_SCHEME) ? id : null
        },
        load(id: string): string | null {
            if (!id.startsWith(DEV_SCHEME)) return null
            const widgetName = nameToKey[id.slice(DEV_SCHEME.length)]
            return widgetName ? devWrapperSource(base, entryUrlFor(widgetName)) : null
        },
    }
}

/**
 * Recommended `output.codeSplitting` for widget builds — REUSABLE vendor chunks instead of one fat entry:
 *   1. `react` — react/react-dom/scheduler as ONE chunk: the import-map substitution target when the
 *      shared-kernel endgame lands (CON-002), and the chunk every widget of the app shares today.
 *   2. per-package — each big dependency (`mui-material`, `tanstack-table-core`, …) is its own chunk, so a
 *      page loading N widgets of the app fetches each library once, and a widget that doesn't use a
 *      library doesn't fetch it.
 *   3. `vendor` — the small-package tail, one shared chunk.
 *   4. `esm-external-require` — rolldown's synthetic CJS require-shims for KERNEL_EXTERNAL libs, isolated.
 * App source stays under automatic chunking (entry = the widget's own code; code shared between widget
 * entries auto-splits). Pass to `build.rollupOptions.output.codeSplitting`.
 *
 * `includeDependenciesRecursively: false` is DELIBERATE and load-bearing: with rolldown's default (`true`)
 * a package's group also swallows that package's OWN dependencies, so a barrel lib like `asma-ui-core`
 * drags @mui/@tanstack/@dnd-kit/date-fns INTO its chunk (~815 kB, mostly not asma-ui-core). Off, each of
 * those deps lands in its own reusable chunk and asma-ui-core drops to ~180 kB of actually-its-own code.
 *
 * The `esm-external-require` group is REQUIRED for kernel-external builds: when a lib is externalized,
 * rolldown's `esm-external-require` plugin synthesizes a tiny CJS-interop module per lib
 * (`builtin:esm-external-require-<lib>` = `module.exports = {...React}`) so bundled CJS deps' `require()`
 * keeps working. Since the externalized lib is NOT a `node_modules` path, that shim matches none of the
 * groups above, and — with `preserveEntrySignatures: 'allow-extension'` (below) — rolldown FOLDS it into
 * whatever chunk first reaches it, which can be a widget ENTRY. Shared chunks (`vendor`) then import the
 * shim back from the entry → a `vendor ⇄ entry` cycle; a widget entry runs its `mount` bootstrap at
 * module-eval, so loading any widget that pulls `vendor` executes the entry mid-cycle and calls a
 * not-yet-initialized binding → `EsmWidgetHost failed … TypeError: <x> is not a function`. Pinning the
 * shims to their own side-effect-free chunk (a clean leaf importing only the external libs) guarantees no
 * entry is ever imported by a shared chunk. It is disjoint from the `node_modules` groups, so its priority
 * only needs to be defined; `'strict'`/`'exports-only'` (which would forbid the fold) are rejected by
 * rolldown alongside `includeDependenciesRecursively:false`, hence the chunk-level fix.
 *
 * REQUIRED sibling options (rolldown errors `INVALID_OPTION` otherwise): the build must set
 * `rollupOptions.preserveEntrySignatures: 'allow-extension'` (keeps the entry's `mount` export) and
 * `output.strictExecutionOrder: true`.
 */
export function widgetCodeSplitting(
    options: WidgetCodeSplittingOptions = {},
): { groups: WidgetChunkGroup[]; includeDependenciesRecursively: false } {
    const minPackageSize = options.minPackageSize ?? 20 * 1024
    return {
        includeDependenciesRecursively: false,
        groups: [
            { name: 'react', test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/, priority: 3 },
            {
                name: (id: string) => {
                    const pkg = packageNameOf(id)
                    return pkg ? pkg.replace(/^@/, '').replace(/\//g, '-') : null
                },
                test: /node_modules/,
                priority: 2,
                minSize: minPackageSize,
            },
            { name: 'vendor', test: /node_modules/, priority: 1 },
            // Kernel-external CJS require-shims → their own leaf chunk (see doc above). Priority 4 is
            // arbitrary-but-defined: the `builtin:esm-external-require-*` id matches no other group.
            { name: 'esm-external-require', test: /builtin:esm-external-require/, priority: 4 },
        ],
    }
}

interface EmitFileContext {
    emitFile: (file: { type: 'asset'; fileName: string; source: string }) => void
}

export interface WidgetBuildOptions {
    /** Path to the widgets config, relative to the build cwd. Default `'src/widgets.config.ts'`. */
    config?: string
    /** Exported object name in that file. Default `'widgets'`. */
    exportName?: string
}

/**
 * Build the Rollup `input` map + the `widgets.json`-emitting plugin from `widgets.config.ts`.
 * `input` is read synchronously (needed before Rollup starts); `widgets.json` (with per-entry `css[]`,
 * REQ-007) is emitted in `generateBundle` from the `importedCss` of each entry's static import graph.
 */
export function widgetBuild(options: WidgetBuildOptions = {}): {
    input: Record<string, string>
    plugin: { name: string; generateBundle: (this: EmitFileContext, _o: unknown, bundle: Record<string, OutputChunk>) => void }
} {
    const configAbs = path.resolve(process.cwd(), options.config ?? 'src/widgets.config.ts')
    const specifiers = readWidgetEntries(readFileSync(configAbs, 'utf8'), options.exportName)
    const configDir = path.dirname(configAbs)

    // Rollup input is keyed by a sanitized chunk name; `nameToKey` maps it back to the original widget
    // name so widgets.json is keyed by exactly what the loader looks up (the `component_path`).
    const input: Record<string, string> = {}
    const nameToKey: Record<string, string> = {}
    for (const [widgetName, spec] of Object.entries(specifiers)) {
        const chunkName = sanitizeEntryName(widgetName)
        input[chunkName] = resolveEntryFile(path.resolve(configDir, spec))
        nameToKey[chunkName] = widgetName
    }

    const plugin = {
        name: 'asma-widget-build',
        generateBundle(this: EmitFileContext, _o: unknown, bundle: Record<string, OutputChunk>): void {
            const widgets: Record<string, { entry: string; css: string[] }> = {}
            for (const chunk of Object.values(bundle)) {
                const key = chunk.type === 'chunk' && chunk.isEntry && chunk.name ? nameToKey[chunk.name] : undefined
                if (key) {
                    widgets[key] = {
                        entry: chunk.fileName,
                        // whole static import graph, not just the entry — vendor chunks carry their own CSS
                        css: collectEntryCss(chunk, bundle),
                    }
                }
            }
            this.emitFile({ type: 'asset', fileName: 'widgets.json', source: `${JSON.stringify({ widgets }, null, 2)}\n` })
        },
    }

    return { input, plugin }
}
