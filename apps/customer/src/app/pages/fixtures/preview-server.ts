// TEMPORARY SERVER SIMULATOR, not production client business rules.
// Replace these functions with validated API responses (view + next action).
// Routes register renderers; only this fixture adapter selects scenario variants.
import { catalogueAnimals, reportedSpeciesId } from '../../animal-catalogue'
import { previewSession } from '../../preview-flow'
import { injuredRouteFor } from '../../walk/injured-route'
import { animalDetailsFixture } from './animal-details'
import { animalGroupsFixture, type AnimalGroupsView } from './animal-groups'
import type { ContactsView } from './contacts'
import { contactFixtures } from './contacts'
import { acuteCrueltyDetailsFixture } from './cruelty'
import { flowPolicy, flowScenarios } from './flow-scenarios'
import { homeDraftFixture, homeFixture } from './home'
import { injuredAnimalTree } from './injured-animal-tree'
import { locationFixture } from './location'
import { mediaFixture } from './media'
import { roadInstructionsFixture } from './other-situations'
import { previewDraftDismissed, suspendedPreview } from './preview-session'
import { selfHelpFixture } from './self-help'
import type { ThankYouView } from './thank-you'

function isRoadFlow() {
  return previewSession.value?.situation === 'other' && previewSession.value.otherSituation === 'road'
}
export function previewLocationView() {
  return {
    ...locationFixture,
    ...scenario().location,
    ...(previewSession.value?.closingDraft ? { confirmTarget: 'W26' } : {})
  }
}
export function previewMediaView() {
  return {
    ...mediaFixture,
    backTarget: previewSession.value?.documentingOther ? flowPolicy.documentedMediaBack : mediaFixture.backTarget
  }
}
function scenario() {
  const session = previewSession.value
  const key =
    session?.situation === 'other'
      ? (session.otherSituation ?? 'other')
      : session?.situation && ['cruelty', 'stray', 'dead'].includes(session.situation)
        ? session.situation
        : 'standard'
  return flowScenarios[key]!
}
export function previewDetailsView() {
  if (previewSession.value?.animalHelpRequested) return animalDetailsFixture
  const base =
    previewSession.value?.situation === 'cruelty' && previewSession.value.crueltyReport
      ? acuteCrueltyDetailsFixture
      : scenario().details
  const species =
    previewSession.value?.situation === 'injured' && previewSession.value.animalIdentification?.kind === 'species'
      ? previewSession.value.animalIdentification.speciesId
      : undefined
  const route = injuredRouteFor(species)
  if (!route) return base
  return {
    ...base,
    questions: base.questions.flatMap(question => {
      if (question.id === 'conscious' && !route.askConscious) return []
      if (question.id === 'juvenile' && !route.askJuvenile) return []
      if (question.id !== 'symptoms') return [question]
      return [
        {
          ...question,
          options: question.options.flatMap(option => {
            if (option.id !== 'collision') return [option]
            if (!route.collision) return []
            return [{ ...option, label: 'Došlo k zrážke s autom' }]
          })
        }
      ]
    })
  }
}
export function previewHomeView(clean: boolean) {
  const draft = suspendedPreview.value
  if (draft) {
    const session = draft.session
    const identification = session.animalIdentification
    const catalogue = previewAnimalCatalogue()
    const animal = catalogueAnimals(catalogue).find(item => reportedSpeciesId(item) === identification?.speciesId)
    const situation = homeFixture.props.situations.find(item => item.id === session.situation)?.label
    return {
      ...homeDraftFixture,
      props: {
        ...homeDraftFixture.props,
        draft: {
          ...homeDraftFixture.props.draft!,
          progress: draft.progress,
          summary: [situation, animal?.label ?? identification?.description, session.location?.label].filter(
            (value): value is string => !!value
          )
        }
      }
    }
  }
  return import.meta.env.DEV && !clean && !previewDraftDismissed.value ? homeDraftFixture : homeFixture
}
export function previewAnimalGroupsView(): AnimalGroupsView {
  return { ...animalGroupsFixture, root: previewAnimalCatalogue() }
}

export function previewAnimalCatalogue() {
  const session = previewSession.value
  return session && session.situation !== 'injured' && !session.animalHelpRequested
    ? animalGroupsFixture.root
    : injuredAnimalTree
}

