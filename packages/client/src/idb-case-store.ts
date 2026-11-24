import type { CaseStore, StoredCase } from "./store.js";

const CASE_DATABASE = "animal-helper.case";
const CASE_STORE = "case";
const CURRENT_KEY = "current";

export type IdbRecordStore<T> = Readonly<{
  load: () => Promise<T | undefined>;
  save: (value: T) => Promise<void>;
  clear: () => Promise<void>;
}>;

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("indexedDB request failed"));
    };
  });

const openDatabase = (
  indexedDb: IDBFactory,
  databaseName: string,
  storeName: string,
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDb.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("indexedDB open failed"));
    };
  });

export const createIdbRecordStore = <T>(
  indexedDb: IDBFactory,
  databaseName: string,
  storeName: string,
): IdbRecordStore<T> => {
  const transactionDone = (transaction: IDBTransaction): Promise<void> =>
    new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("indexedDB transaction aborted"));
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("indexedDB transaction failed"));
      };
    });

  const run = async <Result>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<Result>,
  ): Promise<Result> => {
    const database = await openDatabase(indexedDb, databaseName, storeName);
    try {
      const transaction = database.transaction(storeName, mode);
      const done = transactionDone(transaction);
      const result = await requestResult(
        action(transaction.objectStore(storeName)),
      );
      await done;
      return result;
    } finally {
      database.close();
    }
  };

  return {
    load: async () => {
      const value = await run(
        "readonly",
        (store) => store.get(CURRENT_KEY) as IDBRequest<T | undefined>,
      );
      return value === undefined ? undefined : value;
    },
    save: (value) =>
      run("readwrite", (store) => store.put(value, CURRENT_KEY)).then(
        () => undefined,
      ),
    clear: () =>
      run("readwrite", (store) => store.delete(CURRENT_KEY)).then(
        () => undefined,
      ),
  };
};

const browserLocks = (): Pick<LockManager, "request"> | undefined =>
  (globalThis as { navigator?: { locks?: Pick<LockManager, "request"> } })
    .navigator?.locks;

export const createIdbCaseStore = (
  indexedDb: IDBFactory,
  locks: Pick<LockManager, "request"> | undefined = browserLocks(),
): CaseStore => ({
  ...createIdbRecordStore<StoredCase>(indexedDb, CASE_DATABASE, CASE_STORE),
  exclusive: async (operation) => {
    if (!locks) throw new Error("Cross-tab case locking is unavailable");
    return locks.request(`${CASE_DATABASE}:${CURRENT_KEY}`, operation);
  },
});
