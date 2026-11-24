import { syntheticContactDirectoryEntry } from '@animal-helper/contracts'
import {
  bundledGuidanceDocument,
  contactOptionCells,
  isContactInstruction,
  resolvePublicGuidance
} from '@animal-helper/guidance'
import { expect, test } from '@playwright/test'

function publication() {
  const original = bundledGuidanceDocument()
  const options = [
    {
      id: 'vets',
      serviceKey: 'vet_clinic' as const,
      title: 'Najprv veterinár',
      body: 'Pokyny pre veterinára.',
      enabled: true
    },
    { id: 'disabled', serviceKey: 'vet_exotic' as const, title: 'Vypnuté', body: 'Vypnuté pokyny.', enabled: false },
    {
      id: 'volunteers',
      serviceKey: 'volunteers' as const,
      title: 'Potom dobrovoľníci',
      body: 'Pokyny pre dobrovoľníkov.',
      enabled: true
    },
    {
      id: 'exotic',
      serviceKey: 'vet_exotic' as const,
      clinicVariant: 'protected' as const,
      title: 'Ďalšia možnosť',
      body: 'Pokyny pre ďalšiu možnosť.',
      enabled: true
    }
  ]
  const guidance = resolvePublicGuidance(
    {
      copy: original.copy,
      cells: [
        ...original.cells.filter(cell => cell.kindKey !== 'domestic_cat' || !isContactInstruction(cell.instructionKey)),
        ...contactOptionCells('domestic_cat', options)
      ]
    },
    { source: 'published', revisionId: '018f1a50-7c3b-7000-8000-000000000101', contentHash: 'c'.repeat(64) }
  )
  return {
    ...guidance,
    contactDirectory: {
      schemaVersion: 1 as const,
      jurisdiction: 'SK' as const,
      revisionId: '018f1a50-7c3b-7000-8000-000000000201',
      publishedAt: new Date().toISOString(),
      entries: [
        syntheticContactDirectoryEntry({ name: 'Synthetic vet', coverage: { kind: 'national' } }),
        syntheticContactDirectoryEntry({
          id: '018f1a50-7c3b-7000-8000-000000000202',
          name: 'Synthetic volunteers',
          serviceKeys: ['volunteers'],
          coverage: { kind: 'national' }
        })
      ]
    }
  }
}

test('follows the injured matrix and shows the published directory on each contact screen', async ({ page }) => {
  const guidance = publication()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/guidance', route => route.fulfill({ json: guidance }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?fixture=clean')
  await page.getByRole('button', { name: 'Zviera je zranené', exact: true }).click()
  await page.getByRole('button', { name: 'Ukážková mapa — vybrať Dolné Orešany' }).click()
  await page.getByRole('button', { name: 'Potvrdiť polohu' }).click()
  await page.getByRole('button', { name: 'Nemám fotografiu' }).click()
  await page.getByRole('combobox').fill('mac')
  await page.getByRole('option', { name: 'Mačka', exact: true }).click()
  await page.getByRole('button', { name: 'Potvrdiť voľbu' }).click()
  await page.getByRole('checkbox', { name: 'Krváca', exact: true }).check()
  await page.locator('input[name=conscious][value=yes]').check()
  await page.locator('input[name=juvenile][value=no]').check()
  await page.getByRole('button', { name: 'Zobraziť možnosti pomoci' }).click()
  await page.getByRole('button', { name: 'Rozumiem', exact: true }).click()
  await expect(page).toHaveURL(/\/w15$/)
  await page.getByRole('button', { name: 'Iné možnosti pomoci', exact: true }).click()
  await expect(page).toHaveURL(/\/w18$/)
  await expect(page.getByRole('heading', { name: 'Synthetic vet', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Pozor, nebude to bezplatné', exact: true })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/\/w18$/)
  await page.getByRole('button', { name: 'Iné možnosti pomoci', exact: true }).click()
  await expect(page).toHaveURL(/\/w21$/)
  await expect(page.getByRole('heading', { name: 'Synthetic volunteers', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Iné možnosti pomoci', exact: true }).click()
  await expect(page).toHaveURL(/\/w22a$/)
  await expect(page.getByRole('heading', { name: 'Kedy nechať na mieste' })).toBeVisible()
  await expect(page.getByText('Ak je mačka zdravá, čistá, dobre živená')).toBeVisible()
  await page.getByRole('button', { name: 'Podarilo sa pomôcť', exact: true }).click()
  await expect(page).toHaveURL(/\/w39a$/)
  await expect(page.getByRole('heading', { name: 'Kto pomohol zvieraťu?' })).toBeVisible()
  expect(errors).toEqual([])
})
