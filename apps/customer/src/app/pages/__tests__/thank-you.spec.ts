import BaseExpander from '@/libs/components/base-expander.vue'
import BaseIcon from '@/libs/components/base-icon.vue'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { completion } from '../../completion'
import type * as FlowClientModule from '../../flow-client'
import { previewSession } from '../../preview-flow'
import {
  helpThankYouFixture,
  thankYouFixture,
  thankYouFixtures,
  unsuccessfulThankYouFixture,
  whoHelpedThankYouFixture
} from '../fixtures/thank-you'
import PageThankYou from '../page-thank-you.vue'
const push = vi.hoisted(() => vi.fn())
const submitReport = vi.hoisted(() => vi.fn<(...args: unknown[]) => boolean | Promise<boolean>>(() => true))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../../flow-client', async importOriginal => {
  const actual = await importOriginal<typeof FlowClientModule>()
  return {
    ...actual,
    flowActions: { ...actual.flowActions, submitReport, requestAnimalHelp: vi.fn(async () => 'W14') }
  }
})

it('freezes the submitted choices while pending and allows corrections after a failure', async () => {
  completion.value = null
  submitReport.mockClear()
  let release!: (value: boolean) => void
  submitReport.mockReturnValueOnce(
    new Promise<boolean>(resolve => {
      release = resolve
    })
  )
  const wrapper = mount(PageThankYou, {
    props: { view: { ...thankYouFixture, validation: { fieldErrors: {} } } },
    global: { components: { BaseIcon, BaseExpander } }
  })
  await wrapper.get('form').trigger('submit')
  expect(wrapper.get('form').attributes('inert')).toBeDefined()
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
  await wrapper.get('form').trigger('submit')
  expect(submitReport).toHaveBeenCalledTimes(1)
  release(false)
  await flushPromises()
  expect(wrapper.get('form').attributes('inert')).toBeUndefined()
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  await wrapper.get('input[type=email]').setValue('corrected@example.org')
  await wrapper.get('form').trigger('submit')
  expect(submitReport).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'corrected@example.org' }))
  completion.value = null
  wrapper.unmount()
})

it('shows response errors and preserves the draft when a new response arrives', async () => {
  completion.value = null
  const wrapper = mount(PageThankYou, {
    props: {
      view: {
        ...thankYouFixture,
        values: { email: 'nespravna-adresa' },
        validation: { fieldErrors: { email: ['Zadajte platnú e-mailovú adresu.'] } }
      }
    },
    global: { components: { BaseIcon, BaseExpander } }
  })
  const email = wrapper.get<HTMLInputElement>('input[type=email]')
  expect(email.attributes('aria-invalid')).toBe('true')
  expect(wrapper.get(`[id="${email.attributes('aria-describedby')}"]`).text()).toContain('Zadajte platnú')
  await wrapper.get('form').trigger('submit')
  expect(completion.value).toBeNull()
  await email.setValue('user@example.org')
  expect(email.attributes('aria-invalid')).toBeUndefined()
  await wrapper.setProps({
    view: { ...thankYouFixture, validation: { fieldErrors: { email: ['Server refused'] } } }
  })
  expect(email.element.value).toBe('user@example.org')
  expect(email.attributes('aria-invalid')).toBe('true')
  await wrapper.get('form').trigger('submit')
  expect(completion.value).toBeNull()
  await email.setValue('corrected@example.org')
  await wrapper.get('form').trigger('submit')
  expect(completion.value).not.toBeNull()
  completion.value = null
  wrapper.unmount()
})

it('renders optional contact fields and opt-ins without submitting or persisting', async () => {
  push.mockClear()
  previewSession.value = { situation: 'test', fromDraft: false, thankYouReturnTarget: 'W22' }
  const wrapper = mount(PageThankYou, {
    props: { view: { ...thankYouFixture, backTarget: 'W22' } },
    global: { components: { BaseIcon, BaseExpander }, stubs: { CompletionAnimation: true } }
  })
  expect(wrapper.findAll('input:not([type=checkbox])')).toHaveLength(3)
  expect(wrapper.findAll('input[required]')).toHaveLength(0)
  expect(wrapper.findAll<HTMLInputElement>('input[type=checkbox]').every(input => !input.element.checked)).toBe(true)
  await wrapper.get('input[type=email]').setValue('')
  await wrapper.get('form').trigger('submit')
  expect(push).not.toHaveBeenCalled()
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
  await wrapper.get('form').trigger('submit')
  expect(completion.value).toEqual({ label: thankYouFixture.completionLabel, target: thankYouFixture.submitTarget })
  completion.value = null
  await flushPromises()
  expect(push).not.toHaveBeenCalled()
  await wrapper.get('input[type=email]').setValue('test@example.org')
  await wrapper.get('input[type=checkbox]').setValue(true)
  await wrapper.get('form').trigger('submit')
  completion.value = null
  await flushPromises()
  expect(previewSession.value).toEqual({ situation: 'test', fromDraft: false, thankYouReturnTarget: 'W22' })
  await wrapper.get('button[type=button]').trigger('click')
  expect(push).toHaveBeenLastCalledWith({ name: 'W22' })
  await wrapper.setProps({ view: { ...thankYouFixture, allowedActions: [] } })
  expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
  previewSession.value = null
})

