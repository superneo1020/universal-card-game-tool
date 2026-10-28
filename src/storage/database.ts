import { toErrorMessage } from '../utils/errors';

const DATABASE_NAME = 'card-studio';
const DATABASE_VERSION = 1;
const STORE_NAME = 'project';

function getIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this browser.');
  }
  return indexedDB;
}

/**
 * Opens the application database and creates the key-value project store on
 * first use. Callers close the connection after their transaction.
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = getIndexedDb().open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the local database.'));
    request.onblocked = () =>
      reject(
        new Error(
          'The local database upgrade is blocked by another open tab. Close other tabs and retry.',
        ),
      );
  });
}

/** Reads one key from the project store; `undefined` means the key is absent. */
export async function readStoredValue(key: string): Promise<unknown> {
  const database = await openDatabase();

  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ??
            new Error(`Could not read local data for "${key}".`),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error('The local read transaction was aborted.'),
        );
    });
  } finally {
    database.close();
  }
}

/** Lists all string keys currently present in the project store. */
export async function readStoredKeys(): Promise<string[]> {
  const database = await openDatabase();

  try {
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).getAllKeys();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          request.error ?? new Error('Could not list local data keys.'),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error('The local key listing was aborted.'),
        );
    });

    return keys.filter((key): key is string => typeof key === 'string');
  } finally {
    database.close();
  }
}

/** Writes one key atomically to the project store. */
export async function writeStoredValue(
  key: string,
  value: unknown,
): Promise<void> {
  const database = await openDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');

      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error('The local write transaction was aborted.'),
        );
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error(`Could not write local data for "${key}".`),
        );

      transaction.objectStore(STORE_NAME).put(value, key);
    });
  } finally {
    database.close();
  }
}

/**
 * Writes one key and deletes legacy keys in a single readwrite transaction.
 *
 * If any operation aborts, the whole transaction rolls back, so the new value
 * is never committed while stale keys survive (or vice versa).
 */
export async function writeStoredValueAndDeleteKeys(
  key: string,
  value: unknown,
  keysToDelete: readonly string[],
): Promise<void> {
  const database = await openDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error('The local migration transaction was aborted.'),
        );
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error(
              `Could not commit local data for "${key}" with legacy cleanup.`,
            ),
        );

      store.put(value, key);
      keysToDelete.forEach((legacyKey) => store.delete(legacyKey));
    });
  } finally {
    database.close();
  }
}

/** Deletes one key atomically from the project store. */
export async function deleteStoredValue(key: string): Promise<void> {
  const database = await openDatabase();

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');

      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          transaction.error ??
            new Error('The local delete transaction was aborted.'),
        );
      transaction.onerror = () =>
        reject(
          transaction.error ??
            new Error(`Could not delete local data for "${key}".`),
        );

      transaction.objectStore(STORE_NAME).delete(key);
    });
  } finally {
    database.close();
  }
}

export { toErrorMessage };
