import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { describeOverrideSelfHeal, notifyOverrideSelfHeal } from './overrideSelfHealNotice.ts'
import { recordOverrideSelfHeal } from './platformSignal.ts'

const g = globalThis as { window?: unknown; localStorage?: unknown }
afterEach(() => {
    delete g.window
    delete g.localStorage
})

function fakeLocalStorage(items: Record<string, string>): unknown {
    return {
        getItem: (k: string) => items[k] ?? null,
        setItem: (k: string, v: string) => {
            items[k] = v
        },
        removeItem: (k: string) => {
            delete items[k]
        },
    }
}

/** The platform the page came back on — i.e. what the tester is now actually looking at. */
function injectPlatform(apps: Record<string, { version: string; base: string }>): void {
    g.window = { __ASMA_PLATFORM__: { apps } }
}

describe('describeOverrideSelfHeal (ASMA-7866)', () => {
    it('names the app, the override that is gone, and the version now in effect', () => {
        injectPlatform({ 'asma-app-chat': { version: '1.4.2', base: '/cdn/asma-app-chat/1.4.2/' } })
        const message = describeOverrideSelfHeal({
            appName: 'asma-app-chat',
            base: 'https://web.dev.adopus.no/cdn/asma-app-chat/pr41/',
        })
        assert.match(message, /asma-app-chat/)
        assert.match(message, /pr41/)
        assert.match(message, /1\.4\.2/)
    })

    it('still says what happened when the app has no platform entry to fall back to', () => {
        const message = describeOverrideSelfHeal({ appName: 'asma-app-chat', base: 'https://cdn/pr41/' })
        assert.match(message, /no longer exists/)
        assert.doesNotMatch(message, /version undefined/)
    })
})

describe('notifyOverrideSelfHeal (ASMA-7866)', () => {
    it('says nothing when no override was healed — the ordinary load', () => {
        g.localStorage = fakeLocalStorage({})
        const shown: string[] = []
        assert.equal(
            notifyOverrideSelfHeal((m) => shown.push(m)),
            false,
        )
        assert.deepEqual(shown, [])
    })

    it('reports a pending heal once and never again', () => {
        g.localStorage = fakeLocalStorage({})
        injectPlatform({ 'asma-app-chat': { version: '1.4.2', base: '/cdn/asma-app-chat/1.4.2/' } })
        recordOverrideSelfHeal('asma-app-chat', 'https://cdn/asma-app-chat/pr41/')

        const shown: string[] = []
        assert.equal(
            notifyOverrideSelfHeal((m) => shown.push(m)),
            true,
        )
        // React invokes effects twice in development; the second call must be silent.
        assert.equal(
            notifyOverrideSelfHeal((m) => shown.push(m)),
            false,
        )
        assert.equal(shown.length, 1)
        assert.match(shown[0]!, /asma-app-chat.*pr41.*1\.4\.2/)
    })

    it('hands the raw record to the host alongside the message', () => {
        g.localStorage = fakeLocalStorage({})
        recordOverrideSelfHeal('asma-app-chat', 'https://cdn/asma-app-chat/pr41/')
        let received: unknown
        notifyOverrideSelfHeal((_m, heal) => {
            received = heal
        })
        assert.deepEqual(received, { appName: 'asma-app-chat', base: 'https://cdn/asma-app-chat/pr41/' })
    })
})
