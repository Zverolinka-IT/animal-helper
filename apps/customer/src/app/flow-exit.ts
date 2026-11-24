import type { InjectionKey } from 'vue'

export const requestFlowExit: InjectionKey<(opener: EventTarget | null) => void> = Symbol('request-flow-exit')

export const flowDraftContext: InjectionKey<{
  writer?: () => (values: Record<string, unknown>) => void
  restore: () => Record<string, unknown> | undefined
  register: (capture: () => Record<string, unknown>) => () => void
}> = Symbol('flow-draft-context')
