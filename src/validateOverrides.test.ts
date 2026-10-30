import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { clearDeadOverrides, confirmOverrideIsGone, takeStartupClears } from './validateOverrides.ts'
import { ManifestFormatError, ManifestHttpError } from './widgetsManifest.ts'

const g = globalThis as { window?: unknown; localStorage?: unknown; location?: unknown }
afterEach(() => {
    delete g.window
    delete g.localStorage
    delete g.location
    takeStartupClears() // module state — must not leak into the next case
})

/** The page the loader runs in — what a relative override base is relative to. */
function onPage(origin: string): void {
    g.location = { origin }
}

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

/**
 * Answer per EXACT URL; anything unlisted is a network failure. The startup rule asks two
 * documents of every version, so the prefix-matching fake above cannot tell them apart.
 */
function fetchByUrl(statusByUrl: Record<string, number>) {
    const requested: { url: string; init?: RequestInit }[] = []
    const impl = ((url: string | URL, init?: RequestInit) => {
        const href = String(url)
        requested.push({ url: href, init })
        if (init?.signal?.aborted) return Promise.reject(new Error('aborted'))
        const status = statusByUrl[href]
        if (status === undefined) return Promise.reject(new TypeError('Failed to fetch'))
        return Promise.resolve({ status } as Response)
    }) as unknown as typeof fetch
    return { impl, requested, urls: () => requested.map((r) => r.url).sort() }
}

const DEV = 'https://avansas.dev.adopus.no'
/** A live ESM-only preview, as dev serves it: no entry document, a manifest. */
const ESM_ONLY = `${DEV}/cdn/asma-app-chat/pr166/`
/** A live qiankun-era preview, as dev serves it: an entry document, no manifest. */
const QIANKUN_ONLY = `${DEV}/cdn/asma-app-chat/pr1/`
/** A version that is not there at all. */
const DELETED = `${DEV}/cdn/asma-app-chat/pr99999/`

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

    it('keeps a live ESM-only version — it publishes widgets.json and no entry document (ASMA-8735)', async () => {
        g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-chat': ESM_ONLY })
        const { impl } = fetchByUrl({ [ESM_ONLY]: 403, [`${ESM_ONLY}widgets.json`]: 200 })

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
    })

    it('keeps a live qiankun version — it publishes an entry document and no widgets.json', async () => {
        g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-chat': QIANKUN_ONLY })
        const { impl } = fetchByUrl({ [QIANKUN_ONLY]: 200, [`${QIANKUN_ONLY}widgets.json`]: 403 })

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
    })

    it('clears only when BOTH documents prove absence, in any mix of 404 and 403', async () => {
        for (const [entry, manifest] of [[403, 403], [404, 404], [404, 403], [403, 404]]) {
            const store: Record<string, string> = { 'import-map-override:asma-app-chat': DELETED }
            g.localStorage = fakeLocalStorage(store)
            const { impl, urls } = fetchByUrl({ [DELETED]: entry!, [`${DELETED}widgets.json`]: manifest! })

            const cleared = await clearDeadOverrides({ fetchImpl: impl })
            assert.deepEqual(cleared.map((c) => c.appName), ['asma-app-chat'], `${entry}/${manifest}`)
            assert.deepEqual(urls(), [DELETED, `${DELETED}widgets.json`])
            takeStartupClears()
        }
    })

    it('never clears on half a proof — the other document unreachable, failing or too slow', async () => {
        const unproven: [string, Record<string, number>][] = [
            ['manifest 5xx', { [DELETED]: 403, [`${DELETED}widgets.json`]: 503 }],
            ['entry 5xx', { [DELETED]: 500, [`${DELETED}widgets.json`]: 403 }],
            ['manifest network failure', { [DELETED]: 403 }],
            ['entry network failure', { [`${DELETED}widgets.json`]: 404 }],
        ]
        for (const [label, statuses] of unproven) {
            const store: Record<string, string> = { 'import-map-override:asma-app-chat': DELETED }
            g.localStorage = fakeLocalStorage(store)
            const { impl } = fetchByUrl(statuses)
            assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [], label)
            assert.equal(store['import-map-overrides-disabled'], undefined, label)
        }

        // One document proves absence at once; the other never answers — the deadline is not proof.
        g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-chat': DELETED })
        const impl = ((url: string, init?: { signal?: AbortSignal }) =>
            url.endsWith('widgets.json')
                ? new Promise((_resolve, reject) => {
                      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
                  })
                : Promise.resolve({ status: 403 } as Response)) as unknown as typeof fetch
        const started = Date.now()
        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl, timeoutMs: 30 }), [])
        assert.ok(Date.now() - started < 1000, 'must not hang waiting for the second answer')
    })

    it("probes a RELATIVE override — the overrides dialog's own format — against the page's origin", async () => {
        onPage(DEV)
        const store: Record<string, string> = { 'import-map-override:asma-app-chat': '/cdn/asma-app-chat/pr99999/' }
        g.localStorage = fakeLocalStorage(store)
        const { impl, urls } = fetchByUrl({ [DELETED]: 403, [`${DELETED}widgets.json`]: 403 })

        const cleared = await clearDeadOverrides({ fetchImpl: impl })
        assert.deepEqual(cleared.map((c) => [c.appName, c.base]), [['asma-app-chat', '/cdn/asma-app-chat/pr99999/']])
        assert.deepEqual(urls(), [DELETED, `${DELETED}widgets.json`])
        assert.deepEqual(JSON.parse(store['import-map-overrides-disabled']!), ['asma-app-chat'])
    })

    it('keeps a relative override to a live ESM-only preview, and asks for its manifest to know', async () => {
        onPage(DEV)
        const store: Record<string, string> = { 'import-map-override:asma-app-chat': '/cdn/asma-app-chat/pr166/' }
        g.localStorage = fakeLocalStorage(store)
        const { impl, urls } = fetchByUrl({ [ESM_ONLY]: 403, [`${ESM_ONLY}widgets.json`]: 200 })

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
        assert.deepEqual(urls(), [ESM_ONLY, `${ESM_ONLY}widgets.json`])
        assert.equal(store['import-map-overrides-disabled'], undefined)
    })

    it('leaves a relative override alone when the page itself is a developer machine', async () => {
        onPage('http://localhost:5173')
        g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-chat': '/cdn/asma-app-chat/pr99999/' })
        const { impl, requested } = fetchByUrl({})

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
        assert.deepEqual(requested, [])
    })

    it('neither probes nor throws for a relative override with no page to resolve it against', async () => {
        g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-chat': '/cdn/asma-app-chat/pr99999/' })
        const { impl, requested } = fetchByUrl({})

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
        assert.deepEqual(requested, [])
    })

    it("asks about the version's own folder even when the base lacks its slash or carries a query", async () => {
        // `new URL('widgets.json', '…/pr166')` is the PARENT's manifest — which does not exist, so
        // an unnormalised probe would call a live preview gone.
        for (const base of [`${DEV}/cdn/asma-app-chat/pr166`, `${DEV}/cdn/asma-app-chat/pr166/?debug=1#top`]) {
            g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-chat': base })
            const { impl, urls } = fetchByUrl({
                [ESM_ONLY]: 403,
                [`${ESM_ONLY}widgets.json`]: 200,
                [`${DEV}/cdn/asma-app-chat/widgets.json`]: 403,
            })
            assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [], base)
            assert.deepEqual(urls(), [ESM_ONLY, `${ESM_ONLY}widgets.json`], base)
        }
    })

    it("probes the OVERRIDE's own manifest, never the platform entry's — esm-overrides keeps the server's", async () => {
        // The head injection rewrites only `base`; `widgetsManifest` still names the server's version.
        g.window = {
            __ASMA_PLATFORM__: {
                apps: {
                    'asma-app-chat': {
                        version: '0.105.4',
                        base: ESM_ONLY,
                        esm: true,
                        widgetsManifest: `${DEV}/cdn/asma-app-chat/0.105.4/widgets.json`,
                    },
                },
            },
        }
        g.localStorage = fakeLocalStorage({ 'esm-overrides': JSON.stringify({ apps: { 'asma-app-chat': ESM_ONLY } }) })
        const { impl, urls } = fetchByUrl({ [ESM_ONLY]: 403, [`${ESM_ONLY}widgets.json`]: 200 })

        assert.deepEqual(await clearDeadOverrides({ fetchImpl: impl }), [])
        assert.deepEqual(urls(), [ESM_ONLY, `${ESM_ONLY}widgets.json`])
    })

    it('asks the origin rather than the HTTP cache, with a GET', async () => {
        // A deleted qiankun-era entry document is cacheable for a day; a cached 200 would hide it.
        g.localStorage = fakeLocalStorage({ 'import-map-override:asma-app-chat': DELETED })
        const { impl, requested } = fetchByUrl({ [DELETED]: 403, [`${DELETED}widgets.json`]: 403 })

        await clearDeadOverrides({ fetchImpl: impl })
        assert.equal(requested.length, 2)
        for (const { url, init } of requested) {
            assert.equal(init?.cache, 'no-store', url)
            assert.ok(!init?.method || init.method === 'GET', url)
        }
    })
})

