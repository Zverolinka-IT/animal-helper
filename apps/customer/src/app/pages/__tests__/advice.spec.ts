import BaseIcon from '@/libs/components/base-icon.vue'
import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { adviceFixture, warningsOnlyFixture } from '../fixtures/advice'
import PageAdvice from '../page-advice.vue'
const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

it('renders red-only and combined variants from ordered data', async () => {
  const wrapper = mount(PageAdvice, { props: { view: warningsOnlyFixture }, global: { components: { BaseIcon } } })
  expect(wrapper.findAll('section')).toHaveLength(1)
  expect(wrapper.find('.customer-advice__do').exists()).toBe(false)
  await wrapper.setProps({ view: adviceFixture })
  expect(wrapper.findAll('section')).toHaveLength(2)
  expect(wrapper.findAll('li')).toHaveLength(4)
  const view = structuredClone(adviceFixture)
  view.locale = 'en'
  view.blocks = [
    { id: 'custom', kind: 'do', title: 'Server title', items: [{ id: 'one', title: 'Server instruction' }] }
  ]
  await wrapper.setProps({ view })
  expect(wrapper.attributes('lang')).toBe('en')
  expect(wrapper.get('h2').text()).toBe('Server title')
  expect(wrapper.get('li').text()).toContain('Server instruction')
  expect(wrapper.get('li').find('p').exists()).toBe(false)
  await wrapper
    .findAll('button')
    .find(button => button.text() === view.copy.acknowledge)!
    .trigger('click')
  await flushPromises()
  expect(push).toHaveBeenCalledWith({ name: view.confirmTarget })
  await wrapper
    .findAll('button')
    .find(button => button.text() === view.copy.back)!
    .trigger('click')
  expect(push).toHaveBeenCalledWith({ name: 'W09' })
  await wrapper.setProps({ view: { ...view, allowedActions: [] } })
  expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
})
