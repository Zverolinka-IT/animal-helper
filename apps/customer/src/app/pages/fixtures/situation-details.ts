import { animalDetailsFixture, type AnimalDetailsView } from './animal-details'

// Figma 1101:10460: stray circumstances are distinct from injury symptoms.
export const strayDetailsFixture: AnimalDetailsView = {
  ...animalDetailsFixture,
  questions: [
    {
      id: 'behaviour',
      label: 'Čo je zvieraťu?',
      kind: 'multiple',
      required: false,
      options: [
        { id: 'escaping', label: 'Uteká' },
        { id: 'aggressive', label: 'Je agresívne' },
        { id: 'confused', label: 'Pôsobí zmätene' },
        { id: 'unknown', label: 'Neviem', exclusive: true },
        { id: 'other', label: 'Iné', description: 'Stručne opíšte správanie zvieraťa' }
      ]
    },
    {
      id: 'collar',
      label: 'Má zviera obojok alebo značku?',
      kind: 'single',
      required: false,
      options: [
        { id: 'yes', label: 'Áno' },
        { id: 'no', label: 'Nie' },
        { id: 'unknown', label: 'Neviem' }
      ]
    },
    animalDetailsFixture.questions[2]!
  ]
}

// Figma W12 (1098:13289 / 1098:13438); no consciousness question for a dead animal.
export const deadDetailsFixture: AnimalDetailsView = {
  ...animalDetailsFixture,
  screen: 'W12',
  copy: { ...animalDetailsFixture.copy, description: 'Skontrolujte druh zvieraťa a doplňte okolnosti nálezu.' },
  questions: [
    {
      id: 'suspiciousSigns',
      label: 'Vidíte niektorý z týchto varovných znakov?',
      kind: 'multiple',
      required: false,
      options: [
        { id: 'bound', label: 'Zviera je zviazané alebo v igelite' },
        { id: 'foam', label: 'Pena okolo papule/neprirodzená poloha' },
        { id: 'bait', label: 'Podozrivá návnada v okolí (kúsky mäsa, granule)' },
        { id: 'gunshot', label: 'Zranenie po strelnej zbrani' },
        {
          id: 'unknown',
          label: 'Nič z uvedeného/neviem to posúdiť',
          exclusive: true,
          description: 'Stručne opíšte, ako miesto vyzerá'
        }
      ]
    },
    {
      id: 'animalCount',
      label: 'Koľko mŕtvych zvierat vidíte?',
      kind: 'single',
      required: false,
      options: [
        { id: 'one', label: 'Jedno zviera' },
        { id: 'multiple', label: 'Viac zvierat pohromade' }
      ]
    }
  ]
}
