<script setup lang="ts">
import { reportOutcomeSchema, draftClosureSchema } from '@animal-helper/contracts'
import { flowRoute } from '../flow-route'
import { useFlowDraft } from '../use-flow-draft'
import FlowNavigation from '../components/flow-navigation.vue'
import PageActions from '../components/page-actions.vue'
import ValidationMessage from '../components/validation-message.vue'
import { useFormValidation } from '@/libs/use-form-validation'
import { computed, ref, useId, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { ThankYouView } from './fixtures/thank-you'
import { completion } from '../completion'
import { flowActions } from '../flow-client'
const props = defineProps<{ view: ThankYouView }>()
const router = useRouter()
const form = ref<HTMLFormElement>()
const validation = useFormValidation(() => props.view.validation)
const id = useId()
const finishing = computed(() => !!completion.value)
const submitting = ref(false)
const busy = computed(() => finishing.value || submitting.value)
// No default consent. Outcome and selected reasons are included in the submitted private snapshot.
const values = ref<Record<string, string>>({ ...props.view.values })
const consents = ref<Record<string, boolean>>({})
const reasons = ref<Record<string, boolean>>({})
const selectedReason = ref('')
const descriptions = ref<Record<string, string>>({})
const closureStatus = ref('')
watch(
  () => props.view.screen,
  () => {
    values.value = { ...props.view.values }
    consents.value = {}
    reasons.value = {}
    selectedReason.value = ''
    descriptions.value = {}
    closureStatus.value = ''
  }
)
async function submit() {
  if (validation.hasFieldErrors.value) {
    validation.focusFirstError(form.value)
    return
  }
  if (busy.value || !props.view.allowedActions.includes('submit')) return
  submitting.value = true
  try {
    const outcome = props.view.outcome
      ? reportOutcomeSchema.safeParse({
          status: props.view.outcome,
          reasons:
            props.view.outcome === 'unresolved'
              ? (props.view.reasons?.options ?? []).filter(option => reasons.value[option.id]).map(option => option.id)
              : [],
          ...(props.view.outcome === 'unresolved' && reasons.value.other && descriptions.value.other?.trim()
            ? { otherText: descriptions.value.other.trim() }
            : {})
        })
      : undefined
    if (outcome && !outcome.success) return
    const selected =
      props.view.reasons?.input === 'radio'
        ? props.view.reasons.options.find(option => option.id === selectedReason.value)
        : undefined
    const whoHelped = selected
      ? {
          choice: selected.label,
          ...(selected.id === 'other' && descriptions.value.other?.trim()
            ? { detail: descriptions.value.other.trim() }
            : {})
        }
      : undefined
    const closure =
      props.view.screen === 'W26'
        ? draftClosureSchema.safeParse({
            status: closureStatus.value,
            ...(closureStatus.value === 'other' && descriptions.value.other?.trim()
              ? { description: descriptions.value.other.trim() }
              : {})
          })
        : undefined
    if (closure && !closure.success) return
    const pending = flowActions.submitReport({
      ...(closure?.success ? { closure: closure.data } : {}),
      ...(outcome?.success ? { outcome: outcome.data } : {}),
      ...(whoHelped ? { whoHelped } : {}),
      name: values.value.name,
      phone: values.value.phone,
      email: values.value.email,
      shareWithAuthorities:
        props.view.consents.some(consent => consent.id === 'share-contact') && !!consents.value['share-contact'],
      newsletter: !!consents.value.newsletter
    })
    const accepted = pending instanceof Promise ? await pending : pending
    if (!accepted) return
    completion.value = { label: props.view.completionLabel, target: props.view.submitTarget }
  } finally {
    submitting.value = false
  }
}
async function requestHelp() {
  if (busy.value || !props.view.help?.action.enabled) return
  const target = await flowActions.requestAnimalHelp()
  if (target) await router.push(flowRoute(target))
}
async function goBack() {
  if (busy.value || !props.view.allowedActions.includes('back')) return
  const target = props.view.screen === 'W26' ? flowActions.cancelDraftClosure() : props.view.backTarget
  if (target) await router.push(flowRoute(target))
}
useFlowDraft({ values, consents, reasons, selectedReason, descriptions, closureStatus })
</script>

<template lang="pug">
form.customer-thank-you(
  ref="form",
  class="flex flex-1 flex-col",
  :lang="view.locale",
  :inert="busy || undefined",
  @submit.prevent="submit"
)
  FlowNavigation(
    :back="view.copy.back",
    :back-disabled="busy || !view.allowedActions.includes('back')",
    @back="goBack"
  )
  header(class="px-5 pt-5 pb-3")
    h1(class="mb-1 text-heading-1") {{ view.copy.title }}
    p(
      v-if="view.copy.description",
      class="mt-1"
    ) {{ view.copy.description }}
  ValidationMessage(
    :messages="validation.formErrors.value",
    summary,
    class="mx-4 mb-3"
  )
  div(
    v-for="(group, groupIndex) in view.reasonGroups ?? (view.reasons ? [view.reasons] : [])",
    :key="groupIndex",
    class="px-4 pt-2 pb-4"
  )
    section(
      class="rounded-control border border-primary-light bg-surface py-4",
      :aria-labelledby="id + '-reasons-' + groupIndex"
    )
      h2(
        :id="id + '-reasons-' + groupIndex",
        class="border-b border-primary-light px-4 pb-3 text-body-strong"
      ) {{ group.title }}
      div(class="flex flex-col gap-3 px-4 pt-3")
        div(
          v-for="reason in group.options",
          :key="reason.id"
        )
          label(class="flex items-center gap-2")
            input(
              v-if="view.screen === 'W26'",
              v-model="closureStatus",
              type="radio",
              name="closure-outcome",
              :value="reason.id",
              required,
              class="size-6 shrink-0 accent-primary"
            )
            input(
              v-else-if="group.input === 'radio'",
              v-model="selectedReason",
              type="radio",
              :name="'help-outcome-' + groupIndex",
              :value="reason.id",
              class="size-6 shrink-0 accent-primary"
            )
            input(
              v-else,
              v-model="reasons[reason.id]",
              v-bind="validation.attrs('reason:' + reason.id)",
              type="checkbox",
              :name="reason.id",
              class="size-6 shrink-0 accent-primary",
              @change="validation.clear('reason:' + reason.id, 'description:' + reason.id)"
            )
            span {{ reason.label }}
          ValidationMessage(
            :id="validation.errorId('reason:' + reason.id)",
            :messages="validation.messages('reason:' + reason.id)"
          )
          base-expander(
            v-if="reason.description",
            :state="view.screen === 'W26' ? closureStatus === reason.id : group.input === 'radio' ? selectedReason === reason.id : !!reasons[reason.id]"
          )
            div(class="pt-3")
              textarea(
                v-model="descriptions[reason.id]",
                v-bind="validation.attrs('description:' + reason.id)",
                :aria-label="reason.description.placeholder",
                :placeholder="reason.description.placeholder",
                :required="reasons[reason.id] && reason.description.required",
                :disabled="view.screen === 'W26' ? closureStatus !== reason.id : group.input === 'radio' ? selectedReason !== reason.id : !reasons[reason.id]",
                :maxlength="reason.description.maxLength",
                rows="4",
                class="w-full resize-none rounded-control border border-primary bg-surface p-3 placeholder:text-muted focus:shadow-[inset_0_0_0_1px_var(--color-primary)] focus:outline-none",
                @input="validation.clear('description:' + reason.id)"
              )
              ValidationMessage(
                :id="validation.errorId('description:' + reason.id)",
                :messages="validation.messages('description:' + reason.id)"
              )
  div(
    v-if="view.help",
    class="px-4 pt-2 pb-4"
  )
    section(class="rounded-control border border-success bg-success-light p-4")
      h2(class="mb-3 px-1 text-heading-3 text-success") {{ view.help.title }}
      p(class="mb-5 px-1") {{ view.help.description }}
      button(
        type="button",
        class="ui-button w-full rounded-control bg-primary-gradient p-4 text-button text-white shadow-brand disabled:opacity-40",
        :disabled="!view.help.action.enabled",
        @click="requestHelp"
      ) {{ view.help.action.label }}
  section(
    v-if="view.contactIntro",
    class="px-5 py-1"
  )
    h2(class="mb-1 text-heading-3") {{ view.contactIntro.title }}
    p {{ view.contactIntro.description }}
  div(class="flex flex-col gap-4 px-4 pt-2 pb-4")
    div(
      v-for="field in view.fields",
      :key="field.id",
      class="flex flex-col gap-2"
    )
      label(
        :for="id + field.id",
        class="px-2 font-form text-small"
      ) {{ field.label }}
      input(
        :id="id + field.id",
        v-model="values[field.id]",
        v-bind="validation.attrs(field.id)",
        :type="field.type",
        :name="field.id",
        :autocomplete="field.autocomplete",
        :placeholder="field.placeholder",
        :required="field.required",
        :maxlength="field.maxLength",
        class="min-h-11 w-full rounded-control border border-primary bg-surface px-4 py-2.5 placeholder:text-muted focus:shadow-[inset_0_0_0_1px_var(--color-primary)] focus:outline-none",
        @input="validation.clear(field.id)"
      )
      ValidationMessage(
        :id="validation.errorId(field.id)",
        :messages="validation.messages(field.id)"
      )
    div(
      v-for="consent in view.consents",
      :key="consent.id"
    )
      label(class="flex items-start gap-2")
        input(
          v-model="consents[consent.id]",
          v-bind="validation.attrs('consent:' + consent.id)",
          type="checkbox",
          :name="consent.id",
          :required="consent.required",
          class="size-5 shrink-0 accent-primary",
          @change="validation.clear('consent:' + consent.id)"
        )
        span {{ consent.label }}
      ValidationMessage(
        :id="validation.errorId('consent:' + consent.id)",
        :messages="validation.messages('consent:' + consent.id)"
      )
  PageActions(class="flex flex-col gap-4")
    button(
      type="submit",
      class="ui-button w-full rounded-control bg-primary-gradient p-4 text-button text-white shadow-brand disabled:opacity-40",
      :disabled="busy || !view.allowedActions.includes('submit')"
    ) {{ view.copy.submit }}
</template>
