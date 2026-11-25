import type { ContactCoordinates, ContactServiceKey, PublicContactDirectory } from '@animal-helper/contracts'
import { contactPresentation, guidanceLines, type GuidanceItem } from '@animal-helper/guidance'
import {
  authorityContactsFor,
  contactAvailability,
  navigationHref,
  phoneHref,
  selectContacts,
  veterinaryClinicsFor,
  type AuthorityService,
  type MunicipalityOffice,
  type VeterinaryClinic
} from '@animal-helper/jurisdictions'
import type { AdviceBlock, AdvicePanel, AdviceView } from '../pages/fixtures/advice'
import type { ContactBlock } from '../pages/fixtures/contacts'
import type { InstructionsView } from '../pages/fixtures/instructions'
import type { SelfHelpBlock, SelfHelpView } from '../pages/fixtures/self-help'

export type ContactContext = {
  guidanceSource?: 'bundled' | 'published' | undefined
  directory?: PublicContactDirectory | undefined
  location?: ContactCoordinates | undefined
  district?: string | undefined
  animalGroups?: readonly string[] | undefined
  municipality?: MunicipalityOffice | undefined
  now: Date
}

const authorityServices: Partial<Record<InstructionsView['screen'], AuthorityService>> = {
  W15b: 'sop_rescue',
  W15c: 'hunting_manager_or_opk'
}

function authorityBlocks(service: AuthorityService, district: string | undefined): ContactBlock[] {
  return authorityContactsFor(service, district).map((contact): ContactBlock => {
    const phone = phoneHref(contact.phone)
    const destination = contact.address.replace(/\n/gu, ', ')
    const navigation = destination
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
      : undefined
    return {
      id: `${service}-${contact.name}`,
      kind: 'contact',
      title: contact.name,
      ...(contact.address ? { address: contact.address } : {}),
      ...(phone ? { phone: { label: contact.phone, href: phone } } : {}),
      ...(navigation ? { navigation: { label: 'Navigovať', href: navigation } } : {}),
      ...(contact.note ? { note: contact.note } : {})
    }
  })
}

function municipalityCard(office: MunicipalityOffice): ContactBlock {
  const phone = phoneHref(office.phone)
  return {
    id: `municipality-${office.district}-${office.name}`,
    kind: 'contact',
    title: office.name,
    ...(phone ? { phone: { label: office.phone, href: phone } } : {}),
    ...(office.note ? { note: office.note } : {})
  }
}

function contactBlocks(service: ContactServiceKey, id: string, context: ContactContext): ContactBlock[] {
  const contacts = selectContacts(context.directory, service, context.location, context.now, context.district)
  if (!contacts.length && service === 'municipality_capture' && context.municipality?.phone)
    return [municipalityCard(context.municipality)]
  if (!contacts.length)
    return [
      {
        id: `${id}-unavailable`,
        kind: 'notice',
        emphasis: 'important',
        title: 'Overený kontakt zatiaľ nie je dostupný',
        description:
          'Pre túto službu a lokalitu momentálne nemáme zverejnený overený kontakt. Môžete skúsiť ďalšiu možnosť pomoci.'
      }
    ]
  return contacts.map(({ entry, distanceKm }): ContactBlock => {
    const phone = phoneHref(entry.phone)
    const navigation = navigationHref(entry)
    return {
      id: `${id}-${entry.id}`,
      kind: 'contact',
      title: entry.name,
      ...(distanceKm === undefined
        ? {}
        : {
            distance:
              distanceKm < 1
                ? `${Math.round(distanceKm * 1000)} m`
                : `${new Intl.NumberFormat('sk', { maximumFractionDigits: 1 }).format(distanceKm)} km`
          }),
      ...(entry.address ? { address: entry.address } : {}),
      availability: contactAvailability(entry.hours, context.now),
      hours: entry.hours,
      reviewDueOn: entry.reviewDueOn,
      ...(phone ? { phone: { label: entry.phone, href: phone } } : {}),
      ...(navigation ? { navigation: { label: 'Navigovať', href: navigation } } : {}),
      ...(entry.website ? { website: { label: 'Web kontaktu', href: entry.website } } : {}),
      ...(entry.note ? { note: entry.note } : {})
    }
  })
}

const veterinaryNotice: ContactBlock = {
  id: 'veterinary-cost',
  kind: 'notice',
  emphasis: 'important',
  title: 'Pozor, nebude to bezplatné',
  description:
    'Ak si objednáte ošetrenie veterinára, náklady budete musieť uhradiť vy, pokiaľ sa vopred nedohodnete inak. Niektoré veterinárne pracoviská poskytujú aj pohotovosť a výjazdy. Vopred si telefonicky overte ich dostupnosť a prípadné príplatky.'
}

