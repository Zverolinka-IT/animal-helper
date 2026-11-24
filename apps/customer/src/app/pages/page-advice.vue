<script setup lang="ts">
import PageActions from '../components/page-actions.vue'
import PageIntro from '../components/page-intro.vue'
import { useRouter } from 'vue-router'
import type { AdviceView } from './fixtures/advice'
import AdviceBlocks from '../components/advice-blocks.vue'
import { flowActions } from '../flow-client'
import { flowRoute } from '../flow-route'
import { nextTick, onUnmounted, ref } from 'vue'
const props = defineProps<{ view: AdviceView }>()
const router = useRouter()
const page = ref<HTMLElement>()
const acknowledging = ref(false)
const animations = new Set<Animation>()
let marker: HTMLElement | undefined
let disposed = false
onUnmounted(() => {
  disposed = true
  for (const animation of animations) animation.cancel()
  marker?.remove()
})
async function animateAdvice() {
  if ((window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true) || !page.value?.animate) return
  const cards = [...page.value.querySelectorAll<HTMLElement>('.customer-advice__blocks > section')]
  const header = document.querySelector('.customer-app__header-row')?.getBoundingClientRect()
  const box = cards[0]?.getBoundingClientRect()
  if (!header || !box) return
  // The Figma storyboard shrinks the cards, carries a dot to the header, then reveals Rady.
  // It contains no exported timing tracks; use the app's short transition durations.
  for (const card of cards) {
    animations.add(
      card.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(0.04)' }
        ],
        { duration: 220, easing: 'ease-in', fill: 'forwards' }
      )
    )
  }
  await Promise.allSettled([...animations].map(animation => animation.finished))
  if (disposed) return
  marker = document.createElement('span')
  marker.setAttribute('aria-hidden', 'true')
  Object.assign(marker.style, {
    position: 'fixed',
    left: `${box.left + box.width / 2 - 5}px`,
    top: `${box.top + box.height / 2 - 5}px`,
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-accent)',
    zIndex: '40',
    pointerEvents: 'none'
  })
  document.body.append(marker)
  const flight = marker.animate(
    [
      { transform: 'translate(0, 0)' },
      {
        transform: `translate(${header.right - 48 - box.left - box.width / 2}px, ${header.top + header.height / 2 - box.top - box.height / 2}px)`
      }
    ],
    { duration: 280, easing: 'ease-out', fill: 'forwards' }
  )
  animations.add(flight)
  await Promise.allSettled([flight.finished])
  marker.remove()
}
async function acknowledge() {
  if (acknowledging.value || !props.view.allowedActions.includes('acknowledge')) return
  acknowledging.value = true
  try {
    const target = await flowActions.acknowledgeAdvice(props.view)
    if (!target) return
    try {
      await animateAdvice()
    } catch {
      /* Navigation must also work without animation support. */
    }
    if (disposed) return
    await router.push(flowRoute(target))
    await nextTick()
    const trigger = document.querySelector<HTMLElement>('.customer-app__advice-trigger')
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === false)
      trigger?.animate?.(
        [
          { transform: 'scale(0.15)', opacity: 0 },
          { transform: 'scale(1)', opacity: 1 }
        ],
        { duration: 180, easing: 'ease-out' }
      )
  } finally {
    marker?.remove()
    for (const animation of animations) animation.cancel()
    acknowledging.value = false
  }
}
</script>

<template lang="pug">
.customer-advice(
  ref="page",
  class="flex flex-1 flex-col",
  :lang="view.locale",
  :aria-busy="acknowledging || undefined"
)
  PageIntro(
    :back="view.copy.back",
    :back-disabled="acknowledging || !view.allowedActions.includes('back')",
    :step="view.copy.step",
    :progress="view.copy.progress",
    :title="view.copy.title",
    :description="view.copy.description",
    @back="router.push(flowRoute(view.backTarget))"
  )
  AdviceBlocks(:blocks="view.blocks")
  PageActions(
    as="div",
    class=""
  )
    button(
      type="button",
      class="ui-button w-full rounded-control bg-primary-gradient p-4 text-button text-white shadow-brand disabled:opacity-40",
      :disabled="acknowledging || !view.allowedActions.includes('acknowledge')",
      @click="acknowledge"
    ) {{ view.copy.acknowledge }}
</template>
