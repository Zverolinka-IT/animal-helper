import { formSnapshotV1Schema, type FormSnapshotV1 } from '@animal-helper/contracts'
import { findAnimalKind } from '@animal-helper/guidance'
import type { previewSession } from '../pages/fixtures/preview-session'

type Session = NonNullable<typeof previewSession.value>
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const list = (value: unknown) => (Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [])
const ternary = (value: unknown) => (['yes', 'no', 'unknown'].includes(String(value)) ? value : undefined)
const symptoms: Record<string, string> = {
  bleeding: 'bleeding',
  poisoned: 'poison_suspected',
  foam: 'foam',
  collision: 'hit',
  vomiting: 'vomiting',
  limping: 'limping',
  unknown: 'unknown',
  other: 'other'
}

export function reportSnapshot(session: Session, closure?: FormSnapshotV1['closure']): FormSnapshotV1 {
  const answers = session.animalDetails ?? {}
  const identification = session.animalIdentification
  const kind = identification?.kind === 'species' ? findAnimalKind(identification.speciesId) : undefined
  const species = kind
    ? { source: 'manual', kindKey: kind.key, groupKey: kind.groupKey, categoryKey: kind.categoryKey }
    : {
        source: identification?.kind === 'unknown' ? 'failed' : 'skipped',
        ...(identification?.kind === 'other' ? { description: text(identification.description) } : {})
      }
  const injury = session.situation === 'injured' || session.animalHelpRequested
  const selectedSymptoms = injury ? list(answers.symptoms).flatMap(id => (symptoms[id] ? [symptoms[id]] : [])) : []
  const behaviour = session.situation === 'stray' ? list(answers.behaviour) : undefined
  return formSnapshotV1Schema.parse({
    schemaVersion: 1,
    situationType: session.situation,
    species,
    condition: {
      symptoms: selectedSymptoms,
      otherText: selectedSymptoms.includes('other')
        ? text(answers['symptoms:other'])
        : behaviour?.includes('other')
          ? text(answers['behaviour:other'])
          : undefined,
      ...(injury ? { conscious: ternary(answers.conscious) } : {}),
      ...(injury || behaviour ? { isJuvenile: ternary(answers.juvenile) } : {}),
      ...(behaviour ? { behaviour, collar: ternary(answers.collar) } : {})
    },
    ...(session.situation === 'dead'
      ? {
          dead: {
            suspiciousSigns: list(answers.suspiciousSigns),
            animalCount: text(answers.animalCount),
            description: list(answers.suspiciousSigns).includes('unknown')
              ? text(answers['suspiciousSigns:unknown'])
              : undefined
          }
        }
      : {}),
    ...(session.situation === 'cruelty'
      ? {
          cruelty: {
            acute: !!session.crueltyReport,
            signs: list(answers.cruelty),
            description: text(answers.description),
            ...(session.crueltyReport
              ? { police: { ...session.crueltyReport, description: text(session.crueltyReport.description) } }
              : {})
          }
        }
      : {}),
    ...(session.situation === 'other' &&
    session.otherSituation &&
    !(closure && session.otherSituation === 'road' && !session.roadDetails?.road)
      ? {
          other:
            session.otherSituation === 'road'
              ? {
                  branch: 'road',
                  situation: session.roadDetails?.road,
                  description:
                    session.roadDetails?.road === 'other' ? text(session.roadDetails['road:other']) : undefined,
                  ...(session.otherReport
                    ? { serviceReport: { ...session.otherReport, description: text(session.otherReport.description) } }
                    : {}),
                  ...(session.animalHelpRequested ? { animalHelpRequested: true } : {})
                }
              : session.otherSituation === 'human'
                ? {
                    branch: 'human',
                    situation: text(answers.human),
                    description: answers.human === 'other' ? text(answers['human:other']) : undefined
                  }
                : { branch: 'other', description: text(answers.description) }
        }
      : {}),
    ...(closure ? { closure } : {}),
    mediaRecordIds: []
  })
}
