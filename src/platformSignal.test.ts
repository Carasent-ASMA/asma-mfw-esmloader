import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { getAppSignal, getInjectedPlatform, isEsmApp } from './platformSignal.ts'

const g = globalThis as { window?: unknown; localStorage?: unknown }
afterEach(() => {
    delete g.window
    delete g.localStorage
})

function fakeLocalStorage(items: Record<string, string>): unknown {
    return { getItem: (k: string) => items[k] ?? null }
}

describe('getInjectedPlatform', () => {
    it('returns undefined outside a browser', () => {
        assert.equal(getInjectedPlatform(), undefined)
    })

    it('reads window.__ASMA_PLATFORM__', () => {
        g.window = { __ASMA_PLATFORM__: { apps: { 'asma-app-calendar': { version: '1.2.3', base: '/cdn/asma-app-calendar/1.2.3/' } } } }
        assert.equal(getInjectedPlatform()?.apps?.['asma-app-calendar']?.version, '1.2.3')
    })

    it('prefers window.rawWindow (qiankun child sandbox)', () => {
        g.window = { rawWindow: { __ASMA_PLATFORM__: { apps: { x: { version: '9', base: '/cdn/x/9/' } } } } }
        assert.equal(getInjectedPlatform()?.apps?.['x']?.version, '9')
    })
})

describe('getAppSignal / isEsmApp', () => {
    it('returns the app entry and esm=true only when the app is marked', () => {
        g.window = {
            __ASMA_PLATFORM__: {
                apps: {
                    'asma-app-calendar': { version: '1.2.3', base: '/cdn/asma-app-calendar/1.2.3/', esm: true, widgetsManifest: '/cdn/asma-app-calendar/1.2.3/widgets.json' },
                    'asma-app-chat': { version: '0.75.5', base: '/cdn/asma-app-chat/0.75.5/' },
                },
            },
        }
        assert.equal(getAppSignal('asma-app-calendar')?.widgetsManifest, '/cdn/asma-app-calendar/1.2.3/widgets.json')
        assert.equal(isEsmApp('asma-app-calendar'), true)
        assert.equal(isEsmApp('asma-app-chat'), false)
        assert.equal(isEsmApp('not-a-real-app'), false)
    })

    it('isEsmApp is false when no platform is injected', () => {
        assert.equal(isEsmApp('asma-app-calendar'), false)
    })
})

describe('import-map-override dev signal (single-spa overrides widget)', () => {
    it('marks an app with an active import-map-override esm at that base — no injected platform needed', () => {
        g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-directory': 'http://localhost:3003/' })
        assert.deepEqual(getAppSignal('asma-app-directory'), {
            version: 'dev-override',
            base: 'http://localhost:3003/',
            esm: true,
        })
        assert.equal(isEsmApp('asma-app-directory'), true)
        assert.equal(isEsmApp('asma-app-chat'), false) // only the overridden app
    })

    it('respects the widget disabled list (import-map-overrides-disabled)', () => {
        g.localStorage = fakeLocalStorage({
            'import-map-override:asma-app-directory': 'http://localhost:3003/',
            'import-map-overrides-disabled': '["asma-app-directory"]',
        })
        assert.equal(isEsmApp('asma-app-directory'), false) // disabled → not routed to ESM
    })

    it('override wins over the injected platform for that app; others keep the injected signal', () => {
        g.window = {
            __ASMA_PLATFORM__: {
                apps: {
                    'asma-app-directory': { version: '1.0.0', base: '/cdn/asma-app-directory/1.0.0/' },
                    'asma-app-calendar': { version: '2.0.0', base: '/cdn/asma-app-calendar/2.0.0/', esm: true },
                },
            },
        }
        g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-directory': 'http://localhost:3003/' })
        assert.equal(getAppSignal('asma-app-directory')?.base, 'http://localhost:3003/')
        assert.equal(getAppSignal('asma-app-calendar')?.base, '/cdn/asma-app-calendar/2.0.0/')
    })

    it('a malformed disabled list is handled conservatively (no override, no throw)', () => {
        g.localStorage = fakeLocalStorage({
            'import-map-override:asma-app-directory': 'http://localhost:3003/',
            'import-map-overrides-disabled': 'not-json{',
        })
        // JSON.parse throws → caught → treated as no override rather than crashing the render path.
        assert.equal(isEsmApp('asma-app-directory'), false)
    })
})