export function previewPageAdvice(screen: unknown) {
  if (screen === selfHelpFixture.screen) return selfHelpFixture.advice
  const view = contactFixtures.find(view => view.screen === screen)
  return view ? previewContactView(view).advice : undefined
}
export function previewThankYouView(view: ThankYouView) {
  const session = previewSession.value
  if (view.screen === 'W39a' && view.reasons) {
    const species =
      session?.animalIdentification?.kind === 'species' ? session.animalIdentification.speciesId : undefined
    const helped = injuredRouteFor(species)?.helped ?? []
    if (helped.length) {
      view = {
        ...view,
        reasons: {
          ...view.reasons,
          options: helped.map((label, index) =>
            label === 'Iné'
              ? {
                  id: 'other',
                  label,
                  description: { placeholder: 'Opíšte, kto pomohol', required: false, maxLength: 2000 }
                }
              : { id: `helped-${index}`, label }
          )
        }
      }
    }
  }
  const visited = session?.visitedHelp ?? []
  const showSharing =
    session?.situation === 'dead' ||
    session?.situation === 'cruelty' ||
    (['injured', 'stray'].includes(session?.situation ?? '') && view.screen === 'W25')
  const { outcome: _outcome, ...presentation } = view
  const outcome =
    view.screen === 'W39a'
      ? 'resolved'
      : view.outcome && (view.outcome === 'unresolved' || session?.completionOutcome === 'resolved')
        ? view.outcome
        : undefined
  return {
    ...presentation,
    ...(outcome ? { outcome } : {}),
    backTarget:
      view.screen === 'W26'
        ? (session?.closureReturnTarget ?? 'W01')
        : (session?.thankYouReturnTarget ?? view.backTarget),
    consents: view.consents.filter(consent => consent.id !== 'share-contact' || showSharing),
    ...(view.screen === 'W25' && view.reasons
      ? {
          reasons: {
            ...view.reasons,
            options: view.reasons.options.filter(reason => {
              if (reason.id.startsWith('municipality-')) return visited.includes('municipality_capture')
              if (reason.id.startsWith('clinic-'))
                return visited.includes('vet_clinic') || visited.includes('vet_exotic')
              if (reason.id.startsWith('police-')) return visited.includes('police')
              if (reason.id === 'volunteers') return visited.includes('volunteers')
              if (['equipment', 'unable'].includes(reason.id)) return visited.includes('self')
              return true
            })
          }
        }
      : {})
  }
}
export function previewContactView(view: ContactsView) {
  return isRoadFlow() && view.screen === 'W36' ? roadInstructionsFixture : view
}

// Simulates server availability/redirects for the current in-memory draft. This
// is not authorization; a real backend must validate the request independently.
export function previewAccess(screen: string): true | { name: string } {
  const session = previewSession.value
  const home = { name: 'W01' }
  if (!session) return home
  const located = !!session.location
  const identified = !!session.animalIdentification
  const ready = located && identified && !!session.adviceReady
  switch (screen) {
    case 'W26':
      return located || { name: 'W03' }
    case 'W14':
    case 'W15':
    case 'W15a':
    case 'W15b':
    case 'W15c':
    case 'W15d':
    case 'W15e':
    case 'W15f':
    case 'W20a':
    case 'W20b':
      return (isRoadFlow() && located && !!session.roadDetails?.road) || ready || home
    case 'W32':
      return session.situation === 'other' || home
    case 'W33':
      return (isRoadFlow() && located) || home
    case 'W37':
      return (isRoadFlow() && located && !!session.roadDetails?.road) || home
    case 'W27':
    case 'W28':
      return session.situation === 'cruelty' || home
    case 'W29':
    case 'W30':
      if (session.situation !== 'cruelty') return home
      return session.crueltyReport?.outcome === (screen === 'W29' ? 'reported' : 'not-reported') || { name: 'W28' }
    case 'W03':
      return session.situation === 'other' && !session.otherSituation && !session.closingDraft ? { name: 'W32' } : true
    case 'W04':
    case 'W06':
      return located || home
    case 'W09':
      return (located && (identified || !!session.identificationFailed)) || home
    case 'W40':
      return (located && identified) || home
    case 'W24':
      return (located && (identified || isRoadFlow()) && !!session.adviceReady) || home
    case 'W36':
      return (isRoadFlow() && located && !!session.roadDetails?.road) || ready || home
    default:
      return ready || home
  }
}

// Demonstration progress only; the eventual server payload supplies this value.
export function previewDraftProgress(screen: string) {
  if (['W27', 'W28', 'W29', 'W30', 'W32'].includes(screen)) return 0
  if (screen === 'W03') return locationFixture.props.progress
  if (screen === 'W04') return mediaFixture.props.progress
  if (screen === 'W06') return animalGroupsFixture.props.progress
  if (['W09', 'W40', 'W33'].includes(screen)) return previewDetailsView().copy.progress
  return 100
}
