import type { AnimalBranch, AnimalNode } from './animal-groups'
import illustrationIds from './illustration-ids.json' with { type: 'json' }
import tree from './injured-animal-tree.json' with { type: 'json' }

const illustrations = illustrationIds as Record<string, string>
function illustrationUrl(id: string) {
  const sheetId = illustrations[id]
  return sheetId ? `/illustrations/${sheetId}.webp` : undefined
}

type StoredAnimal = { kind: 'animal'; id: string; label: string; speciesKey?: string }
type StoredBranch = {
  kind: 'branch'
  id: string
  label: string
  otherLabel: string
  children: StoredNode[]
}
type StoredNode = StoredAnimal | StoredBranch

function inflate(node: StoredNode, labels: string[]): AnimalNode {
  if (node.kind === 'animal') {
    const imageUrl = illustrationUrl(node.id)
    return {
      kind: 'animal',
      id: node.id,
      label: node.label,
      detail: labels.join(' · ') || node.label,
      ...(imageUrl ? { imageUrl } : {}),
      ...(node.speciesKey === undefined ? {} : { speciesKey: node.speciesKey })
    }
  }
  const nextLabels = node.id === 'root' ? [] : [...labels, node.label]
  const imageUrl = illustrationUrl(node.id)
  return {
    kind: 'branch',
    id: node.id,
    label: node.label,
    otherLabel: node.otherLabel,
    ...(imageUrl ? { imageUrl } : {}),
    children: node.children.map(child => inflate(child, nextLabels))
  }
}

// Species menu for an injured report, in the spreadsheet order.
export const injuredAnimalTree = inflate(tree as StoredNode, []) as AnimalBranch
