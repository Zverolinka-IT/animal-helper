<script setup lang="ts">
import { flowRoute } from '../flow-route'
import { useFlowDraft } from '../use-flow-draft'
import PageActions from '../components/page-actions.vue'
import PageIntro from '../components/page-intro.vue'
import { computed, onUnmounted, ref, watch, useId } from 'vue'
import { useAutocomplete } from '@/libs/use-autocomplete'
import { useRouter } from 'vue-router'
import type { LocationPoint, LocationView } from './fixtures/location'
import { previewSession } from '../preview-flow'
import { flowActions } from '../flow-client'
import { backWithinFlow } from '../instruction-navigation'

const props = defineProps<{ view: LocationView }>()
const router = useRouter()
const query = ref('')
const resultsId = useId()

const selected = ref<LocationPoint | undefined>(previewSession.value?.location)
const locating = ref(false)
const message = ref('')
let requestId = 0
const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
const matches = computed(() =>
  props.view.places.filter(place => normalized(place.title + ' ' + place.detail).includes(normalized(query.value)))
)
const {
  setAnchor,
  setResults,
  focused,
  activeIndex: activeIndex,
  open,
  floatingStyles,
  keydown: onSearchKeydown
} = useAutocomplete({
  query,
  matches,
  enabled: () => !selected.value,
  select: selectPlace
})
function titleParts(title: string) {
  const needle = normalized(query.value)
  const index = normalized(title).indexOf(needle)
  if (!needle || index < 0) return { before: title, match: '', after: '' }
  return {
    before: title.slice(0, index),
    match: title.slice(index, index + needle.length),
    after: title.slice(index + needle.length)
  }
}
watch(
  query,
  () => {
    selected.value = undefined
    message.value = ''
    requestId++
    locating.value = false
  },
  { flush: 'sync' }
)
function selectPlace(place: LocationPoint) {
  focused.value = false
  requestId++
  locating.value = false
  selected.value = place
  message.value = ''
}
function locate() {
  const token = ++requestId
  if (!navigator.geolocation) {
    message.value = props.view.props.unavailable
    return
  }
  locating.value = true
  message.value = ''
  navigator.geolocation.getCurrentPosition(
    position => {
      if (token !== requestId) return
      locating.value = false
      selected.value = {
        label: props.view.props.deviceLabel,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        source: 'device'
      }
    },
    error => {
      if (token !== requestId) return
      locating.value = false
      message.value = error.code === 1 ? props.view.props.denied : props.view.props.unavailable
    },
    { timeout: 10000, maximumAge: 60000 }
  )
}
async function confirmLocation() {
  if (!selected.value || !previewSession.value || !props.view.allowedActions.includes('confirm-location')) return
  const pending = flowActions.location(selected.value, props.view.confirmTarget)
  const target = pending instanceof Promise ? await pending : pending
  if (target) void router.push(flowRoute(target))
}
function goBack() {
  if (!props.view.allowedActions.includes('back')) return
  if (props.view.backHistoryTargets?.length) {
    backWithinFlow(router, props.view.backTarget, props.view.backHistoryTargets)
    return
  }
  void router.push({ name: props.view.backTarget, query: previewSession.value?.fromDraft ? { fixture: 'draft' } : {} })
}
onUnmounted(() => {
  requestId++
})
useFlowDraft({ query, selected })
</script>

