import { mount } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { beginPreview, previewSession } from '../../preview-flow'
import { animalGroupsFixture } from '../fixtures/animal-groups'
import {
  otherDetailsFixture,
  otherFailedFixture,
  otherSituationFixture,
  roadDetailsFixture
} from '../fixtures/other-situations'
import { previewAccess } from '../fixtures/preview-server'
import PageAnimalDetails from '../page-animal-details.vue'
import PageCrueltyFollowup from '../page-cruelty-followup.vue'
import PageOtherSituation from '../page-other-situation.vue'
import PageRoadDetails from '../page-road-details.vue'
const push = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
beforeEach(() => {
  beginPreview('other')
  push.mockClear()
})
const global = { stubs: { BaseIcon: true, BaseExpander: { template: '<div><slot /></div>' } } }

it('offers only the general situation while the other branches are paused', () => {
  expect(otherSituationFixture.choices).toEqual([{ id: 'other', label: 'Iná situácia', target: 'W03' }])
  const page = mount(PageOtherSituation, { props: { view: otherSituationFixture }, global })
  expect(page.findAll('button').map(button => button.text())).toEqual(['Späť', 'Iná situácia'])
})

it('resets stale data on branch change but preserves same-branch answers', async () => {
  previewSession.value!.otherSituation = 'road'
  previewSession.value!.roadDetails = { road: 'near-highway' }
  const view = {
    ...otherSituationFixture,
    choices: [
      { id: 'road' as const, label: 'Na/pri ceste alebo koľajniciach', target: 'W03' as const },
      {
        id: 'human' as const,
        label: 'Uviazlo alebo ho ohrozuje ľudská činnosť',
        target: 'W03' as const
      },
      ...otherSituationFixture.choices
    ]
  }
  const page = mount(PageOtherSituation, { props: { view }, global })
  await page.findAll('button')[1]!.trigger('click')
  expect(previewSession.value!.roadDetails).toEqual({ road: 'near-highway' })
  await page.findAll('button')[2]!.trigger('click')
  expect(previewSession.value!.otherSituation).toBe('human')
  expect(previewSession.value!.roadDetails).toBeUndefined()
  expect(push).toHaveBeenLastCalledWith({ name: 'W03' })
})

it('keeps road answers and return access after confirming the documentation form', async () => {
  const session = previewSession.value!
  session.otherSituation = 'road'
  session.location = { lat: 48, lng: 17, label: 'A', source: 'fixture' }
  const props = { view: roadDetailsFixture, catalogue: animalGroupsFixture.root }
  const road = mount(PageRoadDetails, { props, global })
  await road.get('input[value=other]').setValue(true)
  await road.get('textarea').setValue('Situácia na ceste')
  await road.get('form').trigger('submit')
  const expected = { road: 'other', 'road:other': 'Situácia na ceste' }
  expect(session.roadDetails).toEqual(expected)
  expect(session.animalDetails).toBeUndefined()
  road.unmount()

  const details = mount(PageAnimalDetails, {
    props: { view: otherDetailsFixture, catalogue: animalGroupsFixture.root },
    global
  })
  await details.get('form').trigger('submit')
  expect(session.animalDetails).toEqual({})
  expect(session.roadDetails).toEqual(expected)
  expect(previewAccess('W37')).toBe(true)
  details.unmount()

  const restored = mount(PageRoadDetails, { props, global })
  expect((restored.get('input[value=other]').element as HTMLInputElement).checked).toBe(true)
  expect((restored.get('textarea').element as HTMLTextAreaElement).value).toBe('Situácia na ceste')
  restored.unmount()
})

it('keeps failure reasons separate from police reporting and omits unchecked Other text', async () => {
  previewSession.value!.crueltyReport = { outcome: 'reported', reasons: [] }
  const page = mount(PageCrueltyFollowup, { props: { view: otherFailedFixture }, global })
  const other = page.get('input[value=other]')
  await other.setValue(true)
  await page.get('textarea').setValue('  Ukážkový dôvod  ')
  expect(previewSession.value!.otherReport).toEqual({ reasons: ['other'], description: 'Ukážkový dôvod' })
  await other.setValue(false)
  expect(previewSession.value!.otherReport).toEqual({ reasons: [] })
  expect(previewSession.value!.crueltyReport).toEqual({ outcome: 'reported', reasons: [] })
  await page.get('footer button').trigger('click')
  expect(previewSession.value!.documentingOther).toBe(true)
  expect(push).toHaveBeenLastCalledWith({ name: 'W04' })
})
