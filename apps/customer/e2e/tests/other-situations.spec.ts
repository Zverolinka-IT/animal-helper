import { expect, test, type Page } from '@playwright/test'

async function start(page: Page, choice: string) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Iné', exact: true }).click()
  await expect(page).toHaveURL(/\/w32$/)
  await page.getByRole('button', { name: choice }).click()
  await expect(page).toHaveURL(/\/w03$/)
  await page.getByRole('button', { name: 'Ukážková mapa — vybrať Dolné Orešany' }).click()
  await page.getByRole('button', { name: 'Potvrdiť polohu' }).click()
}
async function identify(page: Page) {
  await expect(page).toHaveURL(/\/w04$/)
  await page.getByRole('button', { name: 'Nemám fotografiu' }).click()
  await page.getByRole('combobox').fill('mac')
  await page.getByRole('option', { name: 'Mačka', exact: true }).click()
  await page.getByRole('button', { name: 'Potvrdiť voľbu' }).click()
  await expect(page).toHaveURL(/\/w09$/)
}

test('other situation ends with identification and thanks, without advice', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Iné', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'V akej situácii je zviera?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Iná situácia', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Na/pri ceste alebo koľajniciach' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Uviazlo alebo ho ohrozuje/ })).toHaveCount(0)
  await expect(page.locator('.customer-other-situation')).toHaveCSS('opacity', '1')
  await page.screenshot({ path: testInfo.outputPath('other-choice.png'), fullPage: true })
  await start(page, 'Iná situácia')
  await identify(page)
  await expect(page.getByRole('radio')).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Opíšte situáciu' }).fill('Synthetic description')
  await page.getByRole('button', { name: 'Nahlásiť', exact: true }).click()
  await expect(page).toHaveURL(/\/w39$/)
})
