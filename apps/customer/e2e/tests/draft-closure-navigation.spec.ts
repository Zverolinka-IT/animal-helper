import { expect, test, type Page } from '@playwright/test'

async function leave(page: Page) {
  await page.getByRole('button', { name: 'Opustiť hlásenie prípadu', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Opustiť hlásenie prípadu', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
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

test.use({ viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?fixture=clean')
})

test('closure Back, exit and reload keep the original report and separate closure answers', async ({ page }) => {
  const commands: { type: string; kind?: string; privatePayload?: unknown }[] = []
  await page.route('**/commands', async route => {
    commands.push(route.request().postDataJSON() as (typeof commands)[number])
    await route.continue()
  })
  await page.getByRole('button', { name: 'Zviera je zranené', exact: true }).click()
  await locate(page)
  await identify(page)
  await page.getByRole('checkbox', { name: 'Iné', exact: true }).check()
  await page.getByRole('textbox').fill('Synthetic report symptom')
  await leave(page)
  await page.getByRole('button', { name: 'Uzavrieť prípad', exact: true }).click()
  await expect(page).toHaveURL(/\/w26$/)
  await page.getByRole('radio', { name: 'Iné', exact: true }).check()
  await page.getByRole('textbox', { name: 'Opíšte, čo sa stalo' }).fill('Synthetic closure result')
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Opíšte, čo sa stalo' })).toHaveValue('Synthetic closure result')
  await page.getByRole('button', { name: 'Späť', exact: true }).click()
  await expect(page).toHaveURL(/\/w09$/)
  await expect(page.locator('.customer-animal-details textarea')).toHaveValue('Synthetic report symptom')
  await leave(page)
  await page.getByRole('button', { name: 'Uzavrieť prípad', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Opíšte, čo sa stalo' })).toHaveValue('Synthetic closure result')
  await leave(page)
  await page.reload()
  await page.getByRole('button', { name: 'Pokračovať', exact: true }).click()
  await expect(page).toHaveURL(/\/w09$/)
  await expect(page.locator('.customer-animal-details textarea')).toHaveValue('Synthetic report symptom')
  await leave(page)
  await page.getByRole('button', { name: 'Uzavrieť prípad', exact: true }).click()
  await page.getByRole('button', { name: 'Späť', exact: true }).click()
  await expect(page).toHaveURL(/\/w09$/)
  await leave(page)
  await page.getByRole('button', { name: 'Uzavrieť prípad', exact: true }).click()
  await page.getByRole('button', { name: 'Odoslať a ukončiť', exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(commands.filter(command => command.type === 'create_draft')).toHaveLength(1)
  expect(commands.filter(command => command.type === 'submit_draft')).toHaveLength(1)
  expect(commands.filter(command => command.kind === 'form_snapshot').at(-1)?.privatePayload).toMatchObject({
    closure: { status: 'other', description: 'Synthetic closure result' },
    condition: { symptoms: ['other'], otherText: 'Synthetic report symptom' }
  })
})

test('Back after supplying an early closure location returns to branch selection and resumes the normal report', async ({
  page
}) => {
  await page.getByRole('button', { name: 'Iné', exact: true }).click()
  await leave(page)
  await page.getByRole('button', { name: 'Uzavrieť prípad', exact: true }).click()
  await expect(page).toHaveURL(/\/w03$/)
  await locate(page)
  await expect(page).toHaveURL(/\/w26$/)
  await page.getByRole('button', { name: 'Späť', exact: true }).click()
  await expect(page).toHaveURL(/\/w32$/)
  await page.getByRole('button', { name: 'Iná situácia', exact: true }).click()
  await locate(page)
  await expect(page).toHaveURL(/\/w04$/)
})

test('mobile controls remain readable and expanded alternatives stay clear of the sticky confirmation', async ({
  page
}, testInfo) => {
  await page.getByRole('button', { name: 'Zviera je zranené', exact: true }).click()
  await locate(page)
  await page.getByRole('button', { name: 'Nemám fotografiu' }).click()
  const search = page.getByRole('combobox')
  expect(await search.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  await page.getByRole('radio', { name: 'Iné zviera', exact: true }).check()
  const text = page.locator('.customer-animal-groups__description textarea')
  await text.fill('Synthetic unknown animal')
  expect(await text.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  await text.evaluate(element => element.scrollIntoView({ block: 'nearest' }))
  const controlBounds = await text.boundingBox()
  const footerBounds = await page.locator('.customer-animal-groups__actions').boundingBox()
  expect(controlBounds).not.toBeNull()
  expect(footerBounds).not.toBeNull()
  expect(controlBounds!.y + controlBounds!.height).toBeLessThanOrEqual(footerBounds!.y + 1)
  expect(footerBounds!.height).toBeLessThan(110)
  await expect(page.getByRole('button', { name: 'Potvrdiť voľbu' })).toBeEnabled()
  await page.screenshot({ path: testInfo.outputPath('animal-selection-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 852, height: 393 })
  expect(await search.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16)
  await page.getByRole('button', { name: 'Potvrdiť voľbu' }).click()
  await expect(page).toHaveURL(/\/w09$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content')
  expect(viewport).not.toContain('user-scalable=no')
  expect(viewport).not.toContain('maximum-scale=1')
})
