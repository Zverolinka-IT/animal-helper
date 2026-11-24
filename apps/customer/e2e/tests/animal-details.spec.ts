import { expect, test } from '@playwright/test'

test('home does not offer a dead-animal report', async ({ page }) => {
  await page.goto('/?fixture=clean')
  await expect(page.getByRole('button', { name: 'Zviera je zranené', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nález mŕtveho zvieraťa' })).toHaveCount(0)
})

test('stray details persist without requiring answers or claiming a successful rescue', async ({ page }) => {
  const snapshots: unknown[] = []
  await page.route('**/commands', async route => {
    const command = route.request().postDataJSON() as { kind?: string; privatePayload?: unknown }
    if (command.kind === 'form_snapshot') snapshots.push(command.privatePayload)
    await route.continue()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?fixture=clean')
  await page.getByRole('button', { name: 'Zviera je zatúlané', exact: true }).click()
  await page.getByRole('button', { name: 'Ukážková mapa — vybrať Dolné Orešany' }).click()
  await page.getByRole('button', { name: 'Potvrdiť polohu' }).click()
  await page.getByRole('button', { name: 'Nemám fotografiu' }).click()
  await page.getByRole('combobox').fill('mac')
  await page.getByRole('option', { name: 'Mačka', exact: true }).click()
  await page.getByRole('button', { name: 'Potvrdiť voľbu' }).click()
  await expect(page.getByRole('button', { name: 'Zobraziť možnosti pomoci' })).toBeEnabled()
  await expect(page.locator('input[name=conscious]')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Pôsobí zmätene' }).check()
  await page.locator('input[name=collar][value=no]').check()
  await page.getByRole('button', { name: 'Zobraziť možnosti pomoci' }).click()
  await expect(page).toHaveURL(/\/w14$/)
  await page.getByRole('button', { name: 'Pokračovať v hlásení', exact: true }).click()
  await expect(page).toHaveURL(/\/w24$/)
  await expect(page.locator('input[type=email]')).toHaveValue('')
  await expect(page.locator('input[name=share-contact]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Odoslať a ukončiť' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(snapshots).toHaveLength(2)
  expect(snapshots[1]).toMatchObject({
    situationType: 'stray',
    condition: { symptoms: [], behaviour: ['confused'], collar: 'no' }
  })
  expect(snapshots[1]).toEqual(snapshots[0])
  expect(snapshots[0]).not.toHaveProperty('outcome')
})
