import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

import { defineReactWidget, type WidgetInstance } from './contract.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const g = globalThis as unknown as Record<string, unknown>

before(() => {
    g.window = dom.window
    g.document = dom.window.document
    // `globalThis.navigator` is a getter-only property in modern Node, so a plain assignment throws
    // — and a throwing `before` hook cancels every test under it without saying why.
    Object.defineProperty(globalThis, 'navigator', {
        value: dom.window.navigator,
        configurable: true,
        writable: true,
    })
    // React refuses to run `act` without this, and warns loudly rather than failing.
    g.IS_REACT_ACT_ENVIRONMENT = true
})

/** React reports every CAUGHT error through console.error; a passing test should still be quiet. */
const originalConsoleError = console.error
afterEach(() => {
    console.error = originalConsoleError
})
function silenceReactErrorLogging(): void {
    console.error = () => {}
}

function Flaky({ explode }: { explode: boolean }) {
    if (explode) throw new Error('the widget blew up')
    return createElement('span', null, 'widget content')
}

async function mount(props: { explode: boolean }): Promise<{
    container: HTMLElement
    instance: WidgetInstance<{ explode: boolean }>
}> {
    const container = dom.window.document.createElement('div')
    dom.window.document.body.appendChild(container)
    let instance!: WidgetInstance<{ explode: boolean }>
    await act(async () => {
        instance = defineReactWidget(Flaky).mount(container, props)
    })
    return { container: container as unknown as HTMLElement, instance }
}

describe('a widget that throws while rendering', () => {
    it('shows the notice instead of leaving an empty slot', async () => {
        silenceReactErrorLogging()
        const { container } = await mount({ explode: true })

        // Without the boundary React unmounts the whole root and re-throws: an empty container and
        // a console message, which is precisely the silent failure ASMA-7853 is about.
        assert.match(container.textContent ?? '', /Widget failed/)
        assert.notEqual(container.textContent, '')
    })

    it('carries the message the widget itself threw, so the notice says what broke', async () => {
        silenceReactErrorLogging()
        const { container } = await mount({ explode: true })
        const label = container.querySelector('[aria-label]')?.getAttribute('aria-label') ?? ''

        assert.match(label, /the widget blew up/)
        // Named as a crash, not a load failure — the code arrived and ran.
        assert.match(label, /crashed while rendering/)
    })

    it('leaves a healthy widget completely alone', async () => {
        const { container } = await mount({ explode: false })

        assert.equal(container.textContent, 'widget content')
    })

    it('renders the widget again when the host sends props that work', async () => {
        silenceReactErrorLogging()
        const { container, instance } = await mount({ explode: true })
        assert.match(container.textContent ?? '', /Widget failed/)

        await act(async () => {
            instance.update({ explode: false })
        })

        // A widget that threw once on bad data must not stay dead for the life of the page.
        assert.equal(container.textContent, 'widget content')
    })

    it('stays on the notice when the new props throw as well', async () => {
        silenceReactErrorLogging()
        const { container, instance } = await mount({ explode: true })

        await act(async () => {
            instance.update({ explode: true })
        })

        assert.match(container.textContent ?? '', /Widget failed/)
    })
})
