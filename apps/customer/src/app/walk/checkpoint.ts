import { createIdbRecordStore, type IdbRecordStore } from '@animal-helper/client/browser'
import type { ContactServiceKey } from '@animal-helper/contracts'
import type { PublicGuidance, WalkFacts } from '@animal-helper/guidance'
import type { AnimalIdentification } from '../animal-identification'
import type { LocationPoint } from '../contracts/forms'
import type { previewSession } from '../pages/fixtures/preview-session'

export type WalkCheckpoint = {
  streamId?: string
  savedAt?: number
  facts: WalkFacts
  session?: Omit<NonNullable<typeof previewSession.value>, 'media'>
  screen?: string
  location?: LocationPoint
  animalIdentification?: AnimalIdentification
  animalDetails?: Record<string, string | string[]>
  adviceReady?: boolean
  guidance?: PublicGuidance
  guidePath?: string
  visitedHelp?: (ContactServiceKey | 'self')[]
}

export type WalkCheckpointStore = IdbRecordStore<WalkCheckpoint> & { stage?: (value: WalkCheckpoint) => void }

// A tab-local synchronous journal protects the latest control edits when reload
// interrupts queued IndexedDB writes. The durable copy still supports reopening
// the browser; stream identity and timestamps prevent an older journal winning.
export function createWalkCheckpoint(indexedDb: IDBFactory): WalkCheckpointStore {
  const durable = createIdbRecordStore<WalkCheckpoint>(indexedDb, 'animal-helper.walk', 'walk')
  const key = 'animal-helper.walk.pending'
  const storage = () => {
    try {
      return globalThis.sessionStorage
    } catch {
      return undefined
    }
  }
  return {
    stage(value) {
      try {
        storage()?.setItem(key, JSON.stringify(value))
      } catch {
        /* IndexedDB remains available. */
      }
    },
    async load() {
      const saved = await durable.load()
      let staged: WalkCheckpoint | undefined
      try {
        staged = JSON.parse(storage()?.getItem(key) ?? 'null') as WalkCheckpoint | undefined
      } catch {
        /* Ignore a corrupt journal. */
      }
      if (
        staged?.streamId &&
        (!saved || (staged.streamId === saved.streamId && (staged.savedAt ?? 0) >= (saved.savedAt ?? 0)))
      )
        return staged
      return saved
    },
    save: durable.save,
    async clear() {
      try {
        storage()?.removeItem(key)
      } catch {
        /* Clear durable storage below. */
      }
      await durable.clear()
    }
  }
}
