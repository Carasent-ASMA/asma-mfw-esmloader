import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { clearOverrideTransportCache, disableImportMapOverride, getAppSignal, getInjectedPlatform, isEsmApp, peekOverrideTransport, resolveOverrideTransport } from './platformSignal.ts'
import { clearManifestCache } from './widgetsManifest.ts'

const g = globalThis as { window?: unknown; localStorage?: unknown; fetch?: unknown }
afterEach(() => {
    delete g.window
    delete g.localStorage
    delete g.fetch
    clearManifestCache()
    clearOverrideTransportCache()
})

function fakeLocalStorage(items: Record<string, string>): unknown {
    return {
        getItem: (k: string) => items[k] ?? null,
        setItem: (k: string, v: string) => {
            items[k] = v
        },
    }
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

describe('disableImportMapOverride (the "disable override" escape hatch)', () => {
    it('appends the app to an empty/absent disabled list', () => {
        const store: Record<string, string> = {}
        g.localStorage = fakeLocalStorage(store)
        disableImportMapOverride('adopus-app-directory')
        assert.deepEqual(JSON.parse(store['import-map-overrides-disabled']), ['adopus-app-directory'])
    })

    it('appends to an existing list without duplicating', () => {
        const store: Record<string, string> = { 'import-map-overrides-disabled': '["asma-app-chat"]' }
        g.localStorage = fakeLocalStorage(store)
        disableImportMapOverride('adopus-app-directory')
        disableImportMapOverride('adopus-app-directory') // idempotent
        assert.deepEqual(JSON.parse(store['import-map-overrides-disabled']), ['asma-app-chat', 'adopus-app-directory'])
    })

    it('recovers from a malformed list by resetting to just this app', () => {
        const store: Record<string, string> = { 'import-map-overrides-disabled': 'not-json{' }
        g.localStorage = fakeLocalStorage(store)
        disableImportMapOverride('adopus-app-directory')
        assert.deepEqual(JSON.parse(store['import-map-overrides-disabled']), ['adopus-app-directory'])
    })
})

describe('resolveOverrideTransport (widgets.json probe at a dev-override base — RISK-005)', () => {
    const BASE = 'http://localhost:3006/'

    it('widgets.json served ⇒ esm', async () => {
        g.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ widgets: {} }) } as Response)
        assert.equal(await resolveOverrideTransport(BASE), 'esm')
    })

    it('HTTP 404 (an old-architecture qiankun dev server) ⇒ qiankun', async () => {
        g.fetch = () => Promise.resolve({ ok: false, status: 404 } as Response)
        assert.equal(await resolveOverrideTransport(BASE), 'qiankun')
    })

    it('200 + HTML (Vite SPA fallback serves index.html for /widgets.json) ⇒ qiankun', async () => {
        // fetch's res.json() throws SyntaxError on an HTML body — mirror that.
        g.fetch = () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError(`Unexpected token '<', "<!DOCTYPE "... is not valid JSON`)) } as unknown as Response)
        assert.equal(await resolveOverrideTransport(BASE), 'qiankun')
    })

    it('200 + JSON that is not a manifest (no widgets map) ⇒ qiankun', async () => {
        g.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ hello: 'world' }) } as Response)
        assert.equal(await resolveOverrideTransport(BASE), 'qiankun')
    })

    it('network failure (dev server not running) ⇒ esm, so the host shows the actionable error', async () => {
        g.fetch = () => Promise.reject(new TypeError('Failed to fetch'))
        assert.equal(await resolveOverrideTransport(BASE), 'esm')
    })

    it('caches the verdict per base — one probe, then peek answers synchronously', async () => {
        let calls = 0
        g.fetch = () => {
            calls++
            return Promise.resolve({ ok: false, status: 404 } as Response)
        }
        assert.equal(peekOverrideTransport(BASE), undefined)
        await resolveOverrideTransport(BASE)
        await resolveOverrideTransport(BASE)
        assert.equal(calls, 1)
        assert.equal(peekOverrideTransport(BASE), 'qiankun')
    })
})
