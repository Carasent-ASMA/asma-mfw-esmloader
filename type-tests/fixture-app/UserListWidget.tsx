/**
 * Fixture widget for the codegen end-to-end proof. Its `Props` is the SINGLE SOURCE OF TRUTH that the
 * generated `widgets.generated.d.ts` references (never copies) — change it here and the registry follows.
 */
import { defineReactWidget } from '../../src/contract.js'

export type Props = { userId: string; showArchived?: boolean }

export const { mount } = defineReactWidget<Props>((props) => <div>{props.userId}</div>)
