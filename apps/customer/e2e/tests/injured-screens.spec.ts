import { bundledPublicGuidance } from '@animal-helper/guidance'
import { expect, test } from '@playwright/test'

test('an injured report can open the new contact, self-help and thank-you screens', async ({ page }) => {
  await page.route('**/guidance', route => route.fulfill({ json: bundledPublicGuidance() }))
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

  await page.goto('/w15c')
  await expect(page.getByRole('heading', { name: 'Kontaktujte obvodnú poľovnícku komoru' })).toBeVisible()
  await expect(page.getByText('môže zranenú zver usmrtiť')).toBeVisible()

  await page.goto('/w20b')
  await expect(page.getByRole('heading', { name: 'Došlo k zrážke vozidla so zvieraťom?' })).toBeVisible()
  await expect(page.getByRole('link', { name: '112' })).toHaveAttribute('href', 'tel:112')
  await expect(page.getByRole('button', { name: 'Zviera stále potrebuje pomoc' })).toBeVisible()

  await page.goto('/w22b')
  await expect(page.getByRole('heading', { name: 'Pomôžte sami' })).toBeVisible()
  await expect(page.getByText('Kačica hviezdavá')).toBeVisible()

  await page.goto('/w39a')
  await expect(page.getByRole('heading', { name: 'Kto pomohol zvieraťu?' })).toBeVisible()
  await page.getByRole('radio', { name: 'Veterinár / klinika' }).check()
  await expect(page.getByRole('radio', { name: 'Dobrovoľník Zverolinky' })).not.toBeChecked()
})
