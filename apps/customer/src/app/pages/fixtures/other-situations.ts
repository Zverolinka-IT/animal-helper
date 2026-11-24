import { animalDetailsFixture, type AnimalDetailsView } from './animal-details'
import { patrolFixture } from './contacts'
import { policeFailedFixture, type CrueltyFollowupView } from './cruelty-followup'
import type { InstructionsView } from './instructions'

import type { OtherSituationView } from '../../contracts/other-situation'
export const otherSituationFixture: OtherSituationView = {
  screen: 'W32',
  locale: 'sk',
  layout: { showMenu: false },
  backTarget: 'W01',
  copy: { back: 'Späť', title: 'V akej situácii je zviera?' },
  // Road/rail and human-activity choices stay implemented, but are hidden until
  // those branches are ready. The remaining choice sends the report to Zverolinka.
  choices: [{ id: 'other', label: 'Iná situácia', target: 'W03' }] as const
}
export const otherFailedFixture: CrueltyFollowupView = {
  ...policeFailedFixture,
  screen: 'W37',
  answerSource: 'other',
  backTarget: 'W36',
  copy: { ...policeFailedFixture.copy, description: 'Zaškrtnite, čo sa stalo, a pokračujte v zdokumentovaní prípadu.' },
  reasons: {
    title: 'Prečo sa prípad nepodarilo nahlásiť?',
    options: [
      { id: 'unanswered', label: 'Nedvihli mi' },
      { id: 'refused', label: 'Odmietli zasiahnuť' },
      { id: 'no-time', label: 'Nemal/a som čas to riešiť' },
      { id: 'other', label: 'Iné', description: { placeholder: 'Opíšte, čo sa stalo', maxLength: 2000 } }
    ]
  },
  actions: [{ label: 'Zdokumentovať prípad', target: 'W04', primary: true }]
}
export const roadDetailsFixture: AnimalDetailsView = {
  ...animalDetailsFixture,
  screen: 'W33',
  showAnimal: false,
  backTarget: 'W03',
  confirmTarget: 'W36',
  copy: {
    ...animalDetailsFixture.copy,
    step: 'Krok 2 z 2',
    progress: 100,
    title: 'Doplňte podrobnosti o zvierati',
    description: '',
    details: ''
  },
  questions: [
    {
      id: 'road',
      label: 'Situácia na ceste',
      hideLabel: true,
      kind: 'single',
      required: true,
      options: [
        { id: 'near-road', label: 'Pohybuje sa na alebo pri frekventovanej ceste (nie diaľnici)' },
        { id: 'near-highway', label: 'Pohybuje sa na alebo pri diaľnici' },
        { id: 'hit-road', label: 'Zrazené leží na ceste (nie diaľnici)' },
        { id: 'hit-highway', label: 'Zrazené leží na diaľnici' },
        { id: 'railway', label: 'Je na koľajniciach' },
        { id: 'other', label: 'Iné', description: 'Opíšte situáciu' }
      ]
    }
  ]
}
export const humanDetailsFixture: AnimalDetailsView = {
  ...animalDetailsFixture,
  screen: 'W34',
  copy: {
    ...animalDetailsFixture.copy,
    description: 'Skontrolujte druh zvieraťa a vyberte možnosť, ktorá najlepšie opisuje situáciu.'
  },
  questions: [
    {
      id: 'human',
      label: 'Detail situácie',
      hideLabel: true,
      kind: 'single',
      required: false,
      options: [
        { id: 'field', label: 'Kombajn/iné práce na poli' },
        { id: 'trees', label: 'Výrub stromu/ov' },
        { id: 'building', label: 'Stavebné práce' },
        { id: 'fire', label: 'Vypaľovanie/požiar' },
        { id: 'trapped', label: 'Zviera je zaseknuté v plote alebo spadlo do šachty/komína/kanála a pod.' },
        { id: 'inside', label: 'Zviera je uväznené v budove' },
        { id: 'other', label: 'Iné', description: 'Opíšte situáciu' }
      ]
    }
  ]
}
export const otherDetailsFixture: AnimalDetailsView = {
  ...animalDetailsFixture,
  screen: 'W35',
  confirmTarget: 'W39',
  copy: {
    ...animalDetailsFixture.copy,
    step: 'Krok 2 z 2',
    progress: 100,
    title: 'Druh zvieraťa',
    description: '',
    animal: 'Identifikovaný druh zvieraťa',
    details: '',
    confirm: 'Potvrdiť'
  },
  questions: []
}
// A presentation showcase, not an emergency-services routing decision. Backend
// selects the actual service; no live phone numbers are supplied in this fixture.
export const roadInstructionsFixture: InstructionsView = {
  ...patrolFixture,
  backTarget: 'W33',
  copy: {
    ...patrolFixture.copy,
    preview:
      'Ukážka kontaktu na diaľničnú patrolu pre všetky voľby. Správny kontakt podľa situácie určí server; volanie tu nie je zapojené.'
  },
  allowedActions: ['back', 'resolved', 'unresolved'],
  footerActions: [
    { id: 'resolved', label: 'Podarilo sa pomôcť', appearance: 'primary', target: 'W24' },
    { id: 'unresolved', label: 'Nepodarilo sa pomôcť', appearance: 'secondary', target: 'W37' }
  ]
}

// General “other” includes a description; road documentation only identifies the animal.
// Figma examples 1603:5185 / 1603:5286.
export const generalOtherDetailsFixture: AnimalDetailsView = {
  ...otherDetailsFixture,
  copy: {
    ...animalDetailsFixture.copy,
    step: 'Krok 3 z 3',
    progress: 100,
    description: 'Skontrolujte druh zvieraťa a doplňte detaily o jeho stave.',
    confirm: 'Nahlásiť'
  },
  questions: [
    {
      id: 'description',
      label: 'Opíšte situáciu',
      kind: 'text',
      required: false,
      options: [],
      placeholder: 'Čo sa stalo?'
    }
  ]
}
