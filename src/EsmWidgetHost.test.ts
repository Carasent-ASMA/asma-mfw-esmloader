import assert from 'node:assert/strict'
import { afterEach, before, beforeEach, describe, it } from 'node:test'
import { JSDOM, VirtualConsole } from 'jsdom'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { EsmWidgetHost } from './EsmWidgetHost.tsx'
import { clearManifestCache } from './widgetsManifest.ts'

/**
 * The mid-session heal, end to end through the component (ASMA-8735): a widget whose manifest
 * answers 403 is only the reason to ask, and the override is cleared only when the version's entry
 * document is gone too. The page is dev; the override is relative, as the overrides dialog writes it.
 */
const DEV = 'https://avansas.dev.adopus.no'
const BASE = '/cdn/asma-app-chat/pr1/'
const ENTRY = `${DEV}${BASE}`
const MANIFEST = `${ENTRY}widgets.json`

// jsdom does not navigate; it reports a reload attempt here instead, which is how a test sees one.
const navigations: string[] = []
const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', (error) => {
    if (/navigation/i.test(error.message)) navigations.push(error.message)
})
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: `${DEV}/chat`, virtualConsole })
const g = globalThis as unknown as Record<string, unknown>

before(() => {
    g.window = dom.window
    g.document = dom.window.document
    g.location = dom.window.location
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
    g.IS_REACT_ACT_ENVIRONMENT = true
})

let store: Record<string, string>
const originalConsoleError = console.error
beforeEach(() => {
    store = { 'import-map-override:asma-app-chat': BASE }
    g.localStorage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
            store[k] = v
        },
        removeItem: (k: string) => {
            delete store[k]
        },
    }
    navigations.length = 0
    console.error = () => {} // the host logs every failed load; a passing test should stay quiet
})
afterEach(() => {
    delete g.fetch
    clearManifestCache()
    console.error = originalConsoleError
})

/**
 * The widget's own manifest request (no init) always answers 403. The heal's probes (`no-store`)
 * answer from `probe`, which may hold them back to model a slow origin.
 */
function serve(probe: (url: string) => Promise<number>): void {
    g.fetch = (url: string | URL, init?: RequestInit) => {
        const href = String(url)
        const status = init?.cache === 'no-store' ? probe(href) : Promise.resolve(href === MANIFEST ? 403 : 404)
        return status.then((code) => ({ ok: code >= 200 && code < 300, status: code, json: async () => ({}) }))
    }
}

async function mount(onLoadError: (error: unknown) => void): Promise<{ root: Root; container: HTMLElement }> {
    const container = dom.window.document.createElement('div') as unknown as HTMLElement
    dom.window.document.body.appendChild(container as unknown as Node)
    const root = createRoot(container)
    await act(async () => {
        root.render(createElement(EsmWidgetHost, { app: 'asma-app-chat', widget_name: 'chat', props: {}, onLoadError } as never))
    })
    return { root, container }
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)))

describe('EsmWidgetHost — the mid-session heal (ASMA-8735)', () => {
    it('keeps a LIVE qiankun-era override whose manifest 403s, and shows the error instead', async () => {
        serve(async (url) => (url === ENTRY ? 200 : 403))
        const errors: unknown[] = []
        const { root, container } = await mount((error) => errors.push(error))
        await settle()

        assert.equal(store['import-map-overrides-disabled'], undefined, 'a live override must not be cleared')
        assert.equal(store['asma-override-self-heal'], undefined)
        assert.deepEqual(navigations, [])
        assert.equal(errors.length, 1, 'the host still hears about the failed load')
        assert.match(container.textContent ?? '', /Widget failed/, 'the error notice is on screen')
        await act(async () => root.unmount())
    })

    it('clears a dead override, records why and reloads, when both documents are gone', async () => {
        serve(async () => 403)
        const errors: unknown[] = []
        const { root } = await mount((error) => errors.push(error))
        await settle()

        assert.deepEqual(JSON.parse(store['import-map-overrides-disabled']!), ['asma-app-chat'])
        assert.deepEqual(JSON.parse(store['asma-override-self-heal']!), { appName: 'asma-app-chat', base: BASE })
        assert.equal(navigations.length, 1, 'the page reloads once')
        assert.deepEqual(errors, [], 'a reload is coming; there is no error to report')
        await act(async () => root.unmount())
    })

    it('does nothing at all once the widget is gone before the answer arrives', async () => {
        // Either answer: "gone" must not clear or reload, "alive" must not report an error.
        for (const status of [403, 200]) {
            let answer!: (status: number) => void
            const held = new Promise<number>((resolve) => {
                answer = resolve
            })
            serve(() => held)
            const errors: unknown[] = []
            const { root } = await mount((error) => errors.push(error))

            await act(async () => root.unmount())
            answer(status)
            await settle()

            assert.equal(store['import-map-overrides-disabled'], undefined, String(status))
            assert.deepEqual(navigations, [], String(status))
            assert.deepEqual(errors, [], String(status))
            clearManifestCache()
        }
    })
})
