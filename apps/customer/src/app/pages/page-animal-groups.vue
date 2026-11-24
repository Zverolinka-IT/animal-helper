<script setup lang="ts">
import { useFlowDraft } from '../use-flow-draft'
import PageActions from '../components/page-actions.vue'
import PageIntro from '../components/page-intro.vue'
import ValidationMessage from '../components/validation-message.vue'
import { useFormValidation } from '@/libs/use-form-validation'
import { computed, ref, useId } from 'vue'
import { useRouter } from 'vue-router'
import { useAutocomplete } from '@/libs/use-autocomplete'
import { previewSession } from '../preview-flow'
import { flowActions } from '../flow-client'
import {
  catalogueAnimals,
  searchAnimals,
  normalizeAnimalSearch,
  placementId,
  reportedSpeciesId,
  type CatalogueAnimal
} from '../animal-catalogue'
import type { AnimalGroupsView } from './fixtures/animal-groups'

const props = defineProps<{ view: AnimalGroupsView }>()
const router = useRouter()
const form = ref<HTMLElement>()
const validation = useFormValidation(() => props.view.validation)
const resultsId = useId()
const query = ref('')
const path = ref<string[]>([...(previewSession.value?.animalIdentification?.path ?? [])])
const branches = computed(() => {
  const chain = [props.view.root]
  for (const id of path.value) {
    const node = chain[chain.length - 1]!.children.find(item => item.id === id)
    if (!node || node.kind !== 'branch') break
    chain.push(node)
  }
  return chain
})
const branch = computed(() => branches.value[branches.value.length - 1]!)
const cardsKey = computed(() => branches.value.map(item => item.id).join('/'))
const searchFirst = ref('')
const cards = computed(() => {
  const children = branch.value.children
  const first = children.find(node => node.id === searchFirst.value)
  return first ? [first, ...children.filter(node => node.id !== first.id)] : children
})
const heading = computed(() => props.view.props.title)
const intro = computed(() => props.view.props.description)
const animals = computed(() => catalogueAnimals(props.view.root))
function disableLeavingCards(element: Element) {
  const container = element.parentElement
  if (container) container.style.height = `${container.getBoundingClientRect().height}px`
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}
function sizeEnteringCards(element: Element) {
  if (element.parentElement) element.parentElement.style.height = `${element.getBoundingClientRect().height}px`
}
function releaseCardHeight(element: Element) {
  if (element.parentElement) element.parentElement.style.height = ''
}
function cardsLeft() {
  window.scrollTo({ top: 0, behavior: 'instant' })
}
const savedIdentification = previewSession.value?.animalIdentification
const choice = ref(
  savedIdentification?.kind === 'species'
    ? placementId(props.view.root, savedIdentification.path, savedIdentification.speciesId)
    : (savedIdentification?.kind ?? '')
)
const description = ref(savedIdentification?.description ?? '')
const completed = ref(false)
function changeAlternative() {
  completed.value = false
  validation.clear('animal', 'description')
}
function restartSelection() {
  if (!props.view.allowedActions.includes('select-group')) return
  resetSelection()
  path.value = []
}
function resetSelection() {
  validation.clear('animal')
  validation.clear('description')
  searchFirst.value = ''
  choice.value = ''
  description.value = ''
  completed.value = false
  query.value = ''
  focused.value = false
}
function confirm() {
  const session = previewSession.value
  if (!session || !props.view.allowedActions.includes('confirm') || !choice.value) return
  if (choice.value === 'other' && !description.value.trim()) return
  if (validation.hasFieldErrors.value) {
    validation.focusFirstError(form.value)
    return
  }
  const context = { path: [...path.value] }
  const target = flowActions.identify(
    choice.value === 'unknown'
      ? { ...context, kind: 'unknown' }
      : choice.value === 'other'
        ? { ...context, kind: 'other', description: description.value.trim() }
        : {
            ...context,
            kind: 'species',
            speciesId: (() => {
              const selected = branch.value.children.find(item => item.kind === 'animal' && item.id === choice.value)
              return selected?.kind === 'animal' ? reportedSpeciesId(selected) : choice.value
            })()
          },
    props.view.confirmTarget
  )
  completed.value = true
  void router.push({ name: target })
}
function selectCard(id: string) {
  const node = cards.value.find(item => item.id === id)
  if (!node || !props.view.allowedActions.includes(node.kind === 'branch' ? 'select-group' : 'select-animal')) return
  if (node.kind === 'branch') {
    resetSelection()
    path.value = [...path.value, node.id]
  } else {
    validation.clear('animal')
    validation.clear('description')
    choice.value = choice.value === id ? '' : id
    completed.value = false
  }
}
const matches = computed(() => searchAnimals(animals.value, query.value))

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
  enabled: () => props.view.allowedActions.includes('search'),
  select: selectAnimal
})
function titleParts(label: string) {
  const needle = normalizeAnimalSearch(query.value.trim())
  const index = normalizeAnimalSearch(label).indexOf(needle)
  if (!needle || index < 0) return { before: label, match: '', after: '' }
  return {
    before: label.slice(0, index),
    match: label.slice(index, index + needle.length),
    after: label.slice(index + needle.length)
  }
}
function selectAnimal(animal: CatalogueAnimal) {
  if (!props.view.allowedActions.includes('select-animal') || !previewSession.value) return
  resetSelection()
  path.value = [...animal.path]
  choice.value = animal.id
  searchFirst.value = animal.id
}
function goBack() {
  if (!props.view.allowedActions.includes('back')) return
  void router.push({ name: props.view.backTarget })
}
useFlowDraft({ query, path, choice, description, searchFirst })
</script>

