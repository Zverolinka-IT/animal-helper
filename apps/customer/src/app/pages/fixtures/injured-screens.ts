import { municipalityFixture, type ContactBlock, type ContactsView } from './contacts'
import { selfHelpFixture, type SelfHelpView } from './self-help'

const preview = municipalityFixture.copy.preview
const unavailable = municipalityFixture.copy.unavailable
const back = municipalityFixture.copy.back
const advice = municipalityFixture.advice
const continueHelp = municipalityFixture.footerActions

const municipalDuty: ContactBlock = {
  id: 'duty',
  kind: 'notice',
  emphasis: 'critical',
  title: 'Dôležité!',
  description: 'Útulky a dobrovoľníci sú na hranici svojich možností a nemôžu nahrádzať povinnosti obcí.',
  strong: 'Iné možnosti pomoci využite, až keď ste sa opakovane pokúsili získať pomoc od obce, no neuspeli ste.'
}
const veterinaryDuty: ContactBlock = {
  id: 'veterinary-duty',
  kind: 'notice',
  emphasis: 'critical',
  title: 'Dôležité!',
  description:
    'Ak odchytené zviera nie je spoločenským zvieraťom a nemožno ho odovzdať chovateľovi, odchytová služba má zo zákona povinnosť informovať regionálnu veterinárnu správu. Veterinárny inšpektor určí ďalší postup. Ak obec alebo odchytová služba o tejto povinnosti nevie, upozornite ju.'
}
const police: ContactBlock = {
  id: 'municipal-police',
  kind: 'contact',
  title: 'Mestská polícia',
  phone: { label: '159', href: 'tel:159' }
}

function contactScreen(
  screen: ContactsView['screen'],
  title: string,
  description: string,
  blocks: ContactBlock[],
  footer = continueHelp
): ContactsView {
  return {
    ...municipalityFixture,
    screen,
    ...(advice ? { advice: structuredClone(advice) } : {}),
    footerActions: footer,
    copy: { ...municipalityFixture.copy, title, description, preview, unavailable, back },
    blocks
  }
}

const sampleMunicipality: ContactBlock = {
  id: 'municipality',
  kind: 'contact',
  title: 'Obec Horná dolná',
  phone: { label: '+421 902 123 123', href: 'tel:+421902123123' }
}

export const farmMunicipalityFixture = contactScreen(
  'W15a',
  'Kontaktujte mesto alebo obec',
  'Obec má zo zákona povinnosť zabezpečiť odchyt túlavých zvierat vrátane hospodárskych či exotických, ak sa pohybujú bez kontroly na verejnom priestranstve a ich chovateľ nie je známy. Obci oznámte polohu a stav zvieraťa.',
  [sampleMunicipality, veterinaryDuty]
)
export const natureAuthorityFixture = contactScreen(
  'W15b',
  'Kontaktujte Štátnu ochranu prírody',
  'Štátna ochrana prírody SR zabezpečuje pomoc zraneným chráneným živočíchom vrátane ich odchytu, prevozu a potrebnej starostlivosti. ŠOP oznámte, kde sa zviera nachádza a v akom je stave.',
  [
    {
      id: 'sop',
      kind: 'contact',
      title: 'Správa CHKO Malé Karpaty',
      address: 'Štúrova 115, 900 01 Modra',
      phone: { label: '+421 902 123 123', href: 'tel:+421902123123' }
    },
    {
      id: 'station',
      kind: 'contact',
      title: 'Záchranná stanica a Ekocentrum Zázrivá',
      address: 'Dolina 61, 027 05 Zázrivá',
      phone: { label: '+421 903 504 470', href: 'tel:+421903504470' }
    },
    {
      id: 'duty',
      kind: 'notice',
      emphasis: 'critical',
      title: 'Dôležité!',
      description: 'Dobrovoľníci sú na hranici svojich možností a nemôžu nahrádzať povinnosti štátu.',
      strong:
        'Iné možnosti pomoci využite, až keď ste sa opakovane pokúsili získať pomoc od Štátnej ochrany prírody SR, no neuspeli ste.'
    }
  ]
)
export const huntingChamberFixture = contactScreen(
  'W15c',
  'Kontaktujte obvodnú poľovnícku komoru',
  'Starostlivosť o poľovnú zver zabezpečuje užívateľ poľovného revíru. Požiadajte komoru o kontakt na príslušných poľovníkov a oznámte im polohu a stav zraneného zvieraťa.',
  [
    {
      id: 'warning',
      kind: 'notice',
      emphasis: 'critical',
      title: 'Dôležité!',
      description:
        'Privolaný poľovník môže zranenú zver usmrtiť, najmä ak je vážne zranená. Jeho príchod preto nemusí znamenať jej ošetrenie alebo záchranu. So zverou nemanipulujte ani ju nepremiestňujte. Ak sa nedovoláte na poľovnícku komoru a zver potrebuje neodkladnú pomoc, volajte 112.'
    },
    {
      id: 'opk',
      kind: 'contact',
      title: 'OPK Zvolen',
      address: 'Trieda SNP 14, 974 01 Banská Bystrica',
      phone: { label: '+421 902 123 123', href: 'tel:+421902123123' }
    }
  ]
)
export const pigeonHelpFixture = contactScreen(
  'W15d',
  'Kde hľadať pomoc pre zraneného holuba domáceho?',
  'Na rozdiel od ostatných voľne žijúcich druhov holubov holuby domáce (mestské holuby) nie sú zákonom chránené. Štátna ochrana prírody SR preto pri ich zranení štandardne nezabezpečuje pomoc tak, ako pri chránených živočíchoch.',
  [
    {
      id: 'intro',
      kind: 'notice',
      emphasis: 'important',
      title: 'Kontaktujte záchranné zariadenie',
      description:
        'Zobrazené zariadenia dobrovoľne pomáhajú aj holubom domácim. Môžu vám poradiť, ako postupovať, prípadne pomôcť podľa svojich možností.'
    },
    {
      id: 'friends',
      kind: 'contact',
      title: 'Chovná stanica Priatelia prírody',
      distance: '1,3 km',
      address: 'Myjavská 542/33, 906 13 Brezová pod Bradlom',
      phone: { label: '+421 950 381 559', href: 'tel:+421950381559' }
    },
    {
      id: 'wild',
      kind: 'contact',
      title: 'Chovná stanica Návrat do divočiny – Into the Wild',
      address: 'Stupavská 199, 900 32 Borinka',
      phone: { label: '+421 948 339 429', href: 'tel:+421948339429' }
    }
  ]
)
export const municipalPoliceFixture = contactScreen(
  'W15e',
  'Kontaktujte mesto alebo obec',
  municipalityFixture.copy.description,
  [sampleMunicipality, police, municipalDuty]
)
export const farmMunicipalPoliceFixture = contactScreen(
  'W15f',
  'Kontaktujte mesto alebo obec',
  farmMunicipalityFixture.copy.description,
  [sampleMunicipality, police, veterinaryDuty]
)

