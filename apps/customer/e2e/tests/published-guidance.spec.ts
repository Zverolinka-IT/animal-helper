import { syntheticContactDirectoryEntry } from '@animal-helper/contracts'
import { bundledPublicGuidance } from '@animal-helper/guidance'
import { expect, test } from '@playwright/test'

test('renders published guidance and follows species-specific contact steps', async ({ page }) => {
  const guidance = structuredClone(bundledPublicGuidance())
  const cat = guidance.kinds.domestic_cat
  if (!cat) throw new Error('missing synthetic kind')
  guidance.source = 'published'
  guidance.revisionId = '018f1a50-7c3b-7000-8000-000000000101'
  guidance.contentHash = 'b'.repeat(64)
  guidance.contactDirectory = {
    schemaVersion: 1,
    jurisdiction: 'SK',
    revisionId: '018f1a50-7c3b-7000-8000-000000000201',
    publishedAt: new Date().toISOString(),
    entries: [
      syntheticContactDirectoryEntry({
        name: 'Synthetic published municipality',
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
        }
      }),
      syntheticContactDirectoryEntry({ id: '018f1a50-7c3b-7000-8000-000000000202' })
    ]
  }
  guidance.kinds = {
    ...guidance.kinds,
    domestic_cat: {
      items: cat.items.map(item => {
        if (item.instructionKey === 'warning.do_not')
          return { ...item, slots: { 'warning.do_not': 'Synthetic published warning.' } }
        if (item.instructionKey === 'contact.primary')
          return {
            ...item,
            slots: {
              'contact.primary.title': 'Synthetic published contact',
              'contact.primary.body': 'Synthetic contact instructions.'
            }
          }
        return item
      })
    }
  }
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
  await expect(page.getByText('Synthetic published warning.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rozumiem', exact: true }).click()
  await expect(page).toHaveURL(/\/w15$/)
  await expect(page.getByRole('heading', { name: 'Synthetic published contact', exact: true }).first()).toBeVisible()
  await expect(page.getByText('Synthetic contact instructions.', { exact: true })).toBeVisible()
  await expect(page.getByText('Ukážková obec', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Synthetic published municipality', exact: true })).toBeVisible()
  await expect(page.locator('a[href="tel:+421000000001"]')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Navigovať', exact: true })).toHaveAttribute(
    'href',
    /destination=48\.433%2C17\.43/
  )
  await expect(page.getByText('Telefón doplní server')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Dôležité!', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Iné možnosti pomoci', exact: true }).click()
  await expect(page).toHaveURL(/\/w18$/)
  await expect(page.getByRole('heading', { name: 'Synthetic veterinary contact', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Späť', exact: true }).click()
  await expect(page).toHaveURL(/\/w15$/)
  await page.getByRole('button', { name: 'Rady', exact: true }).click()
  await expect(page.getByRole('dialog').getByText('Synthetic published warning.', { exact: true })).toBeVisible()
})
