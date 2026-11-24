import type { Router } from 'vue-router'
import { flowRoute } from './flow-route'

export const contactScreens = [
  'W15',
  'W15a',
  'W15b',
  'W15c',
  'W15d',
  'W15e',
  'W15f',
  'W18',
  'W20',
  'W20a',
  'W20b',
  'W21',
  'W36'
] as const

// Only traverse history when its previous entry belongs to the expected flow.
// Direct entry or unrelated history uses a safe route supplied by the view.
export function backWithinFlow(router: Router, fallback: string, allowedScreens: readonly string[]) {
  const previous = router.options?.history.state.back
  if (typeof previous === 'string' && previous.startsWith('/') && !previous.startsWith('//')) {
    const name = router.resolve(previous).name
    if (
      (typeof name === 'string' && allowedScreens.includes(name)) ||
      allowedScreens.includes(router.resolve(previous).path)
    ) {
      router.back()
      return
    }
  }
  void router.replace(flowRoute(fallback))
}
