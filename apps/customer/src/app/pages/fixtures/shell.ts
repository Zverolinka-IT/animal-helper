// Local bootstrap fallback until a server-provided shell view is available.
export const shellFixture = {
  locale: 'sk',
  homeTarget: '/',
  props: {
    brand: 'Zverolinka',
    home: 'Zverolinka – domov',
    skip: 'Preskočiť na obsah',
    openMenu: 'Otvoriť menu',
    closeMenu: 'Zatvoriť menu',
    menu: 'Hlavné menu',
    navigation: 'Hlavná navigácia',
    welcome: 'Vitajte v Zverolinke',
    unavailable: '{label}: túto časť aplikácie pripravujeme.'
  },
  menuItems: [
    { label: 'Domov', icon: 'about', target: '/' },
    { label: 'Návody a príbehy', icon: 'faq', target: null },
    { label: 'Staňte sa dobrovoľníkom', icon: 'volunteer', target: null },
    { label: 'Podporte Zverolinku', icon: 'donation', target: null }
  ],
  socials: [
    { name: 'Facebook', icon: 'facebook' },
    { name: 'Instagram', icon: 'instagram' },
    { name: 'LinkedIn', icon: 'linkedin' }
  ]
}
