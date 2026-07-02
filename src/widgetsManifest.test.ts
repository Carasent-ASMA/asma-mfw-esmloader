import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'

import { clearManifestCache, fetchManifest, resolveEntry, resolveWidget } from './widgetsManifest.ts'

const ABS_BASE = 'https://cdn.example.com/cdn/asma-app-calendar/1.2.3/'

afterEach(() => {
    clearManifestCache()
    mock.restoreAll()
    delete (globalThis as { fetch?: unknown }).fetch
})

describe('resolveEntry', () => {
    it('normalizes a bare-string entry to { entryUrl, css: [] }', () => {
        const r = resolveEntry(ABS_BASE, 'widgets/therapist-calendar.js')
        assert.equal(r.entryUrl, `${ABS_BASE}widgets/therapist-calendar.js`)
        assert.deepEqual(r.css, [])
    })

    it('resolves entry + css of an object entry to absolute URLs', () => {
        const r = resolveEntry(ABS_BASE, { entry: 'widgets/cal.js', css: ['assets/cal.css', 'assets/shared.css'] })
        assert.equal(r.entryUrl, `${ABS_BASE}widgets/cal.js`)
        assert.deepEqual(r.css, [`${ABS_BASE}assets/cal.css`, `${ABS_BASE}assets/shared.css`])
    })
})

describe('resolveWidget', () => {
    function stubFetch(manifest: unknown): number {
        let calls = 0
        ;(globalThis as { fetch?: unknown }).fetch = () => {
            calls++
            return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) } as Response)
        }
        return calls
    }

    it('resolves a component_path to its entry + css', async () => {
        stubFetch({ widgets: { '/therapist-calendar': { entry: 'widgets/cal.js', css: ['assets/cal.css'] } } })
        const r = await resolveWidget(ABS_BASE, '/therapist-calendar')
        assert.equal(r.entryUrl, `${ABS_BASE}widgets/cal.js`)
        assert.deepEqual(r.css, [`${ABS_BASE}assets/cal.css`])
    })

    it('throws a helpful error for an unknown component_path', async () => {
        stubFetch({ widgets: { '/a': 'a.js' } })
        await assert.rejects(() => resolveWidget(ABS_BASE, '/missing'), /no widget '\/missing'.*Available: \/a/)
    })

    it('caches the manifest per app@version (base) — one fetch across two resolves', async () => {
        let calls = 0
        ;(globalThis as { fetch?: unknown }).fetch = () => {
            calls++
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ widgets: { '/a': 'a.js', '/b': 'b.js' } }) } as Response)
        }
        await resolveWidget(ABS_BASE, '/a')
        await resolveWidget(ABS_BASE, '/b')
        assert.equal(calls, 1)
    })

    it('rejects when widgets.json is missing (HTTP not ok)', async () => {
        ;(globalThis as { fetch?: unknown }).fetch = () => Promise.resolve({ ok: false, status: 404 } as Response)
        await assert.rejects(() => resolveWidget(ABS_BASE, '/a'), /widgets\.json not found.*404/)
    })
})

describe('fetchManifest URL', () => {
    it('prefers an explicit manifestUrl over <base>widgets.json', async () => {
        let requested = ''
        ;(globalThis as { fetch?: unknown }).fetch = (url: string) => {
            requested = url
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ widgets: {} }) } as Response)
        }
        await fetchManifest(ABS_BASE, 'https://cdn.example.com/custom/widgets.json')
        assert.equal(requested, 'https://cdn.example.com/custom/widgets.json')
    })
})
