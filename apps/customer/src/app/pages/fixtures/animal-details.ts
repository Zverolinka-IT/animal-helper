import type { AnimalDetailsView, DetailQuestion, EditAnimalView } from '../../contracts/forms'
export type { AnimalDetailsView, DetailQuestion, EditAnimalView } from '../../contracts/forms'
// Presentation fixtures only. Server supplies translated questions, choices and actions later.
export const animalDetailsFixture: AnimalDetailsView = {
  screen: 'W09a',
  locale: 'sk',
  layout: { showMenu: false },
  backTarget: 'W06',
  failedBackTarget: 'W04',
  editTarget: 'W40',
  manualTarget: 'W06',
  confirmTarget: 'W14',
  allowedActions: ['back', 'edit', 'confirm'],
  values: {} as Record<string, string | string[]>,
  copy: {
    back: 'Späť',
    step: 'Krok 3 z 4',
    progress: 75,
    title: 'Doplňte podrobnosti',
    description: 'Skontrolujte druh zvieraťa a označte, čo ste si všimli.',
    animal: 'Druh zvieraťa',
    edit: 'Upraviť',
    details: 'Detail situácie',
    unknown: 'Neidentifikované zviera',
    other: 'Iné zviera',
    failedTitle: 'Zviera sa nepodarilo identifikovať',
    failedDescription: 'AI nedokázala rozpoznať druh zvieraťa z fotografie. Vyberte ho manuálne.',
    failedPreview: 'Ukážka neúspešného rozpoznania. Žiadne súbory sa neodoslali a AI nebola volaná.',
    manual: 'Prejsť na manuálny výber',
    confirm: 'Zobraziť možnosti pomoci',
    preview: 'Lokálna ukážka: otázky a možnosti sú testovacie dáta, nie odpoveď servera.',
    completed: 'Údaje sú uložené lokálne. Možnosti pomoci zatiaľ nie sú zapojené.'
  },
  // Figma 989:2749: detail questions are optional; unknown remains exclusive.
  questions: [
    {
      id: 'symptoms',
      label: 'Čo je zvieraťu?',
      kind: 'multiple',
      required: false,
      options: [
        { id: 'bleeding', label: 'Krváca' },
        { id: 'poisoned', label: 'Zviera je pravdepodobne otrávené' },
        { id: 'foam', label: 'Má penu okolo papule' },
        { id: 'collision', label: 'Zrazené' },
        { id: 'vomiting', label: 'Zvracia' },
        { id: 'limping', label: 'Kríva' },
        { id: 'unknown', label: 'Neviem', exclusive: true },
        { id: 'other', label: 'Iné', description: 'Stručne opíšte iné zranenie alebo stav zvieraťa' }
      ]
    },
    {
      id: 'conscious',
      label: 'Je zviera pri vedomí?',
      kind: 'single',
      required: false,
      options: [
        { id: 'yes', label: 'Áno' },
        { id: 'no', label: 'Nie' },
        { id: 'unknown', label: 'Neviem' }
      ]
    },
    {
      id: 'juvenile',
      label: 'Ide o mláďa?',
      kind: 'single',
      required: false,
      options: [
        { id: 'yes', label: 'Áno' },
        { id: 'no', label: 'Nie' },
        { id: 'unknown', label: 'Neviem' }
      ]
    }
  ] as DetailQuestion[]
}

export const editAnimalFixture: EditAnimalView = {
  screen: 'W40',
  locale: 'sk',
  layout: { showMenu: false },
  backTarget: 'W09',
  mediaTarget: 'W04',
  manualTarget: 'W06',
  allowedActions: ['back', 'search', 'media', 'manual'],
  copy: {
    back: 'Späť',
    step: 'Krok 3 z 4',
    progress: 75,
    title: 'Upravte druh zvieraťa',
    description:
      'Vyhľadajte zviera textovým výberom, nahrajte novú fotografiu alebo prejdite na manuálny výber zvieraťa.',
    search: 'Vyhľadať zviera',
    results: 'Ukážkové zvieratá',
    empty: 'V ukážkovom číselníku sa nenašla zhoda.',
    media: 'Nahrať novú fotografiu alebo video',
    manual: 'Prejsť na manuálny výber zvieraťa',
    preview: 'Lokálna ukážka číselníka. AI rozpoznávanie zatiaľ nie je zapojené.'
  }
}
