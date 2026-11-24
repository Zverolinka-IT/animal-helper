import { createCaseSession, createMemoryCaseStore, type ApiTransport, type CaseStore } from '@animal-helper/client'
import { bundledPublicGuidance, type PublicGuidance } from '@animal-helper/guidance'
import { afterEach, expect, it } from 'vitest'
import { homeFixture } from '../../pages/fixtures/home'
import { suspendedPreview } from '../../pages/fixtures/preview-session'
import { finishPreview, previewSession } from '../../preview-flow'
import { createWalkActions } from '../adapter'
import type { WalkCheckpoint } from '../checkpoint'

afterEach(() => {
  finishPreview()
})

function memoryCheckpoint() {
  let value: WalkCheckpoint | undefined
  return {
    async load() {
      return value
    },
    async save(next: WalkCheckpoint) {
      value = next
    },
    async clear() {
      value = undefined
    }
  }
}

function harness(
  transport?: ApiTransport,
  store?: CaseStore,
  checkpoint = memoryCheckpoint(),
  guidance?: PublicGuidance
) {
  const commands: { type: string; kind?: string; privatePayload?: unknown }[] = []
  const failures: string[] = []
  const caseStore = store ?? createMemoryCaseStore()
  const sessionTransport: ApiTransport = transport ?? {
    async sendCommand({ command }) {
      commands.push({
        type: command.type,
        ...('kind' in command ? { kind: command.kind, privatePayload: command.privatePayload } : {})
      })
      return {
        status: 200,
        body: {
          ok: true,
          value: {
            outcome: 'applied',
            committedVersion: command.expectedVersion + 1,
            publicState: command.type === 'submit_draft' ? 'received' : 'draft'
          }
        }
      }
    },
    async getStatus() {
      return { status: 404, body: undefined }
    }
  }
  const actions = createWalkActions({
    session: createCaseSession({ store: caseStore, transport: sessionTransport }),
    guidance: async () => guidance ?? bundledPublicGuidance(),
    checkpoint,
    reportFailure: error => {
      failures.push(error.code)
    }
  })
  return { actions, commands, failures, caseStore, checkpoint }
}

const place = { label: 'Dolné Orešany', lat: 48.433, lng: 17.43, source: 'fixture' as const }

it('persists an injured walk and takes the next screen from the walk view', async () => {
  const { actions, commands } = harness()
  expect(await actions.start(homeFixture, 'start-injured')).toBe('W03')
  expect(commands.map(command => command.type)).toEqual(['create_draft'])
  expect(actions.status().publicState).toBe('draft')

  expect(await actions.location(place, 'W99')).toBe('W04')
  expect(commands[1]).toMatchObject({
    kind: 'location',
    privatePayload: {
      address: 'Dolné Orešany',
      coordinates: { latitude: 48.433, longitude: 17.43 }
    }
  })

  actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: ['domestic'] }, 'W09')
  expect(
    await actions.details(
      {
        symptoms: ['bleeding', 'limping', 'other'],
        'symptoms:other': 'Poranená labka',
        conscious: 'yes',
        juvenile: 'no'
      },
      'animalDetails',
      'W99'
    )
  ).toBe('W14')
  expect(commands[2]).toMatchObject({
    kind: 'form_snapshot',
    privatePayload: {
      situationType: 'injured',
      species: { source: 'manual', kindKey: 'domestic_cat', groupKey: 'domestic' },
      condition: {
        symptoms: ['bleeding', 'limping', 'other'],
        otherText: 'Poranená labka',
        conscious: 'yes',
        isJuvenile: 'no'
      }
    }
  })

  expect(
    await actions.submitReport({
      name: 'Test',
      email: 'test@example.org',
      shareWithAuthorities: true,
      newsletter: false,
      outcome: { status: 'resolved', reasons: [] },
      whoHelped: { choice: 'Veterinár / klinika' }
    })
  ).toBe(true)
  expect(commands.at(-3)).toMatchObject({
    kind: 'form_snapshot',
    privatePayload: {
      outcome: { status: 'resolved', reasons: [] },
      whoHelped: { choice: 'Veterinár / klinika' }
    }
  })
  expect(commands.at(-2)).toMatchObject({
    kind: 'contact',
    privatePayload: { name: 'Test', email: 'test@example.org', shareWithAuthorities: true, newsletter: false }
  })
  expect(commands.at(-1)?.type).toBe('submit_draft')
  expect(actions.status().hasDraft).toBe(false)
})