function distanceLabel(distanceKm: number) {
  return distanceKm < 1
    ? `${Math.round(distanceKm * 1000)} m`
    : `${new Intl.NumberFormat('sk', { maximumFractionDigits: 1 }).format(distanceKm)} km`
}

function veterinaryBlock(clinic: VeterinaryClinic): ContactBlock {
  const phone = phoneHref(clinic.phone)
  const destination = clinic.coordinates
    ? `${clinic.coordinates.latitude},${clinic.coordinates.longitude}`
    : clinic.address.replace(/\n/gu, ', ')
  return {
    id: `clinic-${clinic.id}`,
    kind: 'contact',
    title: clinic.name,
    ...(clinic.distanceKm === undefined ? {} : { distance: distanceLabel(clinic.distanceKm) }),
    ...(clinic.address ? { address: clinic.address } : {}),
    ...(phone ? { phone: { label: clinic.phone, href: phone } } : {}),
    ...(destination
      ? {
          navigation: {
            label: 'Navigovať',
            href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
          }
        }
      : {}),
    ...(clinic.note ? { note: clinic.note } : {})
  }
}

export function presentVeterinaryClinics(
  view: InstructionsView,
  district: string | undefined,
  groups: readonly string[],
  now: Date,
  location?: ContactCoordinates
): InstructionsView {
  const listed = veterinaryClinicsFor(district, groups, now, location)
  const clinics = listed.map(veterinaryBlock)
  const shown: ContactBlock[] = clinics.length
    ? clinics
    : [
        {
          id: 'clinics-unavailable',
          kind: 'notice',
          emphasis: 'important',
          title: 'Overený kontakt zatiaľ nie je dostupný',
          description:
            'Pre túto službu a lokalitu momentálne nemáme zverejnený overený kontakt. Môžete skúsiť ďalšiu možnosť pomoci.'
        }
      ]
  return {
    ...view,
    copy: {
      ...view.copy,
      title: 'Môžete kontaktovať veterinárnu kliniku',
      description: listed.some(clinic => clinic.distanceKm !== undefined)
        ? 'Kliniky v tomto okrese, ktoré podľa zoznamu ošetrujú túto skupinu zvierat. Pri každej je dnešný ordinačný čas a vzdušná vzdialenosť od nahláseného miesta.'
        : 'Kliniky v tomto okrese, ktoré podľa zoznamu ošetrujú túto skupinu zvierat. Pri každej je dnešný ordinačný čas.',
      preview: ''
    },
    blocks: [veterinaryNotice, ...shown]
  }
}

// Fixture branches still lack server case workflows, but must not display
// invented public contact details when a user reaches their contact screen.
export function presentDirectoryContacts(view: InstructionsView, context: ContactContext): InstructionsView {
  const services: Partial<Record<InstructionsView['screen'], ContactServiceKey>> = {
    W15: 'municipality_capture',
    W15b: 'sop_rescue',
    W15c: 'hunting_manager_or_opk',
    W18: 'vet_clinic',
    W19: 'vet_clinic',
    W20: 'police',
    W21: 'volunteers',
    W36: 'highway_patrol'
  }
  const authority = authorityServices[view.screen]
  if (authority) {
    const published = selectContacts(context.directory, authority, context.location, context.now, context.district)
    const contacts = published.length
      ? contactBlocks(authority, view.screen, context)
      : authorityBlocks(authority, context.district)
    const notices = view.blocks.filter(block => block.kind === 'notice')
    const shown: ContactBlock[] = contacts.length
      ? contacts
      : [
          {
            id: `${view.screen}-unavailable`,
            kind: 'notice',
            emphasis: 'important',
            title: 'Overený kontakt zatiaľ nie je dostupný',
            description:
              'Pre túto službu a lokalitu momentálne nemáme zverejnený overený kontakt. Môžete skúsiť ďalšiu možnosť pomoci.'
          }
        ]
    return {
      ...view,
      copy: { ...view.copy, preview: '' },
      blocks: authority === 'hunting_manager_or_opk' ? [...notices, ...shown] : [...shown, ...notices]
    }
  }
  if (view.screen === 'W15a' || view.screen === 'W15e' || view.screen === 'W15f') {
    const cards = contactBlocks('municipality_capture', view.screen, context)
    const kept = view.blocks.filter(
      block => block.kind !== 'contact' || ('phone' in block && block.phone?.label === '159')
    )
    return { ...view, copy: { ...view.copy, preview: '' }, blocks: [...cards, ...kept] }
  }
  const service = services[view.screen]
  if (!service) return view
  const preset = contactPresentation(service, view.screen === 'W19' ? 'protected' : undefined)
  const notices: ContactBlock[] =
    preset && 'notice' in preset && preset.notice
      ? [{ id: `${view.screen}-notice`, kind: 'notice', ...preset.notice }]
      : []
  const contacts = contactBlocks(service, view.screen, context)
  return {
    ...view,
    copy: {
      ...view.copy,
      title: preset?.title ?? view.copy.title,
      description: preset && 'description' in preset ? (preset.description ?? '') : '',
      preview: ''
    },
    blocks: [
      ...view.blocks.filter(block => ['W20', 'W36'].includes(view.screen) && block.kind === 'instructions'),
      ...(service === 'municipality_capture' ? [...contacts, ...notices] : [...notices, ...contacts])
    ]
  }
}

