<script setup lang="ts">
import { flowRoute } from '../flow-route'
import PageActions from '../components/page-actions.vue'
import PageIntro from '../components/page-intro.vue'
import ValidationMessage from '../components/validation-message.vue'
import { useFormValidation } from '@/libs/use-form-validation'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { previewSession } from '../preview-flow'
import { flowActions } from '../flow-client'
import { backWithinFlow } from '../instruction-navigation'
import { catalogueAnimals, reportedSpeciesId } from '../animal-catalogue'
import { reconcileDetailAnswers } from '../detail-answers'
import type { AnimalBranch } from './fixtures/animal-groups'
import type { AnimalDetailsView, DetailQuestion } from './fixtures/animal-details'
const props = withDefaults(
  defineProps<{
    view: AnimalDetailsView
    catalogue: AnimalBranch
    answerScope?: 'animalDetails' | 'roadDetails'
  }>(),
  { answerScope: 'animalDetails' }
)
const router = useRouter()
const form = ref<HTMLFormElement>()
const validation = useFormValidation(() => props.view.validation)
const failed = computed(() => props.view.showAnimal !== false && !!previewSession.value?.identificationFailed)
const identification = computed(() => previewSession.value?.animalIdentification)
const animal = computed(() => {
  const selected = identification.value
  if (selected?.kind !== 'species') return undefined
  const animals = catalogueAnimals(props.catalogue)
  const path = selected.path.join('/')
  return (
    animals.find(item => reportedSpeciesId(item) === selected.speciesId && item.path.join('/') === path) ??
    animals.find(item => reportedSpeciesId(item) === selected.speciesId)
  )
})
const animalLabel = computed(
  () =>
    animal.value?.label ??
    (identification.value?.kind === 'other'
      ? identification.value.description || props.view.copy.other
      : props.view.copy.unknown)
)
const answers = ref(
  reconcileDetailAnswers(props.view.questions, previewSession.value?.[props.answerScope] ?? {}, props.view.values)
)
watch(
  () => JSON.stringify(props.view.questions),
  (_, previous) => {
    const oldQuestions = JSON.parse(previous) as DetailQuestion[]
    answers.value = reconcileDetailAnswers(props.view.questions, answers.value, props.view.values, oldQuestions)
    for (const old of oldQuestions) {
      const current = props.view.questions.find(question => question.id === old.id && question.kind === old.kind)
      if (!current) validation.clear(old.id)
      for (const option of old.options) {
        if (!current?.options.some(item => item.id === option.id && item.description)) {
          validation.clear(`${old.id}:${option.id}`)
        }
      }
    }
  }
)
watch(
  answers,
  value => {
    flowActions.saveDetails(value, props.answerScope)
  },
  { deep: true }
)
function selected(question: DetailQuestion, id: string) {
  const value = answers.value[question.id]
  return Array.isArray(value) ? value.includes(id) : value === id
}
function choose(question: DetailQuestion, id: string) {
  if (question.disabled || question.options.find(option => option.id === id)?.disabled) return
  validation.clear(question.id)
  if (question.kind === 'single') answers.value[question.id] = id
  else {
    const current = answers.value[question.id]
    const values = Array.isArray(current) ? current : []
    const exclusive = question.options.find(option => option.id === id)?.exclusive
    answers.value[question.id] = values.includes(id)
      ? values.filter(value => value !== id)
      : exclusive
        ? [id]
        : [...values.filter(value => !question.options.find(option => option.id === value)?.exclusive), id]
  }
  for (const option of question.options)
    if (option.description && !selected(question, option.id)) {
      delete answers.value[`${question.id}:${option.id}`]
      validation.clear(`${question.id}:${option.id}`)
    }
}
const valid = computed(() =>
  props.view.questions.every(
    question =>
      question.disabled ||
      !question.required ||
      (question.kind === 'text'
        ? typeof answers.value[question.id] === 'string' && String(answers.value[question.id]).trim().length > 0
        : question.options.some(option => selected(question, option.id)))
  )
)
async function confirm() {
  if (!valid.value || !props.view.allowedActions.includes('confirm') || !previewSession.value) return
  if (validation.hasFieldErrors.value) {
    validation.focusFirstError(form.value)
    return
  }
  const pending = flowActions.details(answers.value, props.answerScope, props.view.confirmTarget)
  const target = pending instanceof Promise ? await pending : pending
  if (target) void router.push(flowRoute(target))
}
function edit() {
  if (!props.view.allowedActions.includes('edit')) return
  void router.push({ name: flowActions.edit(props.view.editTarget) })
}
</script>

