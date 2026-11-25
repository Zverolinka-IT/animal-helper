import {
  createCaseSession,
  createFetchTransport,
  createMemoryCaseStore,
  type CaseSession,
  type ClientError
} from '@animal-helper/client'
import { createIdbCaseStore } from '@animal-helper/client/browser'
import {
  type ContactServiceKey,
  type FormSnapshotV1,
  type ReportGuidanceContext,
  type ReportOutcome
} from '@animal-helper/contracts'
import {
  bundledPublicGuidance,
  contactOptionPath,
  customerWalkableSteps,
  isContactOptionInstruction,
  parsePublicGuidance,
  reportGuidanceContext,
  reportGuidanceItems,
  reportGuidancePaths,
  resumeWalkView,
  walkViewAfterPath,
  walkViewForPath,
  type GuidanceItem,
  type PublicGuidance,
  type WalkFacts
} from '@animal-helper/guidance'
import { districtForPlace, municipalityOfficeFor, selectContacts } from '@animal-helper/jurisdictions'
import type { AnimalIdentification } from '../animal-identification'
import type { LocationPoint } from '../contracts/forms'
import type { AdvicePanel, AdviceView } from '../pages/fixtures/advice'
import { fixtureFlowActions } from '../pages/fixtures/flow-actions'
import type { InstructionAction, InstructionsView } from '../pages/fixtures/instructions'
import { previewAccess, previewDraftProgress } from '../pages/fixtures/preview-server'
import { suspendedPreview } from '../pages/fixtures/preview-session'
import type { SelfHelpBlock, SelfHelpView } from '../pages/fixtures/self-help'
import type { HomeView } from '../pages/home-view'
import { previewSession } from '../preview-flow'
import { notify } from '../toasts'
import { apiBaseUrl } from './api'
import { createWalkCheckpoint, type WalkCheckpoint, type WalkCheckpointStore } from './checkpoint'
import { clinicGroupsFor } from './clinic-groups'
import { injuredHelpSections, injuredRouteFor, nextInjuredScreen } from './injured-route'
import {
  presentAdvice,
  presentAdvicePanel,
  presentContacts,
  presentDirectoryContacts,
  presentSelfHelp,
  presentVeterinaryClinics
} from './presentation'
import { reportSnapshot } from './report-snapshot'

type ServerSituation = FormSnapshotV1['situationType']
type DetailAnswers = Record<string, string | string[]>
type ContactReport = {
  closure?: FormSnapshotV1['closure']
  outcome?: ReportOutcome
  whoHelped?: FormSnapshotV1['whoHelped']
  name?: string | undefined
  phone?: string | undefined
  email?: string | undefined
  shareWithAuthorities: boolean
  newsletter: boolean
}

const presentationRoutes: Record<string, string> = {
  '/w03': 'W03',
  '/w04': 'W04',
  '/w09': 'W09',
  '/w13': 'W13',
  '/w14': 'W14',
  '/w15': 'W15',
  '/w15a': 'W15a',
  '/w15b': 'W15b',
  '/w15c': 'W15c',
  '/w15d': 'W15d',
  '/w15e': 'W15e',
  '/w15f': 'W15f',
  '/w18': 'W18',
  '/w19': 'W19',
  '/w20': 'W20',
  '/w20a': 'W20a',
  '/w20b': 'W20b',
  '/w21': 'W21',
  '/w22': 'W22',
  '/w22a': 'W22a',
  '/w22b': 'W22b',
  '/w22d': 'W22d',
  '/w24': 'W24',
  '/w26': 'W26',
  '/w06': 'W06',
  '/w25': 'W25',
  '/w27': 'W27',
  '/w28': 'W28',
  '/w29': 'W29',
  '/w30': 'W30',
  '/w32': 'W32',
  '/w33': 'W33',
  '/w36': 'W36',
  '/w37': 'W37',
  '/w38': 'W38',
  '/w39': 'W39',
  '/w39a': 'W39a',
  '/w40': 'W40'
}

const presentationRoute = (path: string): string | undefined =>
  /^\/contacts\/[a-z0-9][a-z0-9-]{0,47}$/.test(path) ? path : presentationRoutes[path]

function initialFacts(): WalkFacts {
  return {
    situationType: 'injured',
    hasDraft: false,
    hasLocation: false,
    photoDone: false,
    hasFormSnapshot: false,
    hasContact: false,
    submitted: false
  }
}