export function adviceBlocks(items: readonly GuidanceItem[], labels: readonly AdviceBlock[]): AdviceBlock[] {
  return items
    .filter(item => item.instructionKey.startsWith('warning.'))
    .map(item => ({
      id: item.instructionKey,
      kind: item.polarity === 'do_not' ? 'avoid' : 'do',
      title: labels.find(block => block.kind === (item.polarity === 'do_not' ? 'avoid' : 'do'))?.title ?? '',
      items: Object.values(item.slots)
        .flatMap(text => guidanceLines(text ?? ''))
        .map((title, index) => ({
          id: `${item.instructionKey}-${index}`,
          title
        }))
    }))
}

export function presentAdvice(view: AdviceView, items: readonly GuidanceItem[], backTarget: string): AdviceView {
  return { ...view, backTarget, blocks: adviceBlocks(items, view.blocks), copy: { ...view.copy, preview: '' } }
}

export function presentAdvicePanel(panel: AdvicePanel, items: readonly GuidanceItem[]): AdvicePanel {
  return { ...panel, blocks: adviceBlocks(items, panel.blocks) }
}

export function presentContacts(
  view: InstructionsView,
  items: readonly GuidanceItem[],
  backTarget: string,
  context: ContactContext
): InstructionsView {
  // A contact screen normally represents one option. Shared fixtures may contain several.
  const first = items[0]
  const service = first?.action?.targetKey as ContactServiceKey | undefined
  const presentation = service ? contactPresentation(service, first?.clinicVariant) : undefined
  const suppliedTitle =
    first?.slots['contact.title'] ?? first?.slots['contact.primary.title'] ?? first?.slots['contact.secondary.title']
  const title =
    suppliedTitle && !['Zavolajte obci alebo mestu', 'Môžete zavolať na veterinárnu kliniku'].includes(suppliedTitle)
      ? suppliedTitle
      : (presentation?.title ?? suppliedTitle ?? view.copy.title)
  let description = ''
  const blocks: ContactBlock[] = items.flatMap(item => {
    const title =
      item.slots['contact.title'] ?? item.slots['contact.primary.title'] ?? item.slots['contact.secondary.title'] ?? ''
    const body =
      item.slots['contact.body'] ??
      item.slots['contact.primary.body'] ??
      item.slots['contact.secondary.body'] ??
      item.slots['volunteers.body'] ??
      ''
    const instructions: ContactBlock = {
      id: item.instructionKey,
      kind: 'instructions',
      title,
      items: guidanceLines(body).map((text, index) => ({ id: `${item.instructionKey}-${index}`, text }))
    }
    const service = item.action?.targetKey as ContactServiceKey | undefined
    const target = service ?? (item.instructionKey === 'volunteers' ? 'volunteers' : undefined)
    const preset = target ? contactPresentation(target, item.clinicVariant) : undefined
    if (!preset) return [instructions, ...(target ? contactBlocks(target, item.instructionKey, context) : [])]
    const useDefault = context.guidanceSource === 'bundled' && !item.instructionKey.startsWith('contact.option.')
    description = [
      useDefault ? (preset.description ?? body) : body,
      !useDefault && item.clinicVariant === 'protected' ? 'Chránených živočíchov prevezmú bezplatne.' : undefined
    ]
      .filter(Boolean)
      .join('\n\n')
    const notice: ContactBlock[] =
      'notice' in preset && preset.notice
        ? [{ id: `${item.instructionKey}-notice`, kind: 'notice', ...preset.notice }]
        : []
    const contacts = target ? contactBlocks(target, item.instructionKey, context) : []
    return target === 'municipality_capture' ? [...contacts, ...notice] : [...notice, ...contacts]
  })
  return {
    ...view,
    backTarget,
    blocks,
    copy: {
      ...view.copy,
      title,
      description,
      preview: ''
    }
  }
}

export function presentSelfHelp(view: SelfHelpView, items: readonly GuidanceItem[], backTarget: string): SelfHelpView {
  const blocks: SelfHelpBlock[] = items.map(item => ({
    id: item.instructionKey,
    kind: 'section',
    title: view.copy.title,
    paragraphs: guidanceLines(item.slots['self_help.intro'] ?? '').map(text => [{ text }])
  }))
  return { ...view, backTarget, blocks, copy: { ...view.copy, description: '', preview: '' } }
}