it('explains unavailable stray guidance before accepting the report', async () => {
  const { actions } = harness()
  await actions.start(homeFixture, 'start-stray')
  await actions.location(place, 'W04')
  expect(await actions.details({}, 'animalDetails', 'W14')).toBe('W14')
})

it('persists optional stray details and the final outcome without discarding either', async () => {
  const { actions, commands } = harness()
  await actions.start(homeFixture, 'start-stray')
  await actions.location(place, 'W04')
  await actions.details({ behaviour: ['confused', 'other'], collar: 'no', juvenile: 'yes' }, 'animalDetails', 'W14')
  expect(
    await actions.submitReport({
      shareWithAuthorities: false,
      newsletter: false,
      outcome: { status: 'unresolved', reasons: ['escaped', 'other'], otherText: 'Synthetic reason' }
    })
  ).toBe(true)
  expect(commands.at(-3)).toMatchObject({
    kind: 'form_snapshot',
    privatePayload: {
      situationType: 'stray',
      condition: { symptoms: [], behaviour: ['confused', 'other'], collar: 'no', isJuvenile: 'yes' },
      outcome: { status: 'unresolved', reasons: ['escaped', 'other'], otherText: 'Synthetic reason' }
    }
  })
})

it('uses corrected contact and consent choices after a failed submission and reload', async () => {
  const contacts: unknown[] = []
  let fail = true
  const transport: ApiTransport = {
    async sendCommand({ command }) {
      if (command.type === 'submit_draft' && fail) {
        fail = false
        throw new Error('offline')
      }
      if (command.type === 'attach_private_data' && command.kind === 'contact') contacts.push(command.privatePayload)
      return {
        status: 200,
        body: {
          ok: true,
          value: {
            outcome: 'applied',
            committedVersion: command.expectedVersion + 1,
            publicState: command.type === 'submit_draft' ? 'received' : 'draft'
          }
        }
      }
    },
    async getStatus() {
      return { status: 404, body: undefined }
    }
  }
  const started = harness(transport)
  await started.actions.start(homeFixture, 'start-injured')
  await started.actions.location(place, 'W04')
  await started.actions.details({ symptoms: ['unknown'] }, 'animalDetails', 'W14')
  expect(
    await started.actions.submitReport({ email: 'first@example.org', shareWithAuthorities: true, newsletter: true })
  ).toBe(false)
  const restored = harness(transport, started.caseStore, started.checkpoint)
  await restored.actions.restore()
  expect(
    await restored.actions.submitReport({
      email: 'corrected@example.org',
      shareWithAuthorities: false,
      newsletter: false
    })
  ).toBe(true)
  expect(contacts).toEqual([
    { schemaVersion: 1, email: 'first@example.org', shareWithAuthorities: true, newsletter: true },
    { schemaVersion: 1, email: 'corrected@example.org', shareWithAuthorities: false, newsletter: false }
  ])
})

it('submits cruelty as a real report with private details', async () => {
  const { actions, commands, failures } = harness()
  expect(await actions.start(homeFixture, 'start-cruelty')).toBe('W27')
  expect(commands[0]?.type).toBe('create_draft')
  await actions.location(place, 'W04')
  expect(await actions.details({ cruelty: ['beaten'], description: 'Synthetic cruelty' }, 'animalDetails', 'W39')).toBe(
    'W39'
  )
  expect(await actions.submitReport({ shareWithAuthorities: true, newsletter: false })).toBe(true)
  expect(commands.at(-3)).toMatchObject({
    privatePayload: {
      situationType: 'cruelty',
      cruelty: { acute: false, signs: ['beaten'], description: 'Synthetic cruelty' }
    }
  })
  expect(failures).toEqual([])
})

