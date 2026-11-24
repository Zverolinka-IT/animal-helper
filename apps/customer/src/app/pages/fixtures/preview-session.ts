import type { ContactServiceKey, ReportOutcome } from '@animal-helper/contracts'
import { ref } from 'vue'
import type { AnimalIdentification } from '../../animal-identification'
import type { LocationPoint } from '../../contracts/forms'

// In-memory fixture session only. Replace with a validated server view adapter.
export const previewSession = ref<{
  uiDrafts?: Record<string, Record<string, unknown>>
  situation: string
  fromDraft: boolean
  otherSituation?: 'road' | 'human' | 'other'
  otherReport?: { reasons: string[]; description?: string }
  documentingOther?: boolean
  animalHelpRequested?: boolean
  closingDraft?: boolean
  reportResumeScreen?: string
  closureReturnTarget?: string
  crueltyReport?: { outcome: 'reported' | 'not-reported'; reasons: string[]; description?: string }
  editingAnimal?: boolean
  identificationFailed?: boolean
  adviceReady?: boolean
  completionOutcome?: ReportOutcome['status']
  visitedHelp?: (ContactServiceKey | 'self')[]
  thankYouReturnTarget?: string
  animalDetails?: Record<string, string | string[]>
  roadDetails?: Record<string, string | string[]>
  location?: LocationPoint
  media?: File[]
  animalIdentification?: AnimalIdentification
} | null>(null)

export function beginPreview(situation: string, fromDraft = false) {
  previewSession.value = { situation, fromDraft }
}

export function finishPreview() {
  if (suspendedPreview.value?.session === previewSession.value) suspendedPreview.value = null
  previewSession.value = null
}

export function confirmPreviewLocation(location: LocationPoint) {
  const session = previewSession.value
  if (!session) return
  if (session.location?.lat !== location.lat || session.location?.lng !== location.lng) {
    session.adviceReady = false
    delete session.thankYouReturnTarget
    delete session.completionOutcome
    delete session.otherReport
    delete session.documentingOther
    // Road contacts have their own availability guard, independent of adviceReady.
    delete session.roadDetails
  }
  session.location = { ...location }
}

export function confirmAnimalIdentification(identification: AnimalIdentification) {
  const session = previewSession.value
  if (!session) return
  session.animalIdentification = { ...identification, path: [...identification.path] }
  session.editingAnimal = false
  session.identificationFailed = false
  session.adviceReady = false
  delete session.completionOutcome
}

// One suspended case for the local preview; files and form drafts stay in memory.
export const suspendedPreview = ref<{
  session: NonNullable<typeof previewSession.value>
  screen: string
  progress: number
} | null>(null)
export const previewDraftDismissed = ref(false)