const emergencyFooter: ContactsView['footerActions'] = [
  { id: 'resolved', label: 'Podarilo sa pomôcť', appearance: 'primary', target: 'W39a' },
  { id: 'alternatives', label: 'Iné možnosti pomoci', appearance: 'secondary', target: 'W22' }
]
export const emergencyLineFixture = contactScreen(
  'W20a',
  'Zavolajte na tiesňovú linku 112',
  'Ak sa pri náleze zraneného chráneného živočícha nedovoláte na Štátnu ochranu prírody SR alebo do záchranného zariadenia, zavolajte na 112. Operátor má pohotovostné kontakty na pracovníkov ochrany prírody.',
  [
    { id: 'line', kind: 'contact', title: 'Tiesňová linka', phone: { label: '112', href: 'tel:112' } },
    {
      id: 'script',
      kind: 'instructions',
      title: 'Čo povedať operátorovi:',
      items: [
        { id: 'place', text: 'Kde presne sa zviera nachádza' },
        {
          id: 'state',
          text: 'O aké zviera ide a v akom je stave, napríklad či krváca, má poranené krídlo alebo leží na vozovke'
        },
        { id: 'attempts', text: 'Kam ste už volali a že sa vám nepodarilo dovolať' }
      ]
    }
  ],
  emergencyFooter
)
export const collisionFixture = contactScreen(
  'W20b',
  'Došlo k zrážke vozidla so zvieraťom?',
  'Ak je zviera po zrážke s vozidlom zranené, je dôležité oznámiť udalosť polícii. Urobte tak prostredníctvom tiesňovej linky 112. Operátor vás prepojí s políciou a podľa situácie môže sprostredkovať aj pomoc zranenému zvieraťu. Ak zviera stále potrebuje pomoc, pokračujte podľa pokynov Zverolinky.',
  [
    { id: 'line', kind: 'contact', title: 'Tiesňová linka', phone: { label: '112', href: 'tel:112' } },
    {
      id: 'script',
      kind: 'instructions',
      title: 'Čo povedať operátorovi:',
      items: [
        { id: 'place', text: 'Kde presne sa zviera nachádza' },
        {
          id: 'state',
          text: 'O aké zviera ide a v akom je stave, napríklad či je zranené a krváca alebo leží na vozovke bez pohybu'
        }
      ]
    },
    {
      id: 'help',
      kind: 'notice',
      emphasis: 'important',
      title: 'Požiadajte o zabezpečenie pomoci',
      description:
        'Pri volaní požiadajte operátora aj o zabezpečenie pomoci zranenému zvieraťu. Overte si, či a kto pomoc zabezpečí.'
    }
  ],
  [
    { id: 'resolved', label: 'Podarilo sa pomôcť', appearance: 'primary', target: 'W39a' },
    { id: 'alternatives', label: 'Zviera stále potrebuje pomoc', appearance: 'secondary', target: 'W15' }
  ]
)