it('reopens the same case id and walk step from the saved checkpoint', async () => {
  const checkpoint = memoryCheckpoint()
  const started = harness(undefined, createMemoryCaseStore(), checkpoint)
  await started.actions.start(homeFixture, 'start-injured')
  expect(await started.actions.location(place, 'W99')).toBe('W04')

  const reloaded = harness(undefined, started.caseStore, checkpoint)
  await reloaded.actions.restore()
  expect(reloaded.actions.status().hasDraft).toBe(true)
  expect(reloaded.actions.status().hasLocation).toBe(true)
  expect(suspendedPreview.value?.screen).toBe('W04')
  expect(await reloaded.actions.location({ ...place, label: 'Iná ulica' }, 'W99')).toBe('W04')
  expect(reloaded.commands[0]).toMatchObject({ kind: 'location' })
})

it('stays on the current screen when the server rejects the draft', async () => {
  const rejected: ApiTransport = {
    async sendCommand() {
      return { status: 400, body: { ok: false, error: { code: 'INVALID_REQUEST' } } }
    },
    async getStatus() {
      return { status: 404, body: undefined }
    }
  }
  const { actions, failures } = harness(rejected)
  expect(await actions.start(homeFixture, 'start-injured')).toBeUndefined()
  expect(failures).toEqual(['API'])
  expect(actions.status().hasDraft).toBe(false)
})

it('renders published species copy and follows the resolver beyond the first advice page', async () => {
  const guidance = structuredClone(bundledPublicGuidance())
  const cat = guidance.kinds.domestic_cat
  if (!cat) throw new Error('missing synthetic kind')
  guidance.kinds = {
    ...guidance.kinds,
    domestic_cat: {
      items: cat.items.map(item =>
        item.instructionKey === 'warning.do_not'
          ? { ...item, slots: { 'warning.do_not': 'Synthetic published warning.' } }
          : item
      )
    }
  }
  const { actions } = harness(undefined, undefined, memoryCheckpoint(), guidance)
  await actions.start(homeFixture, 'start-injured')
  await actions.location(place, 'W04')
  actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: ['domestic'] }, 'W09')
  expect(await actions.details({ symptoms: ['unknown'] }, 'animalDetails', 'W99')).toBe('W14')
  const { adviceFixture } = await import('../../pages/fixtures/advice')
  const { municipalityFixture } = await import('../../pages/fixtures/contacts')
  const advice = actions.adviceView(adviceFixture)
  expect(JSON.stringify(advice.blocks)).toContain('Synthetic published warning.')
  expect(JSON.stringify(advice.blocks)).not.toContain('Ukážkové upozornenie')
  expect(await actions.acknowledgeAdvice(advice)).toBe('W15')
  const contact = actions.contactView(municipalityFixture)
  expect(JSON.stringify(contact.blocks)).not.toContain('Ukážková obec')
  const alternatives = contact.footerActions.find(action => action.id === 'alternatives')
  if (!alternatives) throw new Error('missing alternative')
  expect(await actions.instruction(contact, alternatives)).toBe('W18')
})

it('keeps the matrix warning when the published warning text is removed', async () => {
  const guidance = structuredClone(bundledPublicGuidance())
  const cat = guidance.kinds.domestic_cat
  if (!cat) throw new Error('missing synthetic kind')
  guidance.kinds = {
    ...guidance.kinds,
    domestic_cat: { items: cat.items.filter(item => !item.instructionKey.startsWith('warning.')) }
  }
  const { actions } = harness(undefined, undefined, memoryCheckpoint(), guidance)
  await actions.start(homeFixture, 'start-injured')
  await actions.location(place, 'W04')
  actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: ['domestic'] }, 'W09')
  expect(await actions.details({ symptoms: ['unknown'] }, 'animalDetails', 'W99')).toBe('W14')
  const { adviceFixture } = await import('../../pages/fixtures/advice')
  expect(JSON.stringify(actions.adviceView(adviceFixture).blocks)).toContain('Pozor, toto nerobte!')
})

