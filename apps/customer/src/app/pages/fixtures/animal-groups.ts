// Presentation fixture populated from the shared product catalogue; not an API adapter.
import type { FormValidation } from '../../contracts/validation'
import { animalCatalogueTree } from './animal-tree'
export type AnimalGroupsView = {
  validation?: FormValidation
  screen: 'W06a'
  locale: string
  layout: { showMenu: boolean }
  backTarget: string
  confirmTarget: string
  allowedActions: ('back' | 'select-group' | 'search' | 'select-animal' | 'confirm')[]
  copy: {
    restart: string
    alternatives: string
    unknown: string
    description: string
    confirm: string
    completed: string
  }
  props: {
    back: string
    step: string
    progress: number
    title: string
    description: string
    search: string
    preview: string
    results: string
    empty: string
  }
  root: AnimalBranch
}

export type AnimalNode =
  AnimalBranch | { kind: 'animal'; id: string; label: string; detail: string; imageUrl?: string; speciesKey?: string }

export type AnimalBranch = {
  kind: 'branch'
  id: string
  label: string
  otherLabel: string
  imageUrl?: string
  children: AnimalNode[]
}

export const animalGroupsFixture: AnimalGroupsView = {
  screen: 'W06a',
  locale: 'sk',
  layout: { showMenu: false },
  backTarget: 'W04',
  confirmTarget: 'W09',
  allowedActions: ['back', 'select-group', 'search', 'select-animal', 'confirm'],
  copy: {
    restart: 'Začať výber odznova',
    alternatives: 'Ďalšie možnosti',
    unknown: 'Neviem identifikovať',
    description: 'Popis zvieraťa',
    confirm: 'Potvrdiť voľbu',
    completed: 'Výber je uložený iba v lokálnej ukážke. Krok 3 – Údaje o zvierati ešte pripravujeme.'
  },
  props: {
    back: 'Späť',
    step: 'Krok 2 z 4',
    progress: 50,
    title: 'O aké zviera ide?',
    description: 'Vyhľadajte zviera alebo ho nájdite postupným výberom.',
    search: 'Vyhľadať zviera',
    preview: 'Katalóg zvierat z produktových podkladov. Obrázky doplníme neskôr.',
    results: 'Zvieratá',
    empty: 'V katalógu sa nenašla zhoda.'
  },
  root: animalCatalogueTree
}