function serverSituation(actionId: string): ServerSituation | undefined {
  return (['injured', 'stray', 'dead', 'cruelty', 'other'] as const).find(value => actionId === `start-${value}`)
}

function withPublicState(facts: WalkFacts, publicState: WalkFacts['publicState']): WalkFacts {
  if (publicState === undefined) return facts
  return { ...facts, publicState }
}

function failureText(error: ClientError) {
  if (error.code === 'UNSUPPORTED_SITUATION')
    return 'Odosielanie tohto typu hlásenia zatiaľ nie je dostupné. Údaje neboli odoslané.'
  if (error.code === 'STORAGE_UNAVAILABLE')
    return 'Prehliadač neumožnil bezpečne uložiť zmeny hlásenia na tomto zariadení. Skúste to znova.'
  if (error.code === 'CASE_READ_ONLY')
    return 'Hlásenie už bolo odoslané alebo uzavreté. Zmenené údaje ani súhlasy sa neuložili.'
  if (error.code === 'API' && error.apiCode === 'INCOMPLETE_REPORT')
    return 'Hlásenie ešte nie je úplné. Doplňte miesto a údaje o zvierati a skúste ho odoslať znova.'
  return error.code === 'NETWORK_FAILURE'
    ? 'Server je teraz nedostupný. Skúste to znova.'
    : 'Server hlásenie neprijal. Skúste to znova.'
}

export type WalkDependencies = {
  session: CaseSession
  guidance: () => Promise<PublicGuidance>
  checkpoint?: WalkCheckpointStore
  reportFailure?: (error: ClientError) => void
}

