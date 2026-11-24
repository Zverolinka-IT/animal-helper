import { expect, it } from 'vitest'
import { clinicGroupsFor } from '../clinic-groups'

it('uses the picker group and the narrower clinic labels', () => {
  expect(clinicGroupsFor('domestic_cat')).toEqual(['Domáce'])
  expect(clinicGroupsFor('farm_horse').sort()).toEqual(['Hospodárske', 'Kone'])
  expect(clinicGroupsFor('farm_chicken')).toEqual(['Hospodárske'])
  expect(clinicGroupsFor('bird_duck')).toEqual(['Vtáky'])
  expect(clinicGroupsFor('bird_eagle')).toEqual(['Veľké vtáky a dravce', 'Vtáky'])
  expect(clinicGroupsFor('bird_pigeon')).toEqual(['Holuby', 'Vtáky'])
  expect(clinicGroupsFor('wild_bat')).toEqual(['Netopiere'])
  expect(clinicGroupsFor('amphibian_frog')).toEqual(['Obojživelníky', 'Obojživelníky a plazy'])
  expect(clinicGroupsFor(undefined)).toEqual([])
})
