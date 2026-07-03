import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
    collectEntryCss,
    packageNameOf,
    readWidgetEntries,
    sanitizeEntryName,
    widgetCodeSplitting,
    type OutputChunk,
} from './vite.js'

test('sanitizeEntryName makes a component_path safe as a Rollup chunk name', () => {
    assert.equal(sanitizeEntryName('/my-recipients-widget'), 'my-recipients-widget')
    assert.equal(sanitizeEntryName('user-list'), 'user-list')
    assert.equal(sanitizeEntryName('/a/b/c'), 'a__b__c')
    assert.equal(sanitizeEntryName('/'), 'index')
})

test('readWidgetEntries extracts name → import specifier from the thunk object', () => {
    const source = `
        export const widgets = {
            'user-list': () => import('./widgets/UserListWidget'),
            'user-detail': () => import('./widgets/UserDetailWidget'),
        }
    `
    assert.deepEqual(readWidgetEntries(source), {
        'user-list': './widgets/UserListWidget',
        'user-detail': './widgets/UserDetailWidget',
    })
})

test('readWidgetEntries handles identifier keys and a custom export name', () => {
    const source = `export const entries = { dashboard: () => import('./Dashboard') }`
    assert.deepEqual(readWidgetEntries(source, 'entries'), { dashboard: './Dashboard' })
})

test('readWidgetEntries ignores unrelated exports and non-import values', () => {
    const source = `
        export const other = { x: () => import('./nope') }
        export const widgets = {
            'a': () => import('./A'),
            'b': someHelper('./B'),
        }
    `
    assert.deepEqual(readWidgetEntries(source), { a: './A' })
})

test('readWidgetEntries throws when the widgets export is missing/empty', () => {
    assert.throws(() => readWidgetEntries(`export const widgets = {}`), /no `export const widgets/)
    assert.throws(() => readWidgetEntries(`const widgets = { a: () => import('./A') }`), /no `export const widgets/)
})

test('collectEntryCss unions CSS across the static import graph, dependencies first', () => {
    const chunk = (fileName: string, imports: string[], css: string[]): OutputChunk => ({
        type: 'chunk',
        fileName,
        imports,
        viteMetadata: { importedCss: new Set(css) },
    })
    const bundle: Record<string, OutputChunk> = {
        'widgets/a.js': chunk('widgets/a.js', ['chunks/vendor.js', 'chunks/mui.js'], ['assets/a.css']),
        'chunks/vendor.js': chunk('chunks/vendor.js', ['chunks/mui.js'], ['assets/vendor.css']),
        // shared + cyclic edge back to vendor — must not loop or duplicate
        'chunks/mui.js': chunk('chunks/mui.js', ['chunks/vendor.js'], ['assets/mui.css']),
    }
    assert.deepEqual(collectEntryCss(bundle['widgets/a.js']!, bundle), [
        'assets/mui.css',
        'assets/vendor.css',
        'assets/a.css', // the entry's own CSS last in the cascade
    ])
})

test('collectEntryCss tolerates chunks without imports/metadata and missing bundle edges', () => {
    const entry: OutputChunk = { type: 'chunk', fileName: 'widgets/a.js', imports: ['gone.js'] }
    assert.deepEqual(collectEntryCss(entry, {}), [])
})

test('packageNameOf extracts npm package names from plain and pnpm module ids', () => {
    assert.equal(packageNameOf('/repo/node_modules/react-dom/client.js'), 'react-dom')
    assert.equal(
        packageNameOf('/repo/node_modules/.pnpm/@mui+material@9.0.0/node_modules/@mui/material/Button.js'),
        '@mui/material',
    )
    assert.equal(packageNameOf('/repo/src/App.tsx'), undefined)
})

test('widgetCodeSplitting groups: react kernel wins over per-package; tail falls to vendor', () => {
    const { groups } = widgetCodeSplitting()
    const [react, perPackage, vendor] = groups
    // react/react-dom/scheduler → the substitutable kernel chunk; react-is/react-query must NOT match
    assert.match('/repo/node_modules/react-dom/client.js', react!.test!)
    assert.match('/x/node_modules/.pnpm/react@19.0.0/node_modules/react/index.js', react!.test!)
    assert.doesNotMatch('/repo/node_modules/react-is/index.js', react!.test!)
    assert.doesNotMatch('/repo/node_modules/@tanstack/react-query/index.js', react!.test!)
    assert.ok(react!.priority! > perPackage!.priority! && perPackage!.priority! > vendor!.priority!)
    // per-package name fn: chunk-name-safe package names, null for non-package ids
    const nameOf = perPackage!.name as (id: string) => string | null
    assert.equal(nameOf('/repo/node_modules/.pnpm/@mui+material@9.0.0/node_modules/@mui/material/x.js'), 'mui-material')
    assert.equal(nameOf('/repo/node_modules/tailwind-merge/dist/bundle.js'), 'tailwind-merge')
    assert.equal(nameOf('/repo/src/App.tsx'), null)
    assert.equal(vendor!.name, 'vendor')
    assert.equal(widgetCodeSplitting({ minPackageSize: 1 }).groups[1]!.minSize, 1)
})
