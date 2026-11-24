<script setup lang="ts">
import { flowRoute } from './flow-route'
import { usePreferredReducedMotion, useScrollLock, useElementSize } from '@vueuse/core'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue'
import { nextTick, onMounted, onUnmounted, provide, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { shellFixture as shell } from './pages/fixtures/shell'
import { finishPreview } from './preview-flow'
import { flowActions } from './flow-client'
import FlowExitDialog from './components/flow-exit-dialog.vue'
import { requestFlowExit, flowDraftContext } from './flow-exit'
import { flowExitFixture } from './pages/fixtures/flow-exit'
import AdviceDrawer from './components/advice-drawer.vue'
import { previewHomeView, previewPageAdvice } from './flow-client'
import ManagerToasts from './components/manager-toasts.vue'
import CompletionAnimation from './components/completion-animation.vue'
import { completion } from './completion'
import { clearToasts } from './toasts'
import logoOrange from '@/assets/brand/logo-orange.svg'
import SplashLogo from './components/splash-logo.vue'
import { usePageScrollbars } from '@/plugins/overlay-scrollbars'
import { computed } from 'vue'
import { holdScreenHeight, screenEntered, clearScreenScroll } from '@/providers/router/transition-scroll'
import { focusPageContent } from '@/providers/router/navigation-focus'
onUnmounted(clearScreenScroll)

usePageScrollbars()
const route = useRoute()
const router = useRouter()
const homeView = computed(() => previewHomeView(route.query.fixture === 'clean'))
const exitDialog = ref<InstanceType<typeof FlowExitDialog>>()
provide(requestFlowExit, opener => exitDialog.value?.open(opener))
const draftCaptures = new Set<() => Record<string, unknown>>()
provide(flowDraftContext, {
  writer: () => {
    const screen = String(route.name)
    return values => flowActions.saveUiDraft(screen, values)
  },
  restore: () => flowActions.readDraft(String(route.name)),
  register: capture => {
    draftCaptures.add(capture)
    return () => draftCaptures.delete(capture)
  }
})
async function leaveFlow() {
  const screen = route.name === 'contact-option' ? route.path : String(route.name)
  const target = flowActions.leave(screen)
  for (const capture of draftCaptures) flowActions.saveDraft(screen, capture())
  if (target) await router.push(flowRoute(target))
}
let pendingPageFocus = false
const stopNavigationFocus = router.afterEach((to, from, failure) => {
  if (!failure) void flowActions.rememberGuidePath(to.path)
  if (failure || !from.matched.length || to.path === from.path) return
  if (to.matched.at(-1)?.components?.default === from.matched.at(-1)?.components?.default) {
    const previousControl = document.activeElement
    void nextTick(() => focusPageContent(previousControl))
  } else pendingPageFocus = true
})
onUnmounted(stopNavigationFocus)
function pageTransitionFinished() {
  completionPageReady.value = true
  if (pendingPageFocus) {
    pendingPageFocus = false
    focusPageContent()
  }
}
const completionElapsed = ref(false)
const completionPageReady = ref(false)
async function navigateUnderCompletion() {
  completionElapsed.value = false
  completionPageReady.value = false
  const target = completion.value?.target
  if (!target) return
  try {
    if (route.name === target) completionPageReady.value = true
    const failure = await router.replace({ name: target })
    if (!failure && route.name === 'W01') finishPreview()
    if (failure) completionPageReady.value = true
  } catch {
    completionPageReady.value = true
  }
}
function finishCompletion() {
  completion.value = null
  completionElapsed.value = false
  completionPageReady.value = false
  void nextTick(() => document.getElementById('main-content')?.focus({ preventScroll: true }))
}
const pageAdvice = computed(() => previewPageAdvice(route.name))
const adviceDrawer = ref<InstanceType<typeof AdviceDrawer>>()
function openAdvice(event: MouseEvent) {
  void adviceDrawer.value?.open(event.currentTarget)
}
const appHeader = ref<HTMLElement>()
const { height: headerHeight } = useElementSize(appHeader, { width: 0, height: 80 }, { box: 'border-box' })
const stopToastNavigation = router.afterEach((to, from, failure) => {
  if (!failure && to.fullPath !== from.fullPath) {
    clearToasts()
    exitDialog.value?.close(true)
    adviceDrawer.value?.close(true)
  }
})
onUnmounted(stopToastNavigation)
async function handlePageAction(id: string) {
  if (route.name !== 'W01') return
  const pending = flowActions.start(homeView.value, id)
  const target = pending instanceof Promise ? await pending : pending
  if (target) await router.push(flowRoute(target))
}
const reducedMotion = usePreferredReducedMotion()
const starting = ref(true)
const menu = ref<HTMLDialogElement>()
const menuTrigger = ref<HTMLButtonElement>()
const menuOpen = ref(false)
const menuClosing = ref(false)
let menuCloseTimer: ReturnType<typeof setTimeout> | undefined
const notice = ref('')
const body = ref<HTMLElement | null>(null)
const scrollLocked = useScrollLock(body)
let splashTimer: ReturnType<typeof setTimeout> | undefined
function openMenu() {
  clearTimeout(menuCloseTimer)
  menuClosing.value = false
  menu.value?.showModal()
  menuOpen.value = true
  scrollLocked.value = true
}
function closeMenu() {
  if (!menu.value?.open || menuClosing.value) return
  if (reducedMotion.value === 'reduce') {
    menu.value.close()
    return
  }
  menuClosing.value = true
  // Keep the native modal and scroll lock until both exit animations finish.
  menuCloseTimer = setTimeout(() => menu.value?.close(), 380)
}
function onMenuKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = menu.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')
  if (!controls?.length) return
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
function onMenuClosed() {
  clearTimeout(menuCloseTimer)
  menuClosing.value = false
  menuOpen.value = false
  scrollLocked.value = false
  menuTrigger.value?.focus({ preventScroll: true })
}
async function showUnavailable(label: string) {
  closeMenu()
  notice.value = ''
  await nextTick()
  notice.value = shell.props.unavailable.replace('{label}', label)
}
onMounted(() => {
  body.value = document.body
  // Temporary brand introduction, independent of future API loading state.
  splashTimer = setTimeout(
    () => {
      starting.value = false
    },
    reducedMotion.value === 'reduce' ? 0 : 1600
  )
})
onUnmounted(() => {
  clearTimeout(splashTimer)
  clearTimeout(menuCloseTimer)
  menu.value?.close()
  scrollLocked.value = false
})
</script>

<template lang="pug">
.customer-app(
  class="relative min-h-dvh w-full bg-canvas",
  :lang="shell.locale"
)
  FlowExitDialog(
    ref="exitDialog",
    :copy="flowExitFixture",
    @leave="leaveFlow"
  )
  ManagerToasts
  CompletionAnimation(
    v-if="completion",
    :label="completion.label",
    :reveal="completionElapsed && completionPageReady",
    @covered="navigateUnderCompletion",
    @elapsed="completionElapsed = true",
    @complete="finishCompletion"
  )
  AdviceDrawer(
    v-if="pageAdvice",
    ref="adviceDrawer",
    :view="pageAdvice",
    :style="{ '--advice-header-height': headerHeight + 'px' }"
  )
  .customer-app__content(
    class="flex min-h-dvh flex-col",
    :inert="starting || !!completion"
  )
    a.customer-app__skip(
      class="sr-only focus:not-sr-only focus:absolute focus:z-20 focus:bg-surface focus:p-4",
      href="#main-content"
    ) {{ shell.props.skip }}
    header.customer-app__header(
      ref="appHeader",
      class="sticky top-0 z-30 shrink-0 bg-surface px-[15px] pt-[max(16px,env(safe-area-inset-top))] pb-5 shadow-[0_2px_8px_rgb(37_42_49/8%)] supports-backdrop-filter:bg-surface/80 supports-backdrop-filter:backdrop-blur-md"
    )
      .customer-app__header-row(class="flex min-h-11 items-center justify-between")
        RouterLink(
          :to="shell.homeTarget",
          :aria-label="shell.props.home"
        )
          img(
            :src="logoOrange",
            :alt="shell.props.brand",
            width="62",
            height="40",
            class="h-10 w-[62px]"
          )
        button.customer-app__advice-trigger(
          v-if="pageAdvice",
          type="button",
          aria-haspopup="dialog",
          class="ui-button rounded-control bg-accent-gradient px-6 py-3 text-button text-white",
          @click="openAdvice"
        ) {{ pageAdvice.triggerLabel }}
        button.customer-app__menu-trigger(
          v-if="route.meta.showMenu !== false",
          ref="menuTrigger",
          class="flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-canvas",
          type="button",
          :aria-label="shell.props.openMenu",
          aria-haspopup="dialog",
          aria-controls="app-menu",
          :aria-expanded="menuOpen",
          @click="openMenu"
        )
          base-icon(name="menu")
    main#main-content.customer-app__main(
      class="mx-auto flex w-full max-w-[640px] flex-1 flex-col",
      tabindex="-1"
    )
      RouterView(v-slot="{ Component }")
        Transition(
          name="screen",
          mode="out-in",
          @before-leave="holdScreenHeight",
          @enter="screenEntered",
          @after-enter="pageTransitionFinished"
        )
          component(
            :is="Component",
            v-bind="route.name === 'W01' ? { view: homeView } : {}",
            @action="handlePageAction"
          )
    p.customer-app__notice(
      class="px-5 text-body text-primary empty:hidden",
      role="status",
      aria-live="polite"
    ) {{ notice }}
  dialog#app-menu.customer-app__menu(
    ref="menu",
    class="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-ink",
    :aria-label="shell.props.menu",
    :class="{ 'is-closing': menuClosing }",
    @cancel.prevent="closeMenu",
    @click.self="closeMenu",
    @keydown="onMenuKeydown",
    @close="onMenuClosed"
  )
    .customer-app__drawer(class="flex h-full w-[calc(100%-48px)] max-w-[324px] flex-col rounded-r-control bg-surface")
      .customer-app__drawer-header(
        class="flex shrink-0 items-center justify-between border-b border-primary-light px-[15px] pt-[max(16px,env(safe-area-inset-top))] pb-5"
      )
        img(
          :src="logoOrange",
          :alt="shell.props.brand",
          width="62",
          height="40",
          class="h-10 w-[62px]"
        )
        button(
          class="-mr-2 flex size-11 cursor-pointer items-center justify-center rounded-lg text-primary hover:bg-canvas",
          type="button",
          :aria-label="shell.props.closeMenu",
          autofocus,
          @click="closeMenu"
        )
          base-icon(name="close")
      OverlayScrollbarsComponent.customer-app__drawer-scroll(
        class="min-h-0 flex-1 overflow-auto",
        :defer="true"
      )
        nav(
          class="flex flex-col gap-3 py-3",
          :aria-label="shell.props.navigation"
        )
          template(
            v-for="item in shell.menuItems",
            :key="item.label"
          )
            RouterLink(
              v-if="item.target",
              class="flex min-h-14 items-center gap-3 px-4 py-4 text-body-strong hover:bg-canvas",
              :to="item.target",
              @click="closeMenu"
            )
              base-icon(:name="item.icon")
              span {{ item.label }}
            button(
              v-else,
              class="flex min-h-14 cursor-not-allowed items-center gap-3 px-4 py-4 text-left text-body-strong opacity-50",
              type="button",
              disabled
            )
              base-icon(:name="item.icon")
              span {{ item.label }}
      .customer-app__drawer-footer(
        class="relative flex shrink-0 justify-center gap-2 rounded-br-control border-t border-primary-light bg-canvas px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] text-primary"
      )
        button(
          v-for="social in shell.socials",
          :key="social.icon",
          class="flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-primary-light",
          type="button",
          :aria-label="social.name",
          @click="showUnavailable(social.name)"
        )
          base-icon(
            :name="social.icon",
            class="size-7"
          )
  .customer-app__splash(
    v-if="starting",
    class="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-primary",
    role="status",
    :aria-label="shell.props.welcome"
  )
    SplashLogo(
      :label="shell.props.brand",
      class="h-[134px] w-[207px]"
    )