it('follows the injured matrix instead of published contact-option steps', async () => {
  const { municipalityFixture } = await import('../../pages/fixtures/contacts')
  const { adviceFixture } = await import('../../pages/fixtures/advice')
  const { actions } = harness()
  await actions.start(homeFixture, 'start-injured')
  await actions.location(place, 'W04')
  actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: ['domestic'] }, 'W09')
  expect(await actions.details({ symptoms: ['unknown'] }, 'animalDetails', 'W99')).toBe('W14')
  expect(await actions.acknowledgeAdvice(adviceFixture)).toBe('W15')
  const contact = actions.contactView(municipalityFixture)
  const alternatives = contact.footerActions.find(action => action.id === 'alternatives')
  if (!alternatives) throw new Error('alternative action required')
  expect(await actions.instruction(contact, alternatives)).toBe('W18')
  const clinic = actions.contactView({ ...municipalityFixture, screen: 'W18' })
  const clinicNext = clinic.footerActions.find(action => action.id === 'alternatives')
  if (!clinicNext) throw new Error('alternative action required')
  expect(await actions.instruction(clinic, clinicNext)).toBe('W21')
  const volunteers = actions.contactView({ ...municipalityFixture, screen: 'W21' })
  const volunteerNext = volunteers.footerActions.find(action => action.id === 'alternatives')
  if (!volunteerNext) throw new Error('alternative action required')
  expect(await actions.instruction(volunteers, volunteerNext)).toBe('W22a')
})

it('pins the published options and restores the selected contact step across reloads', async () => {
  const { bundledGuidanceDocument, contactOptionCells, isContactInstruction, resolvePublicGuidance } =
    await import('@animal-helper/guidance')
  const original = bundledGuidanceDocument()
  const makeGuidance = (id: string) =>
    resolvePublicGuidance(
      {
        copy: original.copy,
        cells: [
          ...original.cells.filter(
            cell => cell.kindKey !== 'domestic_cat' || !isContactInstruction(cell.instructionKey)
          ),
          ...contactOptionCells('domestic_cat', [
            { id, enabled: true, serviceKey: 'volunteers', title: 'Dobrovoľníci', body: 'Pokyny' }
          ])
        ]
      },
      { revisionId: 'bundled', source: 'bundled', contentHash: 'a'.repeat(64) }
    )
  const started = harness(undefined, undefined, memoryCheckpoint(), makeGuidance('original'))
  await started.actions.start(homeFixture, 'start-injured')
  await started.actions.location(place, 'W04')
  started.actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: ['domestic'] }, 'W09')
  await started.actions.details({ symptoms: ['unknown'] }, 'animalDetails', 'W99')
  await started.actions.rememberGuidePath('/contacts/original')
  const reloaded = harness(undefined, started.caseStore, started.checkpoint, makeGuidance('new-publication'))
  await reloaded.actions.restore()
  expect(suspendedPreview.value?.screen).toBe('/contacts/original')
  expect(reloaded.actions.hasContactOption('original')).toBe(true)
  expect(reloaded.actions.hasContactOption('new-publication')).toBe(false)
  expect(previewSession.value?.visitedHelp).toEqual(['volunteers'])
})

it.each(['near-road', 'near-highway', 'hit-road', 'hit-highway', 'railway', 'other'])(
  'preserves road branch %s, failure reasons and onward help in one case across reload',
  async road => {
    const { otherFailedFixture } = await import('../../pages/fixtures/other-situations')
    const { municipalityFixture } = await import('../../pages/fixtures/contacts')
    const { adviceFixture } = await import('../../pages/fixtures/advice')
    const guidance = {
      ...bundledPublicGuidance(),
      reportProfiles: [
        {
          context: `road-${road}` as 'road-railway',
          warning: 'Synthetic warning',
          instructions: '',
          contacts: [
            {
              id: 'road-service',
              serviceKey: 'police' as const,
              enabled: true,
              title: 'Synthetic service',
              body: 'Synthetic instructions'
            }
          ]
        }
      ]
    }
    const started = harness(undefined, undefined, memoryCheckpoint(), guidance)
    await started.actions.start(homeFixture, 'start-other')
    started.actions.chooseSituation({ id: 'road', label: 'Na/pri ceste alebo koľajniciach', target: 'W03' })
    expect(await started.actions.location(place, 'W33')).toBe('W33')
    expect(await started.actions.details({ road }, 'roadDetails', 'W36')).toBe('W14')
    expect(await started.actions.acknowledgeAdvice(adviceFixture)).toBe('/contacts/road-service')
    const contact = started.actions.contactView(municipalityFixture, 'road-service')
    expect(contact.copy.title).toBe('Synthetic service')
    expect(await started.actions.instruction(contact, contact.footerActions[1]!)).toBe('W37')
    started.actions.saveReport(otherFailedFixture, ['unanswered', 'other'], 'Synthetic failure')
    started.actions.followup(otherFailedFixture, otherFailedFixture.actions[0]!)
    started.actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: [] }, 'W09')
    expect(await started.actions.details({}, 'animalDetails', 'W39')).toBe('W38')
    const restored = harness(undefined, started.caseStore, started.checkpoint)
    await restored.actions.restore()
    expect(suspendedPreview.value?.screen).toBe('W38')
    expect(previewSession.value?.otherReport?.description).toBe('Synthetic failure')
    expect(await restored.actions.requestAnimalHelp()).toBe('W14')
    expect(await restored.actions.submitReport({ shareWithAuthorities: false, newsletter: false })).toBe(true)
    expect(restored.commands.at(-3)).toMatchObject({
      privatePayload: {
        situationType: 'other',
        other: {
          branch: 'road',
          situation: road,
          serviceReport: { reasons: ['unanswered', 'other'], description: 'Synthetic failure' },
          animalHelpRequested: true
        }
      }
    })
    expect([...started.commands, ...restored.commands].filter(command => command.type === 'create_draft')).toHaveLength(
      1
    )
  }
)

