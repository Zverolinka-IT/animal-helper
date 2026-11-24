<script setup lang="ts">
import { useFlowDraft } from '../use-flow-draft'
import PageActions from '../components/page-actions.vue'
import PageIntro from '../components/page-intro.vue'
import { computed, ref, useId } from 'vue'
import { useRouter } from 'vue-router'
import { useAutocomplete } from '@/libs/use-autocomplete'
import { catalogueAnimals, reportedSpeciesId, searchAnimals, type CatalogueAnimal } from '../animal-catalogue'
import { previewSession } from '../preview-flow'
import { flowActions } from '../flow-client'
import type { AnimalBranch } from './fixtures/animal-groups'
import type { EditAnimalView } from './fixtures/animal-details'
const props = defineProps<{ view: EditAnimalView; catalogue: AnimalBranch }>()
const router = useRouter()
const query = ref('')
const id = useId()
const animals = computed(() => catalogueAnimals(props.catalogue))
const matches = computed(() => searchAnimals(animals.value, query.value))

const {
  setAnchor,
  setResults,
  focused,
  activeIndex: active,
  open,
  floatingStyles,
  keydown: keydown
} = useAutocomplete({
  query,
  matches,
  enabled: () => props.view.allowedActions.includes('search'),
  select: select
})
function select(animal: CatalogueAnimal) {
  const session = previewSession.value
  if (!session || !props.view.allowedActions.includes('search')) return
  const target = flowActions.identify(
    { kind: 'species', path: animal.path, speciesId: reportedSpeciesId(animal) },
    props.view.backTarget
  )
  void router.push({ name: target })
}
function go(action: 'media' | 'manual') {
  if (!props.view.allowedActions.includes(action)) return
  void router.push({ name: flowActions.edit(action === 'media' ? props.view.mediaTarget : props.view.manualTarget) })
}
useFlowDraft({ query })
</script>

<template lang="pug">
.customer-edit-animal(
  class="flex flex-1 flex-col",
  :lang="view.locale"
)
  PageIntro(
    :back="view.copy.back",
    :back-disabled="!view.allowedActions.includes('back')",
    :step="view.copy.step",
    :progress="view.copy.progress",
    :title="view.copy.title",
    :description="view.copy.description",
    @back="router.push({ name: view.backTarget })"
  )
  div(class="px-4 py-4")
    div(
      :ref="setAnchor",
      class="flex min-h-11 items-center gap-2 rounded-control border border-primary bg-surface px-3 shadow-md focus-within:shadow-[0_0_0_2px_var(--color-primary-light)]"
    )
      base-icon(
        name="search",
        class="text-primary"
      )
      input(
        v-model="query",
        role="combobox",
        type="text",
        autocomplete="off",
        aria-autocomplete="list",
        :aria-expanded="open",
        :aria-controls="open ? id : undefined",
        :aria-activedescendant="open && active >= 0 ? id + '-' + active : undefined",
        :placeholder="view.copy.search",
        :aria-label="view.copy.search",
        :disabled="!view.allowedActions.includes('search')",
        class="w-full min-w-0 bg-transparent outline-none placeholder:text-muted",
        @focus="focused = true",
        @input="focused = true",
        @blur="focused = false",
        @keydown="keydown"
      )
    Transition(name="edit-results")
      ul(
        v-if="open",
        :id="id",
        :ref="setResults",
        role="listbox",
        :aria-label="view.copy.results",
        :style="floatingStyles",
        class="z-30 flex flex-col gap-2 overflow-auto rounded-control bg-surface p-2 shadow-md"
      )
        li(
          v-for="(animal, index) in matches",
          :id="id + '-' + index",
          :key="animal.id",
          role="option",
          :aria-selected="index === active",
          :aria-label="animal.label",
          class="shrink-0 rounded-control px-3 py-2 transition-colors duration-150 hover:bg-canvas motion-reduce:transition-none",
          :class="{ 'bg-primary-light': index === active }",
          @mousedown.prevent,
          @click="select(animal)"
        )
          p(class="text-body-strong text-primary") {{ animal.label }}
          p(class="mt-1 text-small") {{ animal.detail }}
        li(
          v-if="!matches.length",
          role="status",
          class="p-3"
        ) {{ view.copy.empty }}
  PageActions(
    as="div",
    class="flex flex-col gap-4"
  )
    button(
      type="button",
      :disabled="!view.allowedActions.includes('media')",
      class="ui-button w-full rounded-control bg-primary-gradient p-4 text-button text-white shadow-brand",
      @click="go('media')"
    ) {{ view.copy.media }}
    button(
      type="button",
      :disabled="!view.allowedActions.includes('manual')",
      class="ui-button w-full rounded-control border border-primary bg-surface p-4 text-button text-primary",
      @click="go('manual')"
    ) {{ view.copy.manual }}
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .edit-results-enter-active,
  .edit-results-leave-active {
    transition: opacity 150ms ease;
  }
  .edit-results-enter-from,
  .edit-results-leave-to {
    opacity: 0;
  }
}
.edit-results-leave-active {
  pointer-events: none;
}
</style>