describe('confirmOverrideIsGone — the mid-session heal asks the same question (ASMA-8735)', () => {
    const manifest403 = (base: string) => new ManifestHttpError(`${base}widgets.json`, 403)

    it('does not take a missing manifest as proof — a live qiankun version has none either', async () => {
        const { impl } = fetchByUrl({ [QIANKUN_ONLY]: 200, [`${QIANKUN_ONLY}widgets.json`]: 403 })
        assert.equal(await confirmOverrideIsGone(QIANKUN_ONLY, manifest403(QIANKUN_ONLY), { fetchImpl: impl }), false)
    })

    it('confirms a version whose entry document and manifest are both gone', async () => {
        const { impl } = fetchByUrl({ [DELETED]: 403, [`${DELETED}widgets.json`]: 403 })
        assert.equal(await confirmOverrideIsGone(DELETED, manifest403(DELETED), { fetchImpl: impl }), true)
    })

    it('confirms a dead RELATIVE override against the page origin', async () => {
        onPage(DEV)
        const { impl } = fetchByUrl({ [DELETED]: 404, [`${DELETED}widgets.json`]: 403 })
        const base = '/cdn/asma-app-chat/pr99999/'
        assert.equal(await confirmOverrideIsGone(base, manifest403(base), { fetchImpl: impl }), true)
    })

    it('does not even ask when the failure itself is no proof — a network blip or a 5xx', async () => {
        for (const loadError of [new TypeError('Failed to fetch'), new ManifestHttpError(`${DELETED}widgets.json`, 503)]) {
            const { impl, requested } = fetchByUrl({ [DELETED]: 403, [`${DELETED}widgets.json`]: 403 })
            assert.equal(await confirmOverrideIsGone(DELETED, loadError, { fetchImpl: impl }), false)
            assert.deepEqual(requested, [])
        }
    })

    it('never confirms, nor asks about, a localhost override', async () => {
        const base = 'http://localhost:3002/'
        const { impl, requested } = fetchByUrl({ [base]: 404, [`${base}widgets.json`]: 404 })
        assert.equal(await confirmOverrideIsGone(base, new ManifestFormatError(`${base}widgets.json`, 'not JSON'), { fetchImpl: impl }), false)
        assert.deepEqual(requested, [])
    })
})
