import { expect, it } from 'vitest'
import { injuredHelpSections, injuredRouteFor, injuredScreens, nextInjuredScreen } from '../injured-route'

const none = { collision: false, municipalPolice: false }

it('follows the matrix for a companion animal and inserts the collision screen only when selected', () => {
  expect(injuredScreens(injuredRouteFor('domestic_cat')!, none)).toEqual(['W14', 'W15', 'W18', 'W21', 'W22a'])
  expect(nextInjuredScreen('domestic_cat', 'W09', none)).toBe('W14')
  expect(nextInjuredScreen('domestic_cat', 'W14', none)).toBe('W15')
  expect(nextInjuredScreen('domestic_cat', 'W15e', { collision: true, municipalPolice: true })).toBe('W18')
  expect(injuredScreens(injuredRouteFor('domestic_cat')!, { collision: true, municipalPolice: true })).toEqual([
    'W14',
    'W20b',
    'W15e',
    'W18',
    'W21',
    'W22a'
  ])
})

it('turns the matrix self-help text into sections and keeps a heading that shares a line with its paragraph', () => {
  expect(injuredHelpSections(injuredRouteFor('domestic_cat')!.help).map(section => section.title)).toContain(
    'Kedy nechať na mieste'
  )
  const injured = injuredHelpSections([
    'AK JE ZRANENÉ Krátkodobo zviera umiestnite do krabičky.',
    'ZABEZPEČTE ODBORNÚ POMOC'
  ])
  expect(injured.map(section => section.title)).toEqual(['Ak je zranené', 'Zabezpečte odbornú pomoc'])
  expect(injured[0]?.paragraphs).toEqual(['Krátkodobo zviera umiestnite do krabičky.'])
  expect(injuredRouteFor('bird_duck')?.gameSpecies).toContain('Kačica divá')
  expect(injuredRouteFor('bird_duck')?.gameWarning[0]).toContain('poľovnú zver')
})

it('sends hunted species to the hunting chamber and keeps volunteers when self-help is absent', () => {
  expect(nextInjuredScreen('a0036', 'W14', none)).toBe('W15c')
  expect(nextInjuredScreen('a0036', 'W15c', none)).toBe('W21')
  expect(nextInjuredScreen('a0036', 'W21', none)).toBe('W25')
  expect(injuredRouteFor('a0036')?.helped).toContain('Príslušná OPK')
})