it('offers multiple reasons and an expandable description only in the failure variant', async () => {
  const wrapper = mount(PageThankYou, {
    props: { view: unsuccessfulThankYouFixture },
    global: { components: { BaseIcon, BaseExpander } }
  })
  expect(wrapper.get('h1').text()).toBe('Ďakujeme za vašu snahu')
  expect(wrapper.findAll('input[type=checkbox]')).toHaveLength(19)
  expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
  await wrapper.get('input[name=other]').setValue(true)
  await wrapper.get('input[name=escaped]').setValue(true)
  expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
  await wrapper.get('textarea').setValue('Testovací dôvod')
  await wrapper.get('input[name=other]').setValue(false)
  expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
  expect(wrapper.get<HTMLInputElement>('input[name=escaped]').element.checked).toBe(true)
})

it('renders all supplied variants and combined blocks without inferring business rules', async () => {
  const wrapper = mount(PageThankYou, {
    props: { view: thankYouFixture },
    global: { components: { BaseIcon, BaseExpander } }
  })
  for (const view of thankYouFixtures) {
    await wrapper.setProps({ view })
    expect(wrapper.get('h1').text()).toBe(view.copy.title)
    const groups = view.reasonGroups ?? (view.reasons ? [view.reasons] : [])
    expect(wrapper.findAll('input[type=checkbox], input[type=radio]')).toHaveLength(
      groups.reduce((sum, group) => sum + group.options.length, 0) + view.consents.length
    )
    expect(wrapper.find('.bg-success-light').exists()).toBe(!!view.help)
  }
  await wrapper.setProps({
    view: { ...helpThankYouFixture, reasons: unsuccessfulThankYouFixture.reasons!, fields: [], consents: [] }
  })
  expect(wrapper.findAll('input:not([type=checkbox])')).toHaveLength(0)
  expect(wrapper.find('.bg-success-light').exists()).toBe(true)
  await wrapper
    .findAll('button')
    .find(button => button.text() === helpThankYouFixture.help!.action.label)!
    .trigger('click')
  expect(push).toHaveBeenLastCalledWith({ name: 'W14' })
})

it('submits the selected helper on the resolved injured report', async () => {
  submitReport.mockClear()
  submitReport.mockReturnValue(true)
  const wrapper = mount(PageThankYou, {
    props: { view: whoHelpedThankYouFixture },
    global: { components: { BaseIcon, BaseExpander } }
  })
  await wrapper.get('input[value=clinic]').setValue(true)
  await wrapper.get('form').trigger('submit')
  expect(submitReport).toHaveBeenLastCalledWith(
    expect.objectContaining({
      outcome: { status: 'resolved', reasons: [] },
      whoHelped: { choice: 'Veterinár / klinika' }
    })
  )
  wrapper.unmount()
})

it('submits selected failure reasons and excludes unchecked Other text', async () => {
  completion.value = null
  submitReport.mockClear()
  submitReport.mockReturnValue(false)
  const wrapper = mount(PageThankYou, {
    props: { view: unsuccessfulThankYouFixture },
    global: { components: { BaseIcon, BaseExpander } }
  })
  await wrapper.get('input[name=escaped]').setValue(true)
  await wrapper.get('input[name=other]').setValue(true)
  await wrapper.get('textarea').setValue('  Synthetic failure  ')
  await wrapper.get('form').trigger('submit')
  expect(submitReport).toHaveBeenLastCalledWith(
    expect.objectContaining({
      outcome: { status: 'unresolved', reasons: ['escaped', 'other'], otherText: 'Synthetic failure' }
    })
  )
  await wrapper.get('input[name=other]').setValue(false)
  await wrapper.get('form').trigger('submit')
  expect(submitReport).toHaveBeenLastCalledWith(
    expect.objectContaining({ outcome: { status: 'unresolved', reasons: ['escaped'] } })
  )
  submitReport.mockReturnValue(true)
  wrapper.unmount()
})
