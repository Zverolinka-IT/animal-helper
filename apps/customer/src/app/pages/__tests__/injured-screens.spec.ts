import BaseExpander from '@/libs/components/base-expander.vue'
import BaseIcon from '@/libs/components/base-icon.vue'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import {
  collisionFixture,
  huntingChamberFixture,
  injuredContactFixtures,
  injuredSelfHelpFixtures,
  municipalPoliceFixture,
  selfHelpGameFixture
} from '../fixtures/injured-screens'
import { whoHelpedThankYouFixture } from '../fixtures/thank-you'
import PageInstructions from '../page-instructions.vue'
import PageThankYou from '../page-thank-you.vue'

const global = { components: { BaseIcon, BaseExpander } }

it('renders every new injured contact screen with its heading', async () => {
  const wrapper = mount(PageInstructions, { props: { view: huntingChamberFixture }, global })
  for (const view of injuredContactFixtures) {
    await wrapper.setProps({ view })
    expect(wrapper.get('h1').text()).toBe(view.copy.title)
  }
  await wrapper.setProps({ view: municipalPoliceFixture })
  expect(wrapper.get('a[href="tel:159"]').text()).toBe('159')
  await wrapper.setProps({ view: collisionFixture })
  expect(wrapper.get('a[href="tel:112"]').text()).toBe('112')
  expect(wrapper.text()).toContain('Zviera stále potrebuje pomoc')
})

it('shows the game-species warning and captions on W22b', () => {
  const wrapper = mount(PageInstructions, { props: { view: selfHelpGameFixture }, global })
  expect(wrapper.get('h1').text()).toBe('Pomôžte sami')
  expect(wrapper.text()).toContain('poľovnú zver')
  expect(wrapper.text()).toContain('Kačica divá')
  expect(injuredSelfHelpFixtures.map(view => view.screen)).toEqual(['W22a', 'W22b', 'W22d'])
})

it('asks who helped with one choice on W39a', async () => {
  const wrapper = mount(PageThankYou, { props: { view: whoHelpedThankYouFixture }, global })
  expect(wrapper.get('h1').text()).toBe('Ďakujeme za vašu pomoc')
  expect(wrapper.text()).toContain('Kto pomohol zvieraťu?')
  const radios = wrapper.findAll('input[type="radio"]')
  expect(radios).toHaveLength(whoHelpedThankYouFixture.reasons?.options.length ?? 0)
  await radios[1]!.setValue(true)
  expect((radios[1]!.element as HTMLInputElement).checked).toBe(true)
  expect((radios[0]!.element as HTMLInputElement).checked).toBe(false)
})
