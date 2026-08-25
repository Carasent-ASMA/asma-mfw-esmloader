import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { describeWidgetLoadFailure } from './describeLoadFailure.ts'

describe('describeWidgetLoadFailure', () => {
    it('uses the raw message when nothing overrode the app', () => {
        assert.equal(
            describeWidgetLoadFailure({ appName: 'asma-app-office', error: new Error('entry 404') }),
            'entry 404',
        )
    })

    it('survives a thrown non-Error', () => {
        // qiankun rejects with whatever the app threw; `String(value)` beats `undefined` on screen.
        assert.equal(describeWidgetLoadFailure({ appName: 'a', error: 'plain string' }), 'plain string')
    })

    it('names the override, its base and how to withdraw it', () => {
        const message = describeWidgetLoadFailure({
            appName: 'asma-app-office',
            error: new Error('Failed to fetch'),
            overrideBase: 'http://localhost:5173/',
        })
        assert.match(message, /asma-app-office/)
        assert.match(message, /http:\/\/localhost:5173\//)
        assert.match(message, /Failed to fetch/)
        assert.match(message, /disable override/)
    })

    it('keeps the raw message when the app has no name to blame', () => {
        // Half the long form is a lie without an app name: "undefined is served from a dev override".
        assert.equal(
            describeWidgetLoadFailure({
                appName: undefined,
                error: new Error('Failed to fetch'),
                overrideBase: 'http://localhost:5173/',
            }),
            'Failed to fetch',
        )
    })
})
