import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { getAppSignal, getInjectedPlatform, isEsmApp } from './platformSignal.ts'

const g = globalThis as { window?: unknown }
afterEach(() => {
    delete g.window
})

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
