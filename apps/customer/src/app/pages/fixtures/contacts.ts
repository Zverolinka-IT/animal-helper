import type { ContactDirectoryEntry } from '@animal-helper/contracts'
import { adviceFixture } from './advice'
import type { InstructionsView } from './instructions'
// Working presentation contract, not a live directory or a recommendation engine.
export type ContactLink = { label: string; href?: string }
export type ContactBlock =
  | {
      id: string
      kind: 'contact'
      title: string
      distance?: string
      address?: string
      availability?: { label: string; tone: 'open' | 'closing' | 'closed' | 'unknown' }
      phone?: ContactLink
      navigation?: ContactLink
      website?: ContactLink
      note?: string
      hours?: ContactDirectoryEntry['hours']
      reviewDueOn?: string
    }
  | {
      id: string
      kind: 'notice'
      emphasis: 'important' | 'critical'
      title: string
      description: string
      strong?: string
    }
  | { id: string; kind: 'instructions'; title: string; items: { id: string; text: string }[] }
  | { id: string; kind: 'link'; description: string; link: ContactLink }
export type ContactsView = Omit<InstructionsView, 'screen' | 'blocks' | 'footerActions' | 'allowedActions'> & {
  screen: Exclude<InstructionsView['screen'], 'W22'>
  blocks: ContactBlock[]
  allowedActions: ('back' | 'resolved' | 'alternatives')[]
  footerActions: (
    | { id: 'resolved'; label: string; appearance: 'primary' | 'secondary'; target: 'W24' | 'W39a' }
    | { id: 'alternatives'; label: string; appearance: 'primary' | 'secondary'; target: 'W15' | 'W22' }
  )[]
}
export const municipalityFixture: ContactsView = {
  screen: 'W15',
  locale: 'sk',
  layout: { showMenu: false },
  advice: {
    triggerLabel: 'Rady',
    locale: adviceFixture.locale,
    copy: {
      drawerTitle: adviceFixture.copy.drawerTitle,
      closeAdvice: adviceFixture.copy.closeAdvice,
      acknowledge: adviceFixture.copy.acknowledge
    },
    blocks: structuredClone(adviceFixture.blocks)
  },
  backTarget: 'W14',
  footerActions: [
    { id: 'resolved', label: 'Podarilo sa pomôcť', appearance: 'primary', target: 'W24' },
    { id: 'alternatives', label: 'Iné možnosti pomoci', appearance: 'secondary', target: 'W22' }
  ],
  allowedActions: ['back', 'resolved', 'alternatives'],
  copy: {
    back: 'Späť',
    title: 'Kontaktujte mesto alebo obec',
    description:
      'Obec má zo zákona povinnosť zabezpečiť odchyt túlavých zvierat a ich umiestnenie do útulku, a to aj v prípade, ak sú zranené. Obci oznámte, kde sa zviera nachádza a v akom je stave.',
    preview: 'Lokálna ukážka kontaktov. Údaje nie sú skutočné; volanie ani navigácia nie sú zapojené.',
    unavailable: 'Ďalší postup zatiaľ nie je zapojený. Žiadne hlásenie sa neodoslalo.'
  },
  blocks: [
    {
      id: 'municipality',
      kind: 'contact',
      title: 'Ukážková obec',
      distance: '300 m',
      address: 'Ukážková adresa obce',
      availability: { label: 'Otvorené 8:00–16:00', tone: 'open' },
      phone: { label: 'Telefón doplní server' }
    },
    {
      id: 'duty',
      kind: 'notice',
      emphasis: 'critical',
      title: 'Dôležité!',
      description: 'Útulky a dobrovoľníci sú na hranici svojich možností a nemôžu nahrádzať povinnosti obcí.',
      strong: 'Iné možnosti pomoci využite, až keď ste sa opakovane pokúsili získať pomoc od obce, no neuspeli ste.'
    }
  ]
}
export const clinicFixture: ContactsView = {
  ...municipalityFixture,
  screen: 'W18',
  copy: {
    ...municipalityFixture.copy,
    title: 'Môžete kontaktovať veterinárnu kliniku',
    description: 'Vybrali sme najbližšie veterinárne kliniky vo vašom okolí, ktoré majú momentálne otvorené.'
  },
  blocks: [
    {
      id: 'cost',
      kind: 'notice',
      emphasis: 'important',
      title: 'Pozor, nebude to bezplatné',
      description:
        'Ak si objednáte ošetrenie veterinára, náklady budete musieť uhradiť vy, pokiaľ sa vopred nedohodnete inak. Niektoré veterinárne pracoviská poskytujú aj pohotovosť a výjazdy. Vopred si telefonicky overte ich dostupnosť a prípadné príplatky. Spoluprácu s klinikami ešte pripravujeme. Zatiaľ vám zobrazujeme najbližšie veterinárne pracoviská.'
    },
    ...(['open', 'closing', 'closed'] as const).map((tone, index): ContactBlock => ({
      id: 'clinic-' + index,
      kind: 'contact',
      title: ['Ukážková klinika Labka', 'Ukážková klinika Chvostík', 'Ukážková klinika Fúzik'][index]!,
      distance: ['300 m', '1,3 km', '2 km'][index]!,
      address: 'Ukážková adresa kliniky',
      availability: { tone, label: ['Otvorené 8:00–16:00', 'Čoskoro zatvára', 'Zatvorené'][index]! },
      phone: { label: 'Telefón doplní server' },
      navigation: { label: 'Navigovať ku klinike' }
    }))
  ]
}
export const policeFixture: ContactsView = {
  ...municipalityFixture,
  screen: 'W20',
  copy: {
    ...municipalityFixture.copy,
    title: 'Zavolajte na políciu',
    description: 'Ukážka kontaktu a pokynov, ktoré pre konkrétny prípad určí server.'
  },
  blocks: [
    { id: 'police', kind: 'contact', title: 'Tiesňové číslo polície', phone: { label: 'Telefón doplní server' } },
    {
      id: 'instructions',
      kind: 'instructions',
      title: 'Polícii nadiktujte:',
      items: [
        { id: 'location', text: 'Miesto udalosti' },
        { id: 'situation', text: 'Informácie o situácii a zvierati' }
      ]
    },
    {
      id: 'important',
      kind: 'notice',
      emphasis: 'important',
      title: 'Dôležité upozornenie',
      description: 'Tu bude doplňujúci pokyn zo servera.'
    },
    {
      id: 'critical',
      kind: 'notice',
      emphasis: 'critical',
      title: 'Veľmi dôležité upozornenie',
      description: 'Ukážka výrazného upozornenia. Konkrétny text a ďalší postup dodá server.'
    }
  ]
}
export const volunteersFixture: ContactsView = {
  ...municipalityFixture,
  screen: 'W21',
  copy: {
    ...municipalityFixture.copy,
    title: 'Obráťte sa na dobrovoľníkov',
    description: 'Tu bude kontakt na dobrovoľníkov vo vašom regióne.'
  },
  blocks: [
    { id: 'volunteers', kind: 'link', description: 'O pomoc môžete požiadať', link: { label: 'našich dobrovoľníkov' } }
  ]
}
export const patrolFixture: ContactsView = {
  ...municipalityFixture,
  screen: 'W36',
  layout: { showMenu: false },
  copy: {
    ...municipalityFixture.copy,
    title: 'Zavolajte diaľničnú patrolu',
    description: 'Kontaktné údaje a postup pre túto situáciu dodá server.'
  },
  blocks: [
    {
      id: 'instructions',
      kind: 'instructions',
      title: 'Do telefónu jasne nadiktujte:',
      items: [
        { id: 'location', text: 'Lokalitu' },
        { id: 'animal', text: 'Druh a stav zvieraťa' }
      ]
    },
    {
      id: 'patrol',
      kind: 'contact',
      title: 'Ukážková diaľničná patrola',
      distance: '900 m',
      address: 'Ukážková adresa',
      phone: { label: 'Telefón doplní server' }
    }
  ]
}
export const contactsShowcaseFixture: ContactsView = {
  ...municipalityFixture,
  copy: {
    ...municipalityFixture.copy,
    title: 'Možnosti kontaktovania',
    description: 'Prehľad všetkých podporovaných kontaktných kariet a upozornení v jednej ukážke.'
  },
  blocks: [municipalityFixture, clinicFixture, policeFixture, volunteersFixture, patrolFixture].flatMap(view =>
    view.blocks.map(block => ({ ...block, id: `${view.screen}-${block.id}` }))
  )
}
export const secondaryContactFixture: ContactsView = {
  ...clinicFixture,
  screen: 'W19',
  copy: {
    ...clinicFixture.copy,
    title: 'Kontaktujte veterinárnu kliniku',
    description: 'Chránených živočíchov prevezmú bezplatne.'
  },
  blocks: clinicFixture.blocks.filter(block => block.kind !== 'notice')
}
export const contactFixtures = [
  contactsShowcaseFixture,
  clinicFixture,
  secondaryContactFixture,
  policeFixture,
  volunteersFixture,
  patrolFixture
]

export function safeContactHref(href: string | undefined, type: 'phone' | 'web'): string | undefined {
  if (!href) return undefined
  if (type === 'phone') return /^tel:\+?[\d ()-]+$/.test(href) ? href : undefined
  try {
    const url = new URL(href)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}
