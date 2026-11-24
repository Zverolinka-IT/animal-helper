import BaseExpander from '@/libs/components/base-expander.vue'
import BaseIcon from '@/libs/components/base-icon.vue'
import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { beginPreview, previewSession } from '../../preview-flow'
import type { AnimalBranch, AnimalNode } from '../fixtures/animal-groups'
import { animalGroupsFixture } from '../fixtures/animal-groups'
import PageAnimalGroups from '../page-animal-groups.vue'

const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
afterEach(() => {
  previewSession.value = null
  push.mockClear()
})

it('provides a nonempty catalogue tree with unique IDs and different branch depths', () => {
  expect(animalGroupsFixture.root.children.map(node => node.id)).toEqual(['domestic', 'farm', 'wildlife', 'exotic'])
  const ids = new Set<string>()
  const depths = new Set<number>()
  const branchSizes: number[] = []
  const visit = (node: AnimalNode, depth: number) => {
    expect(ids.has(node.id)).toBe(false)
    ids.add(node.id)
    if (node.kind === 'branch') {
      branchSizes.push(node.children.length)
      node.children.forEach(child => visit(child, depth + 1))
    } else if (node.kind === 'animal') depths.add(depth)
  }
  visit(animalGroupsFixture.root, 0)
  expect(Math.min(...branchSizes)).toBeGreaterThan(0)
  expect([...depths].sort()).toEqual([2, 3, 4])
})

it('traverses an arbitrarily deep tree and search opens the same leaf parent', async () => {
  beginPreview('injured')
  const location = { label: 'Test', lat: 48, lng: 17, source: 'fixture' as const }
  const photo = new File(['test'], 'animal.png', { type: 'image/png' })
  previewSession.value!.location = location
  previewSession.value!.media = [photo]
  const view = structuredClone(animalGroupsFixture)
  let tree: AnimalBranch = {
    ...view.root,
    id: 'deepest',
    label: 'Deepest',
    children: [{ kind: 'animal', id: 'target', label: 'Test animal', detail: 'Deep tree' }]
  }
  for (let depth = 4; depth >= 1; depth--) {
    tree = { ...view.root, id: `branch-${depth}`, label: `Branch ${depth}`, children: [tree] }
  }
  view.root.children = [tree]
  const wrapper = mount(PageAnimalGroups, { props: { view }, global: { components: { BaseIcon, BaseExpander } } })
  const click = async (label: string) => {
    await wrapper
      .findAll('button')
      .find(item => item.text() === label || item.attributes('aria-label') === label)!
      .trigger('click')
  }
  for (let depth = 1; depth <= 4; depth++) {
    await click(`Branch ${depth}`)
    expect(wrapper.get('h1').text()).toBe(view.props.title)
    expect(wrapper.get('.customer-animal-groups__actions > button').attributes('disabled')).toBeDefined()
  }
  await click('Deepest')
  expect(wrapper.find('input[value="unknown"]').exists()).toBe(true)
  expect(wrapper.find('input[value="other"]').exists()).toBe(true)
  await click('Test animal')
  await click('Potvrdiť voľbu')
  const expectedPath = ['branch-1', 'branch-2', 'branch-3', 'branch-4', 'deepest']
  expect(previewSession.value?.animalIdentification?.path).toEqual(expectedPath)
  await click('Začať výber odznova')
  expect(previewSession.value?.location).toEqual(location)
  expect(previewSession.value?.media).toEqual([photo])
  expect(previewSession.value?.animalIdentification?.path).toEqual(expectedPath)
  expect(previewSession.value?.animalIdentification?.path[0]).toBe('branch-1')
  expect(previewSession.value?.animalIdentification?.speciesId).toBe('target')
  const search = wrapper.get('input[role="combobox"]')
  await search.setValue('Branch')
  await search.trigger('focus')
  expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
  await search.setValue('Test')
  await wrapper.get('[role="option"]').trigger('click')
  expect((search.element as HTMLInputElement).value).toBe('')
  expect(previewSession.value?.animalIdentification?.path).toEqual(expectedPath)
  expect(wrapper.get('.customer-animal-groups__grid button').attributes('aria-pressed')).toBe('true')
  await click('Začať výber odznova')
  expect(wrapper.get('.customer-animal-groups__grid button').text()).toBe('Branch 1')
  await click('Späť')
  expect(push).toHaveBeenCalledWith({ name: 'W04' })
})

it('preserves confirmed identification and advice while an edit is reset, searched and abandoned', async () => {
  beginPreview('injured')
  Object.assign(previewSession.value!, {
    animalIdentification: {
      kind: 'species',
      path: ['domestic'],
      speciesId: 'domestic_cat'
    },
    adviceReady: true
  })
  const saved = JSON.parse(JSON.stringify(previewSession.value))
  const wrapper = mount(PageAnimalGroups, {
    props: { view: animalGroupsFixture },
    global: { components: { BaseIcon, BaseExpander } }
  })
  await wrapper.get('button[aria-label="Začať výber odznova"]').trigger('click')
  await wrapper
    .findAll('.customer-animal-groups__grid button')
    .find(button => button.text() === 'Hospodárske zvieratá')!
    .trigger('click')
  const search = wrapper.get('input[role="combobox"]')
  await search.setValue('fretka')
  await search.trigger('focus')
  await wrapper.get('[role="option"]').trigger('click')
  expect(previewSession.value).toEqual(saved)
  await wrapper
    .findAll('button')
    .find(button => button.text() === 'Späť')!
    .trigger('click')
  wrapper.unmount()
  expect(previewSession.value).toEqual(saved)
})