it('closes an early draft only after collecting its location, retaining the reported result', async () => {
  const { homeDraftFixture } = await import('../../pages/fixtures/home')
  const { actions, commands } = harness()
  await actions.start(homeFixture, 'start-other')
  actions.leave('W32')
  expect(await actions.start(homeDraftFixture, 'draft-complete')).toBe('W03')
  expect(actions.status().hasDraft).toBe(true)
  expect(await actions.location(place, 'W04')).toBe('W26')
  expect(
    await actions.submitReport({
      shareWithAuthorities: false,
      newsletter: false,
      closure: { status: 'resolved-otherwise' }
    })
  ).toBe(true)
  expect(commands.at(-3)).toMatchObject({
    privatePayload: { situationType: 'other', closure: { status: 'resolved-otherwise' } }
  })
})

it('uses separate default and species-specific dead guidance and restores the pinned profile', async () => {
  const { adviceFixture } = await import('../../pages/fixtures/advice')
  const guidance = {
    ...bundledPublicGuidance(),
    reportProfiles: [
      { context: 'dead-suspicious' as const, warning: 'Default warning', instructions: '', contacts: [] },
      {
        context: 'dead-suspicious' as const,
        kindKey: 'domestic_cat',
        warning: 'Specific warning',
        instructions: '',
        contacts: []
      }
    ]
  }
  const started = harness(undefined, undefined, memoryCheckpoint(), guidance)
  const deadHome = {
    ...homeFixture,
    allowedActions: [...homeFixture.allowedActions, 'start-dead'],
    previewActions: {
      ...homeFixture.previewActions,
      'start-dead': { situation: 'dead', fromDraft: false, target: 'W03' }
    }
  }
  await started.actions.start(deadHome, 'start-dead')
  await started.actions.location(place, 'W04')
  started.actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: [] }, 'W09')
  await started.actions.details({ suspiciousSigns: ['bait'], animalCount: 'multiple' }, 'animalDetails', 'W14')
  const restored = harness(undefined, started.caseStore, started.checkpoint)
  await restored.actions.restore()
  expect(JSON.stringify(restored.actions.adviceView(adviceFixture).blocks)).toContain('Specific warning')
  await restored.actions.submitReport({ shareWithAuthorities: true, newsletter: false })
  expect(restored.commands.at(-3)).toMatchObject({
    privatePayload: { dead: { suspiciousSigns: ['bait'], animalCount: 'multiple' } }
  })
})