<template lang="pug">
.customer-location(:lang="view.locale")
  PageIntro(
    :back="view.props.back",
    :back-disabled="!view.allowedActions.includes('back')",
    :step="view.props.step",
    :progress="view.props.progress",
    :title="view.props.title",
    :description="view.props.description",
    @back="goBack"
  )
  .customer-location__selector(class="flex flex-col gap-3.5 bg-surface px-4 py-5 [@media(width>640px)]:rounded-control")
    .customer-location__search(
      :ref="setAnchor",
      class="flex items-center gap-2 rounded-control border border-primary px-3 py-1 shadow-[0_2px_6px_rgb(37_42_49/16%)]"
    )
      base-icon(
        name="search",
        class="text-primary"
      )
      input(
        v-model="query",
        type="text",
        role="combobox",
        aria-autocomplete="list",
        :aria-expanded="open",
        :aria-controls="open ? resultsId : undefined",
        :aria-activedescendant="open && activeIndex >= 0 ? resultsId + '-' + activeIndex : undefined",
        class="min-h-11 min-w-0 flex-1 bg-transparent outline-none",
        :aria-label="view.props.searchLabel",
        :placeholder="view.props.placeholder",
        autocomplete="off",
        @focus="focused = true",
        @input="focused = true",
        @blur="focused = false",
        @keydown="onSearchKeydown"
      )
      button(
        type="button",
        class="flex size-11 shrink-0 items-center justify-center",
        :aria-label="view.props.locate",
        :disabled="locating",
        @click="locate"
      )
        base-icon(
          name="location",
          class="text-primary"
        )
    Transition(name="suggestions")
      ul.customer-location__results(
        v-if="open",
        :id="resultsId",
        :ref="setResults",
        role="listbox",
        :style="floatingStyles",
        :aria-label="view.props.results",
        class="z-20 flex flex-col gap-2 overflow-auto rounded-control bg-surface p-2 shadow-[0_2px_6px_rgb(37_42_49/16%)]"
      )
        li(
          v-for="(place, index) in matches",
          :id="resultsId + '-' + index",
          :key="place.label",
          role="option",
          :aria-label="place.label",
          :aria-describedby="resultsId + '-detail-' + index",
          :aria-selected="activeIndex === index",
          class="min-h-11 shrink-0 cursor-pointer rounded-control px-3 py-2 text-left transition-colors duration-150 hover:bg-canvas motion-reduce:transition-none",
          :class="{ 'bg-primary-light': activeIndex === index }",
          @mousedown.prevent,
          @click="selectPlace(place)"
        )
          .customer-location__result-title(class="flex items-center gap-1 text-body-strong")
            base-icon(
              name="navigation",
              class="size-6 shrink-0 text-ink"
            )
            span(class="min-w-0 break-words")
              span {{ titleParts(place.title).before }}
              span(class="text-primary") {{ titleParts(place.title).match }}
              span {{ titleParts(place.title).after }}
          p(
            :id="resultsId + '-detail-' + index",
            class="mt-1 pl-1 text-small text-ink"
          ) {{ place.detail }}
        li(
          v-if="!matches.length",
          class="p-3"
        ) {{ view.props.empty }}
    p(
      v-if="locating",
      role="status"
    ) {{ view.props.locating }}
    button.customer-location__map(
      type="button",
      class="relative flex h-[400px] w-full items-center justify-center overflow-hidden rounded-[20px]",
      :aria-label="view.props.mapLabel",
      @click="selectPlace(view.map.point)"
    )
      img(
        :src="view.map.imageUrl",
        alt="",
        class="absolute inset-0 size-full object-cover"
      )
      span(
        class="absolute top-4 right-4 rounded-full bg-surface p-0.5 text-ink shadow-[0_0_8px_rgb(0_0_0/24%)]",
        aria-hidden="true"
      )
        base-icon(
          name="compass",
          class="size-6"
        )
      span(
        class="relative flex items-center gap-2 rounded-control border border-primary bg-surface px-4 py-2 text-primary shadow"
      )
        base-icon(
          name="locate",
          class="size-6 shrink-0"
        )
        span {{ view.props.mapHint }}
    p(
      v-if="selected",
      class="rounded-control bg-primary-light p-3 text-primary"
    ) {{ view.props.selected }}: {{ selected.label }} ({{ selected.lat.toFixed(5) }}, {{ selected.lng.toFixed(5) }})
  PageActions.customer-location__actions(
    as="div",
    class="shrink-0"
  )
    button(
      type="button",
      class="ui-button w-full rounded-control bg-primary-gradient p-4 text-button text-white shadow-brand disabled:cursor-not-allowed disabled:opacity-50",
      :disabled="!selected || locating || !view.allowedActions.includes('confirm-location')",
      @click="confirmLocation"
    ) {{ view.props.confirm }}
    p(
      class="mt-3 text-primary empty:hidden",
      role="status",
      aria-live="polite"
    ) {{ message }}
</template>

<style scoped>
.suggestions-leave-active {
  pointer-events: none;
}
@media (prefers-reduced-motion: no-preference) {
  .suggestions-enter-active {
    transition: opacity 160ms ease-out;
  }
  .suggestions-leave-active {
    transition: opacity 120ms ease-in;
  }
  .suggestions-enter-from,
  .suggestions-leave-to {
    opacity: 0;
  }
}
.customer-location__search:has(input:focus-visible) {
  box-shadow: 0 0 0 2px var(--color-primary-light);
}
</style>
