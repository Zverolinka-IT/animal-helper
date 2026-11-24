import type { AnimalDetailsView } from '../../contracts/forms'
import { animalDetailsFixture } from './animal-details'
import { crueltyDetailsFixture } from './cruelty'
import { generalOtherDetailsFixture, humanDetailsFixture, otherDetailsFixture } from './other-situations'
import { deadDetailsFixture, strayDetailsFixture } from './situation-details'

// Temporary server-side policy expressed as preview data. These scenarios are
// not client business rules and must be replaced by backend responses.
export const flowScenarios: Record<
  string,
  {
    location: { confirmTarget: string; backTarget: string; backHistoryTargets: string[] }
    details: AnimalDetailsView
  }
> = {
  standard: {
    location: { confirmTarget: 'W04', backTarget: 'W01', backHistoryTargets: [] },
    details: animalDetailsFixture
  },
  stray: {
    location: { confirmTarget: 'W04', backTarget: 'W01', backHistoryTargets: [] },
    details: strayDetailsFixture
  },
  dead: {
    location: { confirmTarget: 'W04', backTarget: 'W01', backHistoryTargets: [] },
    details: deadDetailsFixture
  },
  cruelty: {
    location: { confirmTarget: 'W04', backTarget: 'W27', backHistoryTargets: ['W27', 'W29', 'W30'] },
    details: crueltyDetailsFixture
  },
  road: {
    location: { confirmTarget: 'W33', backTarget: 'W32', backHistoryTargets: ['W32'] },
    details: otherDetailsFixture
  },
  human: {
    location: { confirmTarget: 'W04', backTarget: 'W32', backHistoryTargets: ['W32'] },
    details: humanDetailsFixture
  },
  other: {
    location: { confirmTarget: 'W04', backTarget: 'W32', backHistoryTargets: ['W32'] },
    details: generalOtherDetailsFixture
  }
}

export const flowPolicy = {
  documentedMediaBack: 'W37',
  detailCompletionTarget: 'W39',
  detailCompletionBack: 'W09',
  instructionTargets: ['W22', 'W24', 'W25', 'W37'],
  thankYouTargets: ['W24', 'W25'],
  contactScreens: ['W15', 'W18', 'W19', 'W20', 'W21', 'W36'],
  mediaResult: 'unidentified'
} as const
