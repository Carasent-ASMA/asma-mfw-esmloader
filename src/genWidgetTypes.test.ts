import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { renderWidgetTypes } from './genWidgetTypes.js'

test('renderWidgetTypes references (not copies) each widget Props, sorted, under the app key', () => {
    const out = renderWidgetTypes({
        app: 'directory',
        widgets: {
            'user-list': './widgets/UserListWidget',
            'user-detail': './widgets/UserDetailWidget',
        },
    })
    // Sorted by name: user-detail (W0) before user-list (W1) → stable regeneration diff.
    assert.match(out, /import type \{ Props as W0 \} from '\.\/widgets\/UserDetailWidget'/)
    assert.match(out, /import type \{ Props as W1 \} from '\.\/widgets\/UserListWidget'/)
    assert.match(out, /interface AsmaWidgetRegistry \{/)
    assert.match(out, /"directory": \{/)
    assert.match(out, /"user-detail": W0/)
    assert.match(out, /"user-list": W1/)
    // The whole point: reference the type, never inline/copy the prop shape.
    assert.ok(!out.includes('userId'), 'must reference Props by import, never copy the shape')
})

test('renderWidgetTypes honors a custom propsExport name', () => {
    const out = renderWidgetTypes({ app: 'x', widgets: { w: './W' }, propsExport: 'WidgetProps' })
    assert.match(out, /import type \{ WidgetProps as W0 \} from '\.\/W'/)
})

test('renderWidgetTypes rejects an app with no widgets', () => {
    assert.throws(() => renderWidgetTypes({ app: 'empty', widgets: {} }), /no widgets/)
})

// Drift guard: the committed fixture golden (which the consumer.type-test proves narrows EsmWidgetHost)
// must be EXACTLY what the generator emits — so editing the generator without regenerating fails here.
test('renderWidgetTypes output equals the committed fixture golden (no drift)', () => {
    const golden = readFileSync('type-tests/fixture-app/widgets.generated.d.ts', 'utf8')
    const out = renderWidgetTypes({ app: 'fixture-app', widgets: { 'user-list': './UserListWidget' } })
    assert.equal(out, golden)
})
