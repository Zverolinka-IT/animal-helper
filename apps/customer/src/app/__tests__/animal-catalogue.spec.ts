import { describe, expect, it } from 'vitest'
import { catalogueAnimals, searchAnimals } from '../animal-catalogue'
import { animalGroupsFixture } from '../pages/fixtures/animal-groups'

describe('shared animal search', () => {
  const animals = catalogueAnimals(animalGroupsFixture.root)
  it.each(['mačka', 'MACKA', '  mač  '])('matches word prefixes without case or diacritics: %s', query => {
    expect(searchAnimals(animals, query).some(animal => animal.id === 'domestic_cat')).toBe(true)
  })
  it('does not suggest branches or all animals for an empty query', () => {
    expect(searchAnimals(animals, 'Hospodárske zvieratá')).toEqual([])
    expect(searchAnimals(animals, '   ')).toEqual([])
    expect(searchAnimals(animals, 'čka')).toEqual([])
    expect(searchAnimals(animals, 'mac').map(animal => animal.id)).toContain('domestic_cat')
  })
})

it('offers the injured spreadsheet tree and keeps a known animal on its catalogue key', async () => {
  const { injuredAnimalTree } = await import('../pages/fixtures/injured-animal-tree')
  const { findAnimalKind } = await import('@animal-helper/guidance')
  expect(injuredAnimalTree.children.map(node => node.label)).toEqual([
    'Domáce',
    'Hospodárske',
    'Vodné',
    'Obojživelníky a plazy',
    'Divožijúce cicavce',
    'Netopiere',
    'Vtáky',
    'Exotické, uniknuté alebo nepôvodné zvieratá'
  ])
  const animals = catalogueAnimals(injuredAnimalTree)
  const cat = animals.find(animal => animal.label === 'Mačka')
  expect(cat?.id).toBe('domestic_cat')
  expect(cat?.imageUrl).toBe('/illustrations/A0011.webp')
  expect(injuredAnimalTree.children.find(node => node.label === 'Domáce')?.imageUrl).toBe('/illustrations/G0001.webp')
  expect(findAnimalKind('domestic_cat')?.labelSk).toBe('Mačka')
  expect(
    animals
      .filter(animal => animal.label === 'Králik domáci')
      .map(animal => animal.id)
      .sort()
  ).toEqual(['domestic_rabbit', 'farm_rabbit'])
  const ids = animals.map(animal => animal.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(animals.some(animal => animal.label === 'Daniel škvrnitý')).toBe(true)
  expect(findAnimalKind('a0036')?.labelSk).toBe('Daniel škvrnitý')
})

it('includes every shared catalogue identity exactly once with a navigable path', async () => {
  const { animalKinds } = await import('@animal-helper/guidance/catalog')
  const legacy = animalKinds.filter(
    kind =>
      kind.matrix.crueltyId !== undefined || kind.matrix.injuredId !== undefined || kind.matrix.strayId !== undefined
  )
  const animals = catalogueAnimals(animalGroupsFixture.root)
  expect(animals.map(animal => animal.id).sort()).toEqual(legacy.map(animal => animal.key).sort())
  for (const animal of animals) {
    let parent = animalGroupsFixture.root
    for (const id of animal.path) {
      const next = parent.children.find(node => node.id === id)
      expect(next?.kind).toBe('branch')
      if (next?.kind === 'branch') parent = next
    }
    expect(parent.children.some(node => node.id === animal.id)).toBe(true)
  }
})
