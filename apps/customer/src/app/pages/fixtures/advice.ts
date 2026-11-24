// Presentation-only examples. Not veterinary advice or a response from a decision engine.
export type AdviceBlock = {
  id: string
  kind: 'avoid' | 'do'
  title: string
  items: { id: string; title: string; description?: string }[]
}
export type AdvicePanel = {
  locale: string
  copy: { drawerTitle: string; closeAdvice: string; acknowledge: string }
  blocks: AdviceBlock[]
}
export type AdviceView = {
  screen: 'W13' | 'W14'
  locale: string
  layout: { showMenu: boolean }
  backTarget: string
  confirmTarget: string
  allowedActions: ('back' | 'acknowledge')[]
  copy: {
    back: string
    step: string
    progress: number
    title: string
    description: string
    preview: string
    acknowledge: string
    drawerTitle: string
    closeAdvice: string
  }
  blocks: AdviceBlock[]
}
export const adviceFixture: AdviceView = {
  screen: 'W14',
  locale: 'sk',
  layout: { showMenu: false },
  backTarget: 'W09',
  confirmTarget: 'W15',
  allowedActions: ['back', 'acknowledge'],
  copy: {
    back: 'Späť',
    step: 'Krok 4 z 4',
    progress: 100,
    title: 'Pozor, toto nerobte!',
    description: 'V ďalších krokoch sa dozviete, koho kontaktovať. Medzitým však, prosím, dodržte tieto zásady.',
    preview: 'Ukážka rozloženia: texty nižšie nie sú rady pre váš prípad. Konkrétne pokyny dodá server.',
    acknowledge: 'Rozumiem',
    drawerTitle: 'Rady na pomoc',
    closeAdvice: 'Zavrieť rady'
  },
  blocks: [
    {
      id: 'avoid',
      kind: 'avoid',
      title: 'Pozor, toto nerobte!',
      items: [
        {
          id: 'avoid-1',
          title: 'Ukážkové upozornenie',
          description: 'Na tomto mieste sa zobrazí konkrétne upozornenie podľa údajov o prípade.'
        },
        {
          id: 'avoid-2',
          title: 'Ďalšia nevhodná činnosť',
          description: 'Server dodá vysvetlenie, prečo sa tejto činnosti vyhnúť.'
        },
        {
          id: 'avoid-3',
          title: 'Doplňujúci zákaz',
          description: 'Počet a poradie bodov sa prispôsobia pokynom zo servera.'
        }
      ]
    },
    {
      id: 'do',
      kind: 'do',
      title: 'Je zviera v ohrození?',
      items: [
        {
          id: 'do-1',
          title: 'Ukážkový odporúčaný postup',
          description: 'Tu bude konkrétny postup a jeho vysvetlenie, vybrané serverom pre danú situáciu.'
        }
      ]
    }
  ]
}
export const warningsOnlyFixture: AdviceView = {
  ...adviceFixture,
  screen: 'W13',
  blocks: adviceFixture.blocks.filter(block => block.kind === 'avoid')
}