it.each(['injured', 'stray', 'cruelty', 'other'] as const)(
  'keeps %s report navigation separate from repeated closure attempts',
  async situation => {
    const { homeDraftFixture } = await import('../../pages/fixtures/home')
    const { previewThankYouView } = await import('../../pages/fixtures/preview-server')
    const { pendingThankYouFixture } = await import('../../pages/fixtures/thank-you')
    const { actions, commands } = harness()
    await actions.start(homeFixture, `start-${situation}`)
    await actions.location(place, 'W04')
    actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: [] }, 'W09')
    actions.leave('W09')
    expect(await actions.start(homeDraftFixture, 'draft-resume')).toBe('W09')
    actions.leave('W09')
    expect(await actions.start(homeDraftFixture, 'draft-complete')).toBe('W26')
    await actions.rememberGuidePath('/w26')
    expect(previewThankYouView(pendingThankYouFixture).backTarget).toBe('W09')
    actions.leave('W26')
    actions.saveDraft('W26', { descriptions: { other: 'Synthetic closure note' } })
    expect(suspendedPreview.value?.screen).toBe('W09')
    expect(await actions.start(homeDraftFixture, 'draft-resume')).toBe('W09')
    expect(previewSession.value?.closingDraft).toBeUndefined()
    expect(previewSession.value?.uiDrafts?.W26).toEqual({ descriptions: { other: 'Synthetic closure note' } })
    expect(actions.readDraft('W26')).toEqual({ descriptions: { other: 'Synthetic closure note' } })
    expect(actions.readDraft('W26')).toEqual({ descriptions: { other: 'Synthetic closure note' } })
    actions.leave('W09')
    expect(await actions.start(homeDraftFixture, 'draft-complete')).toBe('W26')
    expect(previewThankYouView(pendingThankYouFixture).backTarget).toBe('W09')
    expect(actions.cancelDraftClosure()).toBe('W09')
    expect(commands.filter(command => command.type === 'create_draft')).toHaveLength(1)
    expect(commands.some(command => command.type === 'submit_draft')).toBe(false)
  }
)

it('retains early closure navigation through location capture and cancels closure before continuing the report', async () => {
  const { homeDraftFixture } = await import('../../pages/fixtures/home')
  const { previewThankYouView } = await import('../../pages/fixtures/preview-server')
  const { pendingThankYouFixture } = await import('../../pages/fixtures/thank-you')
  const { actions } = harness()
  await actions.start(homeFixture, 'start-other')
  actions.leave('W32')
  expect(await actions.start(homeDraftFixture, 'draft-complete')).toBe('W03')
  expect(await actions.location(place, 'W04')).toBe('W26')
  expect(previewThankYouView(pendingThankYouFixture).backTarget).toBe('W32')
  expect(actions.cancelDraftClosure()).toBe('W32')
  actions.chooseSituation({ id: 'human', label: 'Synthetic situation', target: 'W03' })
  expect(await actions.location(place, 'W04')).toBe('W04')
})

it('restores closure without losing the original report screen or overwriting the outcome return target', async () => {
  const { homeDraftFixture } = await import('../../pages/fixtures/home')
  const started = harness()
  await started.actions.start(homeFixture, 'start-injured')
  await started.actions.location(place, 'W04')
  started.actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: [] }, 'W09')
  if (!previewSession.value) throw new Error('Missing draft')
  previewSession.value.thankYouReturnTarget = '/contacts/original'
  started.actions.leave('W09')
  await started.actions.start(homeDraftFixture, 'draft-complete')
  await started.actions.rememberGuidePath('/w26')
  const restored = harness(undefined, started.caseStore, started.checkpoint)
  await restored.actions.restore()
  expect(previewSession.value?.closureReturnTarget).toBe('W09')
  expect(previewSession.value?.thankYouReturnTarget).toBe('/contacts/original')
  expect(restored.actions.cancelDraftClosure()).toBe('W09')
  expect(previewSession.value?.closingDraft).toBeUndefined()
})

it('repairs old self-referential closure checkpoints with a valid report destination', async () => {
  const started = harness()
  await started.actions.start(homeFixture, 'start-injured')
  await started.actions.location(place, 'W04')
  started.actions.identify({ kind: 'species', speciesId: 'domestic_cat', path: [] }, 'W09')
  await started.actions.rememberGuidePath('/w09')
  const saved = await started.checkpoint.load()
  if (!saved?.session) throw new Error('Missing checkpoint')
  const { reportResumeScreen: _resume, closureReturnTarget: _back, ...legacy } = saved.session
  await started.checkpoint.save({ ...saved, screen: 'W26', session: { ...legacy, thankYouReturnTarget: 'W26' } })
  const restored = harness(undefined, started.caseStore, started.checkpoint)
  await restored.actions.restore()
  expect(previewSession.value?.closureReturnTarget).toBe('W09')
  expect(restored.actions.cancelDraftClosure()).toBe('W09')
})
