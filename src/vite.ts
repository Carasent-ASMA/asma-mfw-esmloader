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

/**
 * Recommended `output.codeSplitting` for widget builds — REUSABLE vendor chunks instead of one fat entry:
 *   1. `react` — react/react-dom/scheduler as ONE chunk: the import-map substitution target when the
 *      shared-kernel endgame lands (CON-002), and the chunk every widget of the app shares today.
 *   2. per-package — each big dependency (`mui-material`, `tailwind-merge`, …) is its own chunk, so a
 *      page loading N widgets of the app fetches each library once, and a widget that doesn't use a
 *      library doesn't fetch it.
 *   3. `vendor` — the small-package tail, one shared chunk.
 * App source stays under automatic chunking (entry = the widget's own code; code shared between widget
 * entries auto-splits). Pass to `build.rollupOptions.output.codeSplitting`.
 */
export function widgetCodeSplitting(options: WidgetCodeSplittingOptions = {}): { groups: WidgetChunkGroup[] } {
    const minPackageSize = options.minPackageSize ?? 20 * 1024
    return {
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
