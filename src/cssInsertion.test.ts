import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ensureStylesheets, type CssDoc } from './cssInsertion.ts'

function fakeDoc() {
    const links: { rel: string; href: string; attrs: Record<string, string> }[] = []
    const doc: CssDoc = {
        querySelector(sel: string) {
            // mimic [data-asma-widget-css="<href>"]
            const m = /data-asma-widget-css="(.*)"]$/.exec(sel)
            const wanted = m?.[1]?.replace(/\\(["\\])/g, '$1')
            return links.find((l) => l.attrs['data-asma-widget-css'] === wanted) ?? null
        },
        createElement() {
            const link = {
                rel: '',
                href: '',
                setAttribute(name: string, value: string) {
                    ;(this as unknown as { attrs: Record<string, string> }).attrs[name] = value
                },
                attrs: {} as Record<string, string>,
            }
            return link as unknown as ReturnType<CssDoc['createElement']>
        },
        head: {
            appendChild(node: unknown) {
                links.push(node as (typeof links)[number])
            },
        },
    }
    return { doc, links }
}

describe('ensureStylesheets', () => {
    it('inserts one <link rel=stylesheet> per href', () => {
        const { doc, links } = fakeDoc()
        ensureStylesheets(['https://cdn/a.css', 'https://cdn/b.css'], doc)
        assert.equal(links.length, 2)
        assert.equal(links[0]?.rel, 'stylesheet')
        assert.equal(links[0]?.href, 'https://cdn/a.css')
    })

    it('does not insert the same href twice across calls (dedup by href)', () => {
        const { doc, links } = fakeDoc()
        ensureStylesheets(['https://cdn/a.css'], doc)
        ensureStylesheets(['https://cdn/a.css', 'https://cdn/c.css'], doc)
        assert.deepEqual(
            links.map((l) => l.href),
            ['https://cdn/a.css', 'https://cdn/c.css'],
        )
    })

    it('no-ops when there is no document and none injected', () => {
        assert.doesNotThrow(() => ensureStylesheets(['https://cdn/a.css']))
    })
})