<template lang="pug">
.customer-animal-groups(
  ref="form",
  class="flex flex-1 flex-col",
  :lang="view.locale"
)
  .customer-animal-groups__content(class="flex-1")
    .customer-animal-groups__top
      PageIntro(
        :back="view.props.back",
        :back-disabled="!view.allowedActions.includes('back')",
        :step="view.props.step",
        :progress="view.props.progress",
        :title="heading",
        :description="intro",
        @back="goBack"
      )
      div(class="px-4 py-2")
        hr(class="border-primary-light")
      .customer-animal-groups__search(class="flex items-center gap-2 px-4 pt-2 pb-2")
        div(
          :ref="setAnchor",
          class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control border border-primary bg-surface pr-1 pl-3 shadow-md"
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
            class="w-full min-w-0 bg-transparent outline-none placeholder:text-muted",
            :placeholder="view.props.search",
            :aria-label="view.props.search",
            :disabled="!view.allowedActions.includes('search')",
            autocomplete="off",
            @focus="focused = true",
            @input="focused = true",
            @blur="focused = false",
            @keydown="onSearchKeydown"
          )
          button(
            type="button",
            class="flex size-8 shrink-0 items-center justify-center rounded-full text-primary hover:bg-primary-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40",
            :aria-label="view.copy.restart",
            :title="view.copy.restart",
            :disabled="(!path.length && !query && !choice && !description) || !view.allowedActions.includes('select-group')",
            @click="restartSelection"
          )
            base-icon(
              name="restart",
              style="width: 20px; height: 20px"
            )
        Transition(name="animal-suggestions")
          ul.customer-animal-groups__results(
            v-if="open",
            :id="resultsId",
            :ref="setResults",
            role="listbox",
            :aria-label="view.props.results",
            :style="floatingStyles",
            class="z-20 flex flex-col gap-2 overflow-auto rounded-control bg-surface p-2 shadow-[0_2px_6px_rgb(37_42_49/16%)]"
          )
            li(
              v-for="(animal, index) in matches",
              :id="resultsId + '-' + index",
              :key="animal.id",
              role="option",
              :aria-label="animal.label",
              :aria-describedby="resultsId + '-detail-' + index",
              :aria-selected="activeIndex === index",
              :aria-disabled="!view.allowedActions.includes('select-animal')",
              class="min-h-11 shrink-0 rounded-control px-3 py-2 text-left transition-colors duration-150 hover:bg-canvas motion-reduce:transition-none",
              :class="{ 'bg-primary-light': activeIndex === index }",
              @mousedown.prevent,
              @click="selectAnimal(animal)"
            )
              p(class="text-body-strong")
                span {{ titleParts(animal.label).before }}
                span(class="text-primary") {{ titleParts(animal.label).match }}
                span {{ titleParts(animal.label).after }}
              p(
                :id="resultsId + '-detail-' + index",
                class="mt-1 text-small"
              ) {{ animal.detail }}
            li(
              v-if="!matches.length",
              class="p-3",
              role="status"
            ) {{ view.props.empty }}
    .customer-animal-groups__cards(class="relative overflow-hidden")
      Transition(
        name="animal-cards",
        mode="out-in",
        @before-leave="disableLeavingCards",
        @after-leave="cardsLeft",
        @enter="sizeEnteringCards",
        @after-enter="releaseCardHeight"
      )
        .customer-animal-groups__grid(
          :key="cardsKey",
          class="mx-auto grid w-full max-w-[640px] grid-cols-2 gap-4 px-4 pt-2 pb-4"
        )
          button(
            v-for="group in cards",
            :key="group.id",
            type="button",
            class="flex aspect-square min-w-0 flex-col overflow-hidden rounded-control border bg-surface text-primary transition-colors hover:border-primary motion-reduce:transition-none",
            :class="choice === group.id ? 'border-primary ring-2 ring-primary' : 'border-primary-light'",
            :aria-pressed="group.kind === 'animal' ? choice === group.id : undefined",
            :disabled="!view.allowedActions.includes(group.kind === 'branch' ? 'select-group' : 'select-animal')",
            @click="selectCard(group.id)"
          )
            span.customer-animal-groups__placeholder(
              class="relative min-h-0 w-full flex-1 overflow-hidden",
              aria-hidden="true"
            )
              img(
                v-if="'imageUrl' in group && group.imageUrl",
                :src="'imageUrl' in group ? group.imageUrl : undefined",
                alt="",
                class="absolute inset-0 size-full object-cover"
              )
              span(
                v-else,
                class="absolute inset-0 flex items-center justify-center text-primary/25"
              )
                svg(
                  class="size-12",
                  viewBox="0 0 24 24",
                  focusable="false"
                )
                  use(href="#icon-stray-animal")
            span(class="flex min-h-9 w-full items-center justify-center bg-primary-light px-2 py-2 text-center") {{ group.label }}
    p(
      v-if="completed",
      role="status",
      class="px-4 py-3 text-center text-primary"
    ) {{ view.copy.completed }}
  .customer-animal-groups__alternatives(class="flex shrink-0 flex-col gap-3 px-4 pt-4")
    ValidationMessage(
      :messages="validation.formErrors.value",
      summary
    )
    fieldset.customer-animal-groups__other(
      class="rounded-control border border-primary-light bg-surface p-4",
      v-bind="validation.attrs('animal')",
      tabindex="-1"
    )
      legend(class="px-1 font-semibold") {{ view.copy.alternatives }}
      label(class="flex items-center gap-2")
        input(
          v-model="choice",
          type="radio",
          name="animal-alternative",
          value="other",
          class="size-5 accent-primary",
          :disabled="!view.allowedActions.includes('select-animal')",
          @change="changeAlternative"
        )
        span {{ branch.otherLabel }}
      base-expander.customer-animal-groups__description(:state="choice === 'other'")
        div(class="pt-3")
          textarea(
            v-model="description",
            v-bind="validation.attrs('description')",
            :aria-label="view.copy.description",
            :placeholder="view.copy.description",
            rows="4",
            :required="choice === 'other'",
            class="w-full resize-none rounded-control border border-primary bg-surface p-3 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary-light)]",
            :disabled="choice !== 'other' || !view.allowedActions.includes('select-animal')",
            @input="validation.clear('description')"
          )
          ValidationMessage(
            :id="validation.errorId('description')",
            :messages="validation.messages('description')"
          )
      label(class="mt-3 flex items-center gap-2")
        input(
          v-model="choice",
          type="radio",
          name="animal-alternative",
          value="unknown",
          class="size-5 accent-primary",
          :disabled="!view.allowedActions.includes('select-animal')",
          @change="changeAlternative"
        )
        span {{ view.copy.unknown }}
      ValidationMessage(
        :id="validation.errorId('animal')",
        :messages="validation.messages('animal')"
      )
  PageActions.customer-animal-groups__actions(as="div")
    button(
      type="button",
      class="ui-button min-h-13 w-full rounded-control bg-primary-gradient p-4 text-button text-white disabled:opacity-40",
      :disabled="!choice || (choice === 'other' && !description.trim()) || !view.allowedActions.includes('confirm')",
      @click="confirm()"
    ) {{ view.copy.confirm }}
</template>

<style scoped>
.animal-cards-leave-active {
  pointer-events: none;
}
@media (prefers-reduced-motion: no-preference) {
  .customer-animal-groups__cards {
    transition: height 180ms ease-out;
  }
  .animal-cards-enter-active {
    transition:
      opacity 180ms ease-out,
      transform 180ms ease-out;
  }
  .animal-cards-leave-active {
    transition: opacity 90ms ease-in;
  }
  .animal-cards-enter-from,
  .animal-cards-leave-to {
    opacity: 0;
  }
  .animal-cards-enter-from {
    transform: translateY(6px);
  }
}
.animal-suggestions-leave-active {
  pointer-events: none;
}
.customer-animal-groups__search:has(input:focus-visible) > div {
  box-shadow: 0 0 0 2px var(--color-primary-light);
}
@media (prefers-reduced-motion: no-preference) {
  .animal-suggestions-enter-active {
    transition: opacity 160ms ease-out;
  }
  .animal-suggestions-leave-active {
    transition: opacity 120ms ease-in;
  }
  .animal-suggestions-enter-from,
  .animal-suggestions-leave-to {
    opacity: 0;
  }
}
</style>
