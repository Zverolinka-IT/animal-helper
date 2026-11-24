import { animalKinds } from '@animal-helper/guidance/catalog'
import type { AnimalBranch } from './animal-groups'

type Labels = Record<string, [label: string, otherLabel: string]>
const groups: Labels = {
  domestic: ['Domáce zvieratá', 'Iné domáce zviera'],
  farm: ['Hospodárske zvieratá', 'Iné hospodárske zviera'],
  wildlife: ['Voľne žijúce zvieratá', 'Iné voľne žijúce zviera'],
  exotic: ['Exotické, uniknuté alebo nepôvodné zvieratá', 'Iné exotické zviera']
}
const categories: Labels = {
  bird: ['Vtáky', 'Iný vták'],
  aquatic: ['Ryby a vodné živočíchy', 'Iný vodný živočích'],
  reptile: ['Plazy', 'Iný plaz'],
  amphibian: ['Obojživelníky', 'Iný obojživelník'],
  wild_mammal: ['Voľne žijúce cicavce', 'Iný voľne žijúci cicavec']
}
const subcategories: Labels = {
  forest_game: ['Lesná a poľná zver', 'Iné zviera lesnej a poľnej zveri'],
  songbirds: ['Malé vtáky a spevavce', 'Iný malý vták alebo spevavec'],
  small_wild_mammals: ['Malé voľne žijúce cicavce', 'Iný malý voľne žijúci cicavec'],
  waterfowl: ['Vodné vtáky', 'Iný vodný vták'],
  raptors: ['Dravce', 'Iný dravec'],
  corvids: ['Krkavcovité vtáky', 'Iný krkavcovitý vták'],
  owls: ['Sovy', 'Iná sova'],
  storks_waders: ['Bociany a brodivé vtáky', 'Iný brodivý vták'],
  large_carnivores: ['Veľké šelmy', 'Iná veľká šelma'],
  pigeons: ['Holuby', 'Iný holub']
}
function branch(id: string, labels: [string, string]): AnimalBranch {
  return { kind: 'branch', id, label: labels[0], otherLabel: labels[1], children: [] }
}

// Only presentation shaping lives here. Animal identities and membership come from the shared catalogue.
// Domestic, farm and exotic categories repeat their group, so omit that redundant card level.
export const animalCatalogueTree = branch('root', ['O aké zviera ide?', 'Iné zviera'])
for (const [groupKey, labels] of Object.entries(groups)) {
  const group = branch(groupKey, labels)
  animalCatalogueTree.children.push(group)
  const branches = new Map<string, AnimalBranch>()
  for (const animal of animalKinds.filter(
    item =>
      item.groupKey === groupKey &&
      (item.matrix.crueltyId !== undefined || item.matrix.injuredId !== undefined || item.matrix.strayId !== undefined)
  )) {
    let parent = group
    const pathLabels = [group.label]
    for (const [key, labelMap] of [
      [animal.categoryKey, categories],
      [animal.subcategoryKey, subcategories]
    ] as const) {
      if (!key || !labelMap[key]) continue
      let child = branches.get(key)
      if (!child) {
        child = branch(key, labelMap[key])
        branches.set(key, child)
        parent.children.push(child)
      }
      parent = child
      pathLabels.push(child.label)
    }
    parent.children.push({ kind: 'animal', id: animal.key, label: animal.labelSk, detail: pathLabels.join(' · ') })
  }
}
function sortChildren(node: AnimalBranch) {
  node.children.sort((a, b) => a.label.localeCompare(b.label, 'sk'))
  for (const child of node.children) if (child.kind === 'branch') sortChildren(child)
}
for (const group of animalCatalogueTree.children) if (group.kind === 'branch') sortChildren(group)