export const injuredContactFixtures = [
  farmMunicipalityFixture,
  natureAuthorityFixture,
  huntingChamberFixture,
  pigeonHelpFixture,
  municipalPoliceFixture,
  farmMunicipalPoliceFixture,
  emergencyLineFixture,
  collisionFixture
]

const selfHelpFooter: SelfHelpView['footerActions'] = [
  { id: 'resolved', label: 'Podarilo sa pomôcť', appearance: 'primary', target: 'W39a' },
  { id: 'unresolved', label: 'Nepodarilo sa pomôcť', appearance: 'secondary', target: 'W25' }
]
function selfHelpScreen(screen: SelfHelpView['screen'], blocks: SelfHelpView['blocks']): SelfHelpView {
  return {
    ...selfHelpFixture,
    screen,
    footerActions: selfHelpFooter,
    copy: {
      ...selfHelpFixture.copy,
      title: 'Pomôžte sami',
      description: 'Ak predchádzajúce možnosti nepomohli, môžete zvieraťu dočasne pomôcť podľa nasledovného postupu.'
    },
    blocks
  }
}
const captureSteps: SelfHelpView['blocks'] = [
  {
    id: 'water',
    kind: 'notice',
    tone: 'danger',
    title: 'Nekŕmte a nedávajte vodu',
    content: [{ text: 'Pri zranení alebo strese môže byť kŕmenie nebezpečné.' }]
  },
  {
    id: 'need',
    kind: 'section',
    title: 'Potrebuje skutočne pomoc?',
    paragraphs: [
      [
        {
          text: 'Ak vták krváca, má ovisnuté krídlo, nevie stáť, je apatický alebo má iné poranenie, potrebuje pomoc. Ak ide o operené mláďa bez zranení, nechajte ho na mieste a pozorujte, či sa vrátia jeho rodičia.'
        }
      ]
    ]
  },
  {
    id: 'catch',
    kind: 'section',
    title: 'Ako odchytiť',
    paragraphs: [
      [
        {
          text: 'Vtáka uchopte pevne, ale jemne, s krídlami pritlačenými k telu, prípadne cez ľahkú látku. Podchladené mláďa najprv 10 – 15 minút zahrejte v dlaniach.'
        }
      ]
    ]
  },
  {
    id: 'carry',
    kind: 'section',
    title: 'Prenos',
    paragraphs: [
      [
        {
          text: 'Potom ho vložte do krabice s malými vetracími otvormi a suchou podložkou. Nepoužívajte klietku ani prepravku. Krabicu zatvorte a dajte do ticha, prítmia a mimo priameho slnka. Nenechávajte ju v zaparkovanom aute.'
        }
      ]
    ]
  }
]
export const selfHelpPlainFixture = selfHelpScreen('W22a', captureSteps)
export const selfHelpGameFixture = selfHelpScreen('W22b', [
  ...captureSteps,
  {
    id: 'game',
    kind: 'notice',
    tone: 'warning',
    title: 'Upozornenie',
    content: [
      {
        text: 'Nasledujúce druhy kačíc patria medzi poľovnú zver. Ich neoprávnené privlastnenie alebo prechovávanie môže byť v určitých prípadoch posudzované ako trestný čin pytliactva. Ak zviera potrebuje pomoc, konajte len v rozsahu nevyhnutnom na jeho záchranu.'
      }
    ]
  },
  {
    id: 'species',
    kind: 'images',
    items: ['Kačica divá', 'Kačica chrapkavá', 'Kačica lyžičiarka', 'Kačica hviezdavá'].map(label => ({
      id: label,
      alt: label,
      caption: label
    }))
  }
])
export const selfHelpGameNoticeFixture = selfHelpScreen('W22d', [
  ...captureSteps,
  {
    id: 'game',
    kind: 'notice',
    tone: 'warning',
    title: 'Upozornenie',
    content: [
      {
        text: 'Tento druh zvieraťa patrí aj medzi poľovnú zver. Jeho neoprávnené privlastnenie alebo prechovávanie môže byť za určitých okolností posudzované ako trestný čin pytliactva. Ak je zviera zranené, konajte len v rozsahu nevyhnutnom na jeho záchranu a čo najskôr zabezpečte odbornú pomoc.'
      }
    ]
  }
])
export const injuredSelfHelpFixtures = [selfHelpPlainFixture, selfHelpGameFixture, selfHelpGameNoticeFixture]