</template>

<style scoped>
.customer-app__menu::backdrop {
  background: rgb(37 42 49 / 80%);
}
.customer-app__drawer {
  /* Extend the surface beyond the viewport during the small rightward overshoot. */
  box-shadow: -12px 0 0 var(--color-surface);
}
.customer-app__drawer-footer::before {
  content: '';
  position: absolute;
  inset: -1px 100% 0 auto;
  width: 12px;
  background: inherit;
  border-top: inherit;
  pointer-events: none;
}
@media (prefers-reduced-motion: no-preference) {
  .customer-app__splash {
    animation: splash-fade-out 180ms ease-out 1420ms both;
  }
  @keyframes splash-fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  .screen-enter-active {
    transition:
      opacity 250ms ease-out,
      transform 250ms ease-out;
  }
  .screen-leave-active {
    transition: opacity 100ms ease-out;
    pointer-events: none;
  }
  .screen-enter-from {
    opacity: 0;
    transform: translateY(8px);
  }
  .screen-leave-to {
    opacity: 0;
  }
  .customer-app__menu[open] .customer-app__drawer {
    animation: drawer-enter 460ms both;
  }
  .customer-app__menu[open]::backdrop {
    animation: backdrop-enter 150ms ease-out;
  }
  .customer-app__menu[open].is-closing .customer-app__drawer {
    animation: drawer-exit 360ms forwards;
  }
  .customer-app__menu[open].is-closing::backdrop {
    animation: backdrop-exit 360ms ease-in forwards;
  }
  @keyframes drawer-exit {
    from {
      transform: translateX(0);
      animation-timing-function: ease-out;
    }
    25% {
      transform: translateX(6px);
      animation-timing-function: cubic-bezier(0.4, 0, 1, 1);
    }
    to {
      transform: translateX(-100%);
    }
  }
  @keyframes backdrop-exit {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  @keyframes backdrop-enter {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes drawer-enter {
    from {
      transform: translateX(-100%);
      animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
    }
    72% {
      transform: translateX(6px);
      animation-timing-function: cubic-bezier(0.2, 0, 0.2, 1);
    }
    to {
      transform: translateX(0);
    }
  }
}
</style>
