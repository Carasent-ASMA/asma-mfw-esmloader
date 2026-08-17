import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { clearDeadOverrides } from './validateOverrides.ts'

const g = globalThis as { window?: unknown; localStorage?: unknown }
afterEach(() => {
    delete g.window
    delete g.localStorage
})

/** A localStorage fake that can be ENUMERATED — the startup check discovers apps, not the reverse. */
function fakeLocalStorage(items: Record<string, string>): unknown {
    return {
        get length() {
            return Object.keys(items).length
        },
        key: (index: number) => Object.keys(items)[index] ?? null,
        getItem: (k: string) => items[k] ?? null,
        setItem: (k: string, v: string) => {
            items[k] = v
        },
        removeItem: (k: string) => {
            delete items[k]
        },
    }
}

const GONE = 'https://web.dev.adopus.no/cdn/asma-app-chat/pr41/'
const ALIVE = 'https://web.dev.adopus.no/cdn/asma-app-calendar/pr7/'

/** Answer per URL prefix; anything unlisted is a network failure. */
function fakeFetch(statusByBase: Record<string, number>) {
    const requested: string[] = []
    const impl = ((url: string | URL, init?: { signal?: AbortSignal }) => {
        const href = String(url)
        requested.push(href)
        if (init?.signal?.aborted) return Promise.reject(new Error('aborted'))
        const match = Object.entries(statusByBase).find(([base]) => href.startsWith(base))
        if (!match) return Promise.reject(new TypeError('Failed to fetch'))
        return Promise.resolve({ status: match[1] } as Response)
    }) as unknown as typeof fetch
    return { impl, requested }
}

describe('clearDeadOverrides — the startup check (ASMA-7866 DEC-F2)', () => {
    it('does nothing, and asks the network nothing, on an ordinary load', async () => {
        const store: Record<string, string> = {}
        g.localStorage = fakeLocalStorage(store)
        const { impl, requested } = fakeFetch({})

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
        assert.deepEqual(requested, [], 'a user with no override must not pay for a probe')
    })

    it('clears an override whose published version is gone', async () => {
        const store: Record<string, string> = { 'import-map-override:asma-app-chat': GONE }
        g.localStorage = fakeLocalStorage(store)
        const { impl } = fakeFetch({ [GONE]: 403 })

        const cleared = await clearDeadOverrides({ fetchImpl: impl })
        assert.deepEqual(
            cleared.map((c) => [c.appName, c.source]),
            [['asma-app-chat', 'import-map']],
        )
        assert.deepEqual(JSON.parse(store['import-map-overrides-disabled']!), ['asma-app-chat'])
    })

    it('leaves a LIVE override in place', async () => {
        const store: Record<string, string> = { 'import-map-override:asma-app-calendar': ALIVE }
        g.localStorage = fakeLocalStorage(store)
        const { impl } = fakeFetch({ [ALIVE]: 200 })

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
        assert.equal(store['import-map-overrides-disabled'], undefined)
    })

    it('never discards a setting over unreachability — 5xx or a network failure', async () => {
        for (const status of [500, 503]) {
            const store: Record<string, string> = { 'import-map-override:asma-app-chat': GONE }
            g.localStorage = fakeLocalStorage(store)
            const { impl } = fakeFetch({ [GONE]: status })
            assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [], String(status))
        }

        const store: Record<string, string> = { 'import-map-override:asma-app-chat': GONE }
        g.localStorage = fakeLocalStorage(store)
        const { impl } = fakeFetch({}) // every request rejects
        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
    })

    it('never probes, let alone clears, a localhost override', async () => {
        const store: Record<string, string> = { 'import-map-override:asma-app-chat': 'http://localhost:3002/' }
        g.localStorage = fakeLocalStorage(store)
        const { impl, requested } = fakeFetch({ 'http://localhost:3002/': 404 })

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
        assert.deepEqual(requested, [], 'a dev server that is down is not a deleted version')
    })

    it('covers the esm-overrides channel as well, and clears it through that channel', async () => {
        const store: Record<string, string> = {
            'esm-overrides': JSON.stringify({ apps: { 'asma-app-chat': GONE, 'asma-app-calendar': ALIVE } }),
        }
        g.localStorage = fakeLocalStorage(store)
        const { impl } = fakeFetch({ [GONE]: 403, [ALIVE]: 200 })

        const cleared = await clearDeadOverrides({ fetchImpl: impl })
        assert.deepEqual(
            cleared.map((c) => [c.appName, c.source]),
            [['asma-app-chat', 'esm-overrides']],
        )
        // Only the dead one goes; the other app's override is a separate, still-valid decision.
        assert.deepEqual(JSON.parse(store['esm-overrides']!), { apps: { 'asma-app-calendar': ALIVE } })
    })

    it('clears every dead override, not just the first — several previews can die together', async () => {
        const secondGone = 'https://web.dev.adopus.no/cdn/asma-app-crm/pr9/'
        const store: Record<string, string> = {
            'import-map-override:asma-app-chat': GONE,
            'import-map-override:asma-app-crm': secondGone,
            'import-map-override:asma-app-calendar': ALIVE,
        }
        g.localStorage = fakeLocalStorage(store)
        const { impl } = fakeFetch({ [GONE]: 403, [secondGone]: 404, [ALIVE]: 200 })

        const cleared = await clearDeadOverrides({ fetchImpl: impl })
        assert.deepEqual(
            cleared.map((c) => c.appName).sort(),
            ['asma-app-chat', 'asma-app-crm'],
        )
        assert.deepEqual(JSON.parse(store['import-map-overrides-disabled']!).sort(), [
            'asma-app-chat',
            'asma-app-crm',
        ])
    })

    it('ignores an already-disabled override — it is not in force, so it is not ours to judge', async () => {
        const store: Record<string, string> = {
            'import-map-override:asma-app-chat': GONE,
            'import-map-overrides-disabled': '["asma-app-chat"]',
        }
        g.localStorage = fakeLocalStorage(store)
        const { impl, requested } = fakeFetch({ [GONE]: 403 })

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
        assert.deepEqual(requested, [])
    })

    it('gives up on the deadline rather than delaying the first render', async () => {
        const store: Record<string, string> = { 'import-map-override:asma-app-chat': GONE }
        g.localStorage = fakeLocalStorage(store)
        // A probe that never answers on its own — only the abort ends it.
        const impl = ((_url: string, init?: { signal?: AbortSignal }) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            })) as unknown as typeof fetch

        const started = Date.now()
        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl, timeoutMs: 30 }), [])
        assert.ok(Date.now() - started < 1000, 'must not hang waiting for a silent origin')
    })
})
