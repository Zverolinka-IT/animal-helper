import { inject, onUnmounted, toRaw, watch, type Ref } from 'vue'
import { flowDraftContext } from './flow-exit'

// Keep unfinished controls separate from confirmed business answers.
export function useFlowDraft(fields: Record<string, Ref>) {
  const context = inject(flowDraftContext, undefined)
  if (!context) return
  const saved = context.restore()
  for (const [key, field] of Object.entries(fields)) {
    if (saved && key in saved) field.value = saved[key]
  }
  const capture = () =>
    Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, structuredClone(toRaw(field.value))]))
  const writer = context.writer?.()
  if (writer) watch(Object.values(fields), () => writer(capture()), { deep: true })
  onUnmounted(
    context.register(() =>
      Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, structuredClone(toRaw(field.value))]))
    )
  )
}
