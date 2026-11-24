import type { RouteLocationRaw } from 'vue-router'

export function flowRoute(target: string): RouteLocationRaw {
  return /^\/contacts\/[a-z0-9][a-z0-9-]{0,47}$/.test(target) ? { path: target } : { name: target }
}
