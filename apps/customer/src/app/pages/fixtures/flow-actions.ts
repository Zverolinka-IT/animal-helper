import type { AnimalIdentification } from '../../animal-identification'
import type { OtherSituationChoice } from '../../contracts/other-situation'
import { beginPreview, confirmAnimalIdentification, confirmPreviewLocation, previewSession } from '../../preview-flow'
import type { HomeView } from '../home-view'
import type { CrueltyFollowupView } from './cruelty-followup'
import { flowPolicy } from './flow-scenarios'
import type { InstructionAction, InstructionsView } from './instructions'
import type { LocationPoint } from './location'
import { previewDraftProgress } from './preview-server'
import { previewDraftDismissed, suspendedPreview } from './preview-session'

// Mock command handlers. They return navigation results, never touch the router.
// The API implementation will validate commands and return authoritative state.
export const fixtureFlowActions = {
  start(view: HomeView, id: string) {
    if (!view.allowedActions.includes(id)) return
    if (id === 'draft-complete') {
      if (previewSession.value === suspendedPreview.value?.session) previewSession.value = null
      suspendedPreview.value = null
      previewDraftDismissed.value = true
      return
    }
    if (id === 'draft-resume' && suspendedPreview.value) {
      previewSession.value = suspendedPreview.value.session
      return suspendedPreview.value.screen
    }
    const action = view.previewActions[id]
    if (!action) return
    beginPreview(action.situation, action.fromDraft)
    return action.target
  },
  leave(screen: string) {
    if (!previewSession.value) return
    previewDraftDismissed.value = true
    suspendedPreview.value = { session: previewSession.value, screen, progress: previewDraftProgress(screen) }
    return 'W01'
  },
  readDraft(screen: string) {
    const draft = previewSession.value?.uiDrafts?.[screen]
    if (draft) delete previewSession.value!.uiDrafts![screen]
    return draft
  },
  saveDraft(screen: string, values: Record<string, unknown>) {
    const session = previewSession.value
    if (!session || suspendedPreview.value?.session !== session || suspendedPreview.value.screen !== screen) return
    session.uiDrafts ??= {}
    session.uiDrafts[screen] = values
  },
  chooseSituation(choice: OtherSituationChoice) {
    if (previewSession.value?.otherSituation !== choice.id) beginPreview('other')
    if (previewSession.value) previewSession.value.otherSituation = choice.id
    return choice.target
  },
  location(location: LocationPoint, target: string) {
    confirmPreviewLocation(location)
    return target
  },
  identify(identification: AnimalIdentification, target: string) {
    confirmAnimalIdentification(identification)
    return target
  },
  edit(target: string) {
    if (previewSession.value) previewSession.value.editingAnimal = true
    return target
  },
  details(answers: Record<string, string | string[]>, scope: 'animalDetails' | 'roadDetails', target: string) {
    const session = previewSession.value
    if (!session) return
    session[scope] = { ...answers }
    delete session.completionOutcome
    session.adviceReady = true
    if (target === flowPolicy.detailCompletionTarget) session.thankYouReturnTarget = flowPolicy.detailCompletionBack
    return target
  },
  saveDetails(answers: Record<string, string | string[]>, scope: 'animalDetails' | 'roadDetails') {
    const session = previewSession.value
    if (!session) return
    session[scope] = { ...answers }
    session.adviceReady = false
  },
  saveReport(view: CrueltyFollowupView, reasons: string[], description: string) {
    const session = previewSession.value
    if (!session || !view.reasons) return
    if (view.answerSource === 'other') session.otherReport ??= { reasons: [] }
    const report = view.answerSource === 'other' ? session.otherReport : session.crueltyReport
    if (!report) return
    report.reasons = [...reasons]
    if (reasons.includes('other')) report.description = description.trim()
    else delete report.description
  },
  continueCruelty(target: string) {
    if (previewSession.value) delete previewSession.value.crueltyReport
    return target
  },
  followup(view: CrueltyFollowupView, action: CrueltyFollowupView['actions'][number]) {
    if (!view.actions.includes(action)) return
    const session = previewSession.value
    if (view.answerSource === 'other' && session) session.documentingOther = true
    if (action.outcome && session && session.crueltyReport?.outcome !== action.outcome)
      session.crueltyReport = { outcome: action.outcome, reasons: [] }
    return action.target
  },
  instruction(view: InstructionsView, action: InstructionAction) {
    if (!view.allowedActions.includes(action.id) || !view.footerActions.includes(action)) return
    if (!(flowPolicy.instructionTargets as readonly string[]).includes(action.target)) return
    if (previewSession.value && (flowPolicy.thankYouTargets as readonly string[]).includes(action.target)) {
      previewSession.value.thankYouReturnTarget = view.screen
      if (action.id === 'resolved' || action.id === 'unresolved') previewSession.value.completionOutcome = action.id
    }
    return action.target
  },
  instructionBackTargets(view: InstructionsView): readonly string[] {
    return view.screen === 'W22' ? flowPolicy.contactScreens : [view.backTarget]
  },
  async processMedia(duration: number, target: string, signal: AbortSignal) {
    const session = previewSession.value
    if (!session || signal.aborted) return
    await new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, duration)
      signal.addEventListener('abort', done, { once: true })
    })
    if (signal.aborted || previewSession.value !== session) return
    if (flowPolicy.mediaResult === 'unidentified') {
      session.identificationFailed = true
      session.adviceReady = false
      delete session.animalIdentification
    }
    return target
  }
}
