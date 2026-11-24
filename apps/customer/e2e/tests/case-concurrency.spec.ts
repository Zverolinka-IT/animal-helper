import type { CaseSession } from '@animal-helper/client'
import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

const clientUrl = '/@fs' + new URL('../../../../packages/client/src/index.ts', import.meta.url).pathname
const storeUrl = '/@fs' + new URL('../../../../packages/client/src/idb-case-store.ts', import.meta.url).pathname
type CaseWindow = Window & { concurrencySession: CaseSession }

async function initialize(page: Page) {
  await page.goto('/')
  await page.evaluate(
    async ({ clientUrl, storeUrl }) => {
      const { createCaseSession, createFetchTransport } = await import(clientUrl)
      const { createIdbCaseStore } = await import(storeUrl)
      ;(window as unknown as CaseWindow).concurrencySession = createCaseSession({
        store: createIdbCaseStore(indexedDB),
        transport: createFetchTransport({ baseUrl: location.origin })
      })
    },
    { clientUrl, storeUrl }
  )
}

test('serializes durable case commands across tabs, including a late network failure', async ({ context, page }) => {
  let version = 0
  let delayed = false
  let started!: () => void
  let release!: () => void
  const pending = new Promise<void>(resolve => {
    started = resolve
  })
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const attempts: number[] = []
  await context.route('**/commands', async route => {
    const command = route.request().postDataJSON() as { type: string; expectedVersion: number }
    attempts.push(command.expectedVersion)
    if (command.type === 'attach_private_data' && !delayed) {
      delayed = true
      started()
      await held
      await route.abort('failed')
      return
    }
    const matches = command.expectedVersion === version
    if (matches) version++
    await route.fulfill({
      status: matches ? 200 : 409,
      contentType: 'application/json',
      body: JSON.stringify(
        matches
          ? { ok: true, value: { outcome: 'applied', committedVersion: version, publicState: 'draft' } }
          : { ok: false, error: { code: 'VERSION_CONFLICT' } }
      )
    })
  })
  const other = await context.newPage()
  await initialize(page)
  await initialize(other)
  expect((await page.evaluate(() => (window as unknown as CaseWindow).concurrencySession.openDraft())).ok).toBe(true)
  const a = page.evaluate(() => (window as unknown as CaseWindow).concurrencySession.attachText({ note: 'First tab' }))
  await pending
  const b = other.evaluate(() =>
    (window as unknown as CaseWindow).concurrencySession.attachText({ note: 'Second tab' })
  )
  try {
    await expect
      .poll(() =>
        other.evaluate(
          async () =>
            (await navigator.locks.query()).pending?.filter(lock => lock.name === 'animal-helper.case:current').length
        )
      )
      .toBe(1)
    expect(attempts).toEqual([0, 1])
  } finally {
    release()
  }
  expect((await a).ok).toBe(false)
  expect((await b).ok).toBe(true)
  expect(await other.evaluate(() => (window as unknown as CaseWindow).concurrencySession.snapshot())).toMatchObject({
    expectedVersion: 3,
    pendingCount: 0
  })
  expect(version).toBe(3)
  expect(attempts).toEqual([0, 1, 1, 2])
})
