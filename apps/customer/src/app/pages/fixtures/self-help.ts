import catImage from '@/assets/demo/macka.png'
import dogImage from '@/assets/demo/pes.png'
import birdImage from '@/assets/demo/vtak.png'
import { municipalityFixture } from './contacts'
import type { InstructionsView } from './instructions'
// Working presentation contract. Real instructions must be supplied and approved by the server.
export type HelpImage = { id: string; src?: string; alt: string; caption: string }
export type HelpText = { text: string; emphasis?: 'strong' | 'em'; href?: string }[]
export type SelfHelpBlock =
  | { id: string; kind: 'section'; title: string; paragraphs: HelpText[] }
  | { id: string; kind: 'list'; title: string; ordered: boolean; items: { id: string; content: HelpText }[] }
  | { id: string; kind: 'notice'; tone: 'danger' | 'warning'; title: string; content: HelpText }
  | { id: string; kind: 'divider' }
  | { id: string; kind: 'images'; title?: string; items: HelpImage[] }
export type SelfHelpView = Omit<InstructionsView, 'screen' | 'blocks' | 'footerActions' | 'allowedActions'> & {
  screen: 'W22' | 'W22a' | 'W22b' | 'W22d'
  blocks: SelfHelpBlock[]
  allowedActions: ('back' | 'resolved' | 'unresolved')[]
  footerActions: (
    | { id: 'resolved'; label: string; appearance: 'primary' | 'secondary'; target: 'W24' | 'W39a' }
    | { id: 'unresolved'; label: string; appearance: 'primary' | 'secondary'; target: 'W25' }
  )[]
}
export const selfHelpFixture: SelfHelpView = {
  screen: 'W22',
  locale: 'sk',
  layout: { showMenu: false },
  ...(municipalityFixture.advice ? { advice: structuredClone(municipalityFixture.advice) } : {}),
  backTarget: 'W15',
  footerActions: [
    { id: 'resolved', label: 'Podarilo sa pomôcť', appearance: 'primary', target: 'W24' },
    { id: 'unresolved', label: 'Nepodarilo sa pomôcť', appearance: 'secondary', target: 'W25' }
  ],
  allowedActions: ['back', 'resolved', 'unresolved'],
  copy: {
    title: 'Pomôžte sami',
    description: 'Tu sa zobrazí postup pomoci prispôsobený vášmu hláseniu.',
    back: 'Späť',
    preview: 'Lokálna ukážka rozloženia. Texty nie sú pokynmi na ošetrenie ani manipuláciu so zvieraťom.',
    unavailable: 'Nasledujúca stránka zatiaľ nie je pripravená. Žiadny výsledok sa neodoslal.'
  },
  blocks: [
    {
      id: 'warning',
      kind: 'notice',
      tone: 'danger',
      title: 'Ukážka dôležitého upozornenia',
      content: [{ text: 'Konkrétne upozornenie pre tento prípad dodá server.' }]
    },
    {
      id: 'preparation',
      kind: 'section',
      title: 'Príprava na pomoc',
      paragraphs: [
        [{ text: 'Na tomto mieste bude úvodný text postupu schváleného pre danú situáciu.' }],
        [{ text: 'Dôležité časti', emphasis: 'strong' }, { text: ' môžu byť zvýraznené priamo v odseku.' }],
        [
          { text: 'Ukážkové ilustrácie: ' },
          { text: 'OpenMoji', href: 'https://openmoji.org/' },
          { text: ' · ' },
          { text: 'licencia CC BY-SA 4.0', href: 'https://creativecommons.org/licenses/by-sa/4.0/' }
        ]
      ]
    },
    {
      id: 'steps',
      kind: 'list',
      title: 'Postup pomoci',
      ordered: true,
      items: [
        { id: 'first', content: [{ text: 'Prvý krok doplní server podľa údajov z hlásenia.' }] },
        {
          id: 'second',
          content: [{ text: 'Ďalší krok môže obsahovať ' }, { text: 'doplňujúce vysvetlenie.', emphasis: 'em' }]
        }
      ]
    },
    { id: 'divider', kind: 'divider' },
    {
      id: 'notes',
      kind: 'list',
      title: 'Doplňujúce informácie',
      ordered: false,
      items: [{ id: 'note', content: [{ text: 'Počet, poradie aj obsah týchto bodov určuje server.' }] }]
    },
    {
      id: 'important',
      kind: 'notice',
      tone: 'warning',
      title: 'Ďalšie upozornenie',
      content: [{ text: 'Aj tento blok je iba ukážkou formátovania, nie konkrétnou radou.' }]
    },
    {
      id: 'illustrations',
      kind: 'images',
      title: 'Ukážka obrázkových kariet',
      items: [
        { id: 'cat', src: catImage, alt: 'Ilustrácia mačky', caption: 'Mačka — ukážka' },
        { id: 'dog', src: dogImage, alt: 'Ilustrácia psa', caption: 'Pes — ukážka' },
        { id: 'bird', src: birdImage, alt: 'Ilustrácia vtáka', caption: 'Vták — ukážka' },
        { id: 'placeholder', alt: 'Obrázok zatiaľ nie je dostupný', caption: 'Ukážka bez obrázka' }
      ]
    }
  ]
}