it('renders supplied labels and groups rather than a built-in catalogue', async () => {
  beginPreview('injured')
  const view = structuredClone(animalGroupsFixture)
  view.locale = 'en'
  view.props.title = 'Choose an animal group'
  view.root.children = [{ ...view.root, id: 'server-group', label: 'Example group', children: [] }]
  const wrapper = mount(PageAnimalGroups, { props: { view }, global: { components: { BaseIcon, BaseExpander } } })
  expect(wrapper.get('h1').text()).toBe(view.props.title)
  expect(wrapper.attributes('lang')).toBe('en')
  expect(wrapper.findAll('.customer-animal-groups__grid button')).toHaveLength(1)
  await wrapper.get('.customer-animal-groups__grid button').trigger('click')
  expect(previewSession.value?.animalIdentification?.path[0]).toBeUndefined()
  await wrapper
    .findAll('button')
    .find(item => item.attributes('aria-label') === 'Začať výber odznova')!
    .trigger('click')
  view.allowedActions = ['back']
  await wrapper.setProps({ view: { ...view } })
  expect(wrapper.get('.customer-animal-groups__grid button').attributes('disabled')).toBeDefined()
})

it('keeps alternatives in the page and confirmation available on every branch', async () => {
  beginPreview('injured')
  const wrapper = mount(PageAnimalGroups, {
    props: { view: animalGroupsFixture },
    global: { components: { BaseIcon, BaseExpander } }
  })
  const click = async (label: string) => {
    await wrapper
      .findAll('button')
      .find(item => item.text() === label || item.attributes('aria-label') === label)!
      .trigger('click')
  }
  const confirmButton = () => wrapper.get('.customer-animal-groups__actions > button')
  expect(confirmButton().text()).toBe('Potvrdiť voľbu')
  expect(confirmButton().attributes('disabled')).toBeDefined()
  expect(wrapper.findAll('.customer-animal-groups__alternatives input[type="radio"]')).toHaveLength(2)
  await wrapper.get('input[value="unknown"]').setValue()
  expect(previewSession.value?.animalIdentification).toBeUndefined()
  await click('Potvrdiť voľbu')
  expect(previewSession.value?.animalIdentification).toEqual({ kind: 'unknown', path: [] })
  await click('Hospodárske zvieratá')
  expect(confirmButton().attributes('disabled')).toBeDefined()
  expect(previewSession.value?.animalIdentification).toEqual({ kind: 'unknown', path: [] })
  await wrapper.get('input[value="unknown"]').setValue()
  await click('Potvrdiť voľbu')
  expect(previewSession.value?.animalIdentification).toEqual({
    kind: 'unknown',
    path: ['farm']
  })
  await click('Začať výber odznova')
  await click('Domáce zvieratá')
  expect(wrapper.text()).toContain('Iné domáce zviera')
  expect(confirmButton().attributes('disabled')).toBeDefined()
  await click('Mačka')
  expect(confirmButton().attributes('disabled')).toBeUndefined()
  await wrapper.get('input[value="other"]').setValue()
  expect(wrapper.get('.customer-animal-groups__grid button').attributes('aria-pressed')).toBe('false')
  await click('Potvrdiť voľbu')
  expect(confirmButton().attributes('disabled')).toBeDefined()
  expect(previewSession.value?.animalIdentification?.path).toEqual(['farm'])
  await wrapper.get('textarea').setValue('   ')
  expect(confirmButton().attributes('disabled')).toBeDefined()
  await wrapper.get('textarea').setValue('Iná mačka')
  await click('Potvrdiť voľbu')
  expect(previewSession.value?.animalIdentification?.description).toBe('Iná mačka')
  await wrapper.get('input[value="unknown"]').setValue()
  expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
  expect(wrapper.get('.customer-animal-groups__description').attributes('aria-hidden')).toBe('true')
  await click('Potvrdiť voľbu')
  expect(previewSession.value?.animalIdentification).toEqual({
    kind: 'unknown',
    path: ['domestic']
  })
  expect(previewSession.value?.animalIdentification?.path).toEqual(['domestic'])
  expect(previewSession.value?.animalIdentification?.speciesId).toBeUndefined()
  await click('Mačka')
  expect((wrapper.get('input[value="unknown"]').element as HTMLInputElement).checked).toBe(false)
  await click('Potvrdiť voľbu')
  expect(previewSession.value?.animalIdentification?.speciesId).toBe('domestic_cat')
  await click('Začať výber odznova')
  await wrapper.get('input[value="other"]').setValue()
  await wrapper.get('textarea').setValue('  Neznáme exotické zviera  ')
  await click('Potvrdiť voľbu')
  expect(previewSession.value?.animalIdentification).toEqual({
    kind: 'other',
    path: [],
    description: 'Neznáme exotické zviera'
  })
})
