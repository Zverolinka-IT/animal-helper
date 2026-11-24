import BaseIcon from '@/libs/components/base-icon.vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { homeFixture } from '../fixtures/home'
import PageHome from '../page-home.vue'

describe('fixture-driven homepage', () => {
  it('renders supplied copy and choices without client translation', () => {
    const view = structuredClone(homeFixture)
    view.locale = 'en'
    view.props.title = 'What happened?'
    view.props.situations = [view.props.situations[0]!]
    const wrapper = mount(PageHome, { props: { view }, global: { components: { BaseIcon } } })
    expect(wrapper.get('h1').text()).toBe('What happened?')
    expect(wrapper.attributes('lang')).toBe('en')
    expect(wrapper.findAll('.customer-home__choice')).toHaveLength(1)
  })
  it('emits only permitted actions and never implies a submitted report', async () => {
    expect(homeFixture.props.situations.map(item => item.id)).toEqual(['injured', 'stray', 'cruelty', 'other'])
    expect(homeFixture.allowedActions).not.toContain('start-dead')
    const view = structuredClone(homeFixture)
    view.allowedActions = ['start-injured']
    const wrapper = mount(PageHome, { props: { view }, global: { components: { BaseIcon } } })
    const choices = wrapper.findAll('.customer-home__choice')
    expect(choices[1]!.attributes('disabled')).toBeDefined()
    await choices[0]!.trigger('click')
    expect(wrapper.emitted('action')).toEqual([['start-injured']])
    expect(wrapper.get('[role="status"]').text()).toBe(view.props.actionNotice)
    await choices[1]!.trigger('click')
    expect(wrapper.emitted('action')).toHaveLength(1)
  })
})