export function createWalkActions(dependencies: WalkDependencies) {
  let facts = initialFacts()
  let activeGuidance: PublicGuidance | undefined
  let currentGuidePath: string | undefined
  let pending: Promise<unknown> | undefined
  let currentScreen: string | undefined
  let streamId: string | undefined
  let checkpointClock = 0

  function persisted() {
    return facts.hasDraft && previewSession.value?.situation === facts.situationType
  }

  function setScreen(target: string | undefined) {
    if (!target) return
    currentScreen = target
    const session = previewSession.value
    if (session && target !== 'W26' && target !== 'W01' && !session.closingDraft) session.reportResumeScreen = target
  }

  function reportResumeTarget(): string {
    const session = previewSession.value
    const candidates = [
      session?.reportResumeScreen,
      session?.closureReturnTarget,
      suspendedPreview.value?.screen,
      currentScreen,
      // Recover older checkpoints that used the outcome return target for closure.
      currentScreen === 'W26' ? session?.thankYouReturnTarget : undefined
    ]
    for (const target of candidates) {
      if (!target || target === 'W26' || target === 'W01') continue
      const option = target.startsWith('/contacts/')
      if (option ? !presentationRoute(target) : !Object.values(presentationRoutes).includes(target)) continue
      if (previewAccess(option ? 'W15' : target) === true && (!option || guide(target))) return target
    }
    if (session?.situation === 'other' && !session.otherSituation) return 'W32'
    if (!session?.location) return session?.situation === 'cruelty' ? 'W27' : 'W03'
    return session.animalIdentification || session.identificationFailed ? 'W09' : 'W04'
  }

  function cancelDraftClosure() {
    const target = reportResumeTarget()
    if (previewSession.value) delete previewSession.value.closingDraft
    if (suspendedPreview.value?.session === previewSession.value) {
      suspendedPreview.value.screen = target
      suspendedPreview.value.progress = previewDraftProgress(target)
    }
    return rememberScreen(target)
  }

  function report(error: ClientError) {
    if (dependencies.reportFailure) {
      dependencies.reportFailure(error)
      return
    }
    notify({
      title: 'Hlásenie sa neuložilo',
      text: failureText(error),
      kind: 'error',
      dismissLabel: 'Zavrieť oznámenie'
    })
  }

  async function exclusive<T>(run: () => Promise<T>) {
    if (pending) return undefined
    const current = run()
    pending = current
    try {
      return await current
    } finally {
      if (pending === current) pending = undefined
    }
  }

  let checkpointTail = Promise.resolve()

  function captureCheckpoint(): WalkCheckpoint {
    const session = previewSession.value
    const { media: _media, ...durableSession } = session ?? {}
    const checkpoint: WalkCheckpoint = {
      ...(streamId ? { streamId } : {}),
      savedAt: (checkpointClock = Math.max(Date.now(), checkpointClock + 1)),
      facts: { ...facts },
      ...(session ? { session: durableSession as NonNullable<WalkCheckpoint['session']> } : {}),
      ...(currentScreen ? { screen: currentScreen } : {}),
      ...(activeGuidance ? { guidance: activeGuidance } : {}),
      ...(currentGuidePath ? { guidePath: currentGuidePath } : {}),
      ...(session?.location ? { location: { ...session.location } } : {}),
      ...(session?.animalIdentification
        ? { animalIdentification: { ...session.animalIdentification, path: [...session.animalIdentification.path] } }
        : {}),
      ...(session?.animalDetails ? { animalDetails: { ...session.animalDetails } } : {}),
      ...(session?.adviceReady ? { adviceReady: true } : {}),
      ...(session?.visitedHelp ? { visitedHelp: [...session.visitedHelp] } : {})
    }
    // Vue proxies cannot be stored in IndexedDB.
    return JSON.parse(JSON.stringify(checkpoint)) as WalkCheckpoint
  }

  function persistCheckpoint() {
    const checkpoint = dependencies.checkpoint
    if (!checkpoint) return Promise.resolve()
    const saved = facts.hasDraft ? captureCheckpoint() : undefined
    if (saved) checkpoint.stage?.(saved)
    const run = checkpointTail.then(async () => {
      if (!saved) return
      try {
        await checkpoint.save(saved)
      } catch {
        // The open tab still has the case when the browser refuses storage.
      }
    })
    checkpointTail = run
    return run
  }

  async function resetCase() {
    try {
      await checkpointTail
      await dependencies.session.removeLocal()
      await dependencies.checkpoint?.clear()
      facts = initialFacts()
      activeGuidance = undefined
      currentGuidePath = undefined
      currentScreen = undefined
      streamId = undefined
      return true
    } catch {
      report({ code: 'STORAGE_UNAVAILABLE', retryable: false })
      return false
    }
  }

  async function restore() {
    const snapshot = await dependencies.session.snapshot()
    if (!snapshot?.mutationAllowed || snapshot.publicState === 'received' || snapshot.publicState === 'closed') {
      if (snapshot) await resetCase()
      return
    }
    const candidate = await dependencies.checkpoint?.load()
    const saved = !candidate?.streamId || candidate.streamId === snapshot.streamId ? candidate : undefined
    streamId = snapshot.streamId
    checkpointClock = saved?.savedAt ?? 0
    const restored =
      saved?.facts.hasDraft === true
        ? saved.facts
        : { ...initialFacts(), situationType: 'injured' as const, hasDraft: true }
    facts = withPublicState(restored, snapshot.publicState ?? restored.publicState)
    previewSession.value = {
      ...saved?.session,
      situation: facts.situationType,
      fromDraft: true,
      ...(saved?.location ? { location: saved.location } : {}),
      ...(saved?.animalIdentification ? { animalIdentification: saved.animalIdentification } : {}),
      ...(saved?.animalDetails ? { animalDetails: saved.animalDetails } : {}),
      ...(saved?.adviceReady ? { adviceReady: true } : {}),
      ...(saved?.visitedHelp ? { visitedHelp: saved.visitedHelp } : {})
    }
    let guidance: PublicGuidance
    try {
      guidance = saved?.guidance ? parsePublicGuidance(saved.guidance) : await dependencies.guidance()
    } catch {
      guidance = await dependencies.guidance()
    }
    activeGuidance = guidance
    currentGuidePath =
      saved?.guidePath && walkViewForPath(saved.guidePath, facts, guidance)?.screen === 'guide'
        ? saved.guidePath
        : undefined
    const screen = saved?.screen ?? presentationRoute(currentGuidePath ?? resumeWalkView(facts, guidance).path) ?? 'W03'
    currentScreen = screen
    suspendedPreview.value = { session: previewSession.value, screen, progress: previewDraftProgress(screen) }
    // Normalize old closure checkpoints without restoring a self-referential Back target.
    if (screen === 'W26' || previewSession.value.closingDraft) {
      previewSession.value.closureReturnTarget = reportResumeTarget()
      previewSession.value.reportResumeScreen = previewSession.value.closureReturnTarget
      previewSession.value.closingDraft = true
    } else setScreen(screen)
  }

  function effectiveFacts(): WalkFacts {
    return previewSession.value?.animalHelpRequested ? { ...facts, situationType: 'injured' } : facts
  }

  function profileContext(): ReportGuidanceContext | undefined {
    const session = previewSession.value
    if (!session || session.animalHelpRequested || ['injured', 'cruelty'].includes(session.situation)) return undefined
    // A road profile is selected before animal identification; no species is fabricated.
    try {
      return reportGuidanceContext(reportSnapshot(session))
    } catch {
      return undefined
    }
  }

  function allGuideItems(): readonly GuidanceItem[] {
    const context = profileContext()
    if (!activeGuidance) return []
    if (context) return reportGuidanceItems(activeGuidance, context, facts.kindKey)
    return effectiveFacts().situationType === 'injured' && facts.kindKey
      ? (activeGuidance.kinds[facts.kindKey]?.items ?? [])
      : []
  }

  function profileSteps() {
    return reportGuidancePaths(allGuideItems())
  }

  function rememberScreen(target: string | undefined) {
    setScreen(target)
    void persistCheckpoint()
    return target
  }

  function injuredOptions() {
    const symptoms = previewSession.value?.animalDetails?.symptoms
    const office = municipalityOfficeFor(previewSession.value?.location?.label)
    return {
      collision: Array.isArray(symptoms) && symptoms.includes('collision'),
      municipalPolice: office?.police === true
    }
  }

  async function routeAfter(completedPath: string) {
    const guidance = (activeGuidance ??= await dependencies.guidance())
    if (facts.situationType === 'injured' && !profileContext()) {
      const current = presentationRoute(completedPath)
      const next = nextInjuredScreen(facts.kindKey, current ?? '', injuredOptions())
      if (next) return next
    }
    if (profileContext()) {
      const steps = profileSteps()
      const next = steps[steps.indexOf(completedPath) + 1]
      return next
        ? presentationRoute(next)
        : profileContext()?.startsWith('road-')
          ? 'W37'
          : completedPath.startsWith('/contacts/')
            ? 'W25'
            : 'W24'
    }
    let path = completedPath
    for (let step = 0; step < 12; step++) {
      const view = walkViewAfterPath(path, effectiveFacts(), guidance)
      if (!view) break
      if (view.screen === 'guide' && view.props.items.length === 0) {
        path = view.path
        continue
      }
      const route = presentationRoute(view.path)
      if (route) return route
      path = view.path
    }
    if (facts.hasFormSnapshot && !facts.submitted) return 'W24'
    return undefined
  }

  function guide(path: string) {
    if (!persisted() || !activeGuidance) return undefined
    if (profileContext()) {
      if (!profileSteps().includes(path)) return undefined
      const items = allGuideItems().filter(item =>
        path === '/w14'
          ? item.screenKey === 'w14'
          : isContactOptionInstruction(item.instructionKey) && contactOptionPath(item.instructionKey) === path
      )
      return { screen: 'guide' as const, path, props: { items } }
    }
    const view = walkViewForPath(path, effectiveFacts(), activeGuidance)
    return view?.screen === 'guide' ? view : undefined
  }

  function guideItems(path: string) {
    const view = guide(path)
    if (!view || !activeGuidance) return []
    return allGuideItems().filter(item =>
      view.props.items.some(selected => selected.instructionKey === item.instructionKey)
    )
  }

  function guideBack(path: string) {
    if (profileContext()) {
      const index = profileSteps().indexOf(path)
      return (
        presentationRoute(profileSteps()[index - 1] ?? '') ?? (profileContext()?.startsWith('road-') ? 'W33' : 'W09')
      )
    }
    const steps = customerWalkableSteps(effectiveFacts().situationType, facts.kindKey, allGuideItems())
    const index = steps.findIndex(step => step.path === path)
    for (let i = index - 1; i >= 0; i--) {
      const step = steps[i]
      const route = step ? presentationRoute(step.path) : undefined
      if (step && route && (step.path === '/w09' || guideItems(step.path).length)) return route
    }
    return 'W09'
  }

  return {
    ...fixtureFlowActions,
    readDraft(screen: string) {
      // Restoring a persistent form must not consume its only saved copy:
      // Back/reopen without further edits still needs the restored answers.
      return persisted() ? previewSession.value?.uiDrafts?.[screen] : fixtureFlowActions.readDraft(screen)
    },
    chooseSituation(...args: Parameters<typeof fixtureFlowActions.chooseSituation>) {
      const previous = previewSession.value?.otherSituation
      const next = fixtureFlowActions.chooseSituation(...args)
      if (previous !== args[0].id) {
        facts = { ...initialFacts(), situationType: 'other', hasDraft: facts.hasDraft }
        currentGuidePath = undefined
      }
      return rememberScreen(next)
    },
    continueCruelty(...args: Parameters<typeof fixtureFlowActions.continueCruelty>) {
      return rememberScreen(fixtureFlowActions.continueCruelty(...args))
    },
    followup(...args: Parameters<typeof fixtureFlowActions.followup>) {
      return rememberScreen(fixtureFlowActions.followup(...args))
    },
    saveReport(...args: Parameters<typeof fixtureFlowActions.saveReport>) {
      fixtureFlowActions.saveReport(...args)
      void persistCheckpoint()
    },
    saveDetails(...args: Parameters<typeof fixtureFlowActions.saveDetails>) {
      fixtureFlowActions.saveDetails(...args)
      void persistCheckpoint()
    },
    saveUiDraft(screen: string, values: Record<string, unknown>) {
      if (!previewSession.value || !persisted()) return
      previewSession.value.uiDrafts ??= {}
      previewSession.value.uiDrafts[screen] = values
      void persistCheckpoint()
    },
    saveDraft(...args: Parameters<typeof fixtureFlowActions.saveDraft>) {
      if (persisted() && previewSession.value) {
        previewSession.value.uiDrafts ??= {}
        previewSession.value.uiDrafts[args[0]] = args[1]
      } else fixtureFlowActions.saveDraft(...args)
      void persistCheckpoint()
    },
    leave(screen: string) {
      setScreen(screen)
      const target = fixtureFlowActions.leave(screen)
      if (previewSession.value?.closingDraft && suspendedPreview.value) {
        const resume = reportResumeTarget()
        suspendedPreview.value.screen = resume
        suspendedPreview.value.progress = previewDraftProgress(resume)
        delete previewSession.value.closingDraft
        setScreen(resume)
      }
      void persistCheckpoint()
      return target
    },
    async requestAnimalHelp() {
      if (!persisted() || !previewSession.value || previewSession.value.otherSituation !== 'road') return undefined
      previewSession.value.animalHelpRequested = true
      delete previewSession.value.completionOutcome
      // Retain road details and service failure in the same report.
      return rememberScreen(await routeAfter('/w09'))
    },
    rememberGuidePath(path: string) {
      const screen = presentationRoute(path)
      if (!screen) return
      setScreen(screen)
      if (!guide(path)) return persistCheckpoint()
      currentGuidePath = path
      const session = previewSession.value
      if (session) {
        const services = guideItems(path).flatMap(item =>
          item.instructionKey === 'self_help'
            ? ['self' as const]
            : item.instructionKey === 'volunteers'
              ? ['volunteers' as const]
              : item.action?.kind === 'call-contact'
                ? [item.action.targetKey as ContactServiceKey]
                : []
        )
        session.visitedHelp = [...new Set([...(session.visitedHelp ?? []), ...services])]
      }
      return persistCheckpoint()
    },
    status: () => facts,
    adviceView(view: AdviceView) {
      const path = '/' + view.screen.toLowerCase()
      const route = facts.situationType === 'injured' ? injuredRouteFor(facts.kindKey) : undefined
      const guidedItems = guide(path) ? guideItems(path) : []
      if (!guidedItems.length) {
        if (!route || view.screen !== route.warning || (!route.avoid.length && !route.do.length)) return view
        return {
          ...view,
          copy: { ...view.copy, preview: '' },
          blocks: [
            ...(route.avoid.length
              ? [
                  {
                    id: 'avoid',
                    kind: 'avoid' as const,
                    title: 'Pozor, toto nerobte!',
                    items: route.avoid.map((title, index) => ({ id: `avoid-${index}`, title }))
                  }
                ]
              : []),
            ...(route.do.length
              ? [
                  {
                    id: 'do',
                    kind: 'do' as const,
                    title: 'Je zviera v ohrození?',
                    items: route.do.map((title, index) => ({ id: `do-${index}`, title }))
                  }
                ]
              : [])
          ]
        }
      }
      const presented = presentAdvice(view, guideItems(path), guideBack(path))
      if (profileContext() && !allGuideItems().length)
        return {
          ...presented,
          copy: {
            ...presented.copy,
            title: 'Pokračujte v hlásení',
            description:
              'Pre túto situáciu zatiaľ nemáme zverejnený overený postup pomoci. Prípad môžete aj tak zdokumentovať a odoslať.',
            acknowledge: 'Pokračovať v hlásení'
          }
        }
      return presented
    },
    hasContactOption(id: string) {
      return Boolean(guide(`/contacts/${id}`))
    },
    contactView(view: InstructionsView, optionId?: string) {
      const lastRoadOption =
        view.screen === 'W36' && profileContext()?.startsWith('road-')
          ? allGuideItems()
              .filter(item => isContactOptionInstruction(item.instructionKey))
              .at(-1)
              ?.instructionKey.slice('contact.option.'.length)
          : undefined
      const selectedOptionId = optionId ?? lastRoadOption
      const optionPath = selectedOptionId ? (`/contacts/${selectedOptionId}` as const) : undefined
      const path = optionPath ?? '/' + view.screen.toLowerCase()
      const location = previewSession.value?.location
      const municipality = municipalityOfficeFor(location?.label)
      const district = (location ? districtForPlace(location.label) : undefined) ?? municipality?.district
      const context = {
        guidanceSource: activeGuidance?.source,
        directory: activeGuidance?.contactDirectory,
        location: location ? { latitude: location.lat, longitude: location.lng } : undefined,
        ...(district ? { district } : {}),
        ...(municipality ? { municipality } : {}),
        now: new Date()
      }
      if (view.screen === 'W18' && facts.situationType === 'injured') {
        const published = selectContacts(
          context.directory,
          'vet_clinic',
          context.location,
          context.now,
          context.district
        )
        if (!published.length)
          return presentVeterinaryClinics(view, district, clinicGroupsFor(facts.kindKey), context.now, context.location)
      }
      if (view.screen === 'W36' && profileContext()?.startsWith('road-') && !lastRoadOption)
        return {
          ...view,
          backTarget: 'W33',
          copy: {
            ...view.copy,
            title: 'Overený kontakt zatiaľ nie je dostupný',
            description: 'Pokračujte v zdokumentovaní prípadu.',
            preview: ''
          },
          blocks: []
        }
      return guide(path)
        ? presentContacts(
            { ...view, ...(optionPath ? { flowPath: optionPath } : {}) },
            guideItems(path),
            view.screen === 'W36' ? 'W33' : guideBack(path),
            context
          )
        : optionId
          ? {
              ...view,
              blocks: [],
              allowedActions: [],
              footerActions: [],
              copy: {
                ...view.copy,
                title: 'Táto možnosť pomoci už nie je dostupná',
                description: 'Vráťte sa na predchádzajúci krok.'
              }
            }
          : presentDirectoryContacts(view, context)
    },
    selfHelpView(view: SelfHelpView) {
      if (view.screen === 'W22' && guide('/w22')) return presentSelfHelp(view, guideItems('/w22'), guideBack('/w22'))
      const route = persisted() && facts.situationType === 'injured' ? injuredRouteFor(facts.kindKey) : undefined
      if (!route?.help?.length || route.selfHelp !== view.screen) return view
      const blocks: SelfHelpBlock[] = injuredHelpSections(route.help).map((section, index) => ({
        id: `help-${index}`,
        kind: 'section',
        title: section.title,
        paragraphs: section.paragraphs.map(text => [{ text }])
      }))
      const sheetWarning = route.gameWarning.join('\n')
      if (sheetWarning) {
        blocks.push({
          id: 'game',
          kind: 'notice',
          tone: 'warning',
          title: 'Upozornenie',
          content: [{ text: sheetWarning }]
        })
      } else {
        const designed = view.blocks.find(block => block.id === 'game')
        if (designed) blocks.push(designed)
      }
      if (route.gameSpecies.length) {
        blocks.push({
          id: 'species',
          kind: 'images',
          items: route.gameSpecies.map((label, index) => {
            const file = route.photos?.[index]
            return { id: label, alt: label, caption: label, ...(file ? { src: `/illustrations/${file}.webp` } : {}) }
          })
        })
      }
      return { ...view, copy: { ...view.copy, preview: '' }, blocks }
    },
    advicePanel(panel: (AdvicePanel & { triggerLabel?: string }) | undefined) {
      if (!panel || !persisted() || !activeGuidance) return panel
      return { ...panel, ...presentAdvicePanel(panel, allGuideItems()) }
    },
    async acknowledgeAdvice(view: AdviceView) {
      const target = persisted() ? await routeAfter('/' + view.screen.toLowerCase()) : view.confirmTarget
      if (target === 'W24' && previewSession.value) previewSession.value.thankYouReturnTarget = 'W09'
      return rememberScreen(target)
    },
    instruction(view: InstructionsView, action: InstructionAction) {
      if (!persisted()) return fixtureFlowActions.instruction(view, action)
      if (!view.allowedActions.includes(action.id) || !view.footerActions.includes(action)) return undefined
      if (facts.situationType === 'injured' && injuredRouteFor(facts.kindKey)) {
        if (action.id === 'resolved') {
          if (previewSession.value) previewSession.value.completionOutcome = 'resolved'
          return rememberScreen('W39a')
        }
        if (action.id === 'unresolved') return rememberScreen('W25')
      }
      if (action.id === 'alternatives')
        return routeAfter(view.flowPath ?? '/' + view.screen.toLowerCase()).then(target => {
          if (previewSession.value && (target === 'W25' || target === 'W37')) {
            previewSession.value.thankYouReturnTarget = view.flowPath ?? view.screen
            previewSession.value.completionOutcome = 'unresolved'
          }
          return rememberScreen(target)
        })
      if (action.id === 'unresolved' && profileContext()?.startsWith('road-')) return rememberScreen('W37')
      const target = fixtureFlowActions.instruction(view, action)
      if (target && view.flowPath && previewSession.value) previewSession.value.thankYouReturnTarget = view.flowPath
      return rememberScreen(target)
    },
    instructionBackTargets(view: InstructionsView): readonly string[] {
      return persisted() ? [view.backTarget] : fixtureFlowActions.instructionBackTargets(view)
    },
    restore,
    cancelDraftClosure,
    start(view: HomeView, id: string) {
      return exclusive(async () => {
        if (!view.allowedActions.includes(id)) return undefined
        if (id === 'draft-resume') {
          const target = fixtureFlowActions.start(view, id)
          if (previewSession.value && persisted()) return cancelDraftClosure()
          return target
        }
        if (id === 'draft-complete') {
          if (suspendedPreview.value) previewSession.value = suspendedPreview.value.session
          if (!previewSession.value) return undefined
          const target = reportResumeTarget()
          previewSession.value.reportResumeScreen = target
          previewSession.value.closureReturnTarget = target
          previewSession.value.closingDraft = true
          return rememberScreen(facts.hasLocation ? 'W26' : 'W03')
        }
        const situation = serverSituation(id)
        if (situation) {
          if (!(await resetCase())) return undefined
          const opened = await dependencies.session.openDraft()
          if (!opened.ok) {
            report(opened.error)
            return undefined
          }
          streamId = opened.value.streamId
          facts = withPublicState(
            { ...initialFacts(), situationType: situation, hasDraft: true },
            opened.value.publicState
          )
          activeGuidance = await dependencies.guidance()
          const target = fixtureFlowActions.start(view, id)
          setScreen(target)
          await persistCheckpoint()
          return target
        }
        if (view.previewActions[id]) {
          if (!(await resetCase())) return undefined
          activeGuidance = await dependencies.guidance()
        }
        return fixtureFlowActions.start(view, id)
      })
    },
    location(location: LocationPoint, target: string) {
      if (!persisted()) return fixtureFlowActions.location(location, target)
      return exclusive(async () => {
        const attached = await dependencies.session.attachLocation({
          schemaVersion: 1,
          address: location.label,
          coordinates: { latitude: location.lat, longitude: location.lng }
        })
        if (!attached.ok) {
          report(attached.error)
          return undefined
        }
        facts = withPublicState({ ...facts, hasLocation: true }, attached.value.publicState)
        const next = fixtureFlowActions.location(
          location,
          previewSession.value?.closingDraft
            ? 'W26'
            : facts.situationType === 'other' && previewSession.value?.otherSituation === 'road'
              ? 'W33'
              : 'W04'
        )
        setScreen(next)
        await persistCheckpoint()
        return next
      })
    },
    identify(identification: AnimalIdentification, target: string) {
      if (persisted()) {
        currentGuidePath = undefined
        const { kindKey: _previousKind, ...withoutKind } = facts
        facts = {
          ...withoutKind,
          photoDone: true,
          ...(identification.kind === 'species' ? { kindKey: identification.speciesId } : {})
        }
      }
      const next = fixtureFlowActions.identify(identification, target)
      if (persisted()) rememberScreen(next)
      return next
    },
    details(answers: DetailAnswers, scope: 'animalDetails' | 'roadDetails', target: string) {
      if (!persisted()) return fixtureFlowActions.details(answers, scope, target)
      return exclusive(async () => {
        const session = previewSession.value!
        const payload = reportSnapshot({ ...session, [scope]: answers })
        const attached = await dependencies.session.attachFormSnapshot(payload)
        if (!attached.ok) {
          report(attached.error)
          return undefined
        }
        const { kindKey: _previous, ...withoutKind } = facts
        facts = withPublicState(
          {
            ...withoutKind,
            hasFormSnapshot: true,
            photoDone: scope === 'animalDetails' || facts.photoDone,
            ...(payload.species.kindKey ? { kindKey: payload.species.kindKey } : {})
          },
          attached.value.publicState
        )
        fixtureFlowActions.details(answers, scope, target)
        const documentationOnly =
          session.situation === 'cruelty' || (session.situation === 'other' && session.otherSituation === 'other')
        const roadDocumented =
          session.otherSituation === 'road' && scope === 'animalDetails' && !session.animalHelpRequested
        const next = documentationOnly ? 'W39' : roadDocumented ? 'W38' : ((await routeAfter('/w09')) ?? target)
        setScreen(next)
        await persistCheckpoint()
        return next
      })
    },
    async processMedia(duration: number, target: string, signal: AbortSignal) {
      const next = await fixtureFlowActions.processMedia(duration, target, signal)
      if (next && persisted()) {
        facts = { ...facts, photoDone: true }
        setScreen(next)
        await persistCheckpoint()
      }
      return next
    },
    submitReport(reportInput: ContactReport) {
      if (!persisted()) {
        report({ code: 'UNSUPPORTED_SITUATION', retryable: false })
        return false
      }
      return exclusive(async () => {
        const name = reportInput.name?.trim()
        const phone = reportInput.phone?.trim()
        const email = reportInput.email?.trim()
        const submitted = await dependencies.session.submit(
          {
            schemaVersion: 1,
            ...(name ? { name } : {}),
            ...(phone ? { phone } : {}),
            ...(email ? { email } : {}),
            shareWithAuthorities: reportInput.shareWithAuthorities,
            newsletter: reportInput.newsletter
          },
          {
            ...reportSnapshot(previewSession.value!, reportInput.closure),
            ...(reportInput.outcome ? { outcome: reportInput.outcome } : {}),
            ...(reportInput.whoHelped ? { whoHelped: reportInput.whoHelped } : {})
          }
        )
        if (!submitted.ok) {
          report(submitted.error)
          return false
        }
        await resetCase()
        return true
      })
    }
  }
}