<template lang="pug">
.customer-animal-details(
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
    @back="backWithinFlow(router, failed ? view.failedBackTarget : view.backTarget, [view.backTarget, view.failedBackTarget])"
  )
  div(
    v-if="view.showAnimal !== false",
    class="px-4 py-2"
  )
    hr(class="border-primary-light")
  h2(
    v-if="view.showAnimal !== false",
    class="px-5 py-2 text-heading-3"
  ) {{ view.copy.animal }}
  div(
    v-if="failed",
    class="mx-4 my-2 rounded-control border border-accent bg-accent-light px-5 py-4",
    role="status"
  )
    div(class="flex items-center gap-2 text-accent")
      base-icon(
        name="warning",
        class="size-6 shrink-0"
      )
      p(class="min-w-0 text-heading-3") {{ view.copy.failedTitle }}
    p(class="mt-2") {{ view.copy.failedDescription }}
  template(v-else)
    section(
      v-if="view.showAnimal !== false",
      class="mx-4 mb-4 rounded-control border border-primary-light bg-surface p-5"
    )
      div(class="flex items-center justify-between gap-3")
        p(class="text-body-strong text-primary") {{ animalLabel }}
        button(
          type="button",
          class="flex min-h-8 items-center gap-1 text-small text-accent",
          :disabled="!view.allowedActions.includes('edit')",
          @click="edit"
        )
          base-icon(name="edit")
          span {{ view.copy.edit }}
      hr(class="my-4 border-primary-light")
      img(
        v-if="animal?.imageUrl",
        :src="animal.imageUrl",
        alt="",
        class="h-[200px] w-full rounded-control object-contain"
      )
      div(
        v-else,
        class="flex h-[200px] items-center justify-center text-primary/25",
        aria-hidden="true"
      )
        base-icon(
          name="stray-animal",
          style="width: 64px; height: 64px"
        )
    h2(
      v-if="view.questions.length && view.copy.details",
      class="px-5 py-2 text-heading-3"
    ) {{ view.copy.details }}
    form#animal-details-form(
      ref="form",
      class="flex flex-col gap-2 px-4",
      @submit.prevent="confirm"
    )
      ValidationMessage(
        :messages="validation.formErrors.value",
        summary
      )
      fieldset(
        v-for="question in view.questions",
        :key="question.id",
        :disabled="question.disabled",
        v-bind="validation.attrs(question.id)",
        tabindex="-1",
        class="min-w-0 rounded-control border border-primary-light bg-surface py-4",
        :aria-labelledby="'question-' + question.id"
      )
        div(
          :id="'question-' + question.id",
          class="px-4 text-body-strong",
          :class="question.hideLabel ? 'sr-only' : ''"
        ) {{ question.label }}
        hr(
          v-if="!question.hideLabel",
          class="my-3 border-primary-light"
        )
        div(
          v-if="question.kind === 'text'",
          class="px-4"
        )
          textarea(
            v-model="answers[question.id]",
            v-bind="validation.attrs(question.id)",
            :aria-label="question.label",
            :placeholder="question.placeholder",
            :required="question.required",
            rows="4",
            maxlength="2000",
            class="w-full resize-none rounded-control border border-primary bg-surface p-3 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary-light)]",
            @input="validation.clear(question.id)"
          )
        div(class="flex flex-col gap-3 px-4")
          div(
            v-for="option in question.options",
            :key="option.id"
          )
            label(class="flex items-center gap-2")
              input(
                :type="question.kind === 'multiple' ? 'checkbox' : 'radio'",
                :name="question.id",
                :value="option.id",
                :disabled="question.disabled || option.disabled",
                v-bind="validation.attrs(question.id)",
                :checked="selected(question, option.id)",
                class="size-6 shrink-0 accent-primary",
                @change="choose(question, option.id)"
              )
              span {{ option.label }}
            base-expander(
              v-if="option.description",
              :state="selected(question, option.id)"
            )
              div(class="pt-3")
                textarea(
                  v-model="answers[question.id + ':' + option.id]",
                  v-bind="validation.attrs(question.id + ':' + option.id)",
                  :aria-label="option.description",
                  :placeholder="option.description",
                  :disabled="question.disabled || option.disabled || !selected(question, option.id)",
                  rows="4",
                  maxlength="2000",
                  class="w-full resize-none rounded-control border border-primary bg-surface p-3 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-primary-light)]",
                  @input="validation.clear(question.id + ':' + option.id)"
                )
                ValidationMessage(
                  :id="validation.errorId(question.id + ':' + option.id)",
                  :messages="validation.messages(question.id + ':' + option.id)"
                )
        ValidationMessage(
          :id="validation.errorId(question.id)",
          :messages="validation.messages(question.id)",
          class="px-4"
        )
  PageActions(
    as="div",
    class=""
  )
    button(
      v-if="failed",
      type="button",
      class="ui-button w-full rounded-control bg-primary-gradient p-4 text-button text-white shadow-brand",
      @click="router.push({ name: view.manualTarget })"
    ) {{ view.copy.manual }}
    button(
      v-else,
      type="submit",
      form="animal-details-form",
      :disabled="!valid || !view.allowedActions.includes('confirm')",
      class="ui-button w-full rounded-control bg-primary-gradient p-4 text-button text-white shadow-brand disabled:opacity-40"
    ) {{ view.copy.confirm }}
</template>
