import BaseIcon from '@/libs/components/base-icon.vue'
import { syntheticContactDirectoryEntry, type PublicContactDirectory } from '@animal-helper/contracts'
import { bundledPublicGuidance, type GuidanceItem } from '@animal-helper/guidance'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { municipalityFixture, patrolFixture } from '../../pages/fixtures/contacts'
import { huntingChamberFixture, natureAuthorityFixture } from '../../pages/fixtures/injured-screens'
import PageContacts from '../../pages/page-instructions.vue'
import { presentContacts, presentDirectoryContacts } from '../presentation'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
const now = new Date('2026-10-20T10:00:00Z')
const entry = syntheticContactDirectoryEntry({
  name: 'Synthetic municipal contact',
  serviceKeys: ['municipality_capture'],
  coverage: {
    kind: 'boundary',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [17, 48],
          [18, 48],
          [18, 49],
          [17, 49],
          [17, 48]
        ]
      ]
    }
  },
  hours: { kind: 'weekly', intervals: [{ day: 1, opens: '08:00', closes: '16:00' }] }
})
const directory: PublicContactDirectory = {
  schemaVersion: 1,
  jurisdiction: 'SK',
  revisionId: '018f1a50-7c3b-7000-8000-000000000101',
  publishedAt: now.toISOString(),
  entries: [entry]
}
const items = bundledPublicGuidance().kinds.domestic_cat?.items.filter(item => item.screenKey === 'w15') ?? []
const context = { now, directory, location: entry.coordinates }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => {
  vi.useRealTimers()
})

it('renders published contact details with working call, map and website destinations', () => {
  const view = presentContacts(municipalityFixture, items, 'W14', context)
  const wrapper = mount(PageContacts, { props: { view }, global: { components: { BaseIcon } } })
  expect(wrapper.findAll('.customer-contact-card')).toHaveLength(1)
  expect(wrapper.text()).toContain(entry.name)
  expect(wrapper.text()).toContain('Otvorené · do 16:00')
  expect(wrapper.text()).toContain('0 m')
  expect(wrapper.text()).not.toContain('Telefón doplní server')
  expect(wrapper.get('a[href^="tel:"]').attributes('href')).toBe('tel:+421000000001')
  expect(wrapper.get('a[href^="https://www.google.com/maps"]').attributes('href')).toContain(
    'destination=48.433%2C17.43'
  )
  expect(wrapper.get('a[href="https://example.invalid/help"]').attributes('rel')).toBe('noopener noreferrer')
  wrapper.unmount()
})

it('shows missing-contact guidance without falling back to sample or out-of-area contacts', () => {
  const view = presentContacts(municipalityFixture, items, 'W14', {
    ...context,
    location: { latitude: 49.5, longitude: 21 }
  })
  expect(view.blocks.some(block => block.kind === 'contact')).toBe(false)
  expect(JSON.stringify(view.blocks)).toContain('Overený kontakt zatiaľ nie je dostupný')
  expect(JSON.stringify(view)).not.toContain('Ukážková obec')
  const patrol = presentDirectoryContacts(patrolFixture, { now })
  expect(patrol.blocks.some(block => block.kind === 'contact')).toBe(false)
  expect(JSON.stringify(patrol)).not.toContain('Telefón doplní server')
})

it('keeps the municipality notice after contacts and changes clinic notices only for an explicit protected variant', () => {
  const municipal = presentContacts(municipalityFixture, items, 'W14', context)
  expect(municipal.copy.title).toBe('Kontaktujte mesto alebo obec')
  const fallback = presentContacts(municipalityFixture, items, 'W14', { ...context, guidanceSource: 'bundled' })
  expect(fallback.copy.description).toContain('Obci oznámte, kde sa zviera nachádza')
  expect(municipal.blocks.at(-1)).toMatchObject({ kind: 'notice', title: 'Dôležité!', emphasis: 'critical' })
  const clinic: GuidanceItem = {
    screenKey: 'w15',
    instructionKey: 'contact.option.clinic',
    polarity: 'info',
    slots: { 'contact.title': 'Veterinárna pomoc', 'contact.body': 'Reviewed instructions' },
    action: { kind: 'call-contact', targetKey: 'vet_clinic' }
  }
  const normal = presentContacts(municipalityFixture, [clinic], 'W14', context)
  expect(normal.blocks[0]).toMatchObject({ kind: 'notice', title: 'Pozor, nebude to bezplatné' })
  const protectedView = presentContacts(
    municipalityFixture,
    [{ ...clinic, clinicVariant: 'protected' }],
    'W14',
    context
  )
  expect(JSON.stringify(protectedView.blocks)).not.toContain('Pozor, nebude to bezplatné')
  expect(protectedView.copy.description).toContain('Reviewed instructions')
  expect(protectedView.copy.description).toContain('Chránených živočíchov')
  expect(normal.copy.title).toBe('Veterinárna pomoc')
})

it('shows the ŠOP and hunting chamber for the report district instead of the sample cards', () => {
  const nature = presentDirectoryContacts(natureAuthorityFixture, { now, district: 'Trnava' })
  expect(nature.copy.title).toBe('Kontaktujte Štátnu ochranu prírody')
  expect(nature.blocks.at(-1)).toMatchObject({ kind: 'notice', title: 'Dôležité!' })
  expect(JSON.stringify(nature)).toContain('Správa CHKO Malé Karpaty')
  expect(JSON.stringify(nature)).toContain('tel:0911011384')
  expect(JSON.stringify(nature)).not.toContain('+421 902 123 123')
  const hunting = presentDirectoryContacts(huntingChamberFixture, { now, district: 'Trnava' })
  expect(hunting.blocks[0]).toMatchObject({ kind: 'notice', title: 'Dôležité!' })
  expect(JSON.stringify(hunting)).toContain('OPK Trnava')
  expect(JSON.stringify(hunting)).not.toContain('OPK Zvolen')
  const published = presentDirectoryContacts(natureAuthorityFixture, {
    now,
    district: 'Trnava',
    directory: {
      ...directory,
      entries: [
        syntheticContactDirectoryEntry({
          name: 'Overená správa',
          serviceKeys: ['sop_rescue'],
          coverage: { kind: 'districts', districts: ['Trnava'] }
        })
      ]
    }
  })
  expect(JSON.stringify(published)).toContain('Overená správa')
  expect(JSON.stringify(published)).not.toContain('Správa CHKO Malé Karpaty')
})

it('removes expired phone links when an open screen crosses the local review deadline', async () => {
  const midnight = new Date('2026-10-20T21:59:30Z')
  vi.setSystemTime(midnight)
  const view = presentContacts(municipalityFixture, items, 'W14', {
    ...context,
    now: midnight,
    directory: { ...directory, entries: [{ ...entry, reviewDueOn: '2026-10-20' }] }
  })
  const wrapper = mount(PageContacts, { props: { view }, global: { components: { BaseIcon } } })
  expect(wrapper.findAll('a[href^="tel:"]')).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(60_000)
  await nextTick()
  expect(wrapper.findAll('a[href^="tel:"]')).toHaveLength(0)
  expect(wrapper.text()).toContain('Kontakty čakajú na nové overenie')
  wrapper.unmount()
})