let cachedGuidance: Promise<PublicGuidance> | undefined

export function loadWalkGuidance(): Promise<PublicGuidance> {
  if (!cachedGuidance) {
    const current = fetchPublishedGuidance()
    cachedGuidance = current
    void current.finally(() => {
      if (cachedGuidance === current) cachedGuidance = undefined
    })
  }
  return cachedGuidance
}

async function fetchPublishedGuidance(): Promise<PublicGuidance> {
  try {
    const response = await fetch(`${apiBaseUrl()}/guidance`, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000)
    })
    if (!response.ok) return bundledPublicGuidance()
    return parsePublicGuidance(await response.json())
  } catch {
    return bundledPublicGuidance()
  }
}

const durableBrowser = import.meta.env.MODE !== 'test' && typeof indexedDB !== 'undefined'
const browserTransport = createFetchTransport({ baseUrl: apiBaseUrl() })

export const walkFlowActions = createWalkActions({
  session: createCaseSession({
    store: durableBrowser ? createIdbCaseStore(indexedDB) : createMemoryCaseStore(),
    transport: browserTransport
  }),
  guidance: loadWalkGuidance,
  ...(durableBrowser ? { checkpoint: createWalkCheckpoint(indexedDB) } : {})
})

export function restorePersistedWalk() {
  return walkFlowActions.restore()
}
