import type { FormSnapshotV1 } from '@animal-helper/contracts'
import { expect, test } from '@playwright/test'

test('allows corrected contact and consent after a failed submission', async ({ page }) => {
  const contacts: unknown[] = []
  const forms: FormSnapshotV1[] = []
  let first = true
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  await page.route('**/commands', async route => {
    const command = route.request().postDataJSON() as { type: string; kind?: string; privatePayload?: unknown }
    if (command.kind === 'form_snapshot') forms.push(command.privatePayload as FormSnapshotV1)
    if (command.kind === 'contact') contacts.push(command.privatePayload)
    if (command.type === 'submit_draft' && first) {
      first = false
      await held
      await route.abort('failed')
      return
    }
    await route.continue()
  })
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
  // The bundled cat walk visits municipality, clinic and volunteers before self-help.
  for (let step = 0; step < 3; step++)
    await page.getByRole('button', { name: 'Iné možnosti pomoci', exact: true }).click()
  await expect(page).toHaveURL(/\/w22$/)
  await page.getByRole('button', { name: 'Nepodarilo sa pomôcť', exact: true }).click()
  await page.locator('input[name=municipality-refused]').check()
  await page.locator('input[name=other]').check()
  await page.getByRole('textbox', { name: 'Opíšte, čo sa stalo' }).fill('Synthetic failure')
  await expect(page.locator('input[name=police-refused]')).toHaveCount(0)
  await page.locator('input[type=email]').fill('first@example.org')
  await page.locator('input[name=share-contact]').check()
  await page.locator('input[name=newsletter]').check()
  const submit = page.locator('button[type=submit]')
  await submit.click()
  try {
    await expect(submit).toBeDisabled()
    await expect(page.locator('form.customer-thank-you')).toHaveAttribute('inert', '')
  } finally {
    release()
  }
  await expect(submit).toBeEnabled()
  await expect(page.getByText('Server je teraz nedostupný. Skúste to znova.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Zavrieť oznámenie', exact: true }).click()
  await page.locator('input[type=email]').fill('corrected@example.org')
  await page.locator('input[name=share-contact]').uncheck()
  await page.locator('input[name=newsletter]').uncheck()
  await page.locator('input[name=other]').uncheck()
  await page.locator('input[name=municipality-refused]').uncheck()
  await page.locator('input[name=escaped]').check()
  await submit.click()
  await expect(page).toHaveURL(/\/$/)
  expect(forms.filter(form => form.outcome).map(form => form.outcome)).toEqual([
    { status: 'unresolved', reasons: ['municipality-refused', 'other'], otherText: 'Synthetic failure' },
    { status: 'unresolved', reasons: ['escaped'] }
  ])
  expect(contacts).toEqual([
    expect.objectContaining({ email: 'first@example.org', shareWithAuthorities: true, newsletter: true }),
    expect.objectContaining({ email: 'corrected@example.org', shareWithAuthorities: false, newsletter: false })
  ])
})
