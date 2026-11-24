import BaseExpander from '@/libs/components/base-expander.vue'
import BaseIcon from '@/libs/components/base-icon.vue'
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { beginPreview, previewSession } from '../../preview-flow'
import { animalDetailsFixture } from '../fixtures/animal-details'
import { animalGroupsFixture } from '../fixtures/animal-groups'
import { detailsValidationFixture } from '../fixtures/validation-preview'
import PageAnimalDetails from '../page-animal-details.vue'
const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
afterEach(() => {
  previewSession.value = null
  push.mockClear()
})
function setup(view = structuredClone(animalDetailsFixture)) {
  beginPreview('injured')
  previewSession.value!.animalIdentification = {
    kind: 'species',
    speciesId: 'domestic_cat',
    path: ['domestic']
  }
  return mount(PageAnimalDetails, {
    props: { view, catalogue: animalGroupsFixture.root },
    global: { components: { BaseIcon, BaseExpander } }
  })
}
it('renders independent group and description errors without discarding answers', async () => {
  const wrapper = setup(detailsValidationFixture)
  expect(wrapper.get('textarea').attributes('aria-invalid')).toBe('true')
  await wrapper.get('form').trigger('submit')
  expect(push).not.toHaveBeenCalled()
  await wrapper.get('textarea').setValue('Podrobnejší opis poranenia')
  expect(wrapper.get('textarea').attributes('aria-invalid')).toBeUndefined()
  expect(wrapper.get('input[name=conscious]').attributes('aria-invalid')).toBe('true')
  await wrapper.get('input[name=conscious][value=no]').setValue()
  expect(previewSession.value!.animalDetails!['symptoms:other']).toBe('Podrobnejší opis poranenia')
  await wrapper.get('form').trigger('submit')
  expect(push).toHaveBeenCalledWith({ name: 'W14' })
  wrapper.unmount()
})
it('allows unanswered details and makes unknown exclusive', async () => {
  const wrapper = setup()
  expect(wrapper.text()).toContain('Mačka')
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  await wrapper.get('input[value=bleeding]').setValue(true)
  await wrapper.get('input[name=symptoms][value=unknown]').setValue(true)
  expect(previewSession.value!.animalDetails!.symptoms).toEqual(['unknown'])
  await wrapper.get('input[value=other]').setValue(true)
  expect(previewSession.value!.animalDetails!.symptoms).toEqual(['other'])
  await wrapper.get('textarea').setValue('Opis')
  await wrapper.get('input[name=conscious][value=yes]').setValue()
  await wrapper.get('input[name=juvenile][value=no]').setValue()
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  await wrapper.get('form').trigger('submit')
  expect(previewSession.value!.adviceReady).toBe(true)
  expect(push).toHaveBeenCalledWith({ name: 'W14' })
  await wrapper.get('input[value=other]').setValue(false)
  expect(previewSession.value!.animalDetails!['symptoms:other']).toBeUndefined()
})
it('supports text-only and empty server-shaped forms', async () => {
  const view = structuredClone(animalDetailsFixture)
  view.values = { notes: 'Prefilled by fixture' }
  view.questions = [
    { id: 'notes', label: 'Server label', kind: 'text', placeholder: 'Server placeholder', required: true, options: [] }
  ]
  const wrapper = setup(view)
  expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Prefilled by fixture')
  expect(wrapper.findAll('input')).toHaveLength(0)
  await wrapper.get('textarea').setValue('   ')
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeDefined()
  await wrapper.get('textarea').setValue('Something')
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  await wrapper.setProps({ view: { ...view, questions: [] } })
  expect(wrapper.findAll('fieldset')).toHaveLength(0)
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
})
it('reconciles changed schemas but does not reset drafts for validation-only responses', async () => {
  const wrapper = setup(detailsValidationFixture)
  await wrapper.get('textarea').setValue('User draft')
  const view = {
    ...detailsValidationFixture,
    validation: {},
    questions: [
      detailsValidationFixture.questions[0]!,
      { id: 'notes', kind: 'text' as const, label: 'Notes', required: true, options: [] }
    ],
    values: { notes: 'New default', symptoms: ['bleeding'], 'symptoms:other': 'Do not replace draft' }
  }
  await wrapper.setProps({ view })
  expect(wrapper.get('textarea[aria-label=Notes]').element).toHaveProperty('value', 'New default')
  expect(previewSession.value!.animalDetails).toEqual({
    symptoms: ['other'],
    'symptoms:other': 'User draft',
    notes: 'New default'
  })
  await wrapper.setProps({ view: { ...view, validation: { fieldErrors: { notes: ['Fix it'] } } } })
  expect(wrapper.get('textarea[aria-label=Notes]').element).toHaveProperty('value', 'New default')
  await wrapper.setProps({
    view: { ...view, questions: [{ ...view.questions[0]!, options: [{ id: 'bleeding', label: 'Bleeding' }] }] }
  })
  expect(previewSession.value!.animalDetails).toEqual({ symptoms: [] })
  await wrapper.get('input[value=bleeding]').setValue(true)
  await wrapper.get('form').trigger('submit')
  expect(previewSession.value!.animalDetails).toEqual({ symptoms: ['bleeding'] })
  wrapper.unmount()
})
it('replaces the form with manual recovery after a simulated failure', async () => {
  const wrapper = setup()
  previewSession.value!.identificationFailed = true
  await wrapper.vm.$nextTick()
  expect(wrapper.find('form').exists()).toBe(false)
  expect(wrapper.text()).not.toContain(animalDetailsFixture.copy.failedPreview)
  await wrapper
    .findAll('button')
    .find(button => button.text() === animalDetailsFixture.copy.manual)!
    .trigger('click')
  expect(push).toHaveBeenCalledWith({ name: 'W06' })
})

it('accepts disabled questions and options without changing prefilled answers', async () => {
  const view = structuredClone(animalDetailsFixture)
  view.questions = [
    { id: 'locked', label: 'Locked', kind: 'text', required: true, disabled: true, options: [] },
    {
      id: 'choice',
      label: 'Choice',
      kind: 'single',
      required: true,
      options: [
        { id: 'locked-option', label: 'Locked option', disabled: true, description: 'Details' },
        { id: 'enabled', label: 'Enabled' }
      ]
    }
  ]
  view.values = { choice: 'locked-option', 'choice:locked-option': 'Existing detail' }
  const wrapper = setup(view)
  expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined()
  expect(wrapper.get('input[value=locked-option]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('textarea[aria-label=Details]').attributes('disabled')).toBeDefined()
  expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
  await wrapper.get('form').trigger('submit')
  expect(previewSession.value!.animalDetails!.choice).toBe('locked-option')
  await wrapper.get('input[value=enabled]').setValue()
  expect(previewSession.value!.animalDetails!.choice).toBe('enabled')
})
