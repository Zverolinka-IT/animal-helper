import type { FormSnapshotV1 } from '@animal-helper/contracts'
import { bundledPublicGuidance } from '@animal-helper/guidance'
import { expect, test, type Page } from '@playwright/test'

async function capture(page: Page) {
  const forms: FormSnapshotV1[] = []
  const cases = new Set<string>()
  await page.route('**/guidance', route => route.fulfill({ json: bundledPublicGuidance() }))
  await page.route('**/commands', async route => {
    const command = route.request().postDataJSON() as {
      streamId: string
      kind?: string
      privatePayload?: FormSnapshotV1
    }
    cases.add(command.streamId)
    if (command.kind === 'form_snapshot') forms.push(command.privatePayload!)
    await route.continue()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return { forms, cases }
}
async function locate(page: Page) {
  await page.getByRole('button', { name: 'Ukážková mapa — vybrať Dolné Orešany' }).click()
  await page.getByRole('button', { name: 'Potvrdiť polohu' }).click()
}
async function identify(page: Page) {
  await page.getByRole('button', { name: 'Nemám fotografiu' }).click()
  await page.getByRole('combobox').fill('mac')
  await page.getByRole('option', { name: 'Mačka', exact: true }).click()
  await page.getByRole('button', { name: 'Potvrdiť voľbu' }).click()
}
async function submit(page: Page) {
  await page.getByRole('button', { name: 'Odoslať a ukončiť', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
}

test('acute cruelty resumes police results and final contact choices across reload before submission', async ({
  page
}) => {
  const { forms, cases } = await capture(page)
  await page.goto('/?fixture=clean')
  await page.getByRole('button', { name: 'Týranie/zanedbávanie zvieraťa', exact: true }).click()
  await page.getByRole('button', { name: 'Volať na políciu – 158' }).click()
  await page.getByRole('button', { name: 'Nepodarilo sa nahlásiť', exact: true }).click()
  await page.getByLabel('Polícia odmietla prípad riešiť').check()
  await page.getByLabel('Iné', { exact: true }).check()
  await page.getByRole('textbox').fill('Synthetic police outcome')
  await page.reload()
  await expect(page.getByRole('textbox')).toHaveValue('Synthetic police outcome')
  await page.getByRole('button', { name: 'Zdokumentovať prípad' }).click()
  await locate(page)
  await identify(page)
  await page.getByRole('checkbox', { name: 'Zapaľované zviera', exact: true }).check()
  await page.getByRole('textbox', { name: 'Vlastný opis situácie' }).fill('Synthetic cruelty description')
  await page.getByRole('button', { name: 'Potvrdiť', exact: true }).click()
  await expect(page).toHaveURL(/\/w39$/)
  await page.locator('input[type=email]').fill('synthetic@example.invalid')
  await page.locator('input[name=share-contact]').check()
  await page.reload()
  await expect(page.locator('input[type=email]')).toHaveValue('synthetic@example.invalid')
  await expect(page.locator('input[name=share-contact]')).toBeChecked()
  await submit(page)
  expect(cases.size).toBe(1)
  expect(forms.at(-1)).toMatchObject({
    situationType: 'cruelty',
    cruelty: {
      acute: true,
      signs: ['burned'],
      description: 'Synthetic cruelty description',
      police: { outcome: 'not-reported', reasons: ['refused', 'other'], description: 'Synthetic police outcome' }
    }
  })
})

test('submits other documentation with optional description', async ({ page }) => {
  const { forms } = await capture(page)
  await page.goto('/?fixture=clean')
  await page.getByRole('button', { name: 'Iné', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Na/pri ceste alebo koľajniciach' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Uviazlo alebo ho ohrozuje/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Iná situácia' }).click()
  await locate(page)
  await identify(page)
  await page.getByRole('textbox').fill('Synthetic circumstances')
  await page.getByRole('button', { name: 'Nahlásiť', exact: true }).click()
  await submit(page)
  expect(forms.at(-1)).toMatchObject({
    situationType: 'other',
    other: { branch: 'other', description: 'Synthetic circumstances' }
  })
})

test('closing an early draft collects a location and an exclusive outcome instead of deleting it', async ({ page }) => {
  const { forms, cases } = await capture(page)
  await page.goto('/?fixture=clean')
  await page.getByRole('button', { name: 'Iné', exact: true }).click()
  await expect(page).toHaveURL(/\/w32$/)
  await page.goto('/')
  await page.getByRole('button', { name: 'Uzavrieť prípad', exact: true }).click()
  await expect(page).toHaveURL(/\/w03$/)
  await locate(page)
  await expect(page).toHaveURL(/\/w26$/)
  await page.getByRole('radio', { name: 'Prípad sa nepodarilo vyriešiť', exact: true }).check()
  await page.getByRole('radio', { name: 'Iné', exact: true }).check()
  await expect(page.getByRole('radio', { name: 'Prípad sa nepodarilo vyriešiť', exact: true })).not.toBeChecked()
  await page.getByRole('textbox', { name: 'Opíšte, čo sa stalo' }).fill('Synthetic closure result')
  await submit(page)
  expect(cases.size).toBe(1)
  expect(forms.at(-1)).toMatchObject({
    situationType: 'other',
    closure: { status: 'other', description: 'Synthetic closure result' }
  })
})
