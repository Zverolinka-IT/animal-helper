import { afterEach, expect, it, vi } from 'vitest'
import {
  flowActions,
  previewDetailsView,
  previewLocationView,
  previewMediaView,
  previewThankYouView
} from '../flow-client'
import { policeResultFixture } from '../pages/fixtures/cruelty-followup'
import { fixtureFlowActions } from '../pages/fixtures/flow-actions'
import { homeFixture } from '../pages/fixtures/home'
import { otherFailedFixture, otherSituationFixture } from '../pages/fixtures/other-situations'
import { thankYouFixture } from '../pages/fixtures/thank-you'
import { beginPreview, finishPreview, previewSession } from '../preview-flow'

afterEach(() => {
  finishPreview()
  vi.useRealTimers()
})

it.each([
  ['injured', undefined, 'W04', 'W14'],
  ['stray', undefined, 'W04', 'W14'],
  ['dead', undefined, 'W04', 'W14'],
  ['cruelty', undefined, 'W04', 'W39'],
  ['other', 'road', 'W33', 'W39'],
  ['other', 'human', 'W04', 'W14'],
  ['other', 'other', 'W04', 'W39']
] as const)('selects the fixture flow for %s / %s', (situation, branch, locationTarget, detailsTarget) => {
  beginPreview(situation)
  if (branch) previewSession.value!.otherSituation = branch
  expect(previewLocationView().confirmTarget).toBe(locationTarget)
  expect(previewDetailsView().confirmTarget).toBe(detailsTarget)
})

it('only starts actions exposed by the home payload', async () => {
  expect(await flowActions.start({ ...homeFixture, allowedActions: [] }, 'start-injured')).toBeUndefined()
  expect(previewSession.value).toBeNull()
  expect(fixtureFlowActions.start(homeFixture, 'start-cruelty')).toBe('W27')
  expect(previewSession.value?.situation).toBe('cruelty')
})

it('keeps road documentation and the thanks return target in the fixture provider', async () => {
  expect(otherSituationFixture.choices.map(choice => choice.id)).toEqual(['other'])
  expect(flowActions.chooseSituation({ id: 'road', label: 'Na/pri ceste', target: 'W03' })).toBe('W03')
  expect(flowActions.followup(otherFailedFixture, otherFailedFixture.actions[0]!)).toBe('W04')
  expect(previewMediaView().backTarget).toBe('W37')
  expect(await flowActions.details({}, 'animalDetails', 'W39')).toBe('W39')
  expect(previewThankYouView(thankYouFixture).backTarget).toBe('W09')
})

it('rejects an action not supplied by the follow-up payload', () => {
  beginPreview('cruelty')
  const action = policeResultFixture.actions[0]!
  expect(flowActions.followup({ ...policeResultFixture, actions: [] }, action)).toBeUndefined()
  expect(previewSession.value?.crueltyReport).toBeUndefined()
  expect(flowActions.followup(policeResultFixture, action)).toBe(action.target)
  expect(previewSession.value?.crueltyReport?.outcome).toBe('reported')
})

it('simulates media failure without a component deciding the outcome', async () => {
  vi.useFakeTimers()
  beginPreview('injured')
  const result = flowActions.processMedia(20, 'W09', new AbortController().signal)
  await vi.advanceTimersByTimeAsync(20)
  expect(await result).toBe('W09')
  expect(previewSession.value?.identificationFailed).toBe(true)
})

it.each(['abort', 'new-session'] as const)('ignores a media result after %s', async reason => {
  vi.useFakeTimers()
  beginPreview('injured')
  const controller = new AbortController()
  const result = flowActions.processMedia(20, 'W09', controller.signal)
  if (reason === 'abort') controller.abort()
  else beginPreview('stray')
  await vi.advanceTimersByTimeAsync(20)
  expect(await result).toBeUndefined()
  expect(previewSession.value?.identificationFailed).toBeUndefined()
})

it('uses distinct optional questions for stray, dead, acute cruelty and general Other', () => {
  beginPreview('stray')
  expect(previewDetailsView().questions.map(question => question.id)).toEqual(['behaviour', 'collar', 'juvenile'])
  beginPreview('dead')
  expect(previewDetailsView().questions.map(question => question.id)).toEqual(['suspiciousSigns', 'animalCount'])
  expect(previewDetailsView().questions.every(question => !question.required)).toBe(true)
  beginPreview('cruelty')
  expect(previewDetailsView().questions[0]?.options.some(option => option.id === 'conditions')).toBe(true)
  previewSession.value!.crueltyReport = { outcome: 'not-reported', reasons: [] }
  expect(previewDetailsView().questions[0]?.options.map(option => option.id)).toEqual([
    'burned',
    'beaten',
    'poisoned',
    'unknown'
  ])
  expect(previewDetailsView().questions.map(question => question.id)).toEqual(['cruelty', 'description'])
  beginPreview('other')
  previewSession.value!.otherSituation = 'other'
  expect(previewDetailsView().questions[0]?.id).toBe('description')
  previewSession.value!.otherSituation = 'road'
  expect(previewDetailsView().questions).toEqual([])
})

it('only offers failure reasons for visited services and appropriate sharing consent', async () => {
  const { unsuccessfulThankYouFixture } = await import('../pages/fixtures/thank-you')
  beginPreview('injured')
  previewSession.value!.visitedHelp = ['volunteers', 'vet_exotic']
  const failed = previewThankYouView(unsuccessfulThankYouFixture)
  const ids = failed.reasons!.options.map(option => option.id)
  expect(ids).toContain('clinic-closed')
  expect(ids).toContain('volunteers')
  expect(ids).toContain('other')
  expect(ids).not.toContain('municipality-refused')
  expect(ids).not.toContain('police-refused')
  expect(ids).not.toContain('equipment')
  expect(failed.consents.map(consent => consent.id)).toContain('share-contact')
  const success = previewThankYouView(thankYouFixture)
  expect(success.consents.map(consent => consent.id)).toEqual(['newsletter'])
  expect(success.values?.email).toBeUndefined()
  expect(success.reasons).toBeUndefined()
  expect(success.reasonGroups).toBeUndefined()
  expect(success.help).toBeUndefined()
  // Reaching completion without choosing an outcome does not claim that help succeeded.
  expect(success.outcome).toBeUndefined()
  previewSession.value!.completionOutcome = 'resolved'
  expect(previewThankYouView(thankYouFixture).outcome).toBe('resolved')
})
