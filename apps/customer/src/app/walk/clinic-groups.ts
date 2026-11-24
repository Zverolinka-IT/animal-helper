import { findAnimalKind } from '@animal-helper/guidance'
import type { AnimalNode } from '../pages/fixtures/animal-groups'
import { injuredAnimalTree } from '../pages/fixtures/injured-animal-tree'

const pathsFor = (kindKey: string): string[][] => {
  const found: string[][] = []
  const visit = (node: AnimalNode, labels: string[]) => {
    if (node.kind === 'animal') {
      if (node.id === kindKey || node.speciesKey === kindKey) found.push([...labels, node.label])
      return
    }
    const next = node.id === 'root' ? labels : [...labels, node.label]
    node.children.forEach(child => visit(child, next))
  }
  visit(injuredAnimalTree, [])
  return found
}

// Sheet tokens are the picker groups, plus a few narrower labels the clinic
// workbook uses inside those groups.
export function clinicGroupsFor(kindKey: string | undefined): string[] {
  if (!kindKey) return []
  const tokens = new Set<string>()
  const category = findAnimalKind(kindKey)?.categoryKey
  for (const labels of pathsFor(kindKey)) {
    const root = labels[0]
    if (root?.startsWith('Exotické')) tokens.add('Exotické')
    else if (root) tokens.add(root)
    if (labels.includes('Hady')) tokens.add('Hady')
    if (labels.includes('Veľké vtáky a dravce')) tokens.add('Veľké vtáky a dravce')
    if (labels.includes('Holuby a hrdličky')) tokens.add('Holuby')
    if (labels.includes('Kôň')) tokens.add('Kone')
    if (root === 'Obojživelníky a plazy' && (category === 'reptile' || labels.includes('Hady'))) tokens.add('Plazy')
    if (root === 'Obojživelníky a plazy' && category === 'amphibian') tokens.add('Obojživelníky')
  }
  return [...tokens].sort((left, right) => left.localeCompare(right, 'sk'))
}
