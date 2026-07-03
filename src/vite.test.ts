import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readWidgetEntries, sanitizeEntryName } from './vite.js'

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
